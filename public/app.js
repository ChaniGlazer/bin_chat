// app.js
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

const enableBtn = document.getElementById('enable-btn');
const statusEl = document.getElementById('status');
const chatEl = document.getElementById('chat');
const replyForm = document.getElementById('reply-form');
const replyInput = document.getElementById('reply-input');
const contactsEl = document.getElementById('contacts');
const chatTitleEl = document.getElementById('chat-title');

let currentContact = null;

// לא ניתן להסתמך על פרומפט ה-Basic Auth המובנה של הדפדפן - הוא לא עובד באמינות
// ב-PWA מותקן במסך הבית ב-iOS. במקום זה שומרים כאן את הפרטים אחרי טופס התחברות
// משלנו, ומצרפים אותם ידנית כ-Authorization header לכל בקשת API (ראו apiFetch למטה).
function getAuthHeader() {
  const creds = localStorage.getItem('auth');
  return creds ? `Basic ${creds}` : null;
}

function setAuth(username, password) {
  localStorage.setItem('auth', btoa(`${username}:${password}`));
}

function clearAuth() {
  localStorage.removeItem('auth');
}

async function apiFetch(url, options = {}) {
  const headers = { ...options.headers, Authorization: getAuthHeader() };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    showLogin();
    throw new Error('unauthorized');
  }
  return res;
}

function showLogin() {
  loginScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
  loadContacts();
}

async function tryLogin(username, password) {
  loginError.textContent = '';
  loginBtn.disabled = true;
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      loginError.textContent = data.error || 'שגיאה בהתחברות';
      return;
    }
    setAuth(username, password);
    showApp();
  } catch {
    loginError.textContent = 'שגיאת רשת, נסה שוב';
  } finally {
    loginBtn.disabled = false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusEl.textContent = 'הדפדפן הזה לא תומך בהתראות Push';
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    statusEl.textContent = 'ההרשאה נדחתה - אי אפשר לקבל התראות';
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await apiFetch('/vapid-public-key').then((r) => r.json());

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await apiFetch('/register-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });

  statusEl.textContent = 'התראות מופעלות ✓';
  enableBtn.disabled = true;
}

async function loadContacts() {
  const res = await apiFetch('/contacts');
  if (!res.ok) return;
  const contacts = await res.json();

  contactsEl.innerHTML = contacts
    .map((c) => `<button class="contact" data-username="${escapeHtml(c.username)}">${escapeHtml(c.label || c.username)}</button>`)
    .join('');

  contactsEl.querySelectorAll('.contact').forEach((btn) => {
    btn.addEventListener('click', () => selectContact(btn.dataset.username));
  });

  if (!currentContact && contacts.length) {
    selectContact(contacts[0].username);
  }
}

function selectContact(username) {
  currentContact = username;
  chatTitleEl.textContent = username;
  contactsEl.querySelectorAll('.contact').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.username === username);
  });
  loadMessages();
}

async function loadMessages() {
  if (!currentContact) return;
  const res = await apiFetch(`/messages?with=${encodeURIComponent(currentContact)}`);
  if (!res.ok) {
    chatEl.innerHTML = '<div class="empty">שגיאה בטעינת הודעות</div>';
    return;
  }
  const messages = await res.json();
  if (!messages.length) {
    chatEl.innerHTML = '<div class="empty">אין הודעות עדיין</div>';
    return;
  }
  chatEl.innerHTML = messages.map(renderMessage).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderMessage(m) {
  const side = m.direction === 'out' ? 'out' : 'in';
  return `<div class="bubble ${side}"><div class="text">${escapeHtml(m.text)}</div><div class="time">${m.created_at}</div></div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function sendReply(event) {
  event.preventDefault();
  const text = replyInput.value.trim();
  if (!text || !currentContact) return;

  replyInput.disabled = true;
  try {
    const res = await apiFetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: currentContact, text }),
    });
    if (!res.ok) throw new Error('send failed');
    replyInput.value = '';
    await loadMessages();
  } catch {
    statusEl.textContent = 'שליחת ההודעה נכשלה, נסה שוב';
  } finally {
    replyInput.disabled = false;
    replyInput.focus();
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

enableBtn.addEventListener('click', enablePush);
replyForm.addEventListener('submit', sendReply);
loginBtn.addEventListener('click', () => tryLogin(loginUsername.value.trim(), loginPassword.value));
loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryLogin(loginUsername.value.trim(), loginPassword.value);
});

// אם כבר יש פרטים שמורים מהתחברות קודמת - ננסה איתם ישר בלי להציג את הטופס
if (getAuthHeader()) {
  apiFetch('/contacts')
    .then(() => showApp())
    .catch(() => showLogin());
} else {
  showLogin();
}
