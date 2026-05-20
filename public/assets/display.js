const appConfig = window.__APP_CONFIG__;

const connectionBadge = document.getElementById('connectionBadge');
const shareCountBadge = document.getElementById('shareCountBadge');
const sessionStatusText = document.getElementById('sessionStatusText');
const tokenField = document.getElementById('tokenField');
const mobileLinkField = document.getElementById('mobileLinkField');
const openMobileLink = document.getElementById('openMobileLink');
const qrImage = document.getElementById('qrImage');
const expiryLabel = document.getElementById('expiryLabel');
const redirectPanel = document.getElementById('redirectPanel');
const refreshSessionButton = document.getElementById('refreshSessionButton');
const autoOpenLinksToggle = document.getElementById('autoOpenLinksToggle');
const shareList = document.getElementById('shareList');
const shareListEmptyState = document.getElementById('shareListEmptyState');
const receiverInboxCard = document.getElementById('receiverInboxCard');
const shareNotification = document.getElementById('shareNotification');
const shareNotificationButton = document.getElementById('shareNotificationButton');
const shareNotificationTitle = document.getElementById('shareNotificationTitle');
const shareNotificationBody = document.getElementById('shareNotificationBody');

let currentSessionToken = '';
let currentShares = [];
let inboxHighlightTimer = 0;
let shareNotificationTimer = 0;

function setBadge(text, tone) {
  connectionBadge.textContent = text;
  connectionBadge.dataset.tone = tone;
}

function setStatus(text) {
  sessionStatusText.textContent = text;
}

function setActivityMessage(text, tone = 'neutral') {
  redirectPanel.textContent = text;
  redirectPanel.dataset.tone = tone;
}

function formatExpiry(expiresAt) {
  const expiresDate = new Date(expiresAt);
  const minutesLeft = Math.max(1, Math.round((expiresDate.getTime() - Date.now()) / 60000));
  return `${expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${minutesLeft} min left)`;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

async function copyValue(value, button) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    const originalText = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    setActivityMessage('Copy is not available in this browser. Select the value manually instead.', 'warning');
  }
}

async function copyFieldValue(fieldId, button) {
  const targetField = document.getElementById(fieldId);

  if (!targetField || !targetField.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(targetField.value);
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

function createActionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createActionLink(label, href, openInNewTab = false) {
  const link = document.createElement('a');
  link.className = 'button button-secondary';
  link.href = href;
  link.textContent = label;

  if (openInNewTab) {
    link.target = '_blank';
    link.rel = 'noreferrer';
  }

  return link;
}

function updateShareCount() {
  const count = currentShares.length;
  shareCountBadge.textContent = `${count} item${count === 1 ? '' : 's'}`;
  shareCountBadge.dataset.tone = count > 0 ? 'success' : 'neutral';
  shareListEmptyState.hidden = count > 0;
}

function hideShareNotification() {
  if (!shareNotification) {
    return;
  }

  window.clearTimeout(shareNotificationTimer);
  shareNotification.hidden = true;
}

function focusReceiverInbox() {
  if (!receiverInboxCard) {
    return;
  }

  window.clearTimeout(inboxHighlightTimer);
  receiverInboxCard.classList.remove('is-highlighted');
  void receiverInboxCard.offsetWidth;
  receiverInboxCard.classList.add('is-highlighted');
  receiverInboxCard.focus({ preventScroll: true });
  receiverInboxCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

  inboxHighlightTimer = window.setTimeout(() => {
    receiverInboxCard.classList.remove('is-highlighted');
  }, 2200);
}

function getShareNotificationContent(share) {
  if (share.shareType === 'file') {
    return {
      body: `${share.fileName} is ready in the Receiver Inbox. Click to jump there now.`,
      title: 'File received'
    };
  }

  if (share.shareType === 'note') {
    return {
      body: 'A new note just arrived. Click to jump to the Receiver Inbox and review it.',
      title: 'Note received'
    };
  }

  return {
    body: 'A new link just arrived. Click to jump to the Receiver Inbox and open it.',
    title: 'Link received'
  };
}

function showShareNotification(share) {
  if (!shareNotification || !shareNotificationButton) {
    return;
  }

  const content = getShareNotificationContent(share);
  shareNotificationTitle.textContent = content.title;
  shareNotificationBody.textContent = content.body;
  shareNotification.hidden = false;
  window.clearTimeout(shareNotificationTimer);
  shareNotificationTimer = window.setTimeout(() => {
    hideShareNotification();
  }, 9000);
}

function renderShareCard(share) {
  const card = document.createElement('article');
  card.className = 'share-card';
  card.dataset.shareType = share.shareType;

  const head = document.createElement('div');
  head.className = 'share-card-head';

  const headingWrap = document.createElement('div');
  headingWrap.className = 'share-card-heading';

  const title = document.createElement('h3');
  title.textContent = share.shareType === 'file'
    ? share.fileName
    : share.shareType === 'note'
      ? 'Incoming note'
      : 'Incoming link';
  headingWrap.appendChild(title);

  const typePill = document.createElement('span');
  typePill.className = 'share-meta-pill';
  typePill.textContent = share.isExpired ? 'Expired' : share.shareType;
  head.append(headingWrap, typePill);

  const body = document.createElement('p');

  if (share.shareType === 'note') {
    body.className = 'share-card-note';
    body.textContent = share.text;
  } else if (share.shareType === 'file') {
    body.textContent = `${share.fileName} is ready${share.isExpired ? ' but expired' : ''}.`;
  } else {
    body.textContent = share.url || 'Link ready.';
  }

  const meta = document.createElement('div');
  meta.className = 'share-card-meta';

  if (share.availableUntil) {
    const until = document.createElement('span');
    until.className = 'share-meta-pill';
    until.textContent = `Until ${formatDateTime(share.availableUntil)}`;
    meta.appendChild(until);
  }

  if (share.shareType === 'file' && share.fileSize) {
    const size = document.createElement('span');
    size.className = 'share-meta-pill';
    size.textContent = formatBytes(share.fileSize);
    meta.appendChild(size);
  }

  const actions = document.createElement('div');
  actions.className = 'share-card-actions';

  if (!share.isExpired) {
    if (share.shareType === 'link' && share.url) {
      actions.appendChild(createActionLink('Open link', share.url, true));
      const copyButton = createActionButton('Copy link', () => {
        copyValue(share.url, copyButton);
      });
      actions.appendChild(copyButton);
    }

    if (share.shareType === 'note' && share.text) {
      const copyButton = createActionButton('Copy note', () => {
        copyValue(share.text, copyButton);
      });
      actions.appendChild(copyButton);
    }

    if (share.shareType === 'file') {
      if (share.downloadPath) {
        actions.appendChild(createActionLink('Download file', share.downloadPath));
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'share-meta-pill';
        unavailable.textContent = 'Download unavailable';
        actions.appendChild(unavailable);
      }
    }
  }

  card.append(head, body, meta);

  if (actions.childElementCount > 0) {
    card.appendChild(actions);
  }

  return card;
}

function renderShareList() {
  shareList.textContent = '';
  const fragment = document.createDocumentFragment();

  currentShares.forEach((share) => {
    fragment.appendChild(renderShareCard(share));
  });

  shareList.appendChild(fragment);
  updateShareCount();
}

function setShares(shares) {
  currentShares = shares.slice().sort((left, right) => {
    return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
  });
  renderShareList();
}

function upsertShare(share) {
  currentShares = [share, ...currentShares.filter((item) => item.id !== share.id)];
  renderShareList();
}

async function fetchRecentShares(token) {
  try {
    const response = await fetch(`${appConfig.routes.sessionShares}/${encodeURIComponent(token)}/shares`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load the receiver inbox.');
    }

    setShares(payload.shares || []);
  } catch (error) {
    setActivityMessage(error.message, 'warning');
  }
}

function applySession(payload) {
  currentSessionToken = payload.token;
  tokenField.value = payload.token;
  mobileLinkField.value = payload.mobileUrl;
  openMobileLink.href = payload.mobileUrl;
  qrImage.src = payload.qrCodeDataUrl;
  qrImage.hidden = false;
  expiryLabel.textContent = `This access code stays active until ${formatExpiry(payload.expiresAt)}.`;
  setBadge('Ready', 'success');
  setStatus('This device is ready. Scan the QR code or open the phone link on your phone.');
  setActivityMessage('Waiting for a new share from your phone.', 'neutral');
  refreshSessionButton.disabled = false;
  hideShareNotification();
  setShares([]);
  fetchRecentShares(payload.token);
}

const socket = io({
  path: appConfig.socketPath,
  transports: ['websocket', 'polling']
});

function requestSession(eventName) {
  setBadge('Syncing', 'warning');
  setStatus('Generating a fresh access code for this device...');
  setActivityMessage('This device will stay on standby until a new share is received.', 'neutral');
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
  setActivityMessage('A new access code will be prepared automatically after reconnection.', 'warning');
  hideShareNotification();
});

socket.on('session:ready', (payload) => {
  applySession(payload);
});

socket.on('session:error', (payload) => {
  setBadge('Unavailable', 'danger');
  setStatus(payload.message || 'A new access code is not available right now.');
  setActivityMessage('The service is temporarily unavailable. Refresh the screen and try again.', 'danger');
  refreshSessionButton.disabled = false;
  hideShareNotification();
});

socket.on('share:received', (share) => {
  upsertShare(share);

  if (share.shareType === 'link' && share.url && autoOpenLinksToggle.checked && !share.isExpired) {
    setBadge('Opening', 'success');
    setStatus('Incoming link received. Opening it on this device now...');
    setActivityMessage(`Opening: ${share.url}`, 'success');
    setTimeout(() => {
      window.location.assign(share.url);
    }, 900);
    return;
  }

  setBadge('Received', 'success');
  setStatus('Incoming share received. Review it in the receiver inbox below.');
  showShareNotification(share);

  if (share.shareType === 'file') {
    setActivityMessage('A file is ready in the receiver inbox.', 'success');
  } else if (share.shareType === 'note') {
    setActivityMessage('A note is ready in the receiver inbox.', 'success');
  } else {
    setActivityMessage('A link is ready in the receiver inbox.', 'success');
  }
});

refreshSessionButton.addEventListener('click', () => {
  requestSession('display:refresh');
});

if (shareNotificationButton) {
  shareNotificationButton.addEventListener('click', () => {
    hideShareNotification();
    focusReceiverInbox();
  });
}
