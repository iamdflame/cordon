/**
 * Cordon: the domain model.
 *
 * Enterprise AI has one failure mode that matters more than any other: the
 * agent tells someone something they were never allowed to know. Every system
 * in production today defends against this at the *document* level - filter the
 * corpus by ACL, then retrieve. That defence has a hole in it, and the hole is
 * the entire reason this project exists.
 *
 * The hole is derived knowledge. If a fact is inferred from three documents,
 * what is that fact's access control? Document-level filtering has no answer,
 * because the fact is not a document. Systems that build a knowledge graph over
 * an enterprise corpus and then serve it to everyone have, in effect, laundered
 * restricted information into an unrestricted representation. Nobody sees the
 * leak, because what leaked was never a file.
 *
 * Cordon's answer:
 *
 *     visibility(fact) = intersection of visibility of everything it rests on
 *
 * and therefore, for a principal p:
 *
 *     admissible(fact, p)  <=>  a path exists from fact to a source p may read
 *
 * That is a reachability question with a per-principal predicate, and it cannot
 * be precomputed: with n principals there are 2^n visibility subsets. It has to
 * be traversed, at query time, per asker. Which is precisely what a graph
 * database is for, and precisely what an embedding index cannot express - a
 * vector has no notion of derivation, so it cannot carry a constraint.
 */

/** Node labels. Short: they appear in every statement. */
export const L = {
  /** A person who can ask questions and hold permissions. */
  Principal: 'Principal',
  /** A product workspace. The unit of access control in this corpus. */
  Space: 'Space',
  /** A verbatim artifact: a Slack message, PR, document, transcript. */
  Source: 'Source',
  /** A surface form observed in text: "Hannah", "H. Taylor", "eid_9b02...". */
  Mention: 'Mention',
  /** A resolved real-world thing, after entity resolution. */
  Entity: 'Entity',
  /** An assertion read from a source, or derived from other facts. */
  Fact: 'Fact',
} as const;

export const R = {
  /** Principal -> Space. Membership grants read access to the space. */
  MEMBER_OF: 'MEMBER_OF',
  /** Principal -> Principal. Management chain; managers inherit reports' access. */
  MANAGES: 'MANAGES',
  /** Source -> Space. Which workspace an artifact belongs to. */
  IN_SPACE: 'IN_SPACE',
  /**
   * Fact -> Source | Fact. What this fact rests on.
   *
   * A single relationship type for both evidence and derivation, because the
   * engine rejects multi-type variable-length patterns (`-[:A|B*1..n]->`) and
   * admissibility is a variable-length traversal. The distinction is carried as
   * a `kind` property. See docs/HYDRADB-ENGINE-NOTES.md.
   */
  RESTS_ON: 'RESTS_ON',
  /** Mention -> Entity. The output of entity resolution. */
  RESOLVES_TO: 'RESOLVES_TO',
  /** Source -> Mention. Where a surface form was observed. */
  OBSERVES: 'OBSERVES',
  /** Fact -> Entity. What a fact is about; drives associative recall. */
  ABOUT: 'ABOUT',
  /** Fact -> Fact. Mutually inconsistent assertions. */
  CONFLICTS_WITH: 'CONFLICTS_WITH',
} as const;

export type RelType = (typeof R)[keyof typeof R];

/**
 * Bound on admissibility traversals: fact -> ... -> source.
 *
 * The deepest chain is cluster -> pairing -> person -> claim -> source, which is
 * four hops. A bound of 3 silently failed to reach evidence for level-3 facts
 * and returned the deny-by-default sentinel: correct, but useless. Five leaves
 * one hop of margin without making the traversal materially more expensive.
 */
export const MAX_SUPPORT_HOPS = 5;

/* ------------------------------------------------------------------ corpus */

export interface Employee {
  id: string;
  name: string;
  role: string;
  location: string;
  org: string;
}

export type ArtifactKind =
  | 'slack'
  | 'document'
  | 'meeting_transcript'
  | 'meeting_chat'
  | 'url'
  | 'pr';

export interface Artifact {
  /**
   * The citation id, as questions refer to it. NOT unique across the corpus:
   * shared external links appear under the same id in several products.
   */
  id: string;
  /**
   * Space-scoped node identity.
   *
   * Fourteen artifact ids (shared github/docs links) occur in more than one
   * product. Collapsing them into a single node would give that node whichever
   * space happened to load last, and every fact resting on it would inherit the
   * wrong access requirement. Keying nodes by space keeps each product's copy
   * separate, which is the direction that fails closed.
   */
  key: string;
  space: string;
  kind: ArtifactKind;
  /** Full text used for extraction and lexical retrieval. */
  text: string;
  /** Short label for display. */
  title: string;
  /** Author or speaker, where the artifact records one. */
  author?: string;
  /** People explicitly present, e.g. meeting participants or PR reviewers. */
  participants: string[];
  date?: string;
  /** Channel, document link, or PR url. */
  locator?: string;
}

export interface Space {
  id: string;
  name: string;
  /** Employee ids on the product team. */
  team: string[];
  /** Customer ids associated with the product. */
  customers: string[];
}

export interface Question {
  id: string;
  space: string;
  question: string;
  groundTruth: string;
  /** The answer as the dataset states it: a list for person/pr/url/company. */
  groundTruthRaw: unknown;
  /** Artifact ids that contain the answer. Ground truth for retrieval. */
  citations: string[];
  type: string;
  answerable: boolean;
}

export interface Corpus {
  employees: Map<string, Employee>;
  spaces: Map<string, Space>;
  artifacts: Artifact[];
  questions: Question[];
  /** manager id -> direct report ids, from the org hierarchy. */
  reports: Map<string, string[]>;
  /** employee id -> manager id. */
  managerOf: Map<string, string>;
}

/* --------------------------------------------------------------- knowledge */

export interface MentionNode {
  id: string;
  /** Verbatim surface form as it appeared. */
  surface: string;
  /** Normalised for blocking and comparison. */
  normalised: string;
  kind: 'person' | 'product' | 'customer' | 'other';
  sourceId: string;
  space: string;
}

export interface EntityNode {
  id: string;
  /** Canonical display name. */
  name: string;
  kind: MentionNode['kind'];
  /** Mention ids that resolved here. */
  mentions: string[];
  /** Ground-truth employee id, when the cluster resolved to a known person. */
  canonicalId?: string;
}

export interface FactNode {
  id: string;
  text: string;
  /** Sources and/or facts this rests on. */
  restsOn: string[];
  /** 0 = read directly from a source, >0 = derived. */
  level: number;
  /** Entities this fact is about. */
  entities: string[];
  space: string;
  date?: string;
  /**
   * Spaces whose access is required to see this fact.
   *
   * For a level-0 fact this is the one space its source belongs to. For a
   * derived fact it is the *union of the spaces of everything underneath it*,
   * which means a principal needs access to all of them - the intersection of
   * the audiences, not the union.
   */
  requiredSpaces: string[];
}

/** Deterministic ids, so a rebuild reproduces the same graph exactly. */
export const ids = {
  principal: (employeeId: string) => `p:${employeeId}`,
  space: (name: string) => `sp:${name}`,
  source: (artifactKey: string) => `s:${artifactKey}`,
  mention: (sourceId: string, index: number) => `m:${sourceId}#${index}`,
  entity: (key: string) => `e:${key}`,
  fact: (sourceId: string, index: number) => `f:${sourceId}#${index}`,
  derived: (key: string) => `d:${key}`,
};
