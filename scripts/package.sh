#!/bin/bash
# Compatibility entry point; npm run package is the supported interface.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/package.mjs" "$@"
