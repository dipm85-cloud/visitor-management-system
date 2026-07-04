import {
  isRegisteredTerminal,
  refreshTerminalRegistration,
  renderTerminalHome
} from "./terminal.js";
import { AppState } from "./state.js";
import { recordAppliedRoute } from "./startupDebug.js";

const STAFF_MODE = "workspace";
const TERMINAL_MODE = "terminal";
const LOGIN_MODE = "login";

let modeDependencies;

export function configureModes(dependencies) {
  modeDependencies = dependencies;
}

function activeStaffSession() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

function setDocumentMode(mode, source) {
  document.body.dataset.operationsHubMode = mode;
  recordAppliedRoute(mode, source);

  const shell = document.getElementById("operationsHubShell");
  if (shell) {
    shell.classList.remove("oh-startup-pending");
    shell.classList.toggle("oh-terminal-mode", mode === TERMINAL_MODE);
    // Retain the existing kiosk presentation rules while the shared-terminal
    // shell replaces the temporary kiosk entry routing.
    shell.classList.toggle("oh-kiosk-mode", mode === TERMINAL_MODE);
    shell.classList.toggle("oh-login-mode", mode === LOGIN_MODE);
    shell.classList.toggle("oh-workspace-mode", mode === STAFF_MODE);
  }
}

export function detectEntryMode() {
  if (activeStaffSession()) return STAFF_MODE;
  if (isRegisteredTerminal()) return TERMINAL_MODE;
  return LOGIN_MODE;
}

export async function resolveStartupMode() {
  if (activeStaffSession()) return STAFF_MODE;
  const registeredTerminal = await refreshTerminalRegistration();
  return registeredTerminal ? TERMINAL_MODE : LOGIN_MODE;
}

export function enterTerminalMode(source) {
  setDocumentMode(TERMINAL_MODE, source || "terminal-entry");
  modeDependencies.showTerminalHomeWorkspace();
  renderTerminalHome();
  modeDependencies.updateHomeAccess();
  return TERMINAL_MODE;
}

// Compatibility export for the existing kiosk-profile login path.
export function enterKioskMode(source) {
  return enterTerminalMode(source || "kiosk-login");
}

export function enterStaffLoginMode(source) {
  setDocumentMode(LOGIN_MODE, source || "staff-login-entry");
  modeDependencies.showStaffLoginWorkspace();
  modeDependencies.updateHomeAccess();
  modeDependencies.openLoginModal();
  return LOGIN_MODE;
}

export async function enterWorkspaceMode(source) {
  if (!activeStaffSession()) {
    return returnToEntryMode((source || "workspace-entry") + ":no-staff-session");
  }

  setDocumentMode(STAFF_MODE, source || "workspace-entry");
  modeDependencies.showDashboardWorkspace();
  await modeDependencies.openStaffAreaFromProfile();
  modeDependencies.showDashboardWorkspace();
  return STAFF_MODE;
}

export async function returnToEntryMode(source) {
  const destination = await resolveStartupMode();
  const routeSource = source || "return-to-entry";
  if (destination === STAFF_MODE) return enterWorkspaceMode(routeSource);
  if (destination === TERMINAL_MODE) return enterTerminalMode(routeSource);
  return enterStaffLoginMode(routeSource);
}
