import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM encryption for chat text stored in MongoDB. A database dump (or
 * anyone reading the collection directly) sees only ciphertext; the API
 * decrypts for conversation members. Values written before encryption was
 * introduced have no prefix and are returned unchanged.
 */
const PREFIX = 'enc:v1:';
const KEY = crypto.createHash('sha256').update(String(env.chatKey)).digest(); // 32 bytes

export function seal(text) {
  if (text === undefined || text === null || text === '') return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function open(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '[message could not be decrypted]';
  }
}
