import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const orderSdk = fs.readFileSync(path.join(root, 'order', 'order-sdk.js'), 'utf8');

assert.match(
  orderSdk,
  /params\.delete\('id'\);\s*params\.delete\('pass'\);/,
  'connect success must always strip id/pass from the address bar',
);
assert.doesNotMatch(
  orderSdk,
  /keepIdPass/,
  'shop-slug routes must not retain PIN query parameters after connect',
);
assert.match(
  orderSdk,
  /params\.set\('id', id\);\s*params\.set\('pass', normalizedPin\);/,
  'explicit share/QR URLs must still carry id/pass',
);

console.log('guest URL credential security contract: OK');
