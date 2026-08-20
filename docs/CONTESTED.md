# Disclosure-dependent truth

Regenerate with `npm run audit:contested`.

Track 01 names three hard problems: entity resolution, ontology alignment, and
*"figuring out which of two contradictory statements to trust."* The usual
answer to the third is a trust score - recency, seniority, a model asked to
adjudicate.

We think there is a prior question, and it is one only a system that models
**both** contest and access can ask:

> **Whether you perceive a contradiction at all depends on what you are allowed
> to see.**

If two sources conflict and they sit in different spaces, a principal with
access to only one sees a single uncontested claim. They are not told there is
another side. They are not told the other side exists.

## Detection

Deterministic and adjudication-free: a closed set of predicates
(`role`, `status`, `decision`, `timing`) matched by pattern over entities that
entity resolution has already resolved. No model decides anything.

That is a deliberate constraint rather than a shortcut. An adjudicator would
collapse the two sides into one answer and destroy exactly the structure being
measured - the fact that different people are holding different answers.

| predicate | claims extracted |
|---|---|
| status | 8 |
| decision | 4 |
| role | 1 |

13 claims total; 4 (subject, predicate) pairs where sources
disagree, of which **4** have their sides in different spaces.

## The interaction

Contested-ness and access are independent axes. This is what happens where they
meet.

| | count |
|---|---|
| facts contested globally | 4 |
| ...that appear **uncontested** to at least one principal | **4** |
| mean principals to whom a contested fact looks settled | 7.0 |
| **colleague pairs who would receive opposite values** | **7** |
| mean principals who see no side at all | 10.8 |

For **4** facts, whether you see a contradiction at all is determined by
your clearance. Two colleagues ask the same question and receive confidently
opposed answers, and neither is told the other side exists.

That is not a retrieval bug and no trust score addresses it. It is a property of
serving a partitioned corpus to people with different partitions - and it is
invisible to any system that does not model access and contest together.

## Concrete

**status** of `the ledger migration`

> "the ledger migration is on track" — `cordon-demo-atlas`
>
> "the ledger migration is blocked" — `cordon-demo-draco`

Looks settled to 4 principals. 3 colleague pairs would walk away holding opposite values.

---

**decision** of `the headcount plan`

> "the headcount plan is rejected" — `cordon-demo-draco`
>
> "The headcount plan is approved" — `cordon-demo-fornax`

Looks settled to 4 principals. 4 colleague pairs would walk away holding opposite values.

## What Cordon does about it

**Disclose the contest, not the content.**

When a fact is contested by a source the asker cannot see, the console says:

> *N sources you do not have access to disagree with this.*

It names neither the conflicting claim nor its space. A user who is told their
answer is contested can escalate; a user told nothing cannot. Admissibility is
unchanged - a contested fact still inherits the union of its supports'
requirements, because conflict changes what a *permitted* answer looks like, not
who is permitted.

## The cost, counted honestly

The contest notice is itself a refusal-shaped side channel: the notice carries a
bit about the restricted graph, in exactly the way
[the refusal oracle](https://github.com/iamdflame/cordon#the-threat-model) does.

It is counted there rather than presented as free. A mitigation that opens a
channel and does not say so is not a mitigation.
