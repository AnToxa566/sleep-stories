# Spike: background audio queue and the «Вы спите?» microphone check

Branch `spike/background-audio`. Throwaway code: `apps/mobile/src/spike/`. It answers `ARCHITECTURE.md` "Known open problems" item 1 (and informs item 2) for **`expo-audio` only (SDK 57, `expo-audio` 57.0.5)**. If `expo-audio` fails a test, switching to another library is the owner's decision, not part of this spike.

Nothing in this document is a result yet. The tables at the end are empty on purpose.

## What the test app does

One screen, dark, no design. **Start night** runs this flow:

1. Three local tracks play in a queue with lock-screen controls. **Short test set (the build currently installed):** about 11.6, 11.3 and 11.8 s, 35 s in total, so a full run takes about 1.5 minutes. The original **long set** (2:15, 2:03, 2:00; 6:18 in total) is kept in `apps/mobile/assets/spike-long/`; see "Short and long audio sets".
2. After the last track the pre-rendered prompt «Вы спите?» plays (about 1 s, a macOS system voice, not production TTS).
3. 500 ms after the prompt ends, a listening window opens (default 20 s). The first 2 s calibrate the ambient level (the 10th percentile of the samples, i.e. the quiet floor, so speech right at the start does not become "background"). After that, a level more than the threshold (default +12 dB) above ambient for at least the minimum duration (default 300 ms) in a row counts as an answer. Level only: no speech recognition, no network, and the recording file is deleted on stop.
4. **Answer:** an extra track (about 13 s in the short set, 25 s in the long set) plays. After 10 s of it the app switches the audio mode back from recording to playback.
5. **Silence:** nothing is playing at that moment, so to have something to fade, the app plays the same extra track and fades its volume to 0 over 10 s, then stops. This is a test device for the fade and stop, not product behaviour.

Switches on screen:

| Control | Values | Why |
|---|---|---|
| Запись (recording) | **в конце ночи** (end): audio mode switches to recording and the recorder starts when the window opens. **с начала ночи** (start): recording audio mode and a running recorder from the moment you tap Start night. | Questions 5 and 6 |
| Очередь (queue) | **по плееру** (sequential): one `AudioPlayer` per track, lock-screen controls active. **playlist**: `AudioPlaylist`. | See "Known limits" |
| Порог / Мин. длит. / Окно | threshold dB, minimum duration ms, window seconds | Question 4 |

## Build and install a development build

No `expo-dev-client` is installed (it would be a dependency beyond the two the spike allows). `expo run:*` produces a native build of this app, which is what the test needs. Expo Go cannot run it.

Use **Release** builds for the real runs: the JS bundle is inside the app, no Metro connection is needed, and lifecycle behaviour is closer to a real install. Debug builds are fine for iterating.

Flags below were checked with `npx nx run-ios mobile -- --help` and `npx nx run-android mobile -- --help`. The `--` is required: without it Nx reads `--configuration` as its own option.

### iPhone (physical)

