/**
 * Policy, and what a grant actually costs.
 *
 * Until now Cordon's permission model has been *synthesised* - derived from
 * HERB's org chart, or fetched from GitHub. Neither is something an operator can
 * edit, and a security product an operator cannot configure is a paper.
 *
 * This module is the configurable version, and it exists mostly for one feature
 * that document-level systems cannot have even in principle.
 *
 * ## The blast radius of a grant is not the grant
 *
 * An administrator adds someone to one team. Their mental model - and the model
 * every access-review tool ships - is that this grants the documents in that
 * space. It does. It also silently grants **every derived fact whose entire
 * requirement is now covered**, and those facts rest on spaces the
 * administrator was not thinking about, because the person already had them.
 *
 *     before:  Alice may read {A, B}          fact F requires {A, B, C}   denied
 *     grant:   Alice may read {A, B, C}       fact F requires {A, B, C}   DISCLOSED
 *
 * Nobody granted Alice access to F. Nobody was asked about F. F is not a
 * document, so it appears in no document-level access review, and its
 * disclosure is a consequence of a grant that looked local.
 *
 * `preview` computes that consequence *before* the change is applied. It is the
 * feature this whole thesis earns: you can only compute the blast radius of a
 * grant if you have modelled derivation, and if you have modelled derivation you
 * are obliged to.
 *
 * ## And the second-order one
 *
 * A grant also changes what the principal can *rebuild*. Widening access adds
 * evidence, and evidence feeds the derivation rules in closure.ts, so a grant
 * can push a still-refused claim into reach without disclosing it. `preview`
 * reports those too, because an impact analysis that only counts what became
 * readable is measuring the smaller half of the change.
 */

import type { Corpus, FactNode } from './model.js';
import type { PermissionModel } from './acl.js';
import { reconstruct, type ClaimKey } from './closure.js';
import { protectedClaims } from './planner.js';

/* ------------------------------------------------------------------ policy */

export interface Grant {
  /** Principal id, or a `team:` / `role:` selector resolved at compile time. */
  subject: string;
  space: string;
}

export interface Policy {
  version: string;
  grants: Grant[];
  /**
   * Managers inherit their reports' access, transitively.
   *
   * Defaults on because it is how organisations behave, and off is a deliberate
   * and rare choice. Either way it is now written down rather than implied by
   * whichever code path happened to run.
   */
  managerInheritance: boolean;
}

export const emptyPolicy = (version = '0'): Policy => ({
  version,
  grants: [],
  managerInheritance: true,
});

/**
 * Read a policy back out of an existing permission model.
 *
 * The migration path matters more than the format. An operator adopting Cordon
 * has permissions already - in GitHub, in an org chart, in a spreadsheet - and a
 * policy language they must hand-write from nothing will not be adopted. This
 * turns whatever is already true into an editable starting point.
 */
export function policyFromModel(model: PermissionModel, version = 'imported'): Policy {
  const grants: Grant[] = [];
  for (const [subject, spaces] of model.readable) {
    for (const space of spaces) grants.push({ subject, space });
  }
  grants.sort((a, b) => a.subject.localeCompare(b.subject) || a.space.localeCompare(b.space));
  return { version, grants, managerInheritance: true };
}

/** Transitive management closure, iterative so a cyclic org chart cannot crash it. */
function subordinates(corpus: Corpus, root: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(corpus.reports.get(root) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of corpus.reports.get(next) ?? []) if (!seen.has(child)) stack.push(child);
  }
  return seen;
}

/**
 * Compile a policy to the permission model everything else is defined against.
 *
 * One function, one place authority is decided - the same discipline acl.ts
 * states. A policy that compiles to something *near* the enforced model is worse
 * than no policy, because it will be read as if it were the enforced model.
 */
export function compile(policy: Policy, corpus: Corpus): PermissionModel {
  const direct = new Map<string, Set<string>>();
  for (const grant of policy.grants) {
    const set = direct.get(grant.subject);
    if (set) set.add(grant.space);
    else direct.set(grant.subject, new Set([grant.space]));
  }

  const readable = new Map<string, Set<string>>();
  for (const employee of corpus.employees.keys()) {
    const own = new Set(direct.get(employee) ?? []);
    if (policy.managerInheritance) {
      for (const report of subordinates(corpus, employee)) {
        for (const space of direct.get(report) ?? []) own.add(space);
      }
    }
    readable.set(employee, own);
  }
  /* Subjects that are not employees (teams, service accounts) still hold grants. */
  for (const [subject, spaces] of direct) {
    if (!readable.has(subject)) readable.set(subject, new Set(spaces));
  }

  const audience = new Map<string, Set<string>>();
  for (const [principal, spaces] of readable) {
    for (const space of spaces) {
      const set = audience.get(space);
      if (set) set.add(principal);
      else audience.set(space, new Set([principal]));
    }
  }

  const ranked = [...readable.entries()]
    .map(([principal, spaces]) => ({ principal, spaces: spaces.size }))
    .sort((a, b) => b.spaces - a.spaces);

  return { readable, audience, ranked };
}

/* ----------------------------------------------------------------- preview */

export interface PrincipalImpact {
  principal: string;
  spacesGained: string[];
  spacesLost: string[];
  /** Level-0 facts gained. This is the part an administrator expects. */
  documentsGained: number;
  /** Derived facts gained. This is the part nobody was asked about. */
  derivedGained: number;
  /**
   * Derived facts gained whose requirement includes a space the principal
   * *already had* - so the grant unlocked them in combination, not on its own.
   */
  unlockedByCombination: number;
  documentsLost: number;
  derivedLost: number;
  /** Still-refused claims that the grant puts within rebuilding distance. */
  newlyInferable: ClaimKey[];
}

export interface PolicyImpact {
  from: string;
  to: string;
  principalsAffected: number;
  documentsGained: number;
  derivedGained: number;
  unlockedByCombination: number;
  documentsLost: number;
  derivedLost: number;
  newlyInferable: number;
  /**
   * derivedGained / documentsGained.
   *
   * The number an access review does not show you: how much non-document
   * knowledge rides along with a document-shaped grant.
   */
  hiddenRatio: number;
  perPrincipal: PrincipalImpact[];
}

function fits(required: readonly string[], permitted: ReadonlySet<string>): boolean {
  for (const space of required) if (!permitted.has(space)) return false;
  return true;
}

export interface PreviewInput {
  before: PermissionModel;
  after: PermissionModel;
  facts: readonly FactNode[];
  requiredByFact: ReadonlyMap<string, readonly string[]>;
  /** Cap the per-principal detail; the totals are always over everyone. */
  detail?: number;
  /**
   * Compute the second-order effect (what a grant makes *inferable*).
   *
   * Off by default: it runs the full rule engine twice per affected principal,
   * which is the right cost for a review screen and the wrong one for a
   * keystroke.
   */
  includeInference?: boolean;
}

/**
 * What changing the policy would actually do, computed before it is applied.
 *
 * Deliberately reports losses as prominently as gains. A policy tool that only
 * shows what a change grants will be used to grant, and the revocation path -
 * the one that matters after an incident - stays untested.
 */
export function preview(input: PreviewInput): PolicyImpact {
  const { before, after, facts, requiredByFact } = input;
  const detail = input.detail ?? 25;

  const principals = new Set([...before.readable.keys(), ...after.readable.keys()]);
  const perPrincipal: PrincipalImpact[] = [];

  let documentsGained = 0;
  let derivedGained = 0;
  let unlockedByCombination = 0;
  let documentsLost = 0;
  let derivedLost = 0;
  let newlyInferable = 0;
  let affected = 0;

  for (const principal of principals) {
    const was = before.readable.get(principal) ?? new Set<string>();
    const now = after.readable.get(principal) ?? new Set<string>();

    const spacesGained = [...now].filter((s) => !was.has(s));
    const spacesLost = [...was].filter((s) => !now.has(s));
    if (spacesGained.length === 0 && spacesLost.length === 0) continue;
    affected++;

    let docsG = 0;
    let derG = 0;
    let combo = 0;
    let docsL = 0;
    let derL = 0;

    for (const fact of facts) {
      const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      const couldBefore = fits(required, was);
      const canNow = fits(required, now);
      if (couldBefore === canNow) continue;

      if (canNow) {
        if (fact.level === 0) docsG++;
        else {
          derG++;
          /*
           * Did this fact need a space the principal already held? If so the
           * grant did not "give" it so much as complete it - which is exactly
           * the disclosure no access review surfaces.
           */
          if (required.some((sp) => was.has(sp))) combo++;
        }
      } else if (fact.level === 0) docsL++;
      else derL++;
    }

    documentsGained += docsG;
    derivedGained += derG;
    unlockedByCombination += combo;
    documentsLost += docsL;
    derivedLost += derL;

    let inferable: ClaimKey[] = [];
    if (input.includeInference && spacesGained.length > 0) {
      const wasReach = reconstruct({ facts, requiredByFact, permitted: was }).claims;
      const nowReach = reconstruct({ facts, requiredByFact, permitted: now }).claims;
      const stillProtected = protectedClaims(facts, requiredByFact, now);
      inferable = [...nowReach].filter((k) => !wasReach.has(k) && stillProtected.has(k));
      newlyInferable += inferable.length;
    }

    perPrincipal.push({
      principal,
      spacesGained,
      spacesLost,
      documentsGained: docsG,
      derivedGained: derG,
      unlockedByCombination: combo,
      documentsLost: docsL,
      derivedLost: derL,
      newlyInferable: inferable,
    });
  }

  perPrincipal.sort((a, b) => b.derivedGained - a.derivedGained || b.documentsGained - a.documentsGained);

  return {
    from: 'before',
    to: 'after',
    principalsAffected: affected,
    documentsGained,
    derivedGained,
    unlockedByCombination,
    documentsLost,
    derivedLost,
    newlyInferable,
    hiddenRatio: documentsGained > 0 ? derivedGained / documentsGained : 0,
    perPrincipal: perPrincipal.slice(0, detail),
  };
}

/** Apply a grant, returning a new policy. Policies are values, never mutated. */
export function grant(policy: Policy, subject: string, space: string): Policy {
  if (policy.grants.some((g) => g.subject === subject && g.space === space)) return policy;
  return {
    ...policy,
    version: `${policy.version}+grant(${subject},${space})`,
    grants: [...policy.grants, { subject, space }],
  };
}

/** Revoke a grant, returning a new policy. */
export function revoke(policy: Policy, subject: string, space: string): Policy {
  return {
    ...policy,
    version: `${policy.version}+revoke(${subject},${space})`,
    grants: policy.grants.filter((g) => !(g.subject === subject && g.space === space)),
  };
}
