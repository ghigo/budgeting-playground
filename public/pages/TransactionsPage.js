/**
 * TransactionsPage Module
 * Handles all transaction functionality including display, filtering, categorization,
 * selection, bulk operations, and category management
 */

import { formatCurrency, formatDate, escapeHtml, renderCategoryBadge, renderCategoryControl, createConfidenceBadge, createButton, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { eventBus } from '../services/eventBus.js';
import { debounce, sumBy } from '../utils/helpers.js';
import { aiCategorization } from '../services/aiCategorizationClient.js';
import { showConfirmModal } from '../components/Modal.js';
import { showCategorySelector, closeCategorySelector } from '../components/CategorySelector.js';

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

// ============================================================================
// HELPER FUNCTIONS FOR UI GENERATION
// ============================================================================

/**
 * Clear multiple filter input values
 */
function clearFilterInputs(filterIds) {
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.value = '';
        }
    });
}

/**
 * Set active/inactive state for buttons
 */
function setActiveButton(activeBtn, inactiveBtn) {
    if (activeBtn) {
        activeBtn.classList.remove('btn-secondary');
        activeBtn.classList.add('btn-primary');
    }

    if (inactiveBtn) {
        inactiveBtn.classList.remove('btn-primary');
        inactiveBtn.classList.add('btn-secondary');
    }
}

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
    window.closeAllDropdowns = closeAllDropdowns;
    window.closeSimilarTransactionsModal = closeSimilarTransactionsModal;
    window.toggleAllSimilarTransactions = toggleAllSimilarTransactions;
    window.applyCategoryToSimilar = applyCategoryToSimilar;

    // Initialize AI status badge
    updateAIStatusBadge();

    // Setup infinite scroll
    setupInfiniteScroll();
}

// Setup infinite scroll listener
function setupInfiniteScroll() {
    let scrollTimeout;

    window.addEventListener('scroll', () => {
        // Debounce scroll events
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Check if user is near bottom of page (within 500px)
            const scrollPosition = window.innerHeight + window.scrollY;
            const pageHeight = document.documentElement.scrollHeight;

            if (scrollPosition >= pageHeight - 500) {
                // Auto-load more if we have more transactions
                if (hasMoreTransactions && !isLoadingMore) {
                    loadTransactions(currentFilters, false);
                }
            }
        }, 100);
    });
}

// ============================================================================
// Core Loading and Display
// ============================================================================

// Pagination state
let currentOffset = 0;
let isLoadingMore = false;
let hasMoreTransactions = true;
const TRANSACTIONS_PER_PAGE = 1000;
let currentFilters = {};

export async function loadTransactions(filters = {}, reset = true) {
    // If reset, start fresh; otherwise append
    if (reset) {
        currentOffset = 0;
        hasMoreTransactions = true;
        allTransactions = [];
        currentFilters = filters;
        showLoading();
    } else if (isLoadingMore || !hasMoreTransactions) {
        return; // Already loading or no more data
    }

    isLoadingMore = true;

    try {
        let url = `/api/transactions?limit=${TRANSACTIONS_PER_PAGE}&offset=${currentOffset}`;

        // Add filters to URL if provided
        if (filters.category) url += `&category=${encodeURIComponent(filters.category)}`;
        if (filters.account) url += `&account=${encodeURIComponent(filters.account)}`;
        if (filters.amazonMatch) url += `&amazonMatch=${encodeURIComponent(filters.amazonMatch)}`;
        if (filters.startDate) url += `&startDate=${filters.startDate}`;
        if (filters.endDate) url += `&endDate=${filters.endDate}`;

        const [transactions, categories] = await Promise.all([
            fetchAPI(url),
            reset ? fetchAPI('/api/categories') : Promise.resolve(allCategories)
        ]);

        // Deduplicate categories by name (case-insensitive) - only on first load
        if (reset) {
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
        }

        // Check if we got fewer transactions than requested (end of data)
        if (transactions.length < TRANSACTIONS_PER_PAGE) {
            hasMoreTransactions = false;
        }

        // Append new transactions to existing ones
        allTransactions = [...allTransactions, ...transactions];
        currentOffset += transactions.length;

        displayTransactionsTable(allTransactions);

        if (reset) {
            await loadTransactionFilters();
        }

        updateBulkActionsBar();

        // Add "Load More" button or message if applicable
        updateLoadMoreIndicator();
    } catch (error) {
        showToast('Failed to load transactions', 'error');
        console.error(error);
    } finally {
        hideLoading();
        isLoadingMore = false;
    }
}

function updateLoadMoreIndicator() {
    const tbody = document.getElementById('transactionsTableBody');
    if (!tbody) return;

    // Remove existing load more indicator
    const existingIndicator = document.getElementById('loadMoreIndicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Add load more indicator if there are more transactions
    if (hasMoreTransactions && allTransactions.length > 0) {
        const loadMoreRow = document.createElement('tr');
        loadMoreRow.id = 'loadMoreIndicator';

        if (isLoadingMore) {
            loadMoreRow.innerHTML = `
                <td colspan="6" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary);">
                    <span style="color: var(--text-secondary);">Loading more transactions...</span>
                </td>
            `;
        } else {
            loadMoreRow.innerHTML = `
                <td colspan="6" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary);">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <button onclick="window.loadMoreTransactions()" style="padding: 0.5rem 1rem; background: var(--primary); color: white; border: none; border-radius: 0.375rem; cursor: pointer; font-weight: 500;">
                            Load More (${TRANSACTIONS_PER_PAGE} at a time)
                        </button>
                        <span style="color: var(--text-secondary); font-size: 0.875rem;">
                            Or scroll down to auto-load
                        </span>
                    </div>
                </td>
            `;
        }
        tbody.appendChild(loadMoreRow);
    } else if (!hasMoreTransactions && allTransactions.length > 0) {
        const endRow = document.createElement('tr');
        endRow.id = 'loadMoreIndicator';
        endRow.innerHTML = `
            <td colspan="6" style="text-align: center; padding: 1rem; color: var(--text-secondary); font-size: 0.875rem;">
                All ${allTransactions.length} transactions loaded
            </td>
        `;
        tbody.appendChild(endRow);
    }
}

// Expose loadMoreTransactions globally for the button
window.loadMoreTransactions = function() {
    loadTransactions(currentFilters, false);
};

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
            <td>
                <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span>${escapeHtml(tx.description || tx.name)}</span>
                        ${tx.is_split ? `<span style="background: #fbbf24; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">SPLIT</span>` : ''}
                    </div>
                    ${tx.amazon_order ? `
                        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;">
                            <span style="background: #FF9900; color: white; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem;">
                                📦 Amazon
                            </span>
                            <span style="color: #666;">
                                Order ${escapeHtml(tx.amazon_order.order_id.substring(0, 15))}...
                                ${tx.amazon_order.total_amount ? ` • ${formatCurrency(tx.amazon_order.total_amount)}` : ''}
                            </span>
                            <button
                                onclick="showAmazonOrderDetails('${escapeHtml(tx.amazon_order.order_id)}')"
                                style="padding: 2px 8px; font-size: 0.75rem; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"
                                title="View order details">
                                Details
                            </button>
                        </div>
                    ` : ''}
                </div>
            </td>
            <td>
                ${renderCategoryControl({
                    itemId: tx.transaction_id,
                    category: tx.category,
                    confidence,
                    isVerified,
                    allCategories,
                    onCategoryClick: hasCategory ? `showCategoryDropdown(event, '${tx.transaction_id}')` : `showCategoryDropdown(this)`,
                    onVerify: `verifyCategory('${tx.transaction_id}')`,
                    onUnverify: `unverifyCategory('${tx.transaction_id}')`,
                    itemType: 'transaction'
                })}
            </td>
            <td>
                <div>${escapeHtml(tx.account_name || 'Unknown')}</div>
                ${tx.institution_name ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.125rem;">${escapeHtml(tx.institution_name)}</div>` : ''}
            </td>
            <td class="amount-cell ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </td>
            <td>
                ${tx.is_split ? `
                    <button
                        onclick="unsplitTransaction('${tx.split_parent_id}')"
                        style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 0.25rem; cursor: pointer; color: #92400e;"
                        title="Unsplit transaction">
                        Unsplit
                    </button>
                ` : `
                    <button
                        onclick="showSplitModal('${tx.transaction_id}')"
                        style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 0.25rem; cursor: pointer;"
                        title="Split transaction">
                        Split
                    </button>
                `}
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
        amazonMatch: document.getElementById('filterAmazonMatch')?.value || '',
        startDate: document.getElementById('filterStartDate')?.value || '',
        endDate: document.getElementById('filterEndDate')?.value || ''
    };

    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) searchInput.value = '';

    loadTransactions(filters);
}

