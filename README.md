# Cordon

**Derived knowledge inherits the access control of everything it was derived from.**

A fact inferred from three documents is not a document. It has no ACL of its own —
so document-level filtering, which is what every enterprise AI assistant does,
has no answer for it.

**Demo video:** _<add URL before submitting>_ · **Live console:** _<add URL>_
· `docker compose up`

[Results](docs/RESULTS.md) · [**The aggregation attack**](docs/ATTACK.md) ·
[Real GitHub permissions](docs/RESULTS-GITHUB.md) · [Threat model](docs/THREAT-MODEL.md) ·
[Soundness](docs/SOUNDNESS.md) · [What runs where](docs/WHERE-IT-RUNS.md) ·
[Engine notes](docs/HYDRADB-ENGINE-NOTES.md) · [DKL benchmark](bench/dkl/)

---

## The whole argument, in one screen

| | document-level ACL<br>*what ships today* | **Cordon** |
|---|---|---|
| leak rate, 18,168 trials per system | 17.4% | **0.0%** |
| answer F1 | 0.099 | **0.099** |
| false denials | 0 | **0** |
| disclosure decided by ingest order | **1,008 of 7,280** protected pairs | **never** |
| aggregation leaks *(real GitHub permissions)* | 16 | 16 → **0** under the claim-aware rule<br>*we found this in our own system* |
| verified against | its own model of access | **GitHub's own 404** |

Everything above regenerates: `npm run audit`, `npm run audit:github`,
`npm run attack`. Raw artifacts carrying the git SHA and timestamp are committed
under [`artifacts/`](artifacts/), so every number in this file opens onto the
run that produced it.

**A leaked unit is one (fact, principal, trial) disclosure** — one fact handed
to one asker on one question they were not entitled to. The leak *rate* is the
share of trials disclosing at least one, and it is the honest headline.

---

## Three findings, in order of how much they should worry you

### 1. Document-level filtering is exactly correct — until it infers

| derivation depth | facts | ungated | document-acl | **cordon** |
|---|---|---|---|---|
| 0 — read from one artifact | 56,301 | 332,761 | **0** | **0** |
| 1 — derived across spaces | 503 | 38,345 | 3,626 | **0** |
| 2 — derived from derived | 60 | 4,176 | 400 | **0** |
| 3 — derived from those | 60 | 65,556 | 6,591 | **0** |

Zero at depth 0. That is not a compliment we are paying the baseline — it is the
finding. Document filtering does not have a bug; it has a **ceiling**, and the
ceiling is the first inference.

### 2. The baseline is not just wrong — it is *arbitrary*

A derived fact carries one space, assigned by whichever source the writer
reached first. That assignment is what a document gate reads. So we asked: would
it have answered differently had the node been filed under a different one of
*its own sources*?

| | pairs |
|---|---|
| must be withheld | 7,280 |
| **answer flips with attribution** | **1,008 — 13.8%** |
| answer stable | 6,272 |

Same graph, same permissions, same person asking, opposite answer. On real
GitHub permissions it is worse: **292 of 309 — 94%**.

A security decision settled by ingest order is not a security decision. Cordon's
answer never moves, because it never reads the attribution. It reads the
derivation.

### 3. The attack nobody else can even express

Two facts you *are* entitled to can together determine a third you are not.
Document-level filtering cannot defend against this **even in principle**,
because the thing being aggregated is not a document.

We formalised it, proved what is impossible, and mined the rest from the graph
rather than inventing examples.

> **Theorem 1.** An attacker cannot climb the derivation edges. `required(f)` is
> the union of its supports' requirements, so holding every part of a conclusion
> already entitles you to the conclusion. *Checked: 0 counterexamples.*

> **Theorem 2.** Cordon is closed under aggregation exactly when every claim
> about a space is only asserted by facts resting on that space — *claim
> locality*. So the exposure is a property of **the corpus**, not of the rule.

So we measured the premise instead of assuming it, on a fixture seeded with the
cross-repository references real issues are full of:

| gate | denied pairs | aggregation leaks | over-restricted |
|---|---|---|---|
| ungated | 130 | 130 | — |
| document-acl | 130 | 16 | — |
| **cordon** | 130 | **16** | — |
| **cordon, claim-aware** | 130 | **0** | 54 |

