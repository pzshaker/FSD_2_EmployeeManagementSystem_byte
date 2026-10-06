import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const keyLength = 64;

export function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (/^replace_with_/i.test(password.trim())) return 'must be replaced with a unique password.';
  const length = [...password].length;
  if (length < 15 || length > 128) return 'Password must contain 15 to 128 characters.';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, keyLength, parameters);
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const N = Number(n);
  const blockSize = Number(r);
  const parallelization = Number(p);
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(hashText, 'base64');
  if (N !== parameters.N || blockSize !== parameters.r || parallelization !== parameters.p
    || salt.length !== 16 || expected.length !== keyLength) return false;
  const actual = await scrypt(password, salt, expected.length, parameters);
  return timingSafeEqual(actual, expected);
}

export async function burnPasswordCheck(password) {
  const candidate = await scrypt(password, randomBytes(16), keyLength, parameters);
  timingSafeEqual(candidate, Buffer.alloc(keyLength));
}

export function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email.trim());
}