function clearTransactionFilters() {
    // Clear all filter inputs
    clearFilterInputs([
        'transactionSearch',
        'filterCategory',
        'filterAccount',
        'filterAmazonMatch',
        'filterStartDate',
        'filterEndDate'
    ]);

    // Hide newly categorized banner
    const banner = document.getElementById('newlyCategorizedBanner');
    if (banner) banner.style.display = 'none';
    newlyCategorizedTransactionIds.clear();

    // Reset button states
    const showAllBtn = document.getElementById('showAllBtn');
    const showUnverifiedBtn = document.getElementById('showUnverifiedBtn');
    setActiveButton(showAllBtn, showUnverifiedBtn);

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

    setActiveButton(btn, unverifiedBtn);
    displayTransactionsTable(allTransactions);
}

function applyUnverifiedFilter() {
    const btn = document.getElementById('showUnverifiedBtn');
    const allBtn = document.getElementById('showAllBtn');

    setActiveButton(btn, allBtn);

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
        // Only categorize currently displayed transactions
        const transactionIds = displayedTransactions.map(tx => tx.transaction_id);

        if (transactionIds.length === 0) {
            showToast('No transactions to categorize', 'info');
            hideLoading();
            return;
        }

        const result = await fetchAPI('/api/transactions/recategorize', {
            method: 'POST',
            body: JSON.stringify({
                onlyUncategorized: true,
                transactionIds: transactionIds
            })
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

    if (typeof inputElementOrEvent === 'object' && inputElementOrEvent.target) {
        const event = inputElementOrEvent;
        event.preventDefault();
        event.stopPropagation();
        transactionId = transactionIdParam;
        inputElement = event.target.closest('button') || event.target.closest('span[onclick]');
    } else {
        inputElement = inputElementOrEvent;
        transactionId = inputElement.getAttribute('data-transaction-id');
    }

    if (transactionId && inputElement) {
        inputElement.setAttribute('data-transaction-id', transactionId);
    }

    currentDropdownInput = inputElement;

    // Use the reusable CategorySelector component
    showCategorySelector({
        triggerElement: inputElement,
        categories: allCategories,
        onSelect: (categoryName) => selectCategory(categoryName)
    });
}

async function selectCategory(categoryName) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');
    if (!transactionId) return;

    // Get the transaction details for rule creation prompt
    const transaction = allTransactions.find(t => t.transaction_id === transactionId);

    closeAllDropdowns();

    // Check if there are multiple transactions selected
    const hasSelectedTransactions = selectedTransactions.size > 0;
    const isCurrentSelected = selectedTransactions.has(transactionId);

    if (hasSelectedTransactions && !isCurrentSelected) {
        // If other transactions are selected but not this one, ask user
        const confirmed = confirm(`Apply category "${categoryName}" to all ${selectedTransactions.size} selected transaction(s)?`);
        if (confirmed) {
            return await bulkUpdateCategory(categoryName);
        }
    } else if (hasSelectedTransactions && isCurrentSelected) {
        // If this transaction is part of the selection, automatically apply to all
        return await bulkUpdateCategory(categoryName);
    }

    // Single transaction update
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ category: categoryName })
        });

        if (result.success) {
            showToast(`Category set to "${categoryName}"`, 'success');

            // Store the transaction and category for potential rule creation
            const merchantName = transaction?.merchant_name || transaction?.description;
            window.lastCategorizedTransaction = {
                merchantName: merchantName,
                category: categoryName
            };

            // Always prompt to create a rule (after a short delay)
            setTimeout(() => {
                promptCreateRule(merchantName, categoryName);
            }, 500);

            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to set category: ${error.message}`, 'error');
        console.error(error);
    }
}

async function bulkUpdateCategory(categoryName) {
    showLoading();

    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: Array.from(selectedTransactions),
                category: categoryName
            })
        });

        if (result.success) {
            showToast(`Updated ${result.updated} transaction(s) to "${categoryName}"`, 'success');
            selectedTransactions.clear();
            updateBulkActionsBar();
            updateSelectAllCheckbox();
            eventBus.emit('transactionsUpdated');
        }
    } catch (error) {
        showToast(`Failed to update categories: ${error.message}`, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function closeAllDropdowns() {
    closeCategorySelector();
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

            // Prompt to create a rule after applying to similar transactions
            if (window.lastCategorizedTransaction) {
                setTimeout(() => {
                    promptCreateRule(window.lastCategorizedTransaction.merchantName, category);
                }, 500);
            }

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

        // Get first batch of suggestions (10 transactions for quick initial display)
        const firstResponse = await fetchAPI('/api/ai/review-all', {
            method: 'POST',
            body: JSON.stringify({
                confidenceThreshold: 100,
                limit: 10,
                offset: 0
            })
        });

        hideLoading();

        if (firstResponse.total_available === 0) {
            showToast('All transactions are already categorized!', 'success');
            return;
        }

        if (firstResponse.suggestions_count === 0 && !firstResponse.has_more) {
            showToast(`Reviewed ${firstResponse.total_reviewed} transactions - no improvements found!`, 'success');
            return;
        }

        // Show modal with first batch and continue loading more in background
        await showReCategorizationReview(
            firstResponse.suggestions,
            firstResponse.total_available,
            firstResponse.offset,
            firstResponse.limit
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
async function showReCategorizationReview(initialSuggestions, totalAvailable, initialOffset, batchLimit) {
    const Modal = (await import('../components/Modal.js')).default;

    // Fetch categories for manual correction
    const categories = await fetchAPI('/api/categories');

    // State management for progressive loading
    let allSuggestions = [...initialSuggestions];
    let currentOffset = initialOffset + batchLimit;
    let isLoadingMore = false;
    let appliedCount = 0;
    let manualCorrections = new Map();

    // Build suggestion item HTML
    function buildSuggestionHTML(sugg, idx) {
        // Build metadata display
        const metadata = [];
        if (sugg.merchant_name) metadata.push(`Merchant: ${escapeHtml(sugg.merchant_name)}`);
        if (sugg.plaid_primary_category) metadata.push(`Plaid: ${escapeHtml(sugg.plaid_primary_category)}${sugg.plaid_detailed_category ? ` → ${escapeHtml(sugg.plaid_detailed_category)}` : ''}`);
        if (sugg.location_city || sugg.location_region) {
            const loc = [sugg.location_city, sugg.location_region].filter(Boolean).join(', ');
            metadata.push(`Location: ${escapeHtml(loc)}`);
        }
        if (sugg.payment_channel) metadata.push(`Channel: ${escapeHtml(sugg.payment_channel)}`);
        if (sugg.transaction_type) metadata.push(`Type: ${escapeHtml(sugg.transaction_type)}`);

        return `
            <div class="suggestion-item" data-transaction-id="${escapeHtml(sugg.transaction_id)}" data-index="${idx}">
                <div class="suggestion-content">
                    <div class="suggestion-details">
                        <div class="suggestion-header">
                            <span class="suggestion-date">${formatDate(sugg.date)}</span>
                            <span class="suggestion-account">${escapeHtml(sugg.account_name || 'Unknown')}</span>
                            <span class="suggestion-amount">${formatCurrency(sugg.amount)}</span>
                        </div>
                        <div class="suggestion-description">${escapeHtml(sugg.description)}</div>

                        ${sugg.amazon_order ? `
                            <div class="suggestion-amazon-badge">
                                <span style="background: #FF9900; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                                    📦 Amazon Order ${escapeHtml(sugg.amazon_order.order_id.substring(0, 12))}... • ${formatCurrency(sugg.amazon_order.total_amount)}
                                </span>
                            </div>
                        ` : ''}

                        ${metadata.length > 0 ? `
                            <div class="suggestion-metadata">
                                ${metadata.map(m => `<span class="metadata-tag">${m}</span>`).join('')}
                            </div>
                        ` : ''}

                        <div class="suggestion-change">
                            <div class="suggestion-from">
                                <span class="label">Current:</span>
                                <span class="category">${escapeHtml(sugg.current_category || 'Uncategorized')}</span>
                                <span class="confidence">${sugg.current_confidence}%</span>
                            </div>
                            <div class="suggestion-arrow">→</div>
                            <div class="suggestion-to">
                                <span class="label">Apply as:</span>
                                <select class="category-selector" data-index="${idx}" data-original="${escapeHtml(sugg.suggested_category)}">
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
                    <div class="suggestion-actions">
                        <button class="btn-apply-single" data-index="${idx}">
                            ✓ Apply
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    const modalContent = `
        <div class="recategorization-review">
            <div class="review-summary" id="review-summary">
                <p><strong>Total to review:</strong> ${totalAvailable} transactions</p>
                <p><strong>Loaded:</strong> <span id="loaded-count">${initialSuggestions.length}</span> suggestions</p>
                <p><strong>Applied:</strong> <span id="applied-count">0</span></p>
                <p style="color: #666; font-size: 0.9em; margin-top: 0.5rem;">
                    Review and apply suggestions individually or in batch. Scroll down to load more.
                </p>
            </div>

            <div class="suggestions-list" id="suggestions-list">
                ${initialSuggestions.map((sugg, idx) => buildSuggestionHTML(sugg, idx)).join('')}
            </div>

            <div id="loading-more" class="loading-more" style="display: none;">
                <div class="spinner"></div>
                <span>Loading more suggestions...</span>
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
                position: sticky;
                top: 0;
                z-index: 10;
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
                transition: all 0.3s;
                background: white;
            }

            .suggestion-item.removing {
                opacity: 0;
                transform: translateX(100px);
                height: 0;
                margin: 0;
                padding: 0;
                border: none;
                overflow: hidden;
            }

            .suggestion-item:hover {
                border-color: #3b82f6;
                box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
            }

            .suggestion-content {
                display: flex;
                gap: 1rem;
                padding: 1rem;
            }

            .suggestion-details {
                flex: 1;
                min-width: 0;
            }

            .suggestion-header {
                display: flex;
                gap: 1rem;
                margin-bottom: 0.5rem;
                flex-wrap: wrap;
                align-items: center;
            }

            .suggestion-date {
                color: #6b7280;
                font-size: 0.875rem;
                font-weight: 500;
            }

            .suggestion-account {
                background: #e0e7ff;
                color: #3730a3;
                padding: 0.125rem 0.5rem;
                border-radius: 3px;
                font-size: 0.75rem;
                font-weight: 500;
            }

            .suggestion-description {
                font-weight: 500;
                margin-bottom: 0.5rem;
                font-size: 0.95rem;
            }

            .suggestion-amazon-badge {
                margin-bottom: 0.5rem;
            }

            .suggestion-metadata {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                margin-bottom: 0.75rem;
            }

            .metadata-tag {
                font-size: 0.75rem;
                padding: 0.25rem 0.5rem;
                background: #f3f4f6;
                color: #4b5563;
                border-radius: 3px;
                border: 1px solid #e5e7eb;
            }

            .suggestion-amount {
                font-weight: 600;
                color: #1f2937;
                margin-left: auto;
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

            .suggestion-actions {
                display: flex;
                flex-direction: column;
                justify-content: center;
            }

            .btn-apply-single {
                padding: 0.5rem 1rem;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.2s;
                white-space: nowrap;
            }

            .btn-apply-single:hover {
                background: #2563eb;
                transform: scale(1.05);
            }

            .btn-apply-single:active {
                transform: scale(0.95);
            }

            .loading-more {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 1rem;
                color: #6b7280;
            }

            .spinner {
                width: 20px;
                height: 20px;
                border: 3px solid #e5e7eb;
                border-top-color: #3b82f6;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        </style>
    `;

    const modal = new Modal({
        id: 'recategorization-review-modal',
        title: '🤖 AI Categorization Review',
        content: modalContent,
        actions: [
            { action: 'cancel', label: 'Close', primary: false },
            { action: 'apply-all', label: 'Apply All Remaining', primary: true }
        ],
        options: { size: 'large' }
    });

    modal.show();

    const modalElement = document.getElementById('recategorization-review-modal');
    const suggestionsList = document.getElementById('suggestions-list');
    const loadingMore = document.getElementById('loading-more');
    const reviewContainer = modalElement.querySelector('.recategorization-review');

    // Helper: Update counts
    function updateCounts() {
        document.getElementById('loaded-count').textContent = allSuggestions.length;
        document.getElementById('applied-count').textContent = appliedCount;
    }

    // Helper: Apply single suggestion
    async function applySuggestion(index) {
        const sugg = allSuggestions[index];
        const item = suggestionsList.querySelector(`[data-index="${index}"]`);

        if (!sugg || !item) return;

        // Get selected category
        const selector = item.querySelector('.category-selector');
        const selectedCategory = selector ? selector.value : sugg.suggested_category;

        const applySugg = { ...sugg, suggested_category: selectedCategory };

        try {
            // Apply the suggestion
            await fetchAPI('/api/ai/apply-suggestions', {
                method: 'POST',
                body: JSON.stringify({ suggestions: [applySugg] })
            });

            // Check if manually corrected and send to learning
            const originalCategory = selector?.dataset.original;
            if (selector && selectedCategory !== originalCategory) {
                await fetchAPI('/api/ai/learn', {
                    method: 'POST',
                    body: JSON.stringify({
                        transaction: {
                            transaction_id: sugg.transaction_id,
                            date: sugg.date,
                            description: sugg.description,
                            merchant_name: sugg.merchant_name,
                            account_name: sugg.account_name,
                            amount: sugg.amount,
                            // Include all transaction metadata for better learning
                            payment_channel: sugg.payment_channel,
                            transaction_type: sugg.transaction_type,
                            plaid_primary_category: sugg.plaid_primary_category,
                            plaid_detailed_category: sugg.plaid_detailed_category,
                            plaid_confidence_level: sugg.plaid_confidence_level,
                            location_city: sugg.location_city,
                            location_region: sugg.location_region,
                            location_address: sugg.location_address,
                            merchant_entity_id: sugg.merchant_entity_id,
                            authorized_datetime: sugg.authorized_datetime,
                            pending: sugg.pending,
                            verified: sugg.verified
                        },
                        userCategory: selectedCategory
                    })
                }).catch(console.error);
            }

            // Remove from DOM with animation
            item.classList.add('removing');
            setTimeout(() => item.remove(), 300);

            // Update counts
            appliedCount++;
            updateCounts();

            // Reload transactions in background
            loadTransactions().catch(console.error);

        } catch (error) {
            showToast('Failed to apply: ' + error.message, 'error');
        }
    }

    // Helper: Load more suggestions
    async function loadMoreSuggestions() {
        if (isLoadingMore || currentOffset >= totalAvailable) return;

        isLoadingMore = true;
        loadingMore.style.display = 'flex';

        try {
            const response = await fetchAPI('/api/ai/review-all', {
                method: 'POST',
                body: JSON.stringify({
                    confidenceThreshold: 100,
                    limit: batchLimit,
                    offset: currentOffset
                })
            });

            if (response.suggestions && response.suggestions.length > 0) {
                // Add new suggestions
                const startIdx = allSuggestions.length;
                allSuggestions = allSuggestions.concat(response.suggestions);

                // Append to DOM
                response.suggestions.forEach((sugg, i) => {
                    const html = buildSuggestionHTML(sugg, startIdx + i);
                    suggestionsList.insertAdjacentHTML('beforeend', html);
                });

                // Attach event listeners to new items
                attachEventListeners(startIdx);

                currentOffset += batchLimit;
                updateCounts();
            }
        } catch (error) {
            console.error('Failed to load more:', error);
            showToast('Failed to load more suggestions', 'error');
        } finally {
            isLoadingMore = false;
            loadingMore.style.display = 'none';
        }
    }

    // Attach event listeners (optionally only to new items from startIdx)
    function attachEventListeners(startIdx = 0) {
        // Individual apply buttons
        const buttons = modalElement.querySelectorAll('.btn-apply-single');
        buttons.forEach(btn => {
            const index = parseInt(btn.dataset.index);
            if (index < startIdx) return; // Skip already attached
            if (btn.hasAttribute('data-listener')) return;
            btn.setAttribute('data-listener', 'true');

            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt(e.target.dataset.index);
                await applySuggestion(idx);
            });
        });

        // Category selector changes
        const selectors = modalElement.querySelectorAll('.category-selector');
        selectors.forEach(selector => {
            const index = parseInt(selector.dataset.index);
            if (index < startIdx) return; // Skip already attached
            if (selector.hasAttribute('data-listener')) return;
            selector.setAttribute('data-listener', 'true');

            selector.addEventListener('change', (e) => {
                const originalCategory = e.target.dataset.original;
                if (e.target.value !== originalCategory) {
                    e.target.classList.add('manual-edit');
                } else {
                    e.target.classList.remove('manual-edit');
                }
            });
        });
    }

    // Initial event listeners
    attachEventListeners();

    // Scroll listener for infinite loading
    if (reviewContainer) {
        reviewContainer.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = reviewContainer;
            if (scrollHeight - scrollTop - clientHeight < 200) {
                loadMoreSuggestions();
            }
        });
    }

    // Apply all remaining button
    eventBus.once(`modal:${modal.id}:apply-all`, async () => {
        const remainingSuggestions = [];

        // Get all remaining items with their selected categories
        modalElement.querySelectorAll('.suggestion-item:not(.removing)').forEach(item => {
            const idx = parseInt(item.dataset.index);
            const sugg = allSuggestions[idx];
            if (!sugg) return;

            const selector = item.querySelector('.category-selector');
            if (selector) {
                remainingSuggestions.push({
                    ...sugg,
                    suggested_category: selector.value
                });
            } else {
                remainingSuggestions.push(sugg);
            }
        });

        if (remainingSuggestions.length === 0) {
            showToast('No suggestions remaining', 'info');
            return;
        }

        showLoading(`Applying ${remainingSuggestions.length} remaining suggestions...`);

        try {
            await fetchAPI('/api/ai/apply-suggestions', {
                method: 'POST',
                body: JSON.stringify({ suggestions: remainingSuggestions })
            });

            hideLoading();
            showToast(`Successfully applied ${remainingSuggestions.length} suggestions!`, 'success');

            modal.close();
            await loadTransactions();
        } catch (error) {
            hideLoading();
            showToast('Failed to apply all: ' + error.message, 'error');
        }
    });

    // Start loading more in background after a short delay
    setTimeout(() => {
        if (currentOffset < totalAvailable) {
            loadMoreSuggestions();
        }
    }, 1000);
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

