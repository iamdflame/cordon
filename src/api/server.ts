/**
 * Cordon API.
 *
 * The graph is built once at startup by re-attaching to what is already in
 * HydraDB; every permission decision after that is a live traversal.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { HydraClient, defaultConfig } from '../hydra/client.js';
import { buildGraph, type BuiltGraph } from '../cordon/pipeline.js';
import { FactIndex, PermissionOracle, retrieve } from '../cordon/query.js';
import type { FactNode } from '../cordon/model.js';

let built: BuiltGraph | null = null;
let index: FactIndex | null = null;
let oracle: PermissionOracle | null = null;
let buildError: string | null = null;
let building = true;

const client = new HydraClient();

async function boot() {
  try {
    built = await buildGraph({
      dataRoot: 'data/herb',
      client,
      graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
      skipIngest: true,
      onProgress: (phase, _d, _t, detail) => {
        if (detail) console.log(`  ${phase.padEnd(10)} ${detail}`);
      },
    });

    index = new FactIndex();
    for (const fact of built.facts) index.add(fact);
    index.finalise();
    oracle = new PermissionOracle(client, built.registry);

    /*
     * Load the authorisation tables now rather than on someone's first
     * question. They are 32 queries against the graph and they are the same for
     * every asker, so paying for them at boot turns a 17-second first request
     * into a 20-millisecond one.
     */
    const warmStart = performance.now();
    const anyone = built.permissions.ranked[0]?.principal;
    if (anyone) await oracle.permittedSpaces(anyone);

    // Derived facts are the entire security surface and there are only a few
    // hundred; resolving them up front keeps every request off the slow path.
    const derived = built.facts.filter((f) => f.level >= 1);
    for (const fact of derived) await oracle.requiredSpaces(fact.id);

    console.log(
      `cordon ready: ${built.facts.length.toLocaleString()} facts indexed, ` +
        `${derived.length} derived requirements resolved ` +
        `(${((performance.now() - warmStart) / 1000).toFixed(0)}s warm-up)`,
    );
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
    console.error('build failed:', buildError);
  } finally {
    building = false;
  }
}

const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({
  ok: true,
  building,
  error: buildError,
  hydra: (await client.ping()) ? 'connected' : 'unreachable',
  endpoint: defaultConfig().endpoint,
}));

app.get('/api/overview', async (_req, reply) => {
  if (!built) return reply.code(503).send({ error: buildError ?? 'building' });
  const s = built.stats as Record<string, any>;
  return {
    stats: {
      artifacts: s.corpus.artifacts,
      spaces: s.corpus.spaces,
      employees: s.corpus.employees,
      mentions: s.mentions.total,
      resolved: s.resolution.resolved,
      precision: s.accuracy.precision,
      recall: s.accuracy.recall,
      facts: built.facts.length,
      crossSpaceFacts: s.facts.crossSpaceDerived,
      edges: s.plannedEdges,
      nodes: built.registry.size,
      narrowedFrom: s.resolution.meanCandidatesBefore,
      narrowedTo: s.resolution.meanCandidatesAfter,
    },
    spaces: [...built.corpus.spaces.values()].map((sp) => ({
      id: sp.id,
      team: sp.team.length,
    })),
  };
});

/** People to ask as, spanning the access spectrum. */
app.get('/api/principals', async (_req, reply) => {
  if (!built) return reply.code(503).send({ error: 'building' });
  const { corpus, permissions } = built;

  return permissions.ranked.slice(0, 400).map((r) => {
    const e = corpus.employees.get(r.principal)!;
    return {
      id: r.principal,
      name: e.name,
      role: e.role,
      location: e.location,
      spaces: [...(permissions.readable.get(r.principal) ?? [])],
      reports: (corpus.reports.get(r.principal) ?? []).length,
    };
  });
});

app.get('/api/questions', async (_req, reply) => {
  if (!built) return reply.code(503).send({ error: 'building' });
  return built.corpus.questions
    .filter((q) => q.answerable && q.citations.length > 0)
    .slice(0, 120)
    .map((q) => ({ id: q.id, question: q.question, space: q.space, type: q.type }));
});

app.post<{ Body: { principal?: string; question?: string } }>('/api/ask', async (request, reply) => {
  if (!built || !index || !oracle) return reply.code(503).send({ error: 'building' });
  const { principal, question } = request.body ?? {};
  if (!principal || !question) {
    return reply.code(400).send({ error: 'body must include "principal" and "question"' });
  }

  const started = performance.now();
  const result = await retrieve(index, oracle, principal, question, { topK: 8, candidates: 24 });
  const permitted = await oracle.permittedSpaces(principal);

  const shape = (fact: FactNode) => ({
    id: fact.id,
    text: fact.text,
    level: fact.level,
    space: fact.space,
  });

  return {
    principal,
    principalName: built.corpus.employees.get(principal)?.name ?? principal,
    principalRole: built.corpus.employees.get(principal)?.role ?? '',
    permitted,
    question,
    latencyMs: +(performance.now() - started).toFixed(1),
    traversals: result.traversals,
    admitted: result.admitted.map((a) => ({ ...shape(a.fact), required: a.required, score: +a.score.toFixed(2) })),
    withheld: result.withheld.slice(0, 10).map((w) => ({
      ...shape(w.fact),
      missing: w.missing,
      score: +w.score.toFixed(2),
    })),
  };
});

/** The derivation of one fact, retrieved from the graph. */
app.get<{ Params: { id: string } }>('/api/fact/*', async (request, reply) => {
  if (!built || !oracle) return reply.code(503).send({ error: 'building' });
  const factId = decodeURIComponent((request.params as Record<string, string>)['*'] ?? '');
  const fact = built.facts.find((f) => f.id === factId);
  if (!fact) return reply.code(404).send({ error: 'unknown fact' });

  const required = await oracle.requiredSpaces(factId);
  const factById = new Map(built.facts.map((f) => [f.id, f]));
  const artifactByKey = new Map(built.corpus.artifacts.map((a) => [a.key, a]));

  const supports = fact.restsOn.map((support) => {
    if (support.startsWith('s:')) {
      const a = artifactByKey.get(support.slice(2));
      return {
        kind: 'source' as const,
        id: support,
        space: a?.space ?? '',
        title: a?.title ?? '',
        cite: a?.id ?? '',
        text: (a?.text ?? '').slice(0, 400),
      };
    }
    const parent = factById.get(support);
    return {
      kind: 'fact' as const,
      id: support,
      space: parent?.space ?? '',
      title: `level ${parent?.level ?? '?'} fact`,
      cite: '',
      text: parent?.text ?? '',
    };
  });

  return { fact: { id: fact.id, text: fact.text, level: fact.level }, required, supports };
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`cordon api on http://127.0.0.1:${port}`);
void boot();
