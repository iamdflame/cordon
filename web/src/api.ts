export interface Principal {
  id: string;
  name: string;
  role: string;
  location: string;
  spaces: string[];
  reports: number;
}

export interface SampleQuestion {
  id: string;
  question: string;
  space: string;
  type: string;
}

export interface FactView {
  id: string;
  text: string;
  level: number;
  space: string;
  score: number;
}

export interface AdmittedFact extends FactView {
  required: string[];
}

export interface WithheldFact extends FactView {
  missing: string[];
}

export interface AskResult {
  principal: string;
  principalName: string;
  principalRole: string;
  permitted: string[];
  question: string;
  latencyMs: number;
  traversals: number;
  admitted: AdmittedFact[];
  withheld: WithheldFact[];
}

export interface Overview {
  stats: {
    artifacts: number;
    spaces: number;
    employees: number;
    mentions: number;
    resolved: number;
    precision: number;
    recall: number;
    facts: number;
    crossSpaceFacts: number;
    edges: number;
    nodes: number;
    narrowedFrom: number;
    narrowedTo: number;
  };
  spaces: Array<{ id: string; team: number }>;
}

export interface Derivation {
  fact: { id: string; text: string; level: number };
  required: string[];
  supports: Array<{
    kind: 'source' | 'fact';
    id: string;
    space: string;
    title: string;
    cite: string;
    text: string;
  }>;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const getHealth = () =>
  json<{ ok: boolean; building: boolean; error: string | null; hydra: string }>('/api/health');
export const getOverview = () => json<Overview>('/api/overview');
export const getPrincipals = () => json<Principal[]>('/api/principals');
export const getQuestions = () => json<SampleQuestion[]>('/api/questions');
export const getDerivation = (factId: string) =>
  json<Derivation>(`/api/fact/${encodeURIComponent(factId)}`);

export const ask = (principal: string, question: string) =>
  json<AskResult>('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ principal, question }),
  });

/* ------------------------------------------------------------ risk surface */

export interface RiskFact {
  id: string;
  text: string;
  level: number;
  requires: string[];
  audience: number;
  audienceShare: number;
}

export interface Risk {
  principals: number;
  spaces: number;
  derivedFacts: number;
  invisible: number;
  byLevel: Array<{ level: number; facts: number; meanAudience: number }>;
  riskiest: RiskFact[];
}

export const getRisk = () => json<Risk>('/api/risk');

/* -------------------------------------------------- inference-safe planning */

export interface PlanResult {
  principal: string;
  latencyMs: number;
  safe: boolean;
  disclosed: Array<{ id: string; text: string; level: number }>;
  inadmissible: Array<{ id: string; requires: string[]; missing: string[] }>;
  /** Admissible, withheld anyway because the *set* would have leaked. */
  suppressed: Array<{ id: string; text: string; wouldComplete: string[] }>;
  violationsPrevented: string[];
  stats: {
    candidates: number;
    admissible: number;
    disclosed: number;
    suppressedForInference: number;
    closureSize: number;
    retention: number;
  };
  ledger?: { size: number; queries: number };
  unknown: string[];
}

export const planDisclosure = (principal: string, factIds: string[], session = true) =>
  json<PlanResult>('/v1/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ principal, facts: factIds.map((id) => ({ id })), session }),
  });

/* ---------------------------------------------------------------- sessions */

export interface SessionState {
  principal: string;
  size: number;
  queries: number;
  /** Claims this principal's own history already determines. */
  determines: number;
}

export const getSession = (principal: string) =>
  json<SessionState>(`/api/session/${encodeURIComponent(principal)}`);

export const resetSession = (principal: string) =>
  json<{ principal: string; cleared: number }>('/api/session/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ principal }),
  });
