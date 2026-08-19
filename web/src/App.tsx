import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ask,
  getDerivation,
  getHealth,
  getOverview,
  getPrincipals,
  getQuestions,
  type AskResult,
  type Derivation,
  type Overview,
  type Principal,
  type SampleQuestion,
} from './api';

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [questions, setQuestions] = useState<SampleQuestion[]>([]);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const [asker, setAsker] = useState<Principal | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [derivation, setDerivation] = useState<Derivation | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const health = await getHealth();
        if (health.error) {
          setBootError(health.error);
          setBooting(false);
          return;
        }
        if (health.building) {
          setTimeout(poll, 1400);
          return;
        }
        const [o, p, q] = await Promise.all([getOverview(), getPrincipals(), getQuestions()]);
        if (cancelled) return;
        setOverview(o);
        setPrincipals(p);
        setQuestions(q);
        // Start on someone with narrow access: the interesting case.
        setAsker(p.find((x) => x.spaces.length === 1) ?? p[0] ?? null);
        setBooting(false);
      } catch {
        if (!cancelled) setTimeout(poll, 1800);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const runAsk = useCallback(
    async (principal: Principal, question: string) => {
      if (!question.trim()) return;
      setAsking(true);
      setSelected(null);
      setDerivation(null);
      try {
        setResult(await ask(principal.id, question));
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
      } finally {
        setAsking(false);
      }
    },
    [],
  );

  /** Re-ask the current question as a different person: the whole demo. */
  const switchAsker = useCallback(
    (principal: Principal) => {
      setAsker(principal);
      if (result?.question) void runAsk(principal, result.question);
    },
    [result, runAsk],
  );

  const openFact = useCallback(async (factId: string) => {
    setSelected(factId);
    setDerivation(null);
    try {
      setDerivation(await getDerivation(factId));
    } catch {
      setDerivation(null);
    }
  }, []);

  const visiblePrincipals = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? principals.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.role.toLowerCase().includes(needle),
        )
      : principals;
    return list.slice(0, 120);
  }, [principals, filter]);

  if (booting || bootError) {
    return (
      <div className="app">
        <Masthead ok={!bootError} />
        <div className="centre">
          {bootError ? (
            <>
              <div className="headline" style={{ fontSize: 34 }}>
                Graph unavailable
              </div>
              <p className="sub mono">{bootError}</p>
              <p className="sub" style={{ fontSize: 12 }}>
                Start HydraDB with <span className="mono">npm run hydra:up</span>, then build the
                graph with <span className="mono">npm run build:graph</span>.
              </p>
            </>
          ) : (
            <>
              <div className="spinner" />
              <div className="eyebrow">Attaching to the enterprise graph</div>
              <p className="sub" style={{ fontSize: 12.5 }}>
                Resolving 81,000 person references across 38,600 artifacts.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Masthead ok stats={overview?.stats} />

      <div className="shell">
        {/* ---------------------------------------------------------- left */}
        <aside className="pane pane-left">
          <div className="block">
            <div className="label">Ask as</div>
            <input
              className="field"
              placeholder="filter by name or role"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {asker && (
              <div style={{ marginTop: 11 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{asker.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{asker.role}</div>
                <div className="person-access">
                  {asker.spaces.map((s) => (
                    <span className="chip granted" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 7 }}>
                  may read {asker.spaces.length} of {overview?.stats.spaces ?? '?'} spaces
                  {asker.reports > 0 ? ` · ${asker.reports} direct reports` : ''}
                </div>
              </div>
            )}
          </div>

          <div className="pane-body">
            {visiblePrincipals.map((p) => (
              <button
                key={p.id}
                className={`person${asker?.id === p.id ? ' active' : ''}`}
                onClick={() => switchAsker(p)}
              >
                <div className="person-name">{p.name}</div>
                <div className="person-role">{p.role}</div>
                <div className="person-access">
                  {p.spaces.slice(0, 4).map((s) => (
                    <span className="chip" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* -------------------------------------------------------- centre */}
        <main className="pane">
          <div className="block" style={{ borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field"
                placeholder="Ask the enterprise a question"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && asker) void runAsk(asker, query);
                }}
              />
              <button
                className="btn btn-primary"
                disabled={asking || !query.trim() || !asker}
                onClick={() => asker && void runAsk(asker, query)}
              >
                {asking ? 'Checking…' : 'Ask'}
              </button>
            </div>
          </div>

          <div className="pane-body">
            {result ? (
              <Results
                result={result}
                selected={selected}
                onSelect={openFact}
              />
            ) : (
              <div className="pane-body">
                <div className="block">
                  <div className="label">Questions from the corpus</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
                    Drawn from HERB's own answerable set. Ask one, then switch the person on the
                    left and watch the answer change.
                  </div>
                </div>
                {questions.slice(0, 30).map((q) => (
                  <button
                    key={q.id}
                    className="fact"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => {
                      setQuery(q.question);
                      if (asker) void runAsk(asker, q.question);
                    }}
                  >
                    <div className="fact-text">{q.question}</div>
                    <div className="fact-meta">
                      <span>{q.space}</span>
                      <span>{q.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        {/* --------------------------------------------------------- right */}
        <aside className="pane pane-right">
          {result && (
            <div className="readout">
              <div className="readout-cell">
                <div className="readout-value num" style={{ color: '#7fd1a0' }}>
                  {result.admitted.length}
                </div>
                <div className="readout-label">Disclosed</div>
              </div>
              <div className="readout-cell">
                <div className="readout-value num" style={{ color: 'var(--deny)' }}>
                  {result.withheld.length}
                </div>
                <div className="readout-label">Withheld</div>
              </div>
              <div className="readout-cell">
                <div className="readout-value num" style={{ color: 'var(--trace)' }}>
                  {result.traversals}
                </div>
                <div className="readout-label">Traversals</div>
              </div>
            </div>
          )}

          <div className="pane-body">
            {derivation ? (
              <DerivationPanel derivation={derivation} permitted={result?.permitted ?? []} />
            ) : (
              <div className="block">
                <div className="label">Permission trace</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  Select any result to see what it was derived from, which spaces that derivation
                  requires, and how that set was compared against the asker's grants.
                </div>
              </div>
            )}

            {overview && (
              <div className="block">
                <div className="label">Graph</div>
                <Stat k="artifacts" v={overview.stats.artifacts} />
                <Stat k="facts" v={overview.stats.facts} />
                <Stat k="cross-space facts" v={overview.stats.crossSpaceFacts} />
                <Stat k="nodes" v={overview.stats.nodes} />
                <Stat k="edges" v={overview.stats.edges} />
                <div className="label" style={{ marginTop: 14 }}>
                  Entity resolution
                </div>
                <Stat k="mentions" v={overview.stats.mentions} />
                <Stat k="resolved" v={overview.stats.resolved} />
                <Stat
                  k="precision"
                  v={`${(overview.stats.precision * 100).toFixed(1)}%`}
                />
                <Stat
                  k="candidates narrowed"
                  v={`${overview.stats.narrowedFrom} → ${overview.stats.narrowedTo}`}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <div className="stat-row">
      <span className="stat-key">{k}</span>
      <span className="stat-val">{typeof v === 'number' ? v.toLocaleString() : v}</span>
    </div>
  );
}

function Masthead({ ok, stats }: { ok: boolean; stats?: Overview['stats'] }) {
  return (
    <header className="masthead">
      <div className="brand">
        <span className="brand-mark">Cordon</span>
        <span className="brand-tag">derived knowledge inherits its sources' access</span>
      </div>
      <div className="masthead-right">
        {stats && (
          <span className="pill">
            {stats.nodes.toLocaleString()} nodes / {stats.edges.toLocaleString()} edges
          </span>
        )}
        <span className="pill">
          <span className={`dot${ok ? '' : ' off'}`} />
          hydradb
        </span>
      </div>
    </header>
  );
}

function Results({
  result,
  selected,
  onSelect,
}: {
  result: AskResult;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="results">
      <div className="result-head">
        <span className="asking">
          answering as <strong>{result.principalName}</strong>
          <span style={{ color: 'var(--text-3)' }}> · {result.principalRole}</span>
        </span>
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-4)' }}
        >
          {result.latencyMs}ms
        </span>
      </div>

      {result.admitted.length === 0 && result.withheld.length === 0 && (
        <div className="empty">Nothing in the corpus matches this question.</div>
      )}

      {result.admitted.map((fact) => (
        <div
          key={fact.id}
          className={`fact admitted${selected === fact.id ? ' selected' : ''}`}
          onClick={() => onSelect(fact.id)}
        >
          <div className="fact-text">{fact.text}</div>
          <div className="fact-meta">
            <span className="verdict ok">disclosed</span>
            <span>requires {fact.required.join(', ') || '—'}</span>
            {fact.level > 0 && <span>derived · level {fact.level}</span>}
          </div>
        </div>
      ))}

      {result.withheld.length > 0 && (
        <div
          className="block"
          style={{ borderTop: '1px solid var(--line)', background: 'var(--surface)' }}
        >
          <div className="label" style={{ color: '#ff8f92' }}>
            Withheld from this person
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
            A permission-blind system would have returned these. Each one depends on a space this
            asker cannot read.
          </div>
        </div>
      )}

      {result.withheld.map((fact) => (
        <div
          key={fact.id}
          className={`fact withheld${selected === fact.id ? ' selected' : ''}`}
          onClick={() => onSelect(fact.id)}
        >
          <div className="fact-text">{fact.text}</div>
          <div className="missing-note">
            requires access to{' '}
            {fact.missing.map((m) => (
              <code key={m}>{m}</code>
            ))}{' '}
            — not granted
          </div>
          <div className="fact-meta">
            <span className="verdict no">withheld</span>
            {fact.level > 0 && <span>derived · level {fact.level}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function DerivationPanel({
  derivation,
  permitted,
}: {
  derivation: Derivation;
  permitted: string[];
}) {
  const allowed = new Set(permitted);
  const missing = derivation.required.filter((s) => !allowed.has(s));

  return (
    <div className="block fade-up" key={derivation.fact.id}>
      <div className="label">Permission trace</div>
      <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>
        {derivation.fact.text}
      </div>

      <div className="trace-row">
        <span className="trace-key">required (by traversal)</span>
        <span className="trace-val">{derivation.required.length}</span>
      </div>
      <div className="set">
        {derivation.required.map((s) => (
          <span key={s} className={`chip${allowed.has(s) ? ' granted' : ''}`}>
            {s}
          </span>
        ))}
      </div>

      <div className="trace-row" style={{ marginTop: 12 }}>
        <span className="trace-key">asker may read</span>
        <span className="trace-val">{permitted.length}</span>
      </div>
      <div className="set">
        {permitted.slice(0, 10).map((s) => (
          <span key={s} className="chip granted">
            {s}
          </span>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          borderRadius: 'var(--radius)',
          border: `1px solid ${missing.length ? 'rgba(229,72,77,0.42)' : 'rgba(61,154,99,0.4)'}`,
          background: missing.length ? 'var(--deny-soft)' : 'var(--grant-soft)',
          fontSize: 11.5,
          lineHeight: 1.55,
          color: missing.length ? '#ff8f92' : '#7fd1a0',
        }}
      >
        {missing.length === 0
          ? 'required ⊆ permitted — disclosed'
          : `missing ${missing.join(', ')} — withheld`}
      </div>

      <div className="label" style={{ marginTop: 18 }}>
        Rests on
      </div>
      <div className="derivation">
        {derivation.supports.map((support) => (
          <div
            key={support.id}
            className={`deriv-step${support.kind === 'source' ? ' is-source' : ''}`}
          >
            <span className="deriv-dot" />
            <div className="deriv-kind">
              {support.kind === 'source' ? `${support.title} · ${support.space}` : support.title}
            </div>
            <div className="deriv-text">{support.text.slice(0, 220)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
