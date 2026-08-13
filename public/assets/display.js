const appConfig = window.__APP_CONFIG__;

const connectionBadge = document.getElementById('connectionBadge');
const shareCountBadge = document.getElementById('shareCountBadge');
const sessionStatusText = document.getElementById('sessionStatusText');
const tokenField = document.getElementById('tokenField');
const mobileLinkField = document.getElementById('mobileLinkField');
const openMobileLink = document.getElementById('openMobileLink');
const qrImage = document.getElementById('qrImage');
const expiryLabel = document.getElementById('expiryLabel');
const refreshSessionButton = document.getElementById('refreshSessionButton');
const autoOpenLinksToggle = document.getElementById('autoOpenLinksToggle');
const shareList = document.getElementById('shareList');
const shareListEmptyState = document.getElementById('shareListEmptyState');
const shareAnnouncement = document.getElementById('shareAnnouncement');
const receiverInboxCard = document.getElementById('receiverInboxCard');
const viewInboxButton = document.getElementById('viewInboxButton');

let currentSessionToken = '';
let currentShares = [];
let newShareHighlightTimer = 0;

function setBadge(text, tone) {
  connectionBadge.textContent = text;
  connectionBadge.dataset.tone = tone;
}

function setStatus(text) {
  sessionStatusText.textContent = text;
}

function announce(text) {
  shareAnnouncement.textContent = '';
  window.requestAnimationFrame(() => {
    shareAnnouncement.textContent = text;
  });
}

function formatExpiry(expiresAt) {
  const expiresDate = new Date(expiresAt);
  const minutesLeft = Math.max(1, Math.round((expiresDate.getTime() - Date.now()) / 60000));
  return `${expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${minutesLeft} min left`;
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

function getLinkTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return 'Incoming link';
  }
}

function getShareTypeLabel(shareType) {
  if (shareType === 'file') {
    return 'File';
  }

  if (shareType === 'note') {
    return 'Note';
  }

  return 'Link';
}

function getReceivedAnnouncement(share) {
  if (share.shareType === 'file') {
    return `File received: ${share.fileName}. It is ready to download in Incoming items.`;
  }

  if (share.shareType === 'note') {
    return 'Note received. It is ready to copy in Incoming items.';
  }

  return 'Link received. It is ready to open in Incoming items.';
}

async function copyValue(value, button, successMessage) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    const originalText = button.textContent;
    button.textContent = 'Copied';
    announce(successMessage);
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    announce('Copy is not available in this browser. Select the content and copy it manually.');
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
    announce('Copied to the clipboard.');
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    targetField.focus();
    targetField.select();
    announce('The value is selected. Copy it using your browser or keyboard.');
  }
}

document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.addEventListener('click', () => {
    copyFieldValue(button.dataset.copyTarget, button);
  });
});

function createActionButton(label, onClick, isPrimary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${isPrimary ? 'button-primary' : 'button-secondary'}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createActionLink(label, href, { isPrimary = false, openInNewTab = false } = {}) {
  const link = document.createElement('a');
  link.className = `button ${isPrimary ? 'button-primary' : 'button-secondary'}`;
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
  viewInboxButton.hidden = count === 0;
}

function renderShareCard(share) {
  const card = document.createElement('article');
  card.className = 'share-card';
  card.dataset.shareId = share.id;
  card.dataset.shareType = share.shareType;

  if (share.isExpired) {
    card.classList.add('is-expired');
  }

  const head = document.createElement('div');
  head.className = 'share-card-head';

  const headingWrap = document.createElement('div');
  headingWrap.className = 'share-card-heading';

  const typeBadge = document.createElement('span');
  typeBadge.className = 'share-type-badge';
  typeBadge.dataset.shareType = share.shareType;
  typeBadge.textContent = share.isExpired ? 'Expired' : getShareTypeLabel(share.shareType);

  const title = document.createElement('h3');
  title.textContent = share.shareType === 'file'
    ? share.fileName
    : share.shareType === 'note'
      ? 'Text note'
      : getLinkTitle(share.url);
  headingWrap.append(typeBadge, title);
  head.appendChild(headingWrap);

  let body;

  if (share.shareType === 'note') {
    const noteText = String(share.text || '');

    if (noteText.length > 360) {
      body = document.createElement('div');
      body.className = 'share-card-note-wrap';

      const preview = document.createElement('p');
      preview.className = 'share-card-note share-card-note-preview';
      preview.textContent = `${noteText.slice(0, 280).trimEnd()}…`;

      const details = document.createElement('details');
      details.className = 'note-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Show full note';
      const fullNote = document.createElement('p');
      fullNote.className = 'share-card-note';
      fullNote.textContent = noteText;
      details.append(summary, fullNote);
      details.addEventListener('toggle', () => {
        summary.textContent = details.open ? 'Hide full note' : 'Show full note';
      });
      body.append(preview, details);
    } else {
      body = document.createElement('p');
      body.className = 'share-card-note';
      body.textContent = noteText;
    }
  } else if (share.shareType === 'file') {
    body = document.createElement('p');
    body.textContent = share.isExpired
      ? 'This temporary download has expired.'
      : 'This file is ready to download.';
  } else {
    body = document.createElement('p');
    body.className = 'share-card-link';
    body.textContent = share.url || 'Link ready.';
  }

  const meta = document.createElement('div');
  meta.className = 'share-card-meta';

  if (share.createdAt) {
    const receivedAt = document.createElement('span');
    receivedAt.textContent = `Received ${formatDateTime(share.createdAt)}`;
    meta.appendChild(receivedAt);
  }

  if (share.shareType === 'file' && share.fileSize) {
    const size = document.createElement('span');
    size.textContent = formatBytes(share.fileSize);
    meta.appendChild(size);
  }

  if (share.availableUntil) {
    const until = document.createElement('span');
    until.textContent = `Available until ${formatDateTime(share.availableUntil)}`;
    meta.appendChild(until);
  }

  const actions = document.createElement('div');
  actions.className = 'share-card-actions';

  if (!share.isExpired) {
    if (share.shareType === 'link' && share.url) {
      actions.appendChild(createActionLink('Open link', share.url, {
        isPrimary: true,
        openInNewTab: true
      }));
      const copyButton = createActionButton('Copy', () => {
        copyValue(share.url, copyButton, 'Link copied to the clipboard.');
      });
      actions.appendChild(copyButton);
    }

    if (share.shareType === 'note' && share.text) {
      const copyButton = createActionButton('Copy note', () => {
        copyValue(share.text, copyButton, 'Note copied to the clipboard.');
      }, true);
      actions.appendChild(copyButton);
    }

    if (share.shareType === 'file') {
      if (share.downloadPath) {
        actions.appendChild(createActionLink('Download file', share.downloadPath, { isPrimary: true }));
      } else {
        const unavailable = document.createElement('span');
        unavailable.className = 'share-unavailable';
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

function renderShareList(newShareId = '') {
  shareList.textContent = '';
  const fragment = document.createDocumentFragment();

  currentShares.forEach((share) => {
    fragment.appendChild(renderShareCard(share));
  });

  shareList.appendChild(fragment);
  updateShareCount();

  if (newShareId && shareList.firstElementChild?.dataset.shareId === String(newShareId)) {
    window.clearTimeout(newShareHighlightTimer);
    const newCard = shareList.firstElementChild;
    newCard.classList.add('is-new');
    newShareHighlightTimer = window.setTimeout(() => {
      newCard.classList.remove('is-new');
    }, 2400);
  }
}

function setShares(shares) {
  currentShares = shares.slice().sort((left, right) => {
    return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
  });
  renderShareList();
}

function upsertShare(share) {
  currentShares = [share, ...currentShares.filter((item) => item.id !== share.id)];
  renderShareList(share.id);
}

async function fetchRecentShares(token) {
  try {
    const response = await fetch(`${appConfig.routes.sessionShares}/${encodeURIComponent(token)}/shares`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to load incoming items.');
    }

    if (token !== currentSessionToken) {
      return;
    }

    const mergedShares = [...currentShares];
    (payload.shares || []).forEach((share) => {
      if (!mergedShares.some((item) => item.id === share.id)) {
        mergedShares.push(share);
      }
    });
    setShares(mergedShares);
  } catch (error) {
    setStatus(error.message);
    announce(error.message);
  }
}

function applySession(payload) {
  currentSessionToken = payload.token;
  tokenField.value = payload.token;
  mobileLinkField.value = payload.mobileUrl;
  openMobileLink.href = payload.mobileUrl;
  qrImage.src = payload.qrCodeDataUrl;
  qrImage.hidden = false;
  expiryLabel.textContent = `Code active until ${formatExpiry(payload.expiresAt)}`;
  setBadge('Ready', 'success');
  setStatus('Ready. Scan the QR code, then send something from your phone.');
  refreshSessionButton.disabled = false;
  setShares([]);
  fetchRecentShares(payload.token);
}

const socket = io({
  path: appConfig.socketPath,
  transports: ['websocket', 'polling']
});

function requestSession(eventName) {
  setBadge('Preparing', 'warning');
  setStatus('Generating a fresh QR code for this device…');
  refreshSessionButton.disabled = true;
  socket.emit(eventName);
}

socket.on('connect', () => {
  requestSession('display:register');
});

socket.on('disconnect', () => {
  setBadge('Reconnecting', 'warning');
  setStatus('Connection lost. Reconnecting automatically…');
});

socket.on('session:ready', (payload) => {
  applySession(payload);
});

socket.on('session:error', (payload) => {
  const message = payload.message || 'A new access code is not available right now.';
  setBadge('Unavailable', 'danger');
  setStatus(message);
  announce(message);
  refreshSessionButton.disabled = false;
});

socket.on('share:received', (share) => {
  upsertShare(share);
  const message = getReceivedAnnouncement(share);
  setBadge('Received', 'success');
  setStatus(message);
  announce(message);

  if (share.shareType === 'link' && share.url && autoOpenLinksToggle.checked && !share.isExpired) {
    setStatus('Link received. Opening it on this device…');
    window.setTimeout(() => {
      window.location.assign(share.url);
    }, 900);
  }
});

refreshSessionButton.addEventListener('click', () => {
  requestSession('display:refresh');
});

viewInboxButton.addEventListener('click', () => {
  receiverInboxCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
