# Android release: the runbook

This folder builds the app as one installable file (an APK), signs it with the app's own key, and checks it before it goes to a phone. Everything runs on the owner's Mac. There is no cloud build and no store.

The scripts here were checked offline (`check.sh`) and by one real build with a throwaway key. The real key and the real APK have not been made yet. Nothing in this file says that a release exists.

Why it is built this way: `ARCHITECTURE.md` section 12, the bullet "The release APK". The threat model row is in `SECURITY.md`.

## In plain words

**The APK.** It is the app as one file. Think of the zip you get from `npm run build` for a website: everything the app needs is inside, and you hand that one file to the phone.

**The signing key.** Android installs an update over an installed app only if the update is signed with the same key as the installed one. Different key, different app: the phone refuses.

An analogy from your world. It works like an SSH host key. If the server shows a new key, `ssh` stops with `REMOTE HOST IDENTIFICATION HAS CHANGED` and does not connect. Android does the same for apps. It also resembles the private key of a TLS certificate: whoever holds it can speak as the owner of the name.

**What the key looks like.** One small binary file, `sleep-stories-release.p12` (about 3 KB). It is not text, so you cannot read it or paste it into a chat. It is protected by a password. File and password together are the key.

**"Signing".** It is not a drawn signature. The tool computes a mathematical stamp from the content of the APK and the private key. Change one byte of the APK afterwards and the stamp no longer fits, so the phone refuses the file.

**What happens if you lose the file or the password (and have no backup).**
- You can never update the installed app again.
- The only way out: uninstall the app, make a new key, install the new APK. She signs in again.
- Her stories and queue are on the server and survive. Only the sign-in on that phone is lost.

**What happens if both the file and the password leak.** Someone who has both can build a fake "update" that installs over her app and sees what the app sees. Keep them apart, and never send either in a chat or an email.

**Where things live.**
- The key and its record live in `~/sleep-stories-keys`. This folder is OUTSIDE the repository on purpose, and the scripts refuse to use a folder inside any git project. The git ignore rules cover key file types as a second guard.
- The APK lands in `dist/android-release/` in the repository (git-ignored).
- The Supabase publishable key (asked once) is saved in `apps/mobile/.env.production` (git-ignored, readable only by you).

## What you do, in order

### 1. Once: make the key

```sh
bash apps/mobile/release/create-key.sh
```

