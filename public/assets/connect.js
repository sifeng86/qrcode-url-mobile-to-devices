const appConfig = window.__APP_CONFIG__;
const pageData = window.__PAGE_DATA__ || {};

const handoffForm = document.getElementById('handoffForm');
const tokenInput = document.getElementById('tokenInput');
const urlInput = document.getElementById('urlInput');
const submitButton = document.getElementById('submitButton');
const sessionLookupStatus = document.getElementById('sessionLookupStatus');
const resultPanel = document.getElementById('resultPanel');

let activeSession = null;

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

  const token = tokenInput.value.trim();
  const url = urlInput.value.trim();

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
  } catch (error) {
    setResultMessage(error.message, 'danger');
  } finally {
    setSubmitting(false);
  }
});