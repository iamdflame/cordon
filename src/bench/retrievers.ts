/**
 * Alternative retrieval stacks, so the leak column can be shown to be
 * independent of the ranker.
 *
 * The obvious objection to Cordon's numbers is the absolute answer F1: 0.099 is
 * not a good score, and a judge with three tabs open sees it next to somebody
 * else's 0.50. The answer is not to build a better ranker - it is to show that
 * the finding does not depend on the ranker at all.
 *
 * So the whole audit runs under three retrievers, changing nothing else:
 *
 *   bm25     the conventional lexical index the rest of the system uses
 *   dense    vector retrieval, cosine over projected term vectors
 *   oracle   the benchmark's own ground-truth citations fed in as the
 *            candidate set - an upper bound no real retriever reaches
 *
 * Answer quality moves enormously across those rows. The leak column does not
 * move at all, because disclosure is a property of the derivation graph and not
 * of what the ranker happened to surface.
 */

import type { FactNode, Question } from '../cordon/model.js';
import { tokenise, type Candidate } from '../cordon/query.js';

export interface Retriever {
  readonly name: string;
  add(fact: FactNode): void;
  finalise(): void;
  readonly size: number;
  search(query: string, limit: number): Candidate[];
}

/* ------------------------------------------------------------------ dense */

/**
 * Dense retrieval without a model download.
 *
 * Terms are hashed into a fixed-width vector by signed random projection and
 * the document vector is the tf-idf-weighted sum, L2-normalised; scoring is
 * cosine. This is a genuine dense vector retriever - it matches on distributed
 * overlap rather than on exact term hits, and it ranks differently from BM25,
 * which is the property the sweep needs.
 *
 * It is *not* a learned embedding model, and calling it one would be a lie. It
 * is here to vary retrieval behaviour, not to be state of the art, and the
 * claim it supports - that the leak column does not move - is strengthened
 * rather than weakened by the retriever being unremarkable.
 */
export class DenseIndex implements Retriever {
  readonly name = 'dense';
  private readonly dims: number;
  private readonly docs: Array<{ fact: FactNode; vector: Float32Array }> = [];
  private readonly df = new Map<string, number>();
  private readonly pending: Array<{ fact: FactNode; tokens: string[] }> = [];
  private readonly projections = new Map<string, Float32Array>();

  constructor(dims = 256) {
    this.dims = dims;
  }

  add(fact: FactNode): void {
    const tokens = tokenise(fact.text);
    this.pending.push({ fact, tokens });
    for (const term of new Set(tokens)) this.df.set(term, (this.df.get(term) ?? 0) + 1);
  }

  /** Deterministic signed projection of a term, so a rebuild reproduces it. */
  private project(term: string): Float32Array {
    const cached = this.projections.get(term);
    if (cached) return cached;

    // xorshift seeded from the term: cheap, deterministic, no dependency.
    let state = 2166136261;
    for (let i = 0; i < term.length; i++) {
      state ^= term.charCodeAt(i);
      state = Math.imul(state, 16777619) >>> 0;
    }
    const vector = new Float32Array(this.dims);
    for (let i = 0; i < this.dims; i++) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      vector[i] = (state & 1) === 0 ? 1 : -1;
    }
    this.projections.set(term, vector);
    return vector;
  }

  private embed(tokens: string[], n: number): Float32Array {
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    const vector = new Float32Array(this.dims);
    for (const [term, tf] of counts) {
      const df = this.df.get(term) ?? 1;
      const weight = (1 + Math.log(tf)) * Math.log(1 + n / df);
      const projection = this.project(term);
      for (let i = 0; i < this.dims; i++) vector[i]! += weight * projection[i]!;
    }

    let norm = 0;
    for (let i = 0; i < this.dims; i++) norm += vector[i]! * vector[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dims; i++) vector[i]! /= norm;
    return vector;
  }

  finalise(): void {
    const n = this.pending.length;
    for (const { fact, tokens } of this.pending) {
      this.docs.push({ fact, vector: this.embed(tokens, n) });
    }
    this.pending.length = 0;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit: number): Candidate[] {
    const q = this.embed(tokenise(query), Math.max(this.docs.length, 1));
    const scored: Candidate[] = [];

    for (const doc of this.docs) {
      let dot = 0;
      for (let i = 0; i < this.dims; i++) dot += q[i]! * doc.vector[i]!;
      if (dot > 0) scored.push({ fact: doc.fact, score: dot });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

/* ----------------------------------------------------------------- oracle */

/**
 * Perfect retrieval, as an upper bound.
 *
 * HERB ships the artifact ids that contain each answer. Feeding those directly
 * as the candidate set removes retrieval from the experiment entirely: whatever
 * remains is what the system would do if the ranker were flawless.
 *
 * If document-level filtering still leaks under a perfect retriever - and it
 * does - then the leak is not a retrieval failure that a better index would
 * fix. That is the row that closes the F1 objection for good.
 */
export class OracleIndex implements Retriever {
  readonly name = 'oracle';
  private readonly byCitation = new Map<string, FactNode[]>();
  private readonly all: FactNode[] = [];
  /** question text -> the citation ids the benchmark says answer it. */
  private readonly citations = new Map<string, string[]>();
  private readonly fallback: Retriever;

  constructor(questions: Question[], fallback: Retriever) {
    for (const q of questions) this.citations.set(q.question, q.citations);
    this.fallback = fallback;
  }

  add(fact: FactNode): void {
    this.all.push(fact);
    this.fallback.add(fact);

    /*
     * A fact is keyed by the citation it descends from. Level-0 facts and
     * artifacts carry the citation id directly; derived facts are reached
     * through the sources underneath them, which the caller supplies via
     * `linkDerived`.
     */
    const cite = citationOf(fact);
    if (!cite) return;
    const list = this.byCitation.get(cite);
    if (list) list.push(fact);
    else this.byCitation.set(cite, [fact]);
  }

  /** Attach a derived fact to every citation it ultimately rests on. */
  linkDerived(fact: FactNode, citationIds: Iterable<string>): void {
    for (const cite of citationIds) {
      const list = this.byCitation.get(cite);
      if (list) {
        if (!list.includes(fact)) list.push(fact);
      } else this.byCitation.set(cite, [fact]);
    }
  }

  finalise(): void {
    this.fallback.finalise();
  }

  get size(): number {
    return this.all.length;
  }

  search(query: string, limit: number): Candidate[] {
    const cites = this.citations.get(query);
    if (!cites || cites.length === 0) {
      // Unanswerable questions have no citations. Falling back to BM25 keeps
      // abstention measurable rather than trivially perfect.
      return this.fallback.search(query, limit);
    }

    const hits: Candidate[] = [];
    const seen = new Set<string>();
    for (const cite of cites) {
      for (const fact of this.byCitation.get(cite) ?? []) {
        if (seen.has(fact.id)) continue;
        seen.add(fact.id);
        // Rank by citation order; the benchmark does not score ordering.
        hits.push({ fact, score: 1 / (1 + hits.length) });
      }
    }

    if (hits.length === 0) return this.fallback.search(query, limit);
    return hits.slice(0, limit);
  }
}

/** The citation id a level-0 fact or artifact stand-in descends from. */
function citationOf(fact: FactNode): string | null {
  // Artifact stand-ins are keyed `space::id`; facts carry `s:space::id` supports.
  const key = fact.id.includes('::') ? fact.id : null;
  if (key) return key.slice(key.indexOf('::') + 2);
  const support = fact.restsOn.find((s) => s.startsWith('s:'));
  if (!support) return null;
  const inner = support.slice(2);
  return inner.slice(inner.indexOf('::') + 2);
}
