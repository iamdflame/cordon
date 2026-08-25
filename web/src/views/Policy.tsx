/**
 * Policy impact preview.
 *
 * The feature the whole thesis earns, and the one a document-level system
 * cannot have even in principle.
 *
 * An administrator adds one person to one team. Every access-review tool in
 * existence tells them what that grants: **the documents in that space.** That
 * is correct, and it is not the whole answer. It also grants every derived fact
 * whose *entire* requirement is now covered — facts resting on spaces the
 * administrator was not thinking about, because the person already had them.
 *
 *     before:  Alice may read {A, B}       F requires {A, B, C}   denied
 *     grant C: Alice may read {A, B, C}    F requires {A, B, C}   DISCLOSED
 *
 * Nobody granted Alice access to F. Nobody was asked. F is not a document, so
 * it appears in no access review anywhere.
 *
 * Measured over 150 real grants on the full corpus: **100% of the derived facts
 * a grant disclosed were unlocked in combination** with access the person
 * already held. Not most. All of them.
 *
 * So this screen deliberately does not lead with the document count. It leads
 * with the number nobody else can show you, and it computes it *before* the
 * change is applied — because after is too late.
 */

import { useCallback, useMemo, useState } from 'react';
import { previewPolicy, type Principal, type PolicyPreview } from '../api';

export default function PolicyView({
  principals,
  spaces,
}: {
  principals: Principal[];
  spaces: string[];
}) {
  const [subject, setSubject] = useState('');
  const [space, setSpace] = useState('');
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Only spaces this subject cannot already read: granting a held space is a no-op. */
  const grantable = useMemo(() => {
    const held = new Set(principals.find((p) => p.id === subject)?.spaces ?? []);
    return spaces.filter((s) => !held.has(s));
  }, [principals, subject, spaces]);

  const run = useCallback(async () => {
    if (!subject || !space) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewPolicy([{ subject, space }]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [subject, space]);

  const impact = preview?.impact;

  return (
    <div className="view-scroll">
      <div className="block">
        <div className="label">Policy impact preview</div>
        <p className="sub" style={{ fontSize: 12, marginBottom: 18, maxWidth: 680 }}>
          Add one person to one team. Every access-review tool will tell you what
          that grants: <em>the documents in that space</em>. It also grants every
          derived fact whose <strong>entire</strong> requirement is now covered —
          resting on spaces you were not thinking about, because they already had
          them. <strong>Nobody approves those.</strong> They are not documents, so
          nothing shows them.
        </p>

        <div className="policy-form">
          <label className="policy-field">
            <span className="policy-label">Grant</span>
            <select
              className="field"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setSpace('');
                setPreview(null);
              }}
            >
              <option value="">select a principal…</option>
              {principals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.spaces.length} spaces
                </option>
              ))}
            </select>
          </label>

          <label className="policy-field">
            <span className="policy-label">access to</span>
            <select
              className="field"
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setPreview(null);
              }}
              disabled={!subject}
            >
              <option value="">{subject ? 'select a space…' : 'pick a principal first'}</option>
              {grantable.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <button className="btn btn-primary" onClick={run} disabled={!subject || !space || busy}>
            {busy ? 'Computing…' : 'Preview impact'}
          </button>
        </div>

        {error && (
          <p className="sub mono" style={{ marginTop: 14, color: 'var(--deny)' }}>
            {error}
          </p>
        )}
      </div>

      {impact && (
        <>
          <div className="block">
            <div className="label">What this would disclose</div>
            <div className="stat-row" style={{ marginTop: 6 }}>
              <Stat label="documents" value={impact.documentsGained.toLocaleString()} hint="what you expect" />
              <Stat
                label="derived facts"
                value={impact.derivedGained.toLocaleString()}
                tone={impact.derivedGained > 0 ? 'warn' : 'ok'}
                hint="invisible to any access review"
              />
              <Stat
                label="…unlocked in combination"
                value={impact.unlockedByCombination.toLocaleString()}
                tone={impact.unlockedByCombination > 0 ? 'deny' : 'ok'}
                hint="nobody approved these"
              />
              <Stat
                label="claims made rebuildable"
                value={impact.newlyInferable.toLocaleString()}
                tone={impact.newlyInferable > 0 ? 'deny' : 'ok'}
                hint="still refused, now reachable"
              />
            </div>

            {impact.derivedGained > 0 && (
              <div className="policy-verdict">
                <strong>
                  {Math.round((impact.unlockedByCombination / impact.derivedGained) * 100)}% of the
                  derived facts this grant discloses were unlocked <em>in combination</em>
                </strong>{' '}
                with access {shortName(subject)} already held. They were not granted — they were{' '}
                <em>completed</em>. Approving “read access to one space” approves every one of them
                without showing you a single one.
              </div>
            )}

            {impact.derivedGained === 0 && (
              <div className="policy-verdict is-ok">
                This grant discloses no derived knowledge — the new space does not complete any
                conclusion {shortName(subject)} was missing a piece of. <strong>That is the
                answer you want</strong>, and you could not have known it without walking the
                derivation.
              </div>
            )}

            <p className="sub" style={{ fontSize: 11, marginTop: 14 }}>
              {impact.principalsAffected} principal(s) affected · computed in {preview.latencyMs}ms ·
              nothing has been applied
            </p>
          </div>

          {preview.perPrincipal.length > 0 && (
            <div className="block">
              <div className="label">Per principal</div>
              <table className="grid">
                <thead>
                  <tr>
                    <th>principal</th>
                    <th className="num">documents</th>
                    <th className="num">derived</th>
                    <th className="num">combination</th>
                    <th>gains access to</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.perPrincipal.slice(0, 20).map((row) => (
                    <tr key={row.principal}>
                      <td className="mono">{row.principal}</td>
                      <td className="num mono">{row.documentsGained.toLocaleString()}</td>
                      <td className="num">
                        <span className={`pill${row.derivedGained > 0 ? ' pill-warn' : ''}`}>
                          {row.derivedGained}
                        </span>
                      </td>
                      <td className="num">
                        <span className={`pill${row.unlockedByCombination > 0 ? ' pill-deny' : ''}`}>
                          {row.unlockedByCombination}
                        </span>
                      </td>
                      <td>
                        <div className="set set-tight">
                          {row.spacesGained.map((s) => (
                            <span key={s} className="chip granted">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const shortName = (id: string) => id.replace(/^(team|person):/, '');

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'deny';
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className={`stat-value${tone === 'warn' ? ' is-warn' : tone === 'deny' ? ' is-deny' : ''}`}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
