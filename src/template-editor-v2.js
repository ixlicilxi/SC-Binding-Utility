const DEFAULT_TEMPLATE_V2 = {
    name: '',
    version: '2.0',
    pages: []
};

// Minimal fallback for when Tauri backend is not available (development/testing only)
// In production, axis profiles are always loaded from device-database.json via the backend
const FALLBACK_AXIS_PROFILE = {
    default: { x: 0, y: 1, z: 2, rotx: 3, roty: 4, rotz: 5, slider: 6, hat: 9 }
};

const LOGICAL_AXIS_OPTIONS = ['x', 'y', 'z', 'rotx', 'roty', 'rotz', 'slider', 'slider2', 'hat'];
const RAW_AXIS_RANGE = Array.from({ length: 8 }, (_, index) => index);

const state = {
    template: cloneDeep(DEFAULT_TEMPLATE_V2),
    selectedPageId: null,
    devices: [],
    axisProfiles: {},
    axisProfileOrder: [],
    modalEditingPageId: null,
    modalCustomMapping: {},
    modalImagePath: '',
    modalImageDataUrl: null,
    initialized: false,
    // Detection state
    isDetectingDevice: false,
    deviceDetectionSessionId: null,
    detectedDeviceUuid: null,
    detectedDeviceName: null,
    isDetectingAxis: false,
    axisDetectionSessionId: null,
    axisDetectionIntervalId: null,
    lastAxisValues: {},
    lastAxisUpdateTime: {}
};

const dom = {
    pagesList: null,
    pagesEmpty: null,
    addPageBtn: null,
    pageModal: null,
    pageModalTitle: null,
    pageNameInput: null,
    pageDeviceSelect: null,
    detectDeviceBtn: null,
    detectedDeviceInfo: null,
    detectedDeviceName: null,
    detectedDeviceUuid: null,
    deviceDetectionStatus: null,
    axisProfileSelect: null,
    axisSummary: null,
    openCustomAxisBtn: null,
    pageSaveBtn: null,
    pageCancelBtn: null,
    pageDeleteBtn: null,
    customAxisModal: null,
    customAxisTable: null,
    customAxisSaveBtn: null,
    customAxisCancelBtn: null,
    customAxisResetBtn: null,
    startAxisDetectionBtn: null,
    stopAxisDetectionBtn: null,
    axisDetectionStatus: null,
    pageLoadImageBtn: null,
    pageClearImageBtn: null,
    pageImageInfo: null,
    pageMirrorSelect: null,
    pageImageFileInput: null
};

const callbacks = {
    getTemplate: null,
    onPagesChanged: null,
    onPageSelected: null
};

function getInvoke()
{
    return window.__TAURI__?.core?.invoke;
}

function markTemplateDirty()
{
    if (typeof window.markTemplateAsChanged === 'function')
    {
        window.markTemplateAsChanged();
    }
}

function cloneDeep(value)
{
    return JSON.parse(JSON.stringify(value));
}

