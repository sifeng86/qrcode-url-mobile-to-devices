const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function collectMatches(source, pattern) {
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

function assertUniqueIds(html, templateName) {
  const ids = collectMatches(html, /\bid="([^"]+)"/g);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `${templateName} contains duplicate IDs`);
  return new Set(ids);
}

function assertJavaScriptIdsExist(javaScript, html, pageName) {
  const ids = assertUniqueIds(html, `${pageName}.html`);
  const referencedIds = collectMatches(javaScript, /getElementById\(['"]([^'"]+)['"]\)/g);
  const missingIds = referencedIds.filter((id) => !ids.has(id));
  assert.deepEqual(missingIds, [], `${pageName}.js references IDs missing from its template`);
}

test('frontend JavaScript compiles and only references template IDs that exist', () => {
  const pages = ['display', 'connect'];

  pages.forEach((pageName) => {
    const javaScript = read(`public/assets/${pageName}.js`);
    const html = read(`templates/${pageName}.html`);
    assert.doesNotThrow(() => new vm.Script(javaScript), `${pageName}.js should compile`);
    assertJavaScriptIdsExist(javaScript, html, pageName);
  });
});

test('sender share type controls and panels stay in sync', () => {
  const html = read('templates/connect.html');
  const shareTypes = collectMatches(html, /name="shareType"\s+value="([^"]+)"/g).sort();
  const panelTypes = collectMatches(html, /data-share-panel="([^"]+)"/g).sort();

  assert.deepEqual(shareTypes, ['file', 'link', 'note']);
  assert.deepEqual(panelTypes, ['file', 'link', 'note']);
});

test('receiver keeps connect, inbox, and help in the intended narrow-screen order', () => {
  const html = read('templates/display.html');
  const sessionIndex = html.indexOf('class="card session-card"');
  const inboxIndex = html.indexOf('class="card inbox-card"');
  const guideIndex = html.indexOf('class="quick-guide"');

  assert.ok(sessionIndex >= 0, 'receiver connection card should exist');
  assert.ok(inboxIndex > sessionIndex, 'incoming items should follow the connection card');
  assert.ok(guideIndex > inboxIndex, 'help content should follow the receiver workspace');
  assert.match(html, /id="sessionStatusText"[^>]+aria-live="polite"/);
  assert.match(html, /id="shareAnnouncement"[^>]+aria-live="polite"/);
});

test('receiver continuously updates session and share expiry state', () => {
  const javaScript = read('public/assets/display.js');
  const appSource = read('src/app.js');

  assert.match(javaScript, /function formatRemainingTime\(/);
  assert.match(javaScript, /function removeExpiredShares\(/);
  assert.match(javaScript, /setInterval\(updateTimeSensitiveUi, 1000\)/);
  assert.match(javaScript, /document\.addEventListener\('visibilitychange'/);
  assert.match(appSource, /shareItem\.status === 'delivered'[\s\S]+!isExpiredShareItem\(shareItem\)/);
});

test('sender has accessible status regions and an explicit success choice', () => {
  const html = read('templates/connect.html');
  const javaScript = read('public/assets/connect.js');

  assert.match(html, /id="sessionLookupStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="resultPanel"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="completionOverlay"[\s\S]+role="dialog"/);
  assert.match(html, /id="sendAnotherButton"/);
  assert.match(html, /id="closePageButton"/);
  assert.doesNotMatch(javaScript, /about:blank|completionCountdown|closeCountdown|CLOSE_DELAY_SECONDS/);
});
