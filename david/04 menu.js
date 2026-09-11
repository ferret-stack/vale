/**
 * 04_Menu.gs — §7. No time-driven triggers in v1.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Outreach')
    .addItem('Open Send Panel', 'menuOpenSidebar')
    .addSeparator()
    .addItem('Add Prospects to Send Queue', 'menuAddToQueue')
    .addItem('Validate Send Queue', 'menuValidateQueue')
    .addSeparator()
    .addItem('Send Batch', 'menuSendBatch')
    .addSeparator()
    .addItem('Clear Completed Queue Rows', 'menuClearCompleted')
    .addSeparator()
    .addItem('Import from David\'s List', 'menuImportDavidsList')
    .addItem('Setup Check', 'menuSetupCheck')
    .addToUi();
}

function menuOpenSidebar() { withErrors_(showSendPanel); }

function menuAddToQueue() { withErrors_(addProspectsToQueue); }
function menuValidateQueue() { withErrors_(validateSendQueue); }
function menuSendBatch() { withErrors_(sendBatchFromMenu); }
function menuClearCompleted() { withErrors_(clearCompletedQueueRows); }
function menuImportDavidsList() { withErrors_(importDavidsList); }
function menuSetupCheck() { withErrors_(setupCheck); }

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
  lines.push('Max sends per run: ' + engineMaxSends_(cfg));
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