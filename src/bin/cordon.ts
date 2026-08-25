#!/usr/bin/env node
/**
 * `cordon` — the command line.
 *
 * Until now everything here was `npm run <script>` from inside a checkout,
 * which is a way to run a research harness and not a way to operate a product.
 * Fourteen of those scripts were audits. None of them answered the questions an
 * operator actually has on day one:
 *
 *   is it up?            cordon doctor
 *   what can she see?    cordon check <principal> <fact...>
 *   why not?             cordon explain <fact> --as <principal>
 *   is this answer safe? cordon plan <principal> <fact...>
 *   where am I exposed?  cordon risk
 *   what will this cost? cordon policy grant <subject> <space>
 *   who has what?        cordon whoami <principal>
 *
 * Every command exits non-zero when the answer is "no". That is deliberate:
 * `cordon check` is meant to be usable in a shell pipeline and in CI, and a
 * gate that always exits 0 cannot fail a build.
 */

import { Cordon, CordonError, CordonUnavailableError } from '../client/index.js';

const ESC = String.fromCharCode(27);
const c = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  gold: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
};

const URL_DEFAULT = process.env.CORDON_URL ?? 'http://localhost:8787';

const USAGE = `${c.bold}cordon${c.reset} — derived-knowledge access control

${c.dim}A fact inferred from three documents is not a document. It has no ACL of
its own, so document-level filtering has no answer for it. This does.${c.reset}

${c.bold}USAGE${c.reset}
  cordon <command> [options]

${c.bold}COMMANDS${c.reset}
  ${c.cyan}doctor${c.reset}                          check the engine, graph and API are reachable
  ${c.cyan}whoami${c.reset} <principal>              what spaces this principal may read
  ${c.cyan}principals${c.reset}                      everyone who can hold a permission
  ${c.cyan}check${c.reset} <principal> <fact...>     per fact: may they see these?
  ${c.cyan}plan${c.reset} <principal> <fact...>      per answer: which subset is safe to serve?
  ${c.cyan}explain${c.reset} <fact> [--as <who>]     why this fact requires what it requires
  ${c.cyan}risk${c.reset} [--top N]                  derived facts ranked by how few may read them
  ${c.cyan}policy grant${c.reset} <subject> <space>  what that grant would actually disclose
  ${c.cyan}session${c.reset} <principal> [--reset]   what a session has accumulated

${c.bold}OPTIONS${c.reset}
  --url <url>     API base (default ${URL_DEFAULT}, or $CORDON_URL)
  --json          machine-readable output
  --no-session    for \`plan\`: judge this answer alone, ignoring history
  -h, --help      this

${c.bold}EXIT CODES${c.reset}
  0  everything asked for was admitted
  1  something was withheld, or the request was refused
  2  Cordon is unreachable or still building

${c.dim}A gate that always exits 0 cannot fail a build, so \`check\` and \`plan\`
exit 1 when anything is withheld. Use them in CI.${c.reset}
`;

interface Flags {
  url: string;
  json: boolean;
  session: boolean;
  top: number;
  as?: string;
  reset: boolean;
}

function parse(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = { url: URL_DEFAULT, json: false, session: true, top: 15, reset: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--url') flags.url = argv[++i] ?? flags.url;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--no-session') flags.session = false;
    else if (arg === '--reset') flags.reset = true;
    else if (arg === '--as') {
      const value = argv[++i];
      if (value) flags.as = value;
    }
    else if (arg === '--top') flags.top = Number(argv[++i] ?? flags.top);
    else if (arg.startsWith('--top=')) flags.top = Number(arg.slice(6));
    else if (arg.startsWith('--url=')) flags.url = arg.slice(6);
    else if (arg.startsWith('--as=')) flags.as = arg.slice(5);
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  return { positional, flags };
}

