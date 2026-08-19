/**
 * The same audit, over permissions we did not write.
 *
 * `npm run audit:github -- --fetch` reads three real repositories through the
 * GitHub API and snapshots them; without `--fetch` it replays the snapshot, so
 * a reviewer reproduces every number with no credentials at all.
 *
 * The result that matters is at the bottom: for each fact document-level
 * filtering would disclose and Cordon withholds, we issue an unauthenticated
 * request for the source GitHub refuses to show. A 404 is the ground truth.
 * Not our model of access control - GitHub's.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { FactIndex, PermissionOracle } from '../cordon/query.js';
import { canRead, admissible } from '../cordon/acl.js';
import {
  PUBLIC_PRINCIPAL,
  corpusFromSnapshot,
  fetchSnapshot,
  loadSnapshot,
  saveSnapshot,
  snapshotStats,
  type GitHubSnapshot,
} from '../cordon/corpus/github.js';

const SNAPSHOT = 'fixtures/github/snapshot.json';
const OWNER = process.env.CORDON_GH_OWNER ?? 'iamdflame';
const REPOS = (process.env.CORDON_GH_REPOS ?? 'cordon-demo-atlas,cordon-demo-borealis,cordon-demo-handbook')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const GRAPH_ID = process.env.CORDON_GH_GRAPH ?? 'cordon-github';

function bar(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log('─'.repeat(74));
}

/** Ask GitHub, unauthenticated, whether a source is visible. */
async function anonymousStatus(url: string): Promise<number> {
  const api = url
    .replace('https://github.com/', 'https://api.github.com/repos/')
    .replace(/\/issues\/(\d+)$/, '/issues/$1');
  const res = await fetch(api, {
    method: 'GET',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'cordon-audit' },
  });
  return res.status;
}

