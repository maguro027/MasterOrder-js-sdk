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
  fs.readFileSync(path.join(root, 'core', 'core-sdk.js'), 'utf8'),
  context,
  { filename: 'core-sdk.js' }
);

const sdk = context.MasterOrderCoreSdk;
assert.equal(typeof sdk.normalizePartyFlags, 'function');

function flags(raw) {
  const value = sdk.normalizePartyFlags(raw);
  return [value.family, value.couple, value.companions];
}

assert.deepEqual(flags({ partyCouple: true }), [false, true, false]);
assert.deepEqual(flags({ partyFlags: {}, couple: true }), [false, true, false]);
assert.deepEqual(flags({
  partyFlags: { family: false, couple: false, companions: false },
  partyCouple: true
}), [false, true, false]);
assert.deepEqual(flags({ partyFlags: { couple: true } }), [false, true, false]);
assert.equal(sdk.partyFlagsSignature({ couple: true }), '0:1:0');
assert.equal(sdk.formatPartyFlagsLabel({ couple: true, family: true }), '家族・カップル');
assert.equal(sdk.hasPartyFlagFields({}), false);
assert.equal(sdk.hasPartyFlagFields({ peoples: 2 }), false);
assert.equal(sdk.hasPartyFlagFields({ partyCouple: true }), true);
assert.equal(sdk.hasPartyFlagFields({ partyFlags: { couple: false } }), true);
assert.equal(sdk.normalizePartyFlagsOrNull({ peoples: 2 }), null);
assert.deepEqual(flags(sdk.coalescePartyFlags(null, { couple: true })), [false, true, false]);
assert.deepEqual(flags(sdk.coalescePartyFlags(
  { family: false, couple: false, companions: false },
  { couple: true }
)), [false, true, false]);
assert.deepEqual(flags(sdk.coalescePartyFlags(
  { family: false, couple: false, companions: false },
  { couple: true },
  { confirmed: true }
)), [false, false, false]);
