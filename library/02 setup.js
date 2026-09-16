/**
 * 02_Setup.gs  [LIBRARY]
 * Called ONCE per BDM, via the container's setupWorkbook(), on a blank sheet.
 *
 * Idempotent by design: re-running never duplicates a sheet, never reorders or
 * deletes a column, never overwrites an Engine value the operator has changed,
 * and never re-adds seed data to a sheet that already has rows.
 *
 * MULTI-BDM CHANGE: seed data is no longer a global this file reaches for. It
 * is passed in, because seed data is BDM-owned and lives in the container
 * script (03_SeedData.gs there, absent here — the gap at 03 in this library is
 * deliberate and is the reminder of that). Everything else is shared.
 *
 * seed = { prospects: [ …PROSPECT_SEED… ], templates: [ …TEMPLATE_SEED… ] }
 */
function setupWorkbook_(seed) {
  if (!seed || !seed.prospects || !seed.templates) {
    throw new Error('setupWorkbook_ needs seed data from the container script: ' +
      '{ prospects: PROSPECT_SEED, templates: TEMPLATE_SEED }.');
  }
  var ss = SpreadsheetApp.getActive();

  var prospects = ensureSheet_(ss, SHEETS.PROSPECTS, PROSPECT_COLS);
  var queue     = ensureSheet_(ss, SHEETS.QUEUE, QUEUE_COLS);
  var templates = ensureSheet_(ss, SHEETS.TEMPLATES, TEMPLATE_COLS);
  var engine    = ensureSheet_(ss, SHEETS.ENGINE, ENGINE_COLS);
  var runLog    = ensureSheet_(ss, SHEETS.RUN_LOG, RUN_LOG_COLS);

  ensureEngineDefaults_(engine);
  ensureTemplates_(templates, seed.templates);
  ensureSeedProspects_(prospects, seed.prospects);

  formatSheet_(prospects);
  formatSheet_(queue);
  formatSheet_(templates);
  formatSheet_(engine);
  formatSheet_(runLog);

  templates.setColumnWidth(col_(headerMap_(templates), 'Subject', SHEETS.TEMPLATES), 320);
  templates.setColumnWidth(col_(headerMap_(templates), 'Body', SHEETS.TEMPLATES), 520);
  engine.setColumnWidth(col_(headerMap_(engine), 'Value', SHEETS.ENGINE), 420);
  engine.setColumnWidth(col_(headerMap_(engine), 'Notes', SHEETS.ENGINE), 460);

  // Hidden so the operator never needs to open it to run a batch (§5).
  // Not a security control — see the note at the top of 01_Engine.gs.
  engine.hideSheet();

  // Remove the default "Sheet1" only if it is untouched.
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && def.getLastColumn() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }

  ss.setActiveSheet(prospects);
  SpreadsheetApp.getUi().alert(
    'Setup complete',
    'Workbook built.\n\n' +
    'Before sending anything, unhide the Engine sheet (View ▸ Show hidden sheets) and replace:\n' +
    '  • TEST_EMAIL\n  • SENDER_NAME\n  • SIGNATURE_BLOCK\n\n' +
    'The run will refuse to send while these hold their shipped placeholder text.\n\n' +
    'MAX_SENDS_PER_RUN and MIN_DAYS_BETWEEN_EMAILS are set by the operator and ' +
    'are shown for reference only — editing them here has no effect.\n\n' +
    'Then reload the spreadsheet to pick up the Outreach menu.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Creates the sheet if absent. If present, appends any missing header WITHOUT
 * moving or deleting the existing ones — an operator who reordered columns
 * keeps their layout (§9.5 makes order irrelevant to the code).
 */
function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    return sh;
  }
  if (sh.getLastColumn() === 0 || sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    return sh;
  }
  var existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  var missing = cols.filter(function (c) { return existing.indexOf(c) === -1; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function formatSheet_(sh) {
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol);
  header.setFontWeight('bold').setBackground('#f0f0f0').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), lastCol).setVerticalAlignment('top');
}

/** Adds only keys that are absent. An operator's edited value is never touched. */
function ensureEngineDefaults_(sh) {
  var map = headerMap_(sh);
  var keyCol = col_(map, 'Key', SHEETS.ENGINE);
  var valCol = col_(map, 'Value', SHEETS.ENGINE);
  var noteCol = col_(map, 'Notes', SHEETS.ENGINE);

  var existing = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, keyCol, last - 1, 1).getValues().forEach(function (r) {
      var k = trim_(r[0]);
      if (k) existing[k] = true;
    });
  }

  ENGINE_DEFAULTS.forEach(function (d) {
    if (existing[d[0]]) return;
    var row = sh.getLastRow() + 1;
    sh.getRange(row, keyCol).setValue(d[0]);
    sh.getRange(row, valCol).setValue(d[1]);
    sh.getRange(row, noteCol).setValue(d[2]);
    sh.getRange(row, valCol).setWrap(true);
    sh.getRange(row, noteCol).setWrap(true);
  });
}

/** Seeds draft copy only if the sheet has no rows — never overwrites edits. */
function ensureTemplates_(sh, templateSeed) {
  if (sh.getLastRow() > 1) return;
  var map = headerMap_(sh);
  var rows = templateSeed.map(function (t) {
    var r = new Array(sh.getLastColumn()).fill('');
    r[col_(map, 'Stage', SHEETS.TEMPLATES) - 1] = t.stage;
    r[col_(map, 'Name', SHEETS.TEMPLATES) - 1] = t.name;
    r[col_(map, 'Subject', SHEETS.TEMPLATES) - 1] = t.subject;
    r[col_(map, 'Body', SHEETS.TEMPLATES) - 1] = t.body;
    r[col_(map, 'Active', SHEETS.TEMPLATES) - 1] = 'Y';
    return r;
  });
  sh.getRange(2, 1, rows.length, sh.getLastColumn()).setValues(rows);
  sh.getRange(2, 1, rows.length, sh.getLastColumn()).setWrap(true);
}

/** Seeds the container's dummy prospects only if the sheet has no rows. */
function ensureSeedProspects_(sh, prospectSeed) {
  if (sh.getLastRow() > 1) return;
  var map = headerMap_(sh);
  var width = sh.getLastColumn();
  var today = new Date();

  var rows = prospectSeed.map(function (p, i) {
    var r = new Array(width).fill('');
    function set(name, v) { r[col_(map, name, SHEETS.PROSPECTS) - 1] = v; }
    set('Prospect ID', PROSPECT_ID_PREFIX + padId_(i + 1));
    set('First Name', p.first);
    set('Last Name', p.last);
    set('Company', p.company);
    set('Job Title', p.title);
    set('Town/Area', p.town);
    set('Email', p.email);
    set('Phone', p.phone || '');
    set('Source', 'Seed data');
    set('Date Added', today);
    if (p.dnc) set('Do Not Contact', 'Y');
    // Paused is a routing outcome of the importer (see 11_ImportCore.gs), so
    // a seed row can carry it too and exercise the send-time gate on install.
    if (p.paused) set('Paused', 'Y');
    if (p.note) set('Notes', p.note);
    return r;
  });

  sh.getRange(2, 1, rows.length, width).setValues(rows);
}

function padId_(n) {
  var s = String(n);
  while (s.length < PROSPECT_ID_PAD) s = '0' + s;
  return s;
}