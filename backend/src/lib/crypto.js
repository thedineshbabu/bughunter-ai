/**
 * AES-256-GCM encrypt/decrypt for app credentials.
 *
 * Key: CREDENTIALS_ENCRYPTION_KEY env var — a 64-char hex string (32 bytes).
 * Ciphertext format: iv_hex:authTag_hex:encrypted_hex
 *
 * Generate a key: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey() {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plain JS object. Returns an opaque ciphertext string.
 * @param {object} obj
 * @returns {string}
 */
export function encrypt(obj) {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a ciphertext string produced by encrypt(). Returns the original object.
 * Returns null if the input is null/undefined (no credentials stored).
 * @param {string|null} ciphertext
 * @returns {object|null}
 */
export function decrypt(ciphertext) {
  if (ciphertext == null) return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }
  const [ivHex, tagHex, encHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}
