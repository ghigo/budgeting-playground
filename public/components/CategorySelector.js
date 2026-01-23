/**
 * CategorySelector Component
 * A reusable searchable category dropdown with icons and hierarchy
 */

import { escapeHtml } from '../utils/formatters.js';

let currentDropdown = null;
let currentTriggerElement = null;
let currentCallback = null;

/**
 * Show the category selector dropdown
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.triggerElement - Element that triggered the dropdown
 * @param {Array} options.categories - Array of category objects {name, icon, parent_category}
 * @param {Function} options.onSelect - Callback when category is selected (categoryName) => void
 * @param {string} options.currentCategory - Currently selected category (optional)
 */
export function showCategorySelector(options) {
    console.log('[CategorySelector] showCategorySelector called', options);

    const {
        triggerElement,
        categories,
        onSelect,
        currentCategory = null
    } = options;

    if (!triggerElement) {
        console.error('[CategorySelector] No trigger element provided');
        return;
    }

    if (!categories || categories.length === 0) {
        console.warn('[CategorySelector] No categories provided');
    }

    // Close any existing dropdown
    closeCategorySelector();

    currentTriggerElement = triggerElement;
    currentCallback = onSelect;

    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'category-dropdown';
    dropdown.id = 'category-selector-dropdown';

    dropdown.innerHTML = `
        <div class="category-dropdown-search">
            <input type="text"
                   class="category-search-input"
                   placeholder="Search categories..."
                   oninput="window.filterCategorySelector(this.value)"
                   autofocus>
        </div>
        <div class="category-dropdown-list" id="category-selector-list">
            ${buildCategoryList(categories, '')}
        </div>
    `;

    document.body.appendChild(dropdown);
    currentDropdown = dropdown;

    // Position the dropdown
    positionDropdown(triggerElement, dropdown);

    // Auto-focus search input
    setTimeout(() => {
        const searchInput = dropdown.querySelector('.category-search-input');
        if (searchInput) searchInput.focus();
    }, 10);

    // Store categories for filtering
    dropdown._categories = categories;

    // Close dropdown when clicking outside
    // Delay registration to avoid catching the same click that opened it
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 100);
}

/**
 * Close the category selector dropdown
 */
export function closeCategorySelector() {
    if (currentDropdown) {
        currentDropdown.remove();
        currentDropdown = null;
        currentTriggerElement = null;
        currentCallback = null;
        document.removeEventListener('click', handleOutsideClick);
    }
}

/**
 * Escape string for use in JavaScript string literal (inside onclick, etc.)
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeForJS(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
}

/**
 * Build the category list HTML
 * @param {Array} categories - Array of category objects
 * @param {string} searchTerm - Search filter term
 * @returns {string} HTML string
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

    // Separate top-level and child categories
    const topLevel = filtered.filter(cat => !cat.parent_category || cat.parent_category === '');
    const withParent = filtered.filter(cat => cat.parent_category && cat.parent_category !== '');

    const html = [];

    // Render top-level categories
    topLevel.forEach(cat => {
        html.push(`
            <div class="category-dropdown-item" onclick="window.selectCategoryFromSelector('${escapeForJS(cat.name)}')">
                <span class="category-name" style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.1rem;">${cat.icon || '📁'}</span>
                    <span>${escapeHtml(cat.name)}</span>
                </span>
            </div>
        `);
    });

    // Group child categories by parent
    const parentGroups = {};
    withParent.forEach(cat => {
        if (!parentGroups[cat.parent_category]) {
            parentGroups[cat.parent_category] = [];
        }
        parentGroups[cat.parent_category].push(cat);
    });

    // Render grouped child categories
    Object.keys(parentGroups).sort().forEach(parent => {
        html.push(`<div class="category-dropdown-group-label">${escapeHtml(parent)}</div>`);
        parentGroups[parent].forEach(cat => {
            html.push(`
                <div class="category-dropdown-item indented" onclick="window.selectCategoryFromSelector('${escapeForJS(cat.name)}')">
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

/**
 * Filter the category list by search term
 * @param {string} searchTerm - Search filter term
 */
function filterCategoryList(searchTerm) {
    if (!currentDropdown) return;

    const categories = currentDropdown._categories || [];
    const listContainer = document.getElementById('category-selector-list');

    if (listContainer) {
        listContainer.innerHTML = buildCategoryList(categories, searchTerm);
    }
}

/**
 * Handle category selection
 * @param {string} categoryName - Selected category name
 */
function selectCategory(categoryName) {
    if (currentCallback) {
        currentCallback(categoryName);
    }
    closeCategorySelector();
}

/**
 * Position the dropdown relative to trigger element
 * @param {HTMLElement} triggerElement - Element that triggered dropdown
 * @param {HTMLElement} dropdown - Dropdown element to position
 */
function positionDropdown(triggerElement, dropdown) {
    const rect = triggerElement.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = '250px';
    dropdown.style.maxWidth = '400px';
    dropdown.style.zIndex = '10000';
}

/**
 * Handle clicks outside the dropdown
 * @param {Event} event - Click event
 */
function handleOutsideClick(event) {
    if (currentDropdown && !currentDropdown.contains(event.target) &&
        currentTriggerElement && !currentTriggerElement.contains(event.target)) {
        closeCategorySelector();
    }
}

// Expose functions globally for onclick handlers
console.log('[CategorySelector] Initializing global functions');
window.filterCategorySelector = filterCategoryList;
window.selectCategoryFromSelector = selectCategory;
window.closeCategorySelector = closeCategorySelector;
console.log('[CategorySelector] Global functions initialized:', {
    filterCategorySelector: typeof window.filterCategorySelector,
    selectCategoryFromSelector: typeof window.selectCategoryFromSelector,
    closeCategorySelector: typeof window.closeCategorySelector
});
