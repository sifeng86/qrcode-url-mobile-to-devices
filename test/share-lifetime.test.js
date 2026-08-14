const assert = require('node:assert/strict');
const test = require('node:test');

const { buildVisibleShares } = require('../src/app');

function createLinkShare({ id, status = 'delivered', availableUntil }) {
  return {
    id,
    sessionToken: 'test-session-token',
    shareType: 'link',
    status,
    payloadJson: { url: `https://example.com/${id}` },
    availableUntil,
    createdAt: new Date()
  };
}

test('receiver list only returns delivered shares whose availability has not expired', () => {
  const visibleShare = createLinkShare({
    id: 1,
    availableUntil: new Date(Date.now() + 60_000)
  });
  const expiredShare = createLinkShare({
    id: 2,
    availableUntil: new Date(Date.now() - 1_000)
  });
  const pendingShare = createLinkShare({
    id: 3,
    status: 'pending_upload',
    availableUntil: new Date(Date.now() + 60_000)
  });
  const deletedShare = createLinkShare({
    id: 4,
    status: 'deleted',
    availableUntil: new Date(Date.now() + 60_000)
  });

  const result = buildVisibleShares({}, [visibleShare, expiredShare, pendingShare, deletedShare]);

  assert.deepEqual(result.map((share) => share.id), [1]);
  assert.equal(result[0].isExpired, false);
});
