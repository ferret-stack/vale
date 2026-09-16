'use strict';
/**
 * A fake Apps Script environment, good enough to run the Vale library's
 * server-side code in a Node VM.
 *
 * It does NOT go into the Apps Script editor. It exists so the parts that can
 * be checked off a live Sheet are checked rather than asserted by reading.
 *
 * What is faithfully modelled: header-addressed reads and writes, getLastRow /
 * getLastColumn growing as rows are appended, per-row flush, the Gmail draft
 * -> send -> message-id/thread-id chain, and the script lock. What is stubbed
 * flat: formatting, column widths, and the two HtmlService surfaces, none of
 * which any assertion depends on.
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) row.push(this.sheet._get(this.row + r, this.col + c));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.sheet._get(this.row, this.col); }
  setValues(vals) {
    if (vals.length !== this.numRows) {
      throw new Error('setValues: expected ' + this.numRows + ' rows, got ' + vals.length);
    }
    for (let r = 0; r < this.numRows; r++) {
      if (vals[r].length !== this.numCols) {
        throw new Error('setValues: row ' + r + ' expected ' + this.numCols +
          ' cols, got ' + vals[r].length);
      }
      for (let c = 0; c < this.numCols; c++) this.sheet._set(this.row + r, this.col + c, vals[r][c]);
    }
    return this;
  }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  getA1Notation() { return colName(this.col) + this.row; }
  // Formatting is irrelevant to every assertion; chainable no-ops.
  setWrap() { return this; } setFontWeight() { return this; } setBackground() { return this; }
  setVerticalAlignment() { return this; } setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name, grid) {
    this.name = name;
    this._grid = grid || [];   // array of arrays; '' means empty
    this.hidden = false;
  }
  _get(row, col) {
    const r = this._grid[row - 1];
    if (!r) return '';
    const v = r[col - 1];
    return v === undefined || v === null ? '' : v;
  }
  _set(row, col, v) {
    while (this._grid.length < row) this._grid.push([]);
    const r = this._grid[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = v;
  }
  getName() { return this.name; }
  /** Highest row holding any non-empty cell — matches Sheets' own definition. */
  getLastRow() {
    for (let r = this._grid.length; r >= 1; r--) {
      const row = this._grid[r - 1] || [];
      if (row.some(v => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this._grid) {
      if (!row) continue;
      for (let c = row.length; c >= 1; c--) {
        const v = row[c - 1];
        if (v !== '' && v !== undefined && v !== null) { if (c > max) max = c; break; }
      }
    }
    return max;
  }
  getMaxRows() { return Math.max(1000, this._grid.length); }
  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows === undefined ? 1 : numRows,
                         numCols === undefined ? 1 : numCols);
  }
  setColumnWidth() { return this; }
  setFrozenRows() { return this; }
  hideSheet() { this.hidden = true; return this; }
  deleteRow(r) { this._grid.splice(r - 1, 1); return this; }
  getActiveRangeList() { return null; }
  getActiveRange() { return null; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; this.active = null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  setActiveSheet(s) { this.active = s; return s; }
  getActiveSheet() { return this.active || this.sheets[0]; }
  getId() { return 'FAKE_SPREADSHEET_ID'; }
}

/**
 * Builds the sandbox and loads every library .js file into it, in filename
 * order — the same order the Apps Script editor uses, which is why the numeric
 * prefixes exist.
 */
function makeEnv(opts) {
  opts = opts || {};
  const ss = new FakeSpreadsheet();

  const sent = [];        // every GmailApp send, with the full options object
  const alerts = [];      // every Ui.alert
  const dialogs = [];     // every modal dialog opened
  const prompts = (opts.prompts || []).slice();

  let quota = opts.quota === undefined ? 1500 : opts.quota;
  let msgSeq = 0;

  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    alert(title, msg) { alerts.push({ title, msg }); return 'OK'; },
    prompt(title, msg) {
      const next = prompts.length ? prompts.shift() : { button: 'CANCEL', text: '' };
      return {
        getSelectedButton: () => next.button,
        getResponseText: () => next.text === undefined ? '' : next.text
      };
    },
    showSidebar(h) { dialogs.push({ kind: 'sidebar', h }); },
    showModalDialog(h, title) { dialogs.push({ kind: 'modal', title, h }); },
    createMenu(name) {
      const items = [];
      const m = {
        addItem: (c, f) => { items.push({ caption: c, fn: f }); return m; },
        addSeparator: () => m,
        addToUi: () => { ss._menu = { name, items }; }
      };
      return m;
    }
  };

  // confirm_() goes through ui.alert with YES_NO; let a test force the answer.
  if (opts.confirmAnswer) {
    const inner = ui.alert.bind(ui);
    ui.alert = (title, msg, buttons) => {
      inner(title, msg);
      return buttons === 'YES_NO' ? opts.confirmAnswer : 'OK';
    };
  }

  const sandbox = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => ss,
      getUi: () => ui,
      flush: () => { sandbox.__flushes = (sandbox.__flushes || 0) + 1; }
    },
    MailApp: { getRemainingDailyQuota: () => quota },
    GmailApp: {
      createDraft(to, subject, body, options) {
        return {
          send() {
            if (opts.failSendOn && opts.failSendOn(to, subject)) {
              throw new Error('simulated Gmail failure');
            }
            msgSeq++;
            const rec = { to, subject, body, options: options || {}, id: 'msg-' + msgSeq };
            sent.push(rec);
            quota--;
            return {
              getId: () => rec.id,
              getThread: () => ({ getId: () => 'thread-' + msgSeq })
            };
          }
        };
      }
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = n => String(n).padStart(2, '0');
        return fmt.replace('yyyy', d.getFullYear())
                  .replace('MM', p(d.getMonth() + 1))
                  .replace('dd', p(d.getDate()));
      },
      computeDigest: (_alg, s) => Buffer.from(String(s)),
      base64Encode: b => Buffer.from(b).toString('base64'),
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' }
    },
    Session: {
      getScriptTimeZone: () => 'Europe/London',
      getActiveUser: () => ({ getEmail: () => 'operator@example.com' }),
      getEffectiveUser: () => ({ getEmail: () => 'operator@example.com' })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => opts.lockBusy !== true, releaseLock() {} })
    },
    HtmlService: {
      createHtmlOutputFromFile: n => ({
        setTitle() { return this; }, setWidth() { return this; }, _file: n
      }),
      createTemplateFromFile: n => ({
        _file: n,
        evaluate() { return { setWidth() { return this; }, setHeight() { return this; }, _file: n }; }
      })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const libDir = path.join(__dirname, '..', 'library');
  const files = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).sort();
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(libDir, f), 'utf8'), sandbox, { filename: f });
  }

  return {
    sandbox, ss, sent, alerts, dialogs,
    files,
    setQuota: q => { quota = q; },
    addSheet(name, grid) { const s = new FakeSheet(name, grid); ss.sheets.push(s); return s; },
    /** Load a container file (seed data / profile) into the same sandbox. */
    loadContainer(relPath) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'),
                      sandbox, { filename: relPath });
    },
    run(expr) { return vm.runInContext(expr, sandbox); },
    call(fn, ...args) {
      sandbox.__args = args;
      return vm.runInContext(fn + '.apply(null, __args)', sandbox);
    }
  };
}

module.exports = { makeEnv, FakeSheet };
