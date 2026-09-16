/**
 * 00_Config.gs  [CONTAINER — David]
 *
 * Everything in David's spreadsheet that is his and not the fleet's. All
 * shared logic lives in the Vale library; this file is data, not behaviour.
 *
 * The import profile is here rather than in the library because the column map
 * describes HIS source list. The rules applied to it — required fields,
 * malformed email, within-source duplicates, already-on-Prospects — are in the
 * library and are the same for every BDM. Map is local; rules are shared.
 */

/** Addendum §2 mapping table, verbatim. Unchanged from the single-sheet build. */
var IMPORT_PROFILE = {
  label: 'David\'s List',
  defaultSheetName: 'Davids List',
  columnMap: [
    ['First Name', 'First Name'],
    ['Last Name',  'Last Name'],
    ['Company',    'Company'],
    ['Job Title',  'Job Title'],
    ['Town/Area',  'Town/Area'],
    ['Email',      'Email'],
    ['Phone',      'Phone'],
    ['Insta',      'Instagram']
  ]
  // No pauseOnNonBlank: David's source carries no outreach-history columns
  // this tool can read, so every imported row is active. See Muki's profile
  // for the other case.
};
