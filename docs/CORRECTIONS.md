# What we got wrong

Every entry here is something this project claimed, or nearly claimed, that was
wrong — found by us, corrected in the open, with the commit that fixed it.

It exists because a reader has no way to tell a careful project from a confident
one unless the careful project shows its corrections. Numbers that only ever go
up are a warning sign, not a track record.

---

## 1. An invariant that compared a value to itself

**The claim.** "The admissibility invariant holds over every (fact, principal)
pair."

**What was wrong.** The check computed `admissible(required)` and compared it
against `admissible(required)` — the same value, twice. It could not have
failed. It passed for hours and we believed it.

**How it was found.** By asking what the check would do if the pipeline were
wrong, and realising the answer was "pass".

**What it cost.** When the check was rewritten to compare a requirement obtained
by graph traversal against one recomputed independently from the corpus,
**47 facts disagreed with themselves**. Shared links cited by six teams had
collapsed into one node carrying whichever space loaded last, and every fact
resting on them had inherited the wrong access requirement.

**The lesson, which is now the project's rule.** A security property only ever
checked against the field that produced it is not being checked at all. Every
verification here now recomputes ground truth from an independent path.

---

## 2. Claiming aggregation was closed when the premise was true by construction

**The claim.** Cordon closes the compositional channel.

**What was wrong.** The first claim decomposition defined
`claims(f) = entities(f) × required(f)` — claims *derived from* the requirement.
That makes "claim locality" true by construction, which makes the theorem that
depends on it vacuous, which makes the measured zero meaningless. The same
failure mode as entry 1, in a different costume.

**The fix.** Claims are now read out of a fact's *text*, independently of the
requirement, so the two can disagree — and they do.

**What it cost.** Once measured honestly, **Cordon leaked 16 of 130 denied pairs**
on a corpus with realistic cross-references. That number is in the README. The
mitigation that takes it to zero costs 54 additional withholdings, and that is
in the README too.

---

## 3. "The continuation cursor expires"

**The claim**, in our engine notes: a truncated result hands back a cursor that
fails with `result cursor is unknown or expired`, and `offset`/`page_token`/
`start` silently return the first page again.

**What was wrong.** Re-testing before filing upstream showed the cursor returns
an **empty page**, not an expiry error, and that `SKIP`/`LIMIT` **pages
correctly**. We had described a workaround as unavailable when it works.

**What was actually true, and sharper:** an explicit `LIMIT 2000` is silently
capped to 1024 rather than honoured or rejected.

**The fix.** The note carries the correction rather than quietly swapping the
text, and [hydra-db/hydradb#115](https://github.com/hydra-db/hydradb/issues/115)
reports the verified behaviour.

---

## 4. Calling paraphrases contradictions

**The claim we nearly published.** "28 contested facts; 28,772 colleague pairs
would receive opposite values."

**What was wrong.** The detector was firing on shared sources described
differently by different teams — *"GitHub repository of the TensorFlow library
for machine learning"* against *"GitHub repo of the TensorFlow library for deep
learning applications"*. Those are paraphrases. Nobody is being told opposite
things.

**What is actually true.** HERB contains **no detectable semantic
contradiction** — name and role never co-occur once in 4.7M characters of
document text, because it is generated per product and is internally consistent.
The divergence is real and is reported on its own terms, separately, as
*description divergence*. The opposed claims used to demonstrate the mechanism
are seeded into the GitHub fixture and labelled as seeded.

---

## 5. A demo URL that 404s for the wrong reason

**The claim.** The recording guide pointed at
`github.com/iamdflame/cordon-demo-borealis` to demonstrate that a private
repository refuses an unauthenticated request.

**What was wrong.** That URL does return 404 — because the repository is not
there. The fixture had moved into the `cordon-demo` organisation when teams were
added. A 404 for *"does not exist"* is visually identical to a 404 for *"you may
not see this"*, on the single beat the whole demo rests on.

**The fix.** The correct URL, and the public repository shown loading first.
One 200 and one 404, same organisation, same request — which is what actually
demonstrates the refusal is about permission rather than existence.

---

## 6. A 404 assertion that was really a rate limit

**The claim.** "26/26 sources under withheld facts return 404 to an
unauthenticated request."

**What was wrong.** After the fixture moved, the assertion started returning
**403** — which is `api.github.com` rate-limiting at 60 requests an hour, not a
permission answer. Counting a rate-limit 403 as a pass would have fabricated the
exact result the section exists to establish.

**The fix.** The check uses `github.com` rather than the API, detects rate
limiting explicitly, and reports it as *unverified* — never folded into pass or
fail.

---

## 7. Claiming an upstream filing we had not made

**The claim.** A README row said the composed-traversal performance finding was
"filed upstream".

**What was wrong.** It was not. Variable-length `MATCH` requires a fixed source
id, and the graph being rebuilt at the time had no `Fact` nodes to bind, so the
287ms-versus-30s measurement could not be re-verified. Filing an unverified
performance number on someone else's tracker is not worth the credibility, and
claiming to have filed it is worse.

**The fix.** The row now says where the number came from and claims no filing.
Three findings *were* filed, all re-verified first:
[#115](https://github.com/hydra-db/hydradb/issues/115),
[#116](https://github.com/hydra-db/hydradb/issues/116),
[#117](https://github.com/hydra-db/hydradb/issues/117).

---

## 8. Counting mutual failure as agreement

**The claim, for about four minutes.** "Two independent in-engine formulations
of the requirement agree on 25 of 25 facts."

**What was wrong.** Both formulations had returned `__unresolvable__`, because
the `RESTS_ON` edges were still being ingested. Two computations that both
failed have not agreed about anything. The benchmark counted it as a match and
printed 100%.

**Why it keeps happening.** This is the third instance of one error: *comparing
a thing to something that cannot disagree with it.* First an invariant against
itself, then a claim decomposition against its own premise, now two failures
against each other. It is the characteristic failure mode of checking your own
work, and the only defence that has held is asking, every time: **what would
this check do if the system were broken?**

**The fix.** Pairs where neither side resolved are excluded from the agreement
rate and reported on their own line, and the benchmark says outright that
nothing is comparable rather than printing a reassuring number.

---

## 9. Believing a sound proof meant the asker did not know

**The claim.** Cordon's soundness theorem, proved by induction and checked
exhaustively over 330,190 pairs: a disclosed fact rests only on sources the
asker may read. We presented it as *the* confidentiality result.

**What was wrong.** The theorem is about **provenance** — what the system hands
over. A reviewer is asking about **content** — what the asker ends up knowing.
We had been treating a proof of the first as evidence for the second, and they
come apart.

**How it was found.** By writing the adversary instead of describing it. Our
derivation rules ship under Apache-2.0, so an attacker does not reverse-engineer
them — they clone them. Running *our own rules* over the facts we had disclosed
rebuilt **1,208 denied claims in 120,206**: refusals that satisfy the theorem
perfectly and protect nothing.

**What it cost.** The finding traces to a fix we were right to make. An earlier
build declared `req(pair:A:B) = {A, B}`; traversal found five, and we raised it
— correctly, because under-stating a requirement fails open. But `pair:A:B`
asserts something about A and B *alone*, so raising the requirement to five
spaces was **correct for provenance and worth nothing for content**. Depth 1 is
tight (0 phantoms in 96,206). Depths 2 and 3 are not (6.7% and 3.4%).

Closing them is a minimum cut on the derivation hypergraph, not a stronger
requirement, and it costs **37.7% of the evidence an asker may legitimately
read**. We ship it as a measurement rather than a default.

**A second correction inside the first.** `test/closure.test.ts` checks the cuts
against brute force, and **failed on its first run** — solver 1, brute force
∞. The solver was right; the test had granted the asker full permission, under
which the fact is simply disclosed and no cut of the evidence can touch it. The
comment recording that is still in the file, because a test that has never
failed has not been shown to work.

**The lesson.** *A refusal the asker can undo is not a refusal.* Every access
control claim should say which of the two properties it means, and a system that
measures only provenance will report protection it does not have.

Fixed in [`docs/INFERENCE.md`](INFERENCE.md), `src/cordon/closure.ts`,
`src/bench/inference.ts`, `test/closure.test.ts`.

---

## 10. An adversary handed an empty hand, and scored as a defence

**The claim.** The first run of the LLM adversary reported 0% recall and 0%
false positives against 60 probes, and the audit printed *"the bound holds
against this adversary."*

**What was wrong.** Two things, and the second is worse.

The probe selected the attacker's evidence with `space === a || space === b`.
But these were *effective* denials — denials that are effective **precisely
because the principal cannot read one of the two spaces.** So the filter handed
the model documents from one side only. It answered *"these documents do not
mention ForecastForce"* sixty times, correctly, and we scored that as our
defence working.

Worse: the verdict logic computed `advantage = recall − falsePositiveRate` and
treated `0 − 0 = 0` as a pass. **An adversary that answers NO to everything is
as uninformative as one that answers YES to everything**, and the scoring could
not tell them apart.

**How it was found.** By reading what the model actually said instead of only
its score. The justifications were all the same sentence, which is not what a
model that is genuinely uncertain produces.

**What it cost.** Both are fixed: evidence is now selected by what the text
*says* rather than which space it sits in, and degenerate adversaries are
reported as **inconclusive** rather than scored.

**And the honest result is still a null.** The corrected probe also recovered
nothing — but now we can say why, with a number: **0 of 16,594 level-0 facts
name a product area other than their own.** The prose channel we hypothesised
does not exist in HERB. That measures the corpus, not the defence, and the
lower-bound caveat therefore stands as *untested here* rather than disproved.

**The lesson.** A null result is worthless until you can tell *"the defence
held"* apart from *"there was nothing there to find."* Measure the channel
before you claim to have closed it.

Fixed in `src/bench/llm-adversary.ts`, [`docs/LLM-ADVERSARY.md`](LLM-ADVERSARY.md).

---

## Results that are not wins

Reported here rather than left for a reader to notice.

| | |
|---|---|
| **Absolute answer F1 is 0.099** | Low. It is low for every arm including the ungated upper bound, because HERB scores by strict set match — but we are not going to pretend a 0.099 is a good score in isolation. The measurement is the delta across identical retrieval. |
| **Depth-2 and depth-3 facts are visible to nobody** | Mean audience 0.0 of 530. Cordon is *correct* to withhold them, and a knowledge graph whose deepest inferences serve no one is arguably not worth building at those depths. We report the audience collapse rather than only the leak count. |
| **Entity resolution recall is 99.0%** | One mention in a hundred is abstained on. Abstention is the right failure mode, but it is still a fact we do not surface. |
| **The compositional channel is open** | Measured, mitigated, not closed. The claim-aware rule restores closure by construction and costs additional withholdings. |
| **The refusal side channel is created by our own defence** | Naming the space you lack is useful to a colleague and a perfect oracle to an attacker. Both modes ship; neither is free. |
| **Timing is unmeasured** | Deeper facts traverse further, so latency correlates with derivation depth. We have not measured whether that correlation is exploitable. |
| **Cross-principal collusion is unmeasured** | Every channel number is per principal. Two principals pooling permitted answers reconstruct more than either alone. |

---

## How to catch us

```bash
npm run audit     # emits artifacts/audit-rows.jsonl and audit-summary.json
npm test          # recomputes every published score from those rows
```

The suite fails if the README, the summary, and the raw rows disagree; if the
three evaluation arms were handed different evidence; or if any Cypher in the
source violates a constraint the engine actually enforces.

If you find something this file does not list, it belongs here.
