const appConfig = window.__APP_CONFIG__;
const pageData = window.__PAGE_DATA__ || {};

const handoffForm = document.getElementById('handoffForm');
const tokenInput = document.getElementById('tokenInput');
const urlInput = document.getElementById('urlInput');
const submitButton = document.getElementById('submitButton');
const sessionLookupStatus = document.getElementById('sessionLookupStatus');
const resultPanel = document.getElementById('resultPanel');
const completionOverlay = document.getElementById('completionOverlay');
const completionMessage = document.getElementById('completionMessage');
const completionCountdown = document.getElementById('completionCountdown');
const completionProgressBar = document.getElementById('completionProgressBar');

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

function setSubmitting(isSubmitting) {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? 'Sending...' : 'Send URL';
}

function setConnectPageLocked(isLocked) {
  handoffForm.querySelectorAll('input, button').forEach((element) => {
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

function startCloseSequence() {
  if (isCloseSequenceActive) {
    return;
  }

  isCloseSequenceActive = true;
  setConnectPageLocked(true);
  completionOverlay.hidden = false;
  completionOverlay.classList.add('is-visible');
  tokenInput.blur();
  urlInput.blur();

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
    setLookupMessage('Receiver screen found. You can send a URL now.', 'success');
  } catch (error) {
    setLookupMessage(error.message, 'danger');
  }
}

tokenInput.value = pageData.token || '';

if (pageData.token) {
  loadSessionState();
}

tokenInput.addEventListener('change', loadSessionState);
tokenInput.addEventListener('blur', loadSessionState);

handoffForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isCloseSequenceActive) {
    return;
  }

  const token = tokenInput.value.trim();
  const url = urlInput.value.trim();
  let keepLockedAfterSubmit = false;

  if (!token) {
    setLookupMessage('A session code is required before a URL can be sent.', 'danger');
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

  setSubmitting(true);
  setResultMessage('Checking the URL and notifying the other device...', 'warning');

  try {
    const response = await fetch(appConfig.routes.relay, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token, url })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to deliver the URL.');
    }

    setLookupMessage('Receiver screen connected. Your URL has been accepted.', 'success');
    setResultMessage('URL sent. The other device should update in a moment.', 'success');
    urlInput.value = '';
    keepLockedAfterSubmit = true;
    startCloseSequence();
  } catch (error) {
    setResultMessage(error.message, 'danger');
  } finally {
    if (!keepLockedAfterSubmit) {
      setSubmitting(false);
    }
  }
});