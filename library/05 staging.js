/**
 * 05_Staging.gs — §8 "Staging".
 *
 * DEVIATION FROM SPEC #1, deliberate: the spec gates staging on "already SENT in
 * Send Queue for this stage", but the queue is cleared after every batch
 * (§3, §7). One "Clear Completed Queue Rows" and that gate evaporates, letting
 * the same prospect be staged and sent twice. Source of truth for "already
 * sent" is Prospects!Email {n} Status. The queue is checked too, but only for
 * rows still unprocessed.
 *
 * DEVIATION FROM SPEC #2, deliberate: the spec has `Send?` always land blank
 * on staging, reviewed and set by a human before every batch (§3's guardrail
 * against an accidental mass send). BDM feedback: typing "Y" per row was
 * friction, and speed was prioritized over that guardrail. `commitStaging_`
 * now auto-sets `Send? = 'Y'` for any row that passes the same send-time-shaped
 * checks (valid email, no in-batch duplicate, no missing placeholder) that used
 * to only be *reported* after the fact via previewStagedProblems_. A row that
 * fails any check is left blank and still requires a human to fix and flip it.
 * If the template itself can't load, NO row is auto-Y'd — a row can't be
 * certified clean against a template that couldn't be read.
 *
 * This means: a batch of all-clean rows can now reach Send Batch with zero
 * human review of the Send Queue sheet. The Send Batch confirmation dialogs
 * (first-message preview, LIVE recipient count) are the only remaining hard
 * stop before mail moves. Accepted trade-off, not an oversight — see Dev Log.
 *
 * Core logic (computeStagingPlan_ / computeRowProblems_ / commitStaging_) is
 * shared by the menu entry point (addProspectsToQueue) and the sidebar (see
 * 10_Sidebar.gs) so both surfaces stay identical in behaviour.
 */

/** Menu entry point: reads the current selection on Prospects, prompts for stage. */
function addProspectsToQueue() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getActiveSheet().getName() !== SHEETS.PROSPECTS) {
    throw new Error('Select the rows you want on the "' + SHEETS.PROSPECTS + '" sheet first, then run this.');
  }
  var rowNums = selectedDataRows_(sheet_(SHEETS.PROSPECTS));
  if (!rowNums.length) throw new Error('No prospect rows selected. Select one or more rows on Prospects and run this again.');

  var stage = promptStage_();
  if (stage === null) return;

  var result = stageRowsInteractive_(rowNums, stage);
  if (!result) return; // operator declined the no-prior-stage confirmation

  alert_(result.title, result.body);
}

/**
 * Shared by both UIs: runs the plan, asks the no-prior-stage question if
 * needed (native confirm — same safety gate regardless of which surface
 * triggered it), evaluates each row against send-time-shaped checks BEFORE
 * commit (so those checks can drive Send?, not just report on it afterward),
 * commits, and returns formatted text. Returns null if the operator declined
 * to proceed.
 */
function stageRowsInteractive_(rowNums, stage) {
  var plan = computeStagingPlan_(rowNums, stage);

  if (!plan.toStage.length) {
    return { title: 'Nothing staged', body: report_([], plan.skipped, stage),
             stagedCount: 0, skipped: plan.skipped, previewProblems: [], autoYCount: 0 };
  }

  if (plan.noPriorStage.length) {
    var ok = confirm_('No record of a stage ' + (stage - 1) + ' send',
      plan.noPriorStage.length + ' of the selected rows have no SENT at stage ' + (stage - 1) + ':\n\n' +
      plan.noPriorStage.slice(0, 10).join('\n') +
      (plan.noPriorStage.length > 10 ? '\n…and ' + (plan.noPriorStage.length - 10) + ' more' : '') +
      '\n\nStage them for stage ' + stage + ' anyway?');
    if (!ok) return null;
  }

  var rowProblems = computeRowProblems_(plan.toStage, stage);
  commitStaging_(plan.toStage, stage, rowProblems);

  var autoYCount = rowProblems.templateOk
    ? rowProblems.perRow.filter(function (p) { return p.length === 0; }).length
    : 0;
  var previewProblems = flattenRowProblems_(plan.toStage, rowProblems);

  var body = report_(plan.toStage.map(function (t) { return t.label; }), plan.skipped, stage);

  if (!rowProblems.templateOk) {
    body += '\n\nSend? left blank on all staged rows — cannot verify against a template: ' + rowProblems.templateError;
  } else {
    body += '\n\nSend? = Y auto-set on ' + autoYCount + ' clean row(s). Left blank on ' +
      (plan.toStage.length - autoYCount) + ' — fix and set Send? = Y yourself.';
    if (previewProblems.length) {
      body += '\n\nStill blank, and why:\n' + previewProblems.map(function (p) { return '  • ' + p; }).join('\n');
    }
  }
  body += '\n\nNext: review any blank Send? rows, then Send Batch.';

  return { title: 'Staged ' + plan.toStage.length + ' row(s) for stage ' + stage, body: body,
           stagedCount: plan.toStage.length, skipped: plan.skipped, previewProblems: previewProblems,
           autoYCount: autoYCount };
}

