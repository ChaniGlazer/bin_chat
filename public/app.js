// app.js
const enableBtn = document.getElementById('enable-btn');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('messages');

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
  const { publicKey } = await fetch('/vapid-public-key').then((r) => r.json());

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/register-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });

  statusEl.textContent = 'התראות מופעלות ✓';
  enableBtn.disabled = true;
}

async function loadMessages() {
  const res = await fetch('/messages');
  if (!res.ok) {
    listEl.innerHTML = '<li>שגיאה בטעינת הודעות</li>';
    return;
  }
  const messages = await res.json();
  if (!messages.length) {
    listEl.innerHTML = '<li class="empty">אין הודעות עדיין</li>';
    return;
  }
  listEl.innerHTML = messages.map(renderMessage).join('');
}

function renderMessage(m) {
  const phoneLabel = m.from_phone ? `<div class="phone">מ-${escapeHtml(m.from_phone)}</div>` : '';
  return `<li><div class="text">${escapeHtml(m.text)}</div>${phoneLabel}<div class="time">${m.created_at}</div></li>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

enableBtn.addEventListener('click', enablePush);
loadMessages();
