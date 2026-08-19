# Cordon

**Derived knowledge inherits the access control of everything it was derived from.**

**Hack Hydra 2026 — Track 01: Enterprise Context + Ontology**

[Results on HERB](docs/RESULTS.md) · [Results on real GitHub permissions](docs/RESULTS-GITHUB.md) · [Engine notes](docs/HYDRADB-ENGINE-NOTES.md) · [Demo guide](docs/DEMO.md)

---

## The result

Run 1,514 HERB questions as 12 different principals sampled across the access
spectrum — 18,168 trials per system — and count how often each hands someone a
fact they were not entitled to.

| system | leak rate | leaked units | answer F1 | abstention | false denials |
|---|---|---|---|---|---|
| ungated knowledge graph | 100.0% | 440,838 | 0.075 | 0.0% | 0 |
| document-level ACL filtering | **17.4%** | **10,617** | 0.099 | 22.8% | 0 |
| **Cordon (derivation-aware)** | **0.0%** | **0** | **0.099** | 25.7% | **0** |
| BM25, no graph, no ACL | n/a | — | 0.065 | — | — |

**Document-level filtering — what deployed assistants do, and what a knowledge
graph gives you by default — leaks on 17.4% of trials. Cordon reaches 0.0% at
identical answer quality and zero false denials.** All three systems use the
same retrieval and the same answer assembly; the only difference is what each
is willing to disclose.

Both gated systems *beat* the ungated graph on F1 (0.099 vs 0.075), because
refusing evidence the asker has no business seeing also removes noise.

Reproduce: `npm run audit` — or `npm run audit -- --sample` in under ten minutes.

### Where the leak lives

| derivation depth | facts | ungated | document-acl | **cordon** |
|---|---|---|---|---|
| 0 — read from one artifact | 56,301 | 332,761 | **0** | **0** |
| 1 — derived across spaces | 503 | 38,345 | 3,626 | **0** |
| 2 — derived from derived | 60 | 4,176 | 400 | **0** |
| 3 — derived from those | 60 | 65,556 | 6,591 | **0** |

Document-level filtering is **exactly correct at depth 0** and fails the moment
knowledge is synthesised across sources. That is not an implementation defect —
it is the ceiling of the idea. A fact derived from three documents is not a
document, so there is no document whose ACL could govern it.

### The baseline is not just wrong — it is arbitrary

A derived fact carries one space, assigned when the node was written: whichever
supporting document the writer happened to reach first. That assignment is what
a document-level gate reads.

So for every (fact, principal) pair the fact must be withheld from, we asked
whether the gate would have answered differently had the same node been
attributed to a different one of *its own sources*.

| | pairs |
|---|---|
| must be withheld | 7,280 |
| **decision flips with attribution** | **1,008 — 13.8%** |
| decision stable | 6,272 |

Same graph, same permissions, same person asking — opposite answer. On one pair
in seven, a document-level gate's security decision is settled by ingest order.

Cordon's answer is invariant under attribution, because it never reads the
attribution. It reads the derivation.

### Audience collapse

A fact's audience is the intersection of the audiences of everything it rests
on, so it shrinks as derivation deepens.

| depth | mean spaces required | mean audience (of 530) | visible to nobody |
|---|---|---|---|
| 0 | 1.00 | 46.2 | 0% |
| 1 | 3.52 | 17.9 | 47% |
| 2 | 4.85 | 0.0 | 100% |
| 3 | 4.93 | 0.0 | 100% |

A knowledge graph that serves derived facts to anyone who can read *any* of
their sources discloses to 46+ people what ought to be visible to none.

---

## The same result, over permissions we did not write

The strongest objection to the numbers above is that we invented the access
control we then enforced. So the whole thing runs a second time against a system
that already has permissions.

```bash
npm run audit:github          # replays a snapshot — no credentials needed
npm run audit:github -- --fetch   # re-fetch live, needs `gh auth login`
```

| Cordon | GitHub |
|---|---|
| Principal | an account, or `public` — the unauthenticated internet |
| Space | a repository |
| MEMBER_OF | collaboration, or public visibility |
| Source | an issue or comment |

Three real repositories — two private, one public. Only the loader differs;
extraction, entity resolution, derivation, ingest and the admissibility rule are
the same code, unchanged.

