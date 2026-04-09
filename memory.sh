#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1; then
    exec node "$SCRIPT_DIR/scripts/memory-cli.js" "$@"
fi

echo "node is required to run memory.sh" >&2
exit 1
