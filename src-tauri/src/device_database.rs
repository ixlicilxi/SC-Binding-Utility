use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceEntry {
    pub vendor_id: String,
    pub product_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub device_type: String,
    pub axis_profile: String,
}

#[derive(Debug, Deserialize)]
struct DeviceDatabaseJson {
    devices: Vec<DeviceEntry>,
    axis_profiles: HashMap<String, HashMap<String, String>>,
}

pub struct DeviceDatabase {
    // Map of (vendor_id, product_id) -> DeviceEntry
    vid_pid_map: HashMap<(u32, u32), DeviceEntry>,
    axis_profiles: HashMap<String, HashMap<String, String>>,
}

static DEVICE_DATABASE: OnceLock<DeviceDatabase> = OnceLock::new();

impl DeviceDatabase {
    /// Load device database from JSON file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let json_str =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read database: {}", e))?;

        let db_json: DeviceDatabaseJson =
            serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let mut vid_pid_map = HashMap::new();

        // Parse VID/PID strings from hex format (e.g., "0x231d") to u32
        for device in db_json.devices {
            let vid = u32::from_str_radix(device.vendor_id.trim_start_matches("0x"), 16)
                .map_err(|e| format!("Invalid vendor_id format: {}", e))?;
            let pid = u32::from_str_radix(device.product_id.trim_start_matches("0x"), 16)
                .map_err(|e| format!("Invalid product_id format: {}", e))?;

            vid_pid_map.insert((vid, pid), device);
        }

        Ok(DeviceDatabase {
            vid_pid_map,
            axis_profiles: db_json.axis_profiles,
        })
    }

    /// Initialize the global device database
    pub fn init<P: AsRef<Path>>(path: P) -> Result<(), String> {
        let db = Self::load(path)?;
        DEVICE_DATABASE.set(db).map_err(|_| {
            "Device database already initialized".to_string()
        })?;
        Ok(())
    }

    /// Get device entry by VID/PID
    pub fn lookup_device(vendor_id: u32, product_id: u32) -> Option<DeviceEntry> {
        let result = DEVICE_DATABASE
            .get()
            .and_then(|db| db.vid_pid_map.get(&(vendor_id, product_id)).cloned());
        
        if result.is_none() {
            eprintln!("[DeviceDB] Device not found: VID=0x{:04x}, PID=0x{:04x}", vendor_id, product_id);
        } else {
            eprintln!("[DeviceDB] Device found: VID=0x{:04x}, PID=0x{:04x}", vendor_id, product_id);
        }
        
        result
    }

    /// Get axis profile by name
    pub fn get_axis_profile(profile_name: &str) -> Option<HashMap<String, String>> {
        DEVICE_DATABASE
            .get()
            .and_then(|db| db.axis_profiles.get(profile_name).cloned())
    }

    /// Get all vendor IDs in the database
    pub fn get_vendor_ids() -> Vec<u32> {
        if let Some(db) = DEVICE_DATABASE.get() {
            let mut vids: Vec<u32> = db
                .vid_pid_map
                .keys()
                .map(|(vid, _)| *vid)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            vids.sort();
            vids
        } else {
            Vec::new()
        }
    }

    /// Get all profile names
    pub fn get_profile_names() -> Vec<String> {
        if let Some(db) = DEVICE_DATABASE.get() {
            let mut names: Vec<String> = db.axis_profiles.keys().cloned().collect();
            names.sort();
            names
        } else {
            Vec::new()
        }
    }
}
