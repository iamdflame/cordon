/**
 * The inference channel, and the optimality of the cut that closes it.
 *
 * Two claims are made in src/cordon/closure.ts and neither is self-evident:
 *
 *   1. Depth 1 is tight - a person claim is never rebuilt when it was denied.
 *   2. The cuts are *minimum*, not merely sufficient.
 *
 * (2) is the one that needs real evidence. "Minimum by an exchange argument" is
 * a sentence in a comment, and a sentence in a comment has never caught a bug.
 * So the test enumerates every subset of the evidence on small instances, finds
 * the genuinely smallest cut by brute force, and asserts our solver matches it
 * exactly. If the exchange argument is wrong, this fails.
 *
 * The instances are small enough to enumerate and random enough to contain
 * shapes the author did not think of, which is the same discipline as
 * test/soundness.test.ts and for the same reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claim,
  claimOf,
  reconstruct,
  minimumCut,
  cutHolds,
  type ClaimKey,
} from '../src/cordon/closure.js';
import type { FactNode } from '../src/cordon/model.js';

/** Deterministic PRNG: a property test that cannot be replayed is not evidence. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Instance {
  facts: FactNode[];
  requiredByFact: Map<string, readonly string[]>;
  spaces: string[];
}

/**
 * A miniature corpus in the shape facts.ts produces: level-0 evidence, level-1
 * person facts over subjects seen in two or more spaces, level-2 pairings over
 * subjects spanning the same two spaces.
 */
