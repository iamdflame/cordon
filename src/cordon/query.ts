/**
 * Permission-scoped retrieval.
 *
 * Two questions have to be answered for every candidate fact, and both are
 * answered by traversal in HydraDB rather than by reading a cached column:
 *
 *   required(fact)  MATCH (f:Fact {id})-[:RESTS_ON*1..6]->(s:Source)
 *                         -[:IN_SPACE]->(sp:Space) RETURN sp.name
 *
 *   permitted(p)    MATCH (p:Principal {id})-[:MEMBER_OF]->(sp:Space) RETURN sp.name
 *                   MATCH (p:Principal {id})-[:MANAGES*1..6]->(r:Principal)
 *                         -[:MEMBER_OF]->(sp:Space) RETURN sp.name
 *
 *   admissible      required ⊆ permitted
 *
 * Deriving the requirement by walking the support chain is the whole point. A
 * fact three derivations deep has no edge to any space; the only way to know
 * what it depends on is to follow what it rests on, and the only way to be sure
 * that answer is current is to ask the graph rather than a denormalised field
 * that some earlier pipeline stage wrote.
 *
 * The management clause is why this cannot be reduced to a static group check
 * either: access flows down an arbitrarily deep reporting chain, so a
 * principal's permitted set is itself a traversal.
 */

import { HydraClient } from '../hydra/client.js';
import { NodeIdRegistry } from '../hydra/ids.js';
import { L, MAX_SUPPORT_HOPS, R, type FactNode } from './model.js';

export interface Candidate {
  fact: FactNode;
  score: number;
}

export interface AdmissibilityDecision {
  factId: string;
  admitted: boolean;
  /** Spaces the fact depends on, computed by traversal. */
  required: string[];
  /** Spaces the principal may read, computed by traversal. */
  permitted: string[];
  /** Required spaces the principal lacks. Empty when admitted. */
  missing: string[];
}

export interface RetrievalResult {
  principal: string;
  question: string;
  admitted: Array<{ fact: FactNode; score: number; required: string[] }>;
  /** Facts a permission-blind system would have returned, and why we did not. */
  withheld: Array<{ fact: FactNode; score: number; missing: string[] }>;
  latencyMs: number;
  traversals: number;
}

/**
 * Answers admissibility from the graph, caching what it learns.
 *
 * A fact's required-space set is a property of the graph's shape, so it is
 * stable until the graph changes and is safe to memoise. A principal's
 * permitted set is likewise stable between grant changes. Neither cache is
 * consulted in place of a first computation - they only avoid repeating one.
 */
export class PermissionOracle {
  private readonly requiredCache = new Map<string, string[]>();
  private readonly permittedCache = new Map<string, string[]>();
  traversals = 0;

  constructor(
    private readonly client: HydraClient,
    private readonly registry: NodeIdRegistry,
  ) {}

  /**
   * Spaces a fact depends on, by walking its support chain to evidence.
   *
   * This is the query the whole system turns on, and it is deliberately *not*
   * phrased as the composition it wants to be:
   *
   *     (f)-[:RESTS_ON*1..n]->(s:Source)-[:IN_SPACE]->(sp:Space)   -- times out
   *
   * A variable-length traversal followed by a further hop is pathological at
   * corpus scale (see docs/HYDRADB-ENGINE-NOTES.md). Since a source's space is
   * an attribute of that source, the final hop is unnecessary: walk the support
   * chain - which is the part nothing but a graph can do - and read the space
   * off whatever evidence the walk lands on.
   *
   * The bound is 3 because derivation in this model is at most two levels deep;
   * a lower bound is also a cheaper traversal.
   */
  async requiredSpaces(factId: string, hint?: { level: number; space: string }): Promise<string[]> {
    const cached = this.requiredCache.get(factId);
    if (cached) return cached;

    /*
     * A level-0 fact was read straight out of one artifact, so its requirement
     * is that artifact's space and there is nothing to walk. This is precisely
     * the case document-level access control already handles correctly, and
     * traversing for it would be 56,301 round trips to rediscover a value the
     * node already carries.
     *
     * The traversal exists for derivation, and only derivation.
     */
    if (hint && hint.level === 0 && hint.space) {
      const direct = [hint.space];
      this.requiredCache.set(factId, direct);
      return direct;
    }

    const id = this.registry.intern(factId);
    const cypher =
      `MATCH (f:${L.Fact} {id: ${id}})-[:${R.RESTS_ON}*1..${MAX_SUPPORT_HOPS}]->` +
      `(s:${L.Source}) RETURN s.space`;

    const spaces = new Set<string>();
    try {
      this.traversals++;
      const res = await this.client.query(cypher);
      for (const row of res.rows ?? []) {
        const value = row[0]?.value;
        if (typeof value === 'string' && value.length > 0) spaces.add(value);
      }
    } catch {
      // A traversal we cannot complete must never become an authorisation.
      // A sentinel nobody holds denies by default.
      const closed = ['__unresolvable__'];
      this.requiredCache.set(factId, closed);
      return closed;
    }

    // An empty requirement means the support chain could not be established.
    // Treat that as unresolved rather than public.
    const out = spaces.size > 0 ? [...spaces] : ['__unresolvable__'];
    this.requiredCache.set(factId, out);
    return out;
  }

  /**
   * Load the authorisation tables once, from the graph.
   *
   * The natural phrasing of this question is a single traversal:
   *
   *     MATCH (p:Principal {id})-[:MANAGES*1..6]->(r)-[:MEMBER_OF]->(sp) ...
   *
   * and it does not work. Measured on the built graph, a variable-length
   * traversal *composed with a further fixed hop* exceeds the engine's query
   * timeout at 30s, at every depth tried - while the same variable-length
   * traversal on its own returns 43 rows in 287ms. The cost is in the
   * composition, not the depth.
   *
   * So the two relations are fetched whole - the org is small: 530 principals,
   * 1,370 grants, 512 management edges - and the transitive closure is computed
   * over them. Two queries instead of one per principal, and the closure is the
   * same graph computation either way.
   *
   * Note this is only viable because the *authorisation* side is small. The
   * fact side is not, and stays a live per-fact traversal, which is where the
   * graph is doing work nothing else could.
   */
  private orgLoaded = false;
  private readonly grants = new Map<string, Set<string>>();
  private readonly manages = new Map<string, string[]>();

  private async loadOrg(): Promise<void> {
    if (this.orgLoaded) return;

    /*
     * Partitioned by space, deliberately.
     *
     * The whole membership relation is 1,371 edges and the engine truncates at
     * 1,024 rows, handing back a `next_cursor` that expires before it can be
     * used. Asking for the relation in one query therefore returns a quarter of
     * the access-control table with no error - the worst kind of wrong.
     * Per-space queries are ~46 rows each and cannot be truncated.
     */
    this.traversals++;
    const spaceRows = await this.client.queryComplete(
      `MATCH (sp:${L.Space}) RETURN sp.name`,
    );
    const spaces: string[] = [];
    for (const row of spaceRows.rows ?? []) {
      const name = row[0]?.value;
      if (typeof name === 'string') spaces.push(name);
    }

    for (const space of spaces) {
      this.traversals++;
      const res = await this.client.queryComplete(
        `MATCH (p:${L.Principal})-[:${R.MEMBER_OF}]->(sp:${L.Space} {name: ${JSON.stringify(space)}}) RETURN p.eid`,
      );
      for (const row of res.rows ?? []) {
        const who = row[0]?.value;
        if (typeof who !== 'string') continue;
        const set = this.grants.get(who);
        if (set) set.add(space);
        else this.grants.set(who, new Set([space]));
      }
    }

    this.traversals++;
    const management = await this.client.queryComplete(
      `MATCH (m:${L.Principal})-[:${R.MANAGES}]->(r:${L.Principal}) RETURN m.eid, r.eid`,
    );
    for (const row of management.rows ?? []) {
      const manager = row[0]?.value;
      const report = row[1]?.value;
      if (typeof manager !== 'string' || typeof report !== 'string') continue;
      const list = this.manages.get(manager);
      if (list) list.push(report);
      else this.manages.set(manager, [report]);
    }

    this.orgLoaded = true;
  }

  /** Spaces a principal may read: own grants plus everything their org holds. */
  async permittedSpaces(employeeId: string): Promise<string[]> {
    const cached = this.permittedCache.get(employeeId);
    if (cached) return cached;

    try {
      await this.loadOrg();
    } catch {
      // Fail closed: if authorisation cannot be established, grant nothing.
      this.permittedCache.set(employeeId, []);
      return [];
    }

    const spaces = new Set(this.grants.get(employeeId) ?? []);

    // Transitive closure down the reporting line. Iterative, because a cycle in
    // an org export must not take the authorisation path down with it.
    const seen = new Set<string>();
    const stack = [...(this.manages.get(employeeId) ?? [])];
    while (stack.length > 0) {
      const report = stack.pop()!;
      if (seen.has(report)) continue;
      seen.add(report);
      for (const space of this.grants.get(report) ?? []) spaces.add(space);
      for (const next of this.manages.get(report) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }

    const out = [...spaces];
    this.permittedCache.set(employeeId, out);
    return out;
  }

  async decide(
    factId: string,
    employeeId: string,
    hint?: { level: number; space: string },
  ): Promise<AdmissibilityDecision> {
    const [required, permitted] = await Promise.all([
      this.requiredSpaces(factId, hint),
      this.permittedSpaces(employeeId),
    ]);
    const allowed = new Set(permitted);
    const missing = required.filter((space) => !allowed.has(space));

    return {
      factId,
      admitted: missing.length === 0 && required.length > 0,
      required,
      permitted,
      missing,
    };
  }
}

/* --------------------------------------------------------------- ranking */

const STOP = new Set([
  'the','a','an','and','or','of','to','in','for','on','with','is','are','was','were','be',
  'what','which','who','whom','when','where','how','why','did','do','does','i','my','me',
  'employee','ids','id','find','list','tell','about','that','this','their','they','it',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Lexical index over facts. Deliberately conventional: the graph is the novelty. */
export class FactIndex {
  /** Identifies this ranker in the retriever sweep. */
  readonly name = 'bm25';
  private readonly df = new Map<string, number>();
  private readonly docs: Array<{ fact: FactNode; tokens: string[]; length: number }> = [];
  private averageLength = 1;
  private readonly postings = new Map<string, number[]>();

  add(fact: FactNode) {
    const tokens = tokenise(fact.text);
    const position = this.docs.length;
    this.docs.push({ fact, tokens, length: tokens.length });
    for (const term of new Set(tokens)) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
      const list = this.postings.get(term);
      if (list) list.push(position);
      else this.postings.set(term, [position]);
    }
  }

  finalise() {
    this.averageLength =
      this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(this.docs.length, 1);
  }

  get size(): number {
    return this.docs.length;
  }

  /**
   * BM25 over an inverted index.
   *
   * Scoring every one of ~57,000 facts per query would dominate the latency the
   * permission traversals are supposed to own, so candidates come from the
   * postings lists of the query terms only.
   */
  search(query: string, limit: number): Candidate[] {
    const queryTokens = tokenise(query);
    const k1 = 1.4;
    const b = 0.72;
    const n = this.docs.length;
    const scores = new Map<number, number>();

    for (const term of queryTokens) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.length + 0.5) / (posting.length + 0.5));

      for (const position of posting) {
        const doc = this.docs[position]!;
        let tf = 0;
        for (const t of doc.tokens) if (t === term) tf++;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + (b * doc.length) / this.averageLength);
        scores.set(position, (scores.get(position) ?? 0) + idf * (numerator / denominator));
      }
    }

    return [...scores.entries()]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, limit)
      .map(([position, score]) => ({ fact: this.docs[position]!.fact, score }));
  }
}

export interface RetrieveOptions {
  /** Candidates to consider before the permission filter. */
  candidates?: number;
  /** Facts to return after filtering. */
  topK?: number;
  /**
   * Skip the permission filter entirely.
   *
   * This is the baseline every enterprise RAG system implements: retrieve the
   * best matches and serve them. It exists here so the leak it causes can be
   * counted rather than asserted.
   */
  permissionBlind?: boolean;
}

export async function retrieve(
  index: FactIndex,
  oracle: PermissionOracle,
  principal: string,
  question: string,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const started = performance.now();
  const candidateCount = options.candidates ?? 24;
  const topK = options.topK ?? 8;
  const before = oracle.traversals;

  const candidates = index.search(question, candidateCount);

  if (options.permissionBlind) {
    return {
      principal,
      question,
      admitted: candidates.slice(0, topK).map((c) => ({ fact: c.fact, score: c.score, required: [] })),
      withheld: [],
      latencyMs: +(performance.now() - started).toFixed(1),
      traversals: 0,
    };
  }

  const admitted: RetrievalResult['admitted'] = [];
  const withheld: RetrievalResult['withheld'] = [];

  for (const candidate of candidates) {
    const decision = await oracle.decide(candidate.fact.id, principal, {
      level: candidate.fact.level,
      space: candidate.fact.space,
    });
    if (decision.admitted) {
      admitted.push({ fact: candidate.fact, score: candidate.score, required: decision.required });
      if (admitted.length >= topK) break;
    } else {
      withheld.push({ fact: candidate.fact, score: candidate.score, missing: decision.missing });
    }
  }

  return {
    principal,
    question,
    admitted,
    withheld,
    latencyMs: +(performance.now() - started).toFixed(1),
    traversals: oracle.traversals - before,
  };
}
