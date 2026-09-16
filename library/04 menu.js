/**
 * 04_Menu.gs  [LIBRARY] — §7. No time-driven triggers in v1.
 *
 * MULTI-BDM CHANGE — why the menu is built here but the functions it names
 * are not.
 *
 * addItem()'s second argument is a FUNCTION NAME RESOLVED IN THE CONTAINER
 * SCRIPT, not in this library. Apps Script looks it up in the global scope of
 * the project bound to the spreadsheet. The same is true of every
 * google.script.run call from Sidebar.html and SendPreview.html.
 *
 * So the menu's SHAPE is shared (built here, identical for every BDM) while
 * the handful of names it points at must exist in each container. The
 * container's wrappers are one line each and do nothing but delegate — see
 * 01_Container.gs in any BDM folder. This is the one place the thin-container
 * pattern cannot be made thinner, and it is a platform constraint, not a
 * design choice.
 *
 * The import item is the only per-BDM label, so it is driven by the profile.
 */
function buildMenu_(profile) {
  var menu = SpreadsheetApp.getUi()
    .createMenu('Outreach')
    .addItem('Open Send Panel', 'menuOpenSidebar')
    .addSeparator()
    .addItem('Add Prospects to Send Queue', 'menuAddToQueue')
    .addItem('Validate Send Queue', 'menuValidateQueue')
    .addSeparator()
    .addItem('Send Batch', 'menuSendBatch')
    .addSeparator()
    .addItem('Clear Completed Queue Rows', 'menuClearCompleted')
    .addSeparator();

  if (profile) menu.addItem('Import from ' + profile.label, 'menuImportList');

  menu.addItem('Setup Check', 'menuSetupCheck').addToUi();
}

/** Any thrown error becomes a dialog, never a silent failure in the log. */
function withErrors_(fn) {
  try {
    fn();
  } catch (e) {
    SpreadsheetApp.getUi().alert('Stopped', String(e && e.message ? e.message : e), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function ui_() { return SpreadsheetApp.getUi(); }

function alert_(title, msg) {
  ui_().alert(title, msg, ui_().ButtonSet.OK);
}

function confirm_(title, msg) {
  return ui_().alert(title, msg, ui_().ButtonSet.YES_NO) === ui_().Button.YES;
}

/** Stage picker (§7). Returns 1|2|3, or null if cancelled. */
function promptStage_() {
  var res = ui_().prompt('Which stage?', 'Enter 1, 2 or 3.', ui_().ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui_().Button.OK) return null;
  var n = parseInt(trim_(res.getResponseText()), 10);
  if ([1, 2, 3].indexOf(n) === -1) throw new Error('Stage must be 1, 2 or 3. Got: "' + res.getResponseText() + '"');
  return n;
}

/**
 * §7 — read-only. Reports state without printing Engine cell contents:
 * secrets aren't the point (see 01_Engine.gs), but a check that echoes the
 * config back is a check the operator stops reading.
 */
function setupCheck() {
  var cfg = readEngine_();
  var mode = engineMode_(cfg);
  var lines = [];

  lines.push('MODE: ' + mode + (mode === MODE.LIVE ? '  ← live mail goes to real prospects' : '  (mail goes to your test address)'));
  lines.push('Max sends per run: ' + engineMaxSends_(cfg) + '  (operator-set, locked)');
  lines.push('Min days between emails: ' + engineMinDaysBetween_(cfg) + '  (operator-set, locked; Phase 2)');

  var cc = operatorCcFor_(mode);
  if (mode === MODE.TEST) {
    lines.push('Operator CC on test sends: ' + (cc || 'none set'));
  }

  // An ignored edit is reported as ignored. Silent correctness would leave a
  // BDM believing they had changed something that had not changed.
  var lockIssues = engineLockViolations_();
  if (lockIssues.length) {
    lines.push('');
    lines.push('Locked settings edited on the Engine sheet — these edits are IGNORED:');
    lockIssues.forEach(function (v) {
      lines.push('  • ' + v.key + ': sheet says "' + v.sheetValue + '", running value is ' +
        v.effectiveValue + '. Ask the operator to change it.');
    });
  }
  lines.push('');

  [1, 2, 3].forEach(function (s) {
    try {
      var t = activeTemplate_(s);
      lines.push('Stage ' + s + ' template: OK — "' + t.name + '"');
    } catch (e) {
      lines.push('Stage ' + s + ' template: PROBLEM — ' + e.message);
    }
  });

  lines.push('');
  var problems = engineProblems_(cfg, mode);
  if (problems.length) {
    lines.push('Configuration problems — sending is blocked until these are fixed:');
    problems.forEach(function (p) { lines.push('  • ' + p); });
  } else {
    lines.push('Configuration: OK (test address, sender name and signature are all set).');
  }

  lines.push('');
  lines.push('Gmail recipients remaining today: ' + MailApp.getRemainingDailyQuota());

  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var last = qsh.getLastRow();
  var pending = 0, done = 0;
  if (last >= 2) {
    qsh.getRange(2, 1, last - 1, qsh.getLastColumn()).getValues().forEach(function (r) {
      if (isBlank_(val_(r, qmap, 'Email', SHEETS.QUEUE)) && isBlank_(val_(r, qmap, 'Prospect ID', SHEETS.QUEUE))) return;
      if (isBlank_(val_(r, qmap, 'Status', SHEETS.QUEUE))) pending++; else done++;
    });
  }
  lines.push('Send Queue: ' + pending + ' unprocessed, ' + done + ' completed (clear them before the next batch).');

  alert_('Setup Check', lines.join('\n'));
}