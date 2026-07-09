import { supabaseClient } from "./api.js";
import { auditDiffSummary, buildFieldDiff, buildObjectDiff, writeAuditEvent } from "./audit.js";
import { hasAnyCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { createSidePanelController, renderEmptyState, requestPlatformConfirmation } from "./platformUi.js";
import { refreshSectionNavigator, registerModuleSections, selectModuleSection } from "./sectionNavigation.js";
import { showAdministrationWorkspace } from "./shell.js";
import { AppState } from "./state.js";
import { loadSystemSettings, saveSetting, settingValue } from "./settings.js";

const DOCUMENT_SIGNOFF_ADMIN_VIEW = [
  "module_configuration.manage",
  "settings.edit",
  "document_signoff.manage",
  "agreements.manage"
];

const DOCUMENT_SIGNOFF_ADMIN_MANAGE = [
  "module_configuration.manage",
  "settings.edit",
  "document_signoff.manage",
  "agreements.manage"
];

const SIGNOFF_SETTING_DEFINITIONS = [
  ["visitor_agreements_enabled", "documentSignoffAdminAgreementsEnabled", value => value === "true", "Enable visitor agreement sign-off"],
  ["signature_required", "documentSignoffAdminSignatureRequired", value => value === "true", "Require drawn visitor signature"],
  ["inductor_signoff_enabled", "documentSignoffAdminInductorEnabled", value => value === "true", "Require inductor or witness sign-off"],
  ["inductor_signoff_mode", "documentSignoffAdminInductorMode", value => value || "typed_name", "Inductor sign-off mode"],
  ["agreement_validity_mode", "documentSignoffAdminValidityMode", value => value || "version", "Agreement validity mode"],
  ["agreement_validity_days", "documentSignoffAdminValidityDays", value => Number(value || 365), "Agreement validity days"],
  ["agreement_acceptance_text", "documentSignoffAdminAcceptanceText", value => value.trim() || "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction.", "Visitor acceptance wording"]
];

let documentSignoffAdminInitialised = false;
let documentSignoffAdminDependencies = {};
let documentSignoffAdminTypes = [];
let documentSignoffAdminVersions = [];
let selectedDocumentTypeId = null;
let documentSignoffAdminLoadSequence = 0;
let documentTypePanelController = null;
let documentVersionPanelController = null;

function hasActiveStaffUser() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

function canViewDocumentSignoffAdmin() {
  return hasActiveStaffUser() && hasAnyCapability(DOCUMENT_SIGNOFF_ADMIN_VIEW);
}

function canManageDocumentSignoffAdmin() {
  return hasActiveStaffUser() && hasAnyCapability(DOCUMENT_SIGNOFF_ADMIN_MANAGE);
}

function setAdministrationSection(sectionName) {
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

function requireDocumentSignoffAdminAccess() {
  if (canViewDocumentSignoffAdmin()) return true;
  showToast(
    "You do not have permission",
    "Document Sign-off Administration requires module configuration or settings management access.",
    "error"
  );
  return false;
}

function requireDocumentSignoffAdminManageAccess() {
  if (canManageDocumentSignoffAdmin()) return true;
  showToast(
    "You do not have permission",
    "Editing document sign-off setup requires module_configuration.manage or settings.edit.",
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

function activeVersionForType(type) {
  if (!type) return null;
  return documentSignoffAdminVersions.find(version =>
    version.is_active === true &&
    (
      version.agreement_type_id === type.agreement_type_id ||
      version.agreement_name === type.agreement_name
    )
  ) || null;
}

function versionsForType(typeId) {
  if (!typeId) return [];
  return documentSignoffAdminVersions.filter(version => version.agreement_type_id === typeId);
}

function selectedType() {
  return documentSignoffAdminTypes.find(type => type.agreement_type_id === selectedDocumentTypeId) || null;
}

function selectDocumentSignoffAdminSection(sectionId, options) {
  return selectModuleSection("document-signoff-admin", sectionId, options);
}

function setStatus(message, type) {
  const box = $("documentSignoffAdminStatus");
  if (!box) return;
  box.textContent = message || "";
  box.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function setMetric(id, value) {
  if ($(id)) $(id).textContent = value == null ? "-" : String(value);
}

function normaliseRows(result) {
  if (!result || result.status === "rejected") return [];
  const value = result.value || result;
  if (value.error) return [];
  return Array.isArray(value.data) ? value.data : [];
}

function errorMessage(result) {
  if (!result) return "";
  if (result.status === "rejected") return result.reason && result.reason.message ? result.reason.message : "Request failed.";
  const value = result.value || result;
  return value.error ? value.error.message : "";
}

function renderMetrics() {
  const activeTypes = documentSignoffAdminTypes.filter(type => type.is_active !== false);
  const inactiveTypes = documentSignoffAdminTypes.filter(type => type.is_active === false);
  const activeVersions = documentSignoffAdminVersions.filter(version => version.is_active === true);
  const requiredTypes = activeTypes.filter(type => type.default_required === true);
  const optionalTypes = activeTypes.filter(type => type.default_required !== true);
  const noActiveVersion = activeTypes.filter(type => !activeVersionForType(type));

  setMetric("documentSignoffAdminTotalTypes", documentSignoffAdminTypes.length);
  setMetric("documentSignoffAdminActiveTypes", activeTypes.length);
  setMetric("documentSignoffAdminInactiveTypes", inactiveTypes.length);
  setMetric("documentSignoffAdminActiveVersions", activeVersions.length);
  setMetric("documentSignoffAdminRequiredTypes", requiredTypes.length);
  setMetric("documentSignoffAdminOptionalTypes", optionalTypes.length);
  setMetric("documentSignoffAdminNoActiveVersion", noActiveVersion.length);
}

function typeSearchText(type) {
  return [
    type.agreement_name,
    type.agreement_title,
    type.description,
    type.display_order,
    type.default_required ? "required" : "optional",
    type.is_active === false ? "inactive" : "active"
  ].join(" ").toLowerCase();
}

function filteredTypes() {
  const query = $("documentSignoffAdminSearch") ? $("documentSignoffAdminSearch").value.trim().toLowerCase() : "";
  const status = $("documentSignoffAdminStatusFilter") ? $("documentSignoffAdminStatusFilter").value : "all";
  const requirement = $("documentSignoffAdminRequirementFilter") ? $("documentSignoffAdminRequirementFilter").value : "all";

  return documentSignoffAdminTypes.filter(type => {
    if (query && !typeSearchText(type).includes(query)) return false;
    if (status === "active" && type.is_active === false) return false;
    if (status === "inactive" && type.is_active !== false) return false;
    if (requirement === "required" && type.default_required !== true) return false;
    if (requirement === "optional" && type.default_required === true) return false;
    return true;
  });
}

function createBadge(label, className) {
  const badge = document.createElement("span");
  badge.className = "visitors-planned-status " + (className || "");
  badge.textContent = label;
  return badge;
}

function createTypeCard(type) {
  const card = document.createElement("article");
  card.className = "document-signoff-admin-type-card";
  card.classList.toggle("selected", type.agreement_type_id === selectedDocumentTypeId);

  const heading = document.createElement("div");
  heading.className = "document-signoff-admin-type-heading";
  const title = document.createElement("div");
  const name = document.createElement("h4");
  name.textContent = textOrDash(type.agreement_name);
  const description = document.createElement("p");
  description.textContent = textOrDash(type.agreement_title || type.description);
  title.append(name, description);
  const badges = document.createElement("div");
  badges.className = "document-signoff-detail-badges";
  badges.appendChild(createBadge(type.is_active === false ? "Inactive" : "Active", type.is_active === false ? "status-inactive" : "status-in"));
  badges.appendChild(createBadge(type.default_required ? "Required" : "Optional", type.default_required ? "status-overdue" : ""));
  heading.append(title, badges);

  const version = activeVersionForType(type);
  const meta = document.createElement("dl");
  meta.className = "document-signoff-admin-meta";
  [
    ["Active version", version ? version.version_number : "No active version"],
    ["Version count", versionsForType(type.agreement_type_id).length],
    ["Validity", validityRuleText()],
    ["Display order", type.display_order]
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = textOrDash(value);
    row.append(dt, dd);
    meta.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "document-signoff-admin-card-actions";
  const select = document.createElement("button");
  select.type = "button";
  select.className = "secondary";
  select.textContent = "Review Versions";
  select.addEventListener("click", () => selectType(type.agreement_type_id, {
    switchToVersions: true,
    toast: true
  }));
  actions.appendChild(select);

  if (canManageDocumentSignoffAdmin()) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.addEventListener("click", event => openTypePanel(type, event.currentTarget));
    actions.appendChild(edit);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = type.is_active === false ? "secondary" : "danger";
    toggle.textContent = type.is_active === false ? "Activate" : "Deactivate";
    toggle.addEventListener("click", event => setTypeActive(type, type.is_active === false, event.currentTarget));
    actions.appendChild(toggle);
  }

  card.append(heading, meta, actions);
  return card;
}

function renderTypes() {
  const container = $("documentSignoffAdminTypeResults");
  if (!container) return;
  container.replaceChildren();
  const rows = filteredTypes();
  rows.forEach(type => container.appendChild(createTypeCard(type)));
  $("documentSignoffAdminTypesEmpty").classList.toggle("hidden", rows.length > 0);
  if (!rows.length) {
    renderEmptyState("documentSignoffAdminTypesEmpty", {
      title: "No document types found",
      description: documentSignoffAdminTypes.length
        ? "Adjust the filters to review more document types."
        : "Existing agreement type data could not be loaded or no records are configured."
    });
  }
}

function createVersionCard(version) {
  const card = document.createElement("article");
  card.className = "document-signoff-admin-version-card";
  const heading = document.createElement("div");
  heading.className = "document-signoff-admin-type-heading";
  const title = document.createElement("div");
  const name = document.createElement("h4");
  name.textContent = "Version " + textOrDash(version.version_number);
  const sub = document.createElement("p");
  sub.textContent = textOrDash(version.file_name || version.pdf_url || "No source URL recorded");
  title.append(name, sub);
  heading.appendChild(title);
  heading.appendChild(createBadge(version.is_active ? "Active" : "Inactive", version.is_active ? "status-in" : "status-inactive"));

  const meta = document.createElement("dl");
  meta.className = "document-signoff-admin-meta";
  [
    ["Effective or uploaded", formatDate(version.effective_date || version.uploaded_at || version.created_at)],
    ["Retired", formatDate(version.retired_at || version.retired_date)],
    ["Validity", validityRuleText()],
    ["Updated", formatDate(version.updated_at || version.modified_at)],
    ["Evidence count", version.evidence_count]
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = textOrDash(value);
    row.append(dt, dd);
    meta.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "document-signoff-admin-card-actions";
  if (version.pdf_url) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "secondary";
    open.textContent = "Open Source";
    open.addEventListener("click", () => window.open(version.pdf_url, "_blank", "noopener"));
    actions.appendChild(open);
  }
  if (canManageDocumentSignoffAdmin()) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Edit Version";
    edit.addEventListener("click", event => openVersionPanel(version, event.currentTarget));
    actions.appendChild(edit);
  }

  if (canManageDocumentSignoffAdmin() && !version.is_active) {
    const activate = document.createElement("button");
    activate.type = "button";
    activate.className = "secondary";
    activate.textContent = "Activate Version";
    activate.addEventListener("click", event => activateVersion(version, event.currentTarget));
    actions.appendChild(activate);
  }
  if (!actions.childNodes.length) {
    const readOnly = document.createElement("span");
    readOnly.className = "row-meta";
    readOnly.textContent = version.is_active ? "Active version" : "Read only";
    actions.appendChild(readOnly);
  }

  card.append(heading, meta, actions);
  return card;
}

function renderVersions() {
  const type = selectedType();
  const container = $("documentSignoffAdminVersionResults");
  if (!container) return;
  container.replaceChildren();
  if ($("documentSignoffAdminSelectedTypeMeta")) {
    $("documentSignoffAdminSelectedTypeMeta").textContent = type
      ? textOrDash(type.agreement_name) + " - " + textOrDash(type.agreement_title || type.description) + " - " + versionsForType(type.agreement_type_id).length + " version(s)"
      : "Select a document type to review its versions.";
  }
  if ($("documentSignoffAdminNewVersionButton")) {
    $("documentSignoffAdminNewVersionButton").disabled = !canManageDocumentSignoffAdmin() || !type;
  }
  const rows = type ? versionsForType(type.agreement_type_id) : [];
  rows.forEach(version => container.appendChild(createVersionCard(version)));
  $("documentSignoffAdminVersionsEmpty").classList.toggle("hidden", rows.length > 0);
  if (!rows.length) {
    renderEmptyState("documentSignoffAdminVersionsEmpty", {
      title: type
        ? "No versions found for this document type."
        : "Select a document type to review its versions.",
      description: type
        ? "Create a version if this document type is now managed in Operations Hub."
        : "Use Review Versions from Document Types to load a specific document type.",
      action: type
        ? {
          label: "New Version",
          available: canManageDocumentSignoffAdmin(),
          onClick: event => openVersionPanel(null, event.currentTarget)
        }
        : {
          label: "Back to Document Types",
          onClick: () => selectDocumentSignoffAdminSection("document-types")
        }
    });
  }
}

function populateVersionTypeSelect() {
  const select = $("documentSignoffAdminVersionType");
  if (!select) return;
  const current = select.value || selectedDocumentTypeId || "";
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select document type";
  select.appendChild(empty);
  documentSignoffAdminTypes.forEach(type => {
    const option = document.createElement("option");
    option.value = type.agreement_type_id || "";
    option.textContent = textOrDash(type.agreement_name) + (type.is_active === false ? " (inactive)" : "");
    select.appendChild(option);
  });
  if (current) select.value = current;
}

function selectType(typeId, options) {
  const settings = options || {};
  selectedDocumentTypeId = typeId || null;
  if ($("documentSignoffAdminVersionType") && selectedDocumentTypeId) {
    $("documentSignoffAdminVersionType").value = selectedDocumentTypeId;
  }
  renderTypes();
  renderVersions();
  if (settings.switchToVersions) {
    selectDocumentSignoffAdminSection("document-versions");
  }
  if (settings.toast) {
    const type = selectedType();
    showToast(
      "Document versions loaded",
      type
        ? "Reviewing versions for " + textOrDash(type.agreement_name) + "."
        : "Select a document type to review its versions.",
      type ? "success" : "error"
    );
  }
}

function validityRuleText() {
  const mode = String(settingValue("agreement_validity_mode", "version") || "version");
  const days = Number(settingValue("agreement_validity_days", 365) || 365);
  if (mode === "days") return "Valid for " + days + " day(s) after signing";
  if (mode === "either") return "Current version or " + days + " day(s)";
  if (mode === "never") return "No automatic expiry";
  return "Current version";
}

function resetTypeForm() {
  const form = $("documentSignoffAdminTypeForm");
  if (form) form.reset();
  if ($("documentSignoffAdminTypeId")) $("documentSignoffAdminTypeId").value = "";
  if ($("documentSignoffAdminTypeActive")) $("documentSignoffAdminTypeActive").value = "true";
  if ($("documentSignoffAdminTypeRequired")) $("documentSignoffAdminTypeRequired").value = "true";
  if ($("documentSignoffAdminTypeOrder")) $("documentSignoffAdminTypeOrder").value = "100";
  if ($("documentSignoffAdminTypePanelTitle")) $("documentSignoffAdminTypePanelTitle").textContent = "Create Document Type";
  if ($("documentSignoffAdminSaveTypeButton")) $("documentSignoffAdminSaveTypeButton").textContent = "Save Type";
}

function fillTypeForm(type) {
  if (!type) return;
  $("documentSignoffAdminTypeId").value = type.agreement_type_id || "";
  $("documentSignoffAdminTypeName").value = type.agreement_name || "";
  $("documentSignoffAdminTypeTitle").value = type.agreement_title || "";
  $("documentSignoffAdminTypeDescription").value = type.description || "";
  $("documentSignoffAdminTypeActive").value = type.is_active === false ? "false" : "true";
  $("documentSignoffAdminTypeRequired").value = type.default_required ? "true" : "false";
  $("documentSignoffAdminTypeOrder").value = String(type.display_order || 100);
  if ($("documentSignoffAdminTypePanelTitle")) $("documentSignoffAdminTypePanelTitle").textContent = "Edit Document Type";
  if ($("documentSignoffAdminSaveTypeButton")) $("documentSignoffAdminSaveTypeButton").textContent = "Save Changes";
}

function openTypePanel(type, trigger) {
  if (!requireDocumentSignoffAdminManageAccess()) return;
  if (type) {
    selectType(type.agreement_type_id);
    fillTypeForm(type);
  } else {
    resetTypeForm();
  }
  if (documentTypePanelController) {
    documentTypePanelController.open({
      trigger,
      title: type ? "Edit Document Type" : "Create Document Type",
      initialFocus: "documentSignoffAdminTypeName"
    });
  }
}

function resetVersionForm() {
  const form = $("documentSignoffAdminVersionForm");
  if (form) form.reset();
  if ($("documentSignoffAdminVersionId")) $("documentSignoffAdminVersionId").value = "";
  if ($("documentSignoffAdminVersionType")) {
    $("documentSignoffAdminVersionType").value = selectedDocumentTypeId || "";
    $("documentSignoffAdminVersionType").disabled = false;
  }
  if ($("documentSignoffAdminActivateNow")) $("documentSignoffAdminActivateNow").value = "true";
  if ($("documentSignoffAdminVersionPanelTitle")) $("documentSignoffAdminVersionPanelTitle").textContent = "Create Document Version";
  if ($("documentSignoffAdminCreateVersionButton")) $("documentSignoffAdminCreateVersionButton").textContent = "Create Version";
}

function fillVersionForm(version) {
  if (!version) return;
  selectedDocumentTypeId = version.agreement_type_id || selectedDocumentTypeId;
  $("documentSignoffAdminVersionId").value = version.agreement_version_id || "";
  $("documentSignoffAdminVersionType").value = version.agreement_type_id || "";
  $("documentSignoffAdminVersionType").disabled = true;
  $("documentSignoffAdminVersionNumber").value = version.version_number || "";
  $("documentSignoffAdminPdfUrl").value = version.pdf_url || "";
  $("documentSignoffAdminFileName").value = version.file_name || "";
  $("documentSignoffAdminActivateNow").value = version.is_active ? "true" : "false";
  $("documentSignoffAdminVersionNotes").value = version.notes || "";
  if ($("documentSignoffAdminVersionPanelTitle")) $("documentSignoffAdminVersionPanelTitle").textContent = "Edit Document Version";
  if ($("documentSignoffAdminCreateVersionButton")) $("documentSignoffAdminCreateVersionButton").textContent = "Save Version";
}

function openVersionPanel(version, trigger) {
  if (!requireDocumentSignoffAdminManageAccess()) return;
  if (version) {
    selectType(version.agreement_type_id);
    fillVersionForm(version);
  } else {
    resetVersionForm();
  }
  if (documentVersionPanelController) {
    documentVersionPanelController.open({
      trigger,
      title: version ? "Edit Document Version" : "Create Document Version",
      initialFocus: version ? "documentSignoffAdminVersionNumber" : "documentSignoffAdminVersionType"
    });
  }
}

function readTypePayload() {
  const name = $("documentSignoffAdminTypeName").value.trim();
  if (!name) throw new Error("Document type name is required.");
  return {
    p_agreement_type_id: $("documentSignoffAdminTypeId").value || null,
    p_agreement_name: name,
    p_agreement_title: $("documentSignoffAdminTypeTitle").value.trim(),
    p_description: $("documentSignoffAdminTypeDescription").value.trim() || null,
    p_is_active: $("documentSignoffAdminTypeActive").value === "true",
    p_default_required: $("documentSignoffAdminTypeRequired").value === "true",
    p_display_order: Number($("documentSignoffAdminTypeOrder").value || 100)
  };
}

function auditTypeRecordFromPayload(payload) {
  return {
    agreement_name: payload.p_agreement_name,
    agreement_title: payload.p_agreement_title,
    description: payload.p_description,
    is_active: payload.p_is_active,
    default_required: payload.p_default_required,
    display_order: payload.p_display_order
  };
}

async function saveType(event) {
  if (event) event.preventDefault();
  if (!requireDocumentSignoffAdminManageAccess()) return;

  let payload;
  try {
    payload = readTypePayload();
  } catch (err) {
    showToast("Document type not saved", err.message, "error");
    return;
  }

  const previous = payload.p_agreement_type_id
    ? documentSignoffAdminTypes.find(type => type.agreement_type_id === payload.p_agreement_type_id) || null
    : null;
  const button = $("documentSignoffAdminSaveTypeButton");
  if (button) button.disabled = true;
  setStatus("Saving document type...", "info");

  try {
    const result = await supabaseClient.rpc("superuser_save_agreement_type", payload);
    if (result.error) throw result.error;
    const response = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!response || response.success !== true) {
      throw new Error(response && response.message ? response.message : "Document type save failed.");
    }

    const auditFields = ["agreement_name", "agreement_title", "description", "is_active", "default_required", "display_order"];
    const after = auditTypeRecordFromPayload(payload);
    const changes = buildFieldDiff(previous, after, auditFields);
    void writeAuditEvent(
      previous ? "document_type_updated" : "document_type_created",
      "agreement_types",
      payload.p_agreement_type_id || null,
      {
        action: previous ? "update" : "create",
        document_type_name: payload.p_agreement_name,
        changes,
        summary: previous ? auditDiffSummary(changes) : "Document type created."
      }
    );

    showToast("Document type saved", response.message || "Document type setup was saved.", "success");
    resetTypeForm();
    if (documentTypePanelController) documentTypePanelController.close({ reset: true });
    await loadDocumentSignoffAdmin({ manual: false, keepSelection: true });
  } catch (err) {
    setStatus("Document type could not be saved.", "error");
    showToast("Document type not saved", err.message || "Could not save document type setup.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function setTypeActive(type, active, trigger) {
  if (!requireDocumentSignoffAdminManageAccess() || !type) return;
  const confirmed = await requestPlatformConfirmation({
    title: active ? "Activate document type?" : "Deactivate document type?",
    message: (active ? "Activate " : "Deactivate ") + textOrDash(type.agreement_name) + "? Existing evidence and old versions will not be changed.",
    confirmText: active ? "Activate" : "Deactivate",
    danger: !active,
    initialFocus: "cancel",
    trigger
  });
  if (!confirmed) return;

  setStatus("Updating document type status...", "info");
  try {
    const result = await supabaseClient.rpc("superuser_set_agreement_type_active", {
      p_agreement_type_id: type.agreement_type_id,
      p_is_active: active
    });
    if (result.error) throw result.error;
    const response = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!response || response.success !== true) {
      throw new Error(response && response.message ? response.message : "Document type status update failed.");
    }
    void writeAuditEvent(active ? "document_type_activated" : "document_type_deactivated", "agreement_types", type.agreement_type_id, {
      action: active ? "activate" : "deactivate",
      document_type_name: type.agreement_name,
      changes: { is_active: { old: type.is_active !== false, new: active } },
      summary: active ? "Document type activated." : "Document type deactivated."
    });
    showToast(active ? "Document type activated" : "Document type deactivated", response.message || "Document type status was updated.", "success");
    await loadDocumentSignoffAdmin({ manual: false, keepSelection: true });
  } catch (err) {
    setStatus("Document type status could not be changed.", "error");
    showToast("Status not changed", err.message || "Could not update document type status.", "error");
  }
}

async function createVersion(event) {
  if (event) event.preventDefault();
  if (!requireDocumentSignoffAdminManageAccess()) return;

  const versionId = $("documentSignoffAdminVersionId") ? $("documentSignoffAdminVersionId").value : "";
  const typeId = $("documentSignoffAdminVersionType").value;
  const versionNumber = $("documentSignoffAdminVersionNumber").value.trim();
  const pdfUrl = $("documentSignoffAdminPdfUrl").value.trim();
  if (!typeId) {
    showToast("Version not created", "Document type is required.", "error");
    return;
  }
  if (!versionNumber || !pdfUrl) {
    showToast("Version not created", "Version label and document URL are required.", "error");
    return;
  }

  const button = $("documentSignoffAdminCreateVersionButton");
  if (button) button.disabled = true;
  setStatus(versionId ? "Saving document version..." : "Creating document version...", "info");
  try {
    const payload = {
      p_version_number: versionNumber,
      p_pdf_url: pdfUrl,
      p_file_name: $("documentSignoffAdminFileName").value.trim() || null,
      p_notes: $("documentSignoffAdminVersionNotes").value.trim() || null,
      p_activate_now: $("documentSignoffAdminActivateNow").value === "true"
    };
    const result = versionId
      ? await supabaseClient.rpc("update_agreement_version", {
        p_agreement_version_id: versionId,
        ...payload
      })
      : await supabaseClient.rpc("create_agreement_version", {
        ...payload,
        p_agreement_type_id: typeId
      });
    if (result.error) throw result.error;
    const response = Array.isArray(result.data) ? result.data[0] : result.data;
    if (response && response.duplicate_found) {
      throw new Error("This document type already has that version label. Use Legacy VMS if an existing version needs correction.");
    }
    if (!response || response.success !== true) {
      throw new Error(response && response.message ? response.message : "Document version could not be saved.");
    }

    void writeAuditEvent(versionId ? "document_version_updated" : "document_version_created", "agreement_versions", versionId || response.agreement_version_id || null, {
      action: versionId ? "update" : "create",
      agreement_type_id: typeId,
      version_number: versionNumber,
      activate_now: $("documentSignoffAdminActivateNow").value === "true",
      summary: versionId ? "Document version updated." : "Document version created."
    });
    selectedDocumentTypeId = typeId;
    showToast(versionId ? "Document version saved" : "Document version created", response.message || "Document version was saved.", "success");
    resetVersionForm();
    if (documentVersionPanelController) documentVersionPanelController.close({ reset: true });
    await loadDocumentSignoffAdmin({ manual: false, keepSelection: true });
  } catch (err) {
    setStatus("Document version could not be saved.", "error");
    showToast("Version not saved", err.message || "Could not save document version.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function activateVersion(version, trigger) {
  if (!requireDocumentSignoffAdminManageAccess() || !version) return;
  const confirmed = await requestPlatformConfirmation({
    title: "Activate document version?",
    message: "Activate version " + textOrDash(version.version_number) + " for " + textOrDash(version.agreement_name) + "? Old signed evidence will not be rewritten.",
    confirmText: "Activate",
    initialFocus: "cancel",
    trigger
  });
  if (!confirmed) return;

  setStatus("Activating document version...", "info");
  try {
    const result = await supabaseClient.rpc("activate_agreement_version", {
      p_agreement_version_id: version.agreement_version_id
    });
    if (result.error) throw result.error;
    void writeAuditEvent("document_version_activated", "agreement_versions", version.agreement_version_id, {
      action: "activate",
      agreement_type_id: version.agreement_type_id,
      version_number: version.version_number,
      summary: "Document version activated."
    });
    showToast("Document version activated", "The selected version is now active.", "success");
    await loadDocumentSignoffAdmin({ manual: false, keepSelection: true });
  } catch (err) {
    setStatus("Document version could not be activated.", "error");
    showToast("Version not activated", err.message || "Could not activate document version.", "error");
  }
}

function fillSettingsForm() {
  SIGNOFF_SETTING_DEFINITIONS.forEach(([key, id]) => {
    const control = $(id);
    if (!control) return;
    control.value = String(settingValue(key, key === "agreement_validity_days" ? 365 : defaultSettingValue(key)));
  });
}

function defaultSettingValue(key) {
  const defaults = {
    visitor_agreements_enabled: true,
    signature_required: true,
    inductor_signoff_enabled: false,
    inductor_signoff_mode: "typed_name",
    agreement_validity_mode: "version",
    agreement_validity_days: 365,
    agreement_acceptance_text: "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction."
  };
  return defaults[key];
}

async function saveBehaviourSettings(event) {
  if (event) event.preventDefault();
  if (!requireDocumentSignoffAdminManageAccess()) return;

  const before = {};
  const after = {};
  SIGNOFF_SETTING_DEFINITIONS.forEach(([key, id, reader]) => {
    before[key] = AppState.systemSettingsRaw ? AppState.systemSettingsRaw[key] : null;
    after[key] = reader($(id).value);
  });

  const button = $("documentSignoffAdminSaveSettingsButton");
  if (button) button.disabled = true;
  setStatus("Saving sign-off behaviour settings...", "info");
  try {
    for (const [key, , , description] of SIGNOFF_SETTING_DEFINITIONS) {
      await saveSetting(key, after[key], description);
    }
    const changes = buildObjectDiff(before, after, Object.keys(after));
    await loadSystemSettings();
    fillSettingsForm();
    void writeAuditEvent("signoff_setting_changed", "system_settings", null, {
      action: "document_signoff_settings_saved",
      changes,
      summary: auditDiffSummary(changes)
    });
    renderTypes();
    renderVersions();
    setStatus("Sign-off behaviour settings saved.", "success");
    showToast("Behaviour settings saved", "Document sign-off behaviour settings were updated.", "success");
  } catch (err) {
    setStatus("Sign-off behaviour settings could not be saved.", "error");
    showToast("Settings not saved", err.message || "Could not save sign-off behaviour settings.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function syncEditability() {
  const editable = canManageDocumentSignoffAdmin();
  const readOnlyNotice = $("documentSignoffAdminReadOnlyNotice");
  if (readOnlyNotice) readOnlyNotice.classList.toggle("hidden", editable);
  [
    "documentSignoffAdminNewTypeButton",
    "documentSignoffAdminSaveSettingsButton"
  ].forEach(id => {
    const button = $(id);
    if (button) button.disabled = !editable;
  });
  [
    "documentSignoffAdminNewTypeButton",
    "documentSignoffAdminNewVersionButton"
  ].forEach(id => {
    const button = $(id);
    if (button) button.classList.toggle("hidden", !editable);
  });
}

function registerDocumentSignoffAdminSections() {
  registerModuleSections("document-signoff-admin", [
    {
      id: "overview",
      title: "Overview",
      icon: "O",
      target: "documentSignoffAdminOverviewSection",
      order: 10,
      default: true,
      visible: canViewDocumentSignoffAdmin
    },
    {
      id: "document-types",
      title: "Types",
      fullTitle: "Document Types",
      icon: "DT",
      target: "documentSignoffAdminTypesSection",
      order: 20,
      visible: canViewDocumentSignoffAdmin
    },
    {
      id: "document-versions",
      title: "Versions",
      fullTitle: "Document Versions",
      icon: "DV",
      target: "documentSignoffAdminVersionsSection",
      order: 30,
      visible: canViewDocumentSignoffAdmin
    },
    {
      id: "settings",
      title: "Settings",
      icon: "S",
      target: "documentSignoffAdminSettingsSection",
      order: 40,
      visible: canViewDocumentSignoffAdmin
    },
    {
      id: "legacy-tools",
      title: "Legacy Tools",
      icon: "L",
      target: "documentSignoffAdminLegacySection",
      order: 50,
      visible: canViewDocumentSignoffAdmin
    }
  ], {
    root: "documentSignoffAdminSection",
    content: "documentSignoffAdminWorkspaceContent",
    defaultSection: "overview",
    scrollRoot: "operationsHubWorkspace",
    label: "Document Sign-off Administration section navigation",
    title: "Sections",
    toggleLabel: "Document Sign-off section",
    emptyMessage: "No Document Sign-off Administration sections are available under your current access."
  });
}

function renderAll() {
  renderMetrics();
  populateVersionTypeSelect();
  if (selectedDocumentTypeId && !selectedType()) selectedDocumentTypeId = null;
  fillSettingsForm();
  syncEditability();
  renderTypes();
  renderVersions();
  refreshSectionNavigator("document-signoff-admin");
}

function initialisePanelControllers() {
  if (!documentTypePanelController && $("documentSignoffAdminTypePanel")) {
    documentTypePanelController = createSidePanelController({
      backdrop: "documentSignoffAdminTypePanelBackdrop",
      panel: "documentSignoffAdminTypePanel",
      title: "documentSignoffAdminTypePanelTitle",
      initialFocus: "documentSignoffAdminTypeName",
      closeTriggers: [
        "documentSignoffAdminTypePanelClose",
        "documentSignoffAdminTypeCancelButton"
      ],
      reset: resetTypeForm
    });
  }
  if (!documentVersionPanelController && $("documentSignoffAdminVersionPanel")) {
    documentVersionPanelController = createSidePanelController({
      backdrop: "documentSignoffAdminVersionPanelBackdrop",
      panel: "documentSignoffAdminVersionPanel",
      title: "documentSignoffAdminVersionPanelTitle",
      initialFocus: "documentSignoffAdminVersionType",
      closeTriggers: [
        "documentSignoffAdminVersionPanelClose",
        "documentSignoffAdminVersionCancelButton"
      ],
      reset: resetVersionForm
    });
  }
}

export async function loadDocumentSignoffAdmin(options) {
  if (!canViewDocumentSignoffAdmin()) return;
  const settings = options || {};
  const sequence = ++documentSignoffAdminLoadSequence;
  setStatus("Loading document sign-off setup...", "info");
  [
    "documentSignoffAdminTotalTypes",
    "documentSignoffAdminActiveTypes",
    "documentSignoffAdminInactiveTypes",
    "documentSignoffAdminActiveVersions",
    "documentSignoffAdminRequiredTypes",
    "documentSignoffAdminOptionalTypes",
    "documentSignoffAdminNoActiveVersion"
  ].forEach(id => setMetric(id, "..."));

  if (!settings.keepSelection) selectedDocumentTypeId = null;
  const results = await Promise.allSettled([
    supabaseClient.rpc("list_agreement_types"),
    supabaseClient.rpc("list_agreement_versions"),
    loadSystemSettings()
  ]);
  if (sequence !== documentSignoffAdminLoadSequence) return;

  documentSignoffAdminTypes = normaliseRows(results[0]);
  documentSignoffAdminVersions = normaliseRows(results[1]);
  renderAll();

  const errors = [errorMessage(results[0]), errorMessage(results[1]), errorMessage(results[2])].filter(Boolean);
  if (errors.length) {
    setStatus("Document sign-off setup loaded with " + errors.length + " unavailable data source(s).", "error");
    if (settings.manual) {
      showToast("Document sign-offs partially loaded", "Some setup data was unavailable under current permissions.", "error");
    }
  } else {
    setStatus("Document sign-off setup loaded.", "success");
    if (settings.manual) {
      showToast("Document sign-offs refreshed", "Existing document setup was loaded.", "success");
    }
  }
}

function openLegacyDocumentSignoffTarget(action) {
  if (!documentSignoffAdminDependencies.openLegacyVms) return;
  documentSignoffAdminDependencies.openLegacyVms(action);
}

function bindLegacyButton(id, action) {
  if (!$(id)) return;
  $(id).addEventListener("click", () => {
    if (!requireDocumentSignoffAdminAccess()) return;
    openLegacyDocumentSignoffTarget(action);
  });
}

export function syncDocumentSignoffAdminVisibility() {
  const visible = canViewDocumentSignoffAdmin();
  const nav = $("administrationDocumentSignoffsNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  syncEditability();
  refreshSectionNavigator("document-signoff-admin");
  if (!visible && $("documentSignoffAdminSection") && !$("documentSignoffAdminSection").classList.contains("hidden")) {
    if (hasAnyCapability(["settings.view", "settings.edit"])) setAdministrationSection("reference");
    else if (hasAnyCapability(["module_configuration.view", "module_configuration.manage", "visitor.housekeeping.run"])) setAdministrationSection("modules");
    else if (hasAnyCapability(["devices.view", "devices.manage"])) setAdministrationSection("terminals");
    else if (hasAnyCapability(["access_control.view", "access_control.manage"])) setAdministrationSection("access");
  }
}

export async function openDocumentSignoffAdministration() {
  syncDocumentSignoffAdminVisibility();
  if (!requireDocumentSignoffAdminAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("documentSignoffs");
  selectDocumentSignoffAdminSection("overview", { focus: false });
  await loadDocumentSignoffAdmin({ manual: false });
}

export function configureDocumentSignoffAdmin(dependencies) {
  documentSignoffAdminDependencies = dependencies || {};
}

export function initialiseDocumentSignoffAdministration(dependencies) {
  if (dependencies) configureDocumentSignoffAdmin(dependencies);
  if (documentSignoffAdminInitialised) return;
  documentSignoffAdminInitialised = true;
  registerDocumentSignoffAdminSections();

  if ($("administrationDocumentSignoffsNav")) {
    $("administrationDocumentSignoffsNav").addEventListener("click", openDocumentSignoffAdministration);
  }
  if ($("documentSignoffAdminRefreshButton")) {
    $("documentSignoffAdminRefreshButton").addEventListener("click", () => loadDocumentSignoffAdmin({ manual: true, keepSelection: true }));
  }
  if ($("documentSignoffAdminSearch")) $("documentSignoffAdminSearch").addEventListener("input", renderTypes);
  if ($("documentSignoffAdminStatusFilter")) $("documentSignoffAdminStatusFilter").addEventListener("change", renderTypes);
  if ($("documentSignoffAdminRequirementFilter")) $("documentSignoffAdminRequirementFilter").addEventListener("change", renderTypes);
  initialisePanelControllers();
  if ($("documentSignoffAdminNewTypeButton")) {
    $("documentSignoffAdminNewTypeButton").addEventListener("click", event => openTypePanel(null, event.currentTarget));
  }
  if ($("documentSignoffAdminNewVersionButton")) {
    $("documentSignoffAdminNewVersionButton").addEventListener("click", event => openVersionPanel(null, event.currentTarget));
  }
  if ($("documentSignoffAdminBackToTypesButton")) {
    $("documentSignoffAdminBackToTypesButton").addEventListener("click", () => {
      selectDocumentSignoffAdminSection("document-types");
      window.setTimeout(() => {
        const target = $("documentSignoffAdminSearch") || $("documentSignoffAdminTypesSection");
        if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
      }, 0);
    });
  }
  if ($("documentSignoffAdminClearTypeButton")) {
    $("documentSignoffAdminClearTypeButton").addEventListener("click", () => {
      if ($("documentSignoffAdminSearch")) $("documentSignoffAdminSearch").value = "";
      if ($("documentSignoffAdminStatusFilter")) $("documentSignoffAdminStatusFilter").value = "all";
      if ($("documentSignoffAdminRequirementFilter")) $("documentSignoffAdminRequirementFilter").value = "all";
      renderTypes();
    });
  }
  if ($("documentSignoffAdminTypeForm")) $("documentSignoffAdminTypeForm").addEventListener("submit", saveType);
  if ($("documentSignoffAdminVersionForm")) $("documentSignoffAdminVersionForm").addEventListener("submit", createVersion);
  if ($("documentSignoffAdminVersionType")) $("documentSignoffAdminVersionType").addEventListener("change", event => selectType(event.target.value));
  if ($("documentSignoffAdminSettingsForm")) $("documentSignoffAdminSettingsForm").addEventListener("submit", saveBehaviourSettings);

  bindLegacyButton("documentSignoffAdminLegacyManagementButton", "document-signoffs-management");
  bindLegacyButton("documentSignoffAdminLegacyVersionsButton", "document-signoffs-management");
  bindLegacyButton("documentSignoffAdminLegacySignoffConfigButton", "document-signoffs-management");
  bindLegacyButton("documentSignoffAdminLegacyComplianceButton", "document-signoffs-compliance");

  window.addEventListener("oh:capabilities-changed", syncDocumentSignoffAdminVisibility);
  resetTypeForm();
  resetVersionForm();
  syncDocumentSignoffAdminVisibility();
}
