# Submission form — drafted answers

For some judges this is read before the repository, so it is written to stand
alone. Copy the fenced blocks verbatim.

---

## Project name

```
Cordon
```

## One-line description / tagline

The same sentence appears in the repo description, README line one, the video's
first eight seconds, and here. It has to survive into a deliberation nobody from
the team is in the room for.

```
Derived knowledge inherits the access control of everything it was derived from.
```

---

## The problem

```
Every enterprise AI assistant filters what it retrieves by document
permissions. That is correct, right up until the system infers something.

A fact derived from three documents is not a document. It has no ACL of its
own. So a knowledge graph built over a permissioned corpus quietly launders
restricted material into an unrestricted form — and no file-access audit will
ever show it, because what leaked was never a file.

Measured on Salesforce's HERB enterprise benchmark: document-level filtering
leaks on 17.4% of trials. It is exactly correct at derivation depth 0 and fails
only on derived facts, so this is not a bug in anyone's implementation. It is
the ceiling of the idea.
```

## What we built

```
A permission-propagating enterprise knowledge graph on HydraDB, plus the
measurement that shows why one is needed.

The rule: requiredSpaces(fact) = union of requiredSpaces of everything it rests
on; a principal may see a fact only if they hold all of them. Union on
requirements is intersection on audience — a fact synthesised from two products
is visible to the intersection of their two audiences, not the union.

Results, 1,514 HERB questions x 12 principals x 3 systems = 18,168 trials each,
identical retrieval throughout:

  ungated knowledge graph        100.0% leak rate
  document-level ACL filtering    17.4% leak rate
  Cordon                           0.0% leak rate, same answer F1, 0 false denials

Verified over all 330,190 (fact, principal) pairs, not a sample: 0 violations.
Requirements come from traversal and are compared against a requirement
recomputed independently from the corpus, because a security property checked
against the field that produced it is not being checked at all.

Three things beyond the headline:

1. The baseline is not just wrong, it is arbitrary. A derived fact carries one
   space, assigned by whichever source the writer reached first, and that is
   what a document gate reads. On 1,008 of the 7,280 pairs it is supposed to
   protect, its answer flips depending on that attribution. A security decision
   settled by ingest order is not a security decision. Cordon's answer never
   changes, because it never reads the attribution.

2. The whole thing runs again over permissions we did not write. Eight real
   GitHub repositories, five private and three public, fetched live. Only the
   loader differs; extraction, resolution, derivation and the admissibility
   rule are the same code. For every source under a withheld fact the audit
   issues an unauthenticated request and asserts the refusal: 20/20 return 404.
   The test oracle is GitHub's server, not our model of it.

3. We measured the channels we did not close. Compositional inference — whether
   permitted answers jointly reconstruct a denied one — and the refusal side
   channel our own defence opens, quantified in bits, with an
   indistinguishable-abstention mode that closes it and a plain statement of
   what that costs. A security claim that names only the channel it closed is a
   result, not a threat model.

Also shipped: a soundness proof by induction with its scope stated, a
property-based test that cannot pass vacuously, a standalone /v1/admissible
endpoint and MCP server so any existing RAG stack can call the gate, and DKL —
the derived-knowledge leakage benchmark — packaged so anyone can measure their
own graph.
```

## How it uses HydraDB

Be specific here. Vagueness reads as a wrapper.

```
Admissibility is a variable-length traversal that cannot be precomputed, and it
is the whole product.

  MATCH (f:Fact)-[:RESTS_ON*1..5]->(s:Source) RETURN s.space

The requirement is *discovered* by walking RESTS_ON, per asker, at query time —
never read from a field. It cannot be materialised: with n principals there are
2^n visibility subsets, and precomputing per principal is 30M rows that a single
membership change invalidates. docs/LATENCY.md turns that argument into numbers
rather than leaving it an assertion.

A vector index cannot express this even in principle. An embedding records what
a fact resembles, not what it was derived from, and a constraint that propagates
along derivation has nothing to travel down. Similarity is not provenance.

The graph is 95,898 nodes and 226,357 edges. What runs where is published in
docs/WHERE-IT-RUNS.md, including the part that is application-side: the
transitive org closure, because a variable-length pattern composed with one
further fixed hop times out at 30s while the variable-length half alone takes
287ms.

Three engine behaviours shaped the design, all documented in
docs/HYDRADB-ENGINE-NOTES.md:

  - `MATCH (n)` with no label or predicate is rejected.
  - Alternation inside a variable-length pattern (-[:A|B*1..n]->) is rejected,
    which is why RESTS_ON is one edge type rather than one per support kind.
  - A 1,024-row cap silently truncated a query for the membership relation,
    returning 1,024 of 1,371 rows with no error — a quarter of the access-control
    table missing, failing open, looking exactly like success. Passing the
    continuation cursor back returns zero rows, and an explicit LIMIT above the
    cap is silently reduced rather than honoured. We added a client-side guard
    that throws on truncation-with-cursor.

We filed three findings upstream with reproductions:

  hydra-db/hydradb#115  results silently truncate at 1024 rows; cursor empty
  hydra-db/hydradb#116  no batch write path for labelled nodes
  hydra-db/hydradb#117  five OpenCypher subset constraints, one silent failure

That last one is a correctness bug in an authorisation path, and finding it is
the most useful thing this project can hand back to the HydraDB team.
```

## Repository

```
https://github.com/iamdflame/cordon
```

## Live demo

```
https://cordon-graph.vercel.app
```

Console (13 real GitHub team principals, three gates, derivation chains):
`https://cordon-graph.vercel.app/console`

## Demo video

```
<paste the URL once uploaded — verify it plays logged-out before submitting>
```

---

## Pre-submit checklist

- [ ] Video under 3:00, uploaded, **watched logged-out in a private window**
- [ ] Repo URL opens logged-out
- [ ] Demo/deploy link opens logged-out
- [ ] README first line is the one sentence, unchanged
- [ ] Commit-history note present in README
- [ ] No rounded counts anywhere — say "all 26", never "100%"
- [ ] Submit early; do not discover a broken link at 11:58 PM
