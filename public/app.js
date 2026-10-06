const $ = (id) => document.getElementById(id);
let csrfToken = null;
let user = null;
let employees = null;
let directoryPending = false;
let authVersion = 0;
let directoryVersion = 0;
let editedEmployee = null;
let savePending = false;
let employeeDraft = null;
let editorTrigger = null;
let addedEmployeeId = null;
let deletedEmployee = null;
let deletePending = false;
let deleteDraft = null;
let deleteTrigger = null;
const employeeFields = { name: ['Full name', 100], email: ['Work email', 254], department: ['Department', 100], jobTitle: ['Job title', 100] };
const mobileEditor = matchMedia('(max-width: 767px)');

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.ok) {
    const error = new Error('Request failed');
    error.status = response.status;
    error.retryAfter = response.headers.get('Retry-After');
    try { error.code = (await response.json())?.error?.code; } catch { /* Status still identifies non-JSON failures. */ }
    throw error;
  }
  if ((options.method === 'DELETE' || path === '/api/auth/logout') && response.status !== 204) throw new Error('Unexpected response');
  if (response.status === 204) return null;
  const body = await response.json();
  if (!body || !('data' in body)) throw new Error('Invalid server response');
  return body.data;
}

function errorMessage(error, context) {
  if (error.status === 401 && context === 'login') return 'Email or password is incorrect.';
  if (error.status === 400) return 'The request could not be accepted. Check your entered values and try again.';
  if (error.status === 403) return 'Your request was rejected. Refresh this page and try again safely.';
  if (error.status === 413 || error.status === 415) return 'The request could not be accepted. Check field limits and refresh the page before retrying.';
  if (error.status === 429) {
    const seconds = /^\d+$/.test(error.retryAfter || '') ? Number(error.retryAfter) : Math.ceil((Date.parse(error.retryAfter) - Date.now()) / 1000);
    return Number.isFinite(seconds) ? `Too many requests. Try again in ${Math.max(1, seconds)} seconds.` : 'Too many requests. Please wait before trying again.';
  }
  return context === 'logout' ? 'Could not sign out. You are still in the workspace. Try signing out again.' : 'Could not connect to the workspace. Check your connection and try again.';
}

function notice(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
  $(id).removeAttribute('data-warning');
}

function announce(message) { $('announcement').textContent = message; }

function screen(id, path) {
  for (const name of ['startup', 'login', 'directory']) $(name).hidden = name !== id;
  if (path && location.pathname !== path) history.replaceState(null, '', path);
  document.title = id === 'login' ? 'Sign in — Fieldwork' : 'People directory — Fieldwork';
  $(`${id}-title`).focus();
}

function closeAccount(restoreFocus = false) {
  const wasOpen = !$('account-panel').hidden;
  $('account-panel').hidden = true;
  $('account-toggle').setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus) $('account-toggle').focus();
}

function showLogin(message = '', preserveDraft = false) {
  if (preserveDraft && $('delete-dialog').open) deleteDraft = deletedEmployee;
  else if (!preserveDraft) deleteDraft = null;
  closeDelete(false);
  if (preserveDraft && $('employee-dialog').open) employeeDraft = { employee: editedEmployee, values: readEmployeeValues() };
  else if (!preserveDraft) employeeDraft = null;
  closeEditor(false);
  $('save-confirmation').hidden = true;
  authVersion++;
  directoryVersion++;
  user = null;
  csrfToken = null;
  employees = null;
  addedEmployeeId = null;
  directoryPending = false;
  $('employee-content').replaceChildren();
  $('admin-email').textContent = '';
  $('login-form').reset();
  $('password').type = 'password';
  $('password-toggle').textContent = 'Show';
  $('password-toggle').setAttribute('aria-label', 'Show password');
  $('password-toggle').setAttribute('aria-pressed', 'false');
  clearFieldErrors();
  closeAccount();
  notice('directory-message');
  notice('login-message', message);
  screen('login', '/login');
}

