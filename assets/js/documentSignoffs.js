import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { settingValue } from "./settings.js";
import { todayDate } from "./utils.js";
import { createSidePanelController, renderEmptyState } from "./platformUi.js";

let documentSignoffDependencies = {};
let documentSignoffInitialised = false;
let documentSignoffLoadSequence = 0;
let documentSignoffDetailsPanelController = null;
let documentSignoffOverviewState = {
  types: [],
  versions: [],
  summary: {},
  recentEvidence: []
};

function isActiveStaffUser() {
  return AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";
}

export function canViewDocumentSignoffs() {
  return isActiveStaffUser() &&
    hasCapability("visitor.view") &&
    hasAnyCapability([
      "visitor.history.view",
      "agreements.view",
      "reports.view",
      "settings.view",
      "module_configuration.manage"
    ]);
}

function canOpenLegacyManagement() {
  return canViewDocumentSignoffs() && hasAnyCapability([
    "settings.view",
    "settings.edit",
    "module_configuration.manage"
  ]);
}

function canOpenLegacySignoff() {
  return canViewDocumentSignoffs() && hasAnyCapability([
    "visitor.sign_in",
    "visitor.history.view"
  ]);
}

function canOpenLegacyCompliance() {
  return canViewDocumentSignoffs() && hasAnyCapability([
    "reports.view",
    "visitor.history.view"
  ]);
}

