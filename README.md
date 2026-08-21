# Cordon

**Derived knowledge inherits the access control of everything it was derived from.**

A fact inferred from three documents is not a document. It has no ACL of its own —
so document-level filtering, which is what every enterprise AI assistant does,
has no answer for it.

Cordon gives it one, and proves the rule sound. Then it does the part that
actually decides whether a security system is real: **it attacks its own proof,
finds where the proof does not reach, and publishes the price of closing the
gap.**

### **[cordon-graph.vercel.app](https://cordon-graph.vercel.app)** · [open the console →](https://cordon-graph.vercel.app/console)

**Demo video:** [Watch the pitch and demo](https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n)

---

## Two confidentiality properties, and only one of them is free

Nearly every access-control claim in AI conflates these. Separating them is the
whole contribution.

| | **provenance confidentiality** | **content confidentiality** |
|---|---|---|
| the question | did the system *hand over* a fact the asker lacks rights to? | at the end, does the asker *know* the restricted thing? |
| Cordon's status | **closed**, [proved by induction](docs/SOUNDNESS.md) | **measured and priced**, not closed by default |
| evidence | 0 leaks in 330,190 (fact, principal) pairs | 1,208 phantom denials in 120,206 |
| **cost** | **0.000 F1 — free** | **37.7% of the evidence an asker may legitimately read** |

**A refusal that the asker can undo is not a refusal.** Cordon's derivation
rules are deterministic and ship in this repository under Apache-2.0, so an
adversary does not reverse-engineer them — they `git clone` them, run *our own
rules* over the facts we disclosed, and rebuild some of what we refused. We
measured that against ourselves:

| depth | denied | rebuilt anyway | verdict |
|---|---|---|---|
| 1 | 96,206 | **0** | **tight** — the requirement is exactly as strong as it needs to be |
| 2 | 12,000 | 804 (6.7%) | phantom |
| 3 | 12,000 | 404 (3.4%) | phantom |

A **phantom denial** satisfies the soundness theorem perfectly and protects
nothing. It costs the asker an answer, costs the operator a support ticket, and
returns zero — while appearing on a dashboard as protection. *It is a lie the
system tells its owner.*

Closing one is a **minimum cut**, not a stronger requirement — the asker is
rebuilding the claim from evidence they are *entitled* to, and no requirement on
the derived node can reach that evidence. We compute those cuts exactly, verify
every one by re-running the adversary, and state what they cost.

> **[The full result → docs/INFERENCE.md](docs/INFERENCE.md)** · `npm run audit:inference`

---

## And then the number that makes it shippable

37.7% is unshippable. No operator destroys a third of their staff's legitimate
access. But that figure prices safety against an adversary who has **aggregated
everything they are entitled to** — and someone reading one answer is not that
adversary.

So we made the disclosure decision over the *set* instead of per fact:

```
choose D ⊆ Admissible(p)   maximising utility(D)
subject to  closure(D) ∩ Protected(p) = ∅
```

| top-k | plans where it bit | claims prevented | evidence retained |
|---|---|---|---|
| 10 | 0 | 0 | **100.0%** |
| **20** *(production depth)* | **0 of 1,200** | 0 | **100.0% — free** |
| 50 | 12 | 60 | 97.6% |
| 100 | 60 | 144 | 96.2% |
| 200 | 192 | 504 | 88.8% |

**At production retrieval depth, inference safety is free — 0 violations in
1,200 planned queries — and it first bites at k=50.** That is a measured phase
transition, not a claim: an answer simply does not carry enough evidence to
rebuild with until you retrieve deep enough.

**But per-query safety does not compose.** Ten individually safe answers can
jointly rebuild a refused claim — the aggregation attack, moved from documents
to sessions. A gate that only looks at the current reply is safe against a
reader and useless against an attacker, who will ask twice. So Cordon keeps a
**disclosure ledger** per principal and evaluates the constraint over everything
they have been shown:

| | query 1 | query 30 |
|---|---|---|
| evidence retained (cumulative, n=3,520) | 100.0% | **80.7%** |

Confidentiality stops being a yes/no and becomes **a budget that degrades
gracefully**. Answers keep coming until the asker's own history starts to
determine something they were refused — and then, precisely then, withholding
begins. Every session across the audit verified safe.

