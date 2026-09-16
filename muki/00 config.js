/**
 * 00_Config.gs  [CONTAINER — Muki]
 *
 * Muki's spreadsheet-local data. All shared logic is in the Vale library.
 * Same schema as David — she prospects estate agents, same use case — so
 * nothing here changes PROSPECT_COLS or the placeholder set.
 *
 * ===========================================================================
 * THE COLUMN MAP WAS VERIFIED AGAINST docs/Muki_Template_SAMPLE.xlsx.
 * ===========================================================================
 *
 * The sample's header row carries 24 columns. Ten of them map. The map below
 * uses the header text EXACTLY as it appears in that file — not as it appears
 * in any spec or handover table, because two names in that table do not exist
 * in the file at all:
 *
 *   "Address"   — no such column. Town/Area is mapped from the column that
 *                 actually carries area names; see the note on it below.
 *   "Postcode"  — no such column. It was listed among the columns to drop, so
 *                 nothing is lost by its absence, but the table was wrong
 *                 about the file and that is worth recording.
 *
 * Deliberately dropped, present in the source and unmapped because the v1
 * schema has no slot for them, or because they are not what they claim to be:
 * Type, Insta Link (Company), Tube station (holds postcodes), Location (empty
 * throughout), and the outreach-history columns (read by the pause rule below,
 * but never copied into a Prospects field).
 */

var IMPORT_PROFILE = {
  label: 'Muki Template',
  defaultSheetName: 'Muki Template',

  columnMap: [
    // Source header (verbatim from the sample)   ->  Prospects field
    ['Name',                        'First Name'],
    ['Name (last)',                 'Last Name'],
    ['Agency',                      'Company'],
    ['Title',                       'Job Title'],
    ['Location [CHECK whether it is real Office or NO via PHONE]',
                                    'Town/Area'],
    ['Company Phone',               'Phone'],
    ['Email',                       'Email'],
    ['LinkedIn (Decision maker)',   'LinkedIn URL'],
    ['Insta Link (Decision maker)', 'Instagram'],
    ['Website',                     'Website']

    // ---------------------------------------------------------------------
    // ON Town/Area, and why it maps to that unwieldy header.
    //
    // The mapping table this build was specified against said
    // "Address -> Town/Area". The sample file has no column called Address.
    // It has three that could plausibly have been meant, and the fill pattern
    // in the sample — which its own README says is copied from the real
    // working sheet — is what decided it:
    //
    //   "Location [CHECK whether it is real Office or NO via PHONE]"
    //       IN USE, sparsely. Holds a genuine area name ("Nine Elms").
    //       Mapped. <- this one
    //   "Tube station"
    //       Mislabelled: holds a postcode ("SW8 3HE"), not a station.
    //   "Location"  (the last column)
    //       Clean name, empty on every row. Looks like a newer column added
    //       with the intent to migrate, not yet used.
    //
    // Mapping a header with a working instruction baked into it is normally a
    // bad bet, because it will be reworded. That objection is answered by
    // verifySourceHeaders_(): a rename produces a named refusal BEFORE any row
    // is written, listing what is missing and what the tab actually has. The
    // failure is loud and the fix is one line here — which is exactly what
    // makes betting on an unstable header acceptable. Mapping the empty
    // "Location" instead would have been stable and worthless.
    //
    // If it is reworded: update the string above to match the new header
    // exactly. Do not switch to prefix or fuzzy matching — BOTH candidate
    // columns begin with "Location", so a prefix match is ambiguous by
    // construction and would silently pick the wrong one.
    //
    // Note it is sparsely filled, so many imported rows will still have
    // Town/Area blank. That is why the seed templates do not use
    // {{TownArea}} — see 01_SeedData.gs.
    // ---------------------------------------------------------------------
  ],

  /**
   * THE EXCLUSION RULE (Muki-specific; David has no equivalent).
   *
   * Any row with a non-blank value in ANY of these columns imports with
   * Paused = Y and the raw text of those columns concatenated into Notes.
   * Rows with no outreach history import active.
   *
   * These six are the touches that mean "a human has already engaged this
   * person directly". The source has other channel columns — LinkedIn Invite,
   * Instagram/WA DM/Invite (individual), Instagram DM (company), 2nd — which
   * are NOT in this list, because the brief named these six. Worth knowing: in
   * the sample, every row carrying one of the unlisted columns also carries
   * "Emailed", so no row's routing currently depends on the distinction. That
   * is a property of the sample, not a guarantee of the real list.
   */
  pauseOnNonBlank: [
    'Emailed',
    '1st Called',
    'Visit',
    'Meeting',
    'Offered',
    'Signed as partner'
  ]
};
