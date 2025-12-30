// ============================================================================
// Imports - Modular Architecture
// ============================================================================

import { eventBus } from './services/eventBus.js';
import { showToast, showSuccess, showError } from './services/toast.js';
import { formatCurrency, formatDate, escapeHtml, renderCategoryBadge, getContrastColor, showLoading, hideLoading } from './utils/formatters.js';
import { initializeDashboardPage, loadDashboard } from './pages/DashboardPage.js';
import { initializeAccountsPage, loadAccounts } from './pages/AccountsPage.js';
import { initializeTransactionsPage, loadTransactions } from './pages/TransactionsPage.js';
import { initializeAmazonPage, loadAmazonPage, handleAmazonFileUpload } from './pages/AmazonPage.js';
import { initializeCategoriesPage, loadCategories } from './pages/CategoriesPage.js';
import { initializeMappingsPage, loadMappings } from './pages/MappingsPage.js';

// API Base URL
const API_URL = '';

// State
let plaidHandler = null;
let currentPage = 'dashboard';

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
    // Initialize page modules
    initializeDashboardPage(fetchAPI);
    initializeAccountsPage({
        fetchAPI,
        navigateTo,
        applyTransactionFilters
    });
    initializeTransactionsPage({
        fetchAPI,
        navigateTo
    });
    initializeAmazonPage({
        fetchAPI,
        navigateTo
    });
    initializeCategoriesPage({
        fetchAPI,
        navigateTo,
        applyTransactionFilters
    });
    initializeMappingsPage({
        fetchAPI
    });

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

// Note: Dashboard functions now in pages/DashboardPage.js
// Note: Accounts functions now in pages/AccountsPage.js


// Note: Transactions functions now in pages/TransactionsPage.js
// Note: Categories functions now in pages/CategoriesPage.js
// Note: Mappings functions now in pages/MappingsPage.js

// ============================================================================
// PLAID LINK & SYNC
// ============================================================================

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

// Note: formatCurrency, formatDate, escapeHtml, renderCategoryBadge,
// getContrastColor, showLoading, hideLoading are now imported from utils/formatters.js

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

// Note: showToast is now imported from services/toast.js

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

// Note: Amazon functions now exposed in pages/AmazonPage.js

// ============================================================================
// Expose functions to global scope for onclick handlers
// ============================================================================
// Note: With ES6 modules, functions are scoped to the module. Functions called
// from inline onclick handlers need to be exposed on the window object.

// Navigation
window.navigateTo = navigateTo;

// Note: Transaction functions now exposed in pages/TransactionsPage.js
// Note: Amazon functions now exposed in pages/AmazonPage.js
// Note: Category functions now exposed in pages/CategoriesPage.js

// Google Sheets functions
window.syncToGoogleSheets = syncToGoogleSheets;
window.showSheetsConfigModal = showSheetsConfigModal;
window.closeSheetsConfigModal = closeSheetsConfigModal;
window.saveSheetConfig = saveSheetConfig;

// Plaid/Account functions
window.initiatePlaidLink = initiatePlaidLink;
window.syncTransactions = syncTransactions;
window.backfillHistoricalTransactions = backfillHistoricalTransactions;
