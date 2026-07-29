// app.js
const enableBtn = document.getElementById('enable-btn');
const statusEl = document.getElementById('status');
const chatEl = document.getElementById('chat');
const replyForm = document.getElementById('reply-form');
const replyInput = document.getElementById('reply-input');

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
  if (!text) return;

  replyInput.disabled = true;
  try {
    const res = await fetch('/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('send failed');
    replyInput.value = '';
    await loadMessages();
  } catch {
    statusEl.textContent = 'שליחת התשובה נכשלה, נסה שוב';
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
loadMessages();