Prerequisites: the full Xcode app installed and selected (`xcode-select -p` must not print `/Library/Developer/CommandLineTools`; if it does, run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`; when the spike was written this Mac had only the Command Line Tools, so the native iOS build could not be compiled there), an Apple ID added to Xcode (Settings → Accounts), the iPhone connected by cable, unlocked, trusted, Developer Mode on (Settings → Privacy & Security → Developer Mode). The bundle id is `com.antoxa.sleepstories.spike`; if your team already owns it, change `ios.bundleIdentifier` in `apps/mobile/app.json`.

```sh
npx nx prebuild mobile --platform=ios      # generates apps/mobile/ios (git-ignored)
npx nx run-ios mobile -- --device --configuration Release --no-bundler
```

`--device` with no value lists connected devices and asks you to pick one. If Xcode asks for a signing team, open `apps/mobile/ios/SleepStories.xcworkspace`, select the target → Signing & Capabilities → choose your team once, then rerun the command. First launch: Settings → General → VPN & Device Management → trust the developer.

Debug variant (needs Metro and the Mac on the same network): `npx nx run-ios mobile -- --device`.

### Android phone (physical)

Prerequisites: Android Studio with the SDK and a JDK (Android Studio's bundled JBR works: point `JAVA_HOME` at it; when the spike was written this Mac had no JDK, so the native Android build could not be compiled there), USB debugging on, the phone connected, `adb devices` lists it as `device`.

```sh
npx nx prebuild mobile --platform=android  # generates apps/mobile/android (git-ignored)
npx nx run-android mobile -- --device --variant release --no-bundler
```

`--device` with no value lists devices and asks you to pick. The release variant is signed with the debug keystore the Expo template generates, which is fine for a spike.

Debug variant: `npx nx run-android mobile -- --device`.

On first launch, allow the microphone and notification prompts when you tap Start night (both are requested in the foreground, on purpose). On Android 13+ without the notification permission the media controls and the recording notification may not show.

## Protocol

### Before every run (both platforms)

1. Record in the results header: phone model, OS version, battery saver / Low Power Mode state, whether battery optimisation is on for the app (Android: default is "optimised"; do not change it for the first pass).
2. Volume at a normal bedside level, no headphones, no Bluetooth, not in Do Not Disturb.
3. Open the app and tap **Clear log**.
4. Choose the switches for the run (below), tap **Start night**, accept permission prompts on the first run, then **lock the phone immediately** (side / power button).
5. Do not touch the phone until the run is over: short set: queue 35 s + prompt + 20 s window + extra track ≈ **1.5 minutes**; long set: queue 6:18 + the rest ≈ **7.5 minutes**. Exceptions are called out in the run.
6. Afterwards unlock, check the last log line is `[SUMMARY]`, tap **Share log** and save or send the file. On iOS it shares the file; on Android it shares the last 2000 lines as text. The full file stays on the phone as `spike-log.txt` in the app's document directory.

For answer runs, say "да, не сплю" in a normal voice about 1 m from the phone, **starting about 3 seconds after the prompt «Вы спите?» ends**, and talk for at least 1 second. The first 2 seconds of the window are used to measure the room's background level, so an answer given straight away is counted as background and will be missed (that would be the test's fault, not the phone's). In «в конце ночи» mode the window opens a little later than the prompt end because the recorder has to start first, so if the log shows `[DETECT] window start` late, wait for it. Do not speak before the prompt ends. For silence runs, stay quiet and keep the room quiet.

### Runs (repeat each on iPhone and on Android)

| Run | Recording | Queue | Behaviour | Answers |
|---|---|---|---|---|
| **R0** lock-screen | в конце ночи | по плееру | Not a full run: during track 1 only, wake the screen **without unlocking**, check the lock-screen card, press pause, wait 5 s, press play, drag the seek bar if there is one. Then unlock and tap **Stop**. | Q2 |
| **R1** end + answer | в конце ночи | по плееру | Full run, speak during the window. | Q1, Q3, Q4, Q5, Q6 |
| **R2** end + silence | в конце ночи | по плееру | Full run, stay silent. | Q3, Q4 |
| **R3** start + answer | с начала ночи | по плееру | Full run, speak during the window. | Q1, Q3, Q4, Q5, Q6 |
| **R4** start + silence | с начала ночи | по плееру | Full run, stay silent. | Q3, Q4 |
| **R5** noise | the recording mode that worked best in R1–R4 | по плееру | Full run with a TV (or radio / talk) on at normal volume in the room, **you stay silent**. Then repeat once with you speaking over the TV. | Q4 (and open problem 2) |
| **R6** playlist gap | в конце ночи | playlist | Full run. Lock-screen controls are not expected in this engine. | Q1 gap only |

Do R0 first, then R1 → R6. If R1 breaks (for example the app stops at the prompt), still do the others: the point is to see which combinations work.

### Per question: what to read and what counts

Log lines look like `2026-10-09T21:14:03.120Z +512345ms [TAG] message`. `+ms` is time since Start night. `app=background` in a line means the app was in the background when it was written. To copy only the interesting lines:

```sh
grep -E '\[(GAP|DETECT|ERR|MODE|REC|SUMMARY)\]' spike-log.txt
```

(or just attach the whole file).

**Q1. Does the 3-track queue keep playing in the background, and what is the gap between tracks?** Runs R1 (sequential gap) and R6 (playlist gap). Pass: all three tracks play to the end while locked; the `[TRACK]` lines for tracks 2 and 3 show `app=background`; no unexpected `playing=false`. Copy: all `[TRACK]` and `[GAP]` lines, any `[ERR]`. Also note by ear: was there an audible silence between tracks, roughly how long? The `[GAP]` value is measured on the JS clock and can be delayed in the background, so treat it as an upper-ish estimate; the playlist figure includes up to 100 ms of status-update interval. If the log shows no `[HEARTBEAT]` for much longer than 15 s while locked, JS was suspended and the numbers are unreliable: say so.

**Q2. Do lock-screen controls appear and work?** Run R0. Pass: card shows title «Тест 1» and artist; pause and play work; the track keeps going after play. Copy: the `[TRACK] lock screen active` lines, any `[ERR]`, and the `playing=false` / `playing=true` lines around your presses. Note what the card shows. `expo-audio` offers play/pause and optional seek forward/back only; next/previous are not offered, so absence of them is expected.

**Q3. After the last track, can the app play the prompt and then open the microphone and read levels for 20 s, screen locked, without touching the phone?** Runs R1, R2, R3, R4. Pass: `[TRACK] prompt finished`, then `[DETECT] window start`, then `[METER]` lines every ~250 ms for the whole window, with `app=background`, and no `[ERR]`. Copy: every line from `queue ended` to `[DETECT] result`, and `[HEARTBEAT]` lines in that stretch. Also copy every `[TIMER]` line. Failure shapes to record exactly: the app never reaches the prompt (last line is `queue ended` or earlier), the prompt plays but no `window start` appears, `window start` appears but `[METER] no metering value` lines instead of samples, or an `[ERR]` (copy its full text).

**Q4. Is a spoken answer detected, and does playback then continue? Does silence fade out and stop?** Answer runs R1 and R3, silence runs R2 and R4, noise run R5. Pass for answer: `[DETECT] result: answer` with a plausible `ambient` and `peak`, then `extra track play()` and the extra track plays to the end. Pass for silence: `[DETECT] result: silence`, then a `fade volume=` sequence from about 1.00 down to 0.00 (the first line is logged after the first 250 ms step), `fade finished after ~10000ms`, then stop. Copy: all `[DETECT]` lines, the `[METER]` lines of the window (they show the level that triggered or missed), the `fade` lines, and `[SUMMARY]`. For R5 also write down: did the TV alone trigger a false answer (`result: answer` while you were silent)? Did your voice over the TV still trigger? Which threshold would have worked? You can change the threshold on screen between runs. Metering scales differ by platform (iOS: average power in dBFS, Android: peak amplitude converted to dB), so compare `ambient` and `peak` per platform and do not assume the same threshold works on both.

**Q5 (iOS only). Does enabling recording change the audio route or volume, and must it be on from the start?** Compare R1 (recording enabled at the end) with R3 (recording enabled from the start). Nothing in the API reports route or volume, so this is by ear:
- In R3 the tracks and the prompt play with recording already enabled. Are they quieter or coming from the earpiece than in R1, where they play in the normal playback mode?
- In R1 the extra track plays while recording mode is still on, and 10 s into it the app switches back to playback mode (`[MODE] restored playback mode while the extra track is playing`). Did the sound change at the switch (louder, speaker change)? Did the extra track sound different from the earlier tracks in the same run?
- In R1, did the switch to recording while locked work at all (`[MODE] "recording (end of night)" applied` followed by `[REC] record() called`), or did it fail (`[ERR]`)?
Copy: all `[MODE]` and `[REC]` lines, plus your listening notes with the `+ms` time you noticed a change.

**Q6 (Android only). Can the recording foreground service start while the app is in the background, and does starting the recorder at the start of the night work around it?**
- R1 (recording enabled at the end): look for `[REC] start recorder (end of night) app=background` and then either `record() called ... isRecording=true` or an `[ERR]` (Android 14+ is expected to refuse with a `SecurityException` or `ForegroundServiceStartNotAllowedException`; copy the full text).
- R3 (recording from the start): the recorder is started in the foreground. Pass: `[REC] record() called ... isRecording=true` at the start, a persistent "recording" notification appears, `[HEARTBEAT]` lines through the night show `isRecording=true`, and metering works in the window. Note the notification text and whether it can be dismissed. Note the battery drain over the run if you can see it.
Copy: every `[REC]` and `[ERR]` line, and the Android version.

### What to send back

For each run: the shared log file, the run id (R0–R6), platform, and your by-ear notes (gap, route, volume, anything strange, lock-screen card contents). Fill in the tables below; leave cells blank rather than guessing.

## Finding from the first Android run: JS timers stop in the background

On the first real Android run (Android 16, build with the short stories) the queue and the prompt worked with the screen locked, but after «Вы спите?» finished the log said `listening starts in 500ms` and then nothing happened for 44 s, until the screen was woken: the 500 ms `setTimeout` did not fire in the background, and the 15 s heartbeat only ever logged with `app=active`. Native player events kept reaching JS (tracks chained from the background with gaps of about 100–140 ms). So the spike now runs every deadline (the 500 ms delay, 100 ms metering poll, window end, fade, mode restore, heartbeat) from a scheduler that is driven by native player status updates, with a silent looping "metronome" player running from the moment the prompt ends until the extra track starts. A real player must not rely on `setTimeout`/`setInterval` for anything that has to happen with the screen off. Read the `[TIMER]` lines in the next logs:
- `[TIMER] scheduler is being driven by native player events while app=background` is the proof the workaround ran in the background.
- `[TIMER] job "..." ran Nms late` shows how late a deadline was.
- `[TIMER] metronome play() called` / `metronome paused`: the metronome's lifetime. If the extra track does not start after the listening window with the screen locked, send the log anyway.

## Finding from the second Android run: recording started in the background captures silence

With the scheduler fix (Android 16, mode «в конце ночи», screen locked, nobody touching the phone), the whole flow ran in the background: the prompt, the audio-mode switch to recording, `prepareToRecordAsync` and `record()` all returned without error (`isRecording=true`), the listening window ran, the extra track played and the fade ran, and the 15 s heartbeat logged in the background. But the microphone returned **-160 dB (digital silence) for the entire 10 s window** (97 of 97 samples), so the "silence" result is not real. In the earlier runs, where the same recorder was started with the app in the foreground, the levels were real (-11 to -50 dB). This is consistent with Android's rules for background microphone use: a microphone foreground service cannot be started while the app is in the background, and an app without one is given silence instead of audio. `expo-audio` catches the failure when it cannot start its recording foreground service and only writes it to the console (`Failed to start the expo-audio foreground service for background recording`), so `record()` still looks successful. The spike now mirrors `console.error` and `console.warn` into the log as `[ERR] console.error: ...` so the next logs show it directly. Until a log shows that line, the cause is inferred, not observed.

Consequence for the product (to be confirmed by run R3, mode «с начала ночи»): the recorder session has to be started while the app is in the foreground, at the beginning of the night, and kept running all night. Run R3 is the decisive one.

## Short and long audio sets

The assets in `apps/mobile/assets/spike/` are a **short set** (three stories of about 11 s, an extra of about 13 s) so that the logic can be tested in a minute and a half. A short set **cannot answer Q1** ("keeps playing for 6+ minutes locked", Android's cut-off after about 3 minutes, Doze behaviour, battery). Once the flow works, do at least one long run per platform: copy the four files from `apps/mobile/assets/spike-long/` over `story-1.m4a`, `story-2.m4a`, `story-3.m4a`, `story-extra.m4a` in `apps/mobile/assets/spike/`, rebuild the app (`npx nx build mobile --platform=android --profile=preview`), and record the results as the Q1 evidence. `prompt.m4a` is the same in both sets.

## Known limits of this spike (read before judging results)

- **R6 on Android is expected to stop after about 3 minutes** (during track 2 of the long set; the short set is too short to show it, so the 3-minute cut-off is only testable with the long set). `expo-audio` documents that on Android background playback is cut after roughly 3 minutes unless lock-screen controls are active, and the playlist engine has none. Read R6 on Android as "gap measured until playback stopped", and do not count the stop as a playlist or gap failure; it is itself the evidence that the playlist engine cannot be used for a locked night on Android without lock-screen support. On iOS the same engine has no `keepAudioSessionActive` option, so it may also lose the audio session between tracks; note it if the playlist stops.
- All `AudioPlayer`s are created with `keepAudioSessionActive: true`. Without it `expo-audio` on iOS deactivates the audio session 100 ms after any player finishes, without looking at the recorder, which would stop a running recorder in the "с начала ночи" mode and make recording fail from the background in the "в конце ночи" mode. A real player would need the same setting; that is a finding of its own.
- Force-quit the app between runs. Players are released and the recorder is stopped at the end of a night, but a clean process removes any doubt about leftover Android media sessions.
- **`AudioPlaylist` has no lock-screen API in `expo-audio` (checked in 56 and again in 57.0.5)** (checked in the installed types and native sources: `setActiveForLockScreen` exists only on `AudioPlayer`). That is why the default queue is one `AudioPlayer` per track, started from the previous track's finish event. That engine is **not** gapless by design; its gap is what Q1 measures for "players in a chain". The playlist engine (R6) measures the gapless case but has no lock-screen controls. The honest answer to "gapless queue plus lock-screen controls" may be "not both with `expo-audio` (56 and 57)", and R0/R6 are there to show it.
- Gap values come from JS timestamps. They are approximate and can be delayed in the background.
- The recorder writes a low-quality file only so that metering exists. The spike deletes it after the window. A real feature should not need a file; that is a finding for the player design, not something solved here.
- "Recording from the start" means the recorder is actively recording all night. The variant "audio session in recording category but recorder idle" is not tested; add a run if the results suggest it.
- Android metering is `MediaRecorder.getMaxAmplitude()` (peak since last read) converted to dB; iOS is `AVAudioRecorder.averagePower`. They are not the same quantity.
- Vendor battery managers can kill audio regardless of API. Record the phone make.
- No Do Not Disturb handling, no speech recognition (that is open problem 2's possible follow-up), no backend.

## Results (to be filled in by the owner)

### Devices

| | iPhone | Android |
|---|---|---|
| Model | | |
| OS version | | |
| Low Power Mode / battery saver | | |
| Battery optimisation for the app | n/a | |
| Build | Release / Debug | Release / Debug |

### Question × platform

| # | Question | iOS pass/fail | iOS observations | Android pass/fail | Android observations |
|---|---|---|---|---|---|
| 1 | 3-track queue keeps playing locked; gap between tracks (sequential engine, and playlist engine in R6) | | | | |
| 2 | Lock-screen controls appear and work | | | | |
| 3 | Prompt plays, then microphone opens and levels read for 20 s, locked, untouched | | | | |
| 4a | Spoken answer detected, then one more track plays | | | | |
| 4b | Silence leads to a 10 s fade-out and stop | | | | |
| 4c | Background noise (TV): false answers? answer still detected over noise? | | | | |
| 5 | iOS only: recording changes route or volume? Needed from the start of the night, or can it be switched on at the end while locked? | | | n/a | n/a |
| 6 | Android only: recording foreground service can start in the background? Does starting the recorder at the start of the night work around it? | n/a | n/a | | |

### Run log

| Run | Platform | Date | Pass / fail | Log file | Notes |
|---|---|---|---|---|---|
| R0 | iOS | | | | |
| R0 | Android | | | | |
| R1 | iOS | | | | |
| R1 | Android | | | | |
| R2 | iOS | | | | |
| R2 | Android | | | | |
| R3 | iOS | | | | |
| R3 | Android | | | | |
| R4 | iOS | | | | |
| R4 | Android | | | | |
| R5 | iOS | | | | |
| R5 | Android | | | | |
| R6 | iOS | | | | |
| R6 | Android | | | | |

### Recommendation (owner)

Library: _______________ (the decision between `expo-audio` and `react-native-track-player` belongs to the owner.)

Recording strategy: _______________

Open problem 2 (speech vs other sounds): level-only is enough / needs a local recognition step because: _______________
