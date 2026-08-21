/**
 * Policy: the properties an operator's mental model depends on.
 *
 * The impact preview is the feature this module exists for, and it is only
 * worth anything if its arithmetic is exactly right. An administrator who is
 * told "this grants 14 documents" and is actually granting 300 derived facts is
 * worse off than one who was told nothing, because they now have false
 * confidence in a number.
 *
 * So these check the preview against a direct recomputation rather than against
 * its own bookkeeping - the same discipline as SOUNDNESS.md, for the same
 * reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPermissions, type PermissionModel } from '../src/cordon/acl.js';
import { compile, grant, policyFromModel, preview, revoke } from '../src/cordon/policy.js';
import type { Corpus, FactNode } from '../src/cordon/model.js';

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface World {
  corpus: Corpus;
  facts: FactNode[];
  requiredByFact: Map<string, readonly string[]>;
  permissions: PermissionModel;
  spaces: string[];
}

/** A small organisation: people, teams, a management chain, derived facts. */
function generate(seed: number): World {
  const random = makeRandom(seed);
  const spaceCount = 3 + Math.floor(random() * 4);
  const spaces = Array.from({ length: spaceCount }, (_, i) => `sp${i}`);
  const people = Array.from({ length: 5 + Math.floor(random() * 8) }, (_, i) => `p${i}`);

  const employees = new Map(
    people.map((id) => [id, { id, name: id, role: 'engineer', location: 'x', org: 'o' }]),
  );

  const reports = new Map<string, string[]>();
  const managerOf = new Map<string, string>();
  for (let i = 1; i < people.length; i++) {
    if (random() < 0.4) {
      const manager = people[Math.floor(random() * i)]!;
      const child = people[i]!;
      reports.set(manager, [...(reports.get(manager) ?? []), child]);
      managerOf.set(child, manager);
    }
  }

  const spaceMap = new Map(
    spaces.map((id) => [
      id,
      { id, name: id, team: people.filter(() => random() < 0.35), customers: [] },
    ]),
  );

  const corpus: Corpus = {
    employees,
    spaces: spaceMap,
    artifacts: [],
    questions: [],
    reports,
    managerOf,
  };

  /* Facts: level-0 in one space, derived requiring a random combination. */
  const facts: FactNode[] = [];
  const requiredByFact = new Map<string, readonly string[]>();
  let n = 0;

  for (const space of spaces) {
    for (let i = 0; i < 3; i++) {
      const id = `f:${n++}`;
      facts.push({
        id, text: id, restsOn: [], level: 0, entities: [], space, requiredSpaces: [space],
      });
      requiredByFact.set(id, [space]);
    }
  }
  for (let i = 0; i < 10; i++) {
    const required = spaces.filter(() => random() < 0.5);
    if (required.length < 2) continue;
    const id = `d:${n++}`;
    facts.push({
      id, text: id, restsOn: [], level: 2, entities: [], space: required[0]!, requiredSpaces: required,
    });
    requiredByFact.set(id, required);
  }

  return { corpus, facts, requiredByFact, permissions: buildPermissions(corpus), spaces };
}

const readableBy = (m: PermissionModel, p: string) => m.readable.get(p) ?? new Set<string>();

function sameAccess(a: PermissionModel, b: PermissionModel): boolean {
  for (const principal of a.readable.keys()) {
    const x = readableBy(a, principal);
    const y = readableBy(b, principal);
    if (x.size !== y.size) return false;
    for (const space of x) if (!y.has(space)) return false;
  }
  return true;
}

test('a policy read out of a model compiles back to that model', () => {
  /*
   * The migration path. If this drifts, every impact number is measuring the
   * policy layer's bugs rather than the change being previewed - which is why
   * the audit exits non-zero on any drift rather than reporting anyway.
   */
  for (let seed = 1; seed <= 200; seed++) {
    const world = generate(seed);
    const round = compile(policyFromModel(world.permissions), world.corpus);
    assert.ok(
      sameAccess(world.permissions, round),
      `seed ${seed}: round-tripping the policy changed somebody's access`,
    );
  }
});

