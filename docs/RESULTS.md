# Results

Regenerate with `npm run audit`. Deterministic:
sampling is seeded, and no language model is involved at any stage.

1,514 HERB questions x 12 principals
sampled across the access spectrum x 3 systems = 18,168
trials each.

## Leakage against utility

All three systems use **identical retrieval**. The only difference is what each
is willing to disclose.

| system | leak rate | leaked facts | answer F1 | abstention | false denials |
|---|---|---|---|---|---|
| ungated | 100.0% | 440,838 | 0.075 | 0.0% | 0 |
| document-acl | 17.4% | 10,617 | 0.099 | 22.8% | 0 |
| cordon | 0.0% | 0 | 0.099 | 25.7% | 0 |
| BM25, no graph | n/a | - | 0.065 | - | - |

- **ungated** — an ACL-free knowledge graph. What you get by default.
- **document-acl** — filter by the artifact's own space. What deployed
  enterprise assistants do, and what a knowledge graph gives you when ACLs are
  modelled on documents rather than on derivations.
- **cordon** — requirements derived by traversal and checked in full.

## Leaks by derivation depth

The thesis, as a curve. Document-level filtering is sound for facts read
directly from one artifact and fails progressively as knowledge is synthesised
across sources.

| depth | facts | ungated | document-acl | cordon |
|---|---|---|---|---|
| 0 | 56,301 | 332,761 | 0 | 0 |
| 1 | 503 | 38,345 | 3,626 | 0 |
| 2 | 60 | 4,176 | 400 | 0 |
| 3 | 60 | 65,556 | 6,591 | 0 |

## Is the baseline even well-defined?

A derived fact carries one space, assigned when the node was written — whichever
supporting document the writer happened to reach first. That assignment is what
a document-level gate reads.

So for every (fact, principal) pair the fact must be withheld from, we asked
whether the gate would have answered differently had the same node been
attributed to a different one of *its own sources*.

| | pairs |
|---|---|
| must be withheld | 7,280 |
| **decision flips with attribution** | **1,008** (13.8%) |
| decision stable | 6,272 |

Same graph, same permissions, same asker — opposite answer. On those pairs the
document-level gate is neither conservative nor permissive; it is **arbitrary**,
and which way it falls is settled by ingest order rather than by anything about
the person asking.

Cordon's answer is invariant under attribution, because it never reads the
attribution. It reads the derivation.

## Audience collapse

A fact's audience is the intersection of the audiences of everything it rests
on, so it shrinks as derivation deepens.

| depth | facts | mean spaces required | mean audience (of 530) | visible to nobody |
|---|---|---|---|---|
| 0 | 56,301 | 1.00 | 46.2 | 0% |
| 1 | 503 | 3.52 | 17.9 | 47% |
| 2 | 60 | 4.85 | 0.0 | 100% |
| 3 | 60 | 4.93 | 0.0 | 100% |

A knowledge graph that serves derived facts to anyone who can read *any* of
their sources discloses to 46+ people what ought to be visible to none.

## The invariant, checked exhaustively

330,190 (fact, principal) pairs, every principal in the
organisation against every fact whose requirement was traversed. Not sampled.

```
violations: 0
```

Requirements are derived by traversal at audit time, never read from the field
the pipeline wrote. Of the facts checked, **623 agree
with the graph and 0 disagree** — an earlier build had 47
disagreements and that is how the space-scoping bug was found.

## Concrete leaks

**Alice Taylor** (Chief Product Officer) asked: *Find employee IDs of Chief Product Officers who reviewed the Technical Specifications Document for FeedbackFor*

> Alice Taylor (Chief Product Officer) is active across 4 product areas: EdgeForce, ExplainabilityForce, FeedbackForce, PersonalizeForce.

A level-1 derived fact requiring `EdgeForce`, `PersonalizeForce`, `ExplainabilityForce`, `FeedbackForce`. This asker holds `EdgeForce`, `FeedbackForce`, `PersonalizeForce` and lacks `ExplainabilityForce`. Document-level filtering disclosed it because the artifact it is primarily attributed to *is* readable by them.

---

**Julia Williams** (Technical Architect) asked: *Find employee IDs of Chief Product Officers who reviewed the Technical Specifications Document for FeedbackFor*

> David Martinez (Chief Product Officer) is active across 4 product areas: AutoTuneForce, EdgeForce, FeedbackForce, PersonalizeForce.

A level-1 derived fact requiring `FeedbackForce`, `PersonalizeForce`, `EdgeForce`, `AutoTuneForce`. This asker holds `AutoTuneForce`, `FeedbackForce` and lacks `PersonalizeForce`, `EdgeForce`. Document-level filtering disclosed it because the artifact it is primarily attributed to *is* readable by them.

---

**Julia Williams** (Technical Architect) asked: *Find employee IDs of Chief Product Officers who reviewed the Technical Specifications Document for FeedbackFor*

> Charlie Brown (Chief Product Officer) is active across 4 product areas: AutoTuneForce, ExplainabilityForce, FeedbackForce, PersonalizeForce.

A level-1 derived fact requiring `PersonalizeForce`, `AutoTuneForce`, `ExplainabilityForce`, `FeedbackForce`. This asker holds `AutoTuneForce`, `FeedbackForce` and lacks `PersonalizeForce`, `ExplainabilityForce`. Document-level filtering disclosed it because the artifact it is primarily attributed to *is* readable by them.

---

**Julia Williams** (Technical Architect) asked: *Find employee IDs of Chief Product Officers who reviewed the Technical Specifications Document for FeedbackFor*

> Julia Williams (Technical Architect) is active across 4 product areas: AutoTuneForce, EdgeForce, FeedbackForce, PersonalizeForce.

A level-1 derived fact requiring `EdgeForce`, `FeedbackForce`, `AutoTuneForce`, `PersonalizeForce`. This asker holds `AutoTuneForce`, `FeedbackForce` and lacks `EdgeForce`, `PersonalizeForce`. Document-level filtering disclosed it because the artifact it is primarily attributed to *is* readable by them.

---

**Julia Williams** (Technical Architect) asked: *Find employee IDs of Chief Product Officers who reviewed the Technical Specifications Document for FeedbackFor*

> George Davis (Technical Architect) is active across 4 product areas: AutoTuneForce, EdgeForce, FeedbackForce, PersonalizeForce.

A level-1 derived fact requiring `EdgeForce`, `FeedbackForce`, `PersonalizeForce`, `AutoTuneForce`. This asker holds `AutoTuneForce`, `FeedbackForce` and lacks `EdgeForce`, `PersonalizeForce`. Document-level filtering disclosed it because the artifact it is primarily attributed to *is* readable by them.

