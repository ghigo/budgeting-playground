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

/**
 * Create a generic badge with consistent styling
 * @param {string} text - Badge text
 * @param {Object} options - Options { color, background, size, icon, title }
 * @returns {string} HTML for badge
 */
export function createBadge(text, options = {}) {
    const {
        color = 'white',
        background = '#6B7280',
        size = 'medium',
        icon = null,
        title = null,
        style = {}
    } = options;

    // Size presets
    const sizes = {
        small: 'padding: 0.2rem 0.5rem; font-size: 0.75rem;',
        medium: 'padding: 0.25rem 0.75rem; font-size: 0.85rem;',
        large: 'padding: 0.5rem 1rem; font-size: 1rem;'
    };

    const sizeStyle = sizes[size] || sizes.medium;
    const titleAttr = title ? `title="${escapeHtml(title)}"` : '';
    const iconHtml = icon ? `${icon} ` : '';

    // Merge custom styles
    const customStyles = Object.entries(style)
        .map(([key, value]) => `${key}: ${value};`)
        .join(' ');

    return `
        <span ${titleAttr} style="
            display: inline-block;
            color: ${color};
            background: ${background};
            ${sizeStyle}
            border-radius: 12px;
            font-weight: 600;
            white-space: nowrap;
            ${customStyles}
        ">${iconHtml}${escapeHtml(text)}</span>
    `;
}

/**
 * Create a confidence badge with color-coded confidence levels
 * @param {number} confidence - Confidence percentage (0-100)
 * @param {boolean} isVerified - Whether the item is verified
 * @returns {string} HTML for confidence badge
 */
export function createConfidenceBadge(confidence, isVerified = false) {
    if (!confidence || confidence === 0) {
        return '';
    }

    // Determine color based on confidence or verification status
    let background;
    if (isVerified || confidence === 100) {
        background = '#2563eb'; // blue
    } else if (confidence >= 85) {
        background = '#16a34a'; // green
    } else if (confidence >= 70) {
        background = '#ca8a04'; // amber
    } else if (confidence >= 50) {
        background = '#ea580c'; // orange
    } else {
        background = '#dc2626'; // red
    }

    return createBadge(`${confidence}%`, {
        background,
        color: 'white',
        size: 'small',
        title: `Confidence: ${confidence}%`
    });
}

/**
 * Create a status badge (enabled/disabled, active/inactive, etc.)
 * @param {boolean} isActive - Whether status is active
 * @param {Object} options - Options { activeText, inactiveText, activeColor, inactiveColor }
 * @returns {string} HTML for status badge
 */
export function createStatusBadge(isActive, options = {}) {
    const {
        activeText = 'Enabled',
        inactiveText = 'Disabled',
        activeColor = 'var(--success)',
        inactiveColor = 'var(--text-secondary)',
        activeBg = 'var(--success-light)',
        inactiveBg = 'var(--bg-secondary)'
    } = options;

    return createBadge(
        isActive ? activeText : inactiveText,
        {
            color: isActive ? activeColor : inactiveColor,
            background: isActive ? activeBg : inactiveBg,
            size: 'medium'
        }
    );
}

/**
 * Create a button with consistent styling
 * @param {string} label - Button text
 * @param {string} onClick - onClick handler
 * @param {Object} options - Options { variant, size, icon, title, disabled }
 * @returns {string} HTML for button
 */
