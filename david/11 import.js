/**
 * 11_Import.gs — Addendum v1 §2. One-shot import from a "Davids List"-shaped tab.
 *
 * Reads a source tab whose header row matches the Davids List layout and maps
 * the eight mapped columns into Prospects. Everything else in the source is
 * deliberately not imported (Addendum §2): the v1 schema does not carry those
 * columns, and the source's own outreach history is not equivalent to v1's
 * Email {n} Status state.
 *
 * Header-name resolution throughout (§1 / §9.5). No column letters, no indices.
 * Validation reuses the same primitives as staging and send-time validation
 * (isValidEmail_, normEmail_, buildProspectIndex_) rather than restating rules.
 *
 * NOTE ON WRITES: this appends whole new rows; it never calls
 * writeProspectFields_(). That helper enforces PROSPECT_WRITABLE, which
 * protects human-owned columns on rows that already exist. An import creates
 * the row, so there is no human data to protect — and widening the allowlist
 * to let a script write First Name / Company / Email on an existing row would
 * weaken a load-bearing guarantee for no gain.
 */

var IMPORT_DEFAULT_SHEET = 'Davids List';

/** Source header -> Prospects header. Addendum §2 mapping table, verbatim. */
var IMPORT_COLUMN_MAP = [
  ['First Name', 'First Name'],
  ['Last Name',  'Last Name'],
  ['Company',    'Company'],
  ['Job Title',  'Job Title'],
  ['Town/Area',  'Town/Area'],
  ['Email',      'Email'],
  ['Phone',      'Phone'],
  ['Insta',      'Instagram']
];

/** Required to create a Prospects row at all (MVP spec §2). */
var IMPORT_REQUIRED = ['First Name', 'Email'];

/** Longest itemised skip list a Ui.alert can carry without becoming unreadable. */
var IMPORT_MAX_REPORTED = 25;

/** Menu entry point. Prompts for the source tab, imports, reports. */
function importDavidsList() {
  var ss = SpreadsheetApp.getActive();

  var res = ui_().prompt(
    'Import from David\'s List',
    'Name of the tab holding the list (paste it into this spreadsheet first).\n\n' +
    'Leave as-is to use "' + IMPORT_DEFAULT_SHEET + '".',
    ui_().ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui_().Button.OK) return;

  var name = trim_(res.getResponseText()) || IMPORT_DEFAULT_SHEET;

  if ([SHEETS.PROSPECTS, SHEETS.QUEUE, SHEETS.TEMPLATES, SHEETS.ENGINE, SHEETS.RUN_LOG].indexOf(name) !== -1) {
    throw new Error('"' + name + '" is one of the tool\'s own sheets. The source list must be a separate tab.');
  }

  var src = ss.getSheetByName(name);
  if (!src) {
    throw new Error('No tab named "' + name + '" in this spreadsheet. ' +
      'Paste David\'s List in as its own tab, keeping its header row, then run this again.');
  }

  var result = runImport_(src);
  alert_(result.title, result.body);
}

/**
 * Reads the source sheet, decides row by row, appends what qualifies.
 * Returns { title, body, imported, skipped: [string], filler, sourceRows }.
 */
