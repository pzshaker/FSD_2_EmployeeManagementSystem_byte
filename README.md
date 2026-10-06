# Employee Management System

A responsive employee directory with administrator sign-in and employee create, read, update, and delete operations.

## Features

- Responsive employee directory, add and edit forms, and deletion confirmation.
- Required-field and email validation, with duplicate-email protection.
- Administrator authentication, protected employee changes, CSRF protection, and eight-hour sessions.
- Accessible dialogs, keyboard navigation, visible focus, and reduced-motion support.
- Persistent SQLite storage.

## Use the app

Open the [Employee Management app](https://byte-employee-management-pzshaker.vercel.app) and sign in with your administrator email and password. The account username is its email address. Passwords are case sensitive.

Use **Add employee** to create a record. Choose **Edit** to update it, or **Delete** to review the employee details before confirming. Use **Keep employee** to cancel. Sign out from the administrator menu.

## Run locally

Requirements: Node.js 24.11.1 or newer in the 24.x series.

```sh
npm install
```

Create a `.env` file from `.env.example`. Set a unique administrator email and password, and generate `SESSION_SECRET` with:

```sh
node -p "require('node:crypto').randomBytes(32).toString('base64')"
```

Create the administrator, add the example employees, and start the server:

```sh
npm run admin:create
npm run db:seed
npm start
```

Open http://127.0.0.1:3000. The local database is stored at `data/employees.sqlite`. Keep `.env` and the database file private. For development with automatic restarts, run `npm run dev`.

## API

All routes use the same origin. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code": ..., "message": ... } }`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/auth/csrf` | Get a session CSRF token |
| POST | `/api/auth/login` | Sign in with `{ "email", "password" }` |
| GET | `/api/auth/me` | Get the signed-in administrator |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/employees` | List employees |
| GET | `/api/employees/:id` | Get one employee |
| POST | `/api/employees` | Create an employee |
| PATCH | `/api/employees/:id` | Update an employee |
| DELETE | `/api/employees/:id` | Delete an employee |

Employee fields are `name`, `email`, `department`, and `jobTitle`. All are required when creating an employee. Send JSON for login and employee changes, and include the current `X-CSRF-Token` on login, logout, create, update, and delete requests. DELETE and logout succeed with an empty `204` response.

## Data and security

The deployed app uses persistent SQLite storage. The local app uses a SQLite file; local and deployed employee records are separate. Database schema creation preserves existing records. Example data is added explicitly and does not replace existing employees.

Sessions use an HttpOnly, Secure in production, SameSite=Strict cookie. CSRF tokens and passwords are not stored in browser local storage. Passwords are stored as salted scrypt hashes. Create and update requests validate required fields on the server; email addresses must be unique.
