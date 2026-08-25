/**
 * The client must fail closed.
 *
 * This is the one piece of Cordon that runs inside *someone else's* product. If
 * a network blip here silently resolves to "admitted", we have caused a
 * disclosure bug in a system we do not own, through nothing but our own
 * convenience.
 *
 * So the properties below are not stylistic. Each one is a way the gate could
 * be talked out of refusing:
 *
 *   - an id we do not recognise must never be admitted
 *   - a 4xx is a *decision*, and retrying a refusal until it succeeds is
 *     precisely the attack this project exists to prevent
 *   - a transport failure must raise, never resolve to a permissive default
 *
 * Driven by an injected `fetch`, so these run with no server and no engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Cordon,
  CordonDeniedError,
  CordonError,
  CordonUnavailableError,
} from '../src/client/index.js';

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(handler: Handler, options: Partial<{ retries: number; timeoutMs: number }> = {}) {
  return new Cordon({
    url: 'http://cordon.test',
    retries: options.retries ?? 3,
    timeoutMs: options.timeoutMs ?? 5000,
    fetch: handler as unknown as typeof globalThis.fetch,
  });
}

test('an unrecognised fact id is never admitted', async () => {
  const cordon = client(() =>
    json({ admitted: ['known'], withheld: [], unknown: ['who-is-this'] }),
  );

  const result = await cordon.admissible('p', ['known', 'who-is-this']);
  assert.deepEqual(result.admitted, ['known']);
  assert.deepEqual(result.unknown, ['who-is-this']);
  assert.ok(
    !result.admitted.includes('who-is-this'),
    'a gate that admits what it cannot evaluate is not a gate',
  );
});

test('a 4xx is never retried — a refusal is a decision', async () => {
  let calls = 0;
  const cordon = client(() => {
    calls++;
    return json({ error: 'bad principal' }, 400);
  });

  await assert.rejects(() => cordon.admissible('nobody', ['f']), CordonError);
  assert.equal(calls, 1, `a 4xx was retried ${calls} times; retrying a refusal is the bug`);
});

test('a 5xx is retried, then raises rather than resolving', async () => {
  let calls = 0;
  const cordon = client(
    () => {
      calls++;
      return json({ error: 'boom' }, 500);
    },
    { retries: 3 },
  );

  await assert.rejects(() => cordon.admissible('p', ['f']), CordonError);
  assert.equal(calls, 3, `expected 3 attempts, saw ${calls}`);
});

test('a transient 5xx that recovers returns the real answer', async () => {
  let calls = 0;
  const cordon = client(() => {
    calls++;
    if (calls < 3) return json({ error: 'boom' }, 500);
    return json({ admitted: ['f'], withheld: [], unknown: [] });
  });

  const result = await cordon.admissible('p', ['f']);
  assert.deepEqual(result.admitted, ['f']);
  assert.equal(calls, 3);
});

test('503 surfaces as unavailable, not as a denial', async () => {
  /* "Still building" and "you may not see this" are different facts about the
     world, and a caller that conflates them will show the wrong thing. */
  const cordon = client(() => json({ error: 'building' }, 503));
  await assert.rejects(() => cordon.admissible('p', ['f']), CordonUnavailableError);
});

test('a network failure raises instead of resolving permissively', async () => {
  const cordon = client(() => {
    throw new Error('ECONNREFUSED');
  });

  await assert.rejects(async () => {
    const result = await cordon.admissible('p', ['f']);
    /* If this line is ever reached the client resolved a transport failure. */
    throw new Error(`resolved with ${result.admitted.length} admitted instead of throwing`);
  }, CordonError);
});

test('admissibleOrThrow throws, and carries what was missing', async () => {
  const cordon = client(() =>
    json({
      admitted: [],
      withheld: [{ id: 'f', requires: ['a', 'b'], missing: ['b'] }],
      unknown: [],
    }),
  );

  await assert.rejects(
    () => cordon.admissibleOrThrow('p', ['f']),
    (error: unknown) => {
      assert.ok(error instanceof CordonDeniedError);
      assert.equal(error.withheld.length, 1);
      assert.deepEqual(error.withheld[0]!.missing, ['b'], 'the refusal must stay actionable');
      return true;
    },
  );
});

test('plan defaults to session-aware, because per-query safety does not compose', async () => {
  let sentBody: Record<string, unknown> = {};
  const cordon = client((_url, init) => {
    sentBody = JSON.parse(String(init?.body ?? '{}'));
    return json({
      disclosed: [],
      inadmissible: [],
      suppressed: [],
      violationsPrevented: [],
      safe: true,
      stats: { candidates: 0, admissible: 0, disclosed: 0, suppressedForInference: 0, retention: 1 },
      latencyMs: 1,
    });
  });

  await cordon.plan('p', ['f']);
  assert.equal(sentBody.session, true, 'session tracking must be opt-out, not opt-in');

  await cordon.plan('p', ['f'], { session: false });
  assert.equal(sentBody.session, false);
});

test('rank order is preserved into the request', async () => {
  /* The planner sacrifices low-utility evidence first, which is meaningless if
     the client reorders what it was handed. */
  let sent: Array<{ id: string }> = [];
  const cordon = client((_url, init) => {
    sent = JSON.parse(String(init?.body ?? '{}')).facts;
    return json({
      disclosed: [],
      inadmissible: [],
      suppressed: [],
      violationsPrevented: [],
      safe: true,
      stats: { candidates: 3, admissible: 3, disclosed: 3, suppressedForInference: 0, retention: 1 },
      latencyMs: 1,
    });
  });

  await cordon.plan('p', ['best', 'middle', 'worst']);
  assert.deepEqual(
    sent.map((f) => f.id),
    ['best', 'middle', 'worst'],
  );
});

test('waitUntilReady does not report ready while still building', async () => {
  const cordon = client(() => json({ ok: true, building: true, error: null, hydra: 'connected' }));
  await assert.rejects(() => cordon.waitUntilReady(1200), /not ready/);
});
