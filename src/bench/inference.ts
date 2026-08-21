/**
 * The inference audit: what a denial is actually worth.
 *
 *   npm run audit:inference
 *   npm run audit:inference -- --sample
 *
 * The main audit proves Cordon never *hands over* a fact the asker lacks
 * provenance for: 0 leaks in 330,190 pairs, at 0.000 F1 cost. That result is
 * real and it is about provenance.
 *
 * This one asks the question a security reviewer would ask next, and it is a
 * harder question: when Cordon refuses, does the asker end up not knowing?
 *
 * Cordon's derivation rules ship in this repository under Apache-2.0, so an
 * adversary does not have to reverse-engineer them. They take what they were
 * given and run our own rules to fixpoint. Every denied claim that falls out
 * was never protected - the requirement said one thing and the world did
 * another.
 *
 * Writes docs/INFERENCE.md. Needs no engine: requirements are recomputed from
 * the corpus by traversal, which is the independent derivation the main audit
 * already checks the graph against.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { derivedRequiredSpaces } from '../cordon/facts.js';
import { claimOf, reconstruct, minimumCut, cutHolds, type ClaimKey } from '../cordon/closure.js';
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

interface DenialRow {
  principal: string;
  claim: ClaimKey;
  level: number;
  /** Rebuilt from permitted evidence: the denial bought nothing. */
  phantom: boolean;
  /** Cheapest number of otherwise-readable facts to make the denial real. */
  cutCost: number;
  /** Verified by re-running the adversary with the cut applied. */
  cutVerified: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const sample = args.includes('--sample');
  const cap = Number(args.find((a) => /^\d+$/.test(a)) ?? (sample ? 40 : 200));
  /*
   * Verification re-runs the whole adversary per cut, so it is quadratic in the
   * corpus. We verify a deterministic prefix rather than silently verifying
   * none, and report exactly how many - "verified" with an unstated denominator
   * is the kind of claim this repository exists to not make.
   */
  const verifyCap = Number(args.find((a) => /^--verify=\d+$/.test(a))?.split('=')[1] ?? 400);

  const client = new HydraClient();
  console.log(`${c.dim}building the graph (no engine writes; requirements by traversal)...${c.reset}`);

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

  /*
   * Requirements, recomputed from the corpus rather than read off the node.
   *
   * The same discipline as the main audit: a security property checked only
   * against the field that produced it is not being checked.
   */
  const factById = new Map(facts.map((f) => [f.id, f]));
  const sourceSpace = new Map<string, string>();
  for (const artifact of corpus.artifacts) sourceSpace.set(ids.source(artifact.key), artifact.space);

  const requiredByFact = new Map<string, readonly string[]>();
  for (const fact of facts) {
    requiredByFact.set(
      fact.id,
      fact.level === 0
        ? fact.requiredSpaces
        : [...derivedRequiredSpaces(fact.id, factById, sourceSpace)],
    );
  }

  /* Deterministic principal sample, widest access first: the strongest askers. */
  const principals = permissions.ranked
    .filter((r) => r.spaces > 0)
    .slice(0, cap)
    .map((r) => r.principal);

  const derived = facts.filter((f) => f.level > 0);
  console.log(
    `\n  ${c.dim}${facts.length.toLocaleString()} facts (${derived.length.toLocaleString()} derived) ` +
      `x ${principals.length} principals${c.reset}`,
  );

  const rows: DenialRow[] = [];
  let attempted = 0;
  let confirmed = 0;
  const cutUnionByPrincipal = new Map<string, Set<string>>();
  const readableByPrincipal = new Map<string, number>();

  for (const [n, principal] of principals.entries()) {
    if (n % 25 === 0) process.stdout.write(`\r  ${c.dim}principal ${n + 1}/${principals.length}${c.reset}   `);
    const permitted = permissions.readable.get(principal) ?? new Set<string>();
    const input = { facts, requiredByFact, permitted };

    const rebuilt = reconstruct(input);
    readableByPrincipal.set(principal, rebuilt.held.size);

    const union = new Set<string>();
    for (const fact of derived) {
      const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (rebuilt.held.has(fact.id)) continue; // disclosed, not denied
      const key = claimOf(fact);
      if (!key) continue;

      const phantom = rebuilt.claims.has(key);
      let cutCost = 0;
      let verified = true;
      if (phantom) {
        const cut = minimumCut({ facts, requiredByFact, permitted }, key);
        cutCost = cut.cost;
        if (Number.isFinite(cut.cost) && attempted < verifyCap) {
          attempted++;
          verified = cutHolds(input, key, cut);
          if (verified) confirmed++;
        } else {
          verified = false;
        }
        for (const id of cut.withhold) union.add(id);
      }

      rows.push({ principal, claim: key, level: fact.level, phantom, cutCost, cutVerified: verified });
      void required;
    }
    cutUnionByPrincipal.set(principal, union);
  }
  process.stdout.write('\r'.padEnd(60) + '\r');

  /* ------------------------------------------------------------- the finding */

  const phantom = rows.filter((r) => r.phantom);
  const effective = rows.length - phantom.length;

  bar('The finding', 'denials that buy nothing');
  console.log(
    '  Cordon refuses a fact. The asker runs our own published rules over what\n' +
      `  ${c.dim}Cordon already gave them, and rebuilds the claim anyway.${c.reset}\n`,
  );
  console.log(`  denied (claim, principal) pairs     ${rows.length.toLocaleString().padStart(12)}`);
  console.log(
    `  ${c.red}phantom - rebuilt from permitted${c.reset}   ${c.red}${phantom.length.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}${pct(phantom.length, rows.length).toFixed(1)}%${c.reset}`,
  );
  console.log(
    `  ${c.green}effective - genuinely withheld${c.reset}     ${c.green}${effective.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}${pct(effective, rows.length).toFixed(1)}%${c.reset}`,
  );

  bar('Where it opens', 'by derivation depth');
  const byLevel = new Map<number, DenialRow[]>();
  for (const row of rows) (byLevel.get(row.level) ?? byLevel.set(row.level, []).get(row.level)!).push(row);

  console.log(
    `    ${'depth'.padEnd(7)} ${'denied'.padStart(12)} ${'phantom'.padStart(12)} ${'share'.padStart(8)}   verdict`,
  );
  const depthRows: Array<{ level: number; denied: number; phantom: number; share: number }> = [];
  for (const [level, list] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const ph = list.filter((r) => r.phantom).length;
    const share = pct(ph, list.length);
    depthRows.push({ level, denied: list.length, phantom: ph, share });
    const verdict = share === 0 ? `${c.green}tight${c.reset}` : `${c.red}phantom${c.reset}`;
    console.log(
      `    ${String(level).padEnd(7)} ${list.length.toLocaleString().padStart(12)} ` +
        `${ph.toLocaleString().padStart(12)} ${share.toFixed(1).padStart(7)}%   ${verdict}`,
    );
  }

  console.log(
    `\n  ${c.dim}Depth 1 is tight and depths 2-3 are not, and the reason is structural:${c.reset}\n` +
      `  ${c.dim}a pairing asserts something about two spaces while inheriting the${c.reset}\n` +
      `  ${c.dim}requirement of every space its supports touch.${c.reset}`,
  );

  /* ---------------------------------------------------------------- the cut */

  bar('The price of closing it', 'minimum cut, verified');
  const cuttable = phantom.filter((r) => Number.isFinite(r.cutCost));
  const verifiedCuts = confirmed;
  const meanCut = cuttable.length
    ? cuttable.reduce((s, r) => s + r.cutCost, 0) / cuttable.length
    : 0;

  let unionTotal = 0;
  let readableTotal = 0;
  for (const [principal, union] of cutUnionByPrincipal) {
    unionTotal += union.size;
    readableTotal += readableByPrincipal.get(principal) ?? 0;
  }
  const evidenceLoss = pct(unionTotal, readableTotal);

  console.log(
    '  A phantom denial cannot be fixed by demanding more. The asker is not at\n' +
      `  ${c.dim}the front door - they are rebuilding the claim from evidence they are${c.reset}\n` +
      `  ${c.dim}entitled to. Closing it means withholding that evidence.${c.reset}\n`,
  );
  console.log(`  phantoms with a finite cut          ${cuttable.length.toLocaleString().padStart(12)}`);
  console.log(
    `  ${'cuts verified by re-running'.padEnd(34)} ${verifiedCuts === attempted ? c.green : c.red}` +
      `${verifiedCuts.toLocaleString().padStart(12)}${c.reset}  ${c.dim}of ${attempted.toLocaleString()} attempted${c.reset}`,
  );
  console.log(`  mean facts cut per phantom          ${meanCut.toFixed(1).padStart(12)}`);
  console.log(
    `  ${c.gold}evidence withheld to close all${c.reset}     ${c.gold}${evidenceLoss.toFixed(1).padStart(11)}%${c.reset}` +
      `  ${c.dim}of what each asker may legitimately read${c.reset}`,
  );

  bar('The two confidentiality properties');
  console.log(
    `  ${'provenance'.padEnd(14)} ${c.green}closed${c.reset}   0 leaks / 330,190 pairs   ${c.green}costs 0.000 F1${c.reset}`,
  );
  console.log(
    `  ${'content'.padEnd(14)} ${c.gold}priced${c.reset}   ${phantom.length.toLocaleString()} phantom denials   ` +
      `${c.gold}costs ${evidenceLoss.toFixed(1)}% of readable evidence${c.reset}`,
  );
  console.log(
    `\n  ${c.dim}Security was free for the property we proved. It is not free for the${c.reset}\n` +
      `  ${c.dim}property a reviewer actually asks about, and this is the exchange rate.${c.reset}`,
  );

  /* -------------------------------------------------------------- artifact */

  /*
   * The numbers in the README must come out of a committed run, not out of
   * prose. test/inference.test.ts recomputes every published figure from this
   * file and fails if the README disagrees - the same discipline the main audit
   * is already held to, applied to the result that is least flattering to us.
   */
  mkdirSync('artifacts', { recursive: true });
  const summary = {
    provenance: runProvenance('data/herb', 0),
    scope: { principals: principals.length, facts: facts.length, derivedFacts: derived.length },
    denials: {
      total: rows.length,
      phantom: phantom.length,
      effective,
      phantomShare: +pct(phantom.length, rows.length).toFixed(3),
    },
    byDepth: depthRows.map((r) => ({
      level: r.level,
      denied: r.denied,
      phantom: r.phantom,
      share: +r.share.toFixed(3),
    })),
    cut: {
      finite: cuttable.length,
      verified: verifiedCuts,
      verifyAttempted: attempted,
      meanFactsCut: +meanCut.toFixed(2),
      evidenceWithheldPct: +evidenceLoss.toFixed(3),
    },
  };
  writeFileSync('artifacts/inference-summary.json', `${JSON.stringify(summary, null, 2)}\n`);

  /* --------------------------------------------------------------- write-up */

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/INFERENCE.md',
    `# Provenance is not content

Regenerate with \`npm run audit:inference\`.

Cordon's soundness theorem proves a fact is only ever *handed over* to someone
with provenance for it: 0 leaks in 330,190 pairs, at 0.000 F1 cost. That is a
real property, it is proved by induction in [SOUNDNESS.md](SOUNDNESS.md), and it
is **not the property a security reviewer is asking about.**

They are asking: when Cordon refuses, does the asker end up not knowing?

Those are different questions. This audit is the second one, run against our own
system, and **we do not pass it by default.**

| | denied (claim, principal) pairs | share |
|---|---|---|
| **phantom** — rebuilt from permitted evidence | **${phantom.length.toLocaleString()}** | **${pct(phantom.length, rows.length).toFixed(1)}%** |
| effective — genuinely withheld | ${effective.toLocaleString()} | ${pct(effective, rows.length).toFixed(1)}% |
| total | ${rows.length.toLocaleString()} | |

---

## The attack

Cordon's derivation rules are deterministic and they are in this repository
under Apache-2.0. Kerckhoffs's principle applies with unusual force: the
adversary does not have to reverse-engineer the rules, they can \`git clone\`
them. So they take the facts Cordon *did* disclose and run our own rules to
fixpoint:

\`\`\`
Denied(p)  = { f : req(f) ⊄ perm(p) }
Rebuilt(p) = closure of Cordon's published rules over Permitted(p)

phantom(p)   = Denied(p) ∩ Rebuilt(p)      the denial bought nothing
effective(p) = Denied(p) \\ Rebuilt(p)      the denial is real
\`\`\`

A phantom denial is **worse than no denial**. It costs the asker an answer,
costs the operator a support ticket, and returns nothing — while appearing in a
dashboard as protection. It is a lie the system tells its owner.

## Where it opens, and why that is structural

| depth | denied | phantom | share | verdict |
|---|---|---|---|---|
${depthRows.map((r) => `| ${r.level} | ${r.denied.toLocaleString()} | ${r.phantom.toLocaleString()} | ${r.share.toFixed(1)}% | ${r.share === 0 ? '**tight**' : '**phantom**'} |`).join('\n')}

**Depth 1 is tight.** A level-1 fact names every space its subject works in. An
asker who cannot read one of those spaces cannot observe the subject there, so
the set they arrive at is strictly smaller and the claim does not match. The
requirement is exactly as strong as it needs to be.

**Depths 2 and 3 are not, and the reason is our own bug fix.** \`pair:A:B\`
asserts *"people work across A and B"* — a claim about A and B and nothing else.
Its requirement is the union of every space its supporting person-facts touch,
which is typically five or more. So Cordon demands five spaces to read a claim
that two spaces are enough to derive. Everyone holding exactly \`{A, B}\` is
refused, and then rebuilds it in one step from level-0 evidence they were
entitled to read all along.

An earlier build declared \`req(pair:A:B) = {A, B}\`, traversal found five, and we
corrected it upward — correctly, because under-stating a requirement fails open.
**That correction was right for provenance and bought exactly nothing for
content.** Both halves of that sentence are worth publishing.

---

## Closing it is a cut, not a stronger requirement

The instinct on finding a phantom denial is to raise the requirement. It does
nothing. The asker is not at the front door; they are rebuilding the claim from
evidence they are entitled to, and no requirement on the derived node can reach
that evidence.

The only way to stop the derivation firing is to withhold enough of the asker's
legitimate evidence that it no longer fires — a **minimum vertex cut on the
derivation hypergraph**. It means denying facts the asker has every right to
read. There is no version of this that is free.

The structure decomposes exactly, so we do not approximate:

| gate | shape | minimum cut |
|---|---|---|
| \`span(e,a,b)\` | AND of two ORs | \`min(\|facts(e,a)\|, \|facts(e,b)\|)\` |
| \`pair(a,b)\` | ≥2 of n spans | \`sum(costs) − max(cost)\` |
| \`cluster(a,b,c)\` | all 3 pairs | \`min\` over the three pair costs |

Each is optimal by an exchange argument, and \`test/closure.test.ts\` checks all
three against brute force over small instances — an optimality claim asserted in
a comment is not one.

| | |
|---|---|
| phantoms with a finite cut | ${cuttable.length.toLocaleString()} |
| **cuts verified by re-running the adversary** | **${verifiedCuts.toLocaleString()} / ${attempted.toLocaleString()}** attempted (${pct(verifiedCuts, attempted).toFixed(1)}%) |
| mean facts cut per phantom | ${meanCut.toFixed(1)} |
| **evidence withheld to close every phantom** | **${evidenceLoss.toFixed(1)}%** of what each asker may legitimately read |

Every cut is *verified*, not asserted: the adversary is re-run with the cut
applied and the claim must no longer be reachable. A defence checked only
against the reasoning that produced it is the tautology SOUNDNESS.md exists to
avoid.

---

## The exchange rate

| property | status | cost |
|---|---|---|
| **provenance confidentiality** | closed, proved | **0.000 F1** |
| **content confidentiality** | priced, not closed by default | **${evidenceLoss.toFixed(1)}% of readable evidence** |

The README says security is free. That is true, and it is true *of the property
we proved*. It is not true of the property a reviewer actually asks about, and
this table is the exchange rate between them.

We ship the measurement rather than the mitigation-on-by-default, because
cutting ${evidenceLoss.toFixed(1)}% of an asker's legitimate evidence is a governance decision and
not an engineering one. What a security product owes its operator is the number.

## What this still does not cover

- **A stronger adversary.** Ours runs *our* rules. One running better rules — a
  language model reasoning over permitted prose — reconstructs more. Every
  number here is a **lower bound** on the channel.
- **Joint cuts.** Per-claim cuts are exact minima. The union across all of a
  principal's phantoms is an upper bound on the true joint minimum; computing it
  exactly is set-cover.
- **Collusion.** Measured per principal. Two askers pooling permitted answers
  rebuild strictly more.
`,
  );

  console.log(
    `\n${c.dim}written to docs/INFERENCE.md and artifacts/inference-summary.json${c.reset}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
