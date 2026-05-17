const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

const { io } = require('socket.io-client');

const appUrl = process.env.TEST_APP_URL || 'http://127.0.0.1:8080';
const rawBasePath = String(process.env.TEST_BASE_PATH || '').trim();
const testBasePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`
  : '';
const socketPath = process.env.TEST_SOCKET_PATH || (testBasePath ? `${testBasePath}/socket.io` : '/socket.io');

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withBasePath(pathname) {
  if (!testBasePath) {
    return pathname;
  }

  if (!pathname || pathname === '/') {
    return `${testBasePath}/`;
  }

  return `${testBasePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function fetchJson(pathname, options) {
  const response = await fetch(`${appUrl}${pathname}`, options);
  const bodyText = await response.text();
  const payload = bodyText ? JSON.parse(bodyText) : null;
  return { payload, response };
}

function waitForEvent(socket, eventName, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for socket event: ${eventName}`));
    }, timeoutMs);

    function onEvent(payload) {
      clearTimeout(timeoutHandle);
      resolve(payload);
    }

    socket.once(eventName, onEvent);
  });
}

async function waitForCondition(checker, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await checker();

    if (result) {
      return result;
    }

    await delay(intervalMs);
  }

  throw new Error('Timed out waiting for expected condition.');
}

test('end-to-end share flow behaves correctly', { timeout: 30000 }, async () => {
  const healthResponse = await fetch(`${appUrl}/health`);
  const healthPayload = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(healthPayload.ok, true);

  const expectedPublicOrigin = healthPayload.publicOrigin || appUrl;
  const expectedHomeUrl = `${expectedPublicOrigin}${withBasePath('/')}`;
  const expectedConnectUrl = `${expectedPublicOrigin}${withBasePath('/connect')}`;

  if (testBasePath) {
    const rootResponse = await fetch(appUrl, { redirect: 'manual' });
    assert.equal(rootResponse.status, 302);
    assert.equal(rootResponse.headers.get('location'), `${testBasePath}/`);
  }

  const homeResponse = await fetch(`${appUrl}${withBasePath('/')}`);
  const homeHtml = await homeResponse.text();
  assert.equal(homeResponse.status, 200);
  assert.match(homeHtml, /Sendline \| Send Links and Files from Phone to Computer/);
  assert.match(homeHtml, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(homeHtml, new RegExp(`<link rel="canonical" href="${escapeForRegExp(expectedHomeUrl)}">`));
  assert.match(homeHtml, /<meta property="og:site_name" content="Sendline">/);
  assert.match(homeHtml, /FAQPage/);
  assert.match(homeHtml, /HowTo/);
  assert.match(homeHtml, /phone to a computer/);
  assert.match(homeHtml, /No login, app, or email required/);

  const robotsResponse = await fetch(`${appUrl}/robots.txt`);
  const robotsText = await robotsResponse.text();
  assert.equal(robotsResponse.status, 200);
  assert.match(robotsText, new RegExp(`Disallow: ${escapeForRegExp(withBasePath('/api/'))}`));
  assert.match(robotsText, new RegExp(`Sitemap: ${escapeForRegExp(`${expectedPublicOrigin}${withBasePath('/sitemap.xml')}`)}`));

  const sitemapResponse = await fetch(`${appUrl}/sitemap.xml`);
  const sitemapText = await sitemapResponse.text();
  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemapText, new RegExp(`<loc>${escapeForRegExp(expectedHomeUrl)}</loc>`));

  const displaySocket = io(appUrl, {
    path: socketPath,
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000
  });

  try {
    await waitForEvent(displaySocket, 'connect');
    const firstSessionPromise = waitForEvent(displaySocket, 'session:ready');
    displaySocket.emit('display:register');
    const firstSession = await firstSessionPromise;
    const firstMobileUrl = new URL(firstSession.mobileUrl);

    assert.match(firstSession.token, /^[A-Za-z0-9_-]{12,64}$/);
    assert.equal(firstMobileUrl.origin, new URL(expectedPublicOrigin).origin);
    assert.equal(firstMobileUrl.pathname, withBasePath('/connect'));
    assert.equal(firstMobileUrl.searchParams.get('token'), firstSession.token);
    assert.match(firstSession.qrCodeDataUrl, /^data:image\/png;base64,/);

    const connectResponse = await fetch(firstSession.mobileUrl);
    const connectHtml = await connectResponse.text();
    assert.equal(connectResponse.status, 200);
    assert.match(connectHtml, /Sendline \| Send a Share/);
    assert.match(connectHtml, /<meta name="robots" content="noindex, follow, noarchive">/);
    assert.match(connectHtml, new RegExp(`<link rel="canonical" href="${escapeForRegExp(expectedConnectUrl)}">`));
    assert.match(connectHtml, new RegExp(firstSession.token));
    assert.match(connectHtml, /Send a link, note, or file/);

    const lookupResult = await fetchJson(`${withBasePath('/api/session')}/${firstSession.token}`);
    assert.equal(lookupResult.response.status, 200);
    assert.equal(lookupResult.payload.ok, true);
    assert.equal(lookupResult.payload.session.token, firstSession.token);
    assert.equal(lookupResult.payload.session.hasActiveDisplay, true);
    assert.equal(lookupResult.payload.session.storageEnabled, healthPayload.storage.enabled);

    const invalidUrlResult = await fetchJson(withBasePath('/api/relay'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: firstSession.token,
        url: 'javascript:alert(1)'
      })
    });
    assert.equal(invalidUrlResult.response.status, 400);
    assert.equal(invalidUrlResult.payload.code, 'UNSUPPORTED_PROTOCOL');

    const deliverPromise = waitForEvent(displaySocket, 'share:received');
    const validRelayResult = await fetchJson(withBasePath('/api/relay'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: firstSession.token,
        shareType: 'link',
        retentionMinutes: 15,
        url: 'example.com/service-menu'
      })
    });

    assert.equal(validRelayResult.response.status, 200);
    assert.equal(validRelayResult.payload.ok, true);
    assert.equal(validRelayResult.payload.url, 'https://example.com/service-menu');
    assert.equal(validRelayResult.payload.share.shareType, 'link');

    const deliveredEvent = await deliverPromise;
    assert.equal(deliveredEvent.shareType, 'link');
    assert.equal(deliveredEvent.url, 'https://example.com/service-menu');

    const notePromise = waitForEvent(displaySocket, 'share:received');
    const noteRelayResult = await fetchJson(withBasePath('/api/relay'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: firstSession.token,
        shareType: 'note',
        retentionMinutes: 15,
        text: 'Projector input is HDMI 2'
      })
    });

    assert.equal(noteRelayResult.response.status, 200);
    assert.equal(noteRelayResult.payload.share.shareType, 'note');

    const noteEvent = await notePromise;
    assert.equal(noteEvent.shareType, 'note');
    assert.equal(noteEvent.text, 'Projector input is HDMI 2');

    const listSharesResult = await fetchJson(`${withBasePath('/api/session')}/${firstSession.token}/shares`);
    assert.equal(listSharesResult.response.status, 200);
    assert.ok(listSharesResult.payload.shares.length >= 2);
    assert.ok(listSharesResult.payload.shares.some((share) => share.shareType === 'link'));
    assert.ok(listSharesResult.payload.shares.some((share) => share.shareType === 'note'));

    const filePrepareResult = await fetchJson(withBasePath('/api/files/prepare'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: firstSession.token,
        fileName: 'report.pdf',
        fileSize: 1024,
        contentType: 'application/pdf',
        retentionMinutes: 15
      })
    });

    if (healthPayload.storage.enabled) {
      assert.equal(filePrepareResult.response.status, 200);
      assert.equal(filePrepareResult.payload.ok, true);
      assert.equal(filePrepareResult.payload.share.shareType, 'file');
      assert.equal(filePrepareResult.payload.share.fileName, 'report.pdf');
      assert.equal(filePrepareResult.payload.share.status, 'pending_upload');
      assert.equal(filePrepareResult.payload.upload.method, 'PUT');
      assert.equal(filePrepareResult.payload.upload.headers['Content-Type'], 'application/pdf');
      assert.match(filePrepareResult.payload.upload.url, /^https:\/\//);
    } else {
      assert.equal(filePrepareResult.response.status, 503);
      assert.equal(filePrepareResult.payload.code, 'FILE_STORAGE_UNAVAILABLE');
    }

    const refreshPromise = waitForEvent(displaySocket, 'session:ready');
    displaySocket.emit('display:refresh');
    const refreshedSession = await refreshPromise;
    assert.notEqual(refreshedSession.token, firstSession.token);

    const oldSessionOffline = await waitForCondition(async () => {
      const result = await fetchJson(`${withBasePath('/api/session')}/${firstSession.token}`);
      return result.response.status === 409 ? result : null;
    });
    assert.equal(oldSessionOffline.payload.code, 'DISPLAY_OFFLINE');

    displaySocket.disconnect();

    const refreshedOffline = await waitForCondition(async () => {
      const result = await fetchJson(`${withBasePath('/api/session')}/${refreshedSession.token}`);
      return result.response.status === 409 ? result : null;
    });
    assert.equal(refreshedOffline.payload.code, 'DISPLAY_OFFLINE');

    const missingToken = await fetchJson(`${withBasePath('/api/session')}/short`);
    assert.equal(missingToken.response.status, 400);
    assert.equal(missingToken.payload.code, 'INVALID_TOKEN');
  } finally {
    if (displaySocket.connected) {
      displaySocket.disconnect();
      await delay(250);
    }
  }
});