/**
 * Facts, and the propagation of access control through derivation.
 *
 * This is where the leak that Cordon exists to prevent actually happens.
 *
 * A level-0 fact is read from one artifact and inherits that artifact's space:
 * unremarkable, and document-level filtering handles it correctly. The danger
 * begins at level 1. When the system observes that a person appears in
 * ActionGenie's Slack *and* in AnomalyForce's pull requests, it can form a fact
 * that no single artifact contains - and that fact is derived from two
 * separately restricted places.
 *
 * Almost every knowledge-graph-over-enterprise-corpus system in existence will
 * happily serve that derived fact to anyone who can see either source, or to
 * anyone at all. Both are leaks, and the second is catastrophic. What makes it
 * insidious is that no document escaped: the leak is an *inference*, so no
 * audit of file access will ever show it.
 *
 * The rule Cordon enforces:
 *
 *     requiredSpaces(fact) = union of requiredSpaces of everything it rests on
 *
 * and a principal may see the fact only if they can read *every* space in that
 * set. Union on the requirement side is intersection on the audience side.
 */

import type { Artifact, Corpus, FactNode, MentionNode } from './model.js';
import { ids } from './model.js';
import type { Resolution } from './resolve.js';

/** Sentences shorter than this carry no retrievable assertion. */
const MIN_FACT_CHARS = 40;
const MAX_FACT_CHARS = 400;
/** Cap per artifact so ingest stays inside the engine's write budget. */
const MAX_FACTS_PER_ARTIFACT = 2;
/** Cap on how many supports one derived fact cites, to bound ingest. */
const MAX_SUPPORT_PER_BELIEF = 6;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_FACT_CHARS && s.length <= MAX_FACT_CHARS);
}

/** Prefer sentences that name people, carry numbers, or state decisions. */
const DECISION = /\b(decided|agreed|approved|shipped|launched|blocked|owns?|leads?|assigned|deadline|milestone|released|scheduled|responsible)\b/i;

function informativeness(sentence: string, entityCount: number): number {
  let score = entityCount * 2;
  if (DECISION.test(sentence)) score += 3;
  if (/\d/.test(sentence)) score += 1;
  score += Math.min(sentence.length / 120, 2);
  return score;
}

export interface FactExtraction {
  facts: FactNode[];
  /** entity id -> fact ids mentioning it, used to build derived facts. */
  factsByEntity: Map<string, string[]>;
  /** source id -> entity ids observed in it. */
  entitiesBySource: Map<string, Set<string>>;
  stats: {
    level0: number;
    derived: number;
    crossSpaceDerived: number;
    byLevel: Record<number, number>;
    meanRequiredSpaces: number;
    maxRequiredSpaces: number;
  };
}

export interface FactInput {
  corpus: Corpus;
  mentions: MentionNode[];
  resolutions: Map<string, Resolution>;
  /** Cap on derived facts, to bound ingest. */
  maxDerived?: number;
}

