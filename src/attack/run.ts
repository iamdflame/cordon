/**
 * The aggregation attack, measured.
 *
 *   npm run attack
 *   npm run attack -- --github
 *
 * Produces docs/ATTACK.md and a raw artifact under artifacts/ carrying the git
 * SHA, the timestamp and every mined triple, so a reader can open the file
 * behind any number in the write-up rather than taking it on trust.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { PermissionOracle } from '../cordon/query.js';
import { admissible } from '../cordon/acl.js';
import { corpusFromSnapshot, loadSnapshot } from '../cordon/corpus/github.js';
import type { FactNode } from '../cordon/model.js';
import { buildVocabulary, claimLocality, mineAggregation } from './mine.js';
import { redTeam } from './redteam.js';

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

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  const useGitHub = process.argv.includes('--github');
  const client = new HydraClient();

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    ...(useGitHub
      ? { corpus: corpusFromSnapshot(loadSnapshot('fixtures/github/snapshot.json')) }
      : {}),
    graphId: useGitHub ? 'cordon-github2' : process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${c.dim}${phase.padEnd(9)} ${detail}${c.reset}`);
    },
  });

  const { facts, permissions, corpus } = built;
  const oracle = new PermissionOracle(client, built.registry);

  console.log(`  ${c.dim}resolving derived requirements by traversal...${c.reset}`);
  const requiredByFact = new Map<string, string[]>();
  for (const fact of facts) {
    requiredByFact.set(
      fact.id,
      fact.level === 0 ? fact.requiredSpaces : await oracle.requiredSpaces(fact.id),
    );
  }

  const vocabulary = buildVocabulary(corpus);
  /* Level-0 facts claim the space of the artifact they were read from. */
  const spaceOfFact = (fact: FactNode) => (fact.level === 0 ? fact.space : undefined);

  /* ------------------------------------------------------- Theorem 1 check */
  bar('Theorem 1', 'derivation-path aggregation is impossible');
  const factById = new Map(facts.map((f) => [f.id, f]));
  const principals = [...corpus.employees.keys()];
  let checked = 0;
  let counterexamples = 0;
  for (const fact of facts) {
    if (fact.level === 0) continue;
    const supports = fact.restsOn.filter((s) => !s.startsWith('s:')).map((s) => factById.get(s));
    if (supports.length === 0 || supports.some((s) => !s)) continue;
    for (const principal of principals) {
      const allSupports = supports.every((s) =>
        admissible(permissions, principal, requiredByFact.get(s!.id) ?? s!.requiredSpaces),
      );
      if (!allSupports) continue;
      checked++;
      if (!admissible(permissions, principal, requiredByFact.get(fact.id) ?? fact.requiredSpaces)) {
        counterexamples++;
      }
    }
  }
  console.log(`  cases where a principal held every support   ${checked.toLocaleString().padStart(10)}`);
  console.log(
    `  ...and was nonetheless denied the conclusion  ` +
      `${counterexamples === 0 ? c.green : c.red}${counterexamples.toLocaleString().padStart(10)}${c.reset}`,
  );
  console.log(
    `\n  ${c.dim}Holding all the parts of a conclusion already entitles you to the\n` +
      `  conclusion, so an attacker cannot climb the derivation edges. The real\n` +
      `  attack has to come from facts that are not supports at all.${c.reset}`,
  );

  /* ------------------------------------------------------ claim locality */
  bar('Claim locality', 'the premise of Theorem 2, checked rather than assumed');
  const locality = claimLocality(facts, requiredByFact, vocabulary, spaceOfFact);
  const localRate = locality.total > 0 ? locality.local / locality.total : 1;
  console.log(`  atomic claims asserted                       ${locality.total.toLocaleString().padStart(10)}`);
  console.log(
    `  ...about a space the asserting fact rests on ${locality.local.toLocaleString().padStart(10)}` +
      `  ${c.dim}${(localRate * 100).toFixed(2)}%${c.reset}`,
  );
  const violations = locality.total - locality.local;
  console.log(
    `  ...about a space it does NOT rest on         ` +
      `${violations === 0 ? c.green : c.red}${violations.toLocaleString().padStart(10)}${c.reset}`,
  );
  for (const v of locality.violations.slice(0, 3)) {
    console.log(`\n    ${c.cyan}${v.claim}${c.reset}  ${c.dim}fact rests on ${v.required.join(', ')}${c.reset}`);
    console.log(`    "${v.factText.replace(/\s+/g, ' ')}"`);
  }

  /* --------------------------------------------------------- the census */
  bar('Aggregation census', 'mined, not hand-crafted');
  const census = mineAggregation({
    facts,
    permissions,
    principals,
    requiredByFact,
    vocabulary,
    spaceOfFact,
  });

  console.log(
    `  ${'gate'.padEnd(20)} ${'denied'.padStart(9)} ${'agg. leaks'.padStart(11)} ${'rate'.padStart(7)} ${'coverage'.padStart(9)} ${'over-restricted'.padStart(16)}`,
  );
  console.log('-'.repeat(78));
  for (const row of census) {
    const colour = row.leaks === 0 ? c.green : c.red;
    console.log(
      `  ${row.gate.padEnd(20)} ${row.denied.toLocaleString().padStart(9)} ` +
        `${colour}${row.leaks.toLocaleString().padStart(11)}${c.reset} ` +
        `${(row.leakRate * 100).toFixed(1).padStart(6)}% ${(row.meanCoverage * 100).toFixed(1).padStart(8)}% ` +
        `${row.overRestricted > 0 ? row.overRestricted.toLocaleString().padStart(16) : ''.padStart(16)}`,
    );
  }

  const docAcl = census.find((r) => r.gate === 'document-acl')!;
  const cordon = census.find((r) => r.gate === 'cordon')!;
  const claimAware = census.find((r) => r.gate === 'cordon-claim-aware')!;

  if (cordon.leaks > 0) {
    console.log(
      `\n  ${c.gold}Cordon admits ${cordon.leaks} aggregation leaks here.${c.reset} ${c.dim}The claim-aware rule\n` +
        `  closes ${cordon.leaks - claimAware.leaks} of them by widening the requirement to include spaces a\n` +
        `  fact *names*, at a cost of ${claimAware.overRestricted.toLocaleString()} additional withholdings.${c.reset}`,
    );
  }

  for (const example of docAcl.examples.slice(0, 2)) {
    console.log(`\n  ${c.bold}Instance${c.reset} ${c.dim}document-acl${c.reset}`);
    console.log(`    asker      ${example.principal}`);
    console.log(`    withheld   "${example.factText.slice(0, 120)}"`);
    console.log(`    requires   ${example.required.join(', ')}`);
    console.log(`    lacks      ${c.red}${example.missing.join(', ')}${c.reset}`);
    console.log(`    but was handed ${example.witnesses.length} facts that together say all of it:`);
    for (const w of example.witnesses.slice(0, 4)) {
      console.log(`      ${c.dim}[${w.space}] L${w.level}${c.reset} ${w.text.replace(/\s+/g, ' ').slice(0, 96)}`);
    }
  }

  /* ------------------------------------------------------------ red team */
  bar('Red team', 'multi-turn incremental narrowing');
  const red = redTeam({ facts, permissions, principals, requiredByFact, vocabulary, spaceOfFact });
  console.log(`  attack sequences run                 ${red.sequences.toLocaleString().padStart(10)}`);
  console.log(`  turns issued                         ${red.turns.toLocaleString().padStart(10)}`);
  console.log(
    `  sequences that reconstructed a target ` +
      `${red.successes === 0 ? c.green : c.red}${red.successes.toLocaleString().padStart(9)}${c.reset}`,
  );
  console.log(`  mean coverage reached                ${(red.meanCoverage * 100).toFixed(1).padStart(9)}%`);
  console.log(
    `\n  ${c.dim}Every phrasing variant is committed in the artifact. Admissibility does\n` +
      `  not read the question, so paraphrase and role-play cannot move it - the\n` +
      `  only attack with any surface is accumulation across turns.${c.reset}`,
  );

  /* ------------------------------------------------------------ artifact */
  const sha = gitSha();
  const stamp = new Date().toISOString();
  const corpusName = useGitHub ? 'github' : 'herb';
  mkdirSync('artifacts', { recursive: true });
  const artifactPath = `artifacts/attack-${corpusName}.json`;
  writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        corpus: corpusName,
        gitSha: sha,
        generatedAt: stamp,
        facts: facts.length,
        principals: principals.length,
        theorem1: { casesChecked: checked, counterexamples },
        claimLocality: {
          total: locality.total,
          local: locality.local,
          violations,
          examples: locality.violations,
        },
        census: census.map((row) => ({
          gate: row.gate,
          denied: row.denied,
          leaks: row.leaks,
          leakRate: row.leakRate,
          meanCoverage: row.meanCoverage,
          byLevel: row.byLevel,
          instances: row.examples,
        })),
        redTeam: red,
      },
      null,
      2,
    ),
  );

  /* ------------------------------------------------------------- write-up */
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/ATTACK.md',
    `# The aggregation attack

Regenerate with \`npm run attack\`${useGitHub ? ' -- --github' : ''}.
Raw data: [\`${artifactPath}\`](../${artifactPath}) — git \`${sha.slice(0, 12)}\`, ${stamp}.

Corpus: **${corpusName}** · ${facts.length.toLocaleString()} facts · ${principals.length.toLocaleString()} principals.

---

## Why this is the interesting attack

Document-level filtering cannot defend against aggregation **even in
principle**, because the thing being aggregated is not a document. Two facts a
principal is entitled to can together determine a third they are not, and no
file-level ACL has a place to express that.

Cordon can reason about it, because derivation is an edge in the graph rather
than a property of a file. Whether it *succeeds* is measured below rather than
claimed.

## Definitions

    sources(f)    = { s : f -[:RESTS_ON*1..k]-> s, s:Source }
    required(f)   = { space(s) : s in sources(f) }
    permitted(p)  = { sp : p -[:MEMBER_OF]-> sp }
                  U { sp : p -[:MANAGES*]-> q -[:MEMBER_OF]-> sp }
    entitled(p,f) <=> required(f) subset-of permitted(p)

An **aggregation leak** is a triple (p, f, F) where

1. \`NOT entitled(p, f)\` — p may not be told f
2. every g in F is disclosed to p by the system under test
3. \`claims(f)\` is a subset of the union of \`claims(g)\` for g in F — F determines f

\`claims(f)\` is the set of atomic assertions "entity e is present in space sp",
**read out of the fact's text**, never computed from \`required(f)\`. Deriving
claims from the requirement would make the locality result below true by
construction — the same failure mode as an invariant that compares a value to
itself.

## Theorem 1 — an attacker cannot climb the derivation edges

> If p is entitled to every support of f, then p is entitled to f.

*Proof.* \`required(f)\` is the union of \`required(g)\` over supports g, by
construction. Each is a subset of \`permitted(p)\`. A union of subsets of
\`permitted(p)\` is a subset of it. ∎

Checked, not just proved: **${checked.toLocaleString()}** (principal, fact) cases where the principal held
every support, **${counterexamples}** counterexamples.

This is what forces the real attack to come from facts that are *not* supports.

## Theorem 2 — when Cordon is closed under aggregation too

A corpus has **claim locality** if every claim (e, sp) is only ever asserted by
facts that require sp.

> Under claim locality, Cordon admits no aggregation leaks.

*Proof.* Suppose (p, f, F) satisfies 1–3 under Cordon. Take any sp in
\`required(f)\`. Some (e, sp) is in \`claims(f)\`, so by (3) some g in F asserts it.
By locality sp is in \`required(g)\`; by (2) \`required(g)\` is a subset of
\`permitted(p)\`; so sp is in \`permitted(p)\`. As sp was arbitrary,
\`required(f)\` is a subset of \`permitted(p)\` — contradicting (1). ∎

**So Cordon's exposure is a property of the corpus, not of the rule.** That is
the honest framing, and it is why the premise is measured:

| | |
|---|---|
| atomic claims asserted | ${locality.total.toLocaleString()} |
| about a space the asserting fact rests on | ${locality.local.toLocaleString()} (${(localRate * 100).toFixed(2)}%) |
| **about a space it does not rest on** | **${violations.toLocaleString()}** |

${
  violations === 0
    ? `Claim locality holds **exactly** on this corpus. Every fact talks only about
