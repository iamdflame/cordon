/**
 * The inference channel: what an asker can rebuild from what they were given.
 *
 * Cordon's soundness theorem is about *provenance*. It proves that a disclosed
 * fact rests only on sources the asker may read. That is a real property and it
 * is proved by induction in docs/SOUNDNESS.md.
 *
 * It is not the property a security reviewer actually cares about.
 *
 * What they care about is *content*: at the end of the interaction, does the
 * asker know the restricted thing? Those two properties are not the same, and
 * conflating them is the mistake this module exists to catch - in our own
 * system, because we made it.
 *
 * The attack is embarrassingly cheap. Cordon's derivation rules are
 * deterministic and they are in this repository under Apache-2.0. Kerckhoffs's
 * principle applies with unusual force: the adversary does not need to guess
 * the rules, they can `git clone` them. So the adversary takes the facts Cordon
 * *did* hand them and runs those same rules to fixpoint. Anything that falls
 * out was never protected, whatever the requirement said.
 *
 *     Denied(p)  =  { f : req(f) is not a subset of perm(p) }
 *     Rebuilt(p) =  closure of Cordon's own rules over Permitted(p)
 *
 *     phantom(p)   = Denied(p) INTERSECT Rebuilt(p)   <- denial buys nothing
 *     effective(p) = Denied(p) MINUS     Rebuilt(p)   <- denial is real
 *
 * A phantom denial is worse than no denial. It costs the asker an answer, costs
 * the operator a support ticket, and returns nothing - while showing up in a
 * dashboard as protection. It is a lie the system tells its owner.
 *
 * Two things follow, and the second is the useful one:
 *
 *   1. Depth 1 is tight. A level-1 fact names every space its subject works in,
 *      and an asker who cannot see one of those spaces cannot observe that
 *      subject there, so they cannot rebuild the claim. The rule is exactly as
 *      strong as it needs to be.
 *
 *   2. Depth 2 and 3 are not. `pair:A:B` asserts "people work across A and B" -
 *      a claim about A and B and nothing else - but inherits the requirement of
 *      the level-1 facts under it, which name every *other* space those people
 *      touch. So Cordon demands five spaces to read a claim that two spaces are
 *      sufficient to derive. Everyone holding exactly {A, B} is denied a fact
 *      they can rebuild from level-0 evidence they are entitled to.
 *
 * That over-restriction came from a real fix. An earlier build declared
 * `req(pair:A:B) = {A, B}`, traversal found five, and we corrected it upward -
 * correctly, because under-stating a requirement fails open. The correction was
 * right for provenance and bought exactly nothing for content. Both facts are
 * worth publishing.
 *
 * Closing the channel is a *cut*, not a stronger requirement. To stop an asker
 * rebuilding a claim you have to withhold enough of what they legitimately hold
 * that the derivation no longer fires - which means denying facts they are
 * entitled to. `minimumCut` computes the cheapest such set exactly.
 *
 * That price is the honest headline. Provenance confidentiality is free; we
 * measured it and it costs 0.000 F1. Content confidentiality is not free, and
 * a system that claims otherwise has not measured it.
 */

import type { FactNode } from './model.js';

/* ------------------------------------------------------------------ claims */

/**
 * What a fact *asserts*, independent of which node carries it.
 *
 * The unit of an inference channel is the claim, not the id. If the adversary
 * arrives at "A and B share staff" by their own route, it is irrelevant that
 * they never touched node `d:pair:A:B`. Comparing ids would score that as a
 * successful defence, which is precisely the tautology trap documented in
 * SOUNDNESS.md - a check that compares a thing to itself.
 *
 * Canonical form, matching what the pipeline emits in facts.ts:
 *
 *   person  |<entity>|<space>,<space>,...   spaces sorted
 *   pair    |<a>|<b>                        endpoints sorted
 *   cluster |<a>|<b>|<c>                    members sorted
 */
export type ClaimKey = string;

export const claim = {
  person: (entity: string, spaces: Iterable<string>): ClaimKey =>
    `person|${entity}|${[...new Set(spaces)].sort().join(',')}`,
  pair: (a: string, b: string): ClaimKey => `pair|${[a, b].sort().join('|')}`,
  cluster: (members: Iterable<string>): ClaimKey =>
    `cluster|${[...new Set(members)].sort().join('|')}`,
};

