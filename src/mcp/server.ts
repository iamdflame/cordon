/**
 * cordon-mcp - derived-knowledge access control, as a tool any agent can call.
 *
 *   npx tsx src/mcp/server.ts          # stdio transport
 *
 * The gate is only useful if it is reachable from where retrieval actually
 * happens, and increasingly that is inside an agent framework rather than
 * inside a search stack. This exposes two tools over MCP:
 *
 *   ask_as(principal, question)          retrieve and answer as that person,
 *                                        withholding what they may not see
 *   check_admissible(principal, facts)   gate facts your own stack retrieved
 *
 * Configure it once and any MCP-speaking agent enforces derived-knowledge
 * access control without changing its retrieval:
 *
 *   {
 *     "mcpServers": {
 *       "cordon": { "command": "npx", "args": ["tsx", "src/mcp/server.ts"] }
 *     }
 *   }
 *
 * The transport is hand-rolled JSON-RPC over stdio rather than an SDK
 * dependency: the protocol surface we need is three methods, and a server whose
 * whole job is enforcing a boundary should not pull in a dependency tree to do
 * it.
 */

import { createInterface } from 'node:readline';
import { HydraClient } from '../hydra/client.js';
import { buildGraph, type BuiltGraph } from '../cordon/pipeline.js';
import { FactIndex, PermissionOracle, retrieve } from '../cordon/query.js';
import { DisclosureLedger, plan as planDisclosure, protectedClaims } from '../cordon/planner.js';
import type { FactNode } from '../cordon/model.js';

const PROTOCOL_VERSION = '2024-11-05';

interface Request {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

let built: BuiltGraph | null = null;
let index: FactIndex | null = null;
let oracle: PermissionOracle | null = null;
let ready: Promise<void> | null = null;

/**
 * Requirements and per-principal ledgers, for the set-level tool.
 *
 * An agent is the hardest caller to defend against, because it will happily ask
 * forty questions in a row and stitch the answers together. That is exactly the
 * accumulation the ledger exists to bound, so the MCP surface is the one place
 * session tracking matters most rather than least.
 */
const requiredByFact = new Map<string, readonly string[]>();
const ledgers = new Map<string, DisclosureLedger>();

/** Everything logs to stderr: stdout is the protocol channel. */
function log(message: string) {
  process.stderr.write(`cordon-mcp: ${message}\n`);
}

async function ensureReady(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const client = new HydraClient();
    log('attaching to graph...');
    built = await buildGraph({
      dataRoot: process.env.CORDON_DATA ?? 'data/herb',
      client,
      graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
      skipIngest: true,
    });
    index = new FactIndex();
    for (const fact of built.facts) index.add(fact);
    index.finalise();
    oracle = new PermissionOracle(client, built.registry);
    log(`ready: ${built.facts.length.toLocaleString()} facts`);
  })();
  return ready;
}

/** Resolve every requirement once; level-0 facts require exactly their own space. */
async function resolveRequirements() {
  if (!built || !oracle || requiredByFact.size > 0) return;
  for (const fact of built.facts) {
    requiredByFact.set(
      fact.id,
      fact.level === 0 ? fact.requiredSpaces : await oracle.requiredSpaces(fact.id),
    );
  }
}

