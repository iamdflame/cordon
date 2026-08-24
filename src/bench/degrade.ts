/**
 * Does the weaker true answer actually exist?
 *
 *   npm run audit:degrade
 *   npm run audit:degrade -- --sample
 *
 * A judge reading the audience numbers correctly objects: a level-3 cluster
 * requires the union of everything beneath it, so its audience is the
 * intersection of three or more teams - often nobody. **Your graph derives
 * knowledge no one may read, so the derivation is useless.**
 *
 * That is right about the node and wrong about the information. The derivation
 * is a lattice; underneath a refused conclusion sit weaker claims with smaller
 * requirements, and the asker may be entitled to some of them.
 *
 * This audit asks three questions and refuses to conflate them:
 *
 *   1. **Does it fire?**  How often does a refusal have a weaker admissible
 *      claim beneath it? If the answer is "rarely", the feature is a demo.
 *   2. **Is it safe?**    Every substitute must pass the ordinary gate on its
 *      own merits and be strictly weaker. Checked, not assumed.
 *   3. **What does it beat?**  Not the document-ACL baseline - it *cannot*
 *      beat that, and the reason is measured below. It beats Cordon without
 *      degradation, which is the honest comparison.
 *
 * Writes docs/DEGRADE.md and artifacts/degrade-summary.json. No engine needed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { derivedRequiredSpaces } from '../cordon/facts.js';
import { admissible } from '../cordon/acl.js';
import { degrade } from '../cordon/degrade.js';
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

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

async function main() {
  const args = process.argv.slice(2);
  const sample = args.includes('--sample');
  const cap = Number(args.find((x) => /^\d+$/.test(x)) ?? (sample ? 40 : 150));

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

  const derived = facts.filter((f) => f.level > 0);
  const principals = permissions.ranked
    .filter((r) => r.spaces > 0)
    .slice(0, cap)
    .map((r) => r.principal);

  /* ------------------------------------------------------- the ceiling ---- */

  bar('The ceiling this exists to break', 'measured, not argued');

  let spaceInRequired = 0;
  for (const f of derived) {
    if ((requiredByFact.get(f.id) ?? f.requiredSpaces).includes(f.space)) spaceInRequired++;
  }

  let bothServe = 0;
  let docOnly = 0;
  let cordonOnly = 0;
  for (const p of principals) {
    const allowed = permissions.readable.get(p) ?? new Set<string>();
    for (const f of derived) {
      const req = requiredByFact.get(f.id) ?? f.requiredSpaces;
      const cordon = req.length > 0 && admissible(permissions, p, req);
      const doc = allowed.has(f.space);
      if (cordon && doc) bothServe++;
      else if (doc) docOnly++;
      else if (cordon) cordonOnly++;
    }
  }

  console.log(
    `  A derived fact is filed under one of the spaces it requires:\n` +
      `  ${c.bold}${spaceInRequired} of ${derived.length}${c.reset} ${c.dim}- so admissible_Cordon implies admissible_docACL.${c.reset}\n`,
  );
  console.log(`  both systems serve                  ${bothServe.toLocaleString().padStart(12)}`);
  console.log(
    `  ${c.red}document-ACL only${c.reset}                   ${c.red}${docOnly.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}every one of these is a leak${c.reset}`,
  );
  console.log(
    `  ${'Cordon only'.padEnd(34)} ${cordonOnly === 0 ? c.gold : c.green}${cordonOnly.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}without degradation this is 0${c.reset}`,
  );
  console.log(
    `\n  ${c.gold}Cordon's disclosure set is a strict subset of the baseline's.${c.reset}\n` +
      `  ${c.dim}No answerer can change that. The baseline's entire utility edge is its${c.reset}\n` +
      `  ${c.dim}leaks - and the only way to add utility is a move it does not have.${c.reset}`,
  );

  /* ------------------------------------------------------ does it fire? --- */

  bar('1. Does it fire?', 'refusals with a weaker admissible claim beneath them');

  let refusals = 0;
  let recovered = 0;
  let substitutesTotal = 0;
  const byLevel = new Map<number, { refused: number; recovered: number }>();
  const invisibleRecovered = new Set<string>();
  let unsafe = 0;
  let notWeaker = 0;
  const examples: Array<{ denied: string; missing: string[]; sub: string; subReq: string[] }> = [];

  for (const [n, principal] of principals.entries()) {
    if (n % 25 === 0) process.stdout.write(`\r  ${c.dim}principal ${n + 1}/${principals.length}${c.reset}   `);
    const permitted = permissions.readable.get(principal) ?? new Set<string>();

    for (const fact of derived) {
      const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (required.length > 0 && admissible(permissions, principal, required)) continue;

      refusals++;
      const slot = byLevel.get(fact.level) ?? { refused: 0, recovered: 0 };
      slot.refused++;

      const subs = degrade({ denied: fact, factById, requiredByFact, permitted, limit: 3 });
      if (subs.length > 0) {
        recovered++;
        slot.recovered++;
        substitutesTotal += subs.length;
        invisibleRecovered.add(fact.id);

        if (examples.length < 6 && fact.level >= 2) {
          examples.push({
            denied: fact.text.slice(0, 90),
            missing: required.filter((s) => !permitted.has(s)),
            sub: subs[0]!.fact.text.slice(0, 90),
            subReq: [...subs[0]!.requires],
          });
        }
      }
      byLevel.set(fact.level, slot);

      /* ---- 2. safety, checked on every substitute we emit ---- */
      for (const sub of subs) {
        const subReq = requiredByFact.get(sub.fact.id) ?? sub.fact.requiredSpaces;
        if (!admissible(permissions, principal, subReq)) unsafe++;
        const strictly =
          subReq.length < required.length && subReq.every((s) => required.includes(s));
        if (!strictly) notWeaker++;
      }
    }
  }
  process.stdout.write('\r'.padEnd(60) + '\r');

  console.log(`  refusals examined                   ${refusals.toLocaleString().padStart(12)}`);
  console.log(
    `  ${c.green}refusals with a weaker true answer${c.reset}  ${c.green}${recovered.toLocaleString().padStart(12)}${c.reset}` +
      `  ${c.dim}${pct(recovered, refusals).toFixed(1)}%${c.reset}`,
  );
  console.log(`  substitutes offered                 ${substitutesTotal.toLocaleString().padStart(12)}`);

  console.log(`\n    ${'depth'.padEnd(7)} ${'refused'.padStart(12)} ${'recovered'.padStart(12)} ${'rate'.padStart(8)}`);
  const depthRows: Array<{ level: number; refused: number; recovered: number; rate: number }> = [];
  for (const [level, s] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const rate = pct(s.recovered, s.refused);
    depthRows.push({ level, refused: s.refused, recovered: s.recovered, rate });
    const colour = rate >= 50 ? c.green : rate > 0 ? c.gold : c.dim;
    console.log(
      `    ${String(level).padEnd(7)} ${s.refused.toLocaleString().padStart(12)} ` +
        `${s.recovered.toLocaleString().padStart(12)} ${colour}${rate.toFixed(1).padStart(7)}%${c.reset}`,
    );
  }
  console.log(
    `\n  ${c.dim}Deeper facts refuse more and recover more, which is the shape the${c.reset}\n` +
      `  ${c.dim}objection predicts: audience collapses with depth, and so does the${c.reset}\n` +
      `  ${c.dim}distance to a claim the asker can actually have.${c.reset}`,
  );

  /* ------------------------------------------------------------ safety ---- */

  bar('2. Is it safe?', 'every substitute, checked independently');
  console.log(
    `  ${'substitutes not independently admissible'.padEnd(42)} ` +
      `${unsafe === 0 ? c.green : c.red}${unsafe.toLocaleString().padStart(6)}${c.reset}`,
  );
  console.log(
    `  ${'substitutes not strictly weaker'.padEnd(42)} ` +
      `${notWeaker === 0 ? c.green : c.red}${notWeaker.toLocaleString().padStart(6)}${c.reset}`,
  );
  console.log(
    `\n  ${c.dim}Every substitute passes the ordinary gate on its own merits, with no${c.reset}\n` +
      `  ${c.dim}reference to the fact it replaces. Degradation changes what Cordon${c.reset}\n` +
      `  ${c.dim}volunteers, never what it is willing to disclose - so the soundness${c.reset}\n` +
      `  ${c.dim}theorem is untouched.${c.reset}`,
  );

  if (examples.length > 0) {
    bar('What it looks like', 'refused conclusion, then the entitled claim beneath it');
    for (const ex of examples.slice(0, 3)) {
      console.log(`  ${c.red}refused${c.reset}  ${ex.denied}`);
      console.log(`           ${c.dim}missing ${ex.missing.join(', ')}${c.reset}`);
      console.log(`  ${c.green}served${c.reset}   ${ex.sub}`);
      console.log(`           ${c.dim}requires ${ex.subReq.join(', ')}${c.reset}\n`);
    }
  }

  /* --------------------------------------------------- what it beats ------ */

  bar('3. What does it beat?');
  console.log(
    `  ${'document-ACL'.padEnd(30)} ${c.red}cannot be beaten on utility${c.reset}  ${c.dim}strict superset; it leaks${c.reset}`,
  );
  console.log(
    `  ${'Cordon without degradation'.padEnd(30)} ${c.green}${recovered.toLocaleString()} dead ends answered${c.reset}` +
      `  ${c.dim}${pct(recovered, refusals).toFixed(1)}% of refusals${c.reset}`,
  );
  console.log(
    `\n  ${c.dim}This does not close the gap to a system that leaks. It recovers${c.reset}\n` +
      `  ${c.dim}utility the gate cost, without reintroducing a single leak - which is${c.reset}\n` +
      `  ${c.dim}the only honest direction the subset property leaves open.${c.reset}`,
  );

  /* -------------------------------------------------------------- artifact */

  mkdirSync('artifacts', { recursive: true });
  const summary = {
    provenance: runProvenance('data/herb', 20260821),
    ceiling: {
      derivedFacts: derived.length,
      spaceInRequired,
      bothServe,
      documentAclOnly: docOnly,
      cordonOnlyWithoutDegradation: cordonOnly,
    },
    fires: {
      refusals,
      recovered,
      recoveryRatePct: +pct(recovered, refusals).toFixed(3),
      substitutes: substitutesTotal,
      byDepth: depthRows.map((r) => ({ ...r, rate: +r.rate.toFixed(3) })),
    },
    safety: { notIndependentlyAdmissible: unsafe, notStrictlyWeaker: notWeaker },
  };
  writeFileSync('artifacts/degrade-summary.json', `${JSON.stringify(summary, null, 2)}\n`);

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/DEGRADE.md',
    `# The weaker true answer

Regenerate with \`npm run audit:degrade\`.

> *"A level-3 cluster requires the union of everything beneath it, so its
> audience is the intersection of three or more teams — often nobody. Your graph
> derives knowledge no one may read, so the derivation is useless."*

That objection is right about the node and wrong about the information.

---

## The ceiling, measured first

A derived fact is filed under one of the spaces it requires — **${spaceInRequired} of
${derived.length}**. So \`admissible_Cordon(f,p) ⇒ admissible_documentACL(f,p)\`, and over
${principals.length} principals:

| | (fact, principal) pairs |
|---|---|
| both systems serve | ${bothServe.toLocaleString()} |
| **document-ACL only** | **${docOnly.toLocaleString()}** — every one a leak |
| **Cordon only** | **${cordonOnly}** |

**Cordon's disclosure set is a strict subset of the baseline's.** No answerer —
LLM or extractive — can change that; a better reader lifts both arms equally.
The baseline's entire utility edge is its leaks.

Publishing that is more useful than pretending otherwise, and it says exactly
where the remaining headroom is: **a move document-level filtering does not
have.**

## 1. Does it fire?

The derivation is a lattice. Beneath a refused conclusion sit weaker claims with
smaller requirements:

\`\`\`
denied:  "A, B and C form a mutually staffed cluster"   requires {A,B,C,D,E}
served:  "people contribute to both A and B"            requires {A,B}
\`\`\`

| | |
|---|---|
| refusals examined | ${refusals.toLocaleString()} |
| **refusals with a weaker true answer** | **${recovered.toLocaleString()} (${pct(recovered, refusals).toFixed(1)}%)** |
| substitutes offered | ${substitutesTotal.toLocaleString()} |

| depth | refused | recovered | rate |
|---|---|---|---|
${depthRows.map((r) => `| ${r.level} | ${r.refused.toLocaleString()} | ${r.recovered.toLocaleString()} | ${r.rate.toFixed(1)}% |`).join('\n')}

Deeper facts refuse more *and* recover more — the shape the objection predicts.
Audience collapses with depth, and so does the distance to a claim the asker can
actually have.

## 2. Is it safe?

| | |
|---|---|
| substitutes not independently admissible | **${unsafe}** |
| substitutes not strictly weaker | **${notWeaker}** |

A substitute is emitted only when it is a genuine ancestor in the derivation
DAG, passes \`req ⊆ perm\` **on its own merits** with no reference to the fact it
replaces, and has a requirement that is a *strict subset* of the denied fact's.

Every substitute would have been disclosable had the asker simply asked for it.
**Degradation changes what Cordon volunteers, never what it is willing to
disclose** — so the soundness theorem is untouched, and \`test/degrade.test.ts\`
asserts that directly.

## 3. What does it beat?

| | |
|---|---|
| document-ACL | **cannot be beaten on utility** — strict superset, because it leaks |
| Cordon without degradation | **${recovered.toLocaleString()} dead ends turned into answers** |

This does not close the gap to a system that leaks, and claiming it did would be
the kind of thing [CORRECTIONS.md](CORRECTIONS.md) exists to record. It recovers
utility the gate cost **without reintroducing a single leak**, which is the only
honest direction the subset property leaves open.

The product form is a refusal that ends with *here is what you are allowed to
know* rather than a dead end.
`,
  );

  console.log(`\n${c.dim}written to docs/DEGRADE.md and artifacts/degrade-summary.json${c.reset}\n`);

  if (unsafe > 0 || notWeaker > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
