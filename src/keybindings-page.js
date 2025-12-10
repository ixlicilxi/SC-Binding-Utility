const {invoke} = window.__TAURI__.core;
const {listen} = window.__TAURI__.event;
const {open, save} = window.__TAURI__.dialog;
import {toStarCitizenFormat} from './input-utils.js';
import {CustomDropdown} from './custom-dropdown.js';
import {Tooltip} from './tooltip.js';

const DEVICE_PREFIX_CACHE_KEY = 'devicePrefixMapping';
const SECONDARY_WINDOW_MS = 1000;


// Detection State
let keyboardDetectionActive = false;
let keyboardDetectionHandler = null;
let isDetectionActive = false;
let ignoreModalMouseInputs = false;
let currentBindingId = null;
let bindingModalSaveBtn = null;

// Data State
let currentKeybindings = null;
let currentFilter = 'all';
let currentCategory = null;
let searchTerm = '';
let bindingMode = false;
let currentBindingAction = null;
let countdownInterval = null;
let secondaryDetectionTimeout = null;
let hasUnsavedChanges = false;
let customizedOnly = false;
let showUnboundActions = true;
let categoryFriendlyNames = {};
let currentFilename = null;

// Caches
let deviceAxisNames = {};
let deviceAxisMappings = {};
let deviceSCAxisMappings = {};
let detectedJoysticks = [];
let deviceMappings = {};
let deviceUuidMapping = {};
let deviceUuidToAutoPrefix = {};
let localPrefixMapping = {};
let currentActionBindingsData = null;

// UI Detection State
let allDetectedInputs = new Map();
let selectedInputKey = null;
let statusEl = null;
let selectionContainer = null;
let selectionButtons = new Map();
let selectionMessageEl = null;

const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// =============================================================================
// INITIALIZATION & HELPERS
// =============================================================================

