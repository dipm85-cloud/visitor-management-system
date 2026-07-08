import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { downloadTextFile } from "./exports.js";
import { showToast } from "./messages.js";
import { buildOperationsPrintDocument, createSidePanelController, renderEmptyState } from "./platformUi.js";
import { refreshSectionNavigator, registerModuleSections, selectModuleSection } from "./sectionNavigation.js";
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
  ["privacyGdprCaseLegacyButton", "gdpr-cases"],
  ["privacyGdprLegacySearchButton", "gdpr-search"],
  ["privacyGdprSearchLegacyButton", "gdpr-search"],
  ["privacyGdprEvidencePackLegacySearchButton", "gdpr-search"],
  ["privacyGdprEvidencePackLegacySarButton", "gdpr-sar"],
  ["privacyGdprEvidencePackLegacyEvidenceButton", "gdpr-evidence"],
  ["privacyGdprEvidencePackLegacyErasureButton", "gdpr-erasure"],
  ["privacyGdprLegacySarButton", "gdpr-sar"],
  ["privacyGdprLegacyErasureButton", "gdpr-erasure"],
  ["privacyGdprLegacyEvidenceButton", "gdpr-evidence"]
];

const SEARCH_GROUPS = {
  planned_visits: {
    title: "Planned Visits",
    description: "Existing planned-visit records matching the current search.",
    target: "privacyGdprPlannedResultsSection",
    container: "privacyGdprPlannedResults"
  },
  visit_log: {
    title: "Visitor History / Visit Log",
    description: "Existing visit-log records matching the current search.",
    target: "privacyGdprVisitLogResultsSection",
    container: "privacyGdprVisitLogResults"
  },
  document_evidence: {
    title: "Document Sign-off Evidence / Agreement Signatures",
    description: "Read-only agreement evidence returned by existing sign-off search endpoints.",
    target: "privacyGdprDocumentEvidenceResultsSection",
    container: "privacyGdprDocumentEvidenceResults"
  },
  audit_events: {
    title: "Audit Events",
    description: "Audit events returned by the existing audit search endpoint where current access allows it.",
    target: "privacyGdprAuditResultsSection",
    container: "privacyGdprAuditResults"
  },
  legacy_only: {
    title: "Legacy-only GDPR Records",
    description: "GDPR case, SAR, erasure and evidence workflows remain in Legacy VMS for this milestone."
  }
};

let privacyGdprInitialised = false;
let privacyGdprDependencies = {};
let privacyGdprCases = [];
let privacyGdprCasesLoaded = false;
let privacyGdprSearchGroups = [];
let privacyGdprSearchDetailsPanelController = null;
let privacyGdprSearchSequence = 0;
let privacyGdprHasSearched = false;
let privacyGdprEvidencePackGroups = [];
let privacyGdprEvidencePackPayload = null;
let privacyGdprEvidencePackHasPreview = false;
let privacyGdprEvidencePackSequence = 0;

const SOURCE_SEARCH_CONFIG = {
  planned_visits: {
    sectionId: "planned-visits",
    searchInput: "privacyGdprPlannedSearchText",
    fromDate: "privacyGdprPlannedFromDate",
    toDate: "privacyGdprPlannedToDate",
    status: "privacyGdprPlannedStatus",
    statusId: "privacyGdprPlannedSearchStatus",
    searchButton: "privacyGdprPlannedSearchButton",
    resetButton: "privacyGdprPlannedResetButton",
    quickButtons: [
      ["privacyGdprPlannedTodayButton", 0],
      ["privacyGdprPlannedSevenDaysButton", 6],
      ["privacyGdprPlannedThirtyDaysButton", 29]
    ]
  },
  visit_log: {
    sectionId: "visit-log",
    searchInput: "privacyGdprVisitLogSearchText",
    fromDate: "privacyGdprVisitLogFromDate",
    toDate: "privacyGdprVisitLogToDate",
    status: "privacyGdprVisitLogStatus",
    statusId: "privacyGdprVisitLogSearchStatus",
    searchButton: "privacyGdprVisitLogSearchButton",
    resetButton: "privacyGdprVisitLogResetButton",
    quickButtons: [
      ["privacyGdprVisitLogTodayButton", 0],
      ["privacyGdprVisitLogSevenDaysButton", 6],
      ["privacyGdprVisitLogThirtyDaysButton", 29]
    ]
  },
  document_evidence: {
    sectionId: "document-evidence",
    searchInput: "privacyGdprDocumentSearchText",
    fromDate: "privacyGdprDocumentFromDate",
    toDate: "privacyGdprDocumentToDate",
    status: "privacyGdprDocumentStatus",
    statusId: "privacyGdprDocumentSearchStatus",
    searchButton: "privacyGdprDocumentSearchButton",
    resetButton: "privacyGdprDocumentResetButton",
    quickButtons: [
      ["privacyGdprDocumentTodayButton", 0],
      ["privacyGdprDocumentSevenDaysButton", 6],
      ["privacyGdprDocumentThirtyDaysButton", 29]
    ]
  },
  audit_events: {
    sectionId: "audit-events",
    searchInput: "privacyGdprAuditSearchText",
    fromDate: "privacyGdprAuditFromDate",
    toDate: "privacyGdprAuditToDate",
    eventType: "privacyGdprAuditEventType",
    statusId: "privacyGdprAuditSearchStatus",
    searchButton: "privacyGdprAuditSearchButton",
    resetButton: "privacyGdprAuditResetButton",
    quickButtons: [
      ["privacyGdprAuditTodayButton", 0],
      ["privacyGdprAuditSevenDaysButton", 6],
      ["privacyGdprAuditThirtyDaysButton", 29]
    ]
  }
};

const EVIDENCE_PACK_SOURCE_INPUTS = [
  ["planned_visits", "privacyGdprEvidencePackSourcePlanned"],
  ["visit_log", "privacyGdprEvidencePackSourceVisitLog"],
  ["document_evidence", "privacyGdprEvidencePackSourceDocuments"],
  ["audit_events", "privacyGdprEvidencePackSourceAudit"]
];

function hasActiveStaffUser() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

function isSuperUserProfile() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.role === "super_user"
  );
}

function canViewPrivacyGdpr() {
  return hasActiveStaffUser() && hasAnyCapability(PRIVACY_GDPR_VIEW);
}

function canOpenLegacyPrivacyGdpr() {
  return canViewPrivacyGdpr() && isSuperUserProfile();
}

function canViewPlannedVisitPrivacySearch() {
  return canViewPrivacyGdpr();
}

function canViewVisitLogPrivacySearch() {
  return canViewPrivacyGdpr();
}

function canViewPrivacyCaseDetails() {
  return canViewPrivacyGdpr();
}

function canViewSarEvidencePack() {
  return hasActiveStaffUser() && (
    isSuperUserProfile() ||
    hasAnyCapability([
      "privacy.view",
      "privacy.manage",
      "gdpr.view",
      "gdpr.manage",
      "audit.view",
      "module_configuration.manage"
    ])
  );
}

function canViewDocumentEvidencePrivacySearch() {
  return canViewPrivacyGdpr() && hasAnyCapability([
    "privacy.view",
    "privacy.manage",
    "gdpr.view",
    "gdpr.manage",
    "audit.view",
    "visitor.history.view",
    "module_configuration.manage"
  ]);
}

function canViewAuditPrivacySearch() {
  return canViewPrivacyGdpr() && hasAnyCapability(["audit.view"]);
}

function canViewSourceSearch(sourceId) {
  if (sourceId === "planned_visits") return canViewPlannedVisitPrivacySearch();
  if (sourceId === "visit_log") return canViewVisitLogPrivacySearch();
  if (sourceId === "document_evidence") return canViewDocumentEvidencePrivacySearch();
  if (sourceId === "audit_events") return canViewAuditPrivacySearch();
  return canViewPrivacyGdpr();
}

function selectPrivacyGdprSection(sectionId, options) {
  return selectModuleSection("privacy-gdpr", sectionId, options);
}

function searchGroupById(id) {
  return privacyGdprSearchGroups.find(group => group && group.id === id) || null;
}

