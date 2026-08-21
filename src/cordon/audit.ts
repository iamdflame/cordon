/**
 * The decision log.
 *
 * Everything else in Cordon decides what to disclose. This records that it did,
 * in a form that survives someone wanting it to say something else.
 *
 * Two design constraints, and both of them are the interesting part.
 *
 * ## 1. The log must not become the leak
 *
 * The obvious audit record for a refusal is *"withheld fact F from Alice"*, with
 * F's text alongside so a reviewer can see what was protected. That record is a
 * **second copy of the secret**, sitting in a log file that is almost always
 * readable by more people than the fact was.
 *
 * A system that refuses to tell Alice something and then writes it into a log
 * her whole platform team can read has not protected anything. It has moved the
 * disclosure somewhere nobody is looking.
 *
 * So this log records **identifiers and requirement metadata, never content**.
 * You can prove what was decided, when, for whom, and on what grounds. You
 * cannot read the withheld fact out of the log, because it is not in there.
 * `assertNoContent` enforces that at write time rather than trusting callers.
 *
 * ## 2. A log you cannot verify is a log the attacker can edit
 *
 * An append-only file is append-only until someone opens it in an editor. The
 * threat is not an outsider - it is an insider deleting the line that records
 * what they did, which is exactly the line an investigation needs.
 *
 * So entries are **hash-chained**: each carries a SHA-256 over its own contents
 * and the previous entry's hash. Changing any historical entry, or removing one,
 * breaks every hash after it, and `verify` reports the first index where the
 * chain fails. That does not make the log immutable - nothing in a single
 * process can - but it makes tampering *detectable*, which is the property an
 * auditor actually needs.
 *
 * This is the same discipline as the rest of the repository: not "trust that it
 * was not edited", but "here is the check that would catch it".
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What kind of decision produced this entry. */
export type Decision =
  | 'disclose'
  | 'refuse'
  /** Admissible, and withheld anyway because the *set* would have leaked. */
  | 'suppress'
  | 'policy-preview'
  | 'session-reset';

export interface AuditEntry {
  /** Monotonic index, from 0. */
  seq: number;
  at: string;
  decision: Decision;
  principal: string;
  /** Fact ids only. Never text - see the note above. */
  facts: string[];
  /** Spaces the fact required, by traversal. Metadata, not content. */
  required?: string[];
  /** Required spaces the principal lacked. Empty on a disclosure. */
  missing?: string[];
  /** For a suppression: the protected claim its inclusion would have completed. */
  wouldComplete?: string[];
  /** Free-form, still content-free: latency, counts, endpoint. */
  detail?: Record<string, string | number | boolean>;
  /** sha256 over this entry and the previous hash. */
  hash: string;
  prev: string;
}

/** Genesis. A chain has to start somewhere, and it should be stated. */
const GENESIS = '0'.repeat(64);

/**
 * Fields whose names suggest they carry a fact's text rather than its identity.
 *
 * Deliberately a denylist on *names*: the failure this catches is a developer
 * adding `text` to a detail object in six months because it would be convenient
 * for debugging. That is exactly how audit logs become the thing they were
 * meant to protect against, and it never looks like a mistake at the time.
 */
const CONTENT_FIELDS = /^(text|content|body|snippet|excerpt|answer|value|summary)$/i;

function assertNoContent(detail: Record<string, unknown> | undefined): void {
  if (!detail) return;
  for (const key of Object.keys(detail)) {
    if (CONTENT_FIELDS.test(key)) {
      throw new Error(
        `audit: refusing to log field "${key}" - the log records identifiers, ` +
          'not content, so that it cannot become a second copy of what was withheld',
      );
    }
  }
}

/** Stable serialisation: a hash over object order is not a hash over content. */
function canonical(entry: Omit<AuditEntry, 'hash'>): string {
  return JSON.stringify([
    entry.seq,
    entry.at,
    entry.decision,
    entry.principal,
    [...entry.facts].sort(),
    entry.required ? [...entry.required].sort() : null,
    entry.missing ? [...entry.missing].sort() : null,
    entry.wouldComplete ? [...entry.wouldComplete].sort() : null,
    entry.detail ? Object.keys(entry.detail).sort().map((k) => [k, entry.detail![k]]) : null,
    entry.prev,
  ]);
}

