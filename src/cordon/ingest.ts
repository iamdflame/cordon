/**
 * Write the enterprise graph into HydraDB.
 *
 * The engine takes one edge per CREATE and commits at roughly 130/s on a single
 * cell (measured; cells are isolated shards, so spreading a connected graph
 * across them would sever the very traversals this system depends on - see
 * docs/HYDRADB-ENGINE-NOTES.md). Edge count is therefore the budget, and the
 * extraction stages are capped to stay inside it.
 *
 * What gets written is chosen so that the security decision is answerable *in
 * the database*: sources carry their space, facts carry their support chain,
 * principals carry their grants. Nothing about admissibility is precomputed
 * into a field the query then trusts.
 */

import { HydraClient, pooled } from '../hydra/client.js';
import { NodeIdRegistry } from '../hydra/ids.js';
import { L, R, ids, type Corpus, type FactNode } from './model.js';

export interface IngestOptions {
  client: HydraClient;
  registry: NodeIdRegistry;
  concurrency?: number;
  /** Max ABOUT edges per fact; entity fan-out is the largest cost. */
  maxEntitiesPerFact?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface IngestPlan {
  statements: string[];
  counts: Record<string, number>;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * Build every statement up front.
 *
 * Planning separately from writing means the edge count is known before a
 * single round trip, so an over-budget run is caught in milliseconds rather
 * than half an hour in.
 */
export function planIngest(
  corpus: Corpus,
  facts: FactNode[],
  entitiesBySource: Map<string, Set<string>>,
  registry: NodeIdRegistry,
  client: HydraClient,
  options: { maxEntitiesPerFact?: number } = {},
): IngestPlan {
  const maxEntitiesPerFact = options.maxEntitiesPerFact ?? 2;
  const statements: string[] = [];
  const counts: Record<string, number> = {};
  const written = new Set<string>();

  const props = (key: string, build: () => Record<string, string | number | boolean>) => {
    if (written.has(key)) return {};
    written.add(key);
    return build();
  };

  const edge = (
    type: string,
    fromLabel: string,
    fromKey: string,
    fromProps: Record<string, string | number | boolean>,
    toLabel: string,
    toKey: string,
    toProps: Record<string, string | number | boolean>,
    edgeProps?: Record<string, string | number | boolean>,
  ) => {
    statements.push(
      client.buildEdgeStatement({
        srcLabel: fromLabel,
        srcId: registry.intern(fromKey),
        srcProps: fromProps,
        dstLabel: toLabel,
        dstId: registry.intern(toKey),
        dstProps: toProps,
        type,
        ...(edgeProps ? { edgeProps } : {}),
      }),
    );
    counts[type] = (counts[type] ?? 0) + 1;
  };

  const spaceProps = (space: string) =>
    props(ids.space(space), () => ({ key: ids.space(space), name: space }));

  const principalProps = (employeeId: string) => {
    const e = corpus.employees.get(employeeId);
    return props(ids.principal(employeeId), () => ({
      key: ids.principal(employeeId),
      eid: employeeId,
      name: e?.name ?? employeeId,
      role: e?.role ?? '',
    }));
  };

  const sourceByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));
  const sourceProps = (artifactKey: string) => {
    const a = sourceByKey.get(artifactKey);
    return props(ids.source(artifactKey), () => ({
      key: ids.source(artifactKey),
      cite: a?.id ?? artifactKey,
      kind: a?.kind ?? 'unknown',
      space: a?.space ?? '',
      title: clip(a?.title ?? '', 90),
    }));
  };

  const factProps = (fact: FactNode) =>
    props(fact.id, () => ({
      key: fact.id,
      level: fact.level,
      space: fact.space,
      text: clip(fact.text, 320),
    }));

  // ---- org: principals, grants, management ------------------------------
  for (const space of corpus.spaces.values()) {
    for (const member of space.team) {
      edge(
        R.MEMBER_OF,
        L.Principal,
        ids.principal(member),
        principalProps(member),
        L.Space,
        ids.space(space.id),
        spaceProps(space.id),
      );
    }
  }

  for (const [report, manager] of corpus.managerOf) {
    edge(
      R.MANAGES,
      L.Principal,
      ids.principal(manager),
      principalProps(manager),
      L.Principal,
      ids.principal(report),
      principalProps(report),
    );
  }

  // ---- sources and their space ------------------------------------------
  for (const artifact of corpus.artifacts) {
    edge(
      R.IN_SPACE,
      L.Source,
      ids.source(artifact.key),
      sourceProps(artifact.key),
      L.Space,
      ids.space(artifact.space),
      spaceProps(artifact.space),
    );
  }

  // ---- who appears where -------------------------------------------------
  for (const [sourceKey, entities] of entitiesBySource) {
    for (const entity of entities) {
      edge(
        R.OBSERVES,
        L.Source,
        ids.source(sourceKey),
        sourceProps(sourceKey),
        L.Principal,
        ids.principal(entity),
        principalProps(entity),
      );
    }
  }

  // ---- facts and their support ------------------------------------------
  const factById = new Map(facts.map((f) => [f.id, f]));
  for (const fact of facts) {
    for (const support of fact.restsOn) {
      if (support.startsWith('s:')) {
        edge(
          R.RESTS_ON,
          L.Fact,
          fact.id,
          factProps(fact),
          L.Source,
          support,
          sourceProps(support.slice(2)),
          { kind: 'evidence' },
        );
      } else {
        const parent = factById.get(support);
        if (!parent) continue;
        edge(
          R.RESTS_ON,
          L.Fact,
          fact.id,
          factProps(fact),
          L.Fact,
          parent.id,
          factProps(parent),
          { kind: 'derivation' },
        );
      }
    }

    for (const entity of fact.entities.slice(0, maxEntitiesPerFact)) {
      edge(
        R.ABOUT,
        L.Fact,
        fact.id,
        factProps(fact),
        L.Principal,
        ids.principal(entity),
        principalProps(entity),
      );
    }
  }

  return { statements, counts };
}

export interface IngestStats {
  nodes: number;
  edges: number;
  durationMs: number;
  edgesPerSecond: number;
  counts: Record<string, number>;
}

export async function runIngest(plan: IngestPlan, options: IngestOptions): Promise<IngestStats> {
  const started = performance.now();
  const { client, concurrency = 16 } = options;

  await pooled(plan.statements, concurrency, (stmt) => client.query(stmt), options.onProgress);

  const durationMs = Math.round(performance.now() - started);
  return {
    nodes: options.registry.size,
    edges: plan.statements.length,
    durationMs,
    edgesPerSecond: Math.round((plan.statements.length / Math.max(durationMs, 1)) * 1000),
    counts: plan.counts,
  };
}
