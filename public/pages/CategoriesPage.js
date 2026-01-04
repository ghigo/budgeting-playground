/**
 * CategoriesPage Module
 * Handles all categories page functionality including category management and spending charts
 */

import { formatCurrency, escapeHtml, renderCategoryBadge, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { eventBus } from '../services/eventBus.js';

// Module state
let categorySpendingChartInstance = null;
let allCategories = [];
let currentEditingCategory = null;

// Dependencies (injected)
let fetchAPI = null;
let navigateTo = null;
let applyTransactionFilters = null;

export function initializeCategoriesPage(deps) {
    fetchAPI = deps.fetchAPI;
    navigateTo = deps.navigateTo;
    applyTransactionFilters = deps.applyTransactionFilters;

    // Expose functions globally for onclick handlers
    window.editCategory = editCategory;
    window.saveEditCategory = saveEditCategory;
    window.closeEditCategoryModal = closeEditCategoryModal;
    window.deleteCategory = deleteCategory;
    window.addCategory = addCategory;
    window.viewCategoryTransactions = viewCategoryTransactions;
    window.generateEmojiSuggestions = generateEmojiSuggestions;
    window.selectSuggestedEmoji = selectSuggestedEmoji;

    // Close edit category modal on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('editCategoryModal');
            if (modal && modal.style.display === 'flex') {
                closeEditCategoryModal();
            }
        }
    });
}

export async function loadCategories() {
    showLoading();
    try {
        const [categories, spending] = await Promise.all([
            fetchAPI('/api/categories'),
            fetchAPI('/api/categories/spending')
        ]);

        // Store categories globally for use in edit modal
        allCategories = categories;

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
    const descriptionInput = document.getElementById('newCategoryDescription');

    const name = nameInput.value.trim();
    const parent = parentSelect.value;
    const description = descriptionInput.value.trim();

    if (!name) {
        showToast('Please enter a category name', 'error');
        return;
    }

    try {
        await fetchAPI('/api/categories', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                parent_category: parent || null,
                description: description
            })
        });

        showToast('Category added successfully', 'success');
        nameInput.value = '';
        parentSelect.value = '';
        descriptionInput.value = '';

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
    } catch (error) {
        showToast('Failed to add category: ' + error.message, 'error');
        console.error(error);
    }
}

function editCategory(categoryName, parentCategory, icon = '📁', color = '#6B7280', description = '') {
    currentEditingCategory = categoryName;

    // Find the full category object to get description
    const category = allCategories.find(cat => cat.name === categoryName);
    const categoryDescription = category?.description || description || '';

    // Populate modal fields
    document.getElementById('editCategoryName').value = categoryName;
    document.getElementById('editCategoryIcon').value = icon || '📁';
    document.getElementById('editCategoryColor').value = color || '#6B7280';
    document.getElementById('editCategoryDescription').value = categoryDescription;

    // Hide emoji suggestions from previous session
    const emojiSuggestionsDiv = document.getElementById('emojiSuggestions');
    if (emojiSuggestionsDiv) {
        emojiSuggestionsDiv.style.display = 'none';
    }

    // Reset suggested emojis
    suggestedEmojis = [];

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

    // Hide emoji suggestions
    const emojiSuggestionsDiv = document.getElementById('emojiSuggestions');
    if (emojiSuggestionsDiv) {
        emojiSuggestionsDiv.style.display = 'none';
    }

    // Reset suggested emojis
    suggestedEmojis = [];
}

async function saveEditCategory() {
    const newName = document.getElementById('editCategoryName').value.trim();
    const newParent = document.getElementById('editCategoryParent').value;
    const newIcon = document.getElementById('editCategoryIcon').value.trim() || '📁';
    const newColor = document.getElementById('editCategoryColor').value || '#6B7280';
    const newDescription = document.getElementById('editCategoryDescription').value.trim();

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
                color: newColor,
                description: newDescription
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

let suggestedEmojis = [];

async function generateEmojiSuggestions() {
    const categoryName = document.getElementById('editCategoryName').value.trim();
    const categoryDescription = document.getElementById('editCategoryDescription').value.trim();

    if (!categoryName) {
        showToast('Please enter a category name first', 'info');
        return;
    }

    const emojiSuggestionsDiv = document.getElementById('emojiSuggestions');
    const buttons = emojiSuggestionsDiv.querySelectorAll('.emoji-suggestion-btn');

    // Show loading state
    buttons.forEach(btn => {
        btn.textContent = '⏳';
        btn.disabled = true;
    });
    emojiSuggestionsDiv.style.display = 'block';

    try {
        const result = await fetchAPI('/api/categories/suggest-emojis', {
            method: 'POST',
            body: JSON.stringify({
                name: categoryName,
                description: categoryDescription,
                count: 3
            })
        });

        suggestedEmojis = result.emojis || [];

        // Update buttons with suggestions
        suggestedEmojis.forEach((emoji, index) => {
            if (buttons[index]) {
                buttons[index].textContent = emoji;
                buttons[index].disabled = false;
            }
        });
    } catch (error) {
        console.error('Error generating emoji suggestions:', error);
        showToast('Failed to generate emoji suggestions', 'error');
        emojiSuggestionsDiv.style.display = 'none';
    }
}

function selectSuggestedEmoji(index) {
    if (suggestedEmojis[index]) {
        document.getElementById('editCategoryIcon').value = suggestedEmojis[index];

        // Highlight selected button
        const buttons = document.querySelectorAll('.emoji-suggestion-btn');
        buttons.forEach((btn, i) => {
            if (i === index) {
                btn.style.borderColor = '#3B82F6';
                btn.style.background = '#EFF6FF';
            } else {
                btn.style.borderColor = '#e5e7eb';
                btn.style.background = 'white';
            }
        });
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

export default {
    initializeCategoriesPage,
    loadCategories
};
