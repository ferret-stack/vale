/**
 * 07_Validation.gs — §8 "Pre-flight".
 * Shared by Validate Send Queue (read-only) and Send Batch (writes SKIPPED).
 */

/**
 * Builds the eligible/invalid split for a stage.
 * Returns { eligible: [item], invalid: [item], otherStage: n, notGated: n }
 * where item = { rowNum, id, email, fields, reason? }
 *
 * Eligible = Send? is Y AND Status blank AND Stage matches (§3).
 */
function evaluateQueue_(stage, template, prospectIndex) {
  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var last = qsh.getLastRow();
  var result = { eligible: [], invalid: [], otherStage: 0, notGated: 0, qsh: qsh, qmap: qmap };
  if (last < 2) return result;

  var rows = qsh.getRange(2, 1, last - 1, qsh.getLastColumn()).getValues();
  var seenEmails = {};

  rows.forEach(function (r, i) {
    var rowNum = i + 2;
    if (isRowEmpty_(r)) return;

    if (!isBlank_(val_(r, qmap, 'Status', SHEETS.QUEUE))) return;      // already handled
    if (trim_(val_(r, qmap, 'Send?', SHEETS.QUEUE)).toUpperCase() !== 'Y') { result.notGated++; return; }

    var rowStage = parseInt(val_(r, qmap, 'Stage', SHEETS.QUEUE), 10);
    if (rowStage && rowStage !== stage) { result.otherStage++; return; }

    var id = trim_(val_(r, qmap, 'Prospect ID', SHEETS.QUEUE));
    var email = trim_(val_(r, qmap, 'Email', SHEETS.QUEUE));
    var fields = {
      'First Name': trim_(val_(r, qmap, 'First Name', SHEETS.QUEUE)),
      'Company': trim_(val_(r, qmap, 'Company', SHEETS.QUEUE)),
      'Job Title': trim_(val_(r, qmap, 'Job Title', SHEETS.QUEUE)),
      'Town/Area': trim_(val_(r, qmap, 'Town/Area', SHEETS.QUEUE))
    };
    var item = { rowNum: rowNum, id: id, email: email, fields: fields, unlinked: !id };

    // Control columns are re-read at send time, not trusted from staging: a row
    // can be marked Do Not Contact or Paused between staging and sending.
    // Matched by Prospect ID when linked, by email otherwise — an unlinked
    // hand-pasted row must not be a way around an absolute block (§2).
    var p = (id && prospectIndex.byId[id]) || prospectIndex.byEmail[normEmail_(email)];
    if (p) {
      if (!isBlank_(p['Do Not Contact'])) {
        item.reason = 'Do Not Contact is set on Prospects';
        result.invalid.push(item); return;
      }
      if (!isBlank_(p['Paused'])) {
        item.reason = 'Paused on Prospects';
        result.invalid.push(item); return;
      }
      var st = trim_(p['Email ' + stage + ' Status']).toUpperCase();
      if (BLOCKING_STATUSES.indexOf(st) !== -1) {
        item.reason = 'Email ' + stage + ' Status on Prospects is already ' + st;
        result.invalid.push(item); return;
      }
    }

    if (!email) { item.reason = 'no email address'; result.invalid.push(item); return; }
    if (!isValidEmail_(email)) { item.reason = 'malformed email address'; result.invalid.push(item); return; }

    var key = normEmail_(email);
    if (seenEmails[key]) {
      item.reason = 'duplicate in batch (first occurrence is row ' + seenEmails[key] + ')';
      result.invalid.push(item); return;
    }
    seenEmails[key] = rowNum;

    var missing = missingPlaceholderValues_(template, fields);
    if (missing.length) {
      item.reason = 'missing value for {{' + missing.join('}}, {{') + '}}';
      result.invalid.push(item); return;
    }

    result.eligible.push(item);
  });

  return result;
}

/**
 * Prospects indexed by ID and by lower-cased email, carrying only the columns
 * validation and writeback need.
 */
