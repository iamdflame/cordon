# Inference-safe planning

Regenerate with `npm run audit:planner`.

[INFERENCE.md](INFERENCE.md) prices *global* content confidentiality at **37.7%**
of an asker's readable evidence. Taken at face value that says the property
cannot ship: no operator destroys a third of their staff's legitimate access.

That number assumes an adversary who has already aggregated **everything they
are entitled to**. A single answer is not that. This audit measures what the
same property costs per answer, and what it costs as an asker keeps asking.

| adversary | cost of content confidentiality | verdict |
|---|---|---|
| holds one answer | **0.00%** of evidence | affordable |
| holds a 30-query session | **19.32%** by query 30 | a budget |
| holds everything they may read | **37.7%** | unshippable |

**Inference safety is not one price. It is a curve, and the ledger is where you
sit on it.**

> **Read the denominators before comparing those rows.** The global figure is a
> share of *everything an asker may read*; the per-query and session figures are
> shares of *retrieved candidates in an answer*. They measure the same property
> against different adversaries — they are **not three points on one axis**, and
> the session row exceeding the global row is an artefact of that, not a
> paradox. What the table is for is the shape: the cost of content
> confidentiality is set by how much the adversary has already accumulated.

---

## The rule

Per-fact checking cannot see a set-level leak, because the dangerous object
never appears in the list being checked. So the decision is made over the set:

```
choose D ⊆ Admissible(p)
maximising utility(D)
subject to closure(D) ∩ Protected(p) = ∅
```

`closure` is the same rule engine an adversary would run ([closure.ts](../src/cordon/closure.ts)),
and `Protected(p)` is the set of derived claims `p` was refused.

Exact maximisation is a covering problem and NP-hard. The planner is greedy from
the low-utility end and **is labelled a heuristic**. What is not heuristic is the
safety of the result: every returned plan is re-checked against the rule engine
before it is handed back.

## Arm 1 — per-query

| | |
|---|---|
| queries planned | 1,200 |
| plans where the constraint bit | 0 (0.00%) |
| protected claims prevented | 0 |
| evidence retained | **100.00%** |
| **cost** | **0.00%** |
| plans verified safe | 1,200 / 1,200 |

## Arm 2 — session

Per-query safety **does not compose.** Ten individually safe answers can jointly
rebuild a protected claim — the aggregation attack, moved from documents to
sessions. A planner that only looks at the current reply is safe against a
reader and useless against an attacker, who will simply ask twice.

`DisclosureLedger` accumulates what a principal has actually been shown, and the
constraint is evaluated over that accumulation. Safety degrades into a budget:
the asker keeps getting answers until their own history starts to determine
something they were refused, and then, precisely then, Cordon starts withholding.

Retention is **cumulative** through query *i*, with the denominator shown. An
earlier version reported retention *at* query *i* and swung between 0% and 100%
between adjacent queries — a principal with few spaces has one or two admissible
candidates in a top-20, so one suppression moves the ratio the whole way. A
metric whose denominator is routinely 1 is not measuring anything.

| query | ledger size | admissible so far | retained | plans that bit |
|---|---|---|---|---|
| 1 | 4 | 160 | 100.0% | 0 |
| 2 | 4 | 160 | 100.0% | 0 |
| 3 | 7 | 280 | 100.0% | 0 |
| 5 | 14 | 560 | 100.0% | 0 |
| 10 | 28 | 1,240 | 100.0% | 0 |
| 15 | 35 | 1,800 | 93.3% | 120 |
| 20 | 42 | 2,120 | 92.5% | 160 |
| 25 | 47 | 3,000 | 80.0% | 200 |
| 30 | 50 | 3,520 | 80.7% | 280 |

Sessions verified safe: **all**.

## Arm 3 — where it starts to bind

If the constraint never bites, the guarantee is free and also untested. So: how
deep does retrieval have to go before an answer carries enough evidence to
rebuild something the asker was refused?

| top-k | queries | plans that bit | claims prevented | evidence retained |
|---|---|---|---|---|
| 10 | 240 | 0 | 0 | 100.0% |
| 20 | 240 | 0 | 0 | 100.0% |
| 50 | 240 | 12 | 60 | 97.6% |
| 100 | 240 | 60 | 144 | 96.2% |
| 200 | 240 | 192 | 504 | 88.8% |

The constraint first bites at **k=50**. Below that, inference safety is free because an answer does not carry enough evidence to rebuild with.

## What this does not claim

- **The subset choice is greedy, not optimal.** Exact maximisation is NP-hard.
  The safety check is exact; the utility is a heuristic.
- **The adversary is still ours.** It runs Cordon's published rules. A stronger
  one reconstructs more, so these costs are lower bounds.
- **The ledger is per principal, not per organisation.** Two colluding askers
  pool histories, and nothing here measures that.
