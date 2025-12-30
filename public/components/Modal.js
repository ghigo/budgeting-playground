/**
 * Modal Component
 * Reusable modal dialog with customizable content and actions
 */

import { eventBus } from '../services/eventBus.js';
import { escapeHtml } from '../utils/formatters.js';

export class Modal {
    /**
     * Create a Modal
     * @param {Object} config - Configuration object
     * @param {string} config.id - Unique modal ID
     * @param {string} config.title - Modal title
     * @param {string} config.content - Modal content (HTML)
     * @param {Array} config.actions - Array of action button configs
     * @param {Object} config.options - Display options
     */
    constructor(config) {
        this.id = config.id || `modal-${Date.now()}`;
        this.title = config.title || '';
        this.content = config.content || '';
        this.actions = config.actions || [];
        this.options = {
            closeOnOverlay: true,
            closeOnEscape: true,
            showCloseButton: true,
            size: 'medium', // small, medium, large
            ...config.options
        };
        this.isOpen = false;
        this.modalElement = null;
    }

    /**
     * Render and show the modal
     */
    show() {
        if (this.isOpen) return;

        this.render();
        this.attachEventListeners();
        this.isOpen = true;

        // Trigger show animation
        requestAnimationFrame(() => {
            if (this.modalElement) {
                this.modalElement.classList.add('show');
            }
        });

        eventBus.emit(`modal:${this.id}:opened`);
    }

    /**
     * Render the modal
     */
    render() {
        // Remove existing modal if present
        const existing = document.getElementById(this.id);
        if (existing) {
            existing.remove();
        }

        const sizeClass = `modal-${this.options.size}`;

        const html = `
            <div class="modal-overlay" id="${this.id}">
                <div class="modal-dialog ${sizeClass}">
                    <div class="modal-header">
                        <h2 class="modal-title">${escapeHtml(this.title)}</h2>
                        ${this.options.showCloseButton ? `
                            <button class="modal-close" aria-label="Close">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        ` : ''}
                    </div>
                    <div class="modal-body">
                        ${this.content}
                    </div>
                    ${this.actions.length > 0 ? `
                        <div class="modal-footer">
                            ${this.renderActions()}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
        this.modalElement = document.getElementById(this.id);
    }

    /**
     * Render action buttons
     */
    renderActions() {
        return this.actions.map(action => {
            const className = action.primary ? 'modal-btn-primary' : 'modal-btn-secondary';
            const disabled = action.disabled ? 'disabled' : '';

            return `
                <button
                    class="modal-btn ${className}"
                    data-action="${escapeHtml(action.action)}"
                    ${disabled}
                >
                    ${escapeHtml(action.label)}
                </button>
            `;
        }).join('');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        if (!this.modalElement) return;

        // Close button
        const closeBtn = this.modalElement.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Overlay click
        if (this.options.closeOnOverlay) {
            this.modalElement.addEventListener('click', (e) => {
                if (e.target === this.modalElement) {
                    this.close();
                }
            });
        }

        // Escape key
        if (this.options.closeOnEscape) {
            this.escapeHandler = (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.close();
                }
            };
            document.addEventListener('keydown', this.escapeHandler);
        }

        // Action buttons
        const actionBtns = this.modalElement.querySelectorAll('[data-action]');
        actionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.handleAction(action);
            });
        });
    }

    /**
     * Handle action button click
     */
    handleAction(action) {
        eventBus.emit(`modal:${this.id}:action`, { action });
        eventBus.emit(`modal:${this.id}:${action}`);

        // Auto-close on action unless it's a "cancel" type action
        const actionConfig = this.actions.find(a => a.action === action);
        if (actionConfig && actionConfig.closeOnClick !== false) {
            this.close();
        }
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.isOpen || !this.modalElement) return;

        // Trigger hide animation
        this.modalElement.classList.remove('show');

        // Remove from DOM after animation
        setTimeout(() => {
            if (this.modalElement) {
                this.modalElement.remove();
                this.modalElement = null;
            }
        }, 300); // Match CSS transition duration

        // Remove escape listener
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }

        this.isOpen = false;
        eventBus.emit(`modal:${this.id}:closed`);
    }

    /**
     * Update modal content
     */
    setContent(content) {
        this.content = content;
        if (this.modalElement) {
            const body = this.modalElement.querySelector('.modal-body');
            if (body) {
                body.innerHTML = content;
            }
        }
    }

    /**
     * Update modal title
     */
    setTitle(title) {
        this.title = title;
        if (this.modalElement) {
            const titleElement = this.modalElement.querySelector('.modal-title');
            if (titleElement) {
                titleElement.textContent = title;
            }
        }
    }

    /**
     * Enable/disable an action button
     */
    setActionDisabled(action, disabled) {
        if (!this.modalElement) return;

        const btn = this.modalElement.querySelector(`[data-action="${action}"]`);
        if (btn) {
            if (disabled) {
                btn.setAttribute('disabled', 'disabled');
            } else {
                btn.removeAttribute('disabled');
            }
        }
    }

    /**
     * Check if modal is currently open
     */
    isModalOpen() {
        return this.isOpen;
    }

    /**
     * Destroy the modal
     */
    destroy() {
        this.close();
    }
}

/**
 * Helper function to create a simple confirmation modal
 */
export function showConfirmModal(title, message, onConfirm, onCancel) {
    const modal = new Modal({
        id: `confirm-${Date.now()}`,
        title,
        content: `<p>${escapeHtml(message)}</p>`,
        actions: [
            { action: 'cancel', label: 'Cancel', primary: false },
            { action: 'confirm', label: 'Confirm', primary: true }
        ],
        options: { size: 'small' }
    });

    eventBus.once(`modal:${modal.id}:confirm`, () => {
        if (onConfirm) onConfirm();
    });

    eventBus.once(`modal:${modal.id}:cancel`, () => {
        if (onCancel) onCancel();
    });

    modal.show();
    return modal;
}

/**
 * Helper function to create a simple alert modal
 */
export function showAlertModal(title, message, onClose) {
    const modal = new Modal({
        id: `alert-${Date.now()}`,
        title,
        content: `<p>${escapeHtml(message)}</p>`,
        actions: [
            { action: 'ok', label: 'OK', primary: true }
        ],
        options: { size: 'small' }
    });

    eventBus.once(`modal:${modal.id}:ok`, () => {
        if (onClose) onClose();
    });

    modal.show();
    return modal;
}

export default Modal;