function loadPrefixMappingsLocal() {
    try {
        const saved = localStorage.getItem(DEVICE_PREFIX_CACHE_KEY);
        if (saved) {
            localPrefixMapping = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('[KEYBINDINGS] Failed to load local prefix mappings');
    }
}

function setBindingSaveEnabled(enabled) {
    if (bindingModalSaveBtn) bindingModalSaveBtn.disabled = !enabled;
}


/**
 * Load axis names for all connected devices from HID descriptors
 * This populates the deviceAxisNames cache used for display
 */
async function loadDeviceAxisNames() {
    if (!currentKeybindings || !currentKeybindings.devices) return;

    const deviceNames = new Set([
        ...(currentKeybindings.devices.joysticks || []).map(d => d.device_name),
        ...(currentKeybindings.devices.gamepads || []).map(d => d.device_name)
    ]);

    const loadPromises = Array.from(deviceNames).map(async (deviceName) => {
        if (deviceAxisNames[deviceName]) return; // Already cached

        try {
            // Run these in parallel
            const [axisNames, axisMapping] = await Promise.all([
                invoke('get_axis_names_for_device', {deviceName}).catch(() => ({})),
                invoke('get_directinput_to_hid_mapping', {deviceName}).catch(() => ({}))
            ]);

            deviceAxisNames[deviceName] = axisNames || {};
            deviceAxisMappings[deviceName] = axisMapping || {};

            // Initialize SC mapping container
            deviceSCAxisMappings[deviceName] = {};

            console.log(`[Axis] Loaded ${Object.keys(axisNames).length} axes for ${deviceName}`);
        } catch (error) {
            console.warn(`[Axis] Failed to load data for ${deviceName}`, error);
            deviceAxisNames[deviceName] = {};
        }
    });

    await Promise.all(loadPromises);
}


/**
 * Generates a stable device identifier from device properties
 * Uses: path (if available) OR vendor_id + product_id + serial_number + index
 * This ensures the same physical device gets the same ID across sessions
 * COPIED FROM device_manager.js to ensure consistency
 */
function generateDeviceIdentifier(device, uniqueIndex) {
    // 1. Prefer Hardware Path if available (Operating System location)
    if (device.path) {
        return `path-${device.path}`;
    }

    // 2. Build the hardware ID
    let baseId = '';
    if (device.vendor_id && device.product_id) {
        const serial = device.serial_number || 'nosn';
        baseId = `${device.vendor_id}-${device.product_id}-${serial}`;
    } else {
        // Fallback to name hash
        const nameHash = hashString(device.name);
        baseId = `name-${nameHash}`;
    }

    // 3. Append index if serial is missing or we are forcing index usage
    // This distinguishes identical sticks (same VID/PID, no SN)
    if (baseId.includes('nosn') || uniqueIndex !== undefined) {
        const uniqueId = `${baseId}-idx${uniqueIndex}`;
        console.log(`[KEYBINDINGS] Generated Unique ID (with index): ${uniqueId}`);
        return uniqueId;
    }

    return baseId;
}

/**
 * Simple string hash function for device names
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

/**
 * Build device UUID to auto-detected prefix mapping
 * This ensures keybindings page uses the same device enumeration order as device manager
 */
async function buildDeviceUuidMapping() {
    try {
        const devices = await invoke('detect_joysticks');
        console.log('[KEYBINDINGS] Building device UUID mapping from detected devices:', devices);

        // Clear existing mapping
        deviceUuidToAutoPrefix = {};

        // Count joysticks and gamepads separately (same logic as device-manager.js)
        let joystickCount = 0;
        let gamepadCount = 0;

        // UPDATED: Added index to loop to match device_manager.js logic
        devices.forEach((device, index) => {
            const isGp = device.device_type === 'Gamepad';
            const categoryIndex = isGp ? ++gamepadCount : ++joystickCount;
            const autoDetectedId = isGp ? `gp${categoryIndex}` : `js${categoryIndex}`;

            // UPDATED: Use the same ID generation logic as device_manager.js
            let deviceUuid = device.uuid;
            if (deviceUuid) {
                // If backend provides a UUID, append index to guarantee uniqueness in UI
                // e.g. "10F5:7055" becomes "10F5:7055-idx0"
                deviceUuid = `${deviceUuid}-idx${index}`;
            } else {
                // Fallback generator (already includes index logic)
                deviceUuid = generateDeviceIdentifier(device, index);
            }

            if (deviceUuid) {
                deviceUuidToAutoPrefix[deviceUuid] = autoDetectedId;
                console.log(`[KEYBINDINGS] Mapped UUID ${deviceUuid} -> ${autoDetectedId} (${device.name})`);
            }
        });

        console.log('[KEYBINDINGS] Device UUID mapping complete:', deviceUuidToAutoPrefix);
    } catch (error) {
        console.error('[KEYBINDINGS] Failed to build device UUID mapping:', error);
    }
}

/**
 * Get the HID axis name for a joystick axis binding
 * @param {string} binding - The binding string (e.g., "js1_x", "js2_ry")
 * @returns {string|null} - The HID axis name (e.g., "X", "Ry") or null if not found
 */
function getHidAxisNameForBinding(binding) {
    if (!binding || !currentKeybindings || !currentKeybindings.devices) return null;

    // Parse binding format: jsX_axis or gpX_axis
    const match = binding.match(/^(js|gp)(\d+)_([a-z0-9_]+)$/i);
    if (!match) return null;

    const [, deviceType, deviceNum, axisName] = match;

    // Map deviceType and number to actual device name
    let device = null;

    if (deviceType.toLowerCase() === 'js') {
        const jsNum = parseInt(deviceNum);
        if (currentKeybindings.devices.joysticks && currentKeybindings.devices.joysticks[jsNum - 1]) {
            device = currentKeybindings.devices.joysticks[jsNum - 1];
        }
    } else if (deviceType.toLowerCase() === 'gp') {
        const gpNum = parseInt(deviceNum);
        if (currentKeybindings.devices.gamepads && currentKeybindings.devices.gamepads[gpNum - 1]) {
            device = currentKeybindings.devices.gamepads[gpNum - 1];
        }
    }

    if (!device || !device.device_name) return null;

    // Get axis names and SC axis mapping for this device
    const axisNameMap = deviceAxisNames[device.device_name];
    const scAxisMapping = deviceSCAxisMappings[device.device_name];
    const directInputMapping = deviceAxisMappings[device.device_name];

    if (!axisNameMap || !scAxisMapping || !directInputMapping) return null;

    // Find which DirectInput index maps to this SC axis name using device-specific mapping
    // For example, VKB "rotz" maps to DirectInput index 3 (not 6!)
    const normalizedAxisName = axisName.toLowerCase();
    let directInputIndex = null;

    for (const [idx, scName] of Object.entries(scAxisMapping)) {
        if (scName === normalizedAxisName) {
            directInputIndex = parseInt(idx);
            break;
        }
    }

    if (directInputIndex === null) return null;

    // Convert DirectInput index to HID usage ID using device-specific mapping
    const hidUsageId = directInputMapping[directInputIndex];
    if (hidUsageId === undefined) return null;

    // Look up the actual axis name from HID descriptor
    return axisNameMap[hidUsageId] || null;
}

// Convert JavaScript KeyboardEvent.code to Star Citizen keyboard format
function convertKeyCodeToSC(code, key) {
    // Handle special keys
    const specialKeys = {
        'Space': 'space',
        'Enter': 'enter',
        'Escape': 'escape',
        'Tab': 'tab',
        'Backspace': 'backspace',
        'Delete': 'delete',
        'Insert': 'insert',
        'Home': 'home',
        'End': 'end',
        'PageUp': 'pgup',
        'PageDown': 'pgdown',
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'CapsLock': 'capslock',
        'NumLock': 'numlock',
        'ScrollLock': 'scrolllock',
        'Pause': 'pause',
        'PrintScreen': 'print',
        'ContextMenu': 'apps',
        'Backquote': 'grave',
        'Minus': 'minus',
        'Equal': 'equals',
        'BracketLeft': 'lbracket',
        'BracketRight': 'rbracket',
        'Backslash': 'backslash',
        'Semicolon': 'semicolon',
        'Quote': 'apostrophe',
        'Comma': 'comma',
        'Period': 'period',
        'Slash': 'slash',
    };

    if (specialKeys[code]) {
        return specialKeys[code];
    }

    // Handle letter keys (KeyA -> a)
    if (code.startsWith('Key')) {
        return code.substring(3).toLowerCase();
    }

    // Handle number keys (Digit1 -> 1)
    if (code.startsWith('Digit')) {
        return code.substring(5);
    }

    // Handle numpad keys (Numpad1 -> np_1)
    if (code.startsWith('Numpad')) {
        const numpadKey = code.substring(6).toLowerCase();
        const numpadMap = {
            'divide': 'np_divide',
            'multiply': 'np_multiply',
            'subtract': 'np_subtract',
            'add': 'np_add',
            'enter': 'np_enter',
            'decimal': 'np_period',
        };
        return numpadMap[numpadKey] || `np_${numpadKey}`;
    }

    // Handle function keys (F1 -> f1)
    if (code.match(/^F\d+$/)) {
        return code.toLowerCase();
    }

    // Handle modifiers (these are typically detected as part of combinations)
    if (code === 'ShiftLeft') return 'lshift';
    if (code === 'ShiftRight') return 'rshift';
    if (code === 'ControlLeft') return 'lctrl';
    if (code === 'ControlRight') return 'rctrl';
    if (code === 'AltLeft') return 'lalt';
    if (code === 'AltRight') return 'ralt';
    if (code === 'MetaLeft' || code === 'MetaRight') return 'lwin'; // Windows key

    // Fallback to lowercase key
    return key.toLowerCase();
}

function renderDetectedInputMessage(container, message) {
    container.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'action-binding-button-found';
    span.textContent = message;
    container.appendChild(span);
}

function cleanupInputDetectionListeners() {
    // 1. Clean up Rust Event Listeners
    if (window.currentInputDetectionUnlisten) {
        window.currentInputDetectionUnlisten();
        window.currentInputDetectionUnlisten = null;
    }
    if (window.currentCompletionUnlisten) {
        window.currentCompletionUnlisten();
        window.currentCompletionUnlisten = null;
    }

    // 2. Clean up DOM Listeners
    if (keyboardDetectionHandler) {
        document.removeEventListener('keydown', keyboardDetectionHandler, true);
        keyboardDetectionHandler = null;
    }

    if (window.mouseDetectionHandler) {
        document.removeEventListener('mousedown', window.mouseDetectionHandler, true);
        document.removeEventListener('mouseup', window.mouseUpHandler, true);
        document.removeEventListener('contextmenu', window.contextMenuHandler, true);
        window.removeEventListener('beforeunload', window.beforeUnloadHandler, true);

        window.mouseDetectionHandler = null;
        window.mouseUpHandler = null;
        window.contextMenuHandler = null;
        window.beforeUnloadHandler = null;
    }

    // 3. Reset State
    keyboardDetectionActive = false;
    window.mouseDetectionActive = false;
    window._lastAltKeyPressed = null;
    window._lastShiftKeyPressed = null;
    window._lastCtrlKeyPressed = null;
}

function stopDetection(reason = 'unspecified') {
    if (!isDetectionActive && !countdownInterval && !secondaryDetectionTimeout) {
        cleanupInputDetectionListeners();
        return;
    }

    ignoreModalMouseInputs = false;
    isDetectionActive = false;
    clearPrimaryCountdown();
    clearSecondaryDetectionTimer();
    cleanupInputDetectionListeners();
    console.log(`[TIMER] Detection stopped: ${reason}`);
}

function clearPrimaryCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function clearSecondaryDetectionTimer() {
    if (secondaryDetectionTimeout) {
        clearTimeout(secondaryDetectionTimeout);
        secondaryDetectionTimeout = null;
    }
}

function startSecondaryDetectionWindow() {
    clearSecondaryDetectionTimer();
    secondaryDetectionTimeout = setTimeout(() => {
        stopDetection('secondary-window-expired');
    }, SECONDARY_WINDOW_MS);
}

async function handleDetectedInput(processedInput) {
    if (!processedInput || !isDetectionActive) return;

    // Duplicate check
    if (allDetectedInputs.has(processedInput.scFormattedInput)) return;

    allDetectedInputs.set(processedInput.scFormattedInput, processedInput);

    // Scenario 1: First Input Detected
    if (allDetectedInputs.size === 1) {
        statusEl.innerHTML = '';
        renderDetectedInputMessage(statusEl, `✅ Detected: ${processedInput.displayName}`);

        clearPrimaryCountdown();
        const countdownEl = document.getElementById('binding-modal-countdown');
        if (countdownEl) countdownEl.textContent = '';

        startSecondaryDetectionWindow();

        const helperNote = document.createElement('div');
        helperNote.className = 'input-confirm-note';
        helperNote.textContent = 'Press another input within 1 second to pick a different option, or click Save Binding to confirm.';
        statusEl.appendChild(helperNote);

        selectedInputKey = processedInput.scFormattedInput;
        const conflicts = await setPendingBindingSelection(processedInput);
        updateConflictDisplay(conflicts);
        updateSelectionButtonStates();
    }
    // Scenario 2: Second Input (Potential Conflict or Modifier Combo)
    else if (allDetectedInputs.size === 2) {
        // Check for Auto-Combo (Modifier + Key)
        const firstInput = Array.from(allDetectedInputs.values())[0];
        const isFirstModifier = ['lshift', 'rshift', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lwin'].some(mod =>
            firstInput.scFormattedInput.includes(mod)
        );

        if (isFirstModifier) {
            // It's a combo (e.g., LCTRL was held, then A was pressed)
            // The `processedInput` (the A key) already contains the modifier state due to `processInput` logic
            stopDetection('modifier-auto-combo');
            clearPrimaryCountdown();

            statusEl.innerHTML = '';
            renderDetectedInputMessage(statusEl, `✅ Detected: ${processedInput.displayName}`);

            selectedInputKey = processedInput.scFormattedInput;
            const conflicts = await setPendingBindingSelection(processedInput);
            updateConflictDisplay(conflicts);
            return;
        }

        // It's a conflict (two separate buttons pressed fast) -> Show Selection UI
        clearPrimaryCountdown();
        statusEl.innerHTML = '';

        const countdownEl = document.getElementById('binding-modal-countdown');
        if (countdownEl) countdownEl.textContent = '';

        selectionMessageEl = document.createElement('div');
        selectionMessageEl.className = 'input-selection-message';
        const initiallySelected = allDetectedInputs.get(selectedInputKey) || processedInput;
        selectionMessageEl.textContent = `Multiple inputs detected. Selected: ${initiallySelected.displayName}`;
        statusEl.appendChild(selectionMessageEl);

        const helperNote = document.createElement('div');
        helperNote.className = 'input-confirm-note';
        helperNote.textContent = 'Click the input you want to keep, then press Save Binding.';
        statusEl.appendChild(helperNote);

        selectionContainer = document.createElement('div');
        selectionContainer.className = 'input-selection-container';
        statusEl.appendChild(selectionContainer);

        selectionButtons.clear();

        // Add buttons for all inputs
        Array.from(allDetectedInputs.values()).forEach((input) => {
            addDetectedInputButton(input);
        });

        updateSelectionButtonStates();
        updateConflictDisplay(window.pendingBinding?.conflicts || []);
    }
    // Scenario 3: 3+ Inputs
    else {
        addDetectedInputButton(processedInput);
    }
}


async function loadCategoryMappings() {
    try {
        // Use Tauri's resource resolver to load from the app directory
        const response = await fetch(new URL('../Categories.json', import.meta.url).href);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // The new Categories.json is already a flat mapping object
        categoryFriendlyNames = data;

        console.log('Category mappings loaded:', Object.keys(categoryFriendlyNames).length);
    } catch (error) {
        console.error('Error loading Categories.json:', error);
        // Set default fallback mapping to ensure the app still works
        categoryFriendlyNames = {
            '@ui_CCSeatGeneral': 'vehicle',
            '@ui_CCSpaceFlight': 'vehicle',
            '@ui_CCFPS': ['on foot'],
            '': 'other'
        };
    }
}

async function loadKeybindingsFile() {
    try {
        const filePath = await open({
            filters: [{
                name: 'Star Citizen Keybindings',
                extensions: ['xml']
            }],
            multiple: false
        });

        if (!filePath) return; // User cancelled

        // Extract filename from path
        const filename = filePath.split('\\').pop() || filePath.split('/').pop();
        currentFilename = filename;

        // Load the keybindings (this loads into state on backend)
        await invoke('load_keybindings', {filePath});

        // Now get the merged bindings (AllBinds + user customizations)
        currentKeybindings = await invoke('get_merged_bindings');

        // Persist file path so we know where to save
        localStorage.setItem('keybindingsFilePath', filePath);

        // Cache only the user customizations (delta), not the full merged view
        // This keeps the cache small and prevents stale data issues
        await cacheUserCustomizations();

        // Reset unsaved changes flag
        hasUnsavedChanges = false;
        localStorage.setItem('hasUnsavedChanges', 'false');
        updateUnsavedIndicator();

        // Update UI
        displayKeybindings();
        updateFileIndicator(filePath);

        // Refresh the visual view if it's loaded and visible
        if (window.refreshVisualView) {
            await window.refreshVisualView();
        }

    } catch (error) {
        console.error('Error loading keybindings:', error);
        await window.showAlert(`Failed to load keybindings: ${error}`, 'Error');
    }
}

export async function loadPersistedKeybindings() {
    try {
        const savedPath = localStorage.getItem('keybindingsFilePath');
        const cachedUnsavedState = localStorage.getItem('hasUnsavedChanges');
        const cachedDelta = localStorage.getItem('userCustomizationsDelta');

        console.log('loadPersistedKeybindings - checking state:', {
            hasSavedPath: !!savedPath,
            cachedUnsavedState,
            hasCachedDelta: !!cachedDelta,
            cachedDeltaLength: cachedDelta?.length || 0
        });

        // Set filename if we have a saved path
        if (savedPath) {
            const filename = savedPath.split('\\').pop() || savedPath.split('/').pop();
            currentFilename = filename;
        }

        if (savedPath) {
            // Check if we have unsaved changes cached
            // Note: cachedDelta might be the string "null", so check for that too
            if (cachedUnsavedState === 'true' && cachedDelta && cachedDelta !== 'null') {
                try {
                    console.log('Restoring unsaved changes from cache...');

                    // Load the cached delta into backend state (this is the unsaved work)
                    const userCustomizations = JSON.parse(cachedDelta);
                    console.log('Parsed cached delta:', {
                        hasData: !!userCustomizations,
                        actionMapsCount: userCustomizations?.action_maps?.length || 0
                    });
                    await invoke('restore_user_customizations', {customizations: userCustomizations});

                    // Get fresh merged bindings (AllBinds + cached unsaved delta)
                    currentKeybindings = await invoke('get_merged_bindings');

                    // Restore unsaved changes state and update UI
                    hasUnsavedChanges = true;
                    localStorage.setItem('hasUnsavedChanges', 'true');

                    displayKeybindings();
                    updateFileIndicator(savedPath);
                    updateUnsavedIndicator();

                    console.log('Unsaved changes restored successfully');
                    return;
                } catch (error) {
                    console.error('Error restoring cached changes:', error);
                    // Fall through to load from file
                }
            }

            // No unsaved changes - load from file
            try {
                console.log('Loading keybindings from file:', savedPath);
                await invoke('load_keybindings', {filePath: savedPath});

                // Get fresh merged bindings (AllBinds + user delta)
                currentKeybindings = await invoke('get_merged_bindings');

                // No unsaved changes
                hasUnsavedChanges = false;
                updateUnsavedIndicator();

                displayKeybindings();
                updateFileIndicator(savedPath);
                return;
            } catch (error) {
                console.error('Error loading persisted file:', error);
                await window.showAlert(
                    `Could not load keybindings file:\n${savedPath}\n\nThe file may have been moved or deleted. Starting with default bindings.`,
                    'File Load Error'
                );
                // Clear the saved path and show defaults
                localStorage.removeItem('keybindingsFilePath');
                localStorage.removeItem('hasUnsavedChanges');
                localStorage.removeItem('userCustomizationsDelta');
            }
        }

        // No user file loaded - check if we have unsaved changes for a new keybinding set
        if (cachedUnsavedState === 'true' && cachedDelta && cachedDelta !== 'null') {
            try {
                console.log('Restoring unsaved new keybinding set from cache...');

                // Load the cached delta into backend state (this is the unsaved work)
                const userCustomizations = JSON.parse(cachedDelta);
                await invoke('restore_user_customizations', {customizations: userCustomizations});

                // Get fresh merged bindings (AllBinds + cached unsaved delta)
                currentKeybindings = await invoke('get_merged_bindings');

                // Restore unsaved changes state
                hasUnsavedChanges = true;
                updateUnsavedIndicator();

                displayKeybindings();
                showUnsavedFileIndicator();

                console.log('Unsaved new keybinding set restored successfully');
                return;
            } catch (error) {
                console.error('Error restoring cached new keybinding set:', error);
                // Fall through to show AllBinds only
            }
        }

        // No user file loaded, just show all available bindings from AllBinds
        await loadAllBindsOnly();

    } catch (error) {
        console.error('Error loading persisted keybindings:', error);
    }
}

async function loadAllBindsOnly() {
    try {
        // Don't auto-load AllBinds - show welcome screen instead
        // User can create a new keybinding set or load an existing one
        showWelcomeScreen();
    } catch (error) {
        console.error('Error in loadAllBindsOnly:', error);
        showWelcomeScreen();
    }
}

function showWelcomeScreen() {
    // Show welcome screen
    document.getElementById('welcome-screen').style.display = 'flex';
    document.getElementById('bindings-content').style.display = 'none';

    // Disable save buttons
    document.getElementById('save-btn').disabled = true;
    document.getElementById('save-as-btn').disabled = true;

    // Reset state
    currentKeybindings = null;
    hasUnsavedChanges = false;
}

/**
 * Cache only the user's customizations (delta) to localStorage.
 * This is much smaller than caching the full merged view and prevents stale data issues.
 */
async function cacheUserCustomizations() {
    try {
        // Get the user's customizations from backend (just the delta, not merged with AllBinds)
        const userCustomizations = await invoke('get_user_customizations');

        // Cache the delta - this is typically < 100 KB vs 25+ MB for full merged view
        localStorage.setItem('userCustomizationsDelta', JSON.stringify(userCustomizations));

        console.log('Cached user customizations delta:', {
            hasData: !!userCustomizations,
            actionMapsCount: userCustomizations?.action_maps?.length || 0,
            profileName: userCustomizations?.profile_name
        });
    } catch (error) {
        console.error('Failed to cache user customizations:', error);
        // Non-critical error - we can always reload from file
    }
}

async function newKeybinding() {
    // Check if there are unsaved changes
    if (hasUnsavedChanges) {
        const confirmed = await window.showConfirmation(
            'You have unsaved keybinding changes. Do you want to discard them and start fresh?',
            'Unsaved Changes',
            'Discard & Start New',
            'Cancel',
            'btn-danger'
        );

        if (!confirmed) return;
    }

    try {
        // Clear backend customizations and reload AllBinds
        await invoke('clear_custom_bindings');
        await invoke('load_all_binds');

        // Initialize an empty ActionMaps structure in the backend
        // This is needed so that export_keybindings has something to work with
        const emptyActionMaps = {
            profile_name: 'New Profile',
            action_maps: [],
            categories: [],
            devices: {
                keyboards: [],
                mice: [],
                joysticks: []
            }
        };
        await invoke('restore_user_customizations', {customizations: emptyActionMaps});

        // Get fresh merged bindings (AllBinds only, no customizations)
        currentKeybindings = await invoke('get_merged_bindings');

        // Clear persisted state - we're starting fresh
        localStorage.removeItem('keybindingsFilePath');
        localStorage.setItem('hasUnsavedChanges', 'false');

        // Clear the current filename since we're creating new bindings
        currentFilename = null;

        // Reset unsaved changes flag and update UI
        hasUnsavedChanges = false;
        updateUnsavedIndicator();

        // Display the fresh keybindings
        displayKeybindings();
        showUnsavedFileIndicator();

        // Reset filters and search
        currentFilter = 'all';
        searchTerm = '';
        customizedOnly = false;

        // Update filter buttons
        const filterBtns = document.querySelectorAll('.filter-section .category-item');
        filterBtns.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.filter === 'all') btn.classList.add('active');
        });

        // Clear search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';

        // Uncheck customized only checkbox
        const customizedCheckbox = document.getElementById('customized-only-checkbox');
        if (customizedCheckbox) customizedCheckbox.checked = false;

        // Re-render with fresh state
        renderKeybindings();

        // Show success toast
        if (window.toast) {
            window.toast.success('New profile created. Make your changes and save when ready.');
        }

    } catch (error) {
        console.error('Error creating new keybinding:', error);
        await window.showAlert(`Failed to create new keybinding: ${error}`, 'Error');
    }
}

