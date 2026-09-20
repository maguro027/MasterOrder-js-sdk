/**
 * MasterOrder Staff Product Analysis SDK — 商品分析 / 店舗売上ダッシュボード描画。
 *
 * 拡張方針:
 * - scope: 'product' | 'shop' | 'topping'(互換)
 * - ProductAnalysisSnapshot を受け取り描画するだけ（集計は adapter 側）
 *
 * グローバル: MasterOrderStaffProductAnalysisSdk
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '0.4.0';

    var THEME = {
        grid: 'rgba(255, 255, 255, 0.1)',
        text: '#b4bdc4',
        tooltipBg: 'rgba(30, 36, 40, 0.95)',
        tooltipBorder: 'rgba(255, 255, 255, 0.12)',
        accent: '#3ec3ff',
        sales: '#28c76f',
        warn: '#ff9f43',
        danger: '#ea5455',
        purple: '#7367f0'
    };

    /** Chart.js のぬるっと更新（destroy→再生成を避ける） */
    var CHART_ANIMATION = {
        duration: 720,
        easing: 'easeInOutQuart'
    };

    /** 性別内訳は固定5区分: 男性 / 女性 / 男児 / 女児 / 未選択 */
    var GENDER_COLORS = {
        male: '#3ec3ff',
        female: '#ff6b9d',
        boys: '#5b8def',
        girls: '#f0a0c0',
        unset: '#8b9dc3'
    };

    var GENDER_KEYS = ['male', 'female', 'boys', 'girls', 'unset'];
    var GENDER_LABELS = {
        male: '男性',
        female: '女性',
        boys: '男児',
        girls: '女児',
        unset: '未選択'
    };

    /** 売上管理 / 商品分析で共有する性別表示モード */
    var sharedGenderDisplayMode = 'percent';

    function getGenderDisplayMode() {
        return sharedGenderDisplayMode === 'count' ? 'count' : 'percent';
    }

    function syncGenderModeButtons() {
        if (typeof document === 'undefined') {
            return;
        }
        var mode = getGenderDisplayMode();
        document.querySelectorAll('.pa-gender-mode-btn').forEach(function (btn) {
            var active = btn.getAttribute('data-gender-mode') === mode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function setGenderDisplayMode(mode) {
        sharedGenderDisplayMode = mode === 'count' ? 'count' : 'percent';
        syncGenderModeButtons();
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
            try {
                document.dispatchEvent(new CustomEvent('mo-pa-gender-mode', {
                    detail: { mode: sharedGenderDisplayMode }
                }));
            } catch (_ignored) { /* ignore */ }
        }
        return sharedGenderDisplayMode;
    }

    function formatGenderValueLabel(value, total, mode) {
        var n = Math.max(0, Number(value) || 0);
        if (mode === 'count') {
            // maleShare 等は「提供数 × 性別人数比」の按分数量（来店人数そのものではない）
            return Math.round(n).toLocaleString('ja-JP') + '個';
        }
        var pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return pct + '%';
    }

    var CATEGORY_COLORS = [
        '#3ec3ff', '#28c76f', '#ff9f43', '#ea5455', '#7367f0',
        '#00cfe8', '#ff6b9d', '#c9a227', '#8b9dc3', '#6fd89a'
    ];

    function formatYen(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            return '—';
        }
        return '¥' + Math.round(n).toLocaleString('ja-JP');
    }

    function formatCount(value, unit) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            return '—';
        }
        return Math.round(n).toLocaleString('ja-JP') + (unit || '');
    }

    function formatSignedPercent(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            return '—';
        }
        var rounded = Math.round(n * 10) / 10;
        var sign = rounded > 0 ? '+' : '';
        return sign + rounded.toLocaleString('ja-JP') + '%';
    }

    function destroyChart(chart) {
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
        }
    }

    function clearHost(host) {
        if (host) {
            host.replaceChildren();
        }
    }

    function appendCanvas(host) {
        var wrap = document.createElement('div');
        wrap.className = 'pa-chart-canvas-wrap';
        var canvas = document.createElement('canvas');
        wrap.appendChild(canvas);
        host.appendChild(wrap);
        return canvas;
    }

    function ensureCanvas(host) {
        if (!host) {
            return null;
        }
        var existing = host.querySelector('.pa-chart-canvas-wrap canvas');
        if (existing) {
            return existing;
        }
        clearHost(host);
        return appendCanvas(host);
    }

    function chartFingerprint(payload) {
        try {
            return JSON.stringify(payload);
        } catch (e) {
            return String(Date.now());
        }
    }

    function isLiveChart(chart) {
        return !!(chart && chart.canvas && chart.canvas.isConnected);
    }

    function softUpdateChart(chart, applyFn) {
        if (!isLiveChart(chart) || typeof applyFn !== 'function') {
            return false;
        }
        try {
            applyFn(chart);
            chart.update();
            maybeResizeChart(chart);
            return true;
        } catch (e) {
            return false;
        }
    }

    function maybeResizeChart(chart) {
        if (!isLiveChart(chart) || typeof chart.resize !== 'function') {
            return;
        }
        try {
            chart.resize();
        } catch (_ignored) { /* ignore */ }
    }

    function chartCanvasHasLayout(chart) {
        if (!isLiveChart(chart) || !chart.canvas) {
            return false;
        }
        var w = chart.canvas.clientWidth || chart.canvas.width || 0;
        var h = chart.canvas.clientHeight || chart.canvas.height || 0;
        return w > 0 && h > 0;
    }

    function renderEmpty(host, message) {
        clearHost(host);
        var empty = document.createElement('div');
        empty.className = 'pa-empty';
        empty.textContent = message || 'データがありません';
        host.appendChild(empty);
    }

    function hostHasEmpty(host) {
        return !!(host && host.querySelector('.pa-empty'));
    }

    function tooltipDefaults() {
        return {
            enabled: true,
            backgroundColor: THEME.tooltipBg,
            titleColor: '#f0f3f5',
            bodyColor: THEME.text,
            borderColor: THEME.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
        };
    }

    function normalizeMenuId(value) {
        if (value == null || value === '' || value === 'all') {
            return null;
        }
        if (typeof value === 'string' && value.indexOf('n:') === 0) {
            return value;
        }
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function sameMenuId(a, b) {
        if (a == null || b == null) {
            return false;
        }
        if (String(a) === String(b)) {
            return true;
        }
        var na = Number(a);
        var nb = Number(b);
        if (!Number.isFinite(na) || !Number.isFinite(nb) || na === 0 || nb === 0) {
            return false;
        }
        return na === nb;
    }

    function menuRecordMatches(row, selected) {
        if (!row || selected == null) {
            return false;
        }
        if (sameMenuId(row.menuId, selected)) {
            return true;
        }
        var raw = String(selected);
        if (raw.indexOf('n:') === 0) {
            return String(row.menuName || '') === raw.slice(2);
        }
        return false;
    }

    function buildMenuOptions(dashboard) {
        var topMenus = dashboard && Array.isArray(dashboard.topMenuSales) ? dashboard.topMenuSales : [];
        return topMenus
            .filter(function (row) {
                if (!row) {
                    return false;
                }
                var qty = Number(row.quantity) || 0;
                var yen = Number(row.revenueYen) || 0;
                var named = !!(row.menuName && String(row.menuName).trim());
                return named || row.menuId != null || qty > 0 || yen > 0;
            })
            .map(function (row) {
                var menuId = row.menuId;
                if (menuId == null || Number(menuId) === 0) {
                    menuId = row.menuName ? ('n:' + String(row.menuName)) : menuId;
                }
                return {
                    menuId: menuId,
                    menuName: row.menuName || ('商品 #' + row.menuId),
                    quantity: Math.max(0, Number(row.quantity) || 0),
                    revenueYen: Math.max(0, Number(row.revenueYen) || 0)
                };
            });
    }

    function collectToppingStats(menuCustomSales, menuId) {
        var toppingPickCount = 0;
        var paidToppingCount = 0;
        var toppingYen = 0;
        var popularityBuckets = {};

        (Array.isArray(menuCustomSales) ? menuCustomSales : []).forEach(function (menu) {
            if (!menu) {
                return;
            }
            if (menuId != null && !menuRecordMatches(menu, menuId)) {
                return;
            }
            var groups = Array.isArray(menu.toppingGroups) ? menu.toppingGroups : [];
            groups.forEach(function (group) {
                if (!group || Number(group.toppingGroupId) === -1) {
                    return;
                }
                var groupId = String(group.toppingGroupId != null ? group.toppingGroupId : group.toppingGroupName || '0');
                if (!popularityBuckets[groupId]) {
                    popularityBuckets[groupId] = {
                        categoryId: group.toppingGroupId,
                        categoryName: group.toppingGroupName || 'トッピング',
                        items: {}
                    };
                }
                var bucket = popularityBuckets[groupId];
                (Array.isArray(group.choices) ? group.choices : []).forEach(function (choice) {
                    var key = String(choice && (choice.customKey || choice.customName) || '');
                    if (!key || key === 'none' || key === '__none__') {
                        return;
                    }
                    var qty = Math.max(0, Number(choice.quantity) || 0);
                    if (qty <= 0) {
                        return;
                    }
                    var yen = Math.max(0, Number(choice.revenueYen) || 0);
                    toppingPickCount += qty;
                    toppingYen += yen;
                    if (yen > 0) {
                        paidToppingCount += qty;
                    }
                    var name = choice.customName || choice.customKey || 'カスタム';
                    if (!bucket.items[name]) {
                        bucket.items[name] = { quantity: 0, revenueYen: 0 };
                    }
                    bucket.items[name].quantity += qty;
                    bucket.items[name].revenueYen += yen;
                });
            });
        });

        var popularity = Object.keys(popularityBuckets).map(function (id, index) {
            var bucket = popularityBuckets[id];
            var items = Object.keys(bucket.items).map(function (name) {
                return {
                    name: name,
                    quantity: bucket.items[name].quantity,
                    revenueYen: bucket.items[name].revenueYen
                };
            }).sort(function (a, b) {
                return b.quantity - a.quantity;
            });
            return {
                categoryId: bucket.categoryId,
                categoryName: bucket.categoryName,
                color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                items: items
            };
        }).filter(function (row) {
            return Array.isArray(row.items) && row.items.length > 0;
        }).sort(function (a, b) {
            var aq = a.items.reduce(function (sum, row) { return sum + row.quantity; }, 0);
            var bq = b.items.reduce(function (sum, row) { return sum + row.quantity; }, 0);
            return bq - aq;
        });

        return {
            toppingPickCount: toppingPickCount,
            paidToppingCount: paidToppingCount,
            toppingYen: toppingYen,
            popularity: popularity
        };
    }

    function hourQuantityFromBucket(bucket) {
        var qty = Number(bucket && bucket.quantity);
        if (Number.isFinite(qty) && qty > 0) {
            return qty;
        }
        var sum = 0;
        var groups = bucket && Array.isArray(bucket.toppingGroups) ? bucket.toppingGroups : [];
        groups.forEach(function (group) {
            (Array.isArray(group && group.choices) ? group.choices : []).forEach(function (choice) {
                sum += Math.max(0, Number(choice && choice.quantity) || 0);
            });
        });
        return sum;
    }

    function hourlyQuantityFromApi(dashboard, menuId) {
        var hourlyMenus = dashboard && Array.isArray(dashboard.menuHourlyToppingSales)
            ? dashboard.menuHourlyToppingSales
            : [];
        if (!hourlyMenus.length) {
            return [];
        }
        var rows = hourlyMenus;
        if (menuId != null) {
            rows = hourlyMenus.filter(function (row) {
                return row && menuRecordMatches(row, menuId);
            });
        }
        var byHour = {};
        rows.forEach(function (row) {
            (Array.isArray(row && row.hours) ? row.hours : []).forEach(function (bucket) {
                if (!bucket) {
                    return;
                }
                var hour = Number(bucket.hour);
                if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
                    return;
                }
                var qty = hourQuantityFromBucket(bucket);
                if (qty > 0) {
                    byHour[hour] = (byHour[hour] || 0) + qty;
                }
            });
        });
        return Object.keys(byHour).sort(function (a, b) {
            return Number(a) - Number(b);
        }).map(function (key) {
            var hour = Number(key);
            return {
                label: String(hour).padStart(2, '0') + ':00',
                hour: hour,
                quantity: byHour[hour]
            };
        });
    }

    function buildHourlyQuantity(dashboard, periodMode, totalQty, salesYen, menuId) {
        var fromApi = hourlyQuantityFromApi(dashboard, menuId);
        if (fromApi.length) {
            return fromApi;
        }
        var salesSeries = dashboard && Array.isArray(dashboard.salesSeries) ? dashboard.salesSeries : [];
        var totalYen = salesSeries.reduce(function (sum, row) {
            return sum + Math.max(0, Number(row.value) || 0);
        }, 0);
        var hourlyQuantity = [];

        if (periodMode === 'day' && salesSeries.length) {
            salesSeries.forEach(function (point) {
                var label = String(point.date || '');
                var hourMatch = label.match(/(\d{1,2})/);
                var hour = hourMatch ? Number(hourMatch[1]) : hourlyQuantity.length;
                var yen = Math.max(0, Number(point.value) || 0);
                var qty = totalYen > 0 && totalQty > 0
                    ? Math.max(0, Math.round((yen / totalYen) * totalQty))
                    : Math.round(yen / 800);
                hourlyQuantity.push({
                    label: String(hour).padStart(2, '0') + ':00',
                    hour: hour,
                    quantity: qty
                });
            });
            return hourlyQuantity;
        }

        return [];
    }

    function buildHourlySelectionRate(popularity, selectedCategoryId) {
        // 後方互換: API 未対応時は空（試作の時間拡散は使わない）
        return [];
    }

    /**
     * Server menuHourlyToppingSales → 時間別選択率。
     * 注文のあった時間だけ返す（19時の注文が他時間に出ない）。
     */
    function buildHourlySelectionRateFromApi(dashboard, menuId, selectedCategoryId) {
        var hourlyMenus = dashboard && Array.isArray(dashboard.menuHourlyToppingSales)
            ? dashboard.menuHourlyToppingSales
            : null;
        if (!hourlyMenus) {
            return { rows: [], real: false };
        }
        var menuRow = null;
        if (menuId != null) {
            menuRow = hourlyMenus.find(function (row) {
                return row && menuRecordMatches(row, menuId);
            }) || null;
        }
        if (!menuRow || !Array.isArray(menuRow.hours)) {
            return { rows: [], real: true };
        }

        var wantAll = selectedCategoryId == null
            || selectedCategoryId === ''
            || selectedCategoryId === 'all';
        var colorByKey = {};
        var colorIndex = 0;
        var rows = [];

        menuRow.hours.forEach(function (bucket) {
            if (!bucket) {
                return;
            }
            var hour = Number(bucket.hour);
            if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
                return;
            }
            var groups = Array.isArray(bucket.toppingGroups) ? bucket.toppingGroups : [];
            if (!wantAll) {
                groups = groups.filter(function (group) {
                    return group
                        && (String(group.toppingGroupId) === String(selectedCategoryId)
                            || String(group.toppingGroupName) === String(selectedCategoryId));
                });
            }
            var qtyByKey = {};
            var labelByKey = {};
            groups.forEach(function (group) {
                if (!group || Number(group.toppingGroupId) === -1) {
                    return;
                }
                (Array.isArray(group.choices) ? group.choices : []).forEach(function (choice) {
                    var key = String(choice && (choice.customKey || choice.customName) || '');
                    if (!key || key === 'none' || key === '__none__') {
                        return;
                    }
                    var qty = Math.max(0, Number(choice.quantity) || 0);
                    if (qty <= 0) {
                        return;
                    }
                    if (!qtyByKey[key]) {
                        qtyByKey[key] = 0;
                        labelByKey[key] = choice.customName || choice.customKey || key;
                        if (!colorByKey[key]) {
                            colorByKey[key] = CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length];
                            colorIndex += 1;
                        }
                    }
                    qtyByKey[key] += qty;
                });
            });
            var keys = Object.keys(qtyByKey);
            if (!keys.length) {
                return;
            }
            var total = keys.reduce(function (sum, key) { return sum + qtyByKey[key]; }, 0) || 1;
            rows.push({
                label: bucket.label || (String(hour).padStart(2, '0') + ':00'),
                hour: hour,
                segments: keys.map(function (key) {
                    return {
                        key: key,
                        label: labelByKey[key],
                        color: colorByKey[key],
                        rate: qtyByKey[key] / total
                    };
                })
            });
        });

        return { rows: rows, real: true };
    }

    function formatAvgServeClock(seconds) {
        var n = Number(seconds);
        if (!Number.isFinite(n) || n <= 0) {
            return null;
        }
        var total = Math.round(n);
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        if (mins <= 0) {
            return secs + '秒';
        }
        return mins + ':' + String(secs).padStart(2, '0');
    }

    function formatAvgServe(seconds) {
        var clock = formatAvgServeClock(seconds);
        return clock ? ('平均 ' + clock) : null;
    }

    function genderRowsFromShares(shares) {
        var src = shares && typeof shares === 'object' ? shares : {};
        var male = Math.max(0, Number(src.maleShare != null ? src.maleShare : src.male) || 0);
        var female = Math.max(0, Number(src.femaleShare != null ? src.femaleShare : src.female) || 0);
        var unset = Math.max(0, Number(src.unsetShare != null ? src.unsetShare : src.unset) || 0);
        var boys = Math.max(0, Number(src.boysShare != null ? src.boysShare : src.boys) || 0);
        var girls = Math.max(0, Number(src.girlsShare != null ? src.girlsShare : src.girls) || 0);
        // レガシー children は男児側へ寄せる（表示は男児/女児のみ）
        var children = Math.max(0, Number(src.childrenShare != null ? src.childrenShare : src.children) || 0);
        if (boys <= 0 && girls <= 0 && children > 0) {
            boys = children;
        }
        var values = {
            male: male,
            female: female,
            boys: boys,
            girls: girls,
            unset: unset
        };
        var rows = [];
        GENDER_KEYS.forEach(function (key) {
            var value = values[key];
            if (value > 0) {
                rows.push({ key: key, label: GENDER_LABELS[key], value: value });
            }
        });
        return rows;
    }

    function normalizeGenderRows(rows) {
        if (!Array.isArray(rows) || !rows.length) {
            return [];
        }
        var byKey = Object.create(null);
        rows.forEach(function (row) {
            if (!row) {
                return;
            }
            var key = String(row.key || '');
            // 旧「子ども」は男児へ寄せる
            if (key === 'children') {
                key = 'boys';
            }
            if (!GENDER_LABELS[key]) {
                return;
            }
            byKey[key] = (byKey[key] || 0) + Math.max(0, Number(row.value) || 0);
        });
        return genderRowsFromShares({
            male: byKey.male || 0,
            female: byKey.female || 0,
            boys: byKey.boys || 0,
            girls: byKey.girls || 0,
            unset: byKey.unset || 0
        });
    }

    function genderFromDashboard(dashboard, selectedMenu, opts) {
        if (opts && opts.gender && Array.isArray(opts.gender) && opts.gender.length) {
            return { rows: normalizeGenderRows(opts.gender), provisional: false };
        }
        if (selectedMenu) {
            return {
                rows: genderRowsFromShares(selectedMenu),
                provisional: false
            };
        }
        // 店舗スコープは top12 合算ではなく、サーバーが top 切り詰め前に載せた合算を優先
        var totals = dashboard && dashboard.genderShareTotals;
        if (totals && typeof totals === 'object') {
            var fromTotals = genderRowsFromShares(totals);
            if (fromTotals.length) {
                return { rows: fromTotals, provisional: false };
            }
        }
        var topMenus = dashboard && Array.isArray(dashboard.topMenuSales) ? dashboard.topMenuSales : [];
        var summed = {
            maleShare: 0,
            femaleShare: 0,
            unsetShare: 0,
            boysShare: 0,
            girlsShare: 0,
            childrenShare: 0
        };
        topMenus.forEach(function (row) {
            if (!row) {
                return;
            }
            summed.maleShare += Math.max(0, Number(row.maleShare) || 0);
            summed.femaleShare += Math.max(0, Number(row.femaleShare) || 0);
            summed.unsetShare += Math.max(0, Number(row.unsetShare) || 0);
            summed.boysShare += Math.max(0, Number(row.boysShare) || 0);
            summed.girlsShare += Math.max(0, Number(row.girlsShare) || 0);
            summed.childrenShare += Math.max(0, Number(row.childrenShare) || 0);
        });
        return { rows: genderRowsFromShares(summed), provisional: false };
    }

    function buildVisitorSalesSeries(dashboard) {
        var visitors = dashboard && Array.isArray(dashboard.visitorSeries) ? dashboard.visitorSeries : [];
        var sales = dashboard && Array.isArray(dashboard.salesSeries) ? dashboard.salesSeries : [];
        var salesByLabel = {};
        sales.forEach(function (row) {
            if (!row || row.date == null) {
                return;
            }
            salesByLabel[String(row.date)] = Math.max(0, Number(row.value) || 0);
        });
        var points = [];
        var seen = {};
        visitors.forEach(function (row, index) {
            var label = row && row.date != null ? String(row.date) : String(index);
            seen[label] = true;
            var salesValue = Object.prototype.hasOwnProperty.call(salesByLabel, label)
                ? salesByLabel[label]
                : Math.max(0, Number((sales[index] && sales[index].value) || 0));
            points.push({
                label: label,
                guests: Math.max(0, Number(row && row.value) || 0),
                sales: salesValue
            });
        });
        // visitor が空でも sales があれば軸を出す（来店 0 × 売上あり）
        if (!points.length && sales.length) {
            sales.forEach(function (row, index) {
                var label = row && row.date != null ? String(row.date) : String(index);
                points.push({
                    label: label,
                    guests: 0,
                    sales: Math.max(0, Number(row && row.value) || 0)
                });
            });
        } else {
            sales.forEach(function (row, index) {
                if (!row || row.date == null) {
                    return;
                }
                var label = String(row.date);
                if (seen[label]) {
                    return;
                }
                points.push({
                    label: label,
                    guests: 0,
                    sales: Math.max(0, Number(row.value) || 0)
                });
            });
        }
        // 前後のゼロ期間を落としてムダに長い軸を圧縮
        var first = 0;
        var last = points.length - 1;
        while (first <= last && points[first].guests === 0 && points[first].sales === 0) {
            first += 1;
        }
        while (last >= first && points[last].guests === 0 && points[last].sales === 0) {
            last -= 1;
        }
        if (first > last) {
            return [];
        }
        first = Math.max(0, first - 1);
        last = Math.min(points.length - 1, last + 1);
        return points.slice(first, last + 1);
    }

    /**
     * ShopDashboardResponse → ProductAnalysisSnapshot（商品スコープ）
     */
    function buildProductAnalysisSnapshot(dashboard, options) {
        var opts = options || {};
        var periodMode = opts.periodMode === 'day' ? 'day' : 'month';
        var periodLabel = opts.periodLabel || (periodMode === 'day' ? '本日' : '今月');
        var menuId = normalizeMenuId(opts.menuId);
        var topMenus = dashboard && Array.isArray(dashboard.topMenuSales) ? dashboard.topMenuSales : [];
        var selectedMenu = null;
        if (menuId != null) {
            selectedMenu = topMenus.find(function (row) {
                return row && menuRecordMatches(row, menuId);
            }) || null;
        }

        var salesYen;
        var salesQty;
        if (selectedMenu) {
            salesYen = Math.max(0, Number(selectedMenu.revenueYen) || 0);
            salesQty = Math.max(0, Number(selectedMenu.quantity) || 0);
        } else {
            salesYen = Number(dashboard && dashboard.periodTotals && dashboard.periodTotals.totalSalesYen) || 0;
            salesQty = topMenus.reduce(function (sum, row) {
                return sum + Math.max(0, Number(row && row.quantity) || 0);
            }, 0);
        }

        var topping = collectToppingStats(
            dashboard && dashboard.menuCustomSales,
            menuId
        );
        var hourlyQuantity = buildHourlyQuantity(dashboard, periodMode, salesQty, salesYen, menuId);
        var genderInfo = genderFromDashboard(dashboard, selectedMenu, opts);
        var gender = genderInfo.rows;
        var popularity = topping.popularity;
        var toppingGroupId = opts.toppingGroupId != null ? opts.toppingGroupId : 'all';
        var hourlyFromApi = buildHourlySelectionRateFromApi(dashboard, menuId, toppingGroupId);
        var hourlySelectionRate = hourlyFromApi.real
            ? hourlyFromApi.rows
            : buildHourlySelectionRate(popularity, toppingGroupId);
        var momPercent = opts.momPercent != null ? opts.momPercent : null;
        var hasToppingCategories = popularity.length > 0;
        var avgServeSeconds = selectedMenu && selectedMenu.avgServeSeconds != null
            ? Number(selectedMenu.avgServeSeconds)
            : null;
        var avgServeClock = formatAvgServeClock(avgServeSeconds);
        var avgServeLabel = avgServeClock ? ('平均 ' + avgServeClock) : null;

        return {
            scope: 'product',
            menuId: menuId,
            menuName: selectedMenu ? (selectedMenu.menuName || '') : '',
            periodMode: periodMode,
            periodLabel: periodLabel,
            toppingGroupId: toppingGroupId,
            provisional: {
                gender: genderInfo.provisional || gender.length === 0,
                hourlyQuantity: periodMode !== 'day',
                hourlySelectionRate: !hourlyFromApi.real,
                toppingSalesYen: topping.toppingYen <= 0 && topping.toppingPickCount > 0
            },
            kpi: {
                salesYen: salesYen,
                salesQty: salesQty,
                salesQtyLabel: formatCount(salesQty, '個'),
                secondaryYen: topping.toppingYen,
                secondaryLabel: 'トッピング売上',
                secondaryCount: topping.paidToppingCount,
                secondaryCountLabel: '有料トッピング' + formatCount(topping.paidToppingCount, '個'),
                momPercent: momPercent,
                avgServeSeconds: avgServeSeconds,
                avgServeClock: avgServeClock,
                avgServeLabel: avgServeLabel,
                avgServeHint: avgServeClock
                    ? (periodMode === 'day' ? '日次確定' : '期間加重')
                    : null
            },
            hourlyQuantity: hourlyQuantity,
            gender: gender,
            popularity: popularity,
            hourlySelectionRate: hourlySelectionRate,
            bottomLeftMode: 'popularity',
            bottomRightMode: 'selectionRate'
        };
    }

    /** @deprecated 互換 — buildProductAnalysisSnapshot を使う */
    function buildToppingAnalysisSnapshot(dashboard, options) {
        return buildProductAnalysisSnapshot(dashboard, options);
    }

    /**
     * ShopDashboardResponse → 店舗売上スナップショット（商品分析と同UI）
     */
    function buildShopAnalysisSnapshot(dashboard, options) {
        var opts = options || {};
        var periodMode = opts.periodMode === 'day' ? 'day' : 'month';
        var periodLabel = opts.periodLabel || (periodMode === 'day' ? '本日' : '今月');
        var salesLabel = opts.salesLabel
            || (periodMode === 'day' ? '日の売上' : '月の売上');
        var topMenus = dashboard && Array.isArray(dashboard.topMenuSales) ? dashboard.topMenuSales : [];
        var salesYen = Number(dashboard && dashboard.periodTotals && dashboard.periodTotals.totalSalesYen) || 0;
        var salesQty = topMenus.reduce(function (sum, row) {
            return sum + Math.max(0, Number(row && row.quantity) || 0);
        }, 0);
        var topping = collectToppingStats(dashboard && dashboard.menuCustomSales, null);
        var hourlyQuantity = buildHourlyQuantity(dashboard, periodMode, salesQty, salesYen, null);
        var genderInfo = genderFromDashboard(dashboard, null, opts);
        var gender = genderInfo.rows;
        var popularMenus = topMenus.slice(0, 8).map(function (row, index) {
            return {
                menuId: row.menuId,
                name: row.menuName || ('商品 #' + row.menuId),
                quantity: Math.max(0, Number(row.quantity) || 0),
                revenueYen: Math.max(0, Number(row.revenueYen) || 0),
                avgServeSeconds: row.avgServeSeconds != null ? Number(row.avgServeSeconds) : null,
                avgServeLabel: formatAvgServe(row.avgServeSeconds),
                color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]
            };
        });
        var visitorSales = buildVisitorSalesSeries(dashboard);
        var avgStaySeconds = dashboard && dashboard.avgStaySeconds != null
            ? Number(dashboard.avgStaySeconds)
            : null;
        var avgStayClock = formatAvgServeClock(avgStaySeconds);
        var hourlyStay = buildHourlyStaySeries(dashboard);

        return {
            scope: 'shop',
            periodMode: periodMode,
            periodLabel: periodLabel,
            salesLabel: salesLabel,
            provisional: {
                gender: genderInfo.provisional || gender.length === 0,
                hourlyQuantity: false,
                hourlyStay: hourlyStay.length === 0
            },
            kpi: {
                salesYen: salesYen,
                salesQty: salesQty,
                salesQtyLabel: formatCount(salesQty, '個'),
                secondaryYen: topping.toppingYen,
                secondaryLabel: 'トッピング売上',
                secondaryCount: topping.paidToppingCount,
                secondaryCountLabel: '有料トッピング' + formatCount(topping.paidToppingCount, '個'),
                momPercent: opts.momPercent != null ? opts.momPercent : null,
                avgStaySeconds: avgStaySeconds,
                avgStayClock: avgStayClock,
                avgStayHint: avgStayClock ? '会計完了セッション' : null
            },
            hourlyQuantity: hourlyQuantity,
            hourlyStay: hourlyStay,
            gender: gender,
            popularMenus: popularMenus,
            visitorSales: visitorSales,
            bottomLeftMode: 'popularMenus',
            bottomRightMode: 'visitorSales'
        };
    }

    /** Server avgStaySeries → 開始時刻時間帯別の平均滞在秒 */
    function buildHourlyStaySeries(dashboard) {
        var series = dashboard && Array.isArray(dashboard.avgStaySeries) ? dashboard.avgStaySeries : [];
        if (!series.length) {
            return [];
        }
        return series.map(function (point, index) {
            var label = String(point && point.date != null ? point.date : index);
            var hourMatch = label.match(/(\d{1,2})/);
            var hour = hourMatch ? Number(hourMatch[1]) : index;
            return {
                label: String(hour).padStart(2, '0') + ':00',
                hour: hour,
                staySeconds: Math.max(0, Number(point && point.value) || 0)
            };
        });
    }

    function createProductAnalysisCharts(options) {
        var opts = options || {};
        var Chart = opts.Chart || global.Chart;
        var charts = {
            hourly: null,
            gender: null,
            selectionRate: null,
            visitorSales: null
        };
        var lastGenderHost = null;
        var lastGenderSnapshot = null;

        function destroyAll() {
            Object.keys(charts).forEach(function (key) {
                destroyChart(charts[key]);
                charts[key] = null;
            });
            lastGenderHost = null;
            lastGenderSnapshot = null;
        }

        function resizeAll() {
            Object.keys(charts).forEach(function (key) {
                maybeResizeChart(charts[key]);
            });
        }

        function applyGenderDisplayMode(mode) {
            setGenderDisplayMode(mode);
            if (lastGenderHost && lastGenderSnapshot) {
                if (charts.gender) {
                    charts.gender.$paFp = null;
                }
                renderGender(lastGenderHost, lastGenderSnapshot);
            }
            return getGenderDisplayMode();
        }

        /** 指紋一致でもレイアウト未確定なら再描画させる */
        function shouldSkipRedraw(chart, fingerprint) {
            if (!isLiveChart(chart) || chart.$paFp !== fingerprint) {
                return false;
            }
            if (!chartCanvasHasLayout(chart)) {
                maybeResizeChart(chart);
                return chartCanvasHasLayout(chart);
            }
            maybeResizeChart(chart);
            return true;
        }

        function ensureAvgServeKpiBlock(cardEl) {
            if (!cardEl || cardEl.querySelector('[data-pa-kpi="avg-serve"]')) {
                return;
            }
            var block = document.createElement('div');
            block.className = 'pa-kpi-block pa-kpi-block--avg-serve';
            block.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="avg-serve-label">平均提供時間</div>'
                + '<div class="pa-kpi-value-row">'
                + '<div class="pa-kpi-value pa-kpi-value--sub" data-pa-kpi="avg-serve">—</div>'
                + '<div class="pa-kpi-qty" data-pa-kpi="avg-serve-hint"></div></div>';
            var momEl = cardEl.querySelector('[data-pa-kpi="mom"]');
            if (momEl && momEl.parentNode === cardEl) {
                cardEl.insertBefore(block, momEl);
            } else {
                cardEl.appendChild(block);
            }
        }

        function ensureAvgStayKpiBlock(cardEl) {
            if (!cardEl || cardEl.querySelector('[data-pa-kpi="avg-stay"]')) {
                return;
            }
            var block = document.createElement('div');
            block.className = 'pa-kpi-block pa-kpi-block--avg-stay';
            block.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="avg-stay-label">平均滞在時間</div>'
                + '<div class="pa-kpi-value-row">'
                + '<div class="pa-kpi-value pa-kpi-value--sub" data-pa-kpi="avg-stay">—</div>'
                + '<div class="pa-kpi-qty" data-pa-kpi="avg-stay-hint"></div></div>';
            var momEl = cardEl.querySelector('[data-pa-kpi="mom"]');
            if (momEl && momEl.parentNode === cardEl) {
                cardEl.insertBefore(block, momEl);
            } else {
                cardEl.appendChild(block);
            }
        }

        function renderKpi(cardEl, snapshot) {
            if (!cardEl || !snapshot || !snapshot.kpi) {
                return;
            }
            if (!cardEl.querySelector('[data-pa-kpi="sales"]')) {
                cardEl.replaceChildren();
                var rebuildKicker = document.createElement('div');
                rebuildKicker.className = 'pa-card-kicker';
                rebuildKicker.setAttribute('data-pa-kpi', 'period');
                var salesBlock = document.createElement('div');
                salesBlock.className = 'pa-kpi-block';
                salesBlock.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="sales-label"></div>'
                    + '<div class="pa-kpi-value-row">'
                    + '<div class="pa-kpi-value" data-pa-kpi="sales"></div>'
                    + '<div class="pa-kpi-qty" data-pa-kpi="sales-qty"></div></div>';
                var secondaryBlock = document.createElement('div');
                secondaryBlock.className = 'pa-kpi-block';
                secondaryBlock.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="secondary-label"></div>'
                    + '<div class="pa-kpi-value-row">'
                    + '<div class="pa-kpi-value pa-kpi-value--sub" data-pa-kpi="secondary"></div>'
                    + '<div class="pa-kpi-qty" data-pa-kpi="secondary-qty"></div></div>';
                var avgServeBlock = document.createElement('div');
                avgServeBlock.className = 'pa-kpi-block pa-kpi-block--avg-serve';
                avgServeBlock.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="avg-serve-label">平均提供時間</div>'
                    + '<div class="pa-kpi-value-row">'
                    + '<div class="pa-kpi-value pa-kpi-value--sub" data-pa-kpi="avg-serve">—</div>'
                    + '<div class="pa-kpi-qty" data-pa-kpi="avg-serve-hint"></div></div>';
                var avgStayBlock = document.createElement('div');
                avgStayBlock.className = 'pa-kpi-block pa-kpi-block--avg-stay';
                avgStayBlock.innerHTML = '<div class="pa-kpi-label" data-pa-kpi="avg-stay-label">平均滞在時間</div>'
                    + '<div class="pa-kpi-value-row">'
                    + '<div class="pa-kpi-value pa-kpi-value--sub" data-pa-kpi="avg-stay">—</div>'
                    + '<div class="pa-kpi-qty" data-pa-kpi="avg-stay-hint"></div></div>';
                var rebuildMom = document.createElement('div');
                rebuildMom.className = 'pa-kpi-mom';
                rebuildMom.setAttribute('data-pa-kpi', 'mom');
                cardEl.appendChild(rebuildKicker);
                cardEl.appendChild(salesBlock);
                cardEl.appendChild(secondaryBlock);
                cardEl.appendChild(avgServeBlock);
                cardEl.appendChild(avgStayBlock);
                cardEl.appendChild(rebuildMom);
            }
            ensureAvgServeKpiBlock(cardEl);
            ensureAvgStayKpiBlock(cardEl);
            var salesEl = cardEl.querySelector('[data-pa-kpi="sales"]');
            var salesQtyEl = cardEl.querySelector('[data-pa-kpi="sales-qty"]');
            var secondaryEl = cardEl.querySelector('[data-pa-kpi="secondary"]');
            var secondaryLabelEl = cardEl.querySelector('[data-pa-kpi="secondary-label"]');
            var secondaryQtyEl = cardEl.querySelector('[data-pa-kpi="secondary-qty"]');
            var avgServeEl = cardEl.querySelector('[data-pa-kpi="avg-serve"]');
            var avgServeHintEl = cardEl.querySelector('[data-pa-kpi="avg-serve-hint"]');
            var avgServeBlockEl = cardEl.querySelector('.pa-kpi-block--avg-serve');
            var avgStayEl = cardEl.querySelector('[data-pa-kpi="avg-stay"]');
            var avgStayHintEl = cardEl.querySelector('[data-pa-kpi="avg-stay-hint"]');
            var avgStayBlockEl = cardEl.querySelector('.pa-kpi-block--avg-stay');
            var avgStayLabelEl = cardEl.querySelector('[data-pa-kpi="avg-stay-label"]');
            var momEl = cardEl.querySelector('[data-pa-kpi="mom"]');
            var periodEl = cardEl.querySelector('[data-pa-kpi="period"]');
            if (periodEl) {
                periodEl.textContent = snapshot.periodLabel || '';
            }
            if (salesEl) {
                salesEl.textContent = formatYen(snapshot.kpi.salesYen);
            }
            var salesLabelEl = cardEl.querySelector('[data-pa-kpi="sales-label"]');
            if (salesLabelEl) {
                salesLabelEl.textContent = snapshot.salesLabel
                    || (snapshot.periodMode === 'day' ? '日の売上' : '月の売上');
            }
            if (salesQtyEl) {
                salesQtyEl.textContent = snapshot.kpi.salesQtyLabel
                    ? '（' + snapshot.kpi.salesQtyLabel + '）'
                    : '';
            }
            if (secondaryLabelEl) {
                secondaryLabelEl.textContent = snapshot.kpi.secondaryLabel || 'トッピング売上';
            }
            if (secondaryEl) {
                secondaryEl.textContent = formatYen(snapshot.kpi.secondaryYen);
            }
            if (secondaryQtyEl) {
                secondaryQtyEl.textContent = snapshot.kpi.secondaryCountLabel
                    ? '（' + snapshot.kpi.secondaryCountLabel + '）'
                    : '';
            }
            var showAvgServe = snapshot.scope === 'product' && !!snapshot.kpi.avgServeClock;
            if (avgServeBlockEl) {
                avgServeBlockEl.hidden = !showAvgServe;
            }
            if (avgServeEl) {
                avgServeEl.textContent = showAvgServe ? snapshot.kpi.avgServeClock : '—';
            }
            if (avgServeHintEl) {
                avgServeHintEl.textContent = showAvgServe && snapshot.kpi.avgServeHint
                    ? '（' + snapshot.kpi.avgServeHint + '）'
                    : '';
            }
            var showAvgStay = snapshot.scope === 'shop' && !!snapshot.kpi.avgStayClock;
            if (avgStayBlockEl) {
                avgStayBlockEl.hidden = !showAvgStay && snapshot.scope !== 'shop';
            }
            if (avgStayLabelEl) {
                avgStayLabelEl.textContent = '平均滞在時間';
            }
            if (avgStayEl) {
                avgStayEl.textContent = showAvgStay ? snapshot.kpi.avgStayClock : '—';
            }
            if (avgStayHintEl) {
                avgStayHintEl.textContent = showAvgStay && snapshot.kpi.avgStayHint
                    ? '（' + snapshot.kpi.avgStayHint + '）'
                    : '';
            }
            if (momEl) {
                var mom = snapshot.kpi.momPercent;
                if (mom == null || mom === '') {
                    momEl.hidden = true;
                    momEl.textContent = '';
                    momEl.classList.remove('is-up', 'is-down', 'is-flat');
                } else {
                    momEl.hidden = false;
                    momEl.textContent = '前月比 ' + formatSignedPercent(mom);
                    momEl.classList.toggle('is-up', Number(mom) > 0);
                    momEl.classList.toggle('is-down', Number(mom) < 0);
                    momEl.classList.toggle('is-flat', Number(mom) === 0);
                }
            }
        }

        function renderHourlyQuantity(host, snapshot) {
            if (!host) {
                return;
            }
            if (!Chart) {
                destroyChart(charts.hourly);
                charts.hourly = null;
                renderEmpty(host, 'Chart.js を読み込めませんでした');
                return;
            }
            var useStay = snapshot && snapshot.scope === 'shop'
                && Array.isArray(snapshot.hourlyStay)
                && snapshot.hourlyStay.length > 0;
            var rows = useStay
                ? snapshot.hourlyStay
                : (snapshot && Array.isArray(snapshot.hourlyQuantity) ? snapshot.hourlyQuantity : []);
            if (snapshot && snapshot.periodMode === 'month' && !useStay) {
                rows = rows.filter(function (row) {
                    return Number.isFinite(Number(row.hour))
                        && Number(row.hour) >= 0
                        && Number(row.hour) <= 23
                        && Number(row.quantity) > 0;
                });
            }
            if (useStay) {
                // 開始ありセッションが無い時間はグラフから省く
                rows = rows.filter(function (row) {
                    return Number(row.staySeconds) > 0;
                });
            }
            if (!rows.length) {
                destroyChart(charts.hourly);
                charts.hourly = null;
                renderEmpty(host, useStay ? '滞在時間データがありません' : '時間別データがありません');
                return;
            }
            var labels = rows.map(function (row) { return row.label; });
            var values = rows.map(function (row) {
                return useStay
                    ? Math.round((Number(row.staySeconds) || 0) / 60)
                    : row.quantity;
            });
            var fp = chartFingerprint({ labels: labels, values: values, mode: useStay ? 'stay' : 'qty' });
            if (shouldSkipRedraw(charts.hourly, fp)) {
                return;
            }
            if (softUpdateChart(charts.hourly, function (chart) {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                chart.data.datasets[0].label = useStay ? '平均滞在（分）' : '販売個数';
                chart.$paFp = fp;
            })) {
                return;
            }
            destroyChart(charts.hourly);
            charts.hourly = null;
            var canvas = ensureCanvas(host);
            charts.hourly = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: useStay ? '平均滞在（分）' : '販売個数',
                        data: values,
                        borderColor: THEME.accent,
                        backgroundColor: 'rgba(62, 195, 255, 0.22)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: CHART_ANIMATION,
                    layout: {
                        padding: { top: 6, right: 6, bottom: 4, left: 2 }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: tooltipDefaults()
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: THEME.text,
                                maxRotation: 0,
                                minRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 8,
                                font: { size: 10 }
                            },
                            grid: { color: THEME.grid, drawBorder: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: THEME.text,
                                precision: 0,
                                font: { size: 10 }
                            },
                            grid: { color: THEME.grid, drawBorder: false }
                        }
                    }
                }
            });
            charts.hourly.$paFp = fp;
        }

        function ensureGenderLayout(host) {
            host.classList.add('pa-chart-host--gender');
            var wrap = host.querySelector('.pa-chart-canvas-wrap');
            var legend = host.querySelector('.pa-gender-legend');
            if (!wrap || !legend) {
                host.replaceChildren();
                wrap = document.createElement('div');
                wrap.className = 'pa-chart-canvas-wrap';
                wrap.appendChild(document.createElement('canvas'));
                legend = document.createElement('div');
                legend.className = 'pa-gender-legend';
                legend.setAttribute('aria-label', '性別内訳');
                host.appendChild(wrap);
                host.appendChild(legend);
            }
            var canvas = wrap.querySelector('canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                wrap.replaceChildren(canvas);
            }
            return { canvas: canvas, legend: legend };
        }

        function paintGenderLegend(legendEl, rows, values, colors, mode) {
            if (!legendEl) {
                return;
            }
            var total = values.reduce(function (sum, v) {
                return sum + Math.max(0, Number(v) || 0);
            }, 0) || 1;
            legendEl.replaceChildren();
            rows.forEach(function (row, index) {
                var item = document.createElement('div');
                item.className = 'pa-gender-legend-item';
                var swatch = document.createElement('span');
                swatch.className = 'pa-gender-legend-swatch';
                swatch.style.background = colors[index] || THEME.accent;
                swatch.setAttribute('aria-hidden', 'true');
                var text = document.createElement('span');
                text.className = 'pa-gender-legend-text';
                text.textContent = (row.label || '') + '  '
                    + formatGenderValueLabel(values[index], total, mode);
                item.appendChild(swatch);
                item.appendChild(text);
                legendEl.appendChild(item);
            });
        }

        function renderGender(host, snapshot) {
            if (!host) {
                return;
            }
            lastGenderHost = host;
            lastGenderSnapshot = snapshot;
            if (!Chart) {
                destroyChart(charts.gender);
                charts.gender = null;
                renderEmpty(host, 'Chart.js を読み込めませんでした');
                return;
            }
            var rows = snapshot && Array.isArray(snapshot.gender) ? snapshot.gender : [];
            if (!rows.length) {
                destroyChart(charts.gender);
                charts.gender = null;
                renderEmpty(host, '性別データがありません');
                return;
            }
            var mode = getGenderDisplayMode();
            var labels = rows.map(function (row) { return row.label; });
            var values = rows.map(function (row) { return Math.max(0, Number(row.value) || 0); });
            var colors = rows.map(function (row) {
                return GENDER_COLORS[row.key] || THEME.accent;
            });
            var fp = chartFingerprint({ labels: labels, values: values, colors: colors, mode: mode });
            var layout = ensureGenderLayout(host);
            paintGenderLegend(layout.legend, rows, values, colors, mode);
            if (shouldSkipRedraw(charts.gender, fp)) {
                return;
            }
            if (softUpdateChart(charts.gender, function (chart) {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                chart.data.datasets[0].backgroundColor = colors;
                chart.$paGenderMode = mode;
                chart.$paFp = fp;
            })) {
                return;
            }
            destroyChart(charts.gender);
            charts.gender = null;
            charts.gender = new Chart(layout.canvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors,
                        borderColor: '#151a1e',
                        borderWidth: 2,
                        hoverOffset: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '62%',
                    animation: CHART_ANIMATION,
                    layout: {
                        padding: 0
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: Object.assign({}, tooltipDefaults(), {
                            callbacks: {
                                label: function (context) {
                                    var data = context.dataset.data || [];
                                    var sum = data.reduce(function (a, b) {
                                        return a + Math.max(0, Number(b) || 0);
                                    }, 0) || 1;
                                    var currentMode = context.chart.$paGenderMode || getGenderDisplayMode();
                                    return ' ' + context.label + ': '
                                        + formatGenderValueLabel(context.parsed, sum, currentMode);
                                }
                            }
                        })
                    }
                }
            });
            charts.gender.$paGenderMode = mode;
            charts.gender.$paFp = fp;
        }

        function renderPopularity(host, snapshot) {
            if (!host) {
                return;
            }
            var categories = snapshot && Array.isArray(snapshot.popularity) ? snapshot.popularity : [];
            if (!categories.length) {
                renderEmpty(host, 'トッピング人気データがありません');
                return;
            }
            var selected = snapshot && snapshot.toppingGroupId != null
                ? String(snapshot.toppingGroupId)
                : 'all';
            var isOverall = !selected || selected === 'all' || selected === 'overall';
            var viewCategories;
            if (isOverall) {
                // 総合: 各トッピンググループの1番人気のみ（割合はグループ内シェア）
                viewCategories = categories.map(function (category) {
                    var allItems = Array.isArray(category.items) ? category.items : [];
                    var top = allItems.length ? allItems[0] : null;
                    var groupTotal = allItems.reduce(function (sum, item) {
                        return sum + Math.max(0, Number(item && item.quantity) || 0);
                    }, 0);
                    return {
                        categoryId: category.categoryId,
                        categoryName: category.categoryName,
                        color: category.color,
                        overallMode: true,
                        groupTotal: groupTotal,
                        items: top ? [top] : []
                    };
                }).filter(function (category) {
                    return category.items.length > 0 && category.groupTotal > 0;
                });
            } else {
                viewCategories = categories.filter(function (category) {
                    return String(category.categoryId != null ? category.categoryId : '') === selected
                        || String(category.categoryName || '') === selected;
                });
            }
            if (!viewCategories.length) {
                renderEmpty(host, 'トッピング人気データがありません');
                return;
            }
            var fp = chartFingerprint({
                selected: selected,
                rows: viewCategories.map(function (category) {
                    return {
                        id: category.categoryId,
                        name: category.categoryName,
                        overall: !!category.overallMode,
                        groupTotal: category.groupTotal || 0,
                        items: (category.items || []).slice(0, category.overallMode ? 1 : 6).map(function (item) {
                            return { name: item.name, quantity: item.quantity };
                        })
                    };
                })
            });
            if (host.$paFp === fp && host.querySelector('.pa-popularity-list') && !hostHasEmpty(host)) {
                return;
            }

            var list = host.querySelector('.pa-popularity-list');
            if (!list || hostHasEmpty(host)) {
                clearHost(host);
                list = document.createElement('div');
                list.className = 'pa-popularity-list';
                host.appendChild(list);
            }
            list.replaceChildren();
            viewCategories.slice(0, 8).forEach(function (category) {
                var row = document.createElement('div');
                row.className = 'pa-popularity-row'
                    + (category.overallMode ? ' pa-popularity-row--overall' : '');

                var label = document.createElement('div');
                label.className = 'pa-popularity-label';
                label.textContent = category.categoryName || 'トッピング';
                row.appendChild(label);

                // 全て（総合）: グラフではなく「XX% トッピング名」の文字だけ
                if (category.overallMode) {
                    var topItem = (category.items || [])[0];
                    var groupTotal = Math.max(1, Number(category.groupTotal) || 0);
                    var topQty = Math.max(0, Number(topItem && topItem.quantity) || 0);
                    var topPct = Math.round((topQty / groupTotal) * 100);
                    var value = document.createElement('div');
                    value.className = 'pa-popularity-top-value';
                    value.title = (topItem && topItem.name ? topItem.name : '')
                        + ' · ' + topPct + '%（' + topQty + '回）';
                    var pctEl = document.createElement('span');
                    pctEl.className = 'pa-popularity-top-pct';
                    pctEl.textContent = topPct + '%';
                    var nameEl = document.createElement('span');
                    nameEl.className = 'pa-popularity-top-name';
                    nameEl.textContent = topItem && topItem.name ? topItem.name : '—';
                    value.appendChild(pctEl);
                    value.appendChild(nameEl);
                    row.appendChild(value);
                    list.appendChild(row);
                    return;
                }

                var track = document.createElement('div');
                track.className = 'pa-popularity-track';
                var items = (category.items || []).slice(0, 6);
                var total = items.reduce(function (sum, item) {
                    return sum + Math.max(0, Number(item.quantity) || 0);
                }, 0) || 1;
                items.forEach(function (item, index) {
                    var seg = document.createElement('div');
                    seg.className = 'pa-popularity-seg';
                    var qtyLabel = Math.max(0, Number(item.quantity) || 0);
                    var share = Math.max(0.08, qtyLabel / total);
                    seg.style.flex = '0.001';
                    var alpha = Math.max(0.35, 1 - index * 0.12);
                    seg.style.background = category.color || CATEGORY_COLORS[0];
                    seg.style.opacity = String(alpha);
                    var pct = Math.round((qtyLabel / total) * 100);
                    seg.title = item.name + ' · ' + pct + '%（' + qtyLabel + '回）';
                    var tip = document.createElement('span');
                    tip.className = 'pa-popularity-seg-label';
                    tip.textContent = index === 0 ? item.name : '';
                    seg.appendChild(tip);
                    track.appendChild(seg);
                    requestAnimationFrame(function () {
                        seg.style.flex = String(share);
                    });
                });
                row.appendChild(track);
                list.appendChild(row);
            });
            host.$paFp = fp;
        }

        function renderPopularMenus(host, snapshot) {
            if (!host) {
                return;
            }
            var menus = snapshot && Array.isArray(snapshot.popularMenus) ? snapshot.popularMenus : [];
            if (!menus.length) {
                renderEmpty(host, '人気商品データがありません');
                return;
            }
            var fp = chartFingerprint(menus.map(function (menu) {
                return {
                    name: menu.name,
                    quantity: menu.quantity,
                    revenueYen: menu.revenueYen,
                    avgServeLabel: menu.avgServeLabel || ''
                };
            }));
            if (host.$paFp === fp && host.querySelector('.pa-popular-menus-list') && !hostHasEmpty(host)) {
                return;
            }
            var maxQty = menus.reduce(function (max, row) {
                return Math.max(max, Number(row.quantity) || 0);
            }, 0) || 1;

            clearHost(host);
            var list = document.createElement('div');
            list.className = 'pa-popularity-list pa-popular-menus-list';
            menus.forEach(function (menu, index) {
                var row = document.createElement('div');
                row.className = 'pa-popularity-row pa-popular-menu-row';

                var rank = document.createElement('div');
                rank.className = 'pa-popular-menu-rank';
                rank.textContent = String(index + 1);
                row.appendChild(rank);

                var body = document.createElement('div');
                body.className = 'pa-popular-menu-body';

                var head = document.createElement('div');
                head.className = 'pa-popular-menu-head';
                var name = document.createElement('span');
                name.className = 'pa-popularity-label';
                name.textContent = menu.name || '商品';
                var meta = document.createElement('span');
                meta.className = 'pa-popular-menu-meta';
                var metaParts = [formatCount(menu.quantity, '個')];
                if (menu.revenueYen > 0) {
                    metaParts.push(formatYen(menu.revenueYen));
                }
                if (menu.avgServeLabel) {
                    metaParts.push(menu.avgServeLabel);
                }
                meta.textContent = metaParts.join(' · ');
                head.appendChild(name);
                head.appendChild(meta);
                body.appendChild(head);

                var track = document.createElement('div');
                track.className = 'pa-popularity-track';
                var bar = document.createElement('div');
                bar.className = 'pa-popularity-seg';
                bar.style.flex = '0.001';
                bar.style.background = menu.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length];
                track.appendChild(bar);
                var spacer = document.createElement('div');
                spacer.style.flex = '1';
                track.appendChild(spacer);
                body.appendChild(track);

                row.appendChild(body);
                list.appendChild(row);
                requestAnimationFrame(function () {
                    var share = Math.max(0.06, (Number(menu.quantity) || 0) / maxQty);
                    bar.style.flex = String(share);
                    spacer.style.flex = String(Math.max(0.001, 1 - share));
                });
            });
            host.appendChild(list);
            host.$paFp = fp;
        }

        function renderSelectionRate(host, snapshot) {
            if (!host) {
                return;
            }
            if (!Chart) {
                destroyChart(charts.selectionRate);
                charts.selectionRate = null;
                renderEmpty(host, 'Chart.js を読み込めませんでした');
                return;
            }
            var rows = snapshot && Array.isArray(snapshot.hourlySelectionRate)
                ? snapshot.hourlySelectionRate
                : [];
            if (!rows.length) {
                destroyChart(charts.selectionRate);
                charts.selectionRate = null;
                renderEmpty(host, 'データがありません');
                return;
            }
            var segmentKeys = [];
            var segmentMeta = {};
            rows.forEach(function (row) {
                (row.segments || []).forEach(function (seg) {
                    if (!segmentMeta[seg.key]) {
                        segmentMeta[seg.key] = seg;
                        segmentKeys.push(seg.key);
                    }
                });
            });
            if (!segmentKeys.length) {
                destroyChart(charts.selectionRate);
                charts.selectionRate = null;
                renderEmpty(host, 'データがありません');
                return;
            }
            var labels = rows.map(function (row) { return row.label; });
            var datasets = segmentKeys.map(function (key) {
                var meta = segmentMeta[key];
                return {
                    label: meta.label || key,
                    data: rows.map(function (row) {
                        var found = (row.segments || []).find(function (seg) { return seg.key === key; });
                        if (!found || !(row.segments || []).length) {
                            return null;
                        }
                        return Math.round(found.rate * 1000) / 10;
                    }),
                    backgroundColor: meta.color || THEME.accent,
                    stack: 'rate',
                    borderWidth: 0,
                    maxBarThickness: 28
                };
            });
            var fp = chartFingerprint({ labels: labels, datasets: datasets });
            if (shouldSkipRedraw(charts.selectionRate, fp)) {
                return;
            }
            if (softUpdateChart(charts.selectionRate, function (chart) {
                if (chart.data.datasets.length !== datasets.length) {
                    throw new Error('dataset-count-changed');
                }
                chart.data.labels = labels;
                datasets.forEach(function (ds, index) {
                    chart.data.datasets[index].label = ds.label;
                    chart.data.datasets[index].data = ds.data;
                    chart.data.datasets[index].backgroundColor = ds.backgroundColor;
                });
                chart.$paFp = fp;
            })) {
                return;
            }
            destroyChart(charts.selectionRate);
            charts.selectionRate = null;
            var canvas = ensureCanvas(host);
            charts.selectionRate = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    spanGaps: false,
                    animation: CHART_ANIMATION,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: THEME.text, boxWidth: 10, padding: 10 }
                        },
                        tooltip: Object.assign({}, tooltipDefaults(), {
                            callbacks: {
                                label: function (context) {
                                    if (context.parsed.y == null) {
                                        return null;
                                    }
                                    return ' ' + context.dataset.label + ': ' + context.parsed.y + '%';
                                }
                            }
                        })
                    },
                    scales: {
                        x: {
                            stacked: true,
                            ticks: { color: THEME.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                            grid: { display: false }
                        },
                        y: {
                            stacked: true,
                            min: 0,
                            max: 100,
                            ticks: {
                                color: THEME.text,
                                callback: function (value) { return value + '%'; }
                            },
                            grid: { color: THEME.grid, drawBorder: false }
                        }
                    }
                }
            });
            charts.selectionRate.$paFp = fp;
        }

        function renderVisitorSales(host, snapshot) {
            if (!host) {
                return;
            }
            if (!Chart) {
                destroyChart(charts.visitorSales);
                charts.visitorSales = null;
                renderEmpty(host, 'Chart.js を読み込めませんでした');
                return;
            }
            var points = snapshot && Array.isArray(snapshot.visitorSales) ? snapshot.visitorSales : [];
            if (!points.length) {
                destroyChart(charts.visitorSales);
                charts.visitorSales = null;
                var emptyLabel = snapshot && snapshot.periodMode === 'month'
                    ? '日別データがありません'
                    : '時間別データがありません';
                renderEmpty(host, emptyLabel);
                return;
            }
            var labels = points.map(function (point) { return point.label; });
            var guests = points.map(function (point) { return point.guests; });
            var sales = points.map(function (point) { return point.sales; });
            var fp = chartFingerprint({ labels: labels, guests: guests, sales: sales });
            host.classList.add('pa-chart-host--visitor');
            if (shouldSkipRedraw(charts.visitorSales, fp)) {
                return;
            }
            if (softUpdateChart(charts.visitorSales, function (chart) {
                chart.data.labels = labels;
                chart.data.datasets[0].data = guests;
                chart.data.datasets[1].data = sales;
                chart.$paFp = fp;
            })) {
                return;
            }
            destroyChart(charts.visitorSales);
            charts.visitorSales = null;
            var canvas = ensureCanvas(host);
            charts.visitorSales = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'bar',
                            label: '来店者数',
                            data: guests,
                            yAxisID: 'yGuests',
                            backgroundColor: 'rgba(62, 195, 255, 0.72)',
                            borderColor: THEME.accent,
                            borderWidth: 1,
                            borderRadius: 6,
                            maxBarThickness: 28,
                            pointStyle: 'rect',
                            order: 2
                        },
                        {
                            type: 'line',
                            label: '売上',
                            data: sales,
                            yAxisID: 'ySales',
                            borderColor: THEME.sales,
                            backgroundColor: 'rgba(40, 199, 111, 0.12)',
                            borderWidth: 2.5,
                            tension: 0.35,
                            pointRadius: 2,
                            pointHoverRadius: 5,
                            pointBackgroundColor: THEME.sales,
                            pointStyle: 'rect',
                            fill: false,
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: CHART_ANIMATION,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: THEME.text,
                                boxWidth: 12,
                                boxHeight: 12,
                                padding: 10,
                                usePointStyle: true,
                                pointStyle: 'rect'
                            }
                        },
                        tooltip: Object.assign({}, tooltipDefaults(), {
                            callbacks: {
                                label: function (context) {
                                    if (context.dataset.yAxisID === 'ySales') {
                                        return ' ' + context.dataset.label + ': ' + formatYen(context.parsed.y);
                                    }
                                    return ' ' + context.dataset.label + ': '
                                        + Number(context.parsed.y).toLocaleString('ja-JP') + '人';
                                }
                            }
                        })
                    },
                    scales: {
                        x: {
                            ticks: { color: THEME.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                            grid: { display: false }
                        },
                        yGuests: {
                            type: 'linear',
                            position: 'left',
                            beginAtZero: true,
                            ticks: { color: '#7fd4ff', precision: 0 },
                            grid: { color: THEME.grid, drawBorder: false }
                        },
                        ySales: {
                            type: 'linear',
                            position: 'right',
                            beginAtZero: true,
                            ticks: {
                                color: THEME.sales,
                                callback: function (value) {
                                    return formatYen(value);
                                }
                            },
                            grid: { drawOnChartArea: false, drawBorder: false }
                        }
                    }
                }
            });
            charts.visitorSales.$paFp = fp;
        }

        function syncToppingGroupSelect(selectEl, snapshot) {
            if (!selectEl) {
                return;
            }
            var categories = snapshot && Array.isArray(snapshot.popularity) ? snapshot.popularity : [];
            // 実データがあるカテゴリが1つ以上なら切替を出す（空カタログだけの偽カテゴリは除外済み）
            if (!categories.length || snapshot.bottomRightMode === 'visitorSales') {
                selectEl.hidden = true;
                selectEl.replaceChildren();
                var keepAll = document.createElement('option');
                keepAll.value = 'all';
                keepAll.textContent = '全て';
                selectEl.appendChild(keepAll);
                selectEl.value = 'all';
                return;
            }
            var previous = selectEl.value || 'all';
            selectEl.replaceChildren();
            var allOpt = document.createElement('option');
            allOpt.value = 'all';
            allOpt.textContent = '全て';
            selectEl.appendChild(allOpt);
            categories.forEach(function (cat) {
                var opt = document.createElement('option');
                opt.value = String(cat.categoryId != null ? cat.categoryId : cat.categoryName || '');
                opt.textContent = cat.categoryName || 'トッピング';
                selectEl.appendChild(opt);
            });
            var matched = previous === 'all' || previous === 'overall' || categories.some(function (cat) {
                return String(cat.categoryId != null ? cat.categoryId : cat.categoryName || '') === previous;
            });
            selectEl.value = matched ? (previous === 'overall' ? 'all' : previous) : 'all';
            // 1カテゴリだけでも明示できるよう表示（総合と単一カテゴリの見比べ用）
            selectEl.hidden = false;
        }

        function renderBottomLeft(host, snapshot, titleEl, hintEl) {
            var mode = snapshot && snapshot.bottomLeftMode === 'popularMenus'
                ? 'popularMenus'
                : 'popularity';
            if (titleEl) {
                titleEl.textContent = mode === 'popularMenus' ? '人気商品' : 'トッピングカテゴリ別人気';
            }
            if (hintEl) {
                if (mode === 'popularMenus') {
                    hintEl.textContent = '注文個数順';
                    hintEl.hidden = false;
                } else {
                    hintEl.textContent = '';
                    hintEl.hidden = true;
                }
            }
            if (mode === 'popularMenus') {
                renderPopularMenus(host, snapshot);
            } else {
                renderPopularity(host, snapshot);
            }
        }

        function renderBottomRight(host, snapshot, titleEl) {
            var mode = snapshot && snapshot.bottomRightMode === 'visitorSales'
                ? 'visitorSales'
                : 'selectionRate';
            if (titleEl) {
                if (mode === 'visitorSales') {
                    titleEl.textContent = snapshot && snapshot.periodMode === 'month'
                        ? '日別売上（来店者数 × 売上）'
                        : '時間別売上（来店者数 × 売上）';
                } else {
                    titleEl.textContent = '時間別のトッピング選択率';
                }
            }
            if (mode === 'visitorSales') {
                renderVisitorSales(host, snapshot);
            } else {
                renderSelectionRate(host, snapshot);
            }
        }

        function render(snapshot, hosts) {
            var h = hosts || {};
            renderKpi(h.kpiCard, snapshot);
            if (h.hourlyTitle) {
                var stayMode = snapshot && snapshot.scope === 'shop'
                    && Array.isArray(snapshot.hourlyStay)
                    && snapshot.hourlyStay.some(function (row) {
                        return Number(row.staySeconds) > 0;
                    });
                h.hourlyTitle.textContent = stayMode
                    ? '時間別平均滞在時間（開始時刻）'
                    : (snapshot && snapshot.scope === 'shop'
                        ? '時間別平均販売個数'
                        : '時間別販売個数');
            }
            renderHourlyQuantity(h.hourlyHost, snapshot);
            renderGender(h.genderHost, snapshot);
            renderBottomLeft(h.popularityHost, snapshot, h.bottomLeftTitle, h.bottomLeftHint);
            syncToppingGroupSelect(h.toppingGroupSelect, snapshot);
            renderBottomRight(h.selectionRateHost, snapshot, h.bottomRightTitle);

            if (h.badgeHost) {
                h.badgeHost.textContent = '';
                h.badgeHost.hidden = true;
            }
        }

        return {
            render: render,
            destroy: destroyAll,
            resizeAll: resizeAll,
            setGenderDisplayMode: applyGenderDisplayMode,
            getGenderDisplayMode: getGenderDisplayMode,
            formatYen: formatYen
        };
    }

    global.MasterOrderStaffProductAnalysisSdk = {
        version: SDK_VERSION,
        THEME: THEME,
        buildMenuOptions: buildMenuOptions,
        buildProductAnalysisSnapshot: buildProductAnalysisSnapshot,
        buildToppingAnalysisSnapshot: buildToppingAnalysisSnapshot,
        buildShopAnalysisSnapshot: buildShopAnalysisSnapshot,
        buildHourlySelectionRate: buildHourlySelectionRate,
        buildHourlySelectionRateFromApi: buildHourlySelectionRateFromApi,
        createProductAnalysisCharts: createProductAnalysisCharts,
        getGenderDisplayMode: getGenderDisplayMode,
        setGenderDisplayMode: setGenderDisplayMode,
        syncGenderModeButtons: syncGenderModeButtons,
        formatYen: formatYen,
        formatCount: formatCount,
        formatAvgServe: formatAvgServe,
        formatAvgServeClock: formatAvgServeClock,
        formatSignedPercent: formatSignedPercent
    };
})(typeof window !== 'undefined' ? window : globalThis);
