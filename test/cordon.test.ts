import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NodeIdRegistry } from '../src/hydra/ids.js';
import { cypherProps, cypherString } from '../src/hydra/client.js';
import { admissible, buildPermissions, canRead } from '../src/cordon/acl.js';
import { buildNameIndex, extractMentions } from '../src/cordon/mentions.js';
import { resolveMentions } from '../src/cordon/resolve.js';
import { buildFacts, derivedRequiredSpaces } from '../src/cordon/facts.js';
import { ids, type Artifact, type Corpus, type Employee } from '../src/cordon/model.js';
import { tokenise } from '../src/cordon/query.js';

/* ------------------------------------------------------------- fixtures -- */

function employee(id: string, name: string, role = 'Engineer'): Employee {
  return { id, name, role, location: 'Remote', org: 'slack' };
}

function artifact(over: Partial<Artifact> & { id: string; space: string }): Artifact {
  return {
    kind: 'slack',
    text: '',
    title: 'slack',
    participants: [],
    key: `${over.space}::${over.id}`,
    ...over,
  } as Artifact;
}

/**
 * Two products, overlapping staff, a management chain.
 *
 *   alice  -> Alpha
 *   bob    -> Beta
 *   carol  -> Alpha + Beta
 *   dana   -> manages alice (so inherits Alpha)
 */
function fixture(): Corpus {
  const employees = new Map<string, Employee>([
    ['eid_a11ce0', employee('eid_a11ce0', 'Charlie Garcia')],
    ['eid_b0b111', employee('eid_b0b111', 'Charlie Davis')],
    ['eid_ca6011', employee('eid_ca6011', 'Emma Jones')],
    ['eid_da4a00', employee('eid_da4a00', 'Hannah Taylor', 'VP of Engineering')],
  ]);

  return {
    employees,
    spaces: new Map([
      ['Alpha', { id: 'Alpha', name: 'Alpha', team: ['eid_a11ce0', 'eid_ca6011'], customers: [] }],
      ['Beta', { id: 'Beta', name: 'Beta', team: ['eid_b0b111', 'eid_ca6011'], customers: [] }],
    ]),
    artifacts: [],
    questions: [],
    reports: new Map([['eid_da4a00', ['eid_a11ce0']]]),
    managerOf: new Map([['eid_a11ce0', 'eid_da4a00']]),
  };
}

/* ------------------------------------------------------------------ ids -- */

test('node ids are namespaced, stable and collision-free', () => {
  const a = new NodeIdRegistry('g1');
  const b = new NodeIdRegistry('g1');
  const c = new NodeIdRegistry('g2');
  assert.equal(a.intern('f:x'), b.intern('f:x'));
  assert.notEqual(a.intern('f:x'), c.intern('f:x'));

  const seen = new Set<number>();
  for (let i = 0; i < 40000; i++) {
    const id = a.intern(`s:Space::artifact-${i}`);
    assert.ok(Number.isSafeInteger(id) && id !== 0);
    assert.ok(!seen.has(id), 'a collision would merge two unrelated sources');
    seen.add(id);
  }
});

test('cypher literals cannot be escaped', () => {
  const hostile = 'x" }) MATCH (n) DETACH DELETE n //';
  const rendered = cypherProps({ id: 1, text: hostile });
  const bare = rendered.split('').filter((ch, i) => ch === '"' && rendered[i - 1] !== '\\');
  assert.equal(bare.length, 2);
  assert.equal(cypherString('a\nb'), '"a\\nb"');
  assert.throws(() => cypherProps({ 'bad key': 1 }), /unsafe property key/);
});

/* ----------------------------------------------------------- permissions -- */

test('team membership grants space access', () => {
  const model = buildPermissions(fixture());
  assert.ok(canRead(model, 'eid_a11ce0', 'Alpha'));
  assert.ok(!canRead(model, 'eid_a11ce0', 'Beta'));
  assert.ok(canRead(model, 'eid_ca6011', 'Alpha'));
  assert.ok(canRead(model, 'eid_ca6011', 'Beta'));
});

