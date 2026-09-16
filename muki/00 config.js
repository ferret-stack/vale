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
 * The sample's header row carries 24 columns. Nine of them map. The map below
 * uses the header text EXACTLY as it appears in that file — not as it appears
 * in any spec or handover table, because two names in that table do not exist
 * in the file at all:
 *
 *   "Address"   — no such column. See the note on Town/Area below.
 *   "Postcode"  — no such column. It was listed among the columns to drop, so
 *                 nothing is lost by its absence, but the table was wrong
 *                 about the file and that is worth recording.
 *
 * Deliberately dropped, present in the source and unmapped because the v1
 * schema has no slot for them: Type, Insta Link (Company), Tube station,
 * Location, and the outreach-history columns (which are read by the pause
 * rule below, but are never copied into a Prospects field).
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
    ['Company Phone',               'Phone'],
    ['Email',                       'Email'],
    ['LinkedIn (Decision maker)',   'LinkedIn URL'],
    ['Insta Link (Decision maker)', 'Instagram'],
    ['Website',                     'Website']

    // ---------------------------------------------------------------------
    // Town/Area IS DELIBERATELY UNMAPPED. Do not add a guess here.
    //
    // The mapping table said "Address -> Town/Area". The sample file has no
    // column called Address. It has three that could plausibly be meant, and
    // all three are wrong to assume:
    //
    //   "Location [CHECK whether it is real Office or NO via PHONE]"
    //       — a header with a working instruction embedded in it, so it is
    //         likely to be reworded at any time. Holds an area name
    //         ("Nine Elms") on exactly one sample row, and that row has no
    //         contact on it, so it would not import anyway.
    //   "Tube station"
    //       — holds a postcode ("SW8 3HE") in the sample, not a station.
    //   "Location"
    //       — clean name, completely empty in the sample.
    //
    // Guessing costs more than it saves. A wrong guess here does not fail
    // loudly; it fills a merge field with a plausible-looking wrong value and
    // ships it inside real emails to real estate agents.
    //
    // Consequence, stated plainly: imported rows have Town/Area BLANK. The
    // renderer treats a missing placeholder value as a hard failure, so any
    // template using {{TownArea}} would skip every one of these rows at send
    // time. That is why Muki's seed templates below do not use {{TownArea}}.
    //
    // To fix: confirm which source column is the town/area, add one line here,
    // and re-run the import. No other change is needed anywhere.
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
