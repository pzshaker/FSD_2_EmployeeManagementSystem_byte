# Employee Management Frontend — Screens and Workflow

## Product scope

A private admin interface for one administrator to sign in and manage employee records. There are no employee accounts, registration, password recovery, or public pages in this version. The backend already provides admin login, session cookies, CSRF protection, and employee CRUD APIs.

**Figma prototype:** [Employee Management — Admin UI](https://www.figma.com/design/iod7P6nbE7SuZWxqV6mmFk)

The editable Figma file contains **29 frames**: the core desktop sign-in and CRUD screens, an empty-directory state, mobile layouts, and feedback variants. Create confirmation shows the new sample employee and updated total; update and delete confirmations show their outcomes. Successful sign-in, CRUD, sign-out, retry, and password-toggle paths are wired. Error frames are visual references, not dynamically triggered. “Fieldwork” is a provisional product name in the mock. All data and interactions remain samples, and the prototype is not connected to the backend. The canvas groups core screens, desktop states, and mobile flows into three labeled rows.

## Screens

| Screen | What it does | Main content and actions |
|---|---|---|
| **Admin sign-in** (`/login`) | Authenticates the administrator. | Email/password, show/hide, generic credential error, eight-hour session note, mobile layout; no registration or password recovery. |
| **Employee directory** (`/`) | Main employee-management screen. | Desktop table or mobile cards, total count, add/edit/delete, account menu, populated state, load-failure/retry and CRUD feedback. Search/filtering are out of scope. |
| **Empty directory** (`/`) | First-use state when there are no employees. | Explain the empty state and make “Add employee” the clear next action. Separate desktop frame in Figma. |
| **Add employee** (dialog or `/employees/new`) | Creates an employee through the protected API. | Four required fields, duplicate-email feedback, retained values after failure; desktop dialog and mobile single-column form. |
| **Edit employee** (dialog or `/employees/:id/edit`) | Updates selected employee fields. | Prefilled fields, save/cancel, desktop/mobile layouts, save feedback; preserve ID and creation date. |
| **Delete confirmation** (dialog) | Prevents accidental deletion. | Identify employee by name/email; explicit delete/cancel; desktop dialog and mobile bottom sheet. Success removes row and confirms deletion. |
| **Employee not found** | Handles a valid employee URL whose record no longer exists. | Explain that the record may have been removed and provide a route back to the directory. |

### Complete Figma frame inventory

These are the **29 frames currently in the Figma file**. The numbered names match the canvas. Frames marked “reference” illustrate a state; the clickable prototype uses sample data and does not make real API requests.

| # | Figma frame | Purpose |
|---:|---|---|
| 01 | Admin sign-in | Default desktop sign-in form. |
| 02 | People directory | Populated desktop employee list and primary actions. |
| 03 | Add employee | Desktop create form. |
| 04 | Edit employee | Desktop form prefilled with the selected employee. |
| 05 | Delete confirmation | Desktop confirmation before a destructive action. |
| 06 | Empty directory state | First-use state with a path to add the first employee. |
| 07 | People directory / Mobile | Populated mobile employee cards. |
| 08 | Sign-in / Invalid credentials | Generic login failure; reference state. |
| 09 | Add employee / Duplicate email | Email conflict feedback; reference state. |
| 10 | Add employee / Save failed | Failed create with entered values retained; reference state. |
| 11 | Session expired | Return-to-login guidance after an expired session; reference state. |
| 12 | Directory / Save confirmed | Generic employee update success feedback. |
| 13 | Directory / Employee deleted | Directory after successful deletion. |
| 14 | Add employee / Request rejected | Safe retry guidance while preserving the form; reference state for rejected requests. |
| 15 | Employee unavailable | Missing employee and route back to the directory. |
| 16 | Directory / Account menu | Desktop administrator menu and sign-out action. |
| 17 | Sign-in / Mobile | Single-column mobile sign-in. |
| 18 | Add employee / Mobile | Mobile create form with bottom actions. |
| 19 | Edit employee / Mobile | Mobile edit form with bottom actions. |
| 20 | Delete confirmation / Mobile | Mobile destructive-action bottom sheet. |
| 21 | Directory / Saved / Mobile | Mobile directory after an update. |
| 22 | Directory / Employee deleted / Mobile | Mobile directory after deletion. |
| 23 | Directory / Account menu / Mobile | Mobile account menu and sign-out action. |
| 24 | Directory / Employee added | Desktop directory after create, including updated count and new row. |
| 25 | Directory / Employee added / Mobile | Mobile directory after create. |
| 26 | Sign-in / Password visible | Desktop password visibility state. |
| 27 | Sign-in / Password visible / Mobile | Mobile password visibility state. |
| 28 | Directory / Load failed | Initial desktop directory-load failure with retry. |
| 29 | Directory / Load failed / Mobile | Initial mobile directory-load failure with retry. |

The Figma mock does not currently include separate visual frames for every server response (for example `413`, `415`, or `429`); implement those through the response-to-interface mapping below. It also does not demonstrate keyboard interaction or real loading durations. Treat those as implementation and browser-verification requirements, not as verified prototype behavior.

### Important interface states

Treat these as part of the screens, not extra pages:

- **Session expired:** protected requests return `401`; clear local auth assumptions and return to sign-in with a short explanation. Shown in Figma.
- **CSRF / origin rejection:** show a safe retry or refresh instruction; do not expose token details. Shown in Figma.
- **Validation and duplicate email:** attach messages to the relevant field where possible; keep entered values after a failed save. Duplicate-email feedback is shown in Figma.
- **Client-side validation:** validate required fields, trimmed text, email shape, and length before submitting. Inline invalid-field styling is an implementation state; there is no separate invalid-form Figma frame yet.
- **Empty directory:** say there are no employees yet and offer “Add employee.”
- **Network/server error:** retain form contents and offer retry; never report a save succeeded until the API confirms it. Shown in Figma.

The prototype also shows invalid credentials, an unavailable employee, initial directory-load failures, and separate create/update/delete confirmation feedback. Loading and pending indicators are short component states: show skeleton rows while the first directory request loads; show “Saving…” / “Deleting…” and disable duplicate submission while a write is in flight. On refresh failure, keep already loaded rows and show a retry message; never present a request failure as an empty directory.

## Responsive behavior

- At phone width (390 px in Figma), use a compact brand header and a stacked employee-card list instead of squeezing the desktop table.
- Sign-in becomes one column. Add and edit become full-width, single-column forms with fixed bottom Cancel/Save actions. The delete prompt becomes a bottom sheet.
- Keep the account menu reachable from the mobile avatar. Reflow session-expired, rejected-request, and unavailable-record messages into the same single-column content width.
- On narrow screens, keep the primary action visible without covering the final form field; the prototype uses a 724 px footer start within an 844 px frame.

## API integration contract

Use same-origin requests so the browser sends the `byte.sid` HttpOnly cookie. Do not copy it or the CSRF token into local storage.

The cookie uses `SameSite=Strict`, `Path=/`, and `HttpOnly`; it is `Secure` in production. The authenticated deadline is eight hours from login and is not extended by activity. Send the configured same-origin `Origin` on browser requests. The API rejects a different or `null` Origin; command-line clients may omit Origin but still need CSRF tokens. CORS is disabled.

1. On page load, call `GET /api/auth/me`. A `200` loads the employee directory; `401` opens sign-in. A session expires eight hours after login.
2. Before login, call `GET /api/auth/csrf`; send its token in `X-CSRF-Token` with `POST /api/auth/login` using JSON `{ "email": "...", "password": "..." }`. Login requires the configured administrator credentials; passwords are 15–128 Unicode characters and whitespace is significant. Use the rotated token returned by successful login for later writes and logout.
3. Load employees with `GET /api/employees`. Send JSON and `X-CSRF-Token` for employee `POST` and `PATCH`; send `X-CSRF-Token` for `DELETE`. Handle `DELETE` status `204` without trying to parse a response body. Send `POST /api/auth/logout` with the current token; on `204`, clear in-memory auth state and return to sign-in.
4. Send only `name`, `email`, `department`, and `jobTitle`. Create requires all four; update may send changed fields only. Limits are 100, 254, 100, and 100 Unicode code points respectively. Trim text, require nonblank values, and validate the basic email format. The API trims and lowercases email and checks uniqueness.

| Response | Interface behavior |
|---|---|
| `400` | Show validation or request errors beside the relevant field when possible. Keep entered values. |
| `401` | Use a generic sign-in error for login; for an expired session, return to sign-in and clear in-memory auth state. |
| `403` | Tell the administrator to refresh or retry safely; never expose CSRF token details. |
| `404` | Show the unavailable-employee state and a route back to the directory. |
| `409` | Mark the email field as already in use; preserve the rest of the form. |
| `413` / `415` | Explain that the request could not be accepted; check field limits and JSON content type. `415` applies to JSON-body requests (login, create, and update); DELETE has no body. |
| `429` | Show the wait time from `Retry-After`, especially on sign-in. |
| `500` or network failure | Keep form values, offer retry, and never show success without a successful API response. For an initial directory load, use the directory-load error state; on refresh, preserve loaded rows and show an inline retry message. |

The API wraps successful JSON as `{ "data": ... }` and errors as `{ "error": { "code": "...", "message": "..." } }`. Employee records return `id`, `name`, `email`, `department`, `jobTitle`, `createdAt`, and `updatedAt`.

## Recommended prototype workflow

1. **Lock the smallest useful flow.** Prototype sign-in → directory → add/edit/delete → sign-out/session expiry. Keep search, pagination, bulk actions, charts, and employee profiles out until the CRUD flow feels right or the assignment explicitly needs them.
2. **Choose a design direction before drawing screens.** The current direction is a calm, precise operations tool: a light neutral workspace, deep forest-green navigation, lime accents, restrained status colors, and a readable employee table. Use Inter with a clear heading/body scale. Avoid turning every field and table row into a floating rounded card.
3. **Wireframe the directory and forms first.** Decide the desktop table layout and mobile transformation (compact employee rows or stacked details with actions). Design the add/edit form together so they share structure and validation patterns. Place destructive actions away from primary actions.
4. **Prototype the state changes.** The current mock has empty, duplicate-email, save-failure, generic rejected-request, save/delete success, and expired-session references. Invalid-field styling and loading/pending indicators are specified component states, not separate Figma frames yet. Motion should confirm actions (dialog open/close, row removal, save feedback), not animate every element on page load. Respect reduced-motion preferences in the eventual build.
5. **Review at desktop and mobile sizes.** Check keyboard-only navigation, visible focus, readable contrast, labels for every field, and that dialogs can be closed and used with a keyboard. Fix the flow before writing frontend code.
6. **Implement the approved prototype with the simplest stack.** Use the existing Express app to serve static HTML, CSS, and vanilla JavaScript unless a concrete requirement justifies a framework. Reuse the existing API; keep the session cookie HttpOnly and use the API's CSRF token flow for writes. Do not store passwords, session IDs, or CSRF tokens in localStorage.
7. **Verify the real flows.** Test sign-in/out, CRUD, validation, duplicate email, expired session, API errors, mobile layout, and keyboard access against the running backend. Update README with frontend run/use instructions and capture the required demo screenshots.

## Tools

- **Figma** — current home for frames, components, clickable flows, and developer handoff. The file is in the connected team workspace.
- **Penpot** — free/open-source alternative for interface design and interactive prototypes if you prefer not to use Figma.
- **Browser + DevTools** — final authority for responsive behavior, focus states, animations, and API integration after implementation.
- **No extra frontend framework or animation package by default.** HTML/CSS/JS are already familiar and fit this small admin application. CSS transitions and keyframes cover the needed feedback; add a dependency only if the prototype reveals a specific unmet need.

Do not try to make Figma generate production code for this app. Treat the prototype as a visual and interaction specification, then implement and verify the real API behavior in the browser.

## Current prototype tokens

Use these shared values from the current Figma direction:

- **Canvas:** `#F5F8F4`
- **Surface:** `#FFFFFF`
- **Brand / sidebar:** `#12382F`
- **Active navigation:** `#1A5247`
- **Accent:** `#D6F06B`
- **Primary text:** `#1A2420`
- **Muted text:** `#616E68`
- **Primary action:** `#2C2C2C` (shared button component)
- **Borders:** `#DEE6E0`
- **Type:** `Inter` or a system sans-serif fallback; use sentence case and avoid tiny all-caps labels.
- **Layout:** left-aligned page content, a compact persistent navigation/header, a wide readable table on desktop, and a single-column action-oriented layout on mobile.
- **Motion:** short, purposeful transitions for opening/closing dialogs, save feedback, and row removal; honor `prefers-reduced-motion`.

## Definition of ready for implementation

- Core screens and the main interaction outcomes are represented in the prototype. Transient loading, invalid-field styling, and less common HTTP errors are specified as implementation states, not separate frames.
- The successful sign-in and employee CRUD flows can be clicked through; labeled error frames are visual references, not simulated failures.
- Desktop and mobile layouts are reviewed.
- Colors, typography, spacing, buttons, fields, table rows, dialogs, and feedback messages use consistent reusable styles.
- API fields and auth/CSRF behavior match the existing backend contract documented in `README.md`.

## Out of scope for this pass

Do not build the frontend in this planning step. Do not add employee self-service accounts, registration, password recovery, roles, charts, bulk import, pagination, deployment, or a new backend API unless the project requirements change.
