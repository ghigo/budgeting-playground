/**
 * Utility functions for formatting data
 */

/**
 * Format number as currency
 * @param {number|string} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '$0.00';

    const formatted = Math.abs(num).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
    });

    return num < 0 ? `-${formatted}` : formatted;
}

/**
 * Format date in relative format (e.g., "2 days ago", "yesterday")
 * @param {string} dateString - ISO date string
 * @returns {string} Relative date string
 */
export function formatRelativeDate(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();

    // Get the difference in milliseconds
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    // Future dates
    if (diffMs < 0) {
        const absDays = Math.abs(diffDays);
        const absWeeks = Math.abs(diffWeeks);
        const absMonths = Math.abs(diffMonths);
        const absYears = Math.abs(diffYears);

        if (absDays === 0) return 'today';
        if (absDays === 1) return 'tomorrow';
        if (absDays < 7) return `in ${absDays} days`;
        if (absWeeks < 4) return `in ${absWeeks} week${absWeeks > 1 ? 's' : ''}`;
        if (absMonths < 12) return `in ${absMonths} month${absMonths > 1 ? 's' : ''}`;
        return `in ${absYears} year${absYears > 1 ? 's' : ''}`;
    }

    // Past dates
    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
    if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
}

/**
 * Format date string to readable format
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "Jan 15, 2024" or "2 days ago" depending on settings)
 */
export function formatDate(dateString) {
    if (!dateString) return '';

    // Check if relative dates are enabled
    const useRelativeDates = window.appSettings?.use_relative_dates || false;

    if (useRelativeDates) {
        return formatRelativeDate(dateString);
    }

    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} HTML-safe text
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Render a category badge with icon and color
 * @param {Object} category - Category object with name, icon, color
 * @param {Object} options - Display options
 * @returns {string} HTML string for badge
 */
export function renderCategoryBadge(category, options = {}) {
    const { showIcon = true, inline = false } = options;
    const icon = category.icon || '📁';
    const color = category.color || '#6B7280';
    const name = category.name;

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

/**
 * Get appropriate text color (white or black) based on background color
 * @param {string} hexColor - Hex color code
 * @returns {string} '#FFFFFF' or '#000000'
 */
export function getContrastColor(hexColor) {
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

/**
 * Show loading overlay
 */
export function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

/**
 * Create a category dropdown (select element) HTML
 * @param {Object} options - Configuration options
 * @param {string} options.id - ID for the select element
 * @param {Array} options.categories - Array of category objects {name, ...}
 * @param {string} options.placeholder - Placeholder text (default: "Select category...")
 * @param {string} options.onchange - onchange handler function name
 * @param {string} options.selectedCategory - Currently selected category name
 * @param {string} options.size - Size variant: 'small' (default) or 'normal'
 * @param {Object} options.extraStyles - Additional inline styles
 * @returns {string} HTML string for select element
 */
export function createCategoryDropdown(options = {}) {
    const {
        id = '',
        categories = [],
        placeholder = 'Select category...',
        onchange = '',
        selectedCategory = '',
        size = 'small',
        extraStyles = {}
    } = options;

    // Base styles for consistent appearance
    const baseStyles = {
        padding: size === 'small' ? '0.2rem 0.4rem' : '0.5rem',
        borderRadius: '4px',
        fontSize: size === 'small' ? '0.75rem' : '1rem',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        ...extraStyles
    };

    const styleString = Object.entries(baseStyles)
        .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
        .join('; ');

    const idAttr = id ? `id="${id}"` : '';
    const onchangeAttr = onchange ? `onchange="${onchange}"` : '';

    const optionsHtml = categories
        .map(cat => {
            const selected = cat.name === selectedCategory ? 'selected' : '';
            return `<option value="${escapeHtml(cat.name)}" ${selected}>${escapeHtml(cat.name)}</option>`;
        })
        .join('');

    return `
        <select ${idAttr} ${onchangeAttr} style="${styleString}">
            <option value="">${escapeHtml(placeholder)}</option>
            ${optionsHtml}
        </select>
    `;
}

/**
 * Populate an existing category dropdown with categories
 * @param {HTMLSelectElement} selectElement - The select element to populate
 * @param {Array} categories - Array of category objects {name, ...}
 * @param {string} placeholder - Placeholder text (default: "Select category...")
 * @param {string} selectedCategory - Currently selected category name
 */
export function populateCategoryDropdown(selectElement, categories, placeholder = 'Select category...', selectedCategory = '') {
    if (!selectElement) return;

    selectElement.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
        categories.map(cat => {
            const selected = cat.name === selectedCategory ? 'selected' : '';
            return `<option value="${escapeHtml(cat.name)}" ${selected}>${escapeHtml(cat.name)}</option>`;
        }).join('');
}
