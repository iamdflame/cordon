#!/usr/bin/env bash
#
# Create the GitHub fixture the real-permissions audit runs against.
#
# This exists so the fixture is reproducible and so a reviewer can see exactly
# what was seeded and what was fetched. Everything about *access* comes from
# GitHub - repository visibility, collaborator lists, team membership - and
# nothing about it is asserted here. What this script writes is the prose the
# extraction pipeline then reads, which is the part a fixture is allowed to
# invent.
#
# The people named below are fictional. The permissions are not.
#
#   bash scripts/seed-github-fixture.sh          create repos and issues
#   bash scripts/seed-github-fixture.sh --purge  delete them again
#
# Requires `gh auth login` with the `repo` scope.

set -euo pipefail

OWNER=${CORDON_GH_OWNER:-cordon-demo}

PRIVATE_REPOS=(atlas borealis cygnus draco fornax)
PUBLIC_REPOS=(handbook eridanus gemini)

if [ "${1:-}" = "--purge" ]; then
  for name in "${PRIVATE_REPOS[@]}" "${PUBLIC_REPOS[@]}"; do
    echo "deleting ${OWNER}/cordon-demo-${name}"
    gh repo delete "${OWNER}/cordon-demo-${name}" --yes 2>/dev/null || true
  done
  exit 0
fi

ensure_repo() {
  local name=$1 visibility=$2 description=$3
  local full="${OWNER}/cordon-demo-${name}"
  if gh repo view "${full}" >/dev/null 2>&1; then
    echo "exists   ${full}"
  else
    echo "creating ${full} (${visibility})"
    gh repo create "${full}" "--${visibility}" --description "${description}" >/dev/null
  fi
}

issue() {
  local repo=$1 title=$2 body=$3
  local full="${OWNER}/cordon-demo-${repo}"
  # Idempotent: skip if an issue with this title already exists.
  if gh issue list --repo "${full}" --state all --limit 200 --json title \
      --jq '.[].title' 2>/dev/null | grep -Fxq "${title}"; then
    return 0
  fi
  gh issue create --repo "${full}" --title "${title}" --body "${body}" >/dev/null
  echo "  + ${repo}: ${title}"
}

# --------------------------------------------------------------- repositories

ensure_repo atlas     private "Billing ledger migration (Cordon fixture)"
ensure_repo borealis  private "Northwind acquisition diligence (Cordon fixture)"
ensure_repo cygnus    private "Security incident response (Cordon fixture)"
ensure_repo draco     private "Pricing model rework (Cordon fixture)"
ensure_repo fornax    private "Headcount and org planning (Cordon fixture)"
ensure_repo handbook  public  "Engineering handbook (Cordon fixture)"
ensure_repo eridanus  public  "Open-source client SDK (Cordon fixture)"
ensure_repo gemini    public  "Public product roadmap (Cordon fixture)"

# -------------------------------------------------------------------- content
#
# People are distributed deliberately so that presence overlaps across
# repositories. That overlap is what produces derived facts at depth 1, the
# pairings between repositories at depth 2, and the clusters at depth 3 - which
# is the structure the whole audit is about. It is seeded here rather than
# discovered, and the audit says so.

echo "atlas"
issue atlas "Cutover plan for the billing ledger migration" \
"Priya Raman is leading the ledger cutover. We agreed the freeze window is the last week of September.
Marcus Vale will own the reconciliation checks. Priya asked that we not announce the date externally until Finance signs off."
issue atlas "Reconciliation drift on legacy accounts" \
"Marcus Vale found a 0.4% drift on pre-2024 accounts. Priya Raman confirmed this blocks the cutover.
Assigning to Marcus with Priya as reviewer."
issue atlas "Freeze window confirmed with Finance" \
"Finance signed off. Priya Raman confirmed the freeze window. Do not share outside this repo until the customer comms draft is approved."
issue atlas "Rollback rehearsal" \
"Priya Raman ran the rollback rehearsal. Marcus Vale verified the ledger snapshots restore cleanly."
issue atlas "Capacity review before cutover" \
"Tomas Nowak reviewed capacity headroom for the cutover weekend. Marcus Vale signed off on the runbook.
The billing migration is on track."

echo "borealis"
issue borealis "Diligence checklist for the Northwind acquisition" \
"Priya Raman is the technical lead on diligence. Target close is October.
Elena Fischer is handling the data-room review. This is need-to-know."
issue borealis "Northwind infra assessment" \
"Priya Raman completed the infra assessment. Elena Fischer flagged two licensing risks.
Priya notes the timeline depends on the billing work landing first."
issue borealis "Data room access list" \
"Elena Fischer maintains the access list. Priya Raman approved adding two engineers.
Do not reference the target company name outside this repo."
issue borealis "Integration sequencing" \
"Priya Raman proposed sequencing integration after the ledger freeze lifts. Elena Fischer agreed."
issue borealis "SDK compatibility during integration" \
"Ingrid Holm reviewed the client SDK surface for compatibility with Northwind's stack.
Elena Fischer asked for a written assessment before close."

echo "cygnus"
issue cygnus "Incident 2026-07 initial triage" \
"Sofia Almeida is incident commander. Marcus Vale is on the infrastructure side.
Scope is still being established. This repository is restricted."
issue cygnus "Credential rotation scope" \
"Marcus Vale rotated the affected service credentials. Sofia Almeida confirmed coverage.
Priya Raman was consulted about the billing service blast radius."
issue cygnus "Customer notification decision" \
"Rafael Costa drafted the notification. Sofia Almeida is the approver.
The customer notification is on hold pending legal review."
issue cygnus "Post-incident review scheduling" \
"Sofia Almeida scheduled the review. Priya Raman and Marcus Vale to attend.
Rafael Costa will take the write-up."

echo "draco"
issue draco "Pricing model rework: opening assumptions" \
"Sofia Almeida is leading the rework. Tomas Nowak owns the modelling.
Marcus Vale is reviewing the infrastructure cost inputs."
issue draco "Cost inputs from infrastructure" \
"Marcus Vale supplied unit costs. Tomas Nowak found a discrepancy against last quarter.
The pricing rework is blocked on finance sign-off."
issue draco "Competitive positioning notes" \
"Sofia Almeida summarised the positioning work. Tomas Nowak added sensitivity ranges.
Do not circulate outside this repository."
issue draco "Draft approved for internal review" \
"Sofia Almeida approved the draft for internal review. The pricing rework is approved."

echo "fornax"
issue fornax "Headcount plan for the next two quarters" \
"Elena Fischer owns the plan. Priya Raman supplied engineering requirements.
Rafael Costa is handling the compensation bands. Restricted."
issue fornax "Engineering requirements" \
"Priya Raman submitted requirements covering the billing and integration work.
Tomas Nowak flagged a dependency on the pricing outcome."
issue fornax "Compensation band review" \
"Rafael Costa completed the band review. Elena Fischer approved.
Do not share outside this repository under any circumstances."
issue fornax "Backfill priorities" \
"Elena Fischer set backfill priorities. Priya Raman and Tomas Nowak reviewed."

echo "handbook"
issue handbook "Engineering handbook: how we run migrations" \
"General guidance on planning migrations, freeze windows and rollback rehearsals. No project specifics."
issue handbook "Handbook: reviewing infrastructure changes" \
"How we assess infrastructure changes and who reviews what. General process only."
issue handbook "Handbook: writing incident reports" \
"Template and expectations for incident reports."
issue handbook "Handbook: migration freeze windows - owner" \
"Priya Raman owns this page and reviews changes to it. General guidance only; no project specifics here."
issue handbook "Handbook: who to ask about infrastructure reviews" \
"For questions about infrastructure review process, ask Priya Raman or Elena Fischer. This page is public and intentionally contains no project detail."
issue handbook "Handbook: incident command rotation" \
"Sofia Almeida maintains the incident command rotation page. Ingrid Holm reviews it quarterly. Process only."

echo "eridanus"
issue eridanus "Client SDK: release process" \
"Ingrid Holm maintains the SDK release process. Sofia Almeida reviews breaking changes.
This repository is public."
issue eridanus "Open issue triage rotation" \
"Ingrid Holm and Sofia Almeida share triage. Nothing confidential is discussed here."
issue eridanus "SDK v2 API surface" \
"Ingrid Holm proposed the v2 surface. Community feedback welcome."

echo "gemini"
issue gemini "Public roadmap: this quarter" \
"Ingrid Holm publishes the roadmap. Rafael Costa handles external communications.
Deliberately free of internal detail."
issue gemini "Roadmap: how we prioritise" \
"Sofia Almeida explains the prioritisation process. Ingrid Holm maintains this page."
issue gemini "Community questions" \
"Rafael Costa answers community questions here. Ingrid Holm moderates."

echo
echo "done. re-fetch the snapshot with:"
echo "  npm run audit:github -- --fetch"

# ---------------------------------------------------- deliberate contradictions
#
# These are seeded on purpose and the audit labels them as seeded.
#
# HERB contains no detectable semantic contradiction - it is generated per
# product and is internally consistent - so the contradiction mechanism has
# nowhere to fire there. Rather than tune a detector until a number appears, the
# opposed claims are planted here, in a corpus we control, and the *measurement*
# is what is being demonstrated: which side of a disagreement you see is decided
# by which repository you can read.
#
# Each pair asserts an opposing status or decision about the same subject from
# two repositories with different audiences.

echo "contradictions (seeded, labelled as such)"

issue atlas "Status: the ledger migration" \
"As of this week the ledger migration is on track. Priya Raman confirmed the freeze window holds."
issue draco "Dependency check: ledger" \
"For pricing purposes, note that the ledger migration is blocked. Tomas Nowak raised this against the cutover date."

issue gemini "Roadmap status: the SDK release" \
"The SDK release is on track for this quarter. Ingrid Holm confirmed."
issue cygnus "Release hold during incident" \
"Until the incident closes, the SDK release is paused. Sofia Almeida is the approver."

issue fornax "Decision: the headcount plan" \
"The headcount plan is approved. Elena Fischer signed off."
issue draco "Planning inputs" \
"Pending the pricing outcome, the headcount plan is rejected. Sofia Almeida asked for a resubmission."

issue handbook "Process: the incident review" \
"By default the incident review is complete once the write-up is filed."
issue cygnus "Review status" \
"The incident review is delayed. Rafael Costa has not filed the write-up."