function hashOf(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(entry)).digest('hex');
}

export interface VerifyResult {
  ok: boolean;
  entries: number;
  /** Index of the first entry whose hash does not check out. */
  brokenAt?: number;
  reason?: string;
}

export interface AuditLogOptions {
  /** Append each entry as JSONL. Omitted for tests and the demo console. */
  path?: string;
  /** Cap the in-memory tail. The file, when configured, keeps everything. */
  memory?: number;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly path: string | undefined;
  private readonly memory: number;
  private last = GENESIS;
  private count = 0;

  constructor(options: AuditLogOptions = {}) {
    this.path = options.path;
    this.memory = options.memory ?? 5000;
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      /* Resume the chain rather than restarting it: a log that starts fresh on
         every boot is a log with a gap exactly where a restart happened. */
      if (existsSync(this.path)) {
        const existing = this.readAll();
        const tail = existing[existing.length - 1];
        if (tail) {
          this.last = tail.hash;
          this.count = tail.seq + 1;
        }
      }
    }
  }

  record(input: {
    decision: Decision;
    principal: string;
    facts?: string[];
    required?: string[];
    missing?: string[];
    wouldComplete?: string[];
    detail?: Record<string, string | number | boolean>;
  }): AuditEntry {
    assertNoContent(input.detail);

    const body: Omit<AuditEntry, 'hash'> = {
      seq: this.count++,
      at: new Date().toISOString(),
      decision: input.decision,
      principal: input.principal,
      facts: input.facts ?? [],
      ...(input.required ? { required: input.required } : {}),
      ...(input.missing ? { missing: input.missing } : {}),
      ...(input.wouldComplete ? { wouldComplete: input.wouldComplete } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      prev: this.last,
    };

    const entry: AuditEntry = { ...body, hash: hashOf(body) };
    this.last = entry.hash;

    this.entries.push(entry);
    if (this.entries.length > this.memory) this.entries.shift();
    if (this.path) appendFileSync(this.path, `${JSON.stringify(entry)}\n`);

    return entry;
  }

  /** The in-memory tail, newest last. */
  tail(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit);
  }

  get size(): number {
    return this.count;
  }

  get head(): string {
    return this.last;
  }

  private readAll(): AuditEntry[] {
    if (!this.path || !existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /**
   * Recompute the whole chain and report the first break.
   *
   * Checked against a recomputation from the entry contents, not against a
   * stored checksum - a chain that validates itself against a field it also
   * wrote is the tautology this repository keeps finding in its own work.
   */
  verify(): VerifyResult {
    const all = this.path ? this.readAll() : this.entries;
    let prev = GENESIS;

    for (const [i, entry] of all.entries()) {
      if (entry.prev !== prev) {
        return {
          ok: false,
          entries: all.length,
          brokenAt: i,
          reason: `entry ${entry.seq} does not follow the previous hash - an entry was removed or reordered`,
        };
      }
      const { hash, ...body } = entry;
      if (hashOf(body) !== hash) {
        return {
          ok: false,
          entries: all.length,
          brokenAt: i,
          reason: `entry ${entry.seq} has been modified since it was written`,
        };
      }
      prev = hash;
    }

    return { ok: true, entries: all.length };
  }
}

/** Summary counts for an operator view. Content-free by construction. */
export function summarise(entries: readonly AuditEntry[]) {
  const byDecision = new Map<Decision, number>();
  const byPrincipal = new Map<string, number>();
  for (const entry of entries) {
    byDecision.set(entry.decision, (byDecision.get(entry.decision) ?? 0) + 1);
    byPrincipal.set(entry.principal, (byPrincipal.get(entry.principal) ?? 0) + 1);
  }
  return {
    total: entries.length,
    byDecision: [...byDecision].map(([decision, count]) => ({ decision, count })),
    busiest: [...byPrincipal]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([principal, count]) => ({ principal, count })),
  };
}
