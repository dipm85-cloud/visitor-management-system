import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { showAdministrationWorkspace } from "./shell.js";
import { AppState } from "./state.js";
import { loadSystemSettings, settingValue } from "./settings.js";

const PRIVACY_GDPR_VIEW = [
  "gdpr.view",
  "gdpr.manage",
  "privacy.view",
  "privacy.manage",
  "audit.view",
  "settings.view",
  "settings.edit",
  "module_configuration.manage"
];

const LEGACY_PRIVACY_ACTIONS = [
  ["privacyGdprLegacyCasesButton", "gdpr-cases"],
  ["privacyGdprLegacySearchButton", "gdpr-search"],
  ["privacyGdprLegacySarButton", "gdpr-sar"],
  ["privacyGdprLegacyErasureButton", "gdpr-erasure"],
  ["privacyGdprLegacyEvidenceButton", "gdpr-evidence"]
];

let privacyGdprInitialised = false;
let privacyGdprDependencies = {};
let privacyGdprCases = [];
let privacyGdprCasesLoaded = false;

function hasActiveStaffUser() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

function canViewPrivacyGdpr() {
  return hasActiveStaffUser() && hasAnyCapability(PRIVACY_GDPR_VIEW);
}

function canOpenLegacyPrivacyGdpr() {
  return canViewPrivacyGdpr() &&
    AppState.currentProfile &&
    AppState.currentProfile.role === "super_user";
}

function setAdministrationSection(sectionName) {
  const sections = {
    reference: $("referenceDataSection"),
    documentSignoffs: $("documentSignoffAdminSection"),
    privacyGdpr: $("privacyGdprSection"),
    terminals: $("sharedTerminalsSection"),
    modules: $("moduleConfigurationSection"),
    access: $("accessControlSection")
  };
  const navigation = {
    reference: $("administrationReferenceNav"),
    documentSignoffs: $("administrationDocumentSignoffsNav"),
    privacyGdpr: $("administrationPrivacyGdprNav"),
    terminals: $("administrationSharedTerminalsNav"),
    modules: $("administrationModuleConfigurationNav"),
    access: $("administrationAccessControlNav")
  };

  Object.entries(sections).forEach(([name, section]) => {
    if (section) section.classList.toggle("hidden", name !== sectionName);
  });
  Object.entries(navigation).forEach(([name, button]) => {
    if (!button) return;
    const selected = name === sectionName;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function requirePrivacyGdprAccess() {
  if (canViewPrivacyGdpr()) return true;
  showToast(
    "You do not have permission",
    "Privacy / GDPR requires an existing privacy, GDPR, audit or settings capability.",
    "error"
  );
  return false;
}

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? textOrDash(value) : date.toLocaleString();
}

function settingText(key, fallback) {
  return textOrDash(settingValue(key, fallback));
}

function boolSettingText(key, fallback) {
  const value = settingValue(key, fallback);
  return value === true || value === "true" ? "Enabled" : "Disabled";
}

function setMetric(id, value) {
  const element = $(id);
  if (element) element.textContent = value == null ? "-" : String(value);
}

function setStatus(message, type) {
  const element = $("privacyGdprStatus");
  if (!element) return;
  element.textContent = message || "";
  element.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function renderOverview() {
  const openCases = privacyGdprCases.filter(row =>
    row && !["completed", "rejected"].includes(String(row.status || "").toLowerCase())
  );
  const overdueCases = openCases.filter(row =>
    row.due_date && new Date(row.due_date) < new Date()
  );

  setMetric("privacyGdprCaseCount", privacyGdprCasesLoaded ? privacyGdprCases.length : "-");
  setMetric("privacyGdprOpenCaseCount", privacyGdprCasesLoaded ? openCases.length : "-");
  setMetric("privacyGdprOverdueCaseCount", privacyGdprCasesLoaded ? overdueCases.length : "-");
  setMetric("privacyGdprRetentionMode", settingText("retention_mode", "preview_only"));
  setMetric("privacyGdprPrivacyNoticeStatus", boolSettingText("privacy_notice_enabled", true));
  setMetric("privacyGdprLegacyStatus", canOpenLegacyPrivacyGdpr() ? "Available" : "Restricted");
}

function createCaseRow(row) {
  const item = document.createElement("article");
  item.className = "privacy-gdpr-case-card";

  const heading = document.createElement("div");
  heading.className = "privacy-gdpr-card-heading";
  const title = document.createElement("div");
  const name = document.createElement("h4");
  name.textContent = textOrDash(row.case_reference);
  const summary = document.createElement("p");
  summary.textContent = textOrDash(row.request_type) + " - " + textOrDash(row.status);
  title.append(name, summary);

  const badge = document.createElement("span");
  badge.className = "privacy-gdpr-badge";
  badge.textContent = textOrDash(row.priority || "normal");
  heading.append(title, badge);

  const meta = document.createElement("dl");
  meta.className = "privacy-gdpr-meta";
  [
    ["Received", formatDate(row.request_received_at)],
    ["Due", textOrDash(row.due_date)],
    ["Completed", formatDate(row.completed_at)],
    ["Identity verified", row.identity_verified ? "Yes" : "No"]
  ].forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    meta.appendChild(wrapper);
  });

  item.append(heading, meta);
  return item;
}

function renderCases() {
  const list = $("privacyGdprCasesList");
  const empty = $("privacyGdprCasesEmpty");
  if (!list || !empty) return;

  list.replaceChildren();
  const rows = privacyGdprCases.slice(0, 8);
  rows.forEach(row => list.appendChild(createCaseRow(row)));
  empty.classList.toggle("hidden", rows.length > 0);
  if (!rows.length) {
    renderEmptyState("privacyGdprCasesEmpty", {
      title: "No GDPR cases available",
      description: "No read-only case records were returned for your current access."
    });
  }
}

function renderSettings() {
  const list = $("privacyGdprSettingsList");
  if (!list) return;
  list.replaceChildren();

  [
    ["Privacy notice", boolSettingText("privacy_notice_enabled", true)],
    ["Acknowledgement required", boolSettingText("privacy_acknowledgement_required", true)],
    ["Privacy notice version", settingText("privacy_notice_version", "2026.1")],
    ["Privacy display mode", settingText("privacy_display_mode", "modal")],
    ["Planned visits retention", settingText("retention_planned_days", 30) + " days"],
    ["Visit history retention", settingText("retention_visit_log_days", 365) + " days"],
    ["Audit retention", settingText("retention_audit_days", 730) + " days"],
    ["No-show retention", settingText("planned_no_show_retention_days", 30) + " days"]
  ].forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    list.appendChild(wrapper);
  });
}

