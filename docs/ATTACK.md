# The aggregation attack

Regenerate with `npm run attack` -- --github.
Raw data: [`artifacts/attack-github.json`](../artifacts/attack-github.json) — git `b563123f7aa4`, 2026-08-20T01:43:36.652Z.

Corpus: **github** · 105 facts · 20 principals.

---

## Why this is the interesting attack

Document-level filtering cannot defend against aggregation **even in
principle**, because the thing being aggregated is not a document. Two facts a
principal is entitled to can together determine a third they are not, and no
file-level ACL has a place to express that.

Cordon can reason about it, because derivation is an edge in the graph rather
than a property of a file. Whether it *succeeds* is measured below rather than
claimed.

## Definitions

    sources(f)    = { s : f -[:RESTS_ON*1..k]-> s, s:Source }
    required(f)   = { space(s) : s in sources(f) }
    permitted(p)  = { sp : p -[:MEMBER_OF]-> sp }
                  U { sp : p -[:MANAGES*]-> q -[:MEMBER_OF]-> sp }
    entitled(p,f) <=> required(f) subset-of permitted(p)

An **aggregation leak** is a triple (p, f, F) where

1. `NOT entitled(p, f)` — p may not be told f
2. every g in F is disclosed to p by the system under test
3. `claims(f)` is a subset of the union of `claims(g)` for g in F — F determines f

`claims(f)` is the set of atomic assertions "entity e is present in space sp",
**read out of the fact's text**, never computed from `required(f)`. Deriving
claims from the requirement would make the locality result below true by
construction — the same failure mode as an invariant that compares a value to
itself.

## Theorem 1 — an attacker cannot climb the derivation edges

> If p is entitled to every support of f, then p is entitled to f.

*Proof.* `required(f)` is the union of `required(g)` over supports g, by
construction. Each is a subset of `permitted(p)`. A union of subsets of
`permitted(p)` is a subset of it. ∎

Checked, not just proved: **41** (principal, fact) cases where the principal held
every support, **0** counterexamples.

This is what forces the real attack to come from facts that are *not* supports.

## Theorem 2 — when Cordon is closed under aggregation too

A corpus has **claim locality** if every claim (e, sp) is only ever asserted by
facts that require sp.

> Under claim locality, Cordon admits no aggregation leaks.

*Proof.* Suppose (p, f, F) satisfies 1–3 under Cordon. Take any sp in
`required(f)`. Some (e, sp) is in `claims(f)`, so by (3) some g in F asserts it.
By locality sp is in `required(g)`; by (2) `required(g)` is a subset of
`permitted(p)`; so sp is in `permitted(p)`. As sp was arbitrary,
`required(f)` is a subset of `permitted(p)` — contradicting (1). ∎

**So Cordon's exposure is a property of the corpus, not of the rule.** That is
the honest framing, and it is why the premise is measured:

| | |
|---|---|
| atomic claims asserted | 149 |
| about a space the asserting fact rests on | 142 (95.30%) |
| **about a space it does not rest on** | **7** |

Claim locality **fails** on this corpus: 7 claims are made about a space
the asserting fact does not rest on. That is the door an aggregation attack
walks through, and it is why Cordon's exposure below is nonzero. Examples:

- `person:priya-raman@cordon-demo-cygnus` — asserted by a fact resting only on `cordon-demo-borealis`
  > Priya Raman is splitting time with cordon-demo-cygnus this month.
- `person:priya-raman@cordon-demo-atlas` — asserted by a fact resting only on `cordon-demo-handbook`
  > Priya Raman is currently on cordon-demo-atlas and cordon-demo-borealis.
- `person:priya-raman@cordon-demo-borealis` — asserted by a fact resting only on `cordon-demo-handbook`
  > Priya Raman is currently on cordon-demo-atlas and cordon-demo-borealis.

## The census

Mined from the graph. Every instance in the raw artifact can be re-derived.

| gate | denied pairs | aggregation leaks | rate | mean coverage | over-restricted |
|---|---|---|---|---|---|
| ungated | 130 | **130** | 100.0% | 100.0% | — |
| document-acl | 130 | **16** | 12.3% | 41.5% | — |
| cordon | 130 | **16** | 12.3% | 41.5% | — |
| cordon-claim-aware | 130 | **0** | 0.0% | 26.8% | 54 |

*Denied* always means denied under the correct rule, so the three gates are
scored on the same population. *Mean coverage* is the average share of a denied
fact's claims that the gate's own disclosures already determine — the leak count
is the tail of that distribution at 100%.

**Document-level filtering admits 16 aggregation leaks on this corpus.**
That is a finding about an entire industry approach, not about any one product:
the failure is invisible to document-level filtering's own metric, because
nothing it handed over was itself forbidden.

Cordon admits **16**.

### The fix, implemented and costed

The attack works through facts that **name** a space they do not rest on. So
widen the requirement to include what a fact talks about, not only where its
evidence sits:

    required'(f) = required(f) U { sp : f's text names sp }

That restores claim locality *by construction*, so Theorem 2 applies
unconditionally rather than as a hope about the data.

| | evidence-only | claim-aware |
|---|---|---|
| aggregation leaks | 16 | **0** |
| mean coverage reachable | 41.5% | 26.8% |
| additional withholdings | — | 54 |

It is not free: a fact that merely mentions a space now requires it, so
54 (fact, principal) pairs the evidence-only rule would disclose are
now withheld. Whether that trade is worth making is an operator's decision, and
the point of measuring both is that they get to make it with numbers.

### A mined instance

Asker `public` is denied:

> Ingrid Holm (mentioned) is active across 4 product areas: cordon-demo-borealis, cordon-demo-handbook, cordon-demo-eridanus, cordon-demo-gemini.

It requires `cordon-demo-gemini`, `cordon-demo-borealis`, `cordon-demo-eridanus`, `cordon-demo-handbook` and they lack
`cordon-demo-borealis`.

Document-level filtering handed them 3 facts that between them assert
every claim the withheld fact makes:

- `[cordon-demo-eridanus]` level 0 — Ingrid Holm notes the SDK release depends on cordon-demo-borealis integration work.
- `[cordon-demo-handbook]` level 0 — Sofia Almeida maintains the incident command rotation page.
- `[cordon-demo-gemini]` level 0 — The SDK release is on track for this quarter.

No individual disclosure was forbidden. The conclusion is reconstructed anyway.

## Red team

Adversarial question phrasings, run through the real retrieval and gate.

| | |
|---|---|
| attack sequences | 200 |
| turns issued | 310 |
| sequences that reconstructed a target | **28** |
| mean coverage reached | 24.6% |

Paraphrase and role-play framing (*"as an auditor, ..."*) move nothing, and this
is structural rather than lucky: **admissibility never reads the question.** It
is a function of the asker and the derivation graph, so there is no phrasing
that changes it. The only channel with any surface is accumulation across turns,
which is the aggregation attack above arriving one question at a time.

Every attempted phrasing is committed in the raw artifact.

## What this does not cover

- **A model that infers beyond the claims.** We measure reconstruction of the
  atomic assertions a fact makes. A language model reading the same permitted
  facts may draw conclusions our claim decomposition does not represent.
- **Cross-principal collusion.** Two principals pooling disclosures reconstruct
  more than either alone; every number here is per principal.
- **Claim extraction is lexical.** A fact that implies a space without naming it
  is not counted, so the true attack surface is at least what is reported.
