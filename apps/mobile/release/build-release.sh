#!/usr/bin/env bash
# Builds the Android release app on this Mac and signs it with the release key AFTER the build.
#
# What happens, in order (each step stops with a plain sentence if it cannot go on):
#  1. tools are there (Android Studio's Java and SDK, node, zipalign, apksigner, keytool)
#  2. the project is committed (so the file name names the code; see RELEASE_ALLOW_DIRTY below)
#  3. the version in app.json is higher than the last one recorded in releases.log
#  4. the release key exists (made once by create-key.sh)
#  5. the Supabase publishable key is known (asked once, kept in apps/mobile/.env.production)
#  6. the key password is typed (hidden) and checked at once
#  7. the native Android project is regenerated from app.json (prebuild --clean)
#  8. Gradle builds the release app; the JavaScript is packed inside it. Gradle never sees the
#     password or the key: the generated project signs the release with Android's public debug
#     key, which is why step 9 signs again.
#  9. zipalign (if needed), then apksigner signs with the release key; the debug-signed file is deleted
# 10. verify-apk.sh checks the result; only a PASS of a clean build is recorded in releases.log
#
# Passwords: typed hidden (or, with no terminal, one line of standard input: that is how the
# self-tests feed a throwaway one). Never an argument, never printed, never exported. keytool gets
# it in SS_KS_PASS on one command; apksigner gets it on standard input.
#
# Usage:   bash apps/mobile/release/build-release.sh
#          DRY_RUN=1 bash apps/mobile/release/build-release.sh   (prints the commands, builds nothing)
# Self-test hooks (the real run needs none of them):
#   KEYS_DIR, OUT_DIR       other folders for the key and for the APK
#   RELEASE_ENV_FILE        another file for the Supabase publishable key
#   RELEASE_ALLOW_DIRTY=1   build uncommitted code. The file gets the suffix -dirty, nothing is
#                           recorded, and the result says it must never be installed.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

pw=""
trap 'unset pw' EXIT

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="${REPO_ROOT}/apps/mobile"
android_dir="${mobile_dir}/android"
env_file="${RELEASE_ENV_FILE:-${mobile_dir}/.env.production}"
p12="${KEYS_DIR}/${KEYSTORE_NAME}"
fp_file="${KEYS_DIR}/${CERT_FP_NAME}"
releases_log="${KEYS_DIR}/${RELEASES_LOG_NAME}"
CLEAN_PATHS=(apps/mobile packages/contracts package.json package-lock.json)
built_apk="${android_dir}/app/build/outputs/apk/release/app-release.apk"

dirty_paths() { git -C "$REPO_ROOT" status --porcelain --untracked-files=all -- "${CLEAN_PATHS[@]}"; }

# ---- The override for self-tests: exactly 1, nothing else ------------------------------------------
allow_dirty=0
if [ -n "${RELEASE_ALLOW_DIRTY+set}" ]; then
  if [ "${RELEASE_ALLOW_DIRTY}" != "1" ]; then
    die "RELEASE_ALLOW_DIRTY must be exactly 1 (or not set at all). It exists only for self-tests; a real release never uses it. Nothing was run."
  fi
  allow_dirty=1
  printf '\n!!! RELEASE_ALLOW_DIRTY=1: this build may contain uncommitted code. !!!\n'
  printf '!!! The file is marked -dirty and is NOT recorded. Never install it on a phone. !!!\n\n'
fi

# ---- 1. Tools ------------------------------------------------------------------------------------
tool_paths keytool apksigner zipalign
if ! is_dry; then
  command -v node >/dev/null 2>&1 || die "node was not found. Install Node.js (the version in .nvmrc or package.json 'engines') and run again."
  command -v npx >/dev/null 2>&1 || die "npx was not found. It comes with Node.js; install Node.js and run again."
  command -v unzip >/dev/null 2>&1 || die "unzip was not found (macOS has it at /usr/bin/unzip)."
  command -v shasum >/dev/null 2>&1 || die "shasum was not found (macOS has it at /usr/bin/shasum)."
  command -v git >/dev/null 2>&1 || die "git was not found."
  [ -d "$JAVA_HOME" ] || die "Java was not found at ${JAVA_HOME}. It comes with Android Studio ('jbr/Contents/Home' inside the app). Install Android Studio or set JAVA_HOME."
  [ -d "$ANDROID_HOME" ] || die "the Android SDK was not found at ${ANDROID_HOME}. Open Android Studio once so that it installs the SDK, or set ANDROID_HOME."
fi
# apksigner is a Java program and finds Java through JAVA_HOME in its environment.
export JAVA_HOME

# ---- 2. The project is committed -----------------------------------------------------------------
dirty="$(dirty_paths)"
if [ -n "$dirty" ] && [ "$allow_dirty" -ne 1 ]; then
  printf 'Uncommitted changes in what goes into the app (paths only):\n%s\n' "$(printf '%s\n' "$dirty" | head -n 10)" >&2
  if is_dry; then
    log "DRY_RUN: a real run would stop here; commit first, so the file name names the code"
  else
    die "commit or stash these changes first: the file name carries the commit, so the code must match it."
  fi
fi
commit="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
suffix=""
if [ "$allow_dirty" -eq 1 ]; then suffix="-dirty"; fi

# ---- 3. Version ----------------------------------------------------------------------------------
version_info="$(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).expo || {};
  const v = c.version, k = c.android && c.android.versionCode;
  if (typeof v !== "string" || !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(v) || !Number.isInteger(k) || k < 1) process.exit(2);
  console.log(v);
  console.log(k);
' "${mobile_dir}/app.json")" || die "apps/mobile/app.json must have a version like 1.0.0 and android.versionCode as a whole number from 1 up."
app_version="$(printf '%s\n' "$version_info" | sed -n 1p)"
app_code="$(printf '%s\n' "$version_info" | sed -n 2p)"
last_code="$(highest_logged_version_code "$releases_log")"
if [ "$app_code" -le "$last_code" ]; then
  die "android.versionCode is ${app_code}, but a build with ${last_code} was already made. A phone installs an update only if its number is higher. Raise \`android.versionCode\` in \`apps/mobile/app.json\` to $((last_code + 1)), commit, run again."
fi
apk_name="sleep-stories-${app_version}-vc${app_code}-${commit}${suffix}.apk"
apk_out="${OUT_DIR}/${apk_name}"

# ---- 4. Key --------------------------------------------------------------------------------------
require_outside_repo "$KEYS_DIR"
if ! is_dry; then
  if [ ! -f "$p12" ] || [ ! -f "$fp_file" ]; then
    die "the release key was not found in ${KEYS_DIR}. Run create-key.sh first (bash apps/mobile/release/create-key.sh), back the key up, then come back."
  fi
fi

# ---- 5. The Supabase publishable key -------------------------------------------------------------
if [ -f "$env_file" ]; then
  problem="$(release_env_problem "$env_file")" || die "the env file ${env_file} cannot be used: ${problem}"
elif is_dry; then
  log "DRY_RUN: ${env_file} does not exist; a real run would ask for the Supabase publishable key and write it there"
elif [ -t 0 ]; then
  cat <<'TEXT'

The app needs the Supabase PUBLISHABLE key, once. It is a public value by design (it ends up inside
the app anyway). Where to copy it:
  Supabase dashboard -> your project -> Project Settings -> API Keys -> "Publishable key".
It starts with sb_publishable_. Do NOT paste the "Secret key" (starts with the word secret).
Typing is hidden. It will be saved in a git-ignored file that only you can read.
TEXT
  read_secret_once typed_key "Publishable key: "
  problem="$(release_key_problem "$typed_key")" || die "$problem"
  mkdir -p "$(dirname "$env_file")"
  (
    umask 077
    printf '# Public Supabase key for the release build (git-ignored). The addresses come from config.sh.\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' "$typed_key" >"$env_file"
  )
  chmod 600 "$env_file"
  unset typed_key
  log "saved ${env_file}"
else
  die "the file ${env_file} does not exist and there is no terminal to ask for the Supabase publishable key. Run this script in a terminal, or create the file with one line: EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_..."
fi
if [ -f "$env_file" ]; then
  publishable_key="$(env_file_value "$env_file" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
else
  publishable_key="<publishable key>"
fi

