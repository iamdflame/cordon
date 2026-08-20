/**
 * The aggregation attack, formally.
 *
 * Document-level filtering cannot defend against aggregation even in
 * principle, because the thing being aggregated is not a document. Cordon can
 * reason about it, because derivation is an edge in the graph rather than a
 * property of a file. This module states exactly what the attack is, so the
 * mining in `mine.ts` is measuring something with a definition rather than
 * something we recognised by eye.
 *
 * ## Notation
 *
 *   sources(f)    = { s : f -[:RESTS_ON*1..k]-> s, s:Source }
 *   required(f)   = { space(s) : s in sources(f) }
 *   permitted(p)  = { sp : p -[:MEMBER_OF]-> sp }
 *                 U { sp : p -[:MANAGES*]-> q -[:MEMBER_OF]-> sp }
 *   entitled(p,f) <=> required(f) subset-of permitted(p)
 *
 * ## Theorem 1 — derivation-path aggregation is impossible
 *
 * If p is entitled to every g in supports(f), then p is entitled to f.
 *
 *   Proof. required(f) = U required(g) over g in supports(f), by construction.
 *   Each required(g) is a subset of permitted(p) by assumption. A union of
 *   subsets of permitted(p) is a subset of permitted(p). Hence
 *   required(f) subset-of permitted(p), i.e. entitled(p, f).  []
 *
 * This is worth stating because it rules out the obvious attack and forces the
 * real one to come from somewhere else. An attacker cannot walk up the
 * derivation edges: holding all the parts of a conclusion already entitles you
 * to the conclusion.
 *
 * ## The real attack — content determination
 *
 * The parts an attacker actually holds need not be *supports* of f. They only
 * need to assert the same things f asserts.
 *
 * Decompose a fact into the atomic claims it makes, read as "e is present in
 * sp". Cordon's facts are set-valued - "Bob is active across A, C, I, V" - so
 * the decomposition is natural.
 *
 * **The claims must be read out of the fact's text, not computed from
 * `required(f)`.** Our first attempt defined
 * `claims(f) = entities(f) x required(f)`, which makes Theorem 2's premise true
 * by construction and the whole measurement a tautology - the same failure mode
 * as the invariant check that compared a value to itself. So claims are
 * extracted independently: a fact claims (e, sp) when its text names both the
 * entity and the space. A level-0 fact additionally claims (e, space-of-its-
 * artifact), because the artifact demonstrably places that person there.
 *
 * The difference is the entire attack surface. A document in space B that says
 * "Bob is running the A migration" asserts (Bob, A) while requiring only {B} -
 * so someone holding B alone learns something about A.
 *
 * **Aggregation leak.** A triple (p, f, F) where
 *
 *   1. NOT entitled(p, f)                          - p may not be told f
 *   2. for every g in F, discloses(sys, p, g)      - the system hands p every g
 *   3. claims(f) subset-of U claims(g) for g in F  - F determines f
 *
 * Condition 2 is parameterised by the system under test, which is the whole
 * point: document-level filtering discloses far more than Cordon does, so it
 * admits triples Cordon does not.
 *
 * ## Theorem 2 — when Cordon is closed under aggregation too
 *
 * Say a corpus has **claim locality** if every atomic claim (e, sp) is only
 * ever asserted by facts requiring sp. Under claim locality, Cordon admits no
 * aggregation leaks:
 *
 *   Proof. Suppose (p, f, F) satisfied 1-3 under Cordon. Take any
 *   sp in required(f). Since entities(f) is non-empty, some (e, sp) is in
 *   claims(f), so by (3) some g in F has (e, sp) in claims(g). By claim
 *   locality sp is in required(g). By (2) and Cordon's rule
 *   required(g) subset-of permitted(p), so sp is in permitted(p). As sp was
 *   arbitrary, required(f) subset-of permitted(p) - contradicting (1).  []
 *
 * So whether Cordon is exposed is an **empirical question about the corpus**,
 * not a property of the rule. Claim locality fails exactly when a document in
 * one space discusses what is happening in another - which is common in real
 * corpora, and is why this has to be mined rather than argued.
 *
 * Measured (see docs/ATTACK.md):
 *
 *   HERB    claim locality holds exactly. Not one of 38,600 artifacts names a
 *           space other than its own, because HERB is generated per product.
 *           Cordon therefore admits zero aggregation leaks on it - and that
 *           zero is a fact about the corpus as much as about the rule, which
 *           is why we verified the premise rather than asserting the theorem.
 *
 *   GitHub  claim locality fails, deliberately: the fixture contains the
 *           cross-project references real repositories are full of. That is
 *           where Cordon's exposure is measured rather than argued away.
 *
 * Everything above is checkable against `mine.ts`, which enumerates real
 * triples from the graph rather than constructing illustrative ones.
 */

import type { FactNode } from '../cordon/model.js';

