const appConfig = window.__APP_CONFIG__;

const connectionBadge = document.getElementById('connectionBadge');
const sessionStatusText = document.getElementById('sessionStatusText');
const tokenField = document.getElementById('tokenField');
const mobileLinkField = document.getElementById('mobileLinkField');
const openMobileLink = document.getElementById('openMobileLink');
const qrImage = document.getElementById('qrImage');
const expiryLabel = document.getElementById('expiryLabel');
const redirectPanel = document.getElementById('redirectPanel');
const refreshSessionButton = document.getElementById('refreshSessionButton');

function setBadge(text, tone) {
  connectionBadge.textContent = text;
  connectionBadge.dataset.tone = tone;
}

function setStatus(text) {
  sessionStatusText.textContent = text;
}

function setRedirectMessage(text, tone = 'neutral') {
  redirectPanel.textContent = text;
  redirectPanel.dataset.tone = tone;
}

function formatExpiry(expiresAt) {
  const expiresDate = new Date(expiresAt);
  const minutesLeft = Math.max(1, Math.round((expiresDate.getTime() - Date.now()) / 60000));
  return `${expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${minutesLeft} min left)`;
}

async function copyFieldValue(fieldId, button) {
  const targetField = document.getElementById(fieldId);
  const text = targetField.value;

  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    const originalText = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    targetField.focus();
    targetField.select();
  }
}

document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.addEventListener('click', () => {
    copyFieldValue(button.dataset.copyTarget, button);
  });
});

function applySession(payload) {
  tokenField.value = payload.token;
  mobileLinkField.value = payload.mobileUrl;
  openMobileLink.href = payload.mobileUrl;
  qrImage.src = payload.qrCodeDataUrl;
  qrImage.hidden = false;
  expiryLabel.textContent = `This access code stays active until ${formatExpiry(payload.expiresAt)}.`;
  setBadge('Ready', 'success');
  setStatus('This device is ready. Scan the QR code or open the phone link on your phone.');
  setRedirectMessage('Waiting for a valid URL from your phone.', 'neutral');
  refreshSessionButton.disabled = false;
}

const socket = io({
  path: appConfig.socketPath,
  transports: ['websocket', 'polling']
});

function requestSession(eventName) {
  setBadge('Syncing', 'warning');
  setStatus('Generating a fresh access code for this device...');
  setRedirectMessage('This device will stay on standby until a valid URL is received.', 'neutral');
  refreshSessionButton.disabled = true;
  socket.emit(eventName);
}

socket.on('connect', () => {
  setBadge('Connected', 'success');
  requestSession('display:register');
});

socket.on('disconnect', () => {
  setBadge('Reconnecting', 'warning');
  setStatus('Connection lost. Reconnecting to the service...');
  setRedirectMessage('A new access code will be prepared automatically after reconnection.', 'warning');
});

socket.on('session:ready', (payload) => {
  applySession(payload);
});

socket.on('session:error', (payload) => {
  setBadge('Unavailable', 'danger');
  setStatus(payload.message || 'A new access code is not available right now.');
  setRedirectMessage('The service is temporarily unavailable. Refresh the screen and try again.', 'danger');
  refreshSessionButton.disabled = false;
});

socket.on('relay:deliver', (payload) => {
  setBadge('Opening', 'success');
  setStatus('URL received. Opening it on this device now...');
  setRedirectMessage(`Opening: ${payload.url}`, 'success');
  setTimeout(() => {
    window.location.assign(payload.url);
  }, 900);
});

refreshSessionButton.addEventListener('click', () => {
  requestSession('display:refresh');
});