const appConfig = window.__APP_CONFIG__;
const pageData = window.__PAGE_DATA__ || {};

const handoffForm = document.getElementById('handoffForm');
const tokenFieldGroup = document.getElementById('tokenFieldGroup');
const tokenInput = document.getElementById('tokenInput');
const tokenError = document.getElementById('tokenError');
const urlInput = document.getElementById('urlInput');
const urlError = document.getElementById('urlError');
const noteInput = document.getElementById('noteInput');
const noteError = document.getElementById('noteError');
const noteCharacterCount = document.getElementById('noteCharacterCount');
const fileInput = document.getElementById('fileInput');
const fileInputHint = document.getElementById('fileInputHint');
const fileError = document.getElementById('fileError');
const clearFileButton = document.getElementById('clearFileButton');
const fileProgress = document.getElementById('fileProgress');
const fileProgressBar = document.getElementById('fileProgressBar');
const fileProgressFill = document.getElementById('fileProgressFill');
const fileProgressLabel = document.getElementById('fileProgressLabel');
const retentionSelect = document.getElementById('retentionSelect');
const retentionSummary = document.getElementById('retentionSummary');
const submitButton = document.getElementById('submitButton');
const sessionLookupStatus = document.getElementById('sessionLookupStatus');
const sessionLookupStatusIcon = sessionLookupStatus.querySelector('.connection-banner-icon');
const sessionLookupStatusText = sessionLookupStatus.querySelector('span:last-child');
const resultPanel = document.getElementById('resultPanel');
const completionOverlay = document.getElementById('completionOverlay');
const completionTitle = document.getElementById('completionTitle');
const completionMessage = document.getElementById('completionMessage');
const sendAnotherButton = document.getElementById('sendAnotherButton');
const closePageButton = document.getElementById('closePageButton');
const shareTypeInputs = Array.from(document.querySelectorAll('input[name="shareType"]'));
const sharePanels = Array.from(document.querySelectorAll('[data-share-panel]'));
const fileShareOption = document.getElementById('fileShareOption');
const fileAvailabilityMessage = document.getElementById('fileAvailabilityMessage');

const prefilledToken = String(pageData.token || '').trim();

let activeSession = null;
let completionIsOpen = false;
let sessionLookupSequence = 0;

function setLookupMessage(text, tone = 'neutral') {
  const icons = {
    danger: '!',
    neutral: '•••',
    success: '✓',
    warning: '…'
  };

  sessionLookupStatusText.textContent = text;
  sessionLookupStatusIcon.textContent = icons[tone] || icons.neutral;
  sessionLookupStatus.dataset.tone = tone;
}

function setResultMessage(text = '', tone = 'neutral') {
  resultPanel.textContent = text;
  resultPanel.dataset.tone = tone;
  resultPanel.hidden = !text;
}

function setSubmitting(isSubmitting, label = 'Sending…') {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? label : getSubmitLabel();
  handoffForm.setAttribute('aria-busy', String(isSubmitting));
}

function setConnectPageLocked(isLocked) {
  handoffForm.querySelectorAll('input, button, textarea, select').forEach((element) => {
    if (isLocked) {
      element.dataset.disabledBeforeCompletion = String(element.disabled);
      element.disabled = true;
      return;
    }

    element.disabled = element.dataset.disabledBeforeCompletion === 'true';
    delete element.dataset.disabledBeforeCompletion;
  });

  handoffForm.toggleAttribute('inert', isLocked);
  document.body.classList.toggle('is-completing', isLocked);
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

function formatRetention(minutes) {
  const numericMinutes = Number(minutes);

  if (numericMinutes >= 1440 && numericMinutes % 1440 === 0) {
    const days = numericMinutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  if (numericMinutes >= 60 && numericMinutes % 60 === 0) {
    const hours = numericMinutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${numericMinutes} minute${numericMinutes === 1 ? '' : 's'}`;
}

function getSelectedShareType() {
  const selected = shareTypeInputs.find((input) => input.checked);
  return selected ? selected.value : 'link';
}

function getSubmitLabel() {
  return `Send ${getSelectedShareType()}`;
}

function getActiveShareInput() {
  const shareType = getSelectedShareType();

  if (shareType === 'note') {
    return noteInput;
  }

  if (shareType === 'file') {
    return fileInput;
  }

  return urlInput;
}

function getDefaultFileHint() {
  const maxBytes = Number(appConfig.storage.maxFileBytes || 0);
  return maxBytes > 0
    ? `Choose a temporary file up to ${formatBytes(maxBytes)}.`
    : 'Choose a temporary file to upload.';
}

function setFieldError(input, errorElement, message = '') {
  errorElement.textContent = message;
  errorElement.hidden = !message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function clearContentErrors() {
  setFieldError(urlInput, urlError);
  setFieldError(noteInput, noteError);
  setFieldError(fileInput, fileError);
}

function populateRetentionOptions() {
  const options = appConfig.storage.retentionOptions || [appConfig.storage.defaultRetentionMinutes || 60];
  retentionSelect.textContent = '';

  options.forEach((minutes) => {
    const option = document.createElement('option');
    option.value = String(minutes);
    option.textContent = formatRetention(minutes);

    if (minutes === appConfig.storage.defaultRetentionMinutes) {
      option.selected = true;
    }

    retentionSelect.appendChild(option);
  });

  retentionSummary.textContent = formatRetention(retentionSelect.value);
}

function syncShareTypePanels({ focusInput = false } = {}) {
  const selectedShareType = getSelectedShareType();

  sharePanels.forEach((panel) => {
    panel.hidden = panel.dataset.sharePanel !== selectedShareType;
  });

  clearContentErrors();
  setResultMessage();
  submitButton.textContent = getSubmitLabel();

  if (selectedShareType === 'file' && !appConfig.storage.enabled) {
    setResultMessage('File sharing is not available on this server. Choose a link or note instead.', 'warning');
  }

  if (focusInput) {
    getActiveShareInput().focus();
  }
}

function resetFileProgress() {
  fileProgress.hidden = true;
  fileProgressBar.setAttribute('aria-valuenow', '0');
  fileProgressFill.style.width = '0%';
  fileProgressLabel.textContent = '0%';
}

function updateFileProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, percent));
  fileProgress.hidden = false;
  fileProgressBar.setAttribute('aria-valuenow', String(safePercent));
  fileProgressFill.style.width = `${safePercent}%`;
  fileProgressLabel.textContent = `${safePercent}%`;
}

function updateNoteCount() {
  noteCharacterCount.textContent = `${noteInput.value.length.toLocaleString()} / 4,000`;
}

function validateShareContent() {
  const shareType = getSelectedShareType();
  clearContentErrors();

  if (shareType === 'link') {
    const rawUrl = urlInput.value.trim();

    if (!rawUrl) {
      setFieldError(urlInput, urlError, 'Paste or enter a link to send.');
      urlInput.focus();
      return false;
    }

    try {
      const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const parsedUrl = new URL(candidate);

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch (error) {
      setFieldError(urlInput, urlError, 'Enter a valid web link that starts with http:// or https://.');
      urlInput.focus();
      return false;
    }
  }

  if (shareType === 'note' && !noteInput.value.trim()) {
    setFieldError(noteInput, noteError, 'Enter some text to send.');
    noteInput.focus();
    return false;
  }

  if (shareType === 'file') {
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      setFieldError(fileInput, fileError, 'Choose a file to send.');
      fileInput.focus();
      return false;
    }

    const maxBytes = Number(appConfig.storage.maxFileBytes || 0);
    if (maxBytes > 0 && file.size > maxBytes) {
      setFieldError(fileInput, fileError, `Choose a file smaller than ${formatBytes(maxBytes)}.`);
      fileInput.focus();
      return false;
    }
  }

  return true;
}

async function loadSessionState() {
  const token = tokenInput.value.trim();
  const lookupSequence = ++sessionLookupSequence;
  activeSession = null;
  setFieldError(tokenInput, tokenError);

  if (!token) {
    tokenFieldGroup.hidden = false;
    setLookupMessage('Enter the session code shown on the receiving screen.', 'neutral');
    return false;
  }

  setLookupMessage('Checking the receiving screen…', 'warning');

  try {
    const response = await fetch(`${appConfig.routes.session}/${encodeURIComponent(token)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || 'The session code could not be verified.');
    }

    if (lookupSequence !== sessionLookupSequence || token !== tokenInput.value.trim()) {
      return false;
    }

    activeSession = payload.session;
    tokenFieldGroup.hidden = token === prefilledToken && Boolean(prefilledToken);
    setLookupMessage('Connected to the receiving screen', 'success');
    return true;
  } catch (error) {
    if (lookupSequence !== sessionLookupSequence || token !== tokenInput.value.trim()) {
      return false;
    }

    tokenFieldGroup.hidden = false;
    setFieldError(tokenInput, tokenError, error.message);
    setLookupMessage('Could not connect. Check the session code and try again.', 'danger');
    return false;
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

      updateFileProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        updateFileProgress(100);
        resolve();
        return;
      }

      reject(new Error('The upload to temporary storage failed.'));
    });

    xhr.addEventListener('error', () => {
      reject(new Error('The upload to temporary storage failed.'));
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
    throw new Error('File sharing is not available on this server.');
  }

  setSubmitting(true, 'Preparing upload…');
  setResultMessage('Preparing a secure file upload…', 'warning');
  resetFileProgress();

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

  setSubmitting(true, 'Uploading file…');
  setResultMessage('Uploading your file…', 'warning');
  await uploadFile(preparePayload.upload, file);

  setSubmitting(true, 'Finishing upload…');
  setResultMessage('Finishing the upload and notifying the receiver…', 'warning');

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
    throw new Error(finalizePayload.message || 'Unable to finish this file share.');
  }

  return finalizePayload;
}

function clearShareInputs(shareType) {
  if (shareType === 'link') {
    urlInput.value = '';
  } else if (shareType === 'note') {
    noteInput.value = '';
    updateNoteCount();
  } else if (shareType === 'file') {
    fileInput.value = '';
    fileInputHint.textContent = getDefaultFileHint();
    clearFileButton.hidden = true;
    resetFileProgress();
  }

  clearContentErrors();
}

function showCompletion(shareType) {
  completionIsOpen = true;
  completionTitle.textContent = shareType === 'file'
    ? 'Your file is ready on the other device.'
    : 'The other device has your share.';
  completionMessage.textContent = 'You can send another item or close this page.';
  closePageButton.textContent = 'Close page';
  setConnectPageLocked(true);
  completionOverlay.hidden = false;
  sendAnotherButton.focus();
}

function resetAfterCompletion() {
  completionIsOpen = false;
  completionOverlay.hidden = true;
  setConnectPageLocked(false);
  setSubmitting(false);
  setResultMessage();
  setLookupMessage('Connected to the receiving screen', 'success');
  getActiveShareInput().focus();
}

function attemptClosePage() {
  window.close();

  window.setTimeout(() => {
    if (document.visibilityState === 'visible') {
      completionMessage.textContent = 'Your browser kept this page open. You can close this tab when you are done.';
      closePageButton.textContent = 'Try closing again';
    }
  }, 300);
}

populateRetentionOptions();
fileInputHint.textContent = getDefaultFileHint();
tokenInput.value = prefilledToken;
tokenFieldGroup.hidden = Boolean(prefilledToken);

if (!appConfig.storage.enabled) {
  const fileInputOption = fileShareOption.querySelector('input');
  fileInputOption.disabled = true;
  fileShareOption.classList.add('is-disabled');
  fileShareOption.setAttribute('aria-disabled', 'true');
  fileAvailabilityMessage.hidden = false;

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
updateNoteCount();

if (prefilledToken) {
  loadSessionState();
} else {
  setLookupMessage('Enter the session code shown on the receiving screen.', 'neutral');
}

shareTypeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    syncShareTypePanels({ focusInput: true });
  });
});

tokenInput.addEventListener('input', () => {
  sessionLookupSequence += 1;
  activeSession = null;
  setFieldError(tokenInput, tokenError);
});
tokenInput.addEventListener('blur', loadSessionState);

urlInput.addEventListener('input', () => {
  setFieldError(urlInput, urlError);
});

noteInput.addEventListener('input', () => {
  setFieldError(noteInput, noteError);
  updateNoteCount();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  setFieldError(fileInput, fileError);
  resetFileProgress();

  if (!file) {
    fileInputHint.textContent = getDefaultFileHint();
    clearFileButton.hidden = true;
    return;
  }

  fileInputHint.textContent = `${file.name} · ${formatBytes(file.size)}`;
  clearFileButton.hidden = false;
});

clearFileButton.addEventListener('click', () => {
  fileInput.value = '';
  fileInputHint.textContent = getDefaultFileHint();
  clearFileButton.hidden = true;
  resetFileProgress();
  setFieldError(fileInput, fileError);
  fileInput.focus();
});

retentionSelect.addEventListener('change', () => {
  retentionSummary.textContent = formatRetention(retentionSelect.value);
});

sendAnotherButton.addEventListener('click', resetAfterCompletion);
closePageButton.addEventListener('click', attemptClosePage);

document.addEventListener('keydown', (event) => {
  if (!completionIsOpen) {
    return;
  }

  if (event.key === 'Escape') {
    resetAfterCompletion();
    return;
  }

  if (event.key === 'Tab') {
    const firstButton = sendAnotherButton;
    const lastButton = closePageButton;

    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }
});

handoffForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setResultMessage();

  const token = tokenInput.value.trim();
  const shareType = getSelectedShareType();

  if (!token) {
    tokenFieldGroup.hidden = false;
    setFieldError(tokenInput, tokenError, 'Enter a session code before sending.');
    setLookupMessage('A session code is required.', 'danger');
    tokenInput.focus();
    return;
  }

  if (!validateShareContent()) {
    return;
  }

  if (!activeSession || activeSession.token !== token) {
    const sessionIsReady = await loadSessionState();

    if (!sessionIsReady) {
      tokenInput.focus();
      return;
    }
  }

  let shareWasSent = false;

  try {
    let payload;

    if (shareType === 'file') {
      payload = await sendFile(token);
    } else {
      setSubmitting(true, 'Sending…');
      setResultMessage('Sending to the receiving screen…', 'warning');
      payload = await sendLinkOrNote(token, shareType);
    }

    shareWasSent = true;
    setLookupMessage('Connected to the receiving screen', 'success');
    setResultMessage(payload.message || 'Share sent.', 'success');
    clearShareInputs(shareType);
    showCompletion(shareType);
  } catch (error) {
    setResultMessage(error.message, 'danger');
  } finally {
    if (!shareWasSent) {
      setSubmitting(false);
    }
  }
});
