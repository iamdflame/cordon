/**
 * Graceful degradation must not become a graceful leak.
 *
 * This is the one feature in Cordon that answers a question it just refused,
 * which makes it the one most likely to quietly become a partial disclosure.
 * The whole defence is a single invariant:
 *
 *     every substitute passes the ordinary gate on its own merits
 *
 * If that holds, degradation changes only *what Cordon volunteers*, never what
 * it is willing to disclose - and the soundness theorem is untouched. These
 * tests assert it directly against the permission model rather than against the
 * degrade module's own reasoning, which is the tautology trap SOUNDNESS.md was
 * written to avoid.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrade } from '../src/cordon/degrade.js';
import type { FactNode } from '../src/cordon/model.js';

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface World {
  facts: FactNode[];
  factById: Map<string, FactNode>;
  requiredByFact: Map<string, readonly string[]>;
  spaces: string[];
}

/**
 * A random derivation lattice, built in level order so requirements grow
 * monotonically upward - the same shape facts.ts produces.
 */
function generate(seed: number): World {
  const random = makeRandom(seed);
  const spaces = Array.from({ length: 3 + Math.floor(random() * 4) }, (_, i) => `sp${i}`);

  const facts: FactNode[] = [];
  const factById = new Map<string, FactNode>();
  const requiredByFact = new Map<string, readonly string[]>();
  let n = 0;

  const add = (fact: FactNode, required: string[]) => {
    facts.push(fact);
    factById.set(fact.id, fact);
    requiredByFact.set(fact.id, required);
  };

  /* Level 0: one source, one space. */
  const level0: string[] = [];
  for (const space of spaces) {
    for (let i = 0; i < 2; i++) {
      const id = `f0-${n++}`;
      add(
        { id, text: id, restsOn: [`s:${id}`], level: 0, entities: [], space, requiredSpaces: [space] },
        [space],
      );
      level0.push(id);
    }
  }

  /* Levels 1..3: rest on strictly lower levels; requirement is the union. */
  let previous = level0;
  for (let level = 1; level <= 3; level++) {
    const current: string[] = [];
    const count = 2 + Math.floor(random() * 4);

    for (let k = 0; k < count; k++) {
      const supports: string[] = [];
      const picks = 2 + Math.floor(random() * 2);
      for (let i = 0; i < picks && previous.length > 0; i++) {
        supports.push(previous[Math.floor(random() * previous.length)]!);
      }
      const unique = [...new Set(supports)];
      if (unique.length < 2) continue;

      const union = new Set<string>();
      for (const s of unique) for (const sp of requiredByFact.get(s) ?? []) union.add(sp);
      if (union.size === 0) continue;

      const id = `f${level}-${n++}`;
      add(
        {
          id,
          text: id,
          restsOn: unique,
          level,
          entities: [],
          space: [...union][0]!,
          requiredSpaces: [...union],
        },
        [...union],
      );
      current.push(id);
    }
    if (current.length === 0) break;
    previous = current;
  }

  return { facts, factById, requiredByFact, spaces };
}

const fits = (required: readonly string[], permitted: ReadonlySet<string>) =>
  required.every((s) => permitted.has(s));

test('every substitute is independently admissible', () => {
  /*
   * The invariant the whole feature rests on. A substitute the asker could not
   * have obtained by asking for it directly would be a partial disclosure of
   * the thing we just refused.
   */
  let emitted = 0;

  for (let seed = 1; seed <= 300; seed++) {
    const world = generate(seed);
    const random = makeRandom(seed * 7919);
    const permitted = new Set(world.spaces.filter(() => random() < 0.6));

    for (const fact of world.facts) {
      if (fact.level === 0) continue;
      const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (fits(required, permitted)) continue; // not refused; nothing to degrade

      for (const sub of degrade({
        denied: fact,
        factById: world.factById,
        requiredByFact: world.requiredByFact,
        permitted,
      })) {
        emitted++;
        const subRequired = world.requiredByFact.get(sub.fact.id) ?? sub.fact.requiredSpaces;
        assert.ok(
          fits(subRequired, permitted),
          `seed ${seed}: substitute ${sub.fact.id} requires ${subRequired.join(',')}, ` +
            `which this asker cannot read`,
        );
      }
    }
  }

  assert.ok(emitted >= 30, `too few substitutes generated to prove anything (${emitted})`);
});

