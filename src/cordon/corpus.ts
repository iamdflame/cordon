/**
 * HERB corpus loader.
 *
 * Salesforce's HERB is a synthetic enterprise: 530 employees in a real
 * management hierarchy, 30 product workspaces, and ~38,600 heterogeneous
 * artifacts - Slack threads, pull requests, meeting transcripts, design
 * documents. Questions ship with ground-truth citations to the artifact ids
 * that answer them, which makes both retrieval quality and *leakage* directly
 * measurable rather than a matter of assertion.
 *
 * The property that makes it the right corpus for Cordon: 506 of the 530
 * employees sit on more than one product team. Access is genuinely overlapping,
 * so the visibility of a fact derived across two products is a real
 * intersection over a real org, not a toy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, Corpus, Employee, Question, Space } from './model.js';

interface SlackUtterance {
  User?: { userId?: string; timestamp?: string; text?: string; utteranceID?: string };
  Reactions?: unknown[];
}

interface RawSlack {
  /** `{ name, channelID }` - not a bare string. */
  Channel?: { name?: string; channelID?: string };
  Message?: SlackUtterance;
  ThreadReplies?: SlackUtterance[] | null;
  id?: string;
}

interface RawDocument {
  content?: string;
  date?: string;
  author?: unknown;
  document_link?: string;
  type?: string;
  id?: string;
}

interface RawTranscript {
  transcript?: string;
  date?: string;
  document_type?: string;
  participants?: unknown[];
  id?: string;
}

interface RawPr {
  title?: string;
  summary?: string;
  link?: string;
  merged?: boolean;
  state?: string;
  number?: number;
  user?: unknown;
  created_at?: string;
  reviews?: Array<{ user?: unknown; state?: string; body?: string } | string>;
  id?: string;
}

interface RawProduct {
  team?: string[];
  customers?: string[];
  slack?: RawSlack[];
  documents?: RawDocument[];
  meeting_transcripts?: RawTranscript[];
  meeting_chats?: Array<{ text?: string; id?: string }>;
  urls?: Array<{ link?: string; description?: string; id?: string }>;
  prs?: RawPr[];
  answerable_questions?: Array<{
    question?: string;
    ground_truth?: unknown;
    citations?: string[];
    type?: string;
  }>;
  /** Plain strings in this corpus, not objects. */
  unanswerable_questions?: Array<string | { question?: string; type?: string }>;
}

/** Recursively collect employee ids and the management edges between them. */
function walkOrg(
  node: Record<string, unknown>,
  managerId: string | null,
  reports: Map<string, string[]>,
  managerOf: Map<string, string>,
) {
  const id = typeof node['employee_id'] === 'string' ? node['employee_id'] : null;
  if (id && managerId) {
    const list = reports.get(managerId);
    if (list) list.push(id);
    else reports.set(managerId, [id]);
    managerOf.set(id, managerId);
  }

  // Any array-valued field holding objects with employee ids is a report list.
  for (const value of Object.values(node)) {
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        walkOrg(child as Record<string, unknown>, id ?? managerId, reports, managerOf);
      }
    }
  }
}

/**
 * Coerce a person reference to an employee id string.
 *
 * The corpus is inconsistent: some author fields are bare ids, others are
 * objects carrying the id under a nested key. A loader that assumes one shape
 * fails on the other, and a mention pipeline that receives an object silently
 * loses the reference.
 */