function generate(seed: number): Instance {
  const random = makeRandom(seed);
  const spaceCount = 2 + Math.floor(random() * 3);
  const spaces = Array.from({ length: spaceCount }, (_, i) => `sp${i}`);
  const entities = Array.from({ length: 2 + Math.floor(random() * 3) }, (_, i) => `e${i}`);

  const facts: FactNode[] = [];
  const requiredByFact = new Map<string, readonly string[]>();
  const seenBy = new Map<string, Set<string>>();

  let n = 0;
  for (const entity of entities) {
    for (const space of spaces) {
      const count = Math.floor(random() * 3); // 0..2 artifacts about e in this space
      for (let k = 0; k < count; k++) {
        const id = `f:${n++}`;
        facts.push({
          id,
          text: id,
          restsOn: [`s:${id}`],
          level: 0,
          entities: [entity],
          space,
          requiredSpaces: [space],
        });
        requiredByFact.set(id, [space]);
        (seenBy.get(entity) ?? seenBy.set(entity, new Set()).get(entity)!).add(space);
      }
    }
  }

  // Level 1, mirroring the pipeline: a subject in two or more spaces.
  const personSpaces = new Map<string, string[]>();
  for (const [entity, set] of seenBy) {
    if (set.size < 2) continue;
    const list = [...set].slice(0, 6);
    personSpaces.set(entity, list);
    const id = `d:person:${entity}`;
    facts.push({
      id,
      text: id,
      restsOn: [],
      level: 1,
      entities: [entity],
      space: list[0]!,
      requiredSpaces: list,
    });
    requiredByFact.set(id, list);
  }

  // Level 2, mirroring the pipeline: two or more subjects spanning a pair.
  const span = new Map<string, number>();
  for (const list of personSpaces.values()) {
    const sorted = [...list].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        span.set(key, (span.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of span) {
    if (count < 2) continue;
    const [a, b] = key.split('|') as [string, string];
    const id = `d:pair:${a}:${b}`;
    /* The requirement is the union of the supports, as the pipeline computes it. */
    const union = new Set<string>([a, b]);
    for (const [entity, list] of personSpaces) {
      if (list.includes(a) && list.includes(b)) for (const s of list) union.add(s);
      void entity;
    }
    facts.push({
      id,
      text: id,
      restsOn: [],
      level: 2,
      entities: [],
      space: a,
      requiredSpaces: [...union],
    });
    requiredByFact.set(id, [...union]);
  }

  return { facts, requiredByFact, spaces };
}

/** The genuinely smallest set of level-0 facts whose removal kills `target`. */
function bruteForceCut(inst: Instance, permitted: Set<string>, target: ClaimKey): number {
  const level0 = inst.facts.filter((f) => f.level === 0);
  assert.ok(level0.length <= 16, 'instance too large to enumerate');

  for (let size = 0; size <= level0.length; size++) {
    // Enumerate every subset of exactly this size, smallest first.
    const total = 1 << level0.length;
    for (let mask = 0; mask < total; mask++) {
      let bits = 0;
      for (let i = 0; i < level0.length; i++) if (mask & (1 << i)) bits++;
      if (bits !== size) continue;

      const removed = new Set<string>();
      for (let i = 0; i < level0.length; i++) if (mask & (1 << i)) removed.add(level0[i]!.id);

      const surviving = inst.facts.filter((f) => !removed.has(f.id));
      const rebuilt = reconstruct({
        facts: surviving,
        requiredByFact: inst.requiredByFact,
        permitted,
      });
      if (!rebuilt.claims.has(target)) return size;
    }
  }
  return Number.POSITIVE_INFINITY;
}

test('the cut is minimum, checked against brute force', () => {
  let checked = 0;

  for (let seed = 1; seed <= 400; seed++) {
    const inst = generate(seed);
    if (inst.facts.filter((f) => f.level === 0).length > 14) continue;

    for (const fact of inst.facts) {
      if (fact.level !== 2) continue;
      const key = claimOf(fact);
      if (!key) continue;

      /*
       * The phantom scenario, which is the only one a cut applies to: the asker
       * holds exactly the two spaces the pairing is *about*, and the pairing's
       * requirement - the union of its supports - names more. So Cordon denies
       * it, and the asker rebuilds it from level-0 evidence they may read.
       *
       * An earlier version of this test used full permission, under which the
       * pairing is simply disclosed. Brute force correctly answered "no cut
       * exists", the solver answered 1, and the disagreement was the test's
       * own setup rather than the solver. Worth keeping in the record: the
       * check found a bug on its first run, and the bug was in the check.
       */
      const [, a, b] = key.split('|') as [string, string, string];
      const permitted = new Set([a, b]);

      const required = inst.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (required.every((s) => permitted.has(s))) continue; // admissible, not denied

      const rebuilt = reconstruct({
        facts: inst.facts,
        requiredByFact: inst.requiredByFact,
        permitted,
      });
      if (rebuilt.held.has(fact.id)) continue; // disclosed outright
      if (!rebuilt.claims.has(key)) continue;  // effective denial, nothing to cut

      const ours = minimumCut(
        { facts: inst.facts, requiredByFact: inst.requiredByFact, permitted },
        key,
      );
      const best = bruteForceCut(inst, permitted, key);

      assert.equal(
        ours.cost,
        best,
        `seed ${seed}: solver cut ${ours.cost}, true minimum ${best} for ${key}`,
      );

      /* Sufficiency, separately from optimality: the cut must actually work. */
      assert.ok(
        cutHolds({ facts: inst.facts, requiredByFact: inst.requiredByFact, permitted }, key, ours),
        `seed ${seed}: cut of size ${ours.cost} did not close ${key}`,
      );
      checked++;
      if (checked >= 60) break;
    }
    if (checked >= 60) break;
  }

  assert.ok(checked >= 20, `expected to exercise real pairings, only checked ${checked}`);
});

test('depth 1 is tight: a denied person claim is never rebuilt', () => {
  let denied = 0;

  for (let seed = 1; seed <= 300; seed++) {
    const inst = generate(seed);
    const random = makeRandom(seed * 7919);

    /* A random slice of the org's spaces, i.e. an arbitrary asker. */
    const permitted = new Set(inst.spaces.filter(() => random() < 0.6));
    const rebuilt = reconstruct({
      facts: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
    });

    for (const fact of inst.facts) {
      if (fact.level !== 1) continue;
      const key = claimOf(fact);
      if (!key) continue;

      const required = inst.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      const admissible = required.every((s) => permitted.has(s));
      if (admissible) continue;

      denied++;
      assert.ok(
        !rebuilt.claims.has(key),
        `seed ${seed}: person claim ${key} was denied and still rebuilt`,
      );
    }
  }

  assert.ok(denied > 0, 'generated no denied person claims; the test proved nothing');
});

test('reconstruction is monotone in permission', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const inst = generate(seed);
    if (inst.spaces.length < 2) continue;

    const narrow = new Set(inst.spaces.slice(0, inst.spaces.length - 1));
    const wide = new Set(inst.spaces);

    const a = reconstruct({ facts: inst.facts, requiredByFact: inst.requiredByFact, permitted: narrow });
    const b = reconstruct({ facts: inst.facts, requiredByFact: inst.requiredByFact, permitted: wide });

    for (const key of a.claims) {
      assert.ok(b.claims.has(key), `seed ${seed}: ${key} lost when permission widened`);
    }
  }
});

test('claim keys are canonical under argument order', () => {
  assert.equal(claim.pair('b', 'a'), claim.pair('a', 'b'));
  assert.equal(claim.cluster(['c', 'a', 'b']), claim.cluster(['a', 'b', 'c']));
  assert.equal(claim.person('e', ['z', 'a']), claim.person('e', ['a', 'z']));
});