function syncLegacyBridgeVisibility() {
  const available = canOpenLegacyPrivacyGdpr();
  const bridge = $("privacyGdprLegacyActions");
  if (bridge) bridge.classList.toggle("hidden", !available);
  const restricted = $("privacyGdprLegacyRestricted");
  if (restricted) restricted.classList.toggle("hidden", available);
}

function renderAll() {
  renderOverview();
  renderCases();
  renderSettings();
  syncLegacyBridgeVisibility();
}

async function loadPrivacyGdprCases() {
  const result = await supabaseClient.rpc("superuser_list_gdpr_cases");
  if (result.error) throw result.error;
  privacyGdprCases = Array.isArray(result.data) ? result.data : [];
  privacyGdprCasesLoaded = true;
}

export async function loadPrivacyGdprAdministration(options) {
  if (!canViewPrivacyGdpr()) return;
  const settings = options || {};
  setStatus("Loading privacy and GDPR foundation...", "info");
  privacyGdprCases = [];
  privacyGdprCasesLoaded = false;

  const results = await Promise.allSettled([
    loadSystemSettings(),
    loadPrivacyGdprCases()
  ]);

  renderAll();
  const errors = results.filter(result => result.status === "rejected");
  if (errors.length) {
    setStatus("Privacy / GDPR foundation loaded with limited read-only data.", "error");
    if (settings.manual) {
      showToast(
        "Privacy / GDPR partially loaded",
        "Some read-only privacy data is unavailable under current permissions.",
        "error"
      );
    }
  } else {
    setStatus("Privacy / GDPR foundation loaded.", "success");
    if (settings.manual) {
      showToast("Privacy / GDPR refreshed", "Read-only privacy status was loaded.", "success");
    }
  }
}

export function syncPrivacyGdprVisibility() {
  const visible = canViewPrivacyGdpr();
  const nav = $("administrationPrivacyGdprNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  syncLegacyBridgeVisibility();
  if (!visible && $("privacyGdprSection") && !$("privacyGdprSection").classList.contains("hidden")) {
    if (hasAnyCapability(["settings.view", "settings.edit"])) setAdministrationSection("reference");
    else if (hasAnyCapability(["devices.view", "devices.manage"])) setAdministrationSection("terminals");
    else if (hasAnyCapability(["module_configuration.view", "module_configuration.manage", "visitor.housekeeping.run"])) setAdministrationSection("modules");
    else if (hasAnyCapability(["access_control.view", "access_control.manage"])) setAdministrationSection("access");
  }
}

export async function openPrivacyGdprAdministration() {
  syncPrivacyGdprVisibility();
  if (!requirePrivacyGdprAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("privacyGdpr");
  await loadPrivacyGdprAdministration({ manual: false });
}

export function configurePrivacyGdprAdministration(dependencies) {
  privacyGdprDependencies = dependencies || {};
}

function openLegacyPrivacyGdprTarget(action) {
  if (!canOpenLegacyPrivacyGdpr()) {
    showToast(
      "Legacy GDPR unavailable",
      "Legacy GDPR workflows are available to SuperUser in this migration step.",
      "error"
    );
    return;
  }
  if (typeof privacyGdprDependencies.openLegacyVms === "function") {
    privacyGdprDependencies.openLegacyVms(action);
  }
}

export function initialisePrivacyGdprAdministration(dependencies) {
  if (dependencies) configurePrivacyGdprAdministration(dependencies);
  if (privacyGdprInitialised) return;
  privacyGdprInitialised = true;

  if ($("administrationPrivacyGdprNav")) {
    $("administrationPrivacyGdprNav").addEventListener("click", openPrivacyGdprAdministration);
  }
  if ($("privacyGdprRefreshButton")) {
    $("privacyGdprRefreshButton").addEventListener("click", () => {
      loadPrivacyGdprAdministration({ manual: true });
    });
  }

  LEGACY_PRIVACY_ACTIONS.forEach(([id, action]) => {
    const button = $(id);
    if (button) button.addEventListener("click", () => openLegacyPrivacyGdprTarget(action));
  });

  window.addEventListener("oh:capabilities-changed", syncPrivacyGdprVisibility);
  syncPrivacyGdprVisibility();
  renderAll();
}
