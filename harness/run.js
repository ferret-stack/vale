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
const { decodeRfc2047_ } = require('./gas.js');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'docs', 'Muki_Template_SAMPLE.xlsx');

/**
 * PRE-EXISTING BUG, fixed here as a prerequisite to running this suite at
 * all — unrelated to the astral-emoji/raw-MIME work this session actually
 * came to do. Section A's "byte-identical to David's original" checks used
 * to read `git show main:"david/<file>"`. That was correct ONLY while `main`
 * still pointed at the pre-extraction commit; the same PR that added this
 * harness also extracted david/00_Schema.gs etc. into library/, deleting the
 * david/ copies, and merging that PR into main moved the floating `main` ref
 * past its own extraction commit. From that moment on, `main:"david/<file>"`
 * stopped resolving — a self-invalidating check that happened to still look
 * green right up until the PR that wrote it was merged. Confirmed the fix is
 * the originally-intended comparison, not a new one: library/<file> at HEAD
 * is byte-identical to david/<file> at this pinned commit for all five files
 * below, exactly as the Dev Log's 2026-09-16 entry describes.
 */
const PRE_EXTRACTION_SHA = '79869a0';

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
  const identical = ['00 schema.js', '06 render.js', '07 validation.js',
                     '09 writeback.js'];
  identical.forEach(f => {
    let orig;
    try {
      orig = cp.execSync('git show ' + PRE_EXTRACTION_SHA + ':"david/' + f + '"', { cwd: ROOT, maxBuffer: 1 << 24 });
    } catch (e) { return ok(false, f + ' byte-identical to David\'s original', 'git show failed'); }
    const now = fs.readFileSync(path.join(libDir, f));
    ok(Buffer.compare(orig, now) === 0, f + ' byte-identical to David\'s original');
  });

  // 05 staging.js is the one shared file this session deliberately changed, to
  // write the clear-completed core that 10_Sidebar.gs had always called and
  // nobody had ever defined. The clear-completed block is the last thing in the
  // file, so everything ABOVE it must still be byte-identical to main — that is
  // what keeps the staging/queue logic covered by the same regression evidence
  // as the other four files.
  {
    const mainStaging = cp.execSync('git show ' + PRE_EXTRACTION_SHA + ':"david/05 staging.js"',
      { cwd: ROOT, maxBuffer: 1 << 24 }).toString('utf8');
    const nowStaging = fs.readFileSync(path.join(libDir, '05 staging.js'), 'utf8');
    const mainCut = mainStaging.indexOf('/** §7 — removes every queue row');
    const nowCut = nowStaging.indexOf('/**\n * §7 core — removes every queue row');
    ok(mainCut > 0 && nowCut > 0, 'the clear-completed block is locatable in both versions');
    ok(mainStaging.slice(0, mainCut) === nowStaging.slice(0, nowCut),
       '05 staging.js is byte-identical to main ABOVE the clear-completed block');
  }

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
  // Clear Completed, both surfaces.
  //
  // 10_Sidebar.gs called clearCompletedQueueRowsCore_() from the Addendum v1
  // build onward, and it was never written — the panel's button threw
  // ReferenceError while the identically-labelled menu item worked. Verified
  // against David's live script: no drift, the defect was real and shipped.
  // The core is now written and BOTH surfaces run it.
  // -------------------------------------------------------------------------
  {
    const Q = () => [
      { 'Prospect ID': 'P-1', 'Send?': 'Y', Email: 'a@example.com', Status: 'SENT',      Stage: 1 },
      { 'Prospect ID': 'P-2', 'Send?': 'Y', Email: 'b@example.com', Status: 'TEST-SENT', Stage: 1 },
      { 'Prospect ID': 'P-3', 'Send?': 'Y', Email: 'c@example.com', Status: '' }
    ];
    const rowsLeft = e => readBack(e, 'Send Queue').map(r => r['Prospect ID']);

    // --- the sidebar path, which used to throw on every call ---
    const sYes = fresh({ queue: Q(), confirmAnswer: 'YES' });
    let sRes;
    let threw = false;
    try { sRes = sYes.call('sidebarClearCompleted'); } catch (e) { threw = true; }
    ok(!threw, 'the Send Panel button no longer throws ReferenceError');
    eq(sRes, { cancelled: false, cleared: 2, empty: false },
       'panel gets the shape Sidebar.html renders: {cancelled, cleared, empty}');
    eq(rowsLeft(sYes), ['P-3'], 'panel clears both completed rows and keeps the pending one');

    const sNo = fresh({ queue: Q(), confirmAnswer: 'NO' });
    eq(sNo.call('sidebarClearCompleted'), { cancelled: true, cleared: 0, empty: false },
       'declining the confirm from the panel reports cancelled');
    eq(rowsLeft(sNo), ['P-1', 'P-2', 'P-3'], 'declining from the panel deletes nothing');

    const sEmpty = fresh({ queue: [], confirmAnswer: 'YES' });
    eq(sEmpty.call('sidebarClearCompleted'), { cancelled: false, cleared: 0, empty: true },
       'an empty queue reports empty:true, not cleared:0 — the panel words them differently');

    const sNone = fresh({ confirmAnswer: 'YES', queue: [
      { 'Prospect ID': 'P-9', 'Send?': 'Y', Email: 'z@example.com', Status: '' }] });
    eq(sNone.call('sidebarClearCompleted'), { cancelled: false, cleared: 0, empty: false },
       'rows present but none completed reports cleared:0, empty:false');

    // --- the menu path, unchanged in behaviour ---
    const mYes = fresh({ queue: Q(), confirmAnswer: 'YES' });
    mYes.call('clearCompletedQueueRows');
    eq(rowsLeft(mYes), ['P-3'], 'menu still clears the completed rows');
    eq(mYes.alerts[mYes.alerts.length - 1].msg, 'Removed 2 row(s).',
       'menu still reports the count in its own words');

    const mNo = fresh({ queue: Q(), confirmAnswer: 'NO' });
    mNo.call('clearCompletedQueueRows');
    eq(rowsLeft(mNo), ['P-1', 'P-2', 'P-3'], 'declining from the menu deletes nothing');
    ok(!mNo.alerts.some(a => a.title === 'Cleared'), 'a declined menu run reports no "Cleared"');

    const mEmpty = fresh({ queue: [], confirmAnswer: 'YES' });
    mEmpty.call('clearCompletedQueueRows');
    eq(mEmpty.alerts[mEmpty.alerts.length - 1].msg, 'The Send Queue is empty.',
       'menu keeps its empty-queue wording');

    const mNone = fresh({ confirmAnswer: 'YES', queue: [
      { 'Prospect ID': 'P-9', 'Send?': 'Y', Email: 'z@example.com', Status: '' }] });
    mNone.call('clearCompletedQueueRows');
    eq(mNone.alerts[mNone.alerts.length - 1].msg, 'No queue rows have a Status yet.',
       'menu keeps its nothing-completed wording');

    // --- one implementation, not two ---
    const allLib = fs.readdirSync(path.join(ROOT, 'library')).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(ROOT, 'library', f), 'utf8')).join('\n');
    eq((allLib.match(/function\s+clearCompletedQueueRowsCore_/g) || []).length, 1,
       'the core is defined exactly once');
    ok(/function clearCompletedQueueRows\(\)\s*\{\s*var r = clearCompletedQueueRowsCore_\(\)/.test(allLib),
       'the menu path delegates to the core rather than keeping its own copy');
    ok(/clearCompletedQueueRowsCore_\(\)/.test(
         fs.readFileSync(path.join(ROOT, 'library', '10 sidebar.js'), 'utf8')),
       'the panel path calls the same core');

    // The irreversible delete stays behind a native confirm from BOTH surfaces.
    eq((allLib.match(/confirm_\('Clear completed rows\?'/g) || []).length, 1,
       'exactly one confirm, inside the core, so the panel cannot be a softer gate');
  }
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

// ===========================================================================
S('H. Raw MIME send path — astral-plane emoji (Dev Log 2026-10-01)');
// ===========================================================================
{
  // GmailApp.createDraft(...).send() cannot carry a code point at or above
  // U+10000 — confirmed with a standalone GmailApp script outside this
  // codebase, which lost the same characters with no Vale code involved.
  // sendBatch_() now calls sendRawMime_() instead, which builds a raw RFC
  // 2822 message by hand and hands it to Gmail.Users.Messages.send().
  //
  // These assertions decode what sendRawMime_() built, the same way the
  // mocked Gmail.Users.Messages.send() does (see gas.js), and prove the
  // encode/decode round-trip is correct. They CANNOT and do NOT prove real
  // Gmail renders the result — nothing in this harness calls the actual
  // Gmail API. That proof is the live owner test send described in the
  // report, which only the operator can run.
  const ASTRAL = '📅 🤝 👉 🚩 📱'; // 📅 🤝 👉 🚩 📱
  const BMP = '✅ ⭐ ❤️'; // ✅ ⭐ ❤️

  function sendOne(subject, body, sig) {
    const env = fresh({
      engine: { MODE: 'TEST', SIGNATURE_BLOCK: sig },
      prospects: [{ 'Prospect ID': 'P-00001', 'First Name': 'Ann', Email: 'ann@example.com', Company: 'A Ltd' }],
      queue: [{ 'Prospect ID': 'P-00001', 'Send?': 'Y', Email: 'ann@example.com', 'First Name': 'Ann', Company: 'A Ltd' }],
      templates: [{ Stage: 1, Name: 'T', Subject: subject, Body: body, Active: 'Y' }]
    });
    const idx = env.call('buildProspectIndex_');
    const res = env.call('evaluateQueue_', 1, env.call('activeTemplate_', 1), idx);
    env.call('sendBatch_', res.eligible, 1, 'TEST');
    return env;
  }

  // --- end to end: astral + BMP emoji survive subject, body AND signature --
  {
    const env = sendOne('Quick one ' + ASTRAL + ' about {{Company}}',
      'Hi {{FirstName}},\n\n' + BMP + ' see you soon.', '<p>Sig ' + ASTRAL + '</p>');
    const m = env.sent[0];
    ok(m.subject.indexOf(ASTRAL) !== -1, 'astral-plane emoji survive in the decoded subject', m.subject);
    ok(m.text.indexOf(BMP) !== -1, 'BMP emoji survive in the decoded plain-text body');
    ok(m.html.indexOf(ASTRAL) !== -1, 'astral-plane emoji survive in the decoded HTML signature');
    ok(!/�/.test(m.subject + m.html + m.text),
       'no Unicode replacement characters anywhere in the decoded message');
  }

  // --- direct unit tests on the header encoder ------------------------------
  // (full-pipeline subjects all carry the TEST-mode "[TEST → email] " prefix,
  // which itself contains a non-ASCII arrow; testing the encoder directly
  // keeps these cases exact and byte-boundary-precise.)

  // a pure-ASCII subject is sent as plain text, no RFC 2047 wrapper at all
  {
    const env = fresh({});
    const encoded = env.call('encodeHeaderText_', 'Quick question about A Ltd');
    eq(encoded, 'Quick question about A Ltd', 'an ASCII-only subject is not wastefully RFC 2047-encoded');
  }

  // non-ASCII, non-emoji text (accented letters, currency) round-trips exactly
  {
    const env = fresh({});
    const subject = 'Café pricing — £500 quote'; // Café pricing — £500 quote
    const encoded = env.call('encodeHeaderText_', subject);
    ok(encoded.indexOf('=?UTF-8?B?') === 0, 'non-ASCII, non-emoji text is still RFC 2047-encoded');
    eq(decodeRfc2047_(encoded), subject, 'accented letters and currency symbols round-trip exactly');
  }

  // a long non-ASCII subject folds into multiple encoded words
  {
    const env = fresh({});
    const longSubject = 'Following up ' + ASTRAL.repeat(6) + ' about your enquiry';
    const encoded = env.call('encodeHeaderText_', longSubject);
    eq(decodeRfc2047_(encoded), longSubject, 'a folded subject decodes back to the exact original');
    const wordCount = (encoded.match(/=\?UTF-8\?B\?/g) || []).length;
    ok(wordCount > 1, 'a long non-ASCII subject is split into more than one encoded word', 'words: ' + wordCount);
    ok(encoded.indexOf('\r\n ') !== -1, 'the encoded words are folded with CRLF + space, not left on one line');
    ok(encoded.split('\r\n').every(function (line) { return line.length <= 76; }),
       'no folded subject line exceeds 76 characters');
  }

  // a 45-byte chunk boundary landing right next to an emoji doesn't split it
  {
    const env = fresh({});
    const padding = 'x'.repeat(44); // one byte short of the 45-byte chunk cap
    [ASTRAL.slice(0, 2), BMP.slice(0, 1)].forEach(function (emoji, i) {
      const subject = padding + emoji + 'END' + i;
      const encoded = env.call('encodeHeaderText_', subject);
      eq(decodeRfc2047_(encoded), subject,
         'a chunk boundary adjacent to an emoji (case ' + i + ') does not corrupt it');
    });
  }

  // --- Thread ID / Message ID still wired through on a LIVE send -----------
  {
    const env = fresh({
      engine: { MODE: 'LIVE' },
      prospects: [{ 'Prospect ID': 'P-00001', 'First Name': 'Ann', Email: 'ann@example.com', Company: 'A Ltd' }],
      queue: [{ 'Prospect ID': 'P-00001', 'Send?': 'Y', Email: 'ann@example.com', 'First Name': 'Ann', Company: 'A Ltd' }]
    });
    const idx = env.call('buildProspectIndex_');
    const res = env.call('evaluateQueue_', 1, env.call('activeTemplate_', 1), idx);
    env.call('sendBatch_', res.eligible, 1, 'LIVE');
    const qrow = readBack(env, 'Send Queue')[0];
    const prow = readBack(env, 'Prospects')[0];
    ok(/^thread-/.test(qrow['Thread ID']), 'Send Queue Thread ID comes from the Gmail API response');
    ok(/^msg-/.test(qrow['Message ID']), 'Send Queue Message ID comes from the Gmail API response');
    eq(prow['Thread ID'], qrow['Thread ID'], 'Prospects Thread ID matches the Queue row on a LIVE send');
    eq(prow['Last Message ID'], qrow['Message ID'], 'Prospects Last Message ID matches the Queue row on a LIVE send');
  }

  // --- still exactly one send path -------------------------------------------
  {
    const libFiles = fs.readdirSync(path.join(ROOT, 'library')).filter(function (f) { return f.endsWith('.js'); });
    const allLib = libFiles.map(function (f) {
      return fs.readFileSync(path.join(ROOT, 'library', f), 'utf8');
    }).join('\n');
    // Comments are allowed to name GmailApp when explaining why the code moved
    // away from it (several do, per the "comment every deviation" convention)
    // — strip comments first so this checks for an actual call, not the word.
    const allLibNoComments = allLib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok(!/\bGmailApp\s*\./.test(allLibNoComments), 'no library file calls GmailApp any more');
    eq((allLib.match(/Gmail\.Users\.Messages\.send\(/g) || []).length, 1,
       'Gmail.Users.Messages.send is called from exactly one place in the library');
    const sendSrc = fs.readFileSync(path.join(ROOT, 'library', '08 send.js'), 'utf8');
    ok(sendSrc.indexOf('sendRawMime_(') !== -1 && sendSrc.indexOf('function sendRawMime_(') !== -1,
       'sendRawMime_ is defined and called from 08_Send.gs, the single send choke point file');
  }
}

console.log('\n' + '═'.repeat(64));
console.log(fail === 0 ? `ALL ${pass} ASSERTIONS PASSED` : `${pass} passed, ${fail} FAILED`);
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  • ' + f)); }
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
