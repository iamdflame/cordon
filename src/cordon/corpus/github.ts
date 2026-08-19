/**
 * GitHub connector: real permissions, fetched rather than modelled.
 *
 * The strongest objection to Cordon's HERB results is that we invented the
 * access control we then enforced. This connector removes that objection
 * entirely by reading the permission structure out of a system that already
 * has one:
 *
 *   Cordon        GitHub
 *   ------------  --------------------------------------------------------
 *   Principal     an account: a repository collaborator, or `public` for the
 *                 unauthenticated internet
 *   Space         a repository
 *   MEMBER_OF     collaboration on that repository, or - for a public repo -
 *                 readable by everyone, which is a fact about the world
 *   Source        an issue, a pull request, a comment
 *   IN_SPACE      the repository the source belongs to
 *   Fact          as on HERB: extracted from source text
 *   RESTS_ON      as on HERB: union of supports
 *
 * Nothing here is asserted by us. A private repository genuinely returns 404 to
 * a request that is not entitled to it, and that 404 is the ground truth the
 * audit is scored against. The rest of the pipeline - extraction, resolution,
 * derivation, admissibility - is untouched, which is the point: the same code
 * and the same rule, over permissions we did not write.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Artifact, Corpus, Employee, Question, Space } from '../model.js';

/** The unauthenticated internet, as a principal. */
export const PUBLIC_PRINCIPAL = 'public';

export interface GitHubSnapshot {
  owner: string;
  fetchedAt: string;
  repos: Array<{
    name: string;
    fullName: string;
    private: boolean;
    description: string | null;
    collaborators: string[];
  }>;
  issues: Array<{
    repo: string;
    number: number;
    title: string;
    body: string;
    author: string;
    createdAt: string;
    url: string;
    comments: Array<{ author: string; body: string; createdAt: string }>;
  }>;
  /** Org teams, when the owner is an organisation. Empty for a user account. */
  teams: Array<{ slug: string; name: string; parent: string | null; members: string[] }>;
}

function gh(args: string[]): unknown {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

/** Fetch the live structure. Requires `gh auth login` with `repo` + `read:org`. */
export function fetchSnapshot(owner: string, repoNames: string[]): GitHubSnapshot {
  const repos: GitHubSnapshot['repos'] = [];
  const issues: GitHubSnapshot['issues'] = [];

  for (const name of repoNames) {
    const repo = gh(['api', `repos/${owner}/${name}`]) as {
      name: string;
      full_name: string;
      private: boolean;
      description: string | null;
    };

    // Real collaborators. On a private repo this list *is* the audience.
    let collaborators: string[] = [];
    try {
      const raw = gh(['api', `repos/${owner}/${name}/collaborators`, '--paginate']) as Array<{
        login: string;
      }>;
      collaborators = raw.map((c) => c.login);
    } catch {
      // Insufficient scope to list collaborators: fall back to the owner, which
      // under-grants rather than over-grants.
      collaborators = [owner];
    }

    repos.push({
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      description: repo.description,
      collaborators,
    });

    const raw = gh([
      'api',
      `repos/${owner}/${name}/issues?state=all&per_page=100`,
      '--paginate',
    ]) as Array<{
      number: number;
      title: string;
      body: string | null;
      user: { login: string } | null;
      created_at: string;
      html_url: string;
      comments: number;
    }>;

    for (const issue of raw) {
      const comments: GitHubSnapshot['issues'][number]['comments'] = [];
      if (issue.comments > 0) {
        try {
          const rawComments = gh([
            'api',
            `repos/${owner}/${name}/issues/${issue.number}/comments`,
            '--paginate',
          ]) as Array<{ user: { login: string } | null; body: string | null; created_at: string }>;
          for (const comment of rawComments) {
            comments.push({
              author: comment.user?.login ?? 'unknown',
              body: comment.body ?? '',
              createdAt: comment.created_at,
            });
          }
        } catch {
          // A comment thread we cannot read simply contributes nothing.
        }
      }

      issues.push({
        repo: repo.name,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        author: issue.user?.login ?? 'unknown',
        createdAt: issue.created_at,
        url: issue.html_url,
        comments,
      });
    }
  }

  // Teams exist only for organisations; a user account has none, and the
  // absence is meaningful rather than an error.
  let teams: GitHubSnapshot['teams'] = [];
  try {
    const raw = gh(['api', `orgs/${owner}/teams`, '--paginate']) as Array<{
      slug: string;
      name: string;
      parent: { slug: string } | null;
    }>;
    teams = raw.map((t) => {
      let members: string[] = [];
      try {
        const m = gh(['api', `orgs/${owner}/teams/${t.slug}/members`, '--paginate']) as Array<{
          login: string;
        }>;
        members = m.map((x) => x.login);
      } catch {
        members = [];
      }
      return { slug: t.slug, name: t.name, parent: t.parent?.slug ?? null, members };
    });
  } catch {
    teams = [];
  }

  return { owner, fetchedAt: new Date().toISOString(), repos, issues, teams };
}

export function saveSnapshot(snapshot: GitHubSnapshot, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
}

export function loadSnapshot(path: string): GitHubSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as GitHubSnapshot;
}