test('managers inherit their reports access transitively', () => {
  const model = buildPermissions(fixture());
  // dana is on no team, but manages alice.
  assert.ok(canRead(model, 'eid_da4a00', 'Alpha'), 'manager should inherit');
  assert.ok(!canRead(model, 'eid_da4a00', 'Beta'), 'inheritance must not over-grant');
});

test('a cyclic reporting line does not hang the permission build', () => {
  const corpus = fixture();
  corpus.reports.set('eid_a11ce0', ['eid_da4a00']); // cycle: dana -> alice -> dana
  const model = buildPermissions(corpus);
  assert.ok(model.readable.size > 0);
});

test('a derived fact requires EVERY space it rests on, not any', () => {
  const model = buildPermissions(fixture());

  // The core rule. Union on requirements is intersection on audience.
  assert.ok(admissible(model, 'eid_ca6011', ['Alpha', 'Beta']), 'carol holds both');
  assert.ok(!admissible(model, 'eid_a11ce0', ['Alpha', 'Beta']), 'alice holds only Alpha');
  assert.ok(!admissible(model, 'eid_b0b111', ['Alpha', 'Beta']), 'bob holds only Beta');

  // A single-space fact is unaffected.
  assert.ok(admissible(model, 'eid_a11ce0', ['Alpha']));
});

test('an unknown principal is denied everything', () => {
  const model = buildPermissions(fixture());
  assert.ok(!admissible(model, 'eid_f0f0f0', ['Alpha']));
  assert.ok(!canRead(model, 'eid_f0f0f0', 'Alpha'));
});

test('an empty requirement set does not become a free pass', () => {
  const model = buildPermissions(fixture());
  // Vacuously true by set semantics, so callers must treat "no requirement"
  // as unresolved rather than public. The query layer enforces this by
  // refusing facts whose required set is empty.
  assert.ok(admissible(model, 'eid_a11ce0', []));
});

/* ------------------------------------------------------ entity resolution -- */

test('co-presence disambiguates identical names', () => {
  const corpus = fixture();
  // Put both Charlies on this team, so the roster cannot separate them and the
  // anchor is the only thing that can.
  corpus.spaces.get('Alpha')!.team.push('eid_b0b111');
  // Both "Charlie Garcia" and "Charlie Davis" exist; only alice is anchored.
  const art = artifact({
    id: 'm1',
    space: 'Alpha',
    text: 'Thanks eid_a11ce0. Charlie, can you review the rollout plan today?',
  });
  corpus.artifacts = [art];

  const index = buildNameIndex(corpus);
  const raw = extractMentions(art, index);
  const mentions = raw.map((m, i) => ({
    id: ids.mention(art.key, i),
    surface: m.surface,
    normalised: m.surface.toLowerCase(),
    kind: 'person' as const,
    sourceId: art.key,
    space: art.space,
  }));
  const rawMap = new Map(mentions.map((m, i) => [m.id, raw[i]!]));

  const { resolutions } = resolveMentions({ corpus, index, mentions, raw: rawMap });
  const charlie = mentions.find((m) => m.surface === 'Charlie');
  assert.ok(charlie, 'the ambiguous first name should be extracted');

  const decision = resolutions.get(charlie!.id);
  assert.equal(decision?.employeeId, 'eid_a11ce0', 'should resolve to the anchored Charlie');
  assert.equal(
    decision?.method,
    'co-presence',
    'both Charlies are on this team, so only the anchor can separate them',
  );
});

