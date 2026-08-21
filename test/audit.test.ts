/**
 * The decision log: the two properties it is worth having.
 *
 *   1. Tampering is detectable.
 *   2. The log is not a second copy of what was withheld.
 *
 * Both are easy to claim and neither is self-evident, so both are attacked here
 * rather than asserted. The tamper tests specifically *edit the log the way an
 * insider would* - change a line, delete a line, reorder two - and require the
 * verifier to catch each one and point at where.
 *
 * A verifier that has never been shown a forged log has not been shown to work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, summarise } from '../src/cordon/audit.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cordon-audit-'));
}

function populate(log: AuditLog, n = 12): void {
  for (let i = 0; i < n; i++) {
    log.record({
      decision: i % 3 === 0 ? 'refuse' : i % 3 === 1 ? 'disclose' : 'suppress',
      principal: `p${i % 4}`,
      facts: [`f:${i}`, `f:${i + 100}`],
      required: ['spaceA', 'spaceB'],
      ...(i % 3 === 0 ? { missing: ['spaceB'] } : {}),
      detail: { latencyMs: i, endpoint: '/v1/plan' },
    });
  }
}

test('a clean chain verifies', () => {
  const log = new AuditLog();
  populate(log);
  const result = log.verify();
  assert.ok(result.ok, `clean log failed verification: ${result.reason}`);
  assert.equal(result.entries, 12);
});

test('editing an entry is detected, and located', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path });
    populate(log);
    assert.ok(log.verify().ok, 'log did not verify before tampering');

    /* Exactly what an insider does: change the record of one decision. */
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const target = JSON.parse(lines[5]!);
    target.decision = 'disclose';
    target.missing = [];
    lines[5] = JSON.stringify(target);
    writeFileSync(path, `${lines.join('\n')}\n`);

    const after = new AuditLog({ path }).verify();
    assert.equal(after.ok, false, 'a modified entry passed verification');
    assert.equal(after.brokenAt, 5, `expected the break at index 5, got ${after.brokenAt}`);
    assert.match(String(after.reason), /modified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting an entry is detected', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path });
    populate(log);

    /* Removing the line that records what you did is the whole threat. */
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    lines.splice(7, 1);
    writeFileSync(path, `${lines.join('\n')}\n`);

    const after = new AuditLog({ path }).verify();
    assert.equal(after.ok, false, 'a deletion passed verification');
    assert.equal(after.brokenAt, 7);
    assert.match(String(after.reason), /removed or reordered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reordering two entries is detected', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path });
    populate(log);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const a = lines[3]!;
    lines[3] = lines[4]!;
    lines[4] = a;
    writeFileSync(path, `${lines.join('\n')}\n`);

    const after = new AuditLog({ path }).verify();
    assert.equal(after.ok, false, 'a reordering passed verification');
    assert.equal(after.brokenAt, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a re-signed forgery is still detected, because the chain moves forward', () => {
  /*
   * The sophisticated attack: do not just edit a line, recompute its hash too.
   * That defeats a per-entry checksum. It does not defeat a chain, because
   * every later entry committed to the old hash.
   */
  const dir = scratch();
  try {
    const path = join(dir, 'audit.jsonl');
    const log = new AuditLog({ path });
    populate(log);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const forged = JSON.parse(lines[2]!);
    forged.decision = 'disclose';
    /* Recompute the entry's own hash the way the implementation would. */
    const body = { ...forged };
    delete body.hash;
    forged.hash = createHash('sha256')
      .update(
        JSON.stringify([
          body.seq,
          body.at,
          body.decision,
          body.principal,
          [...body.facts].sort(),
          body.required ? [...body.required].sort() : null,
          body.missing ? [...body.missing].sort() : null,
          body.wouldComplete ? [...body.wouldComplete].sort() : null,
          body.detail
            ? Object.keys(body.detail)
                .sort()
                .map((k: string) => [k, body.detail[k]])
            : null,
          body.prev,
        ]),
      )
      .digest('hex');
    lines[2] = JSON.stringify(forged);
    writeFileSync(path, `${lines.join('\n')}\n`);

    const after = new AuditLog({ path }).verify();
    assert.equal(after.ok, false, 'a re-signed forgery passed verification');
    /* The break shows up at the *next* entry, which still points at the old hash. */
    assert.equal(after.brokenAt, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the log refuses to store fact content', () => {
  /*
   * The property that stops the log becoming the leak. A refusal record that
   * carries the withheld text is a second copy of the secret in a file more
   * people can read than the fact itself.
   */
  const log = new AuditLog();
  for (const field of ['text', 'content', 'body', 'snippet', 'answer', 'summary']) {
    assert.throws(
      () => log.record({ decision: 'refuse', principal: 'p1', detail: { [field]: 'the secret' } }),
      /refusing to log field/,
      `the log accepted a "${field}" field`,
    );
  }

  /* Identity and requirement metadata are exactly what it should keep. */
  const entry = log.record({
    decision: 'refuse',
    principal: 'p1',
    facts: ['d:pair:A:B'],
    required: ['A', 'B', 'C'],
    missing: ['C'],
    detail: { latencyMs: 3, endpoint: '/v1/plan' },
  });
  assert.equal(entry.facts[0], 'd:pair:A:B');
  assert.ok(!JSON.stringify(entry).includes('the secret'));
});

test('a restart resumes the chain instead of starting a new one', () => {
  /*
   * A log that starts fresh on every boot has a gap exactly where a restart
   * happened, which is where an investigation would look first.
   */
  const dir = scratch();
  try {
    const path = join(dir, 'audit.jsonl');
    const first = new AuditLog({ path });
    populate(first, 5);
    const headBefore = first.head;
    const sizeBefore = first.size;

    const second = new AuditLog({ path });
    assert.equal(second.size, sizeBefore, 'sequence numbers restarted');
    assert.equal(second.head, headBefore, 'the chain head was not resumed');

    second.record({ decision: 'disclose', principal: 'p9', facts: ['f:1'] });
    const result = second.verify();
    assert.ok(result.ok, `chain broke across restart: ${result.reason}`);
    assert.equal(result.entries, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the summary counts without exposing anything', () => {
  const log = new AuditLog();
  populate(log, 30);
  const summary = summarise(log.tail(100));

  assert.equal(summary.total, 30);
  assert.ok(summary.byDecision.length >= 2);
  assert.ok(summary.busiest.length > 0);
  assert.ok(summary.busiest[0]!.count >= summary.busiest[summary.busiest.length - 1]!.count);
});
