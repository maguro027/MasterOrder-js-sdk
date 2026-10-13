import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertStaffSdkPartsCoverManifest,
    listStaffBundleSdkFiles,
    loadSdkManifest,
} from '../../scripts/lib/staff-bundle-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = loadSdkManifest(root);
const requiredParts = listStaffBundleSdkFiles(manifest).map((file) => 'sdk/' + file);

assertStaffSdkPartsCoverManifest(requiredParts, manifest);

const withoutEmail = requiredParts.filter((rel) => !rel.endsWith('staff-email-auth-sdk.js'));
assert.notEqual(withoutEmail.length, requiredParts.length, 'email auth must be in the staff manifest');
assert.throws(
    () => assertStaffSdkPartsCoverManifest(withoutEmail, manifest),
    /staff-email-auth-sdk\.js/,
    'the Cloudflare Pages concatenator that omitted email auth must fail the contract'
);

console.log('staff-bundle-contract: stale Pages concatenator is rejected');
