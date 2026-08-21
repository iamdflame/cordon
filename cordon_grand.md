# Cordon → Grand Champion: execution prompt

Paste everything below the line into Claude Code, run from the repo root.

---

## Context

You are working on **Cordon**, a Hack Hydra 2026 Track 01 submission (enterprise context +
ontology) built on HydraDB. Repo state as of now:

- ~6,200 LOC TypeScript, 19 commits, single author, started Aug 18.
- Graph loaded from Salesforce HERB: 95,898 nodes, 226,357 edges.
- Thesis: **derived knowledge inherits the access control of everything it was derived from.**
- `src/cordon/acl.ts` builds the permission lattice (team membership + transitive management).
- `src/cordon/query.ts` resolves requirements and entitlement by Cypher traversal
  (`RESTS_ON*1..6`, `MANAGES*1..6`, `MEMBER_OF`).
- `src/hydra/client.ts` already exposes `isReachable`, `shortestPath`, `singleSourcePaths`,
  `queryComplete`.
- `src/bench/` runs 1,514 HERB questions × 12 principals = 18,168 trials and reports a
  leak-rate table against two baselines.
- `web/src/App.tsx` is a console that re-asks a question as a different principal.
- **Demo video published:** https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n

Judging criteria, in the organisers' own order: technical execution; use of HydraDB and
graph-native approaches; product completeness and usability; quality of results; originality.
Two rounds — best in Track 01 first, then the three track winners compared head to head.

## Strategic objective

Cordon already wins on originality. It is behind the strongest entries in other tracks on
graph-op density, test depth, and deployment. **Do not try to out-build them on volume.**
Win by making the security claim the kind of result the other entries structurally cannot
produce, and by removing every mechanical reason to mark Cordon down.

The wedge: competing systems do **document-level ACL filtering**. That approach cannot, even
in principle, defend against an *aggregation attack* — two facts a principal is entitled to
which together derive a third fact they are not entitled to. Cordon can, because derivation is
an edge in the graph rather than a property of a document. Make that the centrepiece.

## Non-negotiable integrity rules

These are load-bearing, not boilerplate. Cordon's entire thesis is auditability; a judge who
catches one invented number discards the whole submission, and judges can clone and run this.

1. **Every published number comes from a real run.** No estimated, projected, or illustrative
   figures anywhere — README, docs, web UI, or video.
2. **Commit raw artifacts** for every headline number: the judged rows, the seed, the git SHA,
   the wall-clock timestamp. If a number is in the README, a judge must be able to open the
   file behind it.
3. **Do not rewrite, backdate, or squash existing commit history.** Judges read it. The current
   history is clean and well-messaged; it is an asset.
4. **Report failures.** If the exhaustive invariant finds a leak in Cordon, publish it and
   explain the residual. A stated limitation beats a discovered one by an enormous margin.
5. **No new dependency on anything you cannot run offline during the demo.**

---

# Work packages, priority order

Work strictly top-down. Each package must leave the repo green and committed before you start
the next. If you run out of time, everything above the line you reached still ships coherently.

## P0 — Mechanical disqualification risks (do these first, they are cheap)

**P0.1 Demo video. Complete.** Published at
https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n with the aggregation attack as
the centrepiece.

**P0.2 Deploy the console.** `web/` must be live at a URL a judge can open without setup,
with a read-only demo graph pre-loaded so first paint shows a result, not a connection form.
Put the URL in the README's first three lines. Fall back to a hosted static export driven by
captured query responses if a live HydraDB instance is not affordable — but if you do that,
say so plainly in the README.

**P0.3 One-command bring-up.** `docker compose up` (or a single `make demo`) must take a clean
checkout to a working system. Test it in a fresh clone in a scratch directory. A judge who
hits a setup error stops judging.

## P1 — The aggregation attack (this is where the gap is made)

This is the single highest-leverage piece of work in the plan. Build it as
`src/attack/` with results in `docs/ATTACK.md`.

**P1.1 Formalise the attack class.** A principal `p` is *entitled* to fact `f` iff for every
source `s` with `f -[:RESTS_ON*]-> s`, there is a path `p -> space(s)`. An **aggregation leak**
is a fact `f` where `p` is not entitled to `f`, but `p` is entitled to every fact in some set
`F` such that `F` derives `f`. Document-level filtering returns `F`, and the model composes
`f` from it. State this definition precisely in `docs/ATTACK.md` with the graph predicates.

**P1.2 Mine real instances from the HERB graph.** Do not hand-craft examples. Traverse the
existing derivation graph to enumerate actual (principal, forbidden-fact, entitled-support-set)
triples. Report how many exist across all 530 principals. The count is the headline number —
"document-level ACL filtering admits N aggregation leaks on this corpus" is a finding, and it
is a finding about an entire industry approach, not about a competitor.

**P1.3 Demonstrate the leak end to end.** For the strongest instance, run the actual pipeline:
show the doc-filtered baseline composing the forbidden fact from permitted inputs, with the
model's real output text committed as an artifact. Then show Cordon abstaining, and show *why*
by printing the traversal that failed — the specific source node with no path from the
principal.

**P1.4 Quantify.** Extend `src/bench/` with an aggregation-leak axis alongside the existing
leak-rate table. Expected shape of the result: baselines that looked acceptable at 17.4%
document-level leak rate are far worse once aggregation is counted, because the failure is
invisible to their own metric. If the numbers do not come out that way, publish what they are.

**P1.5 Adversarial prompting.** Add a red-team set that tries to induce leakage through
paraphrase, role-play ("as an auditor, ..."), and incremental narrowing across turns. Report
attempts, successes, and the defence that held. Commit every attempted prompt.

## P2 — Make the invariant exhaustive and graph-native

**P2.1 Push entitlement fully into the graph.** `acl.ts` currently materialises the lattice in
TypeScript Maps. Keep it — but only as the *oracle* for testing. The runtime path must decide
authority solely by traversal in HydraDB, and you should be able to say so in one sentence.
Then assert the two agree on all pairs. Divergence between an independent oracle and the graph
traversal is exactly the bug class that matters here, and testing it is a strong result.

**P2.2 Exhaustive, not sampled.** Run the invariant over the full cross-product of principals
and reachable facts, not the 12 sampled principals. Report total pairs checked. "18,168 trials"
is good; "every (principal, fact) pair in a 95,898-node graph, N of them, zero violations" is a
different category of claim. Use `singleSourcePaths` / `isReachable` and batch it.

**P2.3 Publish latency honestly.** Cold and warm, p50/p95, for entitlement resolution at
realistic graph size. Include the pathological case flagged in `query.ts` (variable-length
traversal followed by a further hop).

**P2.4 Say why this needs a graph.** Add a short `docs/WHY-GRAPH.md`: transitive management
inheritance and multi-level `RESTS_ON` derivation are unbounded-depth reachability. A vector
index cannot express them; a relational schema needs recursive CTEs and still cannot do
variable-depth path return. This directly targets the $500 Best Use of HydraDB award, which is
judged separately and can go to a finalist.

## P3 — Depth signals

**P3.1 Tests.** Currently one 287-line test file. Add property-based tests for the invariant
(generate random principals, assert no entitled-path-free fact is ever returned), plus
regression tests pinning each published number. Target: the test suite alone demonstrates the
security property.

**P3.2 CI.** A GitHub Actions workflow that stands up HydraDB, ingests a fixture subset, and
runs the invariant. A green badge for a *security invariant* is a strong signal.

**P3.3 README restructure.** Lead with: one-sentence claim → the aggregation-attack number →
live demo link → video. Move methodology below. A judge reads the first screen.

---

## Commit discipline

Match the existing style: one commit per meaningful unit, imperative subject describing the
finding rather than the file touched (the current history does this well — keep it up). Do not
bulk-commit at the end; a 40-file commit at 23:30 reads badly next to 19 clean ones.

## Definition of done

- [x] README first screen: claim, aggregation number, live URL, video URL
- [ ] Demo video ≤3:00; current public upload is 4:10 and must be shortened
- [ ] Fresh clone → one command → working system, verified in a scratch directory
- [ ] `docs/ATTACK.md` with the formal definition, mined instances, and raw artifacts
- [ ] Exhaustive invariant result with total pair count
- [ ] Every number traceable to a committed artifact
- [ ] Limitations section written by you, not left for a judge to find
- [ ] Submission form completed — **it closes on time and late entries are not accepted**

## Ordering note

If time runs short, P0 + P1 alone beats P0 + P2 + P3 without P1. The aggregation attack is the
differentiator; the exhaustive invariant is the proof that the differentiator is sound. Ship
the finding before you ship the rigour.