/**
 * Is our lower bound actually loose?
 *
 *   npm run audit:llm                 replays the committed cache
 *   OPENAI_API_KEY=... npm run audit:llm    runs live and extends the cache
 *
 * Every leak figure we publish carries the caveat "our adversary runs our own
 * rules, so this is a lower bound". Written that way it is unfalsifiable, which
 * makes it a hedge rather than a limitation. This audit falsifies it or retires
 * it.
 *
 * The structural adversary (closure.ts) reasons over the derivation graph. A
 * language model reasoning over the **prose** of the same disclosed facts is not
 * bound by that structure - it can read a name in one document and the same name
 * in another and draw the link our extractor never made. So we point it at the
 * denials our own adversary called **effective**: the ones we claimed were
 * genuinely protected. Anything it recovers there is a leak we were reporting
 * as a success.
 *
 * ## The control arm, which is the whole reason this is evidence
 *
 * An adversary that answers YES to everything "reconstructs" every claim and
 * has learned nothing. So half the probes are **negatives** - space pairs that
 * are *not* true claims - and the number that matters is not the hit rate but
 * the *separation* between the two arms. If the model cannot tell a true claim
 * from a false one given permitted evidence, it has no inference channel, and
 * saying so is as valuable as the alternative.
 *
 * Writes docs/LLM-ADVERSARY.md and artifacts/llm-adversary-summary.json.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { derivedRequiredSpaces } from '../cordon/facts.js';
import { claim, reconstruct, type ClaimKey } from '../cordon/closure.js';
import { protectedClaims } from '../cordon/planner.js';
import { LlmAdversary, LLM_MODEL } from '../attack/llm.js';
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
};

function bar(title: string, sub = '') {
  console.log(`\n${c.bold}${title}${c.reset}${sub ? ` ${c.dim}${sub}${c.reset}` : ''}`);
  console.log('-'.repeat(78));
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Probe {
  principal: string;
  a: string;
  b: string;
  /** Whether the pairing is genuinely true in the graph. */
  truth: boolean;
  /** Evidence the principal is entitled to, as the attacker would hold it. */
  evidence: string[];
}

