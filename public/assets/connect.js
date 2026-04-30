const appConfig = window.__APP_CONFIG__;
const pageData = window.__PAGE_DATA__ || {};

const handoffForm = document.getElementById('handoffForm');
const tokenInput = document.getElementById('tokenInput');
const urlInput = document.getElementById('urlInput');
const noteInput = document.getElementById('noteInput');
const fileInput = document.getElementById('fileInput');
const fileInputHint = document.getElementById('fileInputHint');
const retentionSelect = document.getElementById('retentionSelect');
const submitButton = document.getElementById('submitButton');
const sessionLookupStatus = document.getElementById('sessionLookupStatus');
const resultPanel = document.getElementById('resultPanel');
const completionOverlay = document.getElementById('completionOverlay');
const completionTitle = document.getElementById('completionTitle');
const completionMessage = document.getElementById('completionMessage');
const completionCountdown = document.getElementById('completionCountdown');
const completionProgressBar = document.getElementById('completionProgressBar');
const shareTypeInputs = Array.from(document.querySelectorAll('input[name="shareType"]'));
const sharePanels = Array.from(document.querySelectorAll('[data-share-panel]'));
const fileShareOption = document.getElementById('fileShareOption');

const CLOSE_DELAY_SECONDS = 5;

let activeSession = null;
let closeCountdownIntervalId = null;
let closeTimeoutId = null;
let isCloseSequenceActive = false;

function setLookupMessage(text, tone = 'neutral') {
  sessionLookupStatus.textContent = text;
  sessionLookupStatus.dataset.tone = tone;
}

function setResultMessage(text, tone = 'neutral') {
  resultPanel.textContent = text;
  resultPanel.dataset.tone = tone;
}

function setSubmitting(isSubmitting, label = 'Sending share...') {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? label : 'Send share';
}

function setConnectPageLocked(isLocked) {
  handoffForm.querySelectorAll('input, button, textarea, select').forEach((element) => {
    element.disabled = isLocked;
  });

  handoffForm.toggleAttribute('inert', isLocked);
  document.body.classList.toggle('is-completing', isLocked);
}

function updateCloseCountdown(secondsLeft) {
  const safeSecondsLeft = Math.max(0, secondsLeft);
  const scale = safeSecondsLeft / CLOSE_DELAY_SECONDS;

  completionCountdown.textContent = String(safeSecondsLeft);
  completionMessage.textContent = `This page will close in ${safeSecondsLeft} second${safeSecondsLeft === 1 ? '' : 's'}.`;
  completionProgressBar.style.transform = `scaleX(${scale})`;
}

function attemptClosePage() {
  window.close();

  window.setTimeout(() => {
    if (document.visibilityState === 'visible') {
      const currentWindow = window.open('', '_self');

      if (currentWindow) {
        currentWindow.close();
      }
    }

    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        window.location.replace('about:blank');
      }
    }, 250);
  }, 250);
}

function startCloseSequence(title) {
  if (isCloseSequenceActive) {
    return;
  }

  isCloseSequenceActive = true;
  completionTitle.textContent = title;
  setConnectPageLocked(true);
  completionOverlay.hidden = false;
  completionOverlay.classList.add('is-visible');
  tokenInput.blur();

  if (urlInput) {
    urlInput.blur();
  }

  if (noteInput) {
    noteInput.blur();
  }

  let secondsLeft = CLOSE_DELAY_SECONDS;
  updateCloseCountdown(secondsLeft);

  closeCountdownIntervalId = window.setInterval(() => {
    secondsLeft -= 1;
    updateCloseCountdown(secondsLeft);

    if (secondsLeft <= 0) {
      window.clearInterval(closeCountdownIntervalId);
      closeCountdownIntervalId = null;
    }
  }, 1000);

  closeTimeoutId = window.setTimeout(() => {
    closeTimeoutId = null;
    attemptClosePage();
  }, CLOSE_DELAY_SECONDS * 1000);
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

function getSelectedShareType() {
  const selected = shareTypeInputs.find((input) => input.checked);
  return selected ? selected.value : 'link';
}

function populateRetentionOptions() {
  const options = appConfig.storage.retentionOptions || [appConfig.storage.defaultRetentionMinutes || 60];
  retentionSelect.textContent = '';

  options.forEach((minutes) => {
    const option = document.createElement('option');
    option.value = String(minutes);
    option.textContent = `${minutes} minute${minutes === 1 ? '' : 's'}`;

    if (minutes === appConfig.storage.defaultRetentionMinutes) {
      option.selected = true;
    }

    retentionSelect.appendChild(option);
  });
}

function syncShareTypePanels() {
  const selectedShareType = getSelectedShareType();

  sharePanels.forEach((panel) => {
    panel.hidden = panel.dataset.sharePanel !== selectedShareType;
  });

  if (selectedShareType === 'file' && !appConfig.storage.enabled) {
    setResultMessage('File sharing is not configured on this server yet. Choose a link or note instead.', 'warning');
  } else {
    setResultMessage('The receiver session will be checked before the other device is updated.', 'neutral');
  }
}

async function loadSessionState() {
  const token = tokenInput.value.trim();

  activeSession = null;

  if (!token) {
    setLookupMessage('Scan the QR code or enter the session code to continue.', 'neutral');
    return;
  }

  setLookupMessage('Checking whether this receiver screen is still available...', 'warning');

  try {
    const response = await fetch(`${appConfig.routes.session}/${encodeURIComponent(token)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || 'The session code could not be verified.');
    }

    activeSession = payload.session;
    setLookupMessage('Receiver screen found. You can send a share now.', 'success');
  } catch (error) {
    setLookupMessage(error.message, 'danger');
  }
}

function uploadFile(upload, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || 'PUT', upload.url);

    Object.entries(upload.headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setResultMessage(`Uploading file... ${percent}%`, 'warning');
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error('The direct upload to temporary storage failed.'));
    });

    xhr.addEventListener('error', () => {
      reject(new Error('The direct upload to temporary storage failed.'));
    });

    xhr.send(file);
  });
}

async function sendLinkOrNote(token, shareType) {
  const response = await fetch(appConfig.routes.relay, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      shareType,
      retentionMinutes: retentionSelect.value,
      url: shareType === 'link' ? urlInput.value.trim() : undefined,
      text: shareType === 'note' ? noteInput.value.trim() : undefined
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || 'Unable to deliver this share.');
  }

  return payload;
}

async function sendFile(token) {
  const file = fileInput.files && fileInput.files[0];

  if (!file) {
    throw new Error('Choose a file before sending.');
  }

  if (!appConfig.storage.enabled) {
    throw new Error('File sharing is not configured on this server yet.');
  }

  setSubmitting(true, 'Preparing upload...');
  setResultMessage('Preparing secure file upload...', 'warning');

  const prepareResponse = await fetch(appConfig.routes.filePrepare, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      retentionMinutes: retentionSelect.value
    })
  });
  const preparePayload = await prepareResponse.json();

  if (!prepareResponse.ok) {
    throw new Error(preparePayload.message || 'Unable to prepare this file upload.');
  }

  setSubmitting(true, 'Uploading file...');
  await uploadFile(preparePayload.upload, file);

  setSubmitting(true, 'Finishing upload...');
  setResultMessage('Verifying the uploaded file and notifying the receiver...', 'warning');

  const finalizeResponse = await fetch(appConfig.routes.fileFinalize, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      shareId: preparePayload.shareId
    })
  });
  const finalizePayload = await finalizeResponse.json();

  if (!finalizeResponse.ok) {
    throw new Error(finalizePayload.message || 'Unable to finalize this file share.');
  }

  return finalizePayload;
}

function clearShareInputs(shareType) {
  if (shareType === 'link') {
    urlInput.value = '';
    return;
  }

  if (shareType === 'note') {
    noteInput.value = '';
    return;
  }

  if (shareType === 'file') {
    fileInput.value = '';
    fileInputHint.textContent = 'Files upload directly to temporary cloud storage and expire automatically.';
  }
}

populateRetentionOptions();

tokenInput.value = pageData.token || '';

if (!appConfig.storage.enabled) {
  const fileInputOption = fileShareOption.querySelector('input');
  fileInputOption.disabled = true;
  fileShareOption.classList.add('is-disabled');

  if ((pageData.shareType || '').toLowerCase() === 'file') {
    shareTypeInputs[0].checked = true;
  }
}

if (pageData.shareType) {
  const matchingShareType = shareTypeInputs.find((input) => input.value === pageData.shareType);

  if (matchingShareType && !matchingShareType.disabled) {
    matchingShareType.checked = true;
  }
}

syncShareTypePanels();

if (pageData.token) {
  loadSessionState();
}

shareTypeInputs.forEach((input) => {
  input.addEventListener('change', syncShareTypePanels);
});

tokenInput.addEventListener('change', loadSessionState);
tokenInput.addEventListener('blur', loadSessionState);

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];

  if (!file) {
    fileInputHint.textContent = 'Files upload directly to temporary cloud storage and expire automatically.';
    return;
  }

  fileInputHint.textContent = `${file.name} • ${formatBytes(file.size)}`;
});

handoffForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isCloseSequenceActive) {
    return;
  }

  const token = tokenInput.value.trim();
  const shareType = getSelectedShareType();
  let keepLockedAfterSubmit = false;

  if (!token) {
    setLookupMessage('A session code is required before a share can be sent.', 'danger');
    tokenInput.focus();
    return;
  }

  if (!activeSession) {
    await loadSessionState();

    if (!activeSession) {
      tokenInput.focus();
      return;
    }
  }

  try {
    let payload;

    if (shareType === 'file') {
      payload = await sendFile(token);
    } else {
      setSubmitting(true, 'Sending share...');
      setResultMessage('Checking the share and notifying the receiver...', 'warning');
      payload = await sendLinkOrNote(token, shareType);
    }

    keepLockedAfterSubmit = true;
    setLookupMessage('Receiver screen connected. Your share has been accepted.', 'success');
    setResultMessage(payload.message || 'Share sent. The other device should update in a moment.', 'success');
    clearShareInputs(shareType);
    startCloseSequence(shareType === 'file' ? 'The other device can download your file.' : 'The other device has your share.');
  } catch (error) {
    setResultMessage(error.message, 'danger');
  } finally {
    if (!keepLockedAfterSubmit) {
      setSubmitting(false);
    }
  }
});
