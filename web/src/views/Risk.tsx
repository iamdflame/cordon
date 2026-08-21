/**
 * The risk surface.
 *
 * The Ask view answers "did this question leak", which is the question a demo
 * asks. An operator has a different one: *where is this organisation exposed?*
 *
 * Derived facts are the entire surface. A level-0 fact is governed correctly by
 * any document ACL that already exists - it is a document, it has an owner, the
 * incumbent handles it. Everything on this page is knowledge that no document
 * contains and no document ACL can describe, ranked by how few people in the
 * organisation may see it.
 *
 * The top of that list is the most tightly-held knowledge in the company. It is
 * also, precisely, what an assistant with no derivation-aware gate would have
 * been handing to everyone.
 */

import { useEffect, useState } from 'react';
import { getRisk, type Risk } from '../api';

export default function RiskView() {
  const [risk, setRisk] = useState<Risk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRisk()
      .then(setRisk)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="centre">
        <div className="block">
          <div className="label">Risk surface unavailable</div>
          <p className="sub mono">{error}</p>
        </div>
      </div>
    );
  }

  if (!risk) {
    return (
      <div className="centre">
        <div className="spinner" />
        <div className="eyebrow" style={{ marginTop: 14 }}>
          Computing the exposure map
        </div>
      </div>
    );
  }

  return (
    <div className="view-scroll">
      <div className="block">
        <div className="label">Exposure</div>
        <p className="sub" style={{ fontSize: 12, marginBottom: 16, maxWidth: 620 }}>
          Every row below is knowledge <em>no document contains</em>. Document-level
          ACLs cannot describe these, because they are not documents — which is
          why an ungated assistant serves them to everyone.
        </p>

        <div className="stat-row">
          <Stat label="derived facts" value={risk.derivedFacts.toLocaleString()} />
          <Stat label="principals" value={risk.principals.toLocaleString()} />
          <Stat label="spaces" value={risk.spaces.toLocaleString()} />
          <Stat
            label="visible to nobody"
            value={risk.invisible.toLocaleString()}
            tone={risk.invisible > 0 ? 'warn' : 'ok'}
            hint="derived past the point of usefulness"
          />
        </div>
      </div>

      <div className="block">
        <div className="label">Audience by derivation depth</div>
        <p className="sub" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Requirement is the union of everything underneath, so audience is the{' '}
          <em>intersection</em> of the teams involved. Deeper knowledge is held by
          fewer people — automatically, without anyone classifying it.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th>depth</th>
              <th className="num">facts</th>
              <th className="num">mean audience</th>
              <th>reach</th>
            </tr>
          </thead>
          <tbody>
            {risk.byLevel.map((row) => {
              const share = (row.meanAudience / Math.max(risk.principals, 1)) * 100;
              return (
                <tr key={row.level}>
                  <td className="mono">{row.level}</td>
                  <td className="num mono">{row.facts.toLocaleString()}</td>
                  <td className="num mono">{row.meanAudience.toFixed(1)}</td>
                  <td>
                    <div className="meter">
                      <span style={{ width: `${Math.max(share, 0.6)}%` }} />
                    </div>
                    <span className="meter-label mono">{share.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="block">
        <div className="label">Most tightly held</div>
        <p className="sub" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Ranked by how few people may read them. This is the knowledge an
          ungated graph leaks most damagingly.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th className="num">audience</th>
              <th className="num">depth</th>
              <th>requires</th>
              <th>claim</th>
            </tr>
          </thead>
          <tbody>
            {risk.riskiest.map((fact) => (
              <tr key={fact.id}>
                <td className="num">
                  <span className={`pill${fact.audience === 0 ? ' pill-deny' : ''}`}>
                    {fact.audience}
                  </span>
                </td>
                <td className="num mono">{fact.level}</td>
                <td>
                  <div className="set set-tight">
                    {fact.requires.slice(0, 5).map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                    {fact.requires.length > 5 && (
                      <span className="chip chip-more">+{fact.requires.length - 5}</span>
                    )}
                  </div>
                </td>
                <td className="cell-text">{fact.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
