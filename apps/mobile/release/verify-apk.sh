#!/usr/bin/env bash
# Proves that a built Android APK is the release we want, before it goes to a phone. It only READS
# the APK (it never changes it) and exits 0 only when every check passes.
#
# What it checks: the signature (one signer, the recorded release key, not the debug key), the
# package facts (name, version, not debuggable, both CPU families), the permissions (an allow-list
# in config.sh, and never the microphone), the manifest (no dev launcher, no cleartext traffic, no
# backup), the zip alignment, a scan of every file for secrets and development addresses, the two
# bundled audio files, and the production addresses.
#
# Usage: bash apps/mobile/release/verify-apk.sh <apk> [versionName] [versionCode]
#        (the expected version can also come from EXPECT_VERSION_NAME and EXPECT_VERSION_CODE;
#         when none is given the version is only printed)
#        DRY_RUN=1 bash apps/mobile/release/verify-apk.sh <apk>   (prints the commands, runs none)
# The expected key fingerprint is read from $KEYS_DIR/release-cert.sha256 (made by create-key.sh);
# EXPECTED_CERT_FILE points at another file (the self-tests use that).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

apk="${1:-}"
[ -n "$apk" ] || die "usage: verify-apk.sh <apk> [versionName] [versionCode]"
expect_name="${2:-${EXPECT_VERSION_NAME:-}}"
expect_code="${3:-${EXPECT_VERSION_CODE:-}}"
cert_file="${EXPECTED_CERT_FILE:-${KEYS_DIR}/${CERT_FP_NAME}}"

tool_paths apksigner aapt2 zipalign
# apksigner is a Java program; it finds Java through JAVA_HOME in its own environment.
signer() { env JAVA_HOME="$JAVA_HOME" "$APKSIGNER" "$@"; }

if is_dry; then
  log "DRY_RUN=1: no tool is run and nothing is unpacked. The real run reads ${apk} and does this:"
  run env JAVA_HOME="$JAVA_HOME" "$APKSIGNER" verify --verbose --print-certs "$apk"
  run "$AAPT2" dump badging "$apk"
  run "$AAPT2" dump permissions "$apk"
  run "$AAPT2" dump xmltree --file AndroidManifest.xml "$apk"
  run "$AAPT2" dump resources "$apk"
  run "$ZIPALIGN" -c -P 16 4 "$apk"
  run unzip -q -o "$apk" -d "<a temporary folder>"
  run shasum -a 256 "$apk"
  result_add "all checks" SKIPPED "dry run"
  result_print "verify-apk"
  exit 0
fi

[ -f "$apk" ] || die "the file ${apk} does not exist. Build the release first, or check the path."

tmp="$(mktemp -d "${TMPDIR:-/tmp}/verify-apk.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# Every FAIL adds a line of plain words to GUIDE, printed before the RESULT block.
GUIDE=""
ok() { result_add "$1" PASS "${2:-}"; }
bad() { # LABEL DETAIL WHAT_IT_MEANS_AND_WHAT_TO_DO
  result_add "$1" FAIL "$2"
  GUIDE="${GUIDE}  - $1: $3"$'\n'
}

# ---- 1. Signature ---------------------------------------------------------------------------------
recorded=""
if [ -f "$cert_file" ]; then
  recorded="$(normalize_sha256 "$(head -n 1 "$cert_file")")" || recorded=""
fi
sig_rc=0
sig_out="$(signer verify --verbose --print-certs "$apk" 2>&1)" || sig_rc=$?
if [ "$sig_rc" -eq 0 ]; then
  ok "signature verifies"
else
  bad "signature verifies" "$(printf '%s' "$sig_out" | head -n 1 | cut -c1-120)" \
    "Android would refuse to install this file. It is damaged or was changed after signing. Build it again."
fi
signers="$(printf '%s\n' "$sig_out" | sed -n 's/^Number of signers:[[:space:]]*//p' | head -n 1)"
if [ "$signers" = "1" ]; then
  ok "exactly one signer"
else
  bad "exactly one signer" "found: ${signers:-none}" \
    "A release is signed by one key. More or none means the signing step is wrong."
