/**
 * 00_Schema.gs
 * Single source of truth for sheet names, column names and runtime header
 * resolution. No other file may contain a column letter or a numeric column
 * index. Spec §1 "Column access rule (mandatory)" / §9.5.
 */

var SHEETS = {
  PROSPECTS: 'Prospects',
  QUEUE: 'Send Queue',
  TEMPLATES: 'Templates',
  ENGINE: 'Engine',
  RUN_LOG: 'Run Log'
};

/** Prospects columns, in creation order. Grouped per spec §2. */
var PROSPECT_COLS = [
  // Identity & contact (human-entered)
  'Prospect ID', 'First Name', 'Last Name', 'Company', 'Job Title', 'Town/Area',
  'Email', 'Phone', 'Instagram', 'LinkedIn URL', 'Website', 'Source', 'Date Added',
  // Control (human-entered)
  'Do Not Contact', 'Paused', 'Interest', 'Signed On', 'Notes',
  // Email outreach state (script-written only)
  'Email 1 Status', 'Email 1 Date',
  'Email 2 Status', 'Email 2 Date',
  'Email 3 Status', 'Email 3 Date',
  'Thread ID', 'Last Message ID', 'Last Contacted',
  // Phase 2 reserved — created now, empty, untouched by v1 code (§2, §9)
  'Auto Cadence', 'Reply Detected', 'Last Reply Date', 'Cadence Status', 'Interest (suggested)',
  // Other channels (human-maintained, script never touches)
  'Instagram DM Sent', 'LinkedIn Connected', 'WhatsApp Sent', 'Fee Offered'
];

/**
 * Columns v1 code is permitted to write on Prospects. Anything not in this
 * list is human territory. Enforced by writeProspectFields_().
 */
var PROSPECT_WRITABLE = [
  'Prospect ID',
  'Email 1 Status', 'Email 1 Date',
  'Email 2 Status', 'Email 2 Date',
  'Email 3 Status', 'Email 3 Date',
  'Thread ID', 'Last Message ID', 'Last Contacted',
  'Date Added'
];

var QUEUE_COLS = [
  'Prospect ID', 'Send?', 'Email', 'First Name', 'Company', 'Job Title', 'Town/Area',
  'Status', 'Stage', 'Sent At', 'Thread ID', 'Message ID', 'Notes'
];

var TEMPLATE_COLS = ['Stage', 'Name', 'Subject', 'Body', 'Active'];

var ENGINE_COLS = ['Key', 'Value', 'Notes'];

var RUN_LOG_COLS = [
  'Timestamp', 'Operator', 'Mode', 'Stage', 'Evaluated', 'Sent', 'Skipped',
  'Failed', 'Unlinked', 'Held Back (Cap)', 'Quota Remaining', 'Notes'
];

/** Status enum. §2 — explicit values only, never blank-vs-non-blank inference (§9.4). */
var STATUS = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  TEST_SENT: 'TEST-SENT',
  SKIPPED: 'SKIPPED'
};

/** Statuses that block a future send of the same stage. TEST-SENT deliberately absent (§2). */
var BLOCKING_STATUSES = [STATUS.SENT, STATUS.FAILED];

var MODE = { TEST: 'TEST', LIVE: 'LIVE' };

/**
 * Template placeholder -> Prospects/Queue column name.
 * Add here only; renderer derives everything from this map.
 */
var PLACEHOLDERS = {
  'FirstName': 'First Name',
  'Company': 'Company',
  'JobTitle': 'Job Title',
  'TownArea': 'Town/Area'
};

var PROSPECT_ID_PREFIX = 'P-';
var PROSPECT_ID_PAD = 5;

/** Wall-clock budget. Apps Script hard ceiling is ~6 min; we exit cleanly well before. */
var TIME_BUDGET_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Runtime header resolution
// ---------------------------------------------------------------------------

/**
 * Reads the header row into a {name: 1-based column index} map.
 * Throws on duplicate headers — a duplicate would make writeback ambiguous
 * and silently write to the wrong column.
 */
function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('Sheet "' + sheet.getName() + '" has no header row.');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      throw new Error('Duplicate header "' + name + '" on sheet "' + sheet.getName() +
        '". Column names must be unique — rename or remove one.');
    }
    map[name] = i + 1;
  }
  return map;
}

/** Resolve a column index by name, or throw a message that names the fix. */
function col_(map, name, sheetName) {
  var idx = map[name];
  if (!idx) {
    throw new Error('Column "' + name + '" not found on sheet "' + sheetName +
      '". It may have been renamed or deleted. Restore the header text exactly, ' +
      'or re-run Outreach ▸ Setup Check.');
  }
  return idx;
}

/** Sheet by name, or a message that tells the operator what to run. */
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) {
    throw new Error('Sheet "' + name + '" not found. Run setupWorkbook() once from the ' +
      'Apps Script editor to build the workbook.');
  }
  return sh;
}

/** Value from a row array (0-based) using a 1-based header map. */
function val_(row, map, name, sheetName) {
  return row[col_(map, name, sheetName) - 1];
}

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function trim_(v) {
  return isBlank_(v) ? '' : String(v).trim();
}

/**
 * Deliberately permissive: rejects the things that actually bounce (spaces,
 * missing @, missing TLD) without inventing rules RFC 5322 doesn't have.
 */
function isValidEmail_(v) {
  var s = trim_(v);
  if (!s) return false;
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s);
}

function normEmail_(v) {
  return trim_(v).toLowerCase();
}

/**
 * Highest numeric suffix currently in use in Prospects!Prospect ID, scanning
 * the whole column — not just live/filtered rows — so IDs are never reused
 * (§9.3). Single source of truth for "what's the next ID", shared by
 * assignMissingProspectIds_ (05_Staging.gs) and the David's List importer
 * (11_Import.gs). Previously the importer called this by name with no
 * implementation behind it — that's the "maxProspectIdNumber_ not defined"
 * error; this extraction is the fix, not a new function invented to patch it.
 */
function maxProspectIdNumber_(sh, pmap) {
  var idCol = col_(pmap, 'Prospect ID', SHEETS.PROSPECTS);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var m = /^P-(\d+)$/.exec(trim_(ids[i][0]));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}