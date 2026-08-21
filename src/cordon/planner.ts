/**
 * Inference-safe disclosure planning.
 *
 * Cordon's original rule decides one fact at a time: `req(f) ⊆ perm(p)`.
 * docs/INFERENCE.md shows why that is not enough - **what an answer leaks is a
 * property of the set, not of its members.** Every fact in a reply can be
 * individually admissible while the reply as a whole re-derives something the
 * asker was refused. Per-fact checking cannot see that, because the dangerous
 * object never appears in the list being checked.
 *
 * So the decision has to be made over the set:
 *
 *     choose D ⊆ Admissible(p)
 *     maximising utility(D)
 *     subject to  closure(D) ∩ Protected(p) = ∅
 *
 * where `closure` is the same rule engine an adversary would run (closure.ts)
 * and `Protected(p)` is the set of derived claims p was denied.
 *
 * ## Why this is affordable, when the global result says it is not
 *
 * The inference audit prices *global* content confidentiality at 37.7% of an
 * asker's readable evidence, which would be an unshippable tax. The number is
 * that large because it assumes an adversary who has aggregated **everything**
 * they are entitled to.
 *
 * A single answer is not that. A top-20 result set has a small closure, so the
 * constraint usually binds on nothing at all and costs nothing. Cordon can
 * afford to be safe against the adversary who is *reading an answer* long
 * before it can afford to be safe against the adversary who has read the whole
 * corpus. `npm run audit:planner` measures both, side by side.
 *
 * ## Why per-query safety is not enough either
 *
 * Because it does not compose. Ten individually-safe answers can jointly
 * rebuild a protected claim - that is exactly the aggregation attack, moved
 * from documents to sessions. A planner that only ever looks at the current
 * reply is safe against a reader and useless against an attacker, who will
 * simply ask twice.
 *
 * `DisclosureLedger` closes that: it accumulates what a principal has actually
 * been shown, and the constraint is evaluated over the accumulation rather than
 * the current reply. Safety degrades gracefully into a budget - the asker keeps
 * getting answers until their own history starts to determine something they
 * were refused, and then, precisely then, Cordon starts withholding.
 */

import { deriveClosure, claimOf, type ClaimKey } from './closure.js';
import type { FactNode } from './model.js';

/** Does this requirement fit inside what the asker may read? */
function fits(required: readonly string[], permitted: ReadonlySet<string>): boolean {
  for (const space of required) if (!permitted.has(space)) return false;
  return true;
}

/**
 * The claims this principal was refused, and must therefore not be able to
 * rebuild. Level-0 facts are excluded: they assert verbatim text, which is not
 * reachable by inference, only by disclosure.
 */
export function protectedClaims(
  facts: readonly FactNode[],
  requiredByFact: ReadonlyMap<string, readonly string[]>,
  permitted: ReadonlySet<string>,
): Set<ClaimKey> {
  const out = new Set<ClaimKey>();
  for (const fact of facts) {
    if (fact.level === 0) continue;
    if (fits(requiredByFact.get(fact.id) ?? fact.requiredSpaces, permitted)) continue;
    const key = claimOf(fact);
    if (key) out.add(key);
  }
  return out;
}

/* ------------------------------------------------------------------ ledger */

/**
 * What a principal has been shown, across queries.
 *
 * Per-query safety does not compose; this is what makes the guarantee hold over
 * a session rather than over a single reply. Deliberately append-only: a
 * disclosure cannot be taken back, so the safe accounting is one that never
 * forgets. Reclaiming budget requires the operator to reset it explicitly, and
 * that shows up in the audit log as the decision it is.
 */
export class DisclosureLedger {
  private readonly shown = new Map<string, FactNode>();
  private queries = 0;

  /** Facts already disclosed to this principal. */
  facts(): FactNode[] {
    return [...this.shown.values()];
  }

  record(facts: readonly FactNode[]): void {
    this.queries++;
    for (const fact of facts) this.shown.set(fact.id, fact);
  }

  get size(): number {
    return this.shown.size;
  }

  get queryCount(): number {
    return this.queries;
  }

  /** The claims this principal's own history already determines. */
  closure(): Set<ClaimKey> {
    return deriveClosure(this.facts()).claims;
  }

  reset(): void {
    this.shown.clear();
    this.queries = 0;
  }
}

/* ----------------------------------------------------------------- planning */

