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
let documentSignoffNativeDialogOpen = false;
let documentSignoffNativeReturnFocus = null;
let documentSignoffNativePreviousBodyOverflow = "";
let documentSignoffOverviewState = {
  types: [],
  versions: [],
  summary: {},
  recentEvidence: []
};
let nativeSignoffCandidates = [];
let nativeSignoffCurrentVisit = null;
let nativeSignoffCurrentRequirement = null;
let nativeSignoffQueue = [];
let nativeSignoffQueueTotal = 0;
let nativeSignoffAdditionalOnly = false;
let nativeDocumentReviewReachedEnd = true;
const nativeVisitorSignatureState = { isDrawing: false, hasInk: false, lastX: 0, lastY: 0, pixelRatio: 1 };
const nativeInductorSignatureState = { isDrawing: false, hasInk: false, lastX: 0, lastY: 0, pixelRatio: 1 };
const NATIVE_SIGNOFF_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

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

function canUseNativeVisitorSignoff() {
  return canViewDocumentSignoffs() && hasAnyCapability([
    "visitor.sign_in",
    "visitor.history.view",
    "agreements.view",
    "module_configuration.manage"
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

function focusNativeElement(element) {
  if (!element || typeof element.focus !== "function") return false;
  try {
    element.focus({ preventScroll: true });
  } catch (error) {
    element.focus();
  }
  return true;
}

function visibleNativeFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(NATIVE_SIGNOFF_FOCUSABLE_SELECTOR)).filter(element => {
    if (element.disabled || element.getAttribute("aria-hidden") === "true") return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  });
}

function trapNativeSignoffFocus(event) {
  if (event.key !== "Tab") return;
  const panel = $("documentSignoffNativePanel");
  const focusable = visibleNativeFocusableElements(panel);
  if (!focusable.length) {
    event.preventDefault();
    focusNativeElement(panel);
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focusNativeElement(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focusNativeElement(first);
  }
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

function setNativeStatus(message, type) {
  const box = $("documentSignoffNativeStatus");
  if (!box) return;
  box.textContent = message || "";
  box.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function setNativePanelStatus(message, type) {
  const box = $("documentSignoffNativePanelStatus");
  if (!box) return;
  box.textContent = message || "";
  box.className = "local-action-status" + (message ? " " + (type || "info") : "");
}

function formatVisitMeta(visit) {
  return [
    ["Visitor", visit && visit.visitor_name],
    ["Company", visit && visit.company],
    ["Signed in", visit && visit.sign_in_time ? formatDateTime(visit.sign_in_time) : ""]
  ].filter(item => hasValue(item[1]));
}

function renderMetaList(targetId, items) {
  const target = $(targetId);
  if (!target) return;
  target.replaceChildren();
  (items || []).forEach(([label, value]) => {
    const item = document.createElement("div");
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = label;
    span.textContent = textOrDash(value);
    item.append(strong, span);
    target.appendChild(item);
  });
}

function clearNativeValidationHighlights() {
  [
    "documentSignoffNativeAgreementList",
    "documentSignoffNativeAcceptanceField",
    "documentSignoffNativeSignatureBox",
    "documentSignoffNativeInductorName",
    "documentSignoffNativeInductorSignatureBox",
    "documentSignoffNativeDocumentReview",
    "documentSignoffNativePdfFrame"
  ].forEach(id => {
    const element = $(id);
    if (element) element.classList.remove("document-signoff-validation-error");
  });
}

function showNativeValidation(message, targetId) {
  const text = message || "Please complete the required sign-off information.";
  setNativePanelStatus(text, "error");
  showToast("Sign-off needs attention", text, "error");
  clearNativeValidationHighlights();
  const target = targetId ? $(targetId) : null;
  if (target) {
    target.classList.add("document-signoff-validation-error");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      const focusTarget = target.matches && target.matches(NATIVE_SIGNOFF_FOCUSABLE_SELECTOR)
        ? target
        : target.querySelector && target.querySelector(NATIVE_SIGNOFF_FOCUSABLE_SELECTOR);
      if (!focusTarget && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      focusNativeElement(focusTarget || target);
    }, 80);
  }
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

function clearNativeSignoffPanel() {
  nativeSignoffCurrentVisit = null;
  nativeSignoffCurrentRequirement = null;
  nativeSignoffQueue = [];
  nativeSignoffQueueTotal = 0;
  nativeSignoffAdditionalOnly = false;
  nativeDocumentReviewReachedEnd = true;
  setText("documentSignoffNativePanelEyebrow", "Visitor Document Sign-off");
  setText("documentSignoffNativePanelTitle", "Visitor Sign-off");
  setNativePanelStatus("", "");
  setText("documentSignoffNativeReviewStatus", "Document review loaded.");
  setText("documentSignoffNativeSelectionSummary", "");
  renderMetaList("documentSignoffNativeVisitorMeta", []);
  renderMetaList("documentSignoffNativeAgreementMeta", []);
  const list = $("documentSignoffNativeAgreementList");
  if (list) list.textContent = "Loading agreement status...";
  if ($("documentSignoffNativePdfFrame")) $("documentSignoffNativePdfFrame").src = "about:blank";
  if ($("documentSignoffNativeAcceptedCheck")) $("documentSignoffNativeAcceptedCheck").checked = false;
  setVisible("documentSignoffNativeSelectionStep", true);
  setVisible("documentSignoffNativeSigningStep", false);
  setVisible("documentSignoffNativeStartButton", true);
  setVisible("documentSignoffNativeSaveButton", false);
  setVisible("documentSignoffNativeReviewCompleteButton", false);
  clearNativeValidationHighlights();
  clearNativeVisitorSignature();
  clearNativeInductorSignature();
}

function setFocusedSignoffChrome(active) {
  const workspace = $("visitorsWorkspace");
  if (workspace) workspace.classList.toggle("document-signoff-focused", !!active);
  document.body.classList.toggle("document-signoff-focused-open", !!active);
  document.body.classList.toggle("oh-transient-ui-open", !!active);
  if (active) {
    documentSignoffNativePreviousBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = documentSignoffNativePreviousBodyOverflow || "";
  }
}

function handleNativeSignoffKeydown(event) {
  if (!documentSignoffNativeDialogOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeNativeSignoffWorkflow({ reason: "escape" });
    return;
  }
  trapNativeSignoffFocus(event);
}

function openNativeSignoffWorkflow(options) {
  const settings = options || {};
  const backdrop = $("documentSignoffNativePanelBackdrop");
  const panel = $("documentSignoffNativePanel");
  if (!backdrop || !panel) return;
  if (documentSignoffNativeDialogOpen) closeNativeSignoffWorkflow({ reset: false, restoreFocus: false });
  documentSignoffNativeReturnFocus = settings.trigger || document.activeElement;
  if (settings.title != null) setText("documentSignoffNativePanelTitle", settings.title);
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  panel.setAttribute("aria-hidden", "false");
  documentSignoffNativeDialogOpen = true;
  setFocusedSignoffChrome(true);
  document.addEventListener("keydown", handleNativeSignoffKeydown, true);
  setTimeout(() => focusNativeElement($("documentSignoffNativePanelClose") || panel), 0);
}

function closeNativeSignoffWorkflow(options) {
  if (!documentSignoffNativeDialogOpen) return;
  const settings = options || {};
  const backdrop = $("documentSignoffNativePanelBackdrop");
  const panel = $("documentSignoffNativePanel");
  documentSignoffNativeDialogOpen = false;
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (panel) panel.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", handleNativeSignoffKeydown, true);
  setFocusedSignoffChrome(false);
  if (settings.reset !== false) clearNativeSignoffPanel();
  if (settings.restoreFocus !== false) {
    const focusTarget = settings.returnFocus || documentSignoffNativeReturnFocus;
    if (focusTarget && focusTarget.isConnected !== false) {
      focusNativeElement(focusTarget);
    }
  }
  documentSignoffNativeReturnFocus = null;
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

function resizeSignatureCanvas(canvasId, state) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 2.4 * ratio;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#172033";
  state.pixelRatio = ratio;
  state.hasInk = false;
}

function clearSignatureCanvas(canvasId, state) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.hasInk = false;
  state.isDrawing = false;
}

function signaturePointFor(event, canvasId) {
  const canvas = $(canvasId);
  const rect = canvas.getBoundingClientRect();
  const source = event.touches && event.touches.length ? event.touches[0] : event;
  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function beginSignature(event, canvasId, state) {
  if (event.cancelable) event.preventDefault();
  const point = signaturePointFor(event, canvasId);
  state.isDrawing = true;
  state.lastX = point.x;
  state.lastY = point.y;
  state.hasInk = true;
}

function drawSignature(event, canvasId, state) {
  if (!state.isDrawing) return;
  if (event.cancelable) event.preventDefault();
  const point = signaturePointFor(event, canvasId);
  const canvas = $(canvasId);
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.moveTo(state.lastX, state.lastY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  state.lastX = point.x;
  state.lastY = point.y;
  state.hasInk = true;
}

function endSignature(state) {
  state.isDrawing = false;
}

function clearNativeVisitorSignature() {
  clearSignatureCanvas("documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState);
}

function clearNativeInductorSignature() {
  clearSignatureCanvas("documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState);
}

function syncNativeInductorPanel(enabled) {
  const mode = String(settingValue("inductor_signoff_mode", "typed_name"));
  setVisible("documentSignoffNativeInductorBox", enabled);
  setVisible("documentSignoffNativeInductorTypedBox", enabled && mode === "typed_name");
  setVisible("documentSignoffNativeInductorSignatureBox", enabled && mode === "manual_signature");
  if (enabled && $("documentSignoffNativeInductorName")) {
    $("documentSignoffNativeInductorName").value =
      AppState.currentProfile && AppState.currentProfile.display_name
        ? AppState.currentProfile.display_name
        : "";
  }
  if (!enabled) clearNativeInductorSignature();
}

function nativeInductorEnabledForCurrentStep() {
  return !!settingValue("inductor_signoff_enabled", false) &&
    (!nativeSignoffQueue || nativeSignoffQueue.length === 0);
}

function nativeRequiresDocumentReviewCompletion() {
  const value = settingValue("require_document_scroll_to_end_before_signing", false);
  return value === true || value === "true";
}

function syncNativeDocumentReviewRequirement() {
  const required = nativeRequiresDocumentReviewCompletion();
  nativeDocumentReviewReachedEnd = !required;
  setVisible("documentSignoffNativeReviewCompleteButton", required);
  setText(
    "documentSignoffNativeReviewStatus",
    required
      ? "Please scroll to the end of the document before signing."
      : "Document review loaded."
  );
}

function nativeActiveTypes() {
  return (documentSignoffOverviewState.types || []).filter(type => type.is_active !== false);
}

async function loadNativeAgreementTypesIfNeeded() {
  if (nativeActiveTypes().length) return documentSignoffOverviewState.types;
  const result = await supabaseClient.rpc("list_agreement_types");
  if (result.error) throw result.error;
  documentSignoffOverviewState.types = result.data || [];
  return documentSignoffOverviewState.types;
}

async function getNativeAgreementStatusesForVisit(visitId) {
  const result = await supabaseClient.rpc("get_visit_agreement_status_all", {
    p_visit_log_id: visitId
  });
  if (result.error) throw result.error;
  return result.data || [];
}

async function getNativeAgreementVersion(versionId) {
  if (!versionId) return null;
  const result = await supabaseClient
    .from("agreement_versions")
    .select("id, version_number, pdf_url, file_name, is_active, agreement_type_id")
    .eq("id", versionId)
    .single();
  if (result.error) throw result.error;
  return result.data;
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

function groupPendingNativeCandidates(rows) {
  const grouped = [];
  const byVisit = {};
  (rows || []).forEach(row => {
    const key = row.visit_log_id || row.id;
    if (!key) return;
    if (!byVisit[key]) {
      byVisit[key] = {
        id: key,
        visit_log_id: key,
        visitor_name: row.visitor_name,
        company: row.company,
        sign_in_time: row.sign_in_time,
        required_requirements: []
      };
      grouped.push(byVisit[key]);
    }
    byVisit[key].required_requirements.push(row);
  });
  return grouped;
}

function renderNativeSignoffCandidates(rows) {
  const box = $("documentSignoffNativeResults");
  if (!box) return;
  box.classList.remove("oh-empty-state");
  box.replaceChildren();
  const visits = groupPendingNativeCandidates(rows);
  nativeSignoffCandidates = visits;

  if (!visits.length) {
    renderEmptyState("documentSignoffNativeResults", {
      title: "No visitors currently require sign-off",
      description: "The existing agreement requirement checks did not return any current visitors needing action."
    });
    return;
  }

  visits.forEach(visit => {
    const card = document.createElement("article");
    card.className = "document-signoff-native-result-card";
    const body = document.createElement("div");
    const title = document.createElement("h4");
    const meta = document.createElement("p");
    const required = document.createElement("p");
    title.textContent = textOrDash(visit.visitor_name);
    meta.textContent = "Company: " + textOrDash(visit.company) +
      " | Signed in: " + textOrDash(visit.sign_in_time ? formatDateTime(visit.sign_in_time) : "");
    required.textContent = "Required agreement(s): " +
      (visit.required_requirements || []).map(row => row.agreement_name).filter(Boolean).join(", ");
    body.append(title, meta);
    if ((visit.required_requirements || []).length) body.appendChild(required);

    const actions = document.createElement("div");
    actions.className = "document-signoff-native-result-actions";
    const sign = document.createElement("button");
    sign.type = "button";
    sign.textContent = "Review / Sign";
    sign.addEventListener("click", () => openNativeSignoffPanel(visit, false, sign));
    actions.appendChild(sign);

    const optional = document.createElement("button");
    optional.type = "button";
    optional.className = "secondary";
    optional.textContent = "Sign Optional";
    optional.addEventListener("click", () => openNativeSignoffPanel(visit, true, optional));
    actions.appendChild(optional);

    const legacy = document.createElement("button");
    legacy.type = "button";
    legacy.className = "secondary";
    legacy.textContent = "Legacy Sign-off";
    legacy.addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-signoff",
        canOpenLegacySignoff,
        "Visitor agreement sign-off requires visitor sign-in or history access."
      );
    });
    actions.appendChild(legacy);

    card.append(body, actions);
    box.appendChild(card);
  });
}

async function loadNativeSignoffCandidates(manual) {
  if (!canUseNativeVisitorSignoff()) {
    showToast("You do not have permission", "Native visitor sign-off requires agreement or visitor sign-off access.", "error");
    return;
  }
  const box = $("documentSignoffNativeResults");
  if (box) box.textContent = "Loading visitors requiring sign-off...";
  setNativeStatus("Loading visitors requiring agreement action...", "info");
  const result = await supabaseClient.rpc("get_pending_agreement_visitors");
  if (result.error) {
    setNativeStatus(result.error.message, "error");
    if (box) {
      renderEmptyState("documentSignoffNativeResults", {
        title: "Native sign-off could not load",
        description: "This workflow is still completed in Legacy VMS for this scenario."
      });
    }
    showToast("Native sign-off failed", result.error.message, "error");
    return;
  }
  renderNativeSignoffCandidates(result.data || []);
  setNativeStatus((result.data || []).length + " agreement action(s) loaded.", (result.data || []).length ? "info" : "success");
  if (manual) {
    showToast("Native sign-off loaded", "Current visitor agreement actions were loaded.", "success");
  }
}

function nativeAgreementStateBadge(status, type) {
  if (status.already_valid === true) return { label: "Already signed", className: "status-in" };
  if (status.status === "outdated") return { label: "Outdated", className: "status-no-show" };
  if (status.status === "expired") return { label: "Expired", className: "status-no-show" };
  if (status.status === "missing") return { label: "Missing", className: "status-overdue" };
  if (!status.active_agreement_version_id) return { label: "Missing active version", className: "status-inactive" };
  if (type.default_required === true) return { label: "Required", className: "status-overdue" };
  return { label: "Optional", className: "" };
}

function updateNativeSelectionSummary() {
  const checkboxes = Array.from(
    document.querySelectorAll("#documentSignoffNativeAgreementList .document-signoff-native-agreement-check")
  );
  const selected = checkboxes.filter(checkbox => checkbox.checked).length;
  const selectable = checkboxes.filter(checkbox => !checkbox.disabled).length;
  const locked = checkboxes.filter(checkbox => checkbox.checked && checkbox.disabled && checkbox.dataset.lockedSelected === "true").length;
  const parts = [
    selected + " selected",
    selectable + " optional/selectable",
    locked ? locked + " required locked" : ""
  ].filter(Boolean);
  setText("documentSignoffNativeSelectionSummary", parts.join(" | "));
}

function renderNativeAgreementSelection(types, statuses, additionalOnly) {
  const list = $("documentSignoffNativeAgreementList");
  if (!list) return;
  list.classList.remove("oh-empty-state");
  list.replaceChildren();
  const statusMap = {};
  statuses.forEach(status => {
    statusMap[status.agreement_type_id] = status;
  });
  const activeTypes = (types || []).filter(type => type.is_active !== false);

  if (!activeTypes.length) {
    setText("documentSignoffNativeSelectionSummary", "");
    renderEmptyState("documentSignoffNativeAgreementList", {
      title: "No active agreement types",
      description: "This sign-off workflow is still completed in Legacy VMS until active versions are available."
    });
    return;
  }

  activeTypes.forEach(type => {
    const status = statusMap[type.agreement_type_id] || {
      agreement_type_id: type.agreement_type_id,
      agreement_name: type.agreement_name,
      agreement_title: type.agreement_title,
      default_required: type.default_required,
      can_select: false,
      selected_by_default: false,
      locked_selected: false,
      already_valid: false,
      reason: "Status could not be calculated"
    };
    const alreadyValid = status.already_valid === true;
    const hasActiveVersion = !!status.active_agreement_version_id;
    const canSelect = status.can_select === true && hasActiveVersion && !alreadyValid;
    const selected = status.selected_by_default === true && !additionalOnly && canSelect;
    const locked = status.locked_selected === true && !additionalOnly && canSelect;
    const disabled = alreadyValid || !hasActiveVersion || !canSelect || locked;
    const badge = nativeAgreementStateBadge(status, type);

    const row = document.createElement("article");
    row.className = "document-signoff-native-agreement-row";
    const label = document.createElement("label");
    label.className = "document-signoff-native-agreement-header";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "document-signoff-native-agreement-check";
    checkbox.dataset.agreementTypeId = type.agreement_type_id;
    checkbox.checked = selected || locked;
    checkbox.disabled = disabled;
    checkbox.dataset.lockedSelected = locked ? "true" : "false";
    checkbox.addEventListener("change", updateNativeSelectionSummary);
    label.appendChild(checkbox);
    const heading = document.createElement("span");
    heading.textContent = textOrDash(type.agreement_name);
    label.appendChild(heading);
    label.appendChild(createBadge(badge.label, badge.className));

    const meta = document.createElement("p");
    meta.textContent = "Title: " + textOrDash(type.agreement_title) +
      " | Status: " + textOrDash(status.reason || (type.default_required ? "Required agreement" : "Optional agreement")) +
      " | Active version: " + textOrDash(status.active_agreement_version_number);
    if (status.last_signed_at) {
      meta.textContent += " | Last signed: " + formatDateTime(status.last_signed_at);
    }
    row.append(label, meta);
    list.appendChild(row);
  });
  updateNativeSelectionSummary();
}

async function openNativeSignoffPanel(visit, additionalOnly, trigger) {
  if (!canUseNativeVisitorSignoff()) return;
  nativeSignoffCurrentVisit = visit;
  nativeSignoffCurrentRequirement = null;
  nativeSignoffQueue = [];
  nativeSignoffQueueTotal = 0;
  nativeSignoffAdditionalOnly = !!additionalOnly;
  setVisible("documentSignoffNativeSelectionStep", true);
  setVisible("documentSignoffNativeSigningStep", false);
  setVisible("documentSignoffNativeStartButton", true);
  setVisible("documentSignoffNativeSaveButton", false);
  setText("documentSignoffNativePanelEyebrow", "Visitor Document Sign-off");
  setText("documentSignoffNativePanelTitle", additionalOnly ? "Sign Optional Agreement" : "Review / Sign Agreements");
  setNativePanelStatus("Loading agreement status...", "info");
  renderMetaList("documentSignoffNativeVisitorMeta", formatVisitMeta(visit));
  const list = $("documentSignoffNativeAgreementList");
  if (list) list.textContent = "Loading agreement status...";
  setText("documentSignoffNativeSelectionSummary", "");
  openNativeSignoffWorkflow({
    trigger,
    title: additionalOnly ? "Sign Optional Agreement" : "Review / Sign Agreements"
  });

  try {
    const visitId = visit.visit_log_id || visit.id;
    const types = await loadNativeAgreementTypesIfNeeded();
    const statuses = await getNativeAgreementStatusesForVisit(visitId);
    renderNativeAgreementSelection(types, statuses, additionalOnly);
    setNativePanelStatus("Agreement status loaded.", "success");
  } catch (err) {
    renderEmptyState("documentSignoffNativeAgreementList", {
      title: "Native sign-off unavailable",
      description: "This sign-off workflow is still completed in Legacy VMS."
    });
    setNativePanelStatus(err.message || "Agreement status could not be loaded.", "error");
  }
}

async function startNativeSignoffQueue() {
  clearNativeValidationHighlights();
  if (!nativeSignoffCurrentVisit) {
    showNativeValidation("No visitor visit is selected.", "documentSignoffNativeVisitorMeta");
    return;
  }
  const selectedBoxes = Array.from(
    document.querySelectorAll("#documentSignoffNativeAgreementList .document-signoff-native-agreement-check")
  ).filter(checkbox =>
    (checkbox.checked && !checkbox.disabled) ||
    (checkbox.checked && checkbox.disabled && checkbox.dataset.lockedSelected === "true")
  );
  if (!selectedBoxes.length) {
    showNativeValidation("Please select at least one optional agreement or continue with required agreements only.", "documentSignoffNativeAgreementList");
    return;
  }

  const visitId = nativeSignoffCurrentVisit.visit_log_id || nativeSignoffCurrentVisit.id;
  setNativePanelStatus("Preparing selected agreement(s)...", "info");
  try {
    const statuses = await getNativeAgreementStatusesForVisit(visitId);
    const statusMap = {};
    statuses.forEach(status => {
      statusMap[status.agreement_type_id] = status;
    });
    const queue = [];
    for (const checkbox of selectedBoxes) {
      const typeId = checkbox.dataset.agreementTypeId;
      const status = statusMap[typeId];
      const typeMeta = (documentSignoffOverviewState.types || []).find(type => type.agreement_type_id === typeId) || {};
      if (!status) {
        showNativeValidation("Agreement status could not be calculated for " + textOrDash(typeMeta.agreement_name || typeId) + ".", "documentSignoffNativeAgreementList");
        return;
      }
      if (status.already_valid === true) {
        showNativeValidation("Agreement " + textOrDash(status.agreement_name) + " is already valid and cannot be signed again.", "documentSignoffNativeAgreementList");
        return;
      }
      if (!status.active_agreement_version_id) {
        showNativeValidation("Agreement " + textOrDash(status.agreement_name) + " has no active version.", "documentSignoffNativeAgreementList");
        return;
      }
      if (status.can_select !== true) {
        showNativeValidation("Agreement " + textOrDash(status.agreement_name) + " is not available: " + textOrDash(status.reason) + ".", "documentSignoffNativeAgreementList");
        return;
      }
      queue.push({
        visit: nativeSignoffCurrentVisit,
        requirement: {
          agreement_type_id: typeId,
          agreement_name: status.agreement_name || typeMeta.agreement_name,
          agreement_title: status.agreement_title || typeMeta.agreement_title,
          active_agreement_version_id: status.active_agreement_version_id,
          active_agreement_version_number: status.active_agreement_version_number,
          signature_required: status.signature_required,
          reason: status.reason
        }
      });
    }
    nativeSignoffQueue = queue;
    nativeSignoffQueueTotal = queue.length;
    await openNextNativeQueuedAgreement();
  } catch (err) {
    setNativePanelStatus(err.message || "Selected agreements could not be prepared.", "error");
    showToast("Native sign-off failed", err.message || "Selected agreements could not be prepared.", "error");
  }
}

async function openNextNativeQueuedAgreement() {
  if (!nativeSignoffQueue.length) {
    nativeSignoffCurrentRequirement = null;
    return;
  }
  const next = nativeSignoffQueue.shift();
  nativeSignoffCurrentVisit = next.visit;
  nativeSignoffCurrentRequirement = next.requirement;
  await renderNativeSigningStep(next.visit, next.requirement);
}

async function renderNativeSigningStep(visit, requirement) {
  setVisible("documentSignoffNativeSelectionStep", false);
  setVisible("documentSignoffNativeSigningStep", true);
  setVisible("documentSignoffNativeStartButton", false);
  setVisible("documentSignoffNativeSaveButton", true);
  setText("documentSignoffNativePanelEyebrow", "Visitor Document Sign-off");
  setText("documentSignoffNativePanelTitle", textOrDash(requirement.agreement_name));
  const completed = nativeSignoffQueueTotal - nativeSignoffQueue.length;
  setText("documentSignoffNativeQueueMeta", "Agreement " + completed + " of " + nativeSignoffQueueTotal);
  setText("documentSignoffNativeAcceptedText", String(settingValue(
    "agreement_acceptance_text",
    "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction."
  )));
  if ($("documentSignoffNativeAcceptedCheck")) $("documentSignoffNativeAcceptedCheck").checked = false;
  setVisible("documentSignoffNativeSignatureBox", requirement.signature_required !== false);
  clearNativeVisitorSignature();
  clearNativeInductorSignature();
  clearNativeValidationHighlights();
  syncNativeDocumentReviewRequirement();
  syncNativeInductorPanel(nativeInductorEnabledForCurrentStep());
  renderMetaList("documentSignoffNativeAgreementMeta", [
    ["Agreement", requirement.agreement_title || requirement.agreement_name],
    ["Version", requirement.active_agreement_version_number],
    ["Requirement", requirement.reason],
    ["Visitor", visit.visitor_name],
    ["Company", visit.company]
  ]);
  setNativePanelStatus("Loading agreement document...", "info");
  try {
    const version = await getNativeAgreementVersion(requirement.active_agreement_version_id);
    if ($("documentSignoffNativePdfFrame")) {
      $("documentSignoffNativePdfFrame").src = version && version.pdf_url ? version.pdf_url : "about:blank";
    }
    setNativePanelStatus("Ready for visitor sign-off.", "success");
  } catch (err) {
    if ($("documentSignoffNativePdfFrame")) $("documentSignoffNativePdfFrame").src = "about:blank";
    setNativePanelStatus("Agreement document could not be previewed. The sign-off can continue if the document has been reviewed elsewhere.", "error");
  }
  setTimeout(() => {
    resizeSignatureCanvas("documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState);
    resizeSignatureCanvas("documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState);
  }, 60);
}

async function saveNativeVisitorAgreement() {
  clearNativeValidationHighlights();
  const visit = nativeSignoffCurrentVisit;
  const requirement = nativeSignoffCurrentRequirement;
  if (!visit || !requirement) {
    showNativeValidation("No agreement is selected.", "documentSignoffNativeAgreementList");
    return;
  }
  if (nativeRequiresDocumentReviewCompletion() && !nativeDocumentReviewReachedEnd) {
    showNativeValidation("Please scroll to the end of the document before signing.", "documentSignoffNativeDocumentReview");
    return;
  }
  if (!$("documentSignoffNativeAcceptedCheck") || !$("documentSignoffNativeAcceptedCheck").checked) {
    showNativeValidation("Please complete the confirmation checkbox before signing.", "documentSignoffNativeAcceptanceField");
    return;
  }

  const signatureRequired = !$("documentSignoffNativeSignatureBox").classList.contains("hidden");
  const visitorSignature = signatureRequired && nativeVisitorSignatureState.hasInk
    ? $("documentSignoffNativeSignatureCanvas").toDataURL("image/png")
    : null;
  if (signatureRequired && !visitorSignature) {
    showNativeValidation("Signature required before saving.", "documentSignoffNativeSignatureBox");
    return;
  }

  const inductorEnabled = nativeInductorEnabledForCurrentStep();
  const inductorMode = String(settingValue("inductor_signoff_mode", "typed_name"));
  const inductorName = inductorEnabled && $("documentSignoffNativeInductorName")
    ? $("documentSignoffNativeInductorName").value.trim()
    : null;
  const inductorSignature = inductorEnabled &&
    inductorMode === "manual_signature" &&
    nativeInductorSignatureState.hasInk
    ? $("documentSignoffNativeInductorSignatureCanvas").toDataURL("image/png")
    : null;
  if (inductorEnabled && inductorMode === "typed_name" && !inductorName) {
    showNativeValidation("Inductor name is required before saving.", "documentSignoffNativeInductorName");
    return;
  }
  if (inductorEnabled && inductorMode === "manual_signature" && !inductorSignature) {
    showNativeValidation("Inductor signature is required before saving.", "documentSignoffNativeInductorSignatureBox");
    return;
  }

  const visitId = visit.visit_log_id || visit.id;
  try {
    setNativePanelStatus("Saving agreement evidence...", "info");
    const latestStatuses = await getNativeAgreementStatusesForVisit(visitId);
    const latest = latestStatuses.find(status => status.agreement_type_id === requirement.agreement_type_id);
    if (!latest || latest.already_valid === true || latest.can_select !== true) {
      showNativeValidation("This agreement is no longer available for signing. Refresh and try again.", "documentSignoffNativeAgreementMeta");
      return;
    }
    const result = await supabaseClient.rpc("save_visitor_agreement", {
      p_visit_log_id: visitId,
      p_agreement_type_id: requirement.agreement_type_id,
      p_signature_data: visitorSignature,
      p_accepted_without_signature: !signatureRequired,
      p_inductor_name: inductorName,
      p_inductor_signature_data: inductorSignature
    });
    if (result.error) throw result.error;
    const response = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!response || response.success !== true) {
      throw new Error(response && response.message ? response.message : "Agreement save failed.");
    }
    if (inductorEnabled) {
      const applyResult = await supabaseClient.rpc("apply_inductor_signoff_to_visit_agreements", {
        p_visit_log_id: visitId,
        p_inductor_name: inductorName,
        p_inductor_signature_data: inductorSignature
      });
      if (applyResult.error) {
        setNativePanelStatus("Agreement saved, but inductor sign-off could not be applied to all selected agreements: " + applyResult.error.message, "error");
        showToast("Agreement saved with warning", applyResult.error.message, "error");
        await loadDocumentSignoffOverview({ manual: false });
        await loadNativeSignoffCandidates(false);
        return;
      }
    }
    showToast("Agreement saved", response.message || "Agreement evidence saved.", "success");
    await loadDocumentSignoffOverview({ manual: false });
    await loadNativeSignoffCandidates(false);
    if (nativeSignoffQueue.length) {
      showToast("Next agreement", "Opening the next selected agreement.", "info");
      await openNextNativeQueuedAgreement();
      return;
    }
    setNativePanelStatus("Agreement saved. Current status has been refreshed.", "success");
    await openNativeSignoffPanel(visit, nativeSignoffAdditionalOnly, $("documentSignoffNativeSaveButton"));
  } catch (err) {
    setNativePanelStatus("Could not save agreement: " + (err.message || String(err)), "error");
    showToast("Agreement save failed", err.message || "Agreement evidence could not be saved.", "error");
  }
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
  const canUseNative = canUseNativeVisitorSignoff();
  setVisible("visitorsDocumentSignoffsSection", canView);
  setVisible("documentSignoffNativeCard", canUseNative);
  setVisible("documentSignoffLoadPendingButton", canUseNative);
  setVisible("documentSignoffNativeLegacyButton", canOpenLegacySignoff());
  setVisible("documentSignoffNativePanelLegacyButton", canOpenLegacySignoff());
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

function initialiseDocumentSignoffNativePanel() {
  if (!$("documentSignoffNativePanel")) return;
  const backdrop = $("documentSignoffNativePanelBackdrop");
  if (backdrop && backdrop.dataset.nativeSignoffInitialised !== "true") {
    backdrop.dataset.nativeSignoffInitialised = "true";
    backdrop.setAttribute("aria-hidden", "true");
    $("documentSignoffNativePanel").setAttribute("aria-hidden", "true");
    backdrop.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeNativeSignoffWorkflow({ reason: "backdrop" });
    });
  }
  clearNativeSignoffPanel();
}

export function initialiseDocumentSignoffs(dependencies) {
  if (dependencies) configureDocumentSignoffs(dependencies);
  if (documentSignoffInitialised) return;
  documentSignoffInitialised = true;
  initialiseDocumentSignoffDetailsPanel();
  initialiseDocumentSignoffNativePanel();

  if ($("documentSignoffRefreshButton")) {
    $("documentSignoffRefreshButton").addEventListener("click", () => {
      loadDocumentSignoffOverview({ manual: true });
    });
  }
  if ($("documentSignoffLoadPendingButton")) {
    $("documentSignoffLoadPendingButton").addEventListener("click", () => {
      loadNativeSignoffCandidates(true);
    });
  }
  if ($("documentSignoffNativeLegacyButton")) {
    $("documentSignoffNativeLegacyButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-signoff",
        canOpenLegacySignoff,
        "Visitor agreement sign-off requires visitor sign-in or history access."
      );
    });
  }
  if ($("documentSignoffNativePanelLegacyButton")) {
    $("documentSignoffNativePanelLegacyButton").addEventListener("click", () => {
      guardedLegacyOpen(
        "document-signoffs-signoff",
        canOpenLegacySignoff,
        "Visitor agreement sign-off requires visitor sign-in or history access."
      );
    });
  }
  if ($("documentSignoffNativePanelClose")) {
    $("documentSignoffNativePanelClose").addEventListener("click", () => {
      closeNativeSignoffWorkflow({ reason: "close" });
    });
  }
  if ($("documentSignoffNativeCancelButton")) {
    $("documentSignoffNativeCancelButton").addEventListener("click", () => {
      closeNativeSignoffWorkflow({ reason: "cancel" });
    });
  }
  if ($("documentSignoffNativeStartButton")) {
    $("documentSignoffNativeStartButton").addEventListener("click", startNativeSignoffQueue);
  }
  if ($("documentSignoffNativeSaveButton")) {
    $("documentSignoffNativeSaveButton").addEventListener("click", saveNativeVisitorAgreement);
  }
  if ($("documentSignoffNativeClearSignatureButton")) {
    $("documentSignoffNativeClearSignatureButton").addEventListener("click", clearNativeVisitorSignature);
  }
  if ($("documentSignoffNativeClearInductorSignatureButton")) {
    $("documentSignoffNativeClearInductorSignatureButton").addEventListener("click", clearNativeInductorSignature);
  }
  if ($("documentSignoffNativeReviewCompleteButton")) {
    $("documentSignoffNativeReviewCompleteButton").addEventListener("click", () => {
      nativeDocumentReviewReachedEnd = true;
      setText("documentSignoffNativeReviewStatus", "Document review completion confirmed.");
      clearNativeValidationHighlights();
      showToast("Document review confirmed", "You can now complete the visitor sign-off.", "success");
    });
  }
  if ($("documentSignoffNativeSignatureCanvas")) {
    $("documentSignoffNativeSignatureCanvas").addEventListener("mousedown", event => beginSignature(event, "documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState));
    $("documentSignoffNativeSignatureCanvas").addEventListener("mousemove", event => drawSignature(event, "documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState));
    $("documentSignoffNativeSignatureCanvas").addEventListener("touchstart", event => beginSignature(event, "documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState), { passive: false });
    $("documentSignoffNativeSignatureCanvas").addEventListener("touchmove", event => drawSignature(event, "documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState), { passive: false });
  }
  if ($("documentSignoffNativeInductorSignatureCanvas")) {
    $("documentSignoffNativeInductorSignatureCanvas").addEventListener("mousedown", event => beginSignature(event, "documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState));
    $("documentSignoffNativeInductorSignatureCanvas").addEventListener("mousemove", event => drawSignature(event, "documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState));
    $("documentSignoffNativeInductorSignatureCanvas").addEventListener("touchstart", event => beginSignature(event, "documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState), { passive: false });
    $("documentSignoffNativeInductorSignatureCanvas").addEventListener("touchmove", event => drawSignature(event, "documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState), { passive: false });
  }
  window.addEventListener("mouseup", () => {
    endSignature(nativeVisitorSignatureState);
    endSignature(nativeInductorSignatureState);
  });
  window.addEventListener("touchend", () => {
    endSignature(nativeVisitorSignatureState);
    endSignature(nativeInductorSignatureState);
  });
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
