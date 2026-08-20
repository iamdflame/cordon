#!/usr/bin/env bash
#
# Move the fixture into a real GitHub organisation and build a nested team
# hierarchy inside it.
#
# Why this matters more than it looks: a GitHub team *is* a principal in
# GitHub's own permission model, and child teams inherit their parent's
# repository access. So the hierarchy created here is a real MANAGES chain
# fetched from someone else's system rather than an org chart we invented -
# which is a much stronger claim than anything we could assert ourselves.
#
#   bash scripts/seed-github-org.sh cordon-demo
#
# Requires `gh auth login` with `repo` and `admin:org` scope. If `admin:org` is
# missing, run:
#
#   gh auth refresh -s admin:org,read:org,repo
#
# Idempotent: re-running adopts whatever already exists.

set -euo pipefail

ORG=${1:?usage: seed-github-org.sh <org-login>}
USER_LOGIN=$(gh api user --jq .login)

PRIVATE_REPOS=(atlas borealis cygnus draco fornax)
PUBLIC_REPOS=(handbook eridanus gemini)

if ! gh api "orgs/${ORG}" >/dev/null 2>&1; then
  echo "organisation '${ORG}' not found, or the token cannot see it." >&2
  echo "create it at https://github.com/organizations/plan (Free), then re-run." >&2
  exit 1
fi

# ------------------------------------------------------------------ transfer

for name in "${PRIVATE_REPOS[@]}" "${PUBLIC_REPOS[@]}"; do
  repo="cordon-demo-${name}"
  if gh api "repos/${ORG}/${repo}" >/dev/null 2>&1; then
    echo "in org   ${ORG}/${repo}"
    continue
  fi
  if gh api "repos/${USER_LOGIN}/${repo}" >/dev/null 2>&1; then
    echo "moving   ${USER_LOGIN}/${repo} -> ${ORG}"
    gh api -X POST "repos/${USER_LOGIN}/${repo}/transfer" -f new_owner="${ORG}" >/dev/null
  else
    echo "missing  ${repo} (run seed-github-fixture.sh first)" >&2
  fi
done

# --------------------------------------------------------------------- teams
#
# Parent teams hold the broad, low-sensitivity access. Children add their own
# on top, and inherit the parent's - which is GitHub's rule, not ours. The
# result is that a member of `billing` can read strictly more than a member of
# `engineering`, and the two see genuinely different derived facts.

make_team() {
  local slug=$1 name=$2 parent=$3
  if gh api "orgs/${ORG}/teams/${slug}" >/dev/null 2>&1; then
    echo "team     ${slug} (exists)"
  else
    if [ -n "${parent}" ]; then
      local parent_id
      parent_id=$(gh api "orgs/${ORG}/teams/${parent}" --jq .id)
      gh api -X POST "orgs/${ORG}/teams" -f name="${name}" -F parent_team_id="${parent_id}" \
        -f privacy=closed >/dev/null
      echo "team     ${slug} (child of ${parent})"
    else
      gh api -X POST "orgs/${ORG}/teams" -f name="${name}" -f privacy=closed >/dev/null
      echo "team     ${slug}"
    fi
  fi
}

grant() {
  local slug=$1 repo=$2 permission=${3:-pull}
  gh api -X PUT "orgs/${ORG}/teams/${slug}/repos/${ORG}/cordon-demo-${repo}" \
    -f permission="${permission}" >/dev/null
  echo "  grant  ${slug} -> ${repo} (${permission})"
}

# roots
make_team engineering "engineering" ""
make_team corporate   "corporate"   ""

# engineering subtree
make_team platform       "platform"       engineering
make_team billing        "billing"        platform
make_team infrastructure "infrastructure" platform
make_team security       "security"       engineering
make_team sdk            "sdk"            engineering

# corporate subtree
make_team corpdev "corpdev" corporate
make_team finance "finance" corporate
make_team people  "people"  corporate

# leadership sees across both trees, which is what makes the audience of a
# cross-tree derived fact non-empty and therefore worth measuring.
make_team leadership "leadership" ""

echo
echo "grants"
grant engineering handbook pull
grant corporate   handbook pull

grant platform       atlas    push
grant billing        draco    push
grant infrastructure cygnus   push
grant security       cygnus   push
grant sdk            eridanus push
grant sdk            gemini   push

grant corpdev borealis push
grant finance draco    push
grant people  fornax   push

grant leadership atlas    pull
grant leadership borealis pull
grant leadership fornax   pull
grant leadership handbook pull

echo
echo "done. re-fetch with:"
echo "  CORDON_GH_OWNER=${ORG} npm run audit:github -- --fetch"
