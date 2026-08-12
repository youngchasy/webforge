use semver::Version;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct PendingUpdate(pub Mutex<Option<Update>>);

impl PendingUpdate {
    pub fn new() -> Self { Self(Mutex::new(None)) }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUpdateConfig {
    configured: bool,
    channel: String,
    endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUpdateInfo {
    available: bool,
    version: Option<String>,
    current_version: String,
    date: Option<String>,
    body: Option<String>,
}

fn updater_endpoint() -> Option<&'static str> { option_env!("WEBFORGE_UPDATER_ENDPOINT").filter(|value| !value.trim().is_empty()) }
fn updater_pubkey() -> Option<&'static str> { option_env!("WEBFORGE_UPDATER_PUBKEY").filter(|value| !value.trim().is_empty()) }
fn updater_channel() -> &'static str { option_env!("WEBFORGE_UPDATE_CHANNEL").unwrap_or("stable") }

const MAX_UPDATE_NOTES_CHARS: usize = 16_000;

fn channel_accepts_version(channel: &str, version: &str) -> bool {
    let parsed = Version::parse(version.trim_start_matches('v'));
    match (channel, parsed) {
        ("stable", Ok(version)) => version.pre.is_empty(),
        ("staging", Ok(_)) => true,
        (_, Ok(version)) => version.pre.is_empty(),
        _ => false,
    }
}

fn bounded_notes(value: Option<String>) -> Option<String> {
    value.map(|notes| notes.chars().take(MAX_UPDATE_NOTES_CHARS).collect())
}

#[tauri::command]
pub fn get_release_update_config(app: AppHandle) -> ReleaseUpdateConfig {
    let _ = app;
    ReleaseUpdateConfig {
        configured: updater_endpoint().is_some() && updater_pubkey().is_some(),
        channel: updater_channel().to_string(),
        endpoint: updater_endpoint().map(str::to_string),
    }
}

#[tauri::command]
pub async fn check_release_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<ReleaseUpdateInfo, String> {
    let endpoint = updater_endpoint().ok_or_else(|| "updater endpoint is not compiled into this build".to_string())?;
    let endpoint = endpoint.replace("{{channel}}", updater_channel()).replace("{channel}", updater_channel());
    let pubkey = updater_pubkey().ok_or_else(|| "updater public key is not compiled into this build".to_string())?;
    let endpoint_url = endpoint.parse().map_err(|error| format!("invalid updater endpoint: {error}"))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint_url])
        .map_err(|error| error.to_string())?
        .pubkey(pubkey)
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?
        .filter(|update| channel_accepts_version(updater_channel(), &update.version));
    let current_version = app.package_info().version.to_string();
    let info = if let Some(update) = update.as_ref() {
        ReleaseUpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            current_version,
            date: update.date.as_ref().map(|value| value.to_string()),
            body: bounded_notes(update.body.clone()),
        }
    } else {
        ReleaseUpdateInfo { available: false, version: None, current_version, date: None, body: None }
    };
    *pending.0.lock().map_err(|_| "pending update lock is poisoned".to_string())? = update;
    Ok(info)
}

#[tauri::command]
pub async fn install_release_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|_| "pending update lock is poisoned".to_string())?.take()
        .ok_or_else(|| "no checked update is pending".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{bounded_notes, channel_accepts_version, updater_channel};

    #[test]
    fn stable_is_the_default_channel() {
        assert!(!updater_channel().trim().is_empty());
    }

    #[test]
    fn stable_rejects_prerelease_updates() {
        assert!(channel_accepts_version("stable", "1.0.1"));
        assert!(!channel_accepts_version("stable", "1.0.1-rc.1"));
        assert!(channel_accepts_version("staging", "1.0.1-rc.1"));
        assert!(!channel_accepts_version("stable", "not-semver"));
    }

    #[test]
    fn release_notes_are_bounded() {
        let notes = bounded_notes(Some("x".repeat(20_000))).unwrap();
        assert_eq!(notes.chars().count(), 16_000);
    }
}
