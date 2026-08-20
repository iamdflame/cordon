/**
 * Every Cypher string in this repository must obey the engine's constraints.
 *
 * We spent real time discovering that HydraDB's OpenCypher subset rejects bare
 * `MATCH (n)`, rejects alternation inside a variable-length pattern, and
 * requires a fixed source id on a variable-length walk. Documenting that in
 * `docs/HYDRADB-ENGINE-NOTES.md` helps the next person. It does not stop *us*
 * from reintroducing the same query six months from now and only finding out
 * at runtime, in an authorization path, against a live graph.
 *
 * So the constraints are enforced here. This is a lint over the source, not a
 * test of behaviour: it reads every `.ts` file, extracts anything that looks
 * like a Cypher query, and applies the rules. A violation fails the build.
 *
 * The rules are deliberately conservative - they only fire on patterns we have
 * actually seen the engine reject - because a linter that cries wolf gets
 * disabled, and a disabled linter protects nothing.
 *
 * Two kinds of text are legitimately illegal and are exempt:
 *
 *   - `src/bench/engine-probe.ts`, whose entire job is to send queries the
 *     engine rejects and record how it rejects them.
 *   - any line carrying a `cypher-lint-ignore:` marker with a stated reason.
 *
 * Exemptions are visible and greppable on purpose. A linter you can silence
 * invisibly is decoration.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Found {
  file: string;
  line: number;
  query: string;
}

/**
 * Pull Cypher out of the source.
 *
 * Queries here are built from template literals with `${}` interpolation, so
 * the extracted text has holes in it. That is fine: every rule below is about
 * the *shape* of the pattern, and the holes are node labels and ids which do
 * not change whether a pattern is legal.
 */
function extractQueries(file: string): Found[] {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const found: Found[] = [];

  const KEYWORD = /\b(MATCH|CREATE|MERGE|UNWIND)\b/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Only string literals, so prose in comments is not linted.
    if (!KEYWORD.test(line)) continue;
    if (!/[`'"]/.test(line)) continue;
    // Skip comment lines: they document the constraints rather than break them.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    // An explicit, stated exemption, on this line or the one above it.
    if (line.includes('cypher-lint-ignore:')) continue;
    if ((lines[i - 1] ?? '').includes('cypher-lint-ignore:')) continue;
    found.push({ file, line: i + 1, query: line });
  }
  return found;
}

/** Files whose purpose is to issue queries the engine rejects. */
const EXEMPT_FILES = ['engine-probe'];

const FILES = sources('src')
  .concat(sources('test').filter((f) => !f.endsWith('cypher-lint.test.ts')))
  .filter((f) => !EXEMPT_FILES.some((e) => f.includes(e)));
const QUERIES = FILES.flatMap(extractQueries);

test('there is Cypher to lint', () => {
  assert.ok(QUERIES.length > 5, `expected to find Cypher, found ${QUERIES.length}`);
});

test('no bare node pattern without a label or predicate', () => {
  /*
   * `MATCH (n)` -> "node-only MATCH requires an id, label, or property
   * predicate". This cost us a confusing health check.
   */
  const bad = QUERIES.filter((q) =>
    /MATCH\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)(?!\s*-)/.test(q.query),
  );
  assert.equal(
    bad.length,
    0,
    `bare MATCH (n) is rejected by the engine:\n${bad.map((b) => `  ${b.file}:${b.line}  ${b.query.trim()}`).join('\n')}`,
  );
});

test('no alternation inside a variable-length relationship pattern', () => {
  /*
   * `-[:A|B*1..n]->` -> "relationship pattern must have exactly one type".
   * This is why RESTS_ON is a single edge type carrying its kind as a property.
   */
  const bad = QUERIES.filter((q) => /\[[^\]]*\|[^\]]*\*[^\]]*\]/.test(q.query));
  assert.equal(
    bad.length,
    0,
    `alternation in a variable-length pattern is rejected:\n${bad.map((b) => `  ${b.file}:${b.line}  ${b.query.trim()}`).join('\n')}`,
  );
});

test('every variable-length traversal is bounded', () => {
  /*
   * An unbounded `*` over a 226k-edge graph is not a query, it is an outage.
   * Every traversal we ship names an upper bound.
   */
  const bad = QUERIES.filter((q) => {
    const varLength = q.query.match(/\[[^\]]*\*([^\]]*)\]/g);
    if (!varLength) return false;
    return varLength.some((m) => {
      const spec = m.match(/\*([^\]]*)\]/)?.[1] ?? '';
      // Accept `*1..5` and `*..5`; reject `*` and `*1..`.
      return !/\d\s*$/.test(spec.replace(/\$\{[^}]*\}/g, '9'));
    });
  });
  assert.equal(
    bad.length,
    0,
    `variable-length traversal must have an upper bound:\n${bad.map((b) => `  ${b.file}:${b.line}  ${b.query.trim()}`).join('\n')}`,
  );
});

test('variable-length traversals start from a bound node', () => {
  /*
   * "variable-length MATCH requires a fixed source id". A traversal whose
   * source is an unconstrained label scan is rejected at runtime, which in an
   * authorization path means failing closed on every request rather than on a
   * test.
   *
   * Bound means the source pattern carries an id or property predicate.
   */
  const bad = QUERIES.filter((q) => {
    if (!/\*\s*\d|\*\s*\$\{|\*1\.\./.test(q.query)) return false;
    if (!/MATCH/.test(q.query)) return false;
    const source = q.query.match(/MATCH\s*\(([^)]*)\)/)?.[1] ?? '';
    // `{` means a property predicate; `$` means an interpolated id.
    return !/[{$]/.test(source);
  });
  assert.equal(
    bad.length,
    0,
    `variable-length MATCH needs a bound source:\n${bad.map((b) => `  ${b.file}:${b.line}  ${b.query.trim()}`).join('\n')}`,
  );
});

test('unbounded relations are read through the truncation guard', () => {
  /*
   * The engine caps results at 1024 rows and hands back a cursor that returns
   * nothing (hydra-db/hydradb#115). `client.query` will happily return the
   * truncated page; `queryComplete` throws. Anything reading a relation whose
   * size is not obviously bounded must use the guard.
   *
   * This checks the specific relations we know are large.
   */
  const risky = QUERIES.filter(
    (q) =>
      /MEMBER_OF|MANAGES/.test(q.query) &&
      /client\.query\(/.test(q.query) &&
      !/queryComplete/.test(q.query),
  );
  assert.equal(
    risky.length,
    0,
    `read an access-control relation through queryComplete, not query:\n${risky.map((b) => `  ${b.file}:${b.line}  ${b.query.trim()}`).join('\n')}`,
  );
});
