# DKL — derived-knowledge leakage

A benchmark for a question nobody currently measures:

> **How much does your knowledge graph disclose to people who were not entitled
> to what it was built from?**

Every enterprise RAG system reports retrieval quality. None reports disclosure.
That is not because disclosure does not fail — it is because there was no way to
ask, so the question was never on anyone's dashboard.

This is the smallest interface that makes it askable about *your* system.
Nothing here depends on Cordon, on HydraDB, or on how you retrieve.

---

## The failure being measured

A fact derived from three documents is not a document. It has no ACL of its own.
So a knowledge graph built over a permissioned corpus quietly launders
restricted material into an unrestricted form — and no file-access audit will
ever show it, because what leaked was never a file.

The rule DKL scores against:

```
required(u) = ⋃ { space(s) : s ∈ transitive sources of u }
entitled(u, p) ⟺ required(u) ⊆ permitted(p)
```

Union on requirements is intersection on audience. A unit synthesised from two
spaces is visible to the intersection of their audiences, not the union.

**Ground truth is computed from the corpus**, by walking supports to the leaves —
never from a field the system under test wrote. That distinction is not
pedantry. Our own first invariant check compared a value against itself, could
not have failed, and passed for hours.

---

## Metrics

| metric | what it says |
|---|---|
| **leak rate** | share of (unit, principal) pairs disclosed without entitlement |
| **leaks by level** | the same, split by derivation depth. The *shape* is the finding: document-level filtering is exactly correct at level 0 and fails progressively above it |
| **false denials** | pairs withheld that should have been disclosed. Stops "refuse everything" from winning |
| **attribution flips** | pairs that must be withheld where the answer changes depending on which of the unit's *own* sources it was filed under. A nonzero value means the decision is settled by ingest order rather than by anything about the asker |

Attribution flips is the metric we would most like other people to adopt. It
does not measure how often a system is wrong; it measures whether its answer is
*well-defined at all*.

---

## Running it

The reference results below come from Cordon's own audits, which implement this
interface over two corpora:

```bash
npm run audit          # HERB: 18,168 trials per system
npm run audit:github   # a real GitHub org, permissions fetched not modelled
```

`adapter.ts` is the standalone interface — it imports nothing from Cordon, from
HydraDB, or from any retriever, so you can implement it against your own stack.

## Adding a corpus

Implement `CorpusAdapter` in [`adapter.ts`](adapter.ts):

```ts
export interface CorpusAdapter {
  readonly name: string;
  sources(): Iterable<Source>;              // verbatim artifacts, one space each
  units(): Iterable<Unit>;                  // knowledge, with `restsOn`
  permissions(): PermissionModel;           // who may read what
  questions?(): Iterable<Question>;         // optional, to score utility too
}
```

**Fetch the permissions; do not assert them.** A benchmark whose access control
is invented by the person being benchmarked measures nothing. The reference
GitHub adapter reads repository visibility and team grants from the API and
treats an unauthenticated 404 as ground truth — the test oracle is somebody
else's server.

## Adding a system

```ts
export interface SystemUnderTest {
  readonly name: string;
  discloses(principal: PrincipalId, units: Unit[]): Unit[] | Promise<Unit[]>;
}
```

Given an asker and candidate units, return what you would disclose. Retrieval,
ranking and answer generation are yours and are deliberately out of scope —
we found the leak column is invariant across three very different retrievers,
so the ranker is not what is being tested.

---

## Reference results

See [`leaderboard.json`](leaderboard.json). Current entries, both corpora:

| corpus | system | leaked | attribution flips |
|---|---|---|---|
| HERB | ungated | 440,838 units · 100.0% of trials | — |
| HERB | document-acl | 10,617 units · 17.4% of trials | 1,008 / 7,280 |
| HERB | derivation-aware | **0** · **0.0%** | **0** |
| GitHub | document-acl (filed-under) | 105 of 1,118 pairs | 292 / 309 |
| GitHub | document-acl (any-source) | 292 of 1,118 pairs | 292 / 309 |
| GitHub | derivation-aware | **0** | **0** |

The GitHub rows carry one extra assertion the HERB rows cannot: for every source
under a withheld fact, an unauthenticated request to GitHub returns 404 —
**26/26**. The test oracle is somebody else's server.

Submit a result by opening a PR that adds an entry to `leaderboard.json` with
the command that reproduces it.

---

## What this benchmark does *not* cover

Stated up front, because a benchmark that implies completeness is worse than no
benchmark.

- **Compositional inference** — whether permitted answers jointly reconstruct a
  denied one. Measured separately in [the threat model](https://github.com/iamdflame/cordon#the-threat-model).
- **Refusal side channels** — whether the refusal itself is informative. Also
  measured there.
- **Timing** — deeper units traverse further; we have not measured whether the
  correlation is exploitable.
- **Whether your permissions are correct.** DKL measures whether your knowledge
  respects them.
