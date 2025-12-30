// API Base URL
const API_URL = '';

// State
let plaidHandler = null;
let currentPage = 'dashboard';

// ============================================================================
// Event Bus for Reactive State Management
// ============================================================================

class EventBus {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
}

const eventBus = new EventBus();

// Setup automatic view updates
function setupReactiveUpdates() {
    // When accounts change, refresh accounts page and transaction filters
    eventBus.on('accountsUpdated', () => {
        console.log('📡 Accounts updated, refreshing views...');
        if (currentPage === 'accounts') {
            loadAccounts();
        }
        // Refresh transaction filters on all pages
        loadTransactionFilters();
    });

    // When transactions change, refresh transactions and dashboard
    eventBus.on('transactionsUpdated', () => {
        console.log('📡 Transactions updated, refreshing views...');
        if (currentPage === 'transactions') {
            loadTransactions();
        }
        if (currentPage === 'dashboard') {
            loadDashboard();
        }
    });

    // When categories change, refresh categories page and dropdowns
    eventBus.on('categoriesUpdated', () => {
        console.log('📡 Categories updated, refreshing views...');
        if (currentPage === 'categories') {
            loadCategories();
        }
        if (currentPage === 'transactions') {
            loadTransactions(); // Reload to get updated category dropdowns
        }
    });

    // When mappings change, refresh mappings page
    eventBus.on('mappingsUpdated', () => {
        console.log('📡 Mappings updated, refreshing views...');
        if (currentPage === 'mappings') {
            loadMappings();
        }
    });
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation(); // This will handle initial page load via hash
    setupEventListeners();
    setupReactiveUpdates();
    checkEnvironment();
});

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            // Update URL hash which will trigger navigation
            window.location.hash = page;
        });
    });

    // Listen for hash changes (back/forward buttons, direct URL changes)
    window.addEventListener('hashchange', handleHashChange);

    // Handle initial page load
    handleHashChange();
}

function handleHashChange() {
    // Get page from hash, default to dashboard
    let page = window.location.hash.slice(1) || 'dashboard';

    // Validate page exists
    const validPages = ['dashboard', 'accounts', 'transactions', 'categories', 'mappings', 'amazon', 'link'];
    if (!validPages.includes(page)) {
        page = 'dashboard';
        window.location.hash = page;
    }

    navigateTo(page, false);
}

function navigateTo(page, updateHash = true) {
    // Update URL hash if not already updated
    if (updateHash && window.location.hash.slice(1) !== page) {
        window.location.hash = page;
        return; // hashchange event will call navigateTo again
    }

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });

    // Update page display
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`${page}-page`).classList.add('active');

    currentPage = page;

    // Load page data
    switch(page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'accounts':
            loadAccounts();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'categories':
            loadCategories();
            break;
        case 'mappings':
            loadMappings();
            break;
        case 'amazon':
            loadAmazonPage();
            break;
        case 'link':
            // Link page is static, no data to load
            break;
    }
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('linkAccountBtn').addEventListener('click', initiatePlaidLink);
    document.getElementById('syncBtn').addEventListener('click', syncTransactions);
    document.getElementById('backfillBtn').addEventListener('click', backfillHistoricalTransactions);
    document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
}

// Dashboard
let netWorthChartInstance = null;
let dailySpendingChartInstance = null;
let categoryChartInstance = null;
let currentTimeRange = '1w';

async function loadDashboard() {
    showLoading();
    try {
        const [accounts, transactions, stats] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/transactions?limit=10'),
            fetchAPI('/api/stats')
        ]);

        updateDashboardStats(accounts, stats);
        displayRecentTransactions(transactions);
        updateCategoryChart(stats);

        // Load new charts
        await loadNetWorthChart(currentTimeRange);
        await loadDailySpendingChart();

        // Set up time range selector listeners
        setupTimeRangeSelector();
    } catch (error) {
        showToast('Failed to load dashboard', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function updateDashboardStats(accounts, stats) {
    // Calculate total balance
    const totalBalance = accounts.reduce((sum, acc) => {
        const balance = parseFloat(acc.current_balance) || 0;
        return sum + balance;
    }, 0);

    document.getElementById('totalBalance').textContent = formatCurrency(totalBalance);
    document.getElementById('totalIncome').textContent = formatCurrency(stats.income || 0);
    document.getElementById('totalExpenses').textContent = formatCurrency(Math.abs(stats.expenses || 0));

    const net = (stats.income || 0) + (stats.expenses || 0);
    const netEl = document.getElementById('netIncome');
    netEl.textContent = formatCurrency(net);
    netEl.className = 'stat-value ' + (net >= 0 ? 'positive' : 'negative');
}

function displayRecentTransactions(transactions) {
    const container = document.getElementById('recentTransactions');

    if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No transactions yet. Link an account to get started!</p>';
        return;
    }

    container.innerHTML = transactions.slice(0, 5).map(tx => `
        <div class="transaction-item">
            <div class="transaction-info">
                <div class="transaction-name">${escapeHtml(tx.description || tx.name)}</div>
                <div class="transaction-meta">${formatDate(tx.date)} • ${escapeHtml(tx.category || 'Uncategorized')}</div>
            </div>
            <div class="transaction-amount ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </div>
        </div>
    `).join('');
}

function updateCategoryChart(stats) {
    const ctx = document.getElementById('categoryChart');
    if (!ctx || !stats.byCategory || Object.keys(stats.byCategory).length === 0) {
        return;
    }

    const categories = Object.keys(stats.byCategory);
    const amounts = Object.values(stats.byCategory).map(Math.abs);

    // Destroy existing chart if it exists
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    '#4CAF50', '#2196F3', '#FFC107', '#FF5722', '#9C27B0',
                    '#00BCD4', '#FF9800', '#E91E63', '#3F51B5', '#8BC34A'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

async function loadNetWorthChart(timeRange = '1w') {
    try {
        const data = await fetchAPI(`/api/charts/net-worth?range=${timeRange}`);

        if (!data || data.length === 0) {
            return;
        }

        const ctx = document.getElementById('netWorthChart');
        if (!ctx) return;

        // Destroy existing chart
        if (netWorthChartInstance) {
            netWorthChartInstance.destroy();
        }

        const labels = data.map(d => formatDate(d.date));
        const balances = data.map(d => d.balance);

        netWorthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Net Worth',
                    data: balances,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Net Worth: ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading net worth chart:', error);
    }
}

async function loadDailySpendingChart() {
    try {
        const data = await fetchAPI('/api/charts/daily-spending-income?days=30');

        if (!data || data.length === 0) {
            return;
        }

        const ctx = document.getElementById('dailySpendingChart');
        if (!ctx) return;

        // Destroy existing chart
        if (dailySpendingChartInstance) {
            dailySpendingChartInstance.destroy();
        }

        const labels = data.map(d => formatDate(d.date));
        const income = data.map(d => d.income);
        const expenses = data.map(d => d.expenses);

        dailySpendingChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Income',
                        data: income,
                        backgroundColor: '#4CAF50',
                        borderRadius: 4
                    },
                    {
                        label: 'Expenses',
                        data: expenses,
                        backgroundColor: '#FF5722',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading daily spending chart:', error);
    }
}

function setupTimeRangeSelector() {
    const buttons = document.querySelectorAll('.time-range-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', async function() {
            // Remove active class from all buttons
            buttons.forEach(b => b.classList.remove('active'));

            // Add active class to clicked button
            this.classList.add('active');

            // Get the time range
            const range = this.getAttribute('data-range');
            currentTimeRange = range;

            // Reload the net worth chart
            await loadNetWorthChart(range);
        });
    });
}