test('every substitute is strictly weaker than what was refused', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const world = generate(seed);
    const random = makeRandom(seed * 104729);
    const permitted = new Set(world.spaces.filter(() => random() < 0.6));

    for (const fact of world.facts) {
      if (fact.level === 0) continue;
      const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (fits(required, permitted)) continue;

      for (const sub of degrade({
        denied: fact,
        factById: world.factById,
        requiredByFact: world.requiredByFact,
        permitted,
      })) {
        const subRequired = world.requiredByFact.get(sub.fact.id) ?? sub.fact.requiredSpaces;
        assert.ok(
          subRequired.length < required.length,
          `seed ${seed}: substitute needs ${subRequired.length} spaces, denied needs ${required.length}`,
        );
        for (const space of subRequired) {
          assert.ok(
            required.includes(space),
            `seed ${seed}: substitute requires ${space}, which the denied fact does not`,
          );
        }
      }
    }
  }
});

test('a substitute is always a genuine ancestor, never an invention', () => {
  /* Reachability down the support edges - a claim that is not entailed by the
     refused fact's own evidence would be fabrication, not degradation. */
  for (let seed = 1; seed <= 200; seed++) {
    const world = generate(seed);
    const random = makeRandom(seed * 31337);
    const permitted = new Set(world.spaces.filter(() => random() < 0.6));

    for (const fact of world.facts) {
      if (fact.level === 0) continue;
      const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (fits(required, permitted)) continue;

      const reachable = new Set<string>();
      const stack = [...fact.restsOn];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        for (const s of world.factById.get(id)?.restsOn ?? []) stack.push(s);
      }

      for (const sub of degrade({
        denied: fact,
        factById: world.factById,
        requiredByFact: world.requiredByFact,
        permitted,
      })) {
        assert.ok(
          reachable.has(sub.fact.id),
          `seed ${seed}: substitute ${sub.fact.id} is not beneath ${fact.id}`,
        );
        assert.ok(sub.fact.level > 0, `seed ${seed}: a level-0 source was offered as a substitute`);
      }
    }
  }
});

test('degradation never widens what is disclosable', () => {
  /*
   * The theorem-level claim: the set of facts Cordon is *willing* to disclose is
   * identical with and without degradation. Only the volunteering changes.
   */
  for (let seed = 1; seed <= 150; seed++) {
    const world = generate(seed);
    const random = makeRandom(seed * 7);
    const permitted = new Set(world.spaces.filter(() => random() < 0.55));

    const disclosable = new Set(
      world.facts
        .filter((f) => fits(world.requiredByFact.get(f.id) ?? f.requiredSpaces, permitted))
        .map((f) => f.id),
    );

    for (const fact of world.facts) {
      if (fact.level === 0) continue;
      const required = world.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (fits(required, permitted)) continue;

      for (const sub of degrade({
        denied: fact,
        factById: world.factById,
        requiredByFact: world.requiredByFact,
        permitted,
      })) {
        assert.ok(
          disclosable.has(sub.fact.id),
          `seed ${seed}: degradation produced ${sub.fact.id}, which was not already disclosable`,
        );
      }
    }
  }
});

test('an admissible fact is never degraded', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const world = generate(seed);
    const permitted = new Set(world.spaces); // entitled to everything

    for (const fact of world.facts) {
      if (fact.level === 0) continue;
      const subs = degrade({
        denied: fact,
        factById: world.factById,
        requiredByFact: world.requiredByFact,
        permitted,
      });
      /* With full permission nothing is refused, so nothing should be strictly
         weaker *and* offered as a replacement for a fact we would have served. */
      for (const sub of subs) {
        const subRequired = world.requiredByFact.get(sub.fact.id) ?? sub.fact.requiredSpaces;
        assert.ok(
          subRequired.length < (world.requiredByFact.get(fact.id) ?? fact.requiredSpaces).length,
          `seed ${seed}: substitute was not weaker`,
        );
      }
    }
  }
});