// ============================================================================
// Amazon Order Details
// ============================================================================

async function showAmazonOrderDetails(orderId) {
    try {
        const Modal = (await import('../components/Modal.js')).default;

        // Fetch order details with items
        const order = await fetchAPI(`/api/amazon/orders/${orderId}`);

        if (!order || !order.items) {
            showToast('Order not found', 'error');
            return;
        }

        // Build items list HTML
        const itemsHtml = order.items.map(item => `
            <div style="padding: 1rem; border-bottom: 1px solid #eee; display: flex; gap: 1rem;">
                ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px;" alt="Product">` : ''}
                <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem;">${escapeHtml(item.title)}</div>
                    ${item.category ? `<div style="font-size: 0.85rem; color: #666; margin-bottom: 0.25rem;">Category: ${escapeHtml(item.category)}</div>` : ''}
                    ${item.seller ? `<div style="font-size: 0.85rem; color: #666; margin-bottom: 0.25rem;">Seller: ${escapeHtml(item.seller)}</div>` : ''}
                    <div style="font-size: 0.85rem; color: #666;">
                        Quantity: ${item.quantity || 1} • Price: ${formatCurrency(item.price)}
                    </div>
                    ${item.return_status ? `<div style="margin-top: 0.5rem; color: #ea580c; font-size: 0.85rem;">⚠️ ${escapeHtml(item.return_status)}</div>` : ''}
                </div>
            </div>
        `).join('');

        const content = `
            <div style="max-height: 70vh; overflow-y: auto;">
                <div style="padding: 1rem; background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="font-weight: 600;">Order ID:</span>
                        <span>${escapeHtml(order.order_id)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="font-weight: 600;">Order Date:</span>
                        <span>${formatDate(order.order_date)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="font-weight: 600;">Total Amount:</span>
                        <span style="font-weight: 700; font-size: 1.1rem; color: #16a34a;">${formatCurrency(order.total_amount)}</span>
                    </div>
                    ${order.subtotal ? `<div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem;">
                        <span>Subtotal:</span>
                        <span>${formatCurrency(order.subtotal)}</span>
                    </div>` : ''}
                    ${order.tax ? `<div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem;">
                        <span>Tax:</span>
                        <span>${formatCurrency(order.tax)}</span>
                    </div>` : ''}
                    ${order.shipping ? `<div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem;">
                        <span>Shipping:</span>
                        <span>${formatCurrency(order.shipping)}</span>
                    </div>` : ''}
                    ${order.payment_method ? `<div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem;">
                        <span>Payment Method:</span>
                        <span>${escapeHtml(order.payment_method)}</span>
                    </div>` : ''}
                    ${order.order_status ? `<div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem;">
                        <span>Status:</span>
                        <span style="color: ${order.order_status.toLowerCase().includes('cancel') ? '#dc2626' : '#16a34a'};">${escapeHtml(order.order_status)}</span>
                    </div>` : ''}
                </div>

                <div style="padding: 1rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                    <h4 style="margin: 0 0 0.5rem 0;">Items (${order.items.length})</h4>
                </div>

                ${itemsHtml}
            </div>
        `;

        const modalId = `amazon-order-${orderId}`;

        const modal = new Modal({
            id: modalId,
            title: '📦 Amazon Order Details',
            content,
            actions: [
                {
                    action: 'debug',
                    label: '🐛 Debug Data',
                    primary: false
                },
                {
                    action: 'close',
                    label: 'Close',
                    primary: false
                }
            ],
            options: { size: 'large' }
        });

        // Handle debug action
        const { eventBus } = await import('../services/eventBus.js');
        eventBus.once(`modal:${modalId}:debug`, () => {
            showAmazonDebugData(order);
        });

        modal.show();
    } catch (error) {
        console.error('Error fetching Amazon order details:', error);
        showToast('Failed to load order details', 'error');
    }
}

async function showAmazonDebugData(order) {
    try {
        const Modal = (await import('../components/Modal.js')).default;

        // Format the raw data for display
        const formatJson = (obj) => JSON.stringify(obj, null, 2);

        const content = `
            <div style="max-height: 70vh; overflow-y: auto;">
                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #374151;">🔍 Raw Order Data</h4>
                    <pre style="background: #1f2937; color: #10b981; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; margin: 0;">${escapeHtml(formatJson({
                        order_id: order.order_id,
                        order_date: order.order_date,
                        total_amount: order.total_amount,
                        subtotal: order.subtotal,
                        tax: order.tax,
                        shipping: order.shipping,
                        payment_method: order.payment_method,
                        shipping_address: order.shipping_address,
                        order_status: order.order_status,
                        account_name: order.account_name,
                        matched_transaction_id: order.matched_transaction_id,
                        match_confidence: order.match_confidence,
                        match_verified: order.match_verified,
                        created_at: order.created_at,
                        updated_at: order.updated_at
                    }))}</pre>
                </div>

                ${order.matched_transaction ? `
                    <div style="margin-bottom: 1.5rem;">
                        <h4 style="margin: 0 0 0.5rem 0; color: #374151;">💳 Matched Transaction Data</h4>
                        <pre style="background: #1f2937; color: #10b981; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; margin: 0;">${escapeHtml(formatJson(order.matched_transaction))}</pre>
                    </div>
                ` : '<div style="margin-bottom: 1.5rem;"><p style="color: #666;">No matched transaction</p></div>'}

                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #374151;">📦 Amazon Items (${order.items?.length || 0})</h4>
                    <pre style="background: #1f2937; color: #10b981; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; margin: 0;">${escapeHtml(formatJson(order.items || []))}</pre>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #374151;">📋 Complete Order Object</h4>
                    <pre style="background: #1f2937; color: #10b981; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; margin: 0;">${escapeHtml(formatJson(order))}</pre>
                </div>

                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 1rem; border-radius: 4px;">
                    <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
                        <strong>💡 Tip:</strong> This is the raw data returned from the database and API.
                        Use this to debug categorization issues or verify data integrity.
                    </p>
                </div>
            </div>
        `;

        const modal = new Modal({
            id: `debug-${order.order_id}`,
            title: '🐛 Debug: Amazon Order Raw Data',
            content,
            actions: [
                {
                    action: 'close',
                    label: 'Close',
                    primary: false
                }
            ],
            options: { size: 'large' }
        });

        modal.show();
    } catch (error) {
        console.error('Error showing debug data:', error);
        showToast('Failed to show debug data', 'error');
    }
}

async function resetAllAmazonMatchings() {
    try {
        const Modal = (await import('../components/Modal.js')).default;
        const { eventBus } = await import('../services/eventBus.js');

        const modalId = `reset-amazon-${Date.now()}`;

        const modal = new Modal({
            id: modalId,
            title: '⚠️ Reset Amazon Matchings',
            content: `
                <p>Are you sure you want to reset all Amazon order matchings?</p>
                <p style="color: #ea580c; margin-top: 1rem;">This will unlink all transactions from Amazon orders. This action cannot be undone.</p>
            `,
            actions: [
                {
                    action: 'cancel',
                    label: 'Cancel',
                    primary: false
                },
                {
                    action: 'confirm',
                    label: 'Reset All',
                    primary: true
                }
            ],
            options: { size: 'small' }
        });

        // Handle confirmation
        eventBus.once(`modal:${modalId}:confirm`, async () => {
            try {
                const result = await fetchAPI('/api/amazon/reset-matchings', {
                    method: 'POST'
                });

                showToast(result.message || 'All Amazon matchings have been reset', 'success');
                await loadTransactions(); // Reload transactions to update display
            } catch (error) {
                showToast('Failed to reset matchings: ' + error.message, 'error');
            }
        });

        modal.show();
    } catch (error) {
        console.error('Error resetting Amazon matchings:', error);
        showToast('Failed to reset matchings', 'error');
    }
}

// ============================================================================
// Rule Creation Functions
// ============================================================================

let rulePreviewTimeout = null;

function promptCreateRule(merchantName, category) {
    if (!merchantName || merchantName === 'Unknown') return;

    // Use a toast notification with action buttons
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast toast-info';
    toast.style.cssText = 'max-width: 500px; padding: 1rem;';

    toast.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <div>
                <strong>Create a rule for ${escapeHtml(merchantName)}</strong>
                <div style="font-size: 0.9rem; margin-top: 0.25rem;">
                    Automatically categorize future transactions from this merchant as "${category}"
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.875rem;" onclick="this.closest('.toast').remove()">
                    Dismiss
                </button>
                <button class="btn btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.875rem;" onclick="this.closest('.toast').remove(); showCreateRuleModal('${escapeHtml(merchantName)}', '${escapeHtml(category)}')">
                    Create Rule
                </button>
            </div>
        </div>
    `;

    toastContainer.appendChild(toast);

    // Auto-remove after 10 seconds
    setTimeout(() => {
        toast.remove();
    }, 10000);
}

function showCreateRuleModal(merchantName, category) {
    const modal = document.getElementById('createRuleModal');
    const nameInput = document.getElementById('ruleNameInput');
    const patternInput = document.getElementById('rulePatternInput');
    const matchTypeSelect = document.getElementById('ruleMatchTypeSelect');
    const categorySelect = document.getElementById('ruleCategorySelect');

    // Prefill the form
    nameInput.value = `Auto-categorize ${merchantName}`;
    patternInput.value = merchantName;
    matchTypeSelect.value = 'exact';

    // Populate category dropdown
    categorySelect.innerHTML = '<option value="">Select category...</option>' +
        allCategories.map(cat => `<option value="${escapeHtml(cat.name)}" ${cat.name === category ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`).join('');

    modal.style.display = 'flex';

    // Trigger initial preview
    updateRulePreview();
}

function closeCreateRuleModal() {
    const modal = document.getElementById('createRuleModal');
    modal.style.display = 'none';

    // Clear form
    document.getElementById('ruleNameInput').value = '';
    document.getElementById('rulePatternInput').value = '';
    document.getElementById('ruleMatchTypeSelect').value = 'exact';
    document.getElementById('ruleCategorySelect').value = '';
    document.getElementById('rulePreviewList').innerHTML = '';
    document.getElementById('rulePreviewCount').textContent = 'Enter a pattern to preview matching transactions';
}

async function updateRulePreview() {
    const patternInput = document.getElementById('rulePatternInput');
    const matchTypeSelect = document.getElementById('ruleMatchTypeSelect');
    const previewLoading = document.getElementById('rulePreviewLoading');
    const previewCount = document.getElementById('rulePreviewCount');
    const previewList = document.getElementById('rulePreviewList');

    const pattern = patternInput.value.trim();
    const matchType = matchTypeSelect.value;

    // Clear previous timeout
    if (rulePreviewTimeout) {
        clearTimeout(rulePreviewTimeout);
    }

    if (!pattern) {
        previewCount.textContent = 'Enter a pattern to preview matching transactions';
        previewList.innerHTML = '';
        return;
    }

    // Debounce the preview update
    rulePreviewTimeout = setTimeout(async () => {
        try {
            previewLoading.style.display = 'block';
            previewCount.textContent = 'Loading...';
            previewList.innerHTML = '';

            const result = await fetchAPI('/api/category-mappings/rules/preview', {
                method: 'POST',
                body: JSON.stringify({ pattern, matchType })
            });

            previewLoading.style.display = 'none';

            if (result.transactions && result.transactions.length > 0) {
                previewCount.innerHTML = `<strong>${result.count}</strong> transaction(s) will match this rule`;
                previewList.innerHTML = result.transactions.slice(0, 10).map(tx => `
                    <div style="padding: 0.5rem; margin-bottom: 0.25rem; background: white; border: 1px solid #e5e7eb; border-radius: 0.25rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
                        <div style="flex: 1;">
                            <div style="font-weight: 500;">${escapeHtml(tx.merchant_name || tx.description)}</div>
                            <div style="color: #666; font-size: 0.8rem;">${formatDate(tx.date)}</div>
                        </div>
                        <div style="font-weight: 500;">${formatCurrency(tx.amount)}</div>
                    </div>
                `).join('');

                if (result.count > 10) {
                    previewList.innerHTML += `<div style="padding: 0.5rem; text-align: center; color: #666; font-size: 0.875rem;">... and ${result.count - 10} more</div>`;
                }
            } else {
                previewCount.textContent = 'No transactions match this pattern';
                previewList.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666;">Try adjusting the pattern or match type</div>';
            }
        } catch (error) {
            previewLoading.style.display = 'none';
            previewCount.textContent = 'Error loading preview';
            previewList.innerHTML = `<div style="padding: 1rem; text-align: center; color: #ef4444;">${escapeHtml(error.message)}</div>`;
        }
    }, 500);
}

async function saveNewRule() {
    const nameInput = document.getElementById('ruleNameInput');
    const patternInput = document.getElementById('rulePatternInput');
    const matchTypeSelect = document.getElementById('ruleMatchTypeSelect');
    const categorySelect = document.getElementById('ruleCategorySelect');

    const name = nameInput.value.trim();
    const pattern = patternInput.value.trim();
    const matchType = matchTypeSelect.value;
    const category = categorySelect.value;

    if (!name || !pattern || !category) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        // First, get all existing rules to check for collisions
        const allRulesResponse = await fetchAPI('/api/category-mappings/rules');
        const allRules = allRulesResponse || [];

        // Find colliding rules (same pattern and match type)
        const collidingRules = allRules.filter(rule =>
            rule.pattern.toLowerCase() === pattern.toLowerCase() &&
            rule.match_type === matchType
        );

        // Get preview of matching transactions before creating the rule
        const previewResult = await fetchAPI('/api/category-mappings/rules/preview', {
            method: 'POST',
            body: JSON.stringify({ pattern, matchType })
        });

        const matchingTransactions = previewResult.transactions || [];

        // Store original categories for undo
        const originalCategories = matchingTransactions.map(tx => ({
            transaction_id: tx.transaction_id,
            category: tx.category,
            confidence: tx.confidence
        }));

        // Delete colliding rules
        const deletedRules = [];
        for (const rule of collidingRules) {
            await fetchAPI(`/api/category-mappings/rules/${rule.id}`, {
                method: 'DELETE'
            });
            deletedRules.push(rule);
        }

        // Create the new rule
        const result = await fetchAPI('/api/category-mappings/rules', {
            method: 'POST',
            body: JSON.stringify({ name, pattern, category, matchType })
        });

        closeCreateRuleModal();

        // Apply the rule to existing matching transactions
        if (matchingTransactions.length > 0) {
            // Update all matching transactions with the new category
            const transactionIds = matchingTransactions.map(tx => tx.transaction_id);
            const bulkUpdateResult = await fetchAPI('/api/transactions/bulk/category', {
                method: 'PATCH',
                body: JSON.stringify({
                    transactionIds,
                    category
                })
            });

            // Reload transactions to reflect changes
            eventBus.emit('transactionsUpdated');

            // Show success toast with undo option
            const message = deletedRules.length > 0
                ? `Rule created (replaced ${deletedRules.length} existing rule(s)) and applied to ${matchingTransactions.length} transaction(s)`
                : `Rule created and applied to ${matchingTransactions.length} transaction(s)`;

            showUndoableToast(
                message,
                async () => {
                    // Undo function: restore original categories and deleted rules
                    await undoRuleApplication(result.id, originalCategories, deletedRules);
                }
            );
        } else {
            const message = deletedRules.length > 0
                ? `Rule created (replaced ${deletedRules.length} existing rule(s))`
                : 'Rule created successfully!';
            showToast(message, 'success');
        }
    } catch (error) {
        showToast(`Failed to create rule: ${error.message}`, 'error');
    }
}

async function undoRuleApplication(ruleId, originalCategories, deletedRules = []) {
    try {
        // Delete the newly created rule
        await fetchAPI(`/api/category-mappings/rules/${ruleId}`, {
            method: 'DELETE'
        });

        // Restore deleted rules (rules that were replaced)
        for (const rule of deletedRules) {
            await fetchAPI('/api/category-mappings/rules', {
                method: 'POST',
                body: JSON.stringify({
                    name: rule.name,
                    pattern: rule.pattern,
                    category: rule.category,
                    matchType: rule.match_type
                })
            });
        }

        // Restore original categories for all affected transactions
        for (const tx of originalCategories) {
            await fetchAPI(`/api/transactions/${tx.transaction_id}/category`, {
                method: 'PATCH',
                body: JSON.stringify({ category: tx.category })
            });
        }

        // Reload transactions
        eventBus.emit('transactionsUpdated');
        showToast('Rule creation undone', 'success');
    } catch (error) {
        showToast(`Failed to undo: ${error.message}`, 'error');
    }
}

function showUndoableToast(message, undoCallback) {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.style.cssText = 'max-width: 500px; padding: 1rem;';

    toast.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
            <div style="flex: 1;">${escapeHtml(message)}</div>
            <button class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.875rem; white-space: nowrap;" onclick="this.closest('.toast').remove()">
                Undo
            </button>
        </div>
    `;

    // Add undo handler
    const undoButton = toast.querySelector('button');
    undoButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        toast.remove();
        await undoCallback();
    });

    toastContainer.appendChild(toast);

    // Auto-remove after 10 seconds
    setTimeout(() => {
        toast.remove();
    }, 10000);
}

// ============================================================================
// Transaction Splitting
// ============================================================================

let currentSplitTransaction = null;
let splitRows = [];

function showSplitModal(transactionId) {
    const transaction = allTransactions.find(tx => tx.transaction_id === transactionId);
    if (!transaction) {
        showToast('Transaction not found', 'error');
        return;
    }

    currentSplitTransaction = transaction;
    splitRows = [];

    // Populate modal with transaction details
    document.getElementById('splitOriginalDescription').textContent = transaction.description || transaction.name;
    document.getElementById('splitOriginalDate').textContent = formatDate(transaction.date);
    document.getElementById('splitOriginalAmount').textContent = formatCurrency(transaction.amount);

    // Initialize with 2 splits at 50% each
    const splitAmount = Math.abs(parseFloat(transaction.amount)) / 2;
    addSplitRow(splitAmount);
    addSplitRow(splitAmount);

    // Show modal
    document.getElementById('splitTransactionModal').style.display = 'flex';

    updateSplitTotals();
}

function closeSplitModal() {
    document.getElementById('splitTransactionModal').style.display = 'none';
    currentSplitTransaction = null;
    splitRows = [];
    document.getElementById('splitItemsContainer').innerHTML = '';
}

function addSplitRow(defaultAmount = null) {
    const index = splitRows.length;
    const amount = defaultAmount !== null ? defaultAmount : 0;
    const percentage = currentSplitTransaction ? (amount / Math.abs(parseFloat(currentSplitTransaction.amount)) * 100).toFixed(2) : 0;

    const splitRow = {
        index,
        amount,
        percentage,
        category: currentSplitTransaction?.category || '',
        description: ''
    };

    splitRows.push(splitRow);
    renderSplitRows();
}

function removeSplitRow(index) {
    if (splitRows.length <= 2) {
        showToast('You must have at least 2 splits', 'error');
        return;
    }
    splitRows.splice(index, 1);
    // Re-index
    splitRows.forEach((row, idx) => {
        row.index = idx;
    });
    renderSplitRows();
}

function renderSplitRows() {
    const container = document.getElementById('splitItemsContainer');
    const originalAmount = Math.abs(parseFloat(currentSplitTransaction.amount));

    container.innerHTML = splitRows.map((split, index) => `
        <div class="split-row" data-index="${index}" style="background: #fff; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <span style="font-weight: 600; color: #666;">Split #${index + 1}</span>
                ${splitRows.length > 2 ? `<button onclick="removeSplitRow(${index})" style="color: #dc2626; background: none; border: none; cursor: pointer; font-size: 1.25rem;">&times;</button>` : ''}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem;">
                <div>
                    <label style="display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem;">Amount</label>
                    <input type="number"
                           step="0.01"
                           value="${split.amount.toFixed(2)}"
                           onchange="updateSplitAmount(${index}, this.value)"
                           style="width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;">
                </div>
                <div>
                    <label style="display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem;">Percentage</label>
                    <input type="number"
                           step="0.01"
                           value="${split.percentage}"
                           onchange="updateSplitPercentage(${index}, this.value)"
                           style="width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;">
                </div>
            </div>

            <div style="margin-bottom: 0.75rem;">
                <label style="display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem;">Category</label>
                <select onchange="updateSplitCategory(${index}, this.value)"
                        style="width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;">
                    <option value="">Select category...</option>
                    ${allCategories.map(cat =>
                        `<option value="${escapeHtml(cat.name)}" ${cat.name === split.category ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
                    ).join('')}
                </select>
            </div>

            <div>
                <label style="display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem;">Description (optional)</label>
                <input type="text"
                       value="${escapeHtml(split.description)}"
                       onchange="updateSplitDescription(${index}, this.value)"
                       placeholder="e.g., Groceries portion"
                       style="width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;">
            </div>
        </div>
    `).join('');

    updateSplitTotals();
}

function updateSplitAmount(index, value) {
    const amount = parseFloat(value) || 0;
    const originalAmount = Math.abs(parseFloat(currentSplitTransaction.amount));
    const percentage = (amount / originalAmount * 100).toFixed(2);

    splitRows[index].amount = amount;
    splitRows[index].percentage = percentage;

    updateSplitTotals();
}

function updateSplitPercentage(index, value) {
    const percentage = parseFloat(value) || 0;
    const originalAmount = Math.abs(parseFloat(currentSplitTransaction.amount));
    const amount = (originalAmount * percentage / 100).toFixed(2);

    splitRows[index].percentage = percentage;
    splitRows[index].amount = parseFloat(amount);

    renderSplitRows();
}

function updateSplitCategory(index, category) {
    splitRows[index].category = category;
}

function updateSplitDescription(index, description) {
    splitRows[index].description = description;
}

function updateSplitTotals() {
    const originalAmount = Math.abs(parseFloat(currentSplitTransaction.amount));
    const total = sumBy(splitRows, 'amount');
    const difference = Math.abs(total - originalAmount);

    document.getElementById('splitTotalAmount').textContent = formatCurrency(total);

    const warningDiv = document.getElementById('splitTotalWarning');
    const differenceText = document.getElementById('splitDifferenceText');
    const saveBtn = document.getElementById('saveSplitsBtn');

    if (difference < 0.01) {
        warningDiv.style.background = '#d1fae5';
        warningDiv.style.borderColor = '#10b981';
        differenceText.textContent = '✓ Total matches original amount';
        differenceText.style.color = '#059669';
        saveBtn.disabled = false;
    } else {
        warningDiv.style.background = '#fef3c7';
        warningDiv.style.borderColor = '#fbbf24';
        differenceText.textContent = `⚠ Difference: ${formatCurrency(difference)}`;
        differenceText.style.color = '#dc2626';
        saveBtn.disabled = true;
    }
}

async function saveSplits() {
    if (!currentSplitTransaction) {
        showToast('No transaction selected', 'error');
        return;
    }

    // Validate splits
    const originalAmount = Math.abs(parseFloat(currentSplitTransaction.amount));
    const total = sumBy(splitRows, 'amount');
    const difference = Math.abs(total - originalAmount);

    if (difference >= 0.01) {
        showToast('Split amounts must equal the original amount', 'error');
        return;
    }

    // Check all splits have categories
    const missingCategory = splitRows.some(split => !split.category);
    if (missingCategory) {
        showToast('All splits must have a category', 'error');
        return;
    }

    try {
        // Prepare splits data
        const isNegative = parseFloat(currentSplitTransaction.amount) < 0;
        const splits = splitRows.map(split => ({
            amount: isNegative ? -Math.abs(parseFloat(split.amount)) : Math.abs(parseFloat(split.amount)),
            category: split.category,
            description: split.description || null,
            source: 'manual'
        }));

        // Save via API
        const result = await fetchAPI(`/api/transactions/${currentSplitTransaction.transaction_id}/splits`, {
            method: 'POST',
            body: JSON.stringify({ splits })
        });

        showToast(`Transaction split into ${splits.length} parts`, 'success');
        closeSplitModal();

        // Reload transactions to reflect changes
        await loadTransactions();
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast(`Failed to split transaction: ${error.message}`, 'error');
    }
}

async function unsplitTransaction(transactionId) {
    if (!confirm('Remove all splits and restore the original transaction?')) {
        return;
    }

    try {
        await fetchAPI(`/api/transactions/${transactionId}/splits`, {
            method: 'DELETE'
        });

        showToast('Transaction splits removed', 'success');
        await loadTransactions();
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast(`Failed to unsplit transaction: ${error.message}`, 'error');
    }
}

// Expose functions globally for onclick handlers
window.aiAutoCategorizeUncategorized = aiAutoCategorizeUncategorized;
window.aiSuggestCategory = aiSuggestCategory;
window.showAmazonOrderDetails = showAmazonOrderDetails;
window.resetAllAmazonMatchings = resetAllAmazonMatchings;
window.showCreateRuleModal = showCreateRuleModal;
window.closeCreateRuleModal = closeCreateRuleModal;
window.updateRulePreview = updateRulePreview;
window.saveNewRule = saveNewRule;
window.showSplitModal = showSplitModal;
window.closeSplitModal = closeSplitModal;
window.addSplitRow = addSplitRow;
window.removeSplitRow = removeSplitRow;
window.updateSplitAmount = updateSplitAmount;
window.updateSplitPercentage = updateSplitPercentage;
window.updateSplitCategory = updateSplitCategory;
window.updateSplitDescription = updateSplitDescription;
window.saveSplits = saveSplits;
window.unsplitTransaction = unsplitTransaction;

// Export module
export default {
    initializeTransactionsPage,
    loadTransactions
};
