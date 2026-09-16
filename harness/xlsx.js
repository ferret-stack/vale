'use strict';
/**
 * Minimal .xlsx reader — enough to read a sheet's cells, nothing more.
 *
 * Dependency-free on purpose. This harness has to run with `node run.js` on a
 * clean checkout with no npm install, because a verification step that needs
 * its own setup is a verification step that stops being run.
 *
 * Handles the two things Muki_Template_SAMPLE.xlsx actually uses: stored and
 * deflated ZIP entries, and inline strings. Shared strings are supported too,
 * since a file re-saved by Excel will use them.
 */
const zlib = require('zlib');
const fs = require('fs');

function readEntries(buf) {
  // Locate End Of Central Directory, scanning back from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no EOCD record).');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory entry.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // Re-read the local header: its extra-field length can differ from the
    // central directory's, and using the wrong one lands mid-stream.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);

    out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, '&');
}

function colToNum(ref) {
  const letters = /^([A-Z]+)/.exec(ref)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Returns a dense 2D array of strings for the named sheet (default: first). */
function readSheet(path, wantName) {
  const z = readEntries(fs.readFileSync(path));
  const wb = z['xl/workbook.xml'].toString('utf8');
  const rels = z['xl/_rels/workbook.xml.rels'].toString('utf8');

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"[^>]*\/?>/g)) {
    sheets.push({ name: unescapeXml(m[1]), rid: m[2] });
  }
  const target = wantName ? sheets.find(s => s.name === wantName) : sheets[0];
  if (!target) throw new Error('No sheet named "' + wantName + '" in ' + path);

  // Attribute order is not guaranteed — this file writes Target before Id —
  // so each Relationship element is matched first and its attributes read
  // independently, rather than assuming a fixed order in one regex.
  let targetPath = null;
  for (const rm of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]*)"/.exec(rm[1]);
    const tg = /Target="([^"]*)"/.exec(rm[1]);
    if (id && tg && id[1] === target.rid) { targetPath = tg[1]; break; }
  }
  if (!targetPath) throw new Error('No relationship for ' + target.rid);
  let sheetPath = targetPath.replace(/^\/?xl\//, '').replace(/^\//, '');
  if (!z['xl/' + sheetPath]) sheetPath = 'worksheets/' + sheetPath.split('/').pop();
  const xml = z['xl/' + sheetPath].toString('utf8');

  // Shared strings, if the file uses them.
  const shared = [];
  if (z['xl/sharedStrings.xml']) {
    const ss = z['xl/sharedStrings.xml'].toString('utf8');
    for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(Array.from(si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
        .map(t => unescapeXml(t[1])).join(''));
    }
  }

  const rows = [];
  let maxCol = 0;
  for (const rm of xml.matchAll(/<row\b[^>]*?r="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g)) {
    const rowIdx = parseInt(rm[1], 10) - 1;
    const cells = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs);
      if (!ref) continue;
      const ci = colToNum(ref[1]) - 1;
      const type = (/t="([^"]*)"/.exec(attrs) || [, ''])[1];
      let v = '';
      if (type === 'inlineStr') {
        v = Array.from(inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(t => unescapeXml(t[1])).join('');
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) v = type === 's' ? (shared[parseInt(vm[1], 10)] || '') : unescapeXml(vm[1]);
      }
      cells[ci] = v;
      if (ci + 1 > maxCol) maxCol = ci + 1;
    }
    rows[rowIdx] = cells;
  }

  const height = rows.length;
  const out = [];
  for (let r = 0; r < height; r++) {
    const row = new Array(maxCol).fill('');
    if (rows[r]) for (let c = 0; c < maxCol; c++) if (rows[r][c] !== undefined) row[c] = rows[r][c];
    out.push(row);
  }
  return out;
}

module.exports = { readSheet };