export function createButton(label, onClick, options = {}) {
    const {
        variant = 'primary',
        size = 'medium',
        icon = null,
        title = null,
        disabled = false
    } = options;

    // Variant styles
    const variants = {
        primary: 'background: #3B82F6; color: white;',
        secondary: 'background: #6B7280; color: white;',
        success: 'background: #10B981; color: white;',
        warning: 'background: #F59E0B; color: white;',
        danger: 'background: #EF4444; color: white;',
        info: 'background: #0EA5E9; color: white;'
    };

    // Size styles
    const sizes = {
        small: 'padding: 0.2rem 0.5rem; font-size: 0.75rem;',
        medium: 'padding: 0.4rem 0.75rem; font-size: 0.875rem;',
        large: 'padding: 0.6rem 1rem; font-size: 1rem;'
    };

    const variantStyle = variants[variant] || variants.primary;
    const sizeStyle = sizes[size] || sizes.medium;
    const titleAttr = title ? `title="${escapeHtml(title)}"` : '';
    const iconHtml = icon ? `${icon} ` : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const disabledStyle = disabled ? 'opacity: 0.5; cursor: not-allowed;' : 'cursor: pointer;';

    return `
        <button
            onclick="${onClick}"
            ${titleAttr}
            ${disabledAttr}
            style="
                ${variantStyle}
                ${sizeStyle}
                ${disabledStyle}
                border: none;
                border-radius: 4px;
                font-weight: 500;
            "
        >${iconHtml}${escapeHtml(label)}</button>
    `;
}

/**
 * Render unified category control (category badge/input, confidence badge, verify button)
 * This is the standard UI component for displaying and editing categories across the entire app
 * Replicates the TransactionsPage pattern: clickable category, separate confidence %, verify checkbox
 *
 * @param {Object} options - Configuration object
 * @param {string} options.itemId - ID of the item (transaction_id or item.id)
 * @param {string} options.category - Current category name
 * @param {number} options.confidence - Confidence percentage (0-100)
 * @param {boolean} options.isVerified - Whether category is verified
 * @param {Array} options.allCategories - Array of all categories for badge rendering
 * @param {string} options.onCategoryClick - onclick handler for category badge/input
 * @param {string} options.onVerify - onclick handler for verify button
 * @param {string} options.onUnverify - onclick handler for unverify button
 * @param {string} options.itemType - Type of item ('transaction' or 'amazon-item')
 * @returns {string} HTML for complete category control UI
 */
export function renderCategoryControl(options) {
    const {
        itemId,
        category,
        confidence = 0,
        isVerified = false,
        allCategories = [],
        onCategoryClick,
        onVerify,
        onUnverify,
        itemType = 'transaction'
    } = options;

    const hasCategory = category && category.length > 0;

    // Build category display (badge or input)
    let categoryDisplay;
    if (hasCategory) {
        // Show clickable category badge
        const categoryObj = allCategories.find(c => c.name === category);
        const badgeHtml = categoryObj
            ? renderCategoryBadge(categoryObj, { inline: true })
            : `<span class="category-badge" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                <span>📁</span>
                <span>${escapeHtml(category)}</span>
            </span>`;
        categoryDisplay = `<span onclick="${onCategoryClick}" style="cursor: pointer;" title="Click to change category">${badgeHtml}</span>`;
    } else {
        // Show input field for uncategorized items
        categoryDisplay = `<div class="searchable-dropdown-container" style="position: relative; flex: 1;">
            <input type="text"
                   class="category-input ${isVerified ? 'verified' : ''}"
                   data-${itemType}-id="${itemId}"
                   value="${escapeHtml(category || '')}"
                   placeholder="Select category..."
                   readonly
                   onclick="${onCategoryClick}"
                   autocomplete="off">
        </div>`;
    }

    // Build confidence badge (separate from category, positioned to the right)
    const confidenceBadge = createConfidenceBadge(confidence, isVerified);

    // Build verify button (checkbox style with ✓)
    let verifyButton = '';
    if (isVerified) {
        verifyButton = `<button class="verify-btn verified" onclick="${onUnverify}" title="Click to unverify">✓</button>`;
    } else if (hasCategory) {
        verifyButton = `<button class="verify-btn" onclick="${onVerify}" title="Verify auto-assigned category">✓</button>`;
    }

    // Return complete category control UI (matching TransactionsPage layout)
    return `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${categoryDisplay}
            ${confidenceBadge}
            ${verifyButton}
        </div>
    `;
}
