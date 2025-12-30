// ============================================================================
// Imports - Modular Architecture
// ============================================================================

import { eventBus } from './services/eventBus.js';
import { showToast, showSuccess, showError } from './services/toast.js';
import { formatCurrency, formatDate, escapeHtml, renderCategoryBadge, getContrastColor, showLoading, hideLoading } from './utils/formatters.js';
import { fetchAPI } from './services/api.js';
import { initializeDashboardPage, loadDashboard } from './pages/DashboardPage.js';
import { initializeAccountsPage, loadAccounts } from './pages/AccountsPage.js';
import { initializeTransactionsPage, loadTransactions, applyTransactionFilters, loadTransactionFilters } from './pages/TransactionsPage.js';
import { initializeAmazonPage, loadAmazonPage, handleAmazonFileUpload } from './pages/AmazonPage.js';
import { initializeCategoriesPage, loadCategories } from './pages/CategoriesPage.js';
import { initializeMappingsPage, loadMappings } from './pages/MappingsPage.js';

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

// Note: fetchAPI is now imported from services/api.js
// Note: formatCurrency, formatDate, escapeHtml, renderCategoryBadge,
// getContrastColor, showLoading, hideLoading are imported from utils/formatters.js

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


// Note: Similar Transactions Modal and Transaction Selection functions
// now in pages/TransactionsPage.js

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
