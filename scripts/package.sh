#!/bin/bash
# Zip the three built extensions into builds/. Never zips anything but the build folders:
# every path is explicit, and the result is checked before it is trusted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$ROOT/builds"

pack() {
	local name="$1" dir="$ROOT/$2" out="$ROOT/builds/qiaomu-clipper-$VERSION-$1.zip"
	[ -f "$dir/manifest.json" ] || { echo "Missing $dir/manifest.json: run npm run build first" >&2; exit 1; }
	grep -q "\"version\": \"$VERSION\"" "$dir/manifest.json" || { echo "$2 is not version $VERSION: rebuild first" >&2; exit 1; }
	rm -f "$out"
	( cd "$dir" && zip -qr -X "$out" . -x '*.DS_Store' )
	# a build folder is a few dozen files; far more means the wrong folder was zipped
	local count; count="$(unzip -Z1 "$out" | wc -l | tr -d ' ')"
	[ "$count" -lt 400 ] || { echo "$out has $count files: wrong folder zipped" >&2; rm -f "$out"; exit 1; }
	echo "$out ($count files)"
}

pack chrome dist
pack firefox dist_firefox
pack safari dist_safari

# The Web Store package (above) must not carry a "key": the store assigns its own. People who load the unpacked build from GitHub
# get the same public key the store item has, so their extension ID equals the store's and the local helper can allow it up front.
# Verified by src/utils/local-build-key.test.ts.
pack_local() {
	local out="$ROOT/builds/qiaomu-clipper-$VERSION-chrome-local.zip" tmp; tmp="$(mktemp -d)"
	cp -R "$ROOT/dist/." "$tmp/"
	node -e "const fs=require('fs');const p=process.argv[1]+'/manifest.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));m.key=fs.readFileSync(process.argv[2],'utf8').trim();fs.writeFileSync(p,JSON.stringify(m,null,2)+'\\n')" "$tmp" "$ROOT/scripts/chrome-local-key.txt"
	rm -f "$out"
	( cd "$tmp" && zip -qr -X "$out" . -x '*.DS_Store' )
	rm -rf "$tmp"
	echo "$out (with the store's public key, for loading unpacked)"
}
pack_local
