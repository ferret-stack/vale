/**
 * 13_Api.gs  [LIBRARY] — the public surface. Everything a container calls.
 *
 * ===========================================================================
 * WHY THIS FILE HAS TO EXIST
 * ===========================================================================
 *
 * Apps Script treats a trailing underscore as "private": a function named
 * foo_() is NOT exported from a library and cannot be reached as Vale.foo_().
 *
 * Almost every function in this codebase ends in an underscore — sheet_(),
 * col_(), render_(), readEngine_(), sendBatch_(), runImport_(). That was the
 * right convention for a single bound script, where the underscore documented
 * "internal, don't call from the menu", and it is the reason the extraction
 * could not be a straight file move: moving those files into a library makes
 * every one of them invisible to the containers that need them.
 *
 * Two ways out. Strip the underscores everywhere — a rename across ~2,200
 * lines, which loses the internal/external distinction inside the library and
 * makes every one of those helpers part of the fleet's public contract. Or add
 * one file that names the small set of entry points that are genuinely public
 * and leaves the other ~60 functions private.
 *
 * This is the second. The internal files stay byte-identical or near enough to
 * diff by eye against David's originals, which is what makes the regression
 * claim checkable; the public contract is small, deliberate, and visible in
 * one place.
 *
 * ===========================================================================
 * WHAT A CONTAINER MUST STILL DEFINE ITSELF
 * ===========================================================================
 *
 * Two kinds of name resolve in the CONTAINER's global scope, never in a
 * library, and no amount of exporting changes that:
 *
 *   1. Menu handlers — addItem('…', 'menuSendBatch') looks up 'menuSendBatch'
 *      in the container.
 *   2. google.script.run targets — Sidebar.html and SendPreview.html call
 *      getSidebarStatus, sidebarStageSelectedRows, sidebarValidate,
 *      sidebarSendBatch, sidebarClearCompleted and executeConfirmedSend, and
 *      all six resolve in the container.
 *
 * So each container carries thirteen one-line wrappers. They contain no logic
 * — every one is `return Vale.x(...)` — and they are the irreducible floor of
 * the thin-container pattern on this platform.
 */

/** Bumped by hand when the public contract changes. Shown by Setup Check. */
var VALE_LIBRARY_VERSION = '2.0.0-multibdm';

function libraryInfo() {
  return {
    version: VALE_LIBRARY_VERSION,
    lockedSettings: ENGINE_LOCKED_VALUES,
    operatorCcConfigured: !!trim_(OPERATOR_CC)
  };
}

// ---------------------------------------------------------------------------
// Install / menu
// ---------------------------------------------------------------------------

/** Called from the container's onOpen(). profile may be null (no importer). */
function installMenu(profile) { buildMenu_(profile); }

/** Called once from the editor, via the container's setupWorkbook(). */
function setupWorkbook(seed) { setupWorkbook_(seed); }

// ---------------------------------------------------------------------------
// Menu handlers. Each wraps its own errors into a dialog, exactly as the
// single-sheet build did — withErrors_() is applied HERE rather than in the
// container so that error presentation cannot drift between BDMs.
// ---------------------------------------------------------------------------

function menuOpenSidebar()    { withErrors_(showSendPanel); }
function menuAddToQueue()     { withErrors_(addProspectsToQueue); }
function menuValidateQueue()  { withErrors_(validateSendQueue); }
function menuSendBatch()      { withErrors_(sendBatchFromMenu); }
function menuClearCompleted() { withErrors_(clearCompletedQueueRows); }
function menuSetupCheck()     { withErrors_(setupCheck); }

/** Import needs the container's profile, so it takes an argument. */
function menuImportList(profile) {
  withErrors_(function () { runImportFlow_(profile); });
}

// ---------------------------------------------------------------------------
// Sidebar / dialog entry points. The container's wrappers of the same names
// delegate straight to these.
// ---------------------------------------------------------------------------

function getSidebarStatus()              { return getSidebarStatus_impl_(); }
function sidebarStageSelectedRows(stage) { return sidebarStageSelectedRows_impl_(stage); }
function sidebarValidate(stage)          { return sidebarValidate_impl_(stage); }
function sidebarSendBatch(stage)         { return sidebarSendBatch_impl_(stage); }
function sidebarClearCompleted()         { return sidebarClearCompleted_impl_(); }

/**
 * Called by SendPreview.html, through the container, after the operator has
 * seen the rendered message. Defined in 08_Send.gs; re-exported here so the
 * whole public contract is readable in one file.
 */
function confirmSend(stage, fingerprint) { return executeConfirmedSend(stage, fingerprint); }

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Runs a profile end to end, including the tab-name prompt and the report. */
function runImport(profile) { runImportFlow_(profile); }

/**
 * The pure core: given a source sheet and a profile, import and return the
 * structured result without touching the UI. This is what the test harness
 * drives, and it is public so the test spreadsheet can drive it too.
 */
function importFromSheet(srcSheet, profile) { return runImport_(srcSheet, profile); }

/** Profile shape check, exposed so a container can fail fast at install time. */
function validateImportProfile(profile) { return validateImportProfile_(profile); }