function canOpenLegacyEvidence() {
  return canViewDocumentSignoffs() && hasAnyCapability([
    "audit.view",
    "visitor.history.view"
  ]);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setVisible(id, visible) {
  const element = $(id);
  if (element) element.classList.toggle("hidden", !visible);
}

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function hasValue(value) {
  const text = String(value == null ? "" : value).trim();
  return text !== "" && text !== "-";
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function setStatus(message, type) {
  const box = $("documentSignoffStatus");
  if (!box) return;
  box.textContent = message || "";
  box.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function setMetricPlaceholders(value) {
  [
    "documentSignoffTypeCount",
    "documentSignoffActiveVersionCount",
    "documentSignoffRequiredCount",
    "documentSignoffOptionalCount",
    "documentSignoffRecentSignatureCount",
    "documentSignoffMissingRequiredCount"
  ].forEach(id => setText(id, value));
}

function appendTextCell(row, primary, secondary) {
  const cell = document.createElement("td");
  const primaryElement = document.createElement("span");
  primaryElement.className = "visitors-planned-table-primary";
  primaryElement.textContent = textOrDash(primary);
  cell.appendChild(primaryElement);
  if (secondary) {
    const secondaryElement = document.createElement("span");
    secondaryElement.className = "visitors-planned-table-secondary";
    secondaryElement.textContent = secondary;
    cell.appendChild(secondaryElement);
  }
  row.appendChild(cell);
}

function appendBadgeCell(row, label, className) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = "visitors-planned-status " + (className || "");
  badge.textContent = label;
  cell.appendChild(badge);
  row.appendChild(cell);
}

function appendDetailsCell(row, label, onClick) {
  const cell = document.createElement("td");
  cell.className = "document-signoff-row-actions";
  const button = document.createElement("button");
  button.className = "secondary";
  button.type = "button";
  button.textContent = label || "View Details";
  button.addEventListener("click", event => {
    event.stopPropagation();
    onClick(button);
  });
  cell.appendChild(button);
  row.appendChild(cell);
}

function createBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = "visitors-planned-status " + (className || "");
  badge.textContent = label;
  return badge;
}

function activeBadge(isActive) {
  return {
    label: isActive === false ? "Inactive" : "Active",
    className: isActive === false ? "status-inactive" : "status-in"
  };
}

function requirementBadge(required) {
  return {
    label: required ? "Required" : "Optional",
    className: required ? "status-overdue" : ""
  };
}

function signedBadge(record) {
  return {
    label: record && record.signed_at ? "Signed" : "Not signed",
    className: record && record.signed_at ? "status-in" : "status-no-show"
  };
}

function validityRuleText() {
  const mode = String(settingValue("agreement_validity_mode", "version") || "version");
  const days = Number(settingValue("agreement_validity_days", 365) || 365);
  if (mode === "days") return "Valid for " + days + " day(s) after signing";
  if (mode === "either") return "Valid for current version or " + days + " day(s), whichever expires first";
  if (mode === "never") return "No automatic expiry configured";
  return "Valid while the signed document version remains current";
}

function activeVersionForType(type) {
  if (!type) return null;
  const typeId = type.id || type.agreement_type_id;
  return documentSignoffOverviewState.versions.find(version =>
    version.is_active === true &&
    (
      version.agreement_type_id === typeId ||
      version.agreement_name === type.agreement_name
    )
  ) || null;
}

function versionCountForType(type) {
  if (!type) return 0;
  const typeId = type.id || type.agreement_type_id;
  return documentSignoffOverviewState.versions.filter(version =>
    version.agreement_type_id === typeId ||
    version.agreement_name === type.agreement_name
  ).length;
}

function clearDetailPanel() {
  setText("documentSignoffDetailsEyebrow", "Document Sign-off");
  setText("documentSignoffDetailsTitle", "Sign-off Details");
  setText("documentSignoffDetailsSummary", "");
  const status = $("documentSignoffDetailsStatus");
  if (status) status.replaceChildren();
  const list = $("documentSignoffDetailsList");
  if (list) list.replaceChildren();
  const actions = $("documentSignoffDetailsLegacyActions");
  if (actions) actions.replaceChildren();
  setVisible("documentSignoffDetailsLegacySection", false);
}

function renderDetailFields(fields) {
  const list = $("documentSignoffDetailsList");
  if (!list) return;
  list.replaceChildren();
  fields
    .filter(field => field && (field.always || hasValue(field.value)))
    .forEach(field => {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = field.label;
      dd.textContent = textOrDash(field.value);
      wrapper.append(dt, dd);
      list.appendChild(wrapper);
    });
}

function createLegacyActionButton(action) {
  const button = document.createElement("button");
  button.className = "secondary";
  button.type = "button";
  button.textContent = action.label;
  button.addEventListener("click", () => {
    guardedLegacyOpen(action.target, action.allowed, action.deniedMessage);
  });
  return button;
}

function renderDetailPanel(details, trigger) {
  if (!documentSignoffDetailsPanelController) return;
  const settings = details || {};
  clearDetailPanel();
  setText("documentSignoffDetailsEyebrow", settings.eyebrow || "Document Sign-off");
  setText("documentSignoffDetailsTitle", settings.title || "Sign-off Details");
  setText("documentSignoffDetailsSummary", settings.summary || "");

  const status = $("documentSignoffDetailsStatus");
  if (status) {
    (settings.badges || []).forEach(badge => {
      status.appendChild(createBadge(badge.label, badge.className));
    });
  }
  renderDetailFields(settings.fields || []);

  const actions = $("documentSignoffDetailsLegacyActions");
  const availableActions = (settings.legacyActions || []).filter(action => action.allowed());
  if (actions) {
    actions.replaceChildren();
    availableActions.forEach(action => actions.appendChild(createLegacyActionButton(action)));
  }
  setVisible("documentSignoffDetailsLegacySection", availableActions.length > 0);

  documentSignoffDetailsPanelController.open({
    trigger,
    title: settings.title || "Sign-off Details",
    mode: "read-only",
    type: settings.type || "document-signoff-details"
  });
}

function normaliseRows(result) {
  if (!result || result.status !== "fulfilled" || result.value.error) return [];
  return Array.isArray(result.value.data) ? result.value.data : [];
}

function errorMessage(result) {
  if (!result) return "";
  if (result.status === "rejected") return result.reason && result.reason.message
    ? result.reason.message
    : String(result.reason || "Request failed");
  if (result.value && result.value.error) return result.value.error.message || "Request failed";
  return "";
}

function openDocumentTypeDetails(type, trigger) {
  const activeVersion = activeVersionForType(type);
  renderDetailPanel({
    type: "document-type",
    eyebrow: "Document Type",
    title: textOrDash(type.agreement_name || type.agreement_title),
    summary: textOrDash(type.description || type.agreement_title || "Existing agreement type metadata."),
    badges: [
      requirementBadge(type.default_required === true),
      activeBadge(type.is_active)
    ],
    fields: [
      { label: "Name", value: type.agreement_name, always: true },
      { label: "Title", value: type.agreement_title },
      { label: "Required by default", value: yesNo(type.default_required), always: true },
      { label: "Active", value: yesNo(type.is_active !== false), always: true },
      { label: "Description", value: type.description },
      { label: "Validity / expiry", value: validityRuleText(), always: true },
      { label: "Active version", value: activeVersion ? activeVersion.version_number : "" },
      { label: "Known versions", value: versionCountForType(type), always: true },
      { label: "Display order", value: type.display_order },
      { label: "Document type ID", value: type.id || type.agreement_type_id },
      { label: "Created", value: formatDateTime(type.created_at) },
      { label: "Updated", value: formatDateTime(type.updated_at) }
    ],
    legacyActions: [
      {
        label: "Manage in Legacy",
        target: "document-signoffs-management",
        allowed: canOpenLegacyManagement,
        deniedMessage: "Agreement management requires settings or module configuration access."
      },
      {
        label: "Open Legacy Compliance Matrix",
        target: "document-signoffs-compliance",
        allowed: canOpenLegacyCompliance,
        deniedMessage: "Agreement compliance requires visitor history or reporting access."
      }
    ]
  }, trigger);
}

function openDocumentVersionDetails(version, trigger) {
  renderDetailPanel({
    type: "document-version",
    eyebrow: "Document Version",
    title: textOrDash(version.agreement_title || version.agreement_name),
    summary: "Read-only version metadata from the existing agreement document store.",
    badges: [
      activeBadge(version.is_active),
      ...(version.is_active === true ? [{ label: "Valid", className: "status-in" }] : [])
    ],
    fields: [
      { label: "Document", value: version.agreement_name, always: true },
      { label: "Title", value: version.agreement_title },
      { label: "Version", value: version.version_number, always: true },
      { label: "Active", value: yesNo(version.is_active), always: true },
      { label: "Validity / expiry", value: validityRuleText(), always: true },
      { label: "File name", value: version.file_name },
      { label: "Document URL", value: version.pdf_url },
      { label: "Effective / uploaded", value: formatDateTime(version.uploaded_at) },
      { label: "Notes", value: version.notes },
      { label: "Version ID", value: version.id || version.agreement_version_id },
      { label: "Document type ID", value: version.agreement_type_id },
      { label: "Created", value: formatDateTime(version.created_at) },
      { label: "Updated", value: formatDateTime(version.updated_at) }
    ],
    legacyActions: [
      {
        label: "Manage in Legacy",
        target: "document-signoffs-management",
        allowed: canOpenLegacyManagement,
        deniedMessage: "Agreement management requires settings or module configuration access."
      },
      {
        label: "Open Legacy Visitor Sign-off",
        target: "document-signoffs-signoff",
        allowed: canOpenLegacySignoff,
        deniedMessage: "Visitor agreement sign-off requires visitor sign-in or history access."
      }
    ]
  }, trigger);
}

function openEvidenceDetails(record, trigger) {
  renderDetailPanel({
    type: "sign-off-evidence",
    eyebrow: "Signature Evidence",
    title: textOrDash(record.visitor_name || "Evidence record"),
    summary: "Read-only evidence metadata. Signature images and raw evidence payloads are not shown here.",
    badges: [
      signedBadge(record),
      { label: evidenceType(record), className: "status-in" }
    ],
    fields: [
      { label: "Visitor / subject as stored", value: record.visitor_name, always: true },
      { label: "Company as stored", value: record.company },
      { label: "Document", value: record.agreement_name, always: true },
      { label: "Title", value: record.agreement_title },
      { label: "Version", value: record.agreement_version_number },
      { label: "Signed date/time", value: formatDateTime(record.signed_at), always: true },
      { label: "Signature method", value: evidenceType(record), always: true },
      { label: "Recorded by / witness", value: record.signed_by_name },
      { label: "Inductor", value: record.inductor_name },
      { label: "Linked visit", value: record.visit_log_id || record.visitor_log_id },
      { label: "Evidence ID", value: record.id || record.agreement_signature_id },
      { label: "Document type ID", value: record.agreement_type_id },
      { label: "Document version ID", value: record.agreement_version_id },
      { label: "Created", value: formatDateTime(record.created_at) },
      { label: "Updated", value: formatDateTime(record.updated_at) }
    ],
    legacyActions: [
      {
        label: "Open Legacy Evidence Tools",
        target: "document-signoffs-evidence",
        allowed: canOpenLegacyEvidence,
        deniedMessage: "Agreement evidence requires audit or visitor history access."
      },
      {
        label: "Open Legacy Compliance Matrix",
        target: "document-signoffs-compliance",
        allowed: canOpenLegacyCompliance,
        deniedMessage: "Agreement compliance requires visitor history or reporting access."
      }
    ]
  }, trigger);
}

function openComplianceStatusDetails(trigger) {
  const summary = documentSignoffOverviewState.summary || {};
  const hasMissingRequired = hasValue(summary.visitors_missing_required);
  const missingRequired = Number(summary.visitors_missing_required || 0);
  renderDetailPanel({
    type: "compliance-status",
    eyebrow: "Compliance Status",
    title: "Visitor Agreement Status",
    summary: "Read-only status from the existing agreement compliance summary where available.",
    badges: hasMissingRequired ? [
      {
        label: missingRequired > 0 ? "Missing" : "Valid",
        className: missingRequired > 0 ? "status-no-show" : "status-in"
      }
    ] : [],
    fields: [
      { label: "Current visitors missing required sign-offs", value: summary.visitors_missing_required, always: true },
      { label: "Current visitors fully compliant", value: summary.visitors_fully_compliant },
      { label: "Current visitors signed in", value: summary.current_visitors },
      { label: "Active document types", value: summary.active_agreement_types ?? documentSignoffOverviewState.types.filter(type => type.is_active !== false).length, always: true },
      { label: "Active document versions", value: summary.active_agreement_versions ?? documentSignoffOverviewState.versions.filter(version => version.is_active === true).length, always: true },
      { label: "Recent evidence records loaded", value: documentSignoffOverviewState.recentEvidence.length, always: true },
      { label: "Validity / expiry", value: validityRuleText(), always: true }
    ],
    legacyActions: [
      {
        label: "Open Legacy Compliance Matrix",
        target: "document-signoffs-compliance",
        allowed: canOpenLegacyCompliance,
        deniedMessage: "Agreement compliance requires visitor history or reporting access."
      },
      {
        label: "Open Legacy Evidence Tools",
        target: "document-signoffs-evidence",
        allowed: canOpenLegacyEvidence,
        deniedMessage: "Agreement evidence requires audit or visitor history access."
      }
    ]
  }, trigger);
}

function renderTypes(types) {
  const body = $("documentSignoffTypesBody");
  if (!body) return;
  body.replaceChildren();
  types.forEach(type => {
    const row = document.createElement("tr");
    appendTextCell(row, type.agreement_name, type.agreement_title || type.description || "");
    appendBadgeCell(
      row,
      type.default_required ? "Required" : "Optional",
      type.default_required ? "status-overdue" : ""
    );
    appendBadgeCell(
      row,
      type.is_active === false ? "Inactive" : "Active",
      type.is_active === false ? "status-inactive" : "status-in"
    );
    appendTextCell(row, type.display_order);
    appendDetailsCell(row, "View Details", trigger => openDocumentTypeDetails(type, trigger));
    body.appendChild(row);
  });
  setVisible("documentSignoffTypesEmpty", types.length === 0);
  if (!types.length) {
    renderEmptyState("documentSignoffTypesEmpty", {
      title: "No document types available",
      description: "Existing agreement type data could not be loaded or no records are configured."
    });
  }
}

function renderVersions(versions) {
  const body = $("documentSignoffVersionsBody");
  if (!body) return;
  body.replaceChildren();
  versions.forEach(version => {
    const row = document.createElement("tr");
    appendTextCell(row, version.agreement_name, version.agreement_title || version.file_name || "");
    appendTextCell(row, version.version_number, version.file_name || "");
    appendBadgeCell(
      row,
      version.is_active ? "Active" : "Inactive",
      version.is_active ? "status-in" : "status-inactive"
    );
    appendTextCell(row, formatDateTime(version.uploaded_at), version.notes || "");
    appendDetailsCell(row, "View Details", trigger => openDocumentVersionDetails(version, trigger));
    body.appendChild(row);
  });
  setVisible("documentSignoffVersionsEmpty", versions.length === 0);
  if (!versions.length) {
    renderEmptyState("documentSignoffVersionsEmpty", {
      title: "No document versions available",
      description: "No existing agreement version records are available to this user."
    });
  }
}

function evidenceType(row) {
  if (row.has_signature || row.has_visitor_signature) return "Signature";
  if (row.accepted_without_signature) return "Tick acceptance";
  return "Evidence recorded";
}

function renderEvidence(rows) {
  const body = $("documentSignoffEvidenceBody");
  if (!body) return;
  body.replaceChildren();
  rows.slice(0, 10).forEach(record => {
    const row = document.createElement("tr");
    appendTextCell(row, record.visitor_name, record.company || "");
    appendTextCell(row, record.agreement_name, record.agreement_title || "");
    appendTextCell(row, record.agreement_version_number);
    appendTextCell(row, formatDateTime(record.signed_at), record.signed_by_name || "");
    appendTextCell(row, evidenceType(record), record.inductor_name ? "Inductor: " + record.inductor_name : "");
    appendDetailsCell(row, "View Details", trigger => openEvidenceDetails(record, trigger));
    body.appendChild(row);
  });
  setVisible("documentSignoffEvidenceEmpty", rows.length === 0);
  if (!rows.length) {
    renderEmptyState("documentSignoffEvidenceEmpty", {
      title: "No recent evidence available",
      description: "No agreement evidence was returned for the recent lookback window."
    });
  }
}

function renderOverview(results, manual) {
  const types = normaliseRows(results.types);
  const versions = normaliseRows(results.versions);
  const summaryRows = normaliseRows(results.summary);
  const recentEvidence = normaliseRows(results.recentEvidence);
  const summary = summaryRows[0] || {};

  documentSignoffOverviewState = {
    types,
    versions,
    summary,
    recentEvidence
  };

  const activeTypes = types.filter(type => type.is_active !== false);
  const requiredTypes = activeTypes.filter(type => type.default_required === true);
  const optionalTypes = activeTypes.filter(type => type.default_required !== true);
  const activeVersions = versions.filter(version => version.is_active === true);

  setText("documentSignoffTypeCount", String(types.length));
  setText(
    "documentSignoffActiveVersionCount",
    summary.active_agreement_versions != null
      ? String(summary.active_agreement_versions)
      : String(activeVersions.length)
  );
  setText(
    "documentSignoffRequiredCount",
    types.length ? String(requiredTypes.length) : "-"
  );
  setText("documentSignoffOptionalCount", types.length ? String(optionalTypes.length) : "-");
  setText(
    "documentSignoffRecentSignatureCount",
    String(recentEvidence.length)
  );
  setText(
    "documentSignoffMissingRequiredCount",
    summary.visitors_missing_required != null
      ? String(summary.visitors_missing_required)
      : "-"
  );

  renderTypes(types);
  renderVersions(versions);
  renderEvidence(recentEvidence);

  const errors = [
    errorMessage(results.types),
    errorMessage(results.versions),
    errorMessage(results.summary),
    errorMessage(results.recentEvidence)
  ].filter(Boolean);

  if (errors.length) {
    setStatus(
      "Document sign-off overview loaded with " + errors.length + " unavailable data source(s).",
      "error"
    );
    if (manual) {
      showToast(
        "Document sign-offs partially loaded",
        "Some existing agreement data was unavailable under current permissions.",
        "error"
      );
    }
  } else {
    setStatus("Document sign-off overview loaded.", "success");
    if (manual) {
      showToast("Document sign-offs refreshed", "Existing agreement and evidence data was loaded.", "success");
    }
  }
}

export async function loadDocumentSignoffOverview(options) {
  if (!canViewDocumentSignoffs()) return;
  const settings = options || {};
  const sequence = ++documentSignoffLoadSequence;
  setMetricPlaceholders("...");
  setStatus("Loading document sign-off overview...", "info");

  const recentFromDate = dateDaysAgo(30);
  const results = await Promise.allSettled([
    supabaseClient.rpc("list_agreement_types"),
    supabaseClient.rpc("list_agreement_versions"),
    supabaseClient.rpc("get_agreement_compliance_summary"),
    supabaseClient.rpc("search_visitor_agreements", {
      p_date_from: recentFromDate,
      p_date_to: todayDate(),
      p_visitor_name: null,
      p_company: null,
      p_agreement_version_id: null,
      p_agreement_type_id: null
    })
  ]);

  if (sequence !== documentSignoffLoadSequence) return;
  renderOverview({
    types: results[0],
    versions: results[1],
    summary: results[2],
    recentEvidence: results[3]
  }, settings.manual === true);
}

function openLegacyDocumentSignoffTarget(action) {
  if (!documentSignoffDependencies.openLegacyVms) return;
  documentSignoffDependencies.openLegacyVms(action);
}

function guardedLegacyOpen(action, allowed, message) {
  if (!allowed()) {
    showToast("You do not have permission", message, "error");
    return;
  }
  openLegacyDocumentSignoffTarget(action);
}

export function syncDocumentSignoffVisibility() {
  const canView = canViewDocumentSignoffs();
  setVisible("visitorsDocumentSignoffsSection", canView);
  setVisible("documentSignoffLegacyManagementButton", canOpenLegacyManagement());
  setVisible("documentSignoffLegacySignoffButton", canOpenLegacySignoff());
  setVisible("documentSignoffLegacyComplianceButton", canOpenLegacyCompliance());
  setVisible("documentSignoffLegacyEvidenceButton", canOpenLegacyEvidence());
}

export function configureDocumentSignoffs(dependencies) {
  documentSignoffDependencies = dependencies || {};
}

function initialiseDocumentSignoffDetailsPanel() {
  if (documentSignoffDetailsPanelController || !$("documentSignoffDetailsPanel")) return;
  documentSignoffDetailsPanelController = createSidePanelController({
    backdrop: "documentSignoffDetailsPanelBackdrop",
    panel: "documentSignoffDetailsPanel",
    title: "documentSignoffDetailsTitle",
    initialFocus: "documentSignoffDetailsClose",
    closeTriggers: ["documentSignoffDetailsClose"],
    reset: clearDetailPanel
  });
  clearDetailPanel();
}

export function initialiseDocumentSignoffs(dependencies) {
  if (dependencies) configureDocumentSignoffs(dependencies);
  if (documentSignoffInitialised) return;
  documentSignoffInitialised = true;
  initialiseDocumentSignoffDetailsPanel();

  if ($("documentSignoffRefreshButton")) {
    $("documentSignoffRefreshButton").addEventListener("click", () => {
      loadDocumentSignoffOverview({ manual: true });
    });
  }
  if ($("documentSignoffComplianceDetailsButton")) {
    $("documentSignoffComplianceDetailsButton").addEventListener("click", event => {
      openComplianceStatusDetails(event.currentTarget);
    });
  }
  if ($("documentSignoffLegacyManagementButton")) {
    $("documentSignoffLegacyManagementButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-management",
        canOpenLegacyManagement,
        "Agreement management requires settings or module configuration access."
      );
    });
  }
  if ($("documentSignoffLegacySignoffButton")) {
    $("documentSignoffLegacySignoffButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-signoff",
        canOpenLegacySignoff,
        "Visitor agreement sign-off requires visitor sign-in or history access."
      );
    });
  }
  if ($("documentSignoffLegacyComplianceButton")) {
    $("documentSignoffLegacyComplianceButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-compliance",
        canOpenLegacyCompliance,
        "Agreement compliance requires visitor history or reporting access."
      );
    });
  }
  if ($("documentSignoffLegacyEvidenceButton")) {
    $("documentSignoffLegacyEvidenceButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-evidence",
        canOpenLegacyEvidence,
        "Agreement evidence requires audit or visitor history access."
      );
    });
  }

  window.addEventListener("oh:capabilities-changed", syncDocumentSignoffVisibility);
  syncDocumentSignoffVisibility();
}
