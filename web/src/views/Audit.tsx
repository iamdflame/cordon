/**
 * The decision log.
 *
 * Every other view shows what Cordon decided. This shows that it can prove what
 * it decided, later, to someone who was not there.
 *
 * ## The log must not become the leak
 *
 * The obvious way to build this is to record the fact that was withheld,
 * including its text, so an investigator can see what nearly escaped. That
 * produces a file containing every restricted conclusion in the organisation,
 * usually readable by more people than the facts themselves — a second copy of
 * the secret, in a less guarded place, created by the security feature.
 *
 * So the log stores **identifiers and requirement metadata only**, and the
 * writer refuses fact text at write time rather than trusting callers to omit
 * it. What you see below is deliberately unreadable as content and completely
 * sufficient as evidence: who asked, what was decided, which spaces were
 * required, which were missing.
 *
 * ## Why the chain matters
 *
 * An audit log that can be edited after the fact proves nothing. Each entry
 * carries a hash over its own contents and the previous entry's hash, so
 * altering or deleting anything in the middle breaks every hash after it.
 * `/api/audit/verify` walks the whole chain and reports the first index that
 * fails — and this view puts that verdict at the top, because a log whose
 * integrity is never checked is decoration.
 */

import { useCallback, useEffect, useState } from 'react';

interface AuditEntry {
  seq: number;
  at: string;
  decision: 'disclose' | 'refuse' | 'suppress' | 'policy-preview' | 'session-reset';
  principal: string;
  facts: string[];
  required?: string[];
  missing?: string[];
  wouldComplete?: string[];
  detail?: Record<string, string | number | boolean>;
}

interface AuditResponse {
  total: number;
  head: string;
  summary: {
    total: number;
    byDecision: Array<{ decision: string; count: number }>;
    busiest: Array<{ principal: string; count: number }>;
  };
  entries: AuditEntry[];
}

interface VerifyResponse {
  ok: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
  means?: string;
}

const DECISION_TONE: Record<string, string> = {
  disclose: 'ok',
  refuse: 'deny',
  suppress: 'warn',
  'policy-preview': 'neutral',
  'session-reset': 'warn',
};

export default function AuditView() {
  const [log, setLog] = useState<AuditResponse | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, v] = await Promise.all([
        fetch('/api/audit?limit=200').then((r) => r.json() as Promise<AuditResponse>),
        fetch('/api/audit/verify').then((r) => r.json() as Promise<VerifyResponse>),
      ]);
      setLog(l);
      setVerify(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <div className="centre">
        <div className="block">
          <div className="label">Audit log unavailable</div>
          <p className="sub mono">{error}</p>
        </div>
      </div>
    );
  }

  if (!log) {
    return (
      <div className="centre">
        <div className="spinner" />
        <div className="eyebrow" style={{ marginTop: 14 }}>
          Reading the decision log
        </div>
      </div>
    );
  }

  const shown =
    filter === 'all' ? log.entries : log.entries.filter((e) => e.decision === filter);

  return (
    <div className="view-scroll">
      <div className="block">
        <div className="label">Chain integrity</div>
        {verify && (
          <div className={`chain-verdict${verify.ok ? ' is-ok' : ' is-broken'}`}>
            <div className="chain-mark">{verify.ok ? '✓' : '✗'}</div>
            <div>
              <strong>
                {verify.ok
                  ? `${verify.entries.toLocaleString()} entries, chain intact`
                  : `Chain broken at entry ${verify.brokenAt}`}
              </strong>
              <div className="chain-note">
                {verify.ok
                  ? 'Each entry hashes its own contents and the previous entry’s hash, so altering or deleting anything in the middle breaks every hash after it. This was just re-walked, end to end.'
                  : (verify.reason ?? 'An entry does not match its recorded hash.')}
              </div>
              <div className="chain-head mono">head {log.head.slice(0, 32)}…</div>
            </div>
          </div>
        )}
      </div>

      <div className="block">
        <div className="label">Decisions</div>
        <p className="sub" style={{ fontSize: 11.5, marginBottom: 14, maxWidth: 66 + 'ch' }}>
          Identifiers and requirement metadata only — <strong>never fact text</strong>. The writer
          refuses content at write time rather than trusting callers to omit it, because a log of
          withheld conclusions is a second copy of the secret in a less guarded place.
        </p>

        <div className="stat-row" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="stat-value">{log.total.toLocaleString()}</div>
            <div className="stat-label">decisions recorded</div>
          </div>
          {log.summary.byDecision.map((d) => (
            <div className="stat" key={d.decision}>
              <div
                className={`stat-value${
                  DECISION_TONE[d.decision] === 'deny'
                    ? ' is-deny'
                    : DECISION_TONE[d.decision] === 'warn'
                      ? ' is-warn'
                      : ''
                }`}
              >
                {d.count.toLocaleString()}
              </div>
              <div className="stat-label">{d.decision}</div>
            </div>
          ))}
        </div>

        <div className="filters" role="group" aria-label="Filter decisions">
          {['all', 'disclose', 'refuse', 'suppress'].map((f) => (
            <button
              key={f}
              className={`filter${filter === f ? ' is-active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="sub" style={{ fontSize: 12, marginTop: 14 }}>
            Nothing recorded yet. Ask a question in <strong>Ask</strong> and it will appear here.
          </p>
        ) : (
          <table className="grid" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>decision</th>
                <th>principal</th>
                <th>facts</th>
                <th>required / missing</th>
              </tr>
            </thead>
            <tbody>
              {shown
                .slice()
                .reverse()
                .map((e) => (
                  <tr key={e.seq}>
                    <td className="num mono">{e.seq}</td>
                    <td>
                      <span className={`tag tag-${DECISION_TONE[e.decision] ?? 'neutral'}`}>
                        {e.decision}
                      </span>
                    </td>
                    <td className="mono">{e.principal}</td>
                    <td className="mono cell-ids">
                      {e.facts.length === 0
                        ? '—'
                        : e.facts.length === 1
                          ? e.facts[0]
                          : `${e.facts[0]} +${e.facts.length - 1}`}
                    </td>
                    <td>
                      <div className="set set-tight">
                        {(e.required ?? []).map((s) => (
                          <span
                            key={s}
                            className={`chip${(e.missing ?? []).includes(s) ? '' : ' granted'}`}
                          >
                            {s}
                          </span>
                        ))}
                        {(e.wouldComplete ?? []).map((k) => (
                          <span key={k} className="chip chip-more">
                            would complete {k}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