test('granting only ever widens, revoking only ever narrows', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const world = generate(seed);
    const base = policyFromModel(world.permissions);
    const subject = [...world.corpus.employees.keys()][0]!;
    const space = world.spaces[world.spaces.length - 1]!;

    const wider = compile(grant(base, subject, space), world.corpus);
    for (const principal of world.corpus.employees.keys()) {
      for (const s of readableBy(world.permissions, principal)) {
        assert.ok(readableBy(wider, principal).has(s), `seed ${seed}: a grant removed access`);
      }
    }

    const narrower = compile(revoke(base, subject, space), world.corpus);
    for (const principal of world.corpus.employees.keys()) {
      for (const s of readableBy(narrower, principal)) {
        assert.ok(readableBy(world.permissions, principal).has(s), `seed ${seed}: a revoke added access`);
      }
    }
  }
});

test('the preview counts exactly what changed, checked by recomputation', () => {
  let previewed = 0;

  for (let seed = 1; seed <= 200; seed++) {
    const world = generate(seed);
    const base = policyFromModel(world.permissions);
    const subject = [...world.corpus.employees.keys()][Math.floor(world.corpus.employees.size / 2)]!;

    for (const space of world.spaces) {
      if (readableBy(world.permissions, subject).has(space)) continue;
      const after = compile(grant(base, subject, space), world.corpus);
      const impact = preview({
        before: world.permissions,
        after,
        facts: world.facts,
        requiredByFact: world.requiredByFact,
        detail: 999,
      });

      /* Independent recomputation: walk every fact for every principal. */
      let docs = 0;
      let derived = 0;
      let combo = 0;
      for (const principal of after.readable.keys()) {
        const was = readableBy(world.permissions, principal);
        const now = readableBy(after, principal);
        for (const fact of world.facts) {
          const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
          const before = required.every((s) => was.has(s));
          const nowOk = required.every((s) => now.has(s));
          if (before || !nowOk) continue;
          if (fact.level === 0) docs++;
          else {
            derived++;
            if (required.some((s) => was.has(s))) combo++;
          }
        }
      }

      assert.equal(impact.documentsGained, docs, `seed ${seed}/${space}: document count wrong`);
      assert.equal(impact.derivedGained, derived, `seed ${seed}/${space}: derived count wrong`);
      assert.equal(impact.unlockedByCombination, combo, `seed ${seed}/${space}: combination count wrong`);
      previewed++;
      break;
    }
  }

  assert.ok(previewed >= 50, `too few previews exercised (${previewed})`);
});

test('a combination unlock genuinely required a space already held', () => {
  /*
   * The claim the audit headlines. If a fact is counted as unlocked "in
   * combination", it must actually depend on something the principal had before
   * the grant - otherwise the grant alone would have sufficed and the framing
   * is wrong.
   */
  let checked = 0;

  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const world = generate(seed);
    const base = policyFromModel(world.permissions);

    for (const subject of world.corpus.employees.keys()) {
      const was = readableBy(world.permissions, subject);
      if (was.size === 0) continue;
      const missing = world.spaces.filter((s) => !was.has(s));
      if (missing.length === 0) continue;

      const space = missing[0]!;
      const after = compile(grant(base, subject, space), world.corpus);
      const impact = preview({
        before: world.permissions,
        after,
        facts: world.facts,
        requiredByFact: world.requiredByFact,
        detail: 999,
      });

      for (const row of impact.perPrincipal) {
        if (row.unlockedByCombination === 0) continue;
        const had = readableBy(world.permissions, row.principal);
        const now = readableBy(after, row.principal);

        let verified = 0;
        for (const fact of world.facts) {
          if (fact.level === 0) continue;
          const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
          const before = required.every((s) => had.has(s));
          const nowOk = required.every((s) => now.has(s));
          if (before || !nowOk) continue;
          if (required.some((s) => had.has(s))) {
            verified++;
            /* The fact must need more than the newly granted space alone. */
            assert.ok(
              required.length > 1,
              `seed ${seed}: single-space fact counted as a combination unlock`,
            );
          }
        }
        assert.equal(
          verified,
          row.unlockedByCombination,
          `seed ${seed}: combination count disagrees with recomputation`,
        );
        checked++;
      }
      break;
    }
  }

  assert.ok(checked >= 5, `no combination unlocks were generated; the test proved nothing (${checked})`);
});

test('a preview with no change reports no impact', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const world = generate(seed);
    const same = compile(policyFromModel(world.permissions), world.corpus);
    const impact = preview({
      before: world.permissions,
      after: same,
      facts: world.facts,
      requiredByFact: world.requiredByFact,
    });
    assert.equal(impact.principalsAffected, 0, `seed ${seed}: a no-op policy change reported impact`);
    assert.equal(impact.derivedGained, 0);
    assert.equal(impact.documentsGained, 0);
  }
});
