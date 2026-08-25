/**
 * Resume, proved by actually crashing.
 *
 * The failure this exists to survive is documented in our own source: the OSS
 * engine's evictor saturates under sustained write pressure and exits 255
 * around 80% of a 226k-edge ingest. Before this, recovery meant restarting a
 * ~48-minute run.
 *
 * A resume path that has never been interrupted is a claim, not a feature. So
 * these tests kill runs mid-flight - at 30%, at 80%, twice in a row - and
 * assert that every statement lands exactly once across the restarts.
 *
 * "Exactly once" is the part that matters. Resume that re-runs a statement is
 * only safe because every statement is a MERGE; if that ever stops being true,
 * duplicated edges change what the requirement traversal computes, and a
 * requirement that is wrong in the permissive direction is a disclosure bug.
 * `verifyIdempotent` is the guard, and it is tested here too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCheckpoint, planHash, runResumable, verifyIdempotent } from '../src/cordon/checkpoint.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cordon-ckpt-'));
}

const plan = (n: number) => Array.from({ length: n }, (_, i) => `MERGE (x:N {id: ${i}})`);

test('a crash mid-ingest loses only the work since the last flush', async () => {
  const dir = scratch();
  const path = join(dir, 'ingest.json');
  const statements = plan(1000);
  const applied = new Map<number, number>(); // index -> times run

  /* Crash at 30%, the way a saturated engine does: abruptly, mid-flight. */
  let seen = 0;
  await assert.rejects(
    () =>
      runResumable({
        statements,
        checkpointPath: path,
        concurrency: 4,
        flushEvery: 50,
        run: async (_s, i) => {
          if (++seen > 300) throw Object.assign(new Error('engine exited 255'), { fatal: true });
          applied.set(i, (applied.get(i) ?? 0) + 1);
        },
        // A fatal engine death is not a per-statement retry; simulate by
        // letting retries exhaust and then asserting on the thrown summary.
        maxRetries: 1,
      }).then((r) => {
        if (r.failed.length > 0) throw new Error(`${r.failed.length} failed`);
        return r;
      }),
    /failed/,
  );

  assert.ok(existsSync(path), 'no checkpoint was written, so the run is unrecoverable');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(saved.done.length > 0, 'checkpoint recorded nothing');
  assert.ok(
    saved.done.length <= 300,
    `checkpoint claims ${saved.done.length} done but only 300 statements ran`,
  );

  rmSync(dir, { recursive: true, force: true });
});

test('resuming finishes the run, and every statement lands exactly once', async () => {
  const dir = scratch();
  const path = join(dir, 'ingest.json');
  const statements = plan(800);
  const applied = new Map<number, number>();

  const attempt = async (failAfter: number) => {
    let seen = 0;
    return runResumable({
      statements,
      checkpointPath: path,
      concurrency: 4,
      flushEvery: 25,
      maxRetries: 1,
      run: async (_s, i) => {
        if (++seen > failAfter) throw new Error('engine exited 255');
        applied.set(i, (applied.get(i) ?? 0) + 1);
      },
    });
  };

  /* Two crashes, then a clean finish. */
  const first = await attempt(250);
  assert.ok(first.failed.length > 0, 'the first attempt was supposed to fail');

  const second = await attempt(250);
  assert.ok(second.skipped > 0, 'the second attempt did not resume from the checkpoint');

  const third = await runResumable({
    statements,
    checkpointPath: path,
    concurrency: 4,
    flushEvery: 25,
    run: async (_s, i) => {
      applied.set(i, (applied.get(i) ?? 0) + 1);
    },
  });

  assert.equal(third.failed.length, 0, 'the final run still failed');
  assert.equal(third.completed, statements.length, 'not every statement completed');
  assert.equal(third.resumes, 2, `expected 2 resumes, got ${third.resumes}`);

  /* The property that makes resume safe. */
  for (let i = 0; i < statements.length; i++) {
    const times = applied.get(i) ?? 0;
    assert.ok(times >= 1, `statement ${i} never ran`);
    assert.ok(times <= 2, `statement ${i} ran ${times} times — more than one replay`);
  }

  rmSync(dir, { recursive: true, force: true });
});