function updateFileIndicator(filePath) {
    const indicator = document.getElementById('loaded-file-indicator');
    const fileNameEl = document.getElementById('loaded-file-name');
    const indicatorSub = document.getElementById('loaded-file-indicator-sub');
    const filePathSubEl = document.getElementById('loaded-file-path-sub');
    const fileNameSubEl = document.getElementById('loaded-file-name-sub');

    if (indicator && fileNameEl) {
        // Show full file path
        fileNameEl.textContent = filePath;
        fileNameEl.title = filePath; // Add tooltip for full path
        indicator.style.display = 'flex';
    }

    if (indicatorSub && fileNameSubEl) {
        // Extract path and filename separately
        const lastSlashIndex = filePath.lastIndexOf('\\');
        const fileName = lastSlashIndex !== -1 ? filePath.substring(lastSlashIndex + 1) : filePath;
        const dirPath = lastSlashIndex !== -1 ? filePath.substring(0, lastSlashIndex + 1) : '';

        // Update sub-nav indicator with split path and filename
        if (filePathSubEl) {
            filePathSubEl.textContent = dirPath;
        }
        fileNameSubEl.textContent = fileName;
        fileNameSubEl.title = filePath; // Add tooltip for full path
        indicatorSub.style.display = 'flex';
    }
}

function showUnsavedFileIndicator() {
    const indicator = document.getElementById('loaded-file-indicator');
    const fileNameEl = document.getElementById('loaded-file-name');
    const indicatorSub = document.getElementById('loaded-file-indicator-sub');
    const filePathSubEl = document.getElementById('loaded-file-path-sub');
    const fileNameSubEl = document.getElementById('loaded-file-name-sub');

    if (indicator && fileNameEl) {
        fileNameEl.textContent = 'Unsaved Keybinding Set';
        indicator.style.display = 'flex';
    }

    if (indicatorSub && fileNameSubEl) {
        if (filePathSubEl) {
            filePathSubEl.textContent = '';
        }
        fileNameSubEl.textContent = 'Unsaved Keybinding Set';
        indicatorSub.style.display = 'flex';
    }
}

// Search for a button ID in the main keybindings view
window.searchMainTabForButtonId = function (buttonId) {
    // Switch to the bindings tab
    window.switchTab('bindings');

    // Switch to list view
    window.switchBindingsView('list');

    // Get the search input element
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        // Set the search input value
        searchInput.value = buttonId;

        // Trigger the search by firing an input event
        searchInput.dispatchEvent(new Event('input', {bubbles: true}));

        // Scroll the search input into view
        searchInput.scrollIntoView({behavior: 'smooth', block: 'nearest'});

        // Focus the search input
        searchInput.focus();
    }
};

async function saveKeybindings() {
    if (!currentKeybindings) {
        await window.showAlert('No keybindings loaded to save!', 'Save Keybindings');
        return;
    }

    try {
        // Get the saved file path
        const savedPath = localStorage.getItem('keybindingsFilePath');

        if (!savedPath) {
            // No file path - redirect to Save As
            await saveKeybindingsAs();
            return;
        }

        // Save to the current file path
        await invoke('export_keybindings', {filePath: savedPath});

        // Clear unsaved changes flag
        hasUnsavedChanges = false;
        localStorage.setItem('hasUnsavedChanges', 'false');
        updateUnsavedIndicator();

        console.log('Keybindings saved successfully to:', savedPath);

        // Check if auto-save to all installations is enabled
        const autoSaveEnabled = localStorage.getItem('autoSaveToAllInstallations') === 'true';
        const scInstallDirectory = localStorage.getItem('scInstallDirectory');

        if (autoSaveEnabled && scInstallDirectory) {
            try {
                // Get all detected installations
                const installations = await invoke('scan_sc_installations', {basePath: scInstallDirectory});

                if (installations.length > 0) {
                    console.log(`Auto-saving to ${installations.length} installation(s)...`);

                    // Filter out installations that contain the currently-opened file
                    let skippedInstallation = null;
                    const installationsToUpdate = installations.filter(installation => {
                        // Check if the current file path is within this installation
                        if (savedPath && savedPath.toLowerCase().includes(installation.path.toLowerCase())) {
                            skippedInstallation = installation.name;
                            return false; // Skip this installation
                        }
                        return true;
                    });

                    // Save to each installation (except the one with the currently open file)
                    const deployResults = [];
                    const failedInstallations = [];

                    for (const installation of installationsToUpdate) {
                        try {
                            await invoke('save_bindings_to_install', {
                                installationPath: installation.path
                            });
                            console.log(`Saved to ${installation.name}`);
                            deployResults.push({name: installation.name, success: true});
                        } catch (deployError) {
                            console.error(`Failed to deploy to ${installation.name}:`, deployError);
                            const errorMsg = typeof deployError === 'string' ? deployError : deployError.message || 'Unknown error';
                            failedInstallations.push({name: installation.name, error: errorMsg});
                            deployResults.push({name: installation.name, success: false, error: errorMsg});
                        }
                    }

                    const successCount = deployResults.filter(r => r.success).length;
                    const failCount = failedInstallations.length;

                    // Build message based on results
                    if (failCount === 0) {
                        // All deployments succeeded
                        let successMsg = `Saved & deployed to ${successCount} installation(s)`;
                        if (skippedInstallation) {
                            successMsg += ` (${skippedInstallation} was skipped as it's the currently open file location)`;
                        }
                        successMsg += '!';
                        if (window.toast) {
                            window.toast.success(successMsg);
                        } else {
                            window.showSuccessMessage(successMsg);
                        }
                    } else if (successCount > 0) {
                        // Partial success
                        const failedNames = failedInstallations.map(f => f.name).join(', ');
                        const errorDetails = failedInstallations.map(f => `${f.name}: ${f.error}`).join('\n');
                        if (window.toast) {
                            window.toast.warning(`Deployed to ${successCount} installation(s), but ${failCount} failed: ${failedNames}`, {
                                title: 'Partial Deployment',
                                details: errorDetails,
                                duration: 8000
                            });
                        } else {
                            window.showSuccessMessage(`Saved (${failCount} deployment(s) failed: ${failedNames})`);
                        }
                    } else {
                        // All deployments failed
                        const errorDetails = failedInstallations.map(f => `${f.name}: ${f.error}`).join('\n');
                        if (window.toast) {
                            window.toast.warning('Saved locally, but all deployments failed', {
                                title: 'Deployment Failed',
                                details: errorDetails,
                                duration: 8000
                            });
                        } else {
                            window.showSuccessMessage('Saved (all deployments failed)');
                        }
                    }
                } else {
                    // No installations found - auto-deploy enabled but nothing to deploy to
                    if (window.toast) {
                        window.toast.warning('Saved locally. No SC installations found to deploy to.', {
                            title: 'No Installations',
                            details: `Checked directory: ${scInstallDirectory}\n\nMake sure your Star Citizen installation directory is correctly configured in Settings.`,
                            duration: 6000
                        });
                    } else {
                        window.showSuccessMessage('Saved! (No installations found for auto-deploy)');
                    }
                }
            } catch (error) {
                console.error('Error auto-saving to installations:', error);
                // Show a more verbose error message (this catches scan_sc_installations errors)
                const errorMessage = typeof error === 'string' ? error : error.message || 'Unknown error';
                if (window.toast) {
                    window.toast.warning('Saved locally, but failed to scan installations', {
                        title: 'Partial Save',
                        details: errorMessage,
                        duration: 8000
                    });
                } else {
                    window.showSuccessMessage(`Saved (scan failed: ${errorMessage})`);
                }
            }
        } else {
            // Show brief success message
            if (window.toast) {
                window.toast.success('Saved!');
            } else {
                window.showSuccessMessage('Saved!');
            }
        }
    } catch (error) {
        console.error('Error saving keybindings:', error);
        await window.showAlert(`Failed to save keybindings: ${error}`, 'Error');
    }
}

async function saveKeybindingsAs() {
    if (!currentKeybindings) {
        await window.showAlert('No keybindings loaded to save!', 'Save Keybindings As');
        return;
    }

    try {
        // Prompt for a new file path
        const filePath = await save({
            filters: [{
                name: 'Star Citizen Keybindings',
                extensions: ['xml']
            }],
            defaultPath: 'layout_exported.xml'
        });

        if (!filePath) {
            // User cancelled
            return;
        }

        // Save to the new file path
        await invoke('export_keybindings', {filePath});

        // Update the stored file path
        localStorage.setItem('keybindingsFilePath', filePath);

        // Extract and set the filename
        const filename = filePath.split('\\').pop() || filePath.split('/').pop();
        currentFilename = filename;

        updateFileIndicator(filePath);
        updateCopyCommandButtonVisibility();

        // Clear unsaved changes flag
        hasUnsavedChanges = false;
        localStorage.setItem('hasUnsavedChanges', 'false');
        updateUnsavedIndicator();

        console.log('Keybindings saved successfully to:', filePath);

        // Show brief success message
        window.showSuccessMessage('Saved!');
    } catch (error) {
        console.error('Error saving keybindings:', error);
        await window.showAlert(`Failed to save keybindings: ${error}`, 'Error');
    }
}

// Helper function to update copy command button visibility
function updateCopyCommandButtonVisibility() {
    const copyCommandBtn = document.getElementById('copy-command-btn');
    if (copyCommandBtn) {
        copyCommandBtn.style.display = currentFilename ? 'inline-flex' : 'none';
    }
}

function displayKeybindings() {
    if (!currentKeybindings) return;

    // Hide welcome screen, show bindings content
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('bindings-content').style.display = 'flex';

    // Enable save buttons
    document.getElementById('save-btn').disabled = false;
    document.getElementById('save-as-btn').disabled = false;

    // Update copy command button visibility
    updateCopyCommandButtonVisibility();

    // Load axis names from HID descriptors for display
    loadDeviceAxisNames();

    // Build device UUID to auto-detected prefix mapping (ensures consistent device numbering)
    buildDeviceUuidMapping();

    // Render categories
    renderCategories();

    // Don't render device info for merged bindings (AllBinds doesn't have device info)
    if (currentKeybindings.devices) {
        renderDeviceInfo();
    }

    // Render keybindings
    renderKeybindings();
}

function renderCategories() {
    const categoryList = document.getElementById('category-list');

    // Group action maps by their mapped category
    const categoryGroups = new Map();

    currentKeybindings.action_maps.forEach(actionMap => {
        // Try to find a mapping for this action map
        // 1. Try ui_category (e.g. @ui_CCSpaceFlight)
        // 2. Try name (e.g. spaceship_movement)
        // 3. Default to 'Uncategorized'

        let categoryKey = actionMap.ui_category;
        if (!categoryFriendlyNames[categoryKey]) {
            categoryKey = actionMap.name;
        }

        let mappedCategory = categoryFriendlyNames[categoryKey];

        // If mappedCategory is an array, take the first element as the main category
        let mainCategory = 'Uncategorized';

        if (Array.isArray(mappedCategory)) {
            mainCategory = mappedCategory[0];
        } else if (typeof mappedCategory === 'string') {
            mainCategory = mappedCategory;
        } else {
            // Fallback if not found in mapping
            if (actionMap.ui_category) {
                mainCategory = actionMap.ui_category;
            } else {
                mainCategory = 'Uncategorized';
            }
        }

        // Normalize category name (capitalize)
        if (mainCategory && mainCategory !== 'Uncategorized') {
            // Capitalize first letter of each word
            mainCategory = mainCategory.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            // Special case for "Comms/social" -> "Comms/Social"
            mainCategory = mainCategory.replace('Comms/social', 'Comms/Social');
        }

        if (!categoryGroups.has(mainCategory)) {
            categoryGroups.set(mainCategory, []);
        }
        categoryGroups.get(mainCategory).push(actionMap);
    });

    // Sort categories
    // We want a specific order if possible, otherwise alphabetical
    const categoryOrder = [
        'Vehicle',
        'On Foot',
        'Turrets',
        'Comms/Social',
        'Camera',
        'Other',
        'Uncategorized'
    ];

    const sortedCategories = Array.from(categoryGroups.keys()).sort((a, b) => {
        const indexA = categoryOrder.indexOf(a);
        const indexB = categoryOrder.indexOf(b);

        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;

        return a.localeCompare(b);
    });

    let html = `
    <div class="category-item ${currentCategory === null ? 'active' : ''}" 
         data-category="all">
      All Categories
    </div>
  `;

    // Render grouped categories
    sortedCategories.forEach(categoryName => {
        const actionMaps = categoryGroups.get(categoryName);

        // Sort action maps within category by display name
        actionMaps.sort((a, b) => {
            const nameA = a.ui_label || a.display_name || a.name;
            const nameB = b.ui_label || b.display_name || b.name;
            return nameA.localeCompare(nameB);
        });

        // Add category header
        html += `<div class="category-header">${categoryName}</div>`;

        // Add action maps under this category
        actionMaps.forEach(actionMap => {
            const displayName = actionMap.ui_label || actionMap.display_name || actionMap.name;
            const isActive = currentCategory === actionMap.name;

            html += `
        <div class="category-item ${isActive ? 'active' : ''} category-item-indented" 
             data-category="${actionMap.name}">
          ${displayName}
        </div>
      `;
        });
    });

    categoryList.innerHTML = html;

    // Add click listeners
    categoryList.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Only remove active from items within this category list, not filter buttons
            categoryList.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category === 'all' ? null : e.target.dataset.category;
            renderKeybindings();
        });
    });
}

function renderDeviceInfo() {
    const deviceList = document.getElementById('device-list');

    let html = '';

    if (currentKeybindings.devices.keyboards.length > 0) {
        html += '<div class="device-item"><div class="device-label">Keyboard</div>';
        currentKeybindings.devices.keyboards.forEach(kb => {
            html += `<div>${kb}</div>`;
        });
        html += '</div>';
    }

    if (currentKeybindings.devices.mice.length > 0) {
        html += '<div class="device-item"><div class="device-label">Mouse</div>';
        currentKeybindings.devices.mice.forEach(mouse => {
            html += `<div>${mouse}</div>`;
        });
        html += '</div>';
    }

    if (currentKeybindings.devices.joysticks.length > 0) {
        html += '<div class="device-item"><div class="device-label">Joysticks</div>';
        currentKeybindings.devices.joysticks.forEach(js => {
            html += `<div>${js}</div>`;
        });
        html += '</div>';
    }

    deviceList.innerHTML = html;
}

// Helper function to check if an action has any bindings that will be displayed
function actionHasVisibleBindings(action) {
    // Check if it's effectively unbound (no bindings or only empty defaults that are placeholders)
    const isEffectivelyUnbound = !action.bindings || action.bindings.length === 0 || action.bindings.every(binding => {
        // Check the pattern BEFORE trimming to catch 'kb_ ', 'js_ ', etc.
        // The digit after the device prefix is optional
        const isEmptyBinding = !!binding.input.match(/^(js\d*|kb\d*|mouse\d*|gp\d*)_\s*$/);
        // It's only "effectively unbound" if it's the special Unbound placeholder
        const isUnboundPlaceholder = binding.is_default && isEmptyBinding && binding.display_name === 'Unbound';

        return isUnboundPlaceholder;
    });

    if (isEffectivelyUnbound) {
        // If we are hiding unbound actions, return false
        if (!showUnboundActions) return false;

        // If customizedOnly is true, unbound actions (which are defaults) should be hidden
        if (customizedOnly) return false;

        // If filtering by input type, check if there's at least one empty binding of that type
        // This logic is a bit fuzzy for "unbound", but preserves existing behavior
        if (currentFilter !== 'all') {
            if (!action.bindings) return true; // If no bindings at all, show it (it's a candidate for any type)

            return action.bindings.some(binding => {
                if (currentFilter === 'keyboard') return binding.input_type === 'Keyboard';
                if (currentFilter === 'mouse') return binding.input_type === 'Mouse';
                if (currentFilter === 'joystick') return binding.input_type === 'Joystick';
                if (currentFilter === 'gamepad') return binding.input_type === 'Gamepad';
                return false;
            });
        }
        return true;
    }

    // If we have bindings, check if any are visible
    return action.bindings.some(binding => {
        const trimmedInput = binding.input.trim();

        // Check if this is a cleared binding (check BEFORE trimming for the pattern)
        const isClearedBinding = !!binding.input.match(/^(js\d*|kb\d*|mouse\d*|gp\d*)_\s*$/);

        // Skip truly unbound bindings (placeholders), but keep cleared bindings that override defaults
        // We use the same strict check for placeholders here
        const isUnboundPlaceholder = binding.is_default && isClearedBinding && binding.display_name === 'Unbound';
        if (isUnboundPlaceholder) return false;

        // Also skip if input is empty and it's NOT a cleared binding (just in case)
        if ((!trimmedInput || trimmedInput === '') && !isClearedBinding) return false;

        // If customizedOnly is true, hide default bindings (unless it's a cleared binding)
        if (customizedOnly && binding.is_default && !isClearedBinding) return false;

        // Filter display based on current filter
        if (currentFilter !== 'all') {
            if (currentFilter === 'keyboard' && binding.input_type !== 'Keyboard') return false;
            if (currentFilter === 'mouse' && binding.input_type !== 'Mouse') return false;
            if (currentFilter === 'joystick' && binding.input_type !== 'Joystick') return false;
            if (currentFilter === 'gamepad' && binding.input_type !== 'Gamepad') return false;
        }

        return true;
    });
}

function renderKeybindings() {
    if (!currentKeybindings) return;

    // Debug: log a sample binding to see its structure
    if (currentKeybindings.action_maps && currentKeybindings.action_maps.length > 0) {
        const firstMap = currentKeybindings.action_maps[0];
        if (firstMap.actions && firstMap.actions.length > 0) {
            const firstAction = firstMap.actions[0];
            if (firstAction.bindings && firstAction.bindings.length > 0) {
                console.log('Sample binding structure:', firstAction.bindings[0]);
            }
        }
    }

    const container = document.getElementById('action-maps-container');

    // Filter action maps
    let actionMaps = currentKeybindings.action_maps;

    if (currentCategory) {
        actionMaps = actionMaps.filter(am => am.name === currentCategory);
    }

    let html = '';

    actionMaps.forEach(actionMap => {
        // Use ui_label if available (from merged bindings), otherwise use display_name
        const actionMapLabel = actionMap.ui_label || actionMap.display_name || actionMap.name;

        // Filter actions based on search term and input type filter
        let actions = actionMap.actions.filter(action => {
            // Use ui_label if available, otherwise display_name
            const displayName = action.ui_label || action.display_name || action.name;

            // Input type filter
            if (currentFilter !== 'all') {
                const hasMatchingBinding = action.bindings && action.bindings.some(binding => {
                    if (currentFilter === 'keyboard') return binding.input_type === 'Keyboard';
                    if (currentFilter === 'mouse') return binding.input_type === 'Mouse';
                    if (currentFilter === 'joystick') return binding.input_type === 'Joystick';
                    if (currentFilter === 'gamepad') return binding.input_type === 'Gamepad';
                    return true;
                });

                if (!hasMatchingBinding) return false;
            }

            // Customized only filter - if checked, skip actions without customized bindings for the current device type
            if (customizedOnly) {
                const hasCustomizedBinding = action.bindings && action.bindings.some(binding => {
                    // Check if this binding is customized (not default)
                    if (binding.is_default) return false;

                    // If a specific device type is selected, only count customizations for that type
                    if (currentFilter !== 'all') {
                        if (currentFilter === 'keyboard' && binding.input_type !== 'Keyboard') return false;
                        if (currentFilter === 'mouse' && binding.input_type !== 'Mouse') return false;
                        if (currentFilter === 'joystick' && binding.input_type !== 'Joystick') return false;
                        if (currentFilter === 'gamepad' && binding.input_type !== 'Gamepad') return false;
                    }

                    return true;
                });

                if (!hasCustomizedBinding) return false;
            }

            // Search filter - search in action name AND binding names
            if (searchTerm) {
                // Support OR operator with | and AND operator with +
                // If search contains +, all terms must match (AND logic)
                // If search contains |, any term can match (OR logic)
                const hasAndOperator = searchTerm.includes('+');
                const hasOrOperator = searchTerm.includes('|');

                let terms;
                let requireAll = false;

                if (hasAndOperator && !hasOrOperator) {
                    // Pure AND operator
                    terms = searchTerm.split('+').map(t => t.trim()).filter(t => t.length > 0);
                    requireAll = true;
                } else if (hasOrOperator && !hasAndOperator) {
                    // Pure OR operator
                    terms = searchTerm.split('|').map(t => t.trim()).filter(t => t.length > 0);
                    requireAll = false;
                } else if (hasAndOperator && hasOrOperator) {
                    // Mixed operators - treat + as primary separator (higher precedence)
                    terms = searchTerm.split('+').map(t => t.trim()).filter(t => t.length > 0);
                    requireAll = true;
                } else {
                    // No operators, treat as single term
                    terms = [searchTerm.trim()];
                    requireAll = false;
                }

                const matches = terms.map(term => {
                    // For OR-separated terms, each can have sub-terms
                    const subTerms = term.split('|').map(t => t.trim()).filter(t => t.length > 0);

                    return subTerms.some(subTerm => {
                        const searchInAction = displayName.toLowerCase().includes(subTerm) ||
                            action.name.toLowerCase().includes(subTerm);

                        const searchInBindings = action.bindings && action.bindings.some(binding =>
                            binding.display_name.toLowerCase().includes(subTerm) ||
                            binding.input.toLowerCase().includes(subTerm)
                        );

                        return searchInAction || searchInBindings;
                    });
                });

                if (requireAll) {
                    // All terms must match
                    if (!matches.every(m => m)) {
                        return false;
                    }
                } else {
                    // At least one term must match
                    if (!matches.some(m => m)) {
                        return false;
                    }
                }
            }

            return true;
        });

        if (actions.length === 0) return; // Skip empty action maps

        // Filter actions to only those with visible bindings, and collect them
        const visibleActions = actions.filter(action => actionHasVisibleBindings(action));

        // Skip this action map if there are no visible actions
        if (visibleActions.length === 0) return;

        html += `
      <div class="action-map">
        <div class="action-map-header" onclick="toggleActionMap(this)">
          <h3>${actionMapLabel}</h3>
          <div class="action-map-header-buttons">
            <button class="action-map-btn btn-clear" onclick="event.stopPropagation(); window.clearAllActionMapBindings('${actionMap.name}')" title="Clear all bindings in this category">Clear All</button>
            <button class="action-map-btn btn-reset" onclick="event.stopPropagation(); window.resetAllActionMapBindings('${actionMap.name}')" title="Reset all bindings in this category to defaults">Reset All</button>
          </div>
          <span class="action-map-toggle">▼</span>
        </div>
        <div class="actions-list">
    `;

        visibleActions.forEach(action => {
            const displayName = action.ui_label || action.display_name || action.name;
            const isCustomized = action.is_customized || false;
            const onHold = action.on_hold || false;

            html += `
        <div class="action-item ${isCustomized ? 'customized' : ''}">
          <div class="action-name">
            ${isCustomized ? '<span class="customized-indicator" title="Customized binding">★</span>' : ''}
            ${displayName}
          </div>
          <div class="action-bindings">
            ${renderActionBindings(action)}
          </div>
          <div class="action-buttons">
            <button class="action-btn btn-primary" onclick="window.openActionBindingsModal('${actionMap.name}', '${action.name}', '${displayName.replace(/'/g, "\\'")}')">Manage</button>
            <button class="action-btn btn-primary" onclick="window.clearActionBinding('${actionMap.name}', '${action.name}')" ${action.bindings && action.bindings.length > 0 ? '' : 'disabled'}>Clear</button>
            <button class="action-btn btn-primary" onclick="window.resetActionBinding('${actionMap.name}', '${action.name}')">Reset</button>
            <button class="action-btn btn-success" onclick="window.startBinding('${actionMap.name}', '${action.name}')">Bind</button>
          </div>
        </div>
      `;
        });

        html += `
        </div>
      </div>
    `;
    });

    container.innerHTML = html;

    // Setup scroll listener for sticky header category tracking
    setupScrollCategoryTracker();
}

function renderActionBindings(action) {
    if (!action.bindings || action.bindings.length === 0) {
        return '<span class="no-bindings">No bindings</span>';
    }

    return action.bindings.map(binding => {
        const inputType = binding.input_type || 'Unknown';
        const trimmedInput = binding.input.trim();

        // Skip cleared placeholder bindings (format: "js1_ ", "kb1_ ", etc. with trailing space)
        const isClearedBinding = binding.input.match(/^(js\d*|kb\d*|mouse\d*|gp\d*)_\s*$/);
        if (isClearedBinding) return '';

        // Skip truly unbound bindings
        if (!trimmedInput || trimmedInput === '') return '';

        // Format display name with activation mode appended
        let displayText = binding.display_name || binding.input;

        if (binding.activation_mode) {
            const formattedMode = binding.activation_mode
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            displayText += ` [${formattedMode}]`;
        }

        // Show multi-tap indicator if present
        if (binding.multi_tap) {
            displayText += ` [${binding.multi_tap}x Tap]`;
        }

        return `
            <span class="binding-tag ${inputType.toLowerCase()}">
                <span class="binding-tag-text">${displayText}</span>
                <button class="binding-tag-remove" onclick="window.removeBindingTag(event, '${action.name.replace(/'/g, "\\'")}', '${binding.input.replace(/'/g, "\\'")}')" title="Remove this binding">×</button>
            </span>
        `;
    }).filter(Boolean).join('');
}

// Global success message helper
window.showSuccessMessage = function (message) {
    // Use the toast system if available
    if (window.toast && window.toast.success) {
        window.toast.success(message);
        return;
    }

    // Fallback: Create a temporary success indicator
    const indicator = document.createElement('div');
    indicator.textContent = message;
    indicator.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background-color: #28a745;
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

    document.body.appendChild(indicator);

    // Remove after 2 seconds
    setTimeout(() => {
        indicator.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => indicator.remove(), 300);
    }, 2000);
};

// Debounce the main render to prevent UI freezing on typing
const debouncedRender = debounce(() => {
    renderKeybindings();
}, 300);

// Use this in your HTML input: oninput="window.handleSearchInput(this.value)"
window.handleSearchInput = function (value) {
    searchTerm = value;
    debouncedRender();
};


// Refresh bindings from backend and update UI
async function refreshBindings() {
    try {
        console.log('Refreshing bindings from backend...');
        currentKeybindings = await invoke('get_merged_bindings');
        console.log('Got merged bindings with', currentKeybindings.action_maps?.length, 'action maps');

        // Update working copy with latest changes
        if (currentKeybindings) {
            // Cache only the user customizations (delta), not the full merged view
            await cacheUserCustomizations();
            localStorage.setItem('hasUnsavedChanges', hasUnsavedChanges.toString());
            console.log('Updated user customizations delta in localStorage');
        }

        renderKeybindings();
    } catch (error) {
        console.error('Error refreshing bindings:', error);
    }
}

// Helper function to process a raw input result
const processInput = (result) => {
    console.log('INPUT DETECTED (raw):', result.display_name, result.input_string);

    // Apply the fixed mapping logic
    const mappedInput = applyJoystickMapping(result.input_string, result.device_uuid);
    if (mappedInput === null) return null;

    let scFormattedInput;

    // Handle Axis Naming (X, Y, RotZ, etc.)
    if (result.hid_axis_name && mappedInput.includes('_axis')) {
        const hidNameLower = result.hid_axis_name.toLowerCase().replace(/\s+/g, '');
        if (hidNameLower === 'hatswitch') {
            scFormattedInput = toStarCitizenFormat(mappedInput);
        } else {
            const scAxisName = hidNameLower === 'rx' ? 'rotx' :
                hidNameLower === 'ry' ? 'roty' :
                    hidNameLower === 'rz' ? 'rotz' : hidNameLower;
            scFormattedInput = mappedInput.replace(/axis\d+(?:_(positive|negative))?/, scAxisName);
        }
    } else {
        scFormattedInput = toStarCitizenFormat(mappedInput);
    }

    // Add modifiers
    if (result.modifiers && result.modifiers.length > 0) {
        const modifierOrder = ['LALT', 'RALT', 'LCTRL', 'RCTRL', 'LSHIFT', 'RSHIFT'];
        const sortedModifiers = result.modifiers
            .filter(mod => modifierOrder.includes(mod))
            .sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))
            .map(mod => mod.toLowerCase());

        if (sortedModifiers.length > 0) {
            const prefixMatch = scFormattedInput.match(/^(kb\d*|js\d*|mouse\d*|gp\d*)_(.+)$/);
            if (prefixMatch) {
                scFormattedInput = `${prefixMatch[1]}_${sortedModifiers.join('+')}+${prefixMatch[2]}`;
            } else {
                scFormattedInput = sortedModifiers.join('+') + '+' + scFormattedInput;
            }
        }
    }

    return {scFormattedInput, displayName: result.display_name, originalResult: result};
};


// Helper function to add a button to the selection UI
const addDetectedInputButton = (processedInput) => {
    if (!selectionContainer) return;

    const btn = document.createElement('button');
    btn.className = 'input-selection-btn';
    btn.innerHTML = `
        <span class="input-selection-icon">🎮</span>
        <span class="input-selection-name">${processedInput.displayName}</span>
      `;

    const inputKey = processedInput.scFormattedInput;

    btn.addEventListener('click', async () => {
        const selectedInput = allDetectedInputs.get(inputKey);

        if (!selectedInput) return;

        selectedInputKey = inputKey;
        updateSelectionButtonStates();
        setSelectionMessage(`Selected: ${selectedInput.displayName}`);

        stopDetection('user-selection-option');

        const conflicts = await setPendingBindingSelection(selectedInput);
        updateConflictDisplay(conflicts);
    });

    selectionButtons.set(inputKey, btn);
    selectionContainer.appendChild(btn);
    updateSelectionButtonStates();
};

async function startBinding(actionMapName, actionName, actionDisplayName = null) {
    if (bindingMode) return;

    bindingMode = true;
    isDetectionActive = true;
    currentBindingAction = {actionMapName, actionName};
    currentBindingId = Date.now(); // Session ID

    // UI Reset
    allDetectedInputs.clear();
    selectedInputKey = null;
    window.pendingBinding = null;

    const modal = document.getElementById('binding-modal');
    statusEl = document.getElementById('binding-modal-status');
    const countdownEl = document.getElementById('binding-modal-countdown');
    bindingModalSaveBtn = document.getElementById('binding-modal-save-btn');

    document.getElementById('binding-modal-action').textContent = 'Binding Action: ' + (actionDisplayName || actionName);
    statusEl.innerHTML = 'Press any button, key, mouse button, or move any axis...';
    statusEl.className = 'binding-status';
    countdownEl.textContent = '10';
    setBindingSaveEnabled(false);

    // Clear dynamic UI
    if (document.getElementById('binding-conflict-display')) {
        document.getElementById('binding-conflict-display').style.display = 'none';
    }
    const amSelect = document.getElementById('activation-mode-select');
    if (amSelect) amSelect.value = '';

    modal.style.display = 'flex';

    // Countdown Logic
    let remaining = 10;
    clearPrimaryCountdown();
    countdownInterval = setInterval(() => {
        remaining--;
        countdownEl.textContent = remaining;
        if (remaining <= 0) {
            clearPrimaryCountdown();
        }
    }, 1000);

    // 1. Rust Backend Listeners
    try {
        const thisBindingId = currentBindingId;

        window.currentInputDetectionUnlisten = await listen('input-detected', (event) => {
            if (!isDetectionActive || currentBindingId !== thisBindingId) return;
            const processed = processInput(event.payload);
            handleDetectedInput(processed);
        });

        window.currentCompletionUnlisten = await listen('input-detection-complete', (event) => {
            if (!isDetectionActive || currentBindingId !== thisBindingId) return;

            // If we found inputs, ignore the timeout completion
            if (allDetectedInputs.size > 0) return;

            stopDetection('backend-timeout');
            statusEl.textContent = 'No input detected - timed out';
            if (countdownEl) countdownEl.textContent = '';

            setTimeout(() => {
                if (currentBindingId === thisBindingId && bindingMode) closeBindingModal();
            }, 2000);
        });

        // 2. Mouse Listeners
        window.mouseDetectionHandler = (event) => {
            if (!isDetectionActive || !window.mouseDetectionActive || window.getIgnoreModalMouseInputs()) return;
            if (!document.getElementById('binding-modal').contains(event.target)) return;

            event.preventDefault();
            event.stopPropagation();

            const buttonMap = {0: 'mouse1', 1: 'mouse3', 2: 'mouse2', 3: 'mouse4', 4: 'mouse5'};
            const displayNameMap = {'mouse1': 'Left Mouse', 'mouse2': 'Right Mouse', 'mouse3': 'Middle Mouse'};

            const scButton = buttonMap[event.button] || `mouse${event.button + 1}`;

            const synthetic = {
                input_string: scButton,
                display_name: displayNameMap[scButton] || `Mouse Button ${event.button}`,
                device_type: 'Mouse',
                modifiers: []
            };

            handleDetectedInput(processInput(synthetic));
        };
        // ... (Add contextMenu, mouseUp, beforeUnload as before)
        window.mouseUpHandler = (e) => {
            if (window.mouseDetectionActive) {
                e.preventDefault();
            }
        };
        window.contextMenuHandler = (e) => {
            if (window.mouseDetectionActive && document.getElementById('binding-modal').contains(e.target)) e.preventDefault();
        };
        window.beforeUnloadHandler = (e) => {
            if (window.mouseDetectionActive) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        document.addEventListener('mousedown', window.mouseDetectionHandler, true);
        document.addEventListener('mouseup', window.mouseUpHandler, true);
        document.addEventListener('contextmenu', window.contextMenuHandler, true);
        window.addEventListener('beforeunload', window.beforeUnloadHandler, true);
        window.mouseDetectionActive = true;

        // 3. Keyboard Listeners
        keyboardDetectionActive = true;
        keyboardDetectionHandler = (event) => {
            if (!isDetectionActive || !keyboardDetectionActive) return;
            event.preventDefault();
            event.stopPropagation();

            // Modifier Tracking
            if (event.code === 'AltLeft') window._lastAltKeyPressed = 'LALT';
            if (event.code === 'AltRight') window._lastAltKeyPressed = 'RALT';
            // ... (keep rest of modifier tracking from original code)

            const scKey = convertKeyCodeToSC(event.code, event.key);
            const modifiers = [];
            if (event.shiftKey && scKey !== 'lshift' && scKey !== 'rshift') modifiers.push('LSHIFT'); // Simplified logic for brevity
            if (event.ctrlKey && scKey !== 'lctrl' && scKey !== 'rctrl') modifiers.push('LCTRL');
            if (event.altKey && scKey !== 'lalt' && scKey !== 'ralt') modifiers.push(window._lastAltKeyPressed || 'LALT');

            const synthetic = {
                input_string: `kb1_${scKey}`,
                display_name: `Keyboard - ${event.code}`,
                device_type: 'Keyboard',
                modifiers: modifiers
            };

            handleDetectedInput(processInput(synthetic));
        };
        document.addEventListener('keydown', keyboardDetectionHandler, true);

        // Start Rust Backend Detection
        invoke('wait_for_inputs_with_events', {
            sessionId: thisBindingId.toString(),
            initialTimeoutSecs: 10,
            collectDurationSecs: 2
        }).catch(e => {
            console.error('Rust detection failed', e);
            closeBindingModal();
        });

    } catch (e) {
        console.error(e);
        closeBindingModal();
    }
}


function cancelBinding() {
    closeBindingModal();
}

async function clearBinding() {
    if (!currentBindingAction) return;

    try {
        await invoke('update_binding', {
            actionMapName: currentBindingAction.actionMapName,
            actionName: currentBindingAction.actionName,
            newInput: ''
        });

        // Mark as unsaved
        hasUnsavedChanges = true;
        if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();

        await refreshBindings();
        closeBindingModal();
    } catch (error) {
        console.error('Error clearing binding:', error);
        if (window.showAlert) await window.showAlert(`Error clearing binding: ${error}`, 'Error');
    }
}

function closeBindingModal() {
    console.log('[TIMER] closeBindingModal called');
    stopDetection('modal-close');

    bindingMode = false;
    currentBindingAction = null;
    document.getElementById('binding-modal').style.display = 'none';
    setBindingSaveEnabled(false);
}

async function resetBinding() {
    if (!currentBindingAction) return;

    try {
        const actionMapName = currentBindingAction.actionMapName;
        const actionName = currentBindingAction.actionName;

        // Call backend to reset binding (remove customization)
        // This will cause the action to use defaults from AllBinds again
        await invoke('reset_binding', {
            actionMapName: actionMapName,
            actionName: actionName
        });

        // Mark as unsaved
        hasUnsavedChanges = true;
        if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();

        // Refresh to show default bindings
        await refreshBindings();
        closeBindingModal();
    } catch (error) {
        console.error('Error resetting binding:', error);
        // Fallback to old method if reset_binding doesn't exist
        if (error.toString().includes('not found')) {
            console.log('Using fallback reset method');
            await fallbackResetBinding();
        } else {
            if (window.showAlert) await window.showAlert(`Error resetting binding: ${error}`, 'Error');
        }
    }
}

// Fallback method for reset if backend doesn't have reset_binding command yet
async function fallbackResetBinding() {
    if (!currentBindingAction) return;

    try {
        const actionMapName = currentBindingAction.actionMapName;
        const actionName = currentBindingAction.actionName;

        // Clear the binding by setting empty input
        await invoke('update_binding', {
            actionMapName: actionMapName,
            actionName: actionName,
            newInput: ''
        });

        hasUnsavedChanges = true;
        if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();
        await refreshBindings();
        closeBindingModal();
    } catch (error) {
        console.error('Error in fallback reset:', error);
        if (window.showAlert) await window.showAlert(`Error resetting binding: ${error}`, 'Error');
    }
}

// Make startBinding available globally
window.startBinding = startBinding;
window.cancelBinding = cancelBinding;
window.clearBinding = clearBinding;
window.closeBindingModal = closeBindingModal;
window.resetBinding = resetBinding;

// =============================================================================
//  FIXED MAPPING LOGIC
// =============================================================================

function applyJoystickMapping(inputString, deviceUuid) {
    // Extract the backend-assigned prefix (e.g., "js1", "gp2")
    const match = inputString.match(/^(js|gp)(\d+)_/);
    if (!match) return inputString;

    const deviceNum = parseInt(match[2]); // 1, 2...
    const calculatedIndex = deviceNum - 1; // 0, 1...

    let effectiveUuid = deviceUuid;

    // FIX: If raw UUID lookup fails, try the Indexed UUID (e.g. uuid-idx1)
    if (deviceUuid && !deviceUuidToAutoPrefix[deviceUuid]) {
        const indexedUuid = `${deviceUuid}-idx${calculatedIndex}`;
        if (deviceUuidToAutoPrefix[indexedUuid]) {
            console.log(`[KEYBINDINGS] Inferred Indexed UUID: ${indexedUuid}`);
            effectiveUuid = indexedUuid;
        }
    }

    let autoDetectedPrefix = match[0].replace('_', '');
    if (effectiveUuid && deviceUuidToAutoPrefix[effectiveUuid]) {
        autoDetectedPrefix = deviceUuidToAutoPrefix[effectiveUuid];
    }

    // Check for Custom Override
    // Priority: 1. Window Global (Device Manager active) 2. Local Storage (Device Manager inactive)
    let finalPrefix = autoDetectedPrefix;
    let overrideFound = false;

    if (window.applyDevicePrefixOverride && effectiveUuid) {
        // Try global function first
        const tempInput = inputString.replace(/^(js|gp)\d+_/, `${autoDetectedPrefix}_`);
        const overriddenInput = window.applyDevicePrefixOverride(tempInput, effectiveUuid);

        if (overriddenInput !== tempInput) {
            const overrideMatch = overriddenInput.match(/^(js|gp\d+)_/);
            if (overrideMatch) {
                finalPrefix = overrideMatch[1];
                overrideFound = true;
            }
        }
    }

    // Fallback to local storage lookup if global function didn't apply/exist
    if (!overrideFound && effectiveUuid && localPrefixMapping[effectiveUuid]) {
        finalPrefix = localPrefixMapping[effectiveUuid];
        // console.log(`[KEYBINDINGS] Applied local override: ${autoDetectedPrefix} -> ${finalPrefix}`);
    }

    return inputString.replace(/^(js|gp)\d+_/, `${finalPrefix}_`);
}


async function setPendingBindingSelection(processedInput) {
    if (!currentBindingAction) return [];

    const {actionMapName, actionName} = currentBindingAction;
    const mappedInput = processedInput.scFormattedInput;

    // Check for conflicts by searching through all actions
    const conflicts = [];
    if (window.getCurrentKeybindings()) {
        const keybindings = window.getCurrentKeybindings();
        keybindings.action_maps.forEach(actionMap => {
            actionMap.actions.forEach(action => {
                // Skip the current action we're binding
                if (actionMap.name === actionMapName && action.name === actionName) return;

                // Check if this action has a binding that matches our new input
                if (action.bindings) {
                    action.bindings.forEach(binding => {
                        if (binding.input === mappedInput) {
                            conflicts.push({
                                action_map: actionMap.name,
                                action_name: action.name,
                                action_display_name: action.ui_label || action.display_name || action.name,
                                input: binding.input
                            });
                        }
                    });
                }
            });
        });
    }

    window.pendingBinding = {
        actionMapName,
        actionName,
        mappedInput,
        conflicts
    };

    // Enable save button
    setBindingSaveEnabled(true);

    return conflicts;
}

function updateConflictDisplay(conflicts) {
    const conflictDisplay = document.getElementById('binding-conflict-display');
    if (!conflictDisplay) return;

    if (!conflicts || conflicts.length === 0) {
        conflictDisplay.style.display = 'none';
        conflictDisplay.innerHTML = '';
        return;
    }

    const conflictItems = conflicts.map(c => {
        const actionLabel = (c.action_label && !c.action_label.startsWith('@'))
            ? c.action_label
            : c.action_name;

        const mapLabel = (c.action_map_label && !c.action_map_label.startsWith('@'))
            ? c.action_map_label
            : c.action_map_name;

        return `
      <div class="conflict-item-inline">
        <div class="conflict-action-label">${actionLabel}</div>
        <div class="conflict-map-label">${mapLabel}</div>
      </div>
    `;
    }).join('');

    conflictDisplay.innerHTML = `
    <div class="conflict-warning-header">
      <span class="conflict-icon">⚠️</span>
      <span>This input is already used by ${conflicts.length} action${conflicts.length > 1 ? 's' : ''}:</span>
    </div>
    <div class="conflict-list-inline">
      ${conflictItems}
    </div>
  `;
    conflictDisplay.style.display = 'block';
}

function updateSelectionButtonStates() {
    selectionButtons.forEach((btn, key) => {
        if (key === selectedInputKey) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
}

function setSelectionMessage(message) {
    if (selectionMessageEl) {
        selectionMessageEl.textContent = message;
    }
}

// Conflict Modal Functions
function showConflictModal(conflicts) {
    const modal = document.getElementById('conflict-modal');
    const conflictList = document.getElementById('conflict-list');

    // Populate conflict list
    conflictList.innerHTML = conflicts.map(c => {
        const actionLabel = (c.action_label && !c.action_label.startsWith('@'))
            ? c.action_label
            : c.action_name;

        const mapLabel = (c.action_map_label && !c.action_map_label.startsWith('@'))
            ? c.action_map_label
            : c.action_map_name;

        return `
      <div class="conflict-item">
        <div class="conflict-action-label">${actionLabel}</div>
        <div class="conflict-map-label">${mapLabel}</div>
      </div>
    `;
    }).join('');

    modal.style.display = 'flex';
}

function closeConflictModal() {
    const modal = document.getElementById('conflict-modal');
    modal.style.display = 'none';

    // Clear pending binding
    window.pendingBinding = null;
    setBindingSaveEnabled(false);

    // Update binding modal status
    document.getElementById('binding-modal-status').textContent = 'Binding cancelled';

    setTimeout(() => {
        closeBindingModal();
    }, 1000);
}

async function confirmConflictBinding() {
    const modal = document.getElementById('conflict-modal');
    modal.style.display = 'none';

    if (window.pendingBinding) {
        const {actionMapName, actionName, mappedInput, multiTap} = window.pendingBinding;

        // Get the selected activation mode
        const activationModeSelect = document.getElementById('activation-mode-select');
        const activationMode = activationModeSelect ? activationModeSelect.value : null;

        await applyBinding(actionMapName, actionName, mappedInput, multiTap, activationMode);
        window.pendingBinding = null;
        setBindingSaveEnabled(false);
    }
}

async function applyBinding(actionMapName, actionName, mappedInput, multiTap = null, activationMode = null) {
    console.log('Calling update_binding...');
    // Update the binding in backend
    await invoke('update_binding', {
        actionMapName: actionMapName,
        actionName: actionName,
        newInput: mappedInput,
        multiTap: multiTap,
        activationMode: activationMode
    });
    console.log('update_binding completed');

    // Mark as unsaved
    hasUnsavedChanges = true;
    if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();

    // Immediately refresh and save to localStorage
    console.log('Binding updated, refreshing data...');
    await refreshBindings();
    console.log('Bindings refreshed and saved to localStorage');

    // Close modal after a short delay
    setTimeout(() => {
        closeBindingModal();
    }, 1000);
}

/**
 * Remove a binding by clicking the X button on a binding tag
 * Uses the same logic as the "Manage Bindings" modal remove button
 */
async function removeBindingTag(event, actionName, inputToClear) {
    event.preventDefault();
    event.stopPropagation();

    // We need to find the action map name by searching through current keybindings
    if (!currentKeybindings) return;

    let actionMapName = null;
    let actionToModify = null;

    // Find which action map contains this action
    for (const actionMap of currentKeybindings.action_maps) {
        const action = actionMap.actions.find(a => a.name === actionName);
        if (action) {
            actionMapName = actionMap.name;
            actionToModify = action;
            break;
        }
    }

    if (!actionMapName || !actionToModify) return;

    // Use the same removeBinding function from main.js which handles confirmation
    const removalSucceeded = await window.removeBinding(actionMapName, actionName, inputToClear);
    if (removalSucceeded) {
        // Refresh the keybindings to update the UI
        await refreshBindings();
    }
}

/**
 * Clear all bindings for all actions within an action map
 * @param {string} actionMapName - The name of the action map (e.g., 'spaceship_general')
 */
async function clearAllActionMapBindings(actionMapName) {
    if (!currentKeybindings) return;

    // Find the action map
    const actionMap = currentKeybindings.action_maps.find(am => am.name === actionMapName);
    if (!actionMap) {
        console.error('Action map not found:', actionMapName);
        return;
    }

    const actionMapLabel = actionMap.ui_label || actionMap.display_name || actionMap.name;

    // Show confirmation dialog
    const confirmed = await window.showConfirmation(
        `Clear all bindings in "${actionMapLabel}"? This will clear bindings for ${actionMap.actions.length} actions.`,
        'Clear All Bindings',
        'Clear All',
        'Cancel'
    );

    if (!confirmed) return;

    try {
        // Process each action
        for (const action of actionMap.actions) {
            if (!action.bindings || action.bindings.length === 0) continue;

            // Collect input types to clear
            const inputTypesToClear = new Set();
            action.bindings.forEach(binding => {
                if (binding.input && binding.input.trim()) {
                    if (binding.input.startsWith('js')) inputTypesToClear.add('joystick');
                    else if (binding.input.startsWith('kb')) inputTypesToClear.add('keyboard');
                    else if (binding.input.startsWith('mouse')) inputTypesToClear.add('mouse');
                    else if (binding.input.startsWith('gp')) inputTypesToClear.add('gamepad');
                }
            });

            // Clear each input type
            for (const inputType of inputTypesToClear) {
                let clearedInput = '';
                switch (inputType) {
                    case 'joystick':
                        clearedInput = 'js1_ ';
                        break;
                    case 'keyboard':
                        clearedInput = 'kb1_ ';
                        break;
                    case 'mouse':
                        clearedInput = 'mouse1_ ';
                        break;
                    case 'gamepad':
                        clearedInput = 'gp1_ ';
                        break;
                }

                if (clearedInput) {
                    await invoke('update_binding', {
                        actionMapName: actionMapName,
                        actionName: action.name,
                        newInput: clearedInput
                    });
                }
            }
        }

        // Mark as unsaved and refresh
        hasUnsavedChanges = true;
        if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();
        await refreshBindings();

        window.showSuccessMessage(`Cleared all bindings in "${actionMapLabel}"`);
    } catch (error) {
        console.error('Error clearing action map bindings:', error);
        if (window.showAlert) await window.showAlert(`Error clearing bindings: ${error}`, 'Error');
    }
}

/**
 * Reset all bindings for all actions within an action map to their defaults
 * @param {string} actionMapName - The name of the action map (e.g., 'spaceship_general')
 */
async function resetAllActionMapBindings(actionMapName) {
    if (!currentKeybindings) return;

    // Find the action map
    const actionMap = currentKeybindings.action_maps.find(am => am.name === actionMapName);
    if (!actionMap) {
        console.error('Action map not found:', actionMapName);
        return;
    }

    const actionMapLabel = actionMap.ui_label || actionMap.display_name || actionMap.name;

    // Show confirmation dialog
    const confirmed = await window.showConfirmation(
        `Reset all bindings in "${actionMapLabel}" to defaults? This will reset ${actionMap.actions.length} actions.`,
        'Reset All to Defaults',
        'Reset All',
        'Cancel'
    );

    if (!confirmed) return;

    try {
        // Process each action
        for (const action of actionMap.actions) {
            try {
                await invoke('reset_binding', {
                    actionMapName: actionMapName,
                    actionName: action.name
                });
            } catch (resetError) {
                // If reset_binding doesn't exist, try clearing instead
                if (resetError.toString().includes('not found')) {
                    await invoke('update_binding', {
                        actionMapName: actionMapName,
                        actionName: action.name,
                        newInput: ''
                    });
                }
            }
        }

        // Mark as unsaved and refresh
        hasUnsavedChanges = true;
        if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();
        await refreshBindings();

        window.showSuccessMessage(`Reset all bindings in "${actionMapLabel}" to defaults`);
    } catch (error) {
        console.error('Error resetting action map bindings:', error);
        if (window.showAlert) await window.showAlert(`Error resetting bindings: ${error}`, 'Error');
    }
}

/**
 * Swap all joystick prefixes (js1 <-> js2) in the current keybindings.
 * This is useful when Star Citizen flips device associations.
 */
async function swapJoystickPrefixes() {
    if (!currentKeybindings) return;

    try {
        let swapCount = 0;
        const updatesToSync = [];

        // 1. Calculate Swaps in Memory
        for (const actionMap of currentKeybindings.action_maps) {
            for (const action of actionMap.actions) {
                if (!action.bindings) continue;

                for (const binding of action.bindings) {
                    if (!binding.input) continue;

                    let newInput = null;
                    let isModified = false;

                    // Direct Swap Logic
                    if (binding.input.match(/^js1_/i)) {
                        newInput = binding.input.replace(/^js1_/i, 'js2_');
                        if (binding.display_name && binding.display_name.includes('Joystick 1')) {
                            binding.display_name = binding.display_name.replace('Joystick 1', 'Joystick 2');
                        }
                        isModified = true;
                    } else if (binding.input.match(/^js2_/i)) {
                        newInput = binding.input.replace(/^js2_/i, 'js1_');
                        if (binding.display_name && binding.display_name.includes('Joystick 2')) {
                            binding.display_name = binding.display_name.replace('Joystick 2', 'Joystick 1');
                        }
                        isModified = true;
                    }

                    if (isModified && newInput) {
                        // Update local object immediately for UI responsiveness
                        binding.input = newInput;
                        swapCount++;

                        // Queue for backend sync
                        updatesToSync.push({
                            actionMapName: actionMap.name,
                            actionName: action.name,
                            newInput: newInput,
                            multiTap: binding.multi_tap || null,
                            activationMode: binding.activation_mode || null
                        });
                    }
                }
            }
        }

        // 2. Sync with Backend
        if (swapCount > 0) {
            if (window.showSuccessMessage) window.showSuccessMessage(`Syncing ${swapCount} swaps...`);

            // Execute in batches to avoid choking the IPC or backend
            const batchSize = 20;
            for (let i = 0; i < updatesToSync.length; i += batchSize) {
                const batch = updatesToSync.slice(i, i + batchSize);
                await Promise.all(batch.map(u =>
                    invoke('update_binding', {
                        actionMapName: u.actionMapName,
                        actionName: u.actionName,
                        newInput: u.newInput,
                        multiTap: u.multiTap,
                        activationMode: u.activationMode
                    })
                ));
            }

            // 3. Finalize
            hasUnsavedChanges = true;
            if (window.updateUnsavedIndicator) window.updateUnsavedIndicator();

            if (window.renderKeybindings) window.renderKeybindings();
            if (window.cacheUserCustomizations) await window.cacheUserCustomizations();

            if (window.showSuccessMessage) window.showSuccessMessage(`Swapped ${swapCount} bindings (JS1 ↔ JS2)`);
        } else {
            if (window.showSuccessMessage) window.showSuccessMessage('No JS1/JS2 bindings found to swap');
        }

    } catch (error) {
        console.error('Error swapping prefixes:', error);
        if (window.showAlert) window.showAlert(`Error swapping: ${error}`, 'Error');
    }
}

// Make startBinding available globally
window.startBinding = startBinding;
window.cancelBinding = cancelBinding;
window.clearBinding = clearBinding;
window.closeBindingModal = closeBindingModal;
window.resetBinding = resetBinding;

// Make action map functions globally available
window.clearAllActionMapBindings = clearAllActionMapBindings;
window.resetAllActionMapBindings = resetAllActionMapBindings;
window.swapJoystickPrefixes = swapJoystickPrefixes;

// Make conflict functions globally available
window.showConflictModal = showConflictModal;
window.closeConflictModal = closeConflictModal;
window.confirmConflictBinding = confirmConflictBinding;

// Make keybinding management functions globally available
window.loadKeybindingsFile = loadKeybindingsFile;
window.newKeybinding = newKeybinding;
window.saveKeybindings = saveKeybindings;
window.saveKeybindingsAs = saveKeybindingsAs;
window.displayKeybindings = displayKeybindings;
window.cacheUserCustomizations = cacheUserCustomizations;
window.renderKeybindings = renderKeybindings;
window.applyBinding = applyBinding;
window.cancelBinding = cancelBinding;
window.setBindingSaveEnabled = setBindingSaveEnabled;
window.loadCategoryMappings = loadCategoryMappings;
window.refreshBindings = refreshBindings;
window.stopDetection = stopDetection;
window.removeBindingTag = removeBindingTag;
window.buildDeviceUuidMapping = buildDeviceUuidMapping;

// Make state variables globally available
window.getShowUnboundActions = () => showUnboundActions;
window.setShowUnboundActions = (value) => {
    showUnboundActions = value;
};
window.getCustomizedOnly = () => customizedOnly;
window.setCustomizedOnly = (value) => {
    customizedOnly = value;
};
window.getCurrentFilter = () => currentFilter;
window.setCurrentFilter = (value) => {
    currentFilter = value;
};
window.getSearchTerm = () => searchTerm;
window.setSearchTerm = (value) => {
    searchTerm = value;
};
window.getCurrentFilename = () => currentFilename;
window.getCurrentKeybindings = () => currentKeybindings;
window.getHasUnsavedChanges = () => hasUnsavedChanges;
window.setHasUnsavedChanges = (value) => {
    hasUnsavedChanges = value;
};
window.getIgnoreModalMouseInputs = () => ignoreModalMouseInputs;
window.setIgnoreModalMouseInputs = (value) => {
    ignoreModalMouseInputs = value;
};
window.getIsDetectionActive = () => isDetectionActive;
window.isBindingModalOpen = () => bindingMode;
window.applyJoystickMapping = applyJoystickMapping;
window.processInput = processInput;
window.buildDeviceUuidMapping = buildDeviceUuidMapping;
/**
 * Toggle the visibility of an action map's actions list
 * @param {HTMLElement} headerEl - The action-map-header element that was clicked
 */
window.toggleActionMap = function (headerEl) {
    const actionsList = headerEl.nextElementSibling;
    const toggle = headerEl.querySelector('.action-map-toggle');

    if (actionsList.style.display === 'none') {
        actionsList.style.display = 'grid';
        toggle.classList.remove('collapsed');
    } else {
        actionsList.style.display = 'none';
        toggle.classList.add('collapsed');
    }
};

window.handleDetectedInput = handleDetectedInput;
window.handleSearchInput = window.handleSearchInput || function (v) {
    searchTerm = v;
    debouncedRender();
};
loadPrefixMappingsLocal();

/**
 * Setup scroll listener to track which category header is visible
 * Updates the profile-name header with the current visible category
 */
function setupScrollCategoryTracker() {
    const scrollContainer = document.getElementById('action-maps-container');
    if (!scrollContainer) return;

    // Remove any existing listener to avoid duplicates
    if (window.categoryTrackerScrollListener) {
        scrollContainer.removeEventListener('scroll', window.categoryTrackerScrollListener);
    }

    window.categoryTrackerScrollListener = () => {
        const profileNameEl = document.getElementById('profile-name');
        if (!profileNameEl) return;

        // Get all action map headers (use the correct class)
        const headers = document.querySelectorAll('.action-map-header');
        if (headers.length === 0) return;

        let lastVisibleCategory = null;
        const scrollTop = scrollContainer.scrollTop;

        // Iterate through headers to find the last one that's above the scroll position
        headers.forEach((header) => {
            const headerTop = header.offsetTop - scrollContainer.offsetTop;
            const h3 = header.querySelector('h3');
            const headerText = h3 ? h3.textContent.trim() : null;

            if (!headerText) return;

            // Check if header is above current scroll position + small threshold
            if (headerTop <= scrollTop + 10) {
                lastVisibleCategory = headerText;
            }
        });

        // Update the profile name if we found a category
        if (lastVisibleCategory && profileNameEl.textContent !== lastVisibleCategory) {
            profileNameEl.textContent = lastVisibleCategory;
        } else if (!lastVisibleCategory && profileNameEl.textContent !== 'Keybindings') {
            // Reset to default if no category is visible
            profileNameEl.textContent = 'Keybindings';
        }
    };

    scrollContainer.addEventListener('scroll', window.categoryTrackerScrollListener);
}