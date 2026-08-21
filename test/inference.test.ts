/**
 * The inference numbers must come out of the committed run.
 *
 * The rest of this repository holds its headline figures to that rule, and the
 * rule matters most for the result that is *least* flattering to us: it would
 * be very easy to publish a phantom-denial count that quietly drifted from what
 * the audit last produced, and no reader could tell.
 *
 * So these tests recompute every published inference figure from
 * `artifacts/inference-summary.json` and fail if the README or docs/INFERENCE.md
 * disagrees with it. Regenerate both with `npm run audit:inference`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ARTIFACT = 'artifacts/inference-summary.json';

interface Summary {
  provenance: { gitSha: string; corpus: { digest: string; bytes: number } };
  scope: { principals: number; facts: number; derivedFacts: number };
  denials: { total: number; phantom: number; effective: number; phantomShare: number };
  byDepth: Array<{ level: number; denied: number; phantom: number; share: number }>;
  cut: {
    finite: number;
    verified: number;
    verifyAttempted: number;
    meanFactsCut: number;
    evidenceWithheldPct: number;
  };
}

const available = existsSync(ARTIFACT);
const summary: Summary | undefined = available
  ? (JSON.parse(readFileSync(ARTIFACT, 'utf8')) as Summary)
  : undefined;

/** Thousands-separated, as the prose writes it. */
const group = (n: number) => n.toLocaleString('en-US');

test('the artifact is internally consistent', { skip: !available }, () => {
  const s = summary!;
  assert.equal(
    s.denials.phantom + s.denials.effective,
    s.denials.total,
    'phantom + effective must exhaust the denials',
  );

  const denied = s.byDepth.reduce((a, d) => a + d.denied, 0);
  const phantom = s.byDepth.reduce((a, d) => a + d.phantom, 0);
  assert.equal(denied, s.denials.total, 'depth breakdown must sum to the total');
  assert.equal(phantom, s.denials.phantom, 'depth phantoms must sum to the total');

  for (const d of s.byDepth) {
    assert.ok(d.phantom <= d.denied, `depth ${d.level}: more phantoms than denials`);
  }

  assert.ok(s.cut.verified <= s.cut.verifyAttempted, 'verified cannot exceed attempted');
  assert.ok(
    s.provenance.corpus.digest.length === 64,
    'a run without a corpus digest is not reproducible',
  );
});

test('depth 1 is tight, as claimed', { skip: !available }, () => {
  const depth1 = summary!.byDepth.find((d) => d.level === 1);
  assert.ok(depth1, 'no depth-1 row');
  assert.equal(
    depth1.phantom,
    0,
    'the README claims depth 1 is tight; the artifact says otherwise',
  );
  assert.ok(depth1.denied > 0, 'depth 1 had no denials, so tightness proved nothing');
});

test('every cut attempted was verified', { skip: !available }, () => {
  const { verified, verifyAttempted } = summary!.cut;
  assert.ok(verifyAttempted > 0, 'no cut was verified, so the defence is unchecked');
  assert.equal(
    verified,
    verifyAttempted,
    'a computed cut failed to close its claim when re-run',
  );
});

test('the README figures match the committed run', { skip: !available }, () => {
  const s = summary!;
  const readme = readFileSync('README.md', 'utf8');

  const claims: Array<[string, string]> = [
    ['phantom denials', group(s.denials.phantom)],
    ['total denials', group(s.denials.total)],
    ['depth-1 denials', group(s.byDepth.find((d) => d.level === 1)!.denied)],
    ['cut cost', `${s.cut.evidenceWithheldPct.toFixed(1)}%`],
  ];

  for (const [what, text] of claims) {
    assert.ok(
      readme.includes(text),
      `README no longer states the ${what} (${text}) from ${ARTIFACT}; rerun npm run audit:inference`,
    );
  }

  for (const d of s.byDepth.filter((x) => x.phantom > 0)) {
    assert.ok(
      readme.includes(`${d.share.toFixed(1)}%`),
      `README omits the depth-${d.level} phantom share (${d.share.toFixed(1)}%)`,
    );
  }
});

test('docs/INFERENCE.md matches the committed run', { skip: !available }, () => {
  const s = summary!;
  const doc = readFileSync('docs/INFERENCE.md', 'utf8');

  for (const text of [
    group(s.denials.phantom),
    group(s.denials.effective),
    group(s.denials.total),
    `${s.cut.evidenceWithheldPct.toFixed(1)}%`,
  ]) {
    assert.ok(doc.includes(text), `docs/INFERENCE.md is stale: missing ${text}`);
  }
});

test('the published cost is a real trade, not a rounding artefact', { skip: !available }, () => {
  const cost = summary!.cut.evidenceWithheldPct;
  assert.ok(
    cost > 0,
    'a cut that costs nothing would mean the channel was never open; check the adversary',
  );
  assert.ok(cost <= 100, 'cannot withhold more evidence than the asker holds');
});

/* -------------------------------------------------------------------------- *
 * The planner's published numbers, held to the same rule.
 * -------------------------------------------------------------------------- */

const PLANNER = 'artifacts/planner-summary.json';

interface PlannerSummary {
  config: { topK: number; principals: number; sessionLength: number };
  perQuery: { queries: number; constraintBound: number; retentionPct: number; unsafe: number };
  session: { unsafe: number; finalRetentionPct: number | null };
  sweep: Array<{ k: number; queries: number; bound: number; prevented: number; retention: number }>;
}

const plannerAvailable = existsSync(PLANNER);
const planner: PlannerSummary | undefined = plannerAvailable
  ? (JSON.parse(readFileSync(PLANNER, 'utf8')) as PlannerSummary)
  : undefined;

test('every planned disclosure was verified safe', { skip: !plannerAvailable }, () => {
  const p = planner!;
  assert.equal(p.perQuery.unsafe, 0, 'a per-query plan was returned unsafe');
  assert.equal(p.session.unsafe, 0, 'a session plan was returned unsafe');
  assert.ok(p.perQuery.queries > 0, 'no queries were planned, so nothing was shown');
});

test('the sweep shows a real phase transition', { skip: !plannerAvailable }, () => {
  const sweep = planner!.sweep;
  assert.ok(sweep.length >= 3, 'too few depths swept to claim a transition');

  /*
   * The README claims safety is free at production depth and starts costing as
   * retrieval deepens. Both halves have to be true of the committed run: a
   * sweep where the constraint never bites has not tested the planner, and one
   * where it always bites contradicts the headline.
   */
  const shallow = sweep.filter((r) => r.k <= 20);
  assert.ok(shallow.length > 0, 'no shallow depth swept');
  for (const row of shallow) {
    assert.equal(row.bound, 0, `constraint bit at k=${row.k}; the README says it is free there`);
    assert.equal(row.retention, 100, `retention below 100% at k=${row.k}`);
  }

  const deep = sweep.filter((r) => r.k >= 50);
  assert.ok(
    deep.some((r) => r.bound > 0),
    'the constraint never bit at any depth; the guarantee is untested',
  );

  /* Deeper retrieval must not be cheaper - that would mean the metric is wrong. */
  for (let i = 1; i < sweep.length; i++) {
    assert.ok(
      sweep[i]!.retention <= sweep[i - 1]!.retention + 1e-9,
      `retention rose from k=${sweep[i - 1]!.k} to k=${sweep[i]!.k}, which is backwards`,
    );
  }
});

test('the README planner figures match the committed run', { skip: !plannerAvailable }, () => {
  const p = planner!;
  const readme = readFileSync('README.md', 'utf8');

  assert.ok(
    readme.includes(group(p.perQuery.queries)),
    `README no longer states the planned-query count (${group(p.perQuery.queries)})`,
  );

  const firstBind = p.sweep.find((r) => r.bound > 0);
  assert.ok(firstBind, 'no binding depth in the sweep');
  assert.ok(
    readme.includes(`k=${firstBind.k}`),
    `README omits the depth at which the constraint first bites (k=${firstBind.k})`,
  );

  const end = p.session.finalRetentionPct;
  assert.ok(end !== null, 'session curve produced no final retention');
  assert.ok(
    readme.includes(`${end.toFixed(1)}%`),
    `README omits the session end retention (${end.toFixed(1)}%)`,
  );
});
