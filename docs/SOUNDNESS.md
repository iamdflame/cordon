# Soundness

What Cordon proves, how, and — the part that matters more — what the proof does
not cover.

---

## The rule

Let `P` be principals, `S` be spaces, and `F` be facts.

- `perm : P → 2^S` — the spaces a principal may read.
- `supports : F → 2^(F ∪ Src)` — what a fact rests on. A fact rests on sources,
  on other facts, or on a mixture.
- `space : Src → S` — the one space a source belongs to. Total: every source
  sits in exactly one space, by construction of the corpus loader.

Requirement is defined by structural recursion on the support relation:

```
req(f) = ⋃ { space(s)  |  s ∈ supports(f), s ∈ Src }
       ∪ ⋃ { req(g)    |  g ∈ supports(f), g ∈ F   }
```

Disclosure is defined as:

```
admissible(f, p)  ⟺  req(f) ⊆ perm(p)
```

Union on requirements is intersection on audience: a fact synthesised from two
spaces is visible to the *intersection* of their two audiences, not the union.
Getting that direction backwards turns a knowledge graph into a laundering
machine, so it is the one place the implementation is checked twice.

---

## Well-definedness

`req` is well defined provided the support relation is acyclic.

The pipeline constructs facts in strictly increasing levels — a level-`k` fact
rests only on facts of level `< k` and on sources — so `supports` induces a
finite DAG and the recursion terminates. `MAX_SUPPORT_HOPS = 5` bounds the walk
in the graph implementation, which is the depth of the deepest chain the corpus
produces (a level-3 fact sits four hops from evidence) plus one.

The bound is a defence against a malformed graph, not a semantic choice. If a
cycle were ever introduced, traversal would terminate at the bound and return a
*subset* of the true requirement — which fails **open**. That is the wrong
direction, and it is why the audit recomputes requirements independently from
the corpus rather than trusting the traversal alone.

---

## Theorem (soundness over explicit derivation)

> For every fact `f` and principal `p`, if Cordon discloses `f` to `p`, then
> every source in the transitive support closure of `f` sits in a space `p` may
> read.

**Proof.** By induction on the derivation depth of `f`.

*Base case, depth 0.* `supports(f) ⊆ Src` and `|supports(f)| = 1`. Then
`req(f) = {space(s)}` for that single source. Disclosure requires
`req(f) ⊆ perm(p)`, so `space(s) ∈ perm(p)`. The transitive closure is `{s}`.
Established.

*Inductive step, depth k > 0.* Assume the claim for every fact of depth `< k`.
Let `f` have depth `k` and suppose `req(f) ⊆ perm(p)`.

By definition, `req(f) = A ∪ B` where `A` collects `space(s)` over the direct
source supports and `B = ⋃ req(g)` over the direct fact supports.

- Since `A ⊆ req(f) ⊆ perm(p)`, every direct source support sits in a readable
  space.
- For each fact support `g`: `req(g) ⊆ B ⊆ req(f) ⊆ perm(p)`, so `g` itself
  satisfies the disclosure condition for `p`. Each `g` has depth `< k`, so by
  the inductive hypothesis every source in `g`'s transitive closure sits in a
  readable space.

The transitive closure of `f` is the union of its direct source supports and the
transitive closures of its fact supports, and both are readable. ∎

The step that carries the whole argument is **union-monotonicity**: `req(g) ⊆
req(f)` whenever `g` is a support of `f`. It holds by construction of `req` —
which is precisely why the requirement must be *computed* from supports rather
than declared on the node. A declared requirement can under-state, and an
under-stated requirement fails open silently.

That is not hypothetical. An earlier build declared level-2 requirements as the
space pair the fact was named for, while traversal found five. See
[the bug worth recording](RESULTS.md).

---

## What the theorem is about — and what it is not

The theorem above is about **provenance**: a disclosed fact rests only on
sources the asker may read. It is proved, it is checked three ways below, and it
is not the property a security reviewer is actually asking about.

They are asking about **content**: when Cordon refuses, does the asker end up
not knowing?