function showDirectory(admin) {
  user = admin;
  $('admin-email').textContent = user.email;
  $('admin-initial').textContent = [...user.email][0].toUpperCase();
  screen('directory', '/');
  loadDirectory();
  if (deleteDraft) {
    const employee = deleteDraft;
    deleteDraft = null;
    openDelete(employee);
    notice('delete-message', 'Your selection was retained. Review it before confirming deletion.');
  }
  if (employeeDraft) {
    const draft = employeeDraft;
    employeeDraft = null;
    openEditor(draft.employee, draft.values);
    notice('employee-message', 'Your entered values were retained. Review them and save when ready.');
    $('employee-hint').hidden = true;
  }
}

async function startup() {
  const version = authVersion;
  screen('startup');
  $('startup-title').textContent = 'Checking your session…';
  $('startup-message').textContent = 'Opening your private workspace.';
  $('startup-retry').hidden = true;
  try {
    const data = await request('/api/auth/me');
    if (version !== authVersion) return;
    if (!data.user?.email) throw new Error('Invalid administrator response');
    showDirectory(data.user);
  } catch (error) {
    if (version !== authVersion) return;
    if (error.status === 401) showLogin();
    else {
      $('startup-title').textContent = 'Workspace unavailable';
      $('startup-message').textContent = errorMessage(error, 'startup');
      $('startup-retry').hidden = false;
      announce($('startup-message').textContent);
    }
  }
}

function clearFieldErrors() {
  for (const id of ['email', 'password']) {
    $(id).removeAttribute('aria-invalid');
    notice(`${id}-error`);
  }
}

function validateLogin() {
  clearFieldErrors();
  const email = $('email').value.trim();
  const password = $('password').value;
  const errors = {};
  if ([...email].length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) errors.email = 'Enter a valid email address, up to 254 characters.';
  if ([...password].length < 15 || [...password].length > 128) errors.password = 'Enter a password with 15–128 characters. Spaces are significant.';
  for (const [id, message] of Object.entries(errors)) {
    $(id).setAttribute('aria-invalid', 'true');
    notice(`${id}-error`, message);
  }
  if (Object.keys(errors).length) { $(Object.keys(errors)[0]).focus(); return null; }
  return { email, password };
}

async function getCsrf() {
  const version = authVersion;
  const data = await request('/api/auth/csrf');
  if (version !== authVersion) return;
  if (typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Invalid CSRF response');
  csrfToken = data.csrfToken;
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('sign-in').disabled) return;
  const values = validateLogin();
  if (!values) return;
  const version = authVersion;
  notice('login-message');
  $('sign-in').disabled = true;
  $('sign-in').textContent = 'Signing in…';
  $('email').readOnly = $('password').readOnly = true;
  try {
    await getCsrf();
    if (version !== authVersion) return;
    const data = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(values) });
    if (version !== authVersion) return;
    if (!data?.user?.email || typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('Invalid login response');
    csrfToken = data.csrfToken;
    $('password').value = '';
    showDirectory(data.user);
  } catch (error) {
    if (version !== authVersion) return;
    if (error.status === 403) csrfToken = null;
    notice('login-message', errorMessage(error, 'login'));
  } finally {
    $('sign-in').disabled = false;
    $('sign-in').textContent = 'Sign in';
    $('email').readOnly = $('password').readOnly = false;
  }
});

$('password-toggle').addEventListener('click', () => {
  const visible = $('password').type === 'password';
  $('password').type = visible ? 'text' : 'password';
  $('password-toggle').textContent = visible ? 'Hide' : 'Show';
  $('password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('password-toggle').setAttribute('aria-pressed', String(visible));
});

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function person(employee) {
  const node = element('div', 'person');
  const initials = employee.name.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join('').toUpperCase();
  const avatar = element('span', 'avatar', initials);
  avatar.dataset.color = String((employee.id - 1) % 5);
  avatar.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'person-copy');
  copy.append(element('strong', '', employee.name), element('p', '', employee.email));
  node.append(avatar, copy);
  return node;
}

function actions(employee) {
  const node = element('div', 'row-actions');
  for (const label of ['Edit', 'Delete']) {
    const button = element('button', '', label);
    button.setAttribute('aria-label', `${label} ${employee.name}`);
    if (label === 'Delete') button.className = 'delete-action';
    button.addEventListener('click', () => label === 'Delete' ? openDelete(employee) : openEditor(employee));
    node.append(button);
  }
  return node;
}

function statePanel({ title, message, icon = '＋', actionLabel, onAction }) {
  const node = element('div', `state-panel${icon === '!' ? ' state-error' : ''}`);
  const iconNode = element('span', 'state-icon', icon);
  iconNode.setAttribute('aria-hidden', 'true');
  if (icon !== '!') {
    const image = element('img');
    image.src = '/assets/empty-symbol.svg';
    image.alt = '';
    iconNode.replaceChildren(image, element('span', '', icon));
  }
  const heading = element('h2', '', title);
  if (icon === '!') heading.replaceChildren(element('span', 'desktop-copy', title), element('span', 'mobile-copy', 'Unable to load employees'));
  node.append(iconNode, heading, element('p', '', message));
  if (actionLabel) {
    const button = element('button', 'primary', actionLabel);
    if (onAction) button.addEventListener('click', onAction);
    else button.disabled = true;
    node.append(button);
  }
  return node;
}

function renderEmployees() {
  const content = $('employee-content');
  content.replaceChildren();
  const count = `${employees.length} ${employees.length === 1 ? 'employee' : 'employees'}`;
  employeeCount(count);
  $('directory').removeAttribute('data-load-error');
  $('add-employee').hidden = !employees.length;
  if (!employees.length) {
    content.append(statePanel({ title: 'No employees yet', message: 'Add your first employee to start building the directory.', actionLabel: 'Add first employee', onAction: () => openEditor() }));
    return;
  }
  const wrap = element('div', 'table-wrap');
  const table = element('table');
  const caption = element('caption', 'sr-only', 'Employee directory');
  const head = element('thead');
  const header = element('tr');
  for (const label of ['Employee', 'Department', 'Job title', 'Actions']) { const th = element('th', '', label); th.scope = 'col'; header.append(th); }
  head.append(header);
  const body = element('tbody');
  const cards = element('div', 'employee-cards');
  for (const employee of employees) {
    const row = element('tr');
    const employeeCell = element('td'); employeeCell.append(person(employee));
    const actionCell = element('td'); actionCell.append(actions(employee));
    row.append(employeeCell, element('td', '', employee.department), element('td', 'employee-role', employee.jobTitle), actionCell);
    body.append(row);
    const card = element('article', 'employee-card');
    if (employee.id === addedEmployeeId) card.style.order = '-1';
    card.append(person(employee));
    card.querySelector('.person p').className = 'sr-only';
    card.querySelector('.person-copy').append(element('p', 'mobile-role', `${employee.department} · ${employee.jobTitle}`));
    card.append(actions(employee));
    cards.append(card);
  }
  table.append(caption, head, body);
  wrap.append(table, element('p', 'table-footer', `Showing 1–${employees.length} of ${count}`));
  content.append(wrap, cards);
}

function employeeCount(message) {
  $('employee-count').textContent = $('mobile-employee-count').textContent = message;
}

async function loadDirectory({ force = false } = {}) {
  if ((directoryPending && !force) || !user) return false;
  const version = authVersion;
  const listVersion = ++directoryVersion;
  directoryPending = true;
  $('refresh').disabled = true;
  $('refresh').textContent = 'Loading…';
  $('employee-content').setAttribute('aria-busy', 'true');
  notice('directory-message');
  if (employees === null) {
    employeeCount('Loading employees…');
    $('add-employee').hidden = false;
    $('directory').removeAttribute('data-load-error');
    const skeleton = element('div', 'skeleton'); skeleton.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) { const row = element('div', 'skeleton-row'); row.append(element('span'), element('span'), element('span')); skeleton.append(row); }
    $('employee-content').replaceChildren(skeleton);
  }
  announce('Loading employee directory.');
  try {
    const data = await request('/api/employees');
    if (version !== authVersion || listVersion !== directoryVersion) return false;
    if (!Array.isArray(data) || data.some((entry) => !validEmployee(entry))) throw new Error('Invalid employee response');
    employees = data;
    renderEmployees();
    announce($('employee-count').textContent + ' loaded.');
    return true;
  } catch (error) {
    if (version !== authVersion || listVersion !== directoryVersion) return false;
    if (error.status === 401) { showLogin('Your session has expired. Sign in again to continue.', true); return false; }
    const message = errorMessage(error, 'directory');
    if (employees === null) {
      employeeCount('Records unavailable');
      $('directory').setAttribute('data-load-error', '');
      $('add-employee').hidden = true;
      const description = !error.status || error.status >= 500 ? 'Your records are safe. Check your connection and retry.' : message;
      $('employee-content').replaceChildren(statePanel({ title: 'We couldn’t load employees', message: description, icon: '!', actionLabel: 'Try again', onAction: loadDirectory }));
    } else {
      notice('directory-message', `${message} Previously loaded records are still shown. Use Refresh directory to retry.`);
    }
    announce(message);
    return false;
  } finally {
    if (version === authVersion && listVersion === directoryVersion) {
      directoryPending = false;
      $('refresh').disabled = false;
      $('refresh').textContent = 'Refresh directory';
      $('employee-content').setAttribute('aria-busy', 'false');
    }
  }
}

function validEmployee(value) {
  return value && Number.isSafeInteger(value.id) && value.id > 0
    && Object.keys(employeeFields).every((key) => typeof value[key] === 'string' && value[key].trim())
    && ['createdAt', 'updatedAt'].every((key) => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key])));
}

function readEmployeeValues() {
  return Object.fromEntries(Object.keys(employeeFields).map((key) => [key, $(`employee-${key}`).value]));
}

function employeeFieldError(key, message) {
  $(`employee-${key}`).setAttribute('aria-invalid', 'true');
  notice(`employee-${key}-error`, message);
}

function clearEmployeeErrors() {
  for (const key of Object.keys(employeeFields)) {
    $(`employee-${key}`).removeAttribute('aria-invalid');
    notice(`employee-${key}-error`);
  }
  notice('employee-message');
  $('employee-hint').hidden = !!editedEmployee;
}

function validateEmployee() {
  clearEmployeeErrors();
  const values = readEmployeeValues();
  let firstInvalid = null;
  for (const [key, [label, max]] of Object.entries(employeeFields)) {
    values[key] = values[key].trim();
    let message = !values[key] ? `${label} is required.` : [...values[key]].length > max ? `Use no more than ${max} characters.` : '';
    if (!message && key === 'email' && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(values[key])) message = 'Enter a valid work email address.';
    if (message) { employeeFieldError(key, message); firstInvalid ??= key; }
  }
  if (firstInvalid) { $(`employee-${firstInvalid}`).focus(); return null; }
  values.email = values.email.toLowerCase();
  return values;
}

function placeEditorAccount() {
  const inEditor = $('employee-dialog').open && mobileEditor.matches;
  const target = inEditor ? $('editor-account') : document.querySelector('#directory .topbar');
  if ($('account').parentElement !== target) target.append($('account'));
  const viewport = window.visualViewport;
  $('employee-dialog').style.height = inEditor ? `${viewport?.height ?? window.innerHeight}px` : '';
  $('employee-dialog').style.top = inEditor ? `${viewport?.offsetTop ?? 0}px` : '';
  if (inEditor && $('employee-form').contains(document.activeElement) && document.activeElement.matches('input')) {
    document.activeElement.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  if ($('employee-dialog').open && !editedEmployee) {
    $('employee-description').textContent = mobileEditor.matches ? 'Enter the required details for the directory.' : 'Add the details you need for the team directory.';
    $('employee-hint').textContent = mobileEditor.matches ? 'All four fields are required.' : 'All four fields are required. Email addresses are saved lowercase.';
  }
}

function openEditor(employee = null, values = employee) {
  if (!user || savePending || $('delete-dialog').open) return;
  closeAccount();
  editorTrigger = document.activeElement;
  editedEmployee = employee;
  $('employee-form').reset();
  clearEmployeeErrors();
  for (const key of Object.keys(employeeFields)) $(`employee-${key}`).value = values?.[key] ?? '';
  $('employee-title').textContent = employee ? 'Edit employee' : 'Add employee';
  $('employee-description').textContent = employee ? `Update ${employee.name}’s directory details.` : 'Add the details you need for the team directory.';
  $('employee-submit').textContent = employee ? 'Save changes' : 'Create employee';
  $('employee-metadata').hidden = !employee;
  $('employee-metadata').textContent = employee ? `Employee ID #${employee.id} · Created ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(employee.createdAt))}` : '';
  $('save-confirmation').hidden = true;
  $('employee-dialog').showModal();
  document.body.classList.add('editor-open');
  placeEditorAccount();
  $('employee-name').focus();
}

function closeEditor(restoreFocus = true) {
  if (!$('employee-dialog').open) return;
  closeAccount();
  $('employee-dialog').close();
  document.body.classList.remove('editor-open');
  placeEditorAccount();
  editedEmployee = null;
  if (restoreFocus) {
    const trigger = editorTrigger?.isConnected && editorTrigger.getClientRects().length ? editorTrigger : $('directory-title');
    trigger.focus();
  }
}

function setSavePending(pending) {
  savePending = pending;
  $('employee-form').setAttribute('aria-busy', String(pending));
  for (const key of Object.keys(employeeFields)) $(`employee-${key}`).readOnly = pending;
  for (const id of ['employee-submit', 'employee-cancel', 'employee-back', 'sign-out']) $(id).disabled = pending;
  $('employee-submit').textContent = pending ? (editedEmployee ? 'Saving…' : 'Creating…') : (editedEmployee ? 'Save changes' : 'Create employee');
}

function employeeSaveError(error) {
  if (error.status === 400) return 'The request could not be accepted. Check your entered values and try again.';
  if (error.status === 403) return 'Your request was rejected. Your values are kept. Try saving again; if it is still rejected, refresh the page.';
  if (error.status === 404) return 'This employee is no longer available. Your values are kept. Cancel to return to the directory.';
  if (error.status === 409) return 'Choose a different work email before saving.';
  if (error.status === 413) return 'The request is too large. Check field lengths before trying again.';
  if (error.status === 415) return 'The server rejected the request format. Your values are kept. Refresh the page if retrying fails.';
  if (error.status === 429) return errorMessage(error, 'employee');
  return 'Couldn’t confirm this save. Check your connection and refresh the directory before retrying.';
}

$('employee-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (savePending || !user) return;
  const values = validateEmployee();
  if (!values) return;
  const version = authVersion;
  const employee = editedEmployee;
  setSavePending(true);
  try {
    if (!csrfToken) await getCsrf();
    if (version !== authVersion) return;
    const saved = await request(employee ? `/api/employees/${employee.id}` : '/api/employees', {
      method: employee ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(values),
    });
    if (version !== authVersion) return;
    if (!validEmployee(saved) || (employee && saved.id !== employee.id)) throw new Error('Invalid employee response');
    if (!employee) addedEmployeeId = saved.id;
    closeEditor(false);
    const refreshed = await loadDirectory({ force: true });
    if (version !== authVersion) {
      if (!user) notice('login-message', 'Your employee was saved, but your session has expired. Sign in again to refresh the directory.');
      return;
    }
    $('save-title').textContent = employee ? 'Changes saved' : 'Employee added';
    $('save-confirmation').removeAttribute('data-deleted');
    $('save-title').toggleAttribute('data-created', !employee);
    $('save-detail').textContent = refreshed ? (employee ? 'Employee details are up to date.' : `${saved.name} is in the directory.`) : 'Saved successfully. The directory could not refresh; use Refresh directory to see the latest records.';
    $('save-confirmation').hidden = false;
    $('directory-title').focus({ preventScroll: true });
    if (mobileEditor.matches) window.scrollTo({ top: 0, behavior: 'instant' });
    announce(`${$('save-title').textContent}. ${$('save-detail').textContent}`);
  } catch (error) {
    if (version !== authVersion) return;
    if (error.status === 401) { showLogin('Your session has expired. Sign in again to continue. Your entered values are kept.', true); return; }
    if (error.status === 403) csrfToken = null;
    if (error.status === 409 || error.code === 'INVALID_EMAIL') {
      employeeFieldError('email', error.status === 409 ? 'This email is already in use.' : 'Enter a valid work email address.');
      $('employee-email').focus();
    }
    $('employee-hint').hidden = true;
    notice('employee-message', employeeSaveError(error));
    $('employee-message').toggleAttribute('data-warning', error.status === 403);
  } finally {
    setSavePending(false);
  }
});

function updateDeleteTitle() {
  if (deletedEmployee) $('delete-title').textContent = mobileEditor.matches ? `Delete ${deletedEmployee.name}?` : 'Delete this employee?';
}

function openDelete(employee) {
  if (!user || deletePending || savePending || $('employee-dialog').open || $('delete-dialog').open) return;
  closeAccount();
  deleteTrigger = document.activeElement;
  deletedEmployee = employee;
  updateDeleteTitle();
  $('delete-description').textContent = `${employee.name} and their employee record will be permanently removed.`;
  $('delete-email').textContent = employee.email;
  notice('delete-message');
  $('save-confirmation').hidden = true;
  $('delete-dialog').showModal();
  document.body.classList.add('delete-open');
  $('delete-cancel').focus();
}

function closeDelete(restoreFocus = true) {
  if (!$('delete-dialog').open) return;
  $('delete-dialog').close();
  document.body.classList.remove('delete-open');
  deletedEmployee = null;
  if (restoreFocus) {
    const trigger = deleteTrigger?.isConnected && deleteTrigger.getClientRects().length ? deleteTrigger : $('directory-title');
    trigger.focus();
  }
}

function setDeletePending(pending) {
  deletePending = pending;
  $('delete-form').setAttribute('aria-busy', String(pending));
  $('delete-submit').disabled = $('delete-cancel').disabled = pending;
  $('delete-submit').textContent = pending ? 'Deleting…' : 'Delete employee';
}

$('delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (deletePending || !user || !deletedEmployee) return;
  const employee = deletedEmployee;
  const version = authVersion;
  setDeletePending(true);
  notice('delete-message');
  try {
    if (!csrfToken) await getCsrf();
    if (version !== authVersion) return;
    await request(`/api/employees/${employee.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
    if (version !== authVersion) return;
    // Invalidate pre-deletion list responses before updating the confirmed local list.
    directoryVersion++;
    directoryPending = false;
    $('refresh').disabled = false;
    $('refresh').textContent = 'Refresh directory';
    $('employee-content').setAttribute('aria-busy', 'false');
    if (employees !== null) {
      employees = employees.filter((record) => record.id !== employee.id);
      renderEmployees();
    } else loadDirectory({ force: true });
    if (addedEmployeeId === employee.id) addedEmployeeId = null;
    closeDelete(false);
    $('save-confirmation').setAttribute('data-deleted', '');
    $('save-title').removeAttribute('data-created');
    $('save-title').textContent = 'Employee deleted';
    $('save-detail').textContent = `${employee.name} was removed.`;
    $('save-confirmation').hidden = false;
    $('directory-title').focus({ preventScroll: true });
    if (mobileEditor.matches) window.scrollTo({ top: 0, behavior: 'instant' });
    announce(`Employee deleted. ${employee.name} was removed.`);
  } catch (error) {
    if (version !== authVersion) return;
    if (error.status === 401) {
      showLogin('Your session has expired. Sign in again to review your deletion. Nothing will be retried automatically.', true);
      return;
    }
    if (error.status === 403) csrfToken = null;
    const message = error.status === 403 ? 'Your request was rejected. Try again safely; if it is still rejected, refresh the page.'
      : error.status === 404 ? 'This employee is no longer available. Keep employee closes this prompt; refresh the directory to see the latest records.'
      : error.status === 429 ? errorMessage(error, 'employee')
      : 'Couldn’t confirm this deletion. Keep employee closes this prompt; check your connection and refresh the directory before retrying.';
    notice('delete-message', message);
    $('delete-message').toggleAttribute('data-warning', error.status === 403);
  } finally {
    setDeletePending(false);
  }
});
$('delete-cancel').addEventListener('click', () => { if (!deletePending) closeDelete(); });
$('delete-dialog').addEventListener('cancel', (event) => { event.preventDefault(); if (!deletePending) closeDelete(); });
mobileEditor.addEventListener('change', updateDeleteTitle);

$('add-employee').addEventListener('click', () => openEditor());
for (const id of ['employee-cancel', 'employee-back']) $(id).addEventListener('click', () => { if (!savePending) closeEditor(); });
$('employee-dialog').addEventListener('cancel', (event) => { event.preventDefault(); if (!savePending) closeEditor(); });
mobileEditor.addEventListener('change', placeEditorAccount);
window.visualViewport?.addEventListener('resize', placeEditorAccount);
window.visualViewport?.addEventListener('scroll', placeEditorAccount);

$('account-toggle').addEventListener('click', () => {
  if (!$('account-panel').hidden) return closeAccount(true);
  $('account-panel').hidden = false;
  $('account-toggle').setAttribute('aria-expanded', 'true');
  $('sign-out').focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('account-panel').hidden) {
    event.preventDefault();
    closeAccount(true);
  }
});
document.addEventListener('click', (event) => { if (!$('account').contains(event.target)) closeAccount(); });
$('account').addEventListener('focusout', (event) => { if (!$('account').contains(event.relatedTarget)) closeAccount(); });
$('sign-out').addEventListener('click', async () => {
  if ($('sign-out').disabled) return;
  const version = authVersion;
  $('sign-out').disabled = true;
  $('sign-out').textContent = 'Signing out…';
  notice('directory-message');
  try {
    if (!csrfToken) await getCsrf();
    if (version !== authVersion) return;
    const result = await request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    if (result !== null) throw new Error('Unexpected logout response');
    if (version === authVersion) showLogin('You have signed out.');
  } catch (error) {
    if (version !== authVersion) return;
    if (error.status === 401) showLogin('Your session has expired. Sign in again to continue.', true);
    else {
      if (error.status === 403) csrfToken = null;
      closeAccount(true);
      $('account-toggle').focus();
      const inEditor = $('employee-dialog').open;
      if (inEditor) $('employee-hint').hidden = true;
      notice(inEditor ? 'employee-message' : 'directory-message', errorMessage(error, 'logout'));
    }
  } finally {
    $('sign-out').disabled = false;
    $('sign-out').textContent = 'Sign out';
  }
});
$('refresh').addEventListener('click', loadDirectory);
$('startup-retry').addEventListener('click', startup);
window.addEventListener('pageshow', (event) => { if (event.persisted) startup(); });
startup();
