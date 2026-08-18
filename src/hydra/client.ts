/**
 * HydraDB HTTP client.
 *
 * Written against the capability map in docs/HYDRADB-ENGINE-NOTES.md, which was
 * derived by probing the engine directly rather than from the published docs.
 * Every restriction encoded here is one we hit and verified.
 */

import { request } from 'undici';

export interface HydraConfig {
  endpoint: string;
  token: string;
  graph: string;
  namespace: string;
  cellId: string;
}

export const defaultConfig = (): HydraConfig => ({
  endpoint: process.env.HYDRA_ENDPOINT ?? 'http://127.0.0.1:8443',
  token: process.env.HYDRA_TOKEN ?? 'local-development-token-32-bytes',
  graph: process.env.HYDRA_GRAPH ?? 'default',
  namespace: process.env.HYDRA_NAMESPACE ?? 'default',
  cellId: process.env.HYDRA_CELL ?? 'cell-0',
});

/** A property value as returned by the engine: a single-key tagged union. */
type TaggedValue = Record<string, unknown>;

export interface HydraNode {
  id: number;
  labels: string[];
  properties: Record<string, TaggedValue>;
}

export interface HydraRelationship {
  id: number;
  edge_type: string;
  src: number;
  dst: number;
  properties: Record<string, TaggedValue>;
}

export interface HydraPath {
  nodes: HydraNode[];
  relationships: HydraRelationship[];
}

interface Cell {
  type: string;
  value: unknown;
}

export interface QueryResponse {
  query_id?: string;
  columns?: string[];
  rows?: Cell[][];
  read_epoch?: number | null;
  next_cursor?: number | string | null;
  bookmark?: string;
  error?: { code: string; message: string };
}

export class HydraError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly query: string,
  ) {
    super(message);
    this.name = 'HydraError';
  }
}

/** Unwrap the engine's tagged property representation: {"String":"x"} -> "x". */
export function unwrap(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) return value;
  const [tag, inner] = entries[0]!;
  if (/^(String|Int|Integer|Float|Bool|Boolean|Null)$/i.test(tag)) return inner;
  return value;
}

export function nodeProps(node: HydraNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.properties ?? {})) {
    out[key] = unwrap(value);
  }
  return out;
}

/**
 * Escape a string for inline embedding in a Cypher literal.
 *
 * The engine only accepts scalar parameters as UNWIND inputs, so structured
 * queries have to be built as text. Everything user-derived flows through here:
 * package names and file paths come from untrusted repositories.
 */
export function cypherString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Strip control characters outright; they have no legitimate use in an
    // identifier and are a parser-confusion vector.
    .replace(/[\u0000-\u001F\u007F]/g, '');
  return `"${escaped}"`;
}

/** Render a property map as a Cypher property literal. */
export function cypherProps(props: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`unsafe property key: ${key}`);
    }
    if (typeof value === 'string') parts.push(`${key}: ${cypherString(value)}`);
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`non-finite property ${key}`);
      parts.push(`${key}: ${value}`);
    } else parts.push(`${key}: ${value ? 'true' : 'false'}`);
  }
  return parts.join(', ');
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdent(value: string, what: string): string {
  if (!IDENT.test(value)) throw new Error(`invalid ${what}: ${value}`);
  return value;
}

export class HydraClient {
  private inFlight = 0;
  private queryCount = 0;
  private totalLatencyMs = 0;

  constructor(private readonly config: HydraConfig = defaultConfig()) {}

  get stats() {
    return {
      queries: this.queryCount,
      totalLatencyMs: Math.round(this.totalLatencyMs),
      avgLatencyMs: this.queryCount ? +(this.totalLatencyMs / this.queryCount).toFixed(2) : 0,
    };
  }

  /** Execute a raw Cypher query. Throws HydraError on engine rejection. */
  async query(cypher: string, parameters?: Record<string, unknown>): Promise<QueryResponse> {
    const url = `${this.config.endpoint}/v1/graphs/${this.config.graph}/query`;
    const body: Record<string, unknown> = { cell_id: this.config.cellId, query: cypher };
    if (parameters) body['parameters'] = parameters;

    const started = performance.now();
    this.inFlight++;
    try {
      const res = await request(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'x-graph-namespace': this.config.namespace,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        headersTimeout: 120_000,
        bodyTimeout: 120_000,
      });

      const text = await res.body.text();
      let parsed: QueryResponse;
      try {
        parsed = JSON.parse(text) as QueryResponse;
      } catch {
        throw new HydraError(`non-JSON response (HTTP ${res.statusCode}): ${text.slice(0, 200)}`, 'transport', cypher);
      }
      if (parsed.error) {
        throw new HydraError(parsed.error.message, parsed.error.code, cypher);
      }
      return parsed;
    } finally {
      this.inFlight--;
      this.queryCount++;
      this.totalLatencyMs += performance.now() - started;
    }
  }

  /**
   * Liveness probe.
   *
   * A bare `MATCH (n)` is rejected ("node-only MATCH requires an id, label, or
   * property predicate"), so the probe carries a label that need not exist:
   * an empty result set still proves the engine parsed and executed.
   */
  /**
   * Row cap at which the engine truncates a result set.
   *
   * Discovered the hard way: a query returning 1,371 authorisation edges came
   * back with exactly 1,024 rows and a `next_cursor`, silently dropping a
   * quarter of the access-control table. Cursors expire almost immediately
   * ("result cursor is unknown or expired"), so the reliable fix is to keep
   * every query below the cap rather than to page through it.
   */
  static readonly ROW_CAP = 1024;

  /**
   * Run a query that must not be truncated.
   *
   * Throws when the result lands exactly on the cap with a continuation
   * available, because in that case the caller is holding an incomplete answer
   * and has no way to tell. For an authorisation lookup, an incomplete answer
   * that looks complete is the most dangerous possible result.
   */
  async queryComplete(cypher: string): Promise<QueryResponse> {
    const res = await this.query(cypher);
    const rows = res.rows?.length ?? 0;
    if (rows >= HydraClient.ROW_CAP && res.next_cursor != null) {
      throw new HydraError(
        `result truncated at ${rows} rows with a continuation pending; ` +
          'partition this query rather than relying on cursors',
        'truncated',
        cypher,
      );
    }
    return res;
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('MATCH (n:__probe) RETURN count(*)');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create one edge and (implicitly) its endpoint nodes.
   *
   * The engine accepts exactly one hop per CREATE, and node properties are bound
   * at first mention, so callers should pass full properties the first time a
   * node appears and may omit them afterwards.
   */
  buildEdgeStatement(edge: {
    srcLabel: string;
    srcId: number;
    srcProps?: Record<string, string | number | boolean | undefined>;
    dstLabel: string;
    dstId: number;
    dstProps?: Record<string, string | number | boolean | undefined>;
    type: string;
    edgeProps?: Record<string, string | number | boolean | undefined>;
  }): string {
    assertIdent(edge.srcLabel, 'label');
    assertIdent(edge.dstLabel, 'label');
    assertIdent(edge.type, 'relationship type');

    const src = cypherProps({ id: edge.srcId, ...(edge.srcProps ?? {}) });
    const dst = cypherProps({ id: edge.dstId, ...(edge.dstProps ?? {}) });
    const rel = edge.edgeProps ? cypherProps(edge.edgeProps) : '';
    const relLiteral = rel ? ` {${rel}}` : '';

    return `CREATE (a:${edge.srcLabel} {${src}})-[:${edge.type}${relLiteral}]->(b:${edge.dstLabel} {${dst}})`;
  }

  /** Boolean reachability via bounded variable-length match. */
  async isReachable(
    label: string,
    sourceId: number,
    targetId: number,
    relTypes: string[],
    maxHops = 12,
  ): Promise<boolean> {
    assertIdent(label, 'label');
    const rel = relTypes.map((t) => assertIdent(t, 'relationship type')).join('|');
    const cypher =
      `MATCH (a:${label} {id: ${sourceId}})-[:${rel}*1..${maxHops}]->(b:${label} {id: ${targetId}}) ` +
      `RETURN b.id`;
    const res = await this.query(cypher);
    return (res.rows?.length ?? 0) > 0;
  }

  /**
   * Retrieve an actual shortest path through the GraphBLAS path procedure.
   *
   * This is the only way to obtain a path: `RETURN p` and `nodes(p)` are both
   * rejected by the engine, so `algo.SPpaths` is load-bearing, not decorative.
   */
  async shortestPath(sourceId: number, targetId: number, relTypes: string[]): Promise<HydraPath | null> {
    const rels = relTypes.map((t) => `"${assertIdent(t, 'relationship type')}"`).join(', ');
    const cypher =
      `CALL algo.SPpaths({relTypes: [${rels}], sourceNode: ${sourceId}, targetNode: ${targetId}}) ` +
      `YIELD path RETURN path`;

    const res = await this.query(cypher);
    const cell = res.rows?.[0]?.[0];
    if (!cell || cell.type !== 'path') return null;
    return cell.value as HydraPath;
  }

  /** All shortest paths outward from a single source. */
  async singleSourcePaths(sourceId: number, relTypes: string[]): Promise<HydraPath[]> {
    const rels = relTypes.map((t) => `"${assertIdent(t, 'relationship type')}"`).join(', ');
    const cypher =
      `CALL algo.SSpaths({relTypes: [${rels}], sourceNode: ${sourceId}}) YIELD path RETURN path`;
    const res = await this.query(cypher);
    return (res.rows ?? [])
      .map((row) => row[0])
      .filter((cell): cell is Cell => !!cell && cell.type === 'path')
      .map((cell) => cell.value as HydraPath);
  }

  /** Node count. A label is required: the engine rejects unpredicated matches. */
  async countNodes(label: string): Promise<number> {
    const res = await this.query(`MATCH (n:${assertIdent(label, 'label')}) RETURN count(*)`);
    const cell = res.rows?.[0]?.[0];
    return typeof cell?.value === 'number' ? cell.value : 0;
  }

  async countEdges(type?: string): Promise<number> {
    const rel = type ? `[:${assertIdent(type, 'relationship type')}]` : '[]';
    const res = await this.query(`MATCH (a)-${rel}->(b) RETURN count(*)`);
    const cell = res.rows?.[0]?.[0];
    return typeof cell?.value === 'number' ? cell.value : 0;
  }
}

/**
 * Bounded-concurrency executor.
 *
 * Ingestion is one edge per statement, so a real dependency graph means tens of
 * thousands of round trips. Concurrency is the entire ingest budget, and an
 * unbounded fan-out will exhaust sockets long before it saturates the engine.
 */
export async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let completed = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
      completed++;
      if (onProgress && completed % 50 === 0) onProgress(completed, items.length);
    }
  });

  await Promise.all(runners);
  onProgress?.(items.length, items.length);
  return results;
}
