#!/bin/bash

set -e

NEW_VERSION="$1"

if [ -z "$NEW_VERSION" ]; then
	echo "Usage: ./bump-version.sh <version>"
	echo "Example: ./bump-version.sh 1.0.1"
	exit 1
fi

if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "Error: Version must be in semver format (X.Y.Z)"
	exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# JSON files to update
JSON_FILES=(
	"package.json"
	"package-lock.json"
	"src/manifest.chrome.json"
	"src/manifest.firefox.json"
	"src/manifest.safari.json"
	"dev/manifest.json"
)

PBXPROJ="xcode/Obsidian Web Clipper/Obsidian Web Clipper.xcodeproj/project.pbxproj"

echo "Bumping version to $NEW_VERSION"
echo ""

# Update only the project's version fields. Dependency versions and URLs must stay intact.
for file in "${JSON_FILES[@]}"; do
	filepath="$ROOT_DIR/$file"
	if [ ! -f "$filepath" ] && [ "$file" = "dev/manifest.json" ]; then continue; fi
	node - "$filepath" "$NEW_VERSION" <<'JS'
const fs = require('node:fs');
const [file, version] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const old = data.version;
data.version = version;
if (data.packages?.['']) data.packages[''].version = version;
fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
console.log(`Updated ${file}: ${old} -> ${version}`);
JS
done

# Update MARKETING_VERSION in Xcode project
pbxpath="$ROOT_DIR/$PBXPROJ"
old_marketing=$(grep -o 'MARKETING_VERSION = [^;]*' "$pbxpath" | head -1 | sed 's/MARKETING_VERSION = //')
sed -i '' "s/MARKETING_VERSION = $old_marketing;/MARKETING_VERSION = $NEW_VERSION;/g" "$pbxpath"
marketing_count=$(grep -c "MARKETING_VERSION = $NEW_VERSION;" "$pbxpath")
echo "Updated project.pbxproj MARKETING_VERSION: $old_marketing -> $NEW_VERSION ($marketing_count occurrences)"

# Increment CURRENT_PROJECT_VERSION
old_build=$(grep -o 'CURRENT_PROJECT_VERSION = [0-9]*' "$pbxpath" | head -1 | sed 's/CURRENT_PROJECT_VERSION = //')
new_build=$((old_build + 1))
sed -i '' "s/CURRENT_PROJECT_VERSION = $old_build;/CURRENT_PROJECT_VERSION = $new_build;/g" "$pbxpath"
build_count=$(grep -c "CURRENT_PROJECT_VERSION = $new_build;" "$pbxpath")
echo "Updated project.pbxproj CURRENT_PROJECT_VERSION: $old_build -> $new_build ($build_count occurrences)"

echo ""
echo "Done!"