function buildProspectIndex_() {
  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var last = psh.getLastRow();
  var idx = { byId: {}, byEmail: {}, sheet: psh, map: pmap };
  if (last < 2) return idx;

  var rows = psh.getRange(2, 1, last - 1, psh.getLastColumn()).getValues();
  rows.forEach(function (r, i) {
    if (isRowEmpty_(r)) return;
    var rec = {
      rowNum: i + 2,
      'Prospect ID': trim_(val_(r, pmap, 'Prospect ID', SHEETS.PROSPECTS)),
      'Email': trim_(val_(r, pmap, 'Email', SHEETS.PROSPECTS)),
      'Do Not Contact': val_(r, pmap, 'Do Not Contact', SHEETS.PROSPECTS),
      'Paused': val_(r, pmap, 'Paused', SHEETS.PROSPECTS),
      'Email 1 Status': val_(r, pmap, 'Email 1 Status', SHEETS.PROSPECTS),
      'Email 2 Status': val_(r, pmap, 'Email 2 Status', SHEETS.PROSPECTS),
      'Email 3 Status': val_(r, pmap, 'Email 3 Status', SHEETS.PROSPECTS)
    };
    if (rec['Prospect ID']) idx.byId[rec['Prospect ID']] = rec;

    var e = normEmail_(rec['Email']);
    if (!e) return;
    var held = idx.byEmail[e];
    // First occurrence wins, EXCEPT that a Do Not Contact row always takes
    // precedence: the same address appearing twice must not let a later row
    // without the flag shadow an absolute block.
    if (!held || (isBlank_(held['Do Not Contact']) && !isBlank_(rec['Do Not Contact']))) {
      idx.byEmail[e] = rec;
    }
  });
  return idx;
}

/** §7 — read-only dry check, prompts for stage. Writes nothing. */
function validateSendQueue() {
  var stage = promptStage_();
  if (stage === null) return;
  var r = runValidation_(stage);
  alert_('Validate Send Queue', validationText_(r));
}

/**
 * Stage-explicit core, shared with the sidebar. Returns a structured result;
 * writes nothing to any sheet.
 */
function runValidation_(stage) {
  var cfg = readEngine_();
  var mode = engineMode_(cfg);
  var configProblems = engineProblems_(cfg, mode);

  var template = null, templateError = null;
  try {
    template = activeTemplate_(stage);
  } catch (e) {
    templateError = e.message;
  }

  var res = { eligible: [], invalid: [], notGated: 0, otherStage: 0 };
  if (template) {
    var idx = buildProspectIndex_();
    res = evaluateQueue_(stage, template, idx);
  }

  return {
    stage: stage, mode: mode, configProblems: configProblems,
    templateName: template ? template.name : null, templateError: templateError,
    eligible: res.eligible, invalid: res.invalid,
    notGated: res.notGated, otherStage: res.otherStage,
    cap: engineMaxSends_(cfg)
  };
}

function validationText_(r) {
  var lines = [];
  if (r.configProblems.length) {
    lines.push('Configuration problems (sending is blocked):');
    r.configProblems.forEach(function (p) { lines.push('  • ' + p); });
    lines.push('');
  }
  if (r.templateError) {
    lines.push('Template problem: ' + r.templateError);
    return lines.join('\n');
  }

  lines.push('Mode: ' + r.mode + '   Stage: ' + r.stage + '   Template: "' + r.templateName + '"');
  lines.push('');
  lines.push('Would send: ' + r.eligible.length);
  lines.push('Would be skipped: ' + r.invalid.length);
  lines.push('Not gated (Send? is not Y): ' + r.notGated);
  if (r.otherStage) lines.push('Staged for a different stage, untouched: ' + r.otherStage);

  var unlinked = r.eligible.filter(function (e) { return e.unlinked; }).length;
  if (unlinked) lines.push('Unlinked (no Prospect ID — will send, but nothing writes back): ' + unlinked);

  if (r.invalid.length) {
    lines.push('');
    lines.push('Skips:');
    r.invalid.forEach(function (it) {
      lines.push('  • Row ' + it.rowNum + ' ' + (it.email || '(no email)') + ' — ' + it.reason);
    });
  }

  if (r.eligible.length > r.cap) {
    lines.push('');
    lines.push('MAX_SENDS_PER_RUN is ' + r.cap + ' — ' + (r.eligible.length - r.cap) + ' row(s) would be held back.');
  }
  return lines.join('\n');
}
