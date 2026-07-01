import { getKioskToken } from "./kiosk.js";
import { showScreen } from "./navigation.js";
import { AppState } from "./state.js";

const KIOSK_MODE = "kiosk";
const WORKSPACE_MODE = "workspace";

let modeDependencies;

export function configureModes(dependencies) {
  modeDependencies = dependencies;
}

function setDocumentMode(mode) {
  document.body.dataset.operationsHubMode = mode;

  const shell = document.getElementById("operationsHubShell");
  if (shell) {
    shell.classList.toggle("oh-kiosk-mode", mode === KIOSK_MODE);
    shell.classList.toggle("oh-workspace-mode", mode === WORKSPACE_MODE);
  }
}

export function detectEntryMode() {
  const profile = AppState.currentProfile;
  const activeKioskSession =
    profile &&
    profile.active &&
    profile.role === "kiosk_user";
  const activeStaffSession =
    profile &&
    profile.active &&
    profile.role !== "kiosk_user";

  if (activeKioskSession) return KIOSK_MODE;
  if (activeStaffSession) return WORKSPACE_MODE;
  return getKioskToken() ? KIOSK_MODE : WORKSPACE_MODE;
}

export function enterKioskMode() {
  setDocumentMode(KIOSK_MODE);
  modeDependencies.showLegacyVmsWorkspace();
  showScreen("homeScreen");
  modeDependencies.updateHomeAccess();
  return KIOSK_MODE;
}

export async function enterWorkspaceMode() {
  setDocumentMode(WORKSPACE_MODE);

  const profile = AppState.currentProfile;
  const activeStaffSession =
    profile &&
    profile.active &&
    profile.role !== "kiosk_user";

  if (activeStaffSession) {
    modeDependencies.showDashboardWorkspace();
    await modeDependencies.openStaffAreaFromProfile();
    modeDependencies.showDashboardWorkspace();
  } else {
    modeDependencies.showLegacyVmsWorkspace();
    showScreen("homeScreen");
    modeDependencies.updateHomeAccess();
  }

  return WORKSPACE_MODE;
}

export async function returnToEntryMode() {
  if (detectEntryMode() === KIOSK_MODE) {
    return enterKioskMode();
  }

  return enterWorkspaceMode();
}
