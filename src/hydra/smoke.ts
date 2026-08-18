/**
 * End-to-end verification that our client speaks the engine's real dialect.
 * Run: npm run cli -- smoke   (or: npx tsx src/hydra/smoke.ts)
 */

import { HydraClient, nodeProps, pooled } from './client.js';
import { NodeIdRegistry } from './ids.js';

async function main() {
  const client = new HydraClient();
  const ids = new NodeIdRegistry();

  const alive = await client.ping();
  console.log(`engine reachable: ${alive}`);
  if (!alive) process.exit(1);

  // A miniature call graph with a real shape: two entry points, a shared
  // helper, one path that reaches a vulnerable sink and one that does not.
  const chain: Array<[string, string]> = [
    ['app:src/server.ts#handleUpload', 'app:src/parse.ts#parseBody'],
    ['app:src/parse.ts#parseBody', 'npm:qs@6.5.1#parseValues'],
    ['npm:qs@6.5.1#parseValues', 'npm:qs@6.5.1#PROTO_POLLUTION_SINK'],
    ['app:src/health.ts#healthCheck', 'app:src/util.ts#now'],
  ];

  const seen = new Set<string>();
  const statements = chain.map(([from, to]) => {
    const srcId = ids.intern(from);
    const dstId = ids.intern(to);
    const stmt = client.buildEdgeStatement({
      srcLabel: 'Fn',
      srcId,
      srcProps: seen.has(from) ? {} : { key: from },
      dstLabel: 'Fn',
      dstId,
      dstProps: seen.has(to) ? {} : { key: to },
      type: 'CALLS',
    });
    seen.add(from);
    seen.add(to);
    return stmt;
  });

  await pooled(statements, 8, (stmt) => client.query(stmt));
  console.log(`wrote ${statements.length} edges, ${ids.size} distinct nodes`);

  const entry = ids.intern('app:src/server.ts#handleUpload');
  const safeEntry = ids.intern('app:src/health.ts#healthCheck');
  const sink = ids.intern('npm:qs@6.5.1#PROTO_POLLUTION_SINK');

  const reachable = await client.isReachable('Fn', entry, sink, ['CALLS']);
  const notReachable = await client.isReachable('Fn', safeEntry, sink, ['CALLS']);
  console.log(`handleUpload -> sink reachable: ${reachable}  (expected true)`);
  console.log(`healthCheck  -> sink reachable: ${notReachable} (expected false)`);

  const path = await client.shortestPath(entry, sink, ['CALLS']);
  if (!path) {
    console.error('FAIL: no proof path returned');
    process.exit(1);
  }

  console.log(`\nproof path (${path.relationships.length} hops):`);
  for (const [i, node] of path.nodes.entries()) {
    const props = nodeProps(node);
    console.log(`  ${i === 0 ? '' : '-> '}${props['key'] ?? node.id}`);
  }

  const ok = reachable && !notReachable && path.nodes.length === 4;
  console.log(`\nclient stats: ${JSON.stringify(client.stats)}`);
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
