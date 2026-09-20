import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
let nextGet = () => Promise.resolve([]);
const http = {
  get: (...args) => nextGet(...args),
  post: () => Promise.resolve({}),
  patch: () => Promise.resolve({}),
  put: () => Promise.resolve({}),
  delete: () => Promise.resolve({}),
  request: () => Promise.resolve({}),
};
const route = new Proxy({}, { get: () => (...args) => `/${args.join('/')}` });
const context = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Promise,
  localStorage,
  MasterOrderApiRoutes: { paths: { staff: route, auth: route } },
  MasterOrderCoreSdk: {
    createHttpClient: () => http,
    createSseClient: () => ({}),
    createProfileApi: () => ({ getMyProfile: () => http.get('/profile') }),
    createAccountStateApi: () => ({}),
    withQuery: (value) => value,
  },
};
context.globalThis = context;
vm.createContext(context);

for (const relative of ['staff/staff-pii-local-cache.js', 'staff/staff-sdk.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, {
    filename: relative,
  });
}

const cache = context.MasterOrderStaffPiiLocalCache;
const uid = 'uid-security-contract';
const shopId = 42;
cache.saveShopMembers(uid, shopId, [{ publicId: '@member' }]);
assert.equal(
  JSON.stringify(cache.loadShopMembers(uid, shopId)),
  JSON.stringify([{ publicId: '@member' }]),
);

const sdk = context.MasterOrderStaffSdk.createStaffSdk({
  apiBaseUrl: 'https://api.example.invalid',
  getFirebaseUid: () => uid,
  getIdToken: () => Promise.resolve('token'),
});

nextGet = () => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
await assert.rejects(() => sdk.listShopMembers(shopId), /forbidden/);
assert.equal(cache.loadShopMembers(uid, shopId), null, '403 must purge cached PII');

cache.saveShopMembers(uid, shopId, [{ publicId: '@offline-member' }]);
nextGet = () => Promise.reject(Object.assign(new Error('offline'), { status: 0 }));
assert.equal(
  JSON.stringify(await sdk.listShopMembers(shopId)),
  JSON.stringify([{ publicId: '@offline-member' }]),
  'fresh cache may be used only for a transient network failure',
);

const key = `mo:staff:pii:v2:${uid}:members:${shopId}`;
localStorage.setItem(key, JSON.stringify({
  shopId,
  savedAt: Date.now() - 61_000,
  members: [{ publicId: '@expired' }],
}));
await assert.rejects(() => sdk.listShopMembers(shopId), /offline/);
assert.equal(cache.loadShopMembers(uid, shopId), null, 'expired PII must be removed');

cache.saveProfile(uid, { publicId: '@me', familyName: 'A', givenName: 'B' });
assert.equal(cache.loadProfile(uid).publicId, '@me');
assert.equal(cache.loadProfileStale(uid).publicId, '@me');
const profileKey = `mo:staff:pii:v2:${uid}:profile`;
localStorage.setItem(profileKey, JSON.stringify({
  savedAt: Date.now() - (6 * 60 * 1000),
  profile: { publicId: '@stale-me' },
}));
assert.equal(cache.loadProfile(uid), null, 'fresh TTL expired profile is null');
assert.equal(cache.loadProfileStale(uid).publicId, '@stale-me', 'stale profile remains for SWR paint');

let profileHits = 0;
nextGet = () => {
  profileHits += 1;
  return Promise.resolve({ publicId: '@fresh-me', familyName: 'C', givenName: 'D' });
};
const painted = await sdk.getMyProfile();
assert.equal(painted.publicId, '@stale-me', 'getMyProfile returns stale cache immediately');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(profileHits >= 1, 'background refresh should run after SWR paint');

console.log('staff PII cache security contract: OK');
