/**
 * 03_SeedData.gs
 * §11 — 15 dummy prospects, four deliberate edge cases:
 *   • P-00004  missing First Name        -> validation failure, never a blank merge
 *   • P-00007  malformed email           -> SKIPPED, distinct reason
 *   • P-00011  duplicate of P-00002      -> SKIPPED, distinct reason
 *   • P-00013  Do Not Contact            -> cannot be staged at all
 * All addresses are on example.com, which is reserved by RFC 2606 and cannot
 * receive mail. Nothing here can reach a real person by accident.
 */
var PROSPECT_SEED = [
  { first: 'Amelia',  last: 'Hartley',   company: 'Hartley & Rowe Interiors', title: 'Managing Director',   town: 'Guildford',  email: 'amelia.hartley@example.com',  phone: '01483 555 101' },
  { first: 'Daniel',  last: 'Okonkwo',   company: 'Northgate Facilities',     title: 'Operations Manager',  town: 'Reading',    email: 'd.okonkwo@example.com',       phone: '0118 555 102' },
  { first: 'Priya',   last: 'Raman',     company: 'Blue Cedar Lettings',      title: 'Head of Property',    town: 'Woking',     email: 'priya.raman@example.com',     phone: '01483 555 103' },
  { first: '',        last: 'Callaghan', company: 'Callaghan Joinery',        title: 'Owner',               town: 'Basingstoke', email: 'office@example.com',         phone: '01256 555 104',
    note: 'EDGE CASE: First Name blank — must fail validation, never send "Hi ,"' },
  { first: 'Tomasz',  last: 'Nowak',     company: 'Meridian Print',           title: 'Sales Director',      town: 'Slough',     email: 't.nowak@example.com',         phone: '01753 555 105' },
  { first: 'Grace',   last: 'Whitfield', company: 'Whitfield Dental Group',   title: 'Practice Manager',    town: 'Farnham',    email: 'grace@example.com',           phone: '01252 555 106' },
  { first: 'Marcus',  last: 'Bell',      company: 'Bell Automotive',          title: 'Director',            town: 'Camberley',  email: 'marcus.bell@example',         phone: '01276 555 107',
    note: 'EDGE CASE: malformed email (no TLD) — must be SKIPPED with its own reason' },
  { first: 'Sofia',   last: 'Marchetti', company: 'Marchetti Catering',       title: 'Founder',             town: 'Windsor',    email: 'sofia@example.com',           phone: '01753 555 108' },
  { first: 'Oliver',  last: 'Grant',     company: 'Grant Surveying',          title: 'Senior Partner',      town: 'Newbury',    email: 'o.grant@example.com',         phone: '01635 555 109' },
  { first: 'Hannah',  last: 'Reed',      company: 'Reed Physio',              title: 'Clinic Owner',        town: 'Bracknell',  email: 'hannah.reed@example.com',     phone: '01344 555 110' },
  { first: 'Danielle', last: 'Okonkwo',  company: 'Northgate Facilities',     title: 'Finance Lead',        town: 'Reading',    email: 'd.okonkwo@example.com',       phone: '0118 555 111',
    note: 'EDGE CASE: duplicate email of P-00002 — later row must be SKIPPED as duplicate in batch' },
  { first: 'Rashid',  last: 'Iqbal',     company: 'Iqbal Wholesale',          title: 'Commercial Manager',  town: 'Staines',    email: 'rashid@example.com',          phone: '01784 555 112' },
  { first: 'Eleanor', last: 'Payne',     company: 'Payne Legal',              title: 'Partner',             town: 'Maidenhead', email: 'e.payne@example.com',         phone: '01628 555 113',
    dnc: true, note: 'EDGE CASE: Do Not Contact — must never stage, must report why' },
  { first: 'Callum',  last: 'Fraser',    company: 'Fraser Groundworks',       title: 'Contracts Manager',   town: 'Aldershot',  email: 'callum.fraser@example.com',   phone: '01252 555 114' },
  { first: 'Yuki',    last: 'Tanaka',    company: 'Tanaka Design Studio',     title: 'Creative Director',   town: 'Richmond',   email: 'yuki.tanaka@example.com',     phone: '020 8555 115' }
];

/**
 * §4 — plain text only, no HTML. Every placeholder used here must resolve to a
 * non-empty value on the row or the row fails validation (§8).
 */
var TEMPLATE_SEED = [
  {
    stage: 1,
    name: 'Stage 1 — first contact',
    subject: 'Quick question about {{Company}}',
    body:
      'Hi {{FirstName}},\n\n' +
      'I came across {{Company}} while looking at businesses around {{TownArea}}, and thought it was worth a short note.\n\n' +
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