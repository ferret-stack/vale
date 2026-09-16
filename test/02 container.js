/**
 * 02_Container.gs  [CONTAINER — Test sheet]
 *
 * The whole container. Thirteen wrappers and nothing else.
 *
 * Every one of these exists because of a platform rule, not a design choice:
 * Apps Script resolves menu-item function names and google.script.run targets
 * in the SPREADSHEET-BOUND script's global scope, never in a library. See the
 * header of the library's 13_Api.gs for the full reasoning.
 *
 * If you are tempted to put logic in this file: don't. Anything that belongs
 * to more than one BDM belongs in the library, and anything that belongs to
 * Test sheet alone belongs in 00_Config.gs as data. A behaviour change made here is
 * a behaviour change that silently does not reach the BDMs.
 */

function onOpen() { Vale.installMenu(IMPORT_PROFILE); }

/** Run once from the editor on a blank spreadsheet. */
function setupWorkbook() {
  Vale.setupWorkbook({ prospects: PROSPECT_SEED, templates: TEMPLATE_SEED });
}

// --- Menu handlers -------------------------------------------------------
function menuOpenSidebar()    { Vale.menuOpenSidebar(); }
function menuAddToQueue()     { Vale.menuAddToQueue(); }
function menuValidateQueue()  { Vale.menuValidateQueue(); }
function menuSendBatch()      { Vale.menuSendBatch(); }
function menuClearCompleted() { Vale.menuClearCompleted(); }
function menuSetupCheck()     { Vale.menuSetupCheck(); }
function menuImportList()     { Vale.menuImportList(IMPORT_PROFILE); }

// --- google.script.run targets (Sidebar.html, SendPreview.html) ----------
function getSidebarStatus()              { return Vale.getSidebarStatus(); }
function sidebarStageSelectedRows(stage) { return Vale.sidebarStageSelectedRows(stage); }
function sidebarValidate(stage)          { return Vale.sidebarValidate(stage); }
function sidebarSendBatch(stage)         { return Vale.sidebarSendBatch(stage); }
function sidebarClearCompleted()         { return Vale.sidebarClearCompleted(); }
function executeConfirmedSend(stage, fingerprint) {
  return Vale.confirmSend(stage, fingerprint);
}
