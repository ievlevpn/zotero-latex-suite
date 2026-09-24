#!/usr/bin/env bash
# Cut a release: build the bundle and the .xpi, regenerate update.json from
# manifest.json, commit, push, and publish a GitHub release with the .xpi.
# Bump "version" in manifest.json first, then run ./release.sh
set -euo pipefail
cd "$(dirname "$0")"

REPO="ievlevpn/zotero-latex-suite"
XPI="latex-suite.xpi"
VER=$(node -p "require('./manifest.json').version")

npm run build
node test.js

rm -f "$XPI"
zip -q -r "$XPI" manifest.json bootstrap.js icon.svg prefs.xhtml prefs.js prefs.css LICENSE \
	build/content-script.js build/render.js vendor/ \
	src/default_snippets.js src/default_snippet_variables.js

# Regenerate update.json so update_link always points at this version's asset.
REPO="$REPO" node -e '
const fs = require("fs");
const m = require("./manifest.json");
const z = m.applications.zotero;
const repo = process.env.REPO;
const out = { addons: { [z.id]: { updates: [{
  version: m.version,
  update_link: `https://github.com/${repo}/releases/download/v${m.version}/latex-suite.xpi`,
  applications: { zotero: {
    strict_min_version: z.strict_min_version,
    ...(z.strict_max_version ? { strict_max_version: z.strict_max_version } : {}),
  } },
}] } } };
fs.writeFileSync("update.json", JSON.stringify(out, null, 2) + "\n");
'

git add -A
# Skip only a genuinely empty commit - any other commit failure (hook,
# identity) must stop the release instead of publishing the old HEAD
if git diff --cached --quiet; then
  echo "(nothing to commit)"
else
  git commit -m "Release v$VER"
fi
git push

# Changelog = commits since the previous tag (drop the "Release vX" commits).
git fetch --tags -q || true
PREV=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
RANGE=${PREV:+$PREV..HEAD}
CHANGES=$(git log --no-merges --pretty='- %s' $RANGE | grep -v '^- Release v' || true)
[ -z "$CHANGES" ] && CHANGES="- Initial release"

NOTES="## What's changed
$CHANGES

---
Install: download \`latex-suite.xpi\` below → Zotero → Tools → Plugins → ⚙ → Install Plugin From File…
Existing installs update automatically."

gh release create "v$VER" "$XPI" -t "v$VER" -n "$NOTES"

echo "released v$VER"
