/**
 * Entity resolution.
 *
 * The hard case in this corpus is not spelling variation, it is genuine
 * ambiguity: 62 employees are called Charlie, and 92 of the 98 distinct full
 * names belong to more than one person. String similarity cannot separate them,
 * because the strings are *identical*. Every classical record-linkage technique
 * that scores surface forms is, on this data, blind.
 *
 * What does separate them is context. A first name in a Slack thread almost
 * always refers to someone already in that thread; a full name in a meeting
 * transcript is almost always one of the meeting's participants; and everyone
 * in a product's conversations is overwhelmingly likely to be on that product's
 * team. Those are all *structural* constraints, and structure is exactly what
 * the surrounding graph provides.
 *
 * So resolution proceeds by narrowing, cheapest constraint first:
 *
 *   1. blocking      - name index gives the candidate set (62 Charlies)
 *   2. co-presence   - identifiers anchored in the same artifact (usually 1-3)
 *   3. space roster  - the product team this artifact belongs to (~46)
 *   4. proximity     - the nearest anchor in the text
 *
 * and abstains when the constraints do not single out one person, because a
 * confidently wrong identity is worse than an unresolved mention - it would
 * attach a fact, and therefore an access decision, to the wrong human being.
 */

import type { Corpus, MentionNode } from './model.js';
import type { NameIndex, RawMention } from './mentions.js';

export type ResolutionMethod =
  | 'identifier'
  | 'co-presence'
  | 'space-roster'
  | 'proximity'
  | 'unique-name'
  | 'abstained';

export interface Resolution {
  mentionId: string;
  /** Resolved employee id, or null when we declined to guess. */
  employeeId: string | null;
  method: ResolutionMethod;
  /** How many candidates remained when the decision was made. */
  candidates: number;
  confidence: number;
}

export interface ResolutionStats {
  total: number;
  resolved: number;
  abstained: number;
  byMethod: Record<string, number>;
  meanCandidatesBefore: number;
  meanCandidatesAfter: number;
}

/** Candidate employees for a surface form, before any narrowing. */
function candidatesFor(mention: RawMention, index: NameIndex): string[] {
  if (mention.employeeId) return [mention.employeeId];

  const key = mention.surface.toLowerCase();
  const full = index.full.get(key);
  if (full) return full;

  const firstToken = key.split(' ')[0] ?? key;
  return index.first.get(firstToken) ?? [];
}

export interface ResolverInput {
  corpus: Corpus;
  index: NameIndex;
  mentions: MentionNode[];
  raw: Map<string, RawMention>;
}

