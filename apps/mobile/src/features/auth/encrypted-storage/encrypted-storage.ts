// Supabase-compatible async storage that keeps the session encrypted at rest.
//
// Why two places: the session JSON (access token, refresh token, user) is several KB,
// above SecureStore's ~2 KB value limit, so it cannot live in SecureStore. Instead each
// write encrypts the JSON with a fresh AES-256-GCM key, puts the sealed blob in a file in
// the app's document directory and keeps only the 32-byte key in SecureStore (Keychain /
// Android Keystore-backed). The file alone is useless without the key, and the key alone
// is useless without the file. Cost: two writes per save, so a crash between them leaves
// an undecryptable blob, which reads as "signed out" (see getItem), never as a wrong session.
//
// This module is pure: the real Expo dependencies are wired in expo-storage-deps.ts, and
// tests pass fakes. Nothing here logs; values and key material never leave this module
// except as the decrypted string returned to Supabase.

export type CryptoPort = {
  // A new random AES-256 key, base64.
  generateKey(): Promise<string>;
  // Seals UTF-8 text; returns base64 of iv + ciphertext + tag.
  encrypt(keyBase64: string, plaintext: string): Promise<string>;
  // Opens a sealed blob; must throw when the key or the data is wrong or was tampered with.
  decrypt(keyBase64: string, sealedBase64: string): Promise<string>;
};

export type KeyStorePort = {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
};

export type BlobStorePort = {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  delete(name: string): Promise<void>;
};

export type EncryptedStorageDeps = {
  crypto: CryptoPort;
  keyStore: KeyStorePort;
  blobStore: BlobStorePort;
};

export type AsyncStringStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// SecureStore accepts only letters, digits, ".", "-" and "_" in a key. File names are
// restricted the same way so the logical key maps safely to both.
const ALLOWED_KEY = /^[A-Za-z0-9._-]+$/;

const KEY_SUFFIX = '.aeskey';
const FILE_SUFFIX = '.enc';

export function createEncryptedStorage({ crypto, keyStore, blobStore }: EncryptedStorageDeps): AsyncStringStorage {
  // Operations run one at a time: a write is two steps (file, key), and interleaving two
  // writes could leave a file sealed with one key next to the other's key.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  function names(key: string): { keyName: string; fileName: string } {
    if (!ALLOWED_KEY.test(key)) {
      // Never include the key in the message: callers pass fixed names, so this is a bug, not data.
      throw new Error('Invalid storage key');
    }
    return { keyName: `${key}${KEY_SUFFIX}`, fileName: `${key}${FILE_SUFFIX}` };
  }

  async function wipe(keyName: string, fileName: string): Promise<void> {
    // Both deletions are attempted even if the first fails.
    await Promise.allSettled([keyStore.delete(keyName), blobStore.delete(fileName)]);
  }

  return {
    getItem(key) {
      return serial(async () => {
        const { keyName, fileName } = names(key);
        try {
          const [keyBase64, sealed] = await Promise.all([keyStore.get(keyName), blobStore.read(fileName)]);
          if (keyBase64 === null || sealed === null) {
            await wipe(keyName, fileName);
            return null;
          }
          return await crypto.decrypt(keyBase64, sealed);
        } catch {
          // Missing half, tampered data, a wrong key or an unreadable store: all mean the
          // stored session cannot be trusted. Drop it and report "no session"; the user
          // signs in again. Cost: a transient storage error also signs the user out.
          await wipe(keyName, fileName);
          return null;
        }
      });
    },

    setItem(key, value) {
      return serial(async () => {
        const { keyName, fileName } = names(key);
        // A new key on every write: no key is ever used for two different blobs.
        const keyBase64 = await crypto.generateKey();
        const sealed = await crypto.encrypt(keyBase64, value);
        await blobStore.write(fileName, sealed);
        await keyStore.set(keyName, keyBase64);
      });
    },

    removeItem(key) {
      return serial(async () => {
        const { keyName, fileName } = names(key);
        await wipe(keyName, fileName);
      });
    },
  };
}
