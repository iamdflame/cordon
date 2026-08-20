# Results: real permissions

Regenerate with `npm run audit:github`. No credentials needed — it replays
`fixtures/github/snapshot.json`, captured from the live API on
2026-08-20. Re-capture with `--fetch` and a `gh` login.

The strongest objection to the [HERB results](RESULTS.md) is that we invented
the access control we then enforced. This run removes that objection: the
permissions are read out of a system that already has them, and the ground truth
is an HTTP status code.

## The source system

| repository | visibility | collaborators |
|---|---|---|
| `cordon-demo/cordon-demo-atlas` | **private** | 1 |
| `cordon-demo/cordon-demo-borealis` | **private** | 1 |
| `cordon-demo/cordon-demo-cygnus` | **private** | 1 |
| `cordon-demo/cordon-demo-draco` | **private** | 1 |
| `cordon-demo/cordon-demo-fornax` | **private** | 1 |
| `cordon-demo/cordon-demo-handbook` | public | 1 |
| `cordon-demo/cordon-demo-eridanus` | public | 1 |
| `cordon-demo/cordon-demo-gemini` | public | 1 |

49 issues, 0 comments.

**Principals** are real accounts plus `public`, the unauthenticated internet.
A public repository is readable by `public` because it genuinely is. A private
one is readable by its collaborators because GitHub says so — and returns 404 to
everyone else.

## The same pipeline

```
corpus -> mentions -> resolution -> derivation -> HydraDB -> admissibility
```

Only the first stage differs from the HERB run: a connector that returns the
same `Corpus` shape. Extraction, entity resolution, fact derivation, ingest and
the admissibility rule are the same code, unmodified.

105 facts (38 derived) over 49 sources,
13 principals, 1,365 (fact, principal) pairs.

## Disclosure

A derived fact has no document, so a document-level gate must invent an
attribution for it. These are the readings real systems use.

| gate | leaked |
|---|---|
| filed-under | 137 |
| any-source | 453 |
| cordon | 0 |

- **filed-under** — gate by the single space the node carries. What a graph
  store gives you when a node has one owning-collection property.
- **any-source** — gate by whether the asker can read *any* supporting document.
  What happens when a derived node is indexed once per source and the retriever
  unions the hits.
- **cordon** — gate by every space the derivation depends on.

## The gates disagree with each other

453 of the 453 (fact, principal) pairs that must be withheld would be
decided differently depending on which of its own sources the node was
attributed to.

> Priya Raman (mentioned) is active across 5 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-cygnus, cordon-demo-fornax, cordon-demo-handbook.
>
> asker `public` — attributed to `cordon-demo-fornax`: **withheld**; attributed to `cordon-demo-handbook`: **disclosed**

> Priya Raman (mentioned) is active across 5 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-cygnus, cordon-demo-fornax, cordon-demo-handbook.
>
> asker `team:billing` — attributed to `cordon-demo-fornax`: **withheld**; attributed to `cordon-demo-atlas`: **disclosed**

> Priya Raman (mentioned) is active across 5 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-cygnus, cordon-demo-fornax, cordon-demo-handbook.
>
> asker `team:corpdev` — attributed to `cordon-demo-fornax`: **withheld**; attributed to `cordon-demo-borealis`: **disclosed**

Same graph, same permissions, same asker, opposite answer. Cordon returns the
same answer under every attribution, because it never reads the attribution.

## Ground truth

> Priya Raman (mentioned) is active across 5 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-cygnus, cordon-demo-fornax, cordon-demo-handbook.

Rests on `cordon-demo-fornax`, `cordon-demo-borealis`, `cordon-demo-atlas`, `cordon-demo-handbook`, `cordon-demo-cygnus`. The anonymous asker holds `cordon-demo-handbook` — enough for a document-level gate — and lacks `cordon-demo-fornax`, `cordon-demo-borealis`, `cordon-demo-atlas`, `cordon-demo-cygnus`.

Source: https://github.com/cordon-demo/cordon-demo-fornax/issues/2

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/cordon-demo/cordon-demo-fornax/issues/2
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.

---

> Tomas Nowak (mentioned) is active across 4 product areas: cordon-demo-atlas, cordon-demo-draco, cordon-demo-fornax, cordon-demo-gemini.

Rests on `cordon-demo-fornax`, `cordon-demo-gemini`, `cordon-demo-draco`, `cordon-demo-atlas`. The anonymous asker holds `cordon-demo-gemini` — enough for a document-level gate — and lacks `cordon-demo-fornax`, `cordon-demo-draco`, `cordon-demo-atlas`.

Source: https://github.com/cordon-demo/cordon-demo-fornax/issues/2

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/cordon-demo/cordon-demo-fornax/issues/2
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.

---

> Marcus Vale (mentioned) is active across 4 product areas: cordon-demo-atlas, cordon-demo-cygnus, cordon-demo-draco, cordon-demo-handbook.

Rests on `cordon-demo-draco`, `cordon-demo-atlas`, `cordon-demo-handbook`, `cordon-demo-cygnus`. The anonymous asker holds `cordon-demo-handbook` — enough for a document-level gate — and lacks `cordon-demo-draco`, `cordon-demo-atlas`, `cordon-demo-cygnus`.

Source: https://github.com/cordon-demo/cordon-demo-draco/issues/2

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/cordon-demo/cordon-demo-draco/issues/2
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.
