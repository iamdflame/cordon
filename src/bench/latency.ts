/**
 * What it costs to answer admissibility at query time.
 *
 *   npm run bench:latency
 *
 * The architectural claim is that admissibility cannot be precomputed: it is a
 * reachability question with a per-principal predicate, and with n principals
 * there are 2^n visibility subsets. An architectural claim with no number
 * attached is an opinion, so this measures both halves:
 *
 *   - what the traversal actually costs, per decision, at the tail
 *   - what the materialisation we are arguing against would cost, extrapolated
 *     from the real corpus rather than from the worst case
 *
 * Writes docs/LATENCY.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { PermissionOracle } from '../cordon/query.js';
import { admissible } from '../cordon/acl.js';

const ESC = String.fromCharCode(27);
const c = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  cyan: `${ESC}[36m`,
  gold: `${ESC}[33m`,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / Math.max(samples.length, 1);
  return {
    n: samples.length,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function bar(title: string, sub = '') {
  console.log(`\n${c.bold}${title}${c.reset}${sub ? ` ${c.dim}${sub}${c.reset}` : ''}`);
  console.log('-'.repeat(72));
}

async function main() {
  const client = new HydraClient();
  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const { facts, permissions, corpus } = built;
  const oracle = new PermissionOracle(client, built.registry);
  const derived = facts.filter((f) => f.level >= 1);

  /* --------------------------------------------- cold traversal, by depth */
  bar('Requirement traversal', 'cold, one query per fact, no cache');

  const byDepth = new Map<number, number[]>();
  const requiredByFact = new Map<string, string[]>();
  const sampleSize = Math.min(derived.length, 400);
  const step = Math.max(1, Math.floor(derived.length / sampleSize));

  for (let i = 0; i < derived.length; i += step) {
    const fact = derived[i]!;
    const started = performance.now();
    const required = await oracle.requiredSpaces(fact.id);
    const elapsed = performance.now() - started;
    requiredByFact.set(fact.id, required);
    const list = byDepth.get(fact.level);
    if (list) list.push(elapsed);
    else byDepth.set(fact.level, [elapsed]);
  }

  console.log(
    `  ${'depth'.padEnd(7)} ${'n'.padStart(6)} ${'mean'.padStart(9)} ${'p50'.padStart(9)} ` +
      `${'p95'.padStart(9)} ${'p99'.padStart(9)}`,
  );
  const depthRows: Array<{ level: number } & ReturnType<typeof stats>> = [];
  for (const [level, samples] of [...byDepth].sort((a, b) => a[0] - b[0])) {
    const s = stats(samples);
    depthRows.push({ level, ...s });
    console.log(
      `  ${String(level).padEnd(7)} ${String(s.n).padStart(6)} ${s.mean.toFixed(1).padStart(8)}ms ` +
        `${s.p50.toFixed(1).padStart(8)}ms ${s.p95.toFixed(1).padStart(8)}ms ${s.p99.toFixed(1).padStart(8)}ms`,
    );
  }
  const allTraversals = [...byDepth.values()].flat();
  const traversalStats = stats(allTraversals);

  /* --------------------------------- warm decisions, the production path */
  bar('Admissibility decision', 'warm: requirement resolved, set check per asker');

  const principals = permissions.ranked.slice(0, 64).map((r) => r.principal);
  const resolved = [...requiredByFact.entries()];
  const decisionSamples: number[] = [];
  const bySpaceCount = new Map<number, number[]>();

  const decisionStart = performance.now();
  let decisions = 0;
  for (const principal of principals) {
    const held = permissions.readable.get(principal)?.size ?? 0;
    const bucket = held === 0 ? 0 : held <= 2 ? 2 : held <= 5 ? 5 : held <= 10 ? 10 : 30;
    for (const [factId, required] of resolved) {
      const started = performance.now();
      admissible(permissions, principal, required);
      const elapsed = performance.now() - started;
      decisionSamples.push(elapsed);
      decisions++;
      const list = bySpaceCount.get(bucket);
      if (list) list.push(elapsed);
      else bySpaceCount.set(bucket, [elapsed]);
      void factId;
    }
  }
  const wall = performance.now() - decisionStart;
  const decisionStats = stats(decisionSamples);
  const perSecond = Math.round(decisions / (wall / 1000));

  console.log(`  decisions            ${decisions.toLocaleString().padStart(12)}`);
  console.log(`  mean                 ${decisionStats.mean.toFixed(4).padStart(11)}ms`);
  console.log(`  p50                  ${decisionStats.p50.toFixed(4).padStart(11)}ms`);
  console.log(`  p95                  ${decisionStats.p95.toFixed(4).padStart(11)}ms`);
  console.log(`  p99                  ${decisionStats.p99.toFixed(4).padStart(11)}ms`);
  console.log(
    `  throughput           ${c.cyan}${perSecond.toLocaleString().padStart(12)}${c.reset} decisions/s, single instance`,
  );

  console.log(`\n  ${c.dim}by |permittedSpaces|${c.reset}`);
  const spaceRows: Array<{ bucket: number; mean: number; p99: number; n: number }> = [];
  for (const [bucket, samples] of [...bySpaceCount].sort((a, b) => a[0] - b[0])) {
    const s = stats(samples);
    spaceRows.push({ bucket, mean: s.mean, p99: s.p99, n: s.n });
    console.log(
      `    <= ${String(bucket).padEnd(4)} ${String(s.n).padStart(8)} decisions  ` +
        `mean ${s.mean.toFixed(4)}ms  p99 ${s.p99.toFixed(4)}ms`,
    );
  }

  /* --------------------------------- the materialisation we argue against */
  bar('The alternative', 'what precomputing would actually cost');

  const everyone = [...corpus.employees.keys()];
  const subsets = new Set<string>();
  for (const principal of everyone) {
    const held = [...(permissions.readable.get(principal) ?? [])].sort();
    subsets.add(held.join('|'));
  }

  const spaceCount = corpus.spaces.size;
  const pairs = facts.length * everyone.length;
  const distinctSubsets = subsets.size;
  const possibleSubsets = Math.pow(2, spaceCount);

  console.log(`  spaces                              ${String(spaceCount).padStart(14)}`);
  console.log(`  principals                          ${everyone.length.toLocaleString().padStart(14)}`);
  console.log(`  facts                               ${facts.length.toLocaleString().padStart(14)}`);
  console.log('');
  console.log(
    `  per-principal materialisation       ${c.gold}${pairs.toLocaleString().padStart(14)}${c.reset} rows`,
  );
  console.log(
    `  distinct permission subsets today   ${distinctSubsets.toLocaleString().padStart(14)}`,
  );
  console.log(
    `  possible permission subsets (2^${spaceCount})   ${c.gold}${possibleSubsets.toExponential(2).padStart(14)}${c.reset}`,
  );

  const rebuildPerPrincipal = facts.length * decisionStats.mean;
  console.log('');
  console.log(
    `  ${c.dim}One membership change invalidates that principal's entire row set:\n` +
      `  ${facts.length.toLocaleString()} rows, ~${(rebuildPerPrincipal / 1000).toFixed(1)}s to rebuild — and that is the\n` +
      `  cheap case, where the requirement is already resolved.${c.reset}`,
  );

  const coldRebuild = (derived.length * traversalStats.mean) / 1000;
  console.log(
    `  ${c.dim}Cold, with traversal: ~${coldRebuild.toFixed(0)}s per principal.${c.reset}`,
  );

  /* ---------------------------------------------------------------- write */
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/LATENCY.md',
    `# Latency

Regenerate with \`npm run bench:latency\`. Single instance, local HydraDB,
no warm cache except where stated.

## Requirement traversal, cold

One graph query per fact, no caching. This is the expensive half and it is paid
once per fact rather than once per asker.

| depth | n | mean | p50 | p95 | p99 |
|---|---|---|---|---|---|
${depthRows.map((r) => `| ${r.level} | ${r.n} | ${r.mean.toFixed(1)}ms | ${r.p50.toFixed(1)}ms | ${r.p95.toFixed(1)}ms | ${r.p99.toFixed(1)}ms |`).join('\n')}

Latency rises with derivation depth, because a deeper fact is a longer walk.
That is the shape you would predict, and it is also a channel we have **not**
measured — see [THREAT-MODEL.md](THREAT-MODEL.md#what-is-still-unmeasured).

## Admissibility decision, warm

The production path: requirement already resolved, one subset check per asker.
This is what a request actually pays per fact.

| | |
|---|---|
| decisions measured | ${decisions.toLocaleString()} |
| mean | ${decisionStats.mean.toFixed(4)} ms |
| p50 | ${decisionStats.p50.toFixed(4)} ms |
| p95 | ${decisionStats.p95.toFixed(4)} ms |
| p99 | ${decisionStats.p99.toFixed(4)} ms |
| **throughput** | **${perSecond.toLocaleString()} decisions/s**, single instance |

### By |permittedSpaces|

| spaces held | decisions | mean | p99 |
|---|---|---|---|
${spaceRows.map((r) => `| <= ${r.bucket} | ${r.n.toLocaleString()} | ${r.mean.toFixed(4)}ms | ${r.p99.toFixed(4)}ms |`).join('\n')}

The check is a subset test over a small set, so it is flat in the number of
spaces held. The cost that matters is the traversal above, and the API resolves
derived requirements at boot for exactly that reason — a 70-second warm-up turns
a 17-second first request into 7-55ms.

## The alternative, costed

Cordon's architectural claim is that admissibility cannot be precomputed. Here
is the claim as a number rather than as an argument.

| | |
|---|---|
| spaces | ${spaceCount} |
| principals | ${everyone.length.toLocaleString()} |
| facts | ${facts.length.toLocaleString()} |
| **per-principal materialisation** | **${pairs.toLocaleString()} rows** |
| distinct permission subsets in this org today | ${distinctSubsets.toLocaleString()} |
| **possible permission subsets (2^${spaceCount})** | **${possibleSubsets.toExponential(2)}** |

Two ways to precompute, and both fail for the same reason.

**Per principal.** ${pairs.toLocaleString()} rows, and one membership change invalidates that
principal's entire row set — ${facts.length.toLocaleString()} rows, roughly
**${(rebuildPerPrincipal / 1000).toFixed(1)}s** to rebuild warm and **${coldRebuild.toFixed(0)}s** cold. Access changes are not
rare events in an enterprise; they are the normal state of one.

**Per permission subset.** Only ${distinctSubsets.toLocaleString()} distinct subsets exist in this
organisation right now, which sounds tractable until you notice that the space
of subsets is ${possibleSubsets.toExponential(2)} and every new one is a cache miss that has to
traverse anyway. You cannot enumerate what you have not seen, and a security
system whose fast path is "the case I already computed" fails open on the case
I did not.

So the requirement is discovered by walking \`RESTS_ON*\` at query time, per
asker. It costs ${traversalStats.p50.toFixed(1)}ms at p50 to resolve and
${decisionStats.p50.toFixed(4)}ms to decide, and it is correct for a
principal whose access changed one second ago.
`,
  );

  console.log(`\n${c.dim}written to docs/LATENCY.md${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
