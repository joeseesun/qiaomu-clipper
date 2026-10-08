#!/bin/bash
# Download the Python runtimes for the installer from astral-sh/python-build-standalone and check them against the
# SHA256SUMS file published in the same release. Usage: fetch-python.sh <release-tag> <python-version>
#   bash scripts/pkg/fetch-python.sh 20261003 3.12.x   (pick a version listed in that release)
set -euo pipefail
TAG="${1:?release tag}"; PYV="${2:?python version}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/build/python"; mkdir -p "$OUT"; cd "$OUT"
BASE="https://github.com/astral-sh/python-build-standalone/releases/download/$TAG"
curl -fsSL -o SHA256SUMS "$BASE/SHA256SUMS"
for arch in aarch64 x86_64; do
	name="cpython-$PYV+$TAG-$arch-apple-darwin-install_only_stripped.tar.gz"
	curl -fsSL -o "$name" "$BASE/${name//+/%2B}"
	want="$(grep " $name\$" SHA256SUMS | cut -d' ' -f1)"; [ -n "$want" ] || { echo "$name not in SHA256SUMS" >&2; exit 1; }
	[ "$(shasum -a 256 "$name" | cut -d' ' -f1)" = "$want" ] || { echo "checksum mismatch: $name" >&2; exit 1; }
	d="$([ "$arch" = aarch64 ] && echo arm64 || echo x86_64)"; rm -rf "$d"; mkdir "$d"; tar -xzf "$name" -C "$d" --strip-components=1
done
echo "bash scripts/pkg/build-pkg.sh --python-arm64 $OUT/arm64 --python-x86_64 $OUT/x86_64"
