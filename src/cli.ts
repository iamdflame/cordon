/**
 * Cordon CLI.
 *
 *   npm run build:graph            ingest the enterprise graph into HydraDB
 *   npm run build:graph -- --dry   plan only, report the edge budget
 */

import { HydraClient } from './hydra/client.js';
import { buildGraph } from './cordon/pipeline.js';

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  gold: '\u001b[33m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  red: '\u001b[31m',
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  /*
   * The sample path exists because a one-hour write-bound ingest is a
   * reproducibility blocker. Three overlapping product spaces still exercise
   * every stage: shared staff, cross-space derived facts, and principals on
   * either side of them.
   */
  const isSample = args.includes('--sample');
  const spacesArg = args.find((a) => a.startsWith('--spaces='));
  const spaces = isSample ? 3 : spacesArg ? Number(spacesArg.split('=')[1]) : undefined;

  const client = new HydraClient();
  if (!(await client.ping())) {
    console.error(`${c.red}HydraDB unreachable.${c.reset} Start it with: npm run hydra:up`);
    process.exit(1);
  }

  console.log(`\n${c.bold}Cordon${c.reset} ${c.dim}building the enterprise graph${c.reset}\n`);

  let lastPhase = '';
  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? (isSample ? 'cordon-sample' : 'cordon-v1'),
    ...(spaces !== undefined ? { spaces } : {}),
    ...(dryRun ? { dryRun: true } : {}),
    onProgress: (phase, done, total, detail) => {
      if (detail) {
        if (lastPhase === 'ingest') process.stdout.write('\n');
        console.log(`  ${c.cyan}${phase.padEnd(10)}${c.reset} ${detail}`);
        lastPhase = phase;
      } else if (phase === 'ingest' && done % 2000 === 0) {
        lastPhase = 'ingest';
        const pct = ((done / total) * 100).toFixed(0);
        process.stdout.write(
          `\r  ${c.cyan}ingest    ${c.reset} ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%)   `,
        );
      }
    },
  });

  const s = built.stats as Record<string, any>;
  console.log(`\n${c.bold}Graph${c.reset}`);
  console.log(`  ${built.registry.size.toLocaleString()} nodes, ${s.plannedEdges.toLocaleString()} edges`);
  console.log(
    `  ${c.dim}${Object.entries(s.plan)
      .map(([k, v]) => `${k} ${(v as number).toLocaleString()}`)
      .join(' | ')}${c.reset}`,
  );

  console.log(`\n${c.bold}Entity resolution${c.reset}`);
  console.log(`  ${s.resolution.resolved.toLocaleString()} of ${s.resolution.total.toLocaleString()} mentions resolved`);
  console.log(`  candidates narrowed ${s.resolution.meanCandidatesBefore} -> ${s.resolution.meanCandidatesAfter}`);
  console.log(
    `  ${c.green}precision ${(s.accuracy.precision * 100).toFixed(1)}%${c.reset}  recall ${(s.accuracy.recall * 100).toFixed(1)}%  ${c.dim}(n=${s.accuracy.evaluated.toLocaleString()} held out)${c.reset}`,
  );

  console.log(`\n${c.bold}Facts${c.reset}`);
  console.log(
    `  ${s.facts.level0.toLocaleString()} read from sources, ${s.facts.crossSpaceDerived} derived across spaces`,
  );
  console.log(`  ${c.dim}max spaces required by one fact: ${s.facts.maxRequiredSpaces}${c.reset}`);

  if (s.ingest) {
    console.log(
      `\n${c.dim}ingest ${(s.ingest.durationMs / 1000).toFixed(0)}s @ ${s.ingest.edgesPerSecond} edges/s${c.reset}`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