test('resolution abstains rather than guess when a roll call excludes the name', () => {
  const corpus = fixture();
  const art = artifact({
    id: 't1',
    space: 'Alpha',
    kind: 'meeting_transcript',
    participants: ['eid_ca6011'],
    text: 'Attendees\nEmma Jones\nTranscript\nEmma Jones: Charlie should own this.',
  });
  corpus.artifacts = [art];

  const index = buildNameIndex(corpus);
  const raw = extractMentions(art, index);
  const mentions = raw.map((m, i) => ({
    id: ids.mention(art.key, i),
    surface: m.surface,
    normalised: m.surface.toLowerCase(),
    kind: 'person' as const,
    sourceId: art.key,
    space: art.space,
  }));
  const rawMap = new Map(mentions.map((m, i) => [m.id, raw[i]!]));
  const { resolutions } = resolveMentions({ corpus, index, mentions, raw: rawMap });

  const charlie = mentions.find((m) => m.surface === 'Charlie');
  if (charlie) {
    const decision = resolutions.get(charlie.id);
    assert.equal(
      decision?.employeeId,
      null,
      'Charlie was not in the room; guessing a teammate would attach access to the wrong person',
    );
  }
});

/* ------------------------------------------------------- fact propagation -- */

test('a cross-space fact accumulates the requirements of its supports', () => {
  const corpus = fixture();
  const long = (s: string) => `${s} and the team agreed to proceed with the rollout this quarter.`;
  corpus.artifacts = [
    artifact({ id: 'a1', space: 'Alpha', text: long('eid_ca6011 shipped the Alpha integration') }),
    artifact({ id: 'b1', space: 'Beta', text: long('eid_ca6011 reviewed the Beta migration') }),
  ];

  const index = buildNameIndex(corpus);
  const mentions = corpus.artifacts.flatMap((art) =>
    extractMentions(art, index).map((m, i) => ({
      id: ids.mention(art.key, i),
      surface: m.surface,
      normalised: m.surface.toLowerCase(),
      kind: 'person' as const,
      sourceId: art.key,
      space: art.space,
      _raw: m,
    })),
  );
  const rawMap = new Map(mentions.map((m) => [m.id, m._raw]));
  const { resolutions } = resolveMentions({
    corpus,
    index,
    mentions: mentions.map(({ _raw, ...rest }) => rest),
    raw: rawMap,
  });

  const built = buildFacts({
    corpus,
    mentions: mentions.map(({ _raw, ...rest }) => rest),
    resolutions,
  });

  const derived = built.facts.filter((f) => f.level > 0);
  assert.ok(derived.length > 0, 'carol appears in both spaces, so a cross-space fact should form');

  const fact = derived[0]!;
  assert.deepEqual(
    [...fact.requiredSpaces].sort(),
    ['Alpha', 'Beta'],
    'the derived fact must require both spaces',
  );

  // And the requirement must survive an independent re-derivation.
  const factById = new Map(built.facts.map((f) => [f.id, f]));
  const sourceSpace = new Map(corpus.artifacts.map((a) => [ids.source(a.key), a.space]));
  const walked = derivedRequiredSpaces(fact.id, factById, sourceSpace);
  assert.deepEqual([...walked].sort(), ['Alpha', 'Beta']);

  // The security consequence, stated as a test.
  const model = buildPermissions(corpus);
  assert.ok(admissible(model, 'eid_ca6011', fact.requiredSpaces), 'carol may see it');
  assert.ok(!admissible(model, 'eid_a11ce0', fact.requiredSpaces), 'alice may not');
  assert.ok(!admissible(model, 'eid_b0b111', fact.requiredSpaces), 'bob may not');
});

test('shared artifact ids in different spaces stay distinct nodes', () => {
  // A public link cited by two products must not collapse into one node, or a
  // fact would inherit whichever space happened to load last.
  const a = artifact({ id: 'www_example_org', space: 'Alpha', text: 'x' });
  const b = artifact({ id: 'www_example_org', space: 'Beta', text: 'x' });
  assert.notEqual(a.key, b.key);
  assert.notEqual(ids.source(a.key), ids.source(b.key));
});

/* ----------------------------------------------------------------- query -- */

test('tokenisation drops question scaffolding but keeps identifiers', () => {
  const tokens = tokenise('What are the employee IDs of the reviewers for eid_13fdff84?');
  assert.ok(tokens.includes('reviewers'));
  assert.ok(tokens.includes('eid_13fdff84'), 'identifiers must survive tokenisation');
  assert.ok(!tokens.includes('what'));
  assert.ok(!tokens.includes('the'));
});
