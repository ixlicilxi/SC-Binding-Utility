/**
 * Theme Switcher Module
 * Handles switching between different themes (Scifi and VS Code Dark)
 */

const THEMES = {
    Scifi: 'Scifi',
    VSCODE: 'vscode'
};

const THEME_STORAGE_KEY = 'appTheme';
const DEFAULT_THEME = THEMES.Scifi;

class ThemeSwitcher
{
    constructor()
    {
        this.currentTheme = this.loadTheme();
        this.switcherBtn = null;
        this.initializeTheme();
        this.setupEventListeners();
    }

    /**
     * Load theme from localStorage, fallback to default
     */
    loadTheme()
    {
        return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
    }

    /**
     * Save theme to localStorage
     */
    saveTheme(theme)
    {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    /**
     * Initialize the current theme on page load
     */
    initializeTheme()
    {
        this.applyTheme(this.currentTheme);
    }

    /**
     * Apply theme to the document
     */
    applyTheme(theme)
    {
        const root = document.documentElement;

        // Remove all theme classes
        root.classList.remove('theme-Scifi', 'theme-red');

        // Apply the selected theme
        if (theme === THEMES.VSCODE)
        {
            root.classList.add('theme-red');
        }
        // Scifi is default (no class needed)

        this.currentTheme = theme;
        this.updateSwitcherButton();

        // Dispatch theme change event so canvases can refresh
        document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }

    /**
     * Toggle between themes
     */
    toggleTheme()
    {
        const newTheme = this.currentTheme === THEMES.Scifi ? THEMES.VSCODE : THEMES.Scifi;
        this.applyTheme(newTheme);
        this.saveTheme(newTheme);
    }

    /**
     * Update the theme switcher button appearance
     */
    updateSwitcherButton()
    {
        if (!this.switcherBtn) return;

        const icon = this.switcherBtn.querySelector('.theme-switcher-icon');
        const text = this.switcherBtn.querySelector('.theme-switcher-text');

        if (this.currentTheme === THEMES.VSCODE)
        {
            icon.textContent = '🛑';
            text.textContent = 'Red';
            this.switcherBtn.title = 'Switch to Scifi theme';
        } else
        {
            icon.textContent = '🤖';
            text.textContent = 'Scifi';
            this.switcherBtn.title = 'Switch to Dark red theme';
        }
    }

    /**
     * Setup event listeners for theme switching
     */
    setupEventListeners()
    {
        this.switcherBtn = document.getElementById('theme-switcher');

        if (this.switcherBtn)
        {
            this.switcherBtn.addEventListener('click', () => this.toggleTheme());
            this.updateSwitcherButton();
        }
    }

    /**
     * Get current theme name
     */
    getCurrentTheme()
    {
        return this.currentTheme;
    }

    /**
     * Get available themes
     */
    getAvailableThemes()
    {
        return Object.values(THEMES);
    }
}

// Initialize theme switcher when DOM is ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', () =>
    {
        window.themeSwitcher = new ThemeSwitcher();
    });
} else
{
    window.themeSwitcher = new ThemeSwitcher();
}

export { ThemeSwitcher, THEMES };
