/**
 * @cordon/client — the gate, as a library.
 *
 * Cordon's whole adoption argument is "keep your stack, add the gate". That is
 * only true if adding the gate is one import rather than an afternoon of
 * hand-rolled `fetch` calls, retry logic, and guessing at response shapes.
 *
 * ```ts
 * import { Cordon } from '@cordon/client';
 *
 * const cordon = new Cordon({ url: 'http://localhost:8787' });
 *
 * // Per fact: may this principal see what your retrieval found?
 * const { admitted, withheld } = await cordon.admissible(asker, factIds);
 *
 * // Per answer: what an answer leaks is a property of the SET, not its members.
 * const plan = await cordon.plan(asker, rankedFactIds, { session: true });
 * ```
 *
 * ## The design rule
 *
 * **This client fails closed.** Every path that cannot reach a decision throws
 * rather than returning a permissive default. A network blip that silently
 * resolved to "admitted" would be a disclosure bug in someone else's product,
 * caused by our convenience — so there is no `catch { return facts }` anywhere,
 * and `admissibleOrThrow` exists to make the safe path the short one.
 *
 * Zero dependencies: `fetch` is in every runtime we target.
 */

export const VERSION = '0.1.0';

/* -------------------------------------------------------------------errors */

/** Base for everything this client throws, so callers can catch one type. */
export class CordonError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'CordonError';
  }
}

/** The graph is still building, or the engine is unreachable. Retryable. */
export class CordonUnavailableError extends CordonError {
  constructor(detail?: unknown) {
    super('Cordon is unavailable (graph building or engine unreachable)', 503, detail);
    this.name = 'CordonUnavailableError';
  }
}

/** The gate refused. Carries what was missing, so a refusal is actionable. */
export class CordonDeniedError extends CordonError {
  constructor(
    message: string,
    readonly withheld: WithheldFact[],
  ) {
    super(message, 403);
    this.name = 'CordonDeniedError';
  }
}

/* --------------------------------------------------------------------types */

export interface WithheldFact {
  id: string;
  /** Every space this fact's derivation rests on. */
  requires: string[];
  /** The subset the asker cannot read. Empty means admitted. */
  missing: string[];
  /** Derivation path down to the source that caused the refusal, when resolved. */
  chain?: string[];
}

export interface AdmissibleResult {
  admitted: string[];
  withheld: WithheldFact[];
  /** Ids Cordon does not know. Withheld — a gate that admits the unknown is not a gate. */
  unknown: string[];
}

export interface SuppressedFact {
  id: string;
  text?: string;
  /** The protected claim this fact's inclusion would have completed. */
  wouldComplete: string[];
}

export interface PlanResult {
  /** Safe to serve, in the rank order you supplied. */
  disclosed: Array<{ id: string; text?: string; level?: number }>;
  /** Refused by the per-fact rule: no provenance. */
  inadmissible: WithheldFact[];
  /** Admissible, withheld anyway because the *set* would have leaked. */
  suppressed: SuppressedFact[];
  /** Protected claims the unplanned answer would have re-derived. */
  violationsPrevented: string[];
  /** Always re-checked server-side before returning. */
  safe: boolean;
  stats: {
    candidates: number;
    admissible: number;
    disclosed: number;
    suppressedForInference: number;
    retention: number;
  };
  /** Present when `session: true`. */
  ledger?: { size: number; queries: number };
  latencyMs: number;
}

export interface RiskFact {
  id: string;
  text: string;
  level: number;
  requires: string[];
  audience: number;
  audienceShare: number;
}

export interface RiskSurface {
  principals: number;
  spaces: number;
  derivedFacts: number;
  /** Derived past the point of usefulness: nobody in the org may read them. */
  invisible: number;
  byLevel: Array<{ level: number; facts: number; meanAudience: number }>;
  riskiest: RiskFact[];
}

export interface PolicyImpact {
  principalsAffected: number;
  documentsGained: number;
  /** Invisible to any document-level access review. */
  derivedGained: number;
  /** Of those, the ones unlocked only in combination with access already held. */
  unlockedByCombination: number;
  documentsLost: number;
  derivedLost: number;
  /** Still-refused claims the change puts within rebuilding distance. */
  newlyInferable: number;
  hiddenRatio: number;
}

export interface SessionState {
  principal: string;
  /** Facts disclosed to this principal, cumulatively. */
  size: number;
  queries: number;
  /** Claims their own history already determines, without being told. */
  determines: number;
}