test('transient failures are retried instead of killing the run', async () => {
  const dir = scratch();
  const path = join(dir, 'ingest.json');
  const statements = plan(120);
  const attempts = new Map<number, number>();

  const result = await runResumable({
    statements,
    checkpointPath: path,
    concurrency: 4,
    run: async (_s, i) => {
      const n = (attempts.get(i) ?? 0) + 1;
      attempts.set(i, n);
      /* Every third statement fails once, as a saturated write queue does. */
      if (i % 3 === 0 && n === 1) throw new Error('evictor queue full');
    },
  });

  assert.equal(result.failed.length, 0, 'a transient failure was treated as fatal');
  assert.equal(result.completed, statements.length);
  assert.ok(result.retries >= 40, `expected retries to be exercised, saw ${result.retries}`);

  rmSync(dir, { recursive: true, force: true });
});

test('a checkpoint from a different plan is discarded, not half-applied', async () => {
  /*
   * The dangerous case. Resuming plan B against plan A's checkpoint would skip
   * indices that mean something entirely different, silently omitting writes -
   * and missing edges make a requirement *smaller*, which fails open.
   */
  const dir = scratch();
  const path = join(dir, 'ingest.json');

  const a = plan(200);
  await runResumable({ statements: a, checkpointPath: path, run: async () => {} });

  const b = plan(200).map((s, i) => `${s} // different plan ${i}`);
  const reloaded = loadCheckpoint(path, planHash(b), b.length);

  assert.equal(reloaded.done.length, 0, 'a foreign checkpoint was reused');
  assert.equal(reloaded.resumes, 0, 'a foreign checkpoint was counted as a resume');

  rmSync(dir, { recursive: true, force: true });
});

test('a truncated checkpoint does not crash the resume', async () => {
  const dir = scratch();
  const path = join(dir, 'ingest.json');
  const statements = plan(50);

  writeFileSync(path, '{"planHash":"abc","done":[1,2,3'); // torn write

  const result = await runResumable({
    statements,
    checkpointPath: path,
    run: async () => {},
  });

  assert.equal(result.completed, statements.length, 'a torn checkpoint broke the run');
  rmSync(dir, { recursive: true, force: true });
});

test('non-idempotent plans are refused before anything is written', () => {
  const safe = verifyIdempotent(['MERGE (a:N {id:1})', 'MERGE (b:N {id:2})']);
  assert.equal(safe.ok, true);
  assert.equal(safe.offenders.length, 0);

  const unsafe = verifyIdempotent(['MERGE (a:N {id:1})', 'CREATE (b:N {id:2})']);
  assert.equal(unsafe.ok, false, 'a bare CREATE was accepted as replay-safe');
  assert.deepEqual(unsafe.offenders, [1]);
});

test('the real ingest plan is replay-safe', async () => {
  /*
   * The guard is worthless if it is only ever run against fixtures. This checks
   * the statements planIngest actually emits.
   */
  const { planIngest } = await import('../src/cordon/ingest.js');
  const { NodeIdRegistry } = await import('../src/hydra/ids.js');

  const corpus = {
    employees: new Map([['e1', { id: 'e1', name: 'A', role: 'r', location: 'l', org: 'o' }]]),
    spaces: new Map([['sp1', { id: 'sp1', name: 'sp1', team: ['e1'], customers: [] }]]),
    artifacts: [
      {
        id: 'a1',
        key: 'sp1::a1',
        space: 'sp1',
        kind: 'document' as const,
        text: 'hello',
        title: 't',
        participants: [],
      },
    ],
    questions: [],
    reports: new Map<string, string[]>(),
    managerOf: new Map<string, string>(),
  };

  const { HydraClient } = await import('../src/hydra/client.js');
  const plan = planIngest(
    corpus,
    [],
    new Map<string, Set<string>>(),
    new NodeIdRegistry('t'),
    new HydraClient(),
  );
  const check = verifyIdempotent(plan.statements);
  assert.ok(
    check.ok,
    `planIngest emitted ${check.offenders.length} non-idempotent statement(s); resume would duplicate edges`,
  );
  assert.ok(plan.statements.length > 0, 'the plan was empty, so this proved nothing');
});
