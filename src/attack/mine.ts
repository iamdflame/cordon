/**
 * Mine real aggregation leaks out of the graph.
 *
 * Nothing here is hand-crafted. Every triple reported is enumerated from the
 * derivation graph HERB produced, and any of them can be re-derived by a reader
 * who runs the miner. An illustrative example proves that the author can
 * imagine an attack; a mined census proves the attack is in the corpus.
 *
 * The definitions live in `model.ts`. In short: an aggregation leak is a fact a
 * principal may not be told, together with a set of facts the system *did* hand
 * them which jointly assert everything the withheld fact asserts.
 */

import { admissible, type PermissionModel } from '../cordon/acl.js';
import type { Corpus, FactNode } from '../cordon/model.js';
import {
  claimsOf,
  minimalWitnesses,
  spacesNamedIn,
  type AggregationLeak,
  type Claim,
  type ClaimVocabulary,
  type Gate,
} from './model.js';

/**
 * Build the vocabulary claims are read against.
 *
 * Space names are matched lowercased and as whole words where the id allows;
 * HERB's product names ("EdgeForce") and GitHub's repository names are
 * distinctive enough that substring matching does not produce false hits, and
 * a false hit here would *inflate* the measured attack surface, which is the
 * direction that flatters us least.
 */
export function buildVocabulary(corpus: Corpus): ClaimVocabulary {
  const spaceNames = new Map<string, string>();
  for (const space of corpus.spaces.values()) {
    spaceNames.set(space.id.toLowerCase(), space.id);
    if (space.name && space.name !== space.id) spaceNames.set(space.name.toLowerCase(), space.id);
  }

  const entityNames = new Map<string, string[]>();
  for (const employee of corpus.employees.values()) {
    const names = new Set<string>();
    if (employee.name) names.add(employee.name.toLowerCase());
    names.add(employee.id.toLowerCase());
    entityNames.set(employee.id, [...names]);
  }

  return { spaceNames, entityNames };
}

export interface MineInput {
  facts: FactNode[];
  permissions: PermissionModel;
  principals: string[];
  /** Required spaces per fact, by traversal. */
  requiredByFact: Map<string, string[]>;
  vocabulary: ClaimVocabulary;
  /** Artifact key -> space, so level-0 facts claim the space they were read in. */
  spaceOfFact: (fact: FactNode) => string | undefined;
  /** Cap on reported instances per gate, to keep the artifact readable. */
  keep?: number;
}

export interface GateCensus {
  gate: Gate;
  /** Facts this gate withholds that the evidence-only rule would disclose. */
  overRestricted: number;
  /** (principal, fact) pairs the principal was not entitled to. */
  denied: number;
  /** ...of which the system's own disclosures fully determine the fact. */
  leaks: number;
  leakRate: number;
  /** Mean share of a denied fact's claims recoverable from what was disclosed. */
  meanCoverage: number;
  /** Leaks broken down by the withheld fact's derivation depth. */
  byLevel: Record<number, number>;
  examples: AggregationLeak[];
}

/** Does this system hand this fact to this principal? */
function discloses(
  gate: Gate,
  fact: FactNode,
  principal: string,
  permissions: PermissionModel,
  required: string[],
  widened: string[],
): boolean {
  if (gate === 'ungated') return true;
  if (gate === 'document-acl') {
    // All a document-level gate can see is the space the fact is filed under.
    return permissions.readable.get(principal)?.has(fact.space) === true;
  }
  if (gate === 'cordon-claim-aware') return admissible(permissions, principal, widened);
  return admissible(permissions, principal, required);
}

export function mineAggregation(input: MineInput): GateCensus[] {
  const { facts, permissions, principals, requiredByFact } = input;
  const keep = input.keep ?? 8;

  /* Precompute claims once. Recomputing them per principal would turn this
   * into an hour-long job for no benefit. */
  const claimCache = new Map<string, Set<Claim>>();
  const requiredCache = new Map<string, string[]>();
  /* required'(f) for the claim-aware gate: evidence spaces plus named spaces. */
  const widenedCache = new Map<string, string[]>();
  for (const fact of facts) {
    const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
    requiredCache.set(fact.id, required);
    widenedCache.set(
      fact.id,
      [...new Set([...required, ...spacesNamedIn(fact, input.vocabulary)])],
    );
    claimCache.set(
      fact.id,
      new Set(claimsOf(fact, input.vocabulary, input.spaceOfFact(fact))),
    );
  }

  /*
   * Only derived facts can be aggregation *targets*. A level-0 fact asserts
   * exactly what one artifact says, so reconstructing it means reconstructing
   * the artifact - a different attack, and not one derived-knowledge access
   * control claims to stop.
   */
  const targets = facts.filter((f) => f.level >= 1 && (claimCache.get(f.id)?.size ?? 0) > 0);

  /*
   * Index candidate witnesses by claim. Scanning all 57k facts per (principal,
   * target) pair is ~10^10 operations; indexing makes it ~10^6.
   */
  const factsByClaim = new Map<Claim, FactNode[]>();
  for (const fact of facts) {
    for (const claim of claimCache.get(fact.id)!) {
      const list = factsByClaim.get(claim);
      if (list) list.push(fact);
      else factsByClaim.set(claim, [fact]);
    }
  }

  const census: GateCensus[] = [];

  for (const gate of ['ungated', 'document-acl', 'cordon', 'cordon-claim-aware'] as const) {
    let denied = 0;
    let leaks = 0;
    let coverageSum = 0;
    const byLevel: Record<number, number> = {};
    const examples: AggregationLeak[] = [];

    for (const principal of principals) {
      const permitted = permissions.readable.get(principal) ?? new Set<string>();

      for (const target of targets) {
        const required = requiredCache.get(target.id)!;
        // "Denied" always means denied under the *correct* rule. Whether a
        // particular gate would have handed it over directly is a different
        // question, already answered by the leak table.
        if (admissible(permissions, principal, required)) continue;
        denied++;

        const targetClaims = claimCache.get(target.id)!;

        /*
         * Candidate witnesses: facts this gate discloses to this principal
         * that assert at least one of the target's claims. Anything asserting
         * none of them cannot contribute to covering the target.
         */
        const seen = new Set<string>();
        const candidates: Array<{ item: FactNode; claims: Set<Claim> }> = [];
        const covered = new Set<Claim>();

        for (const claim of targetClaims) {
          for (const candidate of factsByClaim.get(claim) ?? []) {
            if (candidate.id === target.id || seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            const candidateRequired = requiredCache.get(candidate.id)!;
            if (
              !discloses(
                gate,
                candidate,
                principal,
                permissions,
                candidateRequired,
                widenedCache.get(candidate.id)!,
              )
            ) {
              continue;
            }
            const candidateClaims = claimCache.get(candidate.id)!;
            candidates.push({ item: candidate, claims: candidateClaims });
            for (const c of candidateClaims) if (targetClaims.has(c)) covered.add(c);
          }
        }

        const coverage = covered.size / targetClaims.size;
        coverageSum += coverage;
        if (coverage < 1) continue;

        leaks++;
        byLevel[target.level] = (byLevel[target.level] ?? 0) + 1;

        if (examples.length < keep) {
          const witnesses = minimalWitnesses(targetClaims, candidates);
          examples.push({
            principal,
            factId: target.id,
            factText: target.text,
            factLevel: target.level,
            required,
            missing: required.filter((s) => !permitted.has(s)),
            witnesses: witnesses.map((w) => ({
              id: w.id,
              text: w.text.slice(0, 200),
              level: w.level,
              space: w.space,
            })),
            coverage,
          });
        }
      }
    }

    /*
     * What the gate costs. For the claim-aware rule this is the number of
     * (fact, principal) pairs it now withholds that the evidence-only rule
     * would have allowed - the price of restoring claim locality.
     */
    let overRestricted = 0;
    if (gate === 'cordon-claim-aware') {
      for (const principal of principals) {
        for (const fact of facts) {
          const req = requiredCache.get(fact.id)!;
          if (!admissible(permissions, principal, req)) continue;
          if (!admissible(permissions, principal, widenedCache.get(fact.id)!)) overRestricted++;
        }
      }
    }

    census.push({
      gate,
      overRestricted,
      denied,
      leaks,
      leakRate: denied > 0 ? leaks / denied : 0,
      meanCoverage: denied > 0 ? coverageSum / denied : 0,
      byLevel,
      examples,
    });
  }

  return census;
}

/**
 * Does this corpus have claim locality?
 *
 * Theorem 2 in `model.ts` says Cordon admits no aggregation leaks on a corpus
 * where every claim (e, sp) is only ever asserted by facts requiring sp. That
 * is a property of the data, not of the rule, so it has to be checked rather
 * than assumed - and where it fails is exactly where Cordon is exposed.
 */
export function claimLocality(
  facts: FactNode[],
  requiredByFact: Map<string, string[]>,
  vocabulary: ClaimVocabulary,
  spaceOfFact: (fact: FactNode) => string | undefined,
): {
  total: number;
  local: number;
  violations: Array<{ claim: Claim; factId: string; factText: string; required: string[]; about: string }>;
} {
  const violations: Array<{
    claim: Claim;
    factId: string;
    factText: string;
    required: string[];
    about: string;
  }> = [];
  let total = 0;
  let local = 0;

  for (const fact of facts) {
    const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
    const requiredSet = new Set(required);
    for (const claim of claimsOf(fact, vocabulary, spaceOfFact(fact))) {
      total++;
      const space = claim.slice(claim.lastIndexOf('@') + 1);
      /*
       * The claim is local when the fact asserting it also requires the space
       * it is about. A violation is a fact that talks about a space it does not
       * rest on - which is exactly the door an aggregation attack walks
       * through, and cannot be true by construction because the claim came from
       * the text and the requirement came from traversal.
       */
      if (requiredSet.has(space)) local++;
      else {
        if (violations.length < 25) {
          violations.push({
            claim,
            factId: fact.id,
            factText: fact.text.slice(0, 180),
            required,
            about: space,
          });
        }
      }
    }
  }

  return { total, local, violations };
}
