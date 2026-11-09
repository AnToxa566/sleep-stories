// The picture on the system media control (the big square at the left of the card).
//
// expo-audio's native side turns `artworkUrl` into a java.net.URL and loads it. That accepts
// http(s) and file:// only. A bare string such as a drawable name ("icon_512") is a malformed URL:
// the whole `setActiveForLockScreen` call fails and the card disappears (seen on the first
// release build, 2026-11-09).
//
// A release build packs `require('...png')` into the APK as a drawable, and for such an image
// `Asset.fromModule` answers `localUri` = the bare drawable name with `downloaded` already true,
// so `downloadAsync` on it does nothing. The native copy (resource -> cache file) does handle a
// bare name, so a second, fresh `Asset` with the same descriptor is made to force that copy and
// its `file://` path is handed over. Not covered by unit tests (needs a device).
//
// Why `expo-asset` (owner-approved 2026-11-09): `expo-file-system` cannot read an APK asset.
import { Asset } from 'expo-asset';

const ARTWORK_SOURCE: number = require('../../../assets/images/icon-512.png');

let artworkUri: string | undefined;
let pending: Promise<void> | null = null;

// The only forms the native URL accepts. Anything else is dropped rather than risk the card.
export function isLoadableArtworkUri(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && /^(file|https?):\/\//.test(uri);
}

// Starts the copy (once). Never throws: no picture is not a reason to stop a night.
export function prepareLockScreenArtwork(): Promise<void> {
  if (artworkUri !== undefined) return Promise.resolve();
  pending ??= (async () => {
    const source = Asset.fromModule(ARTWORK_SOURCE);
    const fresh = new Asset({
      name: source.name,
      type: source.type,
      hash: source.hash,
      uri: source.uri,
    });
    const asset = await fresh.downloadAsync();
    artworkUri = isLoadableArtworkUri(asset.localUri) ? asset.localUri : undefined;
  })()
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
