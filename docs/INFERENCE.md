# Provenance is not content

Regenerate with `npm run audit:inference`.

Cordon's soundness theorem proves a fact is only ever *handed over* to someone
with provenance for it: 0 leaks in 330,190 pairs, at 0.000 F1 cost. That is a
real property, it is proved by induction in [SOUNDNESS.md](SOUNDNESS.md), and it
is **not the property a security reviewer is asking about.**

They are asking: when Cordon refuses, does the asker end up not knowing?

Those are different questions. This audit is the second one, run against our own
system, and **we do not pass it by default.**

| | denied (claim, principal) pairs | share |
|---|---|---|
| **phantom** — rebuilt from permitted evidence | **1,208** | **1.0%** |
| effective — genuinely withheld | 118,998 | 99.0% |
| total | 120,206 | |

---

## The attack

Cordon's derivation rules are deterministic and they are in this repository
under Apache-2.0. Kerckhoffs's principle applies with unusual force: the
adversary does not have to reverse-engineer the rules, they can `git clone`
them. So they take the facts Cordon *did* disclose and run our own rules to
fixpoint:

```
Denied(p)  = { f : req(f) ⊄ perm(p) }
Rebuilt(p) = closure of Cordon's published rules over Permitted(p)

phantom(p)   = Denied(p) ∩ Rebuilt(p)      the denial bought nothing
effective(p) = Denied(p) \ Rebuilt(p)      the denial is real
```

A phantom denial is **worse than no denial**. It costs the asker an answer,
costs the operator a support ticket, and returns nothing — while appearing in a
dashboard as protection. It is a lie the system tells its owner.

## Where it opens, and why that is structural

| depth | denied | phantom | share | verdict |
|---|---|---|---|---|
| 1 | 96,206 | 0 | 0.0% | **tight** |
| 2 | 12,000 | 804 | 6.7% | **phantom** |
| 3 | 12,000 | 404 | 3.4% | **phantom** |

**Depth 1 is tight.** A level-1 fact names every space its subject works in. An
asker who cannot read one of those spaces cannot observe the subject there, so
the set they arrive at is strictly smaller and the claim does not match. The
requirement is exactly as strong as it needs to be.

**Depths 2 and 3 are not, and the reason is our own bug fix.** `pair:A:B`
asserts *"people work across A and B"* — a claim about A and B and nothing else.
Its requirement is the union of every space its supporting person-facts touch,
which is typically five or more. So Cordon demands five spaces to read a claim
that two spaces are enough to derive. Everyone holding exactly `{A, B}` is
refused, and then rebuilds it in one step from level-0 evidence they were
entitled to read all along.

An earlier build declared `req(pair:A:B) = {A, B}`, traversal found five, and we
corrected it upward — correctly, because under-stating a requirement fails open.
**That correction was right for provenance and bought exactly nothing for
content.** Both halves of that sentence are worth publishing.

---

## Closing it is a cut, not a stronger requirement

The instinct on finding a phantom denial is to raise the requirement. It does
nothing. The asker is not at the front door; they are rebuilding the claim from
evidence they are entitled to, and no requirement on the derived node can reach
that evidence.

The only way to stop the derivation firing is to withhold enough of the asker's
legitimate evidence that it no longer fires — a **minimum vertex cut on the
derivation hypergraph**. It means denying facts the asker has every right to
read. There is no version of this that is free.

The structure decomposes exactly, so we do not approximate:

| gate | shape | minimum cut |
|---|---|---|
| `span(e,a,b)` | AND of two ORs | `min(|facts(e,a)|, |facts(e,b)|)` |
| `pair(a,b)` | ≥2 of n spans | `sum(costs) − max(cost)` |
| `cluster(a,b,c)` | all 3 pairs | `min` over the three pair costs |

Each is optimal by an exchange argument, and `test/closure.test.ts` checks all
three against brute force over small instances — an optimality claim asserted in
a comment is not one.

| | |
|---|---|
| phantoms with a finite cut | 1,208 |
| **cuts verified by re-running the adversary** | **400 / 400** attempted (100.0%) |
| mean facts cut per phantom | 1540.2 |
| **evidence withheld to close every phantom** | **37.7%** of what each asker may legitimately read |

Every cut is *verified*, not asserted: the adversary is re-run with the cut
applied and the claim must no longer be reachable. A defence checked only
against the reasoning that produced it is the tautology SOUNDNESS.md exists to
avoid.

---

## The exchange rate

| property | status | cost |
|---|---|---|
| **provenance confidentiality** | closed, proved | **0.000 F1** |
| **content confidentiality** | priced, not closed by default | **37.7% of readable evidence** |

The README says security is free. That is true, and it is true *of the property
we proved*. It is not true of the property a reviewer actually asks about, and
this table is the exchange rate between them.

We ship the measurement rather than the mitigation-on-by-default, because
cutting 37.7% of an asker's legitimate evidence is a governance decision and
not an engineering one. What a security product owes its operator is the number.

## What this still does not cover

- **A stronger adversary.** Ours runs *our* rules. One running better rules — a
  language model reasoning over permitted prose — reconstructs more. Every
  number here is a **lower bound** on the channel.
- **Joint cuts.** Per-claim cuts are exact minima. The union across all of a
  principal's phantoms is an upper bound on the true joint minimum; computing it
  exactly is set-cover.
- **Collusion.** Measured per principal. Two askers pooling permitted answers
  rebuild strictly more.