1. The script asks for a password twice. Typing is hidden: nothing appears on the screen, not even dots. That is normal. This is the first time this prompt is used for real, so check that nothing shows while you type.
2. Choose a long random password from your password manager: at least 12 characters, letters, digits and signs, ASCII only, no spaces.
3. Save the password in the password manager right away.
4. The script prints a RESULT block (key file, alias, valid-until date, the SHA-256 fingerprint of the certificate, which is public data).
5. Back up TODAY. Two different things go to two different places (one rule, the same in the script's closing text and in `SECURITY.md`):
   - **The password** goes into the password manager, and nowhere else.
   - **The key folder** `~/sleep-stories-keys` (the `.p12` file, `release-cert.sha256`, and later `releases.log`) is copied to a cloud drive AND to a USB stick. Do NOT put it into the password manager next to the password.

   Why: whoever has both the file and the password can sign "updates" that install over her app. Keep the two apart. Never copy the folder into the repository.
6. Copy the folder AGAIN after every release, because `releases.log` grows. If the log is ever lost, `android.versionCode` in `apps/mobile/app.json` (it is in git) tells you the last number: raise it above that.

If only one of the two is lost:
- the file is lost, the password is known: restore the folder from the cloud drive or the USB stick;
- the password is lost, the file is there: the file cannot be opened and is useless; treat the key as lost (see "What happens if you lose the file or the password" above);
- both are lost: the key is lost.

If you do nothing about the backup: the day the Mac dies, the app cannot be updated.

The script refuses to run when the keys folder is not empty: a `.p12` file (even one renamed to `.bak` or moved aside), `release-cert.sha256`, `releases.log` or anything else counts as "a key may already exist". That is on purpose: a second key would make every update impossible. If you ever need the key back, put the renamed file back or restore the folder from the backup. It also refuses a `KEYS_DIR` setting that is empty (set to nothing), relative, `/`, or your whole home folder (an existing folder with nothing inside is fine: that is exactly where a key may be made), and it never overwrites `release-cert.sha256`.

### 2. Each release: build

First commit everything (including any change to this folder). The build refuses a project with uncommitted changes, because the file name carries the commit id.

```sh
bash apps/mobile/release/build-release.sh
```

In order, the script:

1. Checks the tools (Android Studio's Java, the Android SDK build tools).
2. Checks the project is committed.
3. Checks the version number is higher than the last release (see step 3 below).
4. Checks the key exists.
5. Asks for the Supabase publishable key, only if `apps/mobile/.env.production` does not exist yet:
   - Open the Supabase dashboard, your project, Project Settings, API Keys, "Publishable key".
   - It starts with `sb_publishable_`.
   - It is public by design, like `NEXT_PUBLIC_SUPABASE_ANON_KEY` in a Next.js site. It ends up inside the app anyway.
   - NEVER paste the "Secret key" (the one that starts with the word secret). The script refuses it.
   - Typing is hidden. The script saves it in the git-ignored file and does not ask again.
6. Asks for the key password once (hidden) and checks it at once with `keytool`. A wrong password stops everything before the long build.
7. Regenerates the native Android project from `app.json` (the `apps/mobile/android` folder is generated and git-ignored).
8. Builds the release app with Gradle. This is the long step: the script says 10 to 15 minutes. The log is `dist/android-release/build.log`; follow it with `tail -f` in a second terminal. The production addresses are passed explicitly and Expo is told to read no `.env` file, so no address of your dev machine can get into the app. Gradle never sees the key or the password.
9. Aligns the file (if needed) and signs it with the release key. The password goes to the signing tool through standard input, never as an argument. The file Gradle made is signed with Android's public debug key, and the aligned copy is unsigned: the script deletes both when it ends, whether it succeeded or failed (also after Ctrl-C). One exception: if you press Ctrl-C exactly while the signing tool is writing, a half-written `sleep-stories-*.apk` can remain in `dist/android-release/`. Android cannot install it; delete it and run the build again.
10. Runs `verify-apk.sh` on the result (see "Checking an APK" below). Only a pass of a clean build is recorded.

What you get:
- The APK: `dist/android-release/sleep-stories-<version>-vc<code>-<commit>.apk`. Example shape: `sleep-stories-1.0.0-vc1-0123456789ab.apk`.
- A line in `~/sleep-stories-keys/releases.log`: date, version, versionCode, commit, SHA-256 of the APK, SHA-256 of the certificate. It holds no password. The script uses it to refuse a versionCode that is not higher.
- A RESULT block in the terminal. This is what you paste back (see the last section).

You can see every command first, without running anything: `DRY_RUN=1 bash apps/mobile/release/build-release.sh`.

### 3. Each update: raise the number

Android refuses an update whose `versionCode` is not higher than the installed one. Think of it as the build number of a deploy: it only goes up.

1. In `apps/mobile/app.json` raise `android.versionCode` by 1 (1, 2, 3, ...).
2. Commit.
3. Run `bash apps/mobile/release/build-release.sh` again.

`version` (for example `1.0.0`) is the name a person sees. It may stay or change. Only `versionCode` decides whether the phone accepts the update.

The script refuses a dirty tree and a versionCode that is not higher, and says so in plain words (see "When something fails").

## Installing

### On your own phone

1. Turn on USB debugging: Settings, About phone, tap "Build number" 7 times, then Developer options, USB debugging. Plug in the cable and allow the computer on the phone.
2. Remove any older debug build first. A debug build and a release build are different identities (different keys) and cannot update each other: `adb` refuses with an "update incompatible" error. The older development build used another app id (`com.antoxa566.mobile`) and is simply a different app; remove it too, or you will have two icons.
3. Install. The build script prints this exact command at the end:

```sh
"$HOME/Library/Android/sdk/platform-tools/adb" install -r dist/android-release/<the file>.apk
```

`-r` means "replace the installed app, keep its data". For a first install it is harmless.

### On your wife's phone

1. Send the file as a FILE, not as a picture or a link preview: Telegram "send as file", or a Google Drive link. Do not zip it.
2. She opens it. Android asks to allow "Install unknown apps" for the app she opened the file from (Telegram, Drive, Files). She switches it on for that app, once.
3. Play Protect (Google's scanner) may say the app is unknown or not scanned. She taps "More details", then "Install anyway". This is normal for an app that is not from the Play Store.
4. THE FIRST APK SHE EVER GETS MUST BE A RELEASE BUILD (from this folder). A debug build, or a build signed with another key, cannot be updated by the release one. She would have to uninstall and sign in again.
5. Updates later: send the new file, she installs it over the old app. The key is the same and the versionCode is higher, so the app is replaced and she stays signed in.

### About Google's developer verification (not checked)

Google has announced that apps installed outside the Play Store on certified Android phones will need a verified developer. The announcement said the rollout starts in some countries from September 2026 and goes wider later, and that installing with `adb` is exempt. This was not re-checked when this file was written, so treat it as a rumour you must verify.

Before the first install on her phone, read Google's current page about developer verification for sideloaded apps. If a phone refuses the file, `adb` from your Mac is the fallback.

## Checking an APK

```sh
bash apps/mobile/release/verify-apk.sh <path to the apk>
bash apps/mobile/release/verify-apk.sh <path to the apk> <versionName> <versionCode>
```

Run alone with only the path, it PRINTS the version name and code of the file but does not compare them with anything. The comparison with `app.json` happens only when the two extra values are given: `build-release.sh` passes them, and for a manual check you pass them yourself (for example `1.0.0 1`).

It only reads the file; it changes nothing. It prints one line per check, then a RESULT block, and exits with an error if any line is FAIL. After a FAIL it adds a list called "What the failures mean". It also needs the fingerprint file `~/sleep-stories-keys/release-cert.sha256` (made by `create-key.sh`; public data) to compare the signature with.

What the groups of lines mean:

- **Signature.** The signature is valid. There is exactly one signer. The signer is the release key (its fingerprint equals the one recorded when the key was made). It is not Android's public debug key.
- **Package facts.** The app id is `com.antoxa566.sleepstories`. The version name and code match `app.json`. The app is not debuggable (a debuggable app lets anyone with a cable read its data). Native code for both phone CPU families: `arm64-v8a` (modern phones) and `armeabi-v7a` (older 32-bit ones).
- **Permissions.** Android apps must declare what they use. The list is read twice, from two different outputs of the tool (the parsed list and the raw manifest). If nothing can be read, if the internet permission is missing, or if the two counts differ, the line is a FAIL: an empty reading is never "0 permissions, fine". The list in `config.sh` is exact, and a new permission in a built APK is a FAIL until the owner decides to add it. Allowed: internet, a foreground service for playback (and its media-playback type), changing audio settings, vibration, keeping the CPU awake while playing, reading the network state, and the app's own receiver permission. `RECORD_AUDIO` (the microphone) is never allowed and has its own line.
- **Manifest.** The manifest is the app's ID card. There is no development launcher (a screen that lets a user type any server address). Cleartext (plain `http`) traffic is not allowed: if the setting is present its value must be literally `false` (a `true`, a reference or an unreadable value is a FAIL). A network security config (a file that can re-allow plain `http` for chosen servers) is a FAIL if present, because nothing in this app needs one. If the tool's output cannot be read at all (no application line, no manifest), the lines say so and FAIL; nothing is assumed. Backup is off, so Android does not copy the app's saved session into a cloud or `adb` backup.
- **Alignment.** The file is laid out the way Android expects, including for 16 KB memory pages.
- **Bundle scan.** The script unpacks the APK in a temporary folder and searches EVERY file. It counts the files that contain each forbidden pattern; on a hit it prints the count and at most three file paths, never the matching text. Forbidden patterns:
  - the prefix of an Anthropic key, the word for a Supabase service-role key, and strings shaped like a JWT;
  - the names of server settings: the ElevenLabs name, the Anthropic key setting, the database settings;
  - a database connection address and a private-key block header;
  - addresses of a development machine: the local Supabase port, the local API address, and `http://` addresses in private networks.

  It also requires that the two production addresses (the API and Supabase) ARE present. If the app had the wrong ones it would talk to the wrong server or none.
- **Bundled audio.** The two audio files inside the app (waves and the 3-second silence) are there.
- **Size and hash.** Information only.

Deliberate omissions, so nobody wonders later:
- The word `localhost` is NOT scanned. React Native and libraries contain dead default strings such as `http://localhost:8081`, so it only gives false hits.
- The text of the Supabase secret-key prefix is NOT scanned. The Supabase client library (`@supabase/*`, for example the `functions-js` and `supabase-js` files) itself contains that prefix text, and in a Hermes bundle (the app's compiled JavaScript) it can end up next to any other string, so the scan gave false hits. The protection is elsewhere: the app only accepts a key that starts with `sb_publishable_`, and `build-release.sh` refuses a secret key before building.

Six permissions are blocked in `apps/mobile/app.json` (`android.blockedPermissions`) so that libraries cannot add them:
- microphone (`RECORD_AUDIO`): the app never listens;
- drawing over other apps (`SYSTEM_ALERT_WINDOW`): unused;
- reading and writing shared storage (`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`): unused;
- biometrics (`USE_BIOMETRIC`, `USE_FINGERPRINT`): `expo-secure-store` brings them in, but the app never asks for a fingerprint.

If `verify-apk.sh` says FAIL on a built file, do not install it.

## When something fails

Every script stops with one `ERROR:` sentence. Nothing is half-done unless the sentence says so.

**create-key.sh**
- "a key, or the record of one, already exists in ...": the keys folder is not empty. You already made the key (or a copy of it is there under another name). Never make another. Put the renamed file back, or restore the backup if the folder is gone.
- "the keys folder must be a full path", "cannot be the root folder", "cannot be your home folder itself", "KEYS_DIR is empty", "HOME is not set": the folder named in `KEYS_DIR` is not acceptable. Unset `KEYS_DIR` to use the default `~/sleep-stories-keys`.
- "git was not found": the script cannot check that the keys folder is outside every project without git. Install git.
- "the keys folder is inside this repository" or "inside a git work tree": `KEYS_DIR` points into a project. Use the default `~/sleep-stories-keys`.
- "the two entries differ": you typed the password differently twice. Run again; nothing was created.
- "the password must be at least 12 characters ...": choose a longer one without spaces or non-ASCII letters; nothing was created.
- "keytool was not found": Android Studio is missing or in another place. See the tools list below.
- "keytool could not create the key; nothing was kept": nothing exists on disk. Run again.
- "the key was created ... but could not be read back" or "its fingerprint could not be read": the key file EXISTS. Do NOT delete it and do not run the script again. Ask for help.

**build-release.sh**
- "commit or stash these changes first": uncommitted changes in `apps/mobile`, `packages/contracts`, `package.json` or the lockfile (up to 10 paths are shown). Commit, then run again. Changes elsewhere (docs, API) do not block.
- "android.versionCode is N, but a build with M was already made": raise `android.versionCode` in `apps/mobile/app.json` to the number the message gives, commit, run again.
- "apps/mobile/app.json must have a version like 1.0.0 and android.versionCode ...": fix those two fields.
- "the release key was not found in ...": run `create-key.sh` first.
- "the env file ... cannot be used: ...": the file `apps/mobile/.env.production` has a problem, and the sentence names the line number (never the content). The rules: only the three `EXPO_PUBLIC_` names; plain characters; the key must start with `sb_publishable_`; a URL must be the production https address. The easiest fix is to delete the file and run again; it asks for the key once more.
- "this is the SECRET key": you pasted the wrong key. Use "Publishable key".
- "... there is no terminal to ask for the Supabase publishable key": run the script in a real terminal window.
- "the key password is wrong": nothing was built. Type it again. The password is the one from `create-key.sh`.
- "the Android project could not be generated" (see `dist/android-release/prebuild.log`) or "the generated Android project does not use the app id": check `android.package` in `app.json`.
- "the Gradle build failed ... Nothing was signed": read the last lines it printed, then `dist/android-release/build.log`. The first real build may reveal an environment problem (Java, SDK, memory); paste the last lines back.
- "the build changed files that are tracked by git": the build edited a tracked file. Look at `git status`, undo the change, run again.
- "apksigner could not sign the file": nothing was kept as a release; the half-made file, the debug-signed file Gradle made and the aligned copy are deleted.
- "verify-apk.sh did not pass": the file was renamed `<name>.apk.FAILED` so it cannot be installed by mistake. Read the list "What the failures mean", fix the cause, build again. NEVER install a `.FAILED` file.
- "RELEASE_ALLOW_DIRTY must be exactly 1": that setting exists only for the script's own tests. A real release never uses it. A build made with it gets `-dirty` in its name, is not recorded in `releases.log` and must never be installed.
- "DRY_RUN must be unset, 0 or 1": use exactly `DRY_RUN=1`.

**Missing tools** (the messages say which one):
- Android Studio's Java ("Java was not found at ..."): install Android Studio. The scripts use the Java inside it.
- The Android SDK ("the Android SDK was not found"): open Android Studio once so that it installs the SDK.
- "apksigner / zipalign / aapt2 was not found ...": in Android Studio open SDK Manager, SDK Tools, tick "Show Package Details", and install "Android SDK Build-Tools 36.1.0".
- Docker is NOT needed for any of this.

**Offline check.** `bash apps/mobile/release/check.sh` needs no network, no Android Studio build and never touches the real key folder. It tests the scripts with throwaway folders and stub tools: syntax, that no password can be an argument, be printed or be exported, that no secret-looking text or email address is in this folder, that the git ignore rules for key files are in place, that every dry run runs nothing, and that each refusal above happens before any later step. The last line must be `mobile release check: OK`. It proves the scripts behave as designed. It does not prove that a real APK is good: only a real build plus `verify-apk.sh` does that.

## First things to try on the phone

These were never verified on a device (`ARCHITECTURE.md` section 11 item 1 and section 7). A failure here is information about code that was never run on a phone, not a regression.

1. Install the APK. Sign in against production.
2. Kill the app and open it again. You must still be signed in.
3. Go through onboarding.
4. On «Сегодня», try the queue gestures: drag by the handle, swipe to remove, the item menu.
5. Start ONE explicit generation. It costs real money (one of the 5 allowed per 24 hours).
6. Open the player: play, move the slider, tap «Дальше», use previous.
7. Turn the screen off. The audio must keep going past 3 minutes, and then past 6 minutes.
8. Let the first story end with the screen off. The next story must start by itself.
9. On the lock screen: the control shows the story title, and play, pause and scrub work.
10. At the end of the night the waves play. A tap continues the night.
11. Install a second APK with `versionCode` 2 over the first (step 3 above). The app must be replaced, and you must stay signed in.

## What to paste back to the chat

Paste only the RESULT blocks (from `create-key.sh`, `build-release.sh`, `verify-apk.sh`). They hold names, versions, PASS or FAIL and public fingerprints.

NEVER paste a password, the key file, the contents of `apps/mobile/.env.production`, or the output of a command you are unsure about.

## Notes for later

- The build uses the Nx executor `@nx/expo:prebuild`. It is deprecated and will be removed in Nx 24. When Nx is upgraded, the call in `build-release.sh` will need a replacement.
- iOS and the Play Store are not planned.
- If EAS cloud builds are ever used, their version codes must start above every local one in `releases.log`, and EAS would need the same key (or the app would have a second identity).
