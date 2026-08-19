/**
 * The hero scenario.
 *
 *   npm run demo:leak
 *
 * One question. Two colleagues. One is entitled to the answer and one is not,
 * and the difference is invisible to any system that reasons about documents
 * rather than about derivations.
 *
 * The scenario is *discovered*, not hardcoded: the corpus is searched for a
 * question whose best answer is a derived fact spanning several spaces, and for
 * a pair of principals who fall on either side of it. Hardcoding it would make
 * the demo a claim; finding it makes the demo a measurement.
 */

import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { FactIndex, PermissionOracle } from '../cordon/query.js';
import { admissible } from '../cordon/acl.js';
import type { FactNode } from '../cordon/model.js';

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  gold: '\u001b[33m',
};

const rule = (width = 78) => '─'.repeat(width);

async function main() {
  const client = new HydraClient();
  if (!(await client.ping())) {
    console.error('HydraDB unreachable. Start it with: npm run hydra:up');
    process.exit(1);
  }

  const built = await buildGraph({
    dataRoot: 'data/herb',
    client,
    graphId: process.env.CORDON_GRAPH ?? 'cordon-v1',
    skipIngest: true,
  });

  const { corpus, facts, permissions, registry } = built;
  const index = new FactIndex();
  for (const fact of facts) index.add(fact);
  index.finalise();

  const oracle = new PermissionOracle(client, registry);
  const everyone = [...corpus.employees.keys()];

  /* ---- find a question whose answer is a cross-space derived fact ------- */
  let scenario: {
    question: string;
    fact: FactNode;
    required: string[];
    entitled: string;
    denied: string;
  } | null = null;

  const derived = facts.filter((f) => f.level >= 1);
  const derivedIds = new Set(derived.map((f) => f.id));

  for (const question of corpus.questions) {
    if (!question.answerable) continue;
    const hits = index.search(question.question, 12);
    const hit = hits.find((h) => derivedIds.has(h.fact.id));
    if (!hit) continue;

    const required = await oracle.requiredSpaces(hit.fact.id);
    if (required.length < 2) continue;

    /*
     * The pair that makes the point.
     *
     * `entitled` holds every space the fact rests on. `denied` holds the space
     * the fact is *filed under* - so a document-level check waves it straight
     * through - but not everything underneath it. That gap is the leak, and a
     * scenario where document-level filtering happens to refuse anyway would
     * demonstrate nothing.
     */
    const entitled = everyone.find((p) => admissible(permissions, p, required));
    if (!entitled) continue;

    const denied = everyone.find((p) => {
      const allowed = permissions.readable.get(p) ?? new Set<string>();
      if (!allowed.has(hit.fact.space)) return false;   // doc-ACL must disclose
      return !admissible(permissions, p, required);      // cordon must withhold
    });
    if (!denied) continue;

    scenario = { question: question.question, fact: hit.fact, required, entitled, denied };
    break;
  }

  if (!scenario) {
    console.log('No qualifying scenario found in this corpus slice.');
    return;
  }

  const { question, fact, required, entitled, denied } = scenario;
  const a = corpus.employees.get(entitled)!;
  const b = corpus.employees.get(denied)!;
  const aSpaces = [...(permissions.readable.get(entitled) ?? [])];
  const bSpaces = [...(permissions.readable.get(denied) ?? [])];
  const missing = required.filter((s) => !bSpaces.includes(s));

  console.log(`\n${c.bold}The same question, asked by two colleagues${c.reset}`);
  console.log(rule());
  console.log(`${c.dim}question${c.reset}  ${question}`);
  console.log(`${c.dim}answer  ${c.reset}  ${fact.text.slice(0, 150)}`);
  console.log(
    `${c.dim}        ${c.reset}  ${c.gold}a level-${fact.level} derived fact${c.reset} — no single document states it`,
  );
  console.log(`${c.dim}requires${c.reset}  ${required.join(', ')}  ${c.dim}(by traversal)${c.reset}`);

  for (const [person, spaces, label] of [
    [a, aSpaces, 'entitled'],
    [b, bSpaces, 'denied'],
  ] as const) {
    const permitted = label === 'entitled';
    console.log(`\n${rule()}`);
    console.log(`${c.bold}${person.name}${c.reset} ${c.dim}· ${person.role}${c.reset}`);
    console.log(`${c.dim}may read${c.reset}  ${spaces.join(', ') || '(nothing)'}`);
    console.log();
    console.log(`  ${c.dim}ungated knowledge graph${c.reset}       ${c.red}discloses${c.reset}`);
    console.log(
      `  ${c.dim}document-level ACL filtering${c.reset}  ${
        admissible(permissions, permitted ? entitled : denied, [fact.space])
          ? `${c.red}discloses${c.reset}`
          : `${c.green}withholds${c.reset}`
      }   ${c.dim}(checks only ${fact.space})${c.reset}`,
    );
    console.log(
      `  ${c.bold}cordon${c.reset}                        ${
        permitted ? `${c.green}discloses${c.reset}` : `${c.green}withholds${c.reset}`
      }   ${c.dim}${permitted ? 'holds every required space' : `lacks ${missing.join(', ')}`}${c.reset}`,
    );
  }

  console.log(`\n${rule()}`);
  console.log(
    `${c.bold}${b.name}${c.reset} can read ${c.gold}${
      required.filter((s) => bSpaces.includes(s)).join(', ') || 'none'
    }${c.reset} of what this fact rests on, but not ${c.gold}${missing.join(', ')}${c.reset}.`,
  );
  console.log(
    'Document-level filtering asks which document this belongs to. There is no',
  );
  console.log('such document — the fact was synthesised across several, and its audience');
  console.log('is the intersection of theirs.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