// Accounts
async function loadAccounts() {
    showLoading();
    try {
        const [accounts, institutions] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/institutions')
        ]);
        displayInstitutions(institutions);
        displayAccounts(accounts);
    } catch (error) {
        showToast('Failed to load accounts', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function displayInstitutions(institutions) {
    const container = document.getElementById('institutionsList');

    if (!institutions || institutions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No institutions connected yet.</p>';
        return;
    }

    container.innerHTML = institutions.map(inst => `
        <div class="institution-item">
            <div class="institution-info">
                <div class="institution-name">🏦 ${escapeHtml(inst.institution_name)}</div>
                <div class="institution-meta">Last synced: ${inst.last_synced_at ? formatDate(inst.last_synced_at) : 'Never'}</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn-icon" onclick="syncInstitution('${inst.item_id}', '${escapeHtml(inst.institution_name)}')" title="Sync transactions">
                    🔄
                </button>
                <button class="btn-icon btn-danger" onclick="removeInstitution('${inst.item_id}', '${escapeHtml(inst.institution_name)}')" title="Remove institution">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}

function displayAccounts(accounts) {
    const container = document.getElementById('accountsList');

    if (!accounts || accounts.length === 0) {
        container.innerHTML = `
            <div class="card centered">
                <p>No accounts connected yet.</p>
                <button onclick="navigateTo('accounts')" class="btn btn-primary" style="margin-top: 1rem;">Link Your First Account</button>
            </div>
        `;
        return;
    }

    container.innerHTML = accounts.map(acc => `
        <div class="account-card" onclick="viewAccountTransactions('${escapeHtml(acc.name)}')" style="cursor: pointer;" title="Click to view transactions">
            <div class="account-header">
                <div>
                    <div class="account-name">${escapeHtml(acc.name)}</div>
                    <div class="account-type">${escapeHtml(acc.type)}</div>
                </div>
                <div style="font-size: 2rem;">🏦</div>
            </div>
            <div class="account-balance">${formatCurrency(acc.current_balance || 0)}</div>
            <div class="account-institution">
                ${escapeHtml(acc.institution_name || acc.institution)} ${acc.mask ? `••${acc.mask}` : ''}
            </div>
        </div>
    `).join('');
}

function viewAccountTransactions(accountName) {
    // Navigate to transactions page
    navigateTo('transactions');

    // Wait for the page to load, then apply the filter
    setTimeout(() => {
        const filterAccount = document.getElementById('filterAccount');
        if (filterAccount) {
            filterAccount.value = accountName;
            applyTransactionFilters();
        }
    }, 100);
}

async function syncInstitution(itemId, institutionName) {
    showLoading();

    try {
        const result = await fetchAPI(`/api/sync/${itemId}`, {
            method: 'POST'
        });

        if (result.success) {
            showToast(`${result.institution} synced successfully! ${result.transactionsSynced} new transaction(s) added.`, 'success');

            // Emit events to update all views
            eventBus.emit('accountsUpdated');
            if (result.transactionsSynced > 0) {
                eventBus.emit('transactionsUpdated');
            }
        } else {
            showToast(`Failed to sync ${institutionName}: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('Failed to sync institution: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

async function removeInstitution(itemId, institutionName) {
    showLoading();

    try {
        const result = await fetchAPI(`/api/institutions/${itemId}`, {
            method: 'DELETE'
        });

        showToast(`${result.institution} removed! Deleted ${result.accountsRemoved} account(s) and ${result.transactionsRemoved} transaction(s). You can re-link your account anytime.`, 'success');

        // Emit events to update all views
        eventBus.emit('accountsUpdated');
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to remove institution: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// Transactions
let allCategories = [];
let allTransactions = []; // Store all transactions for client-side search/filter
let selectedTransactions = new Set(); // Track selected transaction IDs
let newlyCategorizedTransactionIds = new Set(); // Track newly categorized transaction IDs
let displayedTransactions = []; // Track currently displayed transactions
let newlyMatchedAmazonOrderIds = new Set(); // Track newly matched Amazon order IDs

async function loadTransactions(filters = {}) {
    showLoading();
    try {
        let url = '/api/transactions?limit=500';

        // Add filters to URL if provided
        if (filters.category) url += `&category=${encodeURIComponent(filters.category)}`;
        if (filters.account) url += `&account=${encodeURIComponent(filters.account)}`;
        if (filters.startDate) url += `&startDate=${filters.startDate}`;
        if (filters.endDate) url += `&endDate=${filters.endDate}`;

        const [transactions, categories] = await Promise.all([
            fetchAPI(url),
            fetchAPI('/api/categories')
        ]);

        // Deduplicate categories by name (case-insensitive)
        const uniqueCategories = [];
        const seenNames = new Set();
        categories.forEach(cat => {
            const lowerName = cat.name.toLowerCase();
            if (!seenNames.has(lowerName)) {
                seenNames.add(lowerName);
                uniqueCategories.push(cat);
            }
        });

        allCategories = uniqueCategories;
        allTransactions = transactions; // Store for searching
        displayTransactionsTable(transactions);
        // Load all available filters (not just from current transactions)
        await loadTransactionFilters();
        updateBulkActionsBar();
    } catch (error) {
        showToast('Failed to load transactions', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Load fresh transaction filter data (accounts and categories)
 * Shows ALL accounts and categories, not just those with transactions
 * Used by reactive updates when data changes
 */
async function loadTransactionFilters() {
    try {
        const [accounts, categories] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/categories')
        ]);

        // Update account filter dropdown
        const accountFilter = document.getElementById('filterAccount');
        if (accountFilter) {
            const currentValue = accountFilter.value;
            accountFilter.innerHTML = '<option value="">All Accounts</option>' +
                accounts.map(acc => `<option value="${escapeHtml(acc.name)}">${escapeHtml(acc.name)}</option>`).join('');
            // Restore previous selection if still valid
            if (currentValue && Array.from(accountFilter.options).some(opt => opt.value === currentValue)) {
                accountFilter.value = currentValue;
            }
        }

        // Update category filter dropdown
        const categoryFilter = document.getElementById('filterCategory');
        if (categoryFilter) {
            const currentValue = categoryFilter.value;
            categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                categories.map(cat => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`).join('');
            // Restore previous selection if still valid
            if (currentValue && Array.from(categoryFilter.options).some(opt => opt.value === currentValue)) {
                categoryFilter.value = currentValue;
            }
        }
    } catch (error) {
        console.error('Error loading transaction filters:', error);
    }
}

function displayTransactionsTable(transactions, sortByConfidence = false) {
    const tbody = document.getElementById('transactionsTableBody');

    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No transactions found</td></tr>';
        document.getElementById('approveAllBtn').style.display = 'none';
        return;
    }

    // Sort by confidence if requested (descending order)
    let displayTransactions = [...transactions];
    if (sortByConfidence) {
        displayTransactions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    }

    // Store displayed transactions
    displayedTransactions = displayTransactions;

    // Show "Approve All Visible" button if:
    // 1. We're viewing a filtered view (not all transactions)
    // 2. There are unverified transactions in the view
    const isFilteredView = displayTransactions.length < allTransactions.length;
    const hasUnverified = displayTransactions.some(tx => !tx.verified);
    const approveAllBtn = document.getElementById('approveAllBtn');

    if (isFilteredView && hasUnverified) {
        approveAllBtn.style.display = 'block';
    } else {
        approveAllBtn.style.display = 'none';
    }

    tbody.innerHTML = displayTransactions.map(tx => {
        const isVerified = tx.verified;
        const hasCategory = tx.category && tx.category.length > 0;
        const confidence = tx.confidence || 0;
        const isSelected = selectedTransactions.has(tx.transaction_id);

        // Determine confidence badge color and style
        let confidenceColor = '#666';
        let confidenceBg = '#eee';
        if (confidence === 100) {
            confidenceColor = '#fff';
            confidenceBg = '#2563eb'; // Blue for manually verified
        } else if (confidence >= 85) {
            confidenceColor = '#fff';
            confidenceBg = '#16a34a'; // Green for high confidence
        } else if (confidence >= 70) {
            confidenceColor = '#fff';
            confidenceBg = '#ca8a04'; // Yellow for medium confidence
        } else if (confidence >= 50) {
            confidenceColor = '#fff';
            confidenceBg = '#ea580c'; // Orange for low confidence
        } else if (confidence > 0) {
            confidenceColor = '#fff';
            confidenceBg = '#dc2626'; // Red for very low confidence
        }

        return `
        <tr>
            <td>
                <input type="checkbox"
                       class="transaction-checkbox"
                       data-transaction-id="${tx.transaction_id}"
                       ${isSelected ? 'checked' : ''}
                       onchange="toggleTransactionSelection('${tx.transaction_id}')">
            </td>
            <td>${formatDate(tx.date)}</td>
            <td>${escapeHtml(tx.description || tx.name)}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    ${hasCategory ? (() => {
                        const categoryObj = allCategories.find(c => c.name === tx.category);
                        const badgeHtml = categoryObj
                            ? renderCategoryBadge(categoryObj, { inline: true })
                            : `<span class="category-badge" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                                <span>📁</span>
                                <span>${escapeHtml(tx.category)}</span>
                            </span>`;
                        return `<span onclick="showCategoryDropdown(event, '${tx.transaction_id}')" style="cursor: pointer;" title="Click to change category">${badgeHtml}</span>`;
                    })() : `<div class="searchable-dropdown-container" style="position: relative; flex: 1;">
                        <input type="text"
                               class="category-input ${isVerified ? 'verified' : ''}"
                               data-transaction-id="${tx.transaction_id}"
                               value="${escapeHtml(tx.category || '')}"
                               placeholder="Select category..."
                               readonly
                               onclick="showCategoryDropdown(this)"
                               autocomplete="off">
                    </div>`}
                    ${hasCategory && confidence > 0 ?
                        `<span style="
                            display: inline-block;
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 0.75rem;
                            font-weight: 600;
                            color: ${confidenceColor};
                            background: ${confidenceBg};
                            white-space: nowrap;
                        " title="Confidence: ${confidence}%">${confidence}%</span>` :
                        ''
                    }
                    ${isVerified ?
                        `<button class="verify-btn verified" onclick="unverifyCategory('${tx.transaction_id}')" title="Click to unverify">✓</button>` :
                        (hasCategory ?
                            `<button class="verify-btn" onclick="verifyCategory('${tx.transaction_id}')" title="Verify auto-assigned category">✓</button>` :
                            '')
                    }
                </div>
            </td>
            <td>${escapeHtml(tx.account_name || 'Unknown')}</td>
            <td class="amount-cell ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </td>
        </tr>
        `;
    }).join('');
}

function searchTransactions() {
    const searchInput = document.getElementById('transactionSearch');
    const searchTerm = searchInput?.value?.toLowerCase() || '';

    if (!searchTerm) {
        // No search term - show all transactions
        displayTransactionsTable(allTransactions);
        return;
    }

    // Filter transactions based on search term
    const filtered = allTransactions.filter(tx => {
        const description = (tx.description || tx.name || '').toLowerCase();
        const merchant = (tx.merchant_name || '').toLowerCase();
        const amount = (tx.amount || '').toString();
        const category = (tx.category || '').toLowerCase();
        const account = (tx.account_name || '').toLowerCase();

        return description.includes(searchTerm) ||
               merchant.includes(searchTerm) ||
               amount.includes(searchTerm) ||
               category.includes(searchTerm) ||
               account.includes(searchTerm);
    });

    displayTransactionsTable(filtered);
}

function applyTransactionFilters() {
    const filters = {
        category: document.getElementById('filterCategory')?.value || '',
        account: document.getElementById('filterAccount')?.value || '',
        startDate: document.getElementById('filterStartDate')?.value || '',
        endDate: document.getElementById('filterEndDate')?.value || ''
    };

    // Clear search when applying filters
    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) searchInput.value = '';

    loadTransactions(filters);
}

function clearTransactionFilters() {
    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) searchInput.value = '';
    if (document.getElementById('filterCategory')) document.getElementById('filterCategory').value = '';
    if (document.getElementById('filterAccount')) document.getElementById('filterAccount').value = '';
    if (document.getElementById('filterStartDate')) document.getElementById('filterStartDate').value = '';
    if (document.getElementById('filterEndDate')) document.getElementById('filterEndDate').value = '';

    // Clear newly categorized filter
    const banner = document.getElementById('newlyCategorizedBanner');
    if (banner) banner.style.display = 'none';
    newlyCategorizedTransactionIds.clear();

    // Reset quick filter buttons to "All"
    const showAllBtn = document.getElementById('showAllBtn');
    const showUnverifiedBtn = document.getElementById('showUnverifiedBtn');
    if (showAllBtn) {
        showAllBtn.classList.remove('btn-secondary');
        showAllBtn.classList.add('btn-primary');
    }
    if (showUnverifiedBtn) {
        showUnverifiedBtn.classList.remove('btn-primary');
        showUnverifiedBtn.classList.add('btn-secondary');
    }

    loadTransactions();
}

async function verifyCategory(transactionId) {
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/verify`, {
            method: 'POST'
        });
        showToast(`Category "${result.category}" verified`, 'success');

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to verify category: ' + error.message, 'error');
        console.error(error);
    }
}

async function unverifyCategory(transactionId) {
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/unverify`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        showToast(`Category "${result.category}" unverified - will be auto-recategorized`, 'success');

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to unverify category: ' + error.message, 'error');
        console.error(error);
    }
}

async function autoCategorizeTransactions() {
    showLoading();
    try {
        const result = await fetchAPI('/api/transactions/recategorize', {
            method: 'POST',
            body: JSON.stringify({ onlyUncategorized: true })
        });

        if (result.success) {
            showToast(
                `✨ Auto-categorization complete!\n` +
                `${result.updated} transactions categorized\n` +
                `${result.skipped} skipped (verified or already categorized)`,
                'success'
            );

            // Store newly categorized transaction IDs
            newlyCategorizedTransactionIds.clear();
            if (result.categorizedTransactions && result.categorizedTransactions.length > 0) {
                result.categorizedTransactions.forEach(tx => {
                    newlyCategorizedTransactionIds.add(tx.transaction_id);
                });
            }

            // Emit events to update all views
            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');

            // Navigate to transactions page
            navigateTo('transactions');

            // Show newly categorized transactions
            setTimeout(() => {
                showNewlyCategorizedTransactions();
            }, 100);
        }
    } catch (error) {
        showToast('Failed to auto-categorize: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// ============================================================================
// Searchable Category Dropdown
// ============================================================================

let currentDropdownInput = null;

/**
 * Show searchable category dropdown
 */
function showCategoryDropdown(inputElementOrEvent, transactionIdParam = null) {
    // Handle both direct input click and button/span click with event
    let inputElement;
    let transactionId;

    let clickedElement;

    if (typeof inputElementOrEvent === 'object' && inputElementOrEvent.target) {
        // Called from button/span with event
        const event = inputElementOrEvent;
        event.preventDefault();
        event.stopPropagation();
        transactionId = transactionIdParam;

        // Find the clicked element (could be button or span)
        clickedElement = event.target.closest('button') || event.target.closest('span[onclick]');
        inputElement = clickedElement; // Use the clicked element as reference for positioning
    } else {
        // Called from input element
        inputElement = inputElementOrEvent;
        transactionId = inputElement.getAttribute('data-transaction-id');
    }

    // Close any existing dropdown
    closeAllDropdowns();

    // Store transaction ID in the input element for later retrieval
    if (transactionId && inputElement) {
        inputElement.setAttribute('data-transaction-id', transactionId);
    }

    currentDropdownInput = inputElement;

    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'category-dropdown';
    dropdown.id = 'category-dropdown-' + transactionId;

    // Build dropdown HTML
    dropdown.innerHTML = `
        <div class="category-dropdown-search">
            <input type="text"
                   class="category-search-input"
                   placeholder="Search categories..."
                   oninput="filterCategoryDropdown(this.value)"
                   autofocus>
        </div>
        <div class="category-dropdown-list" id="category-list-${transactionId}">
            ${buildCategoryList(allCategories)}
        </div>
    `;

    // Append dropdown to document body for proper positioning
    document.body.appendChild(dropdown);

    // Position dropdown relative to the clicked/input element
    const rect = inputElement.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = '250px';
    dropdown.style.maxWidth = '400px';

    // Focus search input
    setTimeout(() => {
        const searchInput = dropdown.querySelector('.category-search-input');
        if (searchInput) searchInput.focus();
    }, 10);
}

/**
 * Build category list HTML
 */
function buildCategoryList(categories, searchTerm = '') {
    const filtered = searchTerm
        ? categories.filter(cat =>
            cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (cat.parent_category && cat.parent_category.toLowerCase().includes(searchTerm.toLowerCase()))
          )
        : categories;

    if (filtered.length === 0) {
        return '<div class="category-dropdown-empty">No categories found</div>';
    }

    // Group by parent category
    const topLevel = filtered.filter(cat => !cat.parent_category);
    const withParent = filtered.filter(cat => cat.parent_category);

    const html = [];

    // Top-level categories first
    topLevel.forEach(cat => {
        html.push(`
            <div class="category-dropdown-item" onclick="selectCategory('${escapeHtml(cat.name)}')">
                <span class="category-name" style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.1rem;">${cat.icon || '📁'}</span>
                    <span>${escapeHtml(cat.name)}</span>
                </span>
            </div>
        `);
    });

    // Child categories grouped by parent
    const parentGroups = {};
    withParent.forEach(cat => {
        if (!parentGroups[cat.parent_category]) {
            parentGroups[cat.parent_category] = [];
        }
        parentGroups[cat.parent_category].push(cat);
    });

    Object.entries(parentGroups).forEach(([parent, children]) => {
        // Add parent header if parent exists in filtered list
        const parentInList = topLevel.find(c => c.name === parent);
        if (!parentInList && !searchTerm) {
            html.push(`
                <div class="category-dropdown-header">${escapeHtml(parent)}</div>
            `);
        }

        children.forEach(cat => {
            html.push(`
                <div class="category-dropdown-item category-child" onclick="selectCategory('${escapeHtml(cat.name)}')">
                    <span class="category-name" style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.1rem;">${cat.icon || '📁'}</span>
                        <span>${escapeHtml(cat.name)}</span>
                    </span>
                    <span class="category-parent">${escapeHtml(cat.parent_category)}</span>
                </div>
            `);
        });
    });

    return html.join('');
}

/**
 * Filter category dropdown based on search term
 */
function filterCategoryDropdown(searchTerm) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');
    const listContainer = document.getElementById('category-list-' + transactionId);

    if (listContainer) {
        listContainer.innerHTML = buildCategoryList(allCategories, searchTerm);
    }
}

/**
 * Select a category from dropdown
 */
async function selectCategory(categoryName) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');

    // Update input value
    currentDropdownInput.value = categoryName;

    // Close dropdown
    closeAllDropdowns();

    // Update category in backend
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ category: categoryName })
        });

        console.log('Category update result:', result);
        console.log('Similar transactions:', result.similarTransactions);
        console.log('Similar count:', result.similarTransactions?.length);

        showToast('Category updated and verified', 'success');

        // Check if there are similar transactions to suggest updating
        if (result.similarTransactions && result.similarTransactions.length > 0) {
            console.log('Showing similar transactions modal with', result.similarTransactions.length, 'transactions');
            showSimilarTransactionsModal(result.similarTransactions, result.suggestedCategory);
            // Don't reload yet - wait for modal to be dismissed
        } else {
            console.log('No similar transactions to show');
            // No modal to show, safe to reload now
            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');
        }
    } catch (error) {
        showToast('Failed to update category: ' + error.message, 'error');
        console.error(error);
        loadTransactions();
    }
}

/**
 * Close all open category dropdowns
 */
function closeAllDropdowns() {
    document.querySelectorAll('.category-dropdown').forEach(dropdown => {
        dropdown.remove();
    });
    currentDropdownInput = null;
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown-container') &&
        !e.target.closest('.category-dropdown')) {
        closeAllDropdowns();
    }
});

// Close dropdown on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllDropdowns();
    }
});

// Categories
let categorySpendingChartInstance = null;

async function loadCategories() {
    showLoading();
    try {
        const [categories, spending] = await Promise.all([
            fetchAPI('/api/categories'),
            fetchAPI('/api/categories/spending')
        ]);

        populateCategoryParentDropdown(categories);
        displayCategories(categories, spending);
        displayCategorySpendingChart(spending);
    } catch (error) {
        showToast('Failed to load categories', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function populateCategoryParentDropdown(categories) {
    const select = document.getElementById('newCategoryParent');
    const topLevelCategories = categories.filter(cat => !cat.parent_category);

    select.innerHTML = '<option value="">No parent (top-level category)</option>' +
        topLevelCategories.map(cat => `
            <option value="${escapeHtml(cat.name)}">${cat.icon || '📁'} ${escapeHtml(cat.name)}</option>
        `).join('');
}

function displayCategories(categories, spending) {
    const container = document.getElementById('categoriesList');

    if (!categories || categories.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No categories yet. Add one above!</p>';
        return;
    }

    // Group by parent category
    const topLevel = categories.filter(cat => !cat.parent_category);
    const children = categories.filter(cat => cat.parent_category);

    const spendingMap = {};
    spending.categories.forEach(cat => {
        spendingMap[cat.name] = cat;
    });

    let html = '<div class="categories-tree">';

    topLevel.forEach(cat => {
        const catSpending = spendingMap[cat.name] || { total: 0, count: 0 };
        const childCats = children.filter(c => c.parent_category === cat.name);

        html += `
            <div class="category-item ${childCats.length > 0 ? 'has-children' : ''}">
                <div class="category-row">
                    <div class="category-info">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            ${renderCategoryBadge(cat, { inline: true })}
                            <span class="category-stats">${catSpending.count} transactions · ${formatCurrency(catSpending.total)}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn-icon btn-primary" onclick="viewCategoryTransactions('${escapeHtml(cat.name)}')" title="View transactions">👁️</button>
                        <button class="btn-icon btn-secondary" onclick="editCategory('${escapeHtml(cat.name)}', '${escapeHtml(cat.parent_category || '')}', '${escapeHtml(cat.icon || '📁')}', '${escapeHtml(cat.color || '#6B7280')}')" title="Edit category">✏️</button>
                        <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(cat.name)}')" title="Delete category">🗑️</button>
                    </div>
                </div>
        `;

        if (childCats.length > 0) {
            html += '<div class="category-children">';
            childCats.forEach(child => {
                const childSpending = spendingMap[child.name] || { total: 0, count: 0 };
                html += `
                    <div class="category-item child">
                        <div class="category-row">
                            <div class="category-info">
                                <div style="display: flex; align-items: center; gap: 0.75rem;">
                                    <span style="color: var(--text-secondary); margin-right: -0.5rem;">↳</span>
                                    ${renderCategoryBadge(child, { inline: true })}
                                    <span class="category-stats">${childSpending.count} transactions · ${formatCurrency(childSpending.total)}</span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 0.5rem;">
                                <button class="btn-icon btn-primary" onclick="viewCategoryTransactions('${escapeHtml(child.name)}')" title="View transactions">👁️</button>
                                <button class="btn-icon btn-secondary" onclick="editCategory('${escapeHtml(child.name)}', '${escapeHtml(child.parent_category || '')}', '${escapeHtml(child.icon || '📁')}', '${escapeHtml(child.color || '#6B7280')}')" title="Edit category">✏️</button>
                                <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(child.name)}')" title="Delete category">🗑️</button>
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    // Show orphaned children (those whose parent doesn't exist)
    const orphans = children.filter(c => !topLevel.some(p => p.name === c.parent_category));
    if (orphans.length > 0) {
        orphans.forEach(orphan => {
            const orphanSpending = spendingMap[orphan.name] || { total: 0, count: 0 };
            html += `
                <div class="category-item">
                    <div class="category-row">
                        <div class="category-info">
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                ${renderCategoryBadge(orphan, { inline: true })}
                                <span style="color: var(--text-secondary); font-size: 0.875rem;">(orphaned)</span>
                                <span class="category-stats">${orphanSpending.count} transactions · ${formatCurrency(orphanSpending.total)}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-icon btn-primary" onclick="viewCategoryTransactions('${escapeHtml(orphan.name)}')" title="View transactions">👁️</button>
                            <button class="btn-icon btn-secondary" onclick="editCategory('${escapeHtml(orphan.name)}', '${escapeHtml(orphan.parent_category || '')}', '${escapeHtml(orphan.icon || '📁')}', '${escapeHtml(orphan.color || '#6B7280')}')" title="Edit category">✏️</button>
                            <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(orphan.name)}')" title="Delete category">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;
}

function displayCategorySpendingChart(spending) {
    const ctx = document.getElementById('categorySpendingCanvas');
    if (!ctx) return;

    // Destroy existing chart
    if (categorySpendingChartInstance) {
        categorySpendingChartInstance.destroy();
    }

    // Get top 10 categories by spending
    const sortedCategories = spending.categories
        .filter(cat => cat.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    if (sortedCategories.length === 0) {
        ctx.parentElement.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">No spending data yet</p>';
        return;
    }

    const labels = sortedCategories.map(cat => cat.name);
    const data = sortedCategories.map(cat => cat.total);

    categorySpendingChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Spending',
                data: data,
                backgroundColor: '#FF5722',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Spending: ' + formatCurrency(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

async function addCategory() {
    const nameInput = document.getElementById('newCategoryName');
    const parentSelect = document.getElementById('newCategoryParent');

    const name = nameInput.value.trim();
    const parent = parentSelect.value;

    if (!name) {
        showToast('Please enter a category name', 'error');
        return;
    }

    try {
        await fetchAPI('/api/categories', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                parent_category: parent || null
            })
        });

        showToast('Category added successfully', 'success');
        nameInput.value = '';
        parentSelect.value = '';

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
    } catch (error) {
        showToast('Failed to add category: ' + error.message, 'error');
        console.error(error);
    }
}

let currentEditingCategory = null;

function editCategory(categoryName, parentCategory, icon = '📁', color = '#6B7280') {
    currentEditingCategory = categoryName;

    // Populate modal fields
    document.getElementById('editCategoryName').value = categoryName;
    document.getElementById('editCategoryIcon').value = icon || '📁';
    document.getElementById('editCategoryColor').value = color || '#6B7280';

    // Populate parent category dropdown
    const parentSelect = document.getElementById('editCategoryParent');
    parentSelect.innerHTML = '<option value="">No parent (top-level category)</option>';

    // Get all categories to populate parent dropdown (exclude the category being edited)
    allCategories.filter(cat => cat.name !== categoryName && !cat.parent_category).forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.name;
        option.textContent = `${cat.icon || '📁'} ${cat.name}`;
        if (cat.name === parentCategory) {
            option.selected = true;
        }
        parentSelect.appendChild(option);
    });

    // Show modal
    document.getElementById('editCategoryModal').style.display = 'flex';
}

function closeEditCategoryModal() {
    document.getElementById('editCategoryModal').style.display = 'none';
    currentEditingCategory = null;
}

async function saveEditCategory() {
    const newName = document.getElementById('editCategoryName').value.trim();
    const newParent = document.getElementById('editCategoryParent').value;
    const newIcon = document.getElementById('editCategoryIcon').value.trim() || '📁';
    const newColor = document.getElementById('editCategoryColor').value || '#6B7280';

    if (!newName) {
        showToast('Please enter a category name', 'error');
        return;
    }

    showLoading();
    try {
        const result = await fetchAPI(`/api/categories/${encodeURIComponent(currentEditingCategory)}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: newName,
                parent_category: newParent || null,
                icon: newIcon,
                color: newColor
            })
        });

        showToast(`Category updated successfully. ${result.transactionsUpdated} transaction(s) updated.`, 'success');
        closeEditCategoryModal();

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to update category: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

async function deleteCategory(categoryName) {
    showLoading();
    try {
        const result = await fetchAPI(`/api/categories/${encodeURIComponent(categoryName)}`, {
            method: 'DELETE'
        });

        showToast(`Category deleted. ${result.transactionsAffected} transaction(s) moved to uncategorized.`, 'success');

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to delete category: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function viewCategoryTransactions(categoryName) {
    // Navigate to transactions page
    navigateTo('transactions');

    // Set the category filter after a short delay to ensure DOM is ready
    setTimeout(() => {
        const categoryFilter = document.getElementById('filterCategory');
        if (categoryFilter) {
            categoryFilter.value = categoryName;
        }

        // Apply the filter
        applyTransactionFilters();
    }, 100);
}

// ============================================================================
// AUTO-CATEGORIZATION MAPPINGS
// ============================================================================

async function loadMappings() {
    showLoading();
    try {
        const [merchantMappings, categoryRules, plaidMappings] = await Promise.all([
            fetchAPI('/api/category-mappings/merchant'),
            fetchAPI('/api/category-mappings/rules'),
            fetchAPI('/api/category-mappings/plaid')
        ]);

        displayMerchantMappings(merchantMappings);
        displayCategoryRules(categoryRules);
        displayPlaidMappings(plaidMappings);
    } catch (error) {
        console.error('Error loading mappings:', error);
        showToast('Failed to load mappings', 'error');
    } finally {
        hideLoading();
    }
}

function displayMerchantMappings(mappings) {
    const container = document.getElementById('merchantMappingsList');

    if (!mappings || mappings.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No merchant mappings yet. Sync transactions to build this list automatically.</p>';
        return;
    }

    // Sort by match count (most used first)
    const sortedMappings = [...mappings].sort((a, b) => b.match_count - a.match_count);

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Merchant</th>
                        <th style="text-align: left; padding: 0.75rem;">Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Matches</th>
                        <th style="text-align: left; padding: 0.75rem;">Last Used</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedMappings.map(mapping => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(mapping.merchant_name)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(mapping.category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">${mapping.match_count}</td>
                            <td style="padding: 0.75rem; color: var(--text-secondary); font-size: 0.9rem;">${formatDate(mapping.last_used)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function displayCategoryRules(rules) {
    const container = document.getElementById('categoryRulesList');

    if (!rules || rules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No category rules configured.</p>';
        return;
    }

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Rule Name</th>
                        <th style="text-align: left; padding: 0.75rem;">Pattern</th>
                        <th style="text-align: left; padding: 0.75rem;">Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rules.map(rule => `
                        <tr style="border-bottom: 1px solid var(--border); ${rule.enabled ? '' : 'opacity: 0.5;'}">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(rule.name)}</td>
                            <td style="padding: 0.75rem; font-family: monospace; font-size: 0.9rem; color: var(--text-secondary);">${escapeHtml(rule.pattern)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(rule.category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">
                                <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; ${rule.enabled ? 'background: var(--success-light); color: var(--success);' : 'background: var(--bg-secondary); color: var(--text-secondary);'}">
                                    ${rule.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function displayPlaidMappings(mappings) {
    const container = document.getElementById('plaidMappingsList');

    if (!mappings || mappings.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No Plaid category mappings yet. These will be created automatically as transactions are synced.</p>';
        return;
    }

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Plaid Category</th>
                        <th style="text-align: left; padding: 0.75rem;">Your Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Auto-Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${mappings.map(mapping => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(mapping.plaid_category)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(mapping.user_category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">
                                ${mapping.auto_created ? '<span style="color: var(--success);">✓</span>' : '<span style="color: var(--text-secondary);">Manual</span>'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

// Plaid Link
async function initiatePlaidLink() {
    const btn = document.getElementById('linkAccountBtn');
    const statusEl = document.getElementById('linkStatus');

    btn.disabled = true;
    btn.textContent = 'Loading...';
    statusEl.textContent = '';
    statusEl.className = 'status-message';

    try {
        const { link_token } = await fetchAPI('/api/plaid/create-link-token', { method: 'POST' });

        plaidHandler = Plaid.create({
            token: link_token,
            onSuccess: async (public_token, metadata) => {
                console.log('✅ Plaid Link success!', { public_token, metadata });
                statusEl.textContent = 'Connecting account...';
                statusEl.className = 'status-message success';

                try {
                    const result = await fetchAPI('/api/plaid/exchange-token', {
                        method: 'POST',
                        body: JSON.stringify({ public_token })
                    });

                    console.log('✅ Account linked!', result);

                    // Show results
                    const transactionCount = result.transactions || 0;
                    if (transactionCount > 0) {
                        showToast(`Account linked! Fetched ${transactionCount} transaction(s) from the last 2 years`, 'success');
                        statusEl.textContent = `✓ Account linked! Fetched ${transactionCount} transaction(s). Redirecting...`;
                    } else {
                        showToast('Account linked! Historical transactions may take a moment to sync. Check back shortly.', 'info');
                        statusEl.textContent = '✓ Account linked! You can sync transactions from the Accounts page. Redirecting...';
                    }

                    // Emit events to update all views
                    eventBus.emit('accountsUpdated');
                    if (transactionCount > 0) {
                        eventBus.emit('transactionsUpdated');
                    }

                    setTimeout(() => {
                        navigateTo('accounts');
                    }, 3000);
                } catch (error) {
                    console.error('❌ Exchange failed:', error);
                    statusEl.textContent = '✗ Failed to link account: ' + error.message;
                    statusEl.className = 'status-message error';
                    showToast('Failed to link account', 'error');
                }
            },
            onExit: (err, metadata) => {
                console.log('Plaid Link exit', { err, metadata });
                if (err) {
                    const errorMessage = err.display_message || err.error_message || err.message || JSON.stringify(err);
                    console.error('❌ Plaid Link error:', err);
                    statusEl.textContent = 'Error: ' + errorMessage;
                    statusEl.className = 'status-message error';
                    showToast('Link error: ' + errorMessage, 'error');
                } else {
                    statusEl.textContent = 'Link process cancelled';
                    statusEl.className = 'status-message';
                }
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
            },
            onEvent: (eventName, metadata) => {
                console.log('Plaid Link event:', eventName, metadata);
            }
        });

        plaidHandler.open();
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
    } catch (error) {
        console.error('Error creating link token:', error);
        statusEl.textContent = 'Failed to initialize Plaid Link: ' + error.message;
        statusEl.className = 'status-message error';
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
        showToast('Failed to initialize link', 'error');
    }
}

// Sync
async function syncTransactions() {
    const btn = document.getElementById('syncBtn');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="icon">⏳</span> Syncing...';

    try {
        const result = await fetchAPI('/api/sync', { method: 'POST' });
        showToast(`Synced successfully! ${result.newTransactions || 0} new transactions`, 'success');

        // Emit events to update all views
        eventBus.emit('accountsUpdated');
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Sync failed: ' + error.message, 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function backfillHistoricalTransactions() {
    const btn = document.getElementById('backfillBtn');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="icon">⏳</span> Backfilling...';

    showToast('Fetching up to 2 years of historical transactions... This may take a few minutes.', 'info');

    try {
        const result = await fetchAPI('/api/backfill', { method: 'POST' });
        showToast(`Backfill complete! ${result.totalTransactions || 0} new transactions added`, 'success');

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Backfill failed: ' + error.message, 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

// Utility Functions
async function fetchAPI(endpoint, options = {}) {
    const response = await fetch(API_URL + endpoint, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

function formatCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '$0.00';

    const formatted = Math.abs(num).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
    });

    return num < 0 ? `-${formatted}` : formatted;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Render a category badge with icon and color
function renderCategoryBadge(category, options = {}) {
    const { showIcon = true, inline = false } = options;
    const icon = category.icon || '📁';
    const color = category.color || '#6B7280';
    const name = category.name;

    // Calculate if we need white text based on background color (simple luminance check)
    const textColor = getContrastColor(color);

    return `
        <span class="category-badge" style="
            background-color: ${color};
            color: ${textColor};
            ${inline ? 'display: inline-flex;' : ''}
            align-items: center;
            gap: 0.25rem;
        ">
            ${showIcon ? `<span>${icon}</span>` : ''}
            <span>${escapeHtml(name)}</span>
        </span>
    `;
}

// Get appropriate text color (white or black) based on background color
function getContrastColor(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Convert to RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return white for dark backgrounds, black for light backgrounds
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Check and display environment
async function checkEnvironment() {
    try {
        const envInfo = await fetchAPI('/api/environment');
        const envBadge = document.getElementById('envBadge');

        if (envBadge) {
            const envName = envInfo.environment.toUpperCase();
            const badgeClass = envInfo.isProduction ? 'env-production' : 'env-sandbox';
            envBadge.textContent = envName;
            envBadge.className = `env-badge ${badgeClass}`;
        }
    } catch (error) {
        console.error('Failed to check environment:', error);
    }
}

function showToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // If there's an undo action, create a toast with message and undo button
    if (options.undoAction) {
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.justifyContent = 'space-between';
        toast.style.gap = '1rem';
        toast.style.cursor = 'default';
        toast.style.padding = '1rem 1.25rem';

        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        messageSpan.style.flex = '1';
        toast.appendChild(messageSpan);

        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'UNDO';
        undoBtn.style.padding = '0.5rem 1rem';
        undoBtn.style.fontSize = '0.875rem';
        undoBtn.style.fontWeight = '600';
        undoBtn.style.background = 'white';
        undoBtn.style.color = '#16a34a';
        undoBtn.style.border = 'none';
        undoBtn.style.borderRadius = '6px';
        undoBtn.style.cursor = 'pointer';
        undoBtn.style.whiteSpace = 'nowrap';
        undoBtn.style.transition = 'all 0.2s ease';
        undoBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

        // Hover effects
        undoBtn.addEventListener('mouseenter', () => {
            undoBtn.style.background = '#f0f0f0';
            undoBtn.style.transform = 'scale(1.05)';
        });
        undoBtn.addEventListener('mouseleave', () => {
            undoBtn.style.background = 'white';
            undoBtn.style.transform = 'scale(1)';
        });

        undoBtn.addEventListener('click', async () => {
            clearTimeout(timeoutId);
            toast.remove();
            await options.undoAction();
        });

        toast.appendChild(undoBtn);
    } else {
        toast.textContent = message;
        toast.style.cursor = 'pointer';
        toast.title = 'Click to dismiss';

        // Click to dismiss immediately (only for non-undo toasts)
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            toast.remove();
        });
    }

    container.appendChild(toast);

    // Auto-dismiss after 10 seconds
    const timeoutId = setTimeout(() => {
        toast.remove();
    }, 10000);
}

// ============================================================================
// Google Sheets Sync Functions
// ============================================================================

// Store current sheets config
let currentSheetsConfig = null;

/**
 * Check Google Sheets configuration status and update UI
 */
async function checkSheetsStatus() {
    try {
        const response = await fetchAPI('/api/sheets/status');
        currentSheetsConfig = response; // Store for later use

        const card = document.getElementById('sheetsSyncCard');
        const syncBtn = document.getElementById('sheetsSyncBtn');
        const configBtn = document.getElementById('sheetsConfigBtn');
        const description = document.getElementById('sheetsSyncDescription');

        if (!card || !syncBtn || !configBtn || !description) {
            return;
        }

        // Show the card
        card.style.display = 'block';

        if (response.configured && response.initialized) {
            // Sheets configured and working - show sync button
            syncBtn.style.display = 'block';
            configBtn.style.display = 'none';

            if (response.url) {
                description.innerHTML = `Synced to: <a href="${escapeHtml(response.url)}" target="_blank" style="color: white; text-decoration: underline;">Google Sheet</a> • <a href="#" onclick="showSheetsConfigModal(); return false;" style="color: white; text-decoration: underline; opacity: 0.8;">Change</a>`;
            } else {
                description.textContent = 'Sync your local SQLite data to Google Sheets for backup and analysis';
            }
        } else {
            // Not configured - show config button
            syncBtn.style.display = 'none';
            configBtn.style.display = 'block';
            description.textContent = 'Link a Google Sheet to backup your data and access it from anywhere';
        }
    } catch (error) {
        console.error('Error checking sheets status:', error);
        // Hide the card on error
        const card = document.getElementById('sheetsSyncCard');
        if (card) {
            card.style.display = 'none';
        }
    }
}

/**
 * Sync data to Google Sheets
 */
async function syncToGoogleSheets() {
    try {
        showToast('Syncing all data to Google Sheets...', 'info');

        const result = await fetchAPI('/api/sheets/sync', {
            method: 'POST'
        });

        if (result.success) {
            const total = Object.values(result.synced || {}).reduce((sum, count) => sum + count, 0);
            showToast(`✓ Successfully synced ${total} records to Google Sheets!\n\n` +
                `Breakdown:\n` +
                `• ${result.synced.transactions || 0} transactions\n` +
                `• ${result.synced.accounts || 0} accounts\n` +
                `• ${result.synced.categories || 0} categories\n` +
                `• ${result.synced.plaidItems || 0} institutions`, 'success');
        } else {
            showToast(`Sync failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error syncing to Google Sheets:', error);
        showToast(`Sync error: ${error.message}`, 'error');
    }
}

/**
 * Show Google Sheets configuration modal
 */
function showSheetsConfigModal() {
    const modal = document.getElementById('sheetsConfigModal');
    const input = document.getElementById('sheetIdInput');
    const title = document.getElementById('sheetsConfigModalTitle');
    const description = document.getElementById('sheetsConfigModalDescription');
    const currentInfo = document.getElementById('currentSheetInfo');

    // Check if reconfiguring
    const isReconfiguring = currentSheetsConfig && currentSheetsConfig.sheetId;

    if (isReconfiguring) {
        // Pre-populate with existing sheet ID
        if (input) {
            input.value = currentSheetsConfig.sheetId;
        }

        // Update modal text for reconfiguration
        if (title) {
            title.textContent = '🔗 Change Google Sheet';
        }
        if (description) {
            description.textContent = 'Update your Google Sheet configuration:';
        }
        if (currentInfo && currentSheetsConfig.url) {
            currentInfo.innerHTML = `Currently synced to: <a href="${escapeHtml(currentSheetsConfig.url)}" target="_blank" style="color: #2563eb; text-decoration: underline;">View Sheet</a>`;
            currentInfo.style.display = 'block';
        }
    } else {
        // Reset to default text for initial configuration
        if (input) {
            input.value = '';
        }
        if (title) {
            title.textContent = '🔗 Link Google Sheet';
        }
        if (description) {
            description.textContent = 'To sync your data to Google Sheets for backup and analysis:';
        }
        if (currentInfo) {
            currentInfo.style.display = 'none';
        }
    }

    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close Google Sheets configuration modal
 */
function closeSheetsConfigModal() {
    const modal = document.getElementById('sheetsConfigModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Save Google Sheet configuration
 */
async function saveSheetConfig() {
    const input = document.getElementById('sheetIdInput');
    const sheetId = input?.value?.trim();

    if (!sheetId) {
        showToast('Please enter a valid Google Sheet ID', 'error');
        return;
    }

    const isReconfiguring = currentSheetsConfig && currentSheetsConfig.sheetId;

    try {
        showToast('Saving configuration...', 'info');

        const result = await fetchAPI('/api/sheets/configure', {
            method: 'POST',
            body: JSON.stringify({ sheetId })
        });

        if (result.success) {
            showToast(result.message, 'success');
            closeSheetsConfigModal();

            // Refresh sheets status
            await checkSheetsStatus();

            // Only ask to sync now if this is the first time configuring
            if (result.configured && !isReconfiguring) {
                // Auto-sync for first-time configuration
                showToast('Configuration saved! Syncing data...', 'success');
                await syncToGoogleSheets();
            }
        } else {
            showToast(`Configuration failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving sheet configuration:', error);
        showToast(`Configuration error: ${error.message}`, 'error');
    }
}

// ============================================================================
// Similar Transactions Modal Functions
// ============================================================================

let currentSimilarTransactions = [];
let currentSuggestedCategory = '';

/**
 * Show modal with similar transactions
 */
function showSimilarTransactionsModal(similarTransactions, suggestedCategory) {
    currentSimilarTransactions = similarTransactions;
    currentSuggestedCategory = suggestedCategory;

    const modal = document.getElementById('similarTransactionsModal');
    const countEl = document.getElementById('similarCount');
    const categoryNameEl = document.getElementById('suggestedCategoryName');
    const listEl = document.getElementById('similarTransactionsList');

    countEl.textContent = similarTransactions.length;
    categoryNameEl.textContent = suggestedCategory;

    // Build table rows
    listEl.innerHTML = similarTransactions.map(tx => {
        const formattedAmount = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(Math.abs(tx.amount));

        return `
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    <input type="checkbox" class="similar-tx-checkbox" value="${escapeHtml(tx.transaction_id)}" checked>
                </td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${escapeHtml(tx.date)}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${escapeHtml(tx.description)}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${formattedAmount}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    ${tx.category ? escapeHtml(tx.category) : '<em style="color: var(--text-secondary);">Uncategorized</em>'}
                </td>
            </tr>
        `;
    }).join('');

    modal.style.display = 'flex';
}

/**
 * Close similar transactions modal
 */
function closeSimilarTransactionsModal() {
    const modal = document.getElementById('similarTransactionsModal');
    modal.style.display = 'none';
    currentSimilarTransactions = [];
    currentSuggestedCategory = '';

    // Reload transactions after modal is closed
    eventBus.emit('transactionsUpdated');
    eventBus.emit('mappingsUpdated');
}

/**
 * Toggle all checkboxes in similar transactions list
 */
function toggleAllSimilarTransactions() {
    const selectAll = document.getElementById('selectAllSimilar');
    const checkboxes = document.querySelectorAll('.similar-tx-checkbox');

    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
    });
}

/**
 * Apply category to selected similar transactions
 */
async function applyCategoryToSimilar() {
    console.log('=== applyCategoryToSimilar called ===');

    const checkboxes = document.querySelectorAll('.similar-tx-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    console.log('Selected checkboxes:', checkboxes.length);
    console.log('Selected transaction IDs:', selectedIds);
    console.log('Current suggested category:', currentSuggestedCategory);

    if (selectedIds.length === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    if (!currentSuggestedCategory) {
        showToast('No category selected', 'error');
        console.error('currentSuggestedCategory is empty or undefined');
        return;
    }

    console.log('Showing loading spinner...');
    showLoading();

    try {
        console.log('Making API call to bulk update...');
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: selectedIds,
                category: currentSuggestedCategory
            })
        });

        console.log('API response:', result);

        if (result.success) {
            const count = result.updated || 0;
            showToast(`✓ Updated ${count} transaction(s) to category "${currentSuggestedCategory}"`, 'success');

            // Close modal (which will emit update events)
            closeSimilarTransactionsModal();
        } else {
            showToast('Failed to update transactions', 'error');
            console.error('API returned success: false');
        }
    } catch (error) {
        console.error('Error updating similar transactions:', error);
        showToast(`Failed to update: ${error.message}`, 'error');
    } finally {
        console.log('Hiding loading spinner...');
        hideLoading();
    }
}

// ============================================================================
// Transaction Selection and Bulk Actions
// ============================================================================

/**
 * Toggle individual transaction selection
 */
function toggleTransactionSelection(transactionId) {
    if (selectedTransactions.has(transactionId)) {
        selectedTransactions.delete(transactionId);
    } else {
        selectedTransactions.add(transactionId);
    }
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

/**
 * Toggle all transactions selection
 */
function toggleAllTransactionSelection() {
    const selectAllCheckbox = document.getElementById('selectAllTransactions');
    const checkboxes = document.querySelectorAll('.transaction-checkbox');

    if (selectAllCheckbox.checked) {
        // Select all
        checkboxes.forEach(cb => {
            const txId = cb.getAttribute('data-transaction-id');
            selectedTransactions.add(txId);
            cb.checked = true;
        });
    } else {
        // Deselect all
        selectedTransactions.clear();
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
    }
    updateBulkActionsBar();
}

/**
 * Update select all checkbox state based on individual selections
 */
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllTransactions');
    const checkboxes = document.querySelectorAll('.transaction-checkbox');

    if (checkboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

/**
 * Update bulk actions bar visibility and count
 */
function updateBulkActionsBar() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCountEl = document.getElementById('selectedCount');

    const count = selectedTransactions.size;

    if (count > 0) {
        bulkActionsBar.style.display = 'block';
        selectedCountEl.textContent = count;
    } else {
        bulkActionsBar.style.display = 'none';
    }
}

/**
 * Clear all selections
 */
function clearSelection() {
    selectedTransactions.clear();
    const checkboxes = document.querySelectorAll('.transaction-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

/**
 * Bulk verify selected transactions
 */
async function bulkVerifyTransactions() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    showLoading();
    try {
        let verified = 0;
        for (const txId of selectedTransactions) {
            await fetchAPI(`/api/transactions/${txId}/verify`, {
                method: 'POST'
            });
            verified++;
        }

        showToast(`✓ Verified ${verified} transaction(s)`, 'success');
        clearSelection();

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to verify transactions: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Show bulk category change modal
 */
function showBulkCategoryModal() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    const modal = document.getElementById('bulkCategoryModal');
    const countEl = document.getElementById('bulkSelectedCount');
    const selectEl = document.getElementById('bulkCategorySelect');

    countEl.textContent = selectedTransactions.size;

    // Populate categories
    selectEl.innerHTML = '<option value="">Select category...</option>' +
        allCategories.map(cat => {
            if (cat.parent_category) {
                return `<option value="${escapeHtml(cat.name)}">  ${escapeHtml(cat.name)} (${escapeHtml(cat.parent_category)})</option>`;
            } else {
                return `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`;
            }
        }).join('');

    modal.style.display = 'flex';
}

/**
 * Close bulk category modal
 */
function closeBulkCategoryModal() {
    const modal = document.getElementById('bulkCategoryModal');
    modal.style.display = 'none';
}

/**
 * Apply category to selected transactions
 */
async function applyBulkCategory() {
    const selectEl = document.getElementById('bulkCategorySelect');
    const category = selectEl.value;

    if (!category) {
        showToast('Please select a category', 'warning');
        return;
    }

    closeBulkCategoryModal();
    showLoading();

    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: Array.from(selectedTransactions),
                category: category
            })
        });

        if (result.success) {
            showToast(`✓ Updated ${result.updated} transaction(s) to category "${category}"`, 'success');
            clearSelection();

            // Emit events to update all views
            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');
        }
    } catch (error) {
        showToast('Failed to update categories: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Approve all visible transactions in the current filtered view
 */
async function approveAllVisibleTransactions() {
    // Get unverified transactions from the displayed set
    const unverifiedTransactions = displayedTransactions.filter(tx => !tx.verified);

    if (unverifiedTransactions.length === 0) {
        showToast('No unverified transactions to approve', 'info');
        return;
    }

    showLoading();
    try {
        // Store transaction state for undo (ID and original confidence)
        const transactionStates = unverifiedTransactions.map(tx => ({
            transaction_id: tx.transaction_id,
            originalConfidence: tx.confidence || 0
        }));

        // Approve all transactions
        let approved = 0;
        for (const tx of unverifiedTransactions) {
            await fetchAPI(`/api/transactions/${tx.transaction_id}/verify`, {
                method: 'POST'
            });
            approved++;
        }

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');

        // Show toast with undo action
        showToast(`✓ Approved ${approved} transaction(s)`, 'success', {
            undoAction: async () => {
                showLoading();
                try {
                    for (const state of transactionStates) {
                        await fetchAPI(`/api/transactions/${state.transaction_id}/unverify`, {
                            method: 'POST',
                            body: JSON.stringify({ originalConfidence: state.originalConfidence })
                        });
                    }
                    showToast(`↶ Undid approval of ${transactionStates.length} transaction(s)`, 'info');
                    eventBus.emit('transactionsUpdated');
                } catch (error) {
                    showToast('Failed to undo approval: ' + error.message, 'error');
                    console.error(error);
                } finally {
                    hideLoading();
                }
            }
        });
    } catch (error) {
        showToast('Failed to approve transactions: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Show newly categorized transactions
 */
function showNewlyCategorizedTransactions() {
    if (newlyCategorizedTransactionIds.size === 0) {
        showToast('No newly categorized transactions to show', 'info');
        return;
    }

    // Filter for newly categorized transactions
    const newlyCategorized = allTransactions.filter(tx =>
        newlyCategorizedTransactionIds.has(tx.transaction_id)
    );

    // Update banner
    const banner = document.getElementById('newlyCategorizedBanner');
    const countEl = document.getElementById('newlyCategorizedCount');
    banner.style.display = 'block';
    countEl.textContent = newlyCategorized.length;

    // Clear quick filter highlights
    document.getElementById('showAllBtn').classList.remove('btn-primary');
    document.getElementById('showAllBtn').classList.add('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-secondary');

    // Display sorted by confidence (descending)
    displayTransactionsTable(newlyCategorized, true);
}

/**
 * Clear newly categorized filter
 */
function clearNewlyCategorizedFilter() {
    // Hide banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Clear the stored IDs
    newlyCategorizedTransactionIds.clear();

    // Show all transactions
    showAllTransactions();
}

/**
 * Apply unverified filter (show unverified transactions sorted by confidence)
 */
function applyUnverifiedFilter() {
    // Hide newly categorized banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Filter for unverified transactions
    const unverified = allTransactions.filter(tx => !tx.verified);

    // Highlight the Unverified button
    document.getElementById('showAllBtn').classList.remove('btn-primary');
    document.getElementById('showAllBtn').classList.add('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-primary');

    // Display sorted by confidence (descending)
    displayTransactionsTable(unverified, true);

    if (unverified.length > 0) {
        showToast(`Showing ${unverified.length} unverified transaction(s), sorted by confidence`, 'info');
    } else {
        showToast('All transactions are verified!', 'success');
    }
}

/**
 * Show all transactions
 */
function showAllTransactions() {
    // Hide newly categorized banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Clear newly categorized IDs
    newlyCategorizedTransactionIds.clear();

    // Highlight the All button
    document.getElementById('showAllBtn').classList.remove('btn-secondary');
    document.getElementById('showAllBtn').classList.add('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-secondary');

    // Clear filters and show all
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterAccount').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('transactionSearch').value = '';

    displayTransactionsTable(allTransactions, false);
}

// Check sheets status when dashboard loads
document.addEventListener('DOMContentLoaded', () => {
    checkSheetsStatus();

    // Add ESC key listener to dismiss modals and clear filters
    document.addEventListener('keydown', (event) => {
        // Check which modals are open
        const similarTransactionsModal = document.getElementById('similarTransactionsModal');
        const bulkCategoryModal = document.getElementById('bulkCategoryModal');
        const editCategoryModal = document.getElementById('editCategoryModal');
        const sheetsConfigModal = document.getElementById('sheetsConfigModal');

        const similarOpen = similarTransactionsModal && similarTransactionsModal.style.display !== 'none';
        const bulkOpen = bulkCategoryModal && bulkCategoryModal.style.display !== 'none';
        const editOpen = editCategoryModal && editCategoryModal.style.display !== 'none';
        const sheetsOpen = sheetsConfigModal && sheetsConfigModal.style.display !== 'none';
        const anyModalOpen = similarOpen || bulkOpen || editOpen || sheetsOpen;

        if (event.key === 'Escape') {
            // First priority: Check if any modal is open and close it
            if (similarOpen) {
                closeSimilarTransactionsModal();
                return;
            }

            if (bulkOpen) {
                closeBulkCategoryModal();
                return;
            }

            if (editOpen) {
                closeEditCategoryModal();
                return;
            }

            if (sheetsOpen) {
                closeSheetsConfigModal();
                return;
            }

            // Second priority: If on transactions page and no modals are open, clear filters
            const transactionsPage = document.getElementById('transactions-page');
            const isOnTransactionsPage = transactionsPage &&
                window.getComputedStyle(transactionsPage).display !== 'none';

            if (isOnTransactionsPage) {
                // Blur any focused input first
                const activeElement = document.activeElement;
                const isInputField = activeElement &&
                    (activeElement.tagName === 'INPUT' ||
                     activeElement.tagName === 'TEXTAREA' ||
                     activeElement.tagName === 'SELECT');

                if (isInputField) {
                    activeElement.blur();
                }

                // Clear all filters and reload all transactions from server
                clearTransactionFilters();
            }
        }

        // Handle Enter key to trigger primary CTA when modal is open
        if (event.key === 'Enter' && anyModalOpen) {
            // Don't trigger if user is typing in a textarea
            const activeElement = document.activeElement;
            if (activeElement && activeElement.tagName === 'TEXTAREA') {
                return;
            }

            event.preventDefault();

            if (similarOpen) {
                applyCategoryToSimilar();
                return;
            }

            if (bulkOpen) {
                applyBulkCategory();
                return;
            }

            if (editOpen) {
                saveEditCategory();
                return;
            }

            if (sheetsOpen) {
                saveSheetConfig();
                return;
            }
        }
    });
});

// ============================================================================
// AMAZON PURCHASES PAGE
// ============================================================================

let amazonOrders = [];
let amazonStats = {};

async function loadAmazonPage() {
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

// Global chart instances
let amazonMonthlyChart = null;
let amazonYearlyChart = null;
let amazonCurrentTimeRange = 'all';

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

async function handleAmazonFileUpload(event) {
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
