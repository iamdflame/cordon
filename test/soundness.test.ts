/**
 * Property-based soundness.
 *
 * The real bug this test exists to prevent: our first invariant check compared
 * `admissible(required)` against `admissible(required)` - the same value twice.
 * It could not have failed and it passed for hours.
 *
 * A generative test is the structural answer to that class of mistake. It
 * cannot be satisfied by an accidental tautology, because it constructs
 * derivation graphs the author did not think of and asserts the theorem's
 * conclusion directly:
 *
 *     disclosed(f, p)  =>  every source under f sits in a space p may read
 *
 * Note what the assertion is *about*. It does not compare a requirement to a
 * requirement. It walks to the leaves and checks the spaces of the actual
 * sources, which is the thing the security claim is really about.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admissible, type PermissionModel } from '../src/cordon/acl.js';
import type { FactNode } from '../src/cordon/model.js';

/** Deterministic PRNG: a property test that cannot be replayed is not evidence. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Generated {
  facts: Map<string, FactNode>;
  /** source id -> the one space it belongs to. */
  sourceSpace: Map<string, string>;
  permissions: PermissionModel;
  principals: string[];
}

/**
 * A random derivation DAG.
 *
 * Facts are emitted in level order and may only rest on strictly lower levels,
 * which is how the pipeline builds them and what makes `req` well defined.
 */
function generate(seed: number): Generated {
  const random = makeRandom(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!;

  const spaceCount = 2 + Math.floor(random() * 6);
  const spaces = Array.from({ length: spaceCount }, (_, i) => `space-${i}`);

  const sourceCount = 3 + Math.floor(random() * 20);
  const sourceSpace = new Map<string, string>();
  for (let i = 0; i < sourceCount; i++) sourceSpace.set(`s:src-${i}`, pick(spaces));

  const facts = new Map<string, FactNode>();
  const byLevel = new Map<number, string[]>();

  // Level 0: one source each.
  for (const [sourceId, space] of sourceSpace) {
    const id = `f0-${sourceId}`;
    facts.set(id, {
      id,
      text: id,
      restsOn: [sourceId],
      level: 0,
      entities: [],
      space,
      requiredSpaces: [space],
    });
    const list = byLevel.get(0);
    if (list) list.push(id);
    else byLevel.set(0, [id]);
  }

  const maxLevel = 1 + Math.floor(random() * 4);
  for (let level = 1; level <= maxLevel; level++) {
    const below: string[] = [];
    for (let l = 0; l < level; l++) below.push(...(byLevel.get(l) ?? []));
    if (below.length < 2) break;

    const count = 1 + Math.floor(random() * 6);
    for (let i = 0; i < count; i++) {
      const arity = 2 + Math.floor(random() * 3);
      const supports = new Set<string>();
      for (let a = 0; a < arity; a++) supports.add(pick(below));
      if (supports.size < 2) continue;

      // Occasionally rest directly on a raw source too, mixing the two kinds -
      // that mixture is exactly what RESTS_ON being one edge type allows.
      if (random() < 0.3) supports.add(pick([...sourceSpace.keys()]));

      const required = new Set<string>();
      for (const support of supports) {
        if (support.startsWith('s:')) required.add(sourceSpace.get(support)!);
        else for (const space of facts.get(support)!.requiredSpaces) required.add(space);
      }

      const id = `f${level}-${i}`;
      facts.set(id, {
        id,
        text: id,
        restsOn: [...supports],
        level,
        entities: [],
        // Deliberately arbitrary, and deliberately *not* the whole requirement:
        // `space` is the field a document-level gate would read, and nothing in
        // the theorem may depend on it.
        space: [...required][Math.floor(random() * required.size)]!,
        requiredSpaces: [...required],
      });
      const list = byLevel.get(level);
      if (list) list.push(id);
      else byLevel.set(level, [id]);
    }
  }

  const principalCount = 2 + Math.floor(random() * 8);
  const readable = new Map<string, Set<string>>();
  const principals: string[] = [];
  for (let i = 0; i < principalCount; i++) {
    const id = `p-${i}`;
    principals.push(id);
    const held = new Set<string>();
    for (const space of spaces) if (random() < 0.5) held.add(space);
    readable.set(id, held);
  }

  const permissions = {
    readable,
    ranked: principals.map((principal) => ({ principal, spaces: readable.get(principal)!.size })),
  } as unknown as PermissionModel;

  return { facts, sourceSpace, permissions, principals };
}

/** Every source reachable from a fact, by walking supports to the leaves. */
function closure(facts: Map<string, FactNode>, id: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  const fact = facts.get(id);
  if (!fact) return out;
  for (const support of fact.restsOn) {
    if (support.startsWith('s:')) out.add(support);
    else for (const deeper of closure(facts, support, seen)) out.add(deeper);
  }
  return out;
}

test('soundness holds over random derivation graphs', () => {
  let disclosures = 0;
  let checkedPairs = 0;

  for (let seed = 1; seed <= 300; seed++) {
    const { facts, sourceSpace, permissions, principals } = generate(seed);

    for (const fact of facts.values()) {
      for (const principal of principals) {
        checkedPairs++;
        if (!admissible(permissions, principal, fact.requiredSpaces)) continue;
        disclosures++;

        const held = permissions.readable.get(principal)!;
        for (const source of closure(facts, fact.id)) {
          const space = sourceSpace.get(source)!;
          assert.ok(
            held.has(space),
            `seed ${seed}: disclosed ${fact.id} to ${principal}, but it rests on ` +
              `${source} in ${space}, which ${principal} cannot read`,
          );
        }
      }
    }
  }

  // A test that never disclosed anything would pass vacuously, which is the
  // same failure as the tautological check it exists to prevent.
  assert.ok(disclosures > 1000, `too few disclosures exercised: ${disclosures}`);
  assert.ok(checkedPairs > 10000, `too few pairs checked: ${checkedPairs}`);
});

test('under-stating a requirement is caught, i.e. the test can fail', () => {
  /*
   * The counterpart to the assertion above. If the property test cannot detect
   * a deliberately broken requirement, it is not testing anything - so break
   * one on purpose and assert that it is caught.
   */
  const { facts, sourceSpace, permissions, principals } = generate(7);

  const derived = [...facts.values()].find((f) => f.level > 0 && f.requiredSpaces.length > 1);
  assert.ok(derived, 'generator produced no multi-space derived fact');

  // Declare only the first required space - the mistake level 2 actually made.
  derived.requiredSpaces = [derived.requiredSpaces[0]!];

  let caught = false;
  for (const principal of principals) {
    if (!admissible(permissions, principal, derived.requiredSpaces)) continue;
    const held = permissions.readable.get(principal)!;
    for (const source of closure(facts, derived.id)) {
      if (!held.has(sourceSpace.get(source)!)) caught = true;
    }
  }

  assert.ok(caught, 'an under-stated requirement went undetected: the property test is vacuous');
});
