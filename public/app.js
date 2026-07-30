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

let currentConversation = null; // { type: 'user', id: username } | { type: 'group', id: groupId }

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
  const [contactsRes, groupsRes] = await Promise.all([apiFetch('/contacts'), apiFetch('/groups')]);
  const contacts = contactsRes.ok ? await contactsRes.json() : [];
  const groups = groupsRes.ok ? await groupsRes.json() : [];

  const groupButtons = groups
    .map((g) => `<button class="contact" data-type="group" data-id="${g.id}">👥 ${escapeHtml(g.name)}</button>`)
    .join('');
  const contactButtons = contacts
    .map((c) => `<button class="contact" data-type="user" data-id="${escapeHtml(c.username)}">${escapeHtml(c.label || c.username)}</button>`)
    .join('');
  contactsEl.innerHTML = groupButtons + contactButtons;

  contactsEl.querySelectorAll('.contact').forEach((btn) => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.type, btn.dataset.id, btn.textContent));
  });

  if (!currentConversation) {
    if (groups.length) selectConversation('group', groups[0].id, `👥 ${groups[0].name}`);
    else if (contacts.length) selectConversation('user', contacts[0].username, contacts[0].label || contacts[0].username);
  }
}

function selectConversation(type, id, label) {
  currentConversation = { type, id };
  chatTitleEl.textContent = label;
  contactsEl.querySelectorAll('.contact').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type && btn.dataset.id === String(id));
  });
  loadMessages();
}

async function loadMessages() {
  if (!currentConversation) return;
  const query =
    currentConversation.type === 'group'
      ? `group=${encodeURIComponent(currentConversation.id)}`
      : `with=${encodeURIComponent(currentConversation.id)}`;
  const res = await apiFetch(`/messages?${query}`);
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
  const senderLine = m.sender && side === 'in' ? `<div class="sender">${escapeHtml(m.sender)}</div>` : '';
  return `<div class="bubble ${side}">${senderLine}<div class="text">${escapeHtml(m.text)}</div><div class="time">${m.created_at}</div></div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function sendReply(event) {
  event.preventDefault();
  const text = replyInput.value.trim();
  if (!text || !currentConversation) return;

  const payload =
    currentConversation.type === 'group' ? { toGroup: currentConversation.id, text } : { to: currentConversation.id, text };

  replyInput.disabled = true;
  try {
    const res = await apiFetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
