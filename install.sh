#!/bin/sh
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 22.13 or newer (https://nodejs.org) and Git (https://git-scm.com).'
  exit 1
fi
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/server/install.mjs" "$@"
