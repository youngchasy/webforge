mod component_library;
mod extensions;
mod assets;
mod audit;
mod debugger;
mod devtools;
mod deploy;
mod generator;
mod git;
mod intelligence;
mod language_services;
mod package_manager;
mod preview;
mod project;
mod runtime;
mod release;
mod security;
mod search;
mod settings;
mod terminal;
mod tasks;
mod workspace;
mod watcher;

use debugger::BrowserDebugState;
use preview::PreviewServerState;
use runtime::RuntimeState;
use release::PendingUpdate;
use security::WorkspaceSecurityState;
use terminal::TerminalState;
use tasks::TaskState;
use language_services::LanguageServiceState;
use std::{collections::HashMap, sync::Mutex};
use workspace::{WorkspaceState, WorkspaceWatchState};
use watcher::NativeWorkspaceWatcherState;
use search::WorkspaceSearchIndexState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkspaceState(Mutex::new(None)))
        .manage(WorkspaceWatchState(Mutex::new(HashMap::new())))
        .manage(NativeWorkspaceWatcherState::new())
        .manage(WorkspaceSearchIndexState::new())
        .manage(PreviewServerState::new())
        .manage(WorkspaceSecurityState::new())
        .manage(BrowserDebugState::new())
        .manage(RuntimeState::new())
        .manage(TerminalState::new())
        .manage(TaskState::new())
        .manage(LanguageServiceState::new())
        .manage(PendingUpdate::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                let runtime = window.state::<RuntimeState>();
                let terminal = window.state::<TerminalState>();
                let tasks = window.state::<TaskState>();
                let language = window.state::<LanguageServiceState>();
                let watcher = window.state::<NativeWorkspaceWatcherState>();
                let debugger = window.state::<BrowserDebugState>();
                let _ = runtime.stop();
                let _ = terminal.stop();
                let _ = tasks.stop();
                let _ = language.stop();
                let _ = debugger.stop();
                let _ = watcher.stop();
            }
        })
        .invoke_handler(tauri::generate_handler![
            workspace::set_workspace_root,
            workspace::refresh_workspace,
            workspace::reset_workspace_watch,
            workspace::poll_workspace_changes,
            watcher::start_native_workspace_watch,
            watcher::stop_native_workspace_watch,
            watcher::poll_native_workspace_changes,
            workspace::read_workspace_file,
            workspace::write_workspace_file,
            workspace::write_workspace_files,
            workspace::create_workspace_file,
            workspace::create_workspace_directory,
            workspace::rename_workspace_entry,
            workspace::delete_workspace_entry,
            package_manager::get_package_manifest,
            package_manager::package_install,
            package_manager::package_remove,
            package_manager::package_update,
            package_manager::package_outdated,
            package_manager::package_security_audit,
            assets::list_workspace_assets,
            assets::optimize_svg_asset,
            audit::run_project_audit,
            generator::create_project,
            search::search_workspace,
            search::preview_workspace_replace,
            search::rebuild_workspace_index,
            search::get_workspace_index_status,
            settings::load_workspace_settings,
            settings::save_workspace_settings,
            settings::save_recovery_snapshot,
            settings::load_recovery_snapshot,
            settings::clear_recovery_snapshot,
            git::get_git_status,
            git::get_git_diff,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_init,
            git::list_git_branches,
            git::get_git_history,
            git::git_switch_branch,
            git::git_create_branch,
            git::git_merge_branch,
            git::git_merge_continue,
            git::git_merge_abort,
            git::list_git_remote_branches,
            git::get_git_operation_state,
            git::git_rebase_branch,
            git::git_rebase_continue,
            git::git_rebase_abort,
            git::git_cherry_pick,
            git::git_cherry_pick_continue,
            git::git_cherry_pick_abort,
            git::list_git_remotes,
            git::get_git_conflict,
            git::git_fetch_remote,
            git::git_pull_remote,
            git::git_push_remote,
            git::list_git_stashes,
            git::git_stash_push,
            git::git_stash_apply,
            git::git_stash_drop,
            git::list_git_tags,
            git::git_create_tag,
            git::git_delete_tag,
            git::get_git_graph,
            git::get_git_file_history,
            git::get_git_blame,
            git::get_git_credential_state,
            intelligence::load_project_language_files,
            language_services::probe_language_servers,
            language_services::start_language_server,
            language_services::stop_language_server,
            language_services::get_language_server_status,
            language_services::update_language_configuration,
            language_services::refresh_language_diagnostics,
            language_services::get_language_server_logs,
            language_services::execute_language_command,
            language_services::sync_language_document,
            language_services::close_language_document,
            language_services::get_language_diagnostics,
            language_services::request_language_feature,
            language_services::request_language_symbols,
            language_services::request_language_hierarchy,
            tasks::list_project_tasks,
            tasks::start_project_task,
            tasks::start_project_test_file,
            tasks::start_project_test_case,
            tasks::start_project_test_coverage,
            tasks::rerun_failed_project_tests,
            tasks::get_project_test_history,
            tasks::clear_project_test_history,
            tasks::stop_project_task,
            tasks::get_project_task_status,
            tasks::poll_project_task_logs,
            tasks::get_project_test_report,
            debugger::probe_debug_browsers,
            debugger::start_browser_debug,
            debugger::stop_browser_debug,
            debugger::get_browser_debug_status,
            debugger::poll_browser_debug_events,
            debugger::browser_debug_action,
            devtools::analyze_project_bundle,
            deploy::get_deploy_config,
            deploy::save_deploy_config,
            deploy::get_deploy_providers,
            deploy::store_deploy_credential,
            deploy::clear_deploy_credential,
            deploy::generate_github_pages_workflow,
            deploy::deploy_project,
            component_library::load_workspace_component_library,
            component_library::save_workspace_component_library,
            extensions::list_extensions,
            extensions::list_extension_catalog,
            extensions::install_bundled_extension,
            extensions::uninstall_extension,
            extensions::set_extension_enabled,
            extensions::set_extension_capability,
            extensions::list_extension_components,
            extensions::list_extension_templates,
            extensions::run_extension_command,
            extensions::create_extension_project,
            preview::sync_preview_root,
            preview::start_preview_server,
            preview::start_build_preview_server,
            preview::stop_build_preview_server,
            preview::set_preview_overlays,
            security::set_workspace_trust,
            security::get_workspace_security,
            security::set_terminal_permission,
            security::set_git_network_permission,
            project::detect_project,
            runtime::probe_runtime_environment,
            runtime::start_project_dev_server,
            runtime::start_project_build,
            runtime::install_project_dependencies,
            runtime::stop_project_runtime,
            runtime::get_project_runtime_status,
            runtime::poll_project_runtime_logs,
            terminal::create_terminal_session,
            terminal::list_terminal_sessions,
            terminal::write_terminal_input,
            terminal::resize_terminal_session,
            terminal::poll_terminal_output,
            terminal::close_terminal_session,
            terminal::close_all_terminal_sessions,
            release::get_release_update_config,
            release::check_release_update,
            release::install_release_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running WebForge");
}
