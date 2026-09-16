'use strict';
/**
 * Sections E-G: Muki's importer, her container, and the fleet's manifests.
 * Driven by run.js, which owns the counters.
 */
module.exports = function (T) {
  const { ok, eq, throws, S, fresh, makeEnv, readBack, grid, readSheet, ROOT, SAMPLE, fs, path } = T;

  /** The sample's real contents, read straight from the .xlsx every run. */
  const SAMPLE_GRID = readSheet(SAMPLE, 'Muki Template');
  const SAMPLE_HEADERS = SAMPLE_GRID[0];
  /** The column Town/Area maps from. Long, and that is the point — see muki/00_Config.gs. */
  const LOC = 'Location [CHECK whether it is real Office or NO via PHONE]';

  function mukiEnv(opts) {
    opts = opts || {};
    const env = fresh(opts);
    env.loadContainer('muki/00 config.js');
    env.addSheet(opts.sheetName || 'Muki Template', opts.sourceGrid || SAMPLE_GRID);
    return env;
  }
  function doImport(env, sheetName) {
    const src = env.ss.getSheetByName(sheetName || 'Muki Template');
    return env.call('runImport_', src, env.run('IMPORT_PROFILE'));
  }

  // =========================================================================
  S('E1. Header verification against the real sample file');
  // =========================================================================
  {
    eq(SAMPLE_HEADERS.length, 24, 'sample carries 24 header columns');

    // The mapping table in the brief named two columns that do not exist.
    ok(!SAMPLE_HEADERS.includes('Address'),
       'the brief\'s "Address" column does NOT exist in the sample — not mapped');
    ok(!SAMPLE_HEADERS.includes('Postcode'),
       'the brief\'s "Postcode" column does NOT exist in the sample either');
    ok(SAMPLE_HEADERS.includes(LOC),
       'the column standing in for "Address" is present, verbatim, instruction and all');
    ok(SAMPLE_HEADERS.includes('Location'),
       'the OTHER Location column also exists — which is why prefix matching is unsafe');
    ok(SAMPLE_HEADERS.filter(h => h.indexOf('Location') === 0).length === 2,
       'two headers begin with "Location": an exact match is the only safe match');

    const env = mukiEnv();
    const profile = env.run('IMPORT_PROFILE');
    const needed = env.call('profileRequiredHeaders_', profile);
    const absent = needed.filter(h => !SAMPLE_HEADERS.includes(h));
    eq(absent, [], 'every header the profile depends on exists in the sample, verbatim');

    // Mapped source names, exactly as the brief listed them minus Address.
    eq(profile.columnMap.map(m => m[0]),
       ['Name', 'Name (last)', 'Agency', 'Title', LOC, 'Company Phone', 'Email',
        'LinkedIn (Decision maker)', 'Insta Link (Decision maker)', 'Website'],
       'the ten verified source headers are mapped');
    eq(profile.columnMap.map(m => m[1]),
       ['First Name', 'Last Name', 'Company', 'Job Title', 'Town/Area', 'Phone', 'Email',
        'LinkedIn URL', 'Instagram', 'Website'],
       'each maps to the Prospects field the brief specified');
    const townSrc = profile.columnMap.filter(m => m[1] === 'Town/Area').map(m => m[0]);
    eq(townSrc, [LOC],
       'Town/Area comes from the column that actually carries area names');
    ok(!profile.columnMap.some(m => m[0] === 'Location'),
       'the empty "Location" column is NOT the one mapped');
    ok(!profile.columnMap.some(m => m[0] === 'Tube station'),
       '"Tube station" is not mapped — it holds postcodes, not stations');

    eq(profile.pauseOnNonBlank,
       ['Emailed', '1st Called', 'Visit', 'Meeting', 'Offered', 'Signed as partner'],
       'the six exclusion columns are exactly those specified');
  }

  // =========================================================================
  S('E2. Header-verification refusal');
  // =========================================================================
  {
    // A mapped column renamed to a plausible near-miss.
    const renamed = SAMPLE_GRID.map(r => r.slice());
    renamed[0][9] = 'E-mail';
    const env = mukiEnv({ sourceGrid: renamed });
    throws(() => doImport(env), 'does not match the Muki Template layout',
           'a renamed mapped column is refused, not silently substituted');
    throws(() => doImport(env), /Missing column header\(s\)[\s\S]*Email/,
           'the refusal names the missing header exactly');
    throws(() => doImport(env), 'E-mail',
           'the refusal also lists what the tab actually has, so the near-miss is visible');
    eq(readBack(env, 'Prospects').length, 0, 'nothing was written before the refusal');

    // A column the PAUSE RULE depends on is just as load-bearing.
    const renamed2 = SAMPLE_GRID.map(r => r.slice());
    renamed2[0][13] = 'Emailed?';
    const env2 = mukiEnv({ sourceGrid: renamed2 });
    throws(() => doImport(env2), /Missing column header\(s\)[\s\S]*Emailed/,
           'a renamed EXCLUSION column is refused too — the pause rule cannot silently no-op');
    eq(readBack(env2, 'Prospects').length, 0, 'still nothing written');

    // The Town/Area source is a mapped column now, so a rewording of that
    // instruction-carrying header must refuse rather than silently import blanks.
    // This is the safety net that makes betting on an unstable header sane.
    const renamed3 = SAMPLE_GRID.map(r => r.slice());
    renamed3[0][SAMPLE_HEADERS.indexOf(LOC)] = 'Location [CHECK via PHONE]';
    const envR3 = mukiEnv({ sourceGrid: renamed3 });
    throws(() => doImport(envR3), 'does not match the Muki Template layout',
           'rewording the long Location header refuses, it does not import blanks');
    throws(() => doImport(envR3), 'Location [CHECK via PHONE]',
           'the refusal shows the reworded header so the change is obvious');
    eq(readBack(envR3, 'Prospects').length, 0, 'nothing written on the reworded-header refusal');

    // Removing a dropped column is harmless — it is not depended on.
    const noType = SAMPLE_GRID.map(r => r.filter((_, i) => i !== 1));
    const env3 = mukiEnv({ sourceGrid: noType });
    const r3 = doImport(env3);
    ok(r3.imported > 0, 'removing a deliberately-dropped column (Type) does not refuse');
  }

  // =========================================================================
  S('E3. Column mapping against the sample');
  // =========================================================================
  {
    const env = mukiEnv();
    doImport(env);
    const rows = readBack(env, 'Prospects');
    const dana = rows.find(r => r['Email'] === 'dana.wells@example.com');
    ok(!!dana, 'Dana Wells imported');
    eq(dana['First Name'], 'Dana', 'Name -> First Name');
    eq(dana['Last Name'], 'Wells', 'Name (last) -> Last Name');
    eq(dana['Company'], 'Northgate Partners (Network)', 'Agency -> Company');
    eq(dana['Job Title'], 'Director & Owner', 'Title -> Job Title');
    eq(dana['Phone'], '020 7000 0022', 'Company Phone -> Phone');
    eq(dana['LinkedIn URL'], 'https://www.linkedin.com/in/dana-wells-example/',
       'LinkedIn (Decision maker) -> LinkedIn URL');
    eq(dana['Instagram'], 'https://www.instagram.com/danawells_example/',
       'Insta Link (Decision maker) -> Instagram');
    eq(dana['Website'], '', 'Website maps (blank on this row, not dropped)');
    eq(dana['Town/Area'], '', 'Town/Area is blank here because the SOURCE cell is blank');

    // The mapping must actually carry a value when the source cell has one.
    // No sample row has both an area AND a contact, so this needs a fixture
    // built from the real header row.
    const withTown = [SAMPLE_HEADERS.slice(), (() => {
      const r = new Array(24).fill('');
      r[0] = 'Vine Street Estates'; r[5] = 'Tess'; r[6] = 'Aldridge';
      r[7] = 'Director'; r[9] = 'tess.aldridge@example.com';
      r[SAMPLE_HEADERS.indexOf(LOC)] = 'Nine Elms';
      r[SAMPLE_HEADERS.indexOf('Location')] = 'SHOULD NOT BE IMPORTED';
      r[SAMPLE_HEADERS.indexOf('Tube station')] = 'SW8 3HE';
      return r;
    })()];
    const envT = mukiEnv({ sourceGrid: withTown });
    doImport(envT);
    const tess = readBack(envT, 'Prospects')[0];
    eq(tess['Town/Area'], 'Nine Elms', 'a populated source cell DOES reach Town/Area');
    const tessAll = JSON.stringify(tess);
    ok(!tessAll.includes('SHOULD NOT BE IMPORTED'),
       'the other "Location" column is not imported into anything');
    ok(!tessAll.includes('SW8 3HE'), 'the postcode in "Tube station" is not imported');

    // Dropped columns must not leak in anywhere.
    const all = JSON.stringify(rows);
    ok(!all.includes('Independent/Network'), 'Type is not imported into any field');
    ok(!all.includes('northgatepartners_example'), 'Insta Link (Company) is not imported');
    ok(!all.includes('SW8 3HE'), 'Tube station is not imported');

    // Source-system state must never become this tool's outreach state.
    rows.forEach(r => {
      ['Email 1 Status', 'Email 2 Status', 'Email 3 Status', 'Last Contacted', 'Thread ID']
        .forEach(f => { if (r[f] !== '') ok(false, 'no source state leaks into ' + f); });
    });
    ok(true, 'no source outreach history leaks into Email {n} Status / Thread ID');

    eq(rows.map(r => r['Prospect ID']), ['P-00001', 'P-00002', 'P-00003', 'P-00004', 'P-00005'],
       'IDs are assigned in sequence from the high-water mark');
    ok(rows.every(r => String(r['Source']).startsWith('Muki Template import — ')),
       'Source records which profile imported the row');
  }

  // =========================================================================
  S('E4. Paused-routing exclusion rule');
  // =========================================================================
  {
    const env = mukiEnv();
    const res = doImport(env);
    const rows = readBack(env, 'Prospects');

    // Every contact-bearing row in the sample carries prior outreach.
    eq(res.imported, 5, 'five rows import from the sample');
    eq(res.paused, 5, 'all five carry prior outreach, so all five are Paused');
    eq(res.active, 0, 'none import active — every sample contact has been touched');
    ok(rows.every(r => r['Paused'] === 'Y'), 'Paused = Y is set on every touched row');

    const dana = rows.find(r => r['Email'] === 'dana.wells@example.com');
    ok(/Emailed: Aug 22/.test(dana['Notes']), 'raw Emailed text is copied into Notes verbatim');
    ok(/Signed as partner: Unit 4, Example Yard, London, SW9 0FN/.test(dana['Notes']),
       'every triggering column contributes its raw text, verbatim');
    ok(/Paused/.test(dana['Notes']), 'Notes explains why the row is paused');

    const ryan = rows.find(r => r['Email'] === 'ryan.osei@example.com');
    ok(/Emailed: Aug 24/.test(ryan['Notes']) && /1st Called: Sep 1/.test(ryan['Notes']) &&
       /Visit: Sep 4/.test(ryan['Notes']) && /Meeting: Sep 6/.test(ryan['Notes']) &&
       /Offered: Y/.test(ryan['Notes']),
       'a row touched on five channels lists all five in Notes');

    // Columns NOT in the exclusion list must not trigger a pause on their own.
    const onlyUnlisted = [SAMPLE_HEADERS.slice(), (() => {
      const r = new Array(24).fill('');
      r[0] = 'Unlisted Channel Co'; r[5] = 'Zara'; r[6] = 'Quinn';
      r[7] = 'Director'; r[9] = 'zara.quinn@example.com';
      r[14] = 'Sep 9';   // LinkedIn Invite   — not in the six
      r[16] = 'Sep 9';   // Instagram DM (company) — not in the six
      r[18] = 'Sep 9';   // 2nd               — not in the six
      return r;
    })()];
    const env2 = mukiEnv({ sourceGrid: onlyUnlisted });
    const res2 = doImport(env2);
    eq(res2.imported, 1, 'the unlisted-channel row imports');
    eq(res2.paused, 0, 'a row touched ONLY on unlisted channels is not paused');
    eq(res2.active, 1, 'it imports active');
    eq(readBack(env2, 'Prospects')[0]['Paused'], '', 'Paused is left blank on an untouched row');
    eq(readBack(env2, 'Prospects')[0]['Notes'], '', 'Notes is left blank on an untouched row');

    // The active path, with a row carrying no outreach at all.
    const cleanRow = [SAMPLE_HEADERS.slice(), (() => {
      const r = new Array(24).fill('');
      r[0] = 'Fresh Lead Estates'; r[5] = 'Owen'; r[6] = 'Pike';
      r[7] = 'Director'; r[8] = '020 7000 0999'; r[9] = 'owen.pike@example.com';
      return r;
    })()];
    const env3 = mukiEnv({ sourceGrid: cleanRow });
    const res3 = doImport(env3);
    eq([res3.imported, res3.active, res3.paused], [1, 1, 0],
       'a row with no outreach history imports ACTIVE');

    // Each of the six, on its own, must pause.
    ['Emailed', '1st Called', 'Visit', 'Meeting', 'Offered', 'Signed as partner'].forEach(h => {
      const ci = SAMPLE_HEADERS.indexOf(h);
      const g = [SAMPLE_HEADERS.slice(), (() => {
        const r = new Array(24).fill('');
        r[0] = 'Solo Co'; r[5] = 'Sam'; r[9] = 'sam@example.com'; r[ci] = 'x';
        return r;
      })()];
      const e = mukiEnv({ sourceGrid: g });
      const rr = doImport(e);
      ok(rr.paused === 1 && readBack(e, 'Prospects')[0]['Paused'] === 'Y',
         '"' + h + '" alone routes the row to Paused');
    });

    // A paused import must actually be unsendable, not merely labelled.
    const idx = env.call('buildProspectIndex_');
    const qsh = env.ss.getSheetByName('Send Queue');
    qsh.getRange(2, 1, 1, qsh.getLastColumn()).setValues([(() => {
      const hdr = qsh.getRange(1, 1, 1, qsh.getLastColumn()).getValues()[0];
      const row = new Array(hdr.length).fill('');
      const put = (h, v) => { row[hdr.indexOf(h)] = v; };
      put('Prospect ID', dana['Prospect ID']); put('Send?', 'Y');
      put('Email', 'dana.wells@example.com'); put('First Name', 'Dana'); put('Company', 'N');
      return row;
    })()]);
    const idx2 = env.call('buildProspectIndex_');
    const ev = env.call('evaluateQueue_', 1,
      { name: 'T', subject: 'x {{Company}}', body: 'Hi {{FirstName}}' }, idx2);
    eq(ev.eligible.length, 0, 'a paused imported row cannot be sent to, even when staged');
    ok(/Paused/.test(ev.invalid[0].reason), 'it is refused specifically for being Paused');
  }

  // =========================================================================
  S('E5. Shared validation checks (reused from David, unchanged)');
  // =========================================================================
  {
    const H = SAMPLE_HEADERS.slice();
    const mk = o => {
      const r = new Array(24).fill('');
      Object.keys(o).forEach(k => { r[H.indexOf(k)] = o[k]; });
      return r;
    };

    // Required fields: First Name + Email.
    const env = mukiEnv({ sourceGrid: [H,
      mk({ 'Agency': 'NoName Ltd', 'Name (last)': 'Onlylast', 'Email': 'nofirst@example.com' }),
      mk({ 'Agency': 'NoEmail Ltd', 'Name': 'Nomail', 'Name (last)': 'Person' }),
      mk({ 'Agency': 'Good Ltd', 'Name': 'Real', 'Email': 'real@example.com' })
    ] });
    const res = doImport(env);
    eq(res.imported, 1, 'only the row with both required fields imports');
    ok(res.skipped.some(s => /missing required First Name/.test(s)),
       'a missing First Name is named specifically');
    ok(res.skipped.some(s => /missing required Email/.test(s)),
       'a missing Email is named specifically');

    // Malformed email.
    const env2 = mukiEnv({ sourceGrid: [H,
      mk({ 'Agency': 'Bad Ltd', 'Name': 'Baddy', 'Email': 'baddy@example' }),
      mk({ 'Agency': 'Sp Ltd', 'Name': 'Spacey', 'Email': 'has space@example.com' })
    ] });
    const res2 = doImport(env2);
    eq(res2.imported, 0, 'malformed addresses do not import');
    eq(res2.skipped.length, 2, 'both malformed rows are reported');
    ok(res2.skipped.every(s => /malformed email address/.test(s)),
       'malformed email is its own distinct reason');

    // Within-source duplicate, reported against the source row.
    const env3 = mukiEnv({ sourceGrid: [H,
      mk({ 'Agency': 'A', 'Name': 'First', 'Email': 'dup@example.com' }),
      mk({ 'Agency': 'B', 'Name': 'Second', 'Email': 'DUP@Example.COM' })
    ] });
    const res3 = doImport(env3);
    eq(res3.imported, 1, 'only the first of two identical addresses imports');
    ok(/duplicate of source row 2/.test(res3.skipped[0]),
       'the duplicate is reported against the source row it collides with, case-insensitively');

    // Already on Prospects.
    const env4 = mukiEnv({
      prospects: [{ 'Prospect ID': 'P-00042', 'First Name': 'Ann', 'Email': 'ann@example.com' }],
      sourceGrid: [H, mk({ 'Agency': 'A', 'Name': 'Ann', 'Email': 'ann@example.com' })]
    });
    const res4 = doImport(env4);
    eq(res4.imported, 0, 'an address already on Prospects does not import again');
    ok(/already on Prospects as P-00042/.test(res4.skipped[0]),
       'the existing Prospect ID is named');

    // Re-running the same import is a no-op.
    const env5 = mukiEnv();
    const first = doImport(env5);
    const second = doImport(env5);
    eq(first.imported, 5, 'first run imports five');
    eq(second.imported, 0, 're-running the same import imports nothing');
    eq(second.skipped.length, 5, 'and reports all five as already present');

    // Filler rows: counted, never itemised.
    const filler = [H];
    for (let i = 0; i < 40; i++) filler.push(mk({ 'Agency': 'Residue Ltd' }));
    filler.push(mk({ 'Agency': 'Real Ltd', 'Name': 'Rene', 'Email': 'rene@example.com' }));
    const env6 = mukiEnv({ sourceGrid: filler });
    const res6 = doImport(env6);
    eq(res6.filler, 40, 'agency-only rows are counted as filler');
    eq(res6.skipped.length, 0, 'filler rows are never itemised as skips');
    eq(res6.imported, 1, 'the one real row still imports');

    // The 25-item report cap.
    const many = [H];
    for (let i = 0; i < 30; i++) many.push(mk({ 'Agency': 'X', 'Name': 'N' + i, 'Email': 'bad' + i + '@x' }));
    const env7 = mukiEnv({ sourceGrid: many });
    const res7 = doImport(env7);
    eq(res7.skipped.length, 30, 'all 30 skips are counted');
    ok(/…and 5 more/.test(res7.body), 'the report itemises 25 and summarises the rest');
  }

  // =========================================================================
  S('F. Profile validation and Muki\'s container');
  // =========================================================================
  {
    const env = mukiEnv();
    throws(() => env.call('validateImportProfile_', { label: 'X', columnMap: [['A', 'Nonsense']] }),
           'not a Prospects column', 'a profile mapping to a non-existent field is rejected');
    throws(() => env.call('validateImportProfile_',
           { label: 'X', columnMap: [['A', 'Email'], ['B', 'Email']] }),
           'maps two source columns', 'a profile filling one field twice is rejected');
    throws(() => env.call('validateImportProfile_', { label: 'X', columnMap: [] }),
           'empty columnMap', 'an empty profile is rejected');
    ok(!!env.call('validateImportProfile_', env.run('IMPORT_PROFILE')),
       "Muki's shipped profile passes validation");

    const denv = makeEnv(); denv.loadContainer('david/00 config.js');
    ok(!!denv.call('validateImportProfile_', denv.run('IMPORT_PROFILE')),
       "David's shipped profile passes validation");

    // The test sheet exists to rehearse Muki's import. If its profile drifts
    // from hers it stops testing anything she will actually run.
    const tenv = makeEnv(); tenv.loadContainer('test/00 config.js');
    eq(tenv.run('IMPORT_PROFILE.columnMap'), env.run('IMPORT_PROFILE.columnMap'),
       "the test sheet's column map is identical to Muki's");
    eq(tenv.run('IMPORT_PROFILE.pauseOnNonBlank'), env.run('IMPORT_PROFILE.pauseOnNonBlank'),
       "the test sheet's exclusion rule is identical to Muki's");

    // Seed data: usable in TEST mode on install, with no real list involved.
    const m = makeEnv(); m.loadContainer('muki/01 seeddata.js');
    const seed = m.run('PROSPECT_SEED');
    const tseed = m.run('TEMPLATE_SEED');
    eq(seed.length, 15, 'Muki ships 15 dummy prospects');
    ok(seed.every(p => !p.email || /@example\.com$|@example$/.test(p.email)),
       'every seed address is on example.com (RFC 2606) and cannot reach anyone');
    eq(tseed.length, 3, 'Muki ships three draft templates');

    const usesTown = tseed.some(t => /\{\{\s*TownArea\s*\}\}/.test(t.subject + t.body));
    ok(!usesTown, "Muki's seed templates do not use {{TownArea}} — her data cannot fill it");
    const dv = makeEnv(); dv.loadContainer('david/01 seeddata.js');
    ok(dv.run('TEMPLATE_SEED').some(t => /\{\{\s*TownArea\s*\}\}/.test(t.subject + t.body)),
       "David's templates still use {{TownArea}} — his import maps it");

    // Every placeholder Muki's copy uses must resolve on her own seed rows.
    const env2 = fresh({});
    tseed.forEach(t => {
      const unknown = env2.call('unknownPlaceholders_', { subject: t.subject, body: t.body });
      eq(unknown, [], 'stage ' + t.stage + ' template uses only known placeholders');
    });
    const good = seed.find(p => p.first && p.email && p.company && p.title);
    tseed.forEach(t => {
      const missing = env2.call('missingPlaceholderValues_', { subject: t.subject, body: t.body },
        { 'First Name': good.first, 'Company': good.company, 'Job Title': good.title, 'Town/Area': '' });
      eq(missing, [], 'stage ' + t.stage + ' renders from a seed row with Town/Area BLANK');
    });

    // The five seeded edge cases are all present.
    ok(seed.some(p => !p.first), 'seed includes a missing-First-Name edge case');
    ok(seed.some(p => p.email && !/\.[a-z]{2,}$/.test(p.email)), 'seed includes a malformed email');
    const emails = seed.map(p => (p.email || '').toLowerCase());
    ok(emails.some((e, i) => e && emails.indexOf(e) !== i), 'seed includes a duplicate address');
    ok(seed.some(p => p.dnc), 'seed includes a Do Not Contact row');
    ok(seed.some(p => p.paused), 'seed includes a Paused row (the importer\'s routing outcome)');

    // No hardcoded column indices anywhere in a container.
    ['david', 'muki', 'test'].forEach(d => {
      fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js')).forEach(f => {
        const src = fs.readFileSync(path.join(ROOT, d, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        ok(!/getRange\(/.test(src) && !/\[\s*\d+\s*\]\s*=/.test(src),
           d + '/' + f + ' contains no direct range or index access');
      });
    });
  }

  // =========================================================================
  S('G. Fleet wiring — manifests and versioning');
  // =========================================================================
  {
    const LIB_ID = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', '.clasp.json'), 'utf8')).scriptId;
    const read = d => JSON.parse(fs.readFileSync(path.join(ROOT, d, 'appsscript.json'), 'utf8'));

    ['david', 'muki', 'test'].forEach(d => {
      const m = read(d);
      const libs = (m.dependencies || {}).libraries || [];
      eq(libs.length, 1, d + ' depends on exactly one library');
      eq(libs[0].userSymbol, 'Vale', d + ' binds the library as "Vale"');
      eq(libs[0].libraryId, LIB_ID, d + ' points at the library\'s real scriptId');
      eq(m.timeZone, 'Europe/London', d + ' is on Europe/London');
    });

    eq(read('david').dependencies.libraries[0].developmentMode, false,
       'David is PINNED to an explicit version, not head');
    eq(read('muki').dependencies.libraries[0].developmentMode, false,
       'Muki is PINNED to an explicit version, not head');
    eq(read('test').dependencies.libraries[0].developmentMode, true,
       'the test sheet tracks HEAD — the whole point of the fourth spreadsheet');

    const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', 'appsscript.json'), 'utf8'));
    eq(lib.timeZone, 'Europe/London', 'the library itself is on Europe/London, not America/New_York');
    eq(lib.oauthScopes.sort(), read('david').oauthScopes.sort(),
       'library and container declare the same scopes');

    // /mike is out of scope and must stay untouched.
    const mikeFiles = fs.readdirSync(path.join(ROOT, 'mike')).sort();
    eq(mikeFiles, ['.clasp.json', 'appsscript.json'], '/mike is untouched — no files added or removed');
  }
};
