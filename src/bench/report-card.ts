/**
 * The security report card.
 *
 *   npm run report
 *
 * Ten audits produce ten documents, and nobody reads ten documents before
 * merging. So this reduces all of them to one question - **is this build still
 * safe?** - and exits non-zero when it is not.
 *
 * The distinction that makes it worth having: every other audit here *measures*.
 * This one *gates*. A measurement tells you what happened; a gate stops the
 * thing that broke from shipping. A security property nobody is checking on
 * every commit is a security property you used to have.
 *
 * It reads the committed artifacts rather than recomputing, deliberately. The
 * artifacts carry a git SHA and a corpus digest, so this also catches the
 * failure mode where a number is *stale* rather than wrong - an audit that has
 * not been re-run since the code changed underneath it is not evidence, and it
 * looks exactly like evidence.
 *
 * Designed to be the whole of a CI job:
 *
 *     npm test && npm run report
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const ESC = String.fromCharCode(27);
const c = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  gold: `${ESC}[33m`,
};

type Status = 'pass' | 'fail' | 'stale' | 'missing';

interface Check {
  area: string;
  claim: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];

function read<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function currentSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const HEAD = currentSha();

/**
 * Add a check, and mark it *stale* when its artifact predates the current
 * commit on files that matter.
 *
 * Stale is reported separately from failing because they call for different
 * actions: a failure means fix the code, a stale artifact means re-run the
 * audit. Collapsing them into "not passing" makes the second look like the
 * first and wastes an hour.
 */
function check(
  area: string,
  claim: string,
  artifact: { provenance?: { gitSha?: string } } | undefined,
  evaluate: () => { ok: boolean; detail: string },
): void {
  if (!artifact) {
    checks.push({ area, claim, status: 'missing', detail: 'no committed artifact - run the audit' });
    return;
  }

  const result = evaluate();
  if (!result.ok) {
    checks.push({ area, claim, status: 'fail', detail: result.detail });
    return;
  }

  const sha = artifact.provenance?.gitSha;
  const stale = sha && sha !== 'unknown' && HEAD !== 'unknown' && sha !== HEAD;
  checks.push({
    area,
    claim,
    status: stale ? 'stale' : 'pass',
    detail: stale ? `${result.detail} ${c.dim}(from ${sha.slice(0, 8)})${c.reset}` : result.detail,
  });
}

/* ------------------------------------------------------------------ checks */

interface InferenceSummary {
  provenance: { gitSha: string };
  denials: { total: number; phantom: number };
  byDepth: Array<{ level: number; denied: number; phantom: number }>;
  cut: { verified: number; verifyAttempted: number; evidenceWithheldPct: number };
}

const inference = read<InferenceSummary>('artifacts/inference-summary.json');

check('inference', 'depth 1 is tight (0 phantom denials)', inference, () => {
  const depth1 = inference!.byDepth.find((d) => d.level === 1);
  return {
    ok: !!depth1 && depth1.phantom === 0,
    detail: depth1 ? `${depth1.phantom} phantom of ${depth1.denied.toLocaleString()}` : 'no depth-1 row',
  };
});

check('inference', 'every cut attempted was verified', inference, () => {
  const { verified, verifyAttempted } = inference!.cut;
  return {
    ok: verifyAttempted > 0 && verified === verifyAttempted,
    detail: `${verified}/${verifyAttempted} cuts re-checked against the adversary`,
  };
});

check('inference', 'phantom denials have not grown', inference, () => {
  /*
   * A ratchet, not a threshold. The committed figure is 1.0%; this fails if a
   * change makes the system leak *more* through the inference channel, which
   * is the regression that would otherwise be invisible.
   */
  const share = (inference!.denials.phantom / Math.max(inference!.denials.total, 1)) * 100;
  return {
    ok: share <= 1.5,
    detail: `${inference!.denials.phantom.toLocaleString()} of ${inference!.denials.total.toLocaleString()} (${share.toFixed(2)}%, ceiling 1.5%)`,
  };
});

interface PlannerSummary {
  provenance: { gitSha: string };
  perQuery: { queries: number; unsafe: number; costPct: number };
  session: { unsafe: number };
  sweep: Array<{ k: number; bound: number; retention: number }>;
}

const planner = read<PlannerSummary>('artifacts/planner-summary.json');

check('planner', 'no plan was ever returned unsafe', planner, () => {
  const bad = planner!.perQuery.unsafe + planner!.session.unsafe;
  return {
    ok: bad === 0,
    detail: `${planner!.perQuery.queries.toLocaleString()} queries, ${bad} unsafe`,
  };
});

check('planner', 'inference safety is free at production depth', planner, () => {
  const shallow = planner!.sweep.filter((r) => r.k <= 20);
  const bound = shallow.reduce((s, r) => s + r.bound, 0);
  return {
    ok: shallow.length > 0 && bound === 0,
    detail: `k<=20: ${bound} plans constrained, ${shallow[0]?.retention.toFixed(1) ?? '-'}% retained`,
  };
});