/**
 * The claim a derived fact carries, read off its id.
 *
 * Ids are content-addressed by construction (`ids.derived` in model.ts), which
 * is what makes this a lookup rather than a guess. Level-0 facts assert a
 * verbatim sentence and are not reachable by inference, so they have no claim.
 */
export function claimOf(fact: FactNode): ClaimKey | undefined {
  if (fact.level === 0) return undefined;

  const body = fact.id.startsWith('d:') ? fact.id.slice(2) : fact.id;

  if (body.startsWith('person:')) {
    return claim.person(body.slice('person:'.length), fact.requiredSpaces);
  }
  if (body.startsWith('pair:')) {
    const [a, b] = body.slice('pair:'.length).split(':');
    return a && b ? claim.pair(a, b) : undefined;
  }
  if (body.startsWith('cluster:')) {
    return claim.cluster(body.slice('cluster:'.length).split('|'));
  }
  return undefined;
}

/* ------------------------------------------------------------- the adversary */

export interface ReconstructionInput {
  /** Every fact in the graph, level 0 and derived. */
  facts: readonly FactNode[];
  /** Fact id -> the requirement, ideally recomputed by traversal. */
  requiredByFact: ReadonlyMap<string, readonly string[]>;
  /** The asker's readable spaces. */
  permitted: ReadonlySet<string>;
}

export interface Reconstruction {
  /** Every claim the asker can reach without being told it. */
  claims: Set<ClaimKey>;
  /** Fact ids Cordon actually disclosed - the adversary's starting hand. */
  held: Set<string>;
  /** Claims arrived at by running the rules, not by being handed the fact. */
  inferred: Set<ClaimKey>;
}

/** Does this requirement fit inside what the asker may read? */
function fits(required: readonly string[], permitted: ReadonlySet<string>): boolean {
  for (const space of required) if (!permitted.has(space)) return false;
  return true;
}

/**
 * Mirror of facts.ts, applied to the adversary's hand.
 *
 * The rules below are not an approximation of Cordon's derivation - they are
 * the same rules, re-expressed over a restricted input. That is the point. An
 * adversary running weaker rules would give us a flatteringly small number, and
 * an adversary running *stronger* rules (an LLM, say, guessing at prose) would
 * give us one we could not defend. Reusing our own published rules is the
 * measurement we can stand behind.
 *
 * Where the rules cap (six spaces per person fact, six supports per pairing)
 * the adversary caps identically, and a claim counts as rebuilt only on an
 * exact match. Both choices *under*-count the channel. For a number we are
 * publishing about our own weakness, under-claiming is the direction that
 * cannot be accused of theatre in the other direction: the true channel is at
 * least this wide.
 */
export function reconstruct(input: ReconstructionInput): Reconstruction {
  const { facts, requiredByFact, permitted } = input;

  const disclosed = facts.filter((f) =>
    fits(requiredByFact.get(f.id) ?? f.requiredSpaces, permitted),
  );
  const closure = deriveClosure(disclosed);
  return { claims: closure.claims, inferred: closure.inferred, held: closure.held };
}

/**
 * The rule engine, over an explicit set of facts.
 *
 * `reconstruct` asks "what can this principal rebuild from everything they may
 * see" - the right question for an audit. The query planner asks a different
 * one: "what can they rebuild from the handful of facts I am about to put in
 * this answer". Same rules, different input, so the rules live here and both
 * callers wrap them.
 *
 * That distinction is the whole basis of inference-safe planning. An adversary
 * who has aggregated everything they are entitled to is powerful; an adversary
 * holding one answer is not. Cordon can afford to be safe against the second
 * long before it can afford to be safe against the first.
 */
