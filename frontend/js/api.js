/**
 * api.js – Centralised HTTP client with automatic JWT refresh.
 *
 * Tokens are stored in httpOnly cookies (set by the server), so we never
 * touch localStorage for auth tokens. We only store non-sensitive UI state
 * (e.g. user role hint) in sessionStorage for routing decisions.
 */

const API_BASE = '/api';

let _refreshing = null; // deduplicate concurrent refresh attempts

/**
 * Wrapper around fetch that:
 *  1. Sends cookies automatically (credentials: 'include')
 *  2. Sets JSON headers
 *  3. On 401 + TOKEN_EXPIRED → attempts one silent token refresh, then retries
 *  4. On 401 after refresh → redirects to login
 */
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // If access token expired, try silent refresh once
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      await silentRefresh();
      // Retry original request
      const retry = await fetch(url, { ...options, headers, credentials: 'include' });
      return retry;
    }
    // Other 401 – not authenticated
    return res;
  }

  return res;
}

async function silentRefresh() {
  if (_refreshing) return _refreshing;

  _refreshing = fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  }).then(r => {
    _refreshing = null;
    if (!r.ok) {
      // Refresh failed – clear session hint and redirect
      sessionStorage.removeItem('user');
      window.location.href = '/';
    }
  }).catch(() => {
    _refreshing = null;
    sessionStorage.removeItem('user');
    window.location.href = '/';
  });

  return _refreshing;
}

// ── Convenience methods ────────────────────────────────────────────────────────

const api = {
  async get(path) {
    return apiFetch(path, { method: 'GET' });
  },
  async post(path, data) {
    return apiFetch(path, { method: 'POST', body: JSON.stringify(data) });
  },
  async put(path, data) {
    return apiFetch(path, { method: 'PUT', body: JSON.stringify(data) });
  },
  async delete(path) {
    return apiFetch(path, { method: 'DELETE' });
  },

  /** Parse JSON and throw if response is not ok */
  async json(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  },
};

// ── UI Helpers ─────────────────────────────────────────────────────────────────

function showAlert(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${type}`;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert(el) {
  if (!el) return;
  el.classList.add('hidden');
}

function setLoading(btn, loading) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.spinner');
  btn.disabled  = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Nav section switching (shared by dashboard + admin)
function initNavSections(navSelector, sectionPrefix) {
  const links = document.querySelectorAll(`${navSelector} .nav-link`);
  const hamburger = document.getElementById('hamburger');
  const nav       = document.querySelector(navSelector);

  function activateSection(name) {
    links.forEach(l => l.classList.toggle('active', l.dataset.section === name));
    document.querySelectorAll('.section').forEach(s => {
      s.classList.toggle('active', s.id === `${sectionPrefix}${name}`);
      s.classList.toggle('hidden', s.id !== `${sectionPrefix}${name}`);
    });
    if (nav) nav.classList.remove('open');
  }

  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      activateSection(link.dataset.section);
    });
  });

  if (hamburger && nav) {
    hamburger.addEventListener('click', () => nav.classList.toggle('open'));
  }

  // Activate first section by default
  const first = links[0];
  if (first) activateSection(first.dataset.section);
}

// Toggle password visibility
function initPasswordToggles() {
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}
