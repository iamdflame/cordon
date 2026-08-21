# What a grant actually costs

Regenerate with `npm run audit:policy`.

An administrator adds one person to one team. Every access-review tool in
existence tells them what that grants: **the documents in that space.** That
answer is correct, and it is not the whole answer.

It also grants every derived fact whose *entire requirement* is now covered —
facts resting on spaces the administrator was not thinking about, because the
person already had them.

```
before:   Alice may read {A, B}       F requires {A, B, C}   denied
grant C:  Alice may read {A, B, C}    F requires {A, B, C}   DISCLOSED
```

Nobody granted Alice access to *F*. Nobody was asked about *F*. **F is not a
document, so it appears in no document-level access review.**

## Measured, over 150 single grants

| | | |
|---|---|---|
| documents disclosed | 713,882 | what the administrator expects |
| **derived facts disclosed** | **380** | invisible to a document-level review |
| **…unlocked only in combination** | **380** | required a space they already held |

| | |
|---|---|
| grants that disclosed derived facts | 4 of 150 (2.7%) |
| grants with a combination unlock | 4 (2.7%) |
| mean derived facts per unlocking grant | 95.0 |

> ### 100.0% were unlocked *in combination*
>
> Of the 380 derived facts these grants disclosed,
> 380 required a space the principal **already held**.
> They were not granted. They were **completed** — and the administrator
> approving "read access to one space" approved every one of them without being
> shown a single one.

### Widest blast radius

| space granted | documents | derived | of which combination |
|---|---|---|---|
| `ForecastForce` | 5,607 | **231** | 231 |
| `FlowForce` | 4,650 | **81** | 81 |
| `ProposalForce` | 5,430 | **66** | 66 |
| `VizForce` | 4,730 | **0** | 0 |
| `PersonalizeForce` | 5,046 | **0** | 0 |

---

## The second-order effect

A grant also adds *evidence*, and evidence feeds the derivation rules in
[closure.ts](../src/cordon/closure.ts). So a grant can push a **still-refused**
claim within rebuilding distance without ever disclosing it.

| | |
|---|---|
| grants analysed for inference | 30 |
| refused claims made rebuildable | **18** |

An impact analysis that counts only what became *readable* is measuring the
smaller half of the change.

---

## The round-trip, checked

Every number above would be measuring the policy layer's bugs rather than the
grant if the compiled policy did not reproduce the enforced model. So it is
checked rather than assumed, and the audit **exits non-zero** on any drift.

| | |
|---|---|
| principals | 530 |
| grants in the imported policy | 1,370 |
| **principals whose access drifted** | **0** |

`policyFromModel` reads a policy back out of whatever is already true — an
org chart, a GitHub org, a spreadsheet. A policy language an operator must
hand-write from nothing does not get adopted.

## What this does not claim

- **Grants only.** Revocation is implemented and symmetric, but the sweep here
  simulates additions, which is the direction administrators actually take.
- **One grant at a time.** Real changes arrive in batches, and batched blast
  radius is superadditive — two grants can unlock a fact neither unlocks alone.
- **The second-order sample is small** (30), because it runs the
  full rule engine twice per grant.
