# shellcheck shell=bash
# Helpers shared by the release scripts. Sourced, never run on its own.
#
# Why this is a copy of the ideas in infra/lib.sh and not a shared file: infra/lib.sh sources the
# Google Cloud config and checks gcloud, and a mobile build has nothing to do with either.
#
# Rules this file enforces (apps/mobile/release/check.sh fails when a script breaks them):
# - DRY_RUN=1 prints each change command and runs nothing. Any other value than unset, 0 or 1
#   is refused at load time.
# - A password is typed hidden (or, with no terminal, read from standard input: that is how the
#   self-tests feed a throwaway one). It is never an argument, never printed, never exported.
#   keytool gets it through the variable SS_KS_PASS set on that one command only.
# - Everything must run under bash 3.2 (the one macOS ships): no mapfile, no ${x,,}, no
#   associative arrays, no namerefs.

_release_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${_release_lib_dir}/config.sh"

is_dry() { [ "${DRY_RUN:-0}" = "1" ]; }
log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# DRY_RUN is unset, 0 or 1. Anything else (true, yes, on, 2) would silently run for real, so it
# stops every script at load time, before a single command.
case "${DRY_RUN:-0}" in
  0 | 1) ;;
  *) die "DRY_RUN must be unset, 0 or 1 (got a different value); nothing was run" ;;
esac

# Runs a command, or under DRY_RUN prints it (shell-quoted, so it can be pasted).
run() {
  if is_dry; then
    printf 'DRY-RUN: '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# --- RESULT block: names, versions and PASS/FAIL, never values -------------------
RESULT_TEXT=""
RESULT_FAILED=0

result_add() { # LABEL STATUS [DETAIL]
  RESULT_TEXT="${RESULT_TEXT}  $1: $2${3:+ ($3)}"$'\n'
  if [ "$2" = "FAIL" ]; then RESULT_FAILED=1; fi
}

result_print() { # TITLE; exits 1 when something failed
  printf '\nRESULT: %s\n%s' "$1" "$RESULT_TEXT"
  if is_dry; then
    printf 'RESULT: DRY-RUN (nothing was executed)\n'
  elif [ "$RESULT_FAILED" -eq 0 ]; then
    printf 'RESULT: PASS\n'
  else
    printf 'RESULT: FAIL\n'
    exit 1
  fi
}

# --- Passwords --------------------------------------------------------------------
# read_secret_once VARNAME PROMPT: reads one hidden line into the variable VARNAME. On a terminal
# it uses `read -rs`; if the run is interrupted the terminal gets its echo back. With no terminal
# it reads exactly ONE line of standard input per call (the self-tests feed a throwaway password
# this way). The value is only stored in the named variable.
read_secret_once() {
  local _line=""
  if [ -t 0 ]; then
    trap 'stty echo 2>/dev/null; printf "\n" >&2; exit 130' INT TERM
    IFS= read -rs -p "$2" _line || { stty echo 2>/dev/null; die "no input was typed"; }
    printf '\n' >&2
    trap - INT TERM
  else
    IFS= read -r _line || die "no password on standard input"
  fi
  printf -v "$1" '%s' "$_line"
}

# read_secret_twice VARNAME: asks twice and checks the rules: at least 12 characters, printable
# ASCII without spaces, and both entries equal. The messages never contain the entry.
read_secret_twice() {
  local _s1="" _s2=""
  read_secret_once _s1 "New key password (typing is hidden): "
  read_secret_once _s2 "Type it again: "
  if [ "$_s1" != "$_s2" ]; then die "the two entries differ; nothing was created"; fi
  _release_password_ok "$_s1" || die "the password must be at least 12 characters, letters, digits and signs only (ASCII, no spaces); nothing was created"
  printf -v "$1" '%s' "$_s1"
}

_release_password_ok() {
  local LC_ALL=C # so that [!-~] means the ASCII printable range, whatever the terminal language is
  [[ "$1" =~ ^[\!-~]{12,}$ ]]
}

# --- Paths --------------------------------------------------------------------------
# require_outside_repo PATH: stops when PATH (which may not exist yet) is inside this repository
# or inside any git work tree. The path is made absolute and symlinks are resolved.
require_outside_repo() {
  local p="$1" rest="" base probe
  case "$p" in /*) ;; *) p="${PWD}/${p}" ;; esac
  probe="$p"
  while [ ! -e "$probe" ]; do
    base="$(basename "$probe")"
    if [ "$base" = ".." ]; then die "the folder path contains '..' in a part that does not exist yet: ${p}"; fi
    rest="/${base}${rest}"
    probe="$(dirname "$probe")"
  done
  probe="$(cd "$probe" && pwd -P)" || die "cannot resolve the folder ${p}"
  p="${probe}${rest}"
  case "${p}/" in
    "${REPO_ROOT}/"*) die "the keys folder is inside this repository (${p}); the key must never live in the project" ;;
  esac
  local top
  top="$(cd "$probe" && git rev-parse --show-toplevel 2>/dev/null)" || top=""
  if [ -n "$top" ]; then die "the keys folder is inside a git work tree (${top}); the key must never live in a project"; fi
}

# tool_paths [keytool] [apksigner] [aapt2] [zipalign]: sets KEYTOOL, APKSIGNER, AAPT2, ZIPALIGN for
# the tools asked for (all four with no argument) and stops with a plain hint when one is missing.
# Under DRY_RUN the paths are only set, not checked.
tool_paths() {
  local want="${*:-keytool apksigner aapt2 zipalign}" t bt="${ANDROID_HOME}/build-tools/${BUILD_TOOLS_VERSION}"
  for t in $want; do
    case "$t" in
      keytool) KEYTOOL="${JAVA_HOME}/bin/keytool" ;;
      apksigner) APKSIGNER="${bt}/apksigner" ;;
      aapt2) AAPT2="${bt}/aapt2" ;;
      zipalign) ZIPALIGN="${bt}/zipalign" ;;
      *) die "internal error: unknown tool ${t}" ;;
    esac
  done
  if is_dry; then return 0; fi
  for t in $want; do
    case "$t" in
      keytool)
        [ -x "$KEYTOOL" ] || die "keytool was not found at ${KEYTOOL}. It comes with Android Studio (its bundled Java). Install Android Studio, or set JAVA_HOME to its folder 'jbr/Contents/Home'." ;;
      apksigner | aapt2 | zipalign)
        local path
        case "$t" in apksigner) path="$APKSIGNER" ;; aapt2) path="$AAPT2" ;; *) path="$ZIPALIGN" ;; esac
        [ -x "$path" ] || die "${t} was not found at ${path}. Open Android Studio, SDK Manager, SDK Tools, tick 'Android SDK Build-Tools ${BUILD_TOOLS_VERSION}' (Show Package Details) and install it, or set ANDROID_HOME." ;;
    esac
  done
}

# 0 if the URL may be baked into a release app: https, a public host name, no port, no login in the
# address. Refuses localhost, loopback, private and link-local addresses, .local names, IPv6.
is_public_https_url() { # URL
  local url="$1" host
  case "$url" in https://*) ;; *) return 1 ;; esac
  case "$url" in *[[:space:]]*) return 1 ;; esac
  host="${url#https://}"
  host="${host%%/*}"
  host="${host%%\?*}"
  host="${host%%#*}"
  [ -n "$host" ] || return 1
  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
  case "$host" in *[!a-z0-9.-]*) return 1 ;; esac # a port, a login, [ ] and ::1 all contain another sign
  case "$host" in
    localhost | localhost. | *.localhost | *.local | *.local. | 0.0.0.0) return 1 ;;
    127.* | 10.* | 192.168.* | 169.254.*) return 1 ;;
    172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 1 ;;
  esac
  case "$host" in *.*) ;; *) return 1 ;; esac # a name with no dot is a local name
  return 0
}

# --- Parsers for verify-apk.sh -----------------------------------------------------------------
# Pure functions: text in, text out, no tool and no APK needed, so check.sh can test them with
# canned text.

# parse_permissions: reads `aapt2 dump permissions` on standard input, prints each permission the
# app asks for once, sorted. A line "uses-permission: name='X' maxSdkVersion='32'" gives X; the
# line "permission: X" only declares the app's own permission (it is listed again as a use).
parse_permissions() {
  sed -n -e "s/^uses-permission[a-z0-9-]*:[[:space:]]*name='\([^']*\)'.*/\1/p" | LC_ALL=C sort -u
}

# parse_native_abis: reads `aapt2 dump badging` on standard input, prints the ABIs of the line
# "native-code: 'a' 'b'" as one comma-separated list, sorted (so the order never matters).
parse_native_abis() {
  sed -n -e "s/^native-code:[[:space:]]*//p" | tr -d "'" | tr ' ' '\n' | grep -v '^$' | LC_ALL=C sort -u | paste -sd, -
}

# sort_csv "b,a" -> "a,b"
sort_csv() { printf '%s\n' "$1" | tr ',' '\n' | grep -v '^$' | LC_ALL=C sort -u | paste -sd, -; }

# badging_field FIELD: reads `aapt2 dump badging`, prints a field of its first "package:" line
# (name, versionCode or versionName).
badging_field() {
  sed -n -e "s/^package:.* $1='\([^']*\)'.*/\1/p" | head -n 1
}

# permission_allowed NAME: 0 if NAME is on ALLOWED_PERMISSIONS (exact match only).
permission_allowed() {
  local p
  for p in "${ALLOWED_PERMISSIONS[@]}"; do
    if [ "$p" = "$1" ]; then return 0; fi
  done
  return 1
}

# unexpected_permissions: reads permission names (one per line) and prints those that are not
# allowed. RECORD_AUDIO is never allowed, so it is always printed.
unexpected_permissions() {
  local name
  while IFS= read -r name; do
    if [ -n "$name" ] && ! permission_allowed "$name"; then printf '%s\n' "$name"; fi
  done
}

# normalize_sha256 TEXT: lower case, no colons, no spaces. Prints the 64 hex characters, or
# nothing (and returns 1) when the text is not a SHA-256 fingerprint.
normalize_sha256() {
  local s
  s="$(printf '%s' "$1" | tr -d ': \t\r\n' | tr '[:upper:]' '[:lower:]')"
  case "$s" in *[!0-9a-f]*) return 1 ;; esac
  if [ "${#s}" -ne 64 ]; then return 1; fi
  printf '%s' "$s"
}

# files_matching MODE PATTERN DIR: prints the paths (relative to DIR) of the files under DIR that
# contain PATTERN, one per line, and NEVER the matching text. MODE is E (regular expression) or F
# (fixed string). Binary files count (-a); LC_ALL=C makes bytes the unit, whatever the language.
files_matching() {
  local mode="$1" pattern="$2" dir="$3"
  (cd "$dir" && LC_ALL=C grep -rla"$mode" -e "$pattern" . 2>/dev/null) || true
}

# count_files_matching MODE PATTERN DIR: the number of such files (a count only).
count_files_matching() {
  files_matching "$1" "$2" "$3" | grep -c . || true
}

# --- Build helpers for build-release.sh ----------------------------------------------------------
# Pure functions again (text in, a plain sentence out), so check.sh can test them offline.

# The only names the production env file may set. Everything else in that file is refused: the file
# is read as data, never run (a shell would run anything written in it).
RELEASE_ENV_NAMES=" EXPO_PUBLIC_API_URL EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY "

# validate_env_file FILE: 0 if every line is empty, a '#' comment, or NAME=VALUE with a name from the
# list above (each at most once) and a value of plain characters. Otherwise prints one sentence
# (the line number, never the content) and returns 1.
validate_env_file() {
  local file="$1" line n=0 seen=" " re='^([A-Z_]+)=([A-Za-z0-9._~:/?#%+=&-]*)$' LC_ALL=C
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    if ! [[ "$line" =~ $re ]]; then
      printf 'line %s is not NAME=VALUE with plain characters (spaces, quotes and $ are not allowed; the content is not shown)\n' "$n"
      return 1
    fi
    case "$RELEASE_ENV_NAMES" in
      *" ${BASH_REMATCH[1]} "*) ;;
      *) printf 'line %s sets a name that a release does not read (only the three EXPO_PUBLIC_ names are allowed)\n' "$n"; return 1 ;;
    esac
    case "$seen" in
      *" ${BASH_REMATCH[1]} "*) printf 'line %s sets the same name a second time\n' "$n"; return 1 ;;
    esac
    seen="${seen}${BASH_REMATCH[1]} "
  done <"$file"
}

# env_file_value FILE NAME: prints the value of NAME (empty if absent). Call validate_env_file first.
env_file_value() {
  sed -n "s/^$2=//p" "$1" | tr -d '\r' | head -n 1
}

# release_key_problem KEY: prints a sentence and returns 1 if KEY cannot be the Supabase publishable key.
release_key_problem() {
  local key="$1"
  case "$key" in
    sb_secre[t]_*) printf 'this is the SECRET key (it starts with the word secret). Never put it in the app. Use the "Publishable key" instead.\n'; return 1 ;;
  esac
  if ! [[ "$key" =~ ^sb_publishable_[A-Za-z0-9_-]+$ ]]; then
    printf 'the key is not a publishable key: it must start with sb_publishable_ and have only letters, digits, - and _\n'
    return 1
  fi
}

# release_url_problem NAME VALUE EXPECTED: prints a sentence and returns 1 unless VALUE is a public
# https address AND exactly the production address EXPECTED.
release_url_problem() {
  if ! is_public_https_url "$2"; then
    printf '%s is not a public https address. A release must never point at a development machine or use plain http.\n' "$1"
    return 1
  fi
  if [ "$2" != "$3" ]; then
    printf '%s is not the production address written in config.sh. Remove the line from the env file (the build uses the config value).\n' "$1"
    return 1
  fi
}

# release_env_problem FILE: 0 if the env file is usable for a release; otherwise prints the reason.
release_env_problem() {
  local file="$1" msg key api supa
  msg="$(validate_env_file "$file")" || { printf '%s\n' "$msg"; return 1; }
  key="$(env_file_value "$file" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
  if [ -z "$key" ]; then printf 'the file has no EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY line\n'; return 1; fi
  msg="$(release_key_problem "$key")" || { printf '%s\n' "$msg"; return 1; }
  api="$(env_file_value "$file" EXPO_PUBLIC_API_URL)"
  if [ -n "$api" ]; then
    msg="$(release_url_problem EXPO_PUBLIC_API_URL "$api" "$EXPECTED_API_URL")" || { printf '%s\n' "$msg"; return 1; }
  fi
  supa="$(env_file_value "$file" EXPO_PUBLIC_SUPABASE_URL)"
  if [ -n "$supa" ]; then
    msg="$(release_url_problem EXPO_PUBLIC_SUPABASE_URL "$supa" "$EXPECTED_SUPABASE_URL")" || { printf '%s\n' "$msg"; return 1; }
  fi
}

# highest_logged_version_code FILE: the highest versionCode (3rd column) in releases.log; 0 if the
# file is missing or empty. Columns: date, version, versionCode, commit, APK SHA-256, certificate SHA-256.
highest_logged_version_code() {
  if [ ! -f "$1" ]; then printf '0'; return 0; fi
  awk '$3 ~ /^[0-9]+$/ { if ($3 + 0 > m) m = $3 + 0 } END { print m + 0 }' "$1"
}
