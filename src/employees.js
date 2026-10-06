import express from 'express';
import { requireCsrf } from './auth.js';

const fields = new Map([
  ['name', { column: 'name', max: 100 }],
  ['email', { column: 'email', max: 254 }],
  ['department', { column: 'department', max: 100 }],
  ['jobTitle', { column: 'job_title', max: 100 }],
]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ApiError(status, code, message);
}

function mapEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    department: row.department,
    jobTitle: row.job_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseEmployeeBody(body, { partial = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  const keys = Object.keys(body);
  if (keys.some((key) => !fields.has(key))) {
    fail(400, 'UNKNOWN_FIELD', 'Request contains an unsupported field.');
  }
  if (keys.length === 0 || (!partial && keys.length !== fields.size)) {
    fail(400, 'REQUIRED_FIELDS', partial ? 'Provide at least one field to update.' : 'All employee fields are required.');
  }

  const values = {};
  for (const key of keys) {
    const value = body[key];
    if (typeof value !== 'string') fail(400, 'INVALID_FIELD', `${key} must be a string.`);
    const normalized = value.trim();
    if (!normalized) fail(400, 'INVALID_FIELD', `${key} is required.`);
    if ([...normalized].length > fields.get(key).max) fail(400, 'INVALID_FIELD', `${key} exceeds its maximum length.`);
    values[key] = key === 'email' ? normalized.toLowerCase() : normalized;
  }
  if ('email' in values && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(values.email)) {
    fail(400, 'INVALID_EMAIL', 'email must have a valid address format.');
  }
  return values;
}

function parseId(raw) {
  if (!/^\d+$/.test(raw)) fail(400, 'INVALID_ID', 'Employee ID must contain decimal digits only.');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'INVALID_ID', 'Employee ID must be a positive safe integer.');
  return id;
}

function isUniqueEmailError(error) {
  return ['ERR_SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code)
    && /UNIQUE constraint failed: employees\.email/.test(error.message);
}

function handleDatabaseError(error, next) {
  if (isUniqueEmailError(error)) {
    next(new ApiError(409, 'DUPLICATE_EMAIL', 'An employee with this email already exists.'));
  } else {
    next(error);
  }
}

export function createEmployeeRouter({ db, authorize }) {
  if (!db || typeof authorize !== 'function') throw new TypeError('Employee routes require a database and authorization middleware.');
  const router = express.Router();

  router.use(authorize);
  router.use((req, res, next) => ['POST', 'PATCH', 'DELETE'].includes(req.method) ? requireCsrf(req, res, next) : next());
  router.use(express.json({ limit: '16kb', strict: false }));
  router.use((req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
    }
    next();
  });

  router.get('/', async (req, res) => {
    const rows = await db.prepare(`SELECT id, name, email, department, job_title, created_at, updated_at
      FROM employees ORDER BY id ASC`).all();
    res.json({ data: rows.map(mapEmployee) });
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const employee = await db.prepare(`SELECT id, name, email, department, job_title, created_at, updated_at
        FROM employees WHERE id = ?`).get(parseId(req.params.id));
      if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
      res.json({ data: mapEmployee(employee) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const values = parseEmployeeBody(req.body);
      const result = await db.prepare(`INSERT INTO employees (name, email, department, job_title)
        VALUES (?, ?, ?, ?)`).run(values.name, values.email, values.department, values.jobTitle);
      const employee = await db.prepare(`SELECT id, name, email, department, job_title, created_at, updated_at
        FROM employees WHERE id = ?`).get(result.lastInsertRowid);
      res.status(201).location(`/api/employees/${employee.id}`).json({ data: mapEmployee(employee) });
    } catch (error) {
      handleDatabaseError(error, next);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const values = parseEmployeeBody(req.body, { partial: true });
      const entries = Object.entries(values);
      const assignments = entries.map(([key]) => `${fields.get(key).column} = ?`);
      assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      const result = await db.prepare(`UPDATE employees SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...entries.map(([, value]) => value), id);
      if (result.changes === 0) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
      const employee = await db.prepare(`SELECT id, name, email, department, job_title, created_at, updated_at
        FROM employees WHERE id = ?`).get(id);
      res.json({ data: mapEmployee(employee) });
    } catch (error) {
      handleDatabaseError(error, next);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await db.prepare('DELETE FROM employees WHERE id = ?').run(parseId(req.params.id));
      if (result.changes === 0) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function employeeErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError || (Number.isInteger(error.status) && typeof error.code === 'string')) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'JSON body must not exceed 16 KB.' } });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON.' } });
  }
  if (error.status === 400 && error.type === 'encoding.unsupported') {
    return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'Request body encoding is not supported.' } });
  }
  console.error('Unhandled API error:', error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
}
