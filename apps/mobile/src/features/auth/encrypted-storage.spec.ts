import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  createEncryptedStorage,
  type BlobStorePort,
  type CryptoPort,
  type KeyStorePort,
} from './encrypted-storage';

// The real expo-crypto AES needs a native module and cannot run in Jest. This fake follows
// the same contract with Node's AES-256-GCM (base64 of iv + ciphertext + tag), so a
// tampered blob or a wrong key really fails authentication, as on a device.
const nodeCrypto: CryptoPort = {
  async generateKey() {
    return randomBytes(32).toString('base64');
  },
  async encrypt(keyBase64, plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
  },
  async decrypt(keyBase64, sealedBase64) {
    const all = Buffer.from(sealedBase64, 'base64');
    const iv = all.subarray(0, 12);
    const tag = all.subarray(all.length - 16);
    const body = all.subarray(12, all.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  },
};

function makeStorage() {
  const keys = new Map<string, string>();
  const files = new Map<string, string>();
  const keyStore: KeyStorePort = {
    get: async (name) => keys.get(name) ?? null,
    set: async (name, value) => void keys.set(name, value),
    delete: async (name) => void keys.delete(name),
  };
  const blobStore: BlobStorePort = {
    read: async (name) => files.get(name) ?? null,
    write: async (name, content) => void files.set(name, content),
    delete: async (name) => void files.delete(name),
  };
  const storage = createEncryptedStorage({ crypto: nodeCrypto, keyStore, blobStore });
  return { storage, keys, files };
}

const KEY = 'sleep-stories.auth';
const session = JSON.stringify({ access_token: 'access-AAAA', refresh_token: 'refresh-BBBB' });

describe('createEncryptedStorage', () => {
  it('round-trips a value', async () => {
    const { storage } = makeStorage();
    await storage.setItem(KEY, session);
    expect(await storage.getItem(KEY)).toBe(session);
  });

  it('round-trips a 4 KB value with non-ASCII text', async () => {
    const { storage } = makeStorage();
    const big = JSON.stringify({ blob: 'щ'.repeat(2100), pad: 'x'.repeat(2000) });
    expect(big.length).toBeGreaterThan(4096);
    await storage.setItem(KEY, big);
    expect(await storage.getItem(KEY)).toBe(big);
  });

  it('returns null when nothing was stored', async () => {
    const { storage } = makeStorage();
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('writes a fresh key on every write', async () => {
    const { storage, keys } = makeStorage();
    await storage.setItem(KEY, session);
    const first = keys.get(`${KEY}.aeskey`);
    await storage.setItem(KEY, session);
    const second = keys.get(`${KEY}.aeskey`);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(await storage.getItem(KEY)).toBe(session);
  });

  it('keeps the plaintext out of the file', async () => {
    const { storage, files } = makeStorage();
    await storage.setItem(KEY, session);
    const blob = files.get(`${KEY}.enc`) ?? '';
    expect(blob.length).toBeGreaterThan(0);
    expect(blob).not.toContain('access-AAAA');
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('refresh-BBBB');
  });

  it('returns null and removes both halves when the ciphertext was tampered with', async () => {
    const { storage, keys, files } = makeStorage();
    await storage.setItem(KEY, session);
    const bytes = Buffer.from(files.get(`${KEY}.enc`) ?? '', 'base64');
    bytes[14] = (bytes[14] ?? 0) ^ 0xff;
    files.set(`${KEY}.enc`, bytes.toString('base64'));
    expect(await storage.getItem(KEY)).toBeNull();
    expect(keys.size).toBe(0);
    expect(files.size).toBe(0);
  });

  it('returns null and removes the file when the key is missing', async () => {
    const { storage, keys, files } = makeStorage();
    await storage.setItem(KEY, session);
    keys.clear();
    expect(await storage.getItem(KEY)).toBeNull();
    expect(files.size).toBe(0);
  });

  it('returns null and removes the key when the file is missing', async () => {
    const { storage, keys, files } = makeStorage();
    await storage.setItem(KEY, session);
    files.clear();
    expect(await storage.getItem(KEY)).toBeNull();
    expect(keys.size).toBe(0);
  });

  it('returns null when the key belongs to another blob', async () => {
    const { storage, keys } = makeStorage();
    await storage.setItem(KEY, session);
    keys.set(`${KEY}.aeskey`, randomBytes(32).toString('base64'));
    expect(await storage.getItem(KEY)).toBeNull();
    expect(keys.size).toBe(0);
  });

  it('removeItem deletes both halves', async () => {
    const { storage, keys, files } = makeStorage();
    await storage.setItem(KEY, session);
    await storage.removeItem(KEY);
    expect(keys.size).toBe(0);
    expect(files.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removeItem still deletes the file when deleting the key fails', async () => {
    const files = new Map<string, string>([[`${KEY}.enc`, 'x']]);
    const storage = createEncryptedStorage({
      crypto: nodeCrypto,
      keyStore: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => {
          throw new Error('keystore down');
        },
      },
      blobStore: {
        read: async (name) => files.get(name) ?? null,
        write: async (name, content) => void files.set(name, content),
        delete: async (name) => void files.delete(name),
      },
    });
    await storage.removeItem(KEY);
    expect(files.size).toBe(0);
  });

  it('keeps the last value when writes overlap', async () => {
    const { storage } = makeStorage();
    await Promise.all([storage.setItem(KEY, 'one'), storage.setItem(KEY, 'two'), storage.setItem(KEY, 'three')]);
    expect(await storage.getItem(KEY)).toBe('three');
  });

  it('rejects keys that SecureStore would not accept, without echoing them', async () => {
    const { storage } = makeStorage();
    await expect(storage.getItem('bad key/..')).rejects.toThrow('Invalid storage key');
    await expect(storage.setItem('bad key/..', 'x')).rejects.toThrow(/^Invalid storage key$/);
  });
});
