/**
 * Provenance for a run: what corpus, what code, what seed.
 *
 * A published number is only checkable if a reader can tell whether their copy
 * of the inputs is the one that produced it. HERB is fetched by a script from a
 * third party, so "we ran it on HERB" is not by itself a reproducible claim -
 * the dataset could change under us and every figure here would drift with no
 * signal. Hashing it turns that into something falsifiable.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CorpusDigest {
  /** sha256 over every file's path and contents, in sorted path order. */
  digest: string;
  files: number;
  bytes: number;
  /** Per-file hashes, so a mismatch says *which* file moved. */
  perFile: Record<string, string>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Hash a corpus directory deterministically. */
export function digestCorpus(root: string): CorpusDigest {
  const files = walk(root).sort();
  const overall = createHash('sha256');
  const perFile: Record<string, string> = {};
  let bytes = 0;

  for (const file of files) {
    const content = readFileSync(file);
    bytes += content.length;
    const one = createHash('sha256').update(content).digest('hex');
    const relative = file.slice(root.length + 1);
    perFile[relative] = one;
    // Path *and* content, so a rename counts as a change.
    overall.update(relative).update(' ').update(one).update('\n');
  }

  return { digest: overall.digest('hex'), files: files.length, bytes, perFile };
}

export interface RunProvenance {
  gitSha: string;
  /** True when the working tree had uncommitted changes at run time. */
  gitDirty: boolean;
  generatedAt: string;
  node: string;
  seed: number;
  corpus: { root: string; digest: string; files: number; bytes: number };
}

export function runProvenance(corpusRoot: string, seed: number): RunProvenance {
  let gitSha = 'unknown';
  let gitDirty = false;
  try {
    gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    gitDirty =
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    /* not a git checkout; the fields say so rather than lying */
  }

  const corpus = digestCorpus(corpusRoot);
  return {
    gitSha,
    gitDirty,
    generatedAt: new Date().toISOString(),
    node: process.version,
    seed,
    corpus: {
      root: corpusRoot,
      digest: corpus.digest,
      files: corpus.files,
      bytes: corpus.bytes,
    },
  };
}
