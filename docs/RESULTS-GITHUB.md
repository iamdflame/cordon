# Results: real permissions

Regenerate with `npm run audit:github`. No credentials needed — it replays
`fixtures/github/snapshot.json`, captured from the live API on
2026-08-19. Re-capture with `--fetch` and a `gh` login.

The strongest objection to the [HERB results](RESULTS.md) is that we invented
the access control we then enforced. This run removes that objection: the
permissions are read out of a system that already has them, and the ground truth
is an HTTP status code.

## The source system

| repository | visibility | collaborators |
|---|---|---|
| `iamdflame/cordon-demo-atlas` | **private** | 1 |
| `iamdflame/cordon-demo-borealis` | **private** | 1 |
| `iamdflame/cordon-demo-handbook` | public | 1 |

13 issues, 0 comments.

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

26 facts (3 derived) over 13 sources,
2 principals, 52 (fact, principal) pairs.

## Disclosure

A derived fact has no document, so a document-level gate must invent an
attribution for it. These are the readings real systems use.

| gate | leaked |
|---|---|
| filed-under | 0 |
| any-source | 3 |
| cordon | 0 |

- **filed-under** — gate by the single space the node carries. What a graph
  store gives you when a node has one owning-collection property.
- **any-source** — gate by whether the asker can read *any* supporting document.
  What happens when a derived node is indexed once per source and the retriever
  unions the hits.
- **cordon** — gate by every space the derivation depends on.

## The gates disagree with each other

3 of the 3 (fact, principal) pairs that must be withheld would be
decided differently depending on which of its own sources the node was
attributed to.

> Priya Raman (mentioned) is active across 3 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-handbook.
>
> asker `public` — attributed to `cordon-demo-borealis`: **withheld**; attributed to `cordon-demo-handbook`: **disclosed**

> Elena Fischer (mentioned) is active across 2 product areas: cordon-demo-borealis, cordon-demo-handbook.
>
> asker `public` — attributed to `cordon-demo-borealis`: **withheld**; attributed to `cordon-demo-handbook`: **disclosed**

> 2 people contribute to both cordon-demo-borealis and cordon-demo-handbook, forming a shared delivery path between the two areas.
>
> asker `public` — attributed to `cordon-demo-borealis`: **withheld**; attributed to `cordon-demo-handbook`: **disclosed**

Same graph, same permissions, same asker, opposite answer. Cordon returns the
same answer under every attribution, because it never reads the attribution.

## Ground truth

> Priya Raman (mentioned) is active across 3 product areas: cordon-demo-atlas, cordon-demo-borealis, cordon-demo-handbook.

Rests on `cordon-demo-handbook`, `cordon-demo-borealis`, `cordon-demo-atlas`. The anonymous asker holds `cordon-demo-handbook` — enough for a document-level gate — and lacks `cordon-demo-borealis`, `cordon-demo-atlas`.

Source: https://github.com/iamdflame/cordon-demo-borealis/issues/4

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/iamdflame/cordon-demo-borealis/issues/4
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.

---

> Elena Fischer (mentioned) is active across 2 product areas: cordon-demo-borealis, cordon-demo-handbook.

Rests on `cordon-demo-handbook`, `cordon-demo-borealis`. The anonymous asker holds `cordon-demo-handbook` — enough for a document-level gate — and lacks `cordon-demo-borealis`.

Source: https://github.com/iamdflame/cordon-demo-borealis/issues/4

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/iamdflame/cordon-demo-borealis/issues/4
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.

---

> 2 people contribute to both cordon-demo-borealis and cordon-demo-handbook, forming a shared delivery path between the two areas.

Rests on `cordon-demo-handbook`, `cordon-demo-borealis`, `cordon-demo-atlas`. The anonymous asker holds `cordon-demo-handbook` — enough for a document-level gate — and lacks `cordon-demo-borealis`, `cordon-demo-atlas`.

Source: https://github.com/iamdflame/cordon-demo-borealis/issues/4

```
$ curl -s -o /dev/null -w '%{http_code}' \
    https://api.github.com/repos/iamdflame/cordon-demo-borealis/issues/4
404
```

GitHub refuses to show the document. The fact derived from it was disclosed anyway.
