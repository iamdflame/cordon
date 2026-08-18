/**
 * Mention extraction.
 *
 * The corpus refers to people in four different registers, and they carry
 * wildly different amounts of information:
 *
 *   eid_13fdff84          unambiguous - an identifier
 *   "Charlie Garcia"      ambiguous - 92 of the 98 distinct full names in this
 *                         organisation belong to more than one person
 *   "Charlie"             very ambiguous - 62 employees are called Charlie
 *   "Charlie Davis:"      a transcript speaker label
 *
 * Extraction's job is only to find these and record what register they are in.
 * Deciding *who* they mean is entity resolution, and it needs context that a
 * single string does not contain - see ./resolve.ts.
 *
 * The explicit identifiers matter far beyond their own resolution: they are the
 * anchors that make the ambiguous mentions solvable, because a first name in a
 * message is almost always someone already present in that conversation.
 */

import type { Artifact, Corpus, MentionNode } from './model.js';
import { ids } from './model.js';

export type MentionRegister = 'identifier' | 'full-name' | 'first-name' | 'speaker';

export interface RawMention {
  surface: string;
  register: MentionRegister;
  /** Set when the surface form is itself an employee id. */
  employeeId?: string;
  /** Character offset, used to find the nearest anchor. */
  offset: number;
}

const EID = /\beid_[0-9a-f]{6,}\b/g;

/** Speaker labels at the head of a transcript line: "Charlie Davis: ...". */
const SPEAKER = /(?:^|\n)\s*([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s*:/g;

/**
 * Index of the names present in this organisation.
 *
 * Built once. Maps a normalised surface form to every employee it could refer
 * to, which is the candidate set entity resolution has to choose from.
 */
export interface NameIndex {
  /** "charlie garcia" -> employee ids */
  full: Map<string, string[]>;
  /** "charlie" -> employee ids */
  first: Map<string, string[]>;
  /** Every distinct first name, for cheap scanning. */
  firstNames: Set<string>;
  /** Longest full name in tokens, to bound the scan window. */
  maxNameTokens: number;
}

export function buildNameIndex(corpus: Corpus): NameIndex {
  const full = new Map<string, string[]>();
  const first = new Map<string, string[]>();
  const firstNames = new Set<string>();
  let maxNameTokens = 1;

  for (const employee of corpus.employees.values()) {
    const name = employee.name.trim();
    if (name.length === 0) continue;

    const key = name.toLowerCase();
    const list = full.get(key);
    if (list) list.push(employee.id);
    else full.set(key, [employee.id]);

    const tokens = name.split(/\s+/);
    maxNameTokens = Math.max(maxNameTokens, tokens.length);

    const firstToken = tokens[0]?.toLowerCase();
    if (firstToken) {
      firstNames.add(firstToken);
      const fl = first.get(firstToken);
      if (fl) fl.push(employee.id);
      else first.set(firstToken, [employee.id]);
    }
  }

  return { full, first, firstNames, maxNameTokens };
}

/** Extract every person reference in one artifact, in document order. */
export function extractMentions(artifact: Artifact, index: NameIndex): RawMention[] {
  const found: RawMention[] = [];
  const text = artifact.text;

  // 1. Explicit identifiers, including the artifact's own author and
  //    participants, which are recorded as structure rather than prose.
  for (const match of text.matchAll(EID)) {
    found.push({
      surface: match[0],
      register: 'identifier',
      employeeId: match[0],
      offset: match.index ?? 0,
    });
  }
  if (artifact.author?.startsWith('eid_')) {
    found.push({ surface: artifact.author, register: 'identifier', employeeId: artifact.author, offset: -1 });
  }
  for (const participant of artifact.participants) {
    if (participant.startsWith('eid_')) {
      found.push({ surface: participant, register: 'identifier', employeeId: participant, offset: -1 });
    }
  }

  // 2. Transcript speaker labels.
  if (artifact.kind === 'meeting_transcript') {
    for (const match of text.matchAll(SPEAKER)) {
      const name = match[1];
      if (!name) continue;
      const key = name.toLowerCase();
      if (index.full.has(key) || index.first.has(key.split(' ')[0] ?? '')) {
        found.push({ surface: name, register: 'speaker', offset: match.index ?? 0 });
      }
    }
  }

  // 3. Names in prose. Scanned longest-first so "Charlie Garcia" is preferred
  //    over the "Charlie" inside it - a full name is far more informative and
  //    consuming it prevents double-counting.
  const words = [...text.matchAll(/\b[A-Z][a-z]+\b/g)];
  const consumed = new Set<number>();

  for (let width = index.maxNameTokens; width >= 1; width--) {
    for (let i = 0; i + width <= words.length; i++) {
      if (consumed.has(i)) continue;

      const slice = words.slice(i, i + width);
      const startOffset = slice[0]!.index ?? 0;
      const endOffset = (slice[width - 1]!.index ?? 0) + slice[width - 1]![0].length;
      // Reject spans broken by punctuation: "Emma. Also" is not a name.
      if (endOffset - startOffset > slice.reduce((n, w) => n + w[0].length, 0) + width * 2) continue;

      const phrase = slice.map((w) => w[0]).join(' ');
      const key = phrase.toLowerCase();

      if (width > 1 && index.full.has(key)) {
        found.push({ surface: phrase, register: 'full-name', offset: startOffset });
        for (let k = i; k < i + width; k++) consumed.add(k);
      } else if (width === 1 && index.first.has(key)) {
        found.push({ surface: phrase, register: 'first-name', offset: startOffset });
        consumed.add(i);
      }
    }
  }

  found.sort((a, b) => a.offset - b.offset);
  return found;
}

export interface MentionExtraction {
  mentions: MentionNode[];
  /** mention id -> the raw record, needed by resolution. */
  raw: Map<string, RawMention>;
  stats: {
    total: number;
    byRegister: Record<string, number>;
    artifactsWithMentions: number;
  };
}

export function extractAll(corpus: Corpus, index: NameIndex): MentionExtraction {
  const mentions: MentionNode[] = [];
  const raw = new Map<string, RawMention>();
  const byRegister: Record<string, number> = {};
  let artifactsWithMentions = 0;

  for (const artifact of corpus.artifacts) {
    const found = extractMentions(artifact, index);
    if (found.length > 0) artifactsWithMentions++;

    const seen = new Set<string>();
    for (const [i, mention] of found.entries()) {
      // One node per distinct surface form per artifact: repeating a name in a
      // message is emphasis, not a second referent.
      const dedupe = `${mention.register}:${mention.surface.toLowerCase()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const id = ids.mention(artifact.key, i);
      mentions.push({
        id,
        surface: mention.surface,
        normalised: mention.surface.toLowerCase(),
        kind: 'person',
        sourceId: artifact.key,
        space: artifact.space,
      });
      raw.set(id, mention);
      byRegister[mention.register] = (byRegister[mention.register] ?? 0) + 1;
    }
  }

  return {
    mentions,
    raw,
    stats: { total: mentions.length, byRegister, artifactsWithMentions },
  };
}
