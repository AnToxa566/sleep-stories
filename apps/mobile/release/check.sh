#!/usr/bin/env bash
# Offline check of the release scripts: syntax, text rules about passwords and secrets, git rules,
# dry runs and refusal tests. It needs no network and never touches the real keys folder: every
# test uses a throwaway folder and a stub keytool. The patterns below use [x] brackets so that
# this file does not match its own rules.
#
# RELEASE_CHECK_STATIC=1 runs only the text and git rules (used by the guard proofs at the end,
# which run this file on scratch copies with one violating line added).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unset DRY_RUN

# shellcheck source=lib.sh
source ./lib.sh

failed=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failed=1; }
# Prints "file:line:text" matches of a pattern outside comment lines.
code_matches() { # PATTERN FILE...
  local pattern="$1"
  shift
  grep -nHE -- "$pattern" "$@" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
}

# One work folder, removed at exit; mkscratch makes folders inside it (it runs in a subshell, so it
# cannot keep a list of its own).
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/relchk.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
mkscratch() { mktemp -d "${work_dir}/d.XXXXXX"; }

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "FAIL: not inside a git work tree" >&2; exit 1; }
scripts=(./*.sh)

# ---- Static rules --------------------------------------------------------------------------
for f in "${scripts[@]}"; do
  bash -n "$f" || fail "syntax error in $f"
done
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x "${scripts[@]}" || fail "shellcheck reported problems"
else
  echo "shellcheck: skipped (not installed)"
fi

# 1. No shell tracing: it would print the password.
hits="$(code_matches 'set[[:space:]]+[-+][a-zA-Z]*[x]|bash[[:space:]]+-[a-z]*[x]|xtrac[e]' "${scripts[@]}")"
if [ -n "$hits" ]; then fail "shell tracing is on:"$'\n'"$hits"; fi

# 2. A password is never an argument. Allowed forms only: keytool -storepass:env SS_KS_PASS and
#    apksigner --ks-pass stdin. Those are cut out of each line first, then anything that still looks
#    like a password flag is a failure.
arg_re='-(src|dest)?(store|key)pas[s]([[:space:]]|:)|(^|[^a-z])pas[s]:|--(ks|key)-pas[s]'
hits="$(code_matches "$arg_re" "${scripts[@]}" | sed -e 's/-storepas[s]:env SS_KS_PAS[S]//g' -e 's/--ks-pas[s] stdin//g' |
  grep -E -- "$arg_re" || true)"
if [ -n "$hits" ]; then fail "a password given as an argument, or in a form that is not approved:"$'\n'"$hits"; fi

# 3. The password variables (pw, the two read buffers, SS_KS_PASS) are never printed or logged.
#    Approved exceptions: the copy into the caller's variable in lib.sh, and (slice 2) the one form
#    that feeds apksigner on standard input.
pwname='(p[w]|_s[1]|_s[2]|SS_KS_PAS[S])([^A-Za-z0-9_]|$)'
pwvar='\$\{?'"$pwname"
approved_re='^[^:]+:[0-9]+:[[:space:]]*(printf -v "\$1" '"'"'%s'"'"' "\$_s[12]"|printf '"'"'%s\\n'"'"' "\$p[w]" \| "\$APKSIGNER" [^;&|>`]*--ks-pas[s] stdin[^;&|>`]*)$'
hits="$(code_matches "(^|[^A-Za-z_])(echo|printf|log|die|result_ad[d])[[:space:]][^|]*${pwvar}|<<<[^|]*${pwvar}" "${scripts[@]}" |
  grep -vE "$approved_re" || true)"
if [ -n "$hits" ]; then fail "a password variable may be printed:"$'\n'"$hits"; fi

# 4. ...and never exported (an exported variable is visible to every child process).
hits="$(code_matches "(^|[;&|({[:space:]])(expor[t]|declare[[:space:]]+-[a-zA-Z]*[x]|typeset[[:space:]]+-[a-zA-Z]*[x])([[:space:]][^#]*)?[^A-Za-z0-9_]${pwname}|set[[:space:]]+-[a-zA-Z]*a([[:space:]]|$)|allexpor[t]" "${scripts[@]}")"
if [ -n "$hits" ]; then fail "a password variable may be exported:"$'\n'"$hits"; fi

# 5. No secret-looking literal anywhere in this folder.
hits="$(grep -nHEi -- 'sk-an[t]|sb_secre[t]_|ey[J]|postgre[s](ql)?://' ./* || true)"
if [ -n "$hits" ]; then fail "a secret-looking literal:"$'\n'"$hits"; fi

# 6. No personal email address in this folder (anything address-looking fails).
email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
hits="$(grep -noHE -- "$email_re" ./* || true)"
if [ -n "$hits" ]; then fail "an email address in the release folder:"$'\n'"$hits"; fi

# 7. Git: nothing secret is tracked or can be committed, and the ignore rules are in place.
hits="$(git -C "$repo_root" ls-files -co --exclude-standard |
  grep -E '\.(jks|keystor[e]|p12|pfx|idsig)$|(^|/)\.env\.productio[n]$' || true)"
if [ -n "$hits" ]; then fail "a key or production env file is tracked or committable:"$'\n'"$hits"; fi
for p in apps/mobile/x.keystore apps/mobile/x.jks apps/mobile/x.p12 apps/mobile/x.pfx apps/mobile/x.apk.idsig apps/mobile/.env.production; do
  git -C "$repo_root" check-ignore -q "$p" || fail ".gitignore does not ignore ${p}"
done
hits="$(git -C "$repo_root" grep --untracked -nIE -e '(store|key)Passwor[d][[:space:]]*[=:][[:space:]]*[^[:space:]]' -e '_STORE_PASSWOR[D]=' || true)"
if [ -n "$hits" ]; then fail "a signing password is written in a tracked or committable file:"$'\n'"$hits"; fi

# 8. The production env file is data, never code: nothing may `source` (or `.`) a file whose name has
#    env in it. It is read by validate_env_file in lib.sh, line by line.
hits="$(code_matches '(^|[;&|({[:space:]])(source|\.)[[:space:]]+[^[:space:]]*[eE][nN][vV]' "${scripts[@]}")"
if [ -n "$hits" ]; then fail "an env file may be run as shell code:"$'\n'"$hits"; fi

# 9. Gradle must not see the password or the key: no gradlew line mentions a password variable, and
#    the gradle command must be given the production addresses with Expo told to read no .env file.
hits="$(code_matches "gradle[w].*${pwvar}|gradle[w].*(KEYSTORE|KEYS_DIR|\.p12)" "${scripts[@]}")"
if [ -n "$hits" ]; then fail "gradle may see the password or the key:"$'\n'"$hits"; fi
if ! grep -q 'NODE_ENV=production EXPO_NO_DOTENV=1' build-release.sh; then
  fail "build-release.sh does not tell Expo to read no .env file (EXPO_NO_DOTENV=1) on the gradle command"
fi

if [ "${RELEASE_CHECK_STATIC:-0}" = "1" ]; then
  if [ "$failed" -ne 0 ]; then echo "mobile release check (static): FAILED" >&2; exit 1; fi
  echo "mobile release check (static): OK"
  exit 0
fi

# ---- Behaviour: URL rule, dry runs, refusals ---------------------------------------------------
for u in "$EXPECTED_API_URL" "$EXPECTED_SUPABASE_URL"; do
  is_public_https_url "$u" || fail "is_public_https_url refused an expected production URL: $u"
done
at_sign="$(printf '\100')" # the sign that makes a login part of a URL
for u in "http://192.168.1.5:3000/api" "https://localhost/api" "https://10.0.0.1/api" "https://172.20.1.1/api" \
  "https://192.168.1.5/api" "https://127.0.0.1/api" "https://169.254.1.1/api" "https://printer.local/api" \
  "https://[::1]/api" "https://example.com:8443/api" "https://user${at_sign}example.com/api" "https://intranet/api" \
  "http://sleep-stories-api-322759812917.europe-west1.run.app/api" ""; do
  if is_public_https_url "$u"; then fail "is_public_https_url accepted: $u"; fi
done

# A stub keytool that logs every call (never a password: it is in the environment, and only its
# presence is logged) and fails, so a script that reaches it is visible in the log.
stub_dir="$(mkscratch)"
mkdir -p "$stub_dir/bin"
cat >"$stub_dir/bin/keytool" <<'STUB'
#!/bin/sh
if [ -n "${SS_KS_PASS:-}" ]; then e=set; else e=unset; fi
echo "env:$e args:$*" >>"$STUB_LOG"
exit 1
STUB
chmod +x "$stub_dir/bin/keytool"
stub_log="$stub_dir/calls.log"
: >"$stub_log"
# Everything runs under the oldest bash that matters (macOS ships 3.2.57).
old_bash=/bin/bash
if [ ! -x "$old_bash" ]; then old_bash=bash; fi
with_stub() { env STUB_LOG="$stub_log" JAVA_HOME="$stub_dir" "$@"; }

# DRY_RUN=1 succeeds, prints commands, creates nothing and calls no tool.
for s in config.sh lib.sh create-key.sh; do
  kd="$(mkscratch)/k"
  with_stub env DRY_RUN=1 KEYS_DIR="$kd" "$old_bash" "./$s" </dev/null >/dev/null 2>&1 || fail "DRY_RUN=1 $s failed"
  if [ -e "$kd" ]; then fail "DRY_RUN=1 $s created ${kd}"; fi
done
if [ -s "$stub_log" ]; then fail "a dry run called keytool"; fi

# DRY_RUN must be unset, 0 or 1. Every other value is refused with the DRY_RUN message, before
# anything runs.
for value in true yes on 2; do
  for s in lib.sh create-key.sh; do
    kd="$(mkscratch)/k"
    out="$(with_stub env DRY_RUN="$value" KEYS_DIR="$kd" "$old_bash" "./$s" </dev/null 2>&1)" && rc=0 || rc=$?
    if [ "$rc" -eq 0 ] || ! grep -q 'DRY_RUN must be' <<<"$out"; then fail "$s did not refuse DRY_RUN=$value"; fi
    if [ -e "$kd" ]; then fail "$s created a folder with DRY_RUN=$value"; fi
  done
done
if [ -s "$stub_log" ]; then fail "a script called keytool with an invalid DRY_RUN"; fi

# Negative proofs: create-key.sh must refuse, say why, create nothing and never reach keytool.
good_input=$'throwaway-pass-12\nthrowaway-pass-12\n'
neg_case() { # NAME INPUT KEYS_DIR MESSAGE_REGEX
  local name="$1" input="$2" kd="$3" re="$4" out rc=0
  : >"$stub_log"
  out="$(printf '%s' "$input" | with_stub env KEYS_DIR="$kd" "$old_bash" ./create-key.sh 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -q -- "$re" <<<"$out"; then fail "negative proof '${name}': not refused with the expected message"; fi
  if [ -s "$stub_log" ]; then fail "negative proof '${name}': keytool was called"; fi
}
existing="$(mkscratch)/k"
mkdir -p "$existing"
: >"$existing/other.p12"
neg_case "a key already exists" "$good_input" "$existing" 'already exists'
if [ "$(ls -A "$existing" | wc -l | tr -d ' ')" != "1" ]; then fail "the existing key folder was changed"; fi
inside="${repo_root}/relchk-must-not-exist/k"
neg_case "folder inside the repository" "$good_input" "$inside" 'inside this repository'
if [ -e "${repo_root}/relchk-must-not-exist" ]; then fail "a folder was created inside the repository"; rm -rf "${repo_root}/relchk-must-not-exist"; fi
for case_name in "different passwords|throwaway-pass-12|throwaway-pass-13|differ" \
  "too short|short|short|at least 12" \
  "non-ASCII|парольпарольпароль|парольпарольпароль|at least 12" \
  "with a space|throwaway pass 12|throwaway pass 12|at least 12"; do
  IFS='|' read -r label a b msg <<<"$case_name"
  kd="$(mkscratch)/k"
  neg_case "$label" "$a"$'\n'"$b"$'\n' "$kd" "$msg"
  if [ -e "$kd" ]; then fail "negative proof '${label}': a folder was created"; fi
done

# The password reaches keytool through the environment only: the stub sees SS_KS_PASS set, the
# arguments name the variable, and the password text is nowhere in the stub's log.
kd="$(mkscratch)/k"
: >"$stub_log"
printf '%s' "$good_input" | with_stub env KEYS_DIR="$kd" "$old_bash" ./create-key.sh >/dev/null 2>&1 && fail "create-key.sh passed with a failing keytool"
grep -q 'env:set' "$stub_log" || fail "keytool did not receive the password in SS_KS_PASS"
grep -q -- '-storepas[s]:env SS_KS_PAS[S]' "$stub_log" || fail "keytool was not told to read the password from SS_KS_PASS"
if grep -q 'throwaway-pass' "$stub_log"; then fail "the password text reached keytool arguments"; fi
if [ -e "$kd/$KEYSTORE_NAME" ]; then fail "a half-made key file was left behind"; fi

# ---- verify-apk.sh: dry run, refusals, parsers and the bundle scan (all offline) ----------------
# DRY_RUN=1 prints the tool commands and runs none: the APK does not exist and the Android folder
# is a missing one, so any tool that was really run would fail.
out="$(env DRY_RUN=1 ANDROID_HOME="$work_dir/no-sdk" "$old_bash" ./verify-apk.sh "$work_dir/none.apk" </dev/null 2>&1)" && rc=0 || rc=$?
if [ "$rc" -ne 0 ] || ! grep -q '^DRY-RUN: .*dump badging' <<<"$out" || ! grep -q 'RESULT: DRY-RUN' <<<"$out"; then
  fail "DRY_RUN=1 verify-apk.sh did not print its commands and stop"
fi
for value in true yes on 2; do
  out="$(env DRY_RUN="$value" "$old_bash" ./verify-apk.sh "$work_dir/none.apk" </dev/null 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -q 'DRY_RUN must be' <<<"$out"; then fail "verify-apk.sh did not refuse DRY_RUN=$value"; fi
done
out="$(env ANDROID_HOME="$work_dir/no-sdk" "$old_bash" ./verify-apk.sh </dev/null 2>&1)" && rc=0 || rc=$?
if [ "$rc" -eq 0 ] || ! grep -q 'usage' <<<"$out"; then fail "verify-apk.sh ran without an APK argument"; fi
out="$("$old_bash" ./verify-apk.sh "$work_dir/none.apk" </dev/null 2>&1)" && rc=0 || rc=$?
if [ "$rc" -eq 0 ] || { ! grep -q 'does not exist' <<<"$out" && ! grep -q 'was not found' <<<"$out"; }; then
  fail "verify-apk.sh did not refuse a missing APK file"
fi

# Permissions: canned `aapt2 dump permissions` text. The allowed set passes; a stray permission is
# named; RECORD_AUDIO is always found.
perm_ok="package: ${APP_ID}
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.WAKE_LOCK' maxSdkVersion='32'
uses-permission: name='android.permission.FOREGROUND_SERVICE'
uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
uses-permission: name='android.permission.MODIFY_AUDIO_SETTINGS'
uses-permission: name='android.permission.VIBRATE'
uses-permission: name='android.permission.ACCESS_NETWORK_STATE'
permission: ${APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
uses-permission: name='${APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'"
perms="$(parse_permissions <<<"$perm_ok")"
if [ "$(grep -c . <<<"$perms")" != "8" ]; then fail "parse_permissions did not return the 8 permissions of the fixture"; fi
if [ -n "$(unexpected_permissions <<<"$perms")" ]; then fail "the allow-list refused an allowed permission"; fi
perms="$(parse_permissions <<<"${perm_ok}
uses-permission: name='android.permission.RECORD_AUDIO'
uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'
uses-permission: name='com.example.other.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'")"
extra="$(unexpected_permissions <<<"$perms")"
for name in android.permission.RECORD_AUDIO android.permission.SYSTEM_ALERT_WINDOW com.example.other.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION; do
  grep -qx "$name" <<<"$extra" || fail "unexpected_permissions did not name ${name}"
done
if [ "$(grep -c . <<<"$extra")" != "3" ]; then fail "unexpected_permissions named something that is allowed"; fi
grep -qx "$FORBIDDEN_PERMISSION" <<<"$perms" || fail "the RECORD_AUDIO fixture was not found by the exact-name test"

# CPU families, package fields, fingerprint.
badging="package: name='${APP_ID}' versionCode='7' versionName='1.2.3' platformBuildVersionName='16'
native-code: 'armeabi-v7a' 'arm64-v8a'"
[ "$(parse_native_abis <<<"$badging")" = "arm64-v8a,armeabi-v7a" ] || fail "parse_native_abis: wrong list or order"
[ "$(parse_native_abis <<<"$badging")" = "$(sort_csv "$ABIS")" ] || fail "the ABIS in config.sh differ from the fixture"
[ "$(parse_native_abis <<<"native-code: 'arm64-v8a'")" = "arm64-v8a" ] || fail "parse_native_abis: a single ABI"
[ -z "$(parse_native_abis <<<"package: name='x'")" ] || fail "parse_native_abis: no native code must give nothing"
[ "$(badging_field name <<<"$badging")" = "$APP_ID" ] || fail "badging_field name"
[ "$(badging_field versionCode <<<"$badging")" = "7" ] || fail "badging_field versionCode"
[ "$(badging_field versionName <<<"$badging")" = "1.2.3" ] || fail "badging_field versionName"
hex64="$(printf 'ab%.0s' $(seq 1 32))"
colon="$(printf '%s' "$hex64" | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//')"
[ "$(normalize_sha256 "$colon")" = "$hex64" ] || fail "normalize_sha256: colons and upper case"
[ "$(normalize_sha256 "$hex64"$'\r\n')" = "$hex64" ] || fail "normalize_sha256: a line ending"
for bad_fp in "" "abc" "${hex64}0" "${hex64%?}g"; do
  if normalize_sha256 "$bad_fp" >/dev/null; then fail "normalize_sha256 accepted '${bad_fp}'"; fi
done

# The bundle scan: a clean zip counts 0 for every pattern of the list; a zip with a planted
# forbidden string is found by the list, and only a path is ever printed.
scan_zip() { # DIR : unpacks DIR/x.zip into DIR/out and prints how many list patterns hit
  local d="$1" pat n=0
  mkdir -p "$d/out"
  unzip -q "$d/x.zip" -d "$d/out"
  for pat in "${BUNDLE_MUST_NOT_CONTAIN[@]}"; do
    n=$((n + $(count_files_matching E "$pat" "$d/out")))
  done
  printf '%s' "$n"
}
d="$(mkscratch)"
mkdir -p "$d/in"
printf 'plain text with %s and %s\n' "$EXPECTED_API_URL" "$EXPECTED_SUPABASE_URL" >"$d/in/clean.txt"
(cd "$d/in" && /usr/bin/zip -q ../x.zip clean.txt)
[ "$(scan_zip "$d")" = "0" ] || fail "the bundle scan flagged a clean zip"
for url in "${BUNDLE_MUST_CONTAIN[@]}"; do
  [ "$(count_files_matching F "$url" "$d/out")" = "1" ] || fail "the bundle scan did not find ${url} in the fixture"
done
# Built from pieces so that this file does not contain them whole.
planted=("sk-an""t-x" "service_rol""e" "ey""Jhbgcioijiuzi1nij9.ey""Jzdwiioixin0" "ELEVEN""LABS" "ANTHROPIC_API""_KEY"
  "DATABASE""_URL" "DIRECT""_URL" "postgre""s://x" "postgre""sql://x" "-----BEG""IN KEY" ":54""321" ":3000""/api" "http://192"".168.1.5"
  "http://10"".0.2.2" "http://172"".16.0.1" "http://127"".0.0.1")
for text in "${planted[@]}"; do
  d="$(mkscratch)"
  mkdir -p "$d/in"
  printf 'prefix %s suffix\n' "$text" >"$d/in/f.bin"
  (cd "$d/in" && /usr/bin/zip -q ../x.zip f.bin)
  [ "$(scan_zip "$d")" -ge 1 ] || fail "the bundle scan missed a planted string (${#text} characters)"
  hits="$(files_matching E "$(printf '%s' "$text" | cut -c1-3)" "$d/out")"
  case "$hits" in *prefix* | *suffix*) fail "files_matching printed file content" ;; esac
done
# Deliberately NOT scanned (owner, 2026-11-07): the secret-key prefix text and a key-shaped value after
# it, and the bare word localhost. The removal is intentional and tested here; the env gate still refuses
# a secret key (see the env file cases below).
prefix_text="sb_secre""t_"
for text in "$prefix_text" "${prefix_text}12345678901234567890abcd" "localhost" "http://localhost:8081/assets/"; do
  d="$(mkscratch)"
  mkdir -p "$d/in"
  printf 'prefix %s suffix\n' "$text" >"$d/in/f.bin"
  (cd "$d/in" && /usr/bin/zip -q ../x.zip f.bin)
  [ "$(scan_zip "$d")" = "0" ] || fail "the bundle scan flagged text that is deliberately not scanned: ${text}"
done

# ---- build-release.sh: env file, URL gate, version gate, and the order of the gates -------------
# The env file is parsed as data. Fixtures are written here and the parser must accept the good one
# and refuse every odd one. (The key texts are built from pieces so that this file does not hold them.)
good_key="sb_publishable_selftest_0123456789"
bad_secret="sb_secre""t_abcdefghij"
write_env() { # FILE LINE... : one line per argument
  local f="$1"
  shift
  printf '%s\n' "$@" >"$f"
}
envf="$work_dir/env.test"
write_env "$envf" "# comment" "" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=${EXPECTED_API_URL}" "EXPO_PUBLIC_SUPABASE_URL=${EXPECTED_SUPABASE_URL}"
problem="$(release_env_problem "$envf")" || fail "release_env_problem refused the good env file: ${problem}"
[ "$(env_file_value "$envf" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)" = "$good_key" ] || fail "env_file_value did not read the key"
write_env "$envf" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}"
release_env_problem "$envf" >/dev/null || fail "release_env_problem refused a file with only the key"
env_case() { # NAME EXPECTED_TEXT LINE...   (the file must be refused, and the text must appear)
  local name="$1" re="$2" out rc=0
  shift 2
  write_env "$envf" "$@"
  out="$(release_env_problem "$envf")" || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -q -- "$re" <<<"$out"; then fail "env file case '${name}': not refused with '${re}' (got: ${out})"; fi
  if grep -q -- "${good_key}\|${bad_secret}" <<<"$out"; then fail "env file case '${name}': the refusal printed a key"; fi
}
env_case "secret key" "SECRET key" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${bad_secret}"
env_case "not a publishable key" "not a publishable key" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyabc.def"
env_case "no key" "no EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY" "EXPO_PUBLIC_API_URL=${EXPECTED_API_URL}"
env_case "empty key" "no EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="
env_case "lan api url" "not a public https" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=http://192.168.1.5:3000/api"
env_case "localhost api url" "not a public https" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=https://localhost/api"
env_case "private api url" "not a public https" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=https://10.0.0.1/api"
env_case "plain http production api" "not a public https" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=${EXPECTED_API_URL/https:/http:}"
env_case "other api host" "not the production address" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=https://example.com/api"
env_case "other supabase" "not the production address" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_SUPABASE_URL=https://abcdefghij.supabase.co"
env_case "lan supabase" "not a public https" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.5:54321"
env_case "command substitution" "not NAME=VALUE" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\$(touch ${work_dir}/pwned)"
env_case "backticks" "not NAME=VALUE" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\`touch ${work_dir}/pwned\`"
env_case "a quote" "not NAME=VALUE" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\"${good_key}\""
env_case "a space" "not NAME=VALUE" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key} x"
env_case "export prefix" "not NAME=VALUE" "export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}"
env_case "a bare word" "not NAME=VALUE" "just some words"
env_case "lower case name" "not NAME=VALUE" "expo_public_x=1"
env_case "a name that is not read" "does not read" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "ANTHROPIC_API_KEY=abc"
env_case "a name twice" "second time" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}"
[ ! -e "$work_dir/pwned" ] || fail "the env parser ran a command written in a file"
write_env "$envf" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}"
printf '%s' "EXPO_PUBLIC_API_URL=${EXPECTED_API_URL}" >>"$envf"
release_env_problem "$envf" >/dev/null || fail "a last line without a line ending was refused"
printf 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\r\n' "$good_key" >"$envf"
release_env_problem "$envf" >/dev/null || fail "a Windows line ending was refused"

# The URL rule on its own, with the values the owner named. The production addresses pass.
release_url_problem X "$EXPECTED_API_URL" "$EXPECTED_API_URL" >/dev/null || fail "release_url_problem refused the production API URL"
release_url_problem X "$EXPECTED_SUPABASE_URL" "$EXPECTED_SUPABASE_URL" >/dev/null || fail "release_url_problem refused the production Supabase URL"
for u in "http://192.168.1.5:3000/api" "https://localhost/api" "https://10.0.0.1/api" "${EXPECTED_API_URL/https:/http:}" "https://example.com/api" ""; do
  if release_url_problem X "$u" "$EXPECTED_API_URL" >/dev/null; then fail "release_url_problem accepted: ${u}"; fi
done
if release_url_problem X "https://abcdefghij.supabase.co" "$EXPECTED_SUPABASE_URL" >/dev/null; then fail "release_url_problem accepted another Supabase project"; fi

# releases.log: the highest versionCode wins, a missing file is 0, junk lines are ignored.
rl="$work_dir/releases.log.test"
[ "$(highest_logged_version_code "$rl")" = "0" ] || fail "highest_logged_version_code: missing file"
printf '%s\n' "2026-11-07T10:00:00Z 1.0.0 3 abc 00 00" "junk" "2026-11-08T10:00:00Z 1.0.1 12 abd 00 00" "2026-11-09T10:00:00Z 1.0.1 9 abe 00 00" >"$rl"
[ "$(highest_logged_version_code "$rl")" = "12" ] || fail "highest_logged_version_code: wrong maximum"

# ---- build-release.sh: stubbed tools, scratch project, every gate must stop before the next --------
# One scratch git project holds a copy of the release folder and an app.json. Tools are stubs that log
# every call (their names and arguments, never a password). A gate that works leaves no gradlew,
# apksigner or zipalign line in the log.
sd="$(mkscratch)"
mkdir -p "$sd/bin" "$sd/jdk/bin" "$sd/sdk/build-tools/${BUILD_TOOLS_VERSION}"
stub() { # PATH BODY
  printf '#!/bin/sh\n%s\n' "$2" >"$1"
  chmod +x "$1"
}
stub "$sd/jdk/bin/java" 'exit 0'
stub "$sd/jdk/bin/keytool" 'if [ -n "${SS_KS_PASS:-}" ]; then e=set; else e=unset; fi; echo "keytool env:$e args:$*" >>"$STUB_LOG"; exit "${STUB_KEYTOOL_RC:-1}"'
stub "$sd/bin/npx" 'echo "npx $*" >>"$STUB_LOG"; [ "${STUB_NPX_RC:-0}" = 0 ] || exit 1
if [ -n "${STUB_NPX_GRADLE:-}" ]; then mkdir -p apps/mobile/android/app; echo "applicationId '"'"'${STUB_NPX_GRADLE}'"'"'" > apps/mobile/android/app/build.gradle; fi
exit 0'
bt="$sd/sdk/build-tools/${BUILD_TOOLS_VERSION}"
stub "$bt/zipalign" 'echo "zipalign $*" >>"$STUB_LOG"; exit 0'
stub "$bt/aapt2" 'echo "aapt2 $*" >>"$STUB_LOG"; exit 1'
stub "$bt/apksigner" 'echo "apksigner $*" >>"$STUB_LOG"; cat >/dev/null; case "$1" in sign) ;; *) exit 0 ;; esac
[ "${STUB_APKSIGNER_RC:-0}" = 0 ] || exit 1
prev=""; for a in "$@"; do if [ "$prev" = "--out" ]; then : >"$a"; fi; prev="$a"; done; exit 0'
GRADLE_STUB='echo "gradle""w $*" >>"$STUB_LOG"; n="$(env | grep -c "^SS_KS_PAS[S]=")"
echo "gradle env: NODE_ENV=${NODE_ENV:-} DOTENV=${EXPO_NO_DOTENV:-} API=${EXPO_PUBLIC_API_URL:-} PASSVARS=$n" >>"$STUB_LOG"
[ "${STUB_GRADLE_RC:-0}" = 0 ] || exit 1
if [ -n "${STUB_GRADLE_APK:-}" ]; then mkdir -p app/build/outputs/apk/release; : > app/build/outputs/apk/release/app-release.apk; fi
exit 0'

new_project() { # prints a clean git project that holds the release folder, app.json and a stub gradlew
  local d
  d="$(mkscratch)"
  mkdir -p "$d/apps/mobile/release" "$d/apps/mobile/android" "$d/packages/contracts"
  cp ./*.sh "$d/apps/mobile/release/"
  cp "$repo_root/apps/mobile/app.json" "$d/apps/mobile/app.json"
  printf '{}\n' >"$d/package.json"
  cp "$repo_root/.gitignore" "$d/.gitignore"
  git -C "$d" init -q
  git -C "$d" add -A
  git -C "$d" -c user.name=selftest -c user.email=selftest -c commit.gpgsign=false commit -q -m selftest
  stub "$d/apps/mobile/android/gradlew" "$GRADLE_STUB"
  printf '%s' "$d"
}
new_keys() { # prints a keys folder with a placeholder key file and fingerprint
  local k
  k="$(mkscratch)/k"
  mkdir -p "$k"
  : >"$k/$KEYSTORE_NAME"
  printf '%s\n' "$(printf 'AB:%.0s' $(seq 1 31))AB" >"$k/$CERT_FP_NAME"
  printf '%s' "$k"
}
good_env="$work_dir/good.env"
write_env "$good_env" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}"
env_for_test="$good_env"
br_run() { # PROJECT KEYS_DIR OUT_DIR INPUT [ENV=VALUE...] : runs build-release.sh from PROJECT; sets br_out and br_rc
  local proj="$1" kd="$2" od="$3" input="$4"
  shift 4
  br_rc=0
  : >"$stub_log"
  br_out="$(printf '%s' "$input" | env STUB_LOG="$stub_log" PATH="$sd/bin:$PATH" JAVA_HOME="$sd/jdk" ANDROID_HOME="$sd/sdk" \
    KEYS_DIR="$kd" OUT_DIR="$od" RELEASE_ENV_FILE="$env_for_test" "$@" "$old_bash" "$proj/apps/mobile/release/build-release.sh" 2>&1)" || br_rc=$?
}
br_expect() { # NAME MESSAGE [FORBIDDEN_CALLS_REGEX] : the last br_run must have failed with MESSAGE and made none of the forbidden calls
  local name="$1" msg="$2" forbidden="${3:-^(npx|gradlew|apksigner|zipalign|keytool)}"
  if [ "$br_rc" -eq 0 ] || ! grep -qF -- "$msg" <<<"$br_out"; then
    fail "build-release gate '${name}': not refused with '${msg}' (exit ${br_rc})"
  elif grep -qE -- "$forbidden" "$stub_log"; then
    fail "build-release gate '${name}': a later step was reached: $(grep -E -- "$forbidden" "$stub_log" | head -n 1 | cut -c1-60)"
  else
    printf 'proved: build-release %s -> %s\n' "$name" "$(grep -F -m1 -- "$msg" <<<"$br_out" | cut -c1-100)"
  fi
  if grep -q 'throwaway-pass' <<<"$br_out" || grep -q 'throwaway-pass' "$stub_log"; then fail "build-release gate '${name}': the password text was printed or logged"; fi
}
pass_in=$'throwaway-pass-12\n'

proj="$(new_project)"
kd="$(new_keys)"
od="$(mkscratch)/out"

# DRY_RUN: values other than unset, 0 and 1 are refused before anything; 1 prints and runs nothing.
for value in true yes on 2; do
  br_run "$proj" "$kd" "$od" "$pass_in" DRY_RUN="$value"
  br_expect "DRY_RUN=${value}" "DRY_RUN must be"
done
br_run "$proj" "$kd" "$od" "" DRY_RUN=1
if [ "$br_rc" -ne 0 ] || ! grep -q '^DRY-RUN: .*prebuild' <<<"$br_out" || ! grep -q 'RESULT: DRY-RUN' <<<"$br_out"; then
  fail "DRY_RUN=1 build-release.sh did not print its commands and stop"
fi
if [ -s "$stub_log" ]; then fail "DRY_RUN=1 build-release.sh called a tool: $(head -n 1 "$stub_log")"; fi
if [ -e "$od" ]; then fail "DRY_RUN=1 build-release.sh created the output folder"; fi

# The override for a dirty tree: exactly 1.
for value in 0 true yes "" 01 " 1"; do
  br_run "$proj" "$kd" "$od" "$pass_in" RELEASE_ALLOW_DIRTY="$value"
  br_expect "RELEASE_ALLOW_DIRTY='${value}'" "RELEASE_ALLOW_DIRTY must be exactly 1"
done

# A dirty tree is refused without the override: an untracked file, a changed tracked file.
printf 'x\n' >"$proj/apps/mobile/stray.txt"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "untracked file in apps/mobile" "commit or stash"
rm -f "${proj:?}/apps/mobile/stray.txt"
printf '\n' >>"$proj/package.json"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "changed package.json" "commit or stash"
git -C "$proj" checkout -q -- package.json
printf 'x\n' >"$proj/packages/contracts/stray.ts"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "untracked file in packages/contracts" "commit or stash"
rm -f "${proj:?}/packages/contracts/stray.ts"
# ...and the generated Android folder and the production env file are NOT dirt (they are git-ignored).
printf 'x\n' >"$proj/apps/mobile/android/leftover.txt"
printf 'x\n' >"$proj/apps/mobile/.env.production"
br_run "$proj" "$kd" "$od" "" STUB_KEYTOOL_RC=1
if grep -qF "commit or stash" <<<"$br_out"; then fail "ignored files were counted as a dirty tree"; fi
rm -f "${proj:?}/apps/mobile/.env.production" "${proj:?}/apps/mobile/android/leftover.txt"

# versionCode must be higher than the last recorded one.
printf '%s\n' "2026-11-07T10:00:00Z 1.0.0 1 abcdef123456 00 00" >"$kd/$RELEASES_LOG_NAME"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "versionCode equal to the last one" 'Raise `android.versionCode` in `apps/mobile/app.json` to 2, commit, run again'
printf '%s\n' "2026-11-07T10:00:00Z 1.0.0 7 abcdef123456 00 00" >"$kd/$RELEASES_LOG_NAME"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "versionCode below the last one" 'to 8, commit, run again'
rm -f "${kd:?}/${RELEASES_LOG_NAME:?}"

# The key must exist.
empty_keys="$(mkscratch)/k"
mkdir -p "$empty_keys"
br_run "$proj" "$empty_keys" "$od" "$pass_in"
br_expect "no key" "create-key.sh first"
rm -f "${kd:?}/${CERT_FP_NAME:?}"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "no fingerprint file" "create-key.sh first"
printf '%s\n' "$(printf 'AB:%.0s' $(seq 1 31))AB" >"$kd/$CERT_FP_NAME"

# The env file: missing with no terminal, and refused contents. Nothing is created or built.
env_for_test="$work_dir/missing.env"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "env file missing, no terminal" "no terminal"
if [ -e "$work_dir/missing.env" ]; then fail "build-release.sh created an env file with no terminal"; fi
env_for_test="$work_dir/bad.env"
write_env "$work_dir/bad.env" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${bad_secret}"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "secret key in the env file" "cannot be used"
write_env "$work_dir/bad.env" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${good_key}" "EXPO_PUBLIC_API_URL=http://192.168.1.5:3000/api"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "LAN api url in the env file" "not a public https"
write_env "$work_dir/bad.env" "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\$(touch ${work_dir}/pwned)"
br_run "$proj" "$kd" "$od" "$pass_in"
br_expect "command in the env file" "cannot be used"
[ ! -e "$work_dir/pwned" ] || fail "build-release.sh ran a command written in the env file"
env_for_test="$good_env"

# The password gate: a wrong password stops at keytool, before prebuild, gradle and signing.
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=1
br_expect "wrong password" "key password is wrong" '^(npx|gradlew|apksigner|zipalign)'
grep -q '^keytool env:set args:.*-storepass:env SS_KS_PASS' "$stub_log" || fail "keytool did not get the password in SS_KS_PASS"
if [ -e "$od/prebuild.log" ]; then fail "prebuild started after a wrong password"; fi

# Later gates, each stopping before the next one.
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_RC=1
br_expect "prebuild fails" "could not be generated" '^(gradlew|apksigner|zipalign)'
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE=com.example.other
br_expect "wrong application id" "does not use the app id" '^(gradlew|apksigner|zipalign)'
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE="$APP_ID" STUB_GRADLE_RC=1
br_expect "gradle fails" "Gradle build failed" '^(apksigner|zipalign)'
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE="$APP_ID"
br_expect "gradle makes no apk" "is missing" '^(apksigner|zipalign)'
# Gradle was given the production values, no .env reading, and NO password.
grep -q "gradle env: NODE_ENV=production DOTENV=1 API=${EXPECTED_API_URL} PASSVARS=0" "$stub_log" || fail "gradle did not get the production environment, or it could see the password variable"

# Signing fails: no output file stays. Signing works but verification fails (the stub aapt2 fails):
# the output is renamed so it cannot be installed, the Gradle file is gone, nothing is recorded.
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE="$APP_ID" STUB_GRADLE_APK=1 STUB_APKSIGNER_RC=1
br_expect "apksigner fails" "apksigner could not sign" '^no-such-call'
if ls "$od"/*.apk >/dev/null 2>&1; then fail "a half-signed APK was left in the output folder"; fi
br_run "$proj" "$kd" "$od" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE="$APP_ID" STUB_GRADLE_APK=1
br_expect "verification fails" "did not pass" '^no-such-call'
ls "$od"/*.apk.FAILED >/dev/null 2>&1 || fail "a failed APK was not renamed to .FAILED"
if ls "$od"/*.apk >/dev/null 2>&1; then fail "a failed APK is still installable"; fi
if [ -e "$proj/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" ]; then fail "the debug-signed Gradle file was not deleted"; fi
if [ -e "$kd/$RELEASES_LOG_NAME" ]; then fail "a failed build was recorded in releases.log"; fi
grep -qE '^apksigner sign .*--ks-pass stdin' "$stub_log" || fail "apksigner did not get the password on standard input"
if grep -q 'apksigner .*throwaway' "$stub_log"; then fail "the password was an apksigner argument"; fi

# A self-test (dirty) build whose verification PASSES: the script exits 0 (the build is honest), says
# loudly that it is for self-test only, keeps the file as -dirty.apk and records nothing. verify-apk.sh
# is replaced by a stub that passes, in a scratch copy only.
proj2="$(new_project)"
kd2="$(new_keys)"
od2="$(mkscratch)/out"
printf '#!/bin/sh\necho "RESULT: PASS"\nexit 0\n' >"$proj2/apps/mobile/release/verify-apk.sh"
br_run "$proj2" "$kd2" "$od2" "$pass_in" STUB_KEYTOOL_RC=0 STUB_NPX_GRADLE="$APP_ID" STUB_GRADLE_APK=1 RELEASE_ALLOW_DIRTY=1
if [ "$br_rc" -ne 0 ]; then fail "a dirty self-test build with a passing verification did not exit 0 (exit ${br_rc})"; fi
grep -q 'DIRTY BUILD: .*for self-test only, never install it' <<<"$br_out" || fail "a dirty build did not say it is for self-test only"
grep -q 'Do not install it anywhere' <<<"$br_out" || fail "a dirty build did not print the do-not-install warning"
ls "$od2"/*-dirty.apk >/dev/null 2>&1 || fail "a dirty build did not keep a -dirty.apk file"
if [ -e "$kd2/$RELEASES_LOG_NAME" ]; then fail "a dirty build was recorded in releases.log"; fi

# ---- Guard proofs: each text rule must fire on a scratch copy with one violating line ---------
scratch_repo() { # prints a throwaway git repo that holds a copy of this folder
  local d
  d="$(mkscratch)"
  mkdir -p "$d/apps/mobile/release"
  cp ./*.sh "$d/apps/mobile/release/"
  cp "$repo_root/.gitignore" "$d/.gitignore"
  git -C "$d" init -q
  printf '%s' "$d"
}
nested_check() { # DIR : runs the static rules of the copy in DIR
  (cd "$1/apps/mobile/release" && RELEASE_CHECK_STATIC=1 "$old_bash" ./check.sh 2>&1)
}
# The offending text is built from pieces so that this file does not contain it whole.
v='$p''w'
guard_proof() { # NAME EXPECTED_MESSAGE LINE [FILE]   (the line is appended to FILE, default create-key.sh, of the copy)
  local d out rc=0
  d="$(scratch_repo)"
  printf '%s\n' "$3" >>"$d/apps/mobile/release/${4:-create-key.sh}"
  out="$(nested_check "$d")" || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -q -- "$2" <<<"$out"; then
    fail "guard proof '$1': the check did not fail with '$2'"
  else
    printf 'proved: %s -> %s\n' "$1" "$(grep -m1 -A1 -- "$2" <<<"$out" | tail -n 1 | cut -c1-110)"
  fi
}
d="$(scratch_repo)"
nested_check "$d" >/dev/null || fail "guard proof control: the untouched copy does not pass"
printf '%s\n' "printf '%s\\n' \"$v\" | \"\$APKSIGNER\" sign --ks-pas""s stdin \"\$apk\"" >>"$d/apps/mobile/release/create-key.sh"
nested_check "$d" >/dev/null || fail "guard proof control: the approved apksigner form was refused"

guard_proof "shell tracing" "shell tracing is on" 'set -''x'
guard_proof "password flag" "given as an argument" '"$KEYTOOL" -storepas''s hunter2'
guard_proof "env: form of a flag" "given as an argument" '"$APKSIGNER" --ks-pas''s env:X'
guard_proof "password printed" "may be printed" "echo \"$v\""
guard_proof "password logged" "may be printed" "log \"typed $v\""
guard_proof "password piped elsewhere" "may be printed" "printf '%s\\n' \"$v\" | cat"
guard_proof "password exported" "may be exported" "expor""t ${v#\$}"
guard_proof "set -a" "may be exported" 'set -''a'
guard_proof "secret-looking text" "secret-looking literal" "# $(printf '%s' 'sk-an''t-abc')"
guard_proof "email address" "email address" "# $(printf '%s' 'someone''@example.org')"
guard_proof "syntax error" "syntax error" 'if ('
guard_proof "secret-looking text in verify-apk.sh" "secret-looking literal" "# $(printf '%s' 'sb_secre''t_abc')" verify-apk.sh
guard_proof "password printed in verify-apk.sh" "may be printed" "echo \"$v\"" verify-apk.sh
guard_proof "shell tracing in verify-apk.sh" "shell tracing is on" 'set -''x' verify-apk.sh
guard_proof "env file sourced" "run as shell code" 'source "$env_file"'
guard_proof "env file dotted" "run as shell code" '. "$RELEASE_ENV_FILE"'
guard_proof "password given to gradle" "gradle may see the password" "./gradle""w build \"$v\""
guard_proof "key given to gradle" "gradle may see the password" './gradle''w build -Pks="$KEYS''_DIR"'
guard_proof "password printed in build-release.sh" "may be printed" "echo \"$v\"" build-release.sh
guard_proof "password exported in build-release.sh" "may be exported" "expor""t ${v#\$}" build-release.sh
guard_proof "secret-looking text in build-release.sh" "secret-looking literal" "# $(printf '%s' 'sb_secre''t_abc')" build-release.sh
d="$(scratch_repo)"
sed -i '' 's/EXPO_NO_DOTENV=1/EXPO_NO_DOTENX=1/g' "$d/apps/mobile/release/build-release.sh"
if out="$(nested_check "$d")"; then
  fail "guard proof 'gradle reads .env': the check passed"
elif ! grep -q 'read no .env file' <<<"$out"; then
  fail "guard proof 'gradle reads .env': wrong message"
else
  printf 'proved: gradle reads .env -> %s\n' "$(grep -m1 'read no .env file' <<<"$out" | cut -c1-110)"
fi

tracked_proof() { # NAME FILE_TO_ADD_WITH_-f EXPECTED_MESSAGE [CONTENT]
  local d out rc=0
  d="$(scratch_repo)"
  mkdir -p "$d/$(dirname "$2")"
  printf '%s' "${4:-}" >"$d/$2"
  git -C "$d" add -f "$2"
  out="$(nested_check "$d")" || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -q -- "$3" <<<"$out"; then
    fail "guard proof '$1': the check did not fail with '$3'"
  else
    printf 'proved: %s -> %s\n' "$1" "$(grep -m1 -A1 -- "$3" <<<"$out" | tail -n 1 | cut -c1-110)"
  fi
}
tracked_proof "a tracked keystore" apps/mobile/x.keystore "is tracked or committable"
tracked_proof "a tracked .env.production" apps/mobile/.env.production "is tracked or committable"
tracked_proof "a tracked pfx" apps/mobile/release/x.pfx "is tracked or committable"
tracked_proof "a password in a file" apps/mobile/signing.txt "signing password is written" "storePasswor""d=abc"
tracked_proof "a password in an env-style file" apps/mobile/signing.txt "signing password is written" "MY_STORE_PASSWOR""D=abc"
d="$(scratch_repo)"
grep -v '^\*\.pfx$' "$repo_root/.gitignore" >"$d/.gitignore"
if out="$(nested_check "$d")"; then
  fail "guard proof 'a missing ignore rule': the check passed"
elif ! grep -q 'does not ignore apps/mobile/x.pfx' <<<"$out"; then
  fail "guard proof 'a missing ignore rule': wrong message"
else
  printf 'proved: a missing ignore rule -> %s\n' "$(grep -m1 'does not ignore' <<<"$out")"
fi

if [ "$failed" -ne 0 ]; then
  echo "mobile release check: FAILED" >&2
  exit 1
fi
echo "mobile release check: OK"
