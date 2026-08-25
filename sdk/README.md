# @cordon/client

**Derived-knowledge access control for enterprise AI. Keep your stack, add the gate.**

A fact inferred from three documents is not a document. It has no ACL of its
own — so document-level filtering, which is what every enterprise AI assistant
ships, has no answer for it. This is the client for the thing that does.

```bash
npm install @cordon/client
```

Zero dependencies. Node 18+, Deno, Bun, browsers, edge runtimes.

---

## The two calls

```ts
import { Cordon } from '@cordon/client';

const cordon = new Cordon({ url: 'http://localhost:8787' });
```

### Per fact — may this principal see what you retrieved?

Retrieval-agnostic. Post whatever your ranker produced.

```ts
const { admitted, withheld } = await cordon.admissible(asker, factIds);

for (const w of withheld) {
  console.log(`${w.id} needs ${w.requires.join(', ')}; missing ${w.missing.join(', ')}`);
}
```

### Per answer — is the *set* safe?

This is the one people miss. **Every fact in a reply can be individually
admissible while the reply as a whole re-derives something the asker was
refused.** `admissible` cannot see that, because the dangerous object never
appears in the list being checked.

```ts
const plan = await cordon.plan(asker, rankedFactIds, { session: true });

plan.disclosed;    // safe to serve, in your rank order
plan.suppressed;   // entitled to these, withheld anyway — and why
plan.safe;         // re-checked server-side before returning
```

`session: true` evaluates against everything this principal has already been
shown, because **per-query safety does not compose** — ten individually safe
answers can jointly rebuild a refused claim.

---

## Failing closed

Every path that cannot reach a decision **throws** rather than returning a
permissive default. A network blip that silently resolved to "admitted" would be
a disclosure bug in your product caused by our convenience, so there is no
`catch { return facts }` anywhere in this client.

Concretely:

- Ids Cordon does not recognise come back in `unknown` and are **not** admitted.
- `5xx` and network failures retry with backoff. **`4xx` never retries** — a
  refusal is a decision, and retrying one until it succeeds is precisely the bug
  this project exists to prevent.
- `admissibleOrThrow` exists so the safe path is also the short one.

```ts
try {
  const ids = await cordon.admissibleOrThrow(asker, factIds);
} catch (e) {
  if (e instanceof CordonDeniedError) {
    // e.withheld carries the missing spaces, so the refusal stays actionable
  }
}
```

---

## Operator surface

```ts
await cordon.risk();                       // derived facts, fewest readers first
await cordon.session(principal);           // what a session has accumulated
await cordon.explain(factId);              // the derivation, walked
await cordon.previewPolicy({               // what a grant would actually cost
  grants: [{ subject: 'team:billing', space: 'atlas' }],
  includeInference: true,
});
```

`previewPolicy` returns the number no document-level access review can produce.
Measured over 150 real grants: **100% of the derived facts a grant discloses
were unlocked *in combination* with access the person already held.** Nobody
approved those; they are not documents, so nothing shows them.

---

## Reference

| method | what it answers |
|---|---|
| `health()` / `waitUntilReady(ms)` | is the graph queryable yet |
| `admissible(principal, ids)` | per fact: may they see these |
| `admissibleOrThrow(principal, ids)` | same, but throws on any refusal |
| `plan(principal, ids, { session })` | per answer: which subset is safe |
| `planIds(principal, ids)` | the surviving ids, in rank order |
| `explain(factId)` | why this fact requires what it requires |
| `risk()` | the exposure map |
| `previewPolicy(change)` | what a grant or revoke would disclose |
| `session(principal)` / `resetSession(principal)` | disclosure budget |
| `principals()` | everyone who can hold a permission |

**Options:** `{ url, timeoutMs = 15000, retries = 3, headers, fetch }`.
Pass your own `fetch` to route through a proxy or instrument calls.

**Errors:** `CordonError` (base), `CordonUnavailableError` (503, retryable),
`CordonDeniedError` (carries `withheld`).

---

Apache-2.0 · [github.com/iamdflame/cordon](https://github.com/iamdflame/cordon)
