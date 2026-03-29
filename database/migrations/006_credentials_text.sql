-- Migration 006: Change credentials column from JSONB to TEXT
-- Reason: credentials are now stored as AES-256-GCM encrypted strings (iv:tag:ciphertext),
-- which are not valid JSON. TEXT allows storing both the encrypted format and NULL.
ALTER TABLE apps ALTER COLUMN credentials TYPE TEXT USING credentials::TEXT;