/** An atomic assertion: "this entity is present in this space." */
export type Claim = string;

export function claimOf(entity: string, space: string): Claim {
  return `${entity}@${space}`;
}

/**
 * An index for reading claims out of text: space name -> space id, and a
 * matcher for each entity's surface forms.
 */
export interface ClaimVocabulary {
  /** Space id keyed by every name that denotes it. */
  spaceNames: Map<string, string>;
  /** Entity id -> the names it goes by, lowercased. */
  entityNames: Map<string, string[]>;
}

/**
 * The atomic claims a fact makes, read from its text.
 *
 * Deliberately *not* derived from `required(f)`. Computing claims from the
 * requirement would make claim locality true by construction and the
 * aggregation census meaningless - it would measure our own definition rather
 * than the corpus. See the header.
 *
 * `ownSpace` is supplied for level-0 facts: an artifact in space S that
 * mentions a person does place that person in S, whether or not the prose says
 * the word "S".
 */
export function claimsOf(
  fact: FactNode,
  vocabulary: ClaimVocabulary,
  ownSpace?: string,
): Claim[] {
  const out = new Set<Claim>();
  const haystack = fact.text.toLowerCase();

  /* Which spaces does this text name? */
  const named: string[] = [];
  for (const [name, spaceId] of vocabulary.spaceNames) {
    if (haystack.includes(name)) named.push(spaceId);
  }

  for (const entity of fact.entities) {
    // A level-0 fact's own space is claimed regardless of the prose.
    if (ownSpace) out.add(claimOf(entity, ownSpace));

    if (named.length === 0) continue;
    /*
     * Require the entity to actually appear in the text alongside the space.
     * `fact.entities` is the resolved set, which for a derived fact is
     * reliable; for a level-0 fact it comes from mention extraction over this
     * very text, so the check is nearly always satisfied and costs little.
     */
    const names = vocabulary.entityNames.get(entity) ?? [];
    const present = names.length === 0 || names.some((n) => haystack.includes(n));
    if (!present) continue;
    for (const spaceId of named) out.add(claimOf(entity, spaceId));
  }

  return [...out];
}

/**
 * Which system decided to hand a fact over.
 *
 * `cordon-claim-aware` is the mitigation the census motivated. Cordon's
 * requirement is the union of the spaces its *evidence* sits in; the attack
 * works through facts that **name** a space they do not rest on. So the fix is
 * to widen the requirement to include the spaces a fact talks about:
 *
 *   required'(f) = required(f) U { sp : f's text names sp }
 *
 * That restores claim locality by construction, and Theorem 2 then applies
 * unconditionally. It is not free - a fact merely mentioning a space now
 * requires it - and the census measures the cost alongside the benefit rather
 * than presenting the fix as pure gain.
 */
export type Gate = 'ungated' | 'document-acl' | 'cordon' | 'cordon-claim-aware';

/** Spaces a fact's text names, whether or not its evidence sits in them. */
export function spacesNamedIn(fact: FactNode, vocabulary: ClaimVocabulary): string[] {
  const haystack = fact.text.toLowerCase();
  const out: string[] = [];
  for (const [name, spaceId] of vocabulary.spaceNames) {
    if (haystack.includes(name)) out.push(spaceId);
  }
  return out;
}

export interface AggregationLeak {
  principal: string;
  /** The fact the principal may not be told. */
  factId: string;
  factText: string;
  factLevel: number;
  /** Spaces the fact requires, by traversal. */
  required: string[];
  /** Spaces the principal lacks. */
  missing: string[];
  /**
   * A minimal set of facts the system did disclose which together assert
   * everything the withheld fact asserts. Minimal by greedy set cover, so it is
   * small enough to read rather than a dump of every contributing fact.
   */
  witnesses: Array<{ id: string; text: string; level: number; space: string }>;
  /** claims(f) covered by the witness set, over |claims(f)|. */
  coverage: number;
}

/**
 * Greedy set cover over the witness candidates.
 *
 * Exact minimum set cover is NP-hard and we do not need the optimum - we need a
 * witness set small enough that a reader can check it by eye. Greedy is within
 * ln(n) of optimal and is deterministic, which matters more here than tightness.
 */
export function minimalWitnesses<T>(
  target: Set<Claim>,
  candidates: Array<{ item: T; claims: Set<Claim> }>,
): T[] {
  const remaining = new Set(target);
  const chosen: T[] = [];

  while (remaining.size > 0) {
    let best: { item: T; claims: Set<Claim> } | null = null;
    let bestGain = 0;
    for (const candidate of candidates) {
      let gain = 0;
      for (const claim of candidate.claims) if (remaining.has(claim)) gain++;
      if (gain > bestGain) {
        bestGain = gain;
        best = candidate;
      }
    }
    if (!best || bestGain === 0) break;
    chosen.push(best.item);
    for (const claim of best.claims) remaining.delete(claim);
  }

  return chosen;
}
