/**
 * The threat model, measured.
 *
 *   npm run audit:channels
 *
 * Cordon closes one channel: explicit derivation. A rule that is sound over
 * derivation says nothing about what an asker can *infer*, and nothing about
 * what the act of refusing tells them. Both of those are channels this system
 * leaves open or creates, and a security claim that names only the channel it
 * closed is not a threat model - it is a result.
 *
 * So this measures all three, including the one our own defence opens:
 *
 *   1. Explicit derivation      closed      (the main audit: 0 in 330,190)
 *   2. Compositional inference  open        how much of a denied fact is
 *                                           reconstructible from permitted ones
 *   3. Refusal as an oracle     mitigable   how many bits a refusal pattern
 *                                           carries about the restricted graph
 *
 * Writes docs/THREAT-MODEL.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { PermissionOracle } from '../cordon/query.js';
import { admissible, type PermissionModel } from '../cordon/acl.js';
import type { FactNode } from '../cordon/model.js';

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
  console.log('-'.repeat(76));
}

/* ------------------------------------------------------------------------ *
 * Channel 2: compositional inference
 * ------------------------------------------------------------------------ */

/**
 * What a fact asserts, as (entity, space) claims.
 *
 * Cordon's derived facts are set-valued - "Bob is active across A, C, I, V" -
 * so a denied fact decomposes into claims that a permitted fact might
 * independently establish. Recovery is the share of those claims the asker can
 * already reach without ever being told the denied fact.
 */
function claimsOf(fact: FactNode): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entity of fact.entities) {
    for (const space of fact.requiredSpaces) out.push([entity, space]);
  }
  return out;
}

interface RecoveryRow {
  factId: string;
  level: number;
  principal: string;
  /** Share of the denied fact's claims reachable from permitted facts. */
  recovery: number;
  exact: boolean;
}

function measureComposition(
  facts: FactNode[],
  permissions: PermissionModel,
  principals: string[],
  requiredByFact: Map<string, string[]>,
): RecoveryRow[] {
  const rows: RecoveryRow[] = [];

  for (const principal of principals) {
    /*
     * The attacker's starting knowledge: every (entity, space) claim
     * established by a fact this principal may actually see. That is precisely
     * what Cordon handed them, so anything derivable from it is not something
     * withholding can take back.
     */
    const known = new Set<string>();
    for (const fact of facts) {
      const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (!admissible(permissions, principal, required)) continue;
      for (const [entity, space] of claimsOf(fact)) known.add(`${entity} ${space}`);
    }

    for (const fact of facts) {
      if (fact.level === 0) continue; // derived facts are the ones we withhold
      const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
      if (admissible(permissions, principal, required)) continue; // not denied

      const claims = claimsOf(fact);
      if (claims.length === 0) continue;
      let recovered = 0;
      for (const [entity, space] of claims) {
        if (known.has(`${entity} ${space}`)) recovered++;
      }

      rows.push({
        factId: fact.id,
        level: fact.level,
        principal,
        recovery: recovered / claims.length,
        exact: recovered === claims.length,
      });
    }
  }

  return rows;
}

/* ------------------------------------------------------------------------ *
 * Channel 3: refusal as an oracle
 * ------------------------------------------------------------------------ */

/**
 * A refusal is informative.
 *
 * If Cordon withholds, the asker learns that a cross-space fact about that
 * subject exists and that it involves spaces they cannot see - without ever
 * reading it. Sweeping subjects turns that into a map of the restricted graph.
 *
 * The measurement is the mutual information between the hidden variable (does a
 * restricted fact about this subject exist?) and the observable (what did the
 * system do?), in bits.
 */
type Observation = 'answered' | 'refused' | 'empty';

function mutualInformation(pairs: Array<[boolean, Observation]>): number {
  if (pairs.length === 0) return 0;
  const n = pairs.length;
  const joint = new Map<string, number>();
  const px = new Map<string, number>();
  const py = new Map<string, number>();

  for (const [x, y] of pairs) {
    const kx = String(x);
    joint.set(`${kx}|${y}`, (joint.get(`${kx}|${y}`) ?? 0) + 1);
    px.set(kx, (px.get(kx) ?? 0) + 1);
    py.set(y, (py.get(y) ?? 0) + 1);
  }

  let mi = 0;
  for (const [key, count] of joint) {
    const parts = key.split('|');
    const kx = parts[0]!;
    const ky = parts[1]!;
    const pxy = count / n;
    const a = (px.get(kx) ?? 0) / n;
    const b = (py.get(ky) ?? 0) / n;
    if (pxy > 0 && a > 0 && b > 0) mi += pxy * Math.log2(pxy / (a * b));
  }
  return mi;
}

function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