function generatePageId()
{
    if (window.crypto?.randomUUID)
    {
        return window.crypto.randomUUID();
    }
    return `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function invertProfile(profile)
{
    const inverted = {};
    Object.entries(profile || {}).forEach(([logical, raw]) =>
    {
        if (raw !== undefined && raw !== null)
        {
            inverted[raw] = logical;
        }
    });
    return inverted;
}

function getSelectedDevice(deviceUuid)
{
    if (!deviceUuid) return null;
    return state.devices.find(device => device.uuid === deviceUuid) || null;
}

function describeAxisMapping(page)
{
    if (!page) return 'No axis mapping configured';
    if (page.axis_profile && page.axis_profile !== 'custom')
    {
        return `Axis profile: ${page.axis_profile}`;
    }
    const entries = Object.entries(page.axis_mapping || {});
    if (!entries.length)
    {
        return 'Custom mapping (not configured)';
    }
    const summary = entries
        .slice(0, 4)
        .map(([raw, logical]) => `${raw}→${logical}`)
        .join(', ');
    const more = entries.length > 4 ? ` +${entries.length - 4} more` : '';
    return `Custom mapping: ${summary}${more}`;
}

async function refreshDevices()
{
    const invoke = getInvoke();
    if (!invoke)
    {
        state.devices = [];
        populateDeviceSelect();
        return;
    }
    try
    {
        const devices = await invoke('get_connected_devices');
        state.devices = Array.isArray(devices) ? devices : [];
    } catch (error)
    {
        console.error('Failed to load devices', error);
        state.devices = [];
    }
    populateDeviceSelect();
}

async function handleRefreshDevices()
{
    const refreshBtn = document.getElementById('refresh-devices-btn');
    if (!refreshBtn) return;

    // Add loading state
    const originalText = refreshBtn.textContent;
    refreshBtn.textContent = '⏳';
    refreshBtn.disabled = true;

    try
    {
        // Store the currently selected device UUID before refresh
        const selectedUuid = dom.pageDeviceSelect?.value;

        // Refresh devices list
        await refreshDevices();

        // Re-select the device by UUID if it was previously selected
        if (selectedUuid && dom.pageDeviceSelect)
        {
            dom.pageDeviceSelect.value = selectedUuid;
            // Trigger change event to sync the display
            dom.pageDeviceSelect.dispatchEvent(new Event('change'));
        }

        // Reset button to show success
        refreshBtn.textContent = '✓';
        setTimeout(() =>
        {
            refreshBtn.textContent = originalText;
            refreshBtn.disabled = false;
        }, 1500);
    } catch (error)
    {
        console.error('Error refreshing devices:', error);
        refreshBtn.textContent = '✗';
        setTimeout(() =>
        {
            refreshBtn.textContent = originalText;
            refreshBtn.disabled = false;
        }, 1500);
    }
}

async function refreshAxisProfiles()
{
    const invoke = getInvoke();
    if (!invoke)
    {
        // Tauri not available - use minimal fallback
        console.warn('Tauri backend not available, using fallback axis profile');
        state.axisProfiles = cloneDeep(FALLBACK_AXIS_PROFILE);
        state.axisProfileOrder = Object.keys(state.axisProfiles);
        populateAxisProfileSelect();
        return;
    }
    try
    {
        const profiles = await invoke('get_axis_profiles');
        if (profiles && typeof profiles === 'object' && Object.keys(profiles).length > 0)
        {
            state.axisProfiles = profiles;
        } else
        {
            // Backend returned empty/invalid data - use fallback
            console.warn('Backend returned invalid axis profiles, using fallback');
            state.axisProfiles = cloneDeep(FALLBACK_AXIS_PROFILE);
        }
    } catch (error)
    {
        console.error('Failed to load axis profiles from backend:', error);
        state.axisProfiles = cloneDeep(FALLBACK_AXIS_PROFILE);
    }
    // Ensure default profile exists
    if (!state.axisProfiles.default)
    {
        console.warn('No default axis profile found, adding fallback default');
        state.axisProfiles.default = cloneDeep(FALLBACK_AXIS_PROFILE.default);
    }
    state.axisProfileOrder = Object.keys(state.axisProfiles).sort();
    populateAxisProfileSelect();
}

function populateDeviceSelect()
{
    if (!dom.pageDeviceSelect) return;
    const options = [`<option value="">— Select a device —</option>`];
    if (state.devices.length === 0)
    {
        options.push('<option disabled value="__none">No devices detected</option>');
    }
    state.devices.forEach(device =>
    {
        options.push(`<option value="${device.uuid}">${device.name} (${device.axis_count} axes)</option>`);
    });
    dom.pageDeviceSelect.innerHTML = options.join('');

    // Sync with detected device if available
    if (state.detectedDeviceUuid)
    {
        dom.pageDeviceSelect.value = state.detectedDeviceUuid;
    }
}

function populateAxisProfileSelect()
{
    if (!dom.axisProfileSelect) return;
    const seen = new Set();
    const options = [];
    [...state.axisProfileOrder, 'default'].forEach(name =>
    {
        if (!name || seen.has(name)) return;
        seen.add(name);
        options.push(`<option value="${name}">${name}</option>`);
    });
    options.push('<option value="custom">Custom Mapping</option>');
    dom.axisProfileSelect.innerHTML = options.join('');
}

function renderPageList()
{
    if (!dom.pagesList || !dom.pagesEmpty) return;
    const pages = state.template.pages;
    dom.pagesList.innerHTML = '';
    dom.pagesEmpty.style.display = pages.length ? 'none' : 'block';

    pages.forEach(page =>
    {
        const card = document.createElement('div');
        card.className = `template-page-card ${page.id === state.selectedPageId ? 'active' : ''}`;
        card.dataset.pageId = page.id;
        card.innerHTML = `
            <div>
                <span class="template-page-name">${page.name || 'Untitled Page'}</span>
                <span class="template-page-device">${page.device_name || 'Device not selected'}</span>
                <div class="template-page-meta">${describeAxisMapping(page)}</div>
            </div>
            <div class="template-page-actions">
                <button type="button" class="btn btn-secondary btn-sm page-edit-btn">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm page-delete-btn">Delete</button>
            </div>
        `;
        dom.pagesList.appendChild(card);
    });

    // Also update the toolbar page selector
    updateToolbarPageSelector();
}

function updateToolbarPageSelector()
{
    const toolbarPageSelect = document.getElementById('toolbar-page-select');
    if (!toolbarPageSelect) return;

    const pages = state.template.pages;
    toolbarPageSelect.innerHTML = '';

    if (pages.length === 0)
    {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No pages';
        toolbarPageSelect.appendChild(option);
        toolbarPageSelect.disabled = true;
        return;
    }

    toolbarPageSelect.disabled = false;
    pages.forEach(page =>
    {
        const option = document.createElement('option');
        option.value = page.id;
        option.textContent = page.name || 'Untitled Page';
        if (page.id === state.selectedPageId)
        {
            option.selected = true;
        }
        toolbarPageSelect.appendChild(option);
    });
}

function selectPage(pageId)
{
    state.selectedPageId = pageId;
    callbacks.onPageSelected?.(pageId || null);
    renderPageList();
}

function openPageModal(pageId = null)
{
    if (!dom.pageModal) return;
    state.modalEditingPageId = pageId;
    state.modalCustomMapping = {};
    state.modalImagePath = '';
    state.modalImageDataUrl = null;
    state.detectedDeviceUuid = null;
    state.detectedDeviceName = null;

    // Refresh devices list when modal opens
    refreshDevices();

    if (pageId)
    {
        const page = state.template.pages.find(p => p.id === pageId);
        if (page)
        {
            dom.pageModalTitle.textContent = 'Edit Page';
            dom.pageNameInput.value = page.name || '';

            // Show existing device info
            state.detectedDeviceUuid = page.device_uuid;
            state.detectedDeviceName = page.device_name;
            if (page.device_name)
            {
                dom.detectedDeviceName.textContent = page.device_name;
                dom.detectedDeviceUuid.textContent = `UUID: ${page.device_uuid || 'Unknown'}`;
                dom.detectedDeviceUuid.style.display = 'block';
                dom.detectedDeviceInfo.classList.add('detected');
                // Set dropdown value
                if (dom.pageDeviceSelect && page.device_uuid)
                {
                    dom.pageDeviceSelect.value = page.device_uuid;
                }
            }
            else
            {
                dom.detectedDeviceName.textContent = 'No device detected';
                dom.detectedDeviceUuid.style.display = 'none';
                dom.detectedDeviceInfo.classList.remove('detected');
                if (dom.pageDeviceSelect)
                {
                    dom.pageDeviceSelect.value = '';
                }
            }

            dom.axisProfileSelect.value = page.axis_profile || 'default';
            state.modalCustomMapping = cloneDeep(page.axis_mapping || {});
            if (page.axis_profile && dom.axisProfileSelect.querySelector(`option[value="${page.axis_profile}"]`))
            {
                dom.axisProfileSelect.value = page.axis_profile;
            }

            // Load image info
            state.modalImagePath = page.image_path || '';
            state.modalImageDataUrl = page.image_data_url || null;
            if (dom.pageImageInfo && page.image_path)
            {
                dom.pageImageInfo.textContent = `Image: ${page.image_path}`;
                if (dom.pageClearImageBtn) dom.pageClearImageBtn.style.display = 'inline-flex';
            }

            // Populate mirror dropdown and set value
            populateMirrorSelect(pageId);
            if (dom.pageMirrorSelect)
            {
                dom.pageMirrorSelect.value = page.mirror_from_page_id || '';
            }

            dom.pageDeleteBtn.style.display = 'inline-flex';
        }
    } else
    {
        dom.pageModalTitle.textContent = 'Add Page';
        dom.pageNameInput.value = '';
        dom.detectedDeviceName.textContent = 'No device detected';
        dom.detectedDeviceUuid.style.display = 'none';
        dom.detectedDeviceInfo.classList.remove('detected');
        dom.axisProfileSelect.value = 'default';

        // Clear image info
        if (dom.pageImageInfo) dom.pageImageInfo.textContent = '';
        if (dom.pageClearImageBtn) dom.pageClearImageBtn.style.display = 'none';

        // Populate mirror dropdown for new page
        populateMirrorSelect(null);
        if (dom.pageMirrorSelect) dom.pageMirrorSelect.value = '';

        dom.pageDeleteBtn.style.display = 'none';
        if (dom.pageDeviceSelect)
        {
            dom.pageDeviceSelect.value = '';
        }
    }

    dom.deviceDetectionStatus.textContent = 'Press any button on your joystick or gamepad to identify it.';
    updateAxisSummary();
    dom.pageModal.style.display = 'flex';
    dom.pageNameInput.focus();
}

function closePageModal()
{
    if (!dom.pageModal) return;
    stopDeviceDetection();
    dom.pageModal.style.display = 'none';
    state.modalEditingPageId = null;
    state.modalCustomMapping = {};
    state.detectedDeviceUuid = null;
    state.detectedDeviceName = null;
}

function savePageFromModal()
{
    const name = dom.pageNameInput.value.trim() || 'Untitled Page';

    // Use detected device if available, otherwise fall back to dropdown selection
    let deviceUuid = state.detectedDeviceUuid || '';
    let deviceName = state.detectedDeviceName || '';

    // If no device was detected but user selected from dropdown, use that
    if (!deviceUuid && dom.pageDeviceSelect && dom.pageDeviceSelect.value)
    {
        deviceUuid = dom.pageDeviceSelect.value;
        const selectedDevice = state.devices.find(d => d.uuid === deviceUuid);
        if (selectedDevice)
        {
            deviceName = selectedDevice.name;
        }
    }
    const axisProfile = dom.axisProfileSelect.value;
    let axisMapping = {};

    if (axisProfile && axisProfile !== 'custom')
    {
        axisMapping = invertProfile(state.axisProfiles[axisProfile] || state.axisProfiles.default || {});
    } else
    {
        axisMapping = cloneDeep(state.modalCustomMapping || {});
    }

    // Get image and mirror settings
    const imagePath = state.modalImagePath || '';
    const imageDataUrl = state.modalImageDataUrl || null;
    const mirrorFromPageId = dom.pageMirrorSelect ? dom.pageMirrorSelect.value : '';

    if (state.modalEditingPageId)
    {
        const page = state.template.pages.find(p => p.id === state.modalEditingPageId);
        if (page)
        {
            page.name = name;
            page.device_uuid = deviceUuid;
            page.device_name = deviceName;
            page.axis_profile = axisProfile;
            page.axis_mapping = axisMapping;
            page.image_path = imagePath;
            page.image_data_url = imageDataUrl;
            page.mirror_from_page_id = mirrorFromPageId;

            // Refresh the canvas if this is the currently displayed page
            // Check both state.selectedPageId and window.currentPageId for compatibility
            const isCurrentPage = state.selectedPageId === state.modalEditingPageId ||
                window.currentPageId === state.modalEditingPageId;

            if (isCurrentPage)
            {
                // Load the updated page image directly
                if (page.mirror_from_page_id)
                {
                    const mirrorPage = state.template.pages.find(p => p.id === page.mirror_from_page_id);
                    if (mirrorPage && mirrorPage.image_data_url)
                    {
                        const img = new Image();
                        img.onload = () =>
                        {
                            if (typeof window.setLoadedImage === 'function')
                            {
                                window.setLoadedImage(img);
                            }
                            document.getElementById('canvas-overlay')?.classList.add('hidden');
                            requestAnimationFrame(() =>
                            {
                                if (typeof window.redraw === 'function')
                                {
                                    window.redraw();
                                }
                            });
                        };
                        img.onerror = () => console.error('Failed to load mirror image');
                        img.src = mirrorPage.image_data_url;
                    }
                }
                else if (page.image_data_url)
                {
                    const img = new Image();
                    img.onload = () =>
                    {
                        if (typeof window.setLoadedImage === 'function')
                        {
                            window.setLoadedImage(img);
                        }
                        document.getElementById('canvas-overlay')?.classList.add('hidden');
                        requestAnimationFrame(() =>
                        {
                            if (typeof window.redraw === 'function')
                            {
                                window.redraw();
                            }
                        });
                    };
                    img.onerror = () => console.error('Failed to load own image');
                    img.src = page.image_data_url;
                }
                else
                {
                    if (typeof window.setLoadedImage === 'function')
                    {
                        window.setLoadedImage(null);
                    }
                    document.getElementById('canvas-overlay')?.classList.remove('hidden');
                    requestAnimationFrame(() =>
                    {
                        if (typeof window.redraw === 'function')
                        {
                            window.redraw();
                        }
                    });
                }
            }
        }
        else
        {
            console.error('[savePageFromModal] Page not found:', state.modalEditingPageId);
        }
    } else
    {
        state.template.pages.push({
            id: generatePageId(),
            name,
            device_uuid: deviceUuid,
            device_name: deviceName,
            axis_profile: axisProfile,
            axis_mapping: axisMapping,
            image_path: imagePath,
            image_data_url: imageDataUrl,
            mirror_from_page_id: mirrorFromPageId,
            buttons: [],
            button_positions: []
        });
    }

    if (!state.selectedPageId && state.template.pages.length)
    {
        state.selectedPageId = state.template.pages[0].id;
    }

    renderPageList();
    markTemplateDirty();
    callbacks.onPagesChanged?.(state.template.pages);
    closePageModal();
}

function deletePage(pageId)
{
    const pages = state.template.pages.filter(page => page.id !== pageId);
    if (pages.length === state.template.pages.length) return;
    state.template.pages = pages;
    if (state.selectedPageId === pageId)
    {
        state.selectedPageId = state.template.pages[0]?.id || null;
    }
    renderPageList();
    markTemplateDirty();
    callbacks.onPagesChanged?.(state.template.pages);
}

function handlePagesListClick(event)
{
    const card = event.target.closest('.template-page-card');
    if (!card) return;
    const pageId = card.dataset.pageId;
    if (!pageId) return;

    if (event.target.classList.contains('page-edit-btn'))
    {
        event.stopPropagation();
        openPageModal(pageId);
        return;
    }
    if (event.target.classList.contains('page-delete-btn'))
    {
        event.stopPropagation();
        deletePage(pageId);
        return;
    }
    selectPage(pageId);
}

function openCustomAxisModal()
{
    if (!dom.customAxisModal || !dom.customAxisTable) return;

    // Store the original profile selection and mapping so we can detect changes
    state.originalAxisProfile = dom.axisProfileSelect.value;
    state.originalCustomMapping = cloneDeep(state.modalCustomMapping);

    // If a preset is selected, load its values into the custom mapping view
    const currentProfile = dom.axisProfileSelect.value;
    if (currentProfile && currentProfile !== 'custom' && state.axisProfiles[currentProfile])
    {
        // Convert profile (logical->raw) to mapping (raw->logical) for display
        state.modalCustomMapping = invertProfile(state.axisProfiles[currentProfile]);
    }

    renderCustomAxisTable();
    dom.customAxisModal.style.display = 'flex';
}

function closeCustomAxisModal()
{
    if (!dom.customAxisModal) return;
    stopAxisDetection();
    dom.customAxisModal.style.display = 'none';
}

function renderCustomAxisTable()
{
    const mapping = state.modalCustomMapping || {};
    dom.customAxisTable.innerHTML = RAW_AXIS_RANGE.map(rawIndex =>
    {
        const isAssigned = mapping[rawIndex] && mapping[rawIndex] !== '';
        return `<div class="custom-axis-row ${isAssigned ? 'axis-assigned' : ''}" data-raw-index="${rawIndex}">
            <label>Raw Axis ${rawIndex}</label>
            <select data-raw-index="${rawIndex}">
                <option value="">— Unassigned —</option>
                ${LOGICAL_AXIS_OPTIONS.map(axis => `
                    <option value="${axis}" ${mapping[rawIndex] === axis ? 'selected' : ''}>${axis}</option>
                `).join('')}
            </select>
        </div>`;
    }).join('');

    // Add change listeners to update green highlight when user changes values
    dom.customAxisTable.querySelectorAll('select').forEach(select =>
    {
        select.addEventListener('change', () =>
        {
            const row = select.closest('.custom-axis-row');
            if (select.value && select.value !== '')
            {
                row.classList.add('axis-assigned');
            } else
            {
                row.classList.remove('axis-assigned');
            }
        });
    });
}

function saveCustomAxisMapping()
{
    const mapping = {};
    dom.customAxisTable.querySelectorAll('select').forEach(select =>
    {
        const rawIndex = Number(select.dataset.rawIndex);
        if (select.value)
        {
            mapping[rawIndex] = select.value;
        }
    });

    // Check if the user actually changed anything from the original
    const originalMapping = state.originalCustomMapping || {};
    const originalProfile = state.originalAxisProfile;

    // Compare if mapping changed
    const mappingChanged = JSON.stringify(mapping) !== JSON.stringify(originalMapping);

    // If user was on a preset and made changes, switch to custom
    if (originalProfile && originalProfile !== 'custom' && mappingChanged)
    {
        dom.axisProfileSelect.value = 'custom';
    }

    state.modalCustomMapping = mapping;
    updateAxisSummary();
    closeCustomAxisModal();
}

function resetCustomAxisMapping()
{
    state.modalCustomMapping = {};
    renderCustomAxisTable();
    updateAxisSummary();
}

function updateAxisSummary()
{
    if (!dom.axisSummary) return;
    if (dom.axisProfileSelect.value === 'custom')
    {
        const entries = Object.entries(state.modalCustomMapping || {});
        if (!entries.length)
        {
            dom.axisSummary.textContent = 'Custom mapping not configured yet.';
            return;
        }
        const summary = entries.map(([raw, logical]) => `${raw}→${logical}`).join(', ');
        dom.axisSummary.textContent = `Custom mapping: ${summary}`;
        return;
    }
    const profile = dom.axisProfileSelect.value;
    dom.axisSummary.textContent = profile ? `Using ${profile} axis profile.` : 'No axis profile selected.';
}

function populateMirrorSelect(currentPageId)
{
    if (!dom.pageMirrorSelect) return;

    const options = ['<option value="">No Mirror (Use Own Image)</option>'];

    // Add all pages except the current one
    state.template.pages.forEach(page =>
    {
        if (page.id !== currentPageId)
        {
            options.push(`<option value="${page.id}">${page.name || 'Untitled Page'}</option>`);
        }
    });

    dom.pageMirrorSelect.innerHTML = options.join('');
}

function handlePageImageLoad()
{
    if (!dom.pageImageFileInput)
    {
        // Create hidden file input if it doesn't exist
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', onPageImageFileSelected);
        document.body.appendChild(input);
        dom.pageImageFileInput = input;
    }
    dom.pageImageFileInput.click();
}

function onPageImageFileSelected(e)
{
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) =>
    {
        state.modalImagePath = file.name;
        state.modalImageDataUrl = event.target.result;

        if (dom.pageImageInfo)
        {
            dom.pageImageInfo.textContent = `Image: ${file.name}`;
        }
        if (dom.pageClearImageBtn)
        {
            dom.pageClearImageBtn.style.display = 'inline-flex';
        }

        // Create an image object and refresh canvas
        const img = new Image();
        img.onload = () =>
        {
            // Resize image to max 1024px width
            resizeImage(img, 1024, (resizedImg) =>
            {
                // Update the stored data URL with the resized version
                state.modalImageDataUrl = resizedImg.src;

                window.loadedImage = resizedImg;
                document.getElementById('canvas-overlay').classList.add('hidden');
                if (typeof window.redraw === 'function')
                {
                    window.redraw();
                }
            });
        };
        img.src = state.modalImageDataUrl;
    };
    reader.readAsDataURL(file);

    // Clear the input so the same file can be loaded again
    e.target.value = '';
}

function clearPageImage()
{
    state.modalImagePath = '';
    state.modalImageDataUrl = null;

    if (dom.pageImageInfo)
    {
        dom.pageImageInfo.textContent = '';
    }
    if (dom.pageClearImageBtn)
    {
        dom.pageClearImageBtn.style.display = 'none';
    }
}

// Helper function to resize image to max width of 1024px while maintaining aspect ratio
function resizeImage(img, maxWidth = 1024, callback)
{
    // If image is already smaller than maxWidth, use it as is
    if (img.width <= maxWidth)
    {
        if (callback)
        {
            // Use setTimeout to make it async like the resize case
            setTimeout(() => callback(img), 0);
        }
        return;
    }

    // Calculate new dimensions maintaining aspect ratio
    const ratio = maxWidth / img.width;
    const newWidth = maxWidth;
    const newHeight = Math.round(img.height * ratio);

    // Create a canvas to resize the image
    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = newWidth;
    resizeCanvas.height = newHeight;

    const resizeCtx = resizeCanvas.getContext('2d');
    resizeCtx.imageSmoothingEnabled = true;
    resizeCtx.imageSmoothingQuality = 'high';

    // Draw the resized image
    resizeCtx.drawImage(img, 0, 0, newWidth, newHeight);

    // Create a new image from the resized canvas
    const resizedImg = new Image();
    resizedImg.onload = () =>
    {
        if (callback)
        {
            callback(resizedImg);
        }
    };
    resizedImg.src = resizeCanvas.toDataURL('image/png');
}

// Device detection functionality
// Device detection - detects which device the user presses a button on
async function detectDevice()
{
    const invoke = getInvoke();
    if (!invoke)
    {
        dom.deviceDetectionStatus.textContent = 'Tauri API not available';
        return;
    }

    if (state.isDetectingDevice)
    {
        stopDeviceDetection();
        return;
    }

    state.isDetectingDevice = true;
    state.deviceDetectionSessionId = `device-detect-${Date.now()}`;
    const sessionId = state.deviceDetectionSessionId;

    dom.detectDeviceBtn.textContent = '⏹️ Stop Detection';
    dom.detectDeviceBtn.classList.add('btn-warning');
    dom.detectDeviceBtn.classList.remove('btn-primary');
    dom.deviceDetectionStatus.textContent = '🎮 Listening... Press any button on your device!';
    dom.deviceDetectionStatus.className = 'info-text detecting';
    dom.detectedDeviceInfo.classList.remove('detected');

    try
    {
        // Refresh devices to get latest list
        await refreshDevices();

        const result = await invoke('wait_for_input_binding', {
            sessionId: sessionId,
            timeoutSecs: 20
        });

        if (!state.isDetectingDevice || state.deviceDetectionSessionId !== sessionId)
        {
            return;
        }

        if (result && result.device_uuid)
        {
            const device = state.devices.find(d => d.uuid === result.device_uuid);
            if (device)
            {
                state.detectedDeviceUuid = device.uuid;
                state.detectedDeviceName = device.name;
                dom.detectedDeviceName.textContent = device.name;
                dom.detectedDeviceUuid.textContent = `UUID: ${device.uuid}`;
                dom.detectedDeviceUuid.style.display = 'block';
                dom.detectedDeviceInfo.classList.add('detected');
                dom.deviceDetectionStatus.textContent = `✓ Device detected: ${device.name}`;
                dom.deviceDetectionStatus.className = 'info-text';

                // Sync dropdown selection
                if (dom.pageDeviceSelect)
                {
                    dom.pageDeviceSelect.value = device.uuid;
                }
            }
            else
            {
                // Device detected but not in cached list - add it with the UUID we got
                state.detectedDeviceUuid = result.device_uuid;
                state.detectedDeviceName = result.device_name || 'Unknown Device';
                dom.detectedDeviceName.textContent = state.detectedDeviceName;
                dom.detectedDeviceUuid.textContent = `UUID: ${result.device_uuid}`;
                dom.detectedDeviceUuid.style.display = 'block';
                dom.detectedDeviceInfo.classList.add('detected');
                dom.deviceDetectionStatus.textContent = `✓ Device detected: ${state.detectedDeviceName}`;
                dom.deviceDetectionStatus.className = 'info-text';

                // Refresh device list in background to update cache and sync dropdown
                refreshDevices().then(() =>
                {
                    if (dom.pageDeviceSelect)
                    {
                        dom.pageDeviceSelect.value = result.device_uuid;
                    }
                });
            }
        }
        else
        {
            dom.deviceDetectionStatus.textContent = '⚠️ No device detected';
        }
    }
    catch (error)
    {
        if (!state.isDetectingDevice) return;
        console.error('Device detection error:', error);
        dom.deviceDetectionStatus.textContent = error.includes('timeout') ?
            '⏱️ Timeout - no input detected. Try again.' :
            `Error: ${error}`;
        dom.deviceDetectionStatus.className = 'info-text';
    }
    finally
    {
        state.isDetectingDevice = false;
        state.deviceDetectionSessionId = null;
        dom.detectDeviceBtn.textContent = '🎯 Press Button on Device';
        dom.detectDeviceBtn.classList.remove('btn-warning');
        dom.detectDeviceBtn.classList.add('btn-primary');
    }
}

function stopDeviceDetection()
{
    state.isDetectingDevice = false;
    state.deviceDetectionSessionId = null;
    if (dom.detectDeviceBtn)
    {
        dom.detectDeviceBtn.textContent = '🎯 Press Button on Device';
        dom.detectDeviceBtn.classList.remove('btn-warning');
        dom.detectDeviceBtn.classList.add('btn-primary');
    }
}

// Axis detection functionality
async function startAxisDetection()
{
    const deviceUuid = state.detectedDeviceUuid;
    if (!deviceUuid)
    {
        dom.axisDetectionStatus.textContent = 'Please detect a device first using the button above.';
        return;
    }

    const invoke = getInvoke();
    if (!invoke)
    {
        dom.axisDetectionStatus.textContent = 'Tauri API not available';
        return;
    }

    state.isDetectingAxis = true;
    state.lastAxisValues = {};

    dom.startAxisDetectionBtn.style.display = 'none';
    dom.stopAxisDetectionBtn.style.display = 'inline-flex';
    dom.axisDetectionStatus.textContent = '🎯 Detecting... Move any axis on your device!';
    dom.axisDetectionStatus.style.color = '#ffc107';

    // Poll for axis movement using recursive async loop instead of setInterval
    // This ensures we don't stack up calls if backend is slow
    async function pollAxisMovement()
    {
        if (!state.isDetectingAxis) return;

        try
        {
            // Pass short timeout so the call returns quickly
            const result = await invoke('detect_axis_movement', {
                deviceUuid,
                timeoutMillis: 50
            });

            if (result && result.axis_id !== undefined && result.value !== undefined)
            {
                const axisId = result.axis_id;
                const value = result.value;

                // Track last update time for each axis to prevent flooding
                if (!state.lastAxisUpdateTime) state.lastAxisUpdateTime = {};
                const now = Date.now();
                const lastUpdateTime = state.lastAxisUpdateTime[axisId] || 0;

                // Only update if axis moved significantly OR enough time has passed
                const lastValue = state.lastAxisValues[axisId] || 0;
                const delta = Math.abs(value - lastValue);
                const timeSinceLastUpdate = now - lastUpdateTime;

                // Require significant change (>0.15) or 500ms cooldown between updates
                if (delta > 0.15 || timeSinceLastUpdate > 500)
                {
                    state.lastAxisValues[axisId] = value;
                    state.lastAxisUpdateTime[axisId] = now;
                    highlightAxis(axisId, value);
                }
            }
        }
        catch (error)
        {
            console.error('Axis detection error:', error);
        }

        // Schedule next poll after this one completes (prevents stacking)
        if (state.isDetectingAxis)
        {
            setTimeout(pollAxisMovement, 10); // Small delay between polls
        }
    }

    // Start the polling loop
    pollAxisMovement();
}

function stopAxisDetection()
{
    state.isDetectingAxis = false;
    // No need to clear interval anymore - the recursive loop will stop on its own

    dom.startAxisDetectionBtn.style.display = 'inline-flex';
    dom.stopAxisDetectionBtn.style.display = 'none';
    dom.axisDetectionStatus.textContent = 'Detection stopped. Click "Start Detection" to resume.';
    dom.axisDetectionStatus.style.color = '';

    // Clear highlighting
    document.querySelectorAll('.custom-axis-row').forEach(row =>
    {
        row.classList.remove('detecting');
        const valueDisplay = row.querySelector('.axis-value-display');
        if (valueDisplay)
        {
            valueDisplay.textContent = '';
            valueDisplay.classList.remove('active');
        }
    });
}

function highlightAxis(axisId, value)
{
    // Find the row for this axis
    const row = document.querySelector(`.custom-axis-row[data-raw-index="${axisId}"]`);
    if (!row) return;

    // Highlight the row with auto-fade after 2 seconds
    row.classList.add('detecting');

    // Clear any existing timeout for this row
    if (row._highlightTimeout)
    {
        clearTimeout(row._highlightTimeout);
    }

    row._highlightTimeout = setTimeout(() =>
    {
        row.classList.remove('detecting');
        const valueDisplay = row.querySelector('.axis-value-display');
        if (valueDisplay)
        {
            valueDisplay.classList.remove('active');
        }
    }, 2000);

    // Update value display
    let valueDisplay = row.querySelector('.axis-value-display');
    if (!valueDisplay)
    {
        valueDisplay = document.createElement('div');
        valueDisplay.className = 'axis-value-display';
        row.appendChild(valueDisplay);
    }

    valueDisplay.textContent = `Value: ${value.toFixed(3)}`;
    valueDisplay.classList.add('active');

    // Update status
    dom.axisDetectionStatus.textContent = `🎯 Detected movement on Axis ${axisId}! Assign it using the dropdown.`;
}

function onDeviceSelectChange()
{
    const selectedUuid = dom.pageDeviceSelect?.value;

    if (selectedUuid && selectedUuid !== '' && selectedUuid !== '__none')
    {
        // User manually selected a device from dropdown - sync with detection display
        const device = state.devices.find(d => d.uuid === selectedUuid);
        if (device)
        {
            state.detectedDeviceUuid = device.uuid;
            state.detectedDeviceName = device.name;
            dom.detectedDeviceName.textContent = device.name;
            dom.detectedDeviceUuid.textContent = `UUID: ${device.uuid}`;
            dom.detectedDeviceUuid.style.display = 'block';
            dom.detectedDeviceInfo.classList.add('detected');
            dom.deviceDetectionStatus.textContent = `✓ Device selected: ${device.name}`;
            dom.deviceDetectionStatus.className = 'info-text';
        }
    }
    else
    {
        // User cleared selection
        state.detectedDeviceUuid = null;
        state.detectedDeviceName = null;
        dom.detectedDeviceName.textContent = 'No device detected';
        dom.detectedDeviceUuid.style.display = 'none';
        dom.detectedDeviceInfo.classList.remove('detected');
        dom.deviceDetectionStatus.textContent = 'Press any button on your joystick or gamepad to identify it.';
        dom.deviceDetectionStatus.className = 'info-text';
    }
}

export function getTemplateV2State()
{
    return state;
}

export async function initializeTemplatePagesUI(options = {})
{
    if (options && typeof options === 'object')
    {
        if (options.getTemplate) callbacks.getTemplate = options.getTemplate;
        if (options.onPagesChanged) callbacks.onPagesChanged = options.onPagesChanged;
        if (options.onPageSelected) callbacks.onPageSelected = options.onPageSelected;
    }

    if (state.initialized)
    {
        refreshTemplatePagesUI(options?.template || null);
        return;
    }

    dom.pagesList = document.getElementById('template-pages-list');
    dom.pagesEmpty = document.getElementById('template-pages-empty');
    dom.addPageBtn = document.getElementById('add-template-page-btn');
    dom.pageModal = document.getElementById('template-page-modal');
    dom.pageModalTitle = document.getElementById('template-page-modal-title');
    dom.pageNameInput = document.getElementById('template-page-name');
    dom.pageDeviceSelect = document.getElementById('page-device-select');
    dom.detectDeviceBtn = document.getElementById('detect-device-btn');
    dom.detectedDeviceInfo = document.getElementById('detected-device-info');
    dom.detectedDeviceName = document.getElementById('detected-device-name');
    dom.detectedDeviceUuid = document.getElementById('detected-device-uuid');
    dom.deviceDetectionStatus = document.getElementById('device-detection-status');
    dom.axisProfileSelect = document.getElementById('template-page-axis-profile');
    dom.axisSummary = document.getElementById('template-page-axis-summary');
    dom.openCustomAxisBtn = document.getElementById('open-custom-axis-modal');
    dom.pageSaveBtn = document.getElementById('template-page-save-btn');
    dom.pageCancelBtn = document.getElementById('template-page-cancel-btn');
    dom.pageDeleteBtn = document.getElementById('template-page-delete-btn');
    dom.customAxisModal = document.getElementById('custom-axis-modal');
    dom.customAxisTable = document.getElementById('custom-axis-table');
    dom.customAxisSaveBtn = document.getElementById('custom-axis-save-btn');
    dom.customAxisCancelBtn = document.getElementById('custom-axis-cancel-btn');
    dom.customAxisResetBtn = document.getElementById('custom-axis-reset-btn');
    dom.startAxisDetectionBtn = document.getElementById('start-axis-detection-btn');
    dom.stopAxisDetectionBtn = document.getElementById('stop-axis-detection-btn');
    dom.axisDetectionStatus = document.getElementById('axis-detection-status');
    dom.pageLoadImageBtn = document.getElementById('page-load-image-btn');
    dom.pageClearImageBtn = document.getElementById('page-clear-image-btn');
    dom.pageImageInfo = document.getElementById('page-image-info');
    dom.pageMirrorSelect = document.getElementById('page-mirror-select');

    if (!dom.pagesList)
    {
        return;
    }

    dom.pagesList.addEventListener('click', handlePagesListClick);
    dom.addPageBtn?.addEventListener('click', () => openPageModal());
    dom.pageDeviceSelect?.addEventListener('change', onDeviceSelectChange);
    dom.detectDeviceBtn?.addEventListener('click', detectDevice);
    dom.pageCancelBtn?.addEventListener('click', closePageModal);
    dom.pageSaveBtn?.addEventListener('click', savePageFromModal);
    dom.pageDeleteBtn?.addEventListener('click', () =>
    {
        if (state.modalEditingPageId)
        {
            deletePage(state.modalEditingPageId);
            closePageModal();
        }
    });
    dom.axisProfileSelect?.addEventListener('change', () =>
    {
        if (dom.axisProfileSelect.value !== 'custom')
        {
            state.modalCustomMapping = {};
        }
        updateAxisSummary();
    });
    dom.openCustomAxisBtn?.addEventListener('click', () =>
    {
        openCustomAxisModal();
    });

    dom.customAxisCancelBtn?.addEventListener('click', closeCustomAxisModal);
    dom.customAxisSaveBtn?.addEventListener('click', saveCustomAxisMapping);
    dom.customAxisResetBtn?.addEventListener('click', resetCustomAxisMapping);
    dom.startAxisDetectionBtn?.addEventListener('click', startAxisDetection);
    dom.stopAxisDetectionBtn?.addEventListener('click', stopAxisDetection);
    dom.pageLoadImageBtn?.addEventListener('click', handlePageImageLoad);
    dom.pageClearImageBtn?.addEventListener('click', clearPageImage);

    // Add refresh devices button listener
    const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
    if (refreshDevicesBtn)
    {
        refreshDevicesBtn.addEventListener('click', async (e) =>
        {
            e.preventDefault();
            e.stopPropagation();
            await handleRefreshDevices();
        });
    }

    await Promise.all([refreshDevices(), refreshAxisProfiles()]);
    state.initialized = true;

    window.templateV2State = state;

    refreshTemplatePagesUI(options?.template || null);
}

export function refreshTemplatePagesUI(templateOverride = null)
{
    let templateRef = templateOverride;
    if (!templateRef && typeof callbacks.getTemplate === 'function')
    {
        templateRef = callbacks.getTemplate();
    }

    if (!templateRef || typeof templateRef !== 'object')
    {
        templateRef = cloneDeep(DEFAULT_TEMPLATE_V2);
    }

    if (!Array.isArray(templateRef.pages))
    {
        templateRef.pages = [];
    }

    templateRef.pages.forEach(page =>
    {
        if (!page.id)
        {
            page.id = generatePageId();
        }
    });

    state.template = templateRef;

    if (state.selectedPageId && !state.template.pages.find(page => page.id === state.selectedPageId))
    {
        state.selectedPageId = null;
    }

    if (!state.selectedPageId && state.template.pages.length)
    {
        state.selectedPageId = state.template.pages[0].id;
        // Trigger callback so template-editor.js can load the page
        callbacks.onPageSelected?.(state.selectedPageId);
    }
    else if (state.selectedPageId && state.template.pages.length)
    {
        // If a page is already selected, ensure it's still loaded
        // This handles the case where refreshTemplatePagesUI is called after template changes
        callbacks.onPageSelected?.(state.selectedPageId);
    }
    else if (!state.template.pages.length)
    {
        callbacks.onPageSelected?.(null);
    }

    renderPageList();
}
