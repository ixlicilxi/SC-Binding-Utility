# Device Database Migration

## Summary
Refactored the device identification system to use a centralized JSON database instead of hardcoded Rust match statements. This consolidates device names, product IDs, and axis profiles into a single maintainable source of truth.

## Changes Made

### New Files
1. **`src-tauri/src/device_database.rs`** - New module for device database management
   - `DeviceDatabase` struct to manage device lookups
   - `DeviceEntry` struct for device information
   - Functions to lookup devices by VID/PID
   - Global initialization using `OnceLock` for thread-safe access

2. **`src-tauri/device-database.json`** - New centralized database
   - Contains 35 device definitions (VKB, Thrustmaster, CH Products, Saitek/Mad Catz, VirPil, Fanatec, Logitech, Turtle Beach)
   - Merged with axis profiles from `joystick-axis-profiles.json`
   - Structure: `devices` array + `axis_profiles` object

### Modified Files

#### `src-tauri/src/lib.rs`
- Added `mod device_database;` to module declarations
- Enhanced `.setup()` function to initialize `DeviceDatabase` on app startup
- Handles both debug (file system lookup) and production (bundled resources) paths
- Non-fatal initialization: app continues even if database fails to load

#### `src-tauri/src/directinput.rs`
- Added `use crate::device_database;` import
- Simplified `get_friendly_device_name()` function:
  - Reduced from ~130 lines of match statements to ~60 lines
  - Now queries the device database first
  - Maintains fallback logic for unknown devices by vendor ID
  - Cleaner, more maintainable code

## Database Structure

### Device Entry Format
```json
{
  "vendor_id": "0x231d",
  "product_id": "0x0133",
  "name": "VKB Gladiator NXT",
  "type": "joystick",
  "axis_profile": "VKB Gladiator NXT"
}
```

### Available Profiles
- VKB Gladiator NXT
- VKB Gladiator EVO
- Thrustmaster T.16000M
- Thrustmaster TFRP Rudder
- Logitech Extreme 3D
- Virpil VPC Constellation ALPHA-R
- default

## Benefits

✅ **Single Source of Truth** - Device information in one place  
✅ **Easier Maintenance** - No need to recompile for device updates  
✅ **Extensible** - Easy to add new devices to JSON  
✅ **Merged Profile System** - Devices link directly to their axis profiles  
✅ **Reduced Code Duplication** - Eliminated 70+ lines of Rust match statements  
✅ **Type Safety** - Serialization structures ensure data consistency  

## Future Enhancements

1. Add API endpoint to query available devices at runtime
2. Support device database hot-reloading without restart
3. Add device categorization by manufacturer
4. Include force feedback capabilities in profile
5. Support custom user-defined devices in local database

## Compilation Notes

- No breaking changes to existing APIs
- All existing functionality preserved
- Database initialization is non-blocking
- Fallback behavior maintained for missing devices

## File Locations

- **Development**: `src-tauri/device-database.json`
- **Production**: Bundled in resources via Tauri's resource system (`_up_/device-database.json`)
