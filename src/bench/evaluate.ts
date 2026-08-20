/**
 * The dual-axis evaluation: leakage against utility, on HERB's own task.
 *
 * Three systems, identical retrieval, identical answer assembly. The only
 * difference is what each is willing to disclose.
 *
 *   ungated        An ACL-free knowledge graph. Retrieve the best evidence,
 *                  answer from it. What you get by default.
 *
 *   document-acl   Gate each artifact by its own space, and each derived fact
 *                  by the space it is primarily attributed to. This is what
 *                  deployed enterprise assistants do, and it is *correct* for
 *                  anything read straight out of a document.
 *
 *   cordon         Gate every unit by the full set of spaces its derivation
 *                  actually depends on, obtained by traversal.
 *
 * Utility is scored as set-F1 against HERB's ground-truth answers, which for
 * 577 of the 815 answerable questions are lists of employee ids, pull-request
 * links, customer names or URLs. Both axes are therefore measured on the same
 * object: the answer a particular person receives.
 */

import type { Artifact, Corpus, FactNode, Question } from '../cordon/model.js';
import { admissible, type PermissionModel } from '../cordon/acl.js';
import { FactIndex } from '../cordon/query.js';
import type { Retriever } from './retrievers.js';
import {
  answerKind,
  assembleAnswer,
  goldAnswer,
  scoreSet,
  type AnswerContext,
} from './answer.js';

export type System = 'ungated' | 'document-acl' | 'cordon';

export interface SystemScore {
  system: System;
  trials: number;

  /* security */
  leakedTrials: number;
  leakRate: number;
  leakedUnits: number;
  disclosedUnits: number;
  leaksByLevel: Record<number, number>;

  /* utility, on questions the asker is entitled to ask */
  scoredTrials: number;
  f1: number;
  precision: number;
  recall: number;
  falseDenials: number;

  /* abstention */
  unanswerableTrials: number;
  abstainedOnUnanswerable: number;
  abstentionRate: number;

  meanLatencyMs: number;
}

export interface EvaluationInput {
  corpus: Corpus;
  facts: FactNode[];
  permissions: PermissionModel;
  /** Retrieval over full artifact text. Any ranker with a `search`. */
  artifactIndex: Retriever;
  /** Retrieval over derived facts only. */
  derivedIndex: Retriever;
  /** Required spaces per derived fact, obtained by traversal. */
  requiredByFact: Map<string, string[]>;
  answerContext: AnswerContext;
  questions: Question[];
  principals: string[];
  topArtifacts?: number;
  topDerived?: number;
}

export interface EvaluationResult {
  scores: SystemScore[];
  trialsPerSystem: number;
  questionsUsed: number;
  scoredQuestionsPerPrincipal: number;
  principalsUsed: number;
  examples: Array<{
    system: System;
    question: string;
    asker: string;
    askerRole: string;
    askerSpaces: string[];
    factText: string;
    factLevel: number;
    required: string[];
    missing: string[];
  }>;
}

function emptyScore(system: System): SystemScore {
  return {
    system,
    trials: 0,
    leakedTrials: 0,
    leakRate: 0,
    leakedUnits: 0,
    disclosedUnits: 0,
    leaksByLevel: {},
    scoredTrials: 0,
    f1: 0,
    precision: 0,
    recall: 0,
    falseDenials: 0,
    unanswerableTrials: 0,
    abstainedOnUnanswerable: 0,
    abstentionRate: 0,
    meanLatencyMs: 0,
  };
}

