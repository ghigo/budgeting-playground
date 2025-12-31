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
 * Format date string to readable format
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "Jan 15, 2024")
 */
export function formatDate(dateString) {
    if (!dateString) return '';
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
