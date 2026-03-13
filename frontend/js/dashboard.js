/**
 * dashboard.js – Student dashboard logic
 */

let currentUser = null;

// ── Auth guard ─────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res  = await api.get('/auth/me');
    if (!res.ok) { window.location.href = '/'; return false; }
    const data = await res.json();
    currentUser = data.user;
    if (currentUser.role === 'admin') { window.location.href = '/admin'; return false; }
    sessionStorage.setItem('user', JSON.stringify(currentUser));
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

  // Set username badge
  document.getElementById('nav-username').textContent = currentUser.full_name || currentUser.username;

  // Initialise navigation
  initNavSections('#main-nav', 'section-');

  // Initialise password toggles
  initPasswordToggles();

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Load all data
  loadOverview();
  loadMyCourses();
  loadBrowseCourses();
  loadAnnouncements();
  loadProfile();
  initPasswordForm();

  // Re-load browse when navigating to it
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (link.dataset.section === 'browse-courses') loadBrowseCourses();
      if (link.dataset.section === 'my-courses')     loadMyCourses();
      if (link.dataset.section === 'announcements')  loadAnnouncements();
      if (link.dataset.section === 'overview')       loadOverview();
    });
  });
}

// ── Logout ─────────────────────────────────────────────────────────────────────
async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
  sessionStorage.clear();
  window.location.href = '/';
}

// ── Overview ───────────────────────────────────────────────────────────────────
async function loadOverview() {
  document.getElementById('greeting-name').textContent = currentUser.full_name.split(' ')[0];
  document.getElementById('stat-student-id').textContent = currentUser.student_id || '–';

  const [coursesRes, annRes] = await Promise.all([
    api.get('/student/courses'),
    api.get('/student/announcements'),
  ]);

  if (coursesRes.ok) {
    const { courses } = await coursesRes.json();
    const active  = courses.filter(c => c.status === 'active');
    const credits = active.reduce((s, c) => s + c.credits, 0);
    document.getElementById('stat-courses').textContent = active.length;
    document.getElementById('stat-credits').textContent = credits;

    const container = document.getElementById('overview-courses');
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;">No courses enrolled yet. <a href="#browse-courses">Browse courses</a>.</p>';
    } else {
      container.innerHTML = active.slice(0, 4).map(c => `
        <div class="ann-item">
          <div class="ann-item-title">${escapeHtml(c.name)}</div>
          <div class="ann-item-meta">${escapeHtml(c.code)} &middot; ${c.credits} credits &middot; <span class="badge badge-blue">${escapeHtml(c.semester)}</span></div>
        </div>
      `).join('');
    }
  }

  if (annRes.ok) {
    const { announcements } = await annRes.json();
    document.getElementById('stat-announcements').textContent = announcements.length;

    const container = document.getElementById('overview-announcements');
    if (!announcements.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;">No announcements.</p>';
    } else {
      container.innerHTML = announcements.slice(0, 3).map(a => `
        <div class="ann-item">
          <div class="ann-item-title">${escapeHtml(a.title)}</div>
          <div class="ann-item-meta">${escapeHtml(a.author)} &middot; ${formatDate(a.created_at)}</div>
        </div>
      `).join('');
    }
  }
}

// ── My Courses ─────────────────────────────────────────────────────────────────
async function loadMyCourses() {
  const container = document.getElementById('my-courses-list');
  container.innerHTML = '<div class="loading">Loading…</div>';

  try {
    const res  = await api.get('/student/courses');
    const data = await api.json(res);
    const { courses } = data;

    if (!courses.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">You are not enrolled in any courses. <a href="#browse-courses" class="nav-link-inline">Browse available courses.</a></p>';
      return;
    }

    container.innerHTML = courses.map(c => `
      <div class="course-card">
        <div class="course-card-top">
          <div>
            <div class="course-code">${escapeHtml(c.code)}</div>
            <div class="course-name">${escapeHtml(c.name)}</div>
          </div>
          ${statusBadge(c.status)}
        </div>
        <div class="course-desc">${escapeHtml(c.description || '')}</div>
        <div class="course-meta">
          Instructor: <span>${escapeHtml(c.instructor)}</span> &nbsp;&middot;&nbsp;
          Credits: <span>${c.credits}</span> &nbsp;&middot;&nbsp;
          ${c.grade ? `Grade: <span>${escapeHtml(c.grade)}</span>` : ''}
        </div>
        <div class="course-meta">Enrolled: ${formatDate(c.enrolled_at)}</div>
        <div class="course-actions">
          ${c.status === 'active' ? `<button class="btn btn-ghost btn-xs" onclick="dropCourse(${c.id}, '${escapeHtml(c.name)}')">Drop Course</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
  }
}

function statusBadge(status) {
  const map = { active: 'badge-green', dropped: 'badge-red', completed: 'badge-blue' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
}

async function dropCourse(courseId, courseName) {
  if (!confirm(`Drop "${courseName}"? You can re-enroll later.`)) return;
  try {
    const res = await api.delete(`/student/courses/${courseId}/drop`);
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    loadMyCourses();
    loadOverview();
  } catch (err) {
    showAlert(document.getElementById('dash-alert'), err.message);
  }
}

// ── Browse Courses ─────────────────────────────────────────────────────────────
async function loadBrowseCourses() {
  const container  = document.getElementById('browse-courses-list');
  const alertEl    = document.getElementById('browse-alert');
  container.innerHTML = '<div class="loading">Loading…</div>';
  hideAlert(alertEl);

  try {
    const res  = await api.get('/student/courses/available');
    const { courses } = await api.json(res);

    if (!courses.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">No additional courses available.</p>';
      return;
    }

    container.innerHTML = courses.map(c => {
      const full = c.enrolled_count >= c.capacity;
      return `
        <div class="course-card">
          <div class="course-card-top">
            <div>
              <div class="course-code">${escapeHtml(c.code)}</div>
              <div class="course-name">${escapeHtml(c.name)}</div>
            </div>
            ${full ? '<span class="badge badge-red">Full</span>' : '<span class="badge badge-green">Open</span>'}
          </div>
          <div class="course-desc">${escapeHtml(c.description || '')}</div>
          <div class="course-meta">
            Instructor: <span>${escapeHtml(c.instructor)}</span> &nbsp;&middot;&nbsp;
            Credits: <span>${c.credits}</span> &nbsp;&middot;&nbsp;
            Seats: <span>${c.enrolled_count}/${c.capacity}</span>
          </div>
          <div class="course-meta">Semester: <span>${escapeHtml(c.semester)}</span></div>
          <div class="course-actions">
            <button class="btn btn-primary btn-xs" ${full ? 'disabled' : ''}
              onclick="enrollCourse(${c.id}, '${escapeHtml(c.name)}')">
              Enroll
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
  }
}

async function enrollCourse(courseId, courseName) {
  const alertEl = document.getElementById('browse-alert');
  hideAlert(alertEl);
  try {
    const res = await api.post(`/student/courses/${courseId}/enroll`, {});
    const data = await res.json();
    if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
    showAlert(alertEl, `Enrolled in "${courseName}" successfully.`, 'success');
    loadBrowseCourses();
    loadMyCourses();
    loadOverview();
  } catch {
    showAlert(alertEl, 'Enrollment failed. Please try again.', 'error');
  }
}

// ── Announcements ──────────────────────────────────────────────────────────────
async function loadAnnouncements() {
  const container = document.getElementById('announcements-list');
  container.innerHTML = '<div class="loading">Loading…</div>';

  try {
    const res  = await api.get('/student/announcements');
    const { announcements } = await api.json(res);

    if (!announcements.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">No announcements at this time.</p>';
      return;
    }

    container.innerHTML = announcements.map(a => `
      <div class="ann-card">
        <div class="ann-card-header">
          <div class="ann-card-title">${escapeHtml(a.title)}</div>
          <span class="badge badge-blue">${escapeHtml(a.target)}</span>
        </div>
        <div class="ann-item-meta">${escapeHtml(a.author)} &middot; ${formatDateTime(a.created_at)}</div>
        <div class="ann-item-body" style="margin-top:.5rem;">${escapeHtml(a.content)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="alert error">${escapeHtml(err.message)}</div>`;
  }
}

// ── Profile ────────────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const res  = await api.get('/student/profile');
    const { user } = await api.json(res);

    document.getElementById('profile-student-id').value = user.student_id || '–';
    document.getElementById('profile-name').value       = user.full_name;
    document.getElementById('profile-email').value      = user.email;
    document.getElementById('profile-username').value   = user.username;
    document.getElementById('profile-since').value      = formatDate(user.created_at);
  } catch { /* silent */ }
}

document.getElementById('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const alertEl = document.getElementById('profile-alert');
  hideAlert(alertEl);

  const full_name = document.getElementById('profile-name').value.trim();
  const email     = document.getElementById('profile-email').value.trim();

  try {
    const res  = await api.put('/student/profile', { full_name, email });
    const data = await res.json();
    if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
    showAlert(alertEl, 'Profile updated.', 'success');
    currentUser.full_name = full_name;
    document.getElementById('nav-username').textContent = full_name;
    document.getElementById('greeting-name').textContent = full_name.split(' ')[0];
    sessionStorage.setItem('user', JSON.stringify(currentUser));
  } catch {
    showAlert(alertEl, 'Update failed.', 'error');
  }
});

function initPasswordForm() {
  document.getElementById('password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const alertEl = document.getElementById('pw-alert');
    hideAlert(alertEl);

    const current_password = document.getElementById('pw-current').value;
    const new_password     = document.getElementById('pw-new').value;
    const confirm          = document.getElementById('pw-confirm').value;

    if (new_password !== confirm) { showAlert(alertEl, 'New passwords do not match.', 'error'); return; }
    if (new_password.length < 8)  { showAlert(alertEl, 'Password must be at least 8 characters.', 'error'); return; }

    try {
      const res  = await api.put('/student/password', { current_password, new_password });
      const data = await res.json();
      if (!res.ok) { showAlert(alertEl, data.error, 'error'); return; }
      showAlert(alertEl, 'Password updated successfully.', 'success');
      document.getElementById('password-form').reset();
    } catch {
      showAlert(alertEl, 'Password change failed.', 'error');
    }
  });
}

init();
