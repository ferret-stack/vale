'use strict';
/**
 * Vale test harness.
 *
 *   node harness/run.js
 *
 * No npm install, no dependencies. Loads the library's .js files into a Node
 * VM with the Apps Script APIs stubbed (see gas.js) and asserts against them.
 * It does NOT go into the Apps Script editor.
 *
 * PROVENANCE, stated plainly: the Dev Log's 2026-09-03 entry refers to a
 * 26-assertion harness under `test/`. That harness is not in this repository
 * and never has been — `git log --diff-filter=A` shows no Node file ever
 * committed, and `test/` holds the operator test sheet's clasp project. This
 * harness was therefore written fresh for the multi-BDM work. It covers the
 * same ground and more, but it is NOT the original, so "David's behaviour is
 * unchanged" rests on these assertions plus the byte-identity check in
 * section A, not on parity with a suite nobody can run.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { fresh, makeEnv, workbook, grid, readBack } = require('./helpers.js');
const { readSheet } = require('./xlsx.js');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'docs', 'Muki_Template_SAMPLE.xlsx');

let pass = 0, fail = 0;
const failures = [];
let section = '';

function S(name) { section = name; console.log('\n── ' + name + ' ' + '─'.repeat(Math.max(0, 58 - name.length))); }

function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failures.push(section + ' / ' + name + (detail ? '\n      ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, name, a === e ? '' : 'expected ' + e + '\n      actual   ' + a);
}
function throws(fn, matcher, name) {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e && e.message ? e.message : e); }
  if (msg === null) return ok(false, name, 'did not throw');
  const good = matcher instanceof RegExp ? matcher.test(msg) : msg.includes(matcher);
  ok(good, name, good ? '' : 'threw, but message did not match ' + matcher + '\n      got: ' + msg);
}

// ===========================================================================
S('A. Library extraction');
// ===========================================================================
{
  const env = makeEnv();
  ok(env.files.length === 12, 'all 12 library files load into one scope', env.files.join(', '));

  const libDir = path.join(ROOT, 'library');
  const names = [];
  for (const f of fs.readdirSync(libDir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(libDir, f), 'utf8');
    for (const m of src.matchAll(/^function ([A-Za-z_][A-Za-z0-9_]*)/gm)) names.push(m[1]);
  }
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  eq(dupes, [], 'no duplicate function declarations across library files');

  // The public contract. A trailing underscore is private in an Apps Script
  // library, so every name here must be underscore-free or a container cannot
  // reach it.
  const publicApi = ['installMenu', 'setupWorkbook', 'menuOpenSidebar', 'menuAddToQueue',
    'menuValidateQueue', 'menuSendBatch', 'menuClearCompleted', 'menuSetupCheck',
    'menuImportList', 'getSidebarStatus', 'sidebarStageSelectedRows', 'sidebarValidate',
    'sidebarSendBatch', 'sidebarClearCompleted', 'confirmSend', 'executeConfirmedSend',
    'runImport', 'importFromSheet', 'validateImportProfile', 'libraryInfo'];
  const missing = publicApi.filter(n => env.run('typeof ' + n) !== 'function');
  eq(missing, [], 'every public API name is an exported (underscore-free) function');
  ok(!publicApi.some(n => n.endsWith('_')), 'no public API name ends in an underscore');

  // The strongest regression evidence available: these carried over untouched.
  const identical = ['00 schema.js', '05 staging.js', '06 render.js', '07 validation.js',
                     '09 writeback.js'];
  identical.forEach(f => {
    let orig;
    try {
      orig = cp.execSync('git show main:"david/' + f + '"', { cwd: ROOT, maxBuffer: 1 << 24 });
    } catch (e) { return ok(false, f + ' byte-identical to David\'s original', 'git show failed'); }
    const now = fs.readFileSync(path.join(libDir, f));
    ok(Buffer.compare(orig, now) === 0, f + ' byte-identical to David\'s original');
  });

  // Containers must carry no logic and no column indices.
  ['david', 'muki', 'test'].forEach(d => {
    const src = fs.readFileSync(path.join(ROOT, d, '02 container.js'), 'utf8');
    const bodies = src.match(/\{[^{}]*\}/g) || [];
    const hasLogic = /\b(for|while|if|switch)\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, ''));
    ok(!hasLogic, d + '/02 container.js contains no control flow');
    ok(!/getRange\(\s*\d+\s*,\s*\d+/.test(src), d + '/02 container.js has no numeric cell access');
  });
}

// ===========================================================================
S('B. David regression — behaviour unchanged');
// ===========================================================================
{
  const env = fresh({});
  const tpl = { name: 'T', subject: 'Quick question about {{Company}}',
                body: 'Hi {{FirstName}},\n\nAbout {{Company}}.\n\nBest,' };

  const r = env.call('render_', tpl,
    { 'First Name': 'Dana', 'Company': 'Rowe & Sons', 'Job Title': 'Director', 'Town/Area': 'Clapham' },
    '<p>Sig</p>');
  eq(r.subject, 'Quick question about Rowe & Sons', 'subject placeholders fill');
  ok(r.html.includes('Rowe &amp; Sons'), 'merge value escaped AFTER substitution');
  ok(!r.html.includes('Rowe & Sons'), 'raw ampersand does not survive into HTML');
  ok(r.html.includes('<p>Sig</p>'), 'HTML signature passes through raw');
  ok(r.text.includes('Hi Dana,') && !/<p>/.test(r.text), 'plain-text alternative is tag-free');

  throws(() => env.call('render_', { name: 'T', subject: 'x', body: 'Hi {{FirstName}}' },
    { 'First Name': '' }, ''), 'Missing value', 'missing placeholder value throws, never blank-merges');
  throws(() => env.call('render_', { name: 'T', subject: 'x', body: 'Hi {{Firstname}}' },
    { 'First Name': 'Dana' }, ''), 'unknown placeholder', 'unknown placeholder throws');

  // Eligibility split, with each skip reason distinct.
  const env2 = fresh({
    prospects: [
      { 'Prospect ID': 'P-00001', 'First Name': 'Ann', 'Email': 'ann@example.com', 'Company': 'A Ltd' },
      { 'Prospect ID': 'P-00002', 'First Name': 'Ben', 'Email': 'ben@example.com', 'Do Not Contact': 'Y' },
      { 'Prospect ID': 'P-00003', 'First Name': 'Cal', 'Email': 'cal@example.com', 'Paused': 'Y' },
      { 'Prospect ID': 'P-00004', 'First Name': 'Dee', 'Email': 'dee@example.com', 'Email 1 Status': 'SENT' }
    ],
    queue: [
      { 'Prospect ID': 'P-00001', 'Send?': 'Y', Email: 'ann@example.com', 'First Name': 'Ann', Company: 'A Ltd' },
      { 'Prospect ID': 'P-00002', 'Send?': 'Y', Email: 'ben@example.com', 'First Name': 'Ben', Company: 'B Ltd' },
      { 'Prospect ID': 'P-00003', 'Send?': 'Y', Email: 'cal@example.com', 'First Name': 'Cal', Company: 'C Ltd' },
      { 'Prospect ID': 'P-00004', 'Send?': 'Y', Email: 'dee@example.com', 'First Name': 'Dee', Company: 'D Ltd' },
      { 'Prospect ID': '',        'Send?': 'Y', Email: 'bad@@example', 'First Name': 'Eve', Company: 'E Ltd' },
      { 'Prospect ID': '',        'Send?': 'Y', Email: 'ann@example.com', 'First Name': 'Ann', Company: 'A Ltd' },
      { 'Prospect ID': '',        'Send?': '',  Email: 'fay@example.com', 'First Name': 'Fay', Company: 'F Ltd' }
    ]
  });
  const idx = env2.call('buildProspectIndex_');
  const res = env2.call('evaluateQueue_', 1,
    { name: 'T', subject: 'x {{Company}}', body: 'Hi {{FirstName}}' }, idx);
  eq(res.eligible.map(e => e.email), ['ann@example.com'], 'only the clean row is eligible');
  eq(res.notGated, 1, 'Send? not Y is counted, not skipped');
  const reasons = res.invalid.map(i => i.reason);
  ok(reasons.some(r => /Do Not Contact/.test(r)), 'Do Not Contact reported by its own reason');
  ok(reasons.some(r => /Paused/.test(r)), 'Paused reported by its own reason');
  ok(reasons.some(r => /already SENT/.test(r)), 'blocking stage status reported by its own reason');
  ok(reasons.some(r => /malformed/.test(r)), 'malformed email reported by its own reason');
  ok(reasons.some(r => /duplicate in batch/.test(r)), 'in-batch duplicate reported by its own reason');

  throws(() => env2.call('writeProspectFields_', env2.ss.getSheetByName('Prospects'),
    env2.call('headerMap_', env2.ss.getSheetByName('Prospects')), 2, { 'First Name': 'Hacked' }),
    'not a script-writable column', 'PROSPECT_WRITABLE still refuses a human-owned column');

  // Fingerprint: stable under case/whitespace, changes on membership.
  const fp = (rows, mode) => env2.call('planFingerprint_', 1, mode || 'TEST',
    { invalid: [] }, rows);
  eq(fp([{ rowNum: 2, email: 'Ann@Example.com ' }]), fp([{ rowNum: 2, email: 'ann@example.com' }]),
    'fingerprint ignores address case and whitespace');
  ok(fp([{ rowNum: 2, email: 'a@x.com' }]) !== fp([{ rowNum: 3, email: 'a@x.com' }]),
    'fingerprint changes when the row number changes');
  ok(fp([{ rowNum: 2, email: 'a@x.com' }], 'TEST') !== fp([{ rowNum: 2, email: 'a@x.com' }], 'LIVE'),
    'fingerprint changes when the mode changes');

  // David's profile still maps exactly the eight Addendum columns.
  const denv = makeEnv(); denv.loadContainer('david/00 config.js');
  const dmap = denv.run('IMPORT_PROFILE.columnMap');
  eq(dmap, [['First Name', 'First Name'], ['Last Name', 'Last Name'], ['Company', 'Company'],
            ['Job Title', 'Job Title'], ['Town/Area', 'Town/Area'], ['Email', 'Email'],
            ['Phone', 'Phone'], ['Insta', 'Instagram']],
     "David's import map is unchanged from the single-sheet build");
  ok(!denv.run('IMPORT_PROFILE.pauseOnNonBlank'), "David's profile declares no pause rule");

  // -------------------------------------------------------------------------
  // KNOWN PRE-EXISTING DEFECT, carried over deliberately unfixed.
  //
  // 10_Sidebar.gs calls clearCompletedQueueRowsCore_(), which has never been
  // defined — not in this library, and not in David's original single-sheet
  // build on `main`. The Send Panel's "Clear Completed" button therefore
  // throws a ReferenceError, and does so in David's LIVE sheet today. The
  // menu path (Outreach > Clear Completed Queue Rows) is unaffected: it calls
  // clearCompletedQueueRows(), which exists and works.
  //
  // This is the same shape as the maxProspectIdNumber_ bug the Dev Log
  // describes for the importer: a function called by name with no
  // implementation behind it.
  //
  // It is NOT fixed here, because this session's job was to move code without
  // changing behaviour, and fixing it would change behaviour. The assertion
  // below pins the current reality so the defect cannot be quietly forgotten —
  // when it IS fixed, this assertion fails, which is the reminder to delete it.
  // -------------------------------------------------------------------------
  const libSrc = fs.readFileSync(path.join(ROOT, 'library', '10 sidebar.js'), 'utf8');
  ok(/clearCompletedQueueRowsCore_\s*\(/.test(libSrc),
     'KNOWN DEFECT: sidebar still calls the undefined clearCompletedQueueRowsCore_()');
  const allLib = fs.readdirSync(path.join(ROOT, 'library')).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(ROOT, 'library', f), 'utf8')).join('\n');
  ok(!/function\s+clearCompletedQueueRowsCore_/.test(allLib),
     'KNOWN DEFECT: ...and it is defined nowhere — Send Panel "Clear Completed" throws');
  ok(/function\s+clearCompletedQueueRows\s*\(/.test(allLib),
     'the MENU path clearCompletedQueueRows() does exist and is unaffected');
}

// ===========================================================================
S('C. Engine lock (step 3)');
// ===========================================================================
{
  // A BDM has edited both locked cells to something they prefer.
  const env = fresh({ engine: { MAX_SENDS_PER_RUN: 9999, MIN_DAYS_BETWEEN_EMAILS: 0,
                                SENDER_NAME: 'Muki B', TEST_EMAIL: 'muki@example.com' } });
  const cfg = env.call('readEngine_');
  eq(cfg.MAX_SENDS_PER_RUN, 200, 'MAX_SENDS_PER_RUN is the library value, not the sheet\'s 9999');
  eq(cfg.MIN_DAYS_BETWEEN_EMAILS, 4, 'MIN_DAYS_BETWEEN_EMAILS is the library value, not the sheet\'s 0');
  eq(env.call('engineMaxSends_', cfg), 200, 'engineMaxSends_ returns the locked value');
  eq(env.call('engineMinDaysBetween_', cfg), 4, 'engineMinDaysBetween_ returns the locked value');

  eq(cfg.SENDER_NAME, 'Muki B', 'SENDER_NAME stays BDM-editable');
  eq(cfg.TEST_EMAIL, 'muki@example.com', 'TEST_EMAIL stays BDM-editable');
  ok(String(cfg.SIGNATURE_BLOCK).includes('United Mortgages'), 'SIGNATURE_BLOCK stays BDM-editable');

  const v = env.call('engineLockViolations_');
  eq(v.map(x => x.key).sort(), ['MAX_SENDS_PER_RUN', 'MIN_DAYS_BETWEEN_EMAILS'],
     'both ignored edits are reported, not silently swallowed');
  eq(v.find(x => x.key === 'MAX_SENDS_PER_RUN').sheetValue, '9999',
     'the violation names what the sheet actually says');

  // Deleting the row entirely must not defeat the lock.
  const env2 = fresh({ dropEngineKeys: ['MAX_SENDS_PER_RUN'] });
  eq(env2.call('readEngine_').MAX_SENDS_PER_RUN, 200,
     'lock holds even when the BDM deletes the Engine row');
  eq(env2.call('engineLockViolations_').length, 0,
     'a deleted row is not reported as an edited row');

  const clean = fresh({});
  eq(clean.call('engineLockViolations_'), [], 'an untouched sheet reports no violations');
  eq(clean.run('ENGINE_LOCKED_KEYS'), ['MAX_SENDS_PER_RUN', 'MIN_DAYS_BETWEEN_EMAILS'],
     'the locked set is exactly the two operator-owned keys');
  ['SENDER_NAME', 'TEST_EMAIL', 'SIGNATURE_BLOCK', 'MODE', 'REPLY_TO'].forEach(k => {
    ok(clean.call('isEngineKeyLocked_', k) === false, k + ' is not locked');
  });
}

// ===========================================================================
S('D. Test-mode CC (step 4)');
// ===========================================================================
{
  function sendEnv(mode, cc) {
    const env = fresh({
      engine: { MODE: mode },
      prospects: [{ 'Prospect ID': 'P-00001', 'First Name': 'Ann', Email: 'ann@example.com', Company: 'A Ltd' }],
      queue: [{ 'Prospect ID': 'P-00001', 'Send?': 'Y', Email: 'ann@example.com',
                'First Name': 'Ann', Company: 'A Ltd' }]
    });
    if (cc !== undefined) env.run('OPERATOR_CC = ' + JSON.stringify(cc));
    return env;
  }
  const CC = 'operator@example.com';

  const t = sendEnv('TEST', CC);
  eq(t.call('operatorCcFor_', 'TEST'), CC, 'operatorCcFor_(TEST) returns the configured address');
  eq(t.call('operatorCcFor_', 'LIVE'), '', 'operatorCcFor_(LIVE) returns empty, always');

  const idxT = t.call('buildProspectIndex_');
  const resT = t.call('evaluateQueue_', 1, t.call('activeTemplate_', 1), idxT);
  t.call('sendBatch_', resT.eligible, 1, 'TEST');
  eq(t.sent.length, 1, 'TEST run sends exactly one message');
  eq(t.sent[0].options.cc, CC, 'TEST send carries the operator CC');
  eq(t.sent[0].to, 'tester@example.com', 'TEST send goes to TEST_EMAIL, not the prospect');

  const l = sendEnv('LIVE', CC);
  const idxL = l.call('buildProspectIndex_');
  const resL = l.call('evaluateQueue_', 1, l.call('activeTemplate_', 1), idxL);
  l.call('sendBatch_', resL.eligible, 1, 'LIVE');
  eq(l.sent.length, 1, 'LIVE run sends exactly one message');
  ok(!('cc' in l.sent[0].options), 'LIVE send options object has NO cc key at all',
     'options were ' + JSON.stringify(Object.keys(l.sent[0].options)));
  eq(l.sent[0].to, 'ann@example.com', 'LIVE send goes to the real prospect');

  // Fresh env: the send above consumed the queue row, and a consumed queue
  // yields a `blocked` plan with no ccRecipient on it at all.
  const lp = sendEnv('LIVE', CC).call('buildSendPlan_', 1);
  eq(lp.blocked, false, 'LIVE plan builds against an unconsumed queue');
  eq(lp.ccRecipient, '', 'LIVE plan exposes no CC to the preview');

  const t2 = sendEnv('TEST', CC);
  eq(t2.call('buildSendPlan_', 1).ccRecipient, CC, 'TEST plan exposes the CC to the preview');

  // Shipped default is blank, and blank must be a clean no-op.
  const blank = sendEnv('TEST');
  eq(blank.run('OPERATOR_CC'), '', 'OPERATOR_CC ships blank');
  const idxB = blank.call('buildProspectIndex_');
  const resB = blank.call('evaluateQueue_', 1, blank.call('activeTemplate_', 1), idxB);
  blank.call('sendBatch_', resB.eligible, 1, 'TEST');
  ok(!('cc' in blank.sent[0].options), 'a blank OPERATOR_CC sets no cc key');

  // The queue Notes record the CC so the sheet shows it too.
  const t3 = sendEnv('TEST', CC);
  const idx3 = t3.call('buildProspectIndex_');
  const res3 = t3.call('evaluateQueue_', 1, t3.call('activeTemplate_', 1), idx3);
  t3.call('sendBatch_', res3.eligible, 1, 'TEST');
  const qrow = readBack(t3, 'Send Queue')[0];
  ok(String(qrow['Notes']).includes('cc ' + CC), 'the CC is recorded in the queue row Notes');
  eq(qrow['Status'], 'TEST-SENT', 'TEST send writes TEST-SENT, which never blocks a live send');
}

// Sections E-G live in run_import.js so each file stays readable. The
// assertion helpers are passed in and close over this file's counters, so the
// totals below cover every section.
require('./run_import.js')({ ok, eq, throws, S, fresh, makeEnv, readBack, grid,
                             readSheet, ROOT, SAMPLE, fs, path });

console.log('\n' + '═'.repeat(64));
console.log(fail === 0 ? `ALL ${pass} ASSERTIONS PASSED` : `${pass} passed, ${fail} FAILED`);
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  • ' + f)); }
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
