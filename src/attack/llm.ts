/**
 * A stronger adversary than ours.
 *
 * Every leak number in docs/INFERENCE.md and docs/PLANNER.md carries the same
 * caveat: *our adversary runs our own rules, so these are lower bounds.* That
 * caveat is honest and it is also unfalsifiable as written. Either we test it
 * or we should stop saying it.
 *
 * So this is the test. The structural adversary in closure.ts reasons over the
 * derivation graph - entities, spaces, support edges. A language model reasoning
 * over the **prose** of the same disclosed facts is not restricted to that
 * structure. It can notice that a document in one space names someone a
 * document in another space also names, in a phrasing our extractor never
 * turned into a mention. If it recovers claims our structural adversary marked
 * *effective*, then the bound was loose and we were reporting a number that
 * flattered us.
 *
 * Three commitments make this admissible as evidence rather than a demo:
 *
 *   1. **It is adversarial, not confirmatory.** We sample only denials our own
 *      adversary called *effective* - the ones we claimed were genuinely
 *      protected. There is nothing to be gained here except being proved wrong.
 *
 *   2. **Every response is cached and committed.** artifacts/llm-adversary-cache.json
 *      is keyed by a hash of the exact prompt. A reader with no API key replays
 *      the committed run and gets identical numbers. An LLM result that cannot
 *      be reproduced is an anecdote.
 *
 *   3. **The core pipeline is untouched.** No language model participates in
 *      extraction, resolution, derivation or admissibility. This is an attacker,
 *      not a component - which is why the determinism claim survives it.
 *
 * Set OPENAI_API_KEY to run live. Without it the cache replays, and anything
 * uncached is reported as unattempted rather than silently scored as a miss.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE_PATH = 'artifacts/llm-adversary-cache.json';
const MODEL = process.env.CORDON_LLM_MODEL ?? 'gpt-4o-mini';
const ENDPOINT = process.env.CORDON_LLM_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions';

interface CacheEntry {
  model: string;
  answer: string;
  /** Kept for audit: how much the adversary was actually shown. */
  promptChars: number;
}

type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

/** Prompts are the cache key, so an edited prompt can never replay a stale answer. */
function keyOf(model: string, prompt: string): string {
  return createHash('sha256').update(`${model} ${prompt}`).digest('hex').slice(0, 32);
}

export interface AdversaryResult {
  /** The model's verdict: did it conclude the claim holds? */
  concluded: boolean;
  /** Verbatim response, for audit. */
  raw: string;
  /** True when this came from the committed cache rather than the network. */
  cached: boolean;
  /** True when no key was available and the prompt was not in the cache. */
  unattempted: boolean;
}

export class LlmAdversary {
  private readonly cache: Cache;
  private readonly apiKey: string | undefined;
  private dirty = false;

  live = 0;
  replayed = 0;
  skipped = 0;

  constructor() {
    this.cache = loadCache();
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  get hasKey(): boolean {
    return !!this.apiKey;
  }

  get cacheSize(): number {
    return Object.keys(this.cache).length;
  }

  /**
   * Ask the adversary whether the evidence establishes a claim.
   *
   * The prompt deliberately does not mention access control, or that anything
   * was withheld. An adversary told they are being tested for a leak is being
   * coached; this one is asked to read documents and answer a question about
   * them, which is what a real attacker does with a pile of things they were
   * legitimately given.
   */
  async ask(evidence: string[], question: string): Promise<AdversaryResult> {
    const prompt = [
      'You are analysing internal company documents. Answer only from what is written.',
      '',
      'DOCUMENTS:',
      ...evidence.map((text, i) => `[${i + 1}] ${text}`),
      '',
      `QUESTION: ${question}`,
      '',
      'Answer with YES or NO on the first line, then one sentence of justification.',
      'Answer NO if the documents do not establish it.',
    ].join('\n');

    const key = keyOf(MODEL, prompt);
    const hit = this.cache[key];
    if (hit) {
      this.replayed++;
      return { concluded: verdict(hit.answer), raw: hit.answer, cached: true, unattempted: false };
    }

    if (!this.apiKey) {
      /*
       * No key and no cache entry. Reporting this as "the adversary failed"
       * would manufacture a pass, so it is reported as not attempted and
       * excluded from the denominator.
       */
      this.skipped++;
      return { concluded: false, raw: '', cached: false, unattempted: true };
    }

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        /* Temperature 0: a probabilistic adversary is not a reproducible one. */
        temperature: 0,
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LLM call failed: ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = payload.choices?.[0]?.message?.content ?? '';

    this.cache[key] = { model: MODEL, answer, promptChars: prompt.length };
    this.dirty = true;
    this.live++;

    return { concluded: verdict(answer), raw: answer, cached: false, unattempted: false };
  }

  flush(): void {
    if (this.dirty) saveCache(this.cache);
  }
}

/** First token wins; anything that is not an affirmative counts as NO. */
function verdict(answer: string): boolean {
  return /^\s*yes\b/i.test(answer.trim());
}

export { MODEL as LLM_MODEL };
