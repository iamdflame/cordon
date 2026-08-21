/**
 * Inference-safe planning: the properties that have to hold.
 *
 * The planner's subset choice is a heuristic and is documented as one. Its
 * *safety* is not, and that is the split these tests enforce:
 *
 *   safety     exact, and asserted directly against the rule engine
 *   utility    heuristic, and measured against brute force rather than claimed
 *
 * The failure mode worth guarding against is a planner that looks safe because
 * it suppresses everything. "Withheld nothing dangerous" is trivially true of a
 * system that withholds all. So the tests below check both directions: nothing
 * protected gets through, *and* nothing is dropped that did not need to be.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveClosure, claimOf, type ClaimKey } from '../src/cordon/closure.js';
import { DisclosureLedger, plan, protectedClaims } from '../src/cordon/planner.js';
import type { FactNode } from '../src/cordon/model.js';

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

/** A miniature corpus in the shape facts.ts produces. */
function generate(seed: number): Instance {
  const random = makeRandom(seed);
  const spaces = Array.from({ length: 2 + Math.floor(random() * 4) }, (_, i) => `sp${i}`);
  const entities = Array.from({ length: 2 + Math.floor(random() * 4) }, (_, i) => `e${i}`);

  const facts: FactNode[] = [];
  const requiredByFact = new Map<string, readonly string[]>();
  const seenBy = new Map<string, Set<string>>();

  let n = 0;
  for (const entity of entities) {
    for (const space of spaces) {
      for (let k = 0, count = Math.floor(random() * 3); k < count; k++) {
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

  const personSpaces = new Map<string, string[]>();
  for (const [entity, set] of seenBy) {
    if (set.size < 2) continue;
    const list = [...set].slice(0, 6);
    personSpaces.set(entity, list);
    const id = `d:person:${entity}`;
    facts.push({
      id, text: id, restsOn: [], level: 1, entities: [entity], space: list[0]!, requiredSpaces: list,
    });
    requiredByFact.set(id, list);
  }

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
    const union = new Set<string>([a, b]);
    for (const list of personSpaces.values()) {
      if (list.includes(a) && list.includes(b)) for (const s of list) union.add(s);
    }
    const id = `d:pair:${a}:${b}`;
    facts.push({
      id, text: id, restsOn: [], level: 2, entities: [], space: a, requiredSpaces: [...union],
    });
    requiredByFact.set(id, [...union]);
  }

  return { facts, requiredByFact, spaces };
}

/** A deterministic slice of the org's spaces: an arbitrary asker. */
function askerFor(inst: Instance, seed: number): Set<string> {
  const random = makeRandom(seed * 7919);
  const chosen = inst.spaces.filter(() => random() < 0.65);
  return new Set(chosen.length > 0 ? chosen : inst.spaces.slice(0, 1));
}

function setup(seed: number) {
  const inst = generate(seed);
  const permitted = askerFor(inst, seed);
  const protectedSet = protectedClaims(inst.facts, inst.requiredByFact, permitted);
  return { inst, permitted, protectedSet };
}

test('a plan never lets a protected claim through', () => {
  let planned = 0;
  let bit = 0;

  for (let seed = 1; seed <= 400; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    if (protectedSet.size === 0) continue;

    const result = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
    });
    planned++;
    if (result.suppressed.length > 0) bit++;

    /* The assertion is against the rule engine, not against the planner's own
       bookkeeping - the tautology trap from SOUNDNESS.md. */
    const reachable = deriveClosure(result.disclosed).claims;
    for (const key of reachable) {
      assert.ok(!protectedSet.has(key), `seed ${seed}: protected claim ${key} reachable from the plan`);
    }
    assert.ok(result.safe, `seed ${seed}: planner reported unsafe`);
  }

  assert.ok(planned >= 50, `too few instances with protected claims (${planned})`);
  assert.ok(bit > 0, 'the constraint never bit; these tests proved nothing');
});

test('a plan never discloses something the asker lacks provenance for', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    const result = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
    });

    for (const fact of result.disclosed) {
      const required = inst.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      for (const space of required) {
        assert.ok(
          permitted.has(space),
          `seed ${seed}: disclosed ${fact.id} requiring ${space}, which the asker cannot read`,
        );
      }
    }
  }
});

