/**
 * Capture a real session for the hosted console.
 *
 *   npm run capture
 *
 * The console at web/ needs a running HydraDB. A judge should not have to stand
 * one up before they can see anything, so this records genuine responses -
 * every principal, every fact, every requirement resolved by traversal - into a
 * single JSON blob the static page replays.
 *
 * It is a recording, not a simulation. Nothing here is authored: the
 * requirements come from the same `PermissionOracle` traversal the live API
 * uses, and the README says plainly that the hosted page is a replay so nobody
 * mistakes it for a live instance.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { HydraClient } from '../hydra/client.js';
import { buildGraph } from '../cordon/pipeline.js';
import { PermissionOracle } from '../cordon/query.js';
import { admissible } from '../cordon/acl.js';
import { corpusFromSnapshot, loadSnapshot } from '../cordon/corpus/github.js';
import { spacesNamedIn } from '../attack/model.js';
import { buildVocabulary } from '../attack/mine.js';

async function main() {
  const client = new HydraClient();
  const snapshot = loadSnapshot('fixtures/github/snapshot.json');

  const built = await buildGraph({
    dataRoot: 'data/herb',
    corpus: corpusFromSnapshot(snapshot),
    client,
    graphId: 'cordon-github2',
    skipIngest: true,
    onProgress: (phase, _d, _t, detail) => {
      if (detail) console.log(`  ${phase.padEnd(9)} ${detail}`);
    },
  });

  const { facts, permissions, corpus } = built;
  const oracle = new PermissionOracle(client, built.registry);
  const vocabulary = buildVocabulary(corpus);

  console.log('  resolving requirements by traversal...');
  const required = new Map<string, string[]>();
  for (const fact of facts) {
    required.set(
      fact.id,
      fact.level === 0 ? fact.requiredSpaces : await oracle.requiredSpaces(fact.id),
    );
  }

  const artifactByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));
  const factById = new Map(facts.map((f) => [f.id, f]));

  /** The chain from a fact down to the sources it rests on. */
  function chain(factId: string, depth = 0, seen = new Set<string>()): unknown[] {
    if (depth > 4 || seen.has(factId)) return [];
    seen.add(factId);
    const fact = factById.get(factId);
    if (!fact) return [];
    return fact.restsOn.slice(0, 6).map((support) => {
      if (support.startsWith('s:')) {
        const artifact = artifactByKey.get(support.slice(2));
        return {
          kind: 'source',
          space: artifact?.space ?? '',
          title: artifact?.title ?? '',
          locator: artifact?.locator ?? '',
          text: (artifact?.text ?? '').replace(/\s+/g, ' ').slice(0, 220),
        };
      }
      const parent = factById.get(support);
      return {
        kind: 'fact',
        level: parent?.level ?? 0,
        space: parent?.space ?? '',
        text: parent?.text ?? '',
        requires: required.get(support) ?? [],
        restsOn: chain(support, depth + 1, seen),
      };
    });
  }

  const principals = [...permissions.readable.keys()]
    .filter((p) => (permissions.readable.get(p)?.size ?? 0) > 0)
    .sort();

  const derived = facts.filter((f) => f.level >= 1);

  const capture = {
    generatedAt: new Date().toISOString(),
    gitSha: (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    })(),
    owner: snapshot.owner,
    note:
      'Recorded from a live HydraDB run against real GitHub permissions. ' +
      'Requirements were resolved by graph traversal, not read from a field.',
    spaces: snapshot.repos.map((r) => ({
      id: r.name,
      private: r.private,
      url: `https://github.com/${r.fullName}`,
    })),
    teams: snapshot.teams.map((t) => ({ slug: t.slug, parent: t.parent, repos: t.repos })),
    principals: principals.map((id) => ({
      id,
      name: corpus.employees.get(id)?.name ?? id,
      role: corpus.employees.get(id)?.role ?? '',
      spaces: [...(permissions.readable.get(id) ?? [])].sort(),
    })),
    facts: derived.map((fact) => {
      const req = required.get(fact.id) ?? [];
      const named = spacesNamedIn(fact, vocabulary);
      return {
        id: fact.id,
        text: fact.text,
        level: fact.level,
        filedUnder: fact.space,
        requires: req,
        /** Spaces the text names but the evidence does not sit in. */
        namesButDoesNotRestOn: named.filter((s) => !req.includes(s)),
        restsOn: chain(fact.id),
        /** Per principal: what each of the three gates would do. */
        verdicts: Object.fromEntries(
          principals.map((p) => {
            const permitted = permissions.readable.get(p) ?? new Set<string>();
            return [
              p,
              {
                cordon: admissible(permissions, p, req),
                documentAcl: permitted.has(fact.space),
                anySource: req.some((s) => permitted.has(s)),
                missing: req.filter((s) => !permitted.has(s)),
              },
            ];
          }),
        ),
      };
    }),
  };

  mkdirSync('web/public', { recursive: true });
  writeFileSync('web/public/capture.json', JSON.stringify(capture));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/console-capture.json', JSON.stringify(capture, null, 2));

  console.log(
    `\n  captured ${capture.facts.length} derived facts x ${capture.principals.length} principals` +
      `\n  written to web/public/capture.json and artifacts/console-capture.json\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
