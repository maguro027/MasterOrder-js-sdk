import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));
require(join(root, '../core/consumption-tax.js'));
require(join(root, 'printer-codec.js'));
require(join(root, 'printer-receipt.js'));

const P = globalThis.MasterOrderPrinter;

function item(overrides) {
    return Object.assign({
        menuName: 'ラーメン',
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
        taxCategory: 'STANDARD'
    }, overrides);
}

function yenSum(lines) {
    return lines.reduce(function (sum, line) {
        var n = Number(line && line.lineTotal);
        return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
}

function taxOf(lines, sessionType) {
    var breakdown = P.computeReceiptTaxBreakdown(lines, sessionType || 'DINE_IN');
    if (!breakdown) {
        return { totalTax: 0, rows: '' };
    }
    var rows = (breakdown.taxByRate || []).map(function (row) {
        return row.percent + ':' + row.base + ':' + row.tax;
    }).join('|');
    return { totalTax: breakdown.totalTax, rows: rows };
}

test('identical lines collapse to one row and money is the sum', function () {
    var cheese = Object.freeze({ name: 'チーズ', price: 100 });
    var egg = Object.freeze({ name: '味玉', price: 150 });
    var first = Object.freeze(item({
        quantity: 1,
        unitPrice: 1250,
        lineTotal: 1250,
        basePrice: 1136,
        toppings: Object.freeze([cheese, egg])
    }));
    var second = Object.freeze(item({
        quantity: 2,
        unitPrice: 1250,
        lineTotal: 2500,
        basePrice: 1136,
        toppings: Object.freeze([egg, cheese]),
        name: 'ラーメン'
    }));
    var before = JSON.parse(JSON.stringify([first, second]));
    var grouped = P.groupIdenticalReceiptLines([first, null, second]);
    assert.deepEqual(JSON.parse(JSON.stringify([first, second])), before);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].quantity, 3);
    assert.equal(grouped[0].lineTotal, 3750);
    assert.equal(grouped[0].unitPrice, 1250);
    assert.equal(grouped[0].basePrice, 1136);
    assert.deepEqual(grouped[0].toppings.map(function (tp) { return [tp.name, tp.price, tp.lineTotal]; }), [
        ['チーズ', 100, 300],
        ['味玉', 150, 450]
    ]);
    assert.equal(yenSum(grouped), yenSum([first, second]));
});

test('topping price, count, tax, and cancel keep rows apart', function () {
    var lines = [
        item({ toppings: [{ name: 'チーズ', price: 100 }] }),
        item({ toppings: [{ name: 'チーズ', price: 150 }] }),
        item({ toppings: [{ name: 'チーズ', price: 100 }, { name: 'チーズ', price: 100 }] }),
        item({ taxCategory: 'REDUCED' }),
        item({ taxCategory: 'CUSTOM', customTaxRatePercent: 8 }),
        item({ unitPrice: 1100, lineTotal: 1100 }),
        item({ cancelled: true }),
        item({ quantity: 2, lineTotal: 2000 })
    ];
    var grouped = P.groupIdenticalReceiptLines(lines);
    assert.equal(grouped.length, lines.length);
    assert.equal(yenSum(grouped), yenSum(lines));
});

test('coupons, discounts, and negative amounts stay one row each', function () {
    var lines = [
        item({ menuName: '【クーポン】ランチ', unitPrice: 300, lineTotal: -300, kind: 'coupon' }),
        item({ menuName: '【クーポン】ランチ', unitPrice: 300, lineTotal: -300, kind: 'coupon' }),
        item({ menuName: 'ランチ割', unitPrice: -300, lineTotal: -300, coupon: true }),
        item({ menuName: 'ランチ割', unitPrice: -300, lineTotal: -300, discountPreset: true }),
        item({ menuName: '端数値引', unitPrice: -50, lineTotal: -50 })
    ];
    var once = P.groupIdenticalReceiptLines(lines);
    var twice = P.groupIdenticalReceiptLines(once);
    assert.equal(once.length, lines.length);
    assert.equal(twice.length, lines.length);
    assert.equal(yenSum(twice), yenSum(lines));
    twice.slice(0, 4).forEach(function (line) {
        assert.equal(line.kind, 'coupon');
    });
    assert.equal(twice[4].lineTotal, -50);
});

test('rows whose total is not unit times quantity are not rounded together', function () {
    var lines = [
        item({ quantity: 2, unitPrice: 100, lineTotal: 201 }),
        item({ quantity: 2, unitPrice: 100, lineTotal: 202 }),
        item({ quantity: 1, unitPrice: null, lineTotal: 500 }),
        item({ quantity: 1, unitPrice: null, lineTotal: 500 }),
        item({ quantity: 1, unitPrice: 1000, lineTotal: 1000, basePrice: 1000 }),
        item({ quantity: 1, unitPrice: 1000, lineTotal: 1000, basePrice: 900 }),
        item({ quantity: 1, unitPrice: 1000, lineTotal: 1000 }),
        item({ menuName: '', quantity: 1, unitPrice: 1000, lineTotal: 1000 }),
        item({ menuName: '  ', name: '', quantity: 1, unitPrice: 1000, lineTotal: 1000 })
    ];
    var grouped = P.groupIdenticalReceiptLines(lines);
    assert.equal(grouped.length, lines.length);
    assert.equal(grouped[2].lineTotal, 500);
    assert.equal(grouped[3].lineTotal, 500);
    assert.equal(grouped[4].basePrice, 1000);
    assert.equal(grouped[5].basePrice, 900);
});

test('partial cancels with exact active totals collapse, and tax does not move', function () {
    var live = item({
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
        basePrice: 455,
        taxCategory: 'REDUCED'
    });
    var other = item({
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
        basePrice: 455,
        taxCategory: 'REDUCED'
    });
    var standard = item({ quantity: 1, unitPrice: 1100, lineTotal: 1100, basePrice: 1000 });
    var coupon = item({
        menuName: '【クーポン】激辛フェス',
        quantity: 1,
        unitPrice: 300,
        lineTotal: -300,
        kind: 'coupon'
    });
    var cancelled = item({ quantity: 1, unitPrice: 1100, lineTotal: 1100, basePrice: 1000, cancelled: true });
    var lines = [live, other, standard, coupon, cancelled];
    var grouped = P.groupIdenticalReceiptLines(lines);
    assert.equal(grouped.length, 4);
    assert.equal(grouped[0].quantity, 4);
    assert.equal(grouped[0].lineTotal, 2000);
    assert.equal(grouped[0].toppings.length, 0);
    assert.deepEqual(taxOf(grouped, 'TAKEOUT'), taxOf(lines, 'TAKEOUT'));
    assert.deepEqual(taxOf(grouped, 'DINE_IN'), taxOf(lines, 'DINE_IN'));
    assert.deepEqual(taxOf(P.groupIdenticalReceiptLines(grouped), 'TAKEOUT'), taxOf(lines, 'TAKEOUT'));
});

test('session history groups the same dish across orders and leaves other dishes', function () {
    var detail = {
        orderHistory: [
            {
                status: 'SERVED',
                items: [
                    {
                        menuName: '餃子',
                        quantity: 1,
                        cancelledQuantity: 0,
                        unitPrice: 480,
                        subTotal: 480,
                        taxCategory: 'STANDARD',
                        toppings: [{ name: '酢', price: 0 }]
                    },
                    {
                        menuName: '【クーポン】会計',
                        quantity: 1,
                        unitPrice: 100,
                        subTotal: -100
                    }
                ]
            },
            {
                status: 'SERVED',
                items: [
                    {
                        menuName: '餃子',
                        quantity: 3,
                        cancelledQuantity: 1,
                        unitPrice: 480,
                        subTotal: 960,
                        taxCategory: 'standard',
                        toppings: [{ name: '酢', price: 0 }]
                    },
                    {
                        menuName: '餃子',
                        quantity: 1,
                        unitPrice: 480,
                        subTotal: 480,
                        taxCategory: 'REDUCED',
                        toppings: [{ name: '酢', price: 0 }]
                    }
                ]
            },
            {
                status: 'CANCELLED',
                discountPreset: true,
                items: [
                    {
                        menuName: 'ランチ割',
                        quantity: 1,
                        unitPrice: -300,
                        subTotal: -300
                    }
                ]
            }
        ]
    };
    var lines = P.flattenSessionReceiptLines(detail);
    var again = P.groupIdenticalReceiptLines(lines);
    assert.equal(lines.length, 4);
    assert.equal(lines[0].name, '餃子');
    assert.equal(lines[0].quantity, 3);
    assert.equal(lines[0].lineTotal, 1440);
    assert.equal(lines[0].toppings[0].lineTotal, 0);
    assert.equal(lines[1].kind, 'coupon');
    assert.equal(lines[1].lineTotal, -100);
    assert.equal(lines[2].taxCategory, 'REDUCED');
    assert.equal(lines[2].quantity, 1);
    assert.equal(lines[3].kind, 'coupon');
    assert.equal(again.length, lines.length);
    assert.equal(yenSum(again), yenSum(lines));

    var payload = P.buildCheckoutReceiptPayload({
        lines: lines,
        totalAmount: yenSum(lines),
        sessionType: 'DINE_IN'
    });
    assert.equal(payload.lines.length, lines.length);
    assert.equal(yenSum(payload.lines), yenSum(lines));
    assert.deepEqual(taxOf(payload.lines, 'DINE_IN'), taxOf(lines, 'DINE_IN'));
});

test('fully voided cancels group with each other and not with priced cancels', function () {
    var lines = [
        item({ quantity: 1, unitPrice: 800, lineTotal: 0, cancelled: true }),
        item({ quantity: 2, unitPrice: 800, lineTotal: 0, cancelled: true }),
        item({ quantity: 1, unitPrice: 800, lineTotal: 800, cancelled: true }),
        item({ quantity: 1, unitPrice: 800, lineTotal: 0 })
    ];
    var grouped = P.groupIdenticalReceiptLines(lines);
    assert.equal(grouped.length, 3);
    assert.equal(grouped[0].quantity, 3);
    assert.equal(grouped[0].lineTotal, 0);
    assert.equal(grouped[0].cancelled, true);
    assert.equal(grouped[1].quantity, 1);
    assert.equal(grouped[1].lineTotal, 800);
    assert.equal(grouped[2].cancelled, false);
    assert.equal(yenSum(grouped), yenSum(lines));
    assert.deepEqual(taxOf(grouped), taxOf(lines));
});

test('zero-yen lines group, and a missing line total is not rewritten to zero', function () {
    var free = [
        item({ menuName: 'お冷や', unitPrice: 0, lineTotal: 0 }),
        item({ menuName: 'お冷や', unitPrice: 0, lineTotal: 0, quantity: 2 })
    ];
    var grouped = P.groupIdenticalReceiptLines(free);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].quantity, 3);
    assert.equal(grouped[0].lineTotal, 0);

    var missing = P.groupIdenticalReceiptLines([
        { menuName: '本日のサラダ', quantity: 1, lineTotal: 680, cancelled: true },
        { menuName: '本日のサラダ', quantity: 1, cancelled: true }
    ]);
    assert.equal(missing.length, 2);
    assert.equal(missing[0].lineTotal, 680);
    assert.equal(missing[1].lineTotal, null);
});
