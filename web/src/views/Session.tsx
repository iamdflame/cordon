/**
 * The disclosure ledger.
 *
 * Every other view in this console shows a decision about one answer. This one
 * shows the thing that makes those decisions hold up over time.
 *
 * Per-query inference safety does not compose. Ten individually safe answers
 * can jointly rebuild a claim the asker was refused - the aggregation attack,
 * moved from documents to sessions. A gate that only ever looks at the current
 * reply is safe against a reader and useless against an attacker, who will
 * simply ask twice.
 *
 * So Cordon accumulates what a principal has actually been shown and evaluates
 * the constraint over the accumulation. Confidentiality stops being a yes/no
 * and becomes a budget: answers keep coming until the asker's own history
 * starts to determine something they were refused, and then, precisely then,
 * withholding begins.
 *
 * The number that matters here is **determines** - claims reachable from this
 * principal's history. It is the honest measure of what a session has actually
 * given away, and it is the thing no document-level audit log can show you.
 */

import { useCallback, useEffect, useState } from 'react';
import { getSession, resetSession, type Principal, type SessionState } from '../api';

export default function SessionView({ asker }: { asker: Principal | null }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!asker) return;
    try {
      setState(await getSession(asker.id));
    } catch {
      setState(null);
    }
  }, [asker]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!asker) {
    return (
      <div className="centre">
        <div className="block" style={{ maxWidth: 460 }}>
          <div className="label">No asker selected</div>
          <p className="sub" style={{ fontSize: 12 }}>
            Pick someone in <strong>Ask</strong> first. A disclosure budget is a
            property of a person, not of the system.
          </p>
        </div>
      </div>
    );
  }

  const onReset = async () => {
    setBusy(true);
    try {
      await resetSession(asker.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const shown = state?.size ?? 0;
  const determines = state?.determines ?? 0;
  const queries = state?.queries ?? 0;

  return (
    <div className="view-scroll">
      <div className="block">
        <div className="label">Disclosure budget · {asker.name}</div>
        <p className="sub" style={{ fontSize: 12, marginBottom: 18, maxWidth: 640 }}>
          Per-query safety does not compose. Ten individually safe answers can
          jointly rebuild a refused claim — the aggregation attack, moved from
          documents to sessions. Cordon evaluates the constraint over everything{' '}
          {asker.name.split(' ')[0]} has been shown, not just the last reply.
        </p>

        <div className="stat-row">
          <Stat label="questions asked" value={queries.toLocaleString()} />
          <Stat label="facts disclosed" value={shown.toLocaleString()} />
          <Stat
            label="claims their history determines"
            value={determines.toLocaleString()}
            tone={determines > 0 ? 'warn' : 'ok'}
            hint="reachable without being told"
          />
        </div>
      </div>

      <div className="block">
        <div className="label">What this measures</div>
        <div className="ledger-explain">
          <div className="ledger-step">
            <span className="ledger-dot" />
            <div>
              <strong>Disclosed</strong> — facts handed over, cumulatively. Append
              only: a disclosure cannot be taken back, so the safe accounting is
              one that never forgets.
            </div>
          </div>
          <div className="ledger-step">
            <span className="ledger-dot is-warn" />
            <div>
              <strong>Determines</strong> — claims reachable by running Cordon's
              own published derivation rules over that history. This is what the
              session has <em>actually</em> given away, which is not the same as
              what it displayed.
            </div>
          </div>
          <div className="ledger-step">
            <span className="ledger-dot is-deny" />
            <div>
              <strong>The budget binds</strong> when a candidate answer would push
              a <em>refused</em> claim into that reachable set. At that point the
              fact is withheld even though {asker.name.split(' ')[0]} is entitled
              to it — the price, and the only defence that actually works.
            </div>
          </div>
        </div>
      </div>

      <div className="block">
        <div className="label">Operator action</div>
        <p className="sub" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Resetting returns the budget to full. In a deployment this is a logged,
          privileged action — a ledger an asker can clear themselves is not a
          control, and one that resets when the process restarts is a bug. This
          console holds ledgers in memory, which is right for a demo and wrong
          for production; that is stated rather than hidden.
        </p>
        <button className="btn" onClick={onReset} disabled={busy || shown === 0}>
          {busy ? 'Resetting…' : `Reset budget (${shown} facts)`}
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className={`stat-value${tone === 'warn' ? ' is-warn' : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
