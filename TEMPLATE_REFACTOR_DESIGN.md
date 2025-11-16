# Template System Refactor - Design Document

## Overview
Refactoring the joystick template system from a fixed "left/right" dual-stick model to a flexible multi-page system that supports any number of devices with custom axis mappings.

## Current System Limitations
1. **Fixed dual-stick model**: Templates always have exactly 2 sides (left/right)
2. **No axis mapping**: Assumes axis order is consistent across devices
3. **Limited flexibility**: Cannot handle pedals, throttles, or more than 2 sticks per template
4. **No device identification**: Cannot reliably map templates to specific physical devices

## New System Architecture

### 1. Multi-Page Template Structure

#### Old Structure (Current)
```json
{
  "name": "My Dual Sticks",
  "left": {
    "buttons": [...],
    "buttonPositions": [...]
  },
  "right": {
    "buttons": [...],
    "buttonPositions": [...]
  }
}
```

#### New Structure (Proposed)
```json
{
  "name": "My Full HOTAS Setup",
  "version": "2.0",
  "pages": [
    {
      "id": "page_1",
      "name": "Left Stick",
      "deviceUuid": "abc123...",
      "deviceName": "VKB Gladiator NXT",
      "axisMapping": {
        "0": "x",
        "1": "y", 
        "2": "z",
        "3": "rotx",
        "4": "roty",
        "5": "rotz",
        "6": "slider"
      },
      "buttons": [
        {"id": 1, "label": "Trigger"},
        {"id": 2, "label": "Thumb Button"}
      ],
      "buttonPositions": [
        {"id": 1, "x": 50, "y": 200},
        {"id": 2, "x": 75, "y": 180}
      ]
    },
    {
      "id": "page_2",
      "name": "Right Stick",
      "deviceUuid": "def456...",
      "deviceName": "VKB Gladiator NXT",
      "axisMapping": {
        "0": "x",
        "1": "y",
        "2": "z",
        "3": "rotx",
        "4": "roty",
        "5": "rotz"
      },
      "buttons": [...],
      "buttonPositions": [...]
    },
    {
      "id": "page_3",
      "name": "Pedals",
      "deviceUuid": "ghi789...",
      "deviceName": "Thrustmaster TFRP",
      "axisMapping": {
        "0": "x",
        "1": "y",
        "2": "z"
      },
      "buttons": [],
      "buttonPositions": []
    }
  ]
}
```

### 2. Built-in Axis Mapping Profiles

Create a hardcoded list of common devices in a new file: `joystick-axis-profiles.json`

```json
{
  "profiles": {
    "VKB Gladiator NXT": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3,
      "roty": 4,
      "rotz": 5,
      "slider": 6,
      "hat": 9
    },
    "VKB Gladiator EVO": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3,
      "roty": 4,
      "rotz": 5,
      "slider": 6,
      "hat": 9
    },
    "Thrustmaster T.16000M": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3,
      "roty": 4,
      "rotz": 5,
      "slider": 6,
      "hat": 9
    },
    "Thrustmaster TFRP Rudder": {
      "x": 0,
      "y": 1,
      "z": 2
    },
    "Logitech Extreme 3D": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3
    },
    "Virpil VPC Constellation ALPHA-R": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3,
      "roty": 4,
      "rotz": 5,
      "slider": 6,
      "hat": 9
    },
    "default": {
      "x": 0,
      "y": 1,
      "z": 2,
      "rotx": 3,
      "roty": 4,
      "rotz": 5,
      "slider": 6,
      "hat": 9
    }
  }
}
```

### 3. UI Changes

#### Template Editor UI

**Main View:**
```
┌─────────────────────────────────────────────┐
│ Template: My Full HOTAS Setup       [Save]  │
├─────────────────────────────────────────────┤
│ Pages:                                      │
│ ┌─────────────────────┐                    │
│ │ ☑ Left Stick        │  [Edit] [Delete]   │
│ │   VKB Gladiator NXT │                    │
│ └─────────────────────┘                    │
│ ┌─────────────────────┐                    │
│ │ ☐ Right Stick       │  [Edit] [Delete]   │
│ │   VKB Gladiator NXT │                    │
│ └─────────────────────┘                    │
│ ┌─────────────────────┐                    │
│ │ ☐ Pedals            │  [Edit] [Delete]   │
│ │   Thrustmaster TFRP │                    │
│ └─────────────────────┘                    │
│                                             │
│ [+ Add New Page]                            │
└─────────────────────────────────────────────┘
```

