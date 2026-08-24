# The weaker true answer

Regenerate with `npm run audit:degrade`.

> *"A level-3 cluster requires the union of everything beneath it, so its
> audience is the intersection of three or more teams — often nobody. Your graph
> derives knowledge no one may read, so the derivation is useless."*

That objection is right about the node and wrong about the information.

---

## The ceiling, measured first

A derived fact is filed under one of the spaces it requires — **623 of
623**. So `admissible_Cordon(f,p) ⇒ admissible_documentACL(f,p)`, and over
150 principals:

| | (fact, principal) pairs |
|---|---|
| both systems serve | 3,826 |
| **document-ACL only** | **9,106** — every one a leak |
| **Cordon only** | **0** |

**Cordon's disclosure set is a strict subset of the baseline's.** No answerer —
LLM or extractive — can change that; a better reader lifts both arms equally.
The baseline's entire utility edge is its leaks.

Publishing that is more useful than pretending otherwise, and it says exactly
where the remaining headroom is: **a move document-level filtering does not
have.**

## 1. Does it fire?

The derivation is a lattice. Beneath a refused conclusion sit weaker claims with
smaller requirements:

```
denied:  "A, B and C form a mutually staffed cluster"   requires {A,B,C,D,E}
served:  "people contribute to both A and B"            requires {A,B}
```

| | |
|---|---|
| refusals examined | 89,624 |
| **refusals with a weaker true answer** | **1,088 (1.2%)** |
| substitutes offered | 2,560 |

| depth | refused | recovered | rate |
|---|---|---|---|
| 1 | 71,624 | 0 | 0.0% |
| 2 | 9,000 | 408 | 4.5% |
| 3 | 9,000 | 680 | 7.6% |

Deeper facts refuse more *and* recover more — the shape the objection predicts.
Audience collapses with depth, and so does the distance to a claim the asker can
actually have.

## 2. Is it safe?

| | |
|---|---|
| substitutes not independently admissible | **0** |
| substitutes not strictly weaker | **0** |

A substitute is emitted only when it is a genuine ancestor in the derivation
DAG, passes `req ⊆ perm` **on its own merits** with no reference to the fact it
replaces, and has a requirement that is a *strict subset* of the denied fact's.

Every substitute would have been disclosable had the asker simply asked for it.
**Degradation changes what Cordon volunteers, never what it is willing to
disclose** — so the soundness theorem is untouched, and `test/degrade.test.ts`
asserts that directly.

## 3. What does it beat?

| | |
|---|---|
| document-ACL | **cannot be beaten on utility** — strict superset, because it leaks |
| Cordon without degradation | **1,088 dead ends turned into answers** |

This does not close the gap to a system that leaks, and claiming it did would be
the kind of thing [CORRECTIONS.md](CORRECTIONS.md) exists to record. It recovers
utility the gate cost **without reintroducing a single leak**, which is the only
honest direction the subset property leaves open.

The product form is a refusal that ends with *here is what you are allowed to
know* rather than a dead end.
