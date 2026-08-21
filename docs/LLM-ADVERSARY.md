# Testing our own lower bound

Regenerate with `npm run audit:llm`. Replays a committed response cache, so it
reproduces without an API key.

Every leak figure in [INFERENCE.md](INFERENCE.md) and [PLANNER.md](PLANNER.md)
carries the caveat *"our adversary runs our own rules, so this is a lower
bound."* Written that way it is unfalsifiable — a hedge rather than a
limitation. This audit falsifies it or retires it.

**Model:** `gpt-4o-mini`, temperature 0. **Probes attempted:** 60
(0 live, 60 replayed from the committed cache).

| | |
|---|---|
| recall on protected claims | **0.0%** |
| false-positive rate | 0.0% |
| precision | 0.0% |
| **adversarial advantage** | **0.0%** |

**Verdict: inconclusive — the adversary never engaged.**

> The model answered **NO** to every probe. Recall and false positives
> are both degenerate, so the separation is undefined. Reported as inconclusive
> rather than as a defence: an adversary that never asserts has not been beaten,
> it has not played.


---

## Does the channel exist here at all?

A null result is worthless unless you can tell **"the defence held"** apart from
**"there was nothing there to find"**. So the corpus is measured before it is
probed:

| | |
|---|---|
| level-0 facts | 16,594 |
| whose text names their own product area | 979 |
| **whose text names a foreign product area** | **0** |

**Zero.** No document in HERB mentions a product area other than its own, so
there is nothing for a language model to cross-reference. The result below
measures the corpus, not the defence — and saying so is the difference between
a finding and a victory lap.

This is a property of HERB, not of Cordon. A corpus whose documents *did*
cross-reference areas would open exactly this channel, and our structural
adversary would miss it, because it reasons over extracted mentions rather than
over prose. **The lower-bound caveat therefore stands — untested here rather
than disproved.**

## The design

The structural adversary reasons over the derivation graph — entities, spaces,
support edges. A language model reasoning over the **prose** of the same
disclosed facts is not bound by that structure: it can read a name in one
document and the same name in another and draw a link our extractor never made.

So it is pointed at the denials our own adversary called **effective** — the
ones we claim are genuinely protected. Those are the only probes where being
wrong costs us anything.

## The control arm, which is why this is evidence

An adversary that answers YES to everything "reconstructs" every claim and has
learned nothing. So half the probes are **negatives**: space pairs that are not
true claims, drawn for the same principals with the same evidence shape. The
only difference between the arms is whether the claim is true.

The number that matters is therefore not the hit rate but the **separation**:

```
advantage = recall on true claims − false-positive rate on false ones
```

At zero the model is guessing at the base rate and has no inference channel.

| | true pairings | false pairings |
|---|---|---|
| model said YES | 0 | 0 |
| model said NO | 30 | 30 |

## Reproducibility

An LLM result that cannot be reproduced is an anecdote. Every response is cached
in `artifacts/llm-adversary-cache.json`, keyed by a SHA-256 of the exact prompt,
and committed. A reader with no API key replays the run and gets these numbers.
Editing a prompt changes its hash, so a stale answer can never be replayed for a
question it was not asked.

**The core pipeline is untouched.** No language model participates in
extraction, resolution, derivation or admissibility. This is an attacker, not a
component — which is why every other number in this repository is still
byte-reproducible.

## What this does not cover

- **One model, one prompt.** A better-prompted or larger model may separate the
  arms where this one does not.
- **Single-shot.** A real attacker iterates, asks follow-ups, and pools answers
  across a session.
- **Pairings only.** Depth-3 clusters and level-1 person facts are not probed.
