#!/usr/bin/env node
/**
 * One-time script: re-encrypt all plaintext credentials in the apps table.
 *
 * Run ONCE after deploying the credential encryption feature (Fix 5).
 * Safe to run multiple times — already-encrypted rows are skipped.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... CREDENTIALS_ENCRYPTION_KEY=<64-char-hex> \
 *     node database/scripts/re_encrypt_credentials.js
 */

import 'dotenv/config';
import pg from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const { Client } = pg;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey() {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-char hex string');
  }
  return Buffer.from(hex, 'hex');
}

function isAlreadyEncrypted(value) {
  // Encrypted format: iv_hex:authTag_hex:encrypted_hex (3 colon-separated hex parts)
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

function encryptObj(obj) {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query('SELECT id, credentials FROM apps WHERE credentials IS NOT NULL');
  console.log(`Found ${rows.length} apps with credentials.`);

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    const raw = row.credentials;

    if (isAlreadyEncrypted(raw)) {
      skipped++;
      continue;
    }

    // Parse plaintext JSON (stored as a JSONB string from pg driver)
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ciphertext = encryptObj(obj);

    await client.query('UPDATE apps SET credentials = $1 WHERE id = $2', [ciphertext, row.id]);
    encrypted++;
  }

  await client.end();
  console.log(`Done. Encrypted: ${encrypted}, Already encrypted (skipped): ${skipped}`);
}

main().catch((err) => {
  console.error('Re-encryption failed:', err.message);
  process.exit(1);
});