export function evaluate(input: EvaluationInput): EvaluationResult {
  const {
    corpus,
    permissions,
    artifactIndex,
    derivedIndex,
    requiredByFact,
    answerContext,
    questions,
    principals,
  } = input;
  const topArtifacts = input.topArtifacts ?? 20;
  const topDerived = input.topDerived ?? 6;

  const artifactByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));

  const scores: Record<System, SystemScore> = {
    ungated: emptyScore('ungated'),
    'document-acl': emptyScore('document-acl'),
    cordon: emptyScore('cordon'),
  };
  const sums: Record<System, { p: number; r: number; f: number; n: number }> = {
    ungated: { p: 0, r: 0, f: 0, n: 0 },
    'document-acl': { p: 0, r: 0, f: 0, n: 0 },
    cordon: { p: 0, r: 0, f: 0, n: 0 },
  };
  const examples: EvaluationResult['examples'] = [];
  let scoredQuestions = 0;

  for (const question of questions) {
    const kind = answerKind(question);
    const gold = goldAnswer(question, question.groundTruthRaw);
    const scoreable = question.answerable && kind !== 'content' && gold.size > 0;
    if (scoreable) scoredQuestions++;

    const started = performance.now();
    const artifactHits = artifactIndex.search(question.question, topArtifacts);
    const derivedHits = derivedIndex.search(question.question, topDerived);
    const searchMs = performance.now() - started;

    for (const asker of principals) {
      const allowed = permissions.readable.get(asker) ?? new Set<string>();

      for (const system of ['ungated', 'document-acl', 'cordon'] as const) {
        const score = scores[system];
        const gateStart = performance.now();

        /* ---- gate the evidence -------------------------------------- */
        const artifacts: Array<Artifact & { score: number }> = [];
        for (const hit of artifactHits) {
          const artifact = artifactByKey.get(hit.fact.id);
          if (!artifact) continue;
          // Artifact gating is identical under both policies: a source belongs
          // to exactly one space. The systems diverge only on derived facts.
          if (system === 'ungated' || allowed.has(artifact.space)) {
            artifacts.push({ ...artifact, score: hit.score });
          }
        }

        /* ---- gate the derived conclusions ---------------------------- */
        const facts: FactNode[] = [];
        const withheld: FactNode[] = [];
        for (const hit of derivedHits) {
          const fact = hit.fact;
          if (system === 'ungated') {
            facts.push(fact);
            continue;
          }
          if (system === 'document-acl') {
            // All a document-level ACL can see is the space the fact is filed
            // under. It has no way to ask what else it was built from.
            if (allowed.has(fact.space)) facts.push(fact);
            else withheld.push(fact);
            continue;
          }
          const required = requiredByFact.get(fact.id) ?? ['__unresolvable__'];
          if (required.length > 0 && admissible(permissions, asker, required)) facts.push(fact);
          else withheld.push(fact);
        }

        score.meanLatencyMs += searchMs + (performance.now() - gateStart);
        score.trials++;
        score.disclosedUnits += artifacts.length + facts.length;

        /* ---- did anything disclosed exceed this asker's entitlement? -- */
        let leakedHere = 0;
        for (const artifact of artifacts) {
          if (!allowed.has(artifact.space)) {
            leakedHere++;
            score.leaksByLevel[0] = (score.leaksByLevel[0] ?? 0) + 1;
          }
        }
        for (const fact of facts) {
          const truth = requiredByFact.get(fact.id) ?? ['__unresolvable__'];
          if (admissible(permissions, asker, truth)) continue;
          leakedHere++;
          score.leaksByLevel[fact.level] = (score.leaksByLevel[fact.level] ?? 0) + 1;

          if (examples.length < 40 && system === 'document-acl') {
            examples.push({
              system,
              question: question.question,
              asker: corpus.employees.get(asker)?.name ?? asker,
              askerRole: corpus.employees.get(asker)?.role ?? '',
              askerSpaces: [...allowed],
              factText: fact.text.slice(0, 200),
              factLevel: fact.level,
              required: truth,
              missing: truth.filter((s) => !allowed.has(s)),
            });
          }
        }
        score.leakedUnits += leakedHere;
        if (leakedHere > 0) score.leakedTrials++;

        /* ---- was anything withheld that this asker was entitled to? --- */
        for (const fact of withheld) {
          const truth = requiredByFact.get(fact.id) ?? [];
          if (truth.length > 0 && admissible(permissions, asker, truth)) score.falseDenials++;
        }

        /* ---- utility --------------------------------------------------
         *
         * Scored only where the asker is entitled to the question's own space.
         * Including askers with no legitimate access would measure how often a
         * system correctly refuses, which is what the leak column is for, and
         * would reward the ungated system for answering questions that were
         * never theirs to ask.
         */
        if (scoreable && allowed.has(question.space)) {
          const predicted = assembleAnswer(question, kind, artifacts, facts, answerContext);
          const s = scoreSet(predicted, gold);
          const acc = sums[system];
          acc.p += s.precision;
          acc.r += s.recall;
          acc.f += s.f1;
          acc.n++;
          score.scoredTrials++;
        }

        if (!question.answerable) {
          score.unanswerableTrials++;
          if (artifacts.length === 0 && facts.length === 0) score.abstainedOnUnanswerable++;
        }
      }
    }
  }

  for (const system of ['ungated', 'document-acl', 'cordon'] as const) {
    const score = scores[system];
    const acc = sums[system];
    score.leakRate = score.trials ? +(score.leakedTrials / score.trials).toFixed(5) : 0;
    score.f1 = acc.n ? +(acc.f / acc.n).toFixed(4) : 0;
    score.precision = acc.n ? +(acc.p / acc.n).toFixed(4) : 0;
    score.recall = acc.n ? +(acc.r / acc.n).toFixed(4) : 0;
    score.abstentionRate = score.unanswerableTrials
      ? +(score.abstainedOnUnanswerable / score.unanswerableTrials).toFixed(4)
      : 0;
    score.meanLatencyMs = score.trials ? +(score.meanLatencyMs / score.trials).toFixed(2) : 0;
  }

  return {
    scores: [scores.ungated, scores['document-acl'], scores.cordon],
    trialsPerSystem: scores.ungated.trials,
    questionsUsed: questions.length,
    scoredQuestionsPerPrincipal: scoredQuestions,
    principalsUsed: principals.length,
    examples,
  };
}

/* ------------------------------------------------------- lexical baseline -- */

/**
 * BM25 over raw artifacts with no graph and no access control.
 *
 * The control for "does any of this structure earn its place". Same retrieval
 * depth, same answer assembly, same scoring.
 */
export function evaluateLexicalBaseline(
  corpus: Corpus,
  questions: Question[],
  artifactIndex: Retriever,
  answerContext: AnswerContext,
  topArtifacts: number,
): { f1: number; precision: number; recall: number; n: number } {
  const artifactByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));
  let p = 0;
  let r = 0;
  let f = 0;
  let n = 0;

  for (const question of questions) {
    const kind = answerKind(question);
    const gold = goldAnswer(question, question.groundTruthRaw);
    if (!question.answerable || kind === 'content' || gold.size === 0) continue;

    const artifacts: Artifact[] = [];
    for (const hit of artifactIndex.search(question.question, topArtifacts)) {
      const artifact = artifactByKey.get(hit.fact.id);
      if (artifact) artifacts.push(artifact);
    }

    const predicted = assembleAnswer(question, kind, artifacts, [], answerContext);
    const s = scoreSet(predicted, gold);
    p += s.precision;
    r += s.recall;
    f += s.f1;
    n++;
  }

  return {
    f1: n ? +(f / n).toFixed(4) : 0,
    precision: n ? +(p / n).toFixed(4) : 0,
    recall: n ? +(r / n).toFixed(4) : 0,
    n,
  };
}
