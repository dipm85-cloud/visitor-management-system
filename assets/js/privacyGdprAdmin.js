import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { createSidePanelController, renderEmptyState } from "./platformUi.js";
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
  ["privacyGdprSearchLegacyButton", "gdpr-search"],
  ["privacyGdprLegacySarButton", "gdpr-sar"],
  ["privacyGdprLegacyErasureButton", "gdpr-erasure"],
  ["privacyGdprLegacyEvidenceButton", "gdpr-evidence"]
];

const SEARCH_GROUPS = {
  planned_visits: {
    title: "Planned Visits",
    description: "Existing planned-visit records matching the current search."
  },
  visit_log: {
    title: "Visitor History / Visit Log",
    description: "Existing visit-log records matching the current search."
  },
  document_evidence: {
    title: "Document Sign-off Evidence / Agreement Signatures",
    description: "Read-only agreement evidence returned by existing sign-off search endpoints."
  },
  audit_events: {
    title: "Audit Events",
    description: "Audit events returned by the existing audit search endpoint where current access allows it."
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
  const searchBridge = $("privacyGdprSearchLegacyButton");
  if (searchBridge) searchBridge.classList.toggle("hidden", !available);
  const restricted = $("privacyGdprLegacyRestricted");
  if (restricted) restricted.classList.toggle("hidden", available);
}

function renderAll() {
  renderOverview();
  renderCases();
  renderSettings();
  renderSearchResults();
  syncLegacyBridgeVisibility();
}

function currentSearchPayload() {
  return {
    searchText: $("privacyGdprSearchText") ? $("privacyGdprSearchText").value.trim() : "",
    fromDate: $("privacyGdprSearchFromDate") ? $("privacyGdprSearchFromDate").value : "",
    toDate: $("privacyGdprSearchToDate") ? $("privacyGdprSearchToDate").value : "",
    recordType: $("privacyGdprSearchRecordType") ? $("privacyGdprSearchRecordType").value : "all"
  };
}

function validateSearchPayload(payload) {
  if (!payload) return "Search filters are unavailable.";
  if (!hasValue(payload.searchText) && !hasValue(payload.fromDate) && !hasValue(payload.toDate)) {
    return "Enter search text or a date range before searching.";
  }
  if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
    return "From date must be on or before to date.";
  }
  return "";
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
  ], payload.searchText));
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
  ], payload.searchText));
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
  return rows.map(row => createSearchRecord("document_evidence", row, {
    id: row.agreement_id || row.id || row.agreement_signature_id,
    title: row.visitor_name,
    subtitle: [row.company, row.agreement_name || row.agreement_title].filter(Boolean).join(" - "),
    date: row.signed_at,
    status: row.has_signature || row.has_visitor_signature ? "Signature" : "Evidence recorded",
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
    p_event_type: null,
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

function renderSearchResults() {
  const container = $("privacyGdprSearchResults");
  if (!container) return;
  container.replaceChildren();
  if (!privacyGdprSearchGroups.length) {
    const empty = document.createElement("div");
    empty.id = "privacyGdprSearchEmpty";
    empty.className = "people-empty-state";
    empty.setAttribute("data-oh-empty-state", "");
    empty.textContent = "Enter search text or a date range to search native read-only privacy records.";
    container.appendChild(empty);
    renderEmptyState(empty, {
      title: "No privacy search yet",
      description: "Search results remain separate by source and are not identity-linked."
    });
    return;
  }
  privacyGdprSearchGroups.forEach(group => container.appendChild(createResultGroupElement(group)));
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
    const list = document.createElement("dl");
    list.className = "privacy-gdpr-search-details-list";
    (record.fields || []).filter(field => field.always || hasValue(field.value)).forEach(field => {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = field.label;
      dd.textContent = textOrDash(field.value);
      wrapper.append(dt, dd);
      list.appendChild(wrapper);
    });
    body.append(summary, list);
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
  privacyGdprSearchGroups = [];
  setSearchStatus("Searching native privacy records...", "info");
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
  const count = groups.reduce((sum, group) => sum + ((group.records || []).length), 0);
  if (errors.length) {
    showToast(
      "Privacy search partially loaded",
      errors.length + " source(s) were unavailable under current permissions.",
      "error"
    );
  }
  setSearchStatus("Privacy search complete. " + count + " read-only record(s) found.", "success");
}

function resetPrivacySearch() {
  ["privacyGdprSearchText", "privacyGdprSearchFromDate", "privacyGdprSearchToDate"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  if ($("privacyGdprSearchRecordType")) $("privacyGdprSearchRecordType").value = "all";
  privacyGdprSearchGroups = [];
  setSearchStatus("", "");
  renderSearchResults();
}

function applySearchQuickFilter(days) {
  if ($("privacyGdprSearchFromDate")) $("privacyGdprSearchFromDate").value = dateDaysAgo(days);
  if ($("privacyGdprSearchToDate")) $("privacyGdprSearchToDate").value = todayDate();
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
  const searchSection = $("privacyGdprSearchSection");
  if (searchSection) searchSection.classList.toggle("hidden", !visible);
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

  LEGACY_PRIVACY_ACTIONS.forEach(([id, action]) => {
    const button = $(id);
    if (button) button.addEventListener("click", () => openLegacyPrivacyGdprTarget(action));
  });

  window.addEventListener("oh:capabilities-changed", syncPrivacyGdprVisibility);
  syncPrivacyGdprVisibility();
  renderAll();
}
