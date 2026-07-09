import { supabaseClient } from "./api.js";
import { writeAuditEvent } from "./audit.js";
import { hasAnyCapability } from "./capabilities.js";
import { KIOSK_TOKEN_STORAGE_KEY } from "./config.js";
import { $ } from "./dom.js";
import {
  showToast
} from "./messages.js";
import {
  renderEmptyState,
  requestPlatformConfirmation
} from "./platformUi.js";
import { showAdministrationWorkspace } from "./shell.js";

const TERMINAL_VIEW_CAPABILITIES = [
  "devices.view",
  "devices.manage",
  "settings.edit",
  "module_configuration.manage"
];

const TERMINAL_MANAGE_CAPABILITIES = [
  "devices.manage",
  "settings.edit",
  "module_configuration.manage"
];

let terminalRecords = [];
let terminalAdminInitialised = false;
let lastValidatedToken = null;
let lastValidationResult = null;

function canViewSharedTerminals() {
  return hasAnyCapability(TERMINAL_VIEW_CAPABILITIES);
}

function canManageSharedTerminals() {
  return hasAnyCapability(TERMINAL_MANAGE_CAPABILITIES);
}

function currentToken() {
  return localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY) || "";
}

function maskToken(token) {
  if (!token) return "Not available";
  const text = String(token);
  if (text.length <= 8) return "Saved token";
  return "..." + text.slice(-6);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function terminalName(device) {
  return device.device_name || device.name || device.id || "Shared terminal";
}

function terminalNotes(device) {
  return device.description || device.notes || device.location_name || "-";
}

function setAdministrationSection(sectionName) {
  const selected = {
    reference: sectionName === "reference",
    identityResolution: sectionName === "identityResolution",
    documentSignoffs: sectionName === "documentSignoffs",
    privacyGdpr: sectionName === "privacyGdpr",
    terminals: sectionName === "terminals",
    modules: sectionName === "modules",
    access: sectionName === "access"
  };
  const sections = {
    reference: $("referenceDataSection"),
    identityResolution: $("identityResolutionSection"),
    documentSignoffs: $("documentSignoffAdminSection"),
    privacyGdpr: $("privacyGdprSection"),
    terminals: $("sharedTerminalsSection"),
    modules: $("moduleConfigurationSection"),
    access: $("accessControlSection")
  };
  const navigation = {
    reference: $("administrationReferenceNav"),
    identityResolution: $("administrationIdentityResolutionNav"),
    documentSignoffs: $("administrationDocumentSignoffsNav"),
    privacyGdpr: $("administrationPrivacyGdprNav"),
    terminals: $("administrationSharedTerminalsNav"),
    modules: $("administrationModuleConfigurationNav"),
    access: $("administrationAccessControlNav")
  };

  Object.entries(sections).forEach(([name, section]) => {
    if (section) section.classList.toggle("hidden", !selected[name]);
  });
  Object.entries(navigation).forEach(([name, button]) => {
    if (!button) return;
    button.classList.toggle("active", !!selected[name]);
    if (selected[name]) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function requireSharedTerminalAccess() {
  if (canViewSharedTerminals()) return true;
  showToast(
    "You do not have permission",
    "Shared Terminal Administration requires devices.view or an administration management capability.",
    "error"
  );
  return false;
}

function requireSharedTerminalManageAccess() {
  if (canManageSharedTerminals()) return true;
  showToast(
    "You do not have permission",
    "Managing shared terminals requires devices.manage or an administration management capability.",
    "error"
  );
  return false;
}

function findDeviceForToken(token) {
  if (!token) return null;
  return terminalRecords.find(device => device.kiosk_token === token) || null;
}

function statusForDevice(device) {
  if (!device.active) return { label: "Inactive", className: "inactive" };
  return { label: "Active", className: "active" };
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function updateCurrentBrowserStatus(options) {
  const settings = options || {};
  const token = currentToken();
  const hasToken = !!token;
  const matchingDevice = findDeviceForToken(token);
  const validationKnown = lastValidatedToken === token && lastValidationResult !== null;
  const valid = validationKnown ? lastValidationResult === true : (matchingDevice ? matchingDevice.active !== false : null);
  const badge = $("sharedTerminalCurrentTokenBadge");

  if ($("sharedTerminalTokenPresent")) $("sharedTerminalTokenPresent").textContent = hasToken ? "Yes" : "No";
  if ($("sharedTerminalTokenValid")) $("sharedTerminalTokenValid").textContent =
    !hasToken ? "No token saved" : (valid === null ? "Not checked" : (valid ? "Yes" : "No"));
  if ($("sharedTerminalRegisteredName")) $("sharedTerminalRegisteredName").textContent =
    matchingDevice ? terminalName(matchingDevice) : (valid ? "Registered terminal" : "Not recognised");
  if ($("sharedTerminalStartupBehaviour")) {
    $("sharedTerminalStartupBehaviour").textContent = valid
      ? "This browser will open Visitor Kiosk / Terminal Home at terminal startup."
      : "This browser will open Staff Login at terminal startup.";
  }
  if ($("sharedTerminalCurrentStatusText")) {
    $("sharedTerminalCurrentStatusText").textContent = settings.message ||
      (hasToken
        ? "A terminal token is saved in this browser."
        : "No terminal token is saved in this browser.");
  }
  if (badge) {
    badge.className = "shared-terminal-badge " + (valid ? "active" : (hasToken ? "warning" : "neutral"));
    badge.textContent = valid ? "Recognised" : (hasToken ? "Needs validation" : "No token");
  }
}

function resetCreateForm() {
  const form = $("sharedTerminalCreateForm");
  if (form) form.reset();
  const tokenBox = $("sharedTerminalNewTokenBox");
  if (tokenBox) tokenBox.replaceChildren();
}

function renderGeneratedToken(token) {
  const box = $("sharedTerminalNewTokenBox");
  if (!box) return;
  box.replaceChildren();
  if (!token) return;

  const intro = document.createElement("p");
  intro.textContent = "New terminal token generated. Copy it now and save it on the terminal device.";

  const code = document.createElement("code");
  code.textContent = token;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary";
  copy.textContent = "Copy Token";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(token);
      showToast("Token copied", "The terminal token was copied to the clipboard.", "success");
    } catch (err) {
      showToast("Copy failed", "Select the token text and copy it manually.", "error");
    }
  });

  box.append(intro, code, copy);
}

function renderTerminalList() {
  const body = $("sharedTerminalResults");
  if (!body) return;
  body.replaceChildren();

  terminalRecords.forEach(device => {
    const row = document.createElement("tr");
    const status = statusForDevice(device);

    const nameCell = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = terminalName(device);
    const location = document.createElement("div");
    location.className = "row-meta";
    location.textContent = device.location_name || "-";
    nameCell.append(name, location);
    row.appendChild(nameCell);

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = "people-status " + status.className;
    statusBadge.textContent = status.label;
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    row.appendChild(createCell(maskToken(device.kiosk_token)));
    row.appendChild(createCell(formatDate(device.created_at)));
    row.appendChild(createCell(formatDate(device.last_seen_at)));
    row.appendChild(createCell(terminalNotes(device)));

    const actionCell = document.createElement("td");
    actionCell.className = "shared-terminal-row-actions";
    if (canManageSharedTerminals()) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = device.active ? "danger" : "secondary";
      toggle.textContent = device.active ? "Deactivate" : "Activate";
      toggle.addEventListener("click", event => {
        setSharedTerminalActive(device.id, !device.active, event.currentTarget);
      });
      actionCell.appendChild(toggle);
    } else {
      actionCell.textContent = "Read only";
    }
    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $("sharedTerminalEmptyState").classList.toggle("hidden", terminalRecords.length > 0);
  if (!terminalRecords.length) {
    renderEmptyState("sharedTerminalEmptyState", {
      title: "No shared terminals registered",
      description: canManageSharedTerminals()
        ? "Register a terminal to enable native Visitor Kiosk startup on that device."
        : "No terminal devices are available for review."
    });
  }
  if ($("sharedTerminalListStatus")) {
    $("sharedTerminalListStatus").textContent =
      terminalRecords.length + " terminal record(s) shown.";
  }
  updateCurrentBrowserStatus();
}

export async function loadSharedTerminals() {
  if (!requireSharedTerminalAccess()) return;
  if ($("sharedTerminalListStatus")) $("sharedTerminalListStatus").textContent = "Loading shared terminals...";
  try {
    const result = await supabaseClient.rpc("superuser_list_kiosk_devices");
    if (result.error) throw result.error;
    terminalRecords = Array.isArray(result.data) ? result.data : [];
    renderTerminalList();
  } catch (err) {
    terminalRecords = [];
    renderTerminalList();
    if ($("sharedTerminalListStatus")) $("sharedTerminalListStatus").textContent = "Shared terminals could not be loaded.";
    showToast("Shared terminals not loaded", err.message || "Could not load registered terminal records.", "error");
  }
}

export async function createSharedTerminal(event) {
  if (event) event.preventDefault();
  if (!requireSharedTerminalManageAccess()) return;

  const name = $("sharedTerminalDeviceName").value.trim();
  const active = $("sharedTerminalActive").value !== "false";
  const location = $("sharedTerminalLocationName").value.trim();
  const description = $("sharedTerminalDescription").value.trim();
  if (!name) {
    showToast("Terminal not registered", "Device name is required.", "error");
    $("sharedTerminalDeviceName").focus();
    return;
  }

  const button = $("sharedTerminalCreateButton");
  button.disabled = true;
  button.textContent = "Registering...";
  if ($("sharedTerminalNewTokenBox")) {
    $("sharedTerminalNewTokenBox").textContent = "Registering terminal...";
  }

  try {
    const result = await supabaseClient.rpc("superuser_create_kiosk_device", {
      p_device_name: name,
      p_location_name: location,
      p_description: description
    });
    if (result.error) throw result.error;

    const token = typeof result.data === "string"
      ? result.data
      : (result.data && (result.data.kiosk_token || result.data.token));
    if (token && !active) {
      const listResult = await supabaseClient.rpc("superuser_list_kiosk_devices");
      if (listResult.error) throw listResult.error;
      const createdDevice = (listResult.data || []).find(device => device.kiosk_token === token);
      if (!createdDevice || !createdDevice.id) {
        throw new Error("Terminal was created, but its inactive status could not be applied.");
      }
      const statusResult = await supabaseClient.rpc("superuser_set_kiosk_status", {
        p_device_id: createdDevice.id,
        p_active: false,
        p_reason: "Registered inactive from Operations Hub Shared Terminal Administration"
      });
      if (statusResult.error) throw statusResult.error;
    }
    resetCreateForm();
    renderGeneratedToken(token);
    void writeAuditEvent("terminal_registered", "kiosk_devices", null, {
      action: "create",
      after: { device_name: name, location_name: location, description, active },
      summary: "Shared terminal registered."
    });
    showToast("Terminal registered", "Copy the generated token into the terminal device.", "success");
    await loadSharedTerminals();
  } catch (err) {
    showToast("Terminal not registered", err.message || "Could not register this terminal.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Register Terminal";
  }
}

export async function setSharedTerminalActive(deviceId, active, trigger) {
  if (!requireSharedTerminalManageAccess()) return;
  const device = terminalRecords.find(record => record.id === deviceId);
  const confirmed = await requestPlatformConfirmation({
    title: active ? "Activate terminal?" : "Deactivate terminal?",
    message: active
      ? "This terminal token will be accepted again after activation."
      : "This terminal token will stop validating for Shared Terminal startup.",
    confirmText: active ? "Activate" : "Deactivate",
    danger: !active,
    initialFocus: "cancel",
    trigger
  });
  if (!confirmed) return;

  try {
    const result = await supabaseClient.rpc("superuser_set_kiosk_status", {
      p_device_id: deviceId,
      p_active: active,
      p_reason: active ? "" : "Deactivated from Operations Hub Shared Terminal Administration"
    });
    if (result.error) throw result.error;

    void writeAuditEvent(active ? "terminal_activated" : "terminal_deactivated", "kiosk_devices", deviceId, {
      action: active ? "activate" : "deactivate",
      changes: { active: { old: !active, new: active } },
      summary: active ? "Shared terminal activated." : "Shared terminal deactivated."
    });
    showToast(
      active ? "Terminal activated" : "Terminal deactivated",
      (device ? terminalName(device) : "The terminal") + " was updated.",
      "success"
    );
    if (lastValidatedToken && device && device.kiosk_token === lastValidatedToken) {
      lastValidationResult = active;
    }
    await loadSharedTerminals();
  } catch (err) {
    showToast("Terminal status not changed", err.message || "Could not update terminal status.", "error");
  }
}

export async function validateCurrentSharedTerminalToken() {
  if (!requireSharedTerminalAccess()) return;
  const token = currentToken();
  if (!token) {
    lastValidatedToken = "";
    lastValidationResult = false;
    updateCurrentBrowserStatus({ message: "No token is saved in this browser." });
    showToast("No token saved", "Set this device token before validating the current browser.", "error");
    return;
  }

  try {
    const result = await supabaseClient.rpc("validate_kiosk_device_token", {
      p_kiosk_token: token
    });
    if (result.error) throw result.error;
    lastValidatedToken = token;
    lastValidationResult = result.data === true;
    updateCurrentBrowserStatus({
      message: lastValidationResult
        ? "The saved token is valid for Shared Terminal startup."
        : "The saved token is not recognised as an active terminal."
    });
    showToast(
      lastValidationResult ? "Terminal recognised" : "Terminal not recognised",
      lastValidationResult
        ? "This browser can open Visitor Kiosk / Terminal Home at startup."
        : "This browser will open Staff Login until a valid token is saved.",
      lastValidationResult ? "success" : "error"
    );
  } catch (err) {
    lastValidatedToken = token;
    lastValidationResult = false;
    updateCurrentBrowserStatus({ message: "Current token validation failed." });
    showToast("Token validation failed", err.message || "Could not validate the saved terminal token.", "error");
  }
}

export async function setCurrentSharedTerminalToken() {
  if (!requireSharedTerminalManageAccess()) return;
  const entered = window.prompt("Enter the terminal token for this browser:");
  if (!entered || !entered.trim()) return;
  localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, entered.trim());
  lastValidatedToken = null;
  lastValidationResult = null;
  updateCurrentBrowserStatus({ message: "A terminal token was saved in this browser." });
  void writeAuditEvent("terminal_current_browser_token_set", "kiosk_devices", null, {
    action: "set_current_browser_token",
    summary: "Current browser terminal token set."
  });
  showToast("Token saved", "This browser now has a Shared Terminal token saved.", "success");
  await validateCurrentSharedTerminalToken();
}

export async function clearCurrentSharedTerminalToken(trigger) {
  if (!requireSharedTerminalManageAccess()) return;
  const confirmed = await requestPlatformConfirmation({
    title: "Clear this device token?",
    message: "This only clears the saved vms_kiosk_token from the current browser. It does not delete the terminal record.",
    confirmText: "Clear Token",
    danger: true,
    initialFocus: "cancel",
    trigger
  });
  if (!confirmed) return;
  localStorage.removeItem(KIOSK_TOKEN_STORAGE_KEY);
  lastValidatedToken = null;
  lastValidationResult = null;
  updateCurrentBrowserStatus({ message: "No terminal token is saved in this browser." });
  void writeAuditEvent("terminal_current_browser_token_cleared", "kiosk_devices", null, {
    action: "clear_current_browser_token",
    summary: "Current browser terminal token cleared."
  });
  showToast("Token cleared", "The Shared Terminal token was cleared from this browser.", "success");
}

export function syncSharedTerminalAdministrationVisibility() {
  const visible = canViewSharedTerminals();
  const nav = $("administrationSharedTerminalsNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  const registrationCard = $("sharedTerminalRegistrationCard");
  if (registrationCard) registrationCard.classList.toggle("hidden", !canManageSharedTerminals());
  [
    "sharedTerminalSetCurrentTokenButton",
    "sharedTerminalClearCurrentTokenButton"
  ].forEach(id => {
    const button = $(id);
    if (button) button.disabled = !canManageSharedTerminals();
  });
  if (!visible && $("sharedTerminalsSection") && !$("sharedTerminalsSection").classList.contains("hidden")) {
    if (hasAnyCapability(["settings.view", "settings.edit"])) setAdministrationSection("reference");
    else if (hasAnyCapability(["module_configuration.view", "module_configuration.manage", "visitor.housekeeping.run"])) {
      setAdministrationSection("modules");
    } else if (hasAnyCapability(["access_control.view", "access_control.manage"])) {
      setAdministrationSection("access");
    }
  }
}

export async function openSharedTerminalAdministration() {
  syncSharedTerminalAdministrationVisibility();
  if (!requireSharedTerminalAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("terminals");
  resetCreateForm();
  updateCurrentBrowserStatus();
  await loadSharedTerminals();
}

export function initialiseSharedTerminalAdministration() {
  if (terminalAdminInitialised) return;
  terminalAdminInitialised = true;
  if ($("administrationSharedTerminalsNav")) {
    $("administrationSharedTerminalsNav").addEventListener("click", openSharedTerminalAdministration);
  }
  if ($("sharedTerminalsRefreshButton")) {
    $("sharedTerminalsRefreshButton").addEventListener("click", loadSharedTerminals);
  }
  if ($("sharedTerminalCreateForm")) {
    $("sharedTerminalCreateForm").addEventListener("submit", createSharedTerminal);
  }
  if ($("sharedTerminalCreateResetButton")) {
    $("sharedTerminalCreateResetButton").addEventListener("click", resetCreateForm);
  }
  if ($("sharedTerminalSetCurrentTokenButton")) {
    $("sharedTerminalSetCurrentTokenButton").addEventListener("click", setCurrentSharedTerminalToken);
  }
  if ($("sharedTerminalValidateCurrentTokenButton")) {
    $("sharedTerminalValidateCurrentTokenButton").addEventListener("click", validateCurrentSharedTerminalToken);
  }
  if ($("sharedTerminalClearCurrentTokenButton")) {
    $("sharedTerminalClearCurrentTokenButton").addEventListener("click", event => {
      clearCurrentSharedTerminalToken(event.currentTarget);
    });
  }
  window.addEventListener("oh:capabilities-changed", syncSharedTerminalAdministrationVisibility);
  syncSharedTerminalAdministrationVisibility();
  updateCurrentBrowserStatus();
}
