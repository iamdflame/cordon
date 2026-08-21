/**
 * What a grant actually costs.
 *
 *   npm run audit:policy
 *   npm run audit:policy -- --sample
 *
 * An administrator adds one person to one team. Every access-review tool in
 * existence will tell them what that grants: the documents in that space. That
 * answer is correct and it is not the whole answer.
 *
 * It also grants **every derived fact whose entire requirement is now covered**
 * - facts resting on spaces the administrator was not thinking about, because
 * the person already had them. Nobody granted those. Nobody was asked. They are
 * not documents, so they appear in no document-level review.
 *
 *     before:  Alice may read {A, B}      F requires {A, B, C}   denied
 *     grant C: Alice may read {A, B, C}   F requires {A, B, C}   DISCLOSED
 *
 * This audit measures how big that gap is across the real organisation, one
 * grant at a time. It is the feature the whole thesis earns: you can only
 * compute the blast radius of a grant if you have modelled derivation - and if
 * you have modelled derivation, you are obliged to.
 *
 * Writes docs/POLICY.md and artifacts/policy-summary.json. No engine needed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { derivedRequiredSpaces } from '../cordon/facts.js';
import { compile, grant, policyFromModel, preview } from '../cordon/policy.js';
import { runProvenance } from './provenance.js';
import { ids } from '../cordon/model.js';

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

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

interface GrantRow {
  principal: string;
  space: string;
  documents: number;
  derived: number;
  combination: number;
  inferable: number;
}

async function main() {
  const args = process.argv.slice(2);
  const sample = args.includes('--sample');
  const trials = Number(args.find((x) => /^--grants=\d+$/.test(x))?.split('=')[1] ?? (sample ? 40 : 150));
  const inferenceTrials = sample ? 10 : 30;

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

  /*
   * Round-trip the enforced model through the policy language.
   *
   * If the compiled policy did not reproduce the model exactly, every number
   * below would be measuring the policy layer's bugs rather than the grant. So
   * that equivalence is checked, not assumed.
   */
  const base = policyFromModel(permissions, 'imported');
  const recompiled = compile(base, corpus);

  let drift = 0;
  for (const [principal, spaces] of permissions.readable) {
    const round = recompiled.readable.get(principal) ?? new Set<string>();
    if (round.size !== spaces.size) drift++;
    else for (const space of spaces) if (!round.has(space)) { drift++; break; }
  }

  bar('Policy round-trip', 'the compiled policy must reproduce the enforced model');
  console.log(`  principals                          ${permissions.readable.size.toLocaleString().padStart(12)}`);
  console.log(`  grants in the imported policy       ${base.grants.length.toLocaleString().padStart(12)}`);
  console.log(
    `  ${'principals whose access drifted'.padEnd(34)} ${drift === 0 ? c.green : c.red}` +
      `${drift.toLocaleString().padStart(12)}${c.reset}`,
  );
  if (drift > 0) {
    console.log(
      `\n  ${c.red}The policy layer does not reproduce the enforced model.${c.reset} ${c.dim}Every\n` +
        `  number below would measure that bug rather than the grant, so they are\n` +
        `  not reported.${c.reset}\n`,
    );
    process.exit(1);
  }

  /* ------------------------------------------------------------ the grants */

  const spaces = [...corpus.spaces.keys()];
  const random = makeRandom(20260820);
  const candidates = permissions.ranked.filter((r) => r.spaces >= 1 && r.spaces < spaces.length);

  const rows: GrantRow[] = [];
  let attempts = 0;

  while (rows.length < trials && attempts < trials * 12) {
    attempts++;
    const pick = candidates[Math.floor(random() * candidates.length)];
    if (!pick) break;
    const held = permissions.readable.get(pick.principal) ?? new Set<string>();
    const missing = spaces.filter((s) => !held.has(s));
    if (missing.length === 0) continue;
    const space = missing[Math.floor(random() * missing.length)]!;

    const after = compile(grant(base, pick.principal, space), corpus);
    const withInference = rows.length < inferenceTrials;
    const impact = preview({
      before: permissions,
      after,
      facts,
      requiredByFact,
      detail: 1,
      includeInference: withInference,
    });

    rows.push({
      principal: pick.principal,
      space,
      documents: impact.documentsGained,
      derived: impact.derivedGained,
      combination: impact.unlockedByCombination,
      inferable: withInference ? impact.newlyInferable : -1,
    });

    if (rows.length % 20 === 0) {
      process.stdout.write(`\r  ${c.dim}grant ${rows.length}/${trials}${c.reset}   `);
    }
  }
  process.stdout.write('\r'.padEnd(50) + '\r');

  /* ------------------------------------------------------------ the result */

  const withDerived = rows.filter((r) => r.derived > 0);
  const withCombo = rows.filter((r) => r.combination > 0);
  const totalDocs = rows.reduce((s, r) => s + r.documents, 0);
  const totalDerived = rows.reduce((s, r) => s + r.derived, 0);
  const totalCombo = rows.reduce((s, r) => s + r.combination, 0);
  const ratios = rows.filter((r) => r.documents > 0).map((r) => r.derived / r.documents);

  bar('One grant, one person', 'what an access review does not show you');
  console.log(
    '  Adding one person to one team. The documents are what the administrator\n' +
      `  ${c.dim}expects. The derived facts are what nobody was asked about.${c.reset}\n`,
  );
  console.log(`  grants simulated                    ${rows.length.toLocaleString().padStart(12)}`);
  console.log(`  documents disclosed                 ${totalDocs.toLocaleString().padStart(12)}  ${c.dim}expected${c.reset}`);
  console.log(
    `  ${c.gold}derived facts disclosed${c.reset}             ${c.gold}${totalDerived.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}invisible to a document-level review${c.reset}`,
  );
  console.log(
    `  ${c.red}...unlocked only in combination${c.reset}     ${c.red}${totalCombo.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}needed a space they already had${c.reset}`,
  );
  console.log('');
  console.log(
    `  grants that disclosed derived facts ${withDerived.length.toLocaleString().padStart(12)}` +
      `  ${c.dim}${((withDerived.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%${c.reset}`,
  );
  console.log(
    `  grants with a combination unlock    ${withCombo.length.toLocaleString().padStart(12)}` +
      `  ${c.dim}${((withCombo.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%${c.reset}`,
  );
  console.log(
    `  mean derived per unlocking grant    ${(totalDerived / Math.max(withDerived.length, 1)).toFixed(1).padStart(12)}`,
  );

  /*
   * The number this whole audit exists to produce.
   *
   * If every derived fact a grant discloses required a space the principal
   * *already held*, then none of them were granted - they were completed. An
   * administrator approving "read access to one space" approved all of them
   * without being shown one.
   */
  const comboShare = totalDerived > 0 ? (totalCombo / totalDerived) * 100 : 0;
  console.log(
    `\n  ${c.bold}${comboShare.toFixed(1)}% of derived facts disclosed by a grant were unlocked${c.reset}\n` +
      `  ${c.bold}in combination with access the principal already held.${c.reset}\n` +
      `  ${c.dim}They were not granted. They were completed - and nobody was shown one.${c.reset}`,
  );

  /*
   * One row per space. Several principals can be granted the same space in a
   * sweep, and printing the same row five times looks like five findings.
   */
  const bySpace = new Map<string, GrantRow>();
  for (const row of rows) {
    const held = bySpace.get(row.space);
    if (!held || row.derived > held.derived) bySpace.set(row.space, row);
  }
  const worst = [...bySpace.values()].sort((a, b) => b.derived - a.derived).slice(0, 5);
  console.log(`\n  ${c.dim}widest blast radius${c.reset}`);
  console.log(`    ${'space granted'.padEnd(22)} ${'documents'.padStart(10)} ${'derived'.padStart(9)} ${'combination'.padStart(12)}`);
  for (const row of worst) {
    console.log(
      `    ${row.space.slice(0, 22).padEnd(22)} ${row.documents.toLocaleString().padStart(10)} ` +
        `${c.gold}${row.derived.toLocaleString().padStart(9)}${c.reset} ${c.red}${row.combination.toLocaleString().padStart(12)}${c.reset}`,
    );
  }

  /* --------------------------------------------------------- second order */

  const measured = rows.filter((r) => r.inferable >= 0);
  const totalInferable = measured.reduce((s, r) => s + r.inferable, 0);

  bar('The second-order effect', 'what the grant makes rebuildable');
  console.log(
    '  A grant also adds evidence, and evidence feeds the derivation rules. So a\n' +
      `  ${c.dim}grant can put a still-refused claim within rebuilding distance without${c.reset}\n` +
      `  ${c.dim}ever disclosing it.${c.reset}\n`,
  );
  console.log(`  grants analysed for inference       ${measured.length.toLocaleString().padStart(12)}`);
  console.log(
    `  ${'refused claims made rebuildable'.padEnd(34)} ` +
      `${totalInferable > 0 ? c.red : c.green}${totalInferable.toLocaleString().padStart(12)}${c.reset}`,
  );
  console.log(
    `\n  ${c.dim}An impact analysis that counts only what became readable is measuring${c.reset}\n` +
      `  ${c.dim}the smaller half of the change.${c.reset}`,
  );

  /* -------------------------------------------------------------- artifact */

  mkdirSync('artifacts', { recursive: true });
  const summary = {
    provenance: runProvenance('data/herb', 20260820),
    roundTrip: { principals: permissions.readable.size, grants: base.grants.length, drift },
    grants: {
      simulated: rows.length,
      documentsDisclosed: totalDocs,
      derivedDisclosed: totalDerived,
      unlockedByCombination: totalCombo,
      withDerived: withDerived.length,
      withCombination: withCombo.length,
      medianDerivedPerDocument: +median(ratios).toFixed(4),
      meanDerivedPerUnlockingGrant: +(totalDerived / Math.max(withDerived.length, 1)).toFixed(2),
      combinationSharePct: +(totalDerived > 0 ? (totalCombo / totalDerived) * 100 : 0).toFixed(2),
    },
    secondOrder: { analysed: measured.length, claimsMadeRebuildable: totalInferable },
    widest: worst.map((r) => ({
      space: r.space,
      documents: r.documents,
      derived: r.derived,
      combination: r.combination,
    })),
  };
  writeFileSync('artifacts/policy-summary.json', `${JSON.stringify(summary, null, 2)}\n`);

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/POLICY.md',
    `# What a grant actually costs

Regenerate with \`npm run audit:policy\`.

An administrator adds one person to one team. Every access-review tool in
existence tells them what that grants: **the documents in that space.** That
answer is correct, and it is not the whole answer.

It also grants every derived fact whose *entire requirement* is now covered —
facts resting on spaces the administrator was not thinking about, because the
person already had them.

\`\`\`
before:   Alice may read {A, B}       F requires {A, B, C}   denied
grant C:  Alice may read {A, B, C}    F requires {A, B, C}   DISCLOSED
\`\`\`

Nobody granted Alice access to *F*. Nobody was asked about *F*. **F is not a
document, so it appears in no document-level access review.**

## Measured, over ${rows.length.toLocaleString()} single grants

| | | |
|---|---|---|
| documents disclosed | ${totalDocs.toLocaleString()} | what the administrator expects |
| **derived facts disclosed** | **${totalDerived.toLocaleString()}** | invisible to a document-level review |
| **…unlocked only in combination** | **${totalCombo.toLocaleString()}** | required a space they already held |

| | |
|---|---|
| grants that disclosed derived facts | ${withDerived.length.toLocaleString()} of ${rows.length.toLocaleString()} (${((withDerived.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%) |
| grants with a combination unlock | ${withCombo.length.toLocaleString()} (${((withCombo.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%) |
| mean derived facts per unlocking grant | ${(totalDerived / Math.max(withDerived.length, 1)).toFixed(1)} |

> ### ${(totalDerived > 0 ? (totalCombo / totalDerived) * 100 : 0).toFixed(1)}% were unlocked *in combination*
>
> Of the ${totalDerived.toLocaleString()} derived facts these grants disclosed,
> ${totalCombo.toLocaleString()} required a space the principal **already held**.
> They were not granted. They were **completed** — and the administrator
> approving "read access to one space" approved every one of them without being
> shown a single one.

### Widest blast radius

| space granted | documents | derived | of which combination |
|---|---|---|---|
${worst.map((r) => `| \`${r.space}\` | ${r.documents.toLocaleString()} | **${r.derived.toLocaleString()}** | ${r.combination.toLocaleString()} |`).join('\n')}

---

## The second-order effect

A grant also adds *evidence*, and evidence feeds the derivation rules in
[closure.ts](../src/cordon/closure.ts). So a grant can push a **still-refused**
claim within rebuilding distance without ever disclosing it.

| | |
|---|---|
| grants analysed for inference | ${measured.length.toLocaleString()} |
| refused claims made rebuildable | **${totalInferable.toLocaleString()}** |

An impact analysis that counts only what became *readable* is measuring the
smaller half of the change.

---

## The round-trip, checked

Every number above would be measuring the policy layer's bugs rather than the
grant if the compiled policy did not reproduce the enforced model. So it is
checked rather than assumed, and the audit **exits non-zero** on any drift.

| | |
|---|---|
| principals | ${permissions.readable.size.toLocaleString()} |
| grants in the imported policy | ${base.grants.length.toLocaleString()} |
| **principals whose access drifted** | **${drift}** |

\`policyFromModel\` reads a policy back out of whatever is already true — an
org chart, a GitHub org, a spreadsheet. A policy language an operator must
hand-write from nothing does not get adopted.

## What this does not claim

- **Grants only.** Revocation is implemented and symmetric, but the sweep here
  simulates additions, which is the direction administrators actually take.
- **One grant at a time.** Real changes arrive in batches, and batched blast
  radius is superadditive — two grants can unlock a fact neither unlocks alone.
- **The second-order sample is small** (${measured.length}), because it runs the
  full rule engine twice per grant.
`,
  );

  console.log(`\n${c.dim}written to docs/POLICY.md and artifacts/policy-summary.json${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