**Add/Edit Page Modal:**
```
┌────────────────────────────────────────────┐
│ Configure Page                             │
├────────────────────────────────────────────┤
│ Page Name: [Left Stick____________]        │
│                                            │
│ Select Device:                             │
│ ┌──────────────────────────────────────┐  │
│ │ Detected Devices:                    │  │
│ │ ○ VKB-Sim Gladiator NXT (UUID: abc..)│  │
│ │ ○ VKB-Sim Gladiator NXT (UUID: def..)│  │
│ │ ○ Thrustmaster TFRP (UUID: ghi...)   │  │
│ └──────────────────────────────────────┘  │
│                                            │
│ Axis Mapping Profile:                      │
│ ┌──────────────────────────────────────┐  │
│ │ ○ VKB Gladiator NXT (Built-in)       │  │
│ │ ○ Thrustmaster T.16000M              │  │
│ │ ○ Virpil VPC Constellation ALPHA-R   │  │
│ │ ○ Default Profile                    │  │
│ │ ● Custom Mapping...                  │  │
│ └──────────────────────────────────────┘  │
│                                            │
│ [Configure Custom Mapping]                 │
│                                            │
│ [Cancel]  [Save]                           │
└────────────────────────────────────────────┘
```

**Custom Axis Mapping UI:**
```
┌────────────────────────────────────────────┐
│ Custom Axis Mapping                        │
├────────────────────────────────────────────┤
│ Move each axis to assign it:               │
│                                            │
│ Raw Axis 0: [x ▼]  (Move X axis...)       │
│ Raw Axis 1: [y ▼]  (Move Y axis...)       │
│ Raw Axis 2: [z ▼]  (Move twist...)        │
│ Raw Axis 3: [rotx ▼]  (Move RotX...)      │
│ Raw Axis 4: [roty ▼]  (Move RotY...)      │
│ Raw Axis 5: [rotz ▼]  (Move RotZ...)      │
│ Raw Axis 6: [slider ▼]  (Move slider...)  │
│                                            │
│ [Auto-Detect]  [Reset]                     │
│                                            │
│ [Cancel]  [Save Mapping]                   │
└────────────────────────────────────────────┘
```

### 4. Backend Changes

#### New Tauri Commands

```rust
// Get all connected devices with their UUIDs
#[tauri::command]
fn get_connected_devices() -> Result<Vec<DeviceInfo>, String> {
    // Returns list of { uuid, name, axis_count, button_count }
}

// Get axis mapping for a device by UUID
#[tauri::command]
fn get_device_axis_mapping(device_uuid: String) -> Result<HashMap<u32, String>, String> {
    // Returns the axis mapping for this device
}

// Test an axis to help with custom mapping
#[tauri::command]
fn detect_axis_movement(device_uuid: String) -> Result<Option<u32>, String> {
    // Returns the raw axis index that moved
}

// Save/load templates with new structure
#[tauri::command]
fn save_template_v2(template: TemplateV2) -> Result<(), String> {
    // Saves new format
}

#[tauri::command]
fn load_template_v2(name: String) -> Result<TemplateV2, String> {
    // Loads template, handles migration from v1 if needed
}
```

#### New Data Structures

```rust
#[derive(Serialize, Deserialize)]
struct DeviceInfo {
    uuid: String,
    name: String,
    axis_count: usize,
    button_count: usize,
}

#[derive(Serialize, Deserialize)]
struct TemplateV2 {
    name: String,
    version: String,  // "2.0"
    pages: Vec<TemplatePage>,
}

#[derive(Serialize, Deserialize)]
struct TemplatePage {
    id: String,
    name: String,
    device_uuid: String,
    device_name: String,
    axis_mapping: HashMap<u32, String>,  // raw index -> logical name
    buttons: Vec<ButtonConfig>,
    button_positions: Vec<ButtonPosition>,
}

#[derive(Serialize, Deserialize)]
struct ButtonConfig {
    id: u32,
    label: String,
}

#[derive(Serialize, Deserialize)]
struct ButtonPosition {
    id: u32,
    x: f64,
    y: f64,
}
```

### 5. Migration Strategy

#### Backward Compatibility

When loading old templates (v1), automatically convert to new format:

