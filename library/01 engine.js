/**
 * 01_Engine.gs  [LIBRARY]
 * Operational configuration (§5) and template access (§4).
 * Engine is read fresh at the start of every run — never cached across runs.
 *
 * NOT a secrets store. Distribution is one spreadsheet per BDM; the file owner
 * can unhide any sheet in one click. Real credentials (Phase 2's Gemini key) go
 * in PropertiesService (§5, §9.9).
 *
 * MULTI-BDM CHANGE — the Engine lock (Dev Log 2026-09-11, Theme A).
 *
 * Engine stays ONE sheet. The split between BDM-editable and operator-owned
 * rows is enforced in code, not by layout — the same pattern as
 * PROSPECT_WRITABLE in 09_Writeback.gs, and for the same reason: a layout
 * convention is advice, an allowlist is a rule.
 *
 *   BDM-editable : SENDER_NAME, TEST_EMAIL, SIGNATURE_BLOCK, REPLY_TO, MODE
 *   Operator-only: MAX_SENDS_PER_RUN, MIN_DAYS_BETWEEN_EMAILS
 *
 * Enforcement is by OVERRIDE, not by refusal. readEngine_() replaces the value
 * of every locked key with the library constant after reading the sheet, so a
 * BDM editing the cell changes nothing that runs. Refusing the write outright
 * was the alternative and is weaker here: Apps Script cannot intercept a cell
 * edit that a human types, so a "refusal" could only ever be a post-hoc
 * complaint, and one that fires at send time — the worst possible moment. An
 * override cannot be raced, cannot be bypassed by editing while a run is in
 * flight, and needs no protected range.
 *
 * The edit is still surfaced rather than swallowed: engineLockViolations_()
 * reports any locked cell whose contents disagree with the library, and
 * Setup Check and the sidebar both show it. Silent correctness is not the goal;
 * correctness the operator can see is.
 */

/**
 * Operator-owned values. The sheet does not get a vote on these.
 *
 * MIN_DAYS_BETWEEN_EMAILS is declared and locked here but NOT CONSUMED BY v1 —
 * there is no cadence logic in this codebase to consume it (see "What this is
 * not" in the README; cadence is Phase 2). It is defined now so that the key
 * exists, is locked from the day BDM sheets are created, and cannot be
 * introduced later as a BDM-editable cell that then has to be taken away.
 * Phase 2 reads it from here, not from the sheet.
 */
var ENGINE_LOCKED_VALUES = {
  MAX_SENDS_PER_RUN: 200,
  MIN_DAYS_BETWEEN_EMAILS: 4
};

/** Keys a BDM may not set. Derived, so the two can never drift apart. */
var ENGINE_LOCKED_KEYS = Object.keys(ENGINE_LOCKED_VALUES);

function isEngineKeyLocked_(key) {
  return ENGINE_LOCKED_KEYS.indexOf(trim_(key)) !== -1;
}

var ENGINE_DEFAULTS = [
  ['MODE', 'TEST',
    'TEST | LIVE. Governs every code path. TEST sends real mail to TEST_EMAIL.'],
  ['TEST_EMAIL', 'tech@yourcompany.com',
    'REPLACE ME. Every message goes here while MODE = TEST. Run aborts if blank or unchanged.'],
  ['MAX_SENDS_PER_RUN', ENGINE_LOCKED_VALUES.MAX_SENDS_PER_RUN,
    'LOCKED — set by the operator, not editable here. Hard stop per run. Editing this cell has no effect; the library value is used. Ask the operator to change it.'],
  ['MIN_DAYS_BETWEEN_EMAILS', ENGINE_LOCKED_VALUES.MIN_DAYS_BETWEEN_EMAILS,
    'LOCKED — set by the operator, not editable here. Minimum gap between stages. Not used by v1 (cadence is Phase 2); shown so the value is visible. Editing this cell has no effect.'],
  ['SENDER_NAME', 'Your Name Here',
    'REPLACE ME. Display name on outgoing mail.'],
  ['REPLY_TO', '',
    'Optional. Blank = replies go to the sending account.'],
  // Addendum v1 §1a: this cell is trusted raw HTML, pasted in by the operator.
  // The shipped placeholder is HTML too, so a fresh install shows the same
  // rendering path the real signature will use rather than only exercising it
  // once it is too late to notice. Still content-checked for "REPLACE ME".
  ['SIGNATURE_BLOCK',
    '<p><strong>REPLACE ME</strong> — this placeholder blocks all sending.</p>\n' +
    '<p>Sender name<br>Company, Registered address</p>\n' +
    '<p style="font-size:12px;color:#5f6368;">If you would rather not hear from us, ' +
    'reply STOP and we will remove you immediately.</p>',
    'REPLACE ME. Pasted HTML, appended to every message. Must carry sender identity and a working opt-out. Run aborts if blank or unchanged. Plain text also works — it is converted automatically.']
];