export interface CordonOptions {
  url: string;
  /** Per-request timeout. Default 15s. */
  timeoutMs?: number;
  /** Attempts on 5xx/network failure. Default 3. */
  retries?: number;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

/* -------------------------------------------------------------------client */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Cordon {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly headers: Record<string, string>;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(options: CordonOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 3;
    this.headers = options.headers ?? {};
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Retries only what is safe to retry.
   *
   * 5xx and network failures are retried with backoff; a 4xx is a decision and
   * is never retried, because retrying a refusal until it succeeds is exactly
   * the bug this whole project exists to prevent.
   */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.doFetch(`${this.url}${path}`, {
          ...init,
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...this.headers, ...(init?.headers ?? {}) },
        });
        clearTimeout(timer);

        if (response.status === 503) throw new CordonUnavailableError(await safeBody(response));
        if (!response.ok && response.status < 500) {
          throw new CordonError(`Cordon returned ${response.status}`, response.status, await safeBody(response));
        }
        if (!response.ok) {
          lastError = new CordonError(`Cordon returned ${response.status}`, response.status);
          if (attempt < this.retries - 1) {
            await sleep(Math.min(200 * 2 ** attempt, 2000));
            continue;
          }
          throw lastError;
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timer);
        /* A decision is final. Only transport problems get another attempt. */
        if (error instanceof CordonError && error.status !== undefined && error.status < 500) throw error;
        lastError = error;
        if (attempt < this.retries - 1) {
          await sleep(Math.min(200 * 2 ** attempt, 2000));
          continue;
        }
      }
    }

    /*
     * Preserve the error type across retries.
     *
     * A 503 is retryable - the graph may finish building - but wrapping the
     * final failure in a generic CordonError threw away the fact that it was
     * *unavailable* rather than *unreachable*. A caller cannot distinguish
     * "come back in a minute" from "your config is wrong" once that happens,
     * and the first one is not an error worth paging anybody about.
     */
    if (lastError instanceof CordonError) throw lastError;
    throw lastError instanceof Error
      ? new CordonError(`Cordon unreachable: ${lastError.message}`)
      : new CordonError('Cordon unreachable');
  }

  /* ---------------------------------------------------------------- health */

  async health(): Promise<{ ok: boolean; building: boolean; error: string | null; hydra: string }> {
    return this.request('/api/health');
  }

  /** Resolves once the graph is queryable, or throws after `timeoutMs`. */
  async waitUntilReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const health = await this.health();
        if (health.ok && !health.building) return;
      } catch {
        /* still coming up */
      }
      if (Date.now() > deadline) throw new CordonError(`Cordon not ready within ${timeoutMs}ms`);
      await sleep(1000);
    }
  }

  /* ------------------------------------------------------------- the gate */

  /**
   * Per-fact: which of these may this principal see?
   *
   * Retrieval-agnostic — post whatever your ranker produced. Ids Cordon does
   * not recognise come back in `unknown` and are **not** admitted.
   */
  async admissible(principal: string, factIds: string[]): Promise<AdmissibleResult> {
    const body = await this.request<{
      admitted?: Array<string | { id: string }>;
      withheld?: WithheldFact[];
      unknown?: string[];
    }>('/v1/admissible', {
      method: 'POST',
      body: JSON.stringify({ principal, facts: factIds.map((id) => ({ id })) }),
    });

    return {
      admitted: (body.admitted ?? []).map((a) => (typeof a === 'string' ? a : a.id)),
      withheld: body.withheld ?? [],
      unknown: body.unknown ?? [],
    };
  }

  /**
   * Filter to the admitted ids, throwing if anything was refused.
   *
   * For callers who would rather fail a request than quietly serve less. The
   * thrown error carries the missing spaces, so the refusal stays actionable.
   */
  async admissibleOrThrow(principal: string, factIds: string[]): Promise<string[]> {
    const result = await this.admissible(principal, factIds);
    if (result.withheld.length > 0 || result.unknown.length > 0) {
      throw new CordonDeniedError(
        `${result.withheld.length} fact(s) withheld, ${result.unknown.length} unknown`,
        result.withheld,
      );
    }
    return result.admitted;
  }

  /**
   * Per-answer: the largest subset of your candidates that is safe to serve.
   *
   * Every fact in a reply can be individually admissible while the reply as a
   * whole re-derives something the asker was refused — `admissible` cannot see
   * that, because the dangerous object never appears in the list being checked.
   *
   * Pass candidates in rank order; the planner sacrifices low-utility evidence
   * first. `session: true` evaluates against everything this principal has been
   * shown, because per-query safety does not compose.
   */
  async plan(
    principal: string,
    factIds: string[],
    options: { session?: boolean } = {},
  ): Promise<PlanResult> {
    return this.request<PlanResult>('/v1/plan', {
      method: 'POST',
      body: JSON.stringify({
        principal,
        facts: factIds.map((id) => ({ id })),
        session: options.session ?? true,
      }),
    });
  }

  /** Convenience: the ids that survived planning, in rank order. */
  async planIds(principal: string, factIds: string[], options: { session?: boolean } = {}): Promise<string[]> {
    const plan = await this.plan(principal, factIds, options);
    return plan.disclosed.map((f) => f.id);
  }

  /* ------------------------------------------------------------- operator */

  /** Derived facts ranked by how few people may read them. */
  async risk(): Promise<RiskSurface> {
    return this.request<RiskSurface>('/api/risk');
  }

  /**
   * What a policy change would actually cost, computed before applying it.
   *
   * `derivedGained` is the number no document-level access review can produce:
   * facts nobody approved, unlocked because their whole requirement is now
   * covered.
   */
  async previewPolicy(change: {
    grants?: Array<{ subject: string; space: string }>;
    revokes?: Array<{ subject: string; space: string }>;
    includeInference?: boolean;
  }): Promise<{ impact: PolicyImpact; latencyMs: number }> {
    return this.request('/v1/policy/preview', { method: 'POST', body: JSON.stringify(change) });
  }

  /** What a principal's session has accumulated, and what it now determines. */
  async session(principal: string): Promise<SessionState> {
    return this.request<SessionState>(`/api/session/${encodeURIComponent(principal)}`);
  }

  /** Clear a principal's disclosure budget. Privileged, and logged server-side. */
  async resetSession(principal: string): Promise<{ principal: string; cleared: number }> {
    return this.request('/api/session/reset', { method: 'POST', body: JSON.stringify({ principal }) });
  }

  /** Everyone who can hold a permission, widest access first. */
  async principals(): Promise<Array<{ id: string; name: string; role: string; spaces: string[] }>> {
    return this.request('/api/principals');
  }

  /** Why a fact requires what it requires: the derivation, walked. */
  async explain(factId: string): Promise<{
    fact: { id: string; text: string; level: number };
    required: string[];
    supports: Array<{ kind: 'source' | 'fact'; id: string; space: string; title: string; text: string }>;
  }> {
    return this.request(`/api/fact/${encodeURIComponent(factId)}`);
  }
}

async function safeBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export default Cordon;
