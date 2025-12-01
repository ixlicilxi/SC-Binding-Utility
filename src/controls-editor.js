/**
 * Controls Editor Module
 * 
 * Provides an editor for Star Citizen control options including:
 * - Inversion settings
 * - Sensitivity curves (nonlinearity_curve)
 * - Exponent values
 * 
 * Supports keyboard, gamepad, and joystick option trees.
 */

const { invoke } = window.__TAURI__.core;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let controlsData = null; // Parsed optiontree data
let currentDeviceType = 'keyboard'; // 'keyboard', 'gamepad', 'joystick'
let currentJoystickInstance = 1; // For joystick, which instance (1-8)
let selectedNode = null; // Currently selected node in tree
let hasUnsavedChanges = false;

// User's custom settings (overrides for default values)
let userSettings = {
    keyboard: {},
    gamepad: {},
    joystick: {} // Each key is instance number, value is settings object
};

// ============================================================================
// INITIALIZATION
// ============================================================================

window.initializeControlsEditor = async function ()
{
    console.log('[CONTROLS-EDITOR] Initializing...');

    // Set up event listeners
    setupDeviceTabListeners();

    // Parse optiontree data from AllBinds.xml
    await loadControlsData();

    // Render initial view
    renderDeviceTabs();
    renderTree();

    console.log('[CONTROLS-EDITOR] Initialization complete');
};

function setupDeviceTabListeners()
{
    const tabContainer = document.getElementById('controls-device-tabs');
    if (!tabContainer) return;

    tabContainer.addEventListener('click', (e) =>
    {
        const tab = e.target.closest('.controls-device-tab');
        if (!tab) return;

        const deviceType = tab.dataset.device;
        if (deviceType && deviceType !== currentDeviceType)
        {
            switchDeviceType(deviceType);
        }
    });

    // Instance selector for joystick
    const instanceSelector = document.getElementById('controls-instance-select');
    if (instanceSelector)
    {
        instanceSelector.addEventListener('change', (e) =>
        {
            currentJoystickInstance = parseInt(e.target.value) || 1;
            renderTree();
            clearSettingsPanel();
        });
    }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadControlsData()
{
    try
    {
        // Get the parsed optiontree data from the backend
        const data = await invoke('get_control_options');
        controlsData = data;
        console.log('[CONTROLS-EDITOR] Loaded control options:', controlsData);
    } catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error loading control options:', error);
        // If backend doesn't have this endpoint yet, we'll parse from the frontend
        await loadControlsDataFromXml();
    }
}

async function loadControlsDataFromXml()
{
    // Fallback: Parse optiontree data from the AllBinds.xml file
    // This would be called if the backend doesn't have the get_control_options command yet
    try
    {
        const xmlContent = await invoke('get_all_binds_xml');
        controlsData = parseOptionTreesFromXml(xmlContent);
        console.log('[CONTROLS-EDITOR] Parsed control options from XML:', controlsData);
    } catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error parsing XML:', error);
        controlsData = getDefaultControlsData();
    }
}

function parseOptionTreesFromXml(xmlString)
{
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const result = {
        keyboard: null,
        gamepad: null,
        joystick: null
    };

    const optionTrees = xmlDoc.querySelectorAll('optiontree');

    optionTrees.forEach(tree =>
    {
        const type = tree.getAttribute('type');
        if (type && result.hasOwnProperty(type))
        {
            result[type] = parseOptionGroup(tree, type);
            result[type].instances = parseInt(tree.getAttribute('instances')) || 1;
            result[type].sensitivityMin = parseFloat(tree.getAttribute('UISensitivityMin')) || 0.01;
            result[type].sensitivityMax = parseFloat(tree.getAttribute('UISensitivityMax')) || 2.0;
        }
    });

    return result;
}

function parseOptionGroup(element, deviceType, parentPath = '')
{
    const node = {
        name: element.getAttribute('name') || 'root',
        label: element.getAttribute('UILabel') || element.getAttribute('name') || 'Unknown',
        path: parentPath ? `${parentPath}.${element.getAttribute('name')}` : element.getAttribute('name'),
        deviceType: deviceType,
        showInvert: parseVisibility(element.getAttribute('UIShowInvert')),
        showCurve: parseVisibility(element.getAttribute('UIShowCurve')),
        showSensitivity: parseVisibility(element.getAttribute('UIShowSensitivity')),
        invert: element.getAttribute('invert') === '1',
        invertCvar: element.getAttribute('invert_cvar') || null,
        exponent: parseFloat(element.getAttribute('exponent')) || null,
        curve: null,
        children: []
    };

    // Parse nonlinearity_curve if present
    const curveElement = element.querySelector(':scope > nonlinearity_curve');
    if (curveElement)
    {
        node.curve = parseCurve(curveElement);
    }

    // Parse child optiongroups
    const childGroups = element.querySelectorAll(':scope > optiongroup');
    childGroups.forEach(child =>
    {
        node.children.push(parseOptionGroup(child, deviceType, node.path));
    });

    return node;
}

function parseCurve(curveElement)
{
    const points = [];
    const resetAttr = curveElement.getAttribute('reset');

    if (resetAttr === '1')
    {
        return { reset: true, points: [] };
    }

    const pointElements = curveElement.querySelectorAll('point');
    pointElements.forEach(point =>
    {
        points.push({
            in: parseFloat(point.getAttribute('in')),
            out: parseFloat(point.getAttribute('out'))
        });
    });

    return { reset: false, points };
}

function parseVisibility(attr)
{
    // -1 = inherit from parent (show)
    // 0 = hide
    // 1 = show
    if (attr === null || attr === undefined) return null;
    const val = parseInt(attr);
    if (val === -1) return 'inherit';
    if (val === 0) return false;
    if (val === 1) return true;
    return null;
}

function getDefaultControlsData()
{
    // Minimal fallback data structure
    return {
        keyboard: { name: 'root', label: 'Keyboard Settings', children: [], deviceType: 'keyboard' },
        gamepad: { name: 'root', label: 'Gamepad Settings', children: [], deviceType: 'gamepad' },
        joystick: { name: 'root', label: 'Joystick Settings', children: [], deviceType: 'joystick', instances: 8 }
    };
}

// ============================================================================
// UI RENDERING
// ============================================================================

function renderDeviceTabs()
{
    const tabContainer = document.getElementById('controls-device-tabs');
    if (!tabContainer) return;

    const devices = [
        { id: 'keyboard', icon: '⌨️', label: 'Keyboard' },
        { id: 'gamepad', icon: '🎮', label: 'Gamepad' },
        { id: 'joystick', icon: '🕹️', label: 'Joystick' }
    ];

    tabContainer.innerHTML = devices.map(device => `
    <button class="controls-device-tab ${device.id === currentDeviceType ? 'active' : ''}" 
            data-device="${device.id}">
      <span class="tab-icon">${device.icon}</span>
      <span>${device.label}</span>
    </button>
  `).join('');
}

function switchDeviceType(deviceType)
{
    currentDeviceType = deviceType;
    selectedNode = null;

    // Update tab states
    document.querySelectorAll('.controls-device-tab').forEach(tab =>
    {
        tab.classList.toggle('active', tab.dataset.device === deviceType);
    });

    // Show/hide instance selector for joystick
    const instanceSelector = document.getElementById('controls-instance-selector');
    if (instanceSelector)
    {
        instanceSelector.style.display = deviceType === 'joystick' ? 'flex' : 'none';
    }

    renderTree();
    clearSettingsPanel();
}

function renderTree()
{
    const treeContent = document.getElementById('controls-tree-content');
    if (!treeContent) return;

    if (!controlsData || !controlsData[currentDeviceType])
    {
        treeContent.innerHTML = `
      <div class="controls-empty-state">
        <div class="empty-icon">📭</div>
        <h3>No Options Available</h3>
        <p>Control options for this device type could not be loaded.</p>
      </div>
    `;
        return;
    }

    const rootNode = controlsData[currentDeviceType];
    treeContent.innerHTML = renderTreeNode(rootNode, 0);

    // Add click listeners to tree nodes
    treeContent.querySelectorAll('.controls-tree-node').forEach(node =>
    {
        node.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            const path = node.dataset.path;
            selectTreeNode(path);
        });
    });

    // Add click listeners to expand toggles
    treeContent.querySelectorAll('.controls-tree-expand').forEach(toggle =>
    {
        toggle.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            toggleTreeExpand(toggle);
        });
    });
}

function renderTreeNode(node, depth)
{
    if (!node) return '';

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = depth < 2; // Auto-expand first 2 levels

    // Determine what settings this node can show
    const canShowInvert = node.showInvert === true || node.showInvert === 'inherit';
    const canShowCurve = node.showCurve === true || node.showCurve === 'inherit';

    // Get display label (clean up @ui_ prefix for readability)
    let displayLabel = node.label;
    if (displayLabel.startsWith('@ui_'))
    {
        displayLabel = cleanupLabel(displayLabel);
    }

    // Build settings badges
    let badges = '';
    if (canShowInvert)
    {
        badges += '<span class="controls-tree-badge has-invert" title="Has inversion setting">↕</span>';
    }
    if (canShowCurve)
    {
        badges += '<span class="controls-tree-badge has-curve" title="Has curve setting">📈</span>';
    }

    let html = `
    <div class="controls-tree-item" data-path="${node.path}">
      <div class="controls-tree-node ${hasChildren ? 'has-children' : ''}" data-path="${node.path}">
        ${hasChildren ? `
          <span class="controls-tree-expand ${isExpanded ? 'expanded' : ''}">▶</span>
        ` : `
          <span class="controls-tree-expand" style="visibility: hidden;">▶</span>
        `}
        <span class="controls-tree-label">${displayLabel}</span>
        <div class="controls-tree-settings">${badges}</div>
      </div>
  `;

    if (hasChildren)
    {
        html += `<div class="controls-tree-children ${isExpanded ? '' : 'collapsed'}">`;
        node.children.forEach(child =>
        {
            html += renderTreeNode(child, depth + 1);
        });
        html += '</div>';
    }

    html += '</div>';
    return html;
}

function cleanupLabel(label)
{
    // Remove @ui_ prefix and convert to readable format
    let clean = label.replace(/^@ui_/i, '');
    // Convert camelCase or PascalCase to spaces
    clean = clean.replace(/([A-Z])/g, ' $1').trim();
    // Convert underscores to spaces
    clean = clean.replace(/_/g, ' ');
    // Capitalize first letter
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return clean;
}

function toggleTreeExpand(toggle)
{
    toggle.classList.toggle('expanded');
    const treeItem = toggle.closest('.controls-tree-item');
    const children = treeItem.querySelector('.controls-tree-children');
    if (children)
    {
        children.classList.toggle('collapsed');
    }
}

function selectTreeNode(path)
{
    // Update selection UI
    document.querySelectorAll('.controls-tree-node').forEach(node =>
    {
        node.classList.toggle('selected', node.dataset.path === path);
    });

    // Find the node data
    selectedNode = findNodeByPath(controlsData[currentDeviceType], path);

    // Render settings panel
    renderSettingsPanel(selectedNode);
}

function findNodeByPath(root, path)
{
    if (!root || !path) return null;

    const parts = path.split('.');
    let current = root;

    for (let i = 0; i < parts.length; i++)
    {
        if (current.name === parts[i])
        {
            if (i === parts.length - 1)
            {
                return current;
            }
            // Look in children for next part
            if (current.children)
            {
                const next = current.children.find(c => c.name === parts[i + 1]);
                if (next)
                {
                    current = next;
                    i++; // Skip the next iteration since we found it
                } else
                {
                    return null;
                }
            }
        } else if (current.children)
        {
            const found = current.children.find(c => c.name === parts[i]);
            if (found)
            {
                current = found;
            } else
            {
                return null;
            }
        }
    }

    return current;
}

// ============================================================================
// SETTINGS PANEL
// ============================================================================

function clearSettingsPanel()
{
    const panel = document.getElementById('controls-settings-content');
    if (!panel) return;

    panel.innerHTML = `
    <div class="controls-empty-state">
      <div class="empty-icon">🎛️</div>
      <h3>Select a Control Option</h3>
      <p>Choose an option from the tree on the left to view and edit its settings.</p>
    </div>
  `;

    updateSettingsHeader(null);
}

function updateSettingsHeader(node)
{
    const headerTitle = document.querySelector('.controls-settings-header h2');
    const headerPath = document.querySelector('.controls-settings-path');

    if (!node)
    {
        if (headerTitle) headerTitle.textContent = 'Settings';
        if (headerPath) headerPath.textContent = '';
        return;
    }

    let displayLabel = node.label;
    if (displayLabel.startsWith('@ui_'))
    {
        displayLabel = cleanupLabel(displayLabel);
    }

    if (headerTitle) headerTitle.textContent = displayLabel;
    if (headerPath) headerPath.textContent = node.path;
}

function renderSettingsPanel(node)
{
    const panel = document.getElementById('controls-settings-content');
    if (!panel || !node)
    {
        clearSettingsPanel();
        return;
    }

    updateSettingsHeader(node);

    const canShowInvert = node.showInvert === true || (node.showInvert === 'inherit');
    const canShowCurve = node.showCurve === true || (node.showCurve === 'inherit');
    const hasExponent = node.exponent !== null || getUserSetting(node.path, 'exponent', null) !== null;

    // Check for curve in both node data and user settings
    const nodeCurve = node.curve;
    const userCurve = getUserSetting(node.path, 'curve', null);
    const hasCurve = nodeCurve !== null || (userCurve !== null && userCurve.points && userCurve.points.length > 0);

    let html = '';

    // Instance selector for joystick (shown at top of settings)
    if (currentDeviceType === 'joystick')
    {
        html += `
      <div class="controls-instance-selector">
        <label>Joystick Instance:</label>
        <select id="controls-instance-select">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `
            <option value="${i}" ${i === currentJoystickInstance ? 'selected' : ''}>Joystick ${i}</option>
          `).join('')}
        </select>
      </div>
    `;
    }

    // Inversion Section
    if (canShowInvert)
    {
        const currentInvert = getUserSetting(node.path, 'invert', node.invert);
        html += `
      <div class="controls-setting-section">
        <h3>↕️ Inversion</h3>
        <div class="controls-invert-toggle">
          <div class="toggle-info">
            <span class="toggle-label">Invert Axis</span>
            <span class="toggle-description">Reverse the direction of this input</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="invert-toggle" ${currentInvert ? 'checked' : ''} 
                   data-path="${node.path}" data-setting="invert">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${node.invertCvar ? `
          <div class="controls-inherited-notice">
            <span class="notice-icon">ℹ️</span>
            <span class="notice-text">This setting is linked to console variable: <strong>${node.invertCvar}</strong></span>
          </div>
        ` : ''}
      </div>
    `;
    }

    // Curve Section
    if (canShowCurve)
    {
        html += `
      <div class="controls-setting-section">
        <h3>📈 Response Curve</h3>
        ${hasExponent ? renderExponentEditor(node) : ''}
        ${hasCurve ? renderCurveEditor(node) : renderCurveEditorEmpty(node)}
      </div>
    `;
    }

    // If nothing to show
    if (!canShowInvert && !canShowCurve)
    {
        html += `
      <div class="controls-inherited-notice">
        <span class="notice-icon">📁</span>
        <span class="notice-text">This is a category node. Select a child option to configure its settings.</span>
      </div>
    `;

        // Show children summary
        if (node.children && node.children.length > 0)
        {
            html += `
        <div class="controls-setting-section">
          <h3>📋 Contains ${node.children.length} option${node.children.length > 1 ? 's' : ''}</h3>
          <ul style="margin: 0; padding-left: 1.5rem; color: var(--text-secondary);">
            ${node.children.map(child =>
            {
                let label = child.label.startsWith('@ui_') ? cleanupLabel(child.label) : child.label;
                return `<li>${label}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
        }
    }

    // Action buttons
    if (canShowInvert || canShowCurve)
    {
        html += `
      <div class="controls-action-buttons">
        <button class="btn btn-secondary" id="reset-settings-btn">↩️ Reset to Default</button>
        <span style="flex: 1;"></span>
        <div class="controls-save-indicator ${hasUnsavedChanges ? 'unsaved' : ''}" id="save-indicator">
          ${hasUnsavedChanges ? '⚠️ Unsaved changes' : '✓ Saved'}
        </div>
      </div>
    `;
    }

    panel.innerHTML = html;

    // Attach event listeners
    attachSettingsEventListeners(node);

    // Render curve canvas if applicable - always render if canShowCurve is true
    // (we show a linear line as default if no curve is defined)
    // Use requestAnimationFrame to ensure the canvas container has proper dimensions
    if (canShowCurve)
    {
        requestAnimationFrame(() =>
        {
            renderCurveCanvas(node);
        });
    }
}

function renderExponentEditor(node)
{
    const currentExponent = getUserSetting(node.path, 'exponent', node.exponent);

    return `
    <div class="controls-exponent-setting">
      <label>Exponent:</label>
      <input type="range" id="exponent-slider" min="0.5" max="5" step="0.1" 
             value="${currentExponent}" data-path="${node.path}" data-setting="exponent">
      <span class="controls-exponent-value" id="exponent-value">${currentExponent.toFixed(1)}</span>
    </div>
  `;
}

function renderCurveEditor(node)
{
    const curve = getUserSetting(node.path, 'curve', node.curve);

    if (curve.reset)
    {
        return `
      <div class="controls-inherited-notice">
        <span class="notice-icon">↩️</span>
        <span class="notice-text">Curve is reset to linear. Points below are inherited from parent.</span>
      </div>
      ${renderCurveEditorEmpty(node)}
    `;
    }

    return `
    <div class="controls-curve-editor">
      <div class="controls-curve-canvas-container">
        <canvas class="controls-curve-canvas" id="curve-canvas"></canvas>
      </div>
      
      <div class="controls-curve-points">
        <div class="controls-curve-points-header">
          <h4>Curve Points</h4>
          <button class="btn btn-secondary btn-sm" id="add-curve-point-btn">+ Add Point</button>
        </div>
        <table class="controls-curve-table">
          <thead>
            <tr>
              <th>Input</th>
              <th>Output</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="curve-points-tbody">
            ${curve.points.map((point, idx) => `
              <tr data-index="${idx}">
                <td><input type="number" min="0" max="1" step="0.01" value="${point.in}" data-field="in"></td>
                <td><input type="number" min="0" max="1" step="0.01" value="${point.out}" data-field="out"></td>
                <td><button class="btn btn-danger btn-sm remove-point-btn" data-index="${idx}">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="controls-curve-presets">
        <span style="color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.5rem;">Presets:</span>
        <button class="controls-curve-preset-btn" data-preset="linear">Linear</button>
        <button class="controls-curve-preset-btn" data-preset="smooth">Smooth</button>
        <button class="controls-curve-preset-btn" data-preset="aggressive">Aggressive</button>
        <button class="controls-curve-preset-btn" data-preset="precise">Precise</button>
      </div>
    </div>
  `;
}

function renderCurveEditorEmpty(node)
{
    return `
    <div class="controls-curve-editor">
      <div class="controls-curve-canvas-container">
        <canvas class="controls-curve-canvas" id="curve-canvas"></canvas>
      </div>
      
      <div class="controls-inherited-notice" style="margin-top: 1rem;">
        <span class="notice-icon">ℹ️</span>
        <span class="notice-text">No custom curve defined. Using linear response or inherited curve from parent.</span>
      </div>
      
      <div class="controls-curve-presets">
        <span style="color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.5rem;">Add curve:</span>
        <button class="controls-curve-preset-btn" data-preset="linear">Linear</button>
        <button class="controls-curve-preset-btn" data-preset="smooth">Smooth</button>
        <button class="controls-curve-preset-btn" data-preset="aggressive">Aggressive</button>
        <button class="controls-curve-preset-btn" data-preset="precise">Precise</button>
      </div>
    </div>
  `;
}

// ============================================================================
// CURVE CANVAS RENDERING
// ============================================================================

function renderCurveCanvas(node)
{
    const canvas = document.getElementById('curve-canvas');
    if (!canvas)
    {
        console.warn('[CONTROLS-EDITOR] Canvas element not found');
        return;
    }

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    // Set canvas size - use fallback values if container has no dimensions yet
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    // If container has no dimensions, use reasonable defaults
    if (containerWidth === 0 || containerHeight === 0)
    {
        console.warn('[CONTROLS-EDITOR] Canvas container has zero dimensions, using defaults');
        containerWidth = containerWidth || 400;
        containerHeight = containerHeight || 200;
    }

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    // Clear canvas
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-darkest').trim() || '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Vertical grid lines
    for (let i = 0; i <= 10; i++)
    {
        const x = padding + (i / 10) * (width - padding * 2);
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 0; i <= 10; i++)
    {
        const y = padding + (i / 10) * (height - padding * 2);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;

    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';

    // X axis labels
    for (let i = 0; i <= 10; i += 2)
    {
        const x = padding + (i / 10) * (width - padding * 2);
        ctx.fillText((i / 10).toFixed(1), x, height - padding + 15);
    }

    // Y axis labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= 10; i += 2)
    {
        const y = height - padding - (i / 10) * (height - padding * 2);
        ctx.fillText((i / 10).toFixed(1), padding - 5, y + 4);
    }

    // Axis titles
    ctx.textAlign = 'center';
    ctx.fillText('Input', width / 2, height - 5);

    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Output', 0, 0);
    ctx.restore();

    // Get curve data
    const curve = getUserSetting(node.path, 'curve', node.curve);
    const exponent = getUserSetting(node.path, 'exponent', node.exponent);

    // Draw linear reference (dashed)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, padding);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the response curve
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#10b981';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();

    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    for (let i = 0; i <= 100; i++)
    {
        const inputVal = i / 100;
        let outputVal = inputVal;

        // Apply exponent if present
        if (exponent !== null)
        {
            outputVal = Math.pow(inputVal, exponent);
        }

        // Apply curve points if present
        if (curve && curve.points && curve.points.length > 0 && !curve.reset)
        {
            outputVal = interpolateCurve(inputVal, curve.points);
        }

        const x = padding + inputVal * graphWidth;
        const y = height - padding - outputVal * graphHeight;

        if (i === 0)
        {
            ctx.moveTo(x, y);
        } else
        {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Draw curve points as circles
    if (curve && curve.points && curve.points.length > 0 && !curve.reset)
    {
        ctx.fillStyle = accentColor;
        curve.points.forEach(point =>
        {
            const x = padding + point.in * graphWidth;
            const y = height - padding - point.out * graphHeight;

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();

            // White border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }
}

function interpolateCurve(input, points)
{
    if (!points || points.length === 0) return input;

    // Sort points by input value
    const sorted = [...points].sort((a, b) => a.in - b.in);

    // Find the two points to interpolate between
    let lower = { in: 0, out: 0 };
    let upper = { in: 1, out: 1 };

    for (let i = 0; i < sorted.length; i++)
    {
        if (sorted[i].in <= input)
        {
            lower = sorted[i];
        }
        if (sorted[i].in >= input)
        {
            upper = sorted[i];
            break;
        }
    }

    // Handle edge case where input is beyond defined points
    if (input <= sorted[0].in)
    {
        return sorted[0].out * (input / sorted[0].in);
    }
    if (input >= sorted[sorted.length - 1].in)
    {
        const lastPoint = sorted[sorted.length - 1];
        const remaining = input - lastPoint.in;
        const remainingRange = 1 - lastPoint.in;
        const outputRemaining = 1 - lastPoint.out;
        return lastPoint.out + (remaining / remainingRange) * outputRemaining;
    }

    // Linear interpolation between lower and upper
    if (lower.in === upper.in) return lower.out;

    const t = (input - lower.in) / (upper.in - lower.in);
    return lower.out + t * (upper.out - lower.out);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function attachSettingsEventListeners(node)
{
    // Invert toggle
    const invertToggle = document.getElementById('invert-toggle');
    if (invertToggle)
    {
        invertToggle.addEventListener('change', (e) =>
        {
            setUserSetting(node.path, 'invert', e.target.checked);
            markUnsaved();
        });
    }

    // Exponent slider
    const exponentSlider = document.getElementById('exponent-slider');
    const exponentValue = document.getElementById('exponent-value');
    if (exponentSlider && exponentValue)
    {
        exponentSlider.addEventListener('input', (e) =>
        {
            const val = parseFloat(e.target.value);
            exponentValue.textContent = val.toFixed(1);
            setUserSetting(node.path, 'exponent', val);
            markUnsaved();
            renderCurveCanvas(node);
        });
    }

    // Instance selector
    const instanceSelect = document.getElementById('controls-instance-select');
    if (instanceSelect)
    {
        instanceSelect.addEventListener('change', (e) =>
        {
            currentJoystickInstance = parseInt(e.target.value) || 1;
            renderSettingsPanel(node);
        });
    }

    // Curve point inputs
    const curvePointInputs = document.querySelectorAll('#curve-points-tbody input');
    curvePointInputs.forEach(input =>
    {
        input.addEventListener('change', (e) =>
        {
            updateCurvePoint(node, e);
            markUnsaved();
            renderCurveCanvas(node);
        });
    });

    // Remove point buttons
    const removePointBtns = document.querySelectorAll('.remove-point-btn');
    removePointBtns.forEach(btn =>
    {
        btn.addEventListener('click', (e) =>
        {
            const index = parseInt(e.target.dataset.index);
            removeCurvePoint(node, index);
            markUnsaved();
            renderSettingsPanel(node);
        });
    });

    // Add point button
    const addPointBtn = document.getElementById('add-curve-point-btn');
    if (addPointBtn)
    {
        addPointBtn.addEventListener('click', () =>
        {
            addCurvePoint(node);
            markUnsaved();
            renderSettingsPanel(node);
        });
    }

    // Preset buttons
    const presetBtns = document.querySelectorAll('.controls-curve-preset-btn');
    console.log('[CONTROLS-EDITOR] Found', presetBtns.length, 'preset buttons');
    presetBtns.forEach(btn =>
    {
        btn.addEventListener('click', () =>
        {
            console.log('[CONTROLS-EDITOR] Preset button clicked:', btn.dataset.preset);
            applyCurvePreset(node, btn.dataset.preset);
            markUnsaved();
            renderSettingsPanel(node);
        });
    });

    // Reset button
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn)
    {
        resetBtn.addEventListener('click', () =>
        {
            resetNodeSettings(node);
            renderSettingsPanel(node);
        });
    }
}

function updateCurvePoint(node, event)
{
    const row = event.target.closest('tr');
    const index = parseInt(row.dataset.index);
    const field = event.target.dataset.field;
    const value = parseFloat(event.target.value);

    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (!curve || !curve.points)
    {
        curve = { reset: false, points: [] };
    }

    if (curve.points[index])
    {
        curve.points[index][field] = Math.max(0, Math.min(1, value));
    }

    setUserSetting(node.path, 'curve', curve);
}

function removeCurvePoint(node, index)
{
    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (curve && curve.points)
    {
        curve.points.splice(index, 1);
        setUserSetting(node.path, 'curve', curve);
    }
}

function addCurvePoint(node)
{
    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (!curve)
    {
        curve = { reset: false, points: [] };
    }

    // Find a gap to add a new point
    const existingInputs = curve.points.map(p => p.in).sort((a, b) => a - b);
    let newIn = 0.5;

    if (existingInputs.length > 0)
    {
        // Find the largest gap
        let maxGap = existingInputs[0];
        let gapStart = 0;

        for (let i = 0; i < existingInputs.length - 1; i++)
        {
            const gap = existingInputs[i + 1] - existingInputs[i];
            if (gap > maxGap)
            {
                maxGap = gap;
                gapStart = existingInputs[i];
            }
        }

        // Check gap at the end
        const endGap = 1 - existingInputs[existingInputs.length - 1];
        if (endGap > maxGap)
        {
            gapStart = existingInputs[existingInputs.length - 1];
            maxGap = endGap;
        }

        newIn = gapStart + maxGap / 2;
    }

    curve.points.push({ in: newIn, out: newIn });
    curve.points.sort((a, b) => a.in - b.in);

    setUserSetting(node.path, 'curve', curve);
}

function applyCurvePreset(node, presetName)
{
    const presets = {
        linear: { reset: false, points: [] },
        smooth: {
            reset: false,
            points: [
                { in: 0.2, out: 0.05 },
                { in: 0.4, out: 0.15 },
                { in: 0.6, out: 0.35 },
                { in: 0.8, out: 0.65 }
            ]
        },
        aggressive: {
            reset: false,
            points: [
                { in: 0.1, out: 0.015 },
                { in: 0.2, out: 0.02 },
                { in: 0.3, out: 0.04 },
                { in: 0.4, out: 0.06 },
                { in: 0.5, out: 0.08 },
                { in: 0.6, out: 0.15 },
                { in: 0.7, out: 0.26 },
                { in: 0.8, out: 0.38 },
                { in: 0.9, out: 0.58 }
            ]
        },
        precise: {
            reset: false,
            points: [
                { in: 0.1, out: 0.02 },
                { in: 0.3, out: 0.08 },
                { in: 0.5, out: 0.20 },
                { in: 0.7, out: 0.45 },
                { in: 0.9, out: 0.80 }
            ]
        }
    };

    const preset = presets[presetName];
    if (preset)
    {
        console.log('[CONTROLS-EDITOR] Applying preset:', presetName, 'to path:', node.path);
        console.log('[CONTROLS-EDITOR] Preset data:', JSON.stringify(preset));
        setUserSetting(node.path, 'curve', JSON.parse(JSON.stringify(preset)));
        console.log('[CONTROLS-EDITOR] User settings after apply:', JSON.stringify(userSettings[currentDeviceType]));
    }
    else
    {
        console.warn('[CONTROLS-EDITOR] Unknown preset:', presetName);
    }
}

function resetNodeSettings(node)
{
    // Remove user settings for this node
    const deviceSettings = userSettings[currentDeviceType];
    if (currentDeviceType === 'joystick')
    {
        if (deviceSettings[currentJoystickInstance])
        {
            delete deviceSettings[currentJoystickInstance][node.path];
        }
    } else
    {
        delete deviceSettings[node.path];
    }

    hasUnsavedChanges = false;
    updateSaveIndicator();
}

// ============================================================================
// USER SETTINGS MANAGEMENT
// ============================================================================

function getUserSetting(path, settingName, defaultValue)
{
    let settings;

    if (currentDeviceType === 'joystick')
    {
        settings = userSettings.joystick[currentJoystickInstance] || {};
    } else
    {
        settings = userSettings[currentDeviceType] || {};
    }

    const pathSettings = settings[path];
    if (pathSettings && pathSettings[settingName] !== undefined)
    {
        return pathSettings[settingName];
    }

    return defaultValue;
}

function setUserSetting(path, settingName, value)
{
    if (currentDeviceType === 'joystick')
    {
        if (!userSettings.joystick[currentJoystickInstance])
        {
            userSettings.joystick[currentJoystickInstance] = {};
        }
        if (!userSettings.joystick[currentJoystickInstance][path])
        {
            userSettings.joystick[currentJoystickInstance][path] = {};
        }
        userSettings.joystick[currentJoystickInstance][path][settingName] = value;
    } else
    {
        if (!userSettings[currentDeviceType][path])
        {
            userSettings[currentDeviceType][path] = {};
        }
        userSettings[currentDeviceType][path][settingName] = value;
    }
}

function markUnsaved()
{
    hasUnsavedChanges = true;
    updateSaveIndicator();
}

function updateSaveIndicator()
{
    const indicator = document.getElementById('save-indicator');
    if (indicator)
    {
        indicator.classList.toggle('unsaved', hasUnsavedChanges);
        indicator.innerHTML = hasUnsavedChanges ? '⚠️ Unsaved changes' : '✓ Saved';
    }
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Get the current user settings for export
 */
window.getControlSettings = function ()
{
    return userSettings;
};

/**
 * Generate XML options element for saving
 */
window.generateControlOptionsXml = function (deviceType, instance = 1)
{
    let settings;

    if (deviceType === 'joystick')
    {
        settings = userSettings.joystick[instance] || {};
    } else
    {
        settings = userSettings[deviceType] || {};
    }

    if (Object.keys(settings).length === 0)
    {
        return null;
    }

    let xml = `  <options type="${deviceType}" instance="${instance}">\n`;

    for (const [path, pathSettings] of Object.entries(settings))
    {
        const optionName = path.split('.').pop(); // Get last part of path

        let attrs = [];
        if (pathSettings.invert !== undefined)
        {
            attrs.push(`invert="${pathSettings.invert ? '1' : '0'}"`);
        }

        if (attrs.length > 0)
        {
            xml += `    <${optionName} ${attrs.join(' ')}/>\n`;
        }

        // TODO: Add nonlinearity_curve export if curve is defined
    }

    xml += '  </options>\n';

    return xml;
};

// Make initialization globally available
window.initializeControlsEditor = window.initializeControlsEditor;
