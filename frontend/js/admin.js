/**
 * admin.js – Admin panel logic
 */

let currentAdmin = null;
let userPage     = 1;
let userTotal    = 0;
let userLimit    = 20;
let confirmCallback = null;

// ── Auth guard ─────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res  = await api.get('/auth/me');
    if (!res.ok) { window.location.href = '/'; return false; }
    const data = await res.json();
    currentAdmin = data.user;
    if (currentAdmin.role !== 'admin') { window.location.href = '/dashboard'; return false; }
    sessionStorage.setItem('user', JSON.stringify(currentAdmin));
    return true;
  } catch {
    window.location.href = '/';
    return false;
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const ok = await checkAuth();
  if (!ok) return;

  document.getElementById('nav-username').textContent = currentAdmin.full_name;
  initNavSections('#main-nav', 'section-');
  document.getElementById('logout-btn').addEventListener('click', logout);

  loadStats();
  loadUsers();
  loadCourses();
  loadAnnouncements();

  // Nav refresh
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const s = link.dataset.section;
      if (s === 'dashboard')     loadStats();
      if (s === 'users')         loadUsers();
      if (s === 'courses')       loadCourses();
      if (s === 'announcements') loadAnnouncements();
    });
  });

  // User filters
  let searchTimer;
  document.getElementById('user-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { userPage = 1; loadUsers(); }, 350);
  });
  document.getElementById('user-role-filter').addEventListener('change', () => { userPage = 1; loadUsers(); });

  // Modal triggers
  document.getElementById('btn-create-user').addEventListener('click', () => openUserModal());
  document.getElementById('btn-create-course').addEventListener('click', () => openCourseModal());
  document.getElementById('btn-create-ann').addEventListener('click', () => openAnnModal());

  // Modal closes
  setupModal('modal-user',    ['modal-user-close',    'modal-user-cancel',   'modal-user-overlay']);
  setupModal('modal-course',  ['modal-course-close',  'modal-course-cancel', 'modal-course-overlay']);
  setupModal('modal-ann',     ['modal-ann-close',     'modal-ann-cancel',    'modal-ann-overlay']);
  setupModal('modal-confirm', ['modal-confirm-close', 'confirm-cancel',      'modal-confirm-overlay']);
  setupModal('modal-user-detail', ['modal-detail-close', 'modal-detail-overlay']);

  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (confirmCallback) confirmCallback();
  });

  // Form submissions
  document.getElementById('user-form').addEventListener('submit', submitUserForm);
  document.getElementById('course-form').addEventListener('submit', submitCourseForm);
  document.getElementById('ann-form').addEventListener('submit', submitAnnForm);
}

async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
  sessionStorage.clear();
  window.location.href = '/';
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function setupModal(modalId, closeTriggerIds) {
  closeTriggerIds.forEach(triggerId => {
    const el = document.getElementById(triggerId);
    if (el) el.addEventListener('click', () => closeModal(modalId));
  });
}

function showConfirm(message, cb) {
  document.getElementById('modal-confirm-msg').textContent = message;
  confirmCallback = cb;
  openModal('modal-confirm');
}

// ── Stats ──────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await api.get('/admin/stats');
    const { stats } = await api.json(res);
    document.getElementById('stat-total-students').textContent   = stats.total_students;
    document.getElementById('stat-active-students').textContent  = stats.active_students;
    document.getElementById('stat-total-courses').textContent    = stats.total_courses;
    document.getElementById('stat-total-enrollments').textContent = stats.total_enrollments;
  } catch { /* silent */ }
}

// ── Users ──────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody    = document.getElementById('users-tbody');
  const alertEl  = document.getElementById('users-alert');
  const search   = document.getElementById('user-search').value.trim();
  const role     = document.getElementById('user-role-filter').value;

  tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading…</td></tr>';
  hideAlert(alertEl);

  let url = `/admin/users?page=${userPage}&limit=${userLimit}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (role)   url += `&role=${encodeURIComponent(role)}`;

  try {
    const res  = await api.get(url);
    const data = await api.json(res);
    userTotal  = data.total;

    if (!data.users.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem;">No users found.</td></tr>';
      renderPagination();
      return;
    }

    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>${escapeHtml(u.full_name)}</td>
        <td><code>${escapeHtml(u.username)}</code></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-orange' : 'badge-blue'}">${u.role}</span></td>
        <td>${u.student_id ? escapeHtml(u.student_id) : '–'}</td>
        <td><span class="badge ${u.is_active ? 'badge-green' : 'badge-red'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
        <td>${formatDate(u.created_at)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-ghost btn-xs" onclick="viewUser(${u.id})">View</button>
            <button class="btn btn-ghost btn-xs" onclick="openUserModal(${u.id})">Edit</button>
            ${u.id !== currentAdmin.id
              ? `<button class="btn btn-danger btn-xs" onclick="deleteUser(${u.id}, '${escapeHtml(u.full_name)}')">Delete</button>`
              : '<span style="font-size:.75rem;color:var(--text-muted)">(you)</span>'
            }
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination();
  } catch (err) {
    showAlert(alertEl, err.message, 'error');
  }
}

function renderPagination() {
  const pag     = document.getElementById('user-pagination');
  const pages   = Math.ceil(userTotal / userLimit);
  pag.innerHTML = '';
  if (pages <= 1) return;

  const prev = document.createElement('button');
  prev.textContent = '← Prev';
  prev.disabled    = userPage <= 1;
  prev.addEventListener('click', () => { userPage--; loadUsers(); });
  pag.appendChild(prev);

  for (let p = Math.max(1, userPage - 2); p <= Math.min(pages, userPage + 2); p++) {
    const btn = document.createElement('button');
    btn.textContent = p;
    btn.className   = p === userPage ? 'active' : '';
    btn.addEventListener('click', () => { userPage = p; loadUsers(); });
    pag.appendChild(btn);
  }

  const next = document.createElement('button');
  next.textContent = 'Next →';
  next.disabled    = userPage >= pages;
  next.addEventListener('click', () => { userPage++; loadUsers(); });
  pag.appendChild(next);

  const info = document.createElement('span');
  info.style.cssText = 'font-size:.8rem;color:var(--text-muted);margin-left:.5rem;';
  info.textContent   = `${userTotal} total`;
  pag.appendChild(info);
}

// ── User Modal ─────────────────────────────────────────────────────────────────
async function openUserModal(userId = null) {
  const form    = document.getElementById('user-form');
  const title   = document.getElementById('modal-user-title');
  const submit  = document.getElementById('user-form-submit');
  const alertEl = document.getElementById('modal-user-alert');

  form.reset();
  hideAlert(alertEl);
  document.getElementById('user-form-id').value = '';
  document.getElementById('uf-username').readOnly = false;
  document.getElementById('uf-password-group').style.display = '';
  document.getElementById('uf-status-group').style.display   = 'none';

  if (userId) {
    title.textContent  = 'Edit User';
    submit.textContent = 'Save Changes';

    try {
      const res  = await api.get(`/admin/users/${userId}`);
      const { user } = await api.json(res);

      document.getElementById('user-form-id').value  = user.id;
      document.getElementById('uf-name').value       = user.full_name;
      document.getElementById('uf-email').value      = user.email;
      document.getElementById('uf-username').value   = user.username;
      document.getElementById('uf-username').readOnly = true;
      document.getElementById('uf-role').value       = user.role;
      document.getElementById('uf-active').checked   = !!user.is_active;
      document.getElementById('uf-password-group').style.display = 'none';
      document.getElementById('uf-status-group').style.display   = '';
    } catch (err) {
      showAlert(alertEl, err.message, 'error');
    }
  } else {
    title.textContent  = 'Create User';
    submit.textContent = 'Create User';
  }

  openModal('modal-user');
}

async function submitUserForm(e) {
  e.preventDefault();
  const alertEl = document.getElementById('modal-user-alert');
  hideAlert(alertEl);

  const id        = document.getElementById('user-form-id').value;
  const full_name = document.getElementById('uf-name').value.trim();
  const email     = document.getElementById('uf-email').value.trim();
  const username  = document.getElementById('uf-username').value.trim();
  const password  = document.getElementById('uf-password').value;
  const role      = document.getElementById('uf-role').value;
  const is_active = document.getElementById('uf-active').checked;

  try {
    let res;
    if (id) {
      res = await api.put(`/admin/users/${id}`, { full_name, email, role, is_active });
    } else {
      if (!username) { showAlert(alertEl, 'Username required.', 'error'); return; }
      if (!password) { showAlert(alertEl, 'Password required.', 'error'); return; }
      res = await api.post('/admin/users', { full_name, email, username, password, role });
    }
    const data = await res.json();
    if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }

    closeModal('modal-user');
    loadUsers();
    loadStats();
  } catch {
    showAlert(alertEl, 'Operation failed. Please try again.', 'error');
  }
}

async function deleteUser(userId, name) {
  showConfirm(`Delete user "${name}"? This action cannot be undone.`, async () => {
    const alertEl = document.getElementById('users-alert');
    try {
      const res  = await api.delete(`/admin/users/${userId}`);
      const data = await res.json();
      if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
      showAlert(alertEl, `User "${name}" deleted.`, 'success');
      loadUsers();
      loadStats();
    } catch {
      showAlert(alertEl, 'Delete failed.', 'error');
    }
  });
}

async function viewUser(userId) {
  const body = document.getElementById('user-detail-body');
  body.innerHTML = '<div class="loading">Loading…</div>';
  openModal('modal-user-detail');

  try {
    const res  = await api.get(`/admin/users/${userId}`);
    const { user, enrollments } = await api.json(res);

    body.innerHTML = `
      <div style="display:grid;gap:.75rem;margin-bottom:1.25rem;">
        <div><strong>Name:</strong> ${escapeHtml(user.full_name)}</div>
        <div><strong>Username:</strong> <code>${escapeHtml(user.username)}</code></div>
        <div><strong>Email:</strong> ${escapeHtml(user.email)}</div>
        <div><strong>Role:</strong> <span class="badge ${user.role === 'admin' ? 'badge-orange' : 'badge-blue'}">${user.role}</span></div>
        <div><strong>Student ID:</strong> ${user.student_id || '–'}</div>
        <div><strong>Status:</strong> <span class="badge ${user.is_active ? 'badge-green' : 'badge-red'}">${user.is_active ? 'Active' : 'Disabled'}</span></div>
        <div><strong>Joined:</strong> ${formatDate(user.created_at)}</div>
        <div><strong>Last Login:</strong> ${formatDateTime(user.last_login)}</div>
      </div>
      ${enrollments.length ? `
        <h4 style="margin-bottom:.75rem;">Enrolled Courses (${enrollments.length})</h4>
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>Code</th><th>Name</th><th>Status</th><th>Grade</th></tr></thead>
            <tbody>
              ${enrollments.map(en => `
                <tr>
                  <td>${escapeHtml(en.code)}</td>
                  <td>${escapeHtml(en.name)}</td>
                  <td>${escapeHtml(en.status)}</td>
                  <td>${en.grade || '–'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p style="color:var(--text-muted);">No enrollments.</p>'}
    `;
  } catch (err) {
    body.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
  }
}

// ── Courses ────────────────────────────────────────────────────────────────────
async function loadCourses() {
  const tbody   = document.getElementById('courses-tbody');
  const alertEl = document.getElementById('courses-alert');
  tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading…</td></tr>';
  hideAlert(alertEl);

  try {
    const res  = await api.get('/admin/courses');
    const { courses } = await api.json(res);

    if (!courses.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:2rem;">No courses found.</td></tr>';
      return;
    }

    tbody.innerHTML = courses.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.code)}</strong></td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.instructor)}</td>
        <td>${c.credits}</td>
        <td>${escapeHtml(c.semester)}</td>
        <td>${c.enrolled_count}</td>
        <td>${c.capacity}</td>
        <td><span class="badge ${c.is_active ? 'badge-green' : 'badge-gray'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-ghost btn-xs" onclick="openCourseModal(${c.id})">Edit</button>
            <button class="btn btn-ghost btn-xs" onclick="toggleCourse(${c.id}, ${c.is_active}, '${escapeHtml(c.name)}')">
              ${c.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showAlert(alertEl, err.message, 'error');
  }
}

async function openCourseModal(courseId = null) {
  const form    = document.getElementById('course-form');
  const title   = document.getElementById('modal-course-title');
  const submit  = document.getElementById('course-form-submit');
  const alertEl = document.getElementById('modal-course-alert');

  form.reset();
  hideAlert(alertEl);
  document.getElementById('course-form-id').value = '';
  document.getElementById('cf-code').readOnly     = false;

  if (courseId) {
    title.textContent  = 'Edit Course';
    submit.textContent = 'Save Changes';

    const res  = await api.get('/admin/courses');
    const { courses } = await api.json(res);
    const course = courses.find(c => c.id === courseId);
    if (course) {
      document.getElementById('course-form-id').value = course.id;
      document.getElementById('cf-code').value        = course.code;
      document.getElementById('cf-code').readOnly     = true;
      document.getElementById('cf-name').value        = course.name;
      document.getElementById('cf-instructor').value  = course.instructor;
      document.getElementById('cf-credits').value     = course.credits;
      document.getElementById('cf-semester').value    = course.semester;
      document.getElementById('cf-capacity').value    = course.capacity;
      document.getElementById('cf-description').value = course.description || '';
    }
  } else {
    title.textContent  = 'Create Course';
    submit.textContent = 'Create Course';
  }

  openModal('modal-course');
}

async function submitCourseForm(e) {
  e.preventDefault();
  const alertEl = document.getElementById('modal-course-alert');
  hideAlert(alertEl);

  const id          = document.getElementById('course-form-id').value;
  const code        = document.getElementById('cf-code').value.trim().toUpperCase();
  const name        = document.getElementById('cf-name').value.trim();
  const instructor  = document.getElementById('cf-instructor').value.trim();
  const credits     = parseInt(document.getElementById('cf-credits').value, 10);
  const semester    = document.getElementById('cf-semester').value.trim();
  const capacity    = parseInt(document.getElementById('cf-capacity').value, 10);
  const description = document.getElementById('cf-description').value.trim();

  try {
    let res;
    if (id) {
      res = await api.put(`/admin/courses/${id}`, { name, instructor, credits });
    } else {
      res = await api.post('/admin/courses', { code, name, instructor, credits, semester, capacity, description });
    }
    const data = await res.json();
    if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
    closeModal('modal-course');
    loadCourses();
  } catch {
    showAlert(alertEl, 'Operation failed.', 'error');
  }
}

async function toggleCourse(id, currentActive, name) {
  const action = currentActive ? 'deactivate' : 'activate';
  showConfirm(`${action.charAt(0).toUpperCase() + action.slice(1)} course "${name}"?`, async () => {
    try {
      await api.put(`/admin/courses/${id}`, { is_active: !currentActive });
      loadCourses();
    } catch { /* silent */ }
  });
}

// ── Announcements ──────────────────────────────────────────────────────────────
async function loadAnnouncements() {
  const container = document.getElementById('announcements-list');
  const alertEl   = document.getElementById('ann-alert');
  container.innerHTML = '<div class="loading">Loading…</div>';
  hideAlert(alertEl);

  try {
    const res  = await api.get('/admin/announcements');
    const { announcements } = await api.json(res);

    if (!announcements.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">No announcements yet.</p>';
      return;
    }

    container.innerHTML = announcements.map(a => `
      <div class="ann-card">
        <div class="ann-card-header">
          <div>
            <div class="ann-card-title">${escapeHtml(a.title)}</div>
            <div class="ann-item-meta">${escapeHtml(a.author)} &middot; ${formatDateTime(a.created_at)} &middot;
              <span class="badge badge-blue">${escapeHtml(a.target)}</span>
              ${!a.is_active ? '<span class="badge badge-gray">Removed</span>' : ''}
            </div>
          </div>
          ${a.is_active ? `<button class="btn btn-danger btn-xs" onclick="deleteAnn(${a.id}, '${escapeHtml(a.title)}')">Remove</button>` : ''}
        </div>
        <div class="ann-item-body">${escapeHtml(a.content)}</div>
      </div>
    `).join('');
  } catch (err) {
    showAlert(alertEl, err.message, 'error');
  }
}

function openAnnModal() {
  document.getElementById('ann-form').reset();
  hideAlert(document.getElementById('modal-ann-alert'));
  openModal('modal-ann');
}

async function submitAnnForm(e) {
  e.preventDefault();
  const alertEl = document.getElementById('modal-ann-alert');
  hideAlert(alertEl);

  const title   = document.getElementById('af-title').value.trim();
  const content = document.getElementById('af-content').value.trim();
  const target  = document.getElementById('af-target').value;

  try {
    const res  = await api.post('/admin/announcements', { title, content, target });
    const data = await res.json();
    if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
    closeModal('modal-ann');
    loadAnnouncements();
  } catch {
    showAlert(alertEl, 'Failed to publish announcement.', 'error');
  }
}

async function deleteAnn(id, title) {
  showConfirm(`Remove announcement "${title}"?`, async () => {
    const alertEl = document.getElementById('ann-alert');
    try {
      const res  = await api.delete(`/admin/announcements/${id}`);
      const data = await res.json();
      if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
      loadAnnouncements();
    } catch {
      showAlert(alertEl, 'Delete failed.', 'error');
    }
  });
}

init();