A person named in the public handbook *and* in both private repositories
produces a derived fact that a document-level gate discloses to the anonymous
internet. Cordon withholds it. The audit then requests the underlying source
without credentials:

```
$ curl -s -o /dev/null -w '%{http_code}'     https://api.github.com/repos/iamdflame/cordon-demo-borealis/issues/4
404
```

**GitHub refuses to show the document. The fact derived from it was handed over
anyway.** The ground truth here is not our model of access control — it is an
HTTP status code from someone else's server.

[Full GitHub results →](docs/RESULTS-GITHUB.md)

---

## The hero scenario

`npm run demo:leak` — discovered from the corpus, not hardcoded.

> **Question:** *"What are the changes suggested by Engineering Lead to improve
> the Product Vision Document for AnomalyForce?"*
>
> **Answer:** *"Bob Brown (Engineering Lead) is active across 4 product areas:
> AnomalyForce, CollaborateForce, InsightForce, VizForce."*
> — a level-1 derived fact. No single document states it.
>
> **Requires** (by traversal): `AnomalyForce`, `CollaborateForce`, `InsightForce`, `VizForce`

| asked by | may read | ungated | document-acl | **cordon** |
|---|---|---|---|---|
| **David Miller**, VP Engineering | all four | discloses | discloses | **discloses** |
| **Bob Brown**, VP Engineering | AnomalyForce, CollaborateForce | discloses | **discloses — leak** | **withholds** |

Bob can read two of the four spaces this fact rests on. Document-level filtering
checks only `AnomalyForce` — the space the fact is filed under — and waves it
through. Cordon walks the derivation, finds `VizForce` and `InsightForce`
underneath, and withholds.

---

## Why this must be a graph

The rule:

```
requiredSpaces(fact) = union of requiredSpaces of everything it rests on
admissible(fact, p)  = requiredSpaces(fact) ⊆ permittedSpaces(p)
```

Union on the requirement side is **intersection on the audience side**.

`admissible` is a reachability question with a per-principal predicate, and it
**cannot be precomputed**: with *n* principals there are 2ⁿ visibility subsets.
It has to be traversed, at query time, per asker.

```cypher
-- what this fact depends on: walk its support chain down to evidence
MATCH (f:Fact {id: $fact})-[:RESTS_ON*1..5]->(s:Source) RETURN s.space

-- what this person may read: own grants, and their whole reporting line
MATCH (p:Principal)-[:MEMBER_OF]->(sp:Space {name: $space}) RETURN p.eid
MATCH (m:Principal)-[:MANAGES]->(r:Principal) RETURN m.eid, r.eid
```

A level-3 fact has **no edge to any space at all**. Its chain is
`cluster → pairing → person → claim → source` — four hops before anything with
a space on it. There is no field to read; the answer only exists as a walk.

## What breaks without HydraDB

- **Admissibility is a variable-length traversal**, not a lookup. Remove path
  traversal and there is no Cordon — only a list of documents.
- **The requirement is discovered, never stored.** The audit re-derives every
  fact's required spaces by traversal and compares against a value computed
  independently from the corpus. That check found a real bug (below); a
  denormalised column would have hidden it.
- **A relational schema** would need recursive CTEs over a 226k-edge graph, per
  principal, per query, and would still have to materialise the closure that the
  2ⁿ argument says cannot be materialised.
- **A vector index cannot express it in principle.** An embedding records what a
  fact *resembles*. It carries no record of what the fact was *derived from*, and
  a constraint that must propagate along derivation has nothing to travel down.
  Similarity is not provenance.

The graph holds **95,898 nodes and 226,357 edges**: principals, spaces, sources,
and facts, joined by `MEMBER_OF`, `MANAGES`, `IN_SPACE`, `OBSERVES`, `ABOUT` and
`RESTS_ON`.

---

## The corpus

Salesforce **HERB**, used unmodified — a synthetic enterprise of 530 employees,
30 product spaces and 38,600 artifacts, with 1,514 questions carrying
ground-truth answers.

Two properties make it the right corpus:

- **506 of 530 employees sit on more than one product team.** Access genuinely
  overlaps, so a cross-product fact has a real intersection audience.
- **91.4% of (principal, space) pairs are denied.** That is the surface area a
  leak can occur across.

<details>
<summary>Full breakdown</summary>

```
530 employees · 18 org roots · 512 management edges · 1,370 team memberships
 30 product spaces
38,600 artifacts — 33,632 Slack · 3,562 PRs · 635 links · 400 docs · 321 transcripts
 1,514 questions — 815 answerable (577 with list-valued answers), 699 unanswerable
```

HERB ships no ACL annotations, so the permission model is synthesised from the
org chart and rosters the dataset *does* provide: team membership grants space
access, and managers inherit their reports' access transitively. The model is
synthetic; the organisation it is derived from is the dataset's own.
</details>

---

## Entity resolution, and why it is the hard part

Access decisions attach to people, so identity has to be right before anything
else can be. In this corpus that is genuinely difficult:

- **530 employees share 10 first names.** 63 Hannahs, 62 Charlies, 61 Davids.
- **92 of the 98 distinct full names are duplicated.** "Charlie Garcia" is
  several different people.

Every record-linkage technique that scores surface forms is blind here, because
the strings are *identical*. What separates them is structure:

| constraint | narrows to | signal |
|---|---|---|
| name index (blocking) | ~62 | who this could be at all |
| **co-presence** | 1–3 | identifiers anchored in the same artifact |
| **roll call** | authoritative | a meeting's participants, a PR's reviewers |
| space roster | ~46 | the product team, where no roll call exists |
| proximity | 1 | the nearest anchor in the text |

```
81,375 mentions extracted from 38,600 artifacts
71,242 resolved, 10,133 abstained
candidates narrowed 8.9 → 1.53
precision 100.0%   recall 99.0%      (n = 12,068 held out)
```

The held-out set is the corpus's own structure: transcripts record participants
as identifiers and then refer to those people by name in the body, so the name
mentions are labelled data the extractor never saw.

**The resolver abstains rather than guess.** An earlier version fell back to the
product roster when a roll call did not contain the name — it resolved 73 such
mentions and got *every single one wrong*, picking a same-named teammate who was
not in the room. Where identity determines access, a confidently wrong identity
is the worst possible failure. Those 73 are now abstentions, and precision went
from 99.4% to 100.0%.

---

## The bug worth recording

Fourteen artifact ids appear in more than one product — shared external links
like `www_tensorflow_org`, cited by six different teams. Collapsing them into one
graph node gave that node whichever space happened to load last, and **every
fact resting on it inherited the wrong access requirement.**

It was caught because the audit re-derives required spaces by traversal instead
of trusting the cached field: 47 facts disagreed with themselves. Node identity
is now space-scoped (`AnomalyForce::www_tensorflow_org`), which is marginally
over-restrictive for genuinely public links and is the direction that fails
closed. Disagreements went to zero.

A second instance of the same class: level-2 facts initially declared their
requirement as the pair of spaces that *named* them, while the traversal found
five. The traversal was right — a pairing derived from two person-facts inherits
every area those people touch. Under-stating a requirement is under-restriction.

**A security property that is only ever checked against the field that produced
it is not being checked at all.** The first version of the exhaustive invariant
check compared `admissible(required)` against `admissible(required)` — the same
value twice — and could not have failed. It now compares the graph traversal
against a requirement recomputed from the corpus.

---

## Verifying every claim

| claim | command | where |
|---|---|---|
| Leak rate 0.0%, F1 0.099 | `npm run audit` | `docs/RESULTS.md` |
| Hero scenario, two principals | `npm run demo:leak` | stdout |
| ER precision 100.0% / recall 99.0% | `npm run build:graph -- --dry` | stdout |
| Edge plan, 226,357 edges | `npm run build:graph -- --dry` | stdout |
| 330,190 pairs, 0 violations | `npm run audit` | `docs/RESULTS.md` |
| Security invariants | `npm test` | 13 tests, no engine needed |

---

## Running it

**Requirements:** Docker, Node 20+.

```bash
npm install
npm run hydra:up                 # HydraDB; a local directory is the object store
bash scripts/fetch-herb.sh       # the corpus, ~28MB

# fast path — three overlapping spaces, full pipeline, minutes not hours
npm run build:graph -- --sample
npm run audit -- --sample

# full corpus
npm run build:graph -- --dry     # plan only: reports the edge budget
npm run build:graph              # ~226k edges, write-bound
npm run audit
npm run demo:leak
```

The interface:

```bash
npm run api                            # :8787
cd web && npm install && npm run dev   # :5173
```

Ask as any of 530 people, watch the answer change, and see each withheld fact
with the derivation and the missing space that caused it.

---

## How it works

```
HERB corpus
    |
    +- mentions      81,375 person references in 4 registers
    +- resolution    structural narrowing; abstains when ambiguous
    +- facts         56,301 read from sources + 623 derived, to depth 3
    |                requiredSpaces = union of supports
    v
 HydraDB            95,898 nodes | 226,357 edges
    |               Principal -MEMBER_OF-> Space <-IN_SPACE- Source <-RESTS_ON- Fact
    v
 query time         required(fact) by traversal; permitted(principal) from the
                    org closure; disclosed iff required is a subset of permitted
```

### What we learned about the engine

`docs/HYDRADB-ENGINE-NOTES.md` is a capability map built by probing, not by
reading documentation. Findings that changed the architecture:

- **Results cap at 1,024 rows and cursors expire immediately.** A query over
  1,371 access-control edges returned exactly 1,024 with no error, silently
  dropping a quarter of the ACL table. `offset`/`page_token`/`start` are ignored
  rather than rejected, so pagination appears to work. Authorisation lookups now
  go through `queryComplete()`, which throws on truncation, and membership is
  fetched per space.
- **A variable-length traversal composed with a further hop is pathological.**
  `MANAGES*1..6` alone: 287ms. The same plus one fixed hop: 30s timeout, at every
  depth. The cost is the composition, not the depth.
- **Cells are isolated shards.** Four cells give 1.6× write throughput, but a
  write to `cell-0` is invisible from `cell-1` — sharding would sever every
  cross-shard traversal.
- **`CREATE` takes exactly one hop**, no batching; node ids must be integers.

---

## Limitations

- **The permission model is synthesised.** HERB has no ACLs; membership and
  management inheritance are our model over the dataset's real org chart.
- **Absolute F1 is low** (0.099 against a 0.065 lexical baseline). The retrieval
  is deliberately conventional BM25 — the contribution is the disclosure
  boundary, not the ranker — and 238 `content` questions requiring generated
  prose are excluded from scoring, since no language model is used anywhere.
- **Fact extraction is deterministic and shallow.** Sentence-level heuristics,
  capped at 2 facts per artifact to stay inside the engine's write budget. Every
  run is byte-identical.
- **The compositional channel is open.** Cordon closes *explicit* derivation: it
  will not hand you a fact whose provenance you lack. It says nothing about
  *inferential* reconstruction — whether several separately-permitted answers
  together narrow a denied fact to near-certainty. We discovered this channel and
  have not measured it. Naming it is more honest than implying it is closed.
- **Over-restrictive on genuinely public artifacts**, by choice — see the bug.
- **Ingest is write-bound** at ~50–130 edges/s. Built once, re-attached after.
- **Cordon governs disclosure, not correctness.** It decides whether you may be
  told something, not whether that something is true.

## Layout

```
src/
  hydra/     HydraDB client, namespaced integer id registry, truncation guard
  cordon/    model | corpus | acl | mentions | resolve | facts | ingest | query
  bench/     evaluation, leak audit, hero scenario
  api/       HTTP API
web/         React console: ask as anyone, see what is withheld and why
docs/        results, engine capability map
test/        13 tests, no engine required
```

## Attribution

- **HydraDB** — object-store-native graph engine
  ([hydra-db/hydradb](https://github.com/hydra-db/hydradb), AGPL-3.0), run as the
  published container image.
- **HERB** — [Salesforce/HERB](https://huggingface.co/datasets/Salesforce/HERB),
  CC-BY-NC-4.0, used unmodified as corpus and ground truth.
- **Fastify**, **undici**, **React**, **Vite** — MIT.
- Typefaces: Space Grotesk, JetBrains Mono — SIL Open Font License.

No language model is used at any point in the pipeline.

## License

Apache-2.0. See `LICENSE`.
