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
planted=("sk-an""t-x" "sb_secre""t_x" "service_rol""e" "ey""Jhbgcioijiuzi1nij9.ey""Jzdwiioixin0" "ELEVEN""LABS" "ANTHROPIC_API""_KEY"
  "DATABASE""_URL" "DIRECT""_URL" "postgre""s://x" "postgre""sql://x" "-----BEG""IN KEY" ":54""321" ":3000""/api" "http://192"".168.1.5"
  "http://10"".0.2.2" "http://172"".16.0.1" "http://127"".0.0.1" "local""host")
for text in "${planted[@]}"; do
  d="$(mkscratch)"
  mkdir -p "$d/in"
  printf 'prefix %s suffix\n' "$text" >"$d/in/f.bin"
  (cd "$d/in" && /usr/bin/zip -q ../x.zip f.bin)
  [ "$(scan_zip "$d")" -ge 1 ] || fail "the bundle scan missed a planted string (${#text} characters)"
  hits="$(files_matching E "$(printf '%s' "$text" | cut -c1-3)" "$d/out")"
  case "$hits" in *prefix* | *suffix*) fail "files_matching printed file content" ;; esac
done

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