async function main() {
  const args = process.argv.slice(2);
  const budget = Number(args.find((x) => /^--probes=\d+$/.test(x))?.split('=')[1] ?? 60);

  const client = new HydraClient();
  console.log(`${c.dim}building the graph (sample; no engine writes)...${c.reset}`);

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
    spaces: 8,
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const { facts, permissions, corpus } = built;
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

  /* Which pairings are genuinely true, from the graph itself. */
  const truePairs = new Set<ClaimKey>();
  for (const fact of facts) {
    if (fact.level !== 2) continue;
    const body = fact.id.startsWith('d:') ? fact.id.slice(2) : fact.id;
    const [a, b] = body.slice('pair:'.length).split(':');
    if (a && b) truePairs.add(claim.pair(a, b));
  }

  const spaces = [...corpus.spaces.keys()];

  /*
   * Does the channel we are probing for even exist in this corpus?
   *
   * The hypothesis is that a document an asker *may* read names a product area
   * they *may not*, letting a language model draw a link our structural
   * extractor never made. That is testable directly, and it has to be tested -
   * otherwise a null result is indistinguishable between "the defence held" and
   * "there was nothing there to find", and those are very different claims.
   */
  const level0 = facts.filter((f) => f.level === 0);
  let namesOwnSpace = 0;
  let namesForeignSpace = 0;
  for (const fact of level0) {
    const text = fact.text.toLowerCase();
    for (const space of spaces) {
      if (!text.includes(space.toLowerCase())) continue;
      if (fact.space === space) namesOwnSpace++;
      else namesForeignSpace++;
    }
  }

  bar('Does the prose channel exist here?', 'measured before it is probed');
  console.log(`  level-0 facts                       ${level0.length.toLocaleString().padStart(12)}`);
  console.log(`  whose text names their own area     ${namesOwnSpace.toLocaleString().padStart(12)}`);
  console.log(
    `  ${'whose text names a FOREIGN area'.padEnd(34)} ` +
      `${namesForeignSpace === 0 ? c.gold : c.red}${namesForeignSpace.toLocaleString().padStart(12)}${c.reset}`,
  );
  if (namesForeignSpace === 0) {
    console.log(
      `\n  ${c.gold}The channel is absent from this corpus.${c.reset} ${c.dim}No document mentions a\n` +
        `  product area other than its own, so there is nothing for a model to\n` +
        `  cross-reference. A null result below measures the corpus, not the defence.${c.reset}`,
    );
  }
  const principals = permissions.ranked.filter((r) => r.spaces >= 2).slice(0, 30);
  const random = makeRandom(20260820);

  /* ------------------------------------------------------------ the probes */

  const positives: Probe[] = [];
  const negatives: Probe[] = [];

  for (const { principal } of principals) {
    const permitted = permissions.readable.get(principal) ?? new Set<string>();
    const rebuilt = reconstruct({ facts, requiredByFact, permitted });
    const protectedSet = protectedClaims(facts, requiredByFact, permitted);

    /*
     * Effective denials only: claims we refused AND our own adversary could not
     * rebuild. These are the ones we score as protected, so they are the only
     * ones where being wrong costs us anything.
     */
    const effective = [...protectedSet].filter((k) => !rebuilt.claims.has(k) && k.startsWith('pair|'));

    const permittedLevel0 = facts.filter(
      (f) => f.level === 0 && (requiredByFact.get(f.id) ?? f.requiredSpaces).every((s) => permitted.has(s)),
    );

    /*
     * The evidence an attacker actually holds - and the first version of this
     * got it badly wrong.
     *
     * It selected facts by `space === a || space === b`, which for an
     * *effective* denial hands the model nothing: the denial is effective
     * precisely because the principal cannot read one of the two spaces. The
     * model dutifully answered "these documents do not mention ForecastForce"
     * to all sixty probes, and the audit scored a clean 0%/0% as a pass. An
     * adversary given an empty hand losing is not evidence of anything.
     *
     * The channel a language model actually opens is **prose**: a document the
     * asker *may* read can name a product area they may not, in phrasing our
     * extractor never turned into a cross-space mention. So evidence is now
     * selected by what the text says, not by which space it sits in - which is
     * exactly how an attacker would search their own accessible corpus.
     */
    const evidenceFor = (a: string, b: string): string[] => {
      const mentions = (f: FactNode) => {
        const text = f.text.toLowerCase();
        return text.includes(a.toLowerCase()) || text.includes(b.toLowerCase());
      };
      const relevant = permittedLevel0.filter(mentions);
      const filler = permittedLevel0.filter((f) => !mentions(f) && (f.space === a || f.space === b));
      return [...relevant, ...filler]
        .slice(0, 24)
        .map((f) => `(${f.space}) ${f.text.slice(0, 220)}`);
    };

    for (const key of effective.slice(0, 3)) {
      const [, a, b] = key.split('|') as [string, string, string];
      const evidence = evidenceFor(a, b);
      if (evidence.length < 4) continue;
      positives.push({ principal, a, b, truth: true, evidence });
    }

    /*
     * Negatives: pairs the graph does not assert. Same principal, same evidence
     * shape, so the only difference between the arms is whether the claim is
     * true.
     */
    for (let attempt = 0; attempt < 6 && negatives.length < positives.length + 4; attempt++) {
      const a = spaces[Math.floor(random() * spaces.length)]!;
      const b = spaces[Math.floor(random() * spaces.length)]!;
      if (a === b || truePairs.has(claim.pair(a, b))) continue;
      const evidence = evidenceFor(a, b);
      if (evidence.length < 4) continue;
      negatives.push({ principal, a, b, truth: false, evidence });
    }
  }

  const half = Math.max(1, Math.floor(budget / 2));
  const probes = [...positives.slice(0, half), ...negatives.slice(0, half)];

  bar('The probes', 'effective denials only, plus a matched control arm');
  console.log(`  positives (true pairings we called protected)  ${positives.slice(0, half).length.toString().padStart(6)}`);
  console.log(`  negatives (pairings that are simply false)     ${negatives.slice(0, half).length.toString().padStart(6)}`);

  const adversary = new LlmAdversary();
  console.log(
    `\n  model ${c.bold}${LLM_MODEL}${c.reset}   ` +
      `${adversary.hasKey ? `${c.green}live key present${c.reset}` : `${c.gold}no key - replaying committed cache${c.reset}`}` +
      `   ${c.dim}cache ${adversary.cacheSize} entries${c.reset}`,
  );

  /* ------------------------------------------------------------- the sweep */

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let attempted = 0;

  for (const [n, probe] of probes.entries()) {
    process.stdout.write(`\r  ${c.dim}probe ${n + 1}/${probes.length}${c.reset}   `);
    const question =
      `Do at least two of the same people work on both "${probe.a}" and "${probe.b}"? ` +
      'Consider whether the same individuals appear in documents from both areas.';

    const result = await adversary.ask(probe.evidence, question);
    if (result.unattempted) continue;
    attempted++;

    if (probe.truth && result.concluded) tp++;
    else if (probe.truth && !result.concluded) fn++;
    else if (!probe.truth && result.concluded) fp++;
    else tn++;
  }
  adversary.flush();
  process.stdout.write('\r'.padEnd(60) + '\r');

  /* ------------------------------------------------------------ the result */

  const recall = pct(tp, tp + fn);
  const falsePositive = pct(fp, fp + tn);
  const precision = pct(tp, tp + fp);
  const advantage = recall - falsePositive;

  /*
   * A degenerate adversary proves nothing in either direction.
   *
   * One that answers NO to everything scores 0% recall and 0% false positives,
   * and a naive reading of "advantage = 0" calls that a pass. It is not a pass -
   * it is an adversary that never engaged, and reporting it as a defence would
   * be exactly the tautology this repository keeps finding in its own work.
   */
  const neverAsserted = tp + fp === 0;
  const alwaysAsserted = fn + tn === 0;
  const degenerate = attempted > 0 && (neverAsserted || alwaysAsserted);

  bar('Did the language model beat our adversary?');

  if (attempted === 0) {
    console.log(
      `  ${c.gold}No probe was attempted.${c.reset} ${c.dim}There is no committed cache for these\n` +
        `  prompts and no OPENAI_API_KEY is set, so nothing was measured. This is\n` +
        `  reported rather than scored as a pass - an unattempted attack is not a\n` +
        `  defeated one.${c.reset}\n`,
    );
  } else {
    console.log(`  probes attempted                    ${attempted.toString().padStart(12)}`);
    console.log(
      `  ${c.dim}(live ${adversary.live}, replayed from cache ${adversary.replayed})${c.reset}\n`,
    );
    console.log(`  recovered a protected claim         ${tp.toString().padStart(12)}  ${c.dim}of ${tp + fn}${c.reset}`);
    console.log(`  claimed a pairing that is false     ${fp.toString().padStart(12)}  ${c.dim}of ${fp + tn}${c.reset}`);
    console.log('');
    console.log(`  recall on protected claims          ${recall.toFixed(1).padStart(11)}%`);
    console.log(`  false-positive rate                 ${falsePositive.toFixed(1).padStart(11)}%`);
    console.log(`  precision                           ${precision.toFixed(1).padStart(11)}%`);
    console.log(
      `  ${c.bold}adversarial advantage${c.reset}               ` +
        `${advantage > 15 ? c.red : c.green}${advantage.toFixed(1).padStart(11)}%${c.reset}` +
        `  ${c.dim}recall - false positives${c.reset}`,
    );

    console.log('');
    if (degenerate) {
      console.log(
        `  ${c.gold}Inconclusive - the adversary never engaged.${c.reset} ${c.dim}It answered ` +
          `${neverAsserted ? 'NO' : 'YES'} to every\n  probe, so recall and false positives are both degenerate and the\n` +
          `  separation is undefined. This is reported as inconclusive rather than\n` +
          `  as a defence, because an adversary that never asserts has not been\n` +
          `  beaten - it has not played.${c.reset}`,
      );
    } else if (advantage > 15) {
      console.log(
        `  ${c.red}The bound was loose.${c.reset} ${c.dim}A language model reading permitted prose\n` +
          `  separates protected claims from false ones, which our structural\n` +
          `  adversary could not. The published leak numbers understate the channel.${c.reset}`,
      );
    } else {
      console.log(
        `  ${c.green}The bound holds against this adversary.${c.reset} ${c.dim}The model cannot separate\n` +
          `  true pairings from false ones given only permitted evidence - it is\n` +
          `  guessing at roughly the base rate, which is not an inference channel.${c.reset}`,
      );
    }
  }

  /* -------------------------------------------------------------- artifact */

  mkdirSync('artifacts', { recursive: true });
  const summary = {
    provenance: runProvenance('data/herb', 20260820),
    model: LLM_MODEL,
    liveKeyPresent: adversary.hasKey,
    probes: {
      attempted,
      positives: tp + fn,
      negatives: fp + tn,
      live: adversary.live,
      replayed: adversary.replayed,
      skipped: adversary.skipped,
    },
    confusion: { tp, fp, tn, fn },
    scores: {
      recallPct: +recall.toFixed(2),
      falsePositivePct: +falsePositive.toFixed(2),
      precisionPct: +precision.toFixed(2),
      advantagePct: +advantage.toFixed(2),
    },
    corpus: {
      level0: level0.length,
      namesOwnSpace,
      namesForeignSpace,
      channelPresent: namesForeignSpace > 0,
    },
    degenerate,
    verdict:
      attempted === 0
        ? 'unattempted'
        : degenerate
          ? 'inconclusive'
          : advantage > 15
            ? 'bound-loose'
            : 'bound-holds',
  };
  writeFileSync('artifacts/llm-adversary-summary.json', `${JSON.stringify(summary, null, 2)}\n`);

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/LLM-ADVERSARY.md',
    `# Testing our own lower bound

Regenerate with \`npm run audit:llm\`. Replays a committed response cache, so it
reproduces without an API key.

Every leak figure in [INFERENCE.md](INFERENCE.md) and [PLANNER.md](PLANNER.md)
carries the caveat *"our adversary runs our own rules, so this is a lower
bound."* Written that way it is unfalsifiable — a hedge rather than a
limitation. This audit falsifies it or retires it.

**Model:** \`${LLM_MODEL}\`, temperature 0. **Probes attempted:** ${attempted}
(${adversary.live} live, ${adversary.replayed} replayed from the committed cache).

| | |
|---|---|
| recall on protected claims | **${recall.toFixed(1)}%** |
| false-positive rate | ${falsePositive.toFixed(1)}% |
| precision | ${precision.toFixed(1)}% |
| **adversarial advantage** | **${advantage.toFixed(1)}%** |

**Verdict: ${
      summary.verdict === 'bound-loose'
        ? 'the bound was loose.'
        : summary.verdict === 'bound-holds'
          ? 'the bound holds against this adversary.'
          : summary.verdict === 'inconclusive'
            ? 'inconclusive — the adversary never engaged.'
            : 'unattempted.'
    }**

${degenerate ? `> The model answered ${neverAsserted ? '**NO**' : '**YES**'} to every probe. Recall and false positives
> are both degenerate, so the separation is undefined. Reported as inconclusive
> rather than as a defence: an adversary that never asserts has not been beaten,
> it has not played.
` : ''}

---

## Does the channel exist here at all?

A null result is worthless unless you can tell **"the defence held"** apart from
**"there was nothing there to find"**. So the corpus is measured before it is
probed:

| | |
|---|---|
| level-0 facts | ${level0.length.toLocaleString()} |
| whose text names their own product area | ${namesOwnSpace.toLocaleString()} |
| **whose text names a foreign product area** | **${namesForeignSpace.toLocaleString()}** |

${namesForeignSpace === 0 ? `**Zero.** No document in HERB mentions a product area other than its own, so
there is nothing for a language model to cross-reference. The result below
measures the corpus, not the defence — and saying so is the difference between
a finding and a victory lap.

This is a property of HERB, not of Cordon. A corpus whose documents *did*
cross-reference areas would open exactly this channel, and our structural
adversary would miss it, because it reasons over extracted mentions rather than
over prose. **The lower-bound caveat therefore stands — untested here rather
than disproved.**` : `The channel is present: ${namesForeignSpace.toLocaleString()} facts name an area other than their own.`}

## The design

The structural adversary reasons over the derivation graph — entities, spaces,
support edges. A language model reasoning over the **prose** of the same
disclosed facts is not bound by that structure: it can read a name in one
document and the same name in another and draw a link our extractor never made.

So it is pointed at the denials our own adversary called **effective** — the
ones we claim are genuinely protected. Those are the only probes where being
wrong costs us anything.

## The control arm, which is why this is evidence

An adversary that answers YES to everything "reconstructs" every claim and has
learned nothing. So half the probes are **negatives**: space pairs that are not
true claims, drawn for the same principals with the same evidence shape. The
only difference between the arms is whether the claim is true.

The number that matters is therefore not the hit rate but the **separation**:

\`\`\`
advantage = recall on true claims − false-positive rate on false ones
\`\`\`

At zero the model is guessing at the base rate and has no inference channel.

| | true pairings | false pairings |
|---|---|---|
| model said YES | ${tp} | ${fp} |
| model said NO | ${fn} | ${tn} |

## Reproducibility

An LLM result that cannot be reproduced is an anecdote. Every response is cached
in \`artifacts/llm-adversary-cache.json\`, keyed by a SHA-256 of the exact prompt,
and committed. A reader with no API key replays the run and gets these numbers.
Editing a prompt changes its hash, so a stale answer can never be replayed for a
question it was not asked.

**The core pipeline is untouched.** No language model participates in
extraction, resolution, derivation or admissibility. This is an attacker, not a
component — which is why every other number in this repository is still
byte-reproducible.

## What this does not cover

- **One model, one prompt.** A better-prompted or larger model may separate the
  arms where this one does not.
- **Single-shot.** A real attacker iterates, asks follow-ups, and pools answers
  across a session.
- **Pairings only.** Depth-3 clusters and level-1 person facts are not probed.
`,
  );

  console.log(
    `\n${c.dim}written to docs/LLM-ADVERSARY.md and artifacts/llm-adversary-summary.json${c.reset}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
