/**
 * AmazonPage Module
 * Handles all Amazon purchases page functionality including order display, matching, and charts
 */

import { formatCurrency, formatDate, escapeHtml, showLoading, hideLoading, createCategoryDropdown, populateCategoryDropdown } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { debounce } from '../utils/helpers.js';
import { progressNotification } from '../services/progressNotification.js';

// Module state
let amazonOrders = [];
let amazonStats = {};
let amazonMonthlyChart = null;
let amazonYearlyChart = null;
let amazonCurrentTimeRange = 'all';
let newlyMatchedAmazonOrderIds = new Set();

// Dependencies (injected)
let fetchAPI = null;
let navigateTo = null;

export function initializeAmazonPage(deps) {
    fetchAPI = deps.fetchAPI;
    navigateTo = deps.navigateTo;

    // Create debounced search for better performance
    const debouncedSearch = debounce(searchAmazonOrders, 300);

    // Expose functions globally for onclick handlers
    window.handleAmazonFileUpload = handleAmazonFileUpload;
    window.verifyAmazonMatch = verifyAmazonMatch;
    window.unverifyAmazonMatch = unverifyAmazonMatch;
    window.unmatchAmazonOrder = unmatchAmazonOrder;
    window.runAmazonAutoMatch = runAmazonAutoMatch;
    window.searchAmazonOrders = debouncedSearch; // Use debounced version
    window.applyAmazonFilters = applyAmazonFilters;
    window.clearAmazonFilters = clearAmazonFilters;
    window.selectTimeRange = selectTimeRange;
    window.deleteAllAmazonData = deleteAllAmazonData;

    // Item categorization functions
    window.categorizeItem = categorizeItem;
    window.updateItemCategory = updateItemCategory;
    window.verifyItemCategory = verifyItemCategory;
    window.unverifyItemCategory = unverifyItemCategory;
    window.categorizeAllAmazonItems = categorizeAllAmazonItems;
    window.categorizeFirst20Items = categorizeFirst20Items;
}

export async function loadAmazonPage() {
    showLoading();
    try {
        await Promise.all([
            loadAmazonStats(),
            loadAmazonOrders(),
            loadCategories()
        ]);
    } catch (error) {
        console.error('Error loading Amazon page:', error);
        showToast('Failed to load Amazon data', 'error');
    } finally {
        hideLoading();
    }
}

async function loadAmazonStats() {
    try {
        const accountFilter = document.getElementById('amazonFilterAccount');
        const accountName = accountFilter && accountFilter.value ? accountFilter.value : null;

        const url = accountName
            ? `/api/amazon/stats?accountName=${encodeURIComponent(accountName)}`
            : '/api/amazon/stats';
        const stats = await fetchAPI(url);
        amazonStats = stats;

        document.getElementById('amazonTotalOrders').textContent = stats.total_orders || 0;
        document.getElementById('amazonMatchedOrders').textContent = stats.matched_orders || 0;
        document.getElementById('amazonTotalSpent').textContent = formatCurrency(stats.total_spent || 0);

        const matchRate = stats.total_orders > 0
            ? Math.round((stats.matched_orders / stats.total_orders) * 100)
            : 0;
        document.getElementById('amazonMatchRate').textContent = `${matchRate}%`;
    } catch (error) {
        console.error('Error loading Amazon stats:', error);
    }
}

async function loadAmazonOrders(filters = {}) {
    try {
        const queryParams = new URLSearchParams();

        if (filters.startDate) queryParams.append('startDate', filters.startDate);
        if (filters.endDate) queryParams.append('endDate', filters.endDate);
        if (filters.matched !== undefined) queryParams.append('matched', filters.matched);

        const queryString = queryParams.toString();
        const url = `/api/amazon/orders${queryString ? '?' + queryString : ''}`;
        amazonOrders = await fetchAPI(url);

        // Log item categorization data for debugging
        const totalItems = amazonOrders.reduce((sum, order) => sum + (order.items?.length || 0), 0);
        const categorizedItems = amazonOrders.reduce((sum, order) =>
            sum + (order.items?.filter(item => item.user_category)?.length || 0), 0);
        console.log(`[Amazon Orders] Loaded ${amazonOrders.length} orders with ${totalItems} items (${categorizedItems} categorized)`);

        // Populate account filter dropdown with unique account names
        populateAccountFilter();

        // Apply search/confidence filters if they exist
        const searchInput = document.getElementById('amazonSearchInput');
        const confidenceFilter = document.getElementById('amazonFilterConfidence');
        if ((searchInput && searchInput.value) || (confidenceFilter && confidenceFilter.value)) {
            searchAmazonOrders();
        } else {
            displayAmazonOrders(amazonOrders);
        }
    } catch (error) {
        console.error('Error loading Amazon orders:', error);
        showToast('Failed to load orders', 'error');
    }
}

function populateAccountFilter() {
    const accountFilter = document.getElementById('amazonFilterAccount');
    if (!accountFilter) return;

    // Get unique account names from orders
    const accountNames = [...new Set(amazonOrders.map(order => order.account_name || 'Primary'))];
    accountNames.sort();

    // Store current selection
    const currentSelection = accountFilter.value;

    // Clear and repopulate
    accountFilter.innerHTML = '<option value="">All Accounts</option>';
    accountNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        accountFilter.appendChild(option);
    });

    // Restore selection if it still exists
    if (currentSelection && accountNames.includes(currentSelection)) {
        accountFilter.value = currentSelection;
    }
}

function selectTimeRange(range) {
    amazonCurrentTimeRange = range;

    // Update button states
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.range === range) {
            btn.classList.add('active');
        }
    });

    // Redraw monthly chart with new range
    displayAmazonSpendingByTime(amazonOrders);
}

