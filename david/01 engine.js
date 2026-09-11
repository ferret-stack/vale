/**
 * 01_Engine.gs
 * Operational configuration (§5) and template access (§4).
 * Engine is read fresh at the start of every run — never cached across runs.
 *
 * NOT a secrets store. Distribution is "Make a copy"; the file owner can
 * unhide any sheet in one click. Real credentials (Phase 2's Gemini key) go in
 * PropertiesService (§5, §9.9).
 */

var ENGINE_DEFAULTS = [
  ['MODE', 'TEST',
    'TEST | LIVE. Governs every code path. TEST sends real mail to TEST_EMAIL.'],
  ['TEST_EMAIL', 'tech@yourcompany.com',
    'REPLACE ME. Every message goes here while MODE = TEST. Run aborts if blank or unchanged.'],
  ['MAX_SENDS_PER_RUN', 200,
    'Hard stop per run. Rows beyond the cap are reported, not sent.'],
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

/** Reads Engine into a plain object. Throws if the sheet is malformed. */
function readEngine_() {
  var sh = sheet_(SHEETS.ENGINE);
  var map = headerMap_(sh);
  var keyCol = col_(map, 'Key', SHEETS.ENGINE);
  var valCol = col_(map, 'Value', SHEETS.ENGINE);
  var last = sh.getLastRow();
  var cfg = {};
  if (last < 2) return cfg;
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  rows.forEach(function (r) {
    var k = trim_(r[keyCol - 1]);
    if (!k) return;
    cfg[k] = r[valCol - 1];
  });
  return cfg;
}

function engineMode_(cfg) {
  var m = trim_(cfg.MODE).toUpperCase();
  if (m !== MODE.TEST && m !== MODE.LIVE) {
    throw new Error('Engine!MODE is "' + trim_(cfg.MODE) + '". It must be exactly TEST or LIVE.');
  }
  return m;
}

function engineMaxSends_(cfg) {
  var n = parseInt(cfg.MAX_SENDS_PER_RUN, 10);
  if (isNaN(n) || n < 1) {
    throw new Error('Engine!MAX_SENDS_PER_RUN must be a whole number of 1 or more.');
  }
  return n;
}

/**
 * Pre-flight config checks (§8 "Pre-flight"). Returns an array of blocking
 * problems — empty means clear to proceed.
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