/**
 * Evaluates each selected Prospects row against the permanent gates (DNC,
 * Paused, already-touched-this-stage, already-pending-in-queue) without
 * writing anything. Returns { toStage: [{rowNum,id,label,email,fields}],
 * skipped: [string], noPriorStage: [string] }.
 */
function computeStagingPlan_(rowNums, stage) {
  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var width = psh.getLastColumn();
  var values = psh.getRange(1, 1, psh.getLastRow(), width).getValues(); // includes header at [0]

  assignMissingProspectIds_(psh, pmap, values);

  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var pendingIds = pendingQueueIds_(qsh, qmap);

  var toStage = [];
  var skipped = [];
  var noPriorStage = [];

  rowNums.forEach(function (rowNum) {
    var r = values[rowNum - 1];
    if (isRowEmpty_(r)) return;

    var id = trim_(val_(r, pmap, 'Prospect ID', SHEETS.PROSPECTS));
    var name = (trim_(val_(r, pmap, 'First Name', SHEETS.PROSPECTS)) + ' ' +
                trim_(val_(r, pmap, 'Last Name', SHEETS.PROSPECTS))).trim() || '(no name)';
    var label = 'Row ' + rowNum + ' ' + name + (id ? ' [' + id + ']' : '');

    if (!isBlank_(val_(r, pmap, 'Do Not Contact', SHEETS.PROSPECTS))) {
      skipped.push(label + ' — Do Not Contact is set. This row can never be staged.');
      return;
    }
    if (!isBlank_(val_(r, pmap, 'Paused', SHEETS.PROSPECTS))) {
      skipped.push(label + ' — Paused. Clear the Paused cell to stage this row.');
      return;
    }

    var status = trim_(val_(r, pmap, 'Email ' + stage + ' Status', SHEETS.PROSPECTS)).toUpperCase();
    if (BLOCKING_STATUSES.indexOf(status) !== -1) {
      skipped.push(label + ' — Email ' + stage + ' Status is already ' + status + '.');
      return;
    }

    if (id && pendingIds[id]) {
      skipped.push(label + ' — already sitting unprocessed in the Send Queue.');
      return;
    }

    if (stage > 1) {
      var prev = trim_(val_(r, pmap, 'Email ' + (stage - 1) + ' Status', SHEETS.PROSPECTS)).toUpperCase();
      if (prev !== STATUS.SENT) noPriorStage.push(label + ' (Email ' + (stage - 1) + ' Status: ' + (prev || 'blank') + ')');
    }

    var fields = {
      'First Name': trim_(val_(r, pmap, 'First Name', SHEETS.PROSPECTS)),
      'Company': trim_(val_(r, pmap, 'Company', SHEETS.PROSPECTS)),
      'Job Title': trim_(val_(r, pmap, 'Job Title', SHEETS.PROSPECTS)),
      'Town/Area': trim_(val_(r, pmap, 'Town/Area', SHEETS.PROSPECTS))
    };

    toStage.push({
      rowNum: rowNum, id: id, label: label,
      email: trim_(val_(r, pmap, 'Email', SHEETS.PROSPECTS)),
      fields: fields
    });
  });

  return { toStage: toStage, skipped: skipped, noPriorStage: noPriorStage };
}

/**
 * Send-time-shaped checks (valid email, no in-batch duplicate, no missing
 * placeholder), run BEFORE commit so they can drive Send? rather than just
 * report on it after the fact. Deliberately does NOT gate on Send? = Y
 * (nothing is written yet) — a duplicate here means duplicate within what is
 * about to be staged together, the honest approximation available at this
 * point. Returns { templateOk: bool, templateError?: string, perRow: [string[]] }
 * where perRow[i] is the list of problems for toStage[i] (empty = clean).
 */
function computeRowProblems_(toStage, stage) {
  var template;
  try {
    template = activeTemplate_(stage);
  } catch (e) {
    return {
      templateOk: false,
      templateError: e.message,
      perRow: toStage.map(function () { return null; })
    };
  }

  var seen = {};
  var perRow = toStage.map(function (t) {
    var problems = [];
    if (!t.email) { problems.push('no email address'); return problems; }
    if (!isValidEmail_(t.email)) { problems.push('malformed email address'); return problems; }
    var key = normEmail_(t.email);
    if (seen[key]) { problems.push('duplicate email with ' + seen[key] + ' in this same staging batch'); return problems; }
    seen[key] = t.label;
    var missing = missingPlaceholderValues_(template, t.fields);
    if (missing.length) problems.push('missing value for {{' + missing.join('}}, {{') + '}}');
    return problems;
  });

  return { templateOk: true, perRow: perRow };
}

/** Flattens computeRowProblems_ output into "Row X ... — reason" strings for display. */
function flattenRowProblems_(toStage, rowProblems) {
  if (!rowProblems.templateOk) {
    return ['(all staged rows) — cannot verify against a template: ' + rowProblems.templateError];
  }
  var out = [];
  toStage.forEach(function (t, i) {
    rowProblems.perRow[i].forEach(function (p) { out.push(t.label + ' — ' + p); });
  });
  return out;
}

/**
 * Writes the planned rows to Send Queue. Send? = 'Y' for rows computeRowProblems_
 * found clean, blank otherwise — see file header for why this deviates from
 * the original "always blank" spec behaviour.
 */
function commitStaging_(toStage, stage, rowProblems) {
  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var qWidth = qsh.getLastColumn();

  var newRows = toStage.map(function (t, i) {
    var q = new Array(qWidth).fill('');
    function set(name, v) { q[col_(qmap, name, SHEETS.QUEUE) - 1] = v; }
    var clean = rowProblems.templateOk && rowProblems.perRow[i].length === 0;
    set('Prospect ID', t.id);
    set('Send?', clean ? 'Y' : '');
    set('Email', t.email);
    set('First Name', t.fields['First Name']);
    set('Company', t.fields['Company']);
    set('Job Title', t.fields['Job Title']);
    set('Town/Area', t.fields['Town/Area']);
    set('Stage', stage);
    return q;
  });

  qsh.getRange(qsh.getLastRow() + 1, 1, newRows.length, qWidth).setValues(newRows);
  SpreadsheetApp.flush();
}

function report_(staged, skipped, stage) {
  var out = [];
  out.push('Stage: ' + stage);
  out.push('Staged: ' + staged.length);
  out.push('Not staged: ' + skipped.length);
  if (skipped.length) {
    out.push('');
    out.push('Not staged, and why:');
    skipped.forEach(function (s) { out.push('  • ' + s); });
  }
  return out.join('\n');
}

/** Row numbers covered by the current selection, header excluded, deduped, sorted. */
function selectedDataRows_(sh) {
  var list = sh.getActiveRangeList();
  if (!list) return [];
  var seen = {};
  var lastRow = sh.getLastRow();
  list.getRanges().forEach(function (rg) {
    var start = rg.getRow();
    var end = start + rg.getNumRows() - 1;
    for (var r = start; r <= end; r++) {
      if (r >= 2 && r <= lastRow) seen[r] = true;
    }
  });
  return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
}

function isRowEmpty_(row) {
  return row.every(function (c) { return isBlank_(c); });
}

/**
 * Assigns Prospect IDs to any selected row missing one, continuing from the
 * highest ID ever used on the sheet. IDs are never reused (§9.3), so this
 * scans the whole column, not just live rows.
 */
function assignMissingProspectIds_(sh, pmap, values) {
  var idCol = col_(pmap, 'Prospect ID', SHEETS.PROSPECTS);
  var max = maxProspectIdNumber_(sh, pmap);   // was: inline regex scan over `values`
  var writes = [];
  for (var j = 1; j < values.length; j++) {
    if (isRowEmpty_(values[j])) continue;
    if (trim_(values[j][idCol - 1])) continue;
    max++;
    var id = PROSPECT_ID_PREFIX + padId_(max);
    values[j][idCol - 1] = id;
    writes.push({ row: j + 1, id: id });
  }
  writes.forEach(function (w) { sh.getRange(w.row, idCol).setValue(w.id); });
  if (writes.length) SpreadsheetApp.flush();
}

/** Prospect IDs currently in the queue with a blank Status. */
function pendingQueueIds_(qsh, qmap) {
  var out = {};
  var last = qsh.getLastRow();
  if (last < 2) return out;
  qsh.getRange(2, 1, last - 1, qsh.getLastColumn()).getValues().forEach(function (r) {
    if (!isBlank_(val_(r, qmap, 'Status', SHEETS.QUEUE))) return;
    var id = trim_(val_(r, qmap, 'Prospect ID', SHEETS.QUEUE));
    if (id) out[id] = true;
  });
  return out;
}

/**
 * §7 core — removes every queue row with a non-blank Status.
 *
 * Returns { cleared: n, empty: bool }, or null if the operator declined at the
 * confirm. Shows no alert of its own: the caller decides how to report, which
 * is what lets the menu use native dialogs and the panel render inline without
 * either surface duplicating the logic.
 *
 * 10_Sidebar.gs has called this function since the Addendum v1 build, but it
 * was never written — the panel's "Clear Completed Queue Rows" button has
 * therefore always thrown ReferenceError, while the identically-labelled menu
 * item worked. Both surfaces now run this one function, which is what the
 * sidebar's own comment always said was intended.
 *
 * The confirm stays NATIVE and stays here, fired from both surfaces. This is
 * an irreversible delete, and the panel must not turn it into a softer gate
 * than the menu's — the same reasoning that keeps the send confirmations out
 * of the panel (§1c, and the Dev Log's note on why the preview is a modal
 * rather than an inline section).
 *
 * The two "nothing to do" outcomes are distinguished rather than collapsed:
 * `empty` means the Send Queue has no data rows at all, `cleared: 0` means it
 * has rows but none carry a Status. They need different sentences, and the
 * panel already renders them differently.
 */
function clearCompletedQueueRowsCore_() {
  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var last = qsh.getLastRow();
  if (last < 2) return { cleared: 0, empty: true };

  var statusCol = col_(qmap, 'Status', SHEETS.QUEUE);
  var values = qsh.getRange(2, 1, last - 1, qsh.getLastColumn()).getValues();
  var toDelete = [];
  values.forEach(function (r, i) {
    if (!isBlank_(r[statusCol - 1])) toDelete.push(i + 2);
  });

  if (!toDelete.length) return { cleared: 0, empty: false };

  if (!confirm_('Clear completed rows?', 'Remove ' + toDelete.length + ' completed row(s) from the Send Queue?\n\n' +
    'The record of what was sent stays on Prospects and in the Run Log.')) return null;

  // Descending, so each deletion cannot shift the index of one not yet done.
  toDelete.reverse().forEach(function (rowNum) { qsh.deleteRow(rowNum); });
  return { cleared: toDelete.length, empty: false };
}

/**
 * §7 menu entry point. Same core, native reporting — the messages and the
 * confirm are unchanged from the single-sheet build.
 */
function clearCompletedQueueRows() {
  var r = clearCompletedQueueRowsCore_();
  if (r === null) return;                        // declined at the confirm
  if (r.empty) { alert_('Nothing to clear', 'The Send Queue is empty.'); return; }
  if (!r.cleared) { alert_('Nothing to clear', 'No queue rows have a Status yet.'); return; }
  alert_('Cleared', 'Removed ' + r.cleared + ' row(s).');
}