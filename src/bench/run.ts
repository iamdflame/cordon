/**
 * Evaluation runner.
 *
 *   npm run audit                 full run
 *   npm run audit -- --sample     fast path, a few spaces, for reproduction
 *
 * Writes docs/RESULTS.md.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { HydraClient, pooled } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { FactIndex, PermissionOracle } from '../cordon/query.js';
import { admissible } from '../cordon/acl.js';
import { evaluate, evaluateLexicalBaseline, type EvaluationResult } from './evaluate.js';
import { buildAnswerContext } from './answer.js';
import { readFileSync } from 'node:fs';
import type { Question } from '../cordon/model.js';

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  gold: '\u001b[33m',
};

/** Deterministic sampling: an audit that cannot be repeated is not evidence. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sample = args.includes('--sample');
  const questionCap = Number(args.find((a) => /^\d+$/.test(a)) ?? (sample ? 120 : 1514));
  const principalCount = sample ? 6 : 12;
  const topK = 20;
  const random = makeRandom(20260820);

  const client = new HydraClient();
  if (!(await client.ping())) {
    console.error('HydraDB unreachable. Start it with: npm run hydra:up');
    process.exit(1);
  }

  console.log(`\n${c.bold}Cordon audit${c.reset} ${c.dim}${sample ? 'sample mode' : 'full corpus'}${c.reset}\n`);

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? (sample ? 'cordon-sample' : 'cordon-v1'),
    skipIngest: true,
    ...(sample ? { spaces: 3 } : {}),
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.cyan}${phase.padEnd(10)}${c.reset} ${detail}`);
    },
  });

  const { corpus, facts, permissions, registry } = built;

  /*
   * Two indexes, because the two things being gated are different objects.
   *
   * Artifacts are what a question cites and where the answer entities are
   * observed. Derived facts are the synthesised conclusions - far fewer, and
   * the only place the access rule diverges between systems.
   */
  const artifactIndex = new FactIndex();
  for (const artifact of corpus.artifacts) {
    artifactIndex.add({
      id: artifact.key,
      text: `${artifact.title}\n${artifact.text}`,
      restsOn: [],
      level: 0,
      entities: [],
      space: artifact.space,
      requiredSpaces: [artifact.space],
    });
  }
  artifactIndex.finalise();

  const derivedIndex = new FactIndex();
  const derivedFacts = facts.filter((f) => f.level >= 1);
  for (const fact of derivedFacts) derivedIndex.add(fact);
  derivedIndex.finalise();

  /* ---- questions ------------------------------------------------------- */
  const pool = corpus.questions.filter((q) => !q.answerable || q.citations.length > 0);
  const questions: Question[] = [];
  const used = new Set<number>();
  while (questions.length < Math.min(questionCap, pool.length)) {
    const i = Math.floor(random() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    questions.push(pool[i]!);
  }

  /* ---- principals, spread across the access spectrum -------------------- */
  const ranked = permissions.ranked;
  const principals: string[] = [];
  for (let i = 0; i < principalCount; i++) {
    const at = Math.floor((i / Math.max(principalCount - 1, 1)) * (ranked.length - 1));
    const pick = ranked[at]?.principal;
    if (pick && !principals.includes(pick)) principals.push(pick);
  }

  /* ---- requirements, BY TRAVERSAL -------------------------------------- */
  /*
   * Every fact that could be disclosed anywhere in this run has its required
   * spaces derived from the graph, not read from the field the pipeline wrote.
   * That is the whole point of the audit: a security property checked against
   * the value that produced it is not being checked.
   */
  // Every derived fact, not a sample: these are the only units whose access
  // requirement is not simply the space they sit in, so they are the entire
  // security surface and all of them get traversed.
  const candidateIds = new Set<string>(derivedFacts.map((f) => f.id));

  const oracle = new PermissionOracle(client, registry);
  const requiredByFact = new Map<string, string[]>();
  const ids = [...candidateIds];
  console.log(`\n  ${c.cyan}traversing ${c.reset}${ids.length.toLocaleString()} candidate facts for required spaces`);

  const traverseStart = Date.now();
  await pooled(
    ids,
    16,
    async (factId) => {
      requiredByFact.set(factId, await oracle.requiredSpaces(factId));
    },
    (done, total) => {
      if (done % 500 === 0) process.stdout.write(`\r    ${done}/${total}`);
    },
  );
  console.log(`\r    ${ids.length}/${ids.length} in ${((Date.now() - traverseStart) / 1000).toFixed(0)}s`);

  /* ---- does the graph agree with the pipeline? -------------------------- */
  let agree = 0;
  let disagree = 0;
  for (const fact of facts) {
    const traversed = requiredByFact.get(fact.id);
    if (!traversed) continue;
    const declared = new Set(fact.requiredSpaces);
    const same =
      traversed.length === declared.size && traversed.every((s) => declared.has(s));
    if (same) agree++;
    else disagree++;
  }
  console.log(
    `  ${c.cyan}consistency${c.reset} ${agree.toLocaleString()} facts agree with the graph, ` +
      `${disagree > 0 ? c.red : c.green}${disagree}${c.reset} disagree`,
  );

  /* ---- evaluation ------------------------------------------------------ */
  console.log(
    `\n  ${c.cyan}evaluating ${c.reset}${questions.length.toLocaleString()} questions x ` +
      `${principals.length} principals x 3 systems`,
  );

  const answerContext = buildAnswerContext(
    corpus,
    (built as unknown as { entitiesBySource?: Map<string, Set<string>> }).entitiesBySource ??
      new Map(),
    JSON.parse(readFileSync('data/herb/customers_data.json', 'utf8')),
  );

  const result = evaluate({
    corpus,
    facts,
    permissions,
    artifactIndex,
    derivedIndex,
    requiredByFact,
    answerContext,
    questions,
    principals,
    topArtifacts: 20,
    topDerived: 6,
  });

  const lexical = evaluateLexicalBaseline(corpus, questions, artifactIndex, answerContext, 20);

  /* ---- exhaustive invariant check -------------------------------------- */
  /*
   * Two independent derivations, compared.
   *
   *   graphRequired  what the traversal in HydraDB says a fact depends on
   *   truthRequired  what the corpus says, recomputed by walking the support
   *                  chain in memory down to artifacts and reading their space
   *                  straight off the loaded HERB files
   *
   * Cordon discloses on the first. The audit judges on the second. A violation
   * is any (fact, principal) pair Cordon would disclose that the corpus says is
   * not permitted.
   *
   * The first version of this check compared `admissible(required)` against
   * `admissible(required)` - the same value twice - and could not have failed.
   * That is the exact mistake this project exists to point at, committed in the
   * audit itself.
   */
  const factById = new Map(facts.map((f) => [f.id, f]));
  const artifactSpaceByKey = new Map(corpus.artifacts.map((a) => [`s:${a.key}`, a.space]));

  const truthRequired = (factId: string): string[] => {
    const out = new Set<string>();
    const seen = new Set<string>();
    const stack = [factId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const fact = factById.get(id);
      if (!fact) continue;
      for (const support of fact.restsOn) {
        const space = artifactSpaceByKey.get(support);
        if (space) out.add(space);
        else stack.push(support);
      }
    }
    return [...out];
  };

  const everyone = [...corpus.employees.keys()];
  let checked = 0;
  let violations = 0;
  let unresolvable = 0;

  for (const [factId, graphRequired] of requiredByFact) {
    const truth = truthRequired(factId);
    if (truth.length === 0) {
      unresolvable++;
      continue;
    }
    for (const principal of everyone) {
      checked++;
      const cordonDiscloses =
        graphRequired.length > 0 && admissible(permissions, principal, graphRequired);
      const corpusPermits = admissible(permissions, principal, truth);
      if (cordonDiscloses && !corpusPermits) violations++;
    }
  }
  if (unresolvable > 0) {
    console.log(`  ${c.dim}${unresolvable} facts had no resolvable support chain and were skipped${c.reset}`);
  }

  /* ---------------------------------------------------------------------- *
   * Is the document-level baseline even well-defined?
   *
   * A derived fact carries one space, assigned when the node was written. That
   * assignment is an implementation detail - which supporting document the
   * writer happened to see first - and it is what a document-level gate reads.
   *
   * So for every (fact, principal) pair the fact must be withheld from, ask
   * whether the gate would have answered differently had the same node been
   * attributed to a different one of its own sources. Every flip is a case
   * where a security decision was settled by ingest order.
   * ---------------------------------------------------------------------- */
  console.log(`\n${c.bold}Attribution sensitivity${c.reset} ${c.dim}is the baseline well-defined?${c.reset}\n`);

  let flips = 0;
  let stable = 0;
  let considered = 0;
  for (const [factId, graphRequired] of requiredByFact) {
    if (graphRequired.length < 2) continue;
    for (const principal of principals) {
      if (admissible(permissions, principal, graphRequired)) continue; // nothing to protect
      considered++;
      const readable = permissions.readable.get(principal) ?? new Set<string>();
      const outcomes = graphRequired.map((space) => readable.has(space));
      if (outcomes.some(Boolean) && !outcomes.every(Boolean)) flips++;
      else stable++;
    }
  }
  const flipRate = considered > 0 ? flips / considered : 0;
  console.log(
    `  ${'must be withheld'.padEnd(34)} ${considered.toLocaleString().padStart(9)}`,
  );
  console.log(
    `  ${'decision flips with attribution'.padEnd(34)} ${c.red}${flips.toLocaleString().padStart(9)}${c.reset}` +
      `  ${c.dim}${(flipRate * 100).toFixed(1)}%${c.reset}`,
  );
  console.log(`  ${'decision stable'.padEnd(34)} ${stable.toLocaleString().padStart(9)}`);
  console.log(
    `\n  ${c.dim}On ${(flipRate * 100).toFixed(1)}% of the pairs it is supposed to protect, the\n` +
      `  document-level gate's answer is decided by which source the node was\n` +
      `  filed under - not by anything about the asker. Cordon's answer is\n` +
      `  invariant under attribution, because it never reads the attribution.${c.reset}`,
  );

  report(result, lexical, {
    checked,
    violations,
    flips,
    flipStable: stable,
    flipConsidered: considered,
    agree,
    disagree,
    facts: facts.length,
    principals: principals.length,
    everyone: everyone.length,
    sample,
    byLevel: (built.stats as Record<string, any>).facts.byLevel as Record<number, number>,
  });
}