fi
cert_dn="$(printf '%s\n' "$sig_out" | sed -n 's/^Signer #1 certificate DN:[[:space:]]*//p' | head -n 1)"
cert_sha="$(printf '%s\n' "$sig_out" | sed -n 's/^Signer #1 certificate SHA-256 digest:[[:space:]]*//p' | head -n 1)"
cert_sha="$(normalize_sha256 "$cert_sha")" || cert_sha=""
if [ -z "$recorded" ]; then
  bad "signed with the release key" "no recorded fingerprint in ${cert_file}" \
    "There is nothing to compare the signature with. Run create-key.sh first (it records the fingerprint), or point EXPECTED_CERT_FILE at it."
elif [ -n "$cert_sha" ] && [ "$cert_sha" = "$recorded" ]; then
  ok "signed with the release key" "SHA-256 ${cert_sha}"
else
  bad "signed with the release key" "APK key ${cert_sha:-unreadable}, expected ${recorded}" \
    "The file is signed with a different key than the release key. A phone with the real app installed would refuse it as an update. Do not install it; sign it with the release key."
fi
case "$cert_dn" in
  *"CN=Android Debug"*) bad "not the debug certificate" "the signer is the Android debug key" \
    "This is a development build signed with the public debug key. Anyone can sign an app with that key. Never give it to a user." ;;
  *) ok "not the debug certificate" ;;
esac

# ---- 2. Package facts -----------------------------------------------------------------------------
badging="$("$AAPT2" dump badging "$apk" 2>&1)" || die "aapt2 could not read ${apk} (is it an APK?)"
pkg="$(badging_field name <<<"$badging")"
code="$(badging_field versionCode <<<"$badging")"
vname="$(badging_field versionName <<<"$badging")"
if [ "$pkg" = "$APP_ID" ]; then
  ok "package name" "$pkg"
else
  bad "package name" "found ${pkg:-none}, expected ${APP_ID}" \
    "The app id is wrong. An app with another id is a different app to the phone and cannot update the real one."
fi
if [ -z "$expect_name" ] || [ "$vname" = "$expect_name" ]; then
  ok "versionName" "$vname"
else
  bad "versionName" "found ${vname:-none}, expected ${expect_name}" "The version name differs from the one asked for. Check app.json and the build."
fi
if [ -z "$expect_code" ] || [ "$code" = "$expect_code" ]; then
  ok "versionCode" "$code"
else
  bad "versionCode" "found ${code:-none}, expected ${expect_code}" \
    "The version code differs from the one asked for. A phone accepts an update only with a HIGHER code than the installed one."
fi
if grep -q '^application-debuggable' <<<"$badging"; then
  bad "not debuggable" "the app is marked debuggable" \
    "A debuggable app lets anyone with a cable read its data and attach a debugger. Build a release variant."
else
  ok "not debuggable"
fi
abis="$(parse_native_abis <<<"$badging")"
want_abis="$(sort_csv "$ABIS")"
if [ "$abis" = "$want_abis" ]; then
  ok "CPU families" "$abis"
else
  bad "CPU families" "found ${abis:-none}, expected ${want_abis}" \
    "The app must carry native code for exactly these phone CPUs. Fewer means some phones cannot run it."
fi

# ---- 3. Permissions -------------------------------------------------------------------------------
perms="$("$AAPT2" dump permissions "$apk" 2>&1 | parse_permissions)"
extra="$(unexpected_permissions <<<"$perms")"
if [ -n "$extra" ]; then
  while IFS= read -r name; do
    bad "permission ${name}" "not on the allow-list" \
      "The app asks for ${name}, which was not approved. Find which library adds it (or block it in app.json); do not add it to the list in config.sh without the owner."
  done <<<"$extra"
else
  ok "permissions all on the allow-list" "$(grep -c . <<<"$perms") asked"
fi
if grep -qx "$FORBIDDEN_PERMISSION" <<<"$perms"; then
  bad "RECORD_AUDIO absent" "the microphone permission is present" \
    "The app must never use the microphone (SECURITY.md). Remove the permission before release."
else
  ok "RECORD_AUDIO absent"
fi

# ---- 4. Manifest ----------------------------------------------------------------------------------
manifest="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$apk" 2>&1)" || die "aapt2 could not read the manifest of ${apk}"
if grep -q 'DevLauncherActivity' <<<"$manifest"; then
  bad "no dev launcher" "DevLauncherActivity is in the manifest" \
    "This is a development client build. It lets a user type any server address. Build the release variant."
else
  ok "no dev launcher"
fi
manifest_flag() { sed -n "s/.*:$1(0x[0-9a-f]*)=\\([a-z]*\\).*/\\1/p" <<<"$manifest" | head -n 1; }
cleartext="$(manifest_flag usesCleartextTraffic)"
if [ "$cleartext" = "true" ]; then
  bad "no cleartext traffic" "usesCleartextTraffic is true" \
    "The app may talk to servers without encryption. A release must use https only."
else
  ok "no cleartext traffic" "${cleartext:-not set}"
fi
backup="$(manifest_flag allowBackup)"
if [ "$backup" = "false" ]; then
  ok "backup off" "allowBackup=false"
else
  bad "backup off" "allowBackup is ${backup:-not set (Android treats that as true)}" \
    "Android may copy the app's data (the session) into a cloud or adb backup. Set allowBackup to false in app.json."
fi

# ---- 5. Alignment ---------------------------------------------------------------------------------
# -c checks only; 4 = 4-byte alignment of the entries; -P 16 = native libraries aligned for 16 KB
# memory pages (required by Google Play for new apps, and harmless elsewhere).
if "$ZIPALIGN" -c -P 16 4 "$apk" >/dev/null 2>&1; then
  ok "zip alignment (4 bytes, 16 KB pages)"
else
  bad "zip alignment (4 bytes, 16 KB pages)" "zipalign -c failed" \
    "The file is not aligned the way Android expects (or the native libraries are not 16 KB aligned). Run zipalign before signing."
fi

# ---- 6. Bundle scan -------------------------------------------------------------------------------
# Counts of FILES that contain each pattern. The matching text is never printed. Hermes keeps its
# strings as readable ASCII, so a plain search finds them; text stored as UTF-16 (resources.arsc,
# binary XML) is not covered, and the secrets of this project would sit in the JS bundle anyway.
# A real false positive (a library that contains the word 'localhost') is reported to the owner
# and decided there: it is never quietly removed from the list in config.sh.
tree="$tmp/apk"
mkdir -p "$tree"
unzip_rc=0
unzip -q -o "$apk" -d "$tree" >/dev/null 2>&1 || unzip_rc=$?
if [ "$unzip_rc" -gt 1 ]; then
  bad "unpacked for the scan" "unzip failed (code ${unzip_rc})" "The file cannot be unpacked, so it was not scanned. It may be damaged."
else
  for pat in "${BUNDLE_MUST_NOT_CONTAIN[@]}"; do
    hits="$(files_matching E "$pat" "$tree")"
    n="$(grep -c . <<<"$hits" || true)"
    if [ "$n" = "0" ]; then
      ok "bundle has no ${pat}" "0 files"
    else
      bad "bundle has no ${pat}" "${n} files, e.g. $(printf '%s\n' "$hits" | head -n 3 | paste -sd' ' -)" \
        "A pattern that must never be inside the app was found. If it is a key, STOP: rotate it. If it is a development address, the build used the wrong .env. If it is a library string, tell the owner; do not edit the list."
    fi
  done
  for url in "${BUNDLE_MUST_CONTAIN[@]}"; do
    n="$(count_files_matching F "$url" "$tree")"
    if [ "$n" != "0" ]; then
      ok "bundle has ${url}" "${n} files"
    else
      bad "bundle has ${url}" "not found" \
        "A production address is missing from the app, so it would talk to the wrong server or none. The build did not get the production .env."
    fi
  done
fi

# ---- 7. Bundled audio -----------------------------------------------------------------------------
raw_names="$("$AAPT2" dump resources "$apk" 2>/dev/null | sed -n 's/^[[:space:]]*resource 0x[0-9a-f]* raw\///p')"
for frag in "${BUNDLED_RAW_FRAGMENTS[@]}"; do
  if grep -q -- "$frag" <<<"$raw_names"; then
    ok "bundled audio ${frag}"
  else
    bad "bundled audio ${frag}" "no res/raw entry with that name" \
      "The night player needs this audio file inside the app. The assets were not packed; check the build."
  fi
done

# ---- 8. Size and hash -----------------------------------------------------------------------------
bytes="$(wc -c <"$apk" | tr -d ' ')"
mb="$(awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1048576 }')"
sha="$(shasum -a 256 "$apk" | cut -d' ' -f1)"
result_add "APK" INFO "$apk"
result_add "size" INFO "${mb} MB"
result_add "SHA-256 of the APK" INFO "$sha"

if [ "$RESULT_FAILED" -ne 0 ]; then
  printf '\nWhat the failures mean:\n%s' "$GUIDE"
fi
result_print "verify-apk"