# ---- DRY_RUN: show what a real run would do ---------------------------------------------------
if is_dry; then
  log "DRY_RUN=1: nothing is typed, built or signed. A real run would do this:"
  log "(the password is typed hidden, checked with keytool, and given to apksigner on standard input)"
  log "(1) in ${REPO_ROOT}:"
  run env EXPO_NO_GIT_STATUS=1 EXPO_NO_DOTENV=1 npx nx prebuild mobile --platform=android --install=false --clean
  log "(2) in ${android_dir}:"
  run env JAVA_HOME="$JAVA_HOME" ANDROID_HOME="$ANDROID_HOME" NODE_ENV=production EXPO_NO_DOTENV=1 \
    EXPO_PUBLIC_API_URL="$EXPECTED_API_URL" EXPO_PUBLIC_SUPABASE_URL="$EXPECTED_SUPABASE_URL" \
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
    ./gradlew :app:assembleRelease "-PreactNativeArchitectures=${ABIS}" --no-daemon --console=plain
  log "(3) then align if needed, sign, verify:"
  run "$ZIPALIGN" -c -P 16 4 "$built_apk"
  run "$APKSIGNER" sign --ks "$p12" --ks-key-alias "$KEY_ALIAS" --ks-pass stdin --v4-signing-enabled false --out "$apk_out" "$built_apk"
  run bash "${here}/verify-apk.sh" "$apk_out" "$app_version" "$app_code"
  result_add "version" INFO "${app_version}, versionCode ${app_code}"
  result_add "APK" SKIPPED "dry run: would be ${apk_out}"
  result_print "build-release"
  exit 0
fi

# ---- 6. Password ---------------------------------------------------------------------------------
log "Building ${apk_name}"
read_secret_once pw "Key password (typing is hidden): "
kt_lang=(-J-Duser.language=en -J-Duser.country=US)
SS_KS_PASS="$pw" "$KEYTOOL" "${kt_lang[@]}" -list -keystore "$p12" -storetype PKCS12 -alias "$KEY_ALIAS" -storepass:env SS_KS_PASS >/dev/null 2>&1 ||
  die "the key password is wrong (or the key file cannot be read). Nothing was built. Type it again; it is the one you chose in create-key.sh."
log "the key password is right"

# ---- 7. Prebuild ---------------------------------------------------------------------------------
mkdir -p "$OUT_DIR"
log "Regenerating the Android project from app.json (replaces apps/mobile/android; it is git-ignored)"
(cd "$REPO_ROOT" && EXPO_NO_GIT_STATUS=1 EXPO_NO_DOTENV=1 npx nx prebuild mobile --platform=android --install=false --clean --outputStyle=static) \
  >"${OUT_DIR}/prebuild.log" 2>&1 || {
  tail -n 20 "${OUT_DIR}/prebuild.log" >&2
  die "the Android project could not be generated (last lines above; full log: ${OUT_DIR}/prebuild.log). Nothing was built."
}
grep -q "applicationId '${APP_ID}'" "${android_dir}/app/build.gradle" ||
  die "the generated Android project does not use the app id ${APP_ID}. Check android.package in apps/mobile/app.json. Nothing was built."
[ -x "${android_dir}/gradlew" ] || die "the generated Android project has no gradlew file; see ${OUT_DIR}/prebuild.log"

# ---- 8. Gradle -----------------------------------------------------------------------------------
# The production addresses and the public key are given here, on this one command, and Expo is told
# not to read any .env file: the phone app must never pick up the LAN addresses of a dev machine.
rm -f "$built_apk"
log "Building the app with Gradle. This takes 10 to 15 minutes; the log is ${OUT_DIR}/build.log (follow it with: tail -f)"
(
  cd "$android_dir" && env -u SS_KS_PASS JAVA_HOME="$JAVA_HOME" ANDROID_HOME="$ANDROID_HOME" NODE_ENV=production EXPO_NO_DOTENV=1 \
    EXPO_PUBLIC_API_URL="$EXPECTED_API_URL" EXPO_PUBLIC_SUPABASE_URL="$EXPECTED_SUPABASE_URL" \
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
    ./gradlew :app:assembleRelease "-PreactNativeArchitectures=${ABIS}" --no-daemon --console=plain
) >"${OUT_DIR}/build.log" 2>&1 || {
  tail -n 30 "${OUT_DIR}/build.log" >&2
  die "the Gradle build failed (last lines above; full log: ${OUT_DIR}/build.log). Nothing was signed."
}
[ -f "$built_apk" ] || die "Gradle finished but ${built_apk} is missing; see ${OUT_DIR}/build.log"

if [ "$allow_dirty" -ne 1 ] && [ -n "$(dirty_paths)" ]; then
  die "the build changed files that are tracked by git, so the commit in the file name would be wrong. Look at 'git status', undo the change, and run again. Nothing was signed."
fi

