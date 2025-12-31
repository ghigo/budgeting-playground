/**
 * Toast Notification Service
 * Provides user feedback with optional undo functionality
 */

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
 * @param {Object} options - Additional options
 * @param {Function} options.undoAction - Async function to call when undo is clicked
 * @param {number} options.duration - Auto-dismiss duration in ms (default: 10000)
 */
export function showToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        console.warn('Toast container not found');
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const duration = options.duration || 10000;

    // If there's an undo action, create a toast with message and undo button
    if (options.undoAction) {
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.justifyContent = 'space-between';
        toast.style.gap = '1rem';
        toast.style.cursor = 'default';
        toast.style.padding = '1rem 1.25rem';

        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        messageSpan.style.flex = '1';
        toast.appendChild(messageSpan);

        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'UNDO';
        undoBtn.style.padding = '0.5rem 1rem';
        undoBtn.style.fontSize = '0.875rem';
        undoBtn.style.fontWeight = '600';
        undoBtn.style.background = 'white';
        undoBtn.style.color = '#16a34a';
        undoBtn.style.border = 'none';
        undoBtn.style.borderRadius = '6px';
        undoBtn.style.cursor = 'pointer';
        undoBtn.style.whiteSpace = 'nowrap';
        undoBtn.style.transition = 'all 0.2s ease';
        undoBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

        // Hover effects
        undoBtn.addEventListener('mouseenter', () => {
            undoBtn.style.background = '#f0f0f0';
            undoBtn.style.transform = 'scale(1.05)';
        });
        undoBtn.addEventListener('mouseleave', () => {
            undoBtn.style.background = 'white';
            undoBtn.style.transform = 'scale(1)';
        });

        undoBtn.addEventListener('click', async () => {
            clearTimeout(timeoutId);
            toast.remove();
            await options.undoAction();
        });

        toast.appendChild(undoBtn);
    } else {
        toast.textContent = message;
        toast.style.cursor = 'pointer';
        toast.title = 'Click to dismiss';

        // Click to dismiss immediately (only for non-undo toasts)
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            toast.remove();
        });
    }

    container.appendChild(toast);

    // Auto-dismiss after duration
    const timeoutId = setTimeout(() => {
        toast.remove();
    }, duration);

    return toast;
}

/**
 * Show success toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export function showSuccess(message, options = {}) {
    return showToast(message, 'success', options);
}

/**
 * Show error toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export function showError(message, options = {}) {
    return showToast(message, 'error', options);
}

/**
 * Show info toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export function showInfo(message, options = {}) {
    return showToast(message, 'info', options);
}

/**
 * Show warning toast
 * @param {string} message - Message to display
 * @param {Object} options - Additional options
 */
export function showWarning(message, options = {}) {
    return showToast(message, 'warning', options);
}

export default {
    showToast,
    showSuccess,
    showError,
    showInfo,
    showWarning
};
