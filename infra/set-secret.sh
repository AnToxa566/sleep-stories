#!/usr/bin/env bash
# Adds a new version to one Secret Manager secret. The value is typed at the
# terminal, hidden, and goes to gcloud on standard input: it is never an argument
# (so not in `ps`), never echoed, never in the shell history, never in a file.
# Each run adds a version (a rotation); old versions stay until destroyed by hand.
#
# Usage: bash infra/set-secret.sh NAME
#        DRY_RUN=1 bash infra/set-secret.sh NAME   (prints the command, reads nothing)
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

name="${1:-}"
allowed=0
for candidate in "${ALL_SECRETS[@]}"; do
  if [ "$name" = "$candidate" ]; then allowed=1; fi
done
if [ "$allowed" -ne 1 ]; then
  printf 'Usage: bash infra/set-secret.sh NAME\nNAME must be one of: %s\n' "${ALL_SECRETS[*]}" >&2
  exit 1
fi

value=""
value_again=""
trap 'unset value value_again' EXIT

if ! is_dry; then
  if [ ! -t 0 ]; then
    die "standard input is not a terminal; run this script by hand so the value can be typed hidden (never pipe a secret into it)"
  fi
  preflight
  IFS= read -rs -p "Value for ${name} (typing is hidden): " value
  printf '\n'
  IFS= read -rs -p "Type it again: " value_again
  printf '\n'
  if [ "$value" != "$value_again" ]; then die "the two entries differ; nothing was stored"; fi
  if [ -z "$value" ]; then die "the value is empty; nothing was stored"; fi
  if [[ "$value" =~ ^[[:space:]] || "$value" =~ [[:space:]]$ ]]; then
    die "the value starts or ends with whitespace; nothing was stored"
  fi
  unset value_again
fi

# printf is a shell builtin, so the value is not visible in the process list.
version=""
if is_dry; then
  gc secrets versions add "$name" --data-file=- --format='value(name.basename())'
else
  version="$(printf '%s' "$value" | gc secrets versions add "$name" --data-file=- --format='value(name.basename())')"
fi
unset value

if is_dry; then
  result_add "secret ${name}" SKIPPED "dry run"
else
  if [[ "$version" =~ ^[0-9]+$ ]]; then
    result_add "secret ${name} new version" PASS "${version}"
  else
    result_add "secret ${name} new version" FAIL "gcloud did not report a version number"
  fi
fi
result_print "set-secret ${name}"