/**
 * Values shipped as placeholders. A forgotten default must abort the run —
 * blank-checking alone would let "tech@yourcompany.com" reach production.
 */
var ENGINE_SENTINELS = {
  TEST_EMAIL: 'tech@yourcompany.com',
  SENDER_NAME: 'Your Name Here',
  SIGNATURE_SENTINEL: 'REPLACE ME'
};

/**
 * Reads Engine into a plain object, then imposes the locked values on top.
 * Throws if the sheet is malformed.
 *
 * Every caller in the codebase goes through this function, which is what makes
 * the override total: there is no second path by which a locked cell's raw
 * contents can reach any decision.
 */
function readEngine_() {
  var sh = sheet_(SHEETS.ENGINE);
  var map = headerMap_(sh);
  var keyCol = col_(map, 'Key', SHEETS.ENGINE);
  var valCol = col_(map, 'Value', SHEETS.ENGINE);
  var last = sh.getLastRow();
  var cfg = {};
  if (last >= 2) {
    var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    rows.forEach(function (r) {
      var k = trim_(r[keyCol - 1]);
      if (!k) return;
      cfg[k] = r[valCol - 1];
    });
  }
  // The lock. Applied after the read, unconditionally, whatever the sheet says
  // — including when the row is missing entirely.
  ENGINE_LOCKED_KEYS.forEach(function (k) {
    cfg[k] = ENGINE_LOCKED_VALUES[k];
  });
  return cfg;
}

/**
 * Locked cells whose sheet contents disagree with the library value.
 * Read-only and advisory: nothing here blocks a run, because nothing here can
 * affect one. It exists so an edit shows up as "ignored" rather than as
 * "mysteriously had no effect".
 *
 * Returns [{ key, sheetValue, effectiveValue }].
 */
function engineLockViolations_() {
  var sh = sheet_(SHEETS.ENGINE);
  var map = headerMap_(sh);
  var keyCol = col_(map, 'Key', SHEETS.ENGINE);
  var valCol = col_(map, 'Value', SHEETS.ENGINE);
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return out;

  sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var k = trim_(r[keyCol - 1]);
    if (!isEngineKeyLocked_(k)) return;
    var onSheet = trim_(r[valCol - 1]);
    var effective = String(ENGINE_LOCKED_VALUES[k]);
    if (onSheet !== effective) {
      out.push({ key: k, sheetValue: onSheet, effectiveValue: effective });
    }
  });
  return out;
}

function engineMode_(cfg) {
  var m = trim_(cfg.MODE).toUpperCase();
  if (m !== MODE.TEST && m !== MODE.LIVE) {
    throw new Error('Engine!MODE is "' + trim_(cfg.MODE) + '". It must be exactly TEST or LIVE.');
  }
  return m;
}

/**
 * The per-run cap. Reads from cfg, which readEngine_() has already overridden,
 * so this is the library value by construction. The validation below is kept
 * rather than dropped: it now guards the library constant against a bad edit
 * to THIS FILE, which is the only way it can be wrong any more.
 */
