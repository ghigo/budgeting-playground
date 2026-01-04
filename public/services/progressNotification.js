/**
 * Progress Notification Service
 * Displays persistent notifications with progress tracking
 */

class ProgressNotificationService {
    constructor() {
        this.notifications = new Map();
        this.container = null;
        this.init();
    }

    init() {
        // Create notification container if it doesn't exist
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'progress-notifications';
            this.container.style.cssText = `
                position: fixed;
                top: 70px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 400px;
            `;
            document.body.appendChild(this.container);
        }
    }

    /**
     * Show a progress notification
     * @param {string} id - Notification ID
     * @param {string} title - Notification title
     * @param {number} progress - Progress percentage (0-100)
     * @param {Object} options - Additional options
     */
    show(id, title, progress = 0, options = {}) {
        this.init();

        let notification = this.notifications.get(id);

        if (!notification) {
            // Create new notification
            notification = this.createNotification(id, title, options);
            this.notifications.set(id, notification);
            this.container.appendChild(notification.element);
        }

        // Update progress
        this.updateProgress(id, progress, options);
    }

    /**
     * Create a notification element
     * @param {string} id - Notification ID
     * @param {string} title - Notification title
     * @param {Object} options - Additional options
     * @returns {Object} Notification object
     */
    createNotification(id, title, options = {}) {
        const element = document.createElement('div');
        element.className = 'progress-notification';
        element.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            padding: 16px;
            border-left: 4px solid #3B82F6;
            animation: slideIn 0.3s ease-out;
        `;

        element.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                <div style="flex: 1;">
                    <div class="notification-title" style="font-weight: 600; color: #1F2937; margin-bottom: 4px;">${title}</div>
                    <div class="notification-status" style="font-size: 0.875rem; color: #6B7280;">Starting...</div>
                </div>
                <button class="notification-close" style="background: none; border: none; color: #9CA3AF; cursor: pointer; font-size: 1.25rem; padding: 0; margin-left: 8px; line-height: 1;">&times;</button>
            </div>
            <div class="progress-bar-container" style="background: #E5E7EB; height: 8px; border-radius: 4px; overflow: hidden;">
                <div class="progress-bar" style="background: linear-gradient(90deg, #3B82F6, #2563EB); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
            </div>
        `;

        // Add close handler
        const closeBtn = element.querySelector('.notification-close');
        closeBtn.onclick = () => this.hide(id);

        // Add slide-in animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        if (!document.getElementById('progress-notification-styles')) {
            style.id = 'progress-notification-styles';
            document.head.appendChild(style);
        }

        return {
            element,
            id,
            title
        };
    }

    /**
     * Update notification progress
     * @param {string} id - Notification ID
     * @param {number} progress - Progress percentage (0-100)
     * @param {Object} options - Additional options
     */
    updateProgress(id, progress, options = {}) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        const progressBar = notification.element.querySelector('.progress-bar');
        const statusText = notification.element.querySelector('.notification-status');

        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }

        if (statusText && options.status) {
            statusText.textContent = options.status;
        }

        // Change color based on state
        if (options.state === 'completed') {
            notification.element.style.borderLeftColor = '#10B981';
            if (progressBar) {
                progressBar.style.background = 'linear-gradient(90deg, #10B981, #059669)';
            }
        } else if (options.state === 'failed') {
            notification.element.style.borderLeftColor = '#EF4444';
            if (progressBar) {
                progressBar.style.background = 'linear-gradient(90deg, #EF4444, #DC2626)';
            }
        }
    }

    /**
     * Hide a notification
     * @param {string} id - Notification ID
     * @param {number} delay - Delay before hiding (ms)
     */
    hide(id, delay = 0) {
        const notification = this.notifications.get(id);
        if (!notification) return;

        setTimeout(() => {
            notification.element.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.element.parentNode) {
                    notification.element.parentNode.removeChild(notification.element);
                }
                this.notifications.delete(id);
            }, 300);
        }, delay);
    }

    /**
     * Show success notification
     * @param {string} id - Notification ID
     * @param {string} title - Notification title
     * @param {string} message - Success message
     * @param {number} autoHideDelay - Auto hide delay (ms), 0 to disable
     */
    showSuccess(id, title, message, autoHideDelay = 5000) {
        this.show(id, title, 100, {
            status: message,
            state: 'completed'
        });

        if (autoHideDelay > 0) {
            this.hide(id, autoHideDelay);
        }
    }

    /**
     * Show error notification
     * @param {string} id - Notification ID
     * @param {string} title - Notification title
     * @param {string} message - Error message
     * @param {number} autoHideDelay - Auto hide delay (ms), 0 to disable
     */
    showError(id, title, message, autoHideDelay = 10000) {
        this.show(id, title, 0, {
            status: message,
            state: 'failed'
        });

        if (autoHideDelay > 0) {
            this.hide(id, autoHideDelay);
        }
    }
}

// Export singleton instance
export const progressNotification = new ProgressNotificationService();