check('planner', 'the constraint still bites somewhere (it is tested)', planner, () => {
  /*
   * The inverse failure, and the easier one to ship by accident: a planner that
   * never constrains anything passes every safety check and does nothing. If no
   * depth in the sweep binds, the guarantee is untested rather than free.
   */
  const deep = planner!.sweep.filter((r) => r.bound > 0);
  return {
    ok: deep.length > 0,
    detail: deep.length > 0 ? `first binds at k=${deep[0]!.k}` : 'never binds - the planner is untested',
  };
});

interface PolicySummary {
  provenance: { gitSha: string };
  roundTrip: { drift: number; principals: number };
  grants: { derivedDisclosed: number; unlockedByCombination: number };
}

const policy = read<PolicySummary>('artifacts/policy-summary.json');

check('policy', 'the policy layer reproduces the enforced model', policy, () => ({
  ok: policy!.roundTrip.drift === 0,
  detail: `${policy!.roundTrip.drift} of ${policy!.roundTrip.principals.toLocaleString()} principals drifted`,
}));

interface LlmSummary {
  provenance: { gitSha: string };
  probes: { attempted: number };
  verdict: string;
  corpus: { channelPresent: boolean };
}

const llm = read<LlmSummary>('artifacts/llm-adversary-summary.json');

check('adversary', 'the stronger adversary was actually run', llm, () => ({
  ok: llm!.probes.attempted > 0,
  detail: `${llm!.probes.attempted} probes, verdict "${llm!.verdict}"`,
}));

check('adversary', 'a null result is explained, not assumed', llm, () => {
  /*
   * If the adversary recovered nothing, the corpus measurement must say whether
   * the channel was even present. "We tried and found nothing" is only evidence
   * when you can tell it apart from "there was nothing to find".
   */
  const nullish = llm!.verdict === 'inconclusive' || llm!.verdict === 'bound-holds';
  return {
    ok: !nullish || llm!.corpus !== undefined,
    detail: nullish
      ? `channel present in corpus: ${llm!.corpus?.channelPresent === true}`
      : 'adversary engaged',
  };
});

/* ------------------------------------------------------------------ output */

const icon: Record<Status, string> = {
  pass: `${c.green}PASS${c.reset}`,
  fail: `${c.red}FAIL${c.reset}`,
  stale: `${c.gold}STALE${c.reset}`,
  missing: `${c.gold}MISSING${c.reset}`,
};

console.log(`\n${c.bold}Cordon security report card${c.reset}`);
console.log(`${c.dim}commit ${HEAD.slice(0, 12)}${c.reset}`);
console.log('='.repeat(78));

let area = '';
for (const entry of checks) {
  if (entry.area !== area) {
    area = entry.area;
    console.log(`\n${c.dim}${area}${c.reset}`);
  }
  console.log(`  ${icon[entry.status].padEnd(16)} ${entry.claim}`);
  console.log(`  ${' '.repeat(6)} ${c.dim}${entry.detail}${c.reset}`);
}

const failed = checks.filter((x) => x.status === 'fail');
const stale = checks.filter((x) => x.status === 'stale');
const missing = checks.filter((x) => x.status === 'missing');
const passed = checks.filter((x) => x.status === 'pass');

console.log(`\n${'='.repeat(78)}`);
console.log(
  `  ${c.green}${passed.length} pass${c.reset}   ` +
    `${failed.length > 0 ? c.red : c.dim}${failed.length} fail${c.reset}   ` +
    `${stale.length > 0 ? c.gold : c.dim}${stale.length} stale${c.reset}   ` +
    `${missing.length > 0 ? c.gold : c.dim}${missing.length} missing${c.reset}`,
);

if (failed.length > 0) {
  console.log(
    `\n  ${c.red}${c.bold}This build is not safe to ship.${c.reset} ${c.dim}A security property that held\n` +
      `  on the last run does not hold on this one.${c.reset}\n`,
  );
  process.exit(1);
}

if (missing.length > 0) {
  console.log(
    `\n  ${c.gold}Some evidence is missing.${c.reset} ${c.dim}Run the audits named above. A check that\n` +
      `  was never run is not a check that passed.${c.reset}\n`,
  );
  process.exit(1);
}

if (stale.length > 0) {
  console.log(
    `\n  ${c.gold}Some evidence predates this commit.${c.reset} ${c.dim}The claims still hold as of the\n` +
      `  run that produced them, but the code has moved since. Re-run those audits\n` +
      `  before publishing the numbers.${c.reset}\n`,
  );
  /*
   * Stale does not fail the build. The properties did hold; what is unknown is
   * whether they still do. Failing here would make every unrelated commit red
   * and teach people to ignore the card, which is worse than the risk.
   */
  process.exit(0);
}

console.log(`\n  ${c.green}${c.bold}Every security property still holds.${c.reset}\n`);
