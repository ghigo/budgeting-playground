/**
 * Helper Utilities
 * Common utility functions for the application
 */

/**
 * Debounce function - delays execution until after wait period of no calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - limits execution to once per wait period
 * @param {Function} func - Function to throttle
 * @param {number} wait - Milliseconds to wait between calls
 * @returns {Function} Throttled function
 */
export function throttle(func, wait = 300) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, wait);
        }
    };
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));

    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}

/**
 * Group array of objects by key
 * @param {Array} array - Array to group
 * @param {string|Function} key - Key to group by (property name or function)
 * @returns {Object} Grouped object
 */
export function groupBy(array, key) {
    return array.reduce((result, item) => {
        const groupKey = typeof key === 'function' ? key(item) : item[key];
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {});
}

/**
 * Sort array of objects by key
 * @param {Array} array - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} order - 'asc' or 'desc' (default: 'asc')
 * @returns {Array} Sorted array
 */
export function sortBy(array, key, order = 'asc') {
    return [...array].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];

        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, empty object)
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
export function isEmpty(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Generate unique ID
 * @param {string} prefix - Optional prefix
 * @returns {string} Unique ID
 */
export function uniqueId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Safe JSON parse with fallback
 * @param {string} str - JSON string
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed value or fallback
 */
export function safeParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

/**
 * Wait for specified milliseconds
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after ms
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms (default: 1000)
 * @returns {Promise} Result of function or throws last error
 */
export async function retry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries) {
                const delay = baseDelay * Math.pow(2, i);
                await sleep(delay);
            }
        }
    }

    throw lastError;
}

/**
 * Wrap async function with loading state and error handling
 * Eliminates need for repetitive try/catch/finally blocks
 * @param {Function} asyncFn - Async function to execute
 * @param {string} errorMessage - Base error message (default: 'Operation failed')
 * @param {Object} options - Options { showLoading: true, showToast: true }
 * @returns {Promise} Result of asyncFn
 */
export async function withLoadingState(asyncFn, errorMessage = 'Operation failed', options = {}) {
    const { showLoading: shouldShowLoading = true, showToast: shouldShowToast = true } = options;

    // Import utilities dynamically to avoid circular dependencies
    const { showLoading, hideLoading } = await import('./formatters.js');
    const { showToast } = await import('../services/toast.js');

    if (shouldShowLoading) showLoading();

    try {
        return await asyncFn();
    } catch (error) {
        if (shouldShowToast) {
            showToast(`${errorMessage}: ${error.message}`, 'error');
        }
        console.error(errorMessage, error);
        throw error;
    } finally {
        if (shouldShowLoading) hideLoading();
    }
}

/**
 * Render generic table from data
 * @param {string} containerId - ID of container element
 * @param {Array} data - Array of objects to display
 * @param {Array} columns - Column definitions [{ key, label, render, align }]
 * @param {Object} options - Options { sortKey, sortOrder, emptyMessage, rowClass }
 * @returns {void}
 */
export function renderTable(containerId, data, columns, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`Container #${containerId} not found`);
        return;
    }

    const {
        sortKey = null,
        sortOrder = 'asc',
        emptyMessage = 'No data available',
        rowClass = null
    } = options;

    // Handle empty state
    if (!data || data.length === 0) {
        container.innerHTML = `<p style="color: var(--text-secondary); font-style: italic; padding: 1rem;">${emptyMessage}</p>`;
        return;
    }

    // Sort data if sortKey provided
    const sortedData = sortKey ? sortBy(data, sortKey, sortOrder) : data;

    // Build table HTML
    const html = `
        <div class="table-container">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        ${columns.map(col => `
                            <th style="text-align: ${col.align || 'left'}; padding: 0.75rem; font-weight: 600;">
                                ${col.label}
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${sortedData.map((item, index) => {
                        const rowClasses = typeof rowClass === 'function' ? rowClass(item, index) : rowClass || '';
                        return `
                            <tr class="${rowClasses}" style="border-bottom: 1px solid var(--border);">
                                ${columns.map(col => {
                                    const value = col.render ? col.render(item) : item[col.key];
                                    return `
                                        <td style="text-align: ${col.align || 'left'}; padding: 0.75rem;">
                                            ${value !== null && value !== undefined ? value : '—'}
                                        </td>
                                    `;
                                }).join('')}
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Create empty state HTML
 * @param {string} message - Message to display
 * @param {Object} action - Optional action { label, onClick }
 * @returns {string} HTML for empty state
 */
export function createEmptyState(message, action = null) {
    const actionHtml = action
        ? `<button onclick="${action.onClick}" class="btn btn-primary" style="margin-top: 1rem;">${action.label}</button>`
        : '';

    return `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
            <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">${message}</p>
            ${actionHtml}
        </div>
    `;
}

/**
 * Apply filters to data array
 * @param {Array} items - Items to filter
 * @param {Object} filters - Filter configuration { key: value|function }
 * @returns {Array} Filtered items
 */
export function applyFilters(items, filters) {
    if (!filters || Object.keys(filters).length === 0) {
        return items;
    }

    return items.filter(item => {
        return Object.entries(filters).every(([key, condition]) => {
            // Skip if no condition
            if (condition === null || condition === undefined || condition === '') {
                return true;
            }

            const value = item[key];

            // Function-based filter
            if (typeof condition === 'function') {
                return condition(value, item);
            }

            // String matching (case-insensitive)
            if (typeof condition === 'string') {
                const itemValue = value?.toString()?.toLowerCase() || '';
                const filterValue = condition.toLowerCase();
                return itemValue.includes(filterValue);
            }

            // Exact match for other types
            return value === condition;
        });
    });
}

export default {
    debounce,
    throttle,
    deepClone,
    groupBy,
    sortBy,
    isEmpty,
    uniqueId,
    safeParse,
    sleep,
    retry,
    withLoadingState,
    renderTable,
    createEmptyState,
    applyFilters
};
