# Hack Hydra 2026 submission — paste-ready answers

For some judges this is read before the repository, so it is written to stand
alone. Copy each fenced block into the matching form field.

---

## Project Name

```
Cordon
```

## Project Description

```
Cordon is a permission-propagating enterprise knowledge graph built on HydraDB.
It prevents derived facts from laundering restricted source material by making
every fact inherit the access requirements of everything it rests on, then
enforcing those requirements through a live console, API, and MCP server.

It also ships the measurement behind the product: a reproducible benchmark,
soundness proof, exhaustive audits, and adversarial tests showing where
document-level access control fails once an AI system begins to infer.
```

---

## What problem are you solving?

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

## What did you build?

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

The product includes a derivation-chain inspector for 13 real GitHub team
principals, three selectable gates, a standalone /v1/admissible endpoint, an MCP
server that existing RAG stacks can call, and DKL, a packaged benchmark for
measuring derived-knowledge leakage in another graph.
```

## How does your project use HydraDB?

Be specific here. Vagueness reads as a wrapper.

```
Admissibility is a variable-length traversal that cannot be precomputed, and it
is the whole product.

  MATCH (f:Fact)-[:RESTS_ON*1..5]->(s:Source) RETURN s.space

The requirement is *discovered* by walking RESTS_ON, per asker, at query time —
never read from a field. It cannot be materialised: with n principals there are
2^n visibility subsets, and precomputing per principal is 30M rows that a single
membership change invalidates.

A vector index cannot express this even in principle. An embedding records what
a fact resembles, not what it was derived from, and a constraint that propagates
along derivation has nothing to travel down. Similarity is not provenance.

The graph is 95,898 nodes and 226,357 edges. We also publish what does *not*
run in the engine: the transitive org closure is application-side, because
variable-length MATCH requires a fixed source id, so a closure over a whole
relation has to be driven from the client one bound start node at a time.

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

The first is a correctness bug in an authorisation path, and finding it is the
most useful thing this project can hand back to the HydraDB team.
```

## Tech Stack

```
TypeScript, Node.js 20, Fastify, React, Vite, HydraDB HTTP/OpenCypher API,
Docker Compose, Zod, undici, GitHub API, Node test runner, and OpenAI API
(optional, for the cached LLM adversary evaluation).
```

## Deployed Project URL

```
https://cordon-graph.vercel.app
```

## Public GitHub Repository URL

```
https://github.com/iamdflame/cordon
```

## 3-Minute Pitch + Demo Video

```
https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n
```

## Anything else the judges should know?

```
The headline result is exhaustive, not sampled: Cordon has 0 violations over
all 330,190 (fact, principal) pairs while preserving answer F1 with 0 false
denials. The same pipeline also runs over permissions we did not invent: eight
real GitHub repositories, five private and three public, with 11 nested teams.
For every source beneath a withheld fact, the audit makes an unauthenticated
request and verifies GitHub's refusal; all 26 return 404.

We also attacked the boundary of our own proof. On a cross-repository fixture,
per-fact provenance control still allowed 16 of 130 denied facts to be rebuilt
by aggregation. Cordon ships the stronger named-space policy that reduces that
to 0, reports its cost of 54 additional withholdings, and includes a
disclosure-ledger planner for compositional inference across repeated queries.
The repository states these limitations rather than folding them into the
headline security claim.

Finally, using HydraDB exposed a silent 1,024-row truncation in an authorization
query. We added a fail-closed client guard and filed three reproducible upstream
issues: hydra-db/hydradb#115, #116, and #117. A clean checkout runs with
`docker compose up`; the live console is at
https://cordon-graph.vercel.app/console.
```

---

## Pre-submit checklist

- [ ] Video under 3:00, uploaded, **watched logged-out in a private window**
- [ ] Repo URL opens logged-out
- [ ] Demo/deploy link opens logged-out
- [ ] README first line is the one sentence, unchanged
- [ ] Commit-history note present in README
- [ ] No rounded counts anywhere — say "all 26", never "100%"
- [ ] LICENSE detected by GitHub as Apache-2.0, not NOASSERTION
- [ ] Every README link clicked, including the eight doc links
- [ ] Submit early; do not discover a broken link at 11:58 PM