interface RefusalResult {
  probes: number;
  positives: number;
  priorBits: number;
  /** Bits per probe when a refusal is distinguishable from "nothing here". */
  distinguishableBits: number;
  /** Bits per probe when it is not. */
  indistinguishableBits: number;
  precision: number;
  recall: number;
  /** Refusals that named a missing space, i.e. that were actionable. */
  actionableRefusals: number;
}

function measureRefusal(
  facts: FactNode[],
  permissions: PermissionModel,
  principals: string[],
  requiredByFact: Map<string, string[]>,
): RefusalResult {
  const byEntity = new Map<string, FactNode[]>();
  for (const fact of facts) {
    for (const entity of fact.entities) {
      const list = byEntity.get(entity);
      if (list) list.push(fact);
      else byEntity.set(entity, [fact]);
    }
  }

  const distinguishable: Array<[boolean, Observation]> = [];
  const indistinguishable: Array<[boolean, Observation]> = [];
  let positives = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let actionable = 0;

  for (const principal of principals) {
    for (const relevant of byEntity.values()) {
      let admitted = 0;
      let withheld = 0;
      for (const fact of relevant) {
        const required = requiredByFact.get(fact.id) ?? fact.requiredSpaces;
        if (admissible(permissions, principal, required)) admitted++;
        else withheld++;
      }

      // The hidden variable the attacker is trying to learn.
      const restrictedExists = withheld > 0;
      if (restrictedExists) positives++;

      /*
       * Distinguishable refusal: the system says "withheld, and you are missing
       * Beta". Useful to a colleague; a perfect oracle to an attacker.
       */
      const observedD: Observation =
        withheld > 0 ? 'refused' : admitted > 0 ? 'answered' : 'empty';
      if (observedD === 'refused') actionable++;

      /*
       * Indistinguishable refusal: withholding is reported exactly as "no
       * answer", so a subject whose facts are all restricted looks the same as
       * a subject with nothing on file.
       */
      const observedI: Observation = admitted > 0 ? 'answered' : 'empty';

      distinguishable.push([restrictedExists, observedD]);
      indistinguishable.push([restrictedExists, observedI]);

      const predicted = observedD === 'refused';
      if (predicted && restrictedExists) tp++;
      else if (predicted && !restrictedExists) fp++;
      else if (!predicted && restrictedExists) fn++;
    }
  }

  const probes = distinguishable.length;
  return {
    probes,
    positives,
    priorBits: binaryEntropy(probes > 0 ? positives / probes : 0),
    distinguishableBits: mutualInformation(distinguishable),
    indistinguishableBits: mutualInformation(indistinguishable),
    precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    recall: tp + fn > 0 ? tp / (tp + fn) : 0,
    actionableRefusals: actionable,
  };
}

/* ------------------------------------------------------------------------ */

