/**
 * 11_ImportCore.gs  [LIBRARY] — Addendum v1 §2, generalised for multi-BDM.
 *
 * David's 11_Import.gs was one importer with one hardcoded column map. Muki
 * needs a different map and one extra rule, so the ENGINE moved here and the
 * MAP stayed with the BDM. A profile (see importProfile_() below) is a plain
 * object living in the BDM's own container script; this file knows how to run
 * one and knows nothing about either BDM's spreadsheet.
 *
 * What did NOT change, and deliberately so: the required-field gate, the
 * malformed-email check, the within-source duplicate check, the
 * already-on-Prospects check, the filler-row rule, and the report shape are
 * the same code for every BDM, not a per-profile setting. Those are the rules
 * that stop bad data entering Prospects; making them configurable would make
 * them negotiable.
 *
 * Header-name resolution throughout (§1 / §9.5). No column letters, no indices,
 * on either sheet. Validation reuses isValidEmail_, normEmail_ and
 * buildProspectIndex_ rather than restating rules.
 *
 * NOTE ON WRITES: this appends whole new rows; it never calls
 * writeProspectFields_(). That helper enforces PROSPECT_WRITABLE, which
 * protects human-owned columns on rows that already exist. An import creates
 * the row, so there is no human data to protect — and widening the allowlist
 * to let a script write First Name / Company / Email on an existing row would
 * weaken a load-bearing guarantee for no gain. This is why the Paused /
 * Notes routing below is legitimate even though both are human-owned columns:
 * it is setting them at creation, not overwriting a human's edit.
 */

/** Required to create a Prospects row at all (MVP spec §2). Not per-profile. */
var IMPORT_REQUIRED = ['First Name', 'Email'];

/** Longest itemised skip list a Ui.alert can carry without becoming unreadable. */
var IMPORT_MAX_REPORTED = 25;

/**
 * Validates a profile before it is allowed anywhere near a sheet.
 * A malformed profile is a developer error in a container script, and it
 * should surface as one rather than as a confusing import result.
 */
function validateImportProfile_(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Import profile missing. The container script must define importProfile_().');
  }
  if (!profile.label) throw new Error('Import profile has no label.');
  if (!profile.columnMap || !profile.columnMap.length) {
    throw new Error('Import profile "' + profile.label + '" has an empty columnMap.');
  }
  var targets = {};
  profile.columnMap.forEach(function (m) {
    if (!m || m.length !== 2 || !m[0] || !m[1]) {
      throw new Error('Import profile "' + profile.label + '" has a malformed columnMap entry.');
    }
    if (PROSPECT_COLS.indexOf(m[1]) === -1) {
      throw new Error('Import profile "' + profile.label + '" maps to "' + m[1] +
        '", which is not a Prospects column. Valid targets come from PROSPECT_COLS.');
    }
    if (targets[m[1]]) {
      throw new Error('Import profile "' + profile.label + '" maps two source columns to "' +
        m[1] + '". Each Prospects field may be filled from one source column only.');
    }
    targets[m[1]] = true;
  });
  return profile;
}

/**
 * Every source header the profile depends on: the mapped ones, plus the
 * outreach-history columns the pause rule reads. Both are load-bearing, so
 * both are verified before any write.
 */
function profileRequiredHeaders_(profile) {
  var names = profile.columnMap.map(function (m) { return m[0]; });
  (profile.pauseOnNonBlank || []).forEach(function (h) {
    if (names.indexOf(h) === -1) names.push(h);
  });
  return names;
}

/**
 * Refuses, by name, if the source does not carry every header the profile
 * needs — before a single row is written.
 *
 * This is the same posture as headerMap_()'s duplicate-header refusal, and for
 * the same reason: a near-miss header is worse than a missing one. "Location"
 * where "Address" was expected still reads as a column full of plausible
 * place names, so a substitution would import silently and wrongly, and the
 * mistake would only surface later as merge values in real emails. The error
 * names what is missing and shows what the sheet actually has, so the operator
 * can see the near-miss and decide, rather than the importer deciding for them.
 */
function verifySourceHeaders_(src, smap, profile) {
  var needed = profileRequiredHeaders_(profile);
  var missing = needed.filter(function (h) { return !smap[h]; });
  if (!missing.length) return;

  var present = Object.keys(smap).sort();
  throw new Error(
    '"' + src.getName() + '" does not match the ' + profile.label + ' layout. ' +
    'Nothing was imported.\n\n' +
    'Missing column header(s), exactly as expected:\n  • ' + missing.join('\n  • ') + '\n\n' +
    'Headers actually found on that tab:\n  • ' + present.join('\n  • ') + '\n\n' +
    'The header row must be row 1 and the names must match exactly. If a column ' +
    'has been renamed, either rename it back or have the import profile updated — ' +
    'the importer will not guess which column was meant.');
}

