// The real Expo-backed dependencies for createEncryptedStorage. Kept apart from
// encrypted-storage.ts so that module stays pure and testable without the Expo runtime.
// Not covered by unit tests (needs a device); the phone check exercises it.
import {
  aesDecryptAsync,
  aesEncryptAsync,
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
} from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { EncryptedStorageDeps } from './encrypted-storage';

// AFTER_FIRST_UNLOCK: readable while the phone is locked, which is how a night session
// runs. THIS_DEVICE_ONLY: never synced to another device through a backup or iCloud.
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function createExpoStorageDeps(): EncryptedStorageDeps {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    crypto: {
      async generateKey() {
        const key = await AESEncryptionKey.generate(AESKeySize.AES256);
        return key.encoded('base64');
      },
      async encrypt(keyBase64, plaintext) {
        const key = await AESEncryptionKey.import(keyBase64, 'base64');
        // A string plaintext would be read as base64, so pass the UTF-8 bytes.
        const sealed = await aesEncryptAsync(encoder.encode(plaintext), key);
        // iv (12) + ciphertext + tag (16), base64.
        return sealed.combined('base64');
      },
      async decrypt(keyBase64, sealedBase64) {
        const key = await AESEncryptionKey.import(keyBase64, 'base64');
        // The docs say a base64 string is accepted, but expo-crypto 57.0.4 passes it to the
        // native side untouched and the Android function takes bytes only, so a string throws
        // there (found on a phone in Expo Go). Hand it the decoded bytes.
        const binary = atob(sealedBase64);
        const sealedBytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) sealedBytes[index] = binary.charCodeAt(index);
        const sealed = AESSealedData.fromCombined(sealedBytes);
        const bytes = await aesDecryptAsync(sealed, key);
        return decoder.decode(bytes);
      },
    },

    keyStore: {
      get: (name) => SecureStore.getItemAsync(name, KEY_OPTIONS),
      set: (name, value) => SecureStore.setItemAsync(name, value, KEY_OPTIONS),
      delete: (name) => SecureStore.deleteItemAsync(name, KEY_OPTIONS),
    },

    blobStore: {
      async read(name) {
        const file = new File(Paths.document, name);
        return file.exists ? file.text() : null;
      },
      async write(name, content) {
        const file = new File(Paths.document, name);
        if (!file.exists) file.create();
        file.write(content);
      },
      async delete(name) {
        const file = new File(Paths.document, name);
        if (file.exists) file.delete();
      },
    },
  };
}