function personId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['employee_id', 'userId', 'user_id', 'id', 'login', 'name']) {
      const v = o[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return undefined;
}

function text(...parts: Array<string | undefined | null>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

export function loadCorpus(root: string, options: { spaces?: number } = {}): Corpus {
  const employees = new Map<string, Employee>();
  const rawEmployees = JSON.parse(readFileSync(join(root, 'employee.json'), 'utf8')) as Record<
    string,
    Employee
  >;
  for (const [id, e] of Object.entries(rawEmployees)) {
    employees.set(id, {
      id,
      name: e.name ?? id,
      role: e.role ?? '',
      location: e.location ?? '',
      org: e.org ?? '',
    });
  }

  const reports = new Map<string, string[]>();
  const managerOf = new Map<string, string>();
  const orgRoots = JSON.parse(readFileSync(join(root, 'salesforce_team.json'), 'utf8')) as unknown;
  for (const node of Array.isArray(orgRoots) ? orgRoots : [orgRoots]) {
    if (node && typeof node === 'object') {
      walkOrg(node as Record<string, unknown>, null, reports, managerOf);
    }
  }

  const spaces = new Map<string, Space>();
  const artifacts: Artifact[] = [];
  const questions: Question[] = [];

  const productDir = join(root, 'products');
  let files = readdirSync(productDir).filter((f) => f.endsWith('.json')).sort();

  if (options.spaces !== undefined && options.spaces < files.length) {
    /*
     * Choose spaces that actually share people.
     *
     * Taking the first N alphabetically produced a sample with zero cross-space
     * derived facts - a fast path that exercises everything except the thing
     * the system exists to do. Greedily growing the set by shared headcount
     * guarantees the sample contains the overlapping access the whole argument
     * turns on.
     */
    const rosters = new Map<string, Set<string>>();
    for (const file of files) {
      const team = (JSON.parse(readFileSync(join(productDir, file), 'utf8')) as RawProduct).team ?? [];
      rosters.set(file, new Set(team));
    }

    const overlap = (a: Set<string>, b: Set<string>) => {
      let n = 0;
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      for (const x of small) if (large.has(x)) n++;
      return n;
    };

    // Seed with the pair sharing the most people, then grow greedily.
    let best: [string, string] = [files[0]!, files[1] ?? files[0]!];
    let bestOverlap = -1;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const n = overlap(rosters.get(files[i]!)!, rosters.get(files[j]!)!);
        if (n > bestOverlap) {
          bestOverlap = n;
          best = [files[i]!, files[j]!];
        }
      }
    }

    const chosen = [...new Set(best)];
    while (chosen.length < options.spaces) {
      let nextFile: string | null = null;
      let nextScore = -1;
      for (const file of files) {
        if (chosen.includes(file)) continue;
        let score = 0;
        for (const picked of chosen) score += overlap(rosters.get(file)!, rosters.get(picked)!);
        if (score > nextScore) {
          nextScore = score;
          nextFile = file;
        }
      }
      if (!nextFile) break;
      chosen.push(nextFile);
    }
    files = chosen;
  }

  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    const product = JSON.parse(readFileSync(join(productDir, file), 'utf8')) as RawProduct;

    spaces.set(name, {
      id: name,
      name,
      team: product.team ?? [],
      customers: product.customers ?? [],
    });

    const push = (a: Omit<Artifact, 'space' | 'key'>) => {
      if (a.text.trim().length === 0) return;
      artifacts.push({ ...a, space: name, key: `${name}::${a.id}` });
    };

    for (const [i, m] of (product.slack ?? []).entries()) {
      // A Slack entry nests its text under Message.User.text, and names its
      // author in Message.User.userId - which is an employee id, making the
      // author an entity reference rather than a display name.
      const root = m.Message?.User;
      const replies = (m.ThreadReplies ?? [])
        .map((r) => r?.User?.text ?? '')
        .filter((r) => r.length > 0);
      const replyAuthors = (m.ThreadReplies ?? [])
        .map((r) => r?.User?.userId ?? '')
        .filter((r) => r.length > 0);

      push({
        id: m.id ?? `${name}-slack-${i}`,
        kind: 'slack',
        title: m.Channel?.name ? `#${m.Channel.name}` : 'slack',
        text: text(root?.text, ...replies),
        participants: replyAuthors,
        ...(root?.userId ? { author: root.userId } : {}),
        ...(root?.timestamp ? { date: root.timestamp } : {}),
        ...(m.Channel?.name ? { locator: m.Channel.name } : {}),
      });
    }

    for (const [i, d] of (product.documents ?? []).entries()) {
      push({
        id: d.id ?? `${name}-doc-${i}`,
        kind: 'document',
        title: d.type ?? 'document',
        text: text(d.content),
        participants: [],
        ...(personId(d.author) ? { author: personId(d.author)! } : {}),
        ...(d.date ? { date: d.date } : {}),
        ...(d.document_link ? { locator: d.document_link } : {}),
      });
    }

    for (const [i, t] of (product.meeting_transcripts ?? []).entries()) {
      push({
        id: t.id ?? `${name}-transcript-${i}`,
        kind: 'meeting_transcript',
        title: t.document_type ?? 'meeting transcript',
        text: text(t.transcript),
        participants: (t.participants ?? []).map(personId).filter((p): p is string => !!p),
        ...(t.date ? { date: t.date } : {}),
      });
    }

    for (const [i, c] of (product.meeting_chats ?? []).entries()) {
      push({
        id: c.id ?? `${name}-chat-${i}`,
        kind: 'meeting_chat',
        title: 'meeting chat',
        text: text(c.text),
        participants: [],
      });
    }

    for (const [i, u] of (product.urls ?? []).entries()) {
      push({
        id: u.id ?? `${name}-url-${i}`,
        kind: 'url',
        title: 'link',
        text: text(u.description, u.link),
        participants: [],
        ...(u.link ? { locator: u.link } : {}),
      });
    }

    for (const [i, pr] of (product.prs ?? []).entries()) {
      const reviews = (pr.reviews ?? [])
        .map((r) => (typeof r === 'string' ? r : text(personId(r?.user), r?.body)))
        .filter((r) => r.length > 0);
      const reviewers = (pr.reviews ?? [])
        .map((r) => (typeof r === 'string' ? undefined : personId(r?.user)))
        .filter((r): r is string => !!r);
      push({
        id: pr.id ?? `${name}-pr-${i}`,
        kind: 'pr',
        title: pr.title ?? `PR #${pr.number ?? i}`,
        text: text(pr.title, pr.summary, ...reviews),
        participants: reviewers,
        ...(personId(pr.user) ? { author: personId(pr.user)! } : {}),
        ...(pr.created_at ? { date: pr.created_at } : {}),
        ...(pr.link ? { locator: pr.link } : {}),
      });
    }

    for (const [i, q] of (product.answerable_questions ?? []).entries()) {
      if (!q.question) continue;
      questions.push({
        id: `${name}-q-${i}`,
        space: name,
        question: q.question,
        groundTruth: typeof q.ground_truth === 'string' ? q.ground_truth : '',
        groundTruthRaw: q.ground_truth,
        citations: q.citations ?? [],
        type: q.type ?? 'unknown',
        answerable: true,
      });
    }

    for (const [i, raw] of (product.unanswerable_questions ?? []).entries()) {
      const question = typeof raw === 'string' ? raw : raw.question;
      if (!question) continue;
      questions.push({
        id: `${name}-qu-${i}`,
        space: name,
        question,
        groundTruth: '',
        groundTruthRaw: null,
        citations: [],
        type: typeof raw === 'string' ? 'unanswerable' : (raw.type ?? 'unanswerable'),
        answerable: false,
      });
    }
  }

  return { employees, spaces, artifacts, questions, reports, managerOf };
}

export function corpusStats(corpus: Corpus) {
  const byKind = new Map<string, number>();
  for (const a of corpus.artifacts) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);

  const membership = new Map<string, number>();
  for (const space of corpus.spaces.values()) {
    for (const member of space.team) membership.set(member, (membership.get(member) ?? 0) + 1);
  }
  const multi = [...membership.values()].filter((n) => n > 1).length;

  return {
    employees: corpus.employees.size,
    spaces: corpus.spaces.size,
    artifacts: corpus.artifacts.length,
    byKind: Object.fromEntries(byKind),
    questions: corpus.questions.length,
    answerable: corpus.questions.filter((q) => q.answerable).length,
    unanswerable: corpus.questions.filter((q) => !q.answerable).length,
    managementEdges: corpus.managerOf.size,
    peopleOnMultipleTeams: multi,
  };
}
