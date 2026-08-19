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