function runImport_(src) {
  var smap = headerMap_(src);

  // Fail before writing anything if the source is not the expected shape.
  var missingHeaders = IMPORT_COLUMN_MAP
    .map(function (m) { return m[0]; })
    .filter(function (h) { return !smap[h]; });
  if (missingHeaders.length) {
    throw new Error('"' + src.getName() + '" does not look like David\'s List. ' +
      'Missing column header(s): ' + missingHeaders.join(', ') + '.\n\n' +
      'The header row must be row 1 and the names must match exactly.');
  }

  var lastRow = src.getLastRow();
  if (lastRow < 2) throw new Error('"' + src.getName() + '" has a header row but no data.');

  var srcRows = src.getRange(2, 1, lastRow - 1, src.getLastColumn()).getValues();

  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var pWidth = psh.getLastColumn();

  // Existing prospects, indexed by normalised email — the same index send-time
  // validation uses, so "already on the list" means the same thing in both places.
  var idx = buildProspectIndex_();

  var nextId = maxProspectIdNumber_(psh, pmap);
  var now = new Date();
  var sourceLabel = 'David\'s List import — ' +
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var skipped = [];
  var filler = 0;
  var seenInSource = {};   // normalised email -> source row number
  var newRows = [];

  srcRows.forEach(function (r, i) {
    var srcRowNum = i + 2;

    function s(header) { return trim_(val_(r, smap, header, src.getName())); }

    var first = s('First Name');
    var last  = s('Last Name');
    var email = s('Email');

    // A row with no name and no email is not a partially-filled person, it is
    // spreadsheet residue — a dragged-down Company value, a leftover formula.
    // Counted, never itemised: the real list carries hundreds of these and an
    // itemised report would bury the handful of skips that need a decision.
    if (!first && !last && !email) { filler++; return; }

    var who = (first + ' ' + last).trim() || email || '(no name)';
    var label = 'Row ' + srcRowNum + ' ' + who;

    var missing = IMPORT_REQUIRED.filter(function (h) { return !s(h); });
    if (missing.length) {
      skipped.push(label + ' — missing required ' + missing.join(', '));
      return;
    }

    if (!isValidEmail_(email)) {
      skipped.push(label + ' — malformed email address (' + email + ')');
      return;
    }

    var key = normEmail_(email);

    // Within-source first. A row this same run has already dealt with must be
    // reported against the source row it collides with, not as "already on
    // Prospects" — the record it would be pointing at was created seconds ago
    // by this very import, and that reads as pre-existing data.
    if (seenInSource[key]) {
      skipped.push(label + ' — duplicate of source row ' + seenInSource[key] + ' (' + email + ')');
      return;
    }
    seenInSource[key] = srcRowNum;

    var existing = idx.byEmail[key];
    if (existing) {
      skipped.push(label + ' — already on Prospects as ' +
        (existing['Prospect ID'] || 'row ' + existing.rowNum) + ' (' + email + ')');
      return;
    }

    nextId++;
    var id = PROSPECT_ID_PREFIX + padId_(nextId);

    var row = new Array(pWidth).fill('');
    function set(header, v) { row[col_(pmap, header, SHEETS.PROSPECTS) - 1] = v; }

    set('Prospect ID', id);
    IMPORT_COLUMN_MAP.forEach(function (m) { set(m[1], s(m[0])); });
    set('Source', sourceLabel);
    set('Date Added', now);

    newRows.push(row);
  });

  if (newRows.length) {
    psh.getRange(psh.getLastRow() + 1, 1, newRows.length, pWidth).setValues(newRows);
    SpreadsheetApp.flush();
  }

  return {
    title: 'Imported ' + newRows.length + ' prospect(s)',
    body: importReport_(src.getName(), srcRows.length, newRows.length, skipped, filler),
    imported: newRows.length,
    skipped: skipped,
    filler: filler,
    sourceRows: srcRows.length
  };
}

function importReport_(srcName, sourceRows, imported, skipped, filler) {
  var out = [];
  out.push('Source: "' + srcName + '"   ' + sourceRows + ' data row(s)');
  out.push('');
  out.push('Imported: ' + imported);
  out.push('Skipped: ' + skipped.length);
  out.push('Blank or filler rows ignored: ' + filler);

  if (skipped.length) {
    out.push('');
    out.push('Skipped, and why:');
    skipped.slice(0, IMPORT_MAX_REPORTED).forEach(function (s) { out.push('  • ' + s); });
    if (skipped.length > IMPORT_MAX_REPORTED) {
      out.push('  …and ' + (skipped.length - IMPORT_MAX_REPORTED) + ' more of the same kinds.');
    }
  }

  if (imported) {
    out.push('');
    out.push('Nothing was sent. Imported rows are on Prospects with fresh IDs — ' +
      'review them, then stage as normal.');
  }
  return out.join('\n');
}