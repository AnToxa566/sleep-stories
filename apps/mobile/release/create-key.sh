#!/usr/bin/env bash
# Creates the release key of the Android app ONCE. The key is the identity of the app: a phone
# accepts an update only if it is signed with the same key as the installed app. So this script
# refuses to run when a key already exists.
#
# The key goes to KEYS_DIR (default ~/sleep-stories-keys), which must be outside the repository.
# The password is typed hidden and reaches keytool only through the environment variable
# SS_KS_PASS set on that one command: never an argument, never printed, never exported.
#
# Usage: bash apps/mobile/release/create-key.sh
#        DRY_RUN=1 bash apps/mobile/release/create-key.sh   (prints the commands, creates nothing)
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

p12="${KEYS_DIR}/${KEYSTORE_NAME}"
fp_file="${KEYS_DIR}/${CERT_FP_NAME}"
pw=""
trap 'unset pw' EXIT

require_outside_repo "$KEYS_DIR"
if [ -e "$KEYS_DIR" ] && [ ! -d "$KEYS_DIR" ]; then die "${KEYS_DIR} exists and is not a folder"; fi
if [ -d "$KEYS_DIR" ]; then
  for existing in "$KEYS_DIR"/*.p12; do
    if [ -e "$existing" ]; then
      die "a key already exists in ${KEYS_DIR}. It is the identity of the app: a second key would make every update impossible. Never make another one; restore the backup instead."
    fi
  done
fi
tool_paths keytool

umask 077

# English output, so that the lines read back below can be found.
kt_lang=(-J-Duser.language=en -J-Duser.country=US)
# PKCS12 keeps one password for the file and the key, so only -storepass is given.
gen_args=(-genkeypair -keystore "$p12" -storetype PKCS12 -alias "$KEY_ALIAS" -keyalg "$KEY_ALG"
  -keysize "$KEY_SIZE" -validity "$KEY_VALIDITY_DAYS" -dname "$KEY_DNAME" -storepass:env SS_KS_PASS)

if is_dry; then
  log "DRY_RUN=1: nothing is typed, nothing is created. The real run asks for the password twice (hidden)"
  log "and gives it to keytool in the variable SS_KS_PASS for this one command only."
  run mkdir -p "$KEYS_DIR"
  run chmod 700 "$KEYS_DIR"
  run "$KEYTOOL" "${kt_lang[@]}" "${gen_args[@]}"
  result_add "key file" SKIPPED "dry run"
  result_print "create-key"
  exit 0
fi

# The password is asked first: a wrong or mistyped one must leave nothing on disk.
read_secret_twice pw
mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"
SS_KS_PASS="$pw" "$KEYTOOL" "${kt_lang[@]}" "${gen_args[@]}" >/dev/null || {
  rm -f "$p12" # nothing existed before this run (checked above), so a half-made file is ours
  die "keytool could not create the key; nothing was kept"
}

# Read the certificate back: the SHA-256 fingerprint and the date are public data, not secrets.
cert_text="$(SS_KS_PASS="$pw" "$KEYTOOL" "${kt_lang[@]}" -list -v -keystore "$p12" -storetype PKCS12 \
  -alias "$KEY_ALIAS" -storepass:env SS_KS_PASS 2>/dev/null)" ||
  die "the key was created at ${p12} but could not be read back. Do NOT delete it and do not run this script again; ask for help."
unset pw
fingerprint="$(printf '%s\n' "$cert_text" | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -n 1)"
valid_until="$(printf '%s\n' "$cert_text" | sed -n 's/.*until:[[:space:]]*//p' | head -n 1)"
if ! [[ "$fingerprint" =~ ^([0-9A-F]{2}:){31}[0-9A-F]{2}$ ]]; then
  die "the key was created at ${p12} but its fingerprint could not be read. Do NOT delete it and do not run this script again; ask for help."
fi
printf '%s\n' "$fingerprint" >"$fp_file"

result_add "key file" PASS "$p12"
result_add "alias" PASS "$KEY_ALIAS"
result_add "valid until" PASS "$valid_until"
result_add "SHA-256 fingerprint" PASS "$fingerprint"
result_print "create-key"

cat <<'TEXT'

The key is made. Read this now, it is the one thing that cannot be redone.

1. Back up BOTH the file and the password, today.
   - Copy the WHOLE folder (the .p12 file and release-cert.sha256) to two places: a password
     manager attachment, and a cloud drive or a USB stick.
   - Keep the password in the password manager, not next to the file.

2. If the file or the password is lost: updates become impossible. The app has to be
   uninstalled and installed again with a new key, and she signs in again. Her queue and stories
   are on the server and survive; only the sign-in on the phone is lost.

3. If both leak: someone who has the file and the password could build an "update" that installs
   over her app. Keep them away from anyone else; never send them in a chat or an email.
TEXT