const TOOLS = [
  {
    name: 'ask_as',
    description:
      'Answer a question as a specific principal, disclosing only facts whose ' +
      'full derivation that principal is entitled to. Withheld facts are ' +
      'reported with the spaces the principal is missing, never with their content.',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'string', description: 'Employee id to answer as.' },
        question: { type: 'string', description: 'The question.' },
        indistinguishableAbstention: {
          type: 'boolean',
          description:
            'When true, a withheld answer is reported exactly as "no answer", ' +
            'closing the refusal side channel at the cost of an actionable refusal. ' +
            'See docs/THREAT-MODEL.md.',
        },
      },
      required: ['principal', 'question'],
    },
  },
  {
    name: 'check_admissible',
    description:
      'Gate facts your own retrieval already produced. Returns which the ' +
      'principal may see, and for the rest the exact spaces they are missing. ' +
      'Retrieval-agnostic: use any ranker you like.',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'string' },
        factIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fact ids present in the Cordon graph.',
        },
      },
      required: ['principal', 'factIds'],
    },
  },
  {
    name: 'plan_disclosure',
    description:
      'Gate a whole answer, not one fact at a time. Returns the largest subset ' +
      'of your candidates that is safe to serve, where "safe" means the ' +
      'disclosed SET cannot re-derive any claim this principal was refused. ' +
      'Every fact in a reply can be individually admissible while the reply as ' +
      'a whole leaks - check_admissible cannot see that; this can. With ' +
      'session=true the check also covers everything this principal has already ' +
      'been shown, because per-query safety does not compose.',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'string' },
        factIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Candidate fact ids, best first. Rank order is respected.',
        },
        session: {
          type: 'boolean',
          description:
            'Evaluate against this principal\'s accumulated disclosure history. ' +
            'Defaults to true: an agent asking repeatedly is the threat this bounds.',
        },
      },
      required: ['principal', 'factIds'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  await ensureReady();
  if (!built || !index || !oracle) throw new Error('graph unavailable');

  if (name === 'ask_as') {
    const principal = String(args.principal ?? '');
    const question = String(args.question ?? '');
    const quiet = args.indistinguishableAbstention === true;

    const result = await retrieve(index, oracle, principal, question, {
      topK: 8,
      candidates: 24,
    });

    const admitted = result.admitted.map((a) => ({
      text: a.fact.text,
      level: a.fact.level,
      requires: a.required,
    }));

    if (quiet) {
      /*
       * Indistinguishable abstention: a withheld answer is reported exactly as
       * no answer. The asker cannot tell "ask someone with clearance" from
       * "not in the corpus" - which is the point, and the cost.
       */
      return {
        principal,
        admitted,
        withheld: [],
        note:
          admitted.length === 0
            ? 'No answer available.'
            : undefined,
      };
    }

    return {
      principal,
      admitted,
      withheld: result.withheld.map((w) => ({
        level: w.fact.level,
        missingSpaces: w.missing,
        note: `Withheld: this rests on ${w.missing.join(', ')}, which you cannot read.`,
      })),
    };
  }

  if (name === 'check_admissible') {
    const principal = String(args.principal ?? '');
    const factIds = Array.isArray(args.factIds) ? args.factIds.map(String) : [];
    const permitted = new Set(await oracle.permittedSpaces(principal));
    const known = new Map(built.facts.map((f) => [f.id, f]));

    const admitted: string[] = [];
    const withheld: Array<{ id: string; requires: string[]; missing: string[] }> = [];

    for (const id of factIds) {
      if (!known.has(id)) {
        // Fail closed. A gate that admits what it cannot evaluate is not a gate.
        withheld.push({ id, requires: [], missing: ['__unknown_fact__'] });
        continue;
      }
      const requires = await oracle.requiredSpaces(id);
      const missing = requires.filter((space) => !permitted.has(space));
      if (missing.length === 0) admitted.push(id);
      else withheld.push({ id, requires, missing });
    }

    return { principal, permitted: [...permitted], admitted, withheld };
  }

  if (name === 'plan_disclosure') {
    const principal = String(args.principal ?? '');
    const factIds = Array.isArray(args.factIds) ? args.factIds.map(String) : [];
    const session = args.session !== false;

    await resolveRequirements();
    const permitted = new Set(await oracle.permittedSpaces(principal));
    const known = new Map(built.facts.map((f) => [f.id, f]));

    const candidates = factIds.map((id) => known.get(id)).filter((f): f is FactNode => !!f);
    const unknown = factIds.filter((id) => !known.has(id));

    let ledger: DisclosureLedger | undefined;
    if (session) {
      ledger = ledgers.get(principal) ?? new DisclosureLedger();
      ledgers.set(principal, ledger);
    }

    const result = planDisclosure({
      candidates,
      requiredByFact,
      permitted,
      protectedSet: protectedClaims(built.facts, requiredByFact, permitted),
      ...(ledger ? { ledger } : {}),
    });
    if (ledger) ledger.record(result.disclosed);

    return {
      principal,
      safe: result.safe,
      disclosed: result.disclosed.map((f) => ({ id: f.id, text: f.text })),
      /* Refused outright: no provenance. */
      inadmissible: result.inadmissible.map((f) => f.id),
      /*
       * Admissible and withheld anyway. Naming the claim it would have
       * completed is deliberate: an agent that cannot see *why* it lost
       * evidence will retry the same query forever.
       */
      suppressed: result.suppressed.map((sup) => ({
        id: sup.fact.id,
        wouldComplete: sup.wouldComplete,
      })),
      stats: result.stats,
      /* Fail closed on ids we cannot evaluate. */
      unknown,
      ...(ledger ? { ledger: { size: ledger.size, queries: ledger.queryCount } } : {}),
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

function send(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(request: Request) {
  const { id, method, params } = request;

  try {
    if (method === 'initialize') {
      // Do not block startup on the graph; the first tool call awaits it.
      void ensureReady().catch((err) => log(`build failed: ${String(err)}`));
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'cordon', version: '0.1.0' },
        },
      });
    }

    if (method === 'notifications/initialized') return; // no reply to notifications

    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const name = String((params as Record<string, unknown>)?.name ?? '');
      const args = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(name, args);
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    }

    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`error in ${method}: ${message}`);
    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message } });
    }
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: Request;
  try {
    request = JSON.parse(trimmed) as Request;
  } catch {
    log('dropped unparseable line');
    return;
  }
  void handle(request);
});

log('listening on stdio');
