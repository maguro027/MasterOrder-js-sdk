import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const archiveSrc = fs.readFileSync(
  path.join(repoRoot, 'Order', 'src', 'main', 'resources', 'static', 'staff', 'js', 'staff-archive-uuid-search.js'),
  'utf8',
);
const authSrc = fs.readFileSync(
  path.join(repoRoot, 'Order', 'src', 'main', 'resources', 'static', 'staff', 'js', 'staff-auth.js'),
  'utf8',
);

assert.match(
  authSrc,
  /function exitUnauthorizedShop[\s\S]*clearStaffAuthCaches\(\)/,
  '401/403 shop exit must purge staff device caches',
);

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

const localStorage = storage();
const context = {
  console,
  Date,
  Number,
  window: {},
  localStorage,
};
context.globalThis = context;
context.window = context;
vm.createContext(context);
vm.runInContext(archiveSrc, context, { filename: 'staff-archive-uuid-search.js' });

const api = context.MasterOrderStaffArchiveUuidSearch;
assert.ok(api, 'archive search module must export');
assert.ok(api.ARCHIVE_DETAIL_TTL_MS > 0, 'archive cache must have a TTL');

api.rememberArchiveDetail(7, 'sess-1', { sessionId: 'sess-1', orderHistory: [{ guestClientId: 'g1' }] });
assert.equal(api.listCachedArchiveDetails(7).length, 1, 'fresh archive detail is readable');

localStorage.setItem(
  'mo.staff.archive.detail.v1:7:sess-old',
  JSON.stringify({
    savedAt: Date.now() - api.ARCHIVE_DETAIL_TTL_MS - 1000,
    detail: { sessionId: 'sess-old', orderHistory: [{ guestClientId: 'g-old' }] },
  }),
);
assert.equal(api.listCachedArchiveDetails(7).length, 1, 'expired archive detail must be dropped');
assert.equal(localStorage.getItem('mo.staff.archive.detail.v1:7:sess-old'), null, 'expired key is removed');

api.clearArchiveDetailCache(7);
assert.equal(api.listCachedArchiveDetails(7).length, 0, 'shop-scoped clear removes archive PII');

console.log('staff archive cache security contract: OK');