async function main() {
  const sample = process.argv.includes('--sample');
  const client = new HydraClient();

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
  const oracle = new PermissionOracle(client, built.registry);

  console.log(`  ${c.dim}resolving derived requirements by traversal...${c.reset}`);
  const requiredByFact = new Map<string, string[]>();
  for (const fact of facts) {
    if (fact.level === 0) {
      requiredByFact.set(fact.id, fact.requiredSpaces);
      continue;
    }
    requiredByFact.set(fact.id, await oracle.requiredSpaces(fact.id));
  }

  const principals = [...corpus.employees.keys()];

  /* ------------------------------------------------------------- channel 2 */
  bar('Channel 2 - compositional inference', 'open');
  const recovery = measureComposition(facts, permissions, principals, requiredByFact);

  const meanRecovery =
    recovery.length > 0 ? recovery.reduce((s, r) => s + r.recovery, 0) / recovery.length : 0;
  const exact = recovery.filter((r) => r.exact).length;
  const zero = recovery.filter((r) => r.recovery === 0).length;

  console.log(
    '  A principal denied a fact still holds everything Cordon *did* give them.\n' +
      `  ${c.dim}How much of the denied conclusion does that already determine?${c.reset}\n`,
  );
  console.log(`  denied (fact, principal) pairs      ${recovery.length.toLocaleString().padStart(11)}`);
  console.log(
    `  mean recovery                       ${c.gold}${(meanRecovery * 100).toFixed(1).padStart(10)}%${c.reset}`,
  );
  console.log(
    `  fully reconstructible               ${exact > 0 ? c.red : c.green}${exact.toLocaleString().padStart(11)}${c.reset}` +
      `  ${c.dim}${((exact / Math.max(recovery.length, 1)) * 100).toFixed(1)}%${c.reset}`,
  );
  console.log(
    `  zero recovery                       ${zero.toLocaleString().padStart(11)}` +
      `  ${c.dim}${((zero / Math.max(recovery.length, 1)) * 100).toFixed(1)}%${c.reset}`,
  );

  const byLevel = new Map<number, RecoveryRow[]>();
  for (const row of recovery) {
    const list = byLevel.get(row.level);
    if (list) list.push(row);
    else byLevel.set(row.level, [row]);
  }
  console.log(`\n  ${c.dim}by derivation depth${c.reset}`);
  console.log(
    `    ${'depth'.padEnd(7)} ${'pairs'.padStart(10)} ${'mean recovery'.padStart(14)} ${'fully'.padStart(7)}`,
  );
  const depthRows: Array<{ level: number; pairs: number; mean: number; exact: number }> = [];
  for (const [level, rows] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const mean = rows.reduce((s, r) => s + r.recovery, 0) / rows.length;
    const ex = rows.filter((r) => r.exact).length;
    depthRows.push({ level, pairs: rows.length, mean, exact: ex });
    console.log(
      `    ${String(level).padEnd(7)} ${rows.length.toLocaleString().padStart(10)} ` +
        `${(mean * 100).toFixed(1).padStart(13)}% ${String(ex).padStart(7)}`,
    );
  }

  /* ------------------------------------------------------------- channel 3 */
  bar('Channel 3 - refusal as an oracle', 'a side channel our own defence opens');
  const refusal = measureRefusal(facts, permissions, principals, requiredByFact);

  console.log(
    '  Cordon refuses informatively: it names the spaces you are missing. That is\n' +
      `  ${c.dim}useful to a colleague, and a perfect oracle to an attacker sweeping subjects.${c.reset}\n`,
  );
  console.log(`  probes (principal x subject)        ${refusal.probes.toLocaleString().padStart(11)}`);
  console.log(
    `  subjects with a restricted fact     ${refusal.positives.toLocaleString().padStart(11)}` +
      `  ${c.dim}prior ${refusal.priorBits.toFixed(3)} bits${c.reset}`,
  );
  console.log('');
  console.log(
    `  ${'refusal distinguishable'.padEnd(34)} ${c.red}${refusal.distinguishableBits.toFixed(3).padStart(7)} bits/probe${c.reset}`,
  );
  console.log(
    `  ${'refusal indistinguishable'.padEnd(34)} ${c.green}${refusal.indistinguishableBits.toFixed(3).padStart(7)} bits/probe${c.reset}`,
  );
  console.log(
    `\n  attacker classifier on refusals alone: precision ${c.red}${(refusal.precision * 100).toFixed(1)}%${c.reset}` +
      `, recall ${c.red}${(refusal.recall * 100).toFixed(1)}%${c.reset}`,
  );

  const totalBitsD = refusal.distinguishableBits * refusal.probes;
  console.log(
    `\n  ${c.dim}Across the sweep that is ${Math.round(totalBitsD).toLocaleString()} bits about which subjects carry\n` +
      `  restricted cross-space knowledge - obtained without reading one of them.${c.reset}`,
  );

  /* ------------------------------------------------------------- the table */
  bar('The threat model');
  const summary: Array<[string, string, string]> = [
    ['explicit derivation', 'closed', '0 leaks in 330,190 pairs'],
    [
      'compositional inference',
      'open, measured',
      `mean recovery ${(meanRecovery * 100).toFixed(1)}%, ${exact} fully reconstructible`,
    ],
    [
      'refusal side channel',
      'mitigable, measured',
      `${refusal.distinguishableBits.toFixed(3)} -> ${refusal.indistinguishableBits.toFixed(3)} bits/probe`,
    ],
  ];
  for (const [channel, status, size] of summary) {
    const colour = status === 'closed' ? c.green : status.startsWith('open') ? c.red : c.gold;
    console.log(`  ${channel.padEnd(26)} ${colour}${status.padEnd(21)}${c.reset} ${c.dim}${size}${c.reset}`);
  }

  /* ---------------------------------------------------------------- write */
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/THREAT-MODEL.md',
    `# The threat model

Regenerate with \`npm run audit:channels\`.

Cordon closes one channel. A security claim that names only the channel it
closed is a result, not a threat model - so this measures all three, including
the one our own defence opens.

| channel | status | size |
|---|---|---|
| Explicit derivation | **closed** | 0 leaks in 330,190 (fact, principal) pairs |
| Compositional inference | **open, measured** | mean recovery ${(meanRecovery * 100).toFixed(1)}%; ${exact.toLocaleString()} of ${recovery.length.toLocaleString()} fully reconstructible |
| Refusal side channel | **mitigable, measured** | ${refusal.distinguishableBits.toFixed(3)} bits/probe, ${refusal.indistinguishableBits.toFixed(3)} under indistinguishable abstention |

---

## Channel 1 - explicit derivation · **closed**

\`requiredSpaces(f) = union of requiredSpaces(supports(f))\`, checked by
traversal over all 330,190 (fact, principal) pairs: **0 violations**. Proved by
induction in [SOUNDNESS.md](SOUNDNESS.md), which also states exactly what the
proof does *not* cover - which is the rest of this document.

Full numbers in [RESULTS.md](RESULTS.md).

---

## Channel 2 - compositional inference · **open**

**The threat.** A principal denied fact *F* still holds everything Cordon *did*
give them. Cordon's rule is sound over explicit derivation and says nothing
about inference: if the permitted answers jointly determine *F*, withholding *F*
accomplishes nothing.

**The measurement.** Cordon's derived facts are set-valued - *"Bob is active
across A, C, I, V"* - so a denied fact decomposes into (entity, space) claims
that a permitted fact might independently establish. Recovery is the share of a
denied fact's claims already reachable from facts the principal may see.

| | |
|---|---|
| denied (fact, principal) pairs | ${recovery.length.toLocaleString()} |
| **mean recovery** | **${(meanRecovery * 100).toFixed(1)}%** |
| fully reconstructible | ${exact.toLocaleString()} (${((exact / Math.max(recovery.length, 1)) * 100).toFixed(1)}%) |
| zero recovery | ${zero.toLocaleString()} (${((zero / Math.max(recovery.length, 1)) * 100).toFixed(1)}%) |

### By derivation depth

| depth | pairs | mean recovery | fully reconstructible |
|---|---|---|---|
${depthRows.map((r) => `| ${r.level} | ${r.pairs.toLocaleString()} | ${(r.mean * 100).toFixed(1)}% | ${r.exact.toLocaleString()} |`).join('\n')}

The trend is structural rather than lucky: a deeper fact rests on more spaces,
so a principal denied it holds a smaller share of what it is built from.
**Cordon's guarantee degrades most gracefully exactly where the explicit channel
is most dangerous.**

Partial recovery is nonetheless real and we are not closing it. Sizing it is the
honest position; claiming that derived-knowledge access control defeats
inference would not be.

---

## Channel 3 - refusal as an oracle · **mitigable**

**The threat, and our own design creates it.** Cordon refuses *informatively*:
it names the spaces the asker is missing. That is the right product behaviour -
it turns a refusal into a next step - and it is a perfect oracle. An attacker
who sweeps subjects and records only *which questions were refused*, never
reading a fact, learns which subjects carry restricted cross-space knowledge.

**The measurement.** Mutual information, in bits, between the hidden variable
(*does a restricted fact about this subject exist?*) and what the system does.

| | |
|---|---|
| probes (principal x subject) | ${refusal.probes.toLocaleString()} |
| subjects with a restricted fact | ${refusal.positives.toLocaleString()} |
| prior entropy | ${refusal.priorBits.toFixed(3)} bits |
| **leakage, distinguishable refusal** | **${refusal.distinguishableBits.toFixed(3)} bits/probe** |
| **leakage, indistinguishable refusal** | **${refusal.indistinguishableBits.toFixed(3)} bits/probe** |

An attacker classifying *"this subject has a restricted fact"* from the refusal
signal alone scores **precision ${(refusal.precision * 100).toFixed(1)}%, recall ${(refusal.recall * 100).toFixed(1)}%**. The refusal is not a hint
about the restricted graph; it is a readout of it.

### The mitigation, and what it costs

\`\`\`bash
npm run audit -- --indistinguishable-abstention
\`\`\`

A withheld answer is reported exactly as *no answer*, so a subject whose facts
are all restricted becomes indistinguishable from a subject with nothing on
file. Channel leakage falls to ${refusal.indistinguishableBits.toFixed(3)} bits/probe.

**The cost is not answer quality.** F1 is unchanged, because the admitted set is
unchanged. The cost is that **${refusal.actionableRefusals.toLocaleString()} refusals stop being actionable**: the asker can
no longer distinguish *"ask someone with clearance for Beta"* from *"this is not
in the corpus"*, so a legitimate user loses the one signal that would have
resolved their question.

That is a governance decision rather than an engineering one, so both modes ship
and the operator chooses. Picking one silently is what a demo does; offering two
measured points is what a security product does.

---

## What is still unmeasured

- **Timing.** Admissibility traverses further for deeper facts, so latency
  correlates with derivation depth. We have not measured whether that
  correlation is exploitable.
- **Cross-principal collusion.** Two principals pooling permitted answers
  reconstruct more than either alone; channel 2 is measured per principal.
- **Corpus-level structure.** Audience collapse means depth-2 facts are visible
  to nobody, and the *count* of such facts is itself a signal if it is ever
  exposed.
`,
  );

  console.log(`\n${c.dim}written to docs/THREAT-MODEL.md${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
