/**
 * Inference-safe planning, priced.
 *
 *   npm run audit:planner
 *   npm run audit:planner -- --sample
 *
 * docs/INFERENCE.md prices *global* content confidentiality at 37.7% of an
 * asker's readable evidence. Taken at face value that says the property is
 * unshippable: no operator destroys a third of their staff's legitimate access.
 *
 * That number assumes an adversary who has aggregated everything they are
 * entitled to. This audit asks the question that actually decides whether the
 * property can ship: **what does it cost per answer?**
 *
 * Three arms, same graph, same retrieval:
 *
 *   global    safety against an asker holding everything they may read
 *   per-query safety against an asker holding one answer
 *   session   safety against an asker who keeps asking, via DisclosureLedger
 *
 * The third is the honest one. Per-query safety does not compose - ten safe
 * answers can jointly rebuild a protected claim - so the session arm is where
 * the guarantee either holds up or is revealed as bookkeeping.
 *
 * Writes docs/PLANNER.md and artifacts/planner-summary.json. No engine needed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { derivedRequiredSpaces } from '../cordon/facts.js';
import { FactIndex } from '../cordon/query.js';
import { DisclosureLedger, plan, protectedClaims } from '../cordon/planner.js';
import { runProvenance } from './provenance.js';
import { ids, type FactNode } from '../cordon/model.js';

const ESC = String.fromCharCode(27);
const c = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  gold: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
};

function bar(title: string, sub = '') {
  console.log(`\n${c.bold}${title}${c.reset}${sub ? ` ${c.dim}${sub}${c.reset}` : ''}`);
  console.log('-'.repeat(78));
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

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
  const topK = 20;
  const principalCount = sample ? 8 : 40;
  const sessionLength = sample ? 12 : 30;

  const client = new HydraClient();
  console.log(`${c.dim}building the graph (no engine writes)...${c.reset}`);

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
    ...(sample ? { spaces: 6 } : {}),
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const { facts, permissions, corpus } = built;

  /* Requirements recomputed from the corpus, not read off the node. */
  const factById = new Map(facts.map((f) => [f.id, f]));
  const sourceSpace = new Map<string, string>();
  for (const a of corpus.artifacts) sourceSpace.set(ids.source(a.key), a.space);

  const requiredByFact = new Map<string, readonly string[]>();
  for (const fact of facts) {
    requiredByFact.set(
      fact.id,
      fact.level === 0
        ? fact.requiredSpaces
        : [...derivedRequiredSpaces(fact.id, factById, sourceSpace)],
    );
  }

  console.log(`  ${c.dim}indexing ${facts.length.toLocaleString()} facts for retrieval...${c.reset}`);
  const index = new FactIndex();
  for (const fact of facts) index.add(fact);
  index.finalise();

  const principals = permissions.ranked
    .filter((r) => r.spaces > 0)
    .slice(0, principalCount)
    .map((r) => r.principal);

  const questions = corpus.questions.filter((q) => q.question.length > 12);
  const random = makeRandom(20260820);
  const shuffled = [...questions].sort(() => random() - 0.5);

  /* ------------------------------------------------------------- per-query */

  bar('Arm 1 — per-query safety', 'the asker holds one answer');

  let queries = 0;
  let bound = 0; // plans where the constraint actually bit
  let admissibleTotal = 0;
  let disclosedTotal = 0;
  let suppressedTotal = 0;
  let unsafe = 0;
  let violationsSeen = 0;

  const protectedByPrincipal = new Map<string, Set<string>>();
  for (const principal of principals) {
    const permitted = permissions.readable.get(principal) ?? new Set<string>();
    protectedByPrincipal.set(principal, protectedClaims(facts, requiredByFact, permitted));
  }

  for (const [n, principal] of principals.entries()) {
    process.stdout.write(`\r  ${c.dim}principal ${n + 1}/${principals.length}${c.reset}   `);
    const permitted = permissions.readable.get(principal) ?? new Set<string>();
    const protectedSet = protectedByPrincipal.get(principal)!;

    for (const question of shuffled.slice(0, sessionLength)) {
      const candidates = index.search(question.question, topK).map((x) => x.fact);
      if (candidates.length === 0) continue;

      const result = plan({ candidates, requiredByFact, permitted, protectedSet });
      queries++;
      admissibleTotal += result.stats.admissible;
      disclosedTotal += result.stats.disclosed;
      suppressedTotal += result.stats.suppressedForInference;
      if (result.violations.length > 0) {
        bound++;
        violationsSeen += result.violations.length;
      }
      if (!result.safe) unsafe++;
    }
  }
  process.stdout.write('\r'.padEnd(60) + '\r');

  const perQueryRetention = pct(disclosedTotal, admissibleTotal);
  const perQueryCost = 100 - perQueryRetention;

  console.log(`  queries planned                     ${queries.toLocaleString().padStart(12)}`);
  console.log(
    `  ${'plans where the constraint bit'.padEnd(34)} ${bound.toLocaleString().padStart(12)}` +
      `  ${c.dim}${pct(bound, queries).toFixed(2)}%${c.reset}`,
  );
  console.log(`  protected claims prevented          ${violationsSeen.toLocaleString().padStart(12)}`);
  console.log(
    `  evidence retained                   ${c.green}${perQueryRetention.toFixed(2).padStart(11)}%${c.reset}`,
  );
  console.log(
    `  ${c.green}cost of per-query inference safety${c.reset}  ${c.green}${perQueryCost.toFixed(2).padStart(11)}%${c.reset}`,
  );
  console.log(
    `  ${'plans verified safe'.padEnd(34)} ${unsafe === 0 ? c.green : c.red}` +
      `${(queries - unsafe).toLocaleString().padStart(12)}${c.reset}  ${c.dim}of ${queries.toLocaleString()}${c.reset}`,
  );

  /* --------------------------------------------------------------- session */

  bar('Arm 2 — session safety', 'the asker keeps asking; the ledger accumulates');
  console.log(
    '  Per-query safety does not compose. Ten individually safe answers can\n' +
      `  ${c.dim}jointly rebuild a protected claim - the aggregation attack, moved from${c.reset}\n` +
      `  ${c.dim}documents to sessions. The ledger evaluates the constraint over${c.reset}\n` +
      `  ${c.dim}everything the asker has been shown, not just the current reply.${c.reset}\n`,
  );

  /*
   * Cumulative, not per-index.
   *
   * The first version of this reported retention *at* query i, and on the full
   * graph it swung between 0% and 100% between adjacent queries. That was not
   * signal: a principal with few spaces has one or two admissible candidates in
   * a top-20, so a single suppression moves the ratio the whole way. A metric
   * whose denominator is routinely 1 is not measuring anything.
   *
   * Cumulative retention through query i has a denominator that grows, so the
   * curve reports the session rather than the noise.
   */
  const curve: Array<{
    query: number;
    retention: number;
    bound: number;
    ledger: number;
    admissible: number;
    disclosed: number;
  }> = [];
  const atQuery = new Map<number, { adm: number; disc: number; bound: number; ledger: number; n: number }>();

  let sessionUnsafe = 0;
  for (const [n, principal] of principals.entries()) {
    process.stdout.write(`\r  ${c.dim}session ${n + 1}/${principals.length}${c.reset}   `);
    const permitted = permissions.readable.get(principal) ?? new Set<string>();
    const protectedSet = protectedByPrincipal.get(principal)!;
    const ledger = new DisclosureLedger();

    for (const [qi, question] of shuffled.slice(0, sessionLength).entries()) {
      const candidates = index.search(question.question, topK).map((x) => x.fact);
      if (candidates.length === 0) continue;

      const result = plan({ candidates, requiredByFact, permitted, protectedSet, ledger });
      ledger.record(result.disclosed);
      if (!result.safe) sessionUnsafe++;

      const slot = atQuery.get(qi) ?? { adm: 0, disc: 0, bound: 0, ledger: 0, n: 0 };
      slot.adm += result.stats.admissible;
      slot.disc += result.stats.disclosed;
      slot.bound += result.violations.length > 0 ? 1 : 0;
      slot.ledger += ledger.size;
      slot.n++;
      atQuery.set(qi, slot);
    }
  }
  process.stdout.write('\r'.padEnd(60) + '\r');

  let cumAdm = 0;
  let cumDisc = 0;
  let cumBound = 0;
  for (const [qi, slot] of [...atQuery].sort((a, b) => a[0] - b[0])) {
    cumAdm += slot.adm;
    cumDisc += slot.disc;
    cumBound += slot.bound;
    curve.push({
      query: qi + 1,
      retention: pct(cumDisc, cumAdm),
      bound: cumBound,
      ledger: Math.round(slot.ledger / Math.max(slot.n, 1)),
      admissible: cumAdm,
      disclosed: cumDisc,
    });
  }

  console.log(
    `    ${'query'.padStart(6)} ${'ledger'.padStart(9)} ${'admissible'.padStart(11)} ${'retained'.padStart(10)} ${'bit'.padStart(6)}`,
  );
  const shown = curve.filter((r, i) => i < 3 || r.query % 5 === 0 || i === curve.length - 1);
  for (const row of shown) {
    const colour = row.retention >= 99.5 ? c.green : row.retention >= 95 ? c.gold : c.red;
    console.log(
      `    ${String(row.query).padStart(6)} ${row.ledger.toLocaleString().padStart(9)} ` +
        `${row.admissible.toLocaleString().padStart(11)} ` +
        `${colour}${row.retention.toFixed(1).padStart(9)}%${c.reset} ${String(row.bound).padStart(6)}`,
    );
  }

  const first = curve[0];
  const last = curve[curve.length - 1];
  console.log(
    `\n  ${c.dim}Retention over a ${sessionLength}-query session: ` +
      `${first ? first.retention.toFixed(1) : '-'}% -> ${last ? last.retention.toFixed(1) : '-'}%.${c.reset}`,
  );
  console.log(
    `  ${'sessions verified safe'.padEnd(34)} ${sessionUnsafe === 0 ? c.green : c.red}` +
      `${sessionUnsafe === 0 ? 'all' : `${sessionUnsafe} FAILED`}${c.reset}`,
  );

  /* ----------------------------------------------------------------- sweep */

  bar('Arm 3 — where it starts to bind', 'sweeping retrieval depth');
  console.log(
    '  If the constraint never bites, the guarantee is free and also untested.\n' +
      `  ${c.dim}So: how deep does retrieval have to go before an answer carries enough${c.reset}\n` +
      `  ${c.dim}evidence to rebuild something the asker was refused?${c.reset}\n`,
  );

  const sweepDepths = sample ? [10, 20, 50] : [10, 20, 50, 100, 200];
  const sweepPrincipals = principals.slice(0, Math.min(principals.length, 12));
  const sweepQuestions = shuffled.slice(0, sample ? 10 : 20);
  const sweepRows: Array<{
    k: number;
    queries: number;
    bound: number;
    prevented: number;
    retention: number;
  }> = [];

  for (const k of sweepDepths) {
    let q = 0;
    let bit = 0;
    let prevented = 0;
    let adm = 0;
    let disc = 0;

    for (const principal of sweepPrincipals) {
      const permitted = permissions.readable.get(principal) ?? new Set<string>();
      const protectedSet = protectedByPrincipal.get(principal)!;
      for (const question of sweepQuestions) {
        const candidates = index.search(question.question, k).map((x) => x.fact);
        if (candidates.length === 0) continue;
        const result = plan({ candidates, requiredByFact, permitted, protectedSet });
        q++;
        adm += result.stats.admissible;
        disc += result.stats.disclosed;
        if (result.violations.length > 0) {
          bit++;
          prevented += result.violations.length;
        }
      }
    }
    sweepRows.push({
      k,
      queries: q,
      bound: bit,
      prevented,
      retention: pct(disc, adm),
    });
    process.stdout.write(`\r  ${c.dim}k=${k} done${c.reset}          `);
  }
  process.stdout.write('\r'.padEnd(40) + '\r');

  console.log(
    `    ${'top-k'.padStart(7)} ${'queries'.padStart(9)} ${'bit'.padStart(7)} ${'prevented'.padStart(11)} ${'retained'.padStart(10)}`,
  );
  for (const row of sweepRows) {
    const colour = row.bound === 0 ? c.green : row.retention >= 95 ? c.gold : c.red;
    console.log(
      `    ${String(row.k).padStart(7)} ${row.queries.toLocaleString().padStart(9)} ` +
        `${colour}${String(row.bound).padStart(7)}${c.reset} ${row.prevented.toLocaleString().padStart(11)} ` +
        `${colour}${row.retention.toFixed(1).padStart(9)}%${c.reset}`,
    );
  }

  const firstBind = sweepRows.find((r) => r.bound > 0);
  console.log(
    firstBind
      ? `\n  ${c.dim}The constraint first bites at k=${firstBind.k}. Below that, inference safety${c.reset}\n` +
          `  ${c.dim}is free because an answer simply does not carry enough to rebuild with.${c.reset}`
      : `\n  ${c.gold}The constraint never bit at any depth swept.${c.reset} ${c.dim}At production retrieval${c.reset}\n` +
          `  ${c.dim}depths this guarantee is free - and that is a measurement, not a claim.${c.reset}`,
  );

  /* ------------------------------------------------------------ the result */

  bar('The exchange rate, three ways');
  const rows: Array<[string, string, string]> = [
    ['provenance (per fact)', '0.000 F1', 'free — the original result'],
    ['content, per query', `${perQueryCost.toFixed(2)}% of evidence`, 'affordable — this audit'],
    [
      'content, per session',
      `${last ? (100 - last.retention).toFixed(2) : '-'}% by query ${sessionLength}`,
      'a budget that degrades gracefully',
    ],
    ['content, global', '37.7% of evidence', 'unshippable — docs/INFERENCE.md'],
  ];
  for (const [label, cost, note] of rows) {
    console.log(`  ${label.padEnd(24)} ${c.bold}${cost.padEnd(24)}${c.reset}${c.dim}${note}${c.reset}`);
  }
  console.log(
    `\n  ${c.dim}The same property costs 37.7% against an adversary who has aggregated${c.reset}\n` +
      `  ${c.dim}everything and ${perQueryCost.toFixed(2)}% against one reading an answer. Inference safety is${c.reset}\n` +
      `  ${c.dim}not one price. It is a curve, and the ledger is where you sit on it.${c.reset}`,
  );
  console.log(
    `\n  ${c.gold}Read the denominators before comparing these.${c.reset} ${c.dim}The global figure is a${c.reset}\n` +
      `  ${c.dim}share of everything an asker may read; the per-query and session figures${c.reset}\n` +
      `  ${c.dim}are shares of retrieved candidates. They measure the same property against${c.reset}\n` +
      `  ${c.dim}different adversaries - they are not three points on one axis.${c.reset}`,
  );

  /* -------------------------------------------------------------- artifact */

  mkdirSync('artifacts', { recursive: true });
  const summary = {
    provenance: runProvenance('data/herb', 20260820),
    config: { topK, principals: principals.length, sessionLength, facts: facts.length },
    perQuery: {
      queries,
      constraintBound: bound,
      boundShare: +pct(bound, queries).toFixed(4),
      violationsPrevented: violationsSeen,
      retentionPct: +perQueryRetention.toFixed(3),
      costPct: +perQueryCost.toFixed(3),
      verifiedSafe: queries - unsafe,
      unsafe,
    },
    session: {
      length: sessionLength,
      unsafe: sessionUnsafe,
      curve,
      finalRetentionPct: last ? +last.retention.toFixed(3) : null,
    },
    sweep: sweepRows,
    comparison: {
      globalCostPct: 37.727,
      perQueryCostPct: +perQueryCost.toFixed(3),
      sessionEndCostPct: last ? +(100 - last.retention).toFixed(3) : null,
    },
  };
  writeFileSync('artifacts/planner-summary.json', `${JSON.stringify(summary, null, 2)}\n`);

  /* --------------------------------------------------------------- write-up */

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/PLANNER.md',
    `# Inference-safe planning

Regenerate with \`npm run audit:planner\`.

[INFERENCE.md](INFERENCE.md) prices *global* content confidentiality at **37.7%**
of an asker's readable evidence. Taken at face value that says the property
cannot ship: no operator destroys a third of their staff's legitimate access.

That number assumes an adversary who has already aggregated **everything they
are entitled to**. A single answer is not that. This audit measures what the
same property costs per answer, and what it costs as an asker keeps asking.

| adversary | cost of content confidentiality | verdict |
|---|---|---|
| holds one answer | **${perQueryCost.toFixed(2)}%** of evidence | affordable |
| holds a ${sessionLength}-query session | **${last ? (100 - last.retention).toFixed(2) : '—'}%** by query ${sessionLength} | a budget |
| holds everything they may read | **37.7%** | unshippable |

**Inference safety is not one price. It is a curve, and the ledger is where you
sit on it.**

> **Read the denominators before comparing those rows.** The global figure is a
> share of *everything an asker may read*; the per-query and session figures are
> shares of *retrieved candidates in an answer*. They measure the same property
> against different adversaries — they are **not three points on one axis**, and
> the session row exceeding the global row is an artefact of that, not a
> paradox. What the table is for is the shape: the cost of content
> confidentiality is set by how much the adversary has already accumulated.

---

## The rule

Per-fact checking cannot see a set-level leak, because the dangerous object
never appears in the list being checked. So the decision is made over the set:

\`\`\`
choose D ⊆ Admissible(p)
maximising utility(D)
subject to closure(D) ∩ Protected(p) = ∅
\`\`\`

\`closure\` is the same rule engine an adversary would run ([closure.ts](../src/cordon/closure.ts)),
and \`Protected(p)\` is the set of derived claims \`p\` was refused.

Exact maximisation is a covering problem and NP-hard. The planner is greedy from
the low-utility end and **is labelled a heuristic**. What is not heuristic is the
safety of the result: every returned plan is re-checked against the rule engine
before it is handed back.

## Arm 1 — per-query

| | |
|---|---|
| queries planned | ${queries.toLocaleString()} |
| plans where the constraint bit | ${bound.toLocaleString()} (${pct(bound, queries).toFixed(2)}%) |
| protected claims prevented | ${violationsSeen.toLocaleString()} |
| evidence retained | **${perQueryRetention.toFixed(2)}%** |
| **cost** | **${perQueryCost.toFixed(2)}%** |
| plans verified safe | ${(queries - unsafe).toLocaleString()} / ${queries.toLocaleString()} |

## Arm 2 — session

Per-query safety **does not compose.** Ten individually safe answers can jointly
rebuild a protected claim — the aggregation attack, moved from documents to
sessions. A planner that only looks at the current reply is safe against a
reader and useless against an attacker, who will simply ask twice.

\`DisclosureLedger\` accumulates what a principal has actually been shown, and the
constraint is evaluated over that accumulation. Safety degrades into a budget:
the asker keeps getting answers until their own history starts to determine
something they were refused, and then, precisely then, Cordon starts withholding.

Retention is **cumulative** through query *i*, with the denominator shown. An
earlier version reported retention *at* query *i* and swung between 0% and 100%
between adjacent queries — a principal with few spaces has one or two admissible
candidates in a top-20, so one suppression moves the ratio the whole way. A
metric whose denominator is routinely 1 is not measuring anything.

| query | ledger size | admissible so far | retained | plans that bit |
|---|---|---|---|---|
${curve.filter((r, i) => i < 3 || r.query % 5 === 0 || i === curve.length - 1).map((r) => `| ${r.query} | ${r.ledger.toLocaleString()} | ${r.admissible.toLocaleString()} | ${r.retention.toFixed(1)}% | ${r.bound} |`).join('\n')}

Sessions verified safe: **${sessionUnsafe === 0 ? 'all' : `${sessionUnsafe} FAILED`}**.

## Arm 3 — where it starts to bind

If the constraint never bites, the guarantee is free and also untested. So: how
deep does retrieval have to go before an answer carries enough evidence to
rebuild something the asker was refused?

| top-k | queries | plans that bit | claims prevented | evidence retained |
|---|---|---|---|---|
${sweepRows.map((r) => `| ${r.k} | ${r.queries.toLocaleString()} | ${r.bound} | ${r.prevented.toLocaleString()} | ${r.retention.toFixed(1)}% |`).join('\n')}

${firstBind ? `The constraint first bites at **k=${firstBind.k}**. Below that, inference safety is free because an answer does not carry enough evidence to rebuild with.` : 'The constraint did not bite at any depth swept — at production retrieval depths this guarantee is free, and that is a measurement rather than a claim.'}

## What this does not claim

- **The subset choice is greedy, not optimal.** Exact maximisation is NP-hard.
  The safety check is exact; the utility is a heuristic.
- **The adversary is still ours.** It runs Cordon's published rules. A stronger
  one reconstructs more, so these costs are lower bounds.
- **The ledger is per principal, not per organisation.** Two colluding askers
  pool histories, and nothing here measures that.
`,
  );

  console.log(
    `\n${c.dim}written to docs/PLANNER.md and artifacts/planner-summary.json${c.reset}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