export interface PlanInput {
  /** Retrieved candidates, **in utility order**: best first. */
  candidates: readonly FactNode[];
  requiredByFact: ReadonlyMap<string, readonly string[]>;
  permitted: ReadonlySet<string>;
  /** Claims the asker was refused and must not rebuild. */
  protectedSet: ReadonlySet<ClaimKey>;
  /** Prior disclosures, when the guarantee is to hold across a session. */
  ledger?: DisclosureLedger;
}

export interface Suppression {
  fact: FactNode;
  /** The protected claim its inclusion would have completed. */
  wouldComplete: ClaimKey[];
}

export interface Plan {
  /** Safe to hand over. */
  disclosed: FactNode[];
  /** Refused by the per-fact rule: the asker lacks provenance. */
  inadmissible: FactNode[];
  /** Admissible, and withheld anyway because the *set* would have leaked. */
  suppressed: Suppression[];
  /** Protected claims the unplanned answer would have re-derived. */
  violations: ClaimKey[];
  /** Whether the final plan satisfies the constraint. Always verified. */
  safe: boolean;
  stats: {
    candidates: number;
    admissible: number;
    disclosed: number;
    suppressedForInference: number;
    closureSize: number;
    /** Utility retained: disclosed / admissible. */
    retention: number;
  };
}

/** Protected claims re-derivable from this set, given the session history. */
function violationsOf(
  disclosed: readonly FactNode[],
  prior: readonly FactNode[],
  protectedSet: ReadonlySet<ClaimKey>,
): ClaimKey[] {
  const closure = deriveClosure([...prior, ...disclosed]);
  const out: ClaimKey[] = [];
  for (const key of closure.claims) if (protectedSet.has(key)) out.push(key);
  return out;
}

/**
 * Plan a disclosure.
 *
 * The subset choice is greedy from the low-utility end: while the set still
 * re-derives something protected, drop the lowest-ranked fact whose removal
 * actually reduces the violation, preferring to sacrifice the least useful
 * evidence. Exact maximisation is a covering problem and NP-hard, so this is a
 * heuristic and is labelled one - `audit:planner` reports the measured gap
 * against brute force on instances small enough to enumerate, rather than
 * claiming an optimality it does not have.
 *
 * What is *not* heuristic is the safety of the result: the returned plan is
 * re-checked against the rule engine before it is handed back, and `safe`
 * reports that check rather than the reasoning that produced it.
 */
export function plan(input: PlanInput): Plan {
  const { candidates, requiredByFact, permitted, protectedSet } = input;
  const prior = input.ledger?.facts() ?? [];

  const admissible: FactNode[] = [];
  const inadmissible: FactNode[] = [];
  for (const fact of candidates) {
    if (fits(requiredByFact.get(fact.id) ?? fact.requiredSpaces, permitted)) admissible.push(fact);
    else inadmissible.push(fact);
  }

  const initial = violationsOf(admissible, prior, protectedSet);

  let kept = [...admissible];
  const suppressed: Suppression[] = [];
  let current = initial;

  while (current.length > 0 && kept.length > 0) {
    let dropIndex = -1;

    /* Lowest utility first: sacrifice the least useful evidence that helps. */
    for (let i = kept.length - 1; i >= 0; i--) {
      const trial = kept.filter((_, j) => j !== i);
      if (violationsOf(trial, prior, protectedSet).length < current.length) {
        dropIndex = i;
        break;
      }
    }

    /*
     * No single removal helps, which happens when several facts jointly carry
     * the derivation. Drop the lowest-ranked one and continue; the loop
     * terminates because `kept` strictly shrinks.
     */
    if (dropIndex === -1) dropIndex = kept.length - 1;

    const fact = kept[dropIndex]!;
    kept = kept.filter((_, j) => j !== dropIndex);
    const after = violationsOf(kept, prior, protectedSet);
    suppressed.push({
      fact,
      wouldComplete: current.filter((k) => !after.includes(k)),
    });
    current = after;
  }

  /* Verification, not assertion: re-check the plan we are about to return. */
  const finalViolations = violationsOf(kept, prior, protectedSet);
  const closure = deriveClosure([...prior, ...kept]);

  return {
    disclosed: kept,
    inadmissible,
    suppressed,
    violations: initial,
    safe: finalViolations.length === 0,
    stats: {
      candidates: candidates.length,
      admissible: admissible.length,
      disclosed: kept.length,
      suppressedForInference: suppressed.length,
      closureSize: closure.claims.size,
      retention: admissible.length > 0 ? kept.length / admissible.length : 1,
    },
  };
}