/**
 * The outreach-history columns that are non-blank on this row.
 * Returns [{ header, text }] in profile order — order is the profile's, not
 * the sheet's, so the Notes string reads the same way for every row.
 */
function pauseTriggersFor_(r, smap, srcName, profile) {
  var cols = profile.pauseOnNonBlank || [];
  var hits = [];
  cols.forEach(function (h) {
    var v = trim_(val_(r, smap, h, srcName));
    if (v) hits.push({ header: h, text: v });
  });
  return hits;
}

/**
 * Reads the source sheet, decides row by row, appends what qualifies.
 * Returns { title, body, imported, paused, active, skipped: [string], filler, sourceRows }.
 */
function runImport_(src, profile) {
  validateImportProfile_(profile);

  var smap = headerMap_(src);
  verifySourceHeaders_(src, smap, profile);

  var lastRow = src.getLastRow();
  if (lastRow < 2) throw new Error('"' + src.getName() + '" has a header row but no data.');

  var srcRows = src.getRange(2, 1, lastRow - 1, src.getLastColumn()).getValues();

  var psh = sheet_(SHEETS.PROSPECTS);
  var pmap = headerMap_(psh);
  var pWidth = psh.getLastColumn();

  // Existing prospects, indexed by normalised email — the same index send-time
  // validation uses, so "already on the list" means the same thing in both places.
  var idx = buildProspectIndex_();

  var nextId = maxProspectIdNumber_(psh, pmap);
  var now = new Date();
  var sourceLabel = profile.label + ' import — ' +
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var skipped = [];
  var filler = 0;
  var pausedCount = 0;
  var seenInSource = {};   // normalised email -> source row number
  var newRows = [];

  srcRows.forEach(function (r, i) {
    var srcRowNum = i + 2;

    function s(header) { return trim_(val_(r, smap, header, src.getName())); }

    // Resolve the three identity fields THROUGH the profile, not by assuming
    // the source calls them what Prospects calls them — Muki's first-name
    // column is "Name" and her last-name column is "Name (last)".
    function mapped(prospectField) {
      for (var k = 0; k < profile.columnMap.length; k++) {
        if (profile.columnMap[k][1] === prospectField) return s(profile.columnMap[k][0]);
      }
      return '';
    }

    var first = mapped('First Name');
    var last  = mapped('Last Name');
    var email = mapped('Email');

    // A row with no name and no email is not a partially-filled person, it is
    // spreadsheet residue — a dragged-down Company value, a leftover formula.
    // Counted, never itemised: the real list carries hundreds of these and an
    // itemised report would bury the handful of skips that need a decision.
    //
    // Muki's sample README calls this out explicitly: an agency-only row with a
    // phone number is a REAL early-stage record, not an error. It still cannot
    // become a Prospects row — there is no one to address an email to — so it
    // is counted here rather than reported as a failure.
    if (!first && !last && !email) { filler++; return; }

    var who = (first + ' ' + last).trim() || email || '(no name)';
    var label = 'Row ' + srcRowNum + ' ' + who;

    var missing = IMPORT_REQUIRED.filter(function (h) { return !mapped(h); });
    if (missing.length) {
      skipped.push(label + ' — missing required ' + missing.join(', '));
      return;
    }

    if (!isValidEmail_(email)) {
      skipped.push(label + ' — malformed email address (' + email + ')');
      return;
    }

    var key = normEmail_(email);

    // Within-source first. A row this same run has already dealt with must be
    // reported against the source row it collides with, not as "already on
    // Prospects" — the record it would be pointing at was created seconds ago
    // by this very import, and that reads as pre-existing data.
    if (seenInSource[key]) {
      skipped.push(label + ' — duplicate of source row ' + seenInSource[key] + ' (' + email + ')');
      return;
    }
    seenInSource[key] = srcRowNum;

    var existing = idx.byEmail[key];
    if (existing) {
      skipped.push(label + ' — already on Prospects as ' +
        (existing['Prospect ID'] || 'row ' + existing.rowNum) + ' (' + email + ')');
      return;
    }

    nextId++;
    var id = PROSPECT_ID_PREFIX + padId_(nextId);

    var row = new Array(pWidth).fill('');
    function set(header, v) { row[col_(pmap, header, SHEETS.PROSPECTS) - 1] = v; }

    set('Prospect ID', id);
    profile.columnMap.forEach(function (m) { set(m[1], s(m[0])); });
    set('Source', sourceLabel);
    set('Date Added', now);

    // ---------------------------------------------------------------------
    // The pause rule (Muki's addition; any profile may declare it).
    //
    // A row carrying ANY prior outreach imports Paused = Y, with the raw text
    // of those columns copied into Notes.
    //
    // Paused rather than skipped: the person is a real prospect and belongs on
    // the list — what is unsafe is AUTOMATED outreach to them, because someone
    // has already contacted them by hand under rules this tool never applied.
    // Paused is checked at send time by evaluateQueue_() against the live
    // Prospects row, so a paused import cannot be sent to even if it is staged
    // by accident. Unpausing is a human clearing one cell once they have read
    // the Notes.
    //
    // The history is NOT written into Email {n} Status. That column means "this
    // tool sent this stage", and a hand-logged "Aug 22" in someone's tracking
    // sheet is not that. Writing it there would make the stage gate believe
    // outreach happened under guarantees it never had. It goes to Notes, which
    // is prose for humans, and the raw text is copied verbatim rather than
    // parsed — "N — already had a partner" is a sentence, not a date.
    // ---------------------------------------------------------------------
    var triggers = pauseTriggersFor_(r, smap, src.getName(), profile);
    if (triggers.length) {
      set('Paused', 'Y');
      set('Notes', importedHistoryNote_(triggers));
      pausedCount++;
    }

    newRows.push(row);
  });

  if (newRows.length) {
    psh.getRange(psh.getLastRow() + 1, 1, newRows.length, pWidth).setValues(newRows);
    SpreadsheetApp.flush();
  }

  var activeCount = newRows.length - pausedCount;
  return {
    title: 'Imported ' + newRows.length + ' prospect(s)',
    body: importReport_(profile, src.getName(), srcRows.length, newRows.length,
                        pausedCount, activeCount, skipped, filler),
    imported: newRows.length,
    paused: pausedCount,
    active: activeCount,
    skipped: skipped,
    filler: filler,
    sourceRows: srcRows.length
  };
}