/**
 * People named in prose who are not GitHub accounts.
 *
 * Issue text refers to colleagues by name; those names are the subjects facts
 * are about, and the resolver needs them in its index. They are not principals -
 * they hold no access - which is exactly the distinction between someone a
 * system knows about and someone it answers to.
 */
function extractNamedPeople(snapshot: GitHubSnapshot): string[] {
  const found = new Set<string>();
  const NAME = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
  const stop = new Set([
    'Do', 'No', 'The', 'This', 'Target', 'Finance', 'General', 'How', 'Not', 'Data', 'Room',
    'Access', 'Integration', 'Engineering', 'Northwind', 'Assigning', 'Template',
  ]);

  for (const issue of snapshot.issues) {
    const text = `${issue.title}\n${issue.body}\n${issue.comments.map((c) => c.body).join('\n')}`;
    for (const match of text.matchAll(NAME)) {
      const [full, first, last] = match;
      if (!first || !last) continue;
      if (stop.has(first) || stop.has(last)) continue;
      found.add(full.trim());
    }
  }
  return [...found];
}

export interface GitHubCorpusOptions {
  /** Questions to pose against this corpus, for the demo. */
  questions?: Array<{ question: string; space: string }>;
}

/**
 * Project a snapshot into the same Corpus the HERB loader produces, so every
 * downstream stage runs unchanged.
 */
export function corpusFromSnapshot(
  snapshot: GitHubSnapshot,
  options: GitHubCorpusOptions = {},
): Corpus {
  const employees = new Map<string, Employee>();
  const spaces = new Map<string, Space>();
  const artifacts: Artifact[] = [];
  const reports = new Map<string, string[]>();
  const managerOf = new Map<string, string>();

  /* ---- principals: real accounts, plus the anonymous internet ----------- */
  const accounts = new Set<string>([PUBLIC_PRINCIPAL]);
  for (const repo of snapshot.repos) for (const login of repo.collaborators) accounts.add(login);
  for (const issue of snapshot.issues) {
    accounts.add(issue.author);
    for (const comment of issue.comments) accounts.add(comment.author);
  }

  for (const login of accounts) {
    employees.set(login, {
      id: login,
      name: login === PUBLIC_PRINCIPAL ? 'Anonymous (the internet)' : login,
      role: login === PUBLIC_PRINCIPAL ? 'unauthenticated' : 'github account',
      location: '',
      org: snapshot.owner,
    });
  }

  // People named in prose are entities, not principals: they appear in the name
  // index so facts can be about them, but they are granted nothing.
  for (const name of extractNamedPeople(snapshot)) {
    const id = `person:${name.toLowerCase().replace(/\s+/g, '-')}`;
    if (employees.has(id)) continue;
    employees.set(id, { id, name, role: 'mentioned', location: '', org: snapshot.owner });
  }

  /* ---- spaces: repositories, with their real audience ------------------- */
  for (const repo of snapshot.repos) {
    /*
     * A public repository is readable by everyone, so its audience includes the
     * anonymous principal. A private one is readable by its collaborators and
     * nobody else - which GitHub enforces with a 404, not with our opinion.
     */
    const team = repo.private
      ? [...repo.collaborators]
      : [...accounts];

    spaces.set(repo.name, { id: repo.name, name: repo.name, team, customers: [] });
  }

  /* ---- sources: issues and their comments ------------------------------ */
  for (const issue of snapshot.issues) {
    const body = [issue.body, ...issue.comments.map((c) => c.body)]
      .filter((s) => s && s.length > 0)
      .join('\n');

    artifacts.push({
      id: `${issue.repo}#${issue.number}`,
      key: `${issue.repo}::${issue.repo}#${issue.number}`,
      space: issue.repo,
      kind: 'document',
      title: issue.title,
      text: `${issue.title}\n${body}`,
      author: issue.author,
      participants: issue.comments.map((c) => c.author),
      date: issue.createdAt,
      locator: issue.url,
    });
  }

  /* ---- team hierarchy, when the owner is an organisation ---------------- */
  for (const team of snapshot.teams) {
    if (!team.parent) continue;
    const parentMembers = snapshot.teams.find((t) => t.slug === team.parent)?.members ?? [];
    for (const child of team.members) {
      for (const parent of parentMembers) {
        if (parent === child) continue;
        const list = reports.get(parent);
        if (list) list.push(child);
        else reports.set(parent, [child]);
        managerOf.set(child, parent);
      }
    }
  }

  const questions: Question[] = (options.questions ?? []).map((q, i) => ({
    id: `gh-q-${i}`,
    space: q.space,
    question: q.question,
    groundTruth: '',
    groundTruthRaw: null,
    citations: [],
    type: 'person',
    answerable: true,
  }));

  return { employees, spaces, artifacts, questions, reports, managerOf };
}

export function snapshotStats(snapshot: GitHubSnapshot) {
  return {
    owner: snapshot.owner,
    repos: snapshot.repos.length,
    private: snapshot.repos.filter((r) => r.private).length,
    public: snapshot.repos.filter((r) => !r.private).length,
    issues: snapshot.issues.length,
    comments: snapshot.issues.reduce((n, i) => n + i.comments.length, 0),
    teams: snapshot.teams.length,
    fetchedAt: snapshot.fetchedAt,
  };
}