These come apart, and the gap is not hypothetical — it is measured in
[INFERENCE.md](INFERENCE.md). Cordon's derivation rules are deterministic and
shipped under Apache-2.0, so an adversary runs *our own rules* over the facts we
disclosed and rebuilds some of what we refused:

```
phantom(p) = Denied(p) ∩ closure(Permitted(p))
```

A phantom denial satisfies the theorem perfectly. Provenance was never violated:
we did not hand the fact over. The asker knows it anyway.

| depth | denied | phantom | verdict |
|---|---|---|---|
| 1 | 96,206 | 0 | **tight** — the requirement is exactly as strong as it needs to be |
| 2 | 12,000 | 804 (6.7%) | phantom |
| 3 | 12,000 | 404 (3.4%) | phantom |

**Depth 1 is tight, and that is a consequence of the rule rather than luck.** A
level-1 fact names every space its subject works in; an asker who cannot read
one of them cannot observe the subject there, so the set they reach is strictly
smaller and the claim does not match.

**Depths 2 and 3 are not tight, and that is a consequence of a fix we were right
to make.** `pair:A:B` asserts something about A and B alone, but inherits the
union of every space its supports touch. We raised that requirement deliberately
after traversal caught it under-stated — correct for provenance, worth nothing
for content.

Closing the gap is a **minimum cut**, not a stronger requirement: the asker is
rebuilding the claim from evidence they are entitled to, and no requirement on
the derived node reaches that evidence. The price is **37.7% of the evidence an
asker may legitimately read**. Provenance confidentiality is free; content
confidentiality is not.

**Stating a soundness theorem without naming the property it does not cover is
the same failure as a check that compares a value to itself.** Both are true and
neither can fail.

---

## Verification, three ways

A proof about the rule says nothing about whether the implementation obeys it.

**1. Exhaustive check.** All 330,190 (fact, principal) pairs — every principal
in the organisation against every fact whose requirement was traversed, not a
sample. Requirements come from graph traversal and are compared against a
requirement recomputed independently from the corpus files.

```
violations: 0
```

**2. Independence of the two derivations.** The first version of this check
compared `admissible(required)` against `admissible(required)` — the same value
twice. It could not have failed and it passed for hours. Once the comparison was
against an independent recomputation, 47 facts disagreed with themselves, and
that is how the shared-link space-scoping bug was found.

**A security property only ever checked against the field that produced it is
not being checked at all.**

**3. Property-based test.** Random derivation DAGs with random permission
assignments, asserting the theorem's conclusion directly:
`disclosed(f, p) ⇒ closure(f) ⊆ perm(p)`. A generative test is the structural
answer to the class of mistake in (2) — it cannot be satisfied by an accidental
tautology, because it constructs cases the author did not think of. See
`test/soundness.test.ts`.

---

## Scope — what this does not prove

The theorem covers **explicit derivation only**. Stating it without stating the
limits would be the same failure as the tautological check: a claim that cannot
be falsified because nobody wrote down what it excludes.

| not covered | status | measured in |
|---|---|---|
| **Compositional inference** — the asker rebuilding a denied claim by re-running our own published rules | **measured and priced**, not closed by default | [INFERENCE.md](INFERENCE.md) — 1,208 phantom denials; closing them costs 37.7% of readable evidence |
| **Refusal as an oracle** — the refusal itself carrying information | mitigable | [the threat model](https://github.com/iamdflame/cordon#the-threat-model) |
| **Timing** — deeper facts traverse further, so latency correlates with depth | unmeasured | — |
| **Cross-principal collusion** — two principals pooling permitted answers | unmeasured | — |
| **Correctness of `perm`** | out of scope | it is fetched, not modelled — see [RESULTS-GITHUB.md](RESULTS-GITHUB.md) |
| **Correctness of extraction** | out of scope | a fact attached to the wrong entity is a resolution error, not a disclosure error; resolution precision is 100.0% at recall 99.0% |

The pairing matters more than either half: **proved here, measured there.** A
soundness theorem with no threat model beside it invites the reader to assume
the theorem covers everything, and it does not.
