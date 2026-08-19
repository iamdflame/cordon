/**
 * Answering HERB's own questions, and scoring against its ground truth.
 *
 * 577 of the 815 answerable questions have list-valued answers: employee ids,
 * pull-request links, customer names, demo URLs. Those are directly scoreable
 * with set-F1, which is the metric this benchmark is built for and the one
 * comparable systems report.
 *
 * The answer is assembled from the graph rather than generated:
 *
 *   person   the principals observed in the artifacts retrieved for the question
 *   pr, url  the locators of the retrieved artifacts of that kind
 *   company  customer names appearing in the retrieved text
 *
 * The point of doing it this way is that **the answer is a function of what the
 * asker may read**. Two people asking the same question retrieve the same
 * candidates and receive different answers, because the evidence admissible to
 * each of them differs. Utility and disclosure are measured on the same object.
 */

import type { Artifact, Corpus, FactNode, Question } from '../cordon/model.js';
import { tokenise } from '../cordon/query.js';

export type AnswerKind = 'person' | 'pr' | 'url' | 'company' | 'content';

export function answerKind(question: Question): AnswerKind {
  const t = question.type.toLowerCase();
  if (t === 'person' || t === 'pr' || t === 'url' || t === 'company') return t;
  return 'content';
}

/** Ground-truth answer as a set, for the list-valued question types. */
export function goldAnswer(question: Question, raw: unknown): Set<string> {
  void question;
  const out = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) if (typeof item === 'string') out.add(item.trim());
  }
  return out;
}

export interface AnswerContext {
  corpus: Corpus;
  /** artifact key -> employee ids observed in it. */
  entitiesBySource: Map<string, Set<string>>;
  /** Customer names, for `company` questions. */
  customerNames: string[];
}

export function buildAnswerContext(
  corpus: Corpus,
  entitiesBySource: Map<string, Set<string>>,
  customersRaw: unknown,
): AnswerContext {
  const customerNames: string[] = [];
  const seen = new Set<string>();

  const consider = (value: unknown) => {
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      for (const key of ['company', 'name', 'customer']) {
        const v = o[key];
        if (typeof v === 'string' && v.length > 1 && !seen.has(v)) {
          seen.add(v);
          customerNames.push(v);
        }
      }
    }
  };

  if (Array.isArray(customersRaw)) for (const c of customersRaw) consider(c);
  else if (customersRaw && typeof customersRaw === 'object') {
    for (const c of Object.values(customersRaw as Record<string, unknown>)) consider(c);
  }

  return { corpus, entitiesBySource, customerNames };
}

/**
 * Assemble an answer from the evidence this asker is allowed to see.
 *
 * `artifacts` are the retrieved sources that passed the permission gate;
 * `facts` are the derived conclusions that passed it. A derived fact names the
 * people it is about, so it contributes to `person` answers - which is exactly
 * why its access requirement has to be right.
 */
export function assembleAnswer(
  question: Question,
  kind: AnswerKind,
  artifacts: Array<Artifact & { score?: number }>,
  facts: FactNode[],
  context: AnswerContext,
): Set<string> {
  const out = new Set<string>();

  if (kind === 'person') {
    /*
     * Rank rather than union.
     *
     * Twenty retrieved artifacts mention on the order of fifty people, against
     * a gold answer of three or four - taking the union guarantees terrible
     * precision no matter how good the retrieval was. Weighting each person by
     * the relevance of the artifacts that mention them, and keeping those well
     * above the background, recovers the people the question is actually about.
     */
    const weight = new Map<string, number>();
    for (const artifact of artifacts) {
      const score = artifact.score ?? 1;

      /*
       * Authorship was tried as a stronger signal than mention - a document has
       * an author, a pull request has reviewers - on the theory that these
       * questions ask who *wrote* something. Measured, it moved F1 from 0.099
       * to 0.079 and was removed. In this corpus the people a question is about
       * are the people discussed, not the single account that filed the
       * artifact.
       */
      for (const eid of context.entitiesBySource.get(artifact.key) ?? []) {
        weight.set(eid, (weight.get(eid) ?? 0) + score);
      }
    }
    // A derived fact names its subject directly, so it is strong evidence.
    for (const fact of facts) {
      for (const eid of fact.entities) weight.set(eid, (weight.get(eid) ?? 0) + 4);
    }
    if (weight.size === 0) return out;

    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0]![1];
    for (const [eid, w] of ranked) {
      if (w < best * 0.45) break;
      out.add(eid);
      if (out.size >= 12) break;
    }
    return out;
  }

  if (kind === 'pr' || kind === 'url') {
    const want = kind === 'pr' ? 'pr' : 'url';
    for (const artifact of artifacts) {
      if (artifact.kind !== want) continue;
      if (artifact.locator) out.add(artifact.locator);
    }
    // PR links also appear inline in discussion.
    const pattern = kind === 'pr' ? /https?:\/\/\S*\/pull\/\d+/g : /https?:\/\/\S+/g;
    for (const artifact of artifacts) {
      for (const match of artifact.text.matchAll(pattern)) {
        out.add(match[0].replace(/[).,>"']+$/, ''));
      }
    }
    return out;
  }

  if (kind === 'company') {
    const haystack = artifacts.map((a) => a.text).join('\n');
    for (const name of context.customerNames) {
      if (haystack.includes(name)) out.add(name);
    }
    return out;
  }

  // `content` questions want prose; scoring them needs generation, which this
  // pipeline deliberately does not do. Reported separately as unscored.
  void question;
  void tokenise;
  return out;
}

export interface SetScore {
  precision: number;
  recall: number;
  f1: number;
}

export function scoreSet(predicted: Set<string>, gold: Set<string>): SetScore {
  if (gold.size === 0) return { precision: 0, recall: 0, f1: 0 };
  let hit = 0;
  for (const item of predicted) if (gold.has(item)) hit++;
  const precision = predicted.size > 0 ? hit / predicted.size : 0;
  const recall = hit / gold.size;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}