**Cordon leaks 16.** That is our own system failing, and we are reporting it
because it locates the mechanism exactly: a *public* issue that names a
*private* repository —

> "Ingrid Holm notes the SDK release depends on **cordon-demo-borealis**
> integration work." — public repo, asserting a claim about a private one

— so the fix follows from the diagnosis. Widen the requirement to include the
spaces a fact *names*, not only where its evidence sits. Leaks go to zero, and
it costs 54 additional withholdings. Both rules ship with their numbers; the
operator picks.

[The formalism, the mined instances, the red team →](docs/ATTACK.md)

---

## The same result, over permissions we did not write

The strongest objection to the numbers above is that we invented the access
control we then enforced. So the whole thing runs a second time against a system
that already has permissions.

```bash
npm run audit:github              # replays a snapshot — no credentials needed
npm run audit:github -- --fetch   # re-fetch live, needs `gh auth login`
```

| Cordon | GitHub |
|---|---|
| Principal | an account, **a team**, or `public` — the unauthenticated internet |
| Space | a repository |
| MEMBER_OF | collaboration, team grant, or public visibility |
| MANAGES | team nesting — child teams inherit the parent's repositories |
| Source | an issue or comment |

A real organisation: **8 repositories** (5 private, 3 public) and **11 teams
nested two deep**, every grant fetched from the API. A GitHub team *is* a
principal in GitHub's own permission model, so the hierarchy is a real access
structure read out of somebody else's system rather than an org chart we drew.

Only the loader differs from the HERB run. Extraction, entity resolution,
derivation, ingest and the admissibility rule are the same code.

**13 principals · 86 facts (26 derived) · 1,118 (fact, principal) pairs**

| gate | leaked |
|---|---|
| document-acl, filed-under | 105 |
| document-acl, any-source | 292 |
| **Cordon** | **0** |

And the attribution finding reproduces, harder: **292 of the 309 pairs that must
be withheld — 94% — flip depending on which of the fact's own sources the node
was filed under.** On real permissions, from a real org, a document-level gate's
answer is arbitrary almost every time it matters.

### The 404 is the test oracle

For every source underneath a withheld fact, the audit issues an
unauthenticated request and asserts the refusal:

```
distinct restricted sources under withheld facts   26
anonymous GET returned 404                         26
```

