// The picture on the system media control (the big square at the left of the card).
//
// expo-audio's native side loads `artworkUrl` with java.net.URL, which reads http(s) and file://
// but not a resource packed into the APK. A release build packs `require('...png')` into the APK,
// so the picture is copied once to the app cache by `Asset.downloadAsync` and its file:// path is
// handed over. Not covered by unit tests (needs a device); the phone check exercises it.
//
// Why `expo-asset` (owner-approved 2026-11-09): `expo-file-system` cannot read an APK asset.
// Cost: one more declared dependency (already installed through `expo`).
import { Asset } from 'expo-asset';

const ARTWORK_SOURCE: number = require('../../../assets/images/icon-512.png');

let artworkUri: string | undefined;
let pending: Promise<void> | null = null;

// Starts the copy (once). Never throws: no picture is not a reason to stop a night.
export function prepareLockScreenArtwork(): Promise<void> {
  if (artworkUri !== undefined) return Promise.resolve();
  pending ??= Asset.fromModule(ARTWORK_SOURCE)
    .downloadAsync()
    .then((asset) => {
      // In a debug build `localUri` can still be the Metro http address; both forms load.
      artworkUri = asset.localUri ?? undefined;
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

// Synchronous: the engine builds its metadata at the moment a story starts. Undefined until the
// copy has finished, in which case the system shows its own placeholder.
export function lockScreenArtworkUri(): string | undefined {
  return artworkUri;
}
