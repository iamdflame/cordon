/**
 * The permission model.
 *
 * Two rules, both drawn from how real organisations actually work:
 *
 *   1. **Team membership grants space access.** If you are on a product team,
 *      you may read that product's internal artifacts.
 *   2. **Managers inherit their reports' access, transitively.** A VP can read
 *      what their organisation can read. This is what makes the model non-flat
 *      and the resulting visibility lattice interesting: access is a partial
 *      order, not a set of disjoint groups.
 *
 * Everything downstream is defined against `readableSpaces(principal)`. The
 * important discipline is that this function is the *only* place authority is
 * decided. Retrieval never re-derives it, never approximates it, and never
 * caches a per-question shortcut - because a permission check that exists in
 * two places will eventually disagree with itself.
 *
 * HERB carries no ACL annotations, so this model is synthesised from the org
 * chart and team rosters the dataset does provide. That is stated plainly in
 * the README: the *model* is synthetic, the *organisation* it is derived from
 * is the dataset's own.
 */

import type { Corpus } from './model.js';

export interface PermissionModel {
  /** principal -> spaces they may read. */
  readable: Map<string, Set<string>>;
  /** space -> principals who may read it. */
  audience: Map<string, Set<string>>;
  /** Principals sorted by breadth of access; useful for choosing askers. */
  ranked: Array<{ principal: string; spaces: number }>;
}

/**
 * Transitively expand the management chain.
 *
 * Done iteratively rather than recursively: an org chart with a cycle (they do
 * occur in real exports) would blow the stack, and a permission system that
 * crashes on malformed input fails open somewhere else.
 */
function subordinates(corpus: Corpus, root: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(corpus.reports.get(root) ?? [])];

  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of corpus.reports.get(next) ?? []) {
      if (!seen.has(child)) stack.push(child);
    }
  }
  return seen;
}

export function buildPermissions(corpus: Corpus): PermissionModel {
  const direct = new Map<string, Set<string>>();

  for (const space of corpus.spaces.values()) {
    for (const member of space.team) {
      const set = direct.get(member);
      if (set) set.add(space.id);
      else direct.set(member, new Set([space.id]));
    }
  }

  const readable = new Map<string, Set<string>>();
  for (const employee of corpus.employees.keys()) {
    const own = new Set(direct.get(employee) ?? []);
    for (const report of subordinates(corpus, employee)) {
      for (const space of direct.get(report) ?? []) own.add(space);
    }
    readable.set(employee, own);
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

/** May this principal read this space? */
export function canRead(model: PermissionModel, principal: string, space: string): boolean {
  return model.readable.get(principal)?.has(space) === true;
}

/**
 * May this principal see a fact requiring these spaces?
 *
 * The rule that distinguishes Cordon from document-level filtering: a derived
 * fact requires **all** the spaces underneath it. Reading a fact synthesised
 * from two products means being entitled to both, not either. Get this
 * backwards and the knowledge graph becomes a laundering machine, turning two
 * separately-restricted documents into one unrestricted conclusion.
 */
export function admissible(
  model: PermissionModel,
  principal: string,
  requiredSpaces: readonly string[],
): boolean {
  const allowed = model.readable.get(principal);
  if (!allowed) return false;
  for (const space of requiredSpaces) {
    if (!allowed.has(space)) return false;
  }
  return true;
}

export interface PermissionStats {
  principals: number;
  spaces: number;
  meanSpacesPerPrincipal: number;
  maxSpacesPerPrincipal: number;
  principalsWithNoAccess: number;
  meanAudiencePerSpace: number;
  /** Pairs of spaces with at least one principal in common. */
  overlappingSpacePairs: number;
  totalSpacePairs: number;
}

export function permissionStats(model: PermissionModel): PermissionStats {
  const sizes = [...model.readable.values()].map((s) => s.size);
  const spaceIds = [...model.audience.keys()];

  let overlapping = 0;
  let pairs = 0;
  for (let i = 0; i < spaceIds.length; i++) {
    for (let j = i + 1; j < spaceIds.length; j++) {
      pairs++;
      const a = model.audience.get(spaceIds[i]!)!;
      const b = model.audience.get(spaceIds[j]!)!;
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      for (const p of small) {
        if (large.has(p)) {
          overlapping++;
          break;
        }
      }
    }
  }

  return {
    principals: model.readable.size,
    spaces: spaceIds.length,
    meanSpacesPerPrincipal: sizes.length
      ? +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2)
      : 0,
    maxSpacesPerPrincipal: sizes.length ? Math.max(...sizes) : 0,
    principalsWithNoAccess: sizes.filter((s) => s === 0).length,
    meanAudiencePerSpace: spaceIds.length
      ? +(
          [...model.audience.values()].reduce((a, b) => a + b.size, 0) / spaceIds.length
        ).toFixed(1)
      : 0,
    overlappingSpacePairs: overlapping,
    totalSpacePairs: pairs,
  };
}
