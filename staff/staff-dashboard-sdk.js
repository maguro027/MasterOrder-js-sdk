/**
 * MasterOrder Staff Dashboard SDK — ショップ情報ダッシュボード Chart.js 描画。
 *
 * 依存: Chart.js（遅延読込可 — getChartJsReady / window.__chartJsReady）
 * グローバル: MasterOrderStaffDashboardSdk
 *
 * renderMpBar 等 DOM 固有 UI は index.html 側に残す。
 */
(function (global) {
    'use strict';

    var SDK_VERSION = '1.10.0';

    var CATEGORY_PIE_MAX_SLICES = 10;
    var MENU_RANK_PREVIEW_LIMIT = 5;
    var POPULAR_RANK_V2_COMBO_LIMIT = 3;
    var POPULAR_RANK_V2_COMBO_GROUP_ID = -1;
    var CATEGORY_OTHER_COLOR = '#7a8490';

    var DASHBOARD_CHART_THEME = {
        grid: 'rgba(255, 255, 255, 0.1)',
        text: '#b4bdc4',
        tooltipBg: 'rgba(30, 36, 40, 0.95)',
        tooltipBorder: 'rgba(255, 255, 255, 0.12)',
        accent: '#3ec3ff',
        sales: '#28c76f'
    };

    var CATEGORY_PIE_COLORS = [
        '#3ec3ff', '#28c76f', '#ff9f43', '#ea5455', '#7367f0',
        '#00cfe8', '#ff6b9d', '#c9a227', '#8b9dc3', '#6fd89a'
    ];

    function buildIntegerAxisTicks(color) {
        return {
            color: color || DASHBOARD_CHART_THEME.text,
            stepSize: 1,
            precision: 0,
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            callback: function (value) {
                if (!Number.isFinite(value) || Math.floor(value) !== value) {
                    return '';
                }
                return Number(value).toLocaleString('ja-JP');
            }
        };
    }

    function truncateLegendName(text, maxLen) {
        var label = String(text || '-');
        var limit = maxLen || 10;
        if (label.length <= limit) {
            return label;
        }
        if (limit <= 3) {
            return label.slice(0, limit);
        }
        return label.slice(0, limit - 3) + '...';
    }

    function truncateChartLabel(text, maxLen) {
        var label = String(text || '-');
        var limit = maxLen || 14;
        if (label.length <= limit) {
            return label;
        }
        return label.slice(0, limit - 1) + '…';
    }

    function dedupeMenuRankItems(items) {
        var merged = {};
        (Array.isArray(items) ? items : []).forEach(function (row) {
            if (!row) {
                return;
            }
            var menuId = row.menuId != null ? Number(row.menuId) : null;
            var menuName = String(row.menuName || '-');
            var normalizedName = menuName.trim().toLowerCase();
            var key = normalizedName && normalizedName !== '-'
                ? 'n:' + normalizedName
                : (menuId != null && menuId > 0 ? 'i:' + menuId : 'n:');
            if (!merged[key]) {
                merged[key] = {
                    menuId: menuId,
                    menuName: menuName,
                    quantity: 0,
                    hasToppings: false
                };
            }
            merged[key].quantity += Math.max(0, Number(row.quantity) || 0);
            if (row.hasToppings === true) {
                merged[key].hasToppings = true;
            }
            if ((merged[key].menuId == null || merged[key].menuId <= 0) && menuId != null && menuId > 0) {
                merged[key].menuId = menuId;
            }
        });
        return Object.keys(merged).map(function (key) {
            return merged[key];
        });
    }

    function normalizeMenuRankName(menuName) {
        return String(menuName || '').trim().toLowerCase();
    }

    function findMenuCustomGroupInList(menuCustomSales, menuId, menuName) {
        var groups = Array.isArray(menuCustomSales) ? menuCustomSales : [];
        var normalizedName = normalizeMenuRankName(menuName);
        for (var i = 0; i < groups.length; i += 1) {
            var group = groups[i];
            if (!group) {
                continue;
            }
            if (menuId != null && group.menuId != null && Number(group.menuId) === Number(menuId)) {
                return group;
            }
        }
        for (var j = 0; j < groups.length; j += 1) {
            var byName = groups[j];
            if (!byName) {
                continue;
            }
            if (normalizeMenuRankName(byName.menuName) === normalizedName) {
                return byName;
            }
        }
        return null;
    }

    function menuCustomGroupIsDrillable(group) {
        if (!group) {
            return false;
        }
        if (group.hasToppings === true) {
            return Array.isArray(group.toppingGroups) && group.toppingGroups.length > 0;
        }
        if (Array.isArray(group.toppingGroups) && group.toppingGroups.length > 0) {
            return true;
        }
        return Array.isArray(group.customs) && group.customs.length > 0;
    }

    function enrichMenuRankRows(items, menuCustomSales) {
        return dedupeMenuRankItems(items).map(function (row) {
            if (!row || row.hasToppings === true) {
                return row;
            }
            var customGroup = findMenuCustomGroupInList(menuCustomSales, row.menuId, row.menuName);
            if (customGroup && menuCustomGroupIsDrillable(customGroup)) {
                row.hasToppings = true;
            }
            return row;
        });
    }

    function sortMenuRankDescending(items, menuCustomSales) {
        return enrichMenuRankRows(items, menuCustomSales).sort(function (left, right) {
            var lq = Math.max(0, Number(left && left.quantity) || 0);
            var rq = Math.max(0, Number(right && right.quantity) || 0);
            if (lq !== rq) {
                return rq - lq;
            }
            return String(left && left.menuName || '').localeCompare(
                String(right && right.menuName || ''),
                'ja'
            );
        });
    }

    /** @deprecated use sortMenuRankDescending — 上位＝売上個数多い */
    function sortMenuRankAscending(items, menuCustomSales) {
        return sortMenuRankDescending(items, menuCustomSales);
    }

    function formatDashboardYen(value) {
        var amount = Math.max(0, Number(value) || 0);
        if (amount >= 100000000) {
            var oku = amount / 100000000;
            return Number.isInteger(oku)
                ? oku.toLocaleString('ja-JP') + '億円'
                : oku.toFixed(2) + '億円';
        }
        if (amount >= 10000) {
            var man = Math.floor(amount / 10000);
            var rest = amount % 10000;
            if (man >= 1000) {
                return (amount / 10000).toFixed(1) + '万円';
            }
            return rest > 0
                ? man.toLocaleString('ja-JP') + '万' + rest.toLocaleString('ja-JP') + '円'
                : man.toLocaleString('ja-JP') + '万円';
        }
        return amount.toLocaleString('ja-JP') + '円';
    }

    function formatDashboardGuests(value) {
        var count = Math.max(0, Number(value) || 0);
        return count.toLocaleString('ja-JP') + '人';
    }

    function formatDashboardSessions(value) {
        var count = Math.max(0, Number(value) || 0);
        return count.toLocaleString('ja-JP') + 'セッション';
    }

    function formatChartDayLabel(isoDate) {
        if (!isoDate) {
            return '-';
        }
        var parts = String(isoDate).split('-');
        if (parts.length !== 3) {
            return isoDate;
        }
        return parts[1] + '/' + parts[2];
    }

    function formatChartAxisLabel(key, period) {
        if (period === 'day' || period === 'hours24') {
            var hour = parseInt(String(key), 10);
            return Number.isNaN(hour) ? String(key) : hour + '時';
        }
        return formatChartDayLabel(key);
    }

    function formatCompactYen(value) {
        var amount = Math.max(0, Number(value) || 0);
        if (amount >= 100000000) {
            var oku = amount / 100000000;
            return Number.isInteger(oku) ? oku + '億' : oku.toFixed(1) + '億';
        }
        if (amount >= 10000) {
            var man = amount / 10000;
            return Number.isInteger(man) ? man + '万' : man.toFixed(1) + '万';
        }
        if (amount >= 1000) {
            return String(Math.round(amount / 1000)) + '千';
        }
        return String(amount);
    }

    /**
     * @param {{ getChartJsReady?: function(): Promise|*, theme?: object }} options
     */
    function createStaffDashboardCharts(options) {
        var opts = options || {};
        var theme = opts.theme || DASHBOARD_CHART_THEME;
        var chartInstances = {
            menuRank: null,
            popularRankV2: null,
            category: null,
            combined: null
        };
        var categoryDrillState = {
            categoryId: null,
            categoryName: null
        };
        var menuDrillState = {
            menuId: null,
            menuName: null,
            toppingGroupId: null
        };
        var popularRankV2DrillState = {
            menuId: null,
            menuName: null
        };
        var menuCustomSalesCache = [];
        var categoryChartMode = 'revenue';
        var menuRankListExpanded = false;

        function resetMenuRankListExpanded() {
            menuRankListExpanded = false;
        }

        function setMenuRankListExpanded(expanded) {
            menuRankListExpanded = !!expanded;
        }

        function isMenuRankListExpanded() {
            return menuRankListExpanded;
        }

        function resolveMenuRankRowsForView(items, menuCustomSales) {
            var allRows = sortMenuRankAscending(items, menuCustomSales);
            if (menuRankListExpanded || allRows.length <= MENU_RANK_PREVIEW_LIMIT) {
                return {
                    allRows: allRows,
                    rows: allRows,
                    totalCount: allRows.length,
                    previewLimit: MENU_RANK_PREVIEW_LIMIT,
                    expanded: menuRankListExpanded,
                    showExpandButton: allRows.length > MENU_RANK_PREVIEW_LIMIT && !menuRankListExpanded,
                    showCollapseButton: menuRankListExpanded && allRows.length > MENU_RANK_PREVIEW_LIMIT
                };
            }
            return {
                allRows: allRows,
                rows: allRows.slice(0, MENU_RANK_PREVIEW_LIMIT),
                totalCount: allRows.length,
                previewLimit: MENU_RANK_PREVIEW_LIMIT,
                expanded: false,
                showExpandButton: true,
                showCollapseButton: false
            };
        }

        function applyMenuRankChartHostHeight(container, rowCount) {
            if (!container) {
                return;
            }
            var count = Math.max(0, Number(rowCount) || 0);
            if (menuRankListExpanded) {
                var contentHeight = Math.max(220, count * 36 + 48);
                var capped = Math.min(contentHeight, Math.round(window.innerHeight * 0.55));
                container.style.height = capped + 'px';
                container.style.minHeight = '220px';
                container.style.maxHeight = capped + 'px';
                container.style.overflowY = 'auto';
            } else {
                container.style.height = '220px';
                container.style.minHeight = '220px';
                container.style.maxHeight = '';
                container.style.overflowY = '';
            }
            container.classList.toggle('chart-canvas-host--menu-rank-expanded', menuRankListExpanded);
        }

        function notifyMenuRankListState(opts, state) {
            if (opts && typeof opts.onRankListState === 'function') {
                opts.onRankListState(state);
            }
        }

        function resetMenuDrill() {
            menuDrillState.menuId = null;
            menuDrillState.menuName = null;
            menuDrillState.toppingGroupId = null;
        }

        function menuHasToppingDrill(group, selected) {
            if (selected && selected.hasToppings === true) {
                return true;
            }
            if (!group) {
                return false;
            }
            if (group.hasToppings === true) {
                return Array.isArray(group.toppingGroups) && group.toppingGroups.length > 0;
            }
            if (Array.isArray(group.toppingGroups) && group.toppingGroups.length > 0) {
                return true;
            }
            return Array.isArray(group.customs) && group.customs.length > 0;
        }

        function resolveMenuToppingGroups(group) {
            if (!group) {
                return [];
            }
            if (Array.isArray(group.toppingGroups) && group.toppingGroups.length) {
                return group.toppingGroups;
            }
            if (Array.isArray(group.customs) && group.customs.length) {
                return [{
                    toppingGroupId: 0,
                    toppingGroupName: 'カスタム',
                    choices: group.customs
                }];
            }
            return [];
        }

        function resolveToppingGroupChoices(group, toppingGroupId) {
            var groups = resolveMenuToppingGroups(group);
            if (!groups.length) {
                return [];
            }
            if (toppingGroupId == null || toppingGroupId === '') {
                return Array.isArray(groups[0].choices) ? groups[0].choices : [];
            }
            var targetId = Number(toppingGroupId);
            for (var i = 0; i < groups.length; i += 1) {
                if (Number(groups[i].toppingGroupId) === targetId) {
                    return Array.isArray(groups[i].choices) ? groups[i].choices : [];
                }
            }
            return [];
        }

        function findMenuCustomGroup(menuCustomSales, menuId, menuName) {
            return findMenuCustomGroupInList(menuCustomSales, menuId, menuName);
        }

        function menuItemIsDrillable(selected) {
            if (!selected) {
                return false;
            }
            if (selected.hasToppings === true) {
                return true;
            }
            var customGroup = findMenuCustomGroup(menuCustomSalesCache, selected.menuId, selected.menuName);
            return menuHasToppingDrill(customGroup, selected);
        }

        function resolveMenuRankDrillGroup(selected) {
            var drillGroup = findMenuCustomGroup(
                menuCustomSalesCache,
                selected.menuId,
                selected.menuName
            );
            if (drillGroup) {
                return drillGroup;
            }
            if (!menuItemIsDrillable(selected)) {
                return null;
            }
            return {
                menuId: selected.menuId,
                menuName: selected.menuName,
                hasToppings: true,
                toppingGroups: [{
                    toppingGroupId: 0,
                    toppingGroupName: 'トッピング',
                    choices: []
                }]
            };
        }

        function updateMenuRankChartRows(chart, rows) {
            if (!chart) {
                return;
            }
            chart._menuRankRows = rows;
            if (chart.options && chart.options.plugins) {
                chart.options.plugins.menuRankDrillable = rows.map(function (row) {
                    return menuItemIsDrillable(row);
                });
            }
        }

        function getChartJsReadyPromise() {
            if (typeof opts.getChartJsReady === 'function') {
                return opts.getChartJsReady();
            }
            if (global.__chartJsReady) {
                return global.__chartJsReady;
            }
            return null;
        }

        function ensureChartJsLoaded() {
            if (typeof global.Chart !== 'undefined') {
                return Promise.resolve(true);
            }
            var readyPromise = getChartJsReadyPromise();
            if (!readyPromise) {
                return Promise.resolve(false);
            }
            return Promise.resolve(readyPromise).then(function () {
                return typeof global.Chart !== 'undefined';
            }).catch(function () {
                return false;
            });
        }

        function renderDashboardEmpty(container, message) {
            if (!container) {
                return;
            }
            container.replaceChildren();
            var empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = message || 'データがありません';
            container.appendChild(empty);
        }

        function chartCanvasInContainer(chart, container) {
            return Boolean(
                chart
                && chart.canvas
                && container
                && container.contains(chart.canvas)
            );
        }

        function destroyChart(key) {
            var chart = chartInstances[key];
            if (!chart) {
                return;
            }
            if (typeof chart.destroy === 'function') {
                chart.destroy();
            }
            chartInstances[key] = null;
        }

        function destroyCharts() {
            destroyChart('menuRank');
            destroyChart('popularRankV2');
            destroyChart('category');
            destroyChart('combined');
        }

        function resetCategoryDrill() {
            categoryDrillState.categoryId = null;
            categoryDrillState.categoryName = null;
        }

        function resetPopularRankV2Drill() {
            popularRankV2DrillState.menuId = null;
            popularRankV2DrillState.menuName = null;
        }

        function resetAllDrills() {
            resetCategoryDrill();
            resetMenuDrill();
            resetPopularRankV2Drill();
        }

        function renderUnavailable(containers, message) {
            destroyCharts();
            resetAllDrills();
            var msg = message || 'Chart.js を読み込めませんでした';
            var c = containers || {};
            renderDashboardEmpty(c.menuRank, msg);
            renderDashboardEmpty(c.popularRankV2, msg);
            renderDashboardEmpty(c.category, msg);
            renderDashboardEmpty(c.combined, msg);
        }

        function resolveCategoryMetric(row, mode) {
            if (mode === 'quantity') {
                return Math.max(0, Number(row && row.quantity) || 0);
            }
            return Math.max(0, Number(row && row.revenueYen) || 0);
        }

        function formatCategoryMetric(value, mode) {
            if (mode === 'quantity') {
                return ' 販売個数: ' + Number(value).toLocaleString('ja-JP') + '個';
            }
            return ' 売上: ' + formatDashboardYen(value);
        }

        function formatSharePercentNumber(value, total) {
            if (!total || total <= 0) {
                return '0.0';
            }
            var pct = (Math.max(0, Number(value) || 0) / total) * 100;
            return (Math.round(pct * 10) / 10).toFixed(1);
        }

        function formatSharePercent(value, total) {
            return formatSharePercentNumber(value, total) + '%';
        }

        function aggregateCategoryPieSlices(categorySales, mode) {
            var rows = (Array.isArray(categorySales) ? categorySales : []).map(function (row) {
                return {
                    categoryId: row.categoryId,
                    categoryName: row.categoryName,
                    colorHex: row.colorHex,
                    quantity: Math.max(0, Number(row && row.quantity) || 0),
                    revenueYen: Math.max(0, Number(row && row.revenueYen) || 0),
                    value: resolveCategoryMetric(row, mode)
                };
            });
            rows.sort(function (a, b) {
                if (b.value !== a.value) {
                    return b.value - a.value;
                }
                return String(a.categoryName || '').localeCompare(String(b.categoryName || ''), 'ja');
            });
            var sliceRows = rows;
            if (rows.length > CATEGORY_PIE_MAX_SLICES) {
                var top = rows.slice(0, CATEGORY_PIE_MAX_SLICES - 1);
                var rest = rows.slice(CATEGORY_PIE_MAX_SLICES - 1);
                var otherValue = rest.reduce(function (sum, row) {
                    return sum + row.value;
                }, 0);
                var otherQuantity = rest.reduce(function (sum, row) {
                    return sum + (Number(row.quantity) || 0);
                }, 0);
                var otherRevenueYen = rest.reduce(function (sum, row) {
                    return sum + (Number(row.revenueYen) || 0);
                }, 0);
                sliceRows = top.concat([{
                    categoryId: null,
                    categoryName: 'その他',
                    quantity: otherQuantity,
                    revenueYen: otherRevenueYen,
                    value: otherValue,
                    isOther: true
                }]);
            }
            return sliceRows.map(function (row, index) {
                var customColor = row.colorHex && /^#[0-9a-fA-F]{6}$/.test(String(row.colorHex))
                    ? String(row.colorHex)
                    : null;
                return {
                    categoryId: row.categoryId,
                    categoryName: row.categoryName,
                    quantity: Math.max(0, Number(row.quantity) || 0),
                    revenueYen: Math.max(0, Number(row.revenueYen) || 0),
                    value: row.value,
                    isOther: !!row.isOther,
                    color: row.isOther
                        ? CATEGORY_OTHER_COLOR
                        : (customColor || CATEGORY_PIE_COLORS[index % CATEGORY_PIE_COLORS.length])
                };
            });
        }

        function ensureCategoryPieLayout(container) {
            var layout = container.querySelector('.category-pie-layout');
            if (layout) {
                return layout;
            }
            container.replaceChildren();
            layout = document.createElement('div');
            layout.className = 'category-pie-layout';
            var chartArea = document.createElement('div');
            chartArea.className = 'category-pie-chart-area';
            var legendEl = document.createElement('div');
            legendEl.className = 'category-pie-legend';
            legendEl.setAttribute('role', 'list');
            layout.appendChild(chartArea);
            layout.appendChild(legendEl);
            container.appendChild(layout);
            return layout;
        }

        function resolveCategoryLegendMode(mode) {
            if (mode === 'quantity' || mode === 'revenue') {
                return mode;
            }
            return categoryChartMode === 'quantity' ? 'quantity' : 'revenue';
        }

        function resolveCategoryLegendAmount(slice, mode) {
            var chartMode = resolveCategoryLegendMode(mode);
            if (chartMode === 'quantity') {
                if (slice && slice.quantity != null) {
                    return Math.max(0, Number(slice.quantity) || 0);
                }
                return Math.max(0, Number(slice && slice.value) || 0);
            }
            if (slice && slice.revenueYen != null) {
                return Math.max(0, Number(slice.revenueYen) || 0);
            }
            return Math.max(0, Number(slice && slice.value) || 0);
        }

        function formatCategoryLegendCount(slice, mode) {
            var chartMode = resolveCategoryLegendMode(mode);
            var amount = resolveCategoryLegendAmount(slice, chartMode);
            if (chartMode === 'quantity') {
                return Math.round(amount).toLocaleString('ja-JP') + '件';
            }
            if (amount >= 10000) {
                return formatCompactYen(amount) + '円';
            }
            return amount.toLocaleString('ja-JP') + '円';
        }

        function renderCategoryPieHtmlLegend(legendEl, slices, mode) {
            if (!legendEl) {
                return;
            }
            legendEl.replaceChildren();
            var rows = Array.isArray(slices) ? slices : [];
            if (!rows.length) {
                return;
            }
            var total = rows.reduce(function (sum, row) {
                return sum + (Number(row.value) || 0);
            }, 0);
            rows.forEach(function (slice) {
                var fullName = String(slice.categoryName || '-');
                var row = document.createElement('div');
                row.className = 'category-pie-legend-row';
                row.setAttribute('role', 'listitem');

                var swatch = document.createElement('span');
                swatch.className = 'category-pie-legend-swatch';
                swatch.style.backgroundColor = slice.color;
                swatch.setAttribute('aria-hidden', 'true');

                var pct = document.createElement('span');
                pct.className = 'category-pie-legend-pct';
                pct.textContent = formatSharePercent(slice.value, total);

                var name = document.createElement('span');
                name.className = 'category-pie-legend-name';
                name.textContent = fullName;
                if (fullName.length > 16) {
                    name.title = fullName;
                }

                var count = document.createElement('span');
                count.className = 'category-pie-legend-count';
                count.textContent = formatCategoryLegendCount(slice, mode);

                row.appendChild(swatch);
                row.appendChild(pct);
                row.appendChild(name);
                row.appendChild(count);
                legendEl.appendChild(row);
            });
        }

        function appendCategoryPieChartCanvas(chartArea) {
            chartArea.replaceChildren();
            var wrap = document.createElement('div');
            wrap.className = 'chart-canvas-wrap category-pie-canvas-wrap';
            var canvas = document.createElement('canvas');
            wrap.appendChild(canvas);
            chartArea.appendChild(wrap);
            return canvas;
        }

        function buildCategoryPieLabels(categories, mode, maxLen) {
            var rows = Array.isArray(categories) ? categories : [];
            return rows.map(function (row) {
                return truncateChartLabel(row.categoryName, maxLen || 12);
            });
        }

        function animateChartUpdate(chart) {
            if (!chart) {
                return;
            }
            chart.update('none');
        }

        function buildMenuRankDataFingerprint(rows, extras) {
            var payload = {
                rows: (Array.isArray(rows) ? rows : []).map(function (row) {
                    return [
                        row && row.menuId != null ? row.menuId : '',
                        row && row.menuName != null ? String(row.menuName) : '',
                        Math.max(0, Number(row && row.quantity) || 0)
                    ];
                }),
                extras: extras || null
            };
            return JSON.stringify(payload);
        }

        function shouldSkipChartRedraw(chart, container, fingerprint, drillFlag) {
            return Boolean(
                chart
                && chartCanvasInContainer(chart, container)
                && chart._menuRankFp === fingerprint
                && !!chart._menuDrillChart === !!drillFlag
            );
        }

        function buildDashboardTooltipOptions() {
            return {
                enabled: true,
                backgroundColor: theme.tooltipBg,
                titleColor: '#f0f3f5',
                bodyColor: theme.text,
                borderColor: theme.tooltipBorder,
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8
            };
        }

        function buildDashboardXScale(period) {
            return {
                ticks: {
                    color: theme.text,
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: period === 'day' || period === 'hours24' ? 12 : (period === 'month' ? 10 : 7)
                },
                grid: {
                    color: theme.grid,
                    drawBorder: false
                }
            };
        }

        function appendDashboardChartCanvas(container) {
            var wrap = document.createElement('div');
            wrap.className = 'chart-canvas-wrap';
            var canvas = document.createElement('canvas');
            wrap.appendChild(canvas);
            container.appendChild(wrap);
            return canvas;
        }

        function buildMenuRankBarColors(rows, drillPalette) {
            var drill = drillPalette === true;
            return (Array.isArray(rows) ? rows : []).map(function (row) {
                if (!menuItemIsDrillable(row)) {
                    return drill ? 'rgba(255, 159, 67, 0.55)' : 'rgba(62, 195, 255, 0.55)';
                }
                return drill ? 'rgba(255, 159, 67, 0.88)' : 'rgba(62, 195, 255, 0.88)';
            });
        }

        function buildMenuRankChartOptions(rows, container, opts, palette) {
            var isDrill = palette === 'drill';
            return {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { left: 0, right: 8 }
                },
                interaction: { mode: 'nearest', intersect: false, axis: 'y' },
                onClick: function (event, elements) {
                    if (isDrill) {
                        return;
                    }
                    var hits = elements && elements.length
                        ? elements
                        : this.getElementsAtEventForMode(event, 'nearest', { intersect: false, axis: 'y' });
                    if (!hits || !hits.length) {
                        return;
                    }
                    var chartRows = this._menuRankRows || rows;
                    var index = hits[0].index;
                    var selected = chartRows[index];
                    if (!selected) {
                        return;
                    }
                    enterMenuRankDrill(container, selected, opts);
                },
                onHover: function (_event, elements) {
                    if (!this.canvas) {
                        return;
                    }
                    if (isDrill) {
                        this.canvas.style.cursor = 'default';
                        return;
                    }
                    var chartRows = this._menuRankRows || rows;
                    var index = elements && elements.length ? elements[0].index : -1;
                    this.canvas.style.cursor = (index >= 0 && menuItemIsDrillable(chartRows[index]))
                        ? 'pointer'
                        : 'default';
                },
                plugins: {
                    legend: { display: false },
                    tooltip: Object.assign({}, buildDashboardTooltipOptions(), {
                        callbacks: {
                            title: function (items) {
                                var index = items && items[0] ? items[0].dataIndex : -1;
                                var chart = items && items[0] && items[0].chart ? items[0].chart : null;
                                var chartRows = (chart && chart._menuRankRows) || rows;
                                if (index < 0 || !chartRows[index]) {
                                    return '';
                                }
                                return chartRows[index].menuName || '-';
                            },
                            label: function (context) {
                                var value = context.parsed.x;
                                var index = context.dataIndex;
                                var chartRows = (context.chart && context.chart._menuRankRows) || rows;
                                var hint = !isDrill && menuItemIsDrillable(chartRows[index])
                                    ? '（棒をタップでトッピング内訳）'
                                    : '';
                                return ' 販売総数: ' + Number(value).toLocaleString('ja-JP') + '個' + hint;
                            }
                        }
                    })
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: Object.assign({}, buildIntegerAxisTicks(isDrill ? theme.text : '#f0f3f5'), {
                            maxRotation: 0,
                            minRotation: 0
                        }),
                        grid: {
                            color: theme.grid,
                            drawBorder: false
                        }
                    },
                    y: {
                        position: 'left',
                        afterFit: function (scale) {
                            scale.width = Math.min(Math.max(scale.width, 96), 148);
                        },
                        ticks: {
                            color: theme.text,
                            autoSkip: false,
                            font: { size: 11 },
                            crossAlign: 'far',
                            align: 'start',
                            padding: 2
                        },
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        border: { display: false }
                    }
                }
            };
        }

        function renderMenuCustomDrillChart(container, group, toppingGroupId, options) {
            var chartKey = 'menuRank';
            var opts = options || {};
            var choices = resolveToppingGroupChoices(group, toppingGroupId);
            var customs = choices.slice().sort(function (left, right) {
                var lq = Math.max(0, Number(left && left.quantity) || 0);
                var rq = Math.max(0, Number(right && right.quantity) || 0);
                if (lq !== rq) {
                    return lq - rq;
                }
                return String(left && (left.customName || left.customKey) || '').localeCompare(
                    String(right && (right.customName || right.customKey) || ''),
                    'ja'
                );
            }).map(function (row) {
                return {
                    menuId: null,
                    menuName: row.customName || row.customKey || '-',
                    quantity: Math.max(0, Number(row.quantity) || 0)
                };
            });

            var resolvedGroupId = toppingGroupId != null && toppingGroupId !== ''
                ? Number(toppingGroupId)
                : (group && group.toppingGroups && group.toppingGroups[0]
                    ? Number(group.toppingGroups[0].toppingGroupId)
                    : 0);
            if (!Number.isFinite(resolvedGroupId)) {
                resolvedGroupId = 0;
            }
            menuDrillState.toppingGroupId = resolvedGroupId;

            var fingerprint = buildMenuRankDataFingerprint(customs, {
                drill: true,
                menuId: menuDrillState.menuId,
                menuName: menuDrillState.menuName,
                toppingGroupId: resolvedGroupId
            });
            var existing = chartInstances[chartKey];
            if (shouldSkipChartRedraw(existing, container, fingerprint, true)) {
                if (typeof opts.onDrillChange === 'function') {
                    opts.onDrillChange(
                        menuDrillState.menuId,
                        menuDrillState.menuName,
                        resolveMenuToppingGroups(group),
                        resolvedGroupId
                    );
                }
                return;
            }

            applyMenuRankChartHostHeight(container, customs.length);

            if (!customs.length) {
                destroyChart(chartKey);
                container.replaceChildren();
                renderDashboardEmpty(container, 'この商品のトッピングデータがありません');
                if (typeof opts.onDrillChange === 'function') {
                    opts.onDrillChange(
                        menuDrillState.menuId,
                        menuDrillState.menuName,
                        resolveMenuToppingGroups(group),
                        resolvedGroupId
                    );
                }
                return;
            }

            if (typeof global.Chart === 'undefined') {
                destroyChart(chartKey);
                container.replaceChildren();
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var labels = customs.map(function (row) {
                return truncateChartLabel(row.menuName, 16);
            });
            var data = customs.map(function (row) {
                return row.quantity;
            });

            // トッピンググループ切替時は categorical scale の差分更新が効かないことがあるため作り直す
            var groupChanged = !existing
                || !existing._menuDrillChart
                || String(existing._menuDrillToppingGroupId) !== String(resolvedGroupId);

            if (!groupChanged
                && chartCanvasInContainer(existing, container)
                && existing.config
                && existing.config.type === 'bar'
                && existing._menuDrillChart) {
                existing.data.labels = labels.slice();
                existing.data.datasets[0].data = data.slice();
                existing.data.datasets[0].backgroundColor = buildMenuRankBarColors(customs, true);
                existing.data.datasets[0].borderColor = '#ff9f43';
                updateMenuRankChartRows(existing, customs);
                existing._menuRankFp = fingerprint;
                existing._menuDrillToppingGroupId = resolvedGroupId;
                applyMenuRankChartHostHeight(container, customs.length);
                existing.update();
                if (typeof opts.onDrillChange === 'function') {
                    opts.onDrillChange(
                        menuDrillState.menuId,
                        menuDrillState.menuName,
                        resolveMenuToppingGroups(group),
                        resolvedGroupId
                    );
                }
                return;
            }

            destroyChart(chartKey);
            container.replaceChildren();
            var canvas = appendDashboardChartCanvas(container);

            chartInstances[chartKey] = new global.Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '販売個数',
                        data: data,
                        backgroundColor: buildMenuRankBarColors(customs, true),
                        borderColor: '#ff9f43',
                        borderWidth: 1,
                        borderRadius: 6,
                        maxBarThickness: 20
                    }]
                },
                options: buildMenuRankChartOptions(customs, container, opts, 'drill')
            });
            chartInstances[chartKey]._menuDrillChart = true;
            chartInstances[chartKey]._menuRankFp = fingerprint;
            chartInstances[chartKey]._menuDrillToppingGroupId = resolvedGroupId;
            updateMenuRankChartRows(chartInstances[chartKey], customs);

            if (typeof opts.onDrillChange === 'function') {
                opts.onDrillChange(
                    menuDrillState.menuId,
                    menuDrillState.menuName,
                    resolveMenuToppingGroups(group),
                    resolvedGroupId
                );
            }
        }

        function enterMenuRankDrill(container, selected, opts) {
            if (!menuItemIsDrillable(selected)) {
                return;
            }
            var drillGroup = resolveMenuRankDrillGroup(selected);
            if (!drillGroup) {
                return;
            }
            var toppingGroups = resolveMenuToppingGroups(drillGroup);
            var toppingGroupId = toppingGroups.length ? toppingGroups[0].toppingGroupId : 0;
            menuDrillState.menuId = selected.menuId;
            menuDrillState.menuName = selected.menuName;
            menuDrillState.toppingGroupId = toppingGroupId;
            renderMenuCustomDrillChart(container, drillGroup, toppingGroupId, opts);
        }

        function renderMenuRankHorizontalChart(container, items, options) {
            var chartKey = 'menuRank';
            var opts = options || {};
            menuCustomSalesCache = Array.isArray(opts.menuCustomSales) ? opts.menuCustomSales : menuCustomSalesCache;

            if (menuDrillState.menuId != null || menuDrillState.menuName) {
                var drillGroup = resolveMenuRankDrillGroup({
                    menuId: menuDrillState.menuId,
                    menuName: menuDrillState.menuName,
                    hasToppings: true
                });
                if (drillGroup && menuHasToppingDrill(drillGroup, {
                    menuId: menuDrillState.menuId,
                    menuName: menuDrillState.menuName,
                    hasToppings: true
                })) {
                    renderMenuCustomDrillChart(
                        container,
                        drillGroup,
                        menuDrillState.toppingGroupId,
                        opts
                    );
                    return;
                }
                resetMenuDrill();
            }

            var rankView = resolveMenuRankRowsForView(items, menuCustomSalesCache);
            var rows = rankView.rows;
            notifyMenuRankListState(opts, rankView);
            applyMenuRankChartHostHeight(container, rows.length);

            if (!rows.length) {
                destroyChart(chartKey);
                renderDashboardEmpty(container);
                return;
            }

            if (typeof global.Chart === 'undefined') {
                destroyChart(chartKey);
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var labels = rows.map(function (row) {
                return truncateChartLabel(row.menuName, 16);
            });
            var data = rows.map(function (row) {
                return Math.max(0, Number(row.quantity) || 0);
            });
            var fingerprint = buildMenuRankDataFingerprint(rows, {
                drill: false,
                expanded: menuRankListExpanded
            });
            var existing = chartInstances[chartKey];

            if (shouldSkipChartRedraw(existing, container, fingerprint, false)) {
                notifyMenuRankListState(opts, rankView);
                return;
            }

            if (chartCanvasInContainer(existing, container)
                && existing.config
                && existing.config.type === 'bar'
                && !existing._menuDrillChart) {
                existing.data.labels = labels;
                existing.data.datasets[0].data = data;
                existing.data.datasets[0].backgroundColor = buildMenuRankBarColors(rows, false);
                existing.data.datasets[0].borderColor = theme.accent;
                updateMenuRankChartRows(existing, rows);
                existing._menuRankFp = fingerprint;
                applyMenuRankChartHostHeight(container, rows.length);
                notifyMenuRankListState(opts, rankView);
                animateChartUpdate(existing);
                return;
            }

            destroyChart(chartKey);
            container.replaceChildren();
            var canvas = appendDashboardChartCanvas(container);
            canvas.classList.add('chart-canvas--menu-rank');

            chartInstances[chartKey] = new global.Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '販売個数',
                        data: data,
                        backgroundColor: buildMenuRankBarColors(rows, false),
                        borderColor: theme.accent,
                        borderWidth: 1,
                        borderRadius: 6,
                        maxBarThickness: 28
                    }]
                },
                options: buildMenuRankChartOptions(rows, container, opts, 'rank')
            });
            chartInstances[chartKey]._menuDrillChart = false;
            chartInstances[chartKey]._menuRankFp = fingerprint;
            updateMenuRankChartRows(chartInstances[chartKey], rows);
        }

        function findCategoryMenuGroup(categoryMenuSales, categoryId) {
            var groups = Array.isArray(categoryMenuSales) ? categoryMenuSales : [];
            for (var i = 0; i < groups.length; i += 1) {
                if (Number(groups[i].categoryId) === Number(categoryId)) {
                    return groups[i];
                }
            }
            return null;
        }

        function renderCategoryDrillChart(container, group, categorySales, categoryMenuSales, onDrillChange) {
            var chartKey = 'category';
            var rows = sortMenuRankAscending(group && group.menus);

            destroyChart(chartKey);
            container.replaceChildren();

            if (!rows.length) {
                renderDashboardEmpty(container, 'このカテゴリの販売データがありません');
                return;
            }

            if (typeof global.Chart === 'undefined') {
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var canvas = appendDashboardChartCanvas(container);
            var labels = rows.map(function (row) {
                return truncateChartLabel(row.menuName, 16);
            });
            var data = rows.map(function (row) {
                return Math.max(0, Number(row.quantity) || 0);
            });

            chartInstances[chartKey] = new global.Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '販売個数',
                        data: data,
                        backgroundColor: 'rgba(40, 199, 111, 0.78)',
                        borderColor: theme.sales,
                        borderWidth: 1,
                        borderRadius: 6,
                        maxBarThickness: 20
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: Object.assign({}, buildDashboardTooltipOptions(), {
                            callbacks: {
                                title: function (items) {
                                    var index = items && items[0] ? items[0].dataIndex : -1;
                                    if (index < 0 || !rows[index]) {
                                        return '';
                                    }
                                    return rows[index].menuName || '-';
                                },
                                label: function (context) {
                                    return ' 販売総数: ' + Number(context.parsed.x).toLocaleString('ja-JP') + '個';
                                }
                            }
                        })
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: buildIntegerAxisTicks(theme.text),
                            grid: { color: theme.grid, drawBorder: false }
                        },
                        y: {
                            ticks: { color: theme.text, autoSkip: false, font: { size: 11 } },
                            grid: { display: false }
                        }
                    }
                }
            });
        }

        function renderCategorySalesChart(container, categorySales, categoryMenuSales, options) {
            var chartKey = 'category';
            var opts = options || {};
            var mode = opts.mode === 'quantity' ? 'quantity' : 'revenue';
            categoryChartMode = mode;
            var categories = Array.isArray(categorySales) ? categorySales : [];
            var drillId = categoryDrillState.categoryId;

            if (drillId != null) {
                var drillGroup = findCategoryMenuGroup(categoryMenuSales, drillId);
                if (drillGroup) {
                    renderCategoryDrillChart(container, drillGroup, categories, categoryMenuSales, opts.onDrillChange);
                    return;
                }
                categoryDrillState.categoryId = null;
                categoryDrillState.categoryName = null;
            }

            if (!categories.length) {
                destroyChart(chartKey);
                renderDashboardEmpty(container);
                return;
            }

            if (typeof global.Chart === 'undefined') {
                destroyChart(chartKey);
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var slices = aggregateCategoryPieSlices(categories, mode);
            var labels = slices.map(function (slice) {
                return truncateChartLabel(slice.categoryName, 12);
            });
            var data = slices.map(function (slice) {
                return slice.value;
            });
            var colors = slices.map(function (slice) {
                return slice.color;
            });
            var layout = ensureCategoryPieLayout(container);
            var chartArea = layout.querySelector('.category-pie-chart-area');
            var legendEl = layout.querySelector('.category-pie-legend');
            renderCategoryPieHtmlLegend(legendEl, slices, mode);
            var existing = chartInstances[chartKey];

            if (existing && existing._categoryChartMode !== mode) {
                destroyChart(chartKey);
                existing = null;
            }

            if (chartCanvasInContainer(existing, chartArea)
                && existing.config.type === 'pie') {
                existing.data.labels = labels;
                existing.data.datasets[0].data = data;
                existing.data.datasets[0].backgroundColor = colors;
                existing._pieSlices = slices;
                existing._categoryChartMode = mode;
                animateChartUpdate(existing);
                return;
            }

            destroyChart(chartKey);
            var canvas = appendCategoryPieChartCanvas(chartArea);

            chartInstances[chartKey] = new global.Chart(canvas, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderColor: '#111518',
                        borderWidth: 1,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: { left: 8, right: 4, top: 4, bottom: 4 }
                    },
                    onClick: function (_event, elements) {
                        if (!elements || !elements.length) {
                            return;
                        }
                        var index = elements[0].index;
                        var selected = slices[index];
                        if (!selected || selected.isOther) {
                            return;
                        }
                        categoryDrillState.categoryId = selected.categoryId;
                        categoryDrillState.categoryName = selected.categoryName;
                        if (typeof opts.onDrillChange === 'function') {
                            opts.onDrillChange(selected.categoryId, selected.categoryName);
                        }
                        renderCategoryDrillChart(
                            container,
                            findCategoryMenuGroup(categoryMenuSales, selected.categoryId),
                            categories,
                            categoryMenuSales,
                            opts.onDrillChange
                        );
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: Object.assign({}, buildDashboardTooltipOptions(), {
                            callbacks: {
                                title: function (items) {
                                    var index = items && items[0] ? items[0].dataIndex : -1;
                                    if (index < 0 || !slices[index]) {
                                        return '';
                                    }
                                    return slices[index].categoryName || '-';
                                },
                                label: function (context) {
                                    var base = formatCategoryMetric(context.parsed, mode);
                                    var total = context.dataset.data.reduce(function (sum, v) {
                                        return sum + v;
                                    }, 0);
                                    return base + ' (' + formatSharePercent(context.parsed, total) + ')';
                                }
                            }
                        })
                    }
                }
            });
            chartInstances[chartKey]._pieSlices = slices;
            chartInstances[chartKey]._categoryChartMode = mode;
        }

        function renderCombinedChart(container, visitorSeries, salesSeries, period) {
            var visitors = Array.isArray(visitorSeries) ? visitorSeries : [];
            var sales = Array.isArray(salesSeries) ? salesSeries : [];
            var points = visitors.map(function (row, index) {
                return {
                    label: row.date,
                    guests: Math.max(0, Number(row.value) || 0),
                    sales: Math.max(0, Number((sales[index] && sales[index].value) || 0))
                };
            });

            if (!points.length) {
                destroyChart('combined');
                renderDashboardEmpty(container);
                return;
            }

            if (typeof global.Chart === 'undefined') {
                destroyChart('combined');
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var labels = points.map(function (point) {
                return formatChartAxisLabel(point.label, period);
            });
            var guestData = points.map(function (point) { return point.guests; });
            var salesData = points.map(function (point) { return point.sales; });
            var existing = chartInstances.combined;

            if (chartCanvasInContainer(existing, container)) {
                existing.data.labels = labels;
                existing.data.datasets[0].data = guestData;
                existing.data.datasets[1].data = salesData;
                animateChartUpdate(existing);
                return;
            }

            destroyChart('combined');
            container.replaceChildren();

            var canvas = appendDashboardChartCanvas(container);

            chartInstances.combined = new global.Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'bar',
                            label: '来店者数',
                            data: guestData,
                            yAxisID: 'yGuests',
                            backgroundColor: 'rgba(62, 195, 255, 0.72)',
                            borderColor: theme.accent,
                            borderWidth: 1,
                            borderRadius: 6,
                            maxBarThickness: 32,
                            order: 2
                        },
                        {
                            type: 'line',
                            label: '売上',
                            data: salesData,
                            yAxisID: 'ySales',
                            borderColor: theme.sales,
                            backgroundColor: 'rgba(40, 199, 111, 0.12)',
                            borderWidth: 2.5,
                            tension: 0.4,
                            pointRadius: 2,
                            pointHoverRadius: 6,
                            pointBackgroundColor: theme.sales,
                            pointBorderColor: '#111518',
                            pointBorderWidth: 1.5,
                            pointHitRadius: 12,
                            fill: false,
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            labels: {
                                color: theme.text,
                                usePointStyle: true,
                                pointStyle: 'rect',
                                boxWidth: 12,
                                boxHeight: 12,
                                padding: 16
                            }
                        },
                        tooltip: Object.assign({}, buildDashboardTooltipOptions(), {
                            callbacks: {
                                label: function (context) {
                                    var value = context.parsed.y;
                                    if (context.dataset.yAxisID === 'ySales') {
                                        return ' ' + context.dataset.label + ': ' + formatDashboardYen(value);
                                    }
                                    return ' ' + context.dataset.label + ': ' + value.toLocaleString('ja-JP') + '人';
                                }
                            }
                        })
                    },
                    scales: {
                        x: buildDashboardXScale(period),
                        yGuests: {
                            type: 'linear',
                            position: 'left',
                            beginAtZero: true,
                            ticks: Object.assign({}, buildIntegerAxisTicks('#7fd4ff')),
                            grid: {
                                color: theme.grid,
                                drawBorder: false
                            }
                        },
                        ySales: {
                            type: 'linear',
                            position: 'right',
                            beginAtZero: true,
                            ticks: {
                                color: '#6fd89a',
                                callback: function (value) {
                                    return formatCompactYen(value) + '円';
                                }
                            },
                            grid: {
                                drawOnChartArea: false
                            }
                        }
                    }
                }
            });
        }

        function isPopularComboGroup(group) {
            if (!group) {
                return false;
            }
            if (Number(group.toppingGroupId) === POPULAR_RANK_V2_COMBO_GROUP_ID) {
                return true;
            }
            return String(group.toppingGroupName || '') === '人気の組み合わせ';
        }

        function sortCustomChoicesDesc(choices) {
            return (Array.isArray(choices) ? choices : []).slice().sort(function (left, right) {
                var lq = Math.max(0, Number(left && left.quantity) || 0);
                var rq = Math.max(0, Number(right && right.quantity) || 0);
                if (lq !== rq) {
                    return rq - lq;
                }
                return String(left && (left.customName || left.customKey) || '').localeCompare(
                    String(right && (right.customName || right.customKey) || ''),
                    'ja'
                );
            });
        }

        function resolvePopularRankV2DrillRows(drillGroup) {
            var toppingGroups = resolveMenuToppingGroups(drillGroup);
            var comboGroup = null;
            for (var i = 0; i < toppingGroups.length; i += 1) {
                if (isPopularComboGroup(toppingGroups[i])) {
                    comboGroup = toppingGroups[i];
                    break;
                }
            }
            if (comboGroup) {
                var comboRows = sortCustomChoicesDesc(comboGroup.choices)
                    .filter(function (row) {
                        var key = String(row && row.customKey || '');
                        return key !== 'none' && key !== '__none__';
                    })
                    .slice(0, POPULAR_RANK_V2_COMBO_LIMIT)
                    .map(function (row, index) {
                        return {
                            menuId: null,
                            menuName: (index + 1) + '. ' + (row.customName || row.customKey || '-'),
                            quantity: Math.max(0, Number(row.quantity) || 0)
                        };
                    });
                if (comboRows.length) {
                    return {
                        mode: 'combo',
                        caption: '人気コンボ TOP' + POPULAR_RANK_V2_COMBO_LIMIT,
                        rows: comboRows
                    };
                }
            }

            var flat = [];
            toppingGroups.forEach(function (group) {
                if (isPopularComboGroup(group)) {
                    return;
                }
                (Array.isArray(group.choices) ? group.choices : []).forEach(function (choice) {
                    var key = String(choice && choice.customKey || '');
                    if (key === 'none' || key === '__none__') {
                        return;
                    }
                    flat.push(choice);
                });
            });
            var toppingRows = sortCustomChoicesDesc(flat)
                .slice(0, POPULAR_RANK_V2_COMBO_LIMIT)
                .map(function (row, index) {
                    return {
                        menuId: null,
                        menuName: (index + 1) + '. ' + (row.customName || row.customKey || '-'),
                        quantity: Math.max(0, Number(row.quantity) || 0)
                    };
                });
            return {
                mode: 'topping',
                caption: '人気トッピング TOP' + POPULAR_RANK_V2_COMBO_LIMIT,
                rows: toppingRows
            };
        }

        function applyPopularRankV2HostHeight(container, rowCount) {
            if (!container) {
                return;
            }
            var count = Math.max(1, Number(rowCount) || 1);
            var height = Math.max(220, Math.min(320, count * 48 + 56));
            container.style.height = height + 'px';
            container.style.minHeight = '220px';
            container.style.maxHeight = '';
            container.style.overflowY = '';
        }

        function renderPopularRankV2BarChart(container, rows, options) {
            var chartKey = 'popularRankV2';
            var opts = options || {};
            var isDrill = opts.mode === 'combo' || opts.mode === 'topping';
            var fingerprint = buildMenuRankDataFingerprint(rows, {
                popularV2: true,
                mode: opts.mode || 'rank',
                menuId: popularRankV2DrillState.menuId,
                menuName: popularRankV2DrillState.menuName
            });
            var existing = chartInstances[chartKey];

            applyPopularRankV2HostHeight(container, rows.length);

            if (!rows.length) {
                destroyChart(chartKey);
                renderDashboardEmpty(container, opts.emptyMessage || 'データがありません');
                return;
            }

            if (typeof global.Chart === 'undefined') {
                destroyChart(chartKey);
                renderDashboardEmpty(container, 'Chart.js を読み込めませんでした');
                return;
            }

            var labels = rows.map(function (row) {
                return truncateChartLabel(row.menuName, isDrill ? 22 : 16);
            });
            var data = rows.map(function (row) {
                return Math.max(0, Number(row.quantity) || 0);
            });

            if (shouldSkipChartRedraw(existing, container, fingerprint, isDrill)) {
                return;
            }

            var modeChanged = !existing
                || !!existing._popularRankV2Drill !== isDrill
                || String(existing._popularRankV2MenuId) !== String(popularRankV2DrillState.menuId || '');

            if (!modeChanged
                && chartCanvasInContainer(existing, container)
                && existing.config
                && existing.config.type === 'bar') {
                existing.data.labels = labels.slice();
                existing.data.datasets[0].data = data.slice();
                existing.data.datasets[0].backgroundColor = isDrill
                    ? 'rgba(255, 159, 67, 0.88)'
                    : 'rgba(255, 159, 67, 0.72)';
                existing._menuRankRows = rows;
                existing._menuRankFp = fingerprint;
                existing._popularRankV2Drill = isDrill;
                existing._popularRankV2MenuId = popularRankV2DrillState.menuId;
                existing.update();
                return;
            }

            destroyChart(chartKey);
            container.replaceChildren();
            var canvas = appendDashboardChartCanvas(container);

            chartInstances[chartKey] = new global.Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: isDrill ? '注文回数' : '販売個数',
                        data: data,
                        backgroundColor: isDrill
                            ? 'rgba(255, 159, 67, 0.88)'
                            : 'rgba(255, 159, 67, 0.72)',
                        borderColor: '#ff9f43',
                        borderWidth: 1,
                        borderRadius: 6,
                        maxBarThickness: isDrill ? 28 : 26
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { left: 0, right: 8 } },
                    interaction: { mode: 'nearest', intersect: false, axis: 'y' },
                    onClick: function (event, elements) {
                        if (isDrill) {
                            return;
                        }
                        var hits = elements && elements.length
                            ? elements
                            : this.getElementsAtEventForMode(event, 'nearest', { intersect: false, axis: 'y' });
                        if (!hits || !hits.length) {
                            return;
                        }
                        var chartRows = this._menuRankRows || rows;
                        var selected = chartRows[hits[0].index];
                        if (!selected || !menuItemIsDrillable(selected)) {
                            return;
                        }
                        popularRankV2DrillState.menuId = selected.menuId;
                        popularRankV2DrillState.menuName = selected.menuName;
                        renderPopularRankV2Chart(container, opts.sourceItems, {
                            menuCustomSales: menuCustomSalesCache,
                            onDrillChange: opts.onDrillChange
                        });
                    },
                    onHover: function (_event, elements) {
                        if (!this.canvas) {
                            return;
                        }
                        if (isDrill) {
                            this.canvas.style.cursor = 'default';
                            return;
                        }
                        var chartRows = this._menuRankRows || rows;
                        var index = elements && elements.length ? elements[0].index : -1;
                        this.canvas.style.cursor = (index >= 0 && menuItemIsDrillable(chartRows[index]))
                            ? 'pointer'
                            : 'default';
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: Object.assign({}, buildDashboardTooltipOptions(), {
                            callbacks: {
                                title: function (items) {
                                    var index = items && items[0] ? items[0].dataIndex : -1;
                                    var chart = items && items[0] && items[0].chart ? items[0].chart : null;
                                    var chartRows = (chart && chart._menuRankRows) || rows;
                                    if (index < 0 || !chartRows[index]) {
                                        return '';
                                    }
                                    return chartRows[index].menuName || '-';
                                },
                                label: function (context) {
                                    return ' 販売総数: ' + Number(context.parsed.x).toLocaleString('ja-JP') + '個';
                                }
                            }
                        })
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: Object.assign({}, buildIntegerAxisTicks(theme.text), {
                                maxRotation: 0,
                                minRotation: 0
                            }),
                            grid: { color: theme.grid, drawBorder: false }
                        },
                        y: {
                            position: 'left',
                            afterFit: function (scale) {
                                scale.width = Math.min(Math.max(scale.width, isDrill ? 120 : 96), isDrill ? 180 : 148);
                            },
                            ticks: {
                                color: theme.text,
                                autoSkip: false,
                                font: { size: isDrill ? 11 : 11 },
                                crossAlign: 'far',
                                align: 'start',
                                padding: 2
                            },
                            grid: { display: false, drawBorder: false },
                            border: { display: false }
                        }
                    }
                }
            });
            chartInstances[chartKey]._menuDrillChart = isDrill;
            chartInstances[chartKey]._menuRankRows = rows;
            chartInstances[chartKey]._menuRankFp = fingerprint;
            chartInstances[chartKey]._popularRankV2Drill = isDrill;
            chartInstances[chartKey]._popularRankV2MenuId = popularRankV2DrillState.menuId;
        }

        function renderPopularRankV2Chart(container, items, options) {
            var opts = options || {};
            menuCustomSalesCache = Array.isArray(opts.menuCustomSales) ? opts.menuCustomSales : menuCustomSalesCache;
            opts.sourceItems = items;

            if (popularRankV2DrillState.menuId != null || popularRankV2DrillState.menuName) {
                var drillGroup = resolveMenuRankDrillGroup({
                    menuId: popularRankV2DrillState.menuId,
                    menuName: popularRankV2DrillState.menuName,
                    hasToppings: true
                });
                if (drillGroup && menuHasToppingDrill(drillGroup, {
                    menuId: popularRankV2DrillState.menuId,
                    menuName: popularRankV2DrillState.menuName,
                    hasToppings: true
                })) {
                    var drillView = resolvePopularRankV2DrillRows(drillGroup);
                    if (typeof opts.onDrillChange === 'function') {
                        opts.onDrillChange(
                            popularRankV2DrillState.menuId,
                            popularRankV2DrillState.menuName,
                            drillView
                        );
                    }
                    renderPopularRankV2BarChart(container, drillView.rows, {
                        mode: drillView.mode,
                        emptyMessage: drillView.mode === 'combo'
                            ? 'この商品の人気コンボがまだありません'
                            : 'この商品のトッピングデータがありません',
                        menuCustomSales: menuCustomSalesCache,
                        onDrillChange: opts.onDrillChange,
                        sourceItems: items
                    });
                    return;
                }
                resetPopularRankV2Drill();
            }

            var rows = sortMenuRankAscending(items, menuCustomSalesCache).slice(0, MENU_RANK_PREVIEW_LIMIT);
            if (typeof opts.onDrillChange === 'function') {
                opts.onDrillChange(null, null, null);
            }
            renderPopularRankV2BarChart(container, rows, {
                mode: 'rank',
                emptyMessage: '注文データがありません',
                menuCustomSales: menuCustomSalesCache,
                onDrillChange: opts.onDrillChange,
                sourceItems: items
            });
        }

        return {
            ensureChartJsLoaded: ensureChartJsLoaded,
            destroyCharts: destroyCharts,
            destroyChart: destroyChart,
            resetCategoryDrill: resetCategoryDrill,
            resetMenuDrill: resetMenuDrill,
            resetPopularRankV2Drill: resetPopularRankV2Drill,
            resetMenuRankListExpanded: resetMenuRankListExpanded,
            setMenuRankListExpanded: setMenuRankListExpanded,
            isMenuRankListExpanded: isMenuRankListExpanded,
            getMenuRankPreviewLimit: function () {
                return MENU_RANK_PREVIEW_LIMIT;
            },
            resetAllDrills: resetAllDrills,
            setMenuRankToppingGroup: function (toppingGroupId) {
                var parsed = toppingGroupId == null || toppingGroupId === ''
                    ? null
                    : Number(toppingGroupId);
                menuDrillState.toppingGroupId = Number.isFinite(parsed) ? parsed : toppingGroupId;
            },
            isMenuDrillActive: function () {
                return menuDrillState.menuId != null || !!menuDrillState.menuName;
            },
            getMenuDrillState: function () {
                return {
                    menuId: menuDrillState.menuId,
                    menuName: menuDrillState.menuName,
                    toppingGroupId: menuDrillState.toppingGroupId
                };
            },
            renderMenuRankHorizontalChart: renderMenuRankHorizontalChart,
            renderPopularRankV2Chart: renderPopularRankV2Chart,
            renderCategorySalesChart: renderCategorySalesChart,
            renderCombinedChart: renderCombinedChart,
            renderUnavailable: renderUnavailable,
            renderEmpty: renderDashboardEmpty,
            formatDashboardYen: formatDashboardYen,
            formatDashboardGuests: formatDashboardGuests,
            formatDashboardSessions: formatDashboardSessions,
            formatChartAxisLabel: formatChartAxisLabel,
            getChartInstances: function () {
                return chartInstances;
            }
        };
    }

    global.MasterOrderStaffDashboardSdk = {
        version: SDK_VERSION,
        createStaffDashboardCharts: createStaffDashboardCharts,
        formatDashboardYen: formatDashboardYen,
        formatDashboardGuests: formatDashboardGuests,
        formatDashboardSessions: formatDashboardSessions,
        formatChartAxisLabel: formatChartAxisLabel,
        CHART_THEME: DASHBOARD_CHART_THEME
    };
})(typeof window !== 'undefined' ? window : globalThis);
