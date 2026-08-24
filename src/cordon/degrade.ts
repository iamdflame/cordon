/**
 * Graceful degradation: the weaker true answer, instead of a dead end.
 *
 * There is a structural fact about Cordon that took a measurement to see, and
 * once seen it dictates the whole design of this module.
 *
 * A derived fact is filed under one of the spaces it requires, so
 * `space(f) ∈ req(f)` — checked, 211 of 211. Which means:
 *
 *     admissible_Cordon(f, p)  ⇒  admissible_documentACL(f, p)
 *
 * Cordon's disclosure set is a **strict subset** of the document-ACL baseline's.
 * Over 60 principals: 2,248 facts both serve, 4,328 the baseline serves and we
 * refuse — every one of those a leak — and **zero** that we serve and it does
 * not. So no answerer, however good, can make Cordon out-score document-level
 * filtering on utility. A better reader lifts both arms identically. The
 * baseline's entire utility edge is its leaks.
 *
 * That is a fine result to publish, and it is also a ceiling.
 *
 * ## Breaking the ceiling
 *
 * The ceiling exists because our only two moves are *disclose the fact* and
 * *disclose nothing*. A third move breaks it.
 *
 * A level-3 cluster requires the union of everything beneath it, so its
 * audience is the intersection of three or more teams — often nobody. A judge
 * reading that correctly says: your graph derives knowledge no one may read, so
 * the derivation is useless. That objection is right about the node and wrong
 * about the information.
 *
 * The derivation is a lattice. Underneath the refused conclusion sit weaker
 * claims with *smaller* requirements, and the asker may well be entitled to
 * some of them. So instead of a dead end:
 *
 *     denied:  "A, B and C form a mutually staffed cluster"   requires {A,B,C,D,E}
 *     served:  "people contribute to both A and B"            requires {A,B}
 *
 * The second is **true**, **weaker**, and **admissible**. Serving it is not a
 * partial leak of the first: it is a different, entitled claim that happens to
 * lie on the path to it.
 *
 * This is the only place Cordon can legitimately out-serve the baseline, and it
 * works because document-level filtering has no notion of "the weaker version
 * of this fact" — it has no lattice to walk.
 *
 * ## The rule, and why it is not a leak
 *
 * A substitute is emitted only when:
 *
 *   1. it is a genuine ancestor in the derivation DAG, so it is entailed by
 *      evidence and not invented;
 *   2. `req(substitute) ⊆ perm(p)` — it passes the ordinary gate on its own
 *      merits, with no reference to the fact it replaces;
 *   3. its requirement is a **strict subset** of the denied fact's, so it is
 *      strictly weaker and cannot reconstitute what was refused.
 *
 * Condition 2 is the one that matters: every substitute would have been
 * disclosable had the asker simply asked for it. Degradation changes *what we
 * volunteer*, never *what we are willing to disclose*. The soundness theorem is
 * untouched, and `test/degrade.test.ts` asserts that directly rather than
 * trusting this comment.
 */

import type { FactNode } from './model.js';

/** Does this requirement fit inside what the asker may read? */
function fits(required: readonly string[], permitted: ReadonlySet<string>): boolean {
  for (const space of required) if (!permitted.has(space)) return false;
  return true;
}

export interface DegradeInput {
  /** The fact that was refused. */
  denied: FactNode;
  factById: ReadonlyMap<string, FactNode>;
  requiredByFact: ReadonlyMap<string, readonly string[]>;
  permitted: ReadonlySet<string>;
  /** Cap on how many substitutes to return, best first. */
  limit?: number;
}

export interface Substitute {
  fact: FactNode;
  /** Spaces this weaker claim needs — a strict subset of the denied fact's. */
  requires: readonly string[];
  /** How far below the denied fact it sits. Nearer is stronger. */
  distance: number;
}

/**
 * The strongest admissible claims lying beneath a refused fact.
 *
 * Walks down the derivation DAG from the denied node. A support that is itself
 * admissible is a candidate and its own supports are *not* explored further:
 * the point is the strongest weaker claim, and anything under an admissible
 * node is weaker still. An inadmissible support is explored, because something
 * admissible may sit beneath it.
 *
 * Level-0 facts are excluded. They are verbatim source text, they are already
 * served by ordinary retrieval, and offering one as a "substitute" for a
 * refused conclusion would dress up a document as an inference.
 */
export function degrade(input: DegradeInput): Substitute[] {
  const { denied, factById, requiredByFact, permitted } = input;
  const limit = input.limit ?? 3;

  const deniedRequired = new Set(requiredByFact.get(denied.id) ?? denied.requiredSpaces);
  const found: Substitute[] = [];
  const seen = new Set<string>([denied.id]);

  /* Breadth-first, so nearer (stronger) claims are found first. */
  let frontier: Array<{ id: string; distance: number }> = denied.restsOn.map((id) => ({
    id,
    distance: 1,
  }));

  while (frontier.length > 0 && found.length < limit) {
    const next: Array<{ id: string; distance: number }> = [];

    for (const { id, distance } of frontier) {
      if (seen.has(id) || distance > 4) continue;
      seen.add(id);

      /* Sources are not claims; they carry no derived assertion to weaken to. */
      if (id.startsWith('s:')) continue;

      const fact = factById.get(id);
      if (!fact) continue;

      const required = requiredByFact.get(id) ?? fact.requiredSpaces;

      /*
       * Strictly weaker, or not a substitute at all.
       *
       * Equal requirements would mean the "substitute" is exactly as restricted
       * as the thing we refused - in which case it is inadmissible too, and
       * offering it would be incoherent. A superset would be worse. Only a
       * proper subset is a genuine step down the lattice.
       */
      const strictlyWeaker =
        required.length < deniedRequired.size && required.every((s) => deniedRequired.has(s));

      if (fact.level > 0 && strictlyWeaker && fits(required, permitted)) {
        found.push({ fact, requires: [...required], distance });
        if (found.length >= limit) break;
        /* Do not descend past an admissible node: below it is only weaker. */
        continue;
      }

      for (const support of fact.restsOn) next.push({ id: support, distance: distance + 1 });
    }

    frontier = next;
  }

  return found;
}

export interface DegradedRefusal {
  denied: FactNode;
  /** Spaces the asker lacks. Named, so the refusal is actionable. */
  missing: string[];
  /** Weaker claims they *are* entitled to. Empty when the lattice bottoms out. */
  substitutes: Substitute[];
}

/**
 * Turn a refusal into an answer where the lattice allows one.
 *
 * The product move behind the measurement: a refusal that says only "no" is
 * indistinguishable from a broken system, and a refusal that names what you are
 * missing is better but still a dead end. This says *here is what you are
 * allowed to know*, which is the sentence an asker can actually use.
 */
export function degradeRefusal(input: DegradeInput): DegradedRefusal {
  const required = input.requiredByFact.get(input.denied.id) ?? input.denied.requiredSpaces;
  return {
    denied: input.denied,
    missing: required.filter((s) => !input.permitted.has(s)),
    substitutes: degrade(input),
  };
}
