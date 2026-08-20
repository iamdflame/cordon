# Two in-engine formulations of the same question

Regenerate with `npm run bench:formulations`.
Raw data: [`artifacts/formulations.json`](../artifacts/formulations.json) —
git `23faa37692b2`, corpus `9268e8dabe619e71`.

Cordon's security decision is *what does this fact rest on, transitively*. The
engine can answer that two different ways, and we ship both so they can be
checked against each other.

| | how it works |
|---|---|
| `MATCH (f:Fact {id})-[:RESTS_ON*1..5]->(s:Source) RETURN s.space` | a variable-length pattern lowered to a walk; reads a denormalised property off each source it lands on |
| `CALL algo.SSpaths({relTypes: ["RESTS_ON"], sourceNode: id}) YIELD path` | the engine's GraphBLAS single-source paths procedure; returns the **paths**, and the spaces are read from the `Source` nodes inside them |

## Do they agree?

**0 of 0** comparable pairs (n/a), out of
25 derived facts examined.

**25** facts are excluded because *neither* formulation resolved a
requirement for them. Two computations that both failed have not agreed about
anything, and counting mutual failure as a match is exactly the error this
repository keeps having to correct - see [CORRECTIONS.md](CORRECTIONS.md).


**They disagree on 25 facts**, which is a finding and is reported
here rather than resolved quietly. See `disagreements` in the raw artifact.

The paths formulation returned no path for **25** facts. Both formulations fail closed — no path means an unresolvable requirement, which nobody holds — so this direction over-restricts rather than over-discloses.


## What each costs

| formulation | p50 | p95 | p99 |
|---|---|---|---|
| `MATCH RESTS_ON*1..5` | 9.9 ms | 24.8 ms | 69.2 ms |
| `algo.SSpaths` | 10.3 ms | 14.1 ms | 17.3 ms |

Measured over 25 derived facts, cold cache per call.

## Why the paths formulation earns its place anyway

Even where it is slower, it returns something the pattern walk cannot: **the
path itself**. The derivation chain a reader sees is then an object the engine
computed, not one we reassembled client-side from a list of endpoints.

That is not a decoration. The entire argument for why this needs a graph is that
admissibility is a property of a *path*, and a path is exactly what an embedding
space does not have. Being able to hand back the engine's own path is the
strongest available form of that claim.

Note also that `algo.SPpaths`/`algo.SSpaths` are the *only* way to obtain a
path from this engine: `RETURN p` and `nodes(p)` are both rejected. The
procedure is load-bearing rather than ornamental.