# ---- 9. Align and sign ---------------------------------------------------------------------------
# Order matters: zipalign first, sign last (aligning after signing breaks the signature).
to_sign="$built_apk"
if "$ZIPALIGN" -c -P 16 4 "$built_apk" >/dev/null 2>&1; then
  log "the built file is already aligned"
else
  to_sign="${OUT_DIR}/aligned-unsigned.tmp.apk"
  rm -f "$to_sign"
  log "aligning the file (4 bytes, 16 KB pages)"
  "$ZIPALIGN" -P 16 -f 4 "$built_apk" "$to_sign" || die "zipalign failed; nothing was signed."
fi
rm -f "$apk_out" "${apk_out}.FAILED"
log "signing with the release key"
# The signing line must stay exactly this one approved form (check.sh matches it), so the plain
# message for a failure comes from this trap, not from a trailing ||.
trap 'rm -f "$apk_out"; printf "ERROR: apksigner could not sign the file. Nothing was kept as a release.\n" >&2' ERR
printf '%s\n' "$pw" | "$APKSIGNER" sign --ks "$p12" --ks-key-alias "$KEY_ALIAS" --ks-pass stdin --v4-signing-enabled false --out "$apk_out" "$to_sign"
trap - ERR
unset pw
# The file Gradle made is signed with Android's public debug key: delete it so that nobody installs it.
rm -f "$built_apk" "${OUT_DIR}/aligned-unsigned.tmp.apk"

# ---- 10. Proof and record ------------------------------------------------------------------------
verify_rc=0
verify_out="$(env KEYS_DIR="$KEYS_DIR" JAVA_HOME="$JAVA_HOME" ANDROID_HOME="$ANDROID_HOME" bash "${here}/verify-apk.sh" "$apk_out" "$app_version" "$app_code" 2>&1)" || verify_rc=$?
printf '%s\n' "$verify_out"
if [ "$verify_rc" -ne 0 ]; then
  mv -f "$apk_out" "${apk_out}.FAILED"
  die "verify-apk.sh did not pass (see the list above). The file was renamed to ${apk_name}.FAILED so that it cannot be installed. Fix the cause and build again."
fi

apk_sha="$(shasum -a 256 "$apk_out" | cut -d' ' -f1)"
cert_sha="$(normalize_sha256 "$(head -n 1 "$fp_file")")" || cert_sha="unreadable"
if [ "$allow_dirty" -eq 1 ]; then
  recorded="no (DIRTY BUILD)"
else
  (
    umask 077
    printf '%s %s %s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$app_version" "$app_code" "$commit" "$apk_sha" "$cert_sha" >>"$releases_log"
  )
  chmod 600 "$releases_log"
  recorded="yes, in ${releases_log}"
fi

if [ "$allow_dirty" -eq 1 ]; then
  result_add "DIRTY BUILD" INFO "for self-test only, never install it"
fi
result_add "version" INFO "${app_version}, versionCode ${app_code}, commit ${commit}"
result_add "APK" INFO "$apk_out"
result_add "APK SHA-256" INFO "$apk_sha"
result_add "key SHA-256" INFO "$cert_sha"
result_add "recorded in releases.log" INFO "$recorded"
result_print "build-release"

if [ "$allow_dirty" -eq 1 ]; then
  printf '\nThis was a self-test build of uncommitted code. Do not install it anywhere.\n'
  exit 0
fi
printf '\nNext steps\n'
printf '\n1. On your own phone (USB debugging on: Settings -> About phone -> tap "Build number" 7 times, then\n'
printf '   Developer options -> USB debugging; plug the cable in and allow the computer):\n'
printf '     "%s/platform-tools/adb" install -r "%s"\n' "$ANDROID_HOME" "$apk_out"
cat <<'TEXT'

2. On your wife's phone:
   - Send the file as a FILE, not as a picture or a link preview: Telegram "send as file", or a
     Google Drive link. Do not zip it.
   - She opens it. Android asks to allow "Install unknown apps" for the app she opened it from
     (Telegram, Drive, Files): she switches it on for that app once.
   - Play Protect may say the app is unknown or not scanned: she taps "More details", then
     "Install anyway". That is normal for an app that is not from the Play Store.
   - The FIRST file she gets must be this release one. A debug build or a build signed with
     another key cannot be updated by this one; she would have to uninstall and sign in again.
   - Updates later: the same key, and a HIGHER android.versionCode in app.json.

3. Paste the RESULT block above back to the person who is helping you.
TEXT