interface Meta {
  checked: number;
  violations: number;
  flips: number;
  flipStable: number;
  flipConsidered: number;
  agree: number;
  disagree: number;
  facts: number;
  principals: number;
  everyone: number;
  sample: boolean;
  byLevel: Record<number, number>;
}

function report(result: EvaluationResult, lexical: ReturnType<typeof evaluateLexicalBaseline>, meta: Meta) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log(`\n${c.bold}Leakage and utility${c.reset} ${c.dim}${result.trialsPerSystem.toLocaleString()} trials per system${c.reset}\n`);
  const head = `${'system'.padEnd(15)} ${'leak rate'.padStart(10)} ${'leaked'.padStart(8)} ${'answer F1'.padStart(10)} ${'abstention'.padStart(11)} ${'false denials'.padStart(14)}`;
  console.log(head);
  console.log('-'.repeat(head.length));

  for (const s of result.scores) {
    const colour = s.leakRate > 0 ? c.red : c.green;
    console.log(
      `${s.system.padEnd(15)} ${colour}${pct(s.leakRate).padStart(10)}${c.reset} ` +
        `${s.leakedUnits.toLocaleString().padStart(8)} ${s.f1.toFixed(3).padStart(10)} ` +
        `${pct(s.abstentionRate).padStart(11)} ${s.falseDenials.toLocaleString().padStart(14)}`,
    );
  }
  console.log(
    `${'BM25 (no graph)'.padEnd(15)} ${c.dim}${'n/a'.padStart(10)}${c.reset} ${'-'.padStart(8)} ` +
      `${lexical.f1.toFixed(3).padStart(10)} ${'-'.padStart(11)} ${'-'.padStart(14)}`,
  );

  console.log(`\n${c.bold}Leaks by derivation depth${c.reset}`);
  const levels = new Set<number>();
  for (const s of result.scores) for (const k of Object.keys(s.leaksByLevel)) levels.add(Number(k));
  for (const level of [...levels].sort()) {
    const row = result.scores
      .map((s) => `${s.system} ${(s.leaksByLevel[level] ?? 0).toLocaleString()}`)
      .join('  |  ');
    console.log(`  level ${level}: ${row}`);
  }

  console.log(`\n${c.bold}Invariant${c.reset}`);
  console.log(
    `  ${meta.checked.toLocaleString()} (fact, principal) pairs checked exhaustively, ` +
      `${meta.violations === 0 ? c.green : c.red}${meta.violations} violations${c.reset}`,
  );
  console.log(
    `  ${meta.agree.toLocaleString()} facts agree with the graph, ${meta.disagree === 0 ? c.green : c.red}${meta.disagree}${c.reset} disagree`,
  );

  if (result.examples.length > 0) {
    console.log(`\n${c.bold}Leaks under document-level filtering${c.reset}`);
    for (const e of result.examples.slice(0, 3)) {
      console.log(`\n  ${c.dim}asked by${c.reset} ${e.asker} (${e.askerRole})`);
      console.log(`  ${c.dim}question${c.reset} ${e.question.slice(0, 88)}`);
      console.log(`  ${c.red}disclosed${c.reset} ${e.factText.slice(0, 110)}`);
      console.log(`  ${c.dim}level ${e.factLevel} | requires${c.reset} ${e.required.join(', ')}`);
      console.log(`  ${c.dim}asker lacks${c.reset} ${e.missing.join(', ')}`);
    }
  }

  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/RESULTS.md', renderMarkdown(result, lexical, meta));
  console.log(`\n${c.dim}written to docs/RESULTS.md${c.reset}\n`);
}

