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
