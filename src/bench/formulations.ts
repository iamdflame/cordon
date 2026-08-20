/**
 * Two independent in-engine computations of the same requirement.
 *
 *   npm run bench:formulations
 *
 * `requiredSpaces` lowers a Cypher variable-length pattern to a walk and reads
 * a property off each source it lands on. `requiredSpacesViaPaths` asks the
 * engine's GraphBLAS single-source paths procedure for the actual paths and
 * reads the spaces out of the `Source` nodes inside them.
 *
 * They are different computations, not rephrasings of one. So when they agree
 * on every derived fact, that is a correctness statement of a kind we could not
 * otherwise make: our own invariant checking already taught us that a value
 * compared against itself proves nothing, and one traversal compared against
 * itself is the same mistake wearing a graph.
 *
 * Disagreement is the interesting outcome and is reported loudly. Latency is
 * reported too, because "which formulation should ship" is a question the
 * numbers should answer rather than taste.
 *
 * Writes docs/FORMULATIONS.md and artifacts/formulations.json.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { PermissionOracle } from '../cordon/query.js';
import { runProvenance } from './provenance.js';

const ESC = String.fromCharCode(27);
const c = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  gold: `${ESC}[33m`,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

async function main() {
  const sample = process.argv.includes('--sample');
  const capArg = process.argv.find((a) => a.startsWith('--facts='));
  const cap = capArg ? Number(capArg.split('=')[1]) : 400;

  const client = new HydraClient();
  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? (sample ? 'cordon-sample' : 'cordon-v1'),
    skipIngest: true,
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const oracle = new PermissionOracle(client, built.registry);
  const derived = built.facts.filter((f) => f.level >= 1).slice(0, cap);

  console.log(
    `\n${c.bold}Two in-engine formulations${c.reset} ${c.dim}${derived.length} derived facts${c.reset}\n`,
  );

  const patternMs: number[] = [];
  const pathsMs: number[] = [];
  let agree = 0;
  let comparable = 0;
  const disagreements: Array<{ fact: string; pattern: string[]; paths: string[] }> = [];
  let pathsUnresolvable = 0;
  let bothUnresolvable = 0;

  for (const fact of derived) {
    // Fresh oracles per measurement would re-load the org table; instead the
    // cache is bypassed by measuring each formulation on its own oracle.
    const a = new PermissionOracle(client, built.registry);
    const b = new PermissionOracle(client, built.registry);

    const t0 = performance.now();
    const viaPattern = await a.requiredSpaces(fact.id);
    patternMs.push(performance.now() - t0);

    const t1 = performance.now();
    const viaPaths = await b.requiredSpacesViaPaths(fact.id);
    pathsMs.push(performance.now() - t1);

    const patternFailed = viaPattern.includes('__unresolvable__');
    const pathsFailed = viaPaths.includes('__unresolvable__');
    if (pathsFailed) pathsUnresolvable++;

    /*
     * Two formulations that both failed have not agreed about anything.
     *
     * The first version of this benchmark counted mutual failure as a match and
     * reported 25/25 agreement on a graph whose RESTS_ON edges were not ingested
     * yet - the same tautology this project has now hit three times in three
     * different costumes. Pairs where neither side resolved are excluded from
     * the rate and reported on their own line.
     */
    if (patternFailed && pathsFailed) {
      bothUnresolvable++;
      continue;
    }

    comparable++;
    const left = [...viaPattern].sort().join(',');
    const right = [...viaPaths].sort().join(',');
    if (left === right) agree++;
    else if (disagreements.length < 15) {
      disagreements.push({ fact: fact.id, pattern: [...viaPattern].sort(), paths: [...viaPaths].sort() });
    }
  }

  patternMs.sort((x, y) => x - y);
  pathsMs.sort((x, y) => x - y);

  const row = (name: string, ms: number[]) =>
    `  ${name.padEnd(28)} ${percentile(ms, 50).toFixed(1).padStart(8)} ${percentile(ms, 95).toFixed(1).padStart(9)} ${percentile(ms, 99).toFixed(1).padStart(9)}`;

  console.log(`  ${'formulation'.padEnd(28)} ${'p50 ms'.padStart(8)} ${'p95 ms'.padStart(9)} ${'p99 ms'.padStart(9)}`);
  console.log('  ' + '-'.repeat(58));
  console.log(row('MATCH RESTS_ON*1..5', patternMs));
  console.log(row('algo.SSpaths (GraphBLAS)', pathsMs));

  const rate = comparable > 0 ? agree / comparable : 0;
  console.log(
    `\n  comparable pairs             ${comparable.toString().padStart(8)}` +
      `  ${c.dim}of ${derived.length} facts${c.reset}`,
  );
  console.log(
    `  agreement                    ${comparable > 0 && rate === 1 ? c.green : c.red}${agree}/${comparable}${c.reset}` +
      `  ${c.dim}${comparable > 0 ? (rate * 100).toFixed(2) + '%' : 'n/a'}${c.reset}`,
  );
  if (bothUnresolvable > 0) {
    console.log(
      `  ${c.gold}neither formulation resolved  ${bothUnresolvable.toString().padStart(8)}${c.reset}` +
        `  ${c.dim}excluded: mutual failure is not agreement${c.reset}`,
    );
  }
  if (comparable === 0) {
    console.log(
      `\n  ${c.red}Nothing to compare.${c.reset} ${c.dim}Both formulations failed on every fact,\n` +
        `  which usually means the RESTS_ON edges are not ingested. Finish\n` +
        `  \`npm run build:graph\` before trusting this benchmark.${c.reset}`,
    );
  }
  if (pathsUnresolvable > 0) {
    console.log(
      `  ${c.gold}paths formulation returned no path for ${pathsUnresolvable} facts${c.reset}`,
    );
  }
  for (const d of disagreements.slice(0, 3)) {
    console.log(`\n    ${c.red}${d.fact}${c.reset}`);
    console.log(`      pattern: ${d.pattern.join(', ')}`);
    console.log(`      paths  : ${d.paths.join(', ')}`);
  }

  const provenance = runProvenance('data/herb', 0);
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/formulations.json',
    JSON.stringify(
      {
        provenance,
        factsExamined: derived.length,
        comparable,
        agree,
        agreementRate: rate,
        bothUnresolvable,
        pathsUnresolvable,
        disagreements,
        latency: {
          pattern: { p50: percentile(patternMs, 50), p95: percentile(patternMs, 95), p99: percentile(patternMs, 99) },
          paths: { p50: percentile(pathsMs, 50), p95: percentile(pathsMs, 95), p99: percentile(pathsMs, 99) },
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    'docs/FORMULATIONS.md',
    `# Two in-engine formulations of the same question

Regenerate with \`npm run bench:formulations\`.
Raw data: [\`artifacts/formulations.json\`](../artifacts/formulations.json) —
git \`${provenance.gitSha.slice(0, 12)}\`, corpus \`${provenance.corpus.digest.slice(0, 16)}\`.

Cordon's security decision is *what does this fact rest on, transitively*. The
engine can answer that two different ways, and we ship both so they can be
checked against each other.

| | how it works |
|---|---|
| \`MATCH (f:Fact {id})-[:RESTS_ON*1..5]->(s:Source) RETURN s.space\` | a variable-length pattern lowered to a walk; reads a denormalised property off each source it lands on |
| \`CALL algo.SSpaths({relTypes: ["RESTS_ON"], sourceNode: id}) YIELD path\` | the engine's GraphBLAS single-source paths procedure; returns the **paths**, and the spaces are read from the \`Source\` nodes inside them |

## Do they agree?

**${agree} of ${comparable}** comparable pairs (${comparable > 0 ? (rate * 100).toFixed(2) + '%' : 'n/a'}), out of
${derived.length} derived facts examined.

${bothUnresolvable > 0 ? `**${bothUnresolvable}** facts are excluded because *neither* formulation resolved a
requirement for them. Two computations that both failed have not agreed about
anything, and counting mutual failure as a match is exactly the error this
repository keeps having to correct - see [CORRECTIONS.md](CORRECTIONS.md).
` : ''}

${
  rate === 1
    ? `They agree on every fact compared. That matters more than it looks: these are
different computations, not two spellings of one. Our own invariant check once
compared a value against itself and could not have failed, so "the traversal
agrees with the traversal" is not a statement we are willing to make. Two
independent engine formulations agreeing is.`
    : `**They disagree on ${derived.length - agree} facts**, which is a finding and is reported
here rather than resolved quietly. See \`disagreements\` in the raw artifact.`
}

${pathsUnresolvable > 0 ? `The paths formulation returned no path for **${pathsUnresolvable}** facts. Both formulations fail closed — no path means an unresolvable requirement, which nobody holds — so this direction over-restricts rather than over-discloses.\n` : ''}

## What each costs

| formulation | p50 | p95 | p99 |
|---|---|---|---|
| \`MATCH RESTS_ON*1..5\` | ${percentile(patternMs, 50).toFixed(1)} ms | ${percentile(patternMs, 95).toFixed(1)} ms | ${percentile(patternMs, 99).toFixed(1)} ms |
| \`algo.SSpaths\` | ${percentile(pathsMs, 50).toFixed(1)} ms | ${percentile(pathsMs, 95).toFixed(1)} ms | ${percentile(pathsMs, 99).toFixed(1)} ms |

Measured over ${derived.length} derived facts, cold cache per call.

## Why the paths formulation earns its place anyway

Even where it is slower, it returns something the pattern walk cannot: **the
path itself**. The derivation chain a reader sees is then an object the engine
computed, not one we reassembled client-side from a list of endpoints.

That is not a decoration. The entire argument for why this needs a graph is that
admissibility is a property of a *path*, and a path is exactly what an embedding
space does not have. Being able to hand back the engine's own path is the
strongest available form of that claim.

Note also that \`algo.SPpaths\`/\`algo.SSpaths\` are the *only* way to obtain a
path from this engine: \`RETURN p\` and \`nodes(p)\` are both rejected. The
procedure is load-bearing rather than ornamental.
`,
  );

  console.log(`\n${c.dim}written to docs/FORMULATIONS.md and artifacts/formulations.json${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