/**
 * The Notes string for a paused row. Verbatim source text, labelled by the
 * column it came from, so a human reading the row later can tell what happened
 * and when without opening the original sheet.
 */
function importedHistoryNote_(triggers) {
  return 'Imported with prior outreach history — Paused so automated sending ' +
    'cannot start without a human decision. From the source list: ' +
    triggers.map(function (t) { return t.header + ': ' + t.text; }).join('; ') + '.';
}

function importReport_(profile, srcName, sourceRows, imported, paused, active, skipped, filler) {
  var out = [];
  out.push('Source: "' + srcName + '"   ' + sourceRows + ' data row(s)');
  out.push('');
  out.push('Imported: ' + imported);
  if (profile.pauseOnNonBlank && profile.pauseOnNonBlank.length) {
    out.push('  • Active (no prior outreach): ' + active);
    out.push('  • Paused (prior outreach found, see Notes): ' + paused);
  }
  out.push('Skipped: ' + skipped.length);
  out.push('Blank or filler rows ignored: ' + filler);

  if (skipped.length) {
    out.push('');
    out.push('Skipped, and why:');
    skipped.slice(0, IMPORT_MAX_REPORTED).forEach(function (s) { out.push('  • ' + s); });
    if (skipped.length > IMPORT_MAX_REPORTED) {
      out.push('  …and ' + (skipped.length - IMPORT_MAX_REPORTED) + ' more of the same kinds.');
    }
  }

  if (imported) {
    out.push('');
    out.push('Nothing was sent. Imported rows are on Prospects with fresh IDs — ' +
      'review them, then stage as normal.');
    if (paused) {
      out.push('The ' + paused + ' paused row(s) will not send while Paused is set, ' +
        'even if staged. Read the Notes, then clear Paused on the ones you want to contact.');
    }
  }
  return out.join('\n');
}

/**
 * Menu entry point. Prompts for the source tab, imports, reports.
 * The profile comes from the container script, so this one function serves
 * every BDM without knowing which one it is running for.
 */
function runImportFlow_(profile) {
  validateImportProfile_(profile);
  var ss = SpreadsheetApp.getActive();
  var fallback = profile.defaultSheetName || profile.label;

  var res = ui_().prompt(
    'Import from ' + profile.label,
    'Name of the tab holding the list (paste it into this spreadsheet first).\n\n' +
    'Leave as-is to use "' + fallback + '".',
    ui_().ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui_().Button.OK) return;

  var name = trim_(res.getResponseText()) || fallback;

  if ([SHEETS.PROSPECTS, SHEETS.QUEUE, SHEETS.TEMPLATES, SHEETS.ENGINE, SHEETS.RUN_LOG].indexOf(name) !== -1) {
    throw new Error('"' + name + '" is one of the tool\'s own sheets. The source list must be a separate tab.');
  }

  var src = ss.getSheetByName(name);
  if (!src) {
    throw new Error('No tab named "' + name + '" in this spreadsheet. ' +
      'Paste the list in as its own tab, keeping its header row, then run this again.');
  }

  var result = runImport_(src, profile);
  alert_(result.title, result.body);
}
