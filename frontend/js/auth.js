/**
 * auth.js – login/register page logic
 */

document.getElementById('year').textContent = new Date().getFullYear();

// ── Redirect if already logged in ─────────────────────────────────────────────
(async () => {
  const user = sessionStorage.getItem('user');
  if (user) {
    const u = JSON.parse(user);
    window.location.href = u.role === 'admin' ? '/admin' : '/dashboard';
    return;
  }
  try {
    const res  = await api.get('/auth/me');
    const data = await res.json().catch(() => null);
    if (res.ok && data?.user) {
      sessionStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = data.user.role === 'admin' ? '/admin' : '/dashboard';
    }
  } catch { /* not logged in */ }
})();

// ── Tab switching ──────────────────────────────────────────────────────────────
const tabLogin    = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const panelLogin  = document.getElementById('panel-login');
const panelReg    = document.getElementById('panel-register');
const authAlert   = document.getElementById('auth-alert');

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');    tabLogin.setAttribute('aria-selected', 'true');
  tabRegister.classList.remove('active'); tabRegister.setAttribute('aria-selected', 'false');
  panelLogin.classList.remove('hidden');
  panelReg.classList.add('hidden');
  hideAlert(authAlert);
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');  tabRegister.setAttribute('aria-selected', 'true');
  tabLogin.classList.remove('active');  tabLogin.setAttribute('aria-selected', 'false');
  panelReg.classList.remove('hidden');
  panelLogin.classList.add('hidden');
  hideAlert(authAlert);
});

// ── Password toggles ──────────────────────────────────────────────────────────
initPasswordToggles();

// ── Password strength meter ───────────────────────────────────────────────────
const pwInput   = document.getElementById('reg-password');
const pwBarFill = document.getElementById('pw-bar-fill');
const pwLabel   = document.getElementById('pw-strength-label');

function calcStrength(pw) {
  let score = 0;
  if (pw.length >= 8)               score++;
  if (pw.length >= 12)              score++;
  if (/[A-Z]/.test(pw))            score++;
  if (/[a-z]/.test(pw))            score++;
  if (/[0-9]/.test(pw))            score++;
  if (/[^A-Za-z0-9]/.test(pw))    score++;
  return score;
}

pwInput.addEventListener('input', () => {
  const score = calcStrength(pwInput.value);
  const pct   = Math.round((score / 6) * 100);
  const colors = ['#dc2626','#f97316','#eab308','#84cc16','#22c55e','#16a34a'];
  const labels = ['Very Weak','Weak','Fair','Good','Strong','Very Strong'];
  pwBarFill.style.width   = pct + '%';
  pwBarFill.style.background = colors[score - 1] || '#e2e8f0';
  pwLabel.textContent     = pwInput.value ? labels[score - 1] || '' : '';
});

// ── Login form ─────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  hideAlert(authAlert);

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username) { showAlert(authAlert, 'Username is required.'); return; }
  if (!password) { showAlert(authAlert, 'Password is required.'); return; }

  setLoading(btn, true);
  try {
    const res  = await api.post('/auth/login', { username, password });
    const data = await res.json();

    if (!res.ok) {
      showAlert(authAlert, data.error || 'Login failed.', 'error');
      return;
    }

    sessionStorage.setItem('user', JSON.stringify(data.user));
    showAlert(authAlert, 'Login successful! Redirecting…', 'success');

    setTimeout(() => {
      window.location.href = data.user.role === 'admin' ? '/admin' : '/dashboard';
    }, 600);
  } catch {
    showAlert(authAlert, 'Network error. Please try again.', 'error');
  } finally {
    setLoading(btn, false);
  }
});

// ── Register form ──────────────────────────────────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('register-btn');
  hideAlert(authAlert);

  const full_name = document.getElementById('reg-name').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const username  = document.getElementById('reg-username').value.trim();
  const password  = document.getElementById('reg-password').value;
  const confirm   = document.getElementById('reg-confirm').value;

  // Client-side validation
  const errs = [];
  if (full_name.length < 2)          errs.push('Full name must be at least 2 characters.');
  if (!/\S+@\S+\.\S+/.test(email))   errs.push('Valid email required.');
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) errs.push('Username must be 3–30 alphanumeric chars or underscores.');
  if (password.length < 8)           errs.push('Password must be at least 8 characters.');
  if (!/[A-Z]/.test(password))       errs.push('Password must contain an uppercase letter.');
  if (!/[a-z]/.test(password))       errs.push('Password must contain a lowercase letter.');
  if (!/[0-9]/.test(password))       errs.push('Password must contain a number.');
  if (!/[^A-Za-z0-9]/.test(password)) errs.push('Password must contain a special character.');
  if (password !== confirm)          errs.push('Passwords do not match.');

  if (errs.length) { showAlert(authAlert, errs[0], 'error'); return; }

  setLoading(btn, true);
  try {
    const res  = await api.post('/auth/register', { full_name, email, username, password });
    const data = await res.json();

    if (!res.ok) {
      showAlert(authAlert, data.error || 'Registration failed.', 'error');
      return;
    }

    showAlert(authAlert, 'Account created! Please sign in.', 'success');
    document.getElementById('register-form').reset();
    pwBarFill.style.width = '0';
    pwLabel.textContent   = '';

    // Switch to login tab
    setTimeout(() => {
      tabLogin.click();
      document.getElementById('login-username').value = username;
    }, 1200);
  } catch {
    showAlert(authAlert, 'Network error. Please try again.', 'error');
  } finally {
    setLoading(btn, false);
  }
});
