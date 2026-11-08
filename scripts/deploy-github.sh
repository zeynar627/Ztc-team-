#!/usr/bin/env bash
# Push this repository to GitHub and deploy it with GitHub Pages.
#
#   GITHUB_TOKEN=... REPO=owner/name ./scripts/deploy-github.sh
#
# The token needs write access to contents and Pages (classic: repo + workflow).
# It is passed per-command and never written to .git/config.
set -euo pipefail

: "${GITHUB_TOKEN:?set GITHUB_TOKEN (classic token with repo + workflow)}"
REPO="${REPO:-zeynar627/Ztc-team-}"
BRANCH="${BRANCH:-main}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

echo "→ repository: $REPO (branch $BRANCH)"

AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"

git remote remove origin >/dev/null 2>&1 || true
git remote add origin "https://github.com/$REPO.git"

echo "→ enabling GitHub Pages (workflow source)"
if ! gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || \
    echo "  (Pages API refused — enable it once in Settings → Pages → Source: GitHub Actions)"
fi

echo "→ pushing $BRANCH"
git -c http.extraheader="$AUTH_HEADER" push -u origin "$BRANCH"

echo "→ waiting for the deployment workflow"
sleep 5
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --repo "$REPO" --workflow pages.yml --branch "$BRANCH" --limit 1 --json databaseId,status --jq '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
  sleep 4
done

if [ -n "$RUN_ID" ]; then
  for _ in $(seq 1 60); do
    STATE=$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion --jq '.status + ":" + (.conclusion // "")' 2>/dev/null || echo "unknown:")
    echo "  workflow $STATE"
    case "$STATE" in
      completed:success) break ;;
      completed:*) echo "  deployment failed — see: gh run view $RUN_ID --repo $REPO --log-failed"; break ;;
    esac
    sleep 5
  done
else
  gh workflow run pages.yml --repo "$REPO" --ref "$BRANCH" >/dev/null 2>&1 || true
fi

URL=$(gh api "repos/$REPO/pages" --jq .html_url 2>/dev/null || true)
echo "→ pages url: ${URL:-not reported yet}"

if [ -n "$URL" ]; then
  for _ in $(seq 1 20); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
    echo "  $URL → HTTP $CODE"
    [ "$CODE" = "200" ] && break
    sleep 6
  done
  curl -s "$URL" | grep -qi "ZTC AI Studio" && echo "  ✓ page serves the studio" || echo "  ! page did not contain the expected title yet"
fi
