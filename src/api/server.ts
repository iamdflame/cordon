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
import { admissible } from '../cordon/acl.js';
import { corpusFromSnapshot, loadSnapshot } from '../cordon/corpus/github.js';
import { buildVocabulary } from '../attack/mine.js';
import { spacesNamedIn } from '../attack/model.js';
import type { FactNode } from '../cordon/model.js';

/**
 * Which corpus this instance serves.
 *
 * `github` is what the hosted deployment runs: 8 real repositories and 11
 * nested teams, 405 edges, which ingests in about a minute. The full HERB graph
 * is 226,357 edges and over an hour of write-bound ingest, so it is built
 * locally and re-attached rather than stood up on a cold container.
 */
const CORPUS = process.env.CORDON_CORPUS === 'github' ? 'github' : 'herb';
const SNAPSHOT = process.env.CORDON_SNAPSHOT ?? 'fixtures/github/snapshot.json';

let built: BuiltGraph | null = null;
let index: FactIndex | null = null;
let oracle: PermissionOracle | null = null;
let buildError: string | null = null;
let building = true;

const client = new HydraClient();

async function boot() {
  try {
    /*
     * On the GitHub corpus the graph is ingested here rather than re-attached:
     * a cold container has an empty store, and 405 edges is a minute. On HERB
     * the graph is far too large to build at boot, so we attach to one that is
     * already there.
     */
    const isGitHub = CORPUS === 'github';
    built = await buildGraph({
      dataRoot: 'data/herb',
      ...(isGitHub ? { corpus: corpusFromSnapshot(loadSnapshot(SNAPSHOT)) } : {}),
      client,
      graphId: process.env.CORDON_GRAPH ?? (isGitHub ? 'cordon-github2' : 'cordon-v1'),
      skipIngest: !isGitHub,
      concurrency: 6,
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

/* -------------------------------------------------------------------------- *
 * The gate, as a service.
 *
 * Everything above assumes you use Cordon's retrieval. This does not. Post the
 * facts your own stack already retrieved, get back which of them this principal
 * may see and, for the rest, exactly which spaces they are missing.
 *
 * Two properties make it adoptable, and both are measured rather than asserted:
 * it is retrieval-agnostic (docs/RESULTS.md, the retriever sweep - the leak
 * column does not move across three rankers), and it is stateless per call
 * given the graph. Keep your stack; add the gate.
 * -------------------------------------------------------------------------- */
interface GateFact {
  id: string;
  /** Optional: supports, if this fact is not already in the graph. */
  restsOn?: string[];
  /** Optional: skip traversal when the caller already knows the requirement. */
  requiredSpaces?: string[];
}

app.post<{ Body: { principal?: string; facts?: GateFact[] } }>(
  '/v1/admissible',
  async (request, reply) => {
    if (!built || !oracle) return reply.code(503).send({ error: buildError ?? 'building' });
    const { principal, facts } = request.body ?? {};
    if (!principal || !Array.isArray(facts)) {
      return reply.code(400).send({ error: 'body must include "principal" and "facts" (array)' });
    }
    if (facts.length > 512) {
      return reply.code(413).send({ error: 'at most 512 facts per call' });
    }

    const started = performance.now();
    const permitted = new Set(await oracle.permittedSpaces(principal));
    if (permitted.size === 0 && !built.corpus.employees.has(principal)) {
      return reply.code(404).send({ error: `unknown principal "${principal}"` });
    }

    const known = new Map(built.facts.map((f) => [f.id, f]));
    const admittedOut: Array<{ id: string; requires: string[] }> = [];
    const withheldOut: Array<{
      id: string;
      requires: string[];
      missing: string[];
      chain: string[];
    }> = [];
    let traversals = 0;

    for (const item of facts) {
      /*
       * Requirement resolution, in order of trust. A caller-supplied
       * requirement is honoured but never *reduces* what the graph knows: if
       * the fact is in the graph we traverse it, because the caller's copy of
       * the requirement is exactly the field that can be stale.
       */
      let requires: string[];
      if (known.has(item.id)) {
        requires = await oracle.requiredSpaces(item.id);
        traversals++;
      } else if (item.requiredSpaces && item.requiredSpaces.length > 0) {
        requires = [...new Set(item.requiredSpaces)];
      } else if (item.restsOn && item.restsOn.length > 0) {
        // Unknown fact described by its supports: union what each support needs.
        const union = new Set<string>();
        for (const support of item.restsOn) {
          if (known.has(support)) {
            for (const space of await oracle.requiredSpaces(support)) union.add(space);
            traversals++;
          } else if (support.startsWith('s:')) {
            const key = support.slice(2);
            const artifact = built.corpus.artifacts.find((a) => a.key === key);
            if (artifact) union.add(artifact.space);
          }
        }
        requires = [...union];
      } else {
        /*
         * Nothing to go on. Fail closed: a gate that admits what it cannot
         * evaluate is not a gate.
         */
        withheldOut.push({ id: item.id, requires: [], missing: ['__unresolvable__'], chain: [] });
        continue;
      }

      const missing = requires.filter((space) => !permitted.has(space));
      if (missing.length === 0) admittedOut.push({ id: item.id, requires });
      else {
        const fact = known.get(item.id);
        withheldOut.push({
          id: item.id,
          requires,
          missing,
          chain: fact ? fact.restsOn.slice(0, 8) : (item.restsOn ?? []).slice(0, 8),
        });
      }
    }

    return {
      principal,
      permitted: [...permitted],
      admitted: admittedOut,
      withheld: withheldOut,
      traversals,
      latencyMs: +(performance.now() - started).toFixed(2),
    };
  },
);

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

/**
 * The console's payload: every derived fact, every principal, and what each of
 * the three gates would do — computed live rather than replayed.
 *
 * Identical in shape to `artifacts/console-capture.json`, so the static page
 * can prefer this and fall back to the committed transcript when the backend is
 * cold. A visitor should never see an empty page because a container is asleep.
 */
app.get('/api/capture', async (_req, reply) => {
  if (!built || !oracle) return reply.code(503).send({ error: buildError ?? 'building' });
  const { facts, permissions, corpus } = built;
  const vocabulary = buildVocabulary(corpus);

  const required = new Map<string, string[]>();
  for (const fact of facts) {
    required.set(
      fact.id,
      fact.level === 0 ? fact.requiredSpaces : await oracle.requiredSpaces(fact.id),
    );
  }

  const artifactByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));
  const factById = new Map(facts.map((f) => [f.id, f]));

  const chain = (factId: string, depth = 0, seen = new Set<string>()): unknown[] => {
    if (depth > 4 || seen.has(factId)) return [];
    seen.add(factId);
    const fact = factById.get(factId);
    if (!fact) return [];
    return fact.restsOn.slice(0, 6).map((support) => {
      if (support.startsWith('s:')) {
        const a = artifactByKey.get(support.slice(2));
        return {
          kind: 'source',
          space: a?.space ?? '',
          title: a?.title ?? '',
          locator: a?.locator ?? '',
          text: (a?.text ?? '').replace(/\s+/g, ' ').slice(0, 220),
        };
      }
      const parent = factById.get(support);
      return {
        kind: 'fact',
        level: parent?.level ?? 0,
        space: parent?.space ?? '',
        text: parent?.text ?? '',
        requires: required.get(support) ?? [],
        restsOn: chain(support, depth + 1, seen),
      };
    });
  };

  const principals = [...permissions.readable.keys()]
    .filter((p) => (permissions.readable.get(p)?.size ?? 0) > 0)
    .sort();

  return {
    generatedAt: new Date().toISOString(),
    live: true,
    owner: process.env.CORDON_GH_OWNER ?? 'cordon-demo',
    note: 'Computed live against HydraDB. Requirements resolved by graph traversal.',
    spaces: [...corpus.spaces.values()].map((sp) => ({
      id: sp.id,
      // A repo is private exactly when the anonymous principal cannot read it.
      private: !sp.team.includes('public'),
      url: `https://github.com/${process.env.CORDON_GH_OWNER ?? 'cordon-demo'}/${sp.id}`,
    })),
    teams: [],
    principals: principals.map((id) => ({
      id,
      name: corpus.employees.get(id)?.name ?? id,
      role: corpus.employees.get(id)?.role ?? '',
      spaces: [...(permissions.readable.get(id) ?? [])].sort(),
    })),
    facts: facts
      .filter((f) => f.level >= 1)
      .map((fact) => {
        const req = required.get(fact.id) ?? [];
        const named = spacesNamedIn(fact, vocabulary);
        return {
          id: fact.id,
          text: fact.text,
          level: fact.level,
          filedUnder: fact.space,
          requires: req,
          namesButDoesNotRestOn: named.filter((sp) => !req.includes(sp)),
          restsOn: chain(fact.id),
          verdicts: Object.fromEntries(
            principals.map((p) => {
              const permitted = permissions.readable.get(p) ?? new Set<string>();
              return [
                p,
                {
                  cordon: admissible(permissions, p, req),
                  documentAcl: permitted.has(fact.space),
                  anySource: req.some((sp) => permitted.has(sp)),
                  missing: req.filter((sp) => !permitted.has(sp)),
                },
              ];
            }),
          ),
        };
      }),
  };
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`cordon api listening on ${process.env.HOST ?? '127.0.0.1'}:${port} (corpus: ${CORPUS})`);
void boot();
