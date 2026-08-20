# HydraDB capability map

What the OSS engine does, what it does not, and what it cost us to find out.
Written while hitting each limit, so the next person hits none of them.

**Filed upstream**, with reproductions:

| # | issue | severity |
|---|---|---|
| [115](https://github.com/hydra-db/hydradb/issues/115) | Results silently truncate at 1024 rows; continuation cursor returns an empty page | **high** — fails open-looking in an authorization path |
| [116](https://github.com/hydra-db/hydradb/issues/116) | No batch write path for labelled nodes; sustained write pressure exits the node | medium |
| [117](https://github.com/hydra-db/hydradb/issues/117) | Five OpenCypher subset constraints, and one silent write failure | low / documentation |

Empirically probed against `ghcr.io/hydra-db/hydradb:latest` (v0.1.0) on 2026-08-18.
The published README advertises "a practical OpenCypher subset"; this documents what
that subset *actually* is, discovered by systematic probing.

## Transport

    POST http://127.0.0.1:8443/v1/graphs/{graph}/query
    Authorization: Bearer <token>
    X-Graph-Namespace: default
    Body: {"cell_id":"cell-0","query":"<cypher>","parameters":{...}}

Bolt also available on :7687 (Neo4j drivers). Admin/metrics on :9090.

## SUPPORTED

| Capability | Form | Notes |
|---|---|---|
| Create node+edge | `CREATE (a:L {id:1})-[:R]->(b:L {id:2})` | **exactly one hop** |
| Match | `MATCH (n:L) RETURN n.id, n.name` | |
| Filtered match | `MATCH (a:L {id:1})-[:R]->(b:L)` | |
| Var-length reach | `MATCH (a:L {id:1})-[:R*1..6]->(b:L {id:4})` | true reachability |
| Shortest path | `CALL algo.SPpaths({relTypes:["R"], sourceNode:1, targetNode:4}) YIELD path RETURN path` | **returns full hydrated path** |
| Single-source | `CALL algo.SSpaths({relTypes:["R"], sourceNode:1}) YIELD path RETURN path` | |
| count | `RETURN count(*)` | |

### The path payload (this is the proof object)

    {"type":"path","value":{
      "nodes":[{"id":1,"labels":["Fn"],"properties":{"name":{"String":"entry"}}}, ...],
      "relationships":[{"id":1,"edge_type":"CALLS","src":1,"dst":2,"properties":{}}, ...]
    }}

## NOT SUPPORTED (verified failures)

| Attempt | Error |
|---|---|
| `CREATE (a {id:1})` (node only) | `only one-hop edge patterns are executable in Query engine CREATE` |
| Multi-hop CREATE chain | same |
| String node ids | `node id property must be an integer` |
| `MATCH ... CREATE ...` | `write query is not executable by the mutation engine` |
| `RETURN length(p)` / `nodes(p)` / `RETURN p` | `RETURN currently supports <binding>.<property> or count(*)` |
| `UNWIND $p AS x CALL algo...` | `query transport cannot authorize an unsupported Cypher clause` |
| `MATCH (s),(t) CALL algo...` | same |
| `CALL dbms.procedures()` | same |
| algo param `relationshipTypes` | must be **`relTypes`** |
| algo call without `YIELD` | `unexpected end of query` |
| `YIELD nodeIds` / arbitrary | `unknown path projection` — only `path` |

## Hard design consequences

1. **Node identity is a 64-bit integer.** All string keys (`pkg@ver#function`)
   must be hashed to a stable integer id. Collisions must be handled explicitly.
2. **Ingestion is one edge per statement.** Bulk load = many concurrent
   single-edge CREATEs. Requires a batched, concurrent, retrying writer.
3. **Node properties are set at edge-creation time.** A node's properties come
   from whichever CREATE first mentions it; later mentions may omit them.
4. **No server-side fan-out.** Multi-source path search must be orchestrated
   client-side as concurrent SPpaths calls — the parallelism budget is ours.
5. **`algo.SPpaths` is the only way to retrieve an actual path**, because
   `RETURN p` is unsupported. Reachability *booleans* come from var-length
   MATCH; reachability *proofs* come from SPpaths.

## Write throughput (measured 2026-08-18)

Ingest is the dominant cost of a scan, so we measured where the ceiling is.

| Transport | Concurrency | Throughput |
|---|---|---|
| HTTP | 8 | 132 edges/s |
| HTTP | 16 | 147 edges/s |
| HTTP | 32 | 132 edges/s |
| HTTP | 64 | 135 edges/s |
| Bolt | 8 | 147 edges/s |
| Bolt | 16 | 148 edges/s |
| Bolt | 32 | 131 edges/s |

Conclusions:

1. **Throughput is server-bound at roughly 150 edges/s.** Bolt and HTTP are
   indistinguishable, so the limit is the durable commit path, not the client
   or the transport.
2. **Client concurrency past ~16 buys nothing** and slightly hurts. Our writer
   therefore fixes concurrency at 16.
3. **There is no batch write path.** Multiple statements per request are
   rejected outright:
   - `a; b` -> `query transport requires exactly one Cypher statement`
   - `a b`  -> `CREATE with following clauses is not executable`
   - No `/batch` endpoint exists.

A 2,400-edge call graph therefore takes ~16s to ingest. We stream progress
rather than hide it. A batch write API is the single highest-value addition
the engine could make for this workload.

---

# Findings from building Cordon (2026-08-19)

Three engine behaviours that changed the architecture. All were discovered by
measurement; none are documented upstream.

## 1. Results are capped at 1024 rows, and the continuation cursor returns nothing

A query over the 1,371 access-control edges returned **exactly 1,024 rows** plus
`next_cursor`, silently dropping a quarter of the authorisation table. No error,
no warning.

Re-verified on a 38,570-node graph, and the behaviour is sharper than we first
recorded it:

```
MATCH (n:Source) RETURN count(*)          -> 38570
MATCH (n:Source) RETURN n.space           -> rows: 1024, next_cursor: 1
  ...same query with cursor: 1            -> rows: 0,    next_cursor: null
MATCH (n:Source) RETURN n.space LIMIT 2000-> rows: 1024, next_cursor: 2
MATCH (n:Source) RETURN n.space SKIP 1024 LIMIT 500
                                          -> rows: 500,  next_cursor: null
```

Three separate problems, in descending nastiness:

1. **The cap is silent.** 1,024 of 38,570 rows, and the response is shaped
   exactly like a complete one.
2. **The continuation cursor yields nothing.** Passing `cursor: 1` back with the
   same query returns *zero* rows and no further cursor, so the remaining 37,546
   rows are simply unreachable through the documented mechanism. (`cursor` also
   requires `query` to be resent; sending it alone is a deserialisation error,
   and sending it as a string rather than a number is another.)
3. **An explicit `LIMIT 2000` is silently capped to 1,024** rather than
   honoured or rejected.

`SKIP`/`LIMIT` *does* page correctly, so a workaround exists — but you have to
know the cap is there to go looking for it.

**Correction to an earlier draft of this note:** we originally wrote that the
cursor "expires" and that `offset`/`page_token`/`start` return the first page
again. Re-testing shows the cursor returns an empty page rather than an
expiry error, and that `SKIP`/`LIMIT` works. The corrected behaviour is above.

**Consequence.** `HydraClient.queryComplete()` throws when a result lands on the
cap with a continuation pending, so an incomplete answer can never masquerade as
a complete one. Any relation that might exceed 1,024 rows is partitioned instead
of paged — membership is fetched per space (~46 rows each) rather than whole.

For a security system this is the single most dangerous engine behaviour we
found: an under-read ACL table fails closed, but it is still wrong, and nothing
surfaces it.

## 2. A variable-length traversal composed with a further hop is pathological

The natural phrasing of "spaces this manager's org can read" times out:

| query | result |
|---|---|
| `(p)-[:MANAGES*1..6]->(r)` | 43 rows, **287ms** |
| `(p)-[:MANAGES*1..2]->(r)` | 43 rows, **140ms** |
| `(p)-[:MANAGES*1..6]->(r)-[:MEMBER_OF]->(sp)` | **30s timeout** |
| `(p)-[:MANAGES*1..3]->(r)-[:MEMBER_OF]->(sp)` | **30s timeout** |

`graph_storage_frontier_source exceeded query timeout`. Depth is not the factor —
the variable-length traversal alone is fast at depth 6. The cost is in the
composition.

Note this contradicts small-graph behaviour: the same shape
(`-[:RESTS_ON*1..6]->(s:Source)-[:IN_SPACE]->(sp:Space)`) returns correctly on a
seven-node test graph. It only degrades at corpus scale.

**Consequence.** Cordon splits such queries: fetch the variable-length relation,
then resolve the final hop separately, or fetch both relations whole when they
are small enough to partition safely.

## 3. Cells are isolated shards, not a distributed graph

Configuring `GRAPH_CELLS=cell-0,cell-1,cell-2,cell-3` makes all four accept
writes, but a write to `cell-0` is **invisible** from `cell-1`.

| cells | throughput |
|---|---|
| 1 | 117 edges/s |
| 2 | 179 edges/s |
| 4 | 192 edges/s |

Sharding a connected knowledge graph across cells would sever every traversal
that crosses a shard boundary — which, for a graph whose entire purpose is
multi-hop derivation, is all of them. The 1.6x write throughput is not worth it.
Cordon runs a single cell and treats ~130 edges/s as the ingest budget.

## Local object store does not implement conditional writes

`CLOUD_PROVIDER=local` backs the store with `LocalFileSystem`, which does not
implement `put_opts` in `PutMode::Update`:

```
object store error: Operation `put_opts` with mode `PutMode::Update`
not yet implemented by LocalFileSystem(file:///data/store).
```

The consequence is specific and expensive to diagnose. A node started fresh over
an empty store writes fine. A node **stopped and started again over a store that
already has data** comes up healthy, answers `MATCH` queries correctly, and then
fails every `CREATE` with `internal query execution error` — no mention of the
object store in the client-visible error, which appears only in the container
log at `WARN`.

So a container restart is not a way to resume an interrupted ingest. Reset the
store and ingest again (`npm run hydra:up -- --reset`). Anything that must
survive a restart has to live outside the graph; for us that is
`fixtures/github/snapshot.json`, which is why the GitHub audit replays from a
file rather than from the database.

## UNWIND batching exists, but not for a typed graph

The engine accepts `UNWIND $batch AS row CREATE ...` when the batch comes from a
`parameters` object, which looked like a large win: our ingest is 226,357
single-statement round trips. It is not usable, and the errors narrow down
precisely why:

```
UNWIND batch input must be a parameter          -- inline list rejected
UNWIND batch supports one-hop relationships only
UNWIND batch node patterns do not support labels
```

Every ingest statement is a one-hop relationship, so the second restriction is
fine. The third is fatal: a batch cannot set node labels, and a graph without
labels is not a graph we can query — every traversal we run is label-qualified.
So the fast path exists but is closed to any typed ingest.

## Sustained write pressure exits the node

A single-node ingest of 226,357 edges completes, but it is marginal. Three runs
died at 80–83% with exit 255, not OOM-killed by Docker, preceded by:

```
evictor queue skipped cache write/access event because it was full
289 times in the last 30s
```

The cache evictor saturates while compaction is running, and the node exits.
Concurrency does not help — 16 parallel writers is *faster* than 64 on an empty
store, because writes serialise internally anyway — so the mitigation is to pace
the ingest down (`npm run build:graph -- --concurrency=6`) and let compaction
keep up.

Combined with the conditional-write limitation above, this is the operational
shape to plan around: **an interrupted ingest cannot be resumed and a slow ingest
is more likely to finish than a fast one.**
