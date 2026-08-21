# YouTube listing — copy and paste

Everything below is ready to paste. Thumbnails are in this folder; their HTML
sources sit beside them, so any number can be corrected and re-rendered:

```bash
google-chrome --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1280,900 --screenshot=out.raw.png \
  "file://$PWD/media/youtube/thumbnail-a.html"
# then crop the top 1280x720 — the layout viewport is shorter than the capture
```

---

## Title

**Use this one:**

```
Cordon — We Attacked Our Own Security Proof | Hack Hydra 2026
```

It names the project, states the differentiator, and tags the event. 60
characters, so it does not truncate in a sidebar.

<details>
<summary>Alternates</summary>

```
1,208 refusals that protected nothing — Cordon | Hack Hydra 2026
```
Leads with the number. Stronger curiosity hook, weaker at saying what the
project *is*. Pair it with thumbnail B.

```
The enterprise AI leak nobody audits: derived knowledge — Cordon
```
Leads with the problem rather than the finding. Better for a general audience,
worse for judges, who want to know what you did that others did not.

</details>

---

## Description

Paste from the line below to the end. The first two lines are what shows before
"…more", so they carry the whole pitch.

```
A fact inferred from three documents is not a document — so document-level access control, which is what every enterprise AI assistant ships, has no answer for it. We closed that hole and proved it sound. Then we attacked our own proof and found 1,208 refusals that protected nothing.

Cordon is derived-knowledge access control, built on HydraDB for Hack Hydra 2026.

── CHAPTERS ──
0:00  A derived fact has no ACL of its own
0:18  We closed it — and it cost nothing
0:38  Then we attacked our own proof
1:20  Why the fix is a minimum cut, and what it costs
1:50  The number that makes it shippable
2:25  We tested our own hedge, and reported the null
2:45  Provenance is free. Content is not.

── WHAT THE NUMBERS ARE ──
• 0 leaks across 18,168 trials, at 0.000 F1 cost — proved by induction, checked over 330,190 (fact, principal) pairs
• 1,208 of 120,206 denials are rebuilt by our own published derivation rules. They satisfy the theorem perfectly and protect nothing
• Depth 1 is tight (0 phantoms in 96,206). Depths 2 and 3 are not — caused by a fix we were right to make
• Closing that gap is a minimum vertex cut costing 37.7% of an asker's legitimate evidence
• Deciding over the SET instead of per fact: 0 violations in 1,200 planned queries at top-20. Free at production retrieval depth, first bites at k=50
• A per-principal disclosure ledger carries the guarantee across a session: 100% retained at query 1, 80.7% by query 30
• One grant to one person disclosed 380 derived facts — 100% of them unlocked in combination with access the person already held. No access review shows those
• We pointed a language model at the denials we called protected. It recovered nothing, and we can say why: 0 of 16,594 documents name a product area other than their own. That measures the corpus, not our defence

── TRY IT ──
Live console:  https://cordon-graph.vercel.app/console
Source:        https://github.com/iamdflame/cordon

  docker compose up          # clean checkout to a working console
  npm run audit:inference    # we attack our own proof
  npm run audit:planner      # and the planner that makes the fix shippable
  npm run audit:policy       # what one grant actually costs

Every number above regenerates from a command and is committed as an artifact carrying its git SHA, corpus digest and seed. The test suite fails if the README and the raw rows ever disagree.

── WHAT WE GOT WRONG ──
Ten corrections, found by us, published as prominently as the results:
https://github.com/iamdflame/cordon/blob/main/docs/CORRECTIONS.md

Including the one in this video: our first LLM adversary scored a clean 0%/0% and we nearly reported it as a pass. It had been handed an empty hand, and the scoring could not tell "defended" from "never engaged".

── READ MORE ──
Provenance is not content:    https://github.com/iamdflame/cordon/blob/main/docs/INFERENCE.md
Inference-safe planning:      https://github.com/iamdflame/cordon/blob/main/docs/PLANNER.md
What a grant actually costs:  https://github.com/iamdflame/cordon/blob/main/docs/POLICY.md
Testing our own lower bound:  https://github.com/iamdflame/cordon/blob/main/docs/LLM-ADVERSARY.md
Soundness, and its limits:    https://github.com/iamdflame/cordon/blob/main/docs/SOUNDNESS.md

Built on HydraDB (AGPL-3.0). Corpus: Salesforce HERB (CC-BY-NC-4.0), used unmodified. No language model is used anywhere in the pipeline — one appears only as an attacker, with its responses cached and committed so the result reproduces without an API key.

#EnterpriseAI #AISecurity #KnowledgeGraph #AccessControl #HydraDB #RAG
```

---

## Thumbnails

**`thumbnail-a-attacked-our-own-proof.png` — use this one.**

"We attacked our own proof" reads at any size, and the withheld-fact card beside
it carries the technical signal: *rests on 5 facts, 0 sources.* A judge scanning
a list learns what is different about this submission in one glance, which is
the only job a thumbnail has.

**`thumbnail-b-1208.png`** — leads with the number instead. Use it only if you
also switch to the "1,208 refusals" title, so the thumbnail and title reinforce
rather than compete.

Both are 1280×720 and well under YouTube's 2MB limit.

---

## Upload settings

| | |
|---|---|
| Visibility | **Unlisted** while you check it, then **Public** before submitting — judges cannot watch a private video |
| Category | Science & Technology |
| Audience | **Not** made for kids |
| Chapters | Work automatically: the description already starts a timestamp list at `0:00` |
| Language | English |
| Comments | Leave on — a judge asking a question in public is a good problem |

**Before you submit, check the video is not private.** It is the single most
common way a good submission scores zero.

Final video URL:

`https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n`

Added to the README, submission form draft, demo guide, and public site.
