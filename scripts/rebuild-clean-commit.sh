#!/bin/bash
# Rebuild the clean SYNKRA Design commit from the current working tree
# (the REAL Task 8 build, restored from 8efb98ff). The previously pushed
# commit (25b0d88f) is a strict subset that silently dropped the entire
# Task 8 source: studio/app/shell/, studio/pages/synkra/, studio/styles/
# synkra.css, README.md, LICENSE, LICENSE-AUTHORS.md, .env.example.
set -euo pipefail
cd /home/z/my-project

TMP_INDEX="$PWD/.git/tmp-clean-index"
BRANCH="clean-restored"

rm -f "$TMP_INDEX"
export GIT_INDEX_FILE="$TMP_INDEX"

# Stage the whole working tree honoring .gitignore
# (ignores media/, repos/, db/, .env, worklog.md, logs, upload/, download/,
#  tool-results/, tests/, examples/, node_modules, .next, skills, ...)
git add -A

# Sanity: no runtime/private paths staged
FORBIDDEN=$(git ls-files | rg -c "^(media/|repos/|db/|upload/|download/|\.env$|worklog\.md|dev\.log|server\.log|tool-results/)" || echo 0)
echo "forbidden paths staged: $FORBIDDEN"
[ "$FORBIDDEN" = "0" ] || { git ls-files | rg "^(media/|repos/|db/|upload/|download/|\.env$|worklog\.md|dev\.log|server\.log|tool-results/)" | head -5; echo "ABORT"; exit 1; }

# Sanity: the previously-dropped Task 8 files MUST be present
for f in \
  studio/app/shell/SynkraShell.tsx \
  studio/app/shell/SynkraShell.module.css \
  studio/pages/synkra/HomeGate.tsx \
  studio/pages/synkra/SynkraHomePage.tsx \
  studio/pages/synkra/ComingSoonPage.tsx \
  studio/pages/synkra/VideoEditorPage.tsx \
  studio/pages/synkra/AiStudioPage.tsx \
  studio/styles/synkra.css \
  README.md LICENSE LICENSE-AUTHORS.md .env.example; do
  git ls-files --error-unmatch -- "$f" > /dev/null 2>&1 || { echo "ABORT: missing $f"; exit 1; }
done
echo "all Task 8 files staged"

COUNT=$(git ls-files | wc -l)
echo "staged files: $COUNT"

TREE=$(git write-tree)
echo "tree: $TREE"

COMMIT=$(git commit-tree "$TREE" -m "SYNKRA Design: Bento Minimalism redesign, rebrand, dashboard and product navigation

- SynkraShell application shell: obsidian pill sidebar (Home / Design Studio /
  Video Editor / AI Studio) with lime active states, user card, floating
  bottom pill nav on mobile
- Home dashboard at / for authenticated users: welcome header, bento entry
  cards (Design Studio workspace, Video Editor and AI Studio honest
  coming-soon stubs at /video-editor and /ai-studio), real recent-designs
  list with skeleton/error/empty states, storage usage card
- Post-auth landing: login and signup land on Home; deep links via ?next=
  preserved
- Rebrand sweep: manifest, marketing pages, footer, contact links now route
  to design@synkra.co.za; open-source/self-host copy replaced with real
  product capabilities; AAL attribution preserved (LICENSE + LICENSE-AUTHORS.md)
- Design Studio (full ported capability set) restyled obsidian + lime;
  UsageMeter re-skinned via token overrides

Restores the shell, synkra pages, styles, README and licence files that were
inadvertently dropped from the previously pushed tree.")
echo "commit: $COMMIT"

git update-ref "refs/heads/$BRANCH" "$COMMIT"
unset GIT_INDEX_FILE
echo "branch $BRANCH -> $(git rev-parse $BRANCH)"
echo "files in commit: $(git ls-tree -r $BRANCH --name-only | wc -l)"