**26/26.** Not our model of access control — GitHub's server, answering a
request anyone can make:

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://github.com/cordon-demo/cordon-demo-fornax/issues/2
404
```

GitHub refuses to show the document. A document-level gate hands over the fact
derived from it.

> The check deliberately uses `github.com` rather than `api.github.com`. The
> unauthenticated API allows 60 requests an hour and then answers **403** to
> everything, and counting a rate-limit 403 as a pass would fabricate the exact
> result this section exists to establish. Rate limiting is detected and
> reported separately from pass and fail.

[Full GitHub results →](docs/RESULTS-GITHUB.md)

---

## The threat model

Cordon closes one channel. A security claim that names only the channel it
closed is a result, not a threat model — so all three are measured, including
the one our own defence opens.

| channel | status | size |
|---|---|---|
| **Explicit derivation** | **closed** | 0 leaks in 330,190 (fact, principal) pairs, [proved](docs/SOUNDNESS.md) and checked exhaustively |
| **Compositional inference** | **open, measured** | see [THREAT-MODEL.md](docs/THREAT-MODEL.md) |
| **Refusal side channel** | **mitigable, measured** | in bits, with a mode that closes it and the cost stated |

```bash
npm run audit:channels
```

### Compositional inference — open

A principal denied fact *F* still holds everything Cordon *did* give them. Our
rule is sound over explicit derivation and says nothing about inference: if the
permitted answers jointly determine *F*, withholding *F* accomplishes nothing.

We measure **recovery** — the share of a denied fact's claims already reachable
from facts the principal may see — and break it down by depth. Recovery falls as
depth rises, for a structural reason rather than a lucky one: a deeper fact
rests on more spaces, so a principal denied it holds a smaller share of what it
is built from. **Cordon degrades most gracefully exactly where the explicit
channel is most dangerous.**

We are not closing this channel. Sizing it is the honest position; claiming that
derived-knowledge access control defeats inference would not be.

### Refusal as an oracle — mitigable, and *we* created it

Cordon refuses **informatively**: it names the spaces you are missing. That is
the right product behaviour — it turns a refusal into a next step — and it is a
perfect oracle. An attacker who sweeps subjects and records only *which
questions were refused*, never reading a fact, maps the restricted graph.

Measured as mutual information in bits between the hidden variable (*does a
restricted fact about this subject exist?*) and what the system does.

The mitigation ships:

```bash
npm run audit -- --indistinguishable-abstention
```

A withheld answer is reported exactly as *no answer*. Channel leakage collapses.
**The cost is not answer quality** — F1 is unchanged, because the admitted set
is unchanged. The cost is that refusals stop being actionable: a legitimate user
can no longer tell *"ask someone with clearance for Beta"* from *"this is not in
the corpus."*

That is a governance decision, not an engineering one, so **both modes ship and
the operator chooses**. Picking one silently is what a demo does.

[Full measurements →](docs/THREAT-MODEL.md)

---

## Disclosure-dependent truth

Track 01 names three hard problems and contradiction is the third. The usual
answer is a trust score. We think there is a prior question, and it is one only
a system modelling **both** contest and access can ask:

> **Whether you perceive a contradiction at all depends on what you are allowed
> to see.**

If two sources conflict and sit in different spaces, a principal with access to
only one sees a single **uncontested** claim. They are not told there is another
side. They are not told the other side exists.

```
"the ledger migration is on track"   [cordon-demo-atlas]
"the ledger migration is blocked"    [cordon-demo-draco]

looks settled to 4 principals; 3 colleague pairs would receive opposite values
```

Detection is deterministic over a closed predicate set, matched against
already-resolved entities. **Nothing adjudicates** — an adjudicator would
collapse the two sides into one answer and destroy exactly the structure being
measured.

Cordon's answer is to **disclose the contest, not the content**: *"a source you
do not have access to disagrees"* names neither the claim nor its space. A user
told their answer is contested can escalate; a user told nothing cannot.

Two honesty notes, because they matter more than the number:

- **HERB contains no detectable semantic contradiction.** Name and role never
  co-occur once in 4.7M characters of document text. It is generated per product
  and is internally consistent. The 28 shared-source disagreements it *does*
  contain are **paraphrases**, not opposed claims, and are reported separately as
  description divergence rather than dressed up as contradiction.
- The opposed claims above are **seeded** into the GitHub fixture and labelled as
  seeded. The permissions they run against are real; the measurement is what is
  being demonstrated.
- The contest notice is itself a refusal-shaped side channel, and it is counted
  in the threat model rather than presented as free.

[Full analysis →](docs/CONTESTED.md)

---

## Using Cordon in your own stack

The gate is retrieval-agnostic — [proved empirically](docs/RESULTS.md), not
asserted — and stateless per call given the graph. **Keep your stack, add the
gate.**

```bash
curl -s localhost:8787/v1/admissible -H 'content-type: application/json' -d '{
  "principal": "eid_9b023657",
  "facts": [{"id": "fact:derived:person:eid_4c81"}]
}'
```

```json
{
  "admitted": [],
  "withheld": [{
    "id": "fact:derived:person:eid_4c81",
    "requires": ["EdgeForce", "PersonalizeForce", "FeedbackForce"],
    "missing": ["PersonalizeForce"],
    "chain": ["fact:claim:...", "s:EdgeForce::doc_113"]
  }]
}
```

### MCP server

```json
{ "mcpServers": { "cordon": { "command": "npx", "args": ["tsx", "src/mcp/server.ts"] } } }
```

Two tools — `ask_as(principal, question)` and `check_admissible(principal,
factIds)` — so any agent framework enforces derived-knowledge access control
with a config line.

Both surfaces **fail closed** on a fact they cannot evaluate. A gate that admits
what it cannot reason about is not a gate.

---

## Soundness

> For every fact `f` and principal `p`, if Cordon discloses `f` to `p`, then
> every source in the transitive support closure of `f` sits in a space `p` may
> read.

Proved by induction on derivation depth; the step that carries it is
union-monotonicity, `req(g) ⊆ req(f)` for every support `g` of `f`. That is
precisely why the requirement must be *computed* from supports rather than
declared on the node — a declared requirement can under-state, and an
under-stated requirement fails open silently.

Verified three ways: exhaustively over all 330,190 pairs; against a requirement
recomputed **independently** from the corpus rather than from the field the
pipeline wrote; and by a property-based test over random derivation DAGs, with a
second test that breaks a requirement on purpose and asserts the first one
catches it.

**The scope is stated in the same breath as the theorem.** It covers explicit
derivation only, and says nothing about the compositional or refusal channels —
which is why those are measured above. A soundness theorem published without its
limits invites the reader to assume it covers everything.

[The proof and its scope →](docs/SOUNDNESS.md)

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

**One command, from a clean checkout:**

```bash
docker compose up          # or: make demo
```

HydraDB, the sample graph, the API and the console at
[localhost:5173](http://localhost:5173). Deliberately the sample rather than the
full corpus — the full graph is 226,357 edges and about an hour of write-bound
ingest, and a first run should end in a working console rather than a progress
bar.

**Reproducing the published numbers** (needs the full graph):

```bash
make audit                 # build:graph, audit, audit:github, attack
```

<details>
<summary>Running it without Docker</summary>

**Requirements:** Docker (for HydraDB), Node 20+.

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
npm run audit                    # leakage, utility, retriever sweep, invariant
npm run demo:leak
```

Everything else, in rough order of how much it will change your mind:

```bash
npm run audit:github             # real permissions; no credentials needed
npm run audit:channels           # the two channels we did not close
npm run audit:contested          # disclosure-dependent truth
npm run bench:latency            # what query-time traversal costs
npm run bench:engine             # every formulation we tried against HydraDB
npm test                         # 15 tests, including property-based soundness
```

> **Note on restarting HydraDB.** The local object store does not implement
> conditional writes, so a container stopped and started over an existing store
> reads fine and fails *every* write with an opaque error. Restarting is not a
> way to resume an interrupted ingest — use `npm run hydra:up -- --reset` and
> ingest again.

The interface:

```bash
npm run api                            # :8787
cd web && npm install && npm run dev   # :5173
```

Ask as any of 530 people, watch the answer change, and see each withheld fact
with the derivation and the missing space that caused it.

</details>

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
  hydra/     client, namespaced id registry, truncation guard
  cordon/    model | corpus | acl | mentions | resolve | facts | ingest | query
             contradict — deterministic contest detection
             corpus/github — permissions fetched from a real system
  bench/     run (audit + retriever sweep) | evaluate | answer | demo
             channels — compositional and refusal side channels
             contested — disclosure-dependent truth
             github — the real-permissions audit and its 404 assertions
             latency | engine-probe | retrievers
  api/       HTTP API, including POST /v1/admissible
  mcp/       MCP server: ask_as, check_admissible
bench/dkl/   the derived-knowledge leakage benchmark, standalone
web/         React console: ask as anyone, see what is withheld and why
scripts/     hydra-up | fetch-herb | seed-github-fixture | seed-github-org
             repro-row-cap — minimal reproduction of the engine bug
docs/        results, threat model, soundness, latency, engine notes, demo guide
test/        15 tests including property-based soundness, no engine required
```

## A note on the commit history

Volunteering this costs nothing and being asked about it without an answer
would cost everything.

**The commit history is reconstructed, not literal.** The work was done in a
single continuous build; at the end it was reorganised into commits that follow
the *logical* order of construction rather than the order in which files
happened to be touched. Author dates were set to lay that sequence out
readably. So the timestamps are regular, and they are not a record of when each
line was typed.

Nothing was backdated to game the eligibility window: the whole project was
built on 18–20 August 2026, well inside it.

**This was built with Claude Code**, working from a specification and a plan
that were themselves iterated on. Every number in this repository was produced
by running the code in it, and every claim is reproducible by a reader with
`npm run audit` — which matters more than who typed it.

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