function engineMaxSends_(cfg) {
  var n = parseInt(cfg.MAX_SENDS_PER_RUN, 10);
  if (isNaN(n) || n < 1) {
    throw new Error('MAX_SENDS_PER_RUN is not a whole number of 1 or more. ' +
      'This is a library-level setting — contact the operator.');
  }
  return n;
}

/** Locked, library-level. Declared for Phase 2; no v1 code path reads it. */
function engineMinDaysBetween_(cfg) {
  var n = parseInt(cfg.MIN_DAYS_BETWEEN_EMAILS, 10);
  if (isNaN(n) || n < 0) {
    throw new Error('MIN_DAYS_BETWEEN_EMAILS is not a whole number of 0 or more. ' +
      'This is a library-level setting — contact the operator.');
  }
  return n;
}

/**
 * Pre-flight config checks (§8 "Pre-flight"). Returns an array of blocking
 * problems — empty means clear to proceed.
 *
 * Locked keys are deliberately absent from this list. They cannot be
 * misconfigured by a BDM any more, so reporting on them here would be theatre.
 */
function engineProblems_(cfg, mode) {
  var problems = [];

  var sig = trim_(cfg.SIGNATURE_BLOCK);
  if (!sig) {
    problems.push('Engine!SIGNATURE_BLOCK is blank. Nothing can send without a signature and opt-out line.');
  } else if (sig.indexOf(ENGINE_SENTINELS.SIGNATURE_SENTINEL) !== -1) {
    problems.push('Engine!SIGNATURE_BLOCK still contains the shipped placeholder text. Replace it with your real signature and opt-out line.');
  }

  if (mode === MODE.TEST) {
    var te = trim_(cfg.TEST_EMAIL);
    if (!te) {
      problems.push('Engine!TEST_EMAIL is blank and MODE = TEST. Set the address test mail should go to.');
    } else if (te.toLowerCase() === ENGINE_SENTINELS.TEST_EMAIL) {
      problems.push('Engine!TEST_EMAIL is still the shipped placeholder (' + ENGINE_SENTINELS.TEST_EMAIL + '). Replace it with a real address you control.');
    } else if (!isValidEmail_(te)) {
      problems.push('Engine!TEST_EMAIL is not a valid email address: ' + te);
    }
  }

  var rt = trim_(cfg.REPLY_TO);
  if (rt && !isValidEmail_(rt)) {
    problems.push('Engine!REPLY_TO is set but is not a valid email address: ' + rt);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Templates (§4)
// ---------------------------------------------------------------------------

/**
 * The single Active = Y template for a stage.
 * Zero or more than one is a hard error — "which one did it use?" is not a
 * question anyone should have to ask after a batch has gone out.
 */
function activeTemplate_(stage) {
  var sh = sheet_(SHEETS.TEMPLATES);
  var map = headerMap_(sh);
  var last = sh.getLastRow();
  if (last < 2) throw new Error('The Templates sheet is empty.');
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();

  var found = [];
  rows.forEach(function (r) {
    var st = parseInt(val_(r, map, 'Stage', SHEETS.TEMPLATES), 10);
    var active = trim_(val_(r, map, 'Active', SHEETS.TEMPLATES)).toUpperCase();
    if (st === stage && active === 'Y') {
      found.push({
        stage: st,
        name: trim_(val_(r, map, 'Name', SHEETS.TEMPLATES)),
        subject: String(val_(r, map, 'Subject', SHEETS.TEMPLATES) || ''),
        body: String(val_(r, map, 'Body', SHEETS.TEMPLATES) || '')
      });
    }
  });

  if (found.length === 0) {
    throw new Error('No template for stage ' + stage + ' is marked Active = Y on the Templates sheet.');
  }
  if (found.length > 1) {
    throw new Error(found.length + ' templates for stage ' + stage + ' are marked Active = Y. ' +
      'Exactly one must be active.');
  }
  var t = found[0];
  if (!trim_(t.subject)) throw new Error('The active stage ' + stage + ' template has a blank Subject.');
  if (!trim_(t.body)) throw new Error('The active stage ' + stage + ' template has a blank Body.');
  return t;
}
