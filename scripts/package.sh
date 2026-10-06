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