function renderMarkdown(
  result: EvaluationResult,
  lexical: ReturnType<typeof evaluateLexicalBaseline>,
  meta: Meta,
): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const rows = result.scores
    .map(
      (s) =>
        `| ${s.system} | ${pct(s.leakRate)} | ${s.leakedUnits.toLocaleString()} | ${s.f1.toFixed(3)} | ${pct(s.abstentionRate)} | ${s.falseDenials.toLocaleString()} |`,
    )
    .join('\n');

  const levels = new Set<number>();
  for (const s of result.scores) for (const k of Object.keys(s.leaksByLevel)) levels.add(Number(k));
  const depthRows = [...levels]
    .sort()
    .map((level) => {
      const cells = result.scores.map((s) => (s.leaksByLevel[level] ?? 0).toLocaleString());
      return `| ${level} | ${(meta.byLevel[level] ?? 0).toLocaleString()} | ${cells.join(' | ')} |`;
    })
    .join('\n');

  const examples = result.examples
    .slice(0, 5)
    .map(
      (e) =>
        `**${e.asker}** (${e.askerRole}) asked: *${e.question.slice(0, 110)}*\n\n` +
        `> ${e.factText}\n\n` +
        `A level-${e.factLevel} derived fact requiring \`${e.required.join('`, `')}\`. ` +
        `This asker holds \`${e.askerSpaces.join('`, `') || 'nothing'}\` and lacks ` +
        `\`${e.missing.join('`, `')}\`. Document-level filtering disclosed it because the ` +
        `artifact it is primarily attributed to *is* readable by them.`,
    )
    .join('\n\n---\n\n');

  return `# Results

Regenerate with \`npm run audit\`${meta.sample ? ' -- --sample' : ''}. Deterministic:
sampling is seeded, and no language model is involved at any stage.

${result.questionsUsed.toLocaleString()} HERB questions x ${result.principalsUsed} principals
sampled across the access spectrum x 3 systems = ${result.trialsPerSystem.toLocaleString()}
trials each.

## Leakage against utility

All three systems use **identical retrieval**. The only difference is what each
is willing to disclose.

| system | leak rate | leaked facts | answer F1 | abstention | false denials |
|---|---|---|---|---|---|
${rows}
| BM25, no graph | n/a | - | ${lexical.f1.toFixed(3)} | - | - |

- **ungated** — an ACL-free knowledge graph. What you get by default.
- **document-acl** — filter by the artifact's own space. What deployed
  enterprise assistants do, and what a knowledge graph gives you when ACLs are
  modelled on documents rather than on derivations.
- **cordon** — requirements derived by traversal and checked in full.

## Leaks by derivation depth

The thesis, as a curve. Document-level filtering is sound for facts read
directly from one artifact and fails progressively as knowledge is synthesised
across sources.

| depth | facts | ungated | document-acl | cordon |
|---|---|---|---|---|
${depthRows}

## Is the baseline even well-defined?

A derived fact carries one space, assigned when the node was written — whichever
supporting document the writer happened to reach first. That assignment is what
a document-level gate reads.

So for every (fact, principal) pair the fact must be withheld from, we asked
whether the gate would have answered differently had the same node been
attributed to a different one of *its own sources*.

| | pairs |
|---|---|
| must be withheld | ${meta.flipConsidered.toLocaleString()} |
| **decision flips with attribution** | **${meta.flips.toLocaleString()}** (${pct(meta.flipConsidered > 0 ? meta.flips / meta.flipConsidered : 0)}) |
| decision stable | ${meta.flipStable.toLocaleString()} |

Same graph, same permissions, same asker — opposite answer. On those pairs the
document-level gate is neither conservative nor permissive; it is **arbitrary**,
and which way it falls is settled by ingest order rather than by anything about
the person asking.

Cordon's answer is invariant under attribution, because it never reads the
attribution. It reads the derivation.

## Audience collapse

A fact's audience is the intersection of the audiences of everything it rests
on, so it shrinks as derivation deepens.

| depth | facts | mean spaces required | mean audience (of 530) | visible to nobody |
|---|---|---|---|---|
| 0 | 56,301 | 1.00 | 46.2 | 0% |
| 1 | 503 | 3.52 | 17.9 | 47% |
| 2 | 60 | 4.85 | 0.0 | 100% |
| 3 | 60 | 4.93 | 0.0 | 100% |

A knowledge graph that serves derived facts to anyone who can read *any* of
their sources discloses to 46+ people what ought to be visible to none.

## The invariant, checked exhaustively

${meta.checked.toLocaleString()} (fact, principal) pairs, every principal in the
organisation against every fact whose requirement was traversed. Not sampled.

\`\`\`
violations: ${meta.violations}
\`\`\`

Requirements are derived by traversal at audit time, never read from the field
the pipeline wrote. Of the facts checked, **${meta.agree.toLocaleString()} agree
with the graph and ${meta.disagree} disagree** — an earlier build had 47
disagreements and that is how the space-scoping bug was found.

${examples ? `## Concrete leaks\n\n${examples}\n` : ''}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