export function buildFacts(input: FactInput): FactExtraction {
  const { corpus, mentions, resolutions } = input;
  const maxDerived = input.maxDerived ?? 40_000;

  // Which resolved people appear in which artifact.
  const entitiesBySource = new Map<string, Set<string>>();
  for (const mention of mentions) {
    const resolution = resolutions.get(mention.id);
    if (!resolution?.employeeId) continue;
    const set = entitiesBySource.get(mention.sourceId);
    if (set) set.add(resolution.employeeId);
    else entitiesBySource.set(mention.sourceId, new Set([resolution.employeeId]));
  }

  const facts: FactNode[] = [];
  const factsByEntity = new Map<string, string[]>();


  /* ------------------------------------------------------- level 0 facts */

  for (const artifact of corpus.artifacts) {
    const entities = [...(entitiesBySource.get(artifact.key) ?? [])];
    const candidates = sentences(artifact.text)
      .map((text) => ({ text, score: informativeness(text, entities.length) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FACTS_PER_ARTIFACT);

    for (const [i, candidate] of candidates.entries()) {
      const id = ids.fact(artifact.key, i);
      facts.push({
        id,
        text: candidate.text,
        restsOn: [ids.source(artifact.key)],
        level: 0,
        entities,
        space: artifact.space,
        // A level-0 fact requires exactly the space its evidence came from.
        requiredSpaces: [artifact.space],
        ...(artifact.date ? { date: artifact.date } : {}),
      });

      for (const entity of entities) {
        const list = factsByEntity.get(entity);
        if (list) list.push(id);
        else factsByEntity.set(entity, [id]);
      }
    }
  }

  const factById = new Map(facts.map((f) => [f.id, f]));

  /* -------------------------------------------------- level 1: derived --- */

  /*
   * Cross-space person facts.
   *
   * For each person, gather the facts about them and group by space. When they
   * appear in more than one space, form a derived fact that rests on one
   * supporting fact from each. This is a real inference - no artifact states
   * it - and it is precisely the kind of conclusion an enterprise assistant
   * would volunteer.
   *
   * Its required-space set is the union of its supports, so the only people who
   * may see it are those entitled to every space it was built from.
   */
  let derived = 0;
  let crossSpace = 0;

  for (const [entity, factIds] of factsByEntity) {
    if (derived >= maxDerived) break;

    const bySpace = new Map<string, string[]>();
    for (const factId of factIds) {
      const fact = factById.get(factId);
      if (!fact) continue;
      const list = bySpace.get(fact.space);
      if (list) list.push(factId);
      else bySpace.set(fact.space, [factId]);
    }
    if (bySpace.size < 2) continue;

    // One representative support per space keeps the derivation legible and
    // the edge count bounded, while preserving the full space requirement.
    const supports: string[] = [];
    const spaces: string[] = [];
    for (const [space, list] of bySpace) {
      const first = list[0];
      if (!first) continue;
      supports.push(first);
      spaces.push(space);
      if (spaces.length >= 6) break;
    }
    if (supports.length < 2) continue;

    const person = corpus.employees.get(entity);
    const id = ids.derived(`person:${entity}`);
    facts.push({
      id,
      text:
        `${person?.name ?? entity} (${person?.role ?? 'unknown role'}) is active across ` +
        `${spaces.length} product areas: ${spaces.join(', ')}.`,
      restsOn: supports,
      level: 1,
      entities: [entity],
      space: spaces[0]!,
      requiredSpaces: [...new Set(spaces)],
    });
    // Register immediately: level 2 unions the requirements of its supports and
    // must be able to look them up.
    factById.set(id, facts[facts.length - 1]!);
    derived++;
    crossSpace++;
  }

  /* -------------------------------------------------- level 2: pairings --- */

  /*
   * Where two product areas share people, that overlap is itself a fact - and it
   * is derived from the person-level facts on both sides, so it requires every
   * space they touch.
   *
   * This is the first point at which a fact rests on other *derived* facts
   * rather than on evidence, which is what makes admissibility a genuine
   * multi-hop traversal: a level-2 node has no edge to any source at all.
   */
  const level1 = facts.filter((f) => f.level === 1);
  const byPair = new Map<string, string[]>();

  for (const belief of level1) {
    const spaces = [...belief.requiredSpaces].sort();
    for (let i = 0; i < spaces.length; i++) {
      for (let j = i + 1; j < spaces.length; j++) {
        const key = `${spaces[i]}|${spaces[j]}`;
        const list = byPair.get(key);
        if (list) list.push(belief.id);
        else byPair.set(key, [belief.id]);
      }
    }
  }

  const level2Ids: string[] = [];
  for (const [pair, supports] of byPair) {
    if (supports.length < 2) continue;
    const [a, b] = pair.split('|');
    if (!a || !b) continue;

    const id = ids.derived(`pair:${a}:${b}`);
    const cited = supports.slice(0, MAX_SUPPORT_PER_BELIEF);

    /*
     * The requirement is the union of what the cited supports require, not the
     * pair that named this fact.
     *
     * Declaring just [a, b] was wrong, and the traversal caught it: a level-1
     * person fact spans every area that person works in, so a pairing derived
     * from two such facts inherits all of them. Naming the pair under-states
     * the requirement, and under-stating a requirement is under-restriction.
     */
    const union = new Set<string>([a, b]);
    for (const supportId of cited) {
      for (const space of factById.get(supportId)?.requiredSpaces ?? []) union.add(space);
    }

    facts.push({
      id,
      text:
        `${supports.length} people contribute to both ${a} and ${b}, forming a ` +
        'shared delivery path between the two areas.',
      restsOn: cited,
      level: 2,
      entities: [],
      space: a,
      requiredSpaces: [...union],
    });
    level2Ids.push(id);
    derived++;
  }

  /* --------------------------------------------------- level 3: clusters --- */

  /*
   * A cluster of mutually-overlapping areas, derived from the pairings. Its
   * requirement is the union of three or more spaces, so its audience is the
   * intersection of three or more teams - typically a handful of people in an
   * organisation of 530.
   *
   * This is the case document-level filtering cannot express at all: no
   * document carries this claim, so there is no document whose ACL could
   * govern it.
   */
  const factByIdAll = new Map(facts.map((f) => [f.id, f]));
  const adjacency = new Map<string, Set<string>>();
  for (const id of level2Ids) {
    const fact = factByIdAll.get(id);
    if (!fact) continue;
    const [a, b] = fact.requiredSpaces;
    if (!a || !b) continue;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  }

  const pairFactId = (a: string, b: string): string | undefined => {
    const [x, y] = [a, b].sort();
    return factByIdAll.has(ids.derived(`pair:${x}:${y}`))
      ? ids.derived(`pair:${x}:${y}`)
      : undefined;
  };

  const emittedClusters = new Set<string>();
  for (const [a, neighbours] of adjacency) {
    const list = [...neighbours].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const b = list[i]!;
        const c = list[j]!;
        // A triangle: all three areas mutually overlap.
        if (!adjacency.get(b)?.has(c)) continue;

        const key = [a, b, c].sort().join('|');
        if (emittedClusters.has(key)) continue;
        emittedClusters.add(key);

        const supports = [pairFactId(a, b), pairFactId(a, c), pairFactId(b, c)].filter(
          (x): x is string => !!x,
        );
        if (supports.length < 2) continue;

        const [x, y, z] = key.split('|') as [string, string, string];
        const union = new Set<string>([x, y, z]);
        for (const supportId of supports) {
          for (const space of factByIdAll.get(supportId)?.requiredSpaces ?? []) union.add(space);
        }

        facts.push({
          id: ids.derived(`cluster:${key}`),
          text: `${x}, ${y} and ${z} form a mutually staffed engineering cluster.`,
          restsOn: supports,
          level: 3,
          entities: [],
          space: x,
          requiredSpaces: [...union],
        });
        derived++;
      }
    }
  }

  const requiredCounts = facts.map((f) => f.requiredSpaces.length);
  const byLevel: Record<number, number> = {};
  for (const f of facts) byLevel[f.level] = (byLevel[f.level] ?? 0) + 1;

  return {
    facts,
    factsByEntity,
    entitiesBySource,
    stats: {
      level0: facts.filter((f) => f.level === 0).length,
      derived,
      crossSpaceDerived: crossSpace,
      byLevel,
      meanRequiredSpaces: requiredCounts.length
        ? +(requiredCounts.reduce((a, b) => a + b, 0) / requiredCounts.length).toFixed(3)
        : 0,
      maxRequiredSpaces: requiredCounts.length ? Math.max(...requiredCounts) : 0,
    },
  };
}
/**
 * Recompute required spaces by traversing the derivation, rather than trusting
 * the value cached on the node.
 *
 * Used by the audit: a security property that is only ever checked against the
 * same field that produced it is not checked at all. This walks the actual
 * support edges down to sources and unions the spaces it finds, so a
 * disagreement with `requiredSpaces` is a real bug and will be caught.
 */
export function derivedRequiredSpaces(
  factId: string,
  factById: Map<string, FactNode>,
  sourceSpace: Map<string, string>,
  depth = 0,
): Set<string> {
  const out = new Set<string>();
  if (depth > 8) return out;

  const fact = factById.get(factId);
  if (!fact) return out;

  for (const support of fact.restsOn) {
    if (support.startsWith('s:')) {
      const space = sourceSpace.get(support);
      if (space) out.add(space);
      continue;
    }
    for (const space of derivedRequiredSpaces(support, factById, sourceSpace, depth + 1)) {
      out.add(space);
    }
  }
  return out;
}