export function deriveClosure(disclosed: readonly FactNode[]): Reconstruction {
  const held = new Set<string>();
  const claims = new Set<ClaimKey>();

  const level0ByEntity = new Map<string, Set<string>>();
  for (const fact of disclosed) {
    held.add(fact.id);
    const own = claimOf(fact);
    if (own) claims.add(own);

    if (fact.level !== 0) continue;
    for (const entity of fact.entities) {
      const spaces = level0ByEntity.get(entity);
      if (spaces) spaces.add(fact.space);
      else level0ByEntity.set(entity, new Set([fact.space]));
    }
  }

  const inferred = new Set<ClaimKey>();
  const note = (key: ClaimKey) => {
    if (!claims.has(key)) inferred.add(key);
    claims.add(key);
  };

  /*
   * Depth 1. A subject observed in two or more spaces yields the cross-space
   * person claim - the level-1 rule, over permitted evidence only.
   *
   * This is where the rule turns out to be tight. The adversary can only name
   * spaces they can see, so the set they arrive at is a subset of Cordon's, and
   * it matches exactly only when they could read every space in it - at which
   * point the fact was admissible anyway and nothing was denied.
   */
  const personSpaces = new Map<string, string[]>();
  for (const [entity, spaces] of level0ByEntity) {
    if (spaces.size < 2) continue;
    const capped = [...spaces].slice(0, 6);
    personSpaces.set(entity, capped);
    note(claim.person(entity, capped));
  }

  /*
   * Depth 2. Two or more subjects spanning the same two spaces yield the
   * pairing - and this is where the channel opens.
   *
   * `pair:A:B` asserts something about A and B alone. Cordon requires the union
   * of every space its supporting person facts touch. An asker holding exactly
   * {A, B} is refused, and then derives it in one step from level-0 facts they
   * were entitled to read all along.
   */
  const spanCount = new Map<ClaimKey, number>();
  for (const spaces of personSpaces.values()) {
    const sorted = [...new Set(spaces)].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = claim.pair(sorted[i]!, sorted[j]!);
        spanCount.set(key, (spanCount.get(key) ?? 0) + 1);
      }
    }
  }

  const adjacency = new Map<string, Set<string>>();
  for (const [key, count] of spanCount) {
    if (count < 2) continue; // the pipeline's own threshold: supports.length < 2
    note(key);
    const [, a, b] = key.split('|') as [string, string, string];
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  }

  /*
   * Depth 3. A triangle of pairings yields the cluster. Same shape as depth 2,
   * one level up, and phantom for the same reason: three spaces are enough to
   * derive a claim about three spaces, however many the requirement names.
   */
  const seen = new Set<ClaimKey>();
  for (const [a, neighbours] of adjacency) {
    const list = [...neighbours].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const b = list[i]!;
        const cc = list[j]!;
        if (!adjacency.get(b)?.has(cc)) continue;
        const key = claim.cluster([a, b, cc]);
        if (seen.has(key)) continue;
        seen.add(key);
        note(key);
      }
    }
  }

  return { claims, held, inferred };
}

/* ------------------------------------------------------------------- the cut */

/**
 * Closing an inference channel is a cut, not a stronger requirement.
 *
 * This is the part that took us longest to accept. The instinct on finding a
 * phantom denial is to raise the requirement - and it does nothing, because the
 * asker is not going through the front door. They are rebuilding the claim from
 * evidence they are *entitled* to. No requirement on the derived node can reach
 * that evidence.
 *
 * The only way to stop the derivation firing is to withhold enough of the
 * asker's legitimate evidence that it no longer fires. That is a minimum vertex
 * cut on the derivation hypergraph, and it means **denying facts the asker has
 * every right to read**. There is no version of this that is free.
 *
 * The structure decomposes exactly, so we do not have to approximate:
 *
 *   span(e,a,b)   AND of two ORs   cut = min(|facts(e,a)|, |facts(e,b)|)
 *   pair(a,b)     >=2 of n spans   cut = sum(costs) - max(cost)
 *                                        (leave the dearest span standing;
 *                                         one is below the threshold)
 *   cluster(a,b,c)  all 3 pairs    cut = min over the three pair costs
 *
 * Each is a minimum over its own subproblem and each is optimal by exchange
 * argument. `test/closure.test.ts` checks them against brute force over small
 * instances, because an optimality claim asserted in a comment is not one.
 */

export interface CutInput {
  facts: readonly FactNode[];
  requiredByFact: ReadonlyMap<string, readonly string[]>;
  permitted: ReadonlySet<string>;
}

export interface Cut {
  /** Level-0 fact ids to additionally withhold. All are ones the asker may read. */
  withhold: Set<string>;
  /** Size of the cut. Infinity when no cut of level-0 evidence can close it. */
  cost: number;
}

interface SpanCost {
  entity: string;
  cost: number;
  /** The cheaper side's fact ids: withholding these kills the span. */
  withhold: string[];
}

