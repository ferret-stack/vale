'use strict';
const { makeEnv } = require('./gas.js');

/** Builds a sheet grid: header row + object rows addressed by header name. */
function grid(headers, rows) {
  const out = [headers.slice()];
  (rows || []).forEach(r => {
    const line = new Array(headers.length).fill('');
    Object.keys(r).forEach(k => {
      const i = headers.indexOf(k);
      if (i === -1) throw new Error('Test fixture uses unknown header "' + k + '"');
      line[i] = r[k];
    });
    out.push(line);
  });
  return out;
}

/**
 * A complete, working workbook. Engine gets the library's own defaults so the
 * fixture cannot drift from the shipped config, with overrides applied on top.
 */
function workbook(env, opts) {
  opts = opts || {};
  const PROSPECT_COLS = env.run('PROSPECT_COLS');
  const QUEUE_COLS = env.run('QUEUE_COLS');
  const TEMPLATE_COLS = env.run('TEMPLATE_COLS');
  const RUN_LOG_COLS = env.run('RUN_LOG_COLS');
  const defaults = env.run('ENGINE_DEFAULTS');

  const engineRows = defaults.map(d => ({ Key: d[0], Value: d[1], Notes: d[2] }));
  const sane = Object.assign({
    TEST_EMAIL: 'tester@example.com',
    SENDER_NAME: 'Muki B',
    SIGNATURE_BLOCK: '<p>Muki B<br>United Mortgages</p><p>Reply STOP to opt out.</p>'
  }, opts.engine || {});
  Object.keys(sane).forEach(k => {
    const row = engineRows.find(r => r.Key === k);
    if (row) row.Value = sane[k];
    else engineRows.push({ Key: k, Value: sane[k], Notes: '' });
  });
  (opts.dropEngineKeys || []).forEach(k => {
    const i = engineRows.findIndex(r => r.Key === k);
    if (i !== -1) engineRows.splice(i, 1);
  });

  env.addSheet('Prospects', grid(PROSPECT_COLS, opts.prospects || []));
  env.addSheet('Send Queue', grid(QUEUE_COLS, opts.queue || []));
  env.addSheet('Templates', grid(TEMPLATE_COLS, opts.templates || [
    { Stage: 1, Name: 'Stage 1', Subject: 'Quick question about {{Company}}',
      Body: 'Hi {{FirstName}},\n\nA note about {{Company}}.\n\nBest,', Active: 'Y' }
  ]));
  env.addSheet('Engine', grid(['Key', 'Value', 'Notes'], engineRows));
  env.addSheet('Run Log', grid(RUN_LOG_COLS, []));
  return env;
}

function fresh(opts) {
  const env = makeEnv(opts);
  workbook(env, opts);
  return env;
}

/** Reads a sheet back as objects keyed by header name. */
function readBack(env, sheetName) {
  const sh = env.ss.getSheetByName(sheetName);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().map(r => {
    const o = {};
    headers.forEach((h, i) => { if (String(h).trim()) o[String(h).trim()] = r[i]; });
    return o;
  });
}

module.exports = { grid, workbook, fresh, readBack, makeEnv };
