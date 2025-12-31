/**
 * AmazonPage Module
 * Handles all Amazon purchases page functionality including order display, matching, and charts
 */

import { formatCurrency, formatDate, escapeHtml, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { debounce } from '../utils/helpers.js';

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
}

export async function loadAmazonPage() {
    showLoading();
    try {
        await Promise.all([
            loadAmazonStats(),
            loadAmazonOrders()
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
        const stats = await fetchAPI('/api/amazon/stats');
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

    // Also display spending by time
    displayAmazonSpendingByTime(orders);

    let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';

    orders.forEach(order => {
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

                // Construct product image URL using ASIN (if available)
                const imageUrl = item.asin ? `https://images-na.ssl-images-amazon.com/images/P/${item.asin}.jpg` : null;

                itemsHtml += `
                    <div style="display: flex; gap: 1rem; padding: 0.5rem; background: var(--bg-secondary); border-radius: 6px;">
                        ${imageUrl ? `
                            <div style="flex-shrink: 0;">
                                <img src="${imageUrl}"
                                     alt="${escapeHtml(item.title)}"
                                     style="width: 60px; height: 60px; object-fit: contain; border-radius: 4px; background: white; padding: 2px;"
                                     onerror="this.style.display='none'">
                            </div>
                        ` : ''}
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 0.9rem; margin-bottom: 0.25rem;">
                                ${titleHtml}
                                ${itemUrl ? ' <span style="font-size: 0.75rem;">🔗</span>' : ''}
                            </div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary);">
                                ${item.quantity > 1 ? `Qty: ${item.quantity} × ` : ''}${formatCurrency(item.price)}${item.quantity > 1 ? ` = ${formatCurrency(item.price * item.quantity)}` : ''}
                                ${item.category ? ` • ${escapeHtml(item.category)}` : ''}
                                ${item.seller ? ` • Sold by: ${escapeHtml(item.seller)}` : ''}
                            </div>
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

    loadAmazonOrders(filters);
}

function clearAmazonFilters() {
    document.getElementById('amazonFilterMatched').value = '';
    document.getElementById('amazonFilterConfidence').value = '';
    document.getElementById('amazonFilterStartDate').value = '';
    document.getElementById('amazonFilterEndDate').value = '';
    document.getElementById('amazonSearchInput').value = '';

    loadAmazonOrders();
}

function searchAmazonOrders() {
    const searchTerm = document.getElementById('amazonSearchInput').value.toLowerCase();
    const minConfidence = parseInt(document.getElementById('amazonFilterConfidence').value) || 0;
    const accountFilter = document.getElementById('amazonFilterAccount').value;

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
 * Delete all Amazon data (DEBUG function)
 * WARNING: This is destructive and cannot be undone
 */
async function deleteAllAmazonData() {
    const Modal = (await import('../components/Modal.js')).default;
    const { eventBus } = await import('../services/eventBus.js');

    const modalId = `delete-amazon-${Date.now()}`;

    const modal = new Modal({
        id: modalId,
        title: '⚠️ Delete All Amazon Data',
        content: `
            <div style="padding: 1rem 0;">
                <p style="color: #dc2626; font-weight: 600; margin-bottom: 1rem;">
                    ⚠️ WARNING: This action is IRREVERSIBLE!
                </p>
                <p style="margin-bottom: 1rem;">
                    This will permanently delete:
                </p>
                <ul style="margin: 0 0 1rem 1.5rem; line-height: 1.8;">
                    <li>All Amazon orders (${amazonStats.total_orders || 0} orders)</li>
                    <li>All Amazon items</li>
                    <li>All transaction matchings</li>
                </ul>
                <p style="color: #666; font-size: 0.9rem;">
                    You will need to re-import your Amazon CSV files to restore this data.
                </p>
                <p style="font-weight: 600; margin-top: 1rem;">
                    Type "DELETE" to confirm:
                </p>
                <input type="text" id="delete-confirmation-input"
                       placeholder="Type DELETE"
                       style="width: 100%; padding: 0.75rem; border: 2px solid #dc2626; border-radius: 6px; font-size: 1rem; margin-top: 0.5rem;">
            </div>
        `,
        actions: [
            { action: 'cancel', label: 'Cancel', primary: false },
            { action: 'delete', label: 'Delete All Data', primary: true }
        ],
        options: { size: 'medium', closeOnOverlay: false }
    });

    eventBus.once(`modal:${modalId}:delete`, async () => {
        const confirmInput = document.getElementById('delete-confirmation-input');
        if (!confirmInput || confirmInput.value !== 'DELETE') {
            showToast('Confirmation text does not match. Deletion cancelled.', 'error');
            return;
        }

        showLoading();
        try {
            const result = await fetchAPI('/api/amazon/delete-all', {
                method: 'POST'
            });

            if (result.success) {
                showToast(
                    `✓ Successfully deleted all Amazon data!\n` +
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

export default {
    initializeAmazonPage,
    loadAmazonPage,
    handleAmazonFileUpload
};