function searchGroupRecordCount(id) {
  const group = searchGroupById(id);
  return group && Array.isArray(group.records) ? group.records.length : 0;
}

function hasSearchGroupRecords(id) {
  return searchGroupRecordCount(id) > 0;
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
    "Privacy / Data Governance requires an existing privacy, GDPR, audit or settings capability.",
    "error"
  );
  return false;
}

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function hasValue(value) {
  return String(value == null ? "" : value).trim() !== "";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? textOrDash(value) : date.toLocaleString();
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function todayDate() {
  return formatDateOnly(new Date());
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days || 0));
  return formatDateOnly(date);
}

function normaliseSearchText(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function matchesSearchText(row, fields, searchText) {
  const needle = normaliseSearchText(searchText);
  if (!needle) return true;
  return (fields || []).some(field => normaliseSearchText(row && row[field]).includes(needle));
}

function selectedSearchTypes(recordType) {
  const type = recordType || "all";
  if (type === "all") return ["planned_visits", "visit_log", "document_evidence", "audit_events", "legacy_only"];
  return [type];
}

function searchDateToTimestampEnd(value) {
  return value ? value + "T23:59:59.999" : null;
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

function setSearchStatus(message, type) {
  const element = $("privacyGdprSearchStatus");
  if (!element) return;
  element.textContent = message || "";
  element.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function setEvidencePackStatus(message, type) {
  const element = $("privacyGdprEvidencePackStatus");
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

  const actions = document.createElement("div");
  actions.className = "privacy-gdpr-card-actions";
  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "secondary";
  detailButton.textContent = "View Details";
  detailButton.addEventListener("click", event => openPrivacyCaseDetails(row, event.currentTarget));
  actions.appendChild(detailButton);

  item.append(heading, meta, actions);
  return item;
}

function currentCaseFilters() {
  return {
    searchText: $("privacyGdprCaseSearchText") ? $("privacyGdprCaseSearchText").value.trim() : "",
    type: $("privacyGdprCaseTypeFilter") ? $("privacyGdprCaseTypeFilter").value : "all",
    status: $("privacyGdprCaseStatusFilter") ? $("privacyGdprCaseStatusFilter").value : "all"
  };
}

function matchesCaseFilter(row, filters) {
  const settings = filters || {};
  const type = normaliseSearchText(settings.type || "all");
  const status = normaliseSearchText(settings.status || "all");
  if (type !== "all" && normaliseSearchText(row.request_type).replaceAll(" ", "_") !== type) return false;
  if (status !== "all" && normaliseSearchText(row.status).replaceAll(" ", "_") !== status) return false;
  return matchesSearchText(row, [
    "case_reference",
    "request_type",
    "status",
    "priority",
    "requester_name",
    "requester_contact",
    "decision",
    "decision_reason",
    "identity_verification_method"
  ], settings.searchText);
}

function filteredPrivacyCases() {
  const filters = currentCaseFilters();
  return privacyGdprCases.filter(row => row && matchesCaseFilter(row, filters));
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

function createCaseWorkspaceRow(row) {
  const item = document.createElement("article");
  item.className = "privacy-gdpr-result-row privacy-gdpr-case-result-row";

  const primary = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = textOrDash(row.case_reference);
  const subtitle = document.createElement("span");
  subtitle.textContent = [row.requester_name, row.request_type].filter(Boolean).join(" - ") || "Privacy case";
  primary.append(name, subtitle);

  const source = document.createElement("div");
  source.className = "privacy-gdpr-result-source";
  source.textContent = textOrDash(row.status);
  const priority = document.createElement("small");
  priority.textContent = "Priority: " + textOrDash(row.priority || "normal");
  source.appendChild(priority);

  const date = document.createElement("span");
  date.textContent = formatDate(row.request_received_at || row.created_at);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "secondary";
  action.textContent = "View Details";
  action.addEventListener("click", event => openPrivacyCaseDetails(row, event.currentTarget));

  item.append(primary, source, date, action);
  return item;
}

function renderCaseWorkspace() {
  const list = $("privacyGdprCasesWorkspaceList");
  const count = $("privacyGdprCasesWorkspaceCount");
  if (!list) return;
  list.replaceChildren();
  const rows = privacyGdprCasesLoaded ? filteredPrivacyCases() : [];
  if (count) count.textContent = privacyGdprCasesLoaded ? String(rows.length) : "-";

  if (!privacyGdprCasesLoaded) {
    renderEmptyState(list, {
      title: "Case data unavailable",
      description: "Privacy case data could not be loaded under the current access."
    });
    return;
  }

  if (!rows.length) {
    renderEmptyState(list, {
      title: "No privacy cases found",
      description: "No read-only GDPR case records match the current filters."
    });
    return;
  }

  const group = document.createElement("section");
  group.className = "privacy-gdpr-result-group";
  const header = document.createElement("div");
  header.className = "privacy-gdpr-result-group-header";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = "Read-only case records";
  const description = document.createElement("p");
  description.textContent = "Open a case to review details and timeline evidence supported by existing case data.";
  titleBlock.append(title, description);
  const badge = document.createElement("span");
  badge.className = "privacy-gdpr-result-count";
  badge.textContent = String(rows.length);
  header.append(titleBlock, badge);

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "privacy-gdpr-result-list";
  rowsContainer.setAttribute("data-oh-scroll-region", "operational");
  rows.slice(0, 100).forEach(row => rowsContainer.appendChild(createCaseWorkspaceRow(row)));
  group.append(header, rowsContainer);
  list.appendChild(group);
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
  const searchBridge = $("privacyGdprSearchLegacyButton");
  if (searchBridge) searchBridge.classList.toggle("hidden", !available);
  const caseBridge = $("privacyGdprCaseLegacyButton");
  if (caseBridge) caseBridge.classList.toggle("hidden", !available);
  [
    "privacyGdprEvidencePackLegacySearchButton",
    "privacyGdprEvidencePackLegacySarButton",
    "privacyGdprEvidencePackLegacyEvidenceButton",
    "privacyGdprEvidencePackLegacyErasureButton"
  ].forEach(id => {
    if ($(id)) $(id).classList.toggle("hidden", !available);
  });
  const restricted = $("privacyGdprLegacyRestricted");
  if (restricted) restricted.classList.toggle("hidden", available);
}

function syncEvidencePackSourceVisibility() {
  EVIDENCE_PACK_SOURCE_INPUTS.forEach(([sourceId, inputId]) => {
    const input = $(inputId);
    if (!input) return;
    const label = input.closest("label");
    const visible = canViewSourceSearch(sourceId);
    input.disabled = !visible;
    if (!visible) input.checked = false;
    if (label) label.classList.toggle("hidden", !visible);
  });
}

function renderAll() {
  renderOverview();
  renderCases();
  renderCaseWorkspace();
  syncEvidencePackSourceVisibility();
  renderEvidencePackPreview();
  renderSettings();
  renderSearchResults();
  syncLegacyBridgeVisibility();
  refreshSectionNavigator("privacy-gdpr");
}

function currentSearchPayload() {
  return {
    searchText: $("privacyGdprSearchText") ? $("privacyGdprSearchText").value.trim() : "",
    fromDate: $("privacyGdprSearchFromDate") ? $("privacyGdprSearchFromDate").value : "",
    toDate: $("privacyGdprSearchToDate") ? $("privacyGdprSearchToDate").value : "",
    recordType: $("privacyGdprSearchRecordType") ? $("privacyGdprSearchRecordType").value : "all"
  };
}

function currentSourceSearchPayload(sourceId) {
  const config = SOURCE_SEARCH_CONFIG[sourceId] || {};
  return {
    searchText: config.searchInput && $(config.searchInput) ? $(config.searchInput).value.trim() : "",
    fromDate: config.fromDate && $(config.fromDate) ? $(config.fromDate).value : "",
    toDate: config.toDate && $(config.toDate) ? $(config.toDate).value : "",
    recordType: sourceId,
    status: config.status && $(config.status) ? $(config.status).value : "all",
    eventType: config.eventType && $(config.eventType) ? $(config.eventType).value.trim() : ""
  };
}

function selectedEvidencePackSources() {
  return EVIDENCE_PACK_SOURCE_INPUTS
    .filter(([sourceId, inputId]) => $(inputId) && $(inputId).checked && !$(inputId).disabled && canViewSourceSearch(sourceId))
    .map(([sourceId]) => sourceId);
}

function currentEvidencePackPayload() {
  return {
    searchText: $("privacyGdprEvidencePackSearchText") ? $("privacyGdprEvidencePackSearchText").value.trim() : "",
    fromDate: $("privacyGdprEvidencePackFromDate") ? $("privacyGdprEvidencePackFromDate").value : "",
    toDate: $("privacyGdprEvidencePackToDate") ? $("privacyGdprEvidencePackToDate").value : "",
    sources: selectedEvidencePackSources()
  };
}

function validateSearchPayload(payload) {
  if (!payload) return "Search filters are unavailable.";
  const hasStatusFilter = hasValue(payload.status) && payload.status !== "all";
  if (!hasValue(payload.searchText) && !hasValue(payload.fromDate) && !hasValue(payload.toDate) && !hasValue(payload.eventType) && !hasStatusFilter) {
    return "Enter search text or a date range before searching.";
  }
  if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
    return "From date must be on or before to date.";
  }
  return "";
}

function validateEvidencePackPayload(payload) {
  if (!payload) return "Evidence pack filters are unavailable.";
  if (!payload.sources || !payload.sources.length) return "Select at least one source category before previewing.";
  if (!hasValue(payload.searchText) && !hasValue(payload.fromDate) && !hasValue(payload.toDate)) {
    return "Enter search text or a date range before previewing an evidence pack.";
  }
  if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
    return "From date must be on or before to date.";
  }
  return "";
}

function matchesSelectedStatus(value, selectedStatus) {
  const selected = normaliseSearchText(selectedStatus || "all");
  if (!selected || selected === "all") return true;
  return normaliseSearchText(value).replaceAll(" ", "_").replaceAll("-", "_") === selected;
}

function evidenceStatus(row) {
  if (row.has_signature || row.has_visitor_signature) return "signature";
  if (row.accepted_without_signature) return "tick_acceptance";
  return "evidence_recorded";
}

function applyDateRange(query, column, payload, timestampColumn) {
  let nextQuery = query;
  if (payload.fromDate) {
    nextQuery = nextQuery.gte(column, timestampColumn ? payload.fromDate + "T00:00:00" : payload.fromDate);
  }
  if (payload.toDate) {
    nextQuery = nextQuery.lte(column, timestampColumn ? searchDateToTimestampEnd(payload.toDate) : payload.toDate);
  }
  return nextQuery;
}

function createUnavailableGroup(id, message) {
  const settings = SEARCH_GROUPS[id] || {};
  return {
    id,
    title: settings.title || id,
    description: settings.description || "",
    records: [],
    unavailable: true,
    message
  };
}

function recordField(label, value, always) {
  return { label, value, always: always === true };
}

function createSearchRecord(groupId, row, settings) {
  const options = settings || {};
  return {
    id: groupId + ":" + textOrDash(options.id || row.id || row.agreement_id || row.event_id),
    groupId,
    sourceId: options.id || row.id || row.agreement_id || row.event_id || "-",
    title: textOrDash(options.title),
    subtitle: textOrDash(options.subtitle),
    date: textOrDash(options.date),
    status: textOrDash(options.status),
    module: textOrDash(options.module),
    summary: options.summary || "",
    fields: options.fields || [],
    raw: row || {}
  };
}

async function searchPlannedVisits(payload) {
  let query = supabaseClient
    .from("planned_visits")
    .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, status, created_by, modified_by, modified_at")
    .order("visit_date", { ascending: false })
    .limit(500);
  query = applyDateRange(query, "visit_date", payload, false);
  const result = await query;
  if (result.error) throw result.error;
  const rows = (result.data || []).filter(row => matchesSearchText(row, [
    "visitor_name",
    "company",
    "id",
    "visit_reason",
    "vehicle_plate",
    "onsite_contact",
    "security_pass_id",
    "notes",
    "status"
  ], payload.searchText) && matchesSelectedStatus(row.status || "planned", payload.status));
  return rows.map(row => createSearchRecord("planned_visits", row, {
    id: row.id,
    title: row.visitor_name,
    subtitle: row.company || row.visit_reason || "Planned visit",
    date: [row.visit_date, row.expected_time].filter(Boolean).join(" "),
    status: row.status || "planned",
    module: "Visitors",
    summary: "Read-only planned visit record. This result is not linked to any other identity record.",
    fields: [
      recordField("Visitor / subject as stored", row.visitor_name, true),
      recordField("Company as stored", row.company),
      recordField("Visit date", row.visit_date, true),
      recordField("Expected time", row.expected_time),
      recordField("Visit reason", row.visit_reason),
      recordField("Vehicle registration", row.vehicle_plate),
      recordField("Security pass ID", row.security_pass_id),
      recordField("On-site contact", row.onsite_contact),
      recordField("Status", row.status || "planned", true),
      recordField("Visit reference", row.id, true),
      recordField("Modified", formatDate(row.modified_at))
    ]
  }));
}

async function searchVisitLog(payload) {
  let query = supabaseClient
    .from("visit_log")
    .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
    .order("sign_in_time", { ascending: false })
    .limit(500);
  query = applyDateRange(query, "sign_in_time", payload, true);
  const result = await query;
  if (result.error) throw result.error;
  const rows = (result.data || []).filter(row => matchesSearchText(row, [
    "visitor_name",
    "company",
    "id",
    "planned_visit_id",
    "visit_reason",
    "vehicle_plate",
    "onsite_contact",
    "security_pass_id",
    "visit_status",
    "visit_origin"
  ], payload.searchText) && matchesSelectedStatus(
    row.visit_status || (row.sign_out_time ? "signed_out" : "signed_in"),
    payload.status
  ));
  return rows.map(row => createSearchRecord("visit_log", row, {
    id: row.id,
    title: row.visitor_name,
    subtitle: row.company || row.visit_reason || "Visit log",
    date: row.sign_in_time,
    status: row.visit_status || (row.sign_out_time ? "signed_out" : "signed_in"),
    module: "Visitors",
    summary: "Read-only visit-log record. Matching records are listed separately and are not merged into one identity.",
    fields: [
      recordField("Visitor / subject as stored", row.visitor_name, true),
      recordField("Company as stored", row.company),
      recordField("Sign-in time", formatDate(row.sign_in_time), true),
      recordField("Sign-out time", formatDate(row.sign_out_time)),
      recordField("Visit reason", row.visit_reason),
      recordField("Vehicle registration", row.vehicle_plate),
      recordField("Security pass ID", row.security_pass_id),
      recordField("On-site contact", row.onsite_contact),
      recordField("Visit status", row.visit_status || (row.sign_out_time ? "signed_out" : "signed_in"), true),
      recordField("Visit origin", row.visit_origin),
      recordField("Privacy notice version", row.privacy_notice_version),
      recordField("Privacy accepted at", formatDate(row.privacy_notice_accepted_at)),
      recordField("Visit reference", row.id, true),
      recordField("Planned visit reference", row.planned_visit_id)
    ]
  }));
}

async function runAgreementSearch(payload, rpcName) {
  const calls = [];
  const base = {
    p_date_from: payload.fromDate || null,
    p_date_to: payload.toDate || null,
    p_agreement_type_id: null
  };
  if (rpcName === "search_visitor_agreements") {
    base.p_agreement_version_id = null;
  } else {
    base.p_inductor = null;
  }
  if (payload.searchText) {
    calls.push(supabaseClient.rpc(rpcName, Object.assign({}, base, {
      p_visitor_name: payload.searchText,
      p_company: null
    })));
    calls.push(supabaseClient.rpc(rpcName, Object.assign({}, base, {
      p_visitor_name: null,
      p_company: payload.searchText
    })));
  } else {
    calls.push(supabaseClient.rpc(rpcName, Object.assign({}, base, {
      p_visitor_name: null,
      p_company: null
    })));
  }
  const results = await Promise.all(calls);
  const rows = [];
  results.forEach(result => {
    if (result.error) throw result.error;
    (result.data || []).forEach(row => {
      const key = row.agreement_id || row.id || row.agreement_signature_id || JSON.stringify(row);
      if (!rows.some(existing => (existing.agreement_id || existing.id || existing.agreement_signature_id || JSON.stringify(existing)) === key)) {
        rows.push(row);
      }
    });
  });
  return rows;
}

async function searchDocumentEvidence(payload) {
  const rows = await runAgreementSearch(payload, "search_visitor_agreements");
  return rows.filter(row => matchesSelectedStatus(evidenceStatus(row), payload.status))
    .map(row => createSearchRecord("document_evidence", row, {
    id: row.agreement_id || row.id || row.agreement_signature_id,
    title: row.visitor_name,
    subtitle: [row.company, row.agreement_name || row.agreement_title].filter(Boolean).join(" - "),
    date: row.signed_at,
    status: evidenceStatus(row).replaceAll("_", " "),
    module: "Document Sign-offs",
    summary: "Read-only agreement evidence metadata. Signature images and raw evidence payloads are not shown here.",
    fields: [
      recordField("Visitor / subject as stored", row.visitor_name, true),
      recordField("Company as stored", row.company),
      recordField("Document", row.agreement_name || row.agreement_title, true),
      recordField("Version", row.agreement_version_number),
      recordField("Signed date/time", formatDate(row.signed_at), true),
      recordField("Recorded by / witness", row.signed_by_name),
      recordField("Inductor", row.inductor_name),
      recordField("Visit reference", row.visit_log_id || row.visitor_log_id),
      recordField("Evidence reference", row.agreement_id || row.id || row.agreement_signature_id, true),
      recordField("Document type ID", row.agreement_type_id),
      recordField("Document version ID", row.agreement_version_id)
    ]
  }));
}

async function searchAuditEvents(payload) {
  if (!hasAnyCapability(["audit.view"])) {
    return createUnavailableGroup("audit_events", "Audit Events require audit.view.");
  }
  const result = await supabaseClient.rpc("superuser_list_audit_events", {
    p_from_date: payload.fromDate || null,
    p_to_date: payload.toDate || null,
    p_event_type: payload.eventType || null,
    p_search_text: payload.searchText || null
  });
  if (result.error) throw result.error;
  return (result.data || []).map(row => createSearchRecord("audit_events", row, {
    id: row.id || row.event_id,
    title: row.event_type,
    subtitle: [row.entity_type, row.actor_display_name].filter(Boolean).join(" - "),
    date: row.created_at,
    status: row.entity_type || "audit",
    module: "Audit",
    summary: "Read-only audit metadata returned by the existing audit endpoint.",
    fields: [
      recordField("Event type", row.event_type, true),
      recordField("Event time", formatDate(row.created_at), true),
      recordField("Actor", row.actor_display_name),
      recordField("Entity type", row.entity_type),
      recordField("Entity reference", row.entity_id),
      recordField("Audit reference", row.id || row.event_id, true)
    ]
  }));
}

async function loadSearchGroup(id, payload) {
  if (id === "planned_visits") return { id, records: await searchPlannedVisits(payload) };
  if (id === "visit_log") return { id, records: await searchVisitLog(payload) };
  if (id === "document_evidence") return { id, records: await searchDocumentEvidence(payload) };
  if (id === "audit_events") {
    const auditResult = await searchAuditEvents(payload);
    return Array.isArray(auditResult) ? { id, records: auditResult } : auditResult;
  }
  if (id === "legacy_only") {
    return createUnavailableGroup("legacy_only", "Use the Legacy GDPR bridge for GDPR cases, SAR export, erasure/anonymisation and GDPR evidence workflows.");
  }
  return createUnavailableGroup(id, "This source is not available in the native privacy search yet.");
}

function createResultGroupElement(group) {
  const settings = SEARCH_GROUPS[group.id] || {};
  const section = document.createElement("section");
  section.className = "privacy-gdpr-result-group";
  section.setAttribute("aria-label", settings.title || group.id);

  const header = document.createElement("div");
  header.className = "privacy-gdpr-result-group-header";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = settings.title || group.title || group.id;
  const description = document.createElement("p");
  description.textContent = group.message || settings.description || "";
  titleBlock.append(title, description);
  const count = document.createElement("span");
  count.className = "privacy-gdpr-result-count";
  count.textContent = group.unavailable ? "Unavailable" : String((group.records || []).length);
  header.append(titleBlock, count);
  section.appendChild(header);

  if (group.unavailable) {
    const unavailable = document.createElement("div");
    unavailable.className = "privacy-gdpr-unavailable";
    unavailable.textContent = group.message || "This source is not available under current access.";
    section.appendChild(unavailable);
    return section;
  }

  if (!group.records || !group.records.length) {
    const empty = document.createElement("div");
    empty.className = "privacy-gdpr-unavailable";
    empty.textContent = "No matching records returned for this source.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "privacy-gdpr-result-list";
  list.setAttribute("data-oh-scroll-region", "operational");
  group.records.slice(0, 50).forEach(record => {
    const row = document.createElement("article");
    row.className = "privacy-gdpr-result-row";
    const primary = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = record.title;
    const subtitle = document.createElement("span");
    subtitle.textContent = record.subtitle;
    primary.append(name, subtitle);

    const source = document.createElement("div");
    source.className = "privacy-gdpr-result-source";
    source.textContent = record.module;
    const status = document.createElement("small");
    status.textContent = record.status;
    source.appendChild(status);

    const date = document.createElement("span");
    date.textContent = formatDate(record.date);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "secondary";
    action.textContent = "View Details";
    action.addEventListener("click", event => openSearchResultDetails(record, event.currentTarget));

    row.append(primary, source, date, action);
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

function clearSearchResultContainers() {
  Object.values(SEARCH_GROUPS).forEach(settings => {
    if (settings.container && $(settings.container)) {
      $(settings.container).replaceChildren();
    }
  });
}

function renderSourceInitialState(sourceId) {
  const settings = SEARCH_GROUPS[sourceId] || {};
  const container = settings.container ? $(settings.container) : null;
  if (!container) return;
  renderEmptyState(container, {
    title: "No source search yet",
    description: "Use this section's filters to search " + (settings.title || "this source") + " records."
  });
}

function renderSearchSummary() {
  const summary = $("privacyGdprSearchSummary");
  if (!summary) return;

  if (!privacyGdprHasSearched) {
    summary.textContent = "Search results will appear as separate sections after you run a search.";
    summary.classList.remove("has-results");
    return;
  }

  const availableGroups = privacyGdprSearchGroups.filter(group =>
    group && !group.unavailable && (group.records || []).length > 0
  );
  const total = availableGroups.reduce((sum, group) => sum + (group.records || []).length, 0);
  const counts = availableGroups.map(group => {
    const settings = SEARCH_GROUPS[group.id] || {};
    return (settings.title || group.id) + ": " + (group.records || []).length;
  });
  summary.textContent = "Search complete: " + total + " record(s) found across " +
    availableGroups.length + " categor" + (availableGroups.length === 1 ? "y" : "ies") +
    (counts.length ? ". " + counts.join(" | ") : ".");
  summary.classList.toggle("has-results", total > 0);
}

function renderSearchResults() {
  clearSearchResultContainers();
  renderSearchSummary();
  ["planned_visits", "visit_log", "document_evidence", "audit_events"].forEach(sourceId => {
    const settings = SEARCH_GROUPS[sourceId] || {};
    const container = settings.container ? $(settings.container) : null;
    if (!container || !canViewSourceSearch(sourceId)) return;
    const group = searchGroupById(sourceId);
    if (group) {
      container.appendChild(createResultGroupElement(group));
    } else {
      renderSourceInitialState(sourceId);
    }
  });
  refreshSectionNavigator("privacy-gdpr");
}

function evidencePackResultCount() {
  return privacyGdprEvidencePackGroups.reduce((sum, group) => sum + ((group.records || []).length), 0);
}

function evidencePackSearchPayloadForSource(sourceId, payload) {
  return {
    searchText: payload.searchText,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    recordType: sourceId,
    status: "all",
    eventType: ""
  };
}

function renderEvidencePackSummary() {
  const summary = $("privacyGdprEvidencePackSummary");
  const count = $("privacyGdprEvidencePackCount");
  if (!summary) return;
  if (count) count.textContent = privacyGdprEvidencePackHasPreview ? String(evidencePackResultCount()) : "No preview";

  if (!privacyGdprEvidencePackHasPreview || !privacyGdprEvidencePackPayload) {
    summary.textContent = "Evidence pack preview is read-only and does not confirm that matching source records belong to one person.";
    summary.classList.remove("has-results");
    return;
  }

  const unavailable = privacyGdprEvidencePackGroups.filter(group => group.unavailable).length;
  const available = privacyGdprEvidencePackGroups.filter(group => !group.unavailable);
  const counts = available.map(group => {
    const settings = SEARCH_GROUPS[group.id] || {};
    return (settings.title || group.id) + ": " + ((group.records || []).length);
  });
  summary.textContent = "Evidence pack preview: " + evidencePackResultCount() + " matching source record(s). " +
    "Search text: " + textOrDash(privacyGdprEvidencePackPayload.searchText) + ". " +
    "Date range: " + textOrDash(privacyGdprEvidencePackPayload.fromDate) + " to " +
    textOrDash(privacyGdprEvidencePackPayload.toDate) + ". " +
    (counts.length ? counts.join(" | ") + ". " : "") +
    (unavailable ? unavailable + " source(s) unavailable under current access. " : "") +
    "This is not a complete SAR export and does not identity-link records.";
  summary.classList.toggle("has-results", evidencePackResultCount() > 0);
}

function renderEvidencePackPreview() {
  const container = $("privacyGdprEvidencePackResults");
  if (!container) return;
  container.replaceChildren();
  renderEvidencePackSummary();

  if (!privacyGdprEvidencePackHasPreview) {
    renderEmptyState(container, {
      title: "No evidence pack preview yet",
      description: "Enter search criteria, choose source categories and preview matching read-only records."
    });
    return;
  }

  if (!privacyGdprEvidencePackGroups.length) {
    renderEmptyState(container, {
      title: "No source categories selected",
      description: "Select at least one available source category before previewing."
    });
    return;
  }

  privacyGdprEvidencePackGroups.forEach(group => {
    container.appendChild(createResultGroupElement(group));
  });
}

async function previewEvidencePack() {
  if (!canViewSarEvidencePack()) {
    showToast("Evidence pack unavailable", "SAR Evidence Pack requires an existing privacy, GDPR, audit or module capability.", "error");
    return;
  }

  const payload = currentEvidencePackPayload();
  const validationMessage = validateEvidencePackPayload(payload);
  if (validationMessage) {
    showToast("Evidence pack needs filters", validationMessage, "error");
    return;
  }

  const sequence = ++privacyGdprEvidencePackSequence;
  privacyGdprEvidencePackPayload = payload;
  privacyGdprEvidencePackHasPreview = true;
  privacyGdprEvidencePackGroups = [];
  setEvidencePackStatus("Previewing read-only evidence metadata...", "info");
  renderEvidencePackPreview();

  const results = await Promise.allSettled(payload.sources.map(sourceId => {
    if (!canViewSourceSearch(sourceId)) {
      return Promise.resolve(createUnavailableGroup(sourceId, "This source is not available under current permissions."));
    }
    return loadSearchGroup(sourceId, evidencePackSearchPayloadForSource(sourceId, payload));
  }));
  if (sequence !== privacyGdprEvidencePackSequence) return;

  const groups = [];
  const errors = [];
  results.forEach((result, index) => {
    const sourceId = payload.sources[index];
    if (result.status === "fulfilled") {
      groups.push(result.value);
      return;
    }
    errors.push({ sourceId, error: result.reason });
    groups.push(createUnavailableGroup(sourceId, "This source could not be previewed under current permissions."));
  });

  privacyGdprEvidencePackGroups = groups;
  renderEvidencePackPreview();
  selectPrivacyGdprSection("evidence-pack", { focus: false, resetScroll: false });
  if (errors.length) {
    showToast(
      "Evidence pack partially previewed",
      errors.length + " source(s) were unavailable under current permissions.",
      "error"
    );
  }
  setEvidencePackStatus("", "");
}

function evidencePackMetadata() {
  const payload = privacyGdprEvidencePackPayload || {};
  return {
    generated_at: new Date().toISOString(),
    preview_only: true,
    warning: "Evidence pack preview only. This is not a complete SAR export and records are not identity-linked.",
    search_text: payload.searchText || "",
    date_from: payload.fromDate || "",
    date_to: payload.toDate || "",
    sources: privacyGdprEvidencePackGroups.map(group => {
      const settings = SEARCH_GROUPS[group.id] || {};
      return {
        source_id: group.id,
        source_label: settings.title || group.title || group.id,
        unavailable: !!group.unavailable,
        message: group.message || "",
        count: (group.records || []).length,
        records: (group.records || []).map(record => ({
          record_reference: record.sourceId,
          title: record.title,
          subtitle: record.subtitle,
          date: record.date,
          status: record.status,
          module: record.module,
          summary: record.summary,
          fields: (record.fields || [])
            .filter(field => field.always || hasValue(field.value))
            .map(field => ({
              label: field.label,
              value: textOrDash(field.value)
            }))
        }))
      };
    })
  };
}

function downloadEvidencePackJson() {
  if (!privacyGdprEvidencePackHasPreview) {
    showToast("Preview required", "Preview the evidence pack before downloading metadata.", "error");
    return;
  }
  downloadTextFile(
    "sar-evidence-pack-preview-" + todayDate() + ".json",
    JSON.stringify(evidencePackMetadata(), null, 2),
    "application/json"
  );
  showToast("Evidence metadata downloaded", "Preview metadata JSON was downloaded. Legacy VMS remains the complete SAR workflow.", "success");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sarPrintFieldAllowed(field) {
  const label = normaliseSearchText(field && field.label);
  if (!label) return false;
  return ![
    "actor",
    "recorded by / witness",
    "inductor",
    "modified",
    "created by",
    "modified by"
  ].includes(label);
}

function printEvidencePackPreview() {
  if (!privacyGdprEvidencePackHasPreview) {
    showToast("Preview required", "Preview the evidence pack before printing.", "error");
    return;
  }

  const data = evidencePackMetadata();
  const sourceList = data.sources.map(source => source.source_label).join(", ");
  const groupsHtml = data.sources.map(source =>
    "<section class='source'>" +
      "<h2>" + escapeHtml(source.source_label) + " (" + source.count + ")</h2>" +
      (source.unavailable
        ? "<p class='warning'>" + escapeHtml(source.message || "Source unavailable.") + "</p>"
        : source.records.map(record =>
          "<article class='record oh-print-avoid-break'>" +
            "<h3>" + escapeHtml(record.title) + "</h3>" +
            "<p>" + escapeHtml([record.subtitle, record.status, record.date].filter(Boolean).join(" | ")) + "</p>" +
            "<dl>" + record.fields.filter(sarPrintFieldAllowed).map(field =>
              "<div><dt>" + escapeHtml(field.label) + "</dt><dd>" + escapeHtml(field.value) + "</dd></div>"
            ).join("") + "</dl>" +
          "</article>"
        ).join(""))
    + "</section>"
  ).join("");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Print preview blocked", "The browser blocked the printable preview window.", "error");
    return;
  }
  const bodyHtml =
    "<div class='sar-print-warning'><strong>Preview only.</strong> This is an internal privacy review document, not a complete SAR disclosure pack. Matching records are not identity-linked.</div>" +
    groupsHtml;
  const html = buildOperationsPrintDocument({
    title: "SAR Evidence Pack Preview",
    subtitle: "Internal Privacy Review - Generated for authorised review",
    kicker: "Operations Hub / Privacy",
    companyName: settingValue("company_name", "Operations Hub"),
    siteName: settingValue("site_name", settingValue("default_site_name", "")),
    logoUrl: settingValue("logo_url", ""),
    generatedAt: new Date(data.generated_at).toLocaleString(),
    orientation: "portrait",
    contextFields: [
      { label: "Search text", value: data.search_text || "-" },
      { label: "Date range", value: (data.date_from || "-") + " to " + (data.date_to || "-") },
      { label: "Source categories", value: sourceList || "-" },
      { label: "Purpose", value: "Evidence Pack Preview" }
    ],
    reference: "SAR preview " + todayDate(),
    footerText: "Internal Privacy Review",
    bodyHtml,
    extraStyles:
      ".sar-print-warning{border:1px solid #9ca3af;background:#f9fafb;padding:10px;border-radius:8px;margin-bottom:14px;font-weight:700;}" +
      ".source{margin-top:18px;}" +
      ".source h2{margin:0 0 8px;font-size:14px;color:#111827;}" +
      ".warning{border:1px solid #f59e0b;background:#fffbeb;padding:10px;border-radius:8px;}" +
      ".record{border:1px solid #d1d5db;border-radius:8px;padding:10px;margin:8px 0;}" +
      ".record h3{margin:0 0 4px;font-size:12px;color:#0f172a;}" +
      ".record p{margin:0 0 8px;color:#4b5563;font-weight:700;}" +
      ".record dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}" +
      ".record dt{font-size:9px;text-transform:uppercase;color:#667085;font-weight:800;}" +
      ".record dd{margin:2px 0 0;overflow-wrap:anywhere;}" +
      "@media print{.record dl{grid-template-columns:repeat(2,minmax(0,1fr));}}"
  });
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function resetEvidencePackPreview() {
  ["privacyGdprEvidencePackSearchText", "privacyGdprEvidencePackFromDate", "privacyGdprEvidencePackToDate"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  EVIDENCE_PACK_SOURCE_INPUTS.forEach(([, inputId]) => {
    if ($(inputId)) $(inputId).checked = true;
  });
  syncEvidencePackSourceVisibility();
  privacyGdprEvidencePackPayload = null;
  privacyGdprEvidencePackGroups = [];
  privacyGdprEvidencePackHasPreview = false;
  setEvidencePackStatus("", "");
  renderEvidencePackPreview();
  selectPrivacyGdprSection("evidence-pack", { focus: false, resetScroll: false });
}

function appendDetailsList(parent, fields) {
  const list = document.createElement("dl");
  list.className = "privacy-gdpr-search-details-list";
  (fields || []).filter(field => field.always || hasValue(field.value)).forEach(field => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = field.label;
    dd.textContent = textOrDash(field.value);
    wrapper.append(dt, dd);
    list.appendChild(wrapper);
  });
  parent.appendChild(list);
  return list;
}

function timelineItem(kind, title, date, description, meta, details) {
  return {
    kind: kind || "case",
    title: title || "Timeline entry",
    date: date || "",
    description: description || "",
    meta: meta || "",
    details: details || null
  };
}

function createPrivacyCaseTimelineItems(caseRecord, notes) {
  const items = [];
  if (caseRecord.request_received_at || caseRecord.created_at) {
    items.push(timelineItem(
      "case",
      "Case received",
      caseRecord.request_received_at || caseRecord.created_at,
      "GDPR/privacy case record exists in the current case backend.",
      "Case reference: " + textOrDash(caseRecord.case_reference)
    ));
  }
  if (caseRecord.completed_at) {
    items.push(timelineItem(
      "case",
      "Case completed",
      caseRecord.completed_at,
      textOrDash(caseRecord.decision || caseRecord.status),
      caseRecord.decision_reason ? "Decision reason recorded" : ""
    ));
  }
  (notes || []).forEach(note => {
    items.push(timelineItem(
      "note",
      textOrDash(note.note_type || "Case note"),
      note.created_at,
      note.note_text || "",
      ["By " + textOrDash(note.created_by_name), note.source_module || note.source_table].filter(Boolean).join(" - "),
      note.details || null
    ));
  });
  return items.sort((a, b) => {
    const aDate = a.date ? new Date(a.date).getTime() : 0;
    const bDate = b.date ? new Date(b.date).getTime() : 0;
    return aDate - bDate;
  });
}

function appendPrivacyTimeline(parent, items) {
  const section = document.createElement("section");
  section.className = "privacy-gdpr-timeline-section";
  const heading = document.createElement("h3");
  heading.textContent = "Evidence Timeline";
  section.appendChild(heading);

  if (!items || !items.length) {
    const empty = document.createElement("div");
    empty.className = "privacy-gdpr-unavailable";
    empty.textContent = "No supported case timeline entries are available.";
    section.appendChild(empty);
    parent.appendChild(section);
    return;
  }

  const list = document.createElement("ol");
  list.className = "privacy-gdpr-timeline";
  items.forEach(item => {
    const row = document.createElement("li");
    row.className = "privacy-gdpr-timeline-item";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = [formatDate(item.date), item.meta].filter(value => value && value !== "-").join(" - ");
    const description = document.createElement("p");
    description.textContent = item.description || "Timeline entry recorded by existing data.";
    row.append(title, meta, description);
    if (item.details) {
      const details = document.createElement("pre");
      details.textContent = typeof item.details === "string" ? item.details : JSON.stringify(item.details, null, 2);
      row.appendChild(details);
    }
    list.appendChild(row);
  });
  section.appendChild(list);
  parent.appendChild(section);
}

function appendPrivacyCaseLegacyBridge(parent) {
  if (!canOpenLegacyPrivacyGdpr()) return;
  const bridge = document.createElement("section");
  bridge.className = "privacy-gdpr-detail-actions";
  const note = document.createElement("p");
  note.textContent = "This privacy workflow is still completed in Legacy VMS.";
  const cases = document.createElement("button");
  cases.type = "button";
  cases.className = "secondary";
  cases.textContent = "Open Legacy GDPR Case Tools";
  cases.addEventListener("click", () => openLegacyPrivacyGdprTarget("gdpr-cases"));
  const evidence = document.createElement("button");
  evidence.type = "button";
  evidence.className = "secondary";
  evidence.textContent = "Open Legacy GDPR Evidence";
  evidence.addEventListener("click", () => openLegacyPrivacyGdprTarget("gdpr-evidence"));
  bridge.append(note, cases, evidence);
  parent.appendChild(bridge);
}

async function loadPrivacyCaseTimeline(caseRecord) {
  if (!caseRecord || !caseRecord.id) return [];
  const result = await supabaseClient.rpc("superuser_list_gdpr_case_notes", {
    p_case_id: caseRecord.id
  });
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

function renderPrivacyCaseDetailsPanel(caseRecord, notes, timelineError) {
  const title = $("privacyGdprSearchDetailsTitle");
  const eyebrow = $("privacyGdprSearchDetailsEyebrow");
  const body = $("privacyGdprSearchDetailsBody");
  if (title) title.textContent = textOrDash(caseRecord.case_reference);
  if (eyebrow) eyebrow.textContent = "Privacy Case";
  if (!body) return;

  body.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "privacy-gdpr-search-details-summary";
  summary.textContent = "Read-only GDPR/privacy case details. No native anonymisation, erasure, export or identity linking is available in this view.";

  body.appendChild(summary);
  appendDetailsList(body, [
    recordField("Case reference", caseRecord.case_reference, true),
    recordField("Subject / requester as stored", caseRecord.requester_name, true),
    recordField("Requester contact", caseRecord.requester_contact),
    recordField("Case type", caseRecord.request_type, true),
    recordField("Status", caseRecord.status, true),
    recordField("Priority", caseRecord.priority || "normal"),
    recordField("Received", formatDate(caseRecord.request_received_at || caseRecord.created_at), true),
    recordField("Due date", caseRecord.due_date),
    recordField("Completed", formatDate(caseRecord.completed_at)),
    recordField("Identity verified", caseRecord.identity_verified ? "Yes" : "No"),
    recordField("Verification method", caseRecord.identity_verification_method),
    recordField("Outcome / decision", caseRecord.decision),
    recordField("Decision reason", caseRecord.decision_reason),
    recordField("Source module", "Legacy GDPR case backend", true),
    recordField("Case record reference", caseRecord.id, true)
  ]);

  if (timelineError) {
    const unavailable = document.createElement("div");
    unavailable.className = "privacy-gdpr-unavailable";
    unavailable.textContent = "Timeline evidence could not be loaded under current permissions.";
    body.appendChild(unavailable);
  } else {
    appendPrivacyTimeline(body, createPrivacyCaseTimelineItems(caseRecord, notes));
  }
  appendPrivacyCaseLegacyBridge(body);
}

async function openPrivacyCaseDetails(caseRecord, trigger) {
  if (!canViewPrivacyCaseDetails()) {
    showToast("Case details unavailable", "You do not have permission to view Privacy / Data Governance details.", "error");
    return;
  }
  if (!privacyGdprSearchDetailsPanelController || !caseRecord) return;
  renderPrivacyCaseDetailsPanel(caseRecord, null, false);
  privacyGdprSearchDetailsPanelController.open({ trigger });
  try {
    const notes = await loadPrivacyCaseTimeline(caseRecord);
    renderPrivacyCaseDetailsPanel(caseRecord, notes, false);
  } catch (error) {
    showToast("Case timeline unavailable", error && error.message ? error.message : "The case timeline could not be loaded.", "error");
    renderPrivacyCaseDetailsPanel(caseRecord, null, true);
  }
}

function openSearchResultDetails(record, trigger) {
  if (!privacyGdprSearchDetailsPanelController) return;
  const title = $("privacyGdprSearchDetailsTitle");
  const eyebrow = $("privacyGdprSearchDetailsEyebrow");
  const body = $("privacyGdprSearchDetailsBody");
  if (title) title.textContent = record.title;
  if (eyebrow) eyebrow.textContent = SEARCH_GROUPS[record.groupId]?.title || "Privacy Record";
  if (body) {
    body.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "privacy-gdpr-search-details-summary";
    summary.textContent = record.summary || "Read-only native privacy search result.";
    body.appendChild(summary);
    appendDetailsList(body, record.fields || []);
  }
  privacyGdprSearchDetailsPanelController.open({ trigger });
}

async function searchPrivacyDataSubject() {
  if (!requirePrivacyGdprAccess()) return;
  const payload = currentSearchPayload();
  const validationMessage = validateSearchPayload(payload);
  if (validationMessage) {
    showToast("Search needs filters", validationMessage, "error");
    return;
  }

  const sequence = ++privacyGdprSearchSequence;
  const types = selectedSearchTypes(payload.recordType);
  privacyGdprHasSearched = true;
  privacyGdprSearchGroups = [];
  setSearchStatus("Searching native privacy records...", "info");
  if ($("privacyGdprSearchSummary")) {
    $("privacyGdprSearchSummary").textContent = "Searching native read-only privacy records...";
    $("privacyGdprSearchSummary").classList.remove("has-results");
  }
  renderSearchResults();

  const results = await Promise.allSettled(types.map(type => loadSearchGroup(type, payload)));
  if (sequence !== privacyGdprSearchSequence) return;

  const groups = [];
  const errors = [];
  results.forEach((result, index) => {
    const type = types[index];
    if (result.status === "fulfilled") {
      groups.push(result.value);
      return;
    }
    errors.push({ type, error: result.reason });
    groups.push(createUnavailableGroup(
      type,
      "This source could not be searched under current permissions."
    ));
  });

  privacyGdprSearchGroups = groups;
  renderSearchResults();
  selectPrivacyGdprSection("search", { focus: false, resetScroll: false });
  if (errors.length) {
    showToast(
      "Privacy search partially loaded",
      errors.length + " source(s) were unavailable under current permissions.",
      "error"
    );
  }
  setSearchStatus("", "");
}

function replaceSearchGroup(group) {
  if (!group || !group.id) return;
  privacyGdprSearchGroups = privacyGdprSearchGroups.filter(existing => existing.id !== group.id);
  privacyGdprSearchGroups.push(group);
  privacyGdprHasSearched = privacyGdprSearchGroups.length > 0;
}

function removeSearchGroup(sourceId) {
  privacyGdprSearchGroups = privacyGdprSearchGroups.filter(group => group.id !== sourceId);
  privacyGdprHasSearched = privacyGdprSearchGroups.length > 0;
}

function setSourceSearchStatus(sourceId, message, type) {
  const config = SOURCE_SEARCH_CONFIG[sourceId] || {};
  const element = config.statusId ? $(config.statusId) : null;
  if (!element) return;
  element.textContent = message || "";
  element.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

async function searchPrivacySource(sourceId) {
  if (!requirePrivacyGdprAccess()) return;
  if (!canViewSourceSearch(sourceId)) {
    showToast("Source unavailable", "You do not have permission to view this privacy source.", "error");
    return;
  }

  const payload = currentSourceSearchPayload(sourceId);
  const validationMessage = validateSearchPayload(payload);
  if (validationMessage) {
    showToast("Search needs filters", validationMessage, "error");
    return;
  }

  const settings = SEARCH_GROUPS[sourceId] || {};
  setSourceSearchStatus(sourceId, "Searching " + (settings.title || "source") + " records...", "info");
  try {
    const group = await loadSearchGroup(sourceId, payload);
    replaceSearchGroup(group);
    renderSearchResults();
    selectPrivacyGdprSection(SOURCE_SEARCH_CONFIG[sourceId]?.sectionId, { focus: false, resetScroll: false });
    setSourceSearchStatus(sourceId, "", "");
  } catch (error) {
    replaceSearchGroup(createUnavailableGroup(
      sourceId,
      "This source could not be searched under current permissions."
    ));
    renderSearchResults();
    showToast("Privacy source search failed", error && error.message ? error.message : "The source search could not be completed.", "error");
    setSourceSearchStatus(sourceId, "Search failed under current permissions.", "error");
  }
}

function resetPrivacySourceSearch(sourceId) {
  const config = SOURCE_SEARCH_CONFIG[sourceId] || {};
  [config.searchInput, config.fromDate, config.toDate, config.eventType].forEach(id => {
    if (id && $(id)) $(id).value = "";
  });
  if (config.status && $(config.status)) $(config.status).value = "all";
  removeSearchGroup(sourceId);
  setSourceSearchStatus(sourceId, "", "");
  renderSearchResults();
  selectPrivacyGdprSection(config.sectionId, { focus: false, resetScroll: false });
}

function resetPrivacySearch() {
  ["privacyGdprSearchText", "privacyGdprSearchFromDate", "privacyGdprSearchToDate"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  if ($("privacyGdprSearchRecordType")) $("privacyGdprSearchRecordType").value = "all";
  privacyGdprHasSearched = false;
  privacyGdprSearchGroups = [];
  setSearchStatus("", "");
  renderSearchResults();
  selectPrivacyGdprSection("search", { focus: false, resetScroll: false });
}

function applyPrivacyCaseFilters() {
  renderCaseWorkspace();
  selectPrivacyGdprSection("cases", { focus: false, resetScroll: false });
}

function resetPrivacyCaseFilters() {
  if ($("privacyGdprCaseSearchText")) $("privacyGdprCaseSearchText").value = "";
  if ($("privacyGdprCaseTypeFilter")) $("privacyGdprCaseTypeFilter").value = "all";
  if ($("privacyGdprCaseStatusFilter")) $("privacyGdprCaseStatusFilter").value = "all";
  const status = $("privacyGdprCaseStatus");
  if (status) {
    status.textContent = "";
    status.className = "local-action-status";
  }
  renderCaseWorkspace();
  selectPrivacyGdprSection("cases", { focus: false, resetScroll: false });
}

function applySearchQuickFilter(days) {
  if ($("privacyGdprSearchFromDate")) $("privacyGdprSearchFromDate").value = dateDaysAgo(days);
  if ($("privacyGdprSearchToDate")) $("privacyGdprSearchToDate").value = todayDate();
}

function applySourceSearchQuickFilter(sourceId, days) {
  const config = SOURCE_SEARCH_CONFIG[sourceId] || {};
  if (config.fromDate && $(config.fromDate)) $(config.fromDate).value = dateDaysAgo(days);
  if (config.toDate && $(config.toDate)) $(config.toDate).value = todayDate();
}

function registerPrivacyGdprSections() {
  registerModuleSections("privacy-gdpr", [
    {
      id: "overview",
      title: "Overview",
      icon: "O",
      target: "privacyGdprOverviewSection",
      order: 10,
      default: true,
      visible: canViewPrivacyGdpr
    },
    {
      id: "search",
      title: "Search All Sources",
      icon: "S",
      target: "privacyGdprSearchSection",
      order: 20,
      visible: canViewPrivacyGdpr
    },
    {
      id: "cases",
      title: "Privacy Cases",
      icon: "C",
      target: "privacyGdprCasesSection",
      order: 25,
      visible: canViewPrivacyCaseDetails
    },
    {
      id: "evidence-pack",
      title: "SAR Evidence Pack",
      icon: "EP",
      target: "privacyGdprEvidencePackSection",
      order: 28,
      visible: canViewSarEvidencePack
    },
    {
      id: "planned-visits",
      title: "Planned Visits",
      icon: "PV",
      target: "privacyGdprPlannedResultsSection",
      order: 30,
      visible: canViewPlannedVisitPrivacySearch
    },
    {
      id: "visit-log",
      title: "Visit Log",
      icon: "VL",
      target: "privacyGdprVisitLogResultsSection",
      order: 40,
      visible: canViewVisitLogPrivacySearch
    },
    {
      id: "document-evidence",
      title: "Document Evidence",
      icon: "DE",
      target: "privacyGdprDocumentEvidenceResultsSection",
      order: 50,
      visible: canViewDocumentEvidencePrivacySearch
    },
    {
      id: "audit-events",
      title: "Audit Events",
      icon: "AE",
      target: "privacyGdprAuditResultsSection",
      order: 60,
      visible: canViewAuditPrivacySearch
    },
    {
      id: "legacy-tools",
      title: "Legacy Tools",
      icon: "L",
      target: "privacyGdprLegacySection",
      order: 70,
      visible: canOpenLegacyPrivacyGdpr
    }
  ], {
    root: "privacyGdprSection",
    content: "privacyGdprWorkspaceContent",
    defaultSection: "overview",
    scrollRoot: "operationsHubWorkspace",
    label: "Privacy / Data Governance section navigation",
    title: "Sections",
    toggleLabel: "Privacy section",
    emptyMessage: "No Privacy / Data Governance sections are available under your current access."
  });
}

async function loadPrivacyGdprCases() {
  const result = await supabaseClient.rpc("superuser_list_gdpr_cases");
  if (result.error) throw result.error;
  privacyGdprCases = Array.isArray(result.data) ? result.data : [];
  privacyGdprCasesLoaded = true;
}

export async function loadPrivacyGdprAdministration(options) {
  if (!canViewPrivacyGdpr()) return;
  setStatus("", "");
  privacyGdprCases = [];
  privacyGdprCasesLoaded = false;

  const results = await Promise.allSettled([
    loadSystemSettings(),
    loadPrivacyGdprCases()
  ]);

  renderAll();
  const errors = results.filter(result => result.status === "rejected");
  if (errors.length) {
    setStatus("Some read-only privacy data is unavailable under current permissions.", "error");
    showToast(
      "Privacy / GDPR partially loaded",
      "Some read-only privacy data is unavailable under current permissions.",
      "error"
    );
  } else {
    setStatus("", "");
  }
}

export function syncPrivacyGdprVisibility() {
  const visible = canViewPrivacyGdpr();
  const nav = $("administrationPrivacyGdprNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  const searchSection = $("privacyGdprSearchSection");
  if (searchSection) searchSection.classList.toggle("hidden", !visible);
  const casesSection = $("privacyGdprCasesSection");
  if (casesSection) casesSection.classList.toggle("hidden", !canViewPrivacyCaseDetails());
  const evidencePackSection = $("privacyGdprEvidencePackSection");
  if (evidencePackSection) evidencePackSection.classList.toggle("hidden", !canViewSarEvidencePack());
  syncEvidencePackSourceVisibility();
  syncLegacyBridgeVisibility();
  refreshSectionNavigator("privacy-gdpr");
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
  selectPrivacyGdprSection("overview", { focus: false });
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
  registerPrivacyGdprSections();
  privacyGdprSearchDetailsPanelController = createSidePanelController({
    backdrop: "privacyGdprSearchDetailsPanelBackdrop",
    panel: "privacyGdprSearchDetailsPanel",
    title: "privacyGdprSearchDetailsTitle",
    closeTriggers: [
      "privacyGdprSearchDetailsClose",
      "privacyGdprSearchDetailsCloseBottom"
    ],
    reset() {
      const body = $("privacyGdprSearchDetailsBody");
      if (body) body.replaceChildren();
    }
  });

  if ($("administrationPrivacyGdprNav")) {
    $("administrationPrivacyGdprNav").addEventListener("click", openPrivacyGdprAdministration);
  }
  if ($("privacyGdprRefreshButton")) {
    $("privacyGdprRefreshButton").addEventListener("click", () => {
      loadPrivacyGdprAdministration({ manual: true });
    });
  }
  if ($("privacyGdprSearchButton")) {
    $("privacyGdprSearchButton").addEventListener("click", searchPrivacyDataSubject);
  }
  if ($("privacyGdprSearchResetButton")) {
    $("privacyGdprSearchResetButton").addEventListener("click", resetPrivacySearch);
  }
  if ($("privacyGdprCaseFilterButton")) {
    $("privacyGdprCaseFilterButton").addEventListener("click", applyPrivacyCaseFilters);
  }
  if ($("privacyGdprCaseResetButton")) {
    $("privacyGdprCaseResetButton").addEventListener("click", resetPrivacyCaseFilters);
  }
  if ($("privacyGdprCaseSearchText")) {
    $("privacyGdprCaseSearchText").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyPrivacyCaseFilters();
      }
    });
  }
  if ($("privacyGdprEvidencePackPreviewButton")) {
    $("privacyGdprEvidencePackPreviewButton").addEventListener("click", previewEvidencePack);
  }
  if ($("privacyGdprEvidencePackResetButton")) {
    $("privacyGdprEvidencePackResetButton").addEventListener("click", resetEvidencePackPreview);
  }
  if ($("privacyGdprEvidencePackDownloadJsonButton")) {
    $("privacyGdprEvidencePackDownloadJsonButton").addEventListener("click", downloadEvidencePackJson);
  }
  if ($("privacyGdprEvidencePackPrintButton")) {
    $("privacyGdprEvidencePackPrintButton").addEventListener("click", printEvidencePackPreview);
  }
  if ($("privacyGdprEvidencePackSearchText")) {
    $("privacyGdprEvidencePackSearchText").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        previewEvidencePack();
      }
    });
  }
  if ($("privacyGdprSearchText")) {
    $("privacyGdprSearchText").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchPrivacyDataSubject();
      }
    });
  }
  if ($("privacyGdprSearchTodayButton")) {
    $("privacyGdprSearchTodayButton").addEventListener("click", () => applySearchQuickFilter(0));
  }
  if ($("privacyGdprSearchSevenDaysButton")) {
    $("privacyGdprSearchSevenDaysButton").addEventListener("click", () => applySearchQuickFilter(6));
  }
  if ($("privacyGdprSearchThirtyDaysButton")) {
    $("privacyGdprSearchThirtyDaysButton").addEventListener("click", () => applySearchQuickFilter(29));
  }
  Object.entries(SOURCE_SEARCH_CONFIG).forEach(([sourceId, config]) => {
    if (config.searchButton && $(config.searchButton)) {
      $(config.searchButton).addEventListener("click", () => searchPrivacySource(sourceId));
    }
    if (config.resetButton && $(config.resetButton)) {
      $(config.resetButton).addEventListener("click", () => resetPrivacySourceSearch(sourceId));
    }
    if (config.searchInput && $(config.searchInput)) {
      $(config.searchInput).addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchPrivacySource(sourceId);
        }
      });
    }
    (config.quickButtons || []).forEach(([buttonId, days]) => {
      if ($(buttonId)) {
        $(buttonId).addEventListener("click", () => applySourceSearchQuickFilter(sourceId, days));
      }
    });
  });

  LEGACY_PRIVACY_ACTIONS.forEach(([id, action]) => {
    const button = $(id);
    if (button) button.addEventListener("click", () => openLegacyPrivacyGdprTarget(action));
  });

  window.addEventListener("oh:capabilities-changed", syncPrivacyGdprVisibility);
  syncPrivacyGdprVisibility();
  renderAll();
}