```rust
fn migrate_template_v1_to_v2(old: TemplateV1) -> TemplateV2 {
    TemplateV2 {
        name: old.name,
        version: "2.0".to_string(),
        pages: vec![
            TemplatePage {
                id: "page_1".to_string(),
                name: "Left".to_string(),
                device_uuid: "".to_string(),  // User will need to assign
                device_name: "Unknown".to_string(),
                axis_mapping: get_default_axis_mapping(),
                buttons: old.left.buttons,
                button_positions: old.left.button_positions,
            },
            TemplatePage {
                id: "page_2".to_string(),
                name: "Right".to_string(),
                device_uuid: "".to_string(),
                device_name: "Unknown".to_string(),
                axis_mapping: get_default_axis_mapping(),
                buttons: old.right.buttons,
                button_positions: old.right.button_positions,
            },
        ],
    }
}
```

### 6. Implementation Plan

#### Phase 1: Backend Infrastructure
1. Create `joystick-axis-profiles.json` with common device profiles
2. Add `DeviceInfo` struct and device enumeration functions
3. Implement `get_connected_devices()` command
4. Add axis mapping lookup logic
5. Create `TemplateV2` data structures

#### Phase 2: Template Migration
1. Implement template version detection
2. Create v1 → v2 migration function
3. Update save/load functions to handle both versions
4. Add migration UI prompt for old templates

#### Phase 3: Frontend UI - Template List
1. Update template editor to show pages instead of left/right
2. Add "Add Page" button
3. Implement page selection/highlighting
4. Add delete page functionality

#### Phase 4: Frontend UI - Page Configuration
1. Create "Add/Edit Page" modal
2. Implement device selection dropdown (from `get_connected_devices()`)
3. Add axis mapping profile selection
4. Create custom axis mapping UI with auto-detect

#### Phase 5: Integration & Testing
1. Update joystick viewer to use selected page
2. Test with multiple device types
3. Test migration from old templates
4. Test saving/loading new templates

#### Phase 6: Polish
1. Add helpful tooltips/instructions
2. Improve axis auto-detection with live feedback
3. Add validation (duplicate UUIDs, missing mappings, etc.)
4. Update documentation

## Key Technical Considerations

### Device UUID Persistence
- UUIDs should remain stable across plug/unplug cycles
- If UUID changes, provide UI to re-map to correct device
- Store last-seen device names to help with identification

### Axis Mapping Fallback
- If device not in built-in profiles, use "default" profile
- Allow saving custom profiles to user's app data
- Provide clear feedback when axis mapping might be wrong

### Button ID Handling
- Button IDs remain unchanged (1-based indexing)
- Support devices with different button counts
- Handle missing buttons gracefully in viewer

### Profile Sharing
- New template format should be shareable between users
- UUIDs won't match, so provide re-mapping wizard on import
- Consider adding "match by device name" option

## Benefits of New System

1. **Flexibility**: Support any number of devices (pedals, throttles, multiple sticks)
2. **Accuracy**: Correct axis mapping per device type
3. **User Control**: Custom mappings for unsupported devices
4. **Future-Proof**: Easy to add new device profiles
5. **Backward Compatible**: Old templates automatically migrate
6. **Sharable**: Users can share templates with proper device identification

## Open Questions

1. Should we allow mixing multiple instances of the same device type on one template?
   - **Answer**: Yes, that's the whole point for dual-stick users

2. How do we handle device disconnection/reconnection with different UUIDs?
   - **Answer**: Store device name + last UUID, prompt user to re-map if UUID changes

3. Should axis mappings be stored per-template or globally per device?
   - **Answer**: Per-template for flexibility, but offer "save as profile" option

4. Do we need to support hat switches in axis mapping?
   - **Answer**: Yes, include in mapping profiles (they're often axis 9+)

5. Should we auto-save templates or require explicit save action?
   - **Answer**: Explicit save with unsaved changes indicator

## Files to Create/Modify

### New Files
- `joystick-axis-profiles.json` - Built-in device profiles
- `src-tauri/src/device_profiles.rs` - Device profile management
- `src/template-editor-v2.js` - New template editor UI
- `src/axis-mapper.js` - Axis mapping configuration UI

### Modified Files
- `src-tauri/src/directinput.rs` - Add device enumeration functions
- `src-tauri/src/lib.rs` - Add new Tauri commands
- `src/template-editor.js` - Update or replace with v2
- `src/joystick-viewer.js` - Use new template structure
- `src/main.js` - Handle template version migration

## Success Criteria

- [ ] Users can create templates with 1-10+ pages
- [ ] Each page correctly maps to a physical device
- [ ] Axis detection works correctly for all mapped devices
- [ ] Old templates migrate automatically without data loss
- [ ] Custom axis mappings can be created and saved
- [ ] UI is intuitive and provides clear feedback
- [ ] Template sharing works between users with proper re-mapping