test('nothing is suppressed when nothing would leak', () => {
  /*
   * The failure this guards against: a planner that is "safe" because it
   * withholds everything. If the admissible set already satisfies the
   * constraint, retention must be exactly 1.
   */
  let checked = 0;

  for (let seed = 1; seed <= 400; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    const admissible = inst.facts.filter((f) =>
      (inst.requiredByFact.get(f.id) ?? f.requiredSpaces).every((s) => permitted.has(s)),
    );
    const reachable = deriveClosure(admissible).claims;
    if ([...reachable].some((k) => protectedSet.has(k))) continue; // would leak; not this test

    const result = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
    });
    assert.equal(
      result.suppressed.length,
      0,
      `seed ${seed}: suppressed ${result.suppressed.length} facts with nothing to prevent`,
    );
    assert.equal(result.stats.retention, 1, `seed ${seed}: lost utility for no reason`);
    checked++;
  }

  assert.ok(checked >= 20, `expected safe instances to exercise, got ${checked}`);
});

test('the ledger only ever tightens: history cannot increase what is disclosed', () => {
  let compared = 0;

  for (let seed = 1; seed <= 250; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    if (protectedSet.size === 0) continue;

    const fresh = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
    });

    /* Same query, but the asker has already been shown the first half. */
    const ledger = new DisclosureLedger();
    ledger.record(fresh.disclosed.slice(0, Math.ceil(fresh.disclosed.length / 2)));

    const withHistory = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
      ledger,
    });

    assert.ok(
      withHistory.disclosed.length <= fresh.disclosed.length,
      `seed ${seed}: history increased disclosure ${fresh.disclosed.length} -> ${withHistory.disclosed.length}`,
    );
    assert.ok(withHistory.safe, `seed ${seed}: unsafe once history was considered`);
    compared++;
  }

  assert.ok(compared >= 30, `too few ledger comparisons (${compared})`);
});

test('a session stays safe across many queries', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    if (protectedSet.size === 0) continue;

    const ledger = new DisclosureLedger();
    const random = makeRandom(seed * 31);

    for (let turn = 0; turn < 8; turn++) {
      /* A different slice of the corpus each turn, as retrieval would give. */
      const candidates = inst.facts.filter(() => random() < 0.5);
      const result = plan({
        candidates,
        requiredByFact: inst.requiredByFact,
        permitted,
        protectedSet,
        ledger,
      });
      ledger.record(result.disclosed);

      /* The real property: the *accumulation* stays clean, not just this turn. */
      const reachable = deriveClosure(ledger.facts()).claims;
      for (const key of reachable) {
        assert.ok(
          !protectedSet.has(key),
          `seed ${seed} turn ${turn}: session history reaches protected claim ${key}`,
        );
      }
    }
  }
});

test('greedy utility loss is measured against brute force, not asserted', () => {
  /*
   * Exact maximisation is NP-hard, so the planner is greedy. This does not
   * assert optimality - it measures the gap, and fails only if greedy is ever
   * *worse than a fixed tolerance*, which would mean the heuristic is bad
   * rather than merely inexact.
   */
  let instances = 0;
  let greedyTotal = 0;
  let bestTotal = 0;

  for (let seed = 1; seed <= 300 && instances < 40; seed++) {
    const { inst, permitted, protectedSet } = setup(seed);
    if (protectedSet.size === 0) continue;

    const admissible = inst.facts.filter((f) =>
      (inst.requiredByFact.get(f.id) ?? f.requiredSpaces).every((s) => permitted.has(s)),
    );
    if (admissible.length === 0 || admissible.length > 13) continue;

    const reachable = deriveClosure(admissible).claims;
    if (![...reachable].some((k) => protectedSet.has(k))) continue; // constraint idle

    const result = plan({
      candidates: inst.facts,
      requiredByFact: inst.requiredByFact,
      permitted,
      protectedSet,
    });

    /* Largest safe subset, by enumeration. */
    let best = 0;
    for (let mask = 0; mask < 1 << admissible.length; mask++) {
      const subset = admissible.filter((_, i) => mask & (1 << i));
      if (subset.length <= best) continue;
      const claims = deriveClosure(subset).claims;
      let clean = true;
      for (const key of claims) if (protectedSet.has(key)) { clean = false; break; }
      if (clean) best = subset.length;
    }

    greedyTotal += result.disclosed.length;
    bestTotal += best;
    instances++;

    assert.ok(
      result.disclosed.length <= best,
      `seed ${seed}: greedy kept ${result.disclosed.length}, more than the true maximum ${best}`,
    );
  }

  assert.ok(instances >= 5, `too few binding instances to measure a gap (${instances})`);
  const ratio = bestTotal > 0 ? greedyTotal / bestTotal : 1;
  console.log(
    `      greedy retains ${(ratio * 100).toFixed(1)}% of the optimal subset over ${instances} binding instances`,
  );
  assert.ok(ratio >= 0.6, `greedy is far from optimal (${(ratio * 100).toFixed(1)}%)`);
});
