/**
 * Contradiction detection, and the thing only Cordon can say about it.
 *
 * Track 01 names three hard parts: entity resolution, ontology alignment, and
 * deciding which of two contradictory statements to trust. The third is
 * normally answered with a trust score - source recency, author seniority, a
 * model asked to adjudicate. We do not do that, because there is a prior
 * question that falls out of our own rule and that a trust score cannot reach:
 *
 *   **Whether you perceive a contradiction at all depends on what you are
 *   allowed to see.**
 *
 * If two sources conflict and they sit in different spaces, a principal with
 * access to only one of them sees a single uncontested claim. They are not
 * told there is another side. They are not told the other side exists. Two
 * colleagues ask the same question and receive confidently opposed answers,
 * and neither has any signal that the other was given something different.
 *
 * Contested-ness and access are independent axes. Their interaction is the
 * finding, and it is only visible to a system that models both.
 *
 * Detection is deterministic - a closed set of predicates matched by pattern
 * over resolved entities. No model adjudicates anything, which matters: an
 * adjudicator would collapse the two sides into one answer and destroy exactly
 * the structure being measured.
 */

import type { Artifact, Corpus } from './model.js';

/**
 * What a claim is about.
 *
 * `description` is deliberately separated from the rest and is **not** reported
 * as contradiction. See `sharedSourceDisagreements` for why: divergent
 * descriptions of the same source are paraphrases, and calling a paraphrase a
 * contradiction would be the kind of overclaim that costs a reader their trust
 * in every other number here.
 */
export type Predicate = 'role' | 'status' | 'decision' | 'timing' | 'description';

/** Predicates where two different values genuinely oppose each other. */
export const OPPOSING: ReadonlySet<Predicate> = new Set<Predicate>([
  'role',
  'status',
  'decision',
  'timing',
]);

export interface Claim {
  subject: string;
  predicate: Predicate;
  /** Normalised value, so "is blocked" and "is Blocked." collide. */
  value: string;
  /** The literal text, for display. */
  quote: string;
  space: string;
  /** Artifact key. */
  source: string;
}

export interface Contradiction {
  subject: string;
  predicate: Predicate;
  /** One entry per distinct value, with the spaces asserting it. */
  sides: Array<{ value: string; spaces: string[]; sources: string[]; quote: string }>;
  /** Every space involved on any side. */
  spaces: string[];
  /** True when the sides do not all sit in the same space. */
  crossSpace: boolean;
}

/* ------------------------------------------------------------------------ */

const ROLE_WORDS =
  '(?:chief [a-z]+ officer|vp(?: of)? [a-z]+|vice president(?: of)? [a-z]+|' +
  '[a-z]+ (?:lead|manager|director|architect|engineer|designer|analyst|scientist)|' +
  'head of [a-z]+|product manager|engineering lead|technical architect)';

const STATUS_WORDS =
  '(?:blocked|unblocked|complete|completed|done|delayed|slipping|on track|at risk|' +
  'cancelled|canceled|paused|shipped|launched|deferred)';

const DECISION_WORDS =
  '(?:approved|rejected|declined|signed off|not approved|on hold|greenlit|deprioritised|deprioritized)';

/**
 * Normalise so trivial variants do not read as disagreement.
 *
 * This is deliberately aggressive. A false contradiction is worse than a missed
 * one here: the whole measurement is about how often sides genuinely differ,
 * and inflating that count with punctuation would make the finding worthless.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:is|was|are|were|has been|been)\s+/, '')
    .replace(/^(?:a|an|the)\s+/, '')
    .replace(/\bcanceled\b/, 'cancelled')
    .replace(/\bdeprioritized\b/, 'deprioritised')
    .replace(/\bcompleted\b/, 'complete')
    .replace(/\bdone\b/, 'complete')
    .trim();
}

/** Subjects other than people: the projects and documents a space argues about. */
function subjectKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract claims from one artifact.
 *
 * `entities` is the set of employee ids entity resolution observed in this
 * artifact, so a role claim can be attached to a resolved person rather than to
 * a string that merely looks like a name.
 */
export function extractClaims(
  artifact: Artifact,
  corpus: Corpus,
  entities: Set<string>,
): Claim[] {
  const claims: Claim[] = [];
  const text = artifact.text;

  /* ---- role: "Bob Brown is the Engineering Lead" / "Bob Brown, VP ..." --- */
  for (const employeeId of entities) {
    const employee = corpus.employees.get(employeeId);
    if (!employee) continue;
    const name = employee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${name}\\s+(?:is|was)\\s+(?:the|a|an|our)?\\s*(${ROLE_WORDS})`, 'gi'),
      new RegExp(`${name}\\s*,\\s*(${ROLE_WORDS})`, 'gi'),
      new RegExp(`(${ROLE_WORDS})\\s+${name}\\b`, 'gi'),
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const value = normalise(match[1] ?? '');
        if (!value) continue;
        claims.push({
          subject: employeeId,
          predicate: 'role',
          value,
          quote: match[0].trim(),
          space: artifact.space,
          source: artifact.key,
        });
      }
    }
  }

  /* ---- status and decision, about a named project or document ----------- */
  const objectPattern =
    '((?:[A-Z][A-Za-z0-9]*(?:Force|Doc|Document|Spec|Plan|Roadmap|Migration|Launch|Release))' +
    '|(?:the [A-Za-z]+ (?:migration|launch|release|rollout|cutover|integration|review|plan|' +
    'rework|notification|assessment)))';

  for (const [predicate, words] of [
    ['status', STATUS_WORDS],
    ['decision', DECISION_WORDS],
  ] as const) {
    const pattern = new RegExp(`${objectPattern}\\s+(?:is|was|has been|were)\\s+(${words})`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const subject = subjectKey(match[1] ?? '');
      const value = normalise(match[2] ?? '');
      if (!subject || !value) continue;
      claims.push({
        subject,
        predicate,
        value,
        quote: match[0].trim(),
        space: artifact.space,
        source: artifact.key,
      });
    }
  }

  /* ---- timing: "X ships in September" ----------------------------------- */
  const timing = new RegExp(
    `${objectPattern}\\s+(?:ships|launches|releases|lands|goes live)\\s+` +
      `(?:on|in|by)\\s+([A-Z][a-z]+(?:\\s+\\d{1,2})?|Q[1-4]|\\d{4}-\\d{2}-\\d{2})`,
    'g',
  );
  for (const match of text.matchAll(timing)) {
    const subject = subjectKey(match[1] ?? '');
    const value = normalise(match[2] ?? '');
    if (!subject || !value) continue;
    claims.push({
      subject,
      predicate: 'timing',
      value,
      quote: match[0].trim(),
      space: artifact.space,
      source: artifact.key,
    });
  }

  return claims;
}

/**
 * Description divergence, which is what HERB actually contains - and which is
 * not the same thing as contradiction.
 *
 * Thirty-three artifact ids appear in more than one product: shared links,
 * cited by several teams. Twenty-eight of them carry different text in
 * different spaces.
 *
 * We looked hard for semantic contradiction in HERB and did not find it. Name
 * and role never co-occur once in 4.7M characters of document text; there are
 * no conflicting status or decision claims. HERB is generated per product and
 * is internally consistent, and saying so is better than tuning a detector
 * until a number appears.
 *
 * What the divergence *does* show is real and worth reporting on its own terms:
 * **which version of a shared source's description you receive is decided by
 * which space you can read.** These are paraphrases - "GitHub repository of the
 * TensorFlow library for machine learning" against "GitHub repo of the
 * TensorFlow library for deep learning applications" - so nobody is being told
 * opposite things. They are being told *different* things, by an assistant that
 * presents each as the description.
 *
 * It is also the same structure that produced our worst bug: collapsing those
 * ids into one node gave it whichever space loaded last, and every fact resting
 * on it inherited the wrong access requirement.
 */
export function sharedSourceDisagreements(corpus: Corpus): Claim[] {
  const byCitation = new Map<string, Artifact[]>();
  for (const artifact of corpus.artifacts) {
    const list = byCitation.get(artifact.id);
    if (list) list.push(artifact);
    else byCitation.set(artifact.id, [artifact]);
  }

  const claims: Claim[] = [];
  for (const [citation, copies] of byCitation) {
    if (copies.length < 2) continue;

    /*
     * Normalise before comparing. Two teams citing the same link with different
     * whitespace are not disagreeing, and counting them as though they were
     * would make the measurement worthless.
     */
    const seen = new Map<string, Artifact>();
    for (const copy of copies) {
      const key = copy.text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) seen.set(key, copy);
    }
    if (seen.size < 2) continue;

    for (const [normalised, copy] of seen) {
      claims.push({
        subject: citation,
        predicate: 'description',
        value: normalised,
        quote: copy.text.replace(/\s+/g, ' ').trim().slice(0, 180),
        space: copy.space,
        source: copy.key,
      });
    }
  }
  return claims;
}

/** Group claims and keep the ones where sources genuinely disagree. */
export function findContradictions(claims: Claim[]): Contradiction[] {
  const grouped = new Map<string, Claim[]>();
  for (const claim of claims) {
    const key = `${claim.predicate}::${claim.subject}`;
    const list = grouped.get(key);
    if (list) list.push(claim);
    else grouped.set(key, [claim]);
  }

  const out: Contradiction[] = [];
  for (const [key, list] of grouped) {
    const byValue = new Map<string, Claim[]>();
    for (const claim of list) {
      const bucket = byValue.get(claim.value);
      if (bucket) bucket.push(claim);
      else byValue.set(claim.value, [claim]);
    }
    if (byValue.size < 2) continue; // everyone agrees

    const parts = key.split('::');
    const sides = [...byValue].map(([value, group]) => ({
      value,
      spaces: [...new Set(group.map((g) => g.space))],
      sources: [...new Set(group.map((g) => g.source))],
      quote: group[0]!.quote,
    }));
    const spaces = [...new Set(sides.flatMap((s) => s.spaces))];

    out.push({
      predicate: parts[0] as Predicate,
      subject: parts.slice(1).join('::'),
      sides,
      spaces,
      // The interesting case: the sides do not all sit together, so which of
      // them you can see is decided by your access rather than by the evidence.
      crossSpace: sides.some((s) => s.spaces.some((sp) => !sides[0]!.spaces.includes(sp))),
    });
  }

  return out;
}

export interface DisclosureDependentTruth {
  contested: number;
  crossSpaceContested: number;
  /** Contested facts that look settled to at least one principal. */
  looksSettledToSomeone: number;
  /** Mean number of principals a contested fact looks settled to. */
  meanPrincipalsSeeingOneSide: number;
  /** Pairs of principals who would receive opposite values for the same query. */
  opposedPairs: number;
  /** Principals who see no side at all. */
  meanPrincipalsSeeingNothing: number;
  examples: Array<{
    subject: string;
    predicate: Predicate;
    sides: Array<{ value: string; spaces: string[]; quote: string }>;
    settledFor: number;
    opposed: number;
  }>;
}

/**
 * The interaction: contested-ness against access.
 *
 * For each contradiction, ask how many principals see every side (and so know
 * it is contested), how many see exactly one (and so believe it settled), and
 * how many pairs of colleagues would walk away holding opposite values.
 */
export function measureDisclosureDependentTruth(
  contradictions: Contradiction[],
  readable: Map<string, Set<string>>,
): DisclosureDependentTruth {
  const principals = [...readable.keys()];
  let looksSettled = 0;
  let settledSum = 0;
  let nothingSum = 0;
  let opposedTotal = 0;
  const examples: DisclosureDependentTruth['examples'] = [];

  for (const contradiction of contradictions) {
    // For each principal, which sides can they see?
    const visibleSides: string[][] = [];
    let settledFor = 0;
    let seesNothing = 0;

    for (const principal of principals) {
      const permitted = readable.get(principal) ?? new Set<string>();
      const seen = contradiction.sides
        .filter((side) => side.spaces.some((space) => permitted.has(space)))
        .map((side) => side.value);
      visibleSides.push(seen);
      if (seen.length === 1) settledFor++;
      if (seen.length === 0) seesNothing++;
    }

    // Colleagues who would walk away with opposite values.
    let opposed = 0;
    for (let i = 0; i < visibleSides.length; i++) {
      const a = visibleSides[i]!;
      if (a.length !== 1) continue;
      for (let j = i + 1; j < visibleSides.length; j++) {
        const b = visibleSides[j]!;
        if (b.length !== 1) continue;
        if (a[0] !== b[0]) opposed++;
      }
    }

    if (settledFor > 0) looksSettled++;
    settledSum += settledFor;
    nothingSum += seesNothing;
    opposedTotal += opposed;

    if (examples.length < 5 && contradiction.crossSpace && opposed > 0) {
      examples.push({
        subject: contradiction.subject,
        predicate: contradiction.predicate,
        sides: contradiction.sides.map((s) => ({
          value: s.value,
          spaces: s.spaces,
          quote: s.quote,
        })),
        settledFor,
        opposed,
      });
    }
  }

  const n = Math.max(contradictions.length, 1);
  return {
    contested: contradictions.length,
    crossSpaceContested: contradictions.filter((c) => c.crossSpace).length,
    looksSettledToSomeone: looksSettled,
    meanPrincipalsSeeingOneSide: settledSum / n,
    opposedPairs: opposedTotal,
    meanPrincipalsSeeingNothing: nothingSum / n,
    examples,
  };
}

/**
 * What to tell an asker whose view of a contested claim is one-sided.
 *
 * Disclose the *contest*, not the content: "a source you do not have access to
 * disagrees" names neither the conflicting claim nor its space. That is the
 * right product answer - a user who is told their answer is contested can
 * escalate, and a user who is told nothing cannot.
 *
 * It is also, unavoidably, a refusal-shaped side channel: the notice itself
 * carries a bit about the restricted graph. It is counted as such in
 * docs/THREAT-MODEL.md rather than being presented as free.
 */
export function contestNotice(
  contradiction: Contradiction,
  permitted: Set<string>,
): string | null {
  const visible = contradiction.sides.filter((s) => s.spaces.some((sp) => permitted.has(sp)));
  if (visible.length === 0 || visible.length === contradiction.sides.length) return null;
  const hidden = contradiction.sides.length - visible.length;
  return (
    `${hidden} source${hidden === 1 ? '' : 's'} you do not have access to ` +
    `disagree${hidden === 1 ? 's' : ''} with this.`
  );
}
