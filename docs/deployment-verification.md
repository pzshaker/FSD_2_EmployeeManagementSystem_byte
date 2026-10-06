# Production verification — 6 October 2026

Live app: https://byte-employee-management-pzshaker.vercel.app

## Architecture

- Vercel serves the frontend and runs the existing Express API.
- Turso Starter provides persistent SQLite employee, administrator and session tables.
- Production was initialized explicitly with sample employees and the existing local administrator's password hash. Development employee records were not copied, reset or overwritten.
- The old external API proxy, alternate backend, deployment scripts, tooling and generated debugging files were removed. No challenge service is part of the app's request flow.
- HTTPS cookies remain Secure, HttpOnly and SameSite=Strict. Origin and CSRF checks, scrypt password verification, session expiry and bodyless DELETE/logout responses remain in place.

## Verified

The real production app was exercised in installed Chrome through Playwright at 1440×960 and 390×844: sign in, load directory, create a disposable employee, edit, cancel deletion, confirm deletion, reload an authenticated session, sign out and verify unauthenticated API access returns 401. DELETE returned 204 and sent no request body. Both layouts had no horizontal overflow; no browser JavaScript errors or requests to the removed external backend were recorded. Disposable verification employees were deleted.

`npm test` with `BYTE_PLAYWRIGHT_MODULE` enabled: 37 passed, 0 failed, 0 skipped. This includes the existing frontend suites and an asynchronous SQLite adapter regression covering authentication, sessions, CSRF, CRUD, duplicate-email mapping, logout and unauthenticated access. JavaScript syntax checks passed. `npm audit` found 0 vulnerabilities.

## Limits

Rate limiting uses process memory and is not shared across serverless instances. Physical-device, Safari/iOS and screen-reader checks remain unverified. GitHub automatic deployment needs Vercel integration access to the repository; CLI production deployments work. Production secrets stay in Vercel and ignored private environment files.