function displayAmazonSpendingByTime(orders) {
    if (!orders || orders.length === 0) {
        // Clear charts if no data
        if (amazonMonthlyChart) {
            amazonMonthlyChart.destroy();
            amazonMonthlyChart = null;
        }
        if (amazonYearlyChart) {
            amazonYearlyChart.destroy();
            amazonYearlyChart = null;
        }
        return;
    }

    // Filter orders by time range for monthly chart
    const now = new Date();
    const filteredOrders = orders.filter(order => {
        const orderDate = new Date(order.order_date);

        switch (amazonCurrentTimeRange) {
            case '1m':
                const oneMonthAgo = new Date(now);
                oneMonthAgo.setMonth(now.getMonth() - 1);
                return orderDate >= oneMonthAgo;
            case '3m':
                const threeMonthsAgo = new Date(now);
                threeMonthsAgo.setMonth(now.getMonth() - 3);
                return orderDate >= threeMonthsAgo;
            case 'ytd':
                const yearStart = new Date(now.getFullYear(), 0, 1);
                return orderDate >= yearStart;
            case '1y':
                const oneYearAgo = new Date(now);
                oneYearAgo.setFullYear(now.getFullYear() - 1);
                return orderDate >= oneYearAgo;
            case 'all':
            default:
                return true;
        }
    });

    // Group by month for monthly chart
    const spendingByMonth = {};
    filteredOrders.forEach(order => {
        const date = new Date(order.order_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const amount = parseFloat(order.total_amount) || 0;
        spendingByMonth[monthKey] = (spendingByMonth[monthKey] || 0) + amount;
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(spendingByMonth).sort();
    const monthLabels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        const date = new Date(year, month - 1);
        return date.toLocaleDateString('default', { month: 'short', year: 'numeric' });
    });
    const monthValues = sortedMonths.map(m => spendingByMonth[m]);

    // Create/update monthly chart
    const monthlyCtx = document.getElementById('amazonMonthlyChart');
    if (monthlyCtx) {
        if (amazonMonthlyChart) {
            amazonMonthlyChart.destroy();
        }

        amazonMonthlyChart = new Chart(monthlyCtx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [{
                    label: 'Spending',
                    data: monthValues,
                    backgroundColor: 'rgba(76, 175, 80, 0.6)',
                    borderColor: 'rgba(76, 175, 80, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Total: ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    // Group by year for yearly chart (use all orders, not filtered)
    const spendingByYear = {};
    orders.forEach(order => {
        const date = new Date(order.order_date);
        const year = date.getFullYear();
        const amount = parseFloat(order.total_amount) || 0;
        spendingByYear[year] = (spendingByYear[year] || 0) + amount;
    });

    // Sort years chronologically
    const sortedYears = Object.keys(spendingByYear).sort();
    const yearLabels = sortedYears.map(y => y.toString());
    const yearValues = sortedYears.map(y => spendingByYear[y]);

    // Create/update yearly chart
    const yearlyCtx = document.getElementById('amazonYearlyChart');
    if (yearlyCtx) {
        if (amazonYearlyChart) {
            amazonYearlyChart.destroy();
        }

        amazonYearlyChart = new Chart(yearlyCtx, {
            type: 'bar',
            data: {
                labels: yearLabels,
                datasets: [{
                    label: 'Spending',
                    data: yearValues,
                    backgroundColor: 'rgba(33, 150, 243, 0.6)',
                    borderColor: 'rgba(33, 150, 243, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Total: ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
}

function displayAmazonOrders(orders) {
    const container = document.getElementById('amazonOrdersList');

    if (!orders || orders.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">No Amazon orders found. Upload your order history to get started!</p>';
        displayAmazonSpendingByTime([]);
        return;
    }

    // Filter out $0 orders (cancelled/refunded items)
    const validOrders = orders.filter(order => {
        const amount = Math.abs(parseFloat(order.total_amount) || 0);
        return amount > 0;
    });

    // Also display spending by time
    displayAmazonSpendingByTime(validOrders);

    if (validOrders.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">No valid Amazon orders found (all orders are $0).</p>';
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';

    validOrders.forEach(order => {
        const isMatched = order.matched_transaction_id !== null;
        const isNewlyMatched = newlyMatchedAmazonOrderIds.has(order.order_id);
        const matchBadge = isMatched
            ? `<span style="background: #10b981; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">✓ Matched (${order.match_confidence}%)</span>${isNewlyMatched ? ` <span style="background: #3b82f6; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">🆕 NEW</span>` : ''}`
            : `<span style="background: #f59e0b; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">⚠ Unmatched</span>`;

        // Add highlight border for newly matched orders
        const cardStyle = isNewlyMatched ? 'border: 3px solid #3b82f6; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);' : '';

        // Build items list HTML
        let itemsHtml = '';
        if (order.items && order.items.length > 0) {
            itemsHtml = `
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; font-size: 0.9rem;">Items (${order.items.length}):</div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            `;

            order.items.forEach(item => {
                const itemUrl = item.asin ? `https://www.amazon.com/dp/${item.asin}` : null;
                const titleHtml = itemUrl
                    ? `<a href="${itemUrl}" target="_blank" style="color: var(--primary); text-decoration: none; hover:text-decoration: underline;">${escapeHtml(item.title)}</a>`
                    : escapeHtml(item.title);

                // Create image HTML with proper fallback cascade
                let imageHtml = '';
                if (item.asin) {
                    const uniqueId = `img-${item.id}-${Math.random().toString(36).substr(2, 9)}`;

                    // Build fallback URL list (will try each in sequence if previous fails)
                    // If we have a cached image_url from database, use it first
                    const fallbackUrls = [];

                    if (item.image_url) {
                        // Use cached image URL as first choice
                        fallbackUrls.push(item.image_url);
                    }

                    // Add standard CDN URL guesses as additional fallbacks
                    fallbackUrls.push(
                        // Modern CDN with .01 suffix (most common)
                        `https://m.media-amazon.com/images/P/${item.asin}.01._SCLZZZZZZZ_SX500_.jpg`,
                        // Without .01 suffix (some products don't use it)
                        `https://m.media-amazon.com/images/P/${item.asin}._SCLZZZZZZZ_SX500_.jpg`,
                        // Legacy CDN with .01
                        `https://images-na.ssl-images-amazon.com/images/P/${item.asin}.01.LZZZZZZZ.jpg`,
                        // Legacy CDN without .01
                        `https://images-na.ssl-images-amazon.com/images/P/${item.asin}.LZZZZZZZ.jpg`,
                        // Modern CDN smaller size with .01
                        `https://m.media-amazon.com/images/P/${item.asin}.01._SCLZZZZZZZ_SX300_.jpg`,
                        // Modern CDN smaller size without .01
                        `https://m.media-amazon.com/images/P/${item.asin}._SCLZZZZZZZ_SX300_.jpg`,
                        // Basic format with .01
                        `https://images-na.ssl-images-amazon.com/images/P/${item.asin}.01.jpg`,
                        // Basic format without .01 (simplest format, last resort)
                        `https://images-na.ssl-images-amazon.com/images/P/${item.asin}.jpg`
                    );

                    imageHtml = `
                        <div id="container-${uniqueId}" style="flex-shrink: 0; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; background: white; border-radius: 4px; overflow: hidden;">
                            <img id="${uniqueId}"
                                 src="${fallbackUrls[0]}"
                                 data-fallback-urls='${JSON.stringify(fallbackUrls)}'
                                 data-fallback-index="0"
                                 alt="${escapeHtml(item.title)}"
                                 style="width: 100%; height: 100%; object-fit: contain; padding: 2px;"
                                 onerror="handleImageError('${uniqueId}')"
                                 onload="handleImageLoad('${uniqueId}')">
                        </div>
                    `;
                }

                // Build category badge with confidence color coding
                const confidence = item.confidence || 0;
                const isVerified = item.verified === 'Yes';
                let categoryBadge = '';
                let categoryColor = '#6B7280'; // gray for uncategorized

                if (item.user_category) {
                    if (isVerified || confidence === 100) {
                        categoryColor = '#3B82F6'; // blue for verified
                    } else if (confidence >= 85) {
                        categoryColor = '#10B981'; // green for high confidence
                    } else if (confidence >= 70) {
                        categoryColor = '#F59E0B'; // amber for medium confidence
                    } else if (confidence >= 50) {
                        categoryColor = '#F97316'; // orange for low confidence
                    } else {
                        categoryColor = '#EF4444'; // red for very low confidence
                    }

                    categoryBadge = `
                        <span style="background: ${categoryColor}; color: white; padding: 0.2rem 0.5rem; border-radius: 8px; font-size: 0.75rem; font-weight: 600; white-space: nowrap;">
                            ${escapeHtml(item.user_category)} ${isVerified ? '✓' : ''} ${confidence}%
                        </span>
                    `;
                } else {
                    categoryBadge = `
                        <span style="background: #6B7280; color: white; padding: 0.2rem 0.5rem; border-radius: 8px; font-size: 0.75rem; white-space: nowrap;">
                            Uncategorized
                        </span>
                    `;
                }

                itemsHtml += `
                    <div id="item-${item.id}" style="display: flex; gap: 1rem; padding: 0.5rem; background: var(--bg-secondary); border-radius: 6px;">
                        ${imageHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 0.9rem; margin-bottom: 0.25rem;">
                                ${titleHtml}
                                ${itemUrl ? ' <span style="font-size: 0.75rem;">🔗</span>' : ''}
                            </div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                                ${item.quantity > 1 ? `Qty: ${item.quantity} × ` : ''}${formatCurrency(item.price)}${item.quantity > 1 ? ` = ${formatCurrency(item.price * item.quantity)}` : ''}
                                ${item.category ? ` • Amazon: ${escapeHtml(item.category)}` : ''}
                                ${item.seller ? ` • Sold by: ${escapeHtml(item.seller)}` : ''}
                            </div>
                            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                                ${categoryBadge}
                                ${createCategoryDropdown({
                                    id: `item-category-${item.id}`,
                                    categories: userCategories || [],
                                    placeholder: 'Change category...',
                                    onchange: `updateItemCategory(${item.id}, this.value)`,
                                    size: 'small'
                                })}
                                ${item.user_category ? `
                                    ${isVerified ?
                                        `<button onclick="unverifyItemCategory(${item.id}, ${confidence})" style="padding: 0.2rem 0.5rem; background: #F59E0B; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Unverify</button>` :
                                        `<button onclick="verifyItemCategory(${item.id})" style="padding: 0.2rem 0.5rem; background: #10B981; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Verify</button>`
                                    }
                                ` : `
                                    <button onclick="categorizeItem(${item.id})" style="padding: 0.2rem 0.5rem; background: #3B82F6; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Categorize</button>
                                `}
                            </div>
                            ${item.categorization_reasoning ? `
                                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; font-style: italic;">
                                    ${escapeHtml(item.categorization_reasoning)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });

            itemsHtml += `
                    </div>
                </div>
            `;
        }

        // Build matched transaction info
        let matchedTransactionHtml = '';
        if (isMatched && order.matched_transaction) {
            const tx = order.matched_transaction;
            const isVerified = order.match_verified === 'Yes';
            matchedTransactionHtml = `
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <div style="font-weight: 600; font-size: 0.9rem; color: var(--success);">✓ Matched Transaction ${isVerified ? '(Verified)' : ''}</div>
                        <div style="display: flex; gap: 0.5rem;">
                            ${isVerified ?
                                `<button onclick="unverifyAmazonMatch('${escapeHtml(order.order_id)}')" class="btn-small" style="background: #f59e0b; color: white; padding: 0.25rem 0.75rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Unverify</button>` :
                                `<button onclick="verifyAmazonMatch('${escapeHtml(order.order_id)}')" class="btn-small" style="background: #10b981; color: white; padding: 0.25rem 0.75rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Approve</button>`
                            }
                            <button onclick="unmatchAmazonOrder('${escapeHtml(order.order_id)}')" class="btn-small" style="background: #dc2626; color: white; padding: 0.25rem 0.75rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Unmatch</button>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem; background: rgba(16, 185, 129, 0.05); border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <div style="flex: 1;">
                            <div style="font-size: 0.9rem; margin-bottom: 0.25rem; font-weight: 500;">${escapeHtml(tx.description || tx.name)}</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary);">
                                📅 ${formatDate(tx.date)}
                                ${tx.account_name ? ` • 🏦 ${escapeHtml(tx.account_name)}` : ''}
                                ${tx.category ? ` • 🏷️ ${escapeHtml(tx.category)}` : ''}
                            </div>
                        </div>
                        <div style="font-size: 1rem; font-weight: 600; color: var(--success); white-space: nowrap; margin-left: 1rem;">
                            ${formatCurrency(tx.amount)}
                        </div>
                    </div>
                </div>
            `;
        }

        html += `
            <div class="card" style="${cardStyle}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                            <h4 style="margin: 0; font-size: 1rem;">Order #${escapeHtml(order.order_id)}</h4>
                            ${matchBadge}
                            ${order.account_name ? `<span style="background: var(--bg-primary); padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">👤 ${escapeHtml(order.account_name)}</span>` : ''}
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.9rem;">
                            <div style="margin-bottom: 0.25rem;">📅 ${formatDate(order.order_date)}</div>
                            ${order.payment_method ? `<div style="margin-bottom: 0.25rem;">💳 ${escapeHtml(order.payment_method)}</div>` : ''}
                            ${order.order_status ? `<div>📦 ${escapeHtml(order.order_status)}</div>` : ''}
                        </div>
                        ${itemsHtml}
                        ${matchedTransactionHtml}
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.5rem; font-weight: 600; color: var(--primary);">${formatCurrency(order.total_amount)}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
                            ${order.subtotal ? `Subtotal: ${formatCurrency(order.subtotal)}<br>` : ''}
                            ${order.tax ? `Tax: ${formatCurrency(order.tax)}<br>` : ''}
                            ${order.shipping ? `Shipping: ${formatCurrency(order.shipping)}` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Populate category dropdowns for all items
    populateItemCategoryDropdowns();
}

export async function handleAmazonFileUpload(event) {
    const file = event.target.files[0];

    if (!file) {
        return;
    }

    if (!file.name.endsWith('.csv')) {
        showToast('Please upload a CSV file', 'error');
        return;
    }

    // Get account name from input
    const accountName = document.getElementById('amazonAccountName').value.trim() || 'Primary';

    showLoading();
    showToast('Uploading and processing Amazon orders...', 'info');

    try {
        const csvContent = await file.text();

        // Add account name as query parameter
        const result = await fetchAPI(`/api/amazon/upload?accountName=${encodeURIComponent(accountName)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: csvContent
        });

        if (result.success) {
            showToast(
                `✓ Successfully imported ${result.imported} orders for "${accountName}"!\n` +
                `• Matched: ${result.matched} orders\n` +
                `• Unmatched: ${result.unmatched} orders`,
                'success'
            );

            // Reload Amazon page
            await loadAmazonPage();
        } else {
            showToast(`Upload failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error uploading Amazon file:', error);
        showToast(`Upload error: ${error.message}`, 'error');
    } finally {
        hideLoading();
        event.target.value = '';
    }
}

async function runAmazonAutoMatch() {
    showLoading();
    showToast('Running auto-match algorithm...', 'info');

    try {
        const result = await fetchAPI('/api/amazon/auto-match', {
            method: 'POST'
        });

        showToast(
            `✓ Auto-match complete!\n` +
            `• Matched: ${result.matched} orders\n` +
            `• Still unmatched: ${result.unmatched} orders`,
            'success'
        );

        // Store newly matched order IDs for highlighting
        newlyMatchedAmazonOrderIds.clear();
        if (result.matchedOrderIds && result.matchedOrderIds.length > 0) {
            result.matchedOrderIds.forEach(orderId => {
                newlyMatchedAmazonOrderIds.add(orderId);
            });
        }

        await loadAmazonPage();
    } catch (error) {
        console.error('Error running auto-match:', error);
        showToast(`Auto-match error: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function verifyAmazonMatch(orderId) {
    try {
        const result = await fetchAPI(`/api/amazon/orders/${orderId}/verify`, {
            method: 'POST'
        });

        if (result.success) {
            showToast('Match verified', 'success');
            await loadAmazonPage();
        }
    } catch (error) {
        console.error('Error verifying match:', error);
        showToast(`Failed to verify: ${error.message}`, 'error');
    }
}

async function unverifyAmazonMatch(orderId) {
    try {
        const result = await fetchAPI(`/api/amazon/orders/${orderId}/unverify`, {
            method: 'POST'
        });

        if (result.success) {
            showToast('Match unverified', 'success');
            await loadAmazonPage();
        }
    } catch (error) {
        console.error('Error unverifying match:', error);
        showToast(`Failed to unverify: ${error.message}`, 'error');
    }
}

async function unmatchAmazonOrder(orderId) {
    // First, get the current match data so we can undo if needed
    const order = amazonOrders.find(o => o.order_id === orderId);
    if (!order || !order.matched_transaction_id) {
        showToast('Order is not matched', 'error');
        return;
    }

    const previousMatch = {
        transactionId: order.matched_transaction_id,
        confidence: order.match_confidence || 0
    };

    try {
        // Perform unmatch immediately
        const result = await fetchAPI(`/api/amazon/orders/${orderId}/unlink`, {
            method: 'POST'
        });

        if (result.success) {
            // Show toast with undo option
            showToast('Order unmatched', 'success', {
                undoAction: async () => {
                    // Undo: re-link the order
                    try {
                        await fetchAPI(`/api/amazon/orders/${orderId}/link`, {
                            method: 'POST',
                            body: JSON.stringify({
                                transactionId: previousMatch.transactionId
                            })
                        });
                        showToast('Match restored', 'success');
                        await loadAmazonPage();
                    } catch (error) {
                        console.error('Error restoring match:', error);
                        showToast(`Failed to restore match: ${error.message}`, 'error');
                    }
                }
            });
            await loadAmazonPage();
        }
    } catch (error) {
        console.error('Error unmatching order:', error);
        showToast(`Failed to unmatch: ${error.message}`, 'error');
    }
}

function applyAmazonFilters() {
    const filters = {
        matched: document.getElementById('amazonFilterMatched').value,
        startDate: document.getElementById('amazonFilterStartDate').value,
        endDate: document.getElementById('amazonFilterEndDate').value
    };

    // Reload both orders and stats with account filter
    Promise.all([
        loadAmazonStats(),
        loadAmazonOrders(filters)
    ]);
}

function clearAmazonFilters() {
    document.getElementById('amazonFilterMatched').value = '';
    document.getElementById('amazonFilterConfidence').value = '';
    document.getElementById('amazonFilterStartDate').value = '';
    document.getElementById('amazonFilterEndDate').value = '';
    document.getElementById('amazonSearchInput').value = '';

    // Clear item categorization filters
    const itemCategorizedFilter = document.getElementById('amazonFilterItemCategorized');
    const itemVerifiedFilter = document.getElementById('amazonFilterItemVerified');
    if (itemCategorizedFilter) itemCategorizedFilter.value = '';
    if (itemVerifiedFilter) itemVerifiedFilter.value = '';

    loadAmazonOrders();
}

function searchAmazonOrders() {
    const searchTerm = document.getElementById('amazonSearchInput').value.toLowerCase();
    const minConfidence = parseInt(document.getElementById('amazonFilterConfidence').value) || 0;
    const accountFilter = document.getElementById('amazonFilterAccount').value;
    const itemCategorizedFilter = document.getElementById('amazonFilterItemCategorized')?.value || '';
    const itemVerifiedFilter = document.getElementById('amazonFilterItemVerified')?.value || '';

    // Start with all orders
    let filtered = amazonOrders;

    // Apply account filter
    if (accountFilter) {
        filtered = filtered.filter(order => order.account_name === accountFilter);
    }

    // Apply confidence filter
    if (minConfidence > 0) {
        filtered = filtered.filter(order => {
            // If order is matched, check confidence
            if (order.matched_transaction_id) {
                return (order.match_confidence || 0) >= minConfidence;
            }
            // Unmatched orders have 0 confidence, so they're excluded if minConfidence > 0
            return false;
        });
    }

    // Apply item categorization filter
    if (itemCategorizedFilter) {
        filtered = filtered.filter(order => {
            if (!order.items || order.items.length === 0) return false;

            if (itemCategorizedFilter === 'categorized') {
                // At least one item must be categorized
                return order.items.some(item => item.user_category);
            } else if (itemCategorizedFilter === 'uncategorized') {
                // At least one item must be uncategorized
                return order.items.some(item => !item.user_category);
            }
            return true;
        });
    }

    // Apply item verified filter
    if (itemVerifiedFilter) {
        filtered = filtered.filter(order => {
            if (!order.items || order.items.length === 0) return false;

            if (itemVerifiedFilter === 'verified') {
                // At least one item must be verified
                return order.items.some(item => item.verified === 'Yes');
            } else if (itemVerifiedFilter === 'unverified') {
                // At least one item must be unverified
                return order.items.some(item => item.verified !== 'Yes');
            }
            return true;
        });
    }

    // Apply search term filter if present
    if (searchTerm) {
        filtered = filtered.filter(order => {
        // Search in order ID
        if (order.order_id && order.order_id.toLowerCase().includes(searchTerm)) {
            return true;
        }

        // Search in account name
        if (order.account_name && order.account_name.toLowerCase().includes(searchTerm)) {
            return true;
        }

        // Search in order amount
        if (order.total_amount && order.total_amount.toString().includes(searchTerm)) {
            return true;
        }

        // Search in payment method
        if (order.payment_method && order.payment_method.toLowerCase().includes(searchTerm)) {
            return true;
        }

        // Search in order status
        if (order.order_status && order.order_status.toLowerCase().includes(searchTerm)) {
            return true;
        }

        // Search in items
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                // Search in item title
                if (item.title && item.title.toLowerCase().includes(searchTerm)) {
                    return true;
                }

                // Search in item category
                if (item.category && item.category.toLowerCase().includes(searchTerm)) {
                    return true;
                }

                // Search in item seller
                if (item.seller && item.seller.toLowerCase().includes(searchTerm)) {
                    return true;
                }

                // Search in item price
                if (item.price && item.price.toString().includes(searchTerm)) {
                    return true;
                }

                // Search in ASIN
                if (item.asin && item.asin.toLowerCase().includes(searchTerm)) {
                    return true;
                }
            }
        }

        // Search in matched transaction
        if (order.matched_transaction) {
            const tx = order.matched_transaction;
            if ((tx.description && tx.description.toLowerCase().includes(searchTerm)) ||
                (tx.name && tx.name.toLowerCase().includes(searchTerm)) ||
                (tx.account_name && tx.account_name.toLowerCase().includes(searchTerm)) ||
                (tx.category && tx.category.toLowerCase().includes(searchTerm))) {
                return true;
            }
        }

        return false;
        });
    }

    displayAmazonOrders(filtered);
}

/**
 * Delete Amazon data (DEBUG function)
 * WARNING: This is destructive and cannot be undone
 */
async function deleteAllAmazonData() {
    const Modal = (await import('../components/Modal.js')).default;
    const { eventBus } = await import('../services/eventBus.js');

    const modalId = `delete-amazon-${Date.now()}`;

    // Get available accounts
    let accounts = [];
    try {
        accounts = await fetchAPI('/api/amazon/accounts');
    } catch (error) {
        console.error('Error fetching accounts:', error);
    }

    // Build account options HTML
    let accountOptionsHtml = '<option value="">All Accounts</option>';
    accounts.forEach(account => {
        accountOptionsHtml += `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`;
    });

    const modal = new Modal({
        id: modalId,
        title: '⚠️ Delete Amazon Data',
        content: `
            <div style="padding: 1rem 0;">
                <p style="color: #dc2626; font-weight: 600; margin-bottom: 1rem;">
                    ⚠️ WARNING: This action is IRREVERSIBLE!
                </p>
                <p style="margin-bottom: 1rem;">
                    Select which data to delete:
                </p>
                <div style="margin-bottom: 1.5rem;">
                    <label for="delete-account-select" style="display: block; font-weight: 600; margin-bottom: 0.5rem;">
                        Account:
                    </label>
                    <select id="delete-account-select" style="width: 100%; padding: 0.75rem; border: 2px solid #ccc; border-radius: 6px; font-size: 1rem;">
                        ${accountOptionsHtml}
                    </select>
                    <p style="font-size: 0.85rem; color: #666; margin-top: 0.5rem;">
                        Select "All Accounts" to delete all Amazon data, or choose a specific account.
                    </p>
                </div>
                <p style="color: #666; font-size: 0.9rem; margin-bottom: 1rem;">
                    This will permanently delete all orders, items, and transaction matchings for the selected account(s).
                    You will need to re-import your Amazon CSV files to restore this data.
                </p>
                <p style="font-weight: 600; margin-bottom: 0.5rem;">
                    Type "DELETE" to confirm:
                </p>
                <input type="text" id="delete-confirmation-input"
                       placeholder="Type DELETE"
                       style="width: 100%; padding: 0.75rem; border: 2px solid #dc2626; border-radius: 6px; font-size: 1rem;">
            </div>
        `,
        actions: [
            { action: 'cancel', label: 'Cancel', primary: false },
            { action: 'delete', label: 'Delete Data', primary: true }
        ],
        options: { size: 'medium', closeOnOverlay: false }
    });

    eventBus.once(`modal:${modalId}:delete`, async () => {
        const confirmInput = document.getElementById('delete-confirmation-input');
        const accountSelect = document.getElementById('delete-account-select');

        if (!confirmInput || confirmInput.value !== 'DELETE') {
            showToast('Confirmation text does not match. Deletion cancelled.', 'error');
            return;
        }

        const accountName = accountSelect.value;

        showLoading();
        try {
            let result;
            if (accountName) {
                // Delete specific account
                result = await fetchAPI('/api/amazon/delete-account', {
                    method: 'POST',
                    body: JSON.stringify({ accountName })
                });
            } else {
                // Delete all
                result = await fetchAPI('/api/amazon/delete-all', {
                    method: 'POST'
                });
            }

            if (result.success) {
                showToast(
                    `✓ Successfully deleted Amazon data!\n` +
                    `• ${result.ordersDeleted} orders deleted\n` +
                    `• ${result.itemsDeleted} items deleted`,
                    'success'
                );
                await loadAmazonPage();
            }
        } catch (error) {
            console.error('Error deleting Amazon data:', error);
            showToast(`Failed to delete: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    modal.show();
}

// ============================================================================
// ITEM CATEGORIZATION FUNCTIONS
// ============================================================================

let userCategories = [];

// Load categories for dropdowns
async function loadCategories() {
    try {
        userCategories = await fetchAPI('/api/categories');
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Populate category dropdowns for all items
function populateItemCategoryDropdowns() {
    // Get all item category dropdowns
    const dropdowns = document.querySelectorAll('[id^="item-category-"]');

    dropdowns.forEach(select => {
        // Clear and repopulate
        select.innerHTML = '<option value="">Change category...</option>';

        userCategories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.name;
            option.textContent = cat.parent_category ? `${cat.parent_category} > ${cat.name}` : cat.name;
            select.appendChild(option);
        });
    });
}

// Categorize a single item
async function categorizeItem(itemId) {
    try {
        showLoading();

        const result = await fetchAPI(`/api/amazon/items/${itemId}/categorize`, {
            method: 'POST'
        });

        showToast(`✓ Item categorized as: ${result.category} (${result.confidence}%)`, 'success');

        // Reload orders to show updated categorization
        await loadAmazonOrders();
    } catch (error) {
        console.error('Error categorizing item:', error);
        showToast(`Failed to categorize item: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// Update item category (manual selection)
async function updateItemCategory(itemId, category) {
    if (!category) return;

    try {
        showLoading();

        const result = await fetchAPI(`/api/amazon/items/${itemId}/category`, {
            method: 'POST',
            body: JSON.stringify({ category })
        });

        showToast(`✓ Item categorized as: ${category}`, 'success');

        if (result.learnResult && result.learnResult.success) {
            if (result.learnResult.action === 'created') {
                showToast(`📚 Created new rule: ${result.learnResult.ruleName}`, 'info');
            }
        }

        // Reload orders to show updated categorization
        await loadAmazonOrders();
    } catch (error) {
        console.error('Error updating item category:', error);
        showToast(`Failed to update category: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// Verify item category
async function verifyItemCategory(itemId) {
    try {
        await fetchAPI(`/api/amazon/items/${itemId}/verify`, {
            method: 'POST'
        });

        showToast('✓ Category verified!', 'success');

        // Reload orders to show updated verification
        await loadAmazonOrders();
    } catch (error) {
        console.error('Error verifying item category:', error);
        showToast(`Failed to verify: ${error.message}`, 'error');
    }
}

// Unverify item category
async function unverifyItemCategory(itemId, originalConfidence) {
    try {
        await fetchAPI(`/api/amazon/items/${itemId}/unverify`, {
            method: 'POST',
            body: JSON.stringify({ originalConfidence })
        });

        showToast('Category unverified', 'info');

        // Reload orders to show updated verification
        await loadAmazonOrders();
    } catch (error) {
        console.error('Error unverifying item category:', error);
        showToast(`Failed to unverify: ${error.message}`, 'error');
    }
}

// Categorize all Amazon items (background job)
async function categorizeAllAmazonItems() {
    if (!confirm('This will categorize ALL Amazon items. This may take a while. You can navigate to other pages while this runs. Continue?')) {
        return;
    }

    try {
        // Start background job
        const result = await fetchAPI('/api/amazon/items/categorize-background', {
            method: 'POST',
            body: JSON.stringify({ categorizedOnly: false })
        });

        const { jobId, totalItems } = result;

        // Show progress notification
        progressNotification.show(
            jobId,
            'Categorizing Amazon Items',
            0,
            { status: `Processing ${totalItems} items...` }
        );

        // Poll for progress
        pollJobProgress(jobId, totalItems);
    } catch (error) {
        console.error('Error starting categorization:', error);
        showToast(`Failed to start categorization: ${error.message}`, 'error');
    }
}

// Categorize first 20 items (for debugging)
async function categorizeFirst20Items() {
    try {
        // Start background job
        const result = await fetchAPI('/api/amazon/items/categorize-background', {
            method: 'POST',
            body: JSON.stringify({ limit: 20 })
        });

        const { jobId, totalItems } = result;

        // Show progress notification
        progressNotification.show(
            jobId,
            'Categorizing Amazon Items (Debug)',
            0,
            { status: `Processing ${totalItems} items...` }
        );

        // Poll for progress
        pollJobProgress(jobId, totalItems);
    } catch (error) {
        console.error('Error starting categorization:', error);
        showToast(`Failed to start categorization: ${error.message}`, 'error');
    }
}

// Update a single item in the UI (reactive update)
function updateItemInUI(itemId, update) {
    try {
        console.log(`[Amazon Item UI] Updating item ${itemId} with category: ${update.category}`);

        // Find the item container
        const itemElement = document.getElementById(`item-${itemId}`);
        if (!itemElement) {
            console.warn(`[Amazon Item UI] Item element not found for item ${itemId}`);
            return;
        }

        // Update the item in amazonOrders array
        let itemFound = false;
        for (const order of amazonOrders) {
            if (order.items) {
                const item = order.items.find(i => i.id === itemId);
                if (item) {
                    item.user_category = update.category;
                    item.confidence = update.confidence;
                    item.categorization_reasoning = update.reasoning;
                    item.verified = update.verified || 'No';
                    itemFound = true;
                    break;
                }
            }
        }

        if (!itemFound) {
            console.warn(`[Amazon Item UI] Item ${itemId} not found in amazonOrders array`);
        }

        // Calculate category color
        const confidence = update.confidence || 0;
        const isVerified = update.verified === 'Yes';
        let categoryColor = '#6B7280';

        if (update.category) {
            if (isVerified || confidence === 100) {
                categoryColor = '#3B82F6'; // blue for verified
            } else if (confidence >= 85) {
                categoryColor = '#10B981'; // green for high confidence
            } else if (confidence >= 70) {
                categoryColor = '#F59E0B'; // amber for medium confidence
            } else if (confidence >= 50) {
                categoryColor = '#F97316'; // orange for low confidence
            } else {
                categoryColor = '#EF4444'; // red for very low confidence
            }
        }

        // Build new category badge
        const categoryBadge = update.category
            ? `<span style="background: ${categoryColor}; color: white; padding: 0.2rem 0.5rem; border-radius: 8px; font-size: 0.75rem; font-weight: 600; white-space: nowrap;">
                   ${escapeHtml(update.category)} ${isVerified ? '✓' : ''} ${confidence}%
               </span>`
            : `<span style="background: #6B7280; color: white; padding: 0.2rem 0.5rem; border-radius: 8px; font-size: 0.75rem; white-space: nowrap;">
                   Uncategorized
               </span>`;

        // Build action buttons
        const actionButtons = update.category
            ? (isVerified
                ? `<button onclick="unverifyItemCategory(${itemId}, ${confidence})" style="padding: 0.2rem 0.5rem; background: #F59E0B; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Unverify</button>`
                : `<button onclick="verifyItemCategory(${itemId})" style="padding: 0.2rem 0.5rem; background: #10B981; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Verify</button>`)
            : `<button onclick="categorizeItem(${itemId})" style="padding: 0.2rem 0.5rem; background: #3B82F6; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Categorize</button>`;

        // Find the controls container (has the badge, dropdown, and buttons)
        const controlsContainer = itemElement.querySelector('div[style*="display: flex"][style*="gap: 0.5rem"]');
        if (controlsContainer) {
            // Update the controls HTML
            controlsContainer.innerHTML = `
                ${categoryBadge}
                ${createCategoryDropdown({
                    id: `item-category-${itemId}`,
                    categories: userCategories || [],
                    placeholder: 'Change category...',
                    onchange: `updateItemCategory(${itemId}, this.value)`,
                    size: 'small'
                })}
                ${actionButtons}
            `;
        }

        // Update reasoning text
        const reasoningContainer = itemElement.querySelector('div[style*="font-style: italic"]');
        if (update.reasoning) {
            if (reasoningContainer) {
                reasoningContainer.textContent = update.reasoning;
            } else {
                // Add reasoning element if it doesn't exist
                const itemContent = itemElement.querySelector('div[style*="flex: 1"]');
                if (itemContent) {
                    const reasoningDiv = document.createElement('div');
                    reasoningDiv.style = 'font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; font-style: italic;';
                    reasoningDiv.textContent = update.reasoning;
                    itemContent.appendChild(reasoningDiv);
                }
            }
        } else if (reasoningContainer) {
            reasoningContainer.remove();
        }

        console.log(`[Amazon Item UI] Successfully updated item ${itemId}`);
    } catch (error) {
        console.error(`[Amazon Item UI] Error updating item ${itemId}:`, error);
    }
}

// Poll for job progress
async function pollJobProgress(jobId, totalItems) {
    const pollInterval = 1000; // Poll every second
    let previousProgress = 0;

    const poll = async () => {
        try {
            const job = await fetchAPI(`/api/jobs/${jobId}`);

            if (!job) {
                progressNotification.showError(
                    jobId,
                    'Categorization Error',
                    'Job not found'
                );
                return;
            }

            // Process incremental updates for reactive UI
            if (job.updates && job.updates.length > 0) {
                console.log(`[Amazon Item Categorization] Processing ${job.updates.length} incremental updates`);
                for (const update of job.updates) {
                    updateItemInUI(update.itemId, update);
                }
            }

            // Update progress notification
            const progress = job.progress || 0;
            const status = `${job.processed || 0} of ${totalItems} items categorized`;

            progressNotification.updateProgress(jobId, progress, {
                status,
                state: job.status
            });

            // Check if job is complete
            if (job.status === 'completed') {
                console.log('[Amazon Item Categorization] Job completed successfully');

                progressNotification.showSuccess(
                    jobId,
                    'Categorization Complete',
                    `Successfully categorized ${job.result?.count || totalItems} items!`,
                    5000
                );

                // Reload stats to update item categorization counts
                // No need to reload orders - UI was updated reactively
                try {
                    await loadAmazonStats();
                    console.log('[Amazon Item Categorization] Stats reloaded');
                } catch (error) {
                    console.error('[Amazon Item Categorization] Error reloading stats:', error);
                }

                return;
            }

            // Check if job failed
            if (job.status === 'failed') {
                progressNotification.showError(
                    jobId,
                    'Categorization Failed',
                    job.error || 'Unknown error occurred',
                    10000
                );
                return;
            }

            // Continue polling if job is still running
            if (job.status === 'running' || job.status === 'pending') {
                setTimeout(poll, pollInterval);
            }
        } catch (error) {
            console.error('Error polling job progress:', error);
            progressNotification.showError(
                jobId,
                'Categorization Error',
                'Failed to fetch job status',
                5000
            );
        }
    };

    // Start polling
    poll();
}

// Handle image loading errors - try fallback URLs before showing placeholder
window.handleImageError = function(imageId) {
    const img = document.getElementById(imageId);
    if (!img) return;

    tryNextFallback(imageId, img);
};

// Handle image load success - check if image is valid (not tiny/broken)
window.handleImageLoad = function(imageId) {
    const img = document.getElementById(imageId);
    if (!img) return;

    // Check if image is too small (likely a broken/missing image placeholder)
    // Amazon CDN sometimes returns 1x1 or very small images for missing products
    if (img.naturalWidth < 50 || img.naturalHeight < 50) {
        tryNextFallback(imageId, img);
    } else {
        // Valid image loaded - log success if this was after fallback attempts
        const fallbackIndex = parseInt(img.getAttribute('data-fallback-index') || '0');
        if (fallbackIndex > 0) {
            const asin = img.src.match(/\/([A-Z0-9]{10})/)?.[1] || 'unknown';
            console.log(`[Amazon Images] ASIN ${asin}: Image loaded successfully using fallback #${fallbackIndex + 1}`);
        }
    }
};

async function tryNextFallback(imageId, img) {
    try {
        const fallbackUrls = JSON.parse(img.getAttribute('data-fallback-urls') || '[]');
        const currentIndex = parseInt(img.getAttribute('data-fallback-index') || '0');
        const nextIndex = currentIndex + 1;

        if (nextIndex < fallbackUrls.length) {
            // Try next URL in fallback cascade (silent - no console spam)
            img.setAttribute('data-fallback-index', nextIndex.toString());
            img.src = fallbackUrls[nextIndex];
        } else {
            // All static fallbacks exhausted - try fetching real image URL from backend as last resort
            const asin = fallbackUrls[0]?.match(/\/([A-Z0-9]{10})/)?.[1];

            if (asin && !img.getAttribute('data-backend-tried')) {
                // Mark that we're trying backend to avoid infinite loops
                img.setAttribute('data-backend-tried', 'true');

                try {
                    console.log(`[Amazon Images] ASIN ${asin}: Trying backend scraper as final fallback...`);
                    const response = await fetch(`/api/amazon/product-image/${asin}`);

                    if (response.ok) {
                        const data = await response.json();
                        if (data.imageUrl) {
                            console.log(`[Amazon Images] ASIN ${asin}: Real image URL found via backend scraper!`);
                            img.src = data.imageUrl;
                            return; // Don't show placeholder yet, wait for this to load
                        }
                    }
                } catch (backendError) {
                    console.log(`[Amazon Images] ASIN ${asin}: Backend scraper failed:`, backendError.message);
                }
            }

            // Show placeholder as absolute last resort
            if (currentIndex > 0) {
                console.log(`[Amazon Images] ASIN ${asin || 'unknown'}: No image available after trying all sources`);
            }
            showPlaceholder(imageId);
        }
    } catch (error) {
        console.error(`[Amazon Images] Error in fallback logic:`, error);
        showPlaceholder(imageId);
    }
}

function showPlaceholder(imageId) {
    const container = document.getElementById(`container-${imageId}`);
    if (container) {
        container.innerHTML = `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f3f4f6;color:#9ca3af;font-size:1.5rem;">
                📦
            </div>
        `;
    }
}

export default {
    initializeAmazonPage,
    loadAmazonPage,
    handleAmazonFileUpload
};
