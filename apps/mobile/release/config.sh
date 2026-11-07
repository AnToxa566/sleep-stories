# shellcheck shell=bash
# Names and numbers for the Android release scripts in apps/mobile/release.
# Sourced by lib.sh; it has no side effects and holds no secret and no password
# (ARCHITECTURE.md section 12; SECURITY.md rule 1). Public production URLs are fine here:
# they end up inside the APK anyway.

_release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_release_dir}/../../.." && pwd)"

# The release key lives OUTSIDE the repository. The environment may override the folder
# (the self-tests use a throwaway one). Never put the real key under the repository.
KEYS_DIR="${KEYS_DIR:-$HOME/sleep-stories-keys}"
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
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

APP_ID="com.antoxa566.sleepstories"
EXPECTED_API_URL="https://sleep-stories-api-322759812917.europe-west1.run.app/api"
EXPECTED_SUPABASE_URL="https://gadguyuxdxjmxtxnwlsv.supabase.co"

# Real phones: 64-bit and 32-bit ARM in one universal APK.
ABIS="arm64-v8a,armeabi-v7a"
OUT_DIR="${REPO_ROOT}/dist/android-release"

# --- What verify-apk.sh accepts (arrays, so that bash 3.2 can read them) ---------------------------
# The only permissions the release app may ask for. Each one is exact: a new one in a built APK is a
# FAIL until the owner decides to add it here. The owner approved blocking the template's
# SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE and WRITE_EXTERNAL_STORAGE in app.json (slice 2b), so
# they are NOT listed. RECORD_AUDIO is never allowed (SECURITY.md checklist: no microphone).
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

# The two audio files bundled into the app (assets/audio). React Native puts them in res/raw and
# turns '-' into '_', so the names are matched by these fragments.
BUNDLED_RAW_FRAGMENTS=("waves" "silence_3s")

# Patterns searched in EVERY file of the unpacked APK (extended regular expressions; the scan
# prints counts of files, never the matching text). The brackets keep this file from matching its
# own secret-literal rule in check.sh. A hit found on a real build that turns out to be a false
# positive (a library string) is reported to the owner, never removed quietly from this list.
BUNDLE_MUST_NOT_CONTAIN=(
  # keys and credentials
  "sk-an[t]-" "sb_secre[t]_" "service_rol[e]" "ey[J][A-Za-z0-9_-]{10,}\.ey[J]"
  "ELEVENLABS" "ANTHROPIC_API_KEY" "DATABASE_URL" "DIRECT_URL"
  "postgre[s](ql)?://" "-----BEGI[N]"
  # addresses of a development machine
  ":5432[1]" ":3000/ap[i]" "http://192\.168\." "http://10\." "http://172\." "http://127\." "localhos[t]"
)
# Fixed strings that must be present: the production API and Supabase addresses (config above).
BUNDLE_MUST_CONTAIN=("$EXPECTED_API_URL" "$EXPECTED_SUPABASE_URL")