export function resolveMentions(input: ResolverInput): {
  resolutions: Map<string, Resolution>;
  stats: ResolutionStats;
} {
  const { corpus, index, mentions, raw } = input;

  // Group by artifact: co-presence is only meaningful within one artifact.
  const byArtifact = new Map<string, MentionNode[]>();
  for (const mention of mentions) {
    const list = byArtifact.get(mention.sourceId);
    if (list) list.push(mention);
    else byArtifact.set(mention.sourceId, [mention]);
  }

  const spaceRoster = new Map<string, Set<string>>();
  for (const space of corpus.spaces.values()) spaceRoster.set(space.id, new Set(space.team));

  /** artifact id -> employee ids the artifact structurally declares present. */
  const anchorsFromStructure = new Map<string, Set<string>>();
  for (const artifact of corpus.artifacts) {
    const declared = new Set<string>();
    if (artifact.author?.startsWith('eid_')) declared.add(artifact.author);
    for (const p of artifact.participants) if (p.startsWith('eid_')) declared.add(p);
    if (declared.size > 0) anchorsFromStructure.set(artifact.key, declared);
  }

  const resolutions = new Map<string, Resolution>();
  const byMethod: Record<string, number> = {};
  let beforeTotal = 0;
  let afterTotal = 0;

  for (const [, group] of byArtifact) {
    // Anchors: identifiers explicitly present in this artifact. These are the
    // fixed points everything else is triangulated against.
    const anchors: Array<{ employeeId: string; offset: number }> = [];
    for (const mention of group) {
      const rawMention = raw.get(mention.id);
      if (rawMention?.employeeId) {
        anchors.push({ employeeId: rawMention.employeeId, offset: rawMention.offset });
      }
    }
    const anchorSet = new Set(anchors.map((a) => a.employeeId));
    const roster = spaceRoster.get(group[0]?.space ?? '') ?? new Set<string>();

    /*
     * Some artifacts state exactly who was present - a meeting's participants,
     * a pull request's author and reviewers. When such a roll call exists it is
     * authoritative, and a name that does not match anyone on it refers to
     * someone outside the room.
     *
     * Falling back to the product team here was measurably wrong: it resolved
     * 73 such mentions and got every single one incorrect, because it picked a
     * same-named teammate who simply was not there. In a system where identity
     * determines access, that is the worst possible failure - so when a roll
     * call exists and does not contain the name, we abstain.
     */
    const hasRollCall = anchorsFromStructure.get(group[0]?.sourceId ?? '')?.size ?? 0;

    for (const mention of group) {
      const rawMention = raw.get(mention.id);
      if (!rawMention) continue;

      const initial = candidatesFor(rawMention, index);
      beforeTotal += initial.length;

      const record = (employeeId: string | null, method: ResolutionMethod, pool: number, confidence: number) => {
        resolutions.set(mention.id, {
          mentionId: mention.id,
          employeeId,
          method,
          candidates: pool,
          confidence,
        });
        byMethod[method] = (byMethod[method] ?? 0) + 1;
        afterTotal += pool;
      };

      // 1. An identifier resolves itself.
      if (rawMention.employeeId) {
        record(rawMention.employeeId, 'identifier', 1, 1);
        continue;
      }

      if (initial.length === 0) {
        record(null, 'abstained', 0, 0);
        continue;
      }

      // 2. A name that is unique organisation-wide needs no context.
      if (initial.length === 1) {
        record(initial[0]!, 'unique-name', 1, 0.95);
        continue;
      }

      // 3. Co-presence: candidates who are explicitly anchored here.
      const coPresent = initial.filter((id) => anchorSet.has(id));
      if (coPresent.length === 1) {
        record(coPresent[0]!, 'co-presence', 1, 0.92);
        continue;
      }

      // 4. A roll call, where one exists, is authoritative.
      const pool = coPresent.length > 1 ? coPresent : initial;
      if (hasRollCall > 0 && coPresent.length === 0) {
        record(null, 'abstained', pool.length, 0);
        continue;
      }

      // 5. Space roster, only for artifacts that declare no attendance.
      const onTeam = pool.filter((id) => roster.has(id));
      if (onTeam.length === 1) {
        record(onTeam[0]!, 'space-roster', 1, 0.85);
        continue;
      }

      // 5. Proximity: among the remaining, prefer whoever is anchored nearest
      //    in the text. Conversation is local; the person just addressed is far
      //    more likely than a namesake elsewhere in the organisation.
      const narrowed = onTeam.length > 0 ? onTeam : pool;
      if (narrowed.length > 1 && anchors.length > 0) {
        let best: string | null = null;
        let bestDistance = Infinity;
        for (const candidate of narrowed) {
          for (const anchor of anchors) {
            if (anchor.employeeId !== candidate) continue;
            const distance = Math.abs(anchor.offset - rawMention.offset);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = candidate;
            }
          }
        }
        if (best) {
          record(best, 'proximity', narrowed.length, 0.7);
          continue;
        }
      }

      if (narrowed.length === 1) {
        record(narrowed[0]!, 'space-roster', 1, 0.85);
        continue;
      }

      // Nothing singled anyone out. Refusing is the correct outcome: attaching
      // this fact to a guessed person would attach an access decision to them.
      record(null, 'abstained', narrowed.length, 0);
    }
  }

  const total = mentions.length;
  const abstained = [...resolutions.values()].filter((r) => r.employeeId === null).length;

  return {
    resolutions,
    stats: {
      total,
      resolved: total - abstained,
      abstained,
      byMethod,
      meanCandidatesBefore: total ? +(beforeTotal / total).toFixed(2) : 0,
      meanCandidatesAfter: total ? +(afterTotal / total).toFixed(2) : 0,
    },
  };
}

/* ------------------------------------------------------------- evaluation */

export interface ResolutionAccuracy {
  evaluated: number;
  correct: number;
  wrong: number;
  abstained: number;
  /** Of the mentions we did resolve, how many were right. */
  precision: number;
  /** Of all evaluable mentions, how many we resolved correctly. */
  recall: number;
  byMethod: Record<string, { n: number; correct: number }>;
}

/**
 * Score resolution against the corpus's own structure.
 *
 * Meeting transcripts are the natural test set: they record their participants
 * as identifiers, and then refer to those same people by name in the body. The
 * name mentions are therefore labelled data the extractor never saw, and a
 * resolution is correct exactly when it lands on someone the meeting says was
 * in the room.
 */
export function scoreResolution(
  corpus: Corpus,
  mentions: MentionNode[],
  raw: Map<string, RawMention>,
  resolutions: Map<string, Resolution>,
): ResolutionAccuracy {
  const artifactByKey = new Map(corpus.artifacts.map((a) => [a.key, a]));
  const byMethod: Record<string, { n: number; correct: number }> = {};

  let evaluated = 0;
  let correct = 0;
  let wrong = 0;
  let abstained = 0;

  for (const mention of mentions) {
    const artifact = artifactByKey.get(mention.sourceId);
    if (!artifact || artifact.kind !== 'meeting_transcript') continue;

    const rawMention = raw.get(mention.id);
    if (!rawMention || rawMention.employeeId) continue; // identifiers are trivial

    const participants = new Set(artifact.participants.filter((p) => p.startsWith('eid_')));
    if (participants.size === 0) continue;

    const resolution = resolutions.get(mention.id);
    if (!resolution) continue;

    evaluated++;
    const bucket = (byMethod[resolution.method] ??= { n: 0, correct: 0 });
    bucket.n++;

    if (resolution.employeeId === null) {
      abstained++;
    } else if (participants.has(resolution.employeeId)) {
      correct++;
      bucket.correct++;
    } else {
      wrong++;
    }
  }

  const attempted = correct + wrong;
  return {
    evaluated,
    correct,
    wrong,
    abstained,
    precision: attempted ? +(correct / attempted).toFixed(4) : 0,
    recall: evaluated ? +(correct / evaluated).toFixed(4) : 0,
    byMethod,
  };
}