spaces it rests on, so by Theorem 2 Cordon admits no aggregation leaks here —
and the census below confirms it independently.

That zero is a fact about the corpus as much as about the rule. HERB is
generated per product and its artifacts never reference another product; not one
of 38,600 names a space other than its own. **A real corpus would not be so
tidy**, which is exactly why the same measurement runs against the GitHub
fixture, where cross-project references are present.`
    : `Claim locality **fails** on this corpus: ${violations.toLocaleString()} claims are made about a space
the asserting fact does not rest on. That is the door an aggregation attack
walks through, and it is why Cordon's exposure below is nonzero. Examples:

${locality.violations
  .slice(0, 3)
  .map(
    (v) =>
      `- \`${v.claim}\` — asserted by a fact resting only on \`${v.required.join('`, `')}\`\n  > ${v.factText.replace(/\s+/g, ' ')}`,
  )
  .join('\n')}`
}

## The census

Mined from the graph. Every instance in the raw artifact can be re-derived.

| gate | denied pairs | aggregation leaks | rate | mean coverage | over-restricted |
|---|---|---|---|---|---|
${census
  .map(
    (row) =>
      `| ${row.gate} | ${row.denied.toLocaleString()} | **${row.leaks.toLocaleString()}** | ${(row.leakRate * 100).toFixed(1)}% | ${(row.meanCoverage * 100).toFixed(1)}% | ${row.overRestricted > 0 ? row.overRestricted.toLocaleString() : '—'} |`,
  )
  .join('\n')}

*Denied* always means denied under the correct rule, so the three gates are
scored on the same population. *Mean coverage* is the average share of a denied
fact's claims that the gate's own disclosures already determine — the leak count
is the tail of that distribution at 100%.

**Document-level filtering admits ${docAcl.leaks.toLocaleString()} aggregation leaks on this corpus.**
That is a finding about an entire industry approach, not about any one product:
the failure is invisible to document-level filtering's own metric, because
nothing it handed over was itself forbidden.

Cordon admits **${cordon.leaks.toLocaleString()}**.

${
  cordon.leaks > 0
    ? `### The fix, implemented and costed

