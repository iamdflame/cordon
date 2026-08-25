/**
 * End-to-end construction of the enterprise graph.
 *
 * corpus -> mentions -> entity resolution -> facts -> HydraDB -> permissions
 */

import { HydraClient } from '../hydra/client.js';
import { NodeIdRegistry } from '../hydra/ids.js';
import { loadCorpus, corpusStats } from './corpus.js';
import { buildNameIndex, extractAll, type NameIndex, type RawMention } from './mentions.js';
import { resolveMentions, scoreResolution, type Resolution } from './resolve.js';
import { buildFacts } from './facts.js';
import { planIngest, runIngest, type IngestStats } from './ingest.js';
import { buildPermissions, permissionStats, type PermissionModel } from './acl.js';
import type { Corpus, FactNode, MentionNode } from './model.js';

export interface BuildOptions {
  dataRoot: string;
  /**
   * Use this corpus instead of reading HERB.
   *
   * The GitHub connector produces the same shape, and injecting it here is what
   * makes the claim checkable: identical extraction, resolution, derivation and
   * admissibility code runs over permissions we fetched rather than wrote.
   */
  corpus?: Corpus;
  client: HydraClient;
  /** Namespaces node ids so successive builds stay isolated. */
  graphId: string;
  /** Limit the number of product spaces, for faster iteration. */
  spaces?: number;
  concurrency?: number;
  /** Plan only: report the edge count without writing. */
  dryRun?: boolean;
  /**
   * Where to keep the ingest checkpoint, enabling resume.
   *
   * The engine is documented to exit 255 around 80% of a 226k-edge write. With
   * a checkpoint, a crash costs the seconds since the last flush instead of the
   * hour. Statements are MERGE, so replaying one is a no-op.
   */
  checkpointPath?: string;
  skipIngest?: boolean;
  onProgress?: (phase: string, done: number, total: number, detail?: string) => void;
}

export interface BuiltGraph {
  corpus: Corpus;
  /** artifact key -> employee ids observed in it, from entity resolution. */
  entitiesBySource: Map<string, Set<string>>;
  index: NameIndex;
  mentions: MentionNode[];
  raw: Map<string, RawMention>;
  resolutions: Map<string, Resolution>;
  facts: FactNode[];
  permissions: PermissionModel;
  registry: NodeIdRegistry;
  stats: Record<string, unknown>;
}

export async function buildGraph(options: BuildOptions): Promise<BuiltGraph> {
  const started = performance.now();
  const report = options.onProgress ?? (() => {});

  report('load', 0, 1, options.corpus ? 'using supplied corpus' : 'reading HERB');
  const corpus =
    options.corpus ??
    loadCorpus(options.dataRoot, options.spaces !== undefined ? { spaces: options.spaces } : {});
  const cstats = corpusStats(corpus);
  report('load', 1, 1, `${cstats.artifacts.toLocaleString()} artifacts, ${cstats.spaces} spaces`);

  report('mentions', 0, 1, 'extracting person references');
  const index = buildNameIndex(corpus);
  const extraction = extractAll(corpus, index);
  report('mentions', 1, 1, `${extraction.stats.total.toLocaleString()} mentions`);

  report('resolve', 0, 1, 'entity resolution');
  const { resolutions, stats: rstats } = resolveMentions({
    corpus,
    index,
    mentions: extraction.mentions,
    raw: extraction.raw,
  });
  const accuracy = scoreResolution(corpus, extraction.mentions, extraction.raw, resolutions);
  report(
    'resolve',
    1,
    1,
    `${rstats.resolved.toLocaleString()} resolved, precision ${(accuracy.precision * 100).toFixed(1)}%`,
  );

  report('facts', 0, 1, 'building facts');
  const factResult = buildFacts({ corpus, mentions: extraction.mentions, resolutions });
  report(
    'facts',
    1,
    1,
    `${factResult.facts.length.toLocaleString()} facts, ${factResult.stats.crossSpaceDerived} cross-space`,
  );

  const permissions = buildPermissions(corpus);
  const registry = new NodeIdRegistry(options.graphId);

  const plan = planIngest(
    corpus,
    factResult.facts,
    factResult.entitiesBySource,
    registry,
    options.client,
  );
  report('plan', 1, 1, `${plan.statements.length.toLocaleString()} edges planned`);

  let ingest: IngestStats | null = null;
  if (!options.dryRun && !options.skipIngest) {
    ingest = await runIngest(plan, {
      client: options.client,
      registry,
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      ...(options.checkpointPath ? { checkpointPath: options.checkpointPath } : {}),
      onProgress: (done, total) => report('ingest', done, total),
      onResumableProgress: (p) => {
        const eta = p.etaSeconds > 0 ? ` eta ${Math.round(p.etaSeconds / 60)}m` : '';
        const resumed = p.skipped > 0 ? ` resumed +${p.skipped.toLocaleString()}` : '';
        const retried = p.retries > 0 ? ` retries ${p.retries}` : '';
        report(
          'ingest',
          p.done,
          p.total,
          `${p.done.toLocaleString()}/${p.total.toLocaleString()} @ ${Math.round(p.ratePerSecond)}/s${eta}${resumed}${retried}`,
        );
      },
    });
    const resumeNote = ingest.resumedFrom > 0 ? `, resumed from ${ingest.resumedFrom.toLocaleString()}` : '';
    const retryNote = ingest.retries > 0 ? `, ${ingest.retries} retried` : '';
    report(
      'ingest',
      ingest.edges,
      ingest.edges,
      `${ingest.edges.toLocaleString()} edges @ ${ingest.edgesPerSecond}/s${resumeNote}${retryNote}`,
    );
  } else if (options.skipIngest) {
    // Re-interning reproduces the id mapping the write phase created.
    report('ingest', 1, 1, 'attached to existing graph');
  }

  return {
    corpus,
    entitiesBySource: factResult.entitiesBySource,
    index,
    mentions: extraction.mentions,
    raw: extraction.raw,
    resolutions,
    facts: factResult.facts,
    permissions,
    registry,
    stats: {
      corpus: cstats,
      mentions: extraction.stats,
      resolution: rstats,
      accuracy,
      facts: factResult.stats,
      permissions: permissionStats(permissions),
      plan: plan.counts,
      plannedEdges: plan.statements.length,
      ingest,
      buildMs: Math.round(performance.now() - started),
    },
  };
}