const out = (flags: Flags, human: () => void, data: unknown) => {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else human();
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const { positional, flags } = parse(argv);
  const [command, ...rest] = positional;
  const cordon = new Cordon({ url: flags.url });

  switch (command) {
    /* ------------------------------------------------------------ doctor */
    case 'doctor': {
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

      try {
        const health = await cordon.health();
        checks.push({ name: 'API reachable', ok: true, detail: flags.url });
        checks.push({
          name: 'graph ready',
          ok: health.ok && !health.building,
          detail: health.building ? 'still building' : (health.error ?? 'ready'),
        });
        checks.push({ name: 'engine connected', ok: health.hydra === 'connected', detail: health.hydra });
      } catch (error) {
        checks.push({
          name: 'API reachable',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      if (checks.every((x) => x.ok)) {
        try {
          const risk = await cordon.risk();
          checks.push({
            name: 'graph populated',
            ok: risk.derivedFacts > 0,
            detail: `${risk.derivedFacts} derived facts, ${risk.principals} principals`,
          });
        } catch {
          checks.push({ name: 'graph populated', ok: false, detail: 'risk surface unavailable' });
        }
      }

      out(
        flags,
        () => {
          console.log(`\n${c.bold}cordon doctor${c.reset}\n`);
          for (const check of checks) {
            const mark = check.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
            console.log(`  ${mark} ${check.name.padEnd(20)} ${c.dim}${check.detail}${c.reset}`);
          }
          const failed = checks.filter((x) => !x.ok);
          console.log(
            failed.length === 0
              ? `\n  ${c.green}Ready.${c.reset} ${c.dim}Try: cordon principals${c.reset}\n`
              : `\n  ${c.red}Not ready.${c.reset} ${c.dim}Start it with: npm run hydra:up && npm run api${c.reset}\n`,
          );
        },
        { checks, ok: checks.every((x) => x.ok) },
      );
      return checks.every((x) => x.ok) ? 0 : 2;
    }

    /* -------------------------------------------------------- principals */
    case 'principals': {
      const people = await cordon.principals();
      out(
        flags,
        () => {
          console.log(`\n${c.bold}${people.length} principals${c.reset} ${c.dim}widest access first${c.reset}\n`);
          for (const p of people.slice(0, flags.top)) {
            console.log(
              `  ${p.id.padEnd(24)} ${c.dim}${String(p.spaces.length).padStart(2)} spaces${c.reset}  ${p.name}`,
            );
          }
          if (people.length > flags.top) console.log(`  ${c.dim}… ${people.length - flags.top} more${c.reset}`);
          console.log('');
        },
        people,
      );
      return 0;
    }

    /* ------------------------------------------------------------ whoami */
    case 'whoami': {
      const who = rest[0];
      if (!who) return fail('usage: cordon whoami <principal>');
      const people = await cordon.principals();
      const person = people.find((p) => p.id === who);
      if (!person) return fail(`no such principal: ${who}`);

      out(
        flags,
        () => {
          console.log(`\n${c.bold}${person.name}${c.reset} ${c.dim}${person.id}${c.reset}`);
          if (person.role) console.log(`  ${c.dim}${person.role}${c.reset}`);
          console.log(`\n  may read ${c.bold}${person.spaces.length}${c.reset} spaces:`);
          for (const s of person.spaces.sort()) console.log(`    ${c.green}✓${c.reset} ${s}`);
          console.log('');
        },
        person,
      );
      return 0;
    }

    /* ------------------------------------------------------------- check */
    case 'check': {
      const [who, ...factIds] = rest;
      if (!who || factIds.length === 0) return fail('usage: cordon check <principal> <fact-id...>');

      const result = await cordon.admissible(who, factIds);
      out(
        flags,
        () => {
          console.log(`\n${c.bold}cordon check${c.reset} ${c.dim}as ${who}${c.reset}\n`);
          for (const id of result.admitted) console.log(`  ${c.green}admit ${c.reset} ${id}`);
          for (const w of result.withheld) {
            console.log(`  ${c.red}deny  ${c.reset} ${w.id}`);
            if (w.missing.length > 0) {
              console.log(`          ${c.dim}missing ${w.missing.join(', ')}${c.reset}`);
            }
          }
          for (const id of result.unknown) console.log(`  ${c.gold}unknown${c.reset} ${id} ${c.dim}(withheld)${c.reset}`);
          console.log(
            `\n  ${result.admitted.length} admitted, ${result.withheld.length} withheld` +
              `${result.unknown.length > 0 ? `, ${result.unknown.length} unknown` : ''}\n`,
          );
        },
        result,
      );
      return result.withheld.length > 0 || result.unknown.length > 0 ? 1 : 0;
    }

    /* -------------------------------------------------------------- plan */
    case 'plan': {
      const [who, ...factIds] = rest;
      if (!who || factIds.length === 0) return fail('usage: cordon plan <principal> <fact-id...>');

      const plan = await cordon.plan(who, factIds, { session: flags.session });
      out(
        flags,
        () => {
          console.log(
            `\n${c.bold}cordon plan${c.reset} ${c.dim}as ${who}${flags.session ? ', session-aware' : ', this answer alone'}${c.reset}\n`,
          );
          for (const f of plan.disclosed) console.log(`  ${c.green}serve  ${c.reset} ${f.id}`);
          for (const f of plan.inadmissible) {
            console.log(`  ${c.red}deny   ${c.reset} ${f.id} ${c.dim}no provenance${c.reset}`);
          }
          for (const s of plan.suppressed) {
            console.log(`  ${c.gold}suppress${c.reset} ${s.id}`);
            console.log(`           ${c.dim}entitled to it, but serving it completes: ${s.wouldComplete.join(', ')}${c.reset}`);
          }
          console.log(
            `\n  ${plan.stats.disclosed}/${plan.stats.admissible} admissible facts served` +
              ` ${c.dim}(${(plan.stats.retention * 100).toFixed(0)}% retained)${c.reset}`,
          );
          if (plan.violationsPrevented.length > 0) {
            console.log(`  ${c.gold}${plan.violationsPrevented.length} protected claim(s) prevented${c.reset}`);
          }
          if (plan.ledger) {
            console.log(`  ${c.dim}ledger: ${plan.ledger.size} facts over ${plan.ledger.queries} queries${c.reset}`);
          }
          console.log(
            `  ${plan.safe ? `${c.green}verified safe${c.reset}` : `${c.red}UNSAFE${c.reset}`} ${c.dim}${plan.latencyMs}ms${c.reset}\n`,
          );
        },
        plan,
      );
      return plan.suppressed.length > 0 || plan.inadmissible.length > 0 ? 1 : 0;
    }

    /* ----------------------------------------------------------- explain */
    case 'explain': {
      const factId = rest[0];
      if (!factId) return fail('usage: cordon explain <fact-id> [--as <principal>]');

      const trace = await cordon.explain(factId);
      let missing: string[] = [];
      if (flags.as) {
        const people = await cordon.principals();
        const held = new Set(people.find((p) => p.id === flags.as)?.spaces ?? []);
        missing = trace.required.filter((s) => !held.has(s));
      }

      out(
        flags,
        () => {
          console.log(`\n${c.bold}${trace.fact.id}${c.reset} ${c.dim}level ${trace.fact.level}${c.reset}`);
          console.log(`  ${trace.fact.text}\n`);
          console.log(`  ${c.bold}requires${c.reset} ${trace.required.length} spaces ${c.dim}(by traversal, not a stored field)${c.reset}`);
          for (const s of trace.required) {
            const lacks = missing.includes(s);
            console.log(`    ${lacks ? `${c.red}✗` : `${c.green}✓`}${c.reset} ${s}`);
          }
          console.log(`\n  ${c.bold}rests on${c.reset} ${trace.supports.length}`);
          for (const s of trace.supports.slice(0, 8)) {
            console.log(`    ${c.dim}${s.kind.padEnd(6)}${c.reset} ${s.title || s.id} ${c.dim}${s.space}${c.reset}`);
          }
          if (flags.as) {
            console.log(
              missing.length === 0
                ? `\n  ${c.green}${flags.as} may see this.${c.reset}\n`
                : `\n  ${c.red}${flags.as} is missing ${missing.join(', ')}.${c.reset}\n`,
            );
          } else {
            console.log('');
          }
        },
        { ...trace, missing },
      );
      return missing.length > 0 ? 1 : 0;
    }

    /* -------------------------------------------------------------- risk */
    case 'risk': {
      const risk = await cordon.risk();
      out(
        flags,
        () => {
          console.log(`\n${c.bold}Risk surface${c.reset} ${c.dim}knowledge no document contains${c.reset}\n`);
          console.log(`  ${String(risk.derivedFacts).padStart(7)}  derived facts`);
          console.log(`  ${String(risk.principals).padStart(7)}  principals`);
          console.log(`  ${String(risk.spaces).padStart(7)}  spaces`);
          console.log(
            `  ${String(risk.invisible).padStart(7)}  ${risk.invisible > 0 ? c.gold : ''}visible to nobody${c.reset}\n`,
          );
          console.log(`  ${c.dim}most tightly held${c.reset}`);
          console.log(`    ${'aud'.padStart(4)} ${'lvl'.padStart(3)}  claim`);
          for (const f of risk.riskiest.slice(0, flags.top)) {
            const pill = f.audience === 0 ? `${c.red}${String(f.audience).padStart(4)}${c.reset}` : String(f.audience).padStart(4);
            console.log(`    ${pill} ${String(f.level).padStart(3)}  ${f.text.slice(0, 74)}`);
          }
          console.log('');
        },
        risk,
      );
      return 0;
    }

    /* ------------------------------------------------------------ policy */
    case 'policy': {
      const [sub, subject, space] = rest;
      if (sub !== 'grant' || !subject || !space) {
        return fail('usage: cordon policy grant <subject> <space>');
      }

      const { impact, latencyMs } = await cordon.previewPolicy({
        grants: [{ subject, space }],
        includeInference: true,
      });

      out(
        flags,
        () => {
          console.log(`\n${c.bold}If you grant${c.reset} ${subject} ${c.dim}→${c.reset} ${space}\n`);
          console.log(`  ${String(impact.documentsGained).padStart(7)}  documents  ${c.dim}what you expect${c.reset}`);
          console.log(
            `  ${c.gold}${String(impact.derivedGained).padStart(7)}${c.reset}  derived facts  ${c.dim}invisible to any access review${c.reset}`,
          );
          console.log(
            `  ${c.red}${String(impact.unlockedByCombination).padStart(7)}${c.reset}  …unlocked in combination  ${c.dim}nobody approved these${c.reset}`,
          );
          if (impact.newlyInferable > 0) {
            console.log(
              `  ${c.red}${String(impact.newlyInferable).padStart(7)}${c.reset}  refused claims made rebuildable`,
            );
          }
          console.log(`\n  ${c.dim}${impact.principalsAffected} principal(s) affected · ${latencyMs}ms${c.reset}\n`);
        },
        impact,
      );
      return 0;
    }

    /* ----------------------------------------------------------- session */
    case 'session': {
      const who = rest[0];
      if (!who) return fail('usage: cordon session <principal> [--reset]');

      if (flags.reset) {
        const cleared = await cordon.resetSession(who);
        console.log(`  ${c.gold}cleared${c.reset} ${cleared.cleared} facts from ${who}'s budget`);
        return 0;
      }

      const state = await cordon.session(who);
      out(
        flags,
        () => {
          console.log(`\n${c.bold}Disclosure budget${c.reset} ${c.dim}${who}${c.reset}\n`);
          console.log(`  ${String(state.queries).padStart(7)}  questions asked`);
          console.log(`  ${String(state.size).padStart(7)}  facts disclosed`);
          console.log(
            `  ${state.determines > 0 ? c.gold : ''}${String(state.determines).padStart(7)}${c.reset}  claims their history determines  ${c.dim}without being told${c.reset}\n`,
          );
        },
        state,
      );
      return 0;
    }

    default:
      console.error(`${c.red}unknown command:${c.reset} ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

function fail(message: string): number {
  console.error(`${c.red}${message}${c.reset}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (error instanceof CordonUnavailableError) {
      console.error(`\n  ${c.red}Cordon is not ready.${c.reset} ${c.dim}${error.message}${c.reset}`);
      console.error(`  ${c.dim}Try: npm run hydra:up && npm run api${c.reset}\n`);
      process.exit(2);
    }
    if (error instanceof CordonError) {
      console.error(`\n  ${c.red}${error.message}${c.reset}\n`);
      process.exit(error.status && error.status < 500 ? 1 : 2);
    }
    console.error(`\n  ${c.red}${error instanceof Error ? error.message : String(error)}${c.reset}\n`);
    process.exit(2);
  });
