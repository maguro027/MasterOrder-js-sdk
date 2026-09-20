/**
 * 来客カート同期フロア価格が税込表示と一致すること（税抜 base が catalogPrice に残るケース）。
 * Run: node js-sdk/scripts/guest-menu-pricing-floor-contract.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadGuestMenuPricing() {
    const taxCode = fs.readFileSync(new URL('../core/consumption-tax.js', import.meta.url), 'utf8');
    const pricingCode = fs.readFileSync(new URL('../order/guest-menu-pricing.js', import.meta.url), 'utf8');
    const sandbox = { global: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(taxCode, sandbox);
    sandbox.globalThis = sandbox.global;
    vm.runInContext(pricingCode, sandbox);
    return sandbox.global.MasterOrderGuestMenuPricing;
}

const pricing = loadGuestMenuPricing();

const menu = {
    name: 'シーザーサラダ',
    price: 700,
    basePrice: 642,
    catalogPrice: 642,
    taxCategory: 'STANDARD',
    pricing: {
        listUnitBase: 642,
        effectiveUnitBase: 642,
        discountUnitBase: 0,
        onSale: false,
        display: {
            listPrice: null,
            effectivePrice: 700,
            discountYen: 0,
            onSale: false
        }
    }
};

const display = pricing.buildGuestMenuPriceDisplay(menu);
const floor = pricing.resolveGuestMenuOrderFloorPrice(menu);

assert.equal(display.effectivePrice, 700, 'display must use published tax-inclusive price');
assert.equal(floor, 700, 'order floor must match display tax-inclusive price, not base 642');

console.log('guest-menu-pricing-floor-contract: ok');
