import { randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { burnPasswordCheck, isValidEmail, validatePassword, verifyPassword } from './passwords.js';
import { SqliteSessionStore } from './session-store.js';

const HOUR = 60 * 60 * 1000;
const ANONYMOUS_SESSION = 15 * 60 * 1000;
const genericLoginError = { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } };

export function validateSessionSecret(secret) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret) || secret.includes('change-me')) {
    throw new Error('SESSION_SECRET must be generated from at least 32 random bytes and set in .env.');
  }
  try {
    if (Buffer.from(secret, 'base64').length < 32) throw new Error();
  } catch {
    throw new Error('SESSION_SECRET must be generated from at least 32 random bytes and set in .env.');
  }
}

function apiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isJson(req) {
  return Boolean(req.is('application/json'));
}

function requireJson(req, res, next) {
  if (!isJson(req)) return next(apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
  next();
}

export function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token');
  const expected = req.session?.csrfToken;
  if (typeof supplied !== 'string' || typeof expected !== 'string') {
    return next(apiError(403, 'INVALID_CSRF_TOKEN', 'A valid CSRF token is required.'));
  }
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return next(apiError(403, 'INVALID_CSRF_TOKEN', 'A valid CSRF token is required.'));
  }
  next();
}

export function createSessionMiddleware({ db, secret, production = process.env.NODE_ENV === 'production' }) {
  validateSessionSecret(secret);
  const store = new SqliteSessionStore(db);
  store.on('error', () => {});
  return session({
    name: 'byte.sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/',
    },
  });
}

export function checkOrigin(expectedOrigin) {
  return (req, res, next) => {
    const origin = req.get('Origin');
    if (origin !== undefined && (origin === 'null' || origin !== expectedOrigin)) {
      return next(apiError(403, 'INVALID_ORIGIN', 'Request origin is not allowed.'));
    }
    next();
  };
}

function makeLimiter({ windowMs, limit, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      const resetAt = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + windowMs;
      res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } });
    },
  });
}

function asyncSessionCall(sessionObject, method) {
  return new Promise((resolve, reject) => sessionObject[method]((error) => error ? reject(error) : resolve()));
}

function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}

function validateLoginBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw apiError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  if (Object.keys(body).some((key) => !['email', 'password'].includes(key))) {
    throw apiError(400, 'UNKNOWN_FIELD', 'Request contains an unsupported field.');
  }
  if (typeof body.email !== 'string' || typeof body.password !== 'string'
    || [...body.password].length > 128 || !isValidEmail(body.email)) {
    throw apiError(400, 'INVALID_BODY', 'A valid email and password are required.');
  }
  const passwordError = validatePassword(body.password);
  if (passwordError) throw apiError(400, 'INVALID_BODY', passwordError);
  return { email: body.email.trim().toLowerCase(), password: body.password };
}

async function saveSession(req) {
  await asyncSessionCall(req.session, 'save');
}

export function createAuthRouter({ db }) {
  const router = express.Router();
  const csrfLimiter = makeLimiter({ windowMs: ANONYMOUS_SESSION, limit: 60 });
  const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true });

  router.get('/csrf', csrfLimiter, (req, res, next) => {
    if (!req.session.csrfToken) req.session.csrfToken = newCsrfToken();
    req.session.cookie.maxAge = ANONYMOUS_SESSION;
    res.set('Cache-Control', 'no-store');
    res.json({ data: { csrfToken: req.session.csrfToken } });
  });

  router.post('/login', requireCsrf, loginLimiter, requireJson, express.json({ limit: '16kb', strict: false }), async (req, res, next) => {
    try {
      const { email, password } = validateLoginBody(req.body);
      const user = await db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
      const valid = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
      if (!user || !valid) return res.status(401).json(genericLoginError);

      await asyncSessionCall(req.session, 'regenerate');
      req.session.userId = user.id;
      req.session.csrfToken = newCsrfToken();
      req.session.authExpiresAt = Date.now() + 8 * HOUR;
      req.session.cookie.expires = new Date(req.session.authExpiresAt);
      req.session.cookie.maxAge = 8 * HOUR;
      await saveSession(req);
      res.set('Cache-Control', 'no-store');
      res.json({ data: { user: { id: user.id, email: user.email }, csrfToken: req.session.csrfToken, expiresAt: new Date(req.session.authExpiresAt).toISOString() } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.session.userId || !req.session.authExpiresAt || req.session.authExpiresAt <= Date.now()) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator authentication is required.' } });
    }
    const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator authentication is required.' } });
    res.json({ data: { user } });
  });

  router.post('/logout', requireCsrf, async (req, res, next) => {
    try {
      await asyncSessionCall(req.session, 'destroy');
      res.clearCookie('byte.sid', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
      res.set('Cache-Control', 'no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function requireAdministrator(db) {
  return async (req, res, next) => {
    const { userId, authExpiresAt } = req.session ?? {};
    if (!userId || !authExpiresAt || authExpiresAt <= Date.now()) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator authentication is required.' } });
    }
    try {
      if (!await db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator authentication is required.' } });
      }
    } catch (error) {
      return next(error);
    }
    next();
  };
}
