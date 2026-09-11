/**
 * 10_Sidebar.gs
 * Server-side functions callable from Sidebar.html via google.script.run.
 *
 * These are thin wrappers around the same core functions the menu uses
 * (05_Staging.gs, 07_Validation.gs, 08_Send.gs) — no send/staging/validation
 * logic is duplicated here, so the two surfaces cannot drift apart.
 *
 * The stage picker is a dropdown in the sidebar, never a text prompt.
 *
 * ADDENDUM v1: the two safety gates now sit in different surfaces. The LIVE
 * recipient-count confirmation is still a native Ui dialog (confirmed working
 * from the sidebar). The first-message preview moved to SendPreview.html, a
 * modal dialog, because Ui.alert() renders raw tags and an HTML signature
 * would have made that gate unreadable. It is still a modal interruption over
 * the sheet, not an inline panel message — the reason the gates were kept out
 * of the panel in the first place still holds.
 */

function showSendPanel() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Outreach — Send Panel')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Snapshot the sidebar shows on open and after every action. */
function getSidebarStatus() {
  var cfg = readEngine_();
  var mode = engineMode_(cfg);
  var configProblems = engineProblems_(cfg, mode);

  var templates = [1, 2, 3].map(function (s) {
    try {
      var t = activeTemplate_(s);
      return { stage: s, ok: true, name: t.name };
    } catch (e) {
      return { stage: s, ok: false, error: e.message };
    }
  });

  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);
  var last = qsh.getLastRow();
  var pending = 0, done = 0;
  if (last >= 2) {
    qsh.getRange(2, 1, last - 1, qsh.getLastColumn()).getValues().forEach(function (r) {
      if (isRowEmpty_(r)) return;
      if (isBlank_(val_(r, qmap, 'Status', SHEETS.QUEUE))) pending++; else done++;
    });
  }

  return {
    mode: mode,
    configProblems: configProblems,
    templates: templates,
    quotaRemaining: MailApp.getRemainingDailyQuota(),
    maxSendsPerRun: engineMaxSends_(cfg),
    queuePending: pending,
    queueDone: done
  };
}

/**
 * Reads the CURRENT selection on Prospects (must be the active sheet when
 * the sidebar button is clicked) and stages it for the given stage.
 */
function sidebarStageSelectedRows(stage) {
  var ss = SpreadsheetApp.getActive();
  if (ss.getActiveSheet().getName() !== SHEETS.PROSPECTS) {
    throw new Error('Click on the Prospects tab and select rows there first, then use this panel.');
  }
  var rowNums = selectedDataRows_(sheet_(SHEETS.PROSPECTS));
  if (!rowNums.length) {
    throw new Error('No rows selected on Prospects. Select one or more rows, then try again.');
  }

  var result = stageRowsInteractive_(rowNums, stage);
  if (!result) {
    return { cancelled: true, stagedCount: 0, skipped: [], previewProblems: [] };
  }
  return { cancelled: false, stagedCount: result.stagedCount, skipped: result.skipped, previewProblems: result.previewProblems };
}

function sidebarValidate(stage) {
  var r = runValidation_(stage);
  return {
    templateError: r.templateError,
    configProblems: r.configProblems,
    eligibleCount: r.eligible.length,
    invalidCount: r.invalid.length,
    notGated: r.notGated,
    otherStage: r.otherStage,
    invalid: r.invalid.map(function (it) {
      return 'Row ' + it.rowNum + ' ' + (it.email || '(no email)') + ' — ' + it.reason;
    })
  };
}

/**
 * Opens the send flow. Does NOT send: it runs pre-flight, the LIVE
 * recipient-count confirmation (native, unchanged), and then opens the HTML
 * preview dialog, which is where the operator actually confirms and where the
 * run summary appears. Returns { opened, title?, message? } so the panel can
 * say what happened when the flow stopped before the dialog opened.
 *
 * The result of the send itself lands in the dialog, not here — an
 * HtmlService dialog cannot return a value to the call that opened it. Use
 * Refresh status in the panel afterwards.
 */
function sidebarSendBatch(stage) {
  return startSendFlow_(stage);
}

/**
 * Same confirm dialog as the menu path (irreversible delete). Returns a
 * result the panel renders inline; null means the operator declined at the
 * native confirm.
 */
function sidebarClearCompleted() {
  var r = clearCompletedQueueRowsCore_();
  if (r === null) return { cancelled: true, cleared: 0, empty: false };
  return { cancelled: false, cleared: r.cleared, empty: r.empty };
}