import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = { console, URL, URLSearchParams };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'staff', 'staff-qr-sdk.js'), 'utf8'),
  context,
  { filename: 'staff-qr-sdk.js' }
);

const sdk = context.MasterOrderStaffQrSdk;
assert.equal(typeof sdk.parseStaffQrScanText, 'function');
assert.equal(typeof sdk.staffQrShopMatches, 'function');

const tableQr = sdk.parseStaffQrScanText(
  'https://order.example/Shop/nakano/?tableNo=3&passPhrase=ABCDEFGHIJ'
);
assert.equal(tableQr.kind, 'fixed');
assert.equal(tableQr.tableNo, 3);
assert.equal(tableQr.passPhrase, 'ABCDEFGHIJ');
assert.equal(tableQr.shopSlug, 'nakano');
assert.equal(sdk.staffQrShopMatches('nakano', 'nakano'), true);
assert.equal(sdk.staffQrShopMatches('nakano', 'other-shop'), false);

const pathTableQr = sdk.parseStaffQrScanText(
  'https://order.example/Shop/nakano/2?passPhrase=ABCDEFGHIJ'
);
assert.equal(pathTableQr.kind, 'fixed');
assert.equal(pathTableQr.tableNo, 2);
assert.equal(pathTableQr.passPhrase, 'ABCDEFGHIJ');
assert.equal(pathTableQr.shopSlug, 'nakano');

const creds = sdk.parseStaffQrScanText(
  'https://order.example/Shop/nakano/?id=sid-1&pass=ABCD'
);
assert.equal(creds.kind, 'credentials');
assert.equal(creds.sessionId, 'sid-1');
assert.equal(creds.pin, 'ABCD');

const join = sdk.parseStaffQrScanText(
  'https://order.example/Shop/nakano/?join=opaque-token'
);
assert.equal(join.kind, 'join');
assert.equal(join.joinToken, 'opaque-token');

assert.equal(sdk.parseStaffQrScanText(''), null);
assert.equal(sdk.parseStaffQrScanText('https://example.com/'), null);
assert.equal(sdk.parseStaffQrScanText('not-a-qr please pay 550-1234-5678-9012 now'), null);
assert.equal(
  sdk.parseStaffQrScanText('11111111-2222-3333-4444-555555555555').kind,
  'session'
);
assert.equal(sdk.staffQrShopMatches('', 'nakano'), false);

console.log('staff QR scan contract OK');