> **[The full result → docs/PLANNER.md](docs/PLANNER.md)** · `npm run audit:planner`
> · live at `POST /v1/plan`

---

> **Judges — the 90-second path.** No API keys, no accounts.
> ```bash
> docker compose up        # clean checkout to a working console
> npm run audit:github     # real GitHub permissions; 26/26 404 assertions
> npm run attack           # the aggregation attack, and the 16 → 0 fix
> npm run audit:inference  # we attack our own proof, and price the defence
> npm run audit:planner    # and the planner that makes the fix shippable
> npm run audit:policy     # what one grant actually costs: 100% invisible
> ```
> Or click the console above — it is a live HydraDB instance, not a mock.

[**Provenance is not content**](docs/INFERENCE.md) ·
[**Inference-safe planning**](docs/PLANNER.md) ·
[**Testing our own lower bound**](docs/LLM-ADVERSARY.md) ·
[**What a grant costs**](docs/POLICY.md) · [Results](docs/RESULTS.md) ·
[**The aggregation attack**](docs/ATTACK.md) · [**What we got wrong**](docs/CORRECTIONS.md) ·
[Real GitHub permissions](docs/RESULTS-GITHUB.md) · [Disclosure-dependent truth](docs/CONTESTED.md) ·
[Soundness](docs/SOUNDNESS.md) · [**HydraDB capability map**](docs/HYDRADB-ENGINE-NOTES.md) ·
[DKL benchmark](bench/dkl/) · [Demo guide](docs/DEMO.md)

---

## And the feature that only a derivation-aware system can have

An administrator adds one person to one team. Every access-review tool in
existence tells them what that grants: **the documents in that space.** That is
correct, and it is not the whole answer.

```
before:   Alice may read {A, B}       F requires {A, B, C}   denied
grant C:  Alice may read {A, B, C}    F requires {A, B, C}   DISCLOSED
```

Nobody granted Alice access to *F*. Nobody was asked about *F*. **F is not a
document, so it appears in no document-level access review.**

Over 150 single grants on the full corpus:

| | |
|---|---|
| documents disclosed | 713,882 — *what the administrator expects* |
| **derived facts disclosed** | **380** — *invisible to a document-level review* |
| **…unlocked only in combination** | **380 — 100.0%** |
| refused claims made *rebuildable* (30 grants) | 18 |

> **Every single derived fact a grant disclosed required a space the principal
> already held.** None were granted. All were *completed* — and the
> administrator approving "read access to one space" approved every one of them
> without being shown a single one.

`POST /v1/policy/preview` computes this **before** the change is applied. You can
only compute the blast radius of a grant if you have modelled derivation — and
if you have modelled derivation, you are obliged to.

> **[The full result → docs/POLICY.md](docs/POLICY.md)** · `npm run audit:policy`

---

## Two things a security product needs that a benchmark does not

### The log must not become the leak

The obvious audit record for a refusal is *"withheld fact F from Alice"*, with
F's text alongside so a reviewer can see what was protected. **That record is a
second copy of the secret**, in a file almost always readable by more people than
the fact was. A system that refuses to tell Alice something and then writes it
into a log her platform team can read has not protected anything — it has moved
the disclosure somewhere nobody is looking.

Cordon's log records **identifiers and requirement metadata, never content**, and
[refuses at write time](src/cordon/audit.ts) to store a field named `text`,
`content`, `body`, `snippet`, `answer` or `summary`. You can prove what was
decided, for whom, and on what grounds. You cannot read the withheld fact out of
the log, because it is not in there.

### A log you cannot verify is a log the attacker can edit

An append-only file is append-only until someone opens it in an editor — and the
threat is not an outsider, it is an insider deleting the line that records what
they did. Entries are **hash-chained**: each carries a SHA-256 over its contents
and the previous entry's hash.

`test/audit.test.ts` forges the log four ways and requires the verifier to catch
each one and say where:

| attack | detected |
|---|---|
| edit one entry | ✅ at that index |
| delete an entry | ✅ |
| reorder two entries | ✅ |
| **edit an entry *and* recompute its hash** | ✅ — at the *next* entry, which still commits to the old hash |

That last row is why it is a chain and not a checksum.

```bash
curl -s localhost:8787/api/audit/verify
# {"ok":true,"meaning":"every entry hashes to its recorded value and follows the previous entry"}
```

### And it is gated on every commit

```bash
npm run report
```

Nine properties, checked against the committed artifacts, **exit non-zero when
one stops holding.** It separates *fail* (fix the code) from *stale* (re-run the
audit), because collapsing them makes the second look like the first and wastes
an hour. Wired into [CI](.github/workflows/security.yml).

> A security property nobody checks on every commit is a security property you
> **used to** have.

---

## Everything in this repository

Every row is a command that regenerates the number next to it, writing a
provenanced artifact under [`artifacts/`](artifacts/) carrying the git SHA, the
corpus digest and the seed.

### The audits

| what it establishes | command | written to |
|---|---|---|
| **0 leaks / 18,168 trials, at 0.000 F1 cost** | `npm run audit` | [RESULTS.md](docs/RESULTS.md) |
| **Real GitHub permissions — 26/26 404 assertions** | `npm run audit:github` | [RESULTS-GITHUB.md](docs/RESULTS-GITHUB.md) |
| **The aggregation attack: 16 → 0** | `npm run attack` | [ATTACK.md](docs/ATTACK.md) |
| **1,208 phantom denials; the cut costs 37.7%** | `npm run audit:inference` | [INFERENCE.md](docs/INFERENCE.md) |
| **Set-level safety: free at k=20, bites at k=50** | `npm run audit:planner` | [PLANNER.md](docs/PLANNER.md) |
| **We point an LLM at our own lower bound** | `npm run audit:llm` | [LLM-ADVERSARY.md](docs/LLM-ADVERSARY.md) |
| **100% of a grant's derived disclosures are invisible** | `npm run audit:policy` | [POLICY.md](docs/POLICY.md) |
| Refusal as an oracle, measured in bits | `npm run audit:channels` | [the threat model](#the-threat-model) &mdash; the audit also writes a standalone `docs/THREAT-MODEL.md` |
| Disclosure-dependent truth | `npm run audit:contested` | [CONTESTED.md](docs/CONTESTED.md) |
| What query-time traversal costs | `npm run bench:latency` | stdout |
| What the engine will and will not do | `npm run bench:engine` | [HYDRADB-ENGINE-NOTES.md](docs/HYDRADB-ENGINE-NOTES.md) |
| **Every property still holds, or the build fails** | `npm run report` | stdout, exit code |
| **58 tests — no engine required** | `npm test` | — |

### The product

| surface | what it does |
|---|---|
| **Console** — [live](https://cordon-graph.vercel.app/console) | three views: **Ask** (did this answer disclose correctly), **Risk surface** (where the org is exposed), **Disclosure budget** (what a session has given away) |
| `POST /v1/admissible` | the per-fact gate. Post what your retrieval found; get back what this principal may see and exactly which spaces they lack. |
| `POST /v1/plan` | **the set-level gate.** Returns the largest subset whose *closure* cannot rebuild anything the asker was refused. `session: true` evaluates against their whole history. |
| `GET /api/risk` | the exposure map: derived facts ranked by how few people may read them |
| `POST /v1/policy/preview` | **what a grant actually costs**, computed before you apply it — including the derived facts no access review shows |
| `GET /api/audit` · `/api/audit/verify` | the decision log — **hash-chained**, so an edited or deleted entry is detectable, and **content-free**, so it cannot become a second copy of what was withheld |
| **MCP server** | `ask_as`, `check_admissible`, `plan_disclosure` — an agent is the hardest caller, because it asks forty questions and stitches the answers together |

### The proofs and the corrections

| | |
|---|---|
| [**SOUNDNESS.md**](docs/SOUNDNESS.md) | the theorem, by induction — and precisely what it does *not* cover |
| [**CORRECTIONS.md**](docs/CORRECTIONS.md) | ten things we got wrong, found by us, with the commit that fixed each |
| [**the threat model**](#the-threat-model) | every channel, including the ones our own defence opens. `npm run audit:channels` writes it out as `docs/THREAT-MODEL.md`; that needs the ingested graph, so it is regenerated rather than committed |
| [bench/dkl/](bench/dkl/) | the derived-knowledge leakage benchmark, standalone |

---

## The whole argument, in one screen

| | document-level ACL<br>*what ships today* | **Cordon** | delta |
|---|---|---|---|
| **leak rate** — 18,168 trials each | 17.4% | **0.0%** | **−100%** |
| **leaked facts** | 10,617 | **0** | **−10,617** |
| **answer F1** | 0.099 | **0.099** | **0.000 — no utility cost** |
| false denials | 0 | **0** | — |
| disclosure decided by ingest order | 1,008 of 7,280 pairs | **never** | — |
| aggregation leaks *(real GitHub perms)* | 16 | 16 → **0** claim-aware | *we found this in our own system* |
| verified against | its own model of access | **GitHub's own 404** | — |
| **denials our own rules undo** | *never measured* | **1,208 of 120,206** | *we attacked our own proof* |
| **price of closing them** | — | **37.7% of readable evidence** | *content security is not free* |

> **Read the third row first.** Eliminating every leak cost us **nothing**. Cordon
> and the deployed baseline answer *identically well* — 0.099 F1 on both — while
> Cordon leaks zero facts across 18,168 trials, with zero false denials. Security
> here is not a trade against utility. It is free.
>
> **Then read the last two rows, because they are the ones that cost us
> something to publish.** "Free" is true of *provenance* — of never handing over
> a fact you lack rights to. It is not true of *content*. When we built an
> adversary that runs our own published rules over what we disclosed, it rebuilt
> 1,208 denials we had counted as protection, and closing those costs 37.7% of
> an asker's legitimate evidence. A system that reports only the first number
> has not looked for the second.

For reference: retrieval with no graph at all (BM25) scores **0.065**, and the
ungated graph scores **0.075** while leaking **440,838** facts. Both gated
systems *beat* the ungated graph, because refusing evidence the asker has no
business seeing also removes noise.

**On the absolute number.** HERB scores answers by strict set match against
ground-truth ids, so absolute F1 is low for every system including the ungated
upper bound. The comparison across identical retrieval is the measurement; the
absolute is a property of the benchmark. We also ran the whole audit under three
different retrievers — BM25, a dense index, and an *oracle* fed the benchmark's
own citations — and the leak column does not move. The finding survives your
retriever, including one much better than ours.

The console at [cordon-graph.vercel.app/console](https://cordon-graph.vercel.app/console)
runs against a **live backend**: a HydraDB node and the Cordon API, both hosted,
serving the real GitHub permissions below. Requirements are resolved by
traversing `RESTS_ON` in the graph at the moment you load the page — the badge
at the top says so.

If the container is cold it falls back to a **verified transcript** captured
byte-for-byte from a real run and committed under
[`artifacts/console-capture.json`](artifacts/console-capture.json) with its git
SHA. The page always tells you which one you are looking at. A visitor should
never meet an empty page because a container was asleep, and should never be
left guessing whether what they are reading is real.

Everything above regenerates: `npm run audit`, `npm run audit:github`,
`npm run attack`. Raw artifacts carrying the git SHA and timestamp are committed
under [`artifacts/`](artifacts/), so every number in this file opens onto the
run that produced it.

### How to catch us being wrong

Every number above is a mean over committed rows, not a figure typed into a
markdown file:

```bash
npm run audit   # writes artifacts/audit-rows.jsonl + audit-summary.json
npm test        # recomputes every score from those rows; fails on disagreement
```

The suite fails if the README, the summary and the raw rows disagree; **if the
three evaluation arms were handed different evidence**; or if any Cypher in the
source breaks a constraint the engine actually enforces.

That middle one is the claim everything here rests on. "Identical retrieval,
only disclosure differs" used to be a comment. Each arm now hashes the candidate
list it was handed, and the audit **exits non-zero** if the three ever disagree —
a comparison between arms that saw different evidence is not a result, so it
should not be publishable.

Runs record a sha256 over the corpus, the git SHA, and the seed, because "we ran
it on HERB" is not reproducible if HERB can move underneath us.

**[We keep a list of what we got wrong →](docs/CORRECTIONS.md)** — an invariant
that compared a value to itself and hid a real bug for hours; a claim
decomposition that made its own premise true by construction; a demo URL that
404'd for the wrong reason; an assertion that was really a rate limit. Numbers
that only ever go up are a warning sign, not a track record.

**A leaked unit is one (fact, principal, trial) disclosure** — one fact handed
to one asker on one question they were not entitled to. The leak *rate* is the
share of trials disclosing at least one, and it is the honest headline.

---

## Why this matters beyond Track 1

HydraDB is sold as the substrate for enterprise ontologies and company brains.
Our depth-0 result is the finding: document-level filtering leaks **zero** facts
read from a single artifact — and **3,626** at the first inference.

Document filtering does not have a bug. It has a **ceiling**, and the ceiling is
the first inference. Which means:

> **Migrating an enterprise from a document store to a knowledge graph creates an
> access-control vulnerability that did not previously exist. The graph becomes
> unsafe at exactly the moment it becomes useful.**

Every enterprise knowledge graph inherits this. We measured it across 18,168
trials, validated it against GitHub's own 404s rather than our own model of
access, and found an aggregation leak in our own system while doing it.

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

## What we learned about HydraDB

The engine notes are not an appendix. They are the part of this project a
database team can act on, and they exist because every one of these cost real
time to find.

| what we hit | consequence | what we did |
|---|---|---|
| **Results silently truncate at 1,024 rows**, returning a `next_cursor` that is already expired | A query for the membership relation returned 1,024 of 1,371 edges with **no error**. A quarter of an access-control table, missing, looking exactly like success | `queryComplete` throws on truncation-with-cursor; membership is read partitioned per space. Filed upstream |
| **Variable-length `MATCH` requires a fixed source id** — `variable-length MATCH requires a fixed source id` | A transitive closure over a whole relation cannot be asked for; it has to be driven from the client, one bound start node at a time | The org closure is application-side. Filed upstream ([#117](https://github.com/hydra-db/hydradb/issues/117)) |
| **Composing a variable-length walk with a further fixed hop is pathological** — measured at 287ms alone against a 30s timeout composed, on the full graph | The natural phrasing of a two-relation authorization question is unusable | The requirement traversal reads `s.space` as a property rather than hopping to the `Space` node |
| **No batch write path.** `UNWIND $batch` exists but rejects labels in batch node patterns; multi-statement requests are rejected | 226,357 edges is 226,357 round trips | Paced ingest. Filed upstream |
| **`MATCH (n)` with no label or predicate is rejected** | Health probes fail confusingly | Probe names a label |
| **Alternation inside a variable-length pattern is rejected** (`-[:A\|B*1..n]->`) | The support relation cannot be typed | One `RESTS_ON` edge type, kind carried as a property |
| **The local object store does not implement conditional writes** | A container restarted over an existing store reads fine and fails **every** write | An interrupted ingest cannot be resumed; `hydra:up --reset` |
| **Sustained write pressure exits the node** (255, not OOM) at 80–83%, preceded by `evictor queue skipped cache write/access event ... full 289 times in the last 30s` | A single-node full ingest is marginal | Ingest paced *down* by default — raising concurrency does not help, because writes serialise internally |

The first one is the important one. **A silent truncation in an authorization
query is the worst failure mode available**: it fails open, and it looks exactly
like success. Our client now refuses to accept a truncated result that carries a
continuation cursor.

All three are **filed upstream with reproductions**, because a bug found and not
reported is a bug the next person finds too:

- [hydra-db/hydradb#115](https://github.com/hydra-db/hydradb/issues/115) — results silently truncate at 1024 rows; continuation cursor returns an empty page
- [hydra-db/hydradb#116](https://github.com/hydra-db/hydradb/issues/116) — no batch write path for labelled nodes; sustained write pressure exits the node
- [hydra-db/hydradb#117](https://github.com/hydra-db/hydradb/issues/117) — five OpenCypher subset constraints, and one silent write failure

We also publish **what does not run in the engine.** The requirement traversal —
the walk the whole thesis rests on — runs in HydraDB, per asker, at query time.
The transitive org closure is application-side, because of row two above. A
reviewer who discovers that themselves reads it as a hole in the claim; measured
and published, it is a capability map.

[The full capability map →](docs/HYDRADB-ENGINE-NOTES.md)

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
request anyone can make. Run both, in the same organisation, with no
credentials either time:

```
$ curl -so /dev/null -w '%{http_code}' https://github.com/cordon-demo/cordon-demo-handbook
200

$ curl -so /dev/null -w '%{http_code}' https://github.com/cordon-demo/cordon-demo-fornax/issues/2
404
```

The pair is the point: **the 404 is about permission, not existence.** GitHub
refuses to show the document. A document-level gate hands over the fact derived
from it.

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
| **Compositional inference** | **measured and priced** | 1,208 phantom denials; closing them costs 37.7% of readable evidence — [INFERENCE.md](docs/INFERENCE.md) |
| **Refusal side channel** | **mitigable, measured** | in bits, with a mode that closes it and the cost stated |
| **Set-level inference** | **closed at production depth** | 0 violations in 1,200 planned queries; first bites at k=50 — [PLANNER.md](docs/PLANNER.md) |
| **A stronger (LLM) adversary** | **tested, inconclusive** | the channel is absent from this corpus, and we say so — [LLM-ADVERSARY.md](docs/LLM-ADVERSARY.md) |

```bash
npm run audit:channels
```

### Compositional inference — measured, priced, and it is *our* proof that breaks

A principal denied fact *F* still holds everything Cordon *did* give them. Our
soundness theorem is sound over **provenance** and says nothing about what the
asker can rebuild. So we built the adversary and pointed it at ourselves.

The adversary does not guess our rules. **They are in this repository, under
Apache-2.0** — Kerckhoffs's principle with unusual force. It takes the facts
Cordon disclosed and runs *our own derivation rules* to fixpoint:

```
phantom(p) = Denied(p) ∩ closure(Permitted(p))    the denial bought nothing
```

**Depth 1 is tight — 0 phantoms in 96,206 denials.** A level-1 fact names every
space its subject works in; an asker who cannot read one of them cannot observe
the subject there, so the set they reach is strictly smaller and the claim does
not match. The requirement is exactly as strong as it needs to be.

**Depths 2 and 3 are not — and it is a fix we were right to make that broke
them.** `pair:A:B` asserts something about A and B alone, but inherits the union
of every space its supports touch. We raised that requirement deliberately after
traversal caught it under-stated ([the bug worth recording](#the-bug-worth-recording))
— which was **correct for provenance and worth nothing for content**. Cordon now
demands five spaces to read a claim two spaces are enough to derive, and
everyone holding exactly `{A, B}` is refused a fact they rebuild in one step.

Both halves of that sentence are worth publishing. Raising the requirement was
not a mistake; believing it bought confidentiality was.

**Closing it is a cut, not a stronger requirement.** The asker is not at the
front door — they are rebuilding the claim from evidence they are entitled to,
and no requirement on the derived node reaches that evidence. The only defence
is to withhold that evidence, which is a **minimum vertex cut on the derivation
hypergraph**. The structure decomposes exactly, so we do not approximate:

| gate | shape | minimum cut |
|---|---|---|
| `span(e,a,b)` | AND of two ORs | `min(|facts(e,a)|, |facts(e,b)|)` |
| `pair(a,b)` | ≥2 of n spans | `sum(costs) − max(cost)` |
| `cluster(a,b,c)` | all 3 pairs | `min` over the three pair costs |

Optimality is **checked, not asserted**: `test/closure.test.ts` enumerates every
subset of the evidence on small instances and requires the solver to match the
true minimum exactly. *That test failed on its first run* — and the bug was in
the test, which is recorded in the file rather than quietly fixed. Every cut the
audit computes is then verified by re-running the adversary against it;
400 of 400 attempted held.

The price: **37.7% of the evidence an asker may legitimately read.** We ship the
measurement rather than the mitigation-on-by-default, because destroying a third
of a colleague's legitimate access is a governance decision, not an engineering
one. What a security product owes its operator is the number.

```bash
npm run audit:inference
```

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

_Regenerate the full write-up with_ `npm run audit:channels`.

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

### The set-level gate

`/v1/admissible` answers the per-fact question. [We showed that is not
sufficient](docs/INFERENCE.md): what an answer leaks is a property of the *set*,
and every fact in a reply can be individually admissible while the reply as a
whole re-derives something the asker was refused.

`POST /v1/plan` answers the set question. Post your ranked candidates; get back
the subset that is safe to serve, plus what was dropped and **which protected
claim it would have completed**.

```bash
curl -s localhost:8787/v1/plan -H 'content-type: application/json' -d '{
  "principal": "eid_9b023657",
  "facts": [{"id": "f:..."}, {"id": "f:..."}],
  "session": true
}'
```

```json
{
  "safe": true,
  "disclosed": [ ... ],
  "suppressed": [{
    "id": "f:AnomalyForce::doc_902#0",
    "wouldComplete": ["pair|AnomalyForce|EdgeForce"]
  }],
  "stats": { "admissible": 8, "disclosed": 6, "retention": 0.75 },
  "ledger": { "size": 17, "queries": 12 }
}
```

`session: true` evaluates the constraint against everything this principal has
already been shown, because **per-query safety does not compose.** The ledger is
what turns a per-answer check into a guarantee that survives an attacker asking
twice. Measured live: over a 16-query session the ledger grew to 17 facts,
`determines` rose 0 → 3 claims, and suppression began exactly when history
started reaching protected ground.

> In this build ledgers are in memory, which is right for a demo and wrong for a
> deployment — a ledger that resets when the process restarts hands the attacker
> a way to clear their own budget. Said here rather than discovered later.

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
| Security invariants | `npm test` | 58 tests, no engine needed |
| 1,208 phantom denials; cut cost 37.7% | `npm run audit:inference` | [`docs/INFERENCE.md`](docs/INFERENCE.md) |
| Cuts are *minimum*, vs. brute force | `npm test` | `test/closure.test.ts` |
| Inference safety free at k=20, bites at k=50 | `npm run audit:planner` | [`docs/PLANNER.md`](docs/PLANNER.md) |
| Session budget: 100% → 80.7% over 30 queries | `npm run audit:planner` | [`docs/PLANNER.md`](docs/PLANNER.md) |
| Planner is safe; greedy retains 92.7% of optimal | `npm test` | `test/planner.test.ts` |
| LLM adversary recovers nothing, and why | `npm run audit:llm` | [`docs/LLM-ADVERSARY.md`](docs/LLM-ADVERSARY.md) |
| One grant discloses 100% invisible derived facts | `npm run audit:policy` | [`docs/POLICY.md`](docs/POLICY.md) |
| Log tampering is detected four ways | `npm test` | `test/audit.test.ts` |
| Every property still holds | `npm run report` | exit code |

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
npm run audit:inference          # we attack our own proof: 1,208 phantom denials
npm run audit:planner            # the planner that makes the fix shippable
npm run audit:llm                # we point an LLM at our own lower bound
npm run audit:policy             # what one grant actually discloses
npm run report                   # gate every property; non-zero on regression
npm run audit:github             # real permissions; no credentials needed
npm run audit:channels           # the channels our own defence opens
npm run audit:contested          # disclosure-dependent truth
npm run bench:latency            # what query-time traversal costs
npm run bench:engine             # every formulation we tried against HydraDB
npm test                         # 58 tests: soundness, cut optimality, planner, policy, tamper detection
```

`audit:inference`, `audit:planner` and `audit:llm` need **no engine** — they
recompute requirements from the corpus by traversal, which is the independent
derivation the main audit already checks the graph against. `audit:llm` replays
a committed response cache, so it reproduces byte-for-byte **without an API
key**; set `OPENAI_API_KEY` only if you want to extend the cache.

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

Three views:

- **Ask** — ask as any of 530 people, watch the answer change, and see each
  withheld fact with the derivation and the missing space that caused it.
- **Risk surface** — every derived fact ranked by how few people may read it.
  This is knowledge no document contains, so no document ACL can describe it.
- **Disclosure budget** — the live ledger for the selected asker: facts
  disclosed, and the number of claims their own history already determines.

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
  `MANAGES*1..6` alone: 287ms, measured on the full graph. The same plus one fixed hop: 30s timeout, at every
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
- **Content confidentiality is priced, not closed.** Cordon closes *provenance*:
  it will not hand you a fact whose sources you lack. [We measured what that is
  worth](docs/INFERENCE.md) and found 1,208 denials our own published rules
  rebuild anyway. Minimum cuts close them at 37.7% of an asker's legitimate
  evidence, and we ship that as a measurement rather than a default.
- **Our adversary runs *our* rules, so every leak number is a lower bound** —
  and [we tried to break that bound rather than just declaring it](docs/LLM-ADVERSARY.md).
  A language model reading permitted prose recovered **nothing**, and the reason
  is measurable rather than flattering: **0 of 16,594 level-0 facts name a
  product area other than their own**, so there was nothing to cross-reference.
  That measures HERB, not Cordon. The caveat stands as *untested here*, not
  disproved. Per-claim cuts are exact minima; the joint cut across a principal's
  phantoms is an upper bound, since computing it exactly is set-cover.
- **The planner's subset choice is greedy, not optimal.** Exact maximisation is
  NP-hard. The *safety* of every plan is exact and re-checked against the rule
  engine; the *utility* is a heuristic, and `test/planner.test.ts` measures it at
  **92.7% of the optimal subset** rather than asserting it is good.
- **Disclosure ledgers are per principal and in memory.** Two colluding askers
  pool histories and nothing here measures that, and a process restart clears
  every budget. Both are deployment gaps, not research ones, and both are real.
- **Over-restrictive on genuinely public artifacts**, by choice — see the bug.
- **Ingest is write-bound** at ~50–130 edges/s. Built once, re-attached after.
- **Cordon governs disclosure, not correctness.** It decides whether you may be
  told something, not whether that something is true.

## Layout

```
src/
  hydra/     client, namespaced id registry, truncation guard
  cordon/    model | corpus | acl | mentions | resolve | facts | ingest | query
             closure — the adversary that re-runs our own rules, and the
                       minimum cuts that close what it rebuilds
             planner — disclosure decided over the *set*, plus the
                       per-principal ledger that makes it hold across a session
             policy — editable policy, compiled to the enforced model, with
                      impact preview: what a grant actually costs
             audit — hash-chained decision log that refuses to store content
             contradict — deterministic contest detection
             corpus/github — permissions fetched from a real system
  bench/     run (audit + retriever sweep) | evaluate | answer | demo
             inference — provenance vs content, phantom denials, cut pricing
             planner — what set-level safety costs per query, per session,
                       and at every retrieval depth
             policy — the blast radius of one grant, measured
             report-card — gates every property; exits non-zero on regression
             llm-adversary — a stronger attacker, cached so it reproduces
             channels — compositional and refusal side channels
             contested — disclosure-dependent truth
             github — the real-permissions audit and its 404 assertions
             latency | engine-probe | retrievers
  api/       HTTP API: POST /v1/admissible (per fact), POST /v1/plan (per set,
             inference-safe, session-aware), GET /api/risk
  mcp/       MCP server: ask_as, check_admissible
bench/dkl/   the derived-knowledge leakage benchmark, standalone
web/         React console, three views: Ask (did this answer disclose
             correctly), Risk surface (where the org is exposed), Disclosure
             budget (what a session has given away)
scripts/     hydra-up | fetch-herb | seed-github-fixture | seed-github-org
             repro-row-cap — minimal reproduction of the engine bug
docs/        results, threat model, soundness, latency, engine notes, demo guide
test/        58 tests: property-based soundness, brute-forced cut
             optimality, README-vs-artifact binding. No engine required.
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

**No language model is used at any point in the pipeline** — not in extraction,
resolution, derivation, or admissibility. Every number in this repository is
byte-reproducible without an API key.

A model appears in exactly one place, as an *attacker*:
[`docs/LLM-ADVERSARY.md`](docs/LLM-ADVERSARY.md) points one at our own
lower-bound caveat. Its responses are cached and committed, keyed by a SHA-256
of the exact prompt, so that audit reproduces without a key too.

## License

Apache-2.0. See `LICENSE`.
