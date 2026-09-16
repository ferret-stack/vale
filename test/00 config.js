/**
 * 00_Config.gs  [CONTAINER — Test sheet]
 *
 * The operator's own sheet, the fourth in the fleet. It exists to exercise the
 * library BEFORE a version is pinned into a BDM's spreadsheet, and it never
 * sends real outreach.
 *
 * TRACKS HEAD, NOT A PINNED VERSION. Its appsscript.json sets
 * developmentMode: true on the library dependency, so it always runs the
 * library's saved head content — no version bump needed to test a change, and
 * no way for it to silently lag behind. David's and Muki's manifests pin an
 * explicit version instead; that asymmetry is the whole point of this sheet.
 *
 * >>> MODE MUST STAY TEST ON THIS SHEET. <<<
 * MODE is a BDM-editable Engine key by design (a BDM has to be able to go
 * live), so nothing in code stops it being flipped here. On this sheet that is
 * a convention, not a control. If this sheet ever needs a hard block, the
 * place to add it is the library's engineProblems_(), keyed on the
 * spreadsheet ID — but that is new scope and is not built.
 *
 * It carries MUKI'S import profile rather than David's. Her importer is the
 * one with the pause-routing rule and the verified-header refusal, so it is
 * the one worth being able to run by hand against a pasted copy of
 * docs/Muki_Template_SAMPLE.xlsx. David's map is a strict subset in shape
 * (map only, no pause rule) and is covered by the same code path.
 */

var IMPORT_PROFILE = {
  label: 'Muki Template',
  defaultSheetName: 'Muki Template',

  columnMap: [
    ['Name',                        'First Name'],
    ['Name (last)',                 'Last Name'],
    ['Agency',                      'Company'],
    ['Title',                       'Job Title'],
    ['Company Phone',               'Phone'],
    ['Email',                       'Email'],
    ['LinkedIn (Decision maker)',   'LinkedIn URL'],
    ['Insta Link (Decision maker)', 'Instagram'],
    ['Website',                     'Website']
    // Town/Area deliberately unmapped — see muki/00_Config.gs for the reasoning.
    // Keep this list identical to Muki's or this sheet stops being a test of hers.
  ],

  pauseOnNonBlank: [
    'Emailed',
    '1st Called',
    'Visit',
    'Meeting',
    'Offered',
    'Signed as partner'
  ]
};
