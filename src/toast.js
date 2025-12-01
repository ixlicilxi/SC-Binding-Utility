/**
 * Toast Notification System
 * Universal toast notifications for the application
 */

// Toast container element
let toastContainer = null;

// Toast configuration
const TOAST_CONFIG = {
    defaultDuration: 4000,
    maxToasts: 5,
    position: 'top-left', // top-right, top-left, bottom-right, bottom-left
    animationDuration: 300
};

// Toast types with their styling
const TOAST_TYPES = {
    success: {
        icon: '✅',
        className: 'toast-success'
    },
    error: {
        icon: '❌',
        className: 'toast-error'
    },
    warning: {
        icon: '⚠️',
        className: 'toast-warning'
    },
    info: {
        icon: 'ℹ️',
        className: 'toast-info'
    }
};

/**
 * Initialize the toast container
 */
function initToastContainer()
{
    if (toastContainer) return;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = `toast-container toast-${TOAST_CONFIG.position}`;
    document.body.appendChild(toastContainer);
}

/**
 * Create and show a toast notification
 * @param {string} message - The message to display
 * @param {Object} options - Toast options
 * @param {string} options.type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {number} options.duration - Duration in milliseconds (0 for persistent)
 * @param {string} options.title - Optional title for the toast
 * @param {boolean} options.dismissible - Whether the toast can be dismissed by clicking
 * @param {string} options.details - Additional details to show (expandable)
 * @returns {HTMLElement} The toast element
 */
function showToast(message, options = {})
{
    initToastContainer();

    const {
        type = 'info',
        duration = TOAST_CONFIG.defaultDuration,
        title = null,
        dismissible = true,
        details = null
    } = options;

    const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${typeConfig.className}`;

    // Build toast content
    let contentHtml = `
        <div class="toast-icon">${typeConfig.icon}</div>
        <div class="toast-body">
    `;

    if (title)
    {
        contentHtml += `<div class="toast-title">${escapeHtml(title)}</div>`;
    }

    contentHtml += `<div class="toast-message">${escapeHtml(message)}</div>`;

    if (details)
    {
        contentHtml += `
            <details class="toast-details">
                <summary>Details</summary>
                <pre class="toast-details-content">${escapeHtml(details)}</pre>
            </details>
        `;
    }

    contentHtml += `</div>`;

    if (dismissible)
    {
        contentHtml += `<button class="toast-close" aria-label="Close">×</button>`;
    }

    toast.innerHTML = contentHtml;

    // Add close button handler
    if (dismissible)
    {
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            dismissToast(toast);
        });
    }

    // Enforce max toasts limit
    const existingToasts = toastContainer.querySelectorAll('.toast');
    if (existingToasts.length >= TOAST_CONFIG.maxToasts)
    {
        dismissToast(existingToasts[0]);
    }

    // Add to container
    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() =>
    {
        toast.classList.add('toast-visible');
    });

    // Auto-dismiss if duration is set
    if (duration > 0)
    {
        toast.timeoutId = setTimeout(() =>
        {
            dismissToast(toast);
        }, duration);

        // Pause timer on hover
        toast.addEventListener('mouseenter', () =>
        {
            if (toast.timeoutId)
            {
                clearTimeout(toast.timeoutId);
                toast.timeoutId = null;
            }
        });

        toast.addEventListener('mouseleave', () =>
        {
            if (!toast.timeoutId && toast.parentElement)
            {
                toast.timeoutId = setTimeout(() =>
                {
                    dismissToast(toast);
                }, duration / 2);
            }
        });
    }

    return toast;
}

/**
 * Dismiss a toast notification
 * @param {HTMLElement} toast - The toast element to dismiss
 */
function dismissToast(toast)
{
    if (!toast || !toast.parentElement) return;

    // Clear any pending timeout
    if (toast.timeoutId)
    {
        clearTimeout(toast.timeoutId);
    }

    // Animate out
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');

    // Remove after animation
    setTimeout(() =>
    {
        if (toast.parentElement)
        {
            toast.remove();
        }
    }, TOAST_CONFIG.animationDuration);
}

/**
 * Dismiss all toasts
 */
function dismissAllToasts()
{
    if (!toastContainer) return;

    const toasts = toastContainer.querySelectorAll('.toast');
    toasts.forEach(dismissToast);
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str)
{
    if (typeof str !== 'string') str = String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Convenience methods
function showSuccess(message, options = {})
{
    return showToast(message, { ...options, type: 'success' });
}

function showError(message, options = {})
{
    // Errors should stay longer by default
    return showToast(message, { duration: 6000, ...options, type: 'error' });
}

function showWarning(message, options = {})
{
    return showToast(message, { duration: 5000, ...options, type: 'warning' });
}

function showInfo(message, options = {})
{
    return showToast(message, { ...options, type: 'info' });
}

// Legacy compatibility - replace window.showSuccessMessage
function initLegacySupport()
{
    // Store original if it exists
    const originalShowSuccessMessage = window.showSuccessMessage;

    window.showSuccessMessage = function (message)
    {
        showSuccess(message);
    };

    // Also add the new API to window
    window.toast = {
        show: showToast,
        success: showSuccess,
        error: showError,
        warning: showWarning,
        info: showInfo,
        dismiss: dismissToast,
        dismissAll: dismissAllToasts
    };
}

// Initialize on DOM ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', initLegacySupport);
} else
{
    initLegacySupport();
}

// Export for ES modules
export
{
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    dismissToast,
    dismissAllToasts,
    TOAST_CONFIG
};