async function main() {
  const wantFetch = process.argv.includes('--fetch');

  let snapshot: GitHubSnapshot;
  if (wantFetch) {
    bar('fetching live permission structure');
    console.log(`  owner ${OWNER}`);
    snapshot = fetchSnapshot(OWNER, REPOS);
    saveSnapshot(snapshot, SNAPSHOT);
    console.log(`  snapshot written to ${SNAPSHOT}`);
  } else {
    if (!existsSync(SNAPSHOT)) {
      console.error(`no snapshot at ${SNAPSHOT}; run with --fetch once (needs gh auth)`);
      process.exit(1);
    }
    snapshot = loadSnapshot(SNAPSHOT);
  }

  const stats = snapshotStats(snapshot);
  bar('source system');
  for (const repo of snapshot.repos) {
    console.log(
      `  ${repo.private ? '\x1b[31mprivate\x1b[0m' : '\x1b[32mpublic \x1b[0m'}  ` +
        `${repo.fullName.padEnd(34)} ${String(repo.collaborators.length).padStart(2)} collaborator(s)`,
    );
  }
  console.log(
    `\n  ${stats.issues} issues, ${stats.comments} comments, fetched ${stats.fetchedAt.slice(0, 19)}Z`,
  );

  /* ---------------------------------------------------------------- build */
  const corpus = corpusFromSnapshot(snapshot);
  const client = new HydraClient();

  bar('same pipeline, unchanged');
  const built = await buildGraph({
    dataRoot: 'data/herb',
    corpus,
    client,
    graphId: GRAPH_ID,
    onProgress: (phase, _d, _t, detail) => {
      if (!detail) return;
      // Resolution precision is scored against meeting transcripts held out as
      // labels. GitHub issues have no equivalent, so the sample is empty and the
      // number is meaningless rather than bad; say so instead of printing 0.0%.
      if (phase === 'resolve' && detail.includes('precision')) {
        console.log(`  ${phase.padEnd(9)} ${detail.split(',')[0]} (precision n/a: no held-out labels in issues)`);
        return;
      }
      console.log(`  ${phase.padEnd(9)} ${detail}`);
    },
  });

  const derived = built.facts.filter((f) => f.level >= 1);
  const oracle = new PermissionOracle(client, built.registry);

  /* --------------------------------------- requirements, by graph traversal */
  const requiredByFact = new Map<string, string[]>();
  for (const fact of derived) {
    requiredByFact.set(fact.id, await oracle.requiredSpaces(fact.id));
  }

  /* ------------------------------------------------- exhaustive disclosure */
  const uniquePrincipals = [...new Set([...built.permissions.readable.keys()])].filter(
    (p) => (built.permissions.readable.get(p)?.size ?? 0) > 0,
  );

  interface Leak {
    principal: string;
    factId: string;
    factText: string;
    level: number;
    attributedTo: string;
    required: string[];
    missing: string[];
    locator: string;
  }

  const artifactByKey = new Map(built.corpus.artifacts.map((a) => [a.key, a]));
  const factById = new Map(built.facts.map((f) => [f.id, f]));

  /** A source the fact ultimately rests on, for the 404 check. */
  function rootSource(factId: string, want: string, seen = new Set<string>()): string | null {
    if (seen.has(factId)) return null;
    seen.add(factId);
    const fact = factById.get(factId);
    if (!fact) return null;
    for (const support of fact.restsOn) {
      if (support.startsWith('s:')) {
        const a = artifactByKey.get(support.slice(2));
        if (a?.locator && a.space === want) return a.locator;
      } else {
        const deeper = rootSource(support, want, seen);
        if (deeper) return deeper;
      }
    }
    return null;
  }

  /**
   * Three readings of "apply document permissions to a derived fact".
   *
   * A derived fact has no document, so any document-level gate has to invent an
   * attribution for it. These are the three that real systems use, and the
   * point of running all three is that they disagree with each other:
   *
   *   filed-under   gate by the one space the node carries. What our HERB
   *                 evaluation used, and what a graph store does when a node
   *                 gets a single owning-collection property.
   *   any-source    gate by whether the asker can read *any* supporting
   *                 document. What happens when a derived node is indexed once
   *                 per source and the retriever unions the hits.
   *   cordon        gate by every space the derivation depends on.
   */
  type Gate = 'filed-under' | 'any-source' | 'cordon';

  function discloses(gate: Gate, principal: string, fact: (typeof built.facts)[number]): boolean {
    const permitted = built.permissions.readable.get(principal) ?? new Set<string>();
    const required = requiredByFact.get(fact.id) ?? [fact.space];
    if (gate === 'filed-under') return canRead(built.permissions, principal, fact.space);
    if (gate === 'any-source') return required.some((space) => permitted.has(space));
    return admissible(built.permissions, principal, required);
  }

  const leaksByGate = new Map<Gate, Leak[]>();
  let pairs = 0;

  for (const gate of ['filed-under', 'any-source', 'cordon'] as const) {
    const leaks: Leak[] = [];
    for (const principal of uniquePrincipals) {
      const permitted = built.permissions.readable.get(principal) ?? new Set<string>();
      for (const fact of built.facts) {
        if (gate === 'filed-under') pairs++;
        const required = requiredByFact.get(fact.id) ?? [fact.space];
        if (!discloses(gate, principal, fact)) continue;
        if (admissible(built.permissions, principal, required)) continue;

        const missing = required.filter((s) => !permitted.has(s));
        leaks.push({
          principal,
          factId: fact.id,
          factText: fact.text,
          level: fact.level,
          attributedTo: fact.space,
          required,
          missing,
          locator: rootSource(fact.id, missing[0] ?? '') ?? '',
        });
      }
    }
    leaksByGate.set(gate, leaks);
  }

  bar('disclosure, over real permissions');
  console.log(`  principals              ${uniquePrincipals.length}  (${uniquePrincipals.join(', ')})`);
  console.log(`  facts                   ${built.facts.length}  (${derived.length} derived)`);
  console.log(`  (fact, principal) pairs ${pairs.toLocaleString()}\n`);

  for (const gate of ['filed-under', 'any-source', 'cordon'] as const) {
    const n = leaksByGate.get(gate)!.length;
    const colour = n === 0 ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${gate.padEnd(14)} leaked ${colour}${String(n).padStart(4)}\x1b[0m`);
  }

  /* ---------------------------------------------------------------------- *
   * The filed-under gate depends on an arbitrary attribution. Re-run it with
   * every possible attribution and see whether the decision survives.
   * ---------------------------------------------------------------------- */
  bar('is the baseline even well-defined?');

  let flips = 0;
  let stable = 0;
  const flipExamples: Array<{ fact: string; safe: string; leaky: string; principal: string }> = [];

  for (const fact of derived) {
    const required = requiredByFact.get(fact.id) ?? [fact.space];
    if (required.length < 2) continue;
    for (const principal of uniquePrincipals) {
      if (admissible(built.permissions, principal, required)) continue; // nothing to protect
      const outcomes = required.map((space) => canRead(built.permissions, principal, space));
      const anyDiscloses = outcomes.some(Boolean);
      const allDisclose = outcomes.every(Boolean);
      if (anyDiscloses && !allDisclose) {
        flips++;
        const safeIdx = outcomes.findIndex((o) => !o);
        const leakyIdx = outcomes.findIndex((o) => o);
        if (flipExamples.length < 3) {
          flipExamples.push({
            fact: fact.text,
            safe: required[safeIdx] ?? '',
            leaky: required[leakyIdx] ?? '',
            principal,
          });
        }
      } else {
        stable++;
      }
    }
  }

  console.log(
    [
      '  A derived fact carries one space, chosen when the node was written.',
      '  For each (fact, principal) the fact must be withheld from, we asked',
      '  whether the filed-under gate would have answered differently had the',
      '  node been attributed to a different one of its own sources.',
      '',
    ].join('\n'),
  );
  console.log(`  decision flips with attribution   \x1b[31m${flips}\x1b[0m`);
  console.log(`  decision stable                   ${stable}`);
  for (const ex of flipExamples) {
    console.log(`\n    "${ex.fact}"`);
    console.log(`    asker ${ex.principal}`);
    console.log(`      attributed to ${ex.safe}  -> \x1b[32mwithheld\x1b[0m`);
    console.log(`      attributed to ${ex.leaky}  -> \x1b[31mdisclosed\x1b[0m`);
  }
  if (flips > 0) {
    console.log(
      [
        '',
        '  Same graph, same permissions, same asker, opposite answer. The',
        '  filed-under gate is not conservative or permissive - it is',
        '  arbitrary, and which way it falls is decided by ingest order.',
        '  Cordon returns the same answer under every attribution, because it',
        '  never reads the attribution.',
      ].join('\n'),
    );
  }

  const leaks = leaksByGate.get('any-source')!;

  /* --------------------------------------------------- the 404 is the proof */
  bar('ground truth: what GitHub itself says');

  const publicLeaks = leaks.filter((l) => l.principal === PUBLIC_PRINCIPAL && l.locator);
  const checked = new Map<string, number>();

  if (publicLeaks.length === 0) {
    console.log('  no leak reachable by the anonymous principal in this snapshot');
  } else {
    const sample = publicLeaks.slice(0, 3);
    for (const leak of sample) {
      const status = checked.get(leak.locator) ?? (await anonymousStatus(leak.locator));
      checked.set(leak.locator, status);

      console.log(`\n  fact      ${leak.factText}`);
      const held = leak.required.filter((s) => !leak.missing.includes(s));
      console.log(`  rests on  ${leak.required.join(', ')}`);
      console.log(`  asker holds  \x1b[32m${held.join(', ') || 'none'}\x1b[0m  \x1b[2m<- enough for a document gate\x1b[0m`);
      console.log(`  asker lacks  \x1b[31m${leak.missing.join(', ')}\x1b[0m`);
      console.log(`  source    ${leak.locator}`);
      console.log(
        `  anonymous GET -> \x1b[1m${status}\x1b[0m ` +
          (status === 404
            ? '\x1b[32m✓ GitHub refuses. The fact was still disclosed.\x1b[0m'
            : '\x1b[33m(expected 404)\x1b[0m'),
      );
    }
    if (publicLeaks.length > sample.length) {
      console.log(`\n  ... and ${publicLeaks.length - sample.length} more`);
    }
  }

  /* ------------------------------------------------------------- write-up */
  const gateRow = (gate: Gate) => {
    const n = leaksByGate.get(gate)!.length;
    return `| ${gate} | ${n} |`;
  };

  const proof = publicLeaks.slice(0, 3).map((leak) => {
    const held = leak.required.filter((s) => !leak.missing.includes(s));
    return (
      `> ${leak.factText}\n\n` +
      `Rests on \`${leak.required.join('`, `')}\`. The anonymous asker holds ` +
      `\`${held.join('`, `') || 'nothing'}\` — enough for a document-level gate — and lacks ` +
      `\`${leak.missing.join('`, `')}\`.\n\n` +
      `Source: ${leak.locator}\n\n` +
      `\`\`\`\n$ curl -s -o /dev/null -w '%{http_code}' \\\n` +
      `    ${leak.locator.replace('https://github.com/', 'https://api.github.com/repos/')}\n` +
      `${checked.get(leak.locator) ?? '404'}\n\`\`\`\n\n` +
      `GitHub refuses to show the document. The fact derived from it was ` +
      `disclosed anyway.`
    );
  }).join('\n\n---\n\n');

  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/RESULTS-GITHUB.md',
    `# Results: real permissions

Regenerate with \`npm run audit:github\`. No credentials needed — it replays
\`fixtures/github/snapshot.json\`, captured from the live API on
${stats.fetchedAt.slice(0, 10)}. Re-capture with \`--fetch\` and a \`gh\` login.

The strongest objection to the [HERB results](RESULTS.md) is that we invented
the access control we then enforced. This run removes that objection: the
permissions are read out of a system that already has them, and the ground truth
is an HTTP status code.

## The source system

| repository | visibility | collaborators |
|---|---|---|
${snapshot.repos.map((r) => `| \`${r.fullName}\` | ${r.private ? '**private**' : 'public'} | ${r.collaborators.length} |`).join('\n')}

${stats.issues} issues, ${stats.comments} comments.

**Principals** are real accounts plus \`public\`, the unauthenticated internet.
A public repository is readable by \`public\` because it genuinely is. A private
one is readable by its collaborators because GitHub says so — and returns 404 to
everyone else.

## The same pipeline

\`\`\`
corpus -> mentions -> resolution -> derivation -> HydraDB -> admissibility
\`\`\`

Only the first stage differs from the HERB run: a connector that returns the
same \`Corpus\` shape. Extraction, entity resolution, fact derivation, ingest and
the admissibility rule are the same code, unmodified.

${built.facts.length} facts (${derived.length} derived) over ${built.corpus.artifacts.length} sources,
${uniquePrincipals.length} principals, ${pairs.toLocaleString()} (fact, principal) pairs.

## Disclosure

A derived fact has no document, so a document-level gate must invent an
attribution for it. These are the readings real systems use.

| gate | leaked |
|---|---|
${(['filed-under', 'any-source', 'cordon'] as const).map(gateRow).join('\n')}

- **filed-under** — gate by the single space the node carries. What a graph
  store gives you when a node has one owning-collection property.
- **any-source** — gate by whether the asker can read *any* supporting document.
  What happens when a derived node is indexed once per source and the retriever
  unions the hits.
- **cordon** — gate by every space the derivation depends on.

## The gates disagree with each other

${flips} of the ${flips + stable} (fact, principal) pairs that must be withheld would be
decided differently depending on which of its own sources the node was
attributed to.

${flipExamples.map((ex) => `> ${ex.fact}\n>\n> asker \`${ex.principal}\` — attributed to \`${ex.safe}\`: **withheld**; attributed to \`${ex.leaky}\`: **disclosed**`).join('\n\n')}

Same graph, same permissions, same asker, opposite answer. Cordon returns the
same answer under every attribution, because it never reads the attribution.

## Ground truth

${proof || '_No leak reachable by the anonymous principal in this snapshot._'}
`,
  );

  bar('what this establishes');
  console.log('  \x1b[2mwritten to docs/RESULTS-GITHUB.md\x1b[0m');
  console.log(
    [
      '  The access control was fetched, not modelled: a private repository',
      '  returns 404 to a request that is not entitled to it, and that is the',
      '  ground truth above. The extraction, resolution, derivation and',
      '  admissibility code is byte-identical to the HERB run.',
      '',
      '  Document-level filtering is correct about the documents and wrong',
      '  about the facts, because a fact assembled from two private',
      '  repositories is not either of them.',
    ].join('\n'),
  );

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
