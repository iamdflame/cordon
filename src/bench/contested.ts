/**
 * Disclosure-dependent truth.
 *
 *   npm run audit:contested
 *
 * Track 01 asks how you decide which of two contradictory statements to trust.
 * The usual answer is a trust score. We think there is a prior question that
 * only a system modelling both contest and access can ask:
 *
 *   whether you perceive a contradiction at all depends on your clearance.
 *
 * Writes docs/CONTESTED.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { corpusFromSnapshot, loadSnapshot } from '../cordon/corpus/github.js';
import {
  extractClaims,
  findContradictions,
  measureDisclosureDependentTruth,
  sharedSourceDisagreements,
  OPPOSING,
  type Claim,
} from '../cordon/contradict.js';

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

async function main() {
  const sample = process.argv.includes('--sample');
  const useGitHub = process.argv.includes('--github');
  const client = new HydraClient();

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    ...(useGitHub
      ? { corpus: corpusFromSnapshot(loadSnapshot('fixtures/github/snapshot.json')) }
      : {}),
    graphId: useGitHub ? 'cordon-github' : process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
    ...(sample ? { spaces: 8 } : {}),
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const { corpus, entitiesBySource, permissions } = built;

  console.log(`\n${c.bold}Extracting claims${c.reset} ${c.dim}deterministic, closed predicate set${c.reset}`);
  const claims: Claim[] = [];

  /*
   * Two independent signals, reported separately so a reader can see which is
   * doing the work.
   *
   * The pattern signal fires on prose that asserts something about a person or
   * a project. HERB's documents are long-form market research and specs and
   * almost never do that - name and role never co-occur once in 4.7M
   * characters - so on HERB it contributes almost nothing. That is a fact about
   * the corpus, not a failure of the detector, and saying so is better than
   * tuning until a number appears.
   *
   * The shared-source signal is where HERB's real disagreement lives.
   */
  for (const artifact of corpus.artifacts) {
    const entities = entitiesBySource.get(artifact.key) ?? new Set<string>();
    claims.push(...extractClaims(artifact, corpus, entities));
  }
  const patternClaims = claims.length;
  claims.push(...sharedSourceDisagreements(corpus));
  const sharedClaims = claims.length - patternClaims;

  const byPredicate = new Map<string, number>();
  for (const claim of claims) byPredicate.set(claim.predicate, (byPredicate.get(claim.predicate) ?? 0) + 1);
  console.log(
    `  ${claims.length.toLocaleString()} claims extracted  ` +
      `(${patternClaims.toLocaleString()} from prose patterns, ${sharedClaims.toLocaleString()} from shared sources)`,
  );
  for (const [predicate, n] of [...byPredicate].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${predicate.padEnd(10)} ${n.toLocaleString().padStart(8)}`);
  }

  const all = findContradictions(claims);
  /*
   * Only opposing predicates count as contradiction. Divergent descriptions of
   * a shared source are paraphrases and are reported separately - calling one a
   * contradiction would be the overclaim that costs a reader their trust in
   * every other number here.
   */
  const contradictions = all.filter((x) => OPPOSING.has(x.predicate));
  const divergences = all.filter((x) => x.predicate === 'description');
  const crossSpace = contradictions.filter((x) => x.crossSpace);

  console.log(`\n${c.bold}Contradictions${c.reset} ${c.dim}opposing claims only${c.reset}`);
  console.log(`  contested (subject, predicate) pairs   ${contradictions.length.toLocaleString().padStart(8)}`);
  console.log(
    `  ...where the sides sit in different spaces ${c.gold}${crossSpace.length.toLocaleString().padStart(7)}${c.reset}`,
  );

  console.log(
    `\n${c.bold}Description divergence${c.reset} ${c.dim}not contradiction - reported separately${c.reset}`,
  );
  console.log(`  shared sources described differently   ${divergences.length.toLocaleString().padStart(8)}`);

  const truth = measureDisclosureDependentTruth(contradictions, permissions.readable);
  const divergenceTruth = measureDisclosureDependentTruth(divergences, permissions.readable);

  console.log(`\n${c.bold}Disclosure-dependent truth${c.reset} ${c.dim}contest against access${c.reset}\n`);
  console.log(`  facts contested globally                       ${truth.contested.toLocaleString().padStart(9)}`);
  console.log(
    `  ...that appear ${c.gold}uncontested${c.reset} to at least one principal  ${c.gold}${truth.looksSettledToSomeone.toLocaleString().padStart(9)}${c.reset}`,
  );
  console.log(
    `  mean principals to whom a contested fact looks settled  ${truth.meanPrincipalsSeeingOneSide.toFixed(1).padStart(8)}`,
  );
  console.log(
    `  colleague pairs who would receive ${c.red}opposite${c.reset} values   ${c.red}${truth.opposedPairs.toLocaleString().padStart(9)}${c.reset}`,
  );
  console.log(
    `  mean principals who see no side at all                 ${truth.meanPrincipalsSeeingNothing.toFixed(1).padStart(8)}`,
  );

  if (truth.examples.length > 0) {
    console.log(`\n${c.bold}Concrete${c.reset}`);
    for (const example of truth.examples.slice(0, 3)) {
      console.log(`\n  ${c.cyan}${example.predicate}${c.reset} of ${example.subject}`);
      for (const side of example.sides) {
        console.log(`    "${side.quote}"  ${c.dim}[${side.spaces.join(', ')}]${c.reset}`);
      }
      console.log(
        `    ${c.dim}looks settled to ${example.settledFor} principals; ` +
          `${example.opposed} colleague pairs would disagree${c.reset}`,
      );
    }
  }

  /* ---------------------------------------------------------------- write */
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/CONTESTED.md',
    `# Disclosure-dependent truth

Regenerate with \`npm run audit:contested\`.

Track 01 names three hard problems: entity resolution, ontology alignment, and
*"figuring out which of two contradictory statements to trust."* The usual
answer to the third is a trust score - recency, seniority, a model asked to
adjudicate.

We think there is a prior question, and it is one only a system that models
**both** contest and access can ask:

> **Whether you perceive a contradiction at all depends on what you are allowed
> to see.**

If two sources conflict and they sit in different spaces, a principal with
access to only one sees a single uncontested claim. They are not told there is
another side. They are not told the other side exists.

## Detection

Deterministic and adjudication-free: a closed set of predicates
(\`role\`, \`status\`, \`decision\`, \`timing\`) matched by pattern over entities that
entity resolution has already resolved. No model decides anything.

That is a deliberate constraint rather than a shortcut. An adjudicator would
collapse the two sides into one answer and destroy exactly the structure being
measured - the fact that different people are holding different answers.

| predicate | claims extracted |
|---|---|
${[...byPredicate].sort((a, b) => b[1] - a[1]).map(([p, n]) => `| ${p} | ${n.toLocaleString()} |`).join('\n')}

${claims.length.toLocaleString()} claims total; ${contradictions.length.toLocaleString()} (subject, predicate) pairs where sources
disagree, of which **${crossSpace.length.toLocaleString()}** have their sides in different spaces.

## The interaction

Contested-ness and access are independent axes. This is what happens where they
meet.

| | count |
|---|---|
| facts contested globally | ${truth.contested.toLocaleString()} |
| ...that appear **uncontested** to at least one principal | **${truth.looksSettledToSomeone.toLocaleString()}** |
| mean principals to whom a contested fact looks settled | ${truth.meanPrincipalsSeeingOneSide.toFixed(1)} |
| **colleague pairs who would receive opposite values** | **${truth.opposedPairs.toLocaleString()}** |
| mean principals who see no side at all | ${truth.meanPrincipalsSeeingNothing.toFixed(1)} |

For **${truth.looksSettledToSomeone.toLocaleString()}** facts, whether you see a contradiction at all is determined by
your clearance. Two colleagues ask the same question and receive confidently
opposed answers, and neither is told the other side exists.

That is not a retrieval bug and no trust score addresses it. It is a property of
serving a partitioned corpus to people with different partitions - and it is
invisible to any system that does not model access and contest together.

${
  truth.examples.length > 0
    ? `## Concrete\n\n${truth.examples
        .slice(0, 4)
        .map(
          (e) =>
            `**${e.predicate}** of \`${e.subject}\`\n\n` +
            e.sides.map((s) => `> "${s.quote}" — \`${s.spaces.join('`, `')}\``).join('\n>\n') +
            `\n\nLooks settled to ${e.settledFor} principals. ${e.opposed} colleague pairs would ` +
            `walk away holding opposite values.`,
        )
        .join('\n\n---\n\n')}\n`
    : ''
}
## What Cordon does about it

**Disclose the contest, not the content.**

When a fact is contested by a source the asker cannot see, the console says:

> *N sources you do not have access to disagree with this.*

It names neither the conflicting claim nor its space. A user who is told their
answer is contested can escalate; a user told nothing cannot. Admissibility is
unchanged - a contested fact still inherits the union of its supports'
requirements, because conflict changes what a *permitted* answer looks like, not
who is permitted.

## The cost, counted honestly

The contest notice is itself a refusal-shaped side channel: the notice carries a
bit about the restricted graph, in exactly the way
[the refusal oracle](THREAT-MODEL.md#channel-3---refusal-as-an-oracle) does.

It is counted there rather than presented as free. A mitigation that opens a
channel and does not say so is not a mitigation.
`,
  );

  console.log(`\n${c.dim}written to docs/CONTESTED.md${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
