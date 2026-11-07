# shellcheck shell=bash
# Names and numbers for the Android release scripts in apps/mobile/release.
# Sourced by lib.sh; it has no side effects and holds no secret and no password
# (ARCHITECTURE.md section 12; SECURITY.md rule 1). Public production URLs are fine here:
# they end up inside the APK anyway.

# pwd -P: the PHYSICAL path (symbolic links resolved), so that a repository reached through a link
# cannot slip past the "keys folder is inside the repository" test in lib.sh.
_release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${_release_dir}/../../.." && pwd -P)"

# The release key lives OUTSIDE the repository. The environment may override the folder
# (the self-tests use a throwaway one). Never put the real key under the repository.
# A KEYS_DIR that is set but empty stays empty, and with no HOME there is no default: both are
# refused by require_outside_repo in lib.sh (never silently replaced by something else).
if [ -n "${KEYS_DIR+set}" ]; then
  KEYS_DIR="$KEYS_DIR"
elif [ -n "${HOME:-}" ]; then
  KEYS_DIR="$HOME/sleep-stories-keys"
else
  KEYS_DIR=""
fi
KEYSTORE_NAME="sleep-stories-release.p12"
CERT_FP_NAME="release-cert.sha256" # the SHA-256 fingerprint of the certificate: public data
RELEASES_LOG_NAME="releases.log"

KEY_ALIAS="sleepstories"
KEY_ALG="RSA"
KEY_SIZE=2048
KEY_VALIDITY_DAYS=10000
KEY_DNAME="CN=Sleep Stories"

# Tools (AGENTS.md, Commands: Android Studio with SDK 36 and its bundled JDK 21).
BUILD_TOOLS_VERSION="36.1.0"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
ANDROID_HOME="${ANDROID_HOME:-${HOME:-}/Library/Android/sdk}"

APP_ID="com.antoxa566.sleepstories"
EXPECTED_API_URL="https://sleep-stories-api-322759812917.europe-west1.run.app/api"
EXPECTED_SUPABASE_URL="https://gadguyuxdxjmxtxnwlsv.supabase.co"

# Real phones: 64-bit and 32-bit ARM in one universal APK.
ABIS="arm64-v8a,armeabi-v7a"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/dist/android-release}" # the self-tests point it at a throwaway folder

# --- What verify-apk.sh accepts (arrays, so that bash 3.2 can read them) ---------------------------
# The only permissions the release app may ask for. Each one is exact: a new one in a built APK is a
# FAIL until the owner decides to add it here. The owner approved blocking SIX permissions in
# app.json (android.blockedPermissions; slice 2b, 2026-11-07): RECORD_AUDIO, SYSTEM_ALERT_WINDOW,
# READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, and USE_BIOMETRIC and USE_FINGERPRINT (a library
# of expo-secure-store adds those two; the app never asks for biometrics). They are NOT listed
# here and must never be. RECORD_AUDIO is never allowed (SECURITY.md checklist: no microphone).
ALLOWED_PERMISSIONS=(
  "android.permission.INTERNET"
  "android.permission.FOREGROUND_SERVICE"
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
  "android.permission.MODIFY_AUDIO_SETTINGS"
  "android.permission.VIBRATE"
  "android.permission.WAKE_LOCK"
  "android.permission.ACCESS_NETWORK_STATE"
  "${APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
)
FORBIDDEN_PERMISSION="android.permission.RECORD_AUDIO"

# The two audio files bundled into the app (assets/audio). React Native puts them in res/raw as
# assets_audio_<name> and drops the '-' (silence-3s.wav becomes silence3s; seen on the real build of
# 2026-11-07), so the names are matched by these fragments.
BUNDLED_RAW_FRAGMENTS=("waves" "silence3s")

# Patterns searched in EVERY file of the unpacked APK (extended regular expressions; the scan
# prints counts of files, never the matching text). The brackets keep this file from matching its
# own secret-literal rule in check.sh. A hit found on a real build that turns out to be a false
# positive (a library string) is reported to the owner, never removed quietly from this list.
# The bare word localhost is NOT checked (owner, 2026-11-07): React Native and library defaults such as
# http://localhost:8081 are dead strings in a release.
BUNDLE_MUST_NOT_CONTAIN=(
  # keys and credentials
  # The Supabase secret-key prefix (written sb_secre[t]_ here) is deliberately NOT scanned (owner,
  # 2026-11-07): the Supabase client library (@supabase/*) itself contains the prefix text, and in a
  # Hermes bundle it can end up next to any other string, so the scan gave false hits. The guard is
  # elsewhere: the app only accepts a key that starts with sb_publishable_ (src/config/env.ts) and
  # build-release.sh refuses a secret key in the env gate before building.
  "sk-an[t]-" "service_rol[e]" "ey[J][A-Za-z0-9_-]{10,}\.ey[J]"
  "ELEVENLABS" "ANTHROPIC_API_KEY" "DATABASE_URL" "DIRECT_URL"
  "postgre[s](ql)?://" "-----BEGI[N]"
  # addresses of a development machine
  ":5432[1]" ":3000/ap[i]" "http://192\.168\." "http://10\." "http://172\." "http://127\."
)
# Fixed strings that must be present: the production API and Supabase addresses (config above).
BUNDLE_MUST_CONTAIN=("$EXPECTED_API_URL" "$EXPECTED_SUPABASE_URL")
