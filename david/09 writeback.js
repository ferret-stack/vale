/**
 * 09_Writeback.gs — §8 "Writeback to Prospects", §6.
 *
 * Keyed on Prospect ID only, never name/company/email (§9.3).
 *
 * TWO DELIBERATE DEVIATIONS from the spec, both to protect Phase 2:
 *
 * 1. Thread ID / Last Message ID are written to Prospects on SENT only, never
 *    on TEST-SENT. A test thread is a conversation with TEST_EMAIL, not with
 *    the prospect. Phase 2 §3 fetches Prospects!Thread ID and treats any
 *    message from someone other than the operator as a reply — so a colleague
 *    answering "looks good" during QA, or an auto-responder on the alias, would
 *    set Reply Detected = Y and permanently kill outreach to a prospect who was
 *    never emailed. The IDs are still captured on the Send Queue row in both
 *    modes, so a test run still proves thread capture end to end. Nothing
 *    downstream uses a test Thread ID: Phase 2 stage 2 requires
 *    Email 1 Status = SENT, which overwrites it with the real thread.
 *
 * 2. Last Contacted records LIVE sends only. Phase 2 §3 counts a reply only if
 *    it is dated after Last Contacted. If a test send bumped that timestamp
 *    forward, a genuine reply received before it would be invisible and the
 *    cadence would keep emailing someone who had already answered.
 *
 * Both are amendments to acceptance criterion 5.
 */

function writebackSend_(prospectId, stage, mode, status, threadId, messageId, when) {
  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var rowNum = findProspectRow_(psh, pmap, prospectId);
  if (!rowNum) return { ok: false, reason: 'Prospect ID ' + prospectId + ' not found on Prospects' };

  var fields = {};
  fields['Email ' + stage + ' Status'] = status;
  fields['Email ' + stage + ' Date'] = when;

  if (status === STATUS.SENT) {
    fields['Last Contacted'] = when;
    fields['Thread ID'] = threadId;
    fields['Last Message ID'] = messageId;
  }

  try {
    writeProspectFields_(psh, pmap, rowNum, fields);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

function writebackFailure_(prospectId, stage) {
  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var rowNum = findProspectRow_(psh, pmap, prospectId);
  if (!rowNum) return { ok: false, reason: 'Prospect ID ' + prospectId + ' not found' };
  var fields = {};
  fields['Email ' + stage + ' Status'] = STATUS.FAILED;
  try {
    writeProspectFields_(psh, pmap, rowNum, fields);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

function findProspectRow_(psh, pmap, prospectId) {
  var id = trim_(prospectId);
  if (!id) return null;
  var last = psh.getLastRow();
  if (last < 2) return null;
  var idCol = col_(pmap, 'Prospect ID', SHEETS.PROSPECTS);
  var col = psh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (trim_(col[i][0]) === id) return i + 2;
  }
  return null;
}

/** Refuses to write anything outside PROSPECT_WRITABLE — human columns stay human. */
function writeProspectFields_(psh, pmap, rowNum, fields) {
  Object.keys(fields).forEach(function (name) {
    if (PROSPECT_WRITABLE.indexOf(name) === -1) {
      throw new Error('Refusing to write to "' + name + '" on Prospects — it is not a script-writable column.');
    }
    psh.getRange(rowNum, col_(pmap, name, SHEETS.PROSPECTS)).setValue(fields[name]);
  });
}

/** §6 — append-only, one row per run. */
function writeRunLog_(o) {
  var sh = sheet_(SHEETS.RUN_LOG);
  var map = headerMap_(sh);
  var width = sh.getLastColumn();
  var row = new Array(width).fill('');
  function set(name, v) { row[col_(map, name, SHEETS.RUN_LOG) - 1] = v; }

  set('Timestamp', new Date());
  set('Operator', operatorEmail_());
  set('Mode', o.mode);
  set('Stage', o.stage);
  set('Evaluated', o.evaluated);
  set('Sent', o.sent);
  set('Skipped', o.skipped);
  set('Failed', o.failed);
  set('Unlinked', o.unlinked);
  set('Held Back (Cap)', o.heldBack);
  set('Quota Remaining', o.quotaRemaining);
  set('Notes', o.notes.join(' | '));

  sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([row]);
  SpreadsheetApp.flush();
}

function operatorEmail_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '(unknown)';
  } catch (e) {
    return '(unknown)';
  }
}