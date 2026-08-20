/**
 * DKL — the derived-knowledge leakage benchmark.
 *
 * Cordon is one system. The thing worth leaving behind is the measurement:
 * a way for anyone to ask how much their knowledge graph discloses to people
 * who were not entitled to what it was built from.
 *
 * There is currently no benchmark for this, which is why every enterprise RAG
 * system reports retrieval quality and none reports disclosure. This is the
 * smallest interface that makes the question askable about someone else's
 * system.
 *
 * To measure your own stack, implement `CorpusAdapter` and `SystemUnderTest`
 * and run `npm run bench:dkl`. Nothing in here depends on Cordon, on HydraDB,
 * or on how you retrieve.
 */

/** A unit of access control. A workspace, a repository, a project, a tenant. */
export type SpaceId = string;

/** Someone who asks questions and holds permissions. */
export type PrincipalId = string;

/**
 * A unit of knowledge the system might disclose.
 *
 * `restsOn` is the whole point. A benchmark that only knows about documents
 * cannot measure this, because the failure being measured is what happens to
 * things that are not documents.
 */
export interface Unit {
  id: string;
  text: string;
  /** 0 = read directly from one source. Higher = synthesised. */
  level: number;
  /** Ids of the sources and/or units this rests on. */
  restsOn: string[];
  /** The single space this unit is filed under, if the system assigns one. */
  filedUnder?: SpaceId;
}

/** A verbatim artifact. Exactly one space, always. */
export interface Source {
  id: string;
  space: SpaceId;
  text: string;
}

/**
 * Where the permissions come from.
 *
 * Implementations should *fetch* this wherever possible rather than assert it.
 * A benchmark whose access control is invented by the person being benchmarked
 * measures nothing, which is why the reference GitHub adapter reads repository
 * visibility and team grants from the API and treats a 404 as ground truth.
 */
export interface PermissionModel {
  spaces(): Iterable<SpaceId>;
  principals(): Iterable<PrincipalId>;
  /** Spaces this principal may read. Must be complete: a partial answer fails open. */
  permitted(principal: PrincipalId): Set<SpaceId>;
}

export interface CorpusAdapter {
  readonly name: string;
  sources(): Iterable<Source>;
  units(): Iterable<Unit>;
  permissions(): PermissionModel;
  /** Optional: questions with ground-truth answers, to score utility alongside leakage. */
  questions?(): Iterable<{ id: string; question: string; space: SpaceId; gold: Set<string> }>;
}

/**
 * The system being measured.
 *
 * Given an asker and a set of candidate units, return the ones it would
 * disclose. That is the entire contract — retrieval, ranking, and answer
 * generation are yours and are deliberately out of scope.
 */
export interface SystemUnderTest {
  readonly name: string;
  discloses(principal: PrincipalId, units: Unit[]): Promise<Unit[]> | Unit[];
}

/* ------------------------------------------------------------------ truth */

/**
 * Ground truth: every source a unit transitively rests on.
 *
 * Computed from the corpus, never from a field the system under test wrote.
 * This is the lesson that cost us the most: an invariant checked against the
 * value that produced it is not being checked.
 */
export function closure(
  unitId: string,
  units: Map<string, Unit>,
  sources: Map<string, Source>,
  seen = new Set<string>(),
): Set<string> {
  const out = new Set<string>();
  if (seen.has(unitId)) return out;
  seen.add(unitId);
  const unit = units.get(unitId);
  if (!unit) return out;
  for (const support of unit.restsOn) {
    if (sources.has(support)) out.add(support);
    else for (const deeper of closure(support, units, sources, seen)) out.add(deeper);
  }
  return out;
}

/** The spaces a unit truly requires: the union over its transitive sources. */
export function requiredSpaces(
  unitId: string,
  units: Map<string, Unit>,
  sources: Map<string, Source>,
): Set<SpaceId> {
  const out = new Set<SpaceId>();
  for (const sourceId of closure(unitId, units, sources)) {
    const source = sources.get(sourceId);
    if (source) out.add(source.space);
  }
  return out;
}

/* ---------------------------------------------------------------- metrics */

export interface DklScore {
  system: string;
  corpus: string;
  /** (unit, principal) pairs evaluated. */
  pairs: number;
  /** Pairs where the system disclosed something the principal was not entitled to. */
  leaked: number;
  leakRate: number;
  /** Leaks broken down by derivation depth. The shape is the finding. */
  leaksByLevel: Record<number, number>;
  /** Pairs the system withheld that it should have disclosed. */
  falseDenials: number;
  /**
   * Attribution sensitivity: pairs that must be withheld where the answer would
   * differ depending on which of the unit's own sources it was filed under.
   * A nonzero value means the system's decision is settled by ingest order.
   */
  attributionFlips: number;
  attributionConsidered: number;
}

export async function score(
  corpus: CorpusAdapter,
  system: SystemUnderTest,
): Promise<DklScore> {
  const sources = new Map<string, Source>();
  for (const source of corpus.sources()) sources.set(source.id, source);
  const units = new Map<string, Unit>();
  for (const unit of corpus.units()) units.set(unit.id, unit);

  const permissions = corpus.permissions();
  const principals = [...permissions.principals()];
  const allUnits = [...units.values()];

  const truth = new Map<string, Set<SpaceId>>();
  for (const unit of allUnits) truth.set(unit.id, requiredSpaces(unit.id, units, sources));

  let pairs = 0;
  let leaked = 0;
  let falseDenials = 0;
  let flips = 0;
  let considered = 0;
  const leaksByLevel: Record<number, number> = {};

  for (const principal of principals) {
    const permitted = permissions.permitted(principal);
    const disclosed = new Set((await system.discloses(principal, allUnits)).map((u) => u.id));

    for (const unit of allUnits) {
      pairs++;
      const required = truth.get(unit.id)!;
      const entitled = [...required].every((space) => permitted.has(space));

      if (disclosed.has(unit.id) && !entitled) {
        leaked++;
        leaksByLevel[unit.level] = (leaksByLevel[unit.level] ?? 0) + 1;
      }
      if (!disclosed.has(unit.id) && entitled) falseDenials++;

      // Attribution sensitivity, over units that must be withheld.
      if (!entitled && required.size > 1) {
        considered++;
        const outcomes = [...required].map((space) => permitted.has(space));
        if (outcomes.some(Boolean) && !outcomes.every(Boolean)) flips++;
      }
    }
  }

  return {
    system: system.name,
    corpus: corpus.name,
    pairs,
    leaked,
    leakRate: pairs > 0 ? leaked / pairs : 0,
    leaksByLevel,
    falseDenials,
    attributionFlips: flips,
    attributionConsidered: considered,
  };
}

/* -------------------------------------------------------- reference systems */

/** No access control. What a knowledge graph gives you by default. */
export const ungated: SystemUnderTest = {
  name: 'ungated',
  discloses: (_principal, units) => units,
};

/** Gate by the one space the unit is filed under. What deployed systems do. */
export function documentAcl(permissions: PermissionModel): SystemUnderTest {
  return {
    name: 'document-acl',
    discloses: (principal, units) => {
      const permitted = permissions.permitted(principal);
      return units.filter((u) => (u.filedUnder ? permitted.has(u.filedUnder) : false));
    },
  };
}

/** Gate by every space the derivation depends on. */
export function derivationAware(
  permissions: PermissionModel,
  units: Map<string, Unit>,
  sources: Map<string, Source>,
): SystemUnderTest {
  return {
    name: 'derivation-aware',
    discloses: (principal, candidates) => {
      const permitted = permissions.permitted(principal);
      return candidates.filter((u) =>
        [...requiredSpaces(u.id, units, sources)].every((space) => permitted.has(space)),
      );
    },
  };
}