/** Permitted level-0 evidence, indexed as the adversary would index it. */
function evidence(input: CutInput): Map<string, Map<string, string[]>> {
  const byEntity = new Map<string, Map<string, string[]>>();
  for (const fact of input.facts) {
    if (fact.level !== 0) continue;
    const required = input.requiredByFact.get(fact.id) ?? fact.requiredSpaces;
    if (!fits(required, input.permitted)) continue;
    for (const entity of fact.entities) {
      const bySpace = byEntity.get(entity) ?? byEntity.set(entity, new Map()).get(entity)!;
      const list = bySpace.get(fact.space);
      if (list) list.push(fact.id);
      else bySpace.set(fact.space, [fact.id]);
    }
  }
  return byEntity;
}

/** Cheapest way to stop the asker observing `entity` in both `a` and `b`. */
function spanCut(
  byEntity: Map<string, Map<string, string[]>>,
  entity: string,
  a: string,
  b: string,
): SpanCost | undefined {
  const bySpace = byEntity.get(entity);
  const inA = bySpace?.get(a);
  const inB = bySpace?.get(b);
  if (!inA?.length || !inB?.length) return undefined; // span already absent
  const cheaper = inA.length <= inB.length ? inA : inB;
  return { entity, cost: cheaper.length, withhold: cheaper };
}

/** Every subject the asker can observe in both `a` and `b`. */
function spansOf(byEntity: Map<string, Map<string, string[]>>, a: string, b: string): SpanCost[] {
  const out: SpanCost[] = [];
  for (const entity of byEntity.keys()) {
    const cut = spanCut(byEntity, entity, a, b);
    if (cut) out.push(cut);
  }
  return out;
}

/**
 * Drive the pairing below its threshold.
 *
 * The rule fires at two or more spanning subjects, so one may remain. Keeping
 * the most expensive one and cutting the rest is optimal: any other choice
 * retains a cheaper span and therefore pays more.
 */
function pairCut(byEntity: Map<string, Map<string, string[]>>, a: string, b: string): Cut {
  const spans = spansOf(byEntity, a, b);
  if (spans.length < 2) return { withhold: new Set(), cost: 0 }; // already below threshold

  let dearest = 0;
  for (const span of spans) if (span.cost > dearest) dearest = span.cost;

  const withhold = new Set<string>();
  let skipped = false;
  let cost = 0;
  for (const span of spans) {
    if (!skipped && span.cost === dearest) {
      skipped = true; // the one we let stand
      continue;
    }
    cost += span.cost;
    for (const id of span.withhold) withhold.add(id);
  }
  return { withhold, cost };
}

/**
 * The minimum set of otherwise-readable facts that must also be withheld before
 * a denial of `target` is real rather than nominal.
 */
export function minimumCut(input: CutInput, target: ClaimKey): Cut {
  const byEntity = evidence(input);
  const parts = target.split('|');
  const kind = parts[0];

  if (kind === 'pair') {
    const [, a, b] = parts as [string, string, string];
    return pairCut(byEntity, a, b);
  }

  if (kind === 'cluster') {
    const [, a, b, cc] = parts as [string, string, string, string];
    /* The triangle needs all three edges, so breaking the cheapest suffices. */
    let best: Cut = { withhold: new Set(), cost: Number.POSITIVE_INFINITY };
    for (const [x, y] of [
      [a, b],
      [a, cc],
      [b, cc],
    ] as Array<[string, string]>) {
      const cut = pairCut(byEntity, x, y);
      if (cut.cost < best.cost) best = cut;
    }
    return best;
  }

  if (kind === 'person') {
    /*
     * Depth 1 is tight, so a person claim is only ever rebuilt when it was
     * admissible anyway. Reaching here means the caller found a phantom we did
     * not predict, and the honest answer is a cut we have not derived rather
     * than a zero that looks like success.
     */
    return { withhold: new Set(), cost: Number.POSITIVE_INFINITY };
  }

  return { withhold: new Set(), cost: Number.POSITIVE_INFINITY };
}

/**
 * Verification, not assertion.
 *
 * Re-runs the adversary with the cut applied and reports whether the target is
 * still reachable. The audit calls this on every cut it computes: a defence
 * that is only ever checked against the reasoning that produced it is the same
 * tautology SOUNDNESS.md was written to avoid.
 */
export function cutHolds(input: ReconstructionInput, target: ClaimKey, cut: Cut): boolean {
  const surviving = input.facts.filter((f) => !cut.withhold.has(f.id));
  return !reconstruct({ ...input, facts: surviving }).claims.has(target);
}
