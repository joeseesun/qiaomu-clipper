#!/bin/bash
# Build the macOS helper installer: builds/qiaomu-clipper-helper-<version>.pkg
#
#   bash scripts/pkg/build-pkg.sh --python-arm64 DIR --python-x86_64 DIR
#
# DIR is an unpacked python-build-standalone "install_only" folder (the one that contains bin/python3). See fetch-python.sh.
# Without signing variables the result is an UNSIGNED package that only works for testing. For release set:
#   APP_SIGN_ID      "Developer ID Application: Name (TEAMID)"   signs every binary in the bundled Python
#   INSTALLER_SIGN_ID "Developer ID Installer: Name (TEAMID)"    signs the .pkg
#   NOTARY_PROFILE   name saved with `xcrun notarytool store-credentials`   notarizes and staples
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
PY_ARM="" PY_X64=""
while [ $# -gt 0 ]; do case "$1" in --python-arm64) PY_ARM="$2"; shift 2;; --python-x86_64) PY_X64="$2"; shift 2;; *) echo "unknown option $1" >&2; exit 1;; esac; done
for d in "$PY_ARM" "$PY_X64"; do [ -x "$d/bin/python3" ] || { echo "need --python-arm64 and --python-x86_64 folders containing bin/python3" >&2; exit 1; }; done

WORK="$ROOT/build/pkg"; PAYLOAD="$WORK/payload/Library/QiaomuClipper"
rm -rf "$WORK"; mkdir -p "$PAYLOAD/native" "$PAYLOAD/bin" "$WORK/scripts" "$WORK/resources" "$ROOT/builds"
ditto "$PY_ARM" "$PAYLOAD/runtime-arm64"; ditto "$PY_X64" "$PAYLOAD/runtime-x86_64"
for f in install.py host.py asr.py asr_cloud.py asr_engines.py asr_runner.py asr_context.py; do cp "$ROOT/native/$f" "$PAYLOAD/native/$f"; done
cp "$ROOT/scripts/pkg/qiaomu-helper" "$PAYLOAD/bin/qiaomu-helper"; chmod +x "$PAYLOAD/bin/qiaomu-helper"
cp "$ROOT/scripts/pkg/postinstall" "$WORK/scripts/postinstall"; chmod +x "$WORK/scripts/postinstall"
# Installer.app ignores <meta charset> and shows UTF-8 as mojibake, so the pages must be pure ASCII (&#x...; entities).
for page in welcome conclusion; do
	python3 -c "import sys;sys.stdout.write(open(sys.argv[1],encoding='utf8').read().encode('ascii','xmlcharrefreplace').decode())" "$ROOT/scripts/pkg/$page.html" > "$WORK/resources/$page.html"
	! LC_ALL=C grep -q '[^ -~]' "$WORK/resources/$page.html" || { echo "$page.html is not ASCII" >&2; exit 1; }
done
sed "s/@VERSION@/$VERSION/" "$ROOT/scripts/pkg/distribution.xml" > "$WORK/distribution.xml"
find "$PAYLOAD" -name __pycache__ -type d -prune -exec rm -rf {} +

if [ -n "${APP_SIGN_ID:-}" ]; then
	# Notarization wants every Mach-O file signed with the hardened runtime and a secure timestamp, deepest files first.
	find "$PAYLOAD" -type f -print0 | while IFS= read -r -d '' f; do
		if file -b "$f" | grep -q "Mach-O"; then codesign --force --options runtime --timestamp --sign "$APP_SIGN_ID" "$f" 2>&1 | grep -v "replacing existing signature" || true; fi
	done
	echo "signed bundled binaries"
fi

pkgbuild --root "$WORK/payload" --scripts "$WORK/scripts" --identifier ai.qiaomu.clipper.helper --version "$VERSION" --install-location / "$WORK/helper.pkg"
OUT="$ROOT/builds/qiaomu-clipper-helper-$VERSION.pkg"
SIGN=(); [ -n "${INSTALLER_SIGN_ID:-}" ] && SIGN=(--sign "$INSTALLER_SIGN_ID" --timestamp)
productbuild --distribution "$WORK/distribution.xml" --resources "$WORK/resources" --package-path "$WORK" ${SIGN[@]+"${SIGN[@]}"} "$OUT"
if [ -n "${NOTARY_PROFILE:-}" ] && [ -n "${INSTALLER_SIGN_ID:-}" ]; then
	xcrun notarytool submit "$OUT" --keychain-profile "$NOTARY_PROFILE" --wait
	xcrun stapler staple "$OUT"
	spctl --assess --type install -v "$OUT"
elif [ -n "${INSTALLER_SIGN_ID:-}" ]; then
	echo "Signed but NOT notarized: macOS will still warn on first open. Set NOTARY_PROFILE to notarize." >&2
else
	echo "NOT signed or notarized: for testing only" >&2
fi
# A fixed name, so the settings page can link to .../releases/latest/download/qiaomu-clipper-helper.pkg
cp "$OUT" "$ROOT/builds/qiaomu-clipper-helper.pkg"
echo "$OUT"
echo "$ROOT/builds/qiaomu-clipper-helper.pkg (upload both with the release)"
