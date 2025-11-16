use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
struct DeviceDatabaseJson {
    axis_profiles: HashMap<String, HashMap<String, String>>,
}

// Load axis profiles from device-database.json at compile time
fn load_axis_profiles() -> HashMap<String, HashMap<String, u32>> {
    let json = include_str!("../device-database.json");
    let db: DeviceDatabaseJson = serde_json::from_str(json)
        .expect("Failed to parse device-database.json");
    
    // Convert from JSON format (raw_index -> axis_name) to internal format (axis_name -> raw_index)
    let mut profiles = HashMap::new();
    for (profile_name, profile_map) in db.axis_profiles {
        let mut converted_map = HashMap::new();
        
        // In the JSON: keys are raw indices ("0", "1", etc), values are axis names ("x", "y", etc)
        // We need to flip this to: axis_name -> raw_index
        for (raw_index_str, axis_name) in profile_map {
            // Skip empty axis names (unmapped axes)
            if !axis_name.is_empty() {
                if let Ok(raw_index) = raw_index_str.parse::<u32>() {
                    converted_map.insert(axis_name, raw_index);
                }
            }
        }
        
        if !converted_map.is_empty() {
            profiles.insert(profile_name, converted_map);
        }
    }
    profiles
}

fn normalize_name(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
}

/// Returns the best matching axis profile for a given device name.
pub fn profile_for_device(device_name: &str) -> (String, HashMap<String, u32>) {
    let normalized_device = normalize_name(device_name);
    let profiles = load_axis_profiles();

    // Prefer exact (case-insensitive) matches first
    if let Some((name, profile)) = profiles
        .iter()
        .find(|(name, _)| normalize_name(name) == normalized_device)
    {
        return (name.clone(), profile.clone());
    }

    // Next look for substring matches (device name contains profile name)
    if let Some((name, profile)) = profiles
        .iter()
        .find(|(name, _)| normalized_device.contains(&normalize_name(name)))
    {
        return (name.clone(), profile.clone());
    }

    // Finally, default fallback profile
    if let Some((name, profile)) = profiles.get_key_value("default") {
        return (name.clone(), profile.clone());
    }

    panic!("No default profile defined in device-database.json");
}

/// Converts a logical->raw axis map to raw_index -> logical name map.
pub fn invert_profile(profile: &HashMap<String, u32>) -> HashMap<u32, String> {
    let mut inverted = HashMap::new();
    for (logical, raw) in profile {
        inverted.insert(*raw, logical.clone());
    }
    inverted
}

/// Returns direct access to the profile map (primarily for testing/debugging).
#[allow(dead_code)]
pub fn all_profiles() -> HashMap<String, HashMap<String, u32>> {
    load_axis_profiles()
}

/// Returns an owned snapshot of all profiles for transport over IPC boundaries.
pub fn profiles_snapshot() -> HashMap<String, HashMap<String, u32>> {
    load_axis_profiles()
}
