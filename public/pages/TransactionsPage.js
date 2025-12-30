/**
 * TransactionsPage Module
 * Handles all transaction functionality including display, filtering, categorization,
 * selection, bulk operations, and category management
 */

import { formatCurrency, formatDate, escapeHtml, renderCategoryBadge, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { eventBus } from '../services/eventBus.js';
import { debounce } from '../utils/helpers.js';
import { aiCategorization } from '../services/aiCategorizationClient.js';
import { showConfirmModal } from '../components/Modal.js';

// Module state
let allCategories = [];
let allTransactions = [];
let selectedTransactions = new Set();
let newlyCategorizedTransactionIds = new Set();
let displayedTransactions = [];

// Dependencies (injected)
let fetchAPI = null;
let navigateTo = null;

// Current dropdown state
let currentDropdownInput = null;

export function initializeTransactionsPage(deps) {
    fetchAPI = deps.fetchAPI;
    navigateTo = deps.navigateTo;

    // Expose functions globally for onclick handlers
    window.showCategoryDropdown = showCategoryDropdown;
    window.selectCategory = selectCategory;
    window.verifyCategory = verifyCategory;
    window.unverifyCategory = unverifyCategory;
    window.toggleTransactionSelection = toggleTransactionSelection;
    window.toggleAllTransactionSelection = toggleAllTransactionSelection;
    window.clearSelection = clearSelection;
    window.showBulkCategoryModal = showBulkCategoryModal;
    window.bulkVerifyTransactions = bulkVerifyTransactions;
    window.closeBulkCategoryModal = closeBulkCategoryModal;
    window.applyBulkCategory = applyBulkCategory;
    window.approveAllVisibleTransactions = approveAllVisibleTransactions;
    window.viewCategoryTransactions = viewCategoryTransactions;
    window.applyTransactionFilters = applyTransactionFilters;
    window.searchTransactions = debouncedSearch; // Use debounced version for better performance
    window.clearTransactionFilters = clearTransactionFilters;
    window.showAllTransactions = showAllTransactions;
    window.applyUnverifiedFilter = applyUnverifiedFilter;
    window.showNewlyCategorizedTransactions = showNewlyCategorizedTransactions;
    window.autoCategorizeTransactions = autoCategorizeTransactions;
    window.filterCategoryDropdown = filterCategoryDropdown;
    window.closeAllDropdowns = closeAllDropdowns;
    window.closeSimilarTransactionsModal = closeSimilarTransactionsModal;
    window.toggleAllSimilarTransactions = toggleAllSimilarTransactions;
    window.applyCategoryToSimilar = applyCategoryToSimilar;

    // Initialize AI status badge
    updateAIStatusBadge();
}

// ============================================================================
// Core Loading and Display
// ============================================================================

export async function loadTransactions(filters = {}) {
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
        allTransactions = transactions;
        displayTransactionsTable(transactions);
        await loadTransactionFilters();
        updateBulkActionsBar();
    } catch (error) {
        showToast('Failed to load transactions', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

export async function loadTransactionFilters() {
    try {
        const [accounts, categories] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/categories')
        ]);

        const accountFilter = document.getElementById('filterAccount');
        if (accountFilter) {
            const currentValue = accountFilter.value;
            accountFilter.innerHTML = '<option value="">All Accounts</option>' +
                accounts.map(acc => `<option value="${escapeHtml(acc.name)}">${escapeHtml(acc.name)}</option>`).join('');
            if (currentValue && Array.from(accountFilter.options).some(opt => opt.value === currentValue)) {
                accountFilter.value = currentValue;
            }
        }

        const categoryFilter = document.getElementById('filterCategory');
        if (categoryFilter) {
            const currentValue = categoryFilter.value;
            categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                categories.map(cat => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`).join('');
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

    let displayTransactions = [...transactions];
    if (sortByConfidence) {
        displayTransactions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    }

    displayedTransactions = displayTransactions;

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

        let confidenceColor = '#666';
        let confidenceBg = '#eee';
        if (confidence === 100) {
            confidenceColor = '#fff';
            confidenceBg = '#2563eb';
        } else if (confidence >= 85) {
            confidenceColor = '#fff';
            confidenceBg = '#16a34a';
        } else if (confidence >= 70) {
            confidenceColor = '#fff';
            confidenceBg = '#ca8a04';
        } else if (confidence >= 50) {
            confidenceColor = '#fff';
            confidenceBg = '#ea580c';
        } else if (confidence > 0) {
            confidenceColor = '#fff';
            confidenceBg = '#dc2626';
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

// ============================================================================
// Filtering and Search
// ============================================================================

function searchTransactions() {
    const searchInput = document.getElementById('transactionSearch');
    const searchTerm = searchInput?.value?.toLowerCase() || '';

    if (!searchTerm) {
        displayTransactionsTable(allTransactions);
        return;
    }

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

// Create debounced version for better performance
const debouncedSearch = debounce(searchTransactions, 300);

export function applyTransactionFilters() {
    const filters = {
        category: document.getElementById('filterCategory')?.value || '',
        account: document.getElementById('filterAccount')?.value || '',
        startDate: document.getElementById('filterStartDate')?.value || '',
        endDate: document.getElementById('filterEndDate')?.value || ''
    };

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

    const banner = document.getElementById('newlyCategorizedBanner');
    if (banner) banner.style.display = 'none';
    newlyCategorizedTransactionIds.clear();

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

function viewCategoryTransactions(categoryName) {
    navigateTo('transactions');
    setTimeout(() => {
        const filterCategory = document.getElementById('filterCategory');
        if (filterCategory) {
            filterCategory.value = categoryName;
            applyTransactionFilters();
        }
    }, 100);
}

function showAllTransactions() {
    const btn = document.getElementById('showAllBtn');
    const unverifiedBtn = document.getElementById('showUnverifiedBtn');

    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    unverifiedBtn.classList.remove('btn-primary');
    unverifiedBtn.classList.add('btn-secondary');

    displayTransactionsTable(allTransactions);
}

function applyUnverifiedFilter() {
    const btn = document.getElementById('showUnverifiedBtn');
    const allBtn = document.getElementById('showAllBtn');

    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    allBtn.classList.remove('btn-primary');
    allBtn.classList.add('btn-secondary');

    const unverified = allTransactions.filter(tx => !tx.verified);
    displayTransactionsTable(unverified, true);
}

function showNewlyCategorizedTransactions() {
    if (newlyCategorizedTransactionIds.size === 0) {
        showToast('No newly categorized transactions to show', 'info');
        return;
    }

    const newlyCategorized = allTransactions.filter(tx =>
        newlyCategorizedTransactionIds.has(tx.transaction_id)
    );

    displayTransactionsTable(newlyCategorized, true);

    const banner = document.getElementById('newlyCategorizedBanner');
    const count = document.getElementById('newlyCategorizedCount');
    if (banner && count) {
        count.textContent = newlyCategorized.length;
        banner.style.display = 'flex';
    }
}

function clearNewlyCategorizedFilter() {
    newlyCategorizedTransactionIds.clear();
    const banner = document.getElementById('newlyCategorizedBanner');
    if (banner) banner.style.display = 'none';
    displayTransactionsTable(allTransactions);
}

// ============================================================================
// Category Management
// ============================================================================

async function verifyCategory(transactionId) {
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/verify`, {
            method: 'POST'
        });
        showToast(`Category "${result.category}" verified`, 'success');
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

            newlyCategorizedTransactionIds.clear();
            if (result.categorizedTransactions && result.categorizedTransactions.length > 0) {
                result.categorizedTransactions.forEach(tx => {
                    newlyCategorizedTransactionIds.add(tx.transaction_id);
                });
            }

            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');

            navigateTo('transactions');

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

// Category Dropdown functionality continues in next part...
// (Due to length, I'll continue in the same file)

function showCategoryDropdown(inputElementOrEvent, transactionIdParam = null) {
    let inputElement;
    let transactionId;
    let clickedElement;

    if (typeof inputElementOrEvent === 'object' && inputElementOrEvent.target) {
        const event = inputElementOrEvent;
        event.preventDefault();
        event.stopPropagation();
        transactionId = transactionIdParam;
        clickedElement = event.target.closest('button') || event.target.closest('span[onclick]');
        inputElement = clickedElement;
    } else {
        inputElement = inputElementOrEvent;
        transactionId = inputElement.getAttribute('data-transaction-id');
    }

    closeAllDropdowns();

    if (transactionId && inputElement) {
        inputElement.setAttribute('data-transaction-id', transactionId);
    }

    currentDropdownInput = inputElement;

    const dropdown = document.createElement('div');
    dropdown.className = 'category-dropdown';
    dropdown.id = 'category-dropdown-' + transactionId;

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

    document.body.appendChild(dropdown);

    const rect = inputElement.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = '250px';
    dropdown.style.maxWidth = '400px';

    setTimeout(() => {
        const searchInput = dropdown.querySelector('.category-search-input');
        if (searchInput) searchInput.focus();
    }, 10);
}

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

    const topLevel = filtered.filter(cat => !cat.parent_category);
    const withParent = filtered.filter(cat => cat.parent_category);

    const html = [];

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

    const parentGroups = {};
    withParent.forEach(cat => {
        if (!parentGroups[cat.parent_category]) {
            parentGroups[cat.parent_category] = [];
        }
        parentGroups[cat.parent_category].push(cat);
    });

    Object.keys(parentGroups).sort().forEach(parent => {
        html.push(`<div class="category-dropdown-group-label">${escapeHtml(parent)}</div>`);
        parentGroups[parent].forEach(cat => {
            html.push(`
                <div class="category-dropdown-item indented" onclick="selectCategory('${escapeHtml(cat.name)}')">
                    <span class="category-name" style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.1rem;">${cat.icon || '📁'}</span>
                        <span>${escapeHtml(cat.name)}</span>
                    </span>
                </div>
            `);
        });
    });

    return html.join('');
}

function filterCategoryDropdown(searchTerm) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');
    const listContainer = document.getElementById('category-list-' + transactionId);

    if (listContainer) {
        listContainer.innerHTML = buildCategoryList(allCategories, searchTerm);
    }
}

async function selectCategory(categoryName) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');
    if (!transactionId) return;

    closeAllDropdowns();

    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ category: categoryName })
        });

        if (result.success) {
            showToast(`Category set to "${categoryName}"`, 'success');

            if (result.similarTransactions && result.similarTransactions.length > 0) {
                setTimeout(() => {
                    showSimilarTransactionsModal(result.similarTransactions, categoryName);
                }, 300);
            }

            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to set category: ${error.message}`, 'error');
        console.error(error);
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.category-dropdown').forEach(dropdown => dropdown.remove());
    currentDropdownInput = null;
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.category-dropdown') &&
        !e.target.closest('.category-input') &&
        !e.target.closest('.category-badge')) {
        closeAllDropdowns();
    }
});

// Close dropdown on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllDropdowns();
    }
});

// ============================================================================
// Similar Transactions Modal
// ============================================================================

function showSimilarTransactionsModal(similarTransactions, suggestedCategory) {
    const modal = document.getElementById('similarTransactionsModal');
    const tbody = document.getElementById('similarTransactionsBody');
    const categorySpan = document.getElementById('suggestedCategory');
    const countSpan = document.getElementById('similarCount');

    if (!modal || !tbody || !categorySpan || !countSpan) return;

    categorySpan.textContent = suggestedCategory;
    countSpan.textContent = similarTransactions.length;

    tbody.innerHTML = similarTransactions.map(tx => `
        <tr>
            <td>
                <input type="checkbox"
                       class="similar-tx-checkbox"
                       data-transaction-id="${tx.transaction_id}"
                       checked>
            </td>
            <td>${formatDate(tx.date)}</td>
            <td>${escapeHtml(tx.description || tx.name)}</td>
            <td>${formatCurrency(tx.amount)}</td>
        </tr>
    `).join('');

    modal.classList.add('show');
}

function closeSimilarTransactionsModal() {
    const modal = document.getElementById('similarTransactionsModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function toggleAllSimilarTransactions() {
    const selectAllCheckbox = document.getElementById('selectAllSimilar');
    const checkboxes = document.querySelectorAll('.similar-tx-checkbox');

    checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
    });
}

async function applyCategoryToSimilar() {
    const categorySpan = document.getElementById('suggestedCategory');
    const category = categorySpan.textContent;

    const selectedCheckboxes = document.querySelectorAll('.similar-tx-checkbox:checked');
    const transactionIds = Array.from(selectedCheckboxes).map(cb => cb.getAttribute('data-transaction-id'));

    if (transactionIds.length === 0) {
        showToast('No transactions selected', 'info');
        return;
    }

    showLoading();

    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds,
                category
            })
        });

        if (result.success) {
            showToast(`Updated ${result.updated} similar transaction(s)`, 'success');
            closeSimilarTransactionsModal();

            setTimeout(() => {
                eventBus.emit('transactionsUpdated');
            }, 100);
        }
    } catch (error) {
        console.error('Error updating similar transactions:', error);
        showToast(`Failed to update: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================================
// Selection and Bulk Operations
// ============================================================================

function toggleTransactionSelection(transactionId) {
    if (selectedTransactions.has(transactionId)) {
        selectedTransactions.delete(transactionId);
    } else {
        selectedTransactions.add(transactionId);
    }
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

function toggleAllTransactionSelection() {
    const selectAllCheckbox = document.getElementById('selectAllTransactions');
    const checkboxes = document.querySelectorAll('.transaction-checkbox');

    if (selectAllCheckbox.checked) {
        checkboxes.forEach(cb => {
            const txId = cb.getAttribute('data-transaction-id');
            selectedTransactions.add(txId);
            cb.checked = true;
        });
    } else {
        selectedTransactions.clear();
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
    }
    updateBulkActionsBar();
}

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

function clearSelection() {
    selectedTransactions.clear();
    document.querySelectorAll('.transaction-checkbox').forEach(cb => cb.checked = false);
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

async function bulkVerifyTransactions() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'info');
        return;
    }

    showLoading();
    try {
        const result = await fetchAPI('/api/transactions/bulk/verify', {
            method: 'POST',
            body: JSON.stringify({ transactionIds: Array.from(selectedTransactions) })
        });

        if (result.success) {
            showToast(`Verified ${result.updated} transaction(s)`, 'success');
            selectedTransactions.clear();
            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to verify: ${error.message}`, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function showBulkCategoryModal() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'info');
        return;
    }

    const modal = document.getElementById('bulkCategoryModal');
    const countEl = document.getElementById('bulkSelectedCount');
    const selectEl = document.getElementById('bulkCategorySelect');

    if (!modal || !countEl || !selectEl) return;

    countEl.textContent = selectedTransactions.size;

    selectEl.innerHTML = '<option value="">Select a category...</option>' +
        allCategories.map(cat => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`).join('');

    modal.classList.add('show');
}

function closeBulkCategoryModal() {
    const modal = document.getElementById('bulkCategoryModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

async function applyBulkCategory() {
    const selectEl = document.getElementById('bulkCategorySelect');
    const category = selectEl.value;

    if (!category) {
        showToast('Please select a category', 'error');
        return;
    }

    showLoading();
    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: Array.from(selectedTransactions),
                category
            })
        });

        if (result.success) {
            showToast(`Updated ${result.updated} transaction(s)`, 'success');
            selectedTransactions.clear();
            closeBulkCategoryModal();
            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to update: ${error.message}`, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

async function approveAllVisibleTransactions() {
    const unverified = displayedTransactions.filter(tx => !tx.verified && tx.category);

    if (unverified.length === 0) {
        showToast('No unverified categorized transactions to approve', 'info');
        return;
    }

    showLoading();
    try {
        const transactionIds = unverified.map(tx => tx.transaction_id);
        const result = await fetchAPI('/api/transactions/bulk/verify', {
            method: 'POST',
            body: JSON.stringify({ transactionIds })
        });

        if (result.success) {
            showToast(`Approved ${result.updated} transaction(s)`, 'success');
            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to approve: ${error.message}`, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// ============================================================================
// AI CATEGORIZATION FUNCTIONS
// ============================================================================

/**
 * Update AI status badge
 */
async function updateAIStatusBadge() {
    const badge = document.getElementById('aiStatusBadge');
    if (!badge) return;

    const status = await aiCategorization.checkStatus();
    badge.textContent = aiCategorization.getStatusMessage();

    if (status.aiAvailable) {
        badge.style.color = '#27ae60';
    } else {
        badge.style.color = '#666';
    }
}

/**
 * AI auto-categorize - Review ALL transactions and suggest improvements
 */
async function aiAutoCategorizeUncategorized() {
    try {
        showLoading('AI is reviewing transactions...');

        // Get AI suggestions for transactions with confidence < 100%
        // Limit to 50 transactions to prevent timeout with Mistral 7B
        const response = await fetchAPI('/api/ai/review-all', {
            method: 'POST',
            body: JSON.stringify({
                confidenceThreshold: 100,
                limit: 50
            })
        });

        hideLoading();

        if (response.suggestions_count === 0) {
            let message = `Reviewed ${response.total_reviewed} transactions - no improvements found!`;
            if (response.has_more) {
                message += ` (${response.total_available - response.total_reviewed} more available - run again to review more)`;
            }
            showToast(message, 'success');
            return;
        }

        // Show review modal with suggestions
        await showReCategorizationReview(
            response.suggestions,
            response.total_reviewed,
            response.total_available,
            response.has_more
        );

    } catch (error) {
        hideLoading();
        console.error('AI review error:', error);
        showToast('Failed to review transactions: ' + error.message, 'error');
    }
}

/**
 * Show re-categorization review modal
 */
async function showReCategorizationReview(suggestions, totalReviewed, totalAvailable, hasMore) {
    const Modal = (await import('../components/Modal.js')).default;

    // Fetch categories for manual correction
    const categories = await fetchAPI('/api/categories');

    // Track selected suggestions and manual corrections
    let selectedSuggestions = new Set(suggestions.map((_, idx) => idx));
    let manualCorrections = new Map(); // idx -> { category, wasAI }

    const modalContent = `
        <div class="recategorization-review">
            <div class="review-summary">
                <p><strong>Reviewed:</strong> ${totalReviewed} of ${totalAvailable} transactions</p>
                <p><strong>Suggested changes:</strong> ${suggestions.length} improvements found</p>
                ${hasMore ? `
                    <p style="color: #ff9800; font-size: 0.9em; margin-top: 0.5rem;">
                        ⚠️ Showing first ${totalReviewed} transactions (${totalAvailable - totalReviewed} more available).
                        Run AI Categorize again after applying these changes to review more.
                    </p>
                ` : ''}
                <p style="color: #666; font-size: 0.9em; margin-top: 0.5rem;">
                    Select the changes you want to apply. Uncheck any you want to keep as-is.
                </p>
            </div>

            <div class="suggestions-list">
                ${suggestions.map((sugg, idx) => `
                    <div class="suggestion-item" data-index="${idx}">
                        <label class="suggestion-checkbox">
                            <input type="checkbox" checked data-suggestion-index="${idx}">
                            <div class="suggestion-details">
                                <div class="suggestion-transaction">
                                    <span class="suggestion-date">${formatDate(sugg.date)}</span>
                                    <span class="suggestion-description">${escapeHtml(sugg.description)}</span>
                                    <span class="suggestion-amount">${formatCurrency(sugg.amount)}</span>
                                </div>
                                <div class="suggestion-change">
                                    <div class="suggestion-from">
                                        <span class="label">Current:</span>
                                        <span class="category">${escapeHtml(sugg.current_category || 'Uncategorized')}</span>
                                        <span class="confidence">${sugg.current_confidence}%</span>
                                    </div>
                                    <div class="suggestion-arrow">→</div>
                                    <div class="suggestion-to">
                                        <span class="label">Apply as:</span>
                                        <select class="category-selector" data-suggestion-index="${idx}" data-original="${escapeHtml(sugg.suggested_category)}">
                                            ${categories.map(cat => `
                                                <option value="${escapeHtml(cat.name)}"
                                                    ${cat.name === sugg.suggested_category ? 'selected' : ''}>
                                                    ${escapeHtml(cat.name)}
                                                </option>
                                            `).join('')}
                                        </select>
                                        <span class="confidence highlight">${sugg.suggested_confidence}%</span>
                                    </div>
                                </div>
                                ${sugg.reasoning ? `
                                    <div class="suggestion-reasoning">
                                        <span class="reasoning-icon">${sugg.method === 'ai' ? '🤖' : '📋'}</span>
                                        <span class="reasoning-text">${escapeHtml(sugg.reasoning)}</span>
                                    </div>
                                ` : ''}
                            </div>
                        </label>
                    </div>
                `).join('')}
            </div>
        </div>

        <style>
            .recategorization-review {
                max-height: 70vh;
                overflow-y: auto;
            }

            .review-summary {
                background: #f0f9ff;
                padding: 1rem;
                border-radius: 6px;
                margin-bottom: 1.5rem;
                border-left: 4px solid #3b82f6;
            }

            .review-summary p {
                margin: 0.25rem 0;
            }

            .suggestions-list {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }

            .suggestion-item {
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                transition: all 0.2s;
            }

            .suggestion-item:hover {
                border-color: #3b82f6;
                box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
            }

            .suggestion-checkbox {
                display: flex;
                gap: 1rem;
                padding: 1rem;
                cursor: pointer;
                margin: 0;
            }

            .suggestion-checkbox input[type="checkbox"] {
                margin-top: 0.25rem;
                flex-shrink: 0;
                width: 18px;
                height: 18px;
                cursor: pointer;
            }

            .suggestion-details {
                flex: 1;
            }

            .suggestion-transaction {
                display: flex;
                gap: 1rem;
                margin-bottom: 0.75rem;
                flex-wrap: wrap;
            }

            .suggestion-date {
                color: #6b7280;
                font-size: 0.875rem;
            }

            .suggestion-description {
                font-weight: 500;
                flex: 1;
                min-width: 150px;
            }

            .suggestion-amount {
                font-weight: 600;
                color: #1f2937;
            }

            .suggestion-change {
                display: flex;
                gap: 1rem;
                align-items: center;
                background: #f9fafb;
                padding: 0.75rem;
                border-radius: 4px;
                margin-bottom: 0.5rem;
                flex-wrap: wrap;
            }

            .suggestion-from,
            .suggestion-to {
                display: flex;
                gap: 0.5rem;
                align-items: center;
            }

            .suggestion-from .label,
            .suggestion-to .label {
                font-size: 0.75rem;
                color: #6b7280;
                text-transform: uppercase;
            }

            .suggestion-from .category {
                padding: 0.25rem 0.75rem;
                background: #e5e7eb;
                border-radius: 4px;
                font-size: 0.875rem;
            }

            .suggestion-to .category.highlight {
                padding: 0.25rem 0.75rem;
                background: #3b82f6;
                color: white;
                border-radius: 4px;
                font-size: 0.875rem;
                font-weight: 500;
            }

            .category-selector {
                padding: 0.4rem 0.75rem;
                border: 2px solid #3b82f6;
                border-radius: 4px;
                font-size: 0.875rem;
                font-weight: 500;
                background: white;
                color: #1e40af;
                cursor: pointer;
                transition: all 0.2s;
                min-width: 150px;
            }

            .category-selector:hover {
                background: #eff6ff;
            }

            .category-selector:focus {
                outline: none;
                border-color: #1e40af;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
            }

            .category-selector.manual-edit {
                border-color: #f59e0b;
                background: #fffbeb;
                color: #92400e;
            }

            .suggestion-from .confidence,
            .suggestion-to .confidence {
                font-size: 0.75rem;
                padding: 0.125rem 0.5rem;
                border-radius: 3px;
                background: #f3f4f6;
                color: #6b7280;
            }

            .suggestion-to .confidence.highlight {
                background: #10b981;
                color: white;
                font-weight: 600;
            }

            .suggestion-arrow {
                color: #3b82f6;
                font-weight: bold;
                font-size: 1.25rem;
            }

            .suggestion-reasoning {
                display: flex;
                gap: 0.5rem;
                padding: 0.5rem;
                background: #fffbeb;
                border-radius: 4px;
                border-left: 3px solid #f59e0b;
                align-items: start;
            }

            .reasoning-icon {
                flex-shrink: 0;
            }

            .reasoning-text {
                font-size: 0.875rem;
                color: #78350f;
                font-style: italic;
                line-height: 1.4;
            }
        </style>
    `;

    const modal = new Modal({
        id: 'recategorization-review-modal',
        title: '🤖 AI Categorization Review',
        content: modalContent,
        actions: [
            { action: 'cancel', label: 'Cancel', primary: false },
            { action: 'apply', label: `Apply ${suggestions.length} Selected`, primary: true }
        ],
        options: { size: 'large' }
    });

    // Handle checkbox changes and apply button
    modal.show();

    const modalElement = document.getElementById('recategorization-review-modal');
    if (modalElement) {
        // Handle checkbox changes
        modalElement.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.suggestionIndex);
                if (e.target.checked) {
                    selectedSuggestions.add(idx);
                } else {
                    selectedSuggestions.delete(idx);
                }

                // Update button text
                const applyBtn = modalElement.querySelector('[data-action="apply"]');
                if (applyBtn) {
                    applyBtn.textContent = `Apply ${selectedSuggestions.size} Selected`;
                }
            });
        });

        // Handle category selector changes (manual corrections)
        modalElement.querySelectorAll('.category-selector').forEach(selector => {
            selector.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.suggestionIndex);
                const originalCategory = e.target.dataset.original;
                const newCategory = e.target.value;
                const sugg = suggestions[idx];

                if (newCategory !== originalCategory) {
                    // Mark as manually corrected
                    e.target.classList.add('manual-edit');
                    manualCorrections.set(idx, {
                        category: newCategory,
                        wasAI: sugg.method === 'ai'
                    });
                } else {
                    // Reverted to AI suggestion
                    e.target.classList.remove('manual-edit');
                    manualCorrections.delete(idx);
                }
            });
        });

        // Handle apply button
        eventBus.once(`modal:${modal.id}:apply`, async () => {
            const selectedSuggs = Array.from(selectedSuggestions).map(idx => {
                const sugg = { ...suggestions[idx] };

                // Get the selected category from the dropdown
                const selector = modalElement.querySelector(`.category-selector[data-suggestion-index="${idx}"]`);
                if (selector) {
                    sugg.suggested_category = selector.value;
                }

                return sugg;
            });

            if (selectedSuggs.length === 0) {
                showToast('No changes selected', 'info');
                return;
            }

            const manualCount = Array.from(selectedSuggestions)
                .filter(idx => manualCorrections.has(idx)).length;

            showLoading(`Applying ${selectedSuggs.length} changes${manualCount > 0 ? ` (${manualCount} manual)` : ''}...`);

            try {
                // Apply the suggestions
                const response = await fetchAPI('/api/ai/apply-suggestions', {
                    method: 'POST',
                    body: JSON.stringify({ suggestions: selectedSuggs })
                });

                // Send manual corrections to learning API
                const learningPromises = [];
                for (const idx of selectedSuggestions) {
                    if (manualCorrections.has(idx)) {
                        const sugg = suggestions[idx];
                        const correction = manualCorrections.get(idx);

                        learningPromises.push(
                            fetchAPI('/api/ai/learn', {
                                method: 'POST',
                                body: JSON.stringify({
                                    transaction: {
                                        transaction_id: sugg.transaction_id,
                                        description: sugg.description,
                                        merchant_name: sugg.merchant_name,
                                        amount: sugg.amount
                                    },
                                    userCategory: correction.category
                                })
                            }).catch(err => {
                                console.error('Failed to record learning:', err);
                                // Don't fail the whole operation if learning fails
                            })
                        );
                    }
                }

                // Wait for all learning calls to complete
                await Promise.all(learningPromises);

                hideLoading();

                let message = `Successfully updated ${response.updated} transactions!`;
                if (manualCount > 0) {
                    message += ` AI learned from ${manualCount} correction${manualCount > 1 ? 's' : ''}.`;
                }
                showToast(message, 'success');

                // Reload transactions
                await loadTransactions();
            } catch (error) {
                hideLoading();
                showToast('Failed to apply changes: ' + error.message, 'error');
            }
        });
    }
}

/**
 * AI suggest category for a specific transaction
 */
async function aiSuggestCategory(transactionId) {
    const transaction = allTransactions.find(tx => tx.transaction_id === transactionId);

    if (!transaction) {
        showToast('Transaction not found', 'error');
        return;
    }

    // Show AI suggestion modal
    await aiCategorization.showSuggestionModal(transaction, async (result) => {
        // Apply the suggested category
        try {
            await fetchAPI(`/api/transactions/${transactionId}/category`, {
                method: 'PATCH',
                body: JSON.stringify({ category: result.category })
            });

            showToast(`Category updated to ${result.category}`, 'success');
            await loadTransactions();
        } catch (error) {
            showToast(`Failed to update category: ${error.message}`, 'error');
        }
    });
}

// Expose functions globally for onclick handlers
window.aiAutoCategorizeUncategorized = aiAutoCategorizeUncategorized;
window.aiSuggestCategory = aiSuggestCategory;

// Export module
export default {
    initializeTransactionsPage,
    loadTransactions
};
