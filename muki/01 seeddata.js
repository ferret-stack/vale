/**
 * 01_SeedData.gs  [CONTAINER — Muki]
 * §11 — dummy prospects + draft templates, so the sheet is testable in TEST
 * mode the moment it is installed, with no real list anywhere near it.
 *
 * Same five deliberate edge cases as David's seed, so the same checks are
 * exercised on her install:
 *   • P-00004  missing First Name   -> validation failure, never a blank merge
 *   • P-00007  malformed email      -> SKIPPED, distinct reason
 *   • P-00011  duplicate of P-00002 -> SKIPPED, distinct reason
 *   • P-00013  Do Not Contact       -> cannot be staged at all
 *   • P-00015  Paused               -> stages, but is refused at send time.
 *     New here, and not in David's seed, because Paused is now a routing
 *     OUTCOME of her importer rather than only a hand-set flag. The gate that
 *     stops a paused row sending is worth having under test on the sheet where
 *     paused rows will actually be created.
 *
 * Estate agents rather than David's mixed trades — same schema, her vertical.
 * All addresses are on example.com, reserved by RFC 2606 and unable to receive
 * mail. Nothing here can reach a real person by accident.
 */
var PROSPECT_SEED = [
  { first: 'Imogen',  last: 'Ashworth',  company: 'Ashworth & Pike',            title: 'Branch Manager',      town: 'Clapham',      email: 'imogen.ashworth@example.com', phone: '020 7946 0101' },
  { first: 'Rafael',  last: 'Mendes',    company: 'Brookvale Residential',      title: 'Director',            town: 'Balham',       email: 'r.mendes@example.com',        phone: '020 7946 0102' },
  { first: 'Saoirse', last: 'Kelly',     company: 'Kelly Property Partners',    title: 'Lettings Manager',    town: 'Battersea',    email: 'saoirse.kelly@example.com',   phone: '020 7946 0103' },
  { first: '',        last: 'Bannerman', company: 'Bannerman Estates',          title: 'Owner',               town: 'Wandsworth',   email: 'office@example.com',          phone: '020 7946 0104',
    note: 'EDGE CASE: First Name blank — must fail validation, never send "Hi ,"' },
  { first: 'Tobias',  last: 'Lindqvist', company: 'Northbank Homes',            title: 'Sales Director',      town: 'Vauxhall',     email: 't.lindqvist@example.com',     phone: '020 7946 0105' },
  { first: 'Ayesha',  last: 'Rahman',    company: 'Rahman & Co Lettings',       title: 'Managing Director',   town: 'Brixton',      email: 'ayesha@example.com',          phone: '020 7946 0106' },
  { first: 'Callum',  last: 'Doyle',     company: 'Doyle Residential',          title: 'Independent Agent',   town: 'Stockwell',    email: 'callum.doyle@example',        phone: '020 7946 0107',
    note: 'EDGE CASE: malformed email (no TLD) — must be SKIPPED with its own reason' },
  { first: 'Martina', last: 'Kovac',     company: 'Riverside Property Group',   title: 'Head of Sales',       town: 'Nine Elms',    email: 'm.kovac@example.com',         phone: '020 7946 0108' },
  { first: 'Desmond', last: 'Owusu',     company: 'Owusu Estates',              title: 'Senior Partner',      town: 'Kennington',   email: 'd.owusu@example.com',         phone: '020 7946 0109' },
  { first: 'Lucia',   last: 'Ferrari',   company: 'Ferrari & Vaughan',          title: 'Branch Partner',      town: 'Pimlico',      email: 'lucia.ferrari@example.com',   phone: '020 7946 0110' },
  { first: 'Rafaela', last: 'Mendes',    company: 'Brookvale Residential',      title: 'Office Manager',      town: 'Balham',       email: 'r.mendes@example.com',        phone: '020 7946 0111',
    note: 'EDGE CASE: duplicate email of P-00002 — later row must be SKIPPED as duplicate in batch' },
  { first: 'Idris',   last: 'Chaudhry',  company: 'Chaudhry Lettings',          title: 'Lettings Director',   town: 'Tooting',      email: 'idris@example.com',           phone: '020 7946 0112' },
  { first: 'Beatrix', last: 'Nowicka',   company: 'Nowicka Property',           title: 'Founder',             town: 'Peckham',      email: 'b.nowicka@example.com',       phone: '020 7946 0113',
    dnc: true, note: 'EDGE CASE: Do Not Contact — must never stage, must report why' },
  { first: 'Aaron',   last: 'Whitfield', company: 'Whitfield Residential',      title: 'Negotiator',          town: 'Camberwell',   email: 'aaron.whitfield@example.com', phone: '020 7946 0114' },
  { first: 'Noor',    last: 'Haddad',    company: 'Haddad & Sons Estates',      title: 'Director',            town: 'Streatham',    email: 'noor.haddad@example.com',     phone: '020 7946 0115',
    paused: true, note: 'EDGE CASE: Paused — the state her importer assigns to any row with prior outreach. Stages, but must be refused at send time.' }
];

/**
 * §4 — plain text only, no HTML. Every placeholder used here must resolve to a
 * non-empty value on the row or the row fails validation (§8).
 *
 * DIFFERENT FROM DAVID'S SEED COPY, deliberately: {{TownArea}} is not used.
 *
 * Her importer cannot fill Town/Area — the source column it was supposed to
 * come from does not exist in her template (see 00_Config.gs). A template
 * using {{TownArea}} would therefore hard-fail EVERY imported row at send
 * time, with a correct but baffling "missing value for {{TownArea}}" on each.
 * The copy uses only fields her data actually carries: {{FirstName}},
 * {{Company}} and {{JobTitle}}.
 *
 * The seed rows above DO have Town/Area filled, because they are dummy data
 * written by hand — so if the Town/Area mapping is resolved later, adding
 * {{TownArea}} back to the copy is a one-cell edit on the Templates sheet and
 * the seed rows will already exercise it.
 */
var TEMPLATE_SEED = [
  {
    stage: 1,
    name: 'Stage 1 — first contact',
    subject: 'Quick question about {{Company}}',
    body:
      'Hi {{FirstName}},\n\n' +
      'I came across {{Company}} while looking at estate agents across South London, and thought it was worth a short note.\n\n' +
      'We work with people in a {{JobTitle}} role on [one specific outcome — replace this], usually without adding to the day-to-day workload.\n\n' +
      'Worth a ten-minute call to see whether it applies to you? Happy to send over a couple of examples first if that is easier.\n\n' +
      'Best,'
  },
  {
    stage: 2,
    name: 'Stage 2 — follow up',
    subject: 'Re: Quick question about {{Company}}',
    body:
      'Hi {{FirstName}},\n\n' +
      'Following up on my note last week — I know things get busy.\n\n' +
      'The short version: [one sentence on the outcome — replace this]. If it is not relevant to {{Company}} right now, just say so and I will leave it there.\n\n' +
      'Best,'
  },
  {
    stage: 3,
    name: 'Stage 3 — close the loop',
    subject: 'Re: Quick question about {{Company}}',
    body:
      'Hi {{FirstName}},\n\n' +
      'Last one from me. I have not heard back, so I will assume the timing is not right and close the file.\n\n' +
      'If that changes, reply to this email any time and I will pick it straight back up.\n\n' +
      'Best,'
  }
];