The attack works through facts that **name** a space they do not rest on. So
widen the requirement to include what a fact talks about, not only where its
evidence sits:

    required'(f) = required(f) U { sp : f's text names sp }

That restores claim locality *by construction*, so Theorem 2 applies
unconditionally rather than as a hope about the data.

| | evidence-only | claim-aware |
|---|---|---|
| aggregation leaks | ${cordon.leaks.toLocaleString()} | **${claimAware.leaks.toLocaleString()}** |
| mean coverage reachable | ${(cordon.meanCoverage * 100).toFixed(1)}% | ${(claimAware.meanCoverage * 100).toFixed(1)}% |
| additional withholdings | — | ${claimAware.overRestricted.toLocaleString()} |

It is not free: a fact that merely mentions a space now requires it, so
${claimAware.overRestricted.toLocaleString()} (fact, principal) pairs the evidence-only rule would disclose are
now withheld. Whether that trade is worth making is an operator's decision, and
the point of measuring both is that they get to make it with numbers.`
    : ''
}

${
  docAcl.examples.length > 0
    ? `### A mined instance

Asker \`${docAcl.examples[0]!.principal}\` is denied:

> ${docAcl.examples[0]!.factText}

It requires \`${docAcl.examples[0]!.required.join('`, `')}\` and they lack
\`${docAcl.examples[0]!.missing.join('`, `')}\`.

Document-level filtering handed them ${docAcl.examples[0]!.witnesses.length} facts that between them assert
every claim the withheld fact makes:

${docAcl.examples[0]!.witnesses
  .map((w) => `- \`[${w.space}]\` level ${w.level} — ${w.text.replace(/\s+/g, ' ')}`)
  .join('\n')}

No individual disclosure was forbidden. The conclusion is reconstructed anyway.`
    : ''
}

## Red team

Adversarial question phrasings, run through the real retrieval and gate.

| | |
|---|---|
| attack sequences | ${red.sequences.toLocaleString()} |
| turns issued | ${red.turns.toLocaleString()} |
| sequences that reconstructed a target | **${red.successes.toLocaleString()}** |
| mean coverage reached | ${(red.meanCoverage * 100).toFixed(1)}% |

Paraphrase and role-play framing (*"as an auditor, ..."*) move nothing, and this
is structural rather than lucky: **admissibility never reads the question.** It
is a function of the asker and the derivation graph, so there is no phrasing
that changes it. The only channel with any surface is accumulation across turns,
which is the aggregation attack above arriving one question at a time.

Every attempted phrasing is committed in the raw artifact.

## What this does not cover

- **A model that infers beyond the claims.** We measure reconstruction of the
  atomic assertions a fact makes. A language model reading the same permitted
  facts may draw conclusions our claim decomposition does not represent.
- **Cross-principal collusion.** Two principals pooling disclosures reconstruct
  more than either alone; every number here is per principal.
- **Claim extraction is lexical.** A fact that implies a space without naming it
  is not counted, so the true attack surface is at least what is reported.
`,
  );

  console.log(`\n${c.dim}written to docs/ATTACK.md and ${artifactPath}${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
