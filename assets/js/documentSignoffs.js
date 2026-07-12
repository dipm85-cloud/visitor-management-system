import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { settingValue } from "./settings.js";
import { todayDate } from "./utils.js";
import { createSidePanelController, renderEmptyState } from "./platformUi.js";
import { openIdentityReviewRequestFromContext } from "./identityResolutionAdmin.js";
import { openLinkedIdentityContextDetails, renderLinkedIdentityContext } from "./identityContext.js";

let documentSignoffDependencies = {};
let documentSignoffInitialised = false;
let documentSignoffLoadSequence = 0;
let documentSignoffDetailsPanelController = null;
let documentSignoffNativeDialogOpen = false;
let documentSignoffNativeReturnFocus = null;
let documentSignoffNativePreviousBodyOverflow = "";
let documentSignoffNativePreviousHtmlOverflow = "";
let documentSignoffNativeCurrentStep = "selection";
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

const IDENTITY_REVIEW_REQUEST_CAPABILITIES = [
  "identity_resolution.request",
  "identity_resolution.manage",
  "privacy.manage",
  "gdpr.manage",
  "module_configuration.manage",
  "settings.edit"
];
const DOCUMENT_COMPLIANCE_IDENTITY_LINK_SETTING =
  "document_signoff.use_confirmed_identity_links_for_compliance";
const LINKED_COMPLIANCE_VISIT_SOURCE_TYPES = new Set(["visit_log", "visitor_history"]);
const LINKED_COMPLIANCE_EVIDENCE_SOURCE_TYPES = new Set([
  "document_evidence",
  "agreement_evidence",
  "document_signoff_evidence"
]);

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

function canRequestIdentityReviewFromDocumentSignoffs() {
  return isActiveStaffUser() && hasAnyCapability(IDENTITY_REVIEW_REQUEST_CAPABILITIES);
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

function readZIndex(selector) {
  const element = document.querySelector(selector);
  if (!element) return "";
  return window.getComputedStyle(element).zIndex || "";
}

function readComputedField(selector, field) {
  const element = document.querySelector(selector);
  if (!element) return "";
  return window.getComputedStyle(element)[field] || "";
}

function isElementVisible(element) {
  if (!element) return false;
  return !element.classList.contains("hidden") &&
    element.getAttribute("aria-hidden") !== "true" &&
    !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function nativeAgreementCheckboxes() {
  return Array.from(
    document.querySelectorAll("#documentSignoffNativeAgreementList .document-signoff-native-agreement-check")
  );
}

function isNativeAgreementCheckboxSignable(checkbox) {
  if (!checkbox) return false;
  return !checkbox.disabled || checkbox.dataset.lockedSelected === "true";
}

function nativeSelectedSignableCheckboxes() {
  return nativeAgreementCheckboxes().filter(checkbox =>
    checkbox.checked && isNativeAgreementCheckboxSignable(checkbox)
  );
}

function nativeSignableAgreementCount() {
  return nativeAgreementCheckboxes().filter(isNativeAgreementCheckboxSignable).length;
}

function updateDocumentSignoffDebug(patch) {
  const previous = window.__ohDocumentSignoffDebug || {};
  const overlay = $("documentSignoffOverlayRoot");
  const backdrop = $("documentSignoffNativePanelBackdrop");
  const footer = document.querySelector(".oh-footer");
  const header = document.querySelector(".oh-header");
  const actions = $("documentSignoffNativePanelActions");
  const continueButton = $("documentSignoffNativeStartButton");
  const overlayStyle = backdrop ? window.getComputedStyle(backdrop) : null;
  window.__ohDocumentSignoffDebug = Object.assign({}, previous, {
    overlayOpen: documentSignoffNativeDialogOpen,
    bodyClasses: document.body.className,
    appShellClasses: $("operationsHubShell") ? $("operationsHubShell").className : "",
    footerElementFound: !!footer,
    footerComputedPosition: footer ? window.getComputedStyle(footer).position : "",
    footerComputedTop: footer ? window.getComputedStyle(footer).top : "",
    footerComputedLeft: footer ? window.getComputedStyle(footer).left : "",
    footerComputedZIndex: footer ? window.getComputedStyle(footer).zIndex : "",
    headerComputedPosition: header ? window.getComputedStyle(header).position : "",
    headerComputedTop: header ? window.getComputedStyle(header).top : "",
    headerComputedLeft: header ? window.getComputedStyle(header).left : "",
    signoffOverlayParentTag: backdrop && backdrop.parentElement ? backdrop.parentElement.tagName : "",
    overlayParentTag: overlay && overlay.parentElement ? overlay.parentElement.tagName : "",
    overlayPositionStyle: overlayStyle ? overlayStyle.position : "",
    overlayZIndex: overlayStyle ? overlayStyle.zIndex : "",
    overlayRootExists: !!overlay,
    overlayRootParentTag: overlay && overlay.parentElement ? overlay.parentElement.tagName : "",
    overlayRootIsBodyChild: !!(overlay && overlay.parentElement === document.body),
    overlayComputedPosition: overlayStyle ? overlayStyle.position : "",
    overlayComputedZIndex: overlayStyle ? overlayStyle.zIndex : "",
    appHeaderZIndex: readZIndex(".oh-header"),
    appFooterZIndex: readZIndex(".oh-footer"),
    headerComputedZIndex: readComputedField(".oh-header", "zIndex"),
    footerComputedZIndexLegacy: readComputedField(".oh-footer", "zIndex"),
    bodyScrollLocked: document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden",
    currentStep: documentSignoffNativeCurrentStep,
    visitorName: nativeSignoffCurrentVisit ? textOrDash(nativeSignoffCurrentVisit.visitor_name) : "",
    selectedAgreementCount: nativeSelectedSignableCheckboxes().length,
    signableAgreementCount: nativeSignableAgreementCount(),
    selectedDocumentCount: nativeSelectedSignableCheckboxes().length,
    signableDocumentCount: nativeSignableAgreementCount(),
    currentDocumentTitle: currentNativeDocumentTitle(),
    confirmationChecked: !!($("documentSignoffNativeAcceptedCheck") && $("documentSignoffNativeAcceptedCheck").checked),
    documentReviewReachedEnd: nativeDocumentReviewReachedEnd,
    signaturePresent: nativeVisitorSignatureState.hasInk,
    selectionFooterExists: !!actions,
    selectionFooterVisible: isElementVisible(actions),
    continueButtonExists: !!continueButton,
    continueButtonVisible: isElementVisible(continueButton),
    continueButtonDisabled: !!(continueButton && continueButton.disabled),
    saveButtonVisible: isElementVisible($("documentSignoffNativeSaveButton")),
    selectionContinueButtonExists: !!continueButton,
    selectionContinueButtonVisible: isElementVisible(continueButton),
    selectionContinueButtonDisabled: !!(continueButton && continueButton.disabled),
    documentStepOpened: previous.documentStepOpened === true || documentSignoffNativeCurrentStep === "signing",
    lastActionClicked: previous.lastActionClicked || "",
    lastError: previous.lastError || ""
  }, patch || {});
  if (localStorage.getItem("oh_debug_document_signoff") === "true") {
    console.debug("Document sign-off debug", window.__ohDocumentSignoffDebug);
  }
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
  const text = message || "";
  const statusType = type || "info";
  const shouldKeepInline =
    statusType === "error" ||
    /no active|no signable|unavailable|could not|failed|required|warning|attention/i.test(text);
  const displayText = text && shouldKeepInline ? text : "";
  box.textContent = displayText;
  box.className = "local-action-status" + (displayText ? " " + statusType : "");
}

function formatVisitMeta(visit) {
  return [
    ["Visitor", visit && visit.visitor_name],
    ["Company", visit && visit.company],
    ["Signed in", visit && visit.sign_in_time ? formatDateTime(visit.sign_in_time) : ""]
  ].filter(item => hasValue(item[1]));
}

function formatWizardVisitorMeta(visit) {
  if (!visit) return "Select visitor documents";
  return [visit.visitor_name, visit.company].filter(hasValue).join(" - ") || "Visitor document sign-off";
}

function currentNativeDocumentTitle() {
  const requirement = nativeSignoffCurrentRequirement || {};
  return textOrDash(requirement.agreement_title || requirement.agreement_name);
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
  updateDocumentSignoffDebug({ lastError: text });
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

function appendActionButtonsCell(row, actions) {
  const cell = document.createElement("td");
  cell.className = "document-signoff-row-actions document-signoff-row-actions-stack";
  (actions || []).forEach(action => {
    if (!action) return;
    const button = document.createElement("button");
    button.className = action.primary ? "" : "secondary";
    button.type = "button";
    button.textContent = action.label || "View Details";
    button.addEventListener("click", event => {
      event.stopPropagation();
      action.handler(button);
    });
    cell.appendChild(button);
  });
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
  const contextActions = $("documentSignoffDetailsContextActions");
  if (contextActions) contextActions.replaceChildren();
  const linkedContext = $("documentSignoffDetailsLinkedIdentityContext");
  if (linkedContext) linkedContext.replaceChildren();
  const advanced = $("documentSignoffDetailsAdvanced");
  if (advanced) advanced.replaceChildren();
  setVisible("documentSignoffDetailsContextSection", false);
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
  setText("documentSignoffNativeWizardMeta", "Select visitor documents");
  setText("documentSignoffNativeWizardStep", "Step 1 of 3 - Select documents");
  setNativePanelStatus("", "");
  setText("documentSignoffNativeReviewStatus", "");
  setText("documentSignoffNativeSelectionSummary", "");
  renderMetaList("documentSignoffNativeVisitorMeta", []);
  renderMetaList("documentSignoffNativeAgreementMeta", []);
  renderMetaList("documentSignoffNativeSignatureMeta", []);
  const list = $("documentSignoffNativeAgreementList");
  if (list) list.textContent = "Loading agreement status...";
  if ($("documentSignoffNativePdfFrame")) $("documentSignoffNativePdfFrame").src = "about:blank";
  if ($("documentSignoffNativeAcceptedCheck")) $("documentSignoffNativeAcceptedCheck").checked = false;
  setVisible("documentSignoffNativeSelectionStep", true);
  setVisible("documentSignoffNativeReviewStep", false);
  setVisible("documentSignoffNativeSignatureStep", false);
  setVisible("documentSignoffNativeStartButton", true);
  setVisible("documentSignoffNativeSaveButton", false);
  setVisible("documentSignoffNativeBackButton", false);
  setNativeWorkflowStep("selection");
  setVisible("documentSignoffNativeReviewCompleteButton", false);
  clearNativeValidationHighlights();
  clearNativeVisitorSignature();
  clearNativeInductorSignature();
}

function setNativeWorkflowStep(step) {
  const panel = $("documentSignoffNativePanel");
  documentSignoffNativeCurrentStep = ["review", "signature"].includes(step) ? step : "selection";
  if (panel) {
    panel.classList.toggle("is-selection-step", documentSignoffNativeCurrentStep === "selection");
    panel.classList.toggle("is-review-step", documentSignoffNativeCurrentStep === "review");
    panel.classList.toggle("is-signature-step", documentSignoffNativeCurrentStep === "signature");
  }
  setVisible("documentSignoffNativeSelectionStep", documentSignoffNativeCurrentStep === "selection");
  setVisible("documentSignoffNativeReviewStep", documentSignoffNativeCurrentStep === "review");
  setVisible("documentSignoffNativeSignatureStep", documentSignoffNativeCurrentStep === "signature");
  syncNativeWizardActions();
  updateDocumentSignoffDebug({ currentStep: documentSignoffNativeCurrentStep });
}

function syncNativeWizardActions() {
  const startButton = $("documentSignoffNativeStartButton");
  const saveButton = $("documentSignoffNativeSaveButton");
  const backButton = $("documentSignoffNativeBackButton");
  if (startButton) {
    startButton.textContent = documentSignoffNativeCurrentStep === "review"
      ? "Next: Sign"
      : "Next: Review Document";
    startButton.classList.toggle("hidden", documentSignoffNativeCurrentStep === "signature");
  }
  if (saveButton) saveButton.classList.toggle("hidden", documentSignoffNativeCurrentStep !== "signature");
  if (backButton) {
    backButton.textContent = documentSignoffNativeCurrentStep === "signature"
      ? "Back to Document"
      : "Back to Selection";
    backButton.classList.toggle("hidden", documentSignoffNativeCurrentStep === "selection");
  }
  setText("documentSignoffNativeWizardStep", {
    selection: "Step 1 of 3 - Select documents",
    review: "Step 2 of 3 - Review document",
    signature: "Step 3 of 3 - Sign and save"
  }[documentSignoffNativeCurrentStep] || "Step 1 of 3 - Select documents");
}

function setFocusedSignoffChrome(active) {
  const workspace = $("visitorsWorkspace");
  if (workspace) workspace.classList.toggle("document-signoff-focused", !!active);
  document.body.classList.toggle("document-signoff-overlay-open", !!active);
  if (active) {
    documentSignoffNativePreviousBodyOverflow = document.body.style.overflow || "";
    documentSignoffNativePreviousHtmlOverflow = document.documentElement.style.overflow || "";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  } else {
    document.body.style.overflow = documentSignoffNativePreviousBodyOverflow || "";
    document.documentElement.style.overflow = documentSignoffNativePreviousHtmlOverflow || "";
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
  updateDocumentSignoffDebug({
    overlayOpen: true,
    documentStepOpened: false,
    lastActionClicked: "open",
    lastError: ""
  });
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
  updateDocumentSignoffDebug({
    overlayOpen: false,
    lastActionClicked: settings.reason || "close"
  });
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

function createDetailMetaItem(label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = textOrDash(value);
  wrapper.append(dt, dd);
  return wrapper;
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

function createContextActionButton(action) {
  const button = document.createElement("button");
  button.className = action.primary ? "" : "secondary";
  button.type = "button";
  button.textContent = action.label;
  button.addEventListener("click", event => action.handler(event.currentTarget));
  return button;
}

function copyDetailTechnicalId(value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast("Copy unavailable", "Clipboard access is not available in this browser.", "error");
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => showToast("Technical ID copied", "The record reference was copied.", "success"))
    .catch(() => showToast("Copy failed", "The record reference could not be copied.", "error"));
}

function renderDetailAdvanced(fields) {
  const host = $("documentSignoffDetailsAdvanced");
  if (!host) return;
  host.replaceChildren();
  const visibleFields = (fields || []).filter(field => field && hasValue(field.value));
  if (!visibleFields.length) return;
  const details = document.createElement("details");
  details.className = "identity-resolution-request-details identity-resolution-request-advanced";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced / Technical Details";
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  visibleFields.forEach(field => {
    meta.appendChild(createDetailMetaItem(field.label, field.value));
  });
  details.append(summary, meta);
  const technicalId = visibleFields.find(field => /evidence id|record id|reference/i.test(field.label || "") && field.value);
  if (technicalId) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy Technical ID";
    copy.addEventListener("click", () => copyDetailTechnicalId(technicalId.value));
    details.appendChild(copy);
  }
  host.appendChild(details);
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
  renderDetailAdvanced(settings.advancedFields || []);
  const linkedContext = $("documentSignoffDetailsLinkedIdentityContext");
  if (linkedContext) {
    linkedContext.replaceChildren();
    if (settings.linkedIdentityContext) {
      renderLinkedIdentityContext(linkedContext, settings.linkedIdentityContext);
    }
  }

  const contextActions = $("documentSignoffDetailsContextActions");
  const availableContextActions = (settings.contextActions || []).filter(action => action.allowed());
  if (contextActions) {
    contextActions.replaceChildren();
    availableContextActions.forEach(action => contextActions.appendChild(createContextActionButton(action)));
  }
  setVisible("documentSignoffDetailsContextSection", availableContextActions.length > 0);

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
  updateDocumentSignoffDebug({ signaturePresent: nativeVisitorSignatureState.hasInk });
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
  updateDocumentSignoffDebug({ signaturePresent: nativeVisitorSignatureState.hasInk });
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
  updateDocumentSignoffDebug({ signaturePresent: nativeVisitorSignatureState.hasInk });
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

function settingEnabled(key, fallback) {
  const value = settingValue(key, fallback);
  return value === true || value === "true";
}

function useIdentityLinksForDocumentCompliance() {
  return settingEnabled(DOCUMENT_COMPLIANCE_IDENTITY_LINK_SETTING, false);
}

function directEvidenceIsValid(status) {
  const normalized = String(status && status.status || "").toLowerCase();
  return status && (
    status.already_valid === true ||
    ["valid", "current", "signed", "complete", "compliant"].includes(normalized)
  );
}

function explicitEvidenceVisitLogIdFromStatus(status) {
  if (!status) return "";
  return String(
    status.evidence_visit_log_id ||
    status.evidence_visitor_log_id ||
    status.document_evidence_visit_log_id ||
    status.agreement_evidence_visit_log_id ||
    status.signed_visit_log_id ||
    ""
  ).trim();
}

function visitIdsMatch(left, right) {
  const leftId = String(left || "").trim();
  const rightId = String(right || "").trim();
  return !!leftId && !!rightId && leftId === rightId;
}

async function directEvidenceRecordMatchesVisit(status, visitId) {
  if (!directEvidenceIsValid(status) || !visitId) return false;

  const explicitVisitId = explicitEvidenceVisitLogIdFromStatus(status);
  if (explicitVisitId) return visitIdsMatch(explicitVisitId, visitId);

  const evidenceId = evidenceRecordIdFromStatus(status);
  if (!evidenceId) return false;

  try {
    const record = await findEvidenceRecordById(evidenceId);
    const recordVisitId = record && (record.visit_log_id || record.visitor_log_id);
    return visitIdsMatch(recordVisitId, visitId);
  } catch (error) {
    console.warn("Could not verify direct document evidence against current visit.", error);
    return false;
  }
}

function demoteUnsafeHistoricalEvidence(status) {
  return {
    ...status,
    already_valid: false,
    status: "missing",
    compliance_status: "missing",
    can_select: !!(status && status.active_agreement_version_id),
    selected_by_default: status && status.default_required === true && !!status.active_agreement_version_id,
    locked_selected: status && status.default_required === true && !!status.active_agreement_version_id,
    evidence_source: "historical_context",
    evidence_source_label: "Historical context only",
    identity_link_lookup_note: "Previous same-name evidence was not used. This visit needs direct evidence or a confirmed identity link.",
    reason: "Required sign-off missing for this visit."
  };
}

async function restrictDirectEvidenceToCurrentVisit(visitId, statuses) {
  const checked = [];
  for (const status of statuses || []) {
    if (!directEvidenceIsValid(status) || status.evidence_source === "confirmed_identity_link") {
      checked.push(status);
      continue;
    }

    const matchesCurrentVisit = await directEvidenceRecordMatchesVisit(status, visitId);
    checked.push(matchesCurrentVisit
      ? {
          ...status,
          evidence_source: status.evidence_source || "direct",
          evidence_source_label: status.evidence_source_label || "Direct evidence"
        }
      : demoteUnsafeHistoricalEvidence(status));
  }
  return checked;
}

function sourceSummaryObject(source) {
  const summary = source && source.linked_source_summary;
  if (!summary) return {};
  if (typeof summary === "object") return summary;
  try {
    return JSON.parse(summary);
  } catch (err) {
    return {};
  }
}

function linkedSourceType(source) {
  return String(source && source.linked_source_type || "").trim().toLowerCase();
}

function linkedVisitLogId(source) {
  const type = linkedSourceType(source);
  if (LINKED_COMPLIANCE_VISIT_SOURCE_TYPES.has(type)) {
    return source && source.linked_source_record_id ? String(source.linked_source_record_id) : "";
  }

  const summary = sourceSummaryObject(source);
  if (LINKED_COMPLIANCE_EVIDENCE_SOURCE_TYPES.has(type) || type === "planned_visits" || type === "planned_visit") {
    return String(
      summary.visit_log_id ||
      summary.visitor_log_id ||
      summary.visit_id ||
      summary.linked_visit_log_id ||
      ""
    ).trim();
  }

  return "";
}

function evidenceRecordIdFromStatus(status) {
  return status && (
    status.evidence_record_id ||
    status.agreement_id ||
    status.agreement_signature_id ||
    status.last_agreement_id ||
    ""
  );
}

function evidenceVisitLogIdFromStatus(status) {
  if (!status) return "";
  return String(
    status.evidence_visit_log_id ||
    status.visit_log_id ||
    status.visitor_log_id ||
    status.linked_visit_log_id ||
    (
      LINKED_COMPLIANCE_VISIT_SOURCE_TYPES.has(String(status.linked_source_type || "").trim().toLowerCase())
        ? status.linked_source_record_id
        : ""
    ) ||
    ""
  ).trim();
}

function evidenceSignedAtFromStatus(status) {
  return status && (
    status.evidence_signed_at ||
    status.last_signed_at ||
    status.signed_at ||
    status.inductor_signed_at ||
    ""
  );
}

function evidenceDocumentTitleFromStatus(status) {
  return status && (
    status.evidence_document_title ||
    status.agreement_title ||
    status.agreement_name ||
    ""
  );
}

function evidenceDocumentVersionFromStatus(status) {
  return status && (
    status.evidence_document_version ||
    status.agreement_version_number ||
    status.active_agreement_version_number ||
    status.version_number ||
    ""
  );
}

function linkedEvidenceStatusForSource(source, status) {
  return {
    ...status,
    compliance_status: "valid",
    status: "valid",
    already_valid: true,
    can_select: false,
    selected_by_default: false,
    locked_selected: false,
    evidence_source: "confirmed_identity_link",
    evidence_source_label: "Confirmed identity link",
    identity_link_reference: source.link_reference || "",
    identity_link_id: source.identity_link_id || "",
    identity_link_reference_label: source.link_reference || source.canonical_label || "Confirmed identity link",
    linked_source_label: source.linked_source_label || source.canonical_label || "",
    linked_source_type: source.linked_source_type || "",
    linked_source_record_id: source.linked_source_record_id || "",
    evidence_visit_log_id: linkedVisitLogId(source) || status.visit_log_id || status.visitor_log_id || "",
    evidence_record_id: evidenceRecordIdFromStatus(status) ||
      (LINKED_COMPLIANCE_EVIDENCE_SOURCE_TYPES.has(linkedSourceType(source)) ? source.linked_source_record_id : ""),
    evidence_signed_at: evidenceSignedAtFromStatus(status),
    evidence_document_title: evidenceDocumentTitleFromStatus(status),
    evidence_document_version: evidenceDocumentVersionFromStatus(status),
    explanation: "Valid evidence found via confirmed identity link.",
    reason: "Valid evidence found via confirmed identity link."
  };
}

async function getNativeAgreementStatusesForVisitDirect(visitId) {
  const result = await supabaseClient.rpc("get_visit_agreement_status_all", {
    p_visit_log_id: visitId
  });
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadDocumentComplianceIdentityLinkSources(visitId) {
  const result = await supabaseClient.rpc("list_document_compliance_identity_link_sources", {
    p_source_type: "visit_log",
    p_source_record_id: String(visitId)
  });
  if (result.error) throw result.error;
  return result.data || [];
}

async function augmentNativeStatusesWithLinkedEvidence(visitId, statuses) {
  const directStatuses = await restrictDirectEvidenceToCurrentVisit(visitId, statuses || []);
  if (!useIdentityLinksForDocumentCompliance() || !visitId || !directStatuses.length) return directStatuses;

  let sources = [];
  try {
    sources = await loadDocumentComplianceIdentityLinkSources(visitId);
  } catch (err) {
    console.warn("Could not load linked identity sources for document compliance. Falling back to direct evidence.", err);
    return directStatuses;
  }

  if (!sources.length) return directStatuses;

  const linkedStatusByType = new Map();
  let checkedLinkedVisitCount = 0;
  const checkedVisitIds = new Set();

  for (const source of sources) {
    const linkedVisitId = linkedVisitLogId(source);
    if (!linkedVisitId || checkedVisitIds.has(linkedVisitId)) continue;
    checkedVisitIds.add(linkedVisitId);
    checkedLinkedVisitCount += 1;

    try {
      const linkedStatuses = await getNativeAgreementStatusesForVisitDirect(linkedVisitId);
      for (const linkedStatus of linkedStatuses || []) {
        const linkedEvidenceMatchesVisit = await directEvidenceRecordMatchesVisit(linkedStatus, linkedVisitId);
        if (!linkedEvidenceMatchesVisit || !linkedStatus.agreement_type_id) continue;
        if (!linkedStatusByType.has(linkedStatus.agreement_type_id)) {
          linkedStatusByType.set(linkedStatus.agreement_type_id, linkedEvidenceStatusForSource(source, linkedStatus));
        }
      }
    } catch (err) {
      console.warn("Could not check linked visit evidence for document compliance. Continuing with direct evidence.", err);
    }
  }

  return directStatuses.map(status => {
    if (directEvidenceIsValid(status)) {
      return {
        ...status,
        evidence_source: status.evidence_source || "direct",
        evidence_source_label: status.evidence_source_label || "Direct evidence"
      };
    }

    const linked = linkedStatusByType.get(status.agreement_type_id);
    if (linked) {
      return {
        ...status,
        ...linked,
        direct_compliance_status: status.status || "missing",
        direct_reason: status.reason || ""
      };
    }

    return {
      ...status,
      evidence_source: status.evidence_source || "none",
      identity_link_source_count: sources.length,
      identity_link_checked_visit_count: checkedLinkedVisitCount,
      identity_link_lookup_note: checkedLinkedVisitCount > 0
        ? "Confirmed identity links exist, but no valid document evidence was found through them."
        : "Confirmed identity links exist, but none exposes a supported visit evidence source."
    };
  });
}

function syncNativeDocumentReviewRequirement() {
  const required = nativeRequiresDocumentReviewCompletion();
  nativeDocumentReviewReachedEnd = !required;
  setVisible("documentSignoffNativeReviewCompleteButton", required);
  setText(
    "documentSignoffNativeReviewStatus",
    required
      ? "Please scroll to the end of the document before signing."
      : ""
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
  const statuses = await getNativeAgreementStatusesForVisitDirect(visitId);
  return augmentNativeStatusesWithLinkedEvidence(visitId, statuses);
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

function evidenceIdentityReviewSourceId(record) {
  return record && (record.id || record.agreement_id || record.agreement_signature_id);
}

function evidenceIdentityReviewLabel(record) {
  const subject = [record.visitor_name, record.company].filter(Boolean).join(" / ");
  return [
    "Document Evidence",
    record.agreement_name || record.agreement_title,
    subject
  ].filter(Boolean).join(" - ");
}

function evidenceIdentityReviewContext(record) {
  const label = evidenceIdentityReviewLabel(record);
  const sourceId = evidenceIdentityReviewSourceId(record);
  return {
    candidateType: "person",
    requestReason: "Document evidence requires identity review.",
    sourceType: "document_evidence",
    sourceRecordId: sourceId,
    sourceLabel: label,
    sourceSummary: {
      result_label: label,
      visitor_name: record.visitor_name || null,
      company: record.company || null,
      document: record.agreement_name || record.agreement_title || null,
      version: record.agreement_version_number || null,
      signed_at: record.signed_at || null,
      visit_log_id: record.visit_log_id || record.visitor_log_id || null,
      evidence_type: evidenceType(record)
    },
    contextType: "document_signoff_evidence",
    contextRecordId: sourceId,
    contextSummary: {
      context_label: "Document Sign-off Evidence",
      result_label: label
    },
    metadata: {
      launched_from: "document_signoff_evidence_detail"
    }
  };
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
      { label: "Created", value: formatDateTime(record.created_at) },
      { label: "Updated", value: formatDateTime(record.updated_at) }
    ],
    advancedFields: [
      { label: "Evidence ID", value: record.id || record.agreement_id || record.agreement_signature_id },
      { label: "Document type ID", value: record.agreement_type_id },
      { label: "Document version ID", value: record.agreement_version_id },
      { label: "Visit record ID", value: record.visit_log_id || record.visitor_log_id }
    ],
    linkedIdentityContext: {
      sourceType: "document_evidence",
      sourceRecordId: evidenceIdentityReviewSourceId(record),
      sourceLabel: evidenceIdentityReviewLabel(record),
      complianceNote: true
    },
    contextActions: [
      {
        label: "View / Print Evidence",
        primary: true,
        allowed: () => true,
        handler: button => {
          if (documentSignoffDetailsPanelController) {
            documentSignoffDetailsPanelController.close({ restoreFocus: false });
          }
          window.dispatchEvent(new CustomEvent("oh:agreement-evidence-printout-requested", {
            detail: { record }
          }));
        }
      },
      {
        label: "Request Identity Review",
        allowed: () => canRequestIdentityReviewFromDocumentSignoffs() && !!evidenceIdentityReviewSourceId(record),
        handler: button => {
          if (documentSignoffDetailsPanelController) {
            documentSignoffDetailsPanelController.close({ restoreFocus: false });
          }
          openIdentityReviewRequestFromContext(evidenceIdentityReviewContext(record), button);
        }
      }
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

function evidenceRecordMatches(record, sourceRecordId) {
  const id = String(sourceRecordId || "").trim();
  if (!id || !record) return false;
  return [
    record.id,
    record.agreement_id,
    record.agreement_signature_id,
    record.document_evidence_id,
    record.evidence_id
  ].some(value => String(value || "").trim() === id);
}

function openFullEvidencePreview(record) {
  if (!record) return;
  window.dispatchEvent(new CustomEvent("oh:agreement-evidence-printout-requested", {
    detail: { record }
  }));
}

async function searchEvidenceRowsForWindow(days, filters) {
  const settings = filters || {};
  const result = await supabaseClient.rpc("search_visitor_agreements", {
    p_date_from: dateDaysAgo(days),
    p_date_to: todayDate(),
    p_visitor_name: null,
    p_company: null,
    p_agreement_version_id: settings.agreementVersionId || null,
    p_agreement_type_id: settings.agreementTypeId || null
  });
  if (result.error) throw result.error;
  return result.data || [];
}

async function findEvidenceRecordById(sourceRecordId) {
  const cached = (documentSignoffOverviewState.recentEvidence || [])
    .find(record => evidenceRecordMatches(record, sourceRecordId));
  if (cached) return cached;

  const searchWindows = [3650, 36500];
  for (const days of searchWindows) {
    const record = (await searchEvidenceRowsForWindow(days))
      .find(row => evidenceRecordMatches(row, sourceRecordId));
    if (record) return record;
  }
  return null;
}

function evidenceRecordMatchesStatus(record, status, fallbackVisitId) {
  if (!record || !status) return false;
  const visitId = evidenceVisitLogIdFromStatus(status) || String(fallbackVisitId || "").trim();
  const typeId = String(status.agreement_type_id || "").trim();
  const versionId = String(status.agreement_version_id || status.active_agreement_version_id || "").trim();
  const signedAt = String(evidenceSignedAtFromStatus(status) || "").trim();

  if (visitId) {
    const recordVisitId = String(record.visit_log_id || record.visitor_log_id || "").trim();
    if (recordVisitId && recordVisitId !== visitId) return false;
  }

  if (versionId) {
    const recordVersionId = String(record.agreement_version_id || "").trim();
    if (recordVersionId && recordVersionId !== versionId) return false;
  } else if (typeId) {
    const recordTypeId = String(record.agreement_type_id || "").trim();
    if (recordTypeId && recordTypeId !== typeId) return false;
  }

  if (!visitId && !typeId && !versionId) return false;
  if (!signedAt) return true;
  const recordSignedAt = String(record.signed_at || "").trim();
  if (!recordSignedAt) return true;
  return Date.parse(recordSignedAt) === Date.parse(signedAt) ||
    recordSignedAt.slice(0, 19) === signedAt.slice(0, 19);
}

async function findEvidenceRecordForStatus(status, fallbackVisitId) {
  const evidenceId = evidenceRecordIdFromStatus(status);
  if (evidenceId) {
    const byId = await findEvidenceRecordById(evidenceId);
    if (byId) return byId;
  }

  const filters = {
    agreementVersionId: status && (status.agreement_version_id || status.active_agreement_version_id),
    agreementTypeId: status && status.agreement_type_id
  };
  const searchWindows = [3650, 36500];
  for (const days of searchWindows) {
    const record = (await searchEvidenceRowsForWindow(days, filters))
      .find(row => evidenceRecordMatchesStatus(row, status, fallbackVisitId));
    if (record) return record;
  }
  return null;
}

export async function openDocumentSignoffEvidenceById(sourceRecordId, trigger) {
  if (!canViewDocumentSignoffs()) {
    showToast("Evidence unavailable", "You do not have permission to view document sign-off evidence.", "error");
    return;
  }
  const id = String(sourceRecordId || "").trim();
  if (!id) return;
  try {
    const record = await findEvidenceRecordById(id);
    if (!record) {
      showToast("Evidence not found", "No agreement evidence record was found for that reference.", "error");
      return;
    }
    openFullEvidencePreview(record);
  } catch (error) {
    showToast(
      "Evidence unavailable",
      error && error.message ? error.message : "The evidence record could not be opened.",
      "error"
    );
  }
}

async function openDocumentSignoffEvidencePreviewById(sourceRecordId, trigger) {
  await openDocumentSignoffEvidenceById(sourceRecordId, trigger);
}

async function openDocumentSignoffEvidencePreviewForStatus(status, fallbackVisitId, trigger) {
  if (!canViewDocumentSignoffs()) {
    showToast("Evidence unavailable", "You do not have permission to view document sign-off evidence.", "error");
    return;
  }
  if (!status) {
    showToast("Evidence unavailable", "Evidence context is unavailable for this agreement.", "error");
    return;
  }
  try {
    const record = await findEvidenceRecordForStatus(status, fallbackVisitId);
    if (!record) {
      showToast(
        "Evidence not found",
        "No agreement evidence record matched the linked compliance result.",
        "error"
      );
      return;
    }
    openFullEvidencePreview(record);
  } catch (error) {
    showToast(
      "Evidence unavailable",
      error && error.message ? error.message : "The agreement evidence could not be opened.",
      "error"
    );
  }
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

function nativeVisitRowId(row) {
  return String(row && (row.visit_log_id || row.id) || "").trim();
}

function nativeAgreementTypeId(row) {
  return String(row && (row.agreement_type_id || row.id) || "").trim();
}

function nativeQueueKey(row) {
  const visitId = nativeVisitRowId(row);
  const typeId = nativeAgreementTypeId(row);
  return visitId && typeId ? visitId + "::" + typeId : "";
}

function activeRequiredNativeTypes() {
  return nativeActiveTypes().filter(type => type.default_required === true);
}

function nativeStatusMapByAgreementType(statuses) {
  const map = new Map();
  (statuses || []).forEach(status => {
    const typeId = nativeAgreementTypeId(status);
    if (typeId) map.set(typeId, status);
  });
  return map;
}

async function loadCurrentVisitRowsForNativeQueue() {
  const result = await supabaseClient
    .from("visit_log")
    .select("id, visitor_name, company, sign_in_time, sign_out_time")
    .not("sign_in_time", "is", null)
    .is("sign_out_time", null)
    .order("sign_in_time", { ascending: true });
  if (result.error) throw result.error;
  return result.data || [];
}

function nativePendingRowFromVisitStatus(visit, type, status) {
  const activeVersion = status && (status.active_agreement_version_id || status.agreement_version_id)
    ? null
    : activeVersionForType(type);
  return {
    visit_log_id: nativeVisitRowId(visit),
    visitor_name: visit.visitor_name,
    company: visit.company,
    sign_in_time: visit.sign_in_time,
    agreement_type_id: nativeAgreementTypeId(type),
    agreement_name: status && status.agreement_name || type.agreement_name,
    agreement_title: status && status.agreement_title || type.agreement_title,
    active_agreement_version_id: status && status.active_agreement_version_id || (activeVersion && activeVersion.id),
    active_agreement_version_number: status && status.active_agreement_version_number || (activeVersion && activeVersion.version_number),
    signature_required: status && status.signature_required,
    reason: status && status.reason || "Required sign-off missing",
    signoff_queue_source: "active_visit_status"
  };
}

async function supplementNativeSignoffCandidatesFromCurrentVisits(rows) {
  const candidates = Array.isArray(rows) ? rows : [];
  try {
    await loadNativeAgreementTypesIfNeeded();
  } catch (error) {
    console.warn("Could not load agreement types for sign-off queue supplement.", error);
    return candidates;
  }
  const requiredTypes = activeRequiredNativeTypes();
  if (!requiredTypes.length) return candidates;

  let currentVisits = [];
  try {
    currentVisits = await loadCurrentVisitRowsForNativeQueue();
  } catch (error) {
    console.warn("Could not load current visitors for sign-off queue supplement.", error);
    return candidates;
  }

  if (!currentVisits.length) return candidates;

  const merged = candidates.slice();
  const existing = new Set(merged.map(nativeQueueKey).filter(Boolean));

  for (const visit of currentVisits) {
    const visitId = nativeVisitRowId(visit);
    if (!visitId) continue;

    let statuses = [];
    try {
      statuses = await getNativeAgreementStatusesForVisit(visitId);
    } catch (error) {
      console.warn("Could not evaluate current visitor agreement status for sign-off queue.", error);
      continue;
    }

    const statusMap = nativeStatusMapByAgreementType(statuses);
    requiredTypes.forEach(type => {
      const typeId = nativeAgreementTypeId(type);
      if (!typeId) return;
      const status = statusMap.get(typeId);
      if (directEvidenceIsValid(status)) return;

      const pendingRow = nativePendingRowFromVisitStatus(visit, type, status);
      const key = nativeQueueKey(pendingRow);
      if (!key || existing.has(key)) return;
      existing.add(key);
      merged.push(pendingRow);
    });
  }

  return merged;
}

function signoffIdentityReviewLabel(visit) {
  const subject = [visit.visitor_name, visit.company].filter(Boolean).join(" / ");
  const pending = (visit.required_requirements || []).map(row => row.agreement_name).filter(Boolean).join(", ");
  return [
    "Visitor Requiring Sign-off",
    subject,
    pending ? pending + " pending" : "Document/induction pending"
  ].filter(Boolean).join(" - ");
}

function signoffIdentityReviewContext(visit) {
  const visitId = visit && (visit.visit_log_id || visit.id);
  const label = signoffIdentityReviewLabel(visit || {});
  return {
    candidateType: "person",
    requestReason: "Visitor requiring sign-off may need identity review.",
    sourceType: "visit_log",
    sourceRecordId: visitId,
    sourceLabel: label,
    sourceSummary: {
      result_label: label,
      visitor_name: visit.visitor_name || null,
      company: visit.company || null,
      sign_in_time: visit.sign_in_time || null,
      pending_agreements: (visit.required_requirements || []).map(row => row.agreement_name).filter(Boolean),
      visit_status: "signed_in"
    },
    contextType: "document_signoff_required_visitor",
    contextRecordId: visitId,
    contextSummary: {
      context_label: "Visitor Requiring Sign-off",
      result_label: label
    },
    metadata: {
      launched_from: "document_signoff_required_visitor"
    }
  };
}

function appendSignoffIdentityReviewAction(container, visit) {
  const visitId = visit && (visit.visit_log_id || visit.id);
  if (!container || !canRequestIdentityReviewFromDocumentSignoffs()) return;
  const request = document.createElement("button");
  request.type = "button";
  request.className = "secondary";
  request.textContent = "Request Identity Review";
  request.disabled = !visitId;
  if (!visitId) {
    request.title = "Exact visit-log context is not available for this sign-off item.";
  } else {
    request.addEventListener("click", event => {
      openIdentityReviewRequestFromContext(signoffIdentityReviewContext(visit), event.currentTarget);
    });
  }
  container.appendChild(request);
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
    appendSignoffIdentityReviewAction(actions, visit);

    card.append(body, actions);
    box.appendChild(card);
  });
}

async function filterNativeSignoffCandidatesForLinkedCompliance(rows) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (!useIdentityLinksForDocumentCompliance() || !candidates.length) return candidates;

  const statusesByVisit = new Map();
  const filtered = [];
  for (const row of candidates) {
    const visitId = row.visit_log_id || row.id;
    const agreementTypeId = row.agreement_type_id;
    if (!visitId || !agreementTypeId) {
      filtered.push(row);
      continue;
    }

    if (!statusesByVisit.has(visitId)) {
      try {
        const statuses = await getNativeAgreementStatusesForVisit(visitId);
        const statusMap = new Map();
        (statuses || []).forEach(status => {
          if (status.agreement_type_id) statusMap.set(status.agreement_type_id, status);
        });
        statusesByVisit.set(visitId, statusMap);
      } catch (error) {
        console.warn("Could not apply linked identity compliance filtering to sign-off queue.", error);
        statusesByVisit.set(visitId, null);
      }
    }

    const statusMap = statusesByVisit.get(visitId);
    if (!statusMap) {
      filtered.push(row);
      continue;
    }
    const status = statusMap.get(agreementTypeId);
    if (!directEvidenceIsValid(status)) filtered.push(row);
  }

  return filtered;
}

async function loadNativeSignoffCandidates(manual) {
  if (!canUseNativeVisitorSignoff()) {
    showToast("You do not have permission", "Native visitor sign-off requires agreement or visitor sign-off access.", "error");
    return;
  }
  // TODO: Future notification milestone - notify compliance users/groups when sign-off action is required.
  const box = $("documentSignoffNativeResults");
  if (box) box.textContent = "Loading visitors requiring sign-off...";
  setNativeStatus("", "");
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
  const rows = result.data || [];
  const supplementedRows = await supplementNativeSignoffCandidatesFromCurrentVisits(rows);
  const displayRows = await filterNativeSignoffCandidatesForLinkedCompliance(supplementedRows);
  renderNativeSignoffCandidates(displayRows);
  setNativeStatus("", "");
}

function nativeAgreementStateBadge(status, type) {
  if (status.evidence_source === "confirmed_identity_link") return { label: "Valid via identity link", className: "status-in" };
  if (status.already_valid === true) return { label: "Already signed", className: "status-in" };
  if (status.status === "outdated") return { label: "Outdated", className: "status-no-show" };
  if (status.status === "expired") return { label: "Expired", className: "status-no-show" };
  if (status.status === "missing") return { label: "Missing", className: "status-overdue" };
  if (!status.active_agreement_version_id) return { label: "Missing active version", className: "status-inactive" };
  if (type.default_required === true) return { label: "Required", className: "status-overdue" };
  return { label: "Optional", className: "" };
}

function linkedEvidenceNoteText(status) {
  const source = [
    status.identity_link_reference ? "Link " + status.identity_link_reference : "Confirmed identity link",
    status.linked_source_label || status.linked_source_type
  ].filter(Boolean).join(" - ");
  const evidence = [
    status.evidence_document_title,
    status.evidence_document_version ? "version " + status.evidence_document_version : "",
    status.evidence_signed_at ? "signed " + formatDateTime(status.evidence_signed_at) : ""
  ].filter(Boolean).join(", ");
  return "Valid evidence found via confirmed identity link. " +
    [source, evidence].filter(Boolean).join(" | ");
}

function createLinkedIdentityContextButton(status) {
  if (!nativeSignoffCurrentVisit) return;
  const visitId = nativeSignoffCurrentVisit.visit_log_id || nativeSignoffCurrentVisit.id;
  if (!visitId) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = "View Linked Identity Context";
  button.addEventListener("click", event => {
    closeNativeSignoffWorkflow({
      restoreFocus: false,
      reset: false,
      reason: "open_linked_identity_context"
    });
    openLinkedIdentityContextDetails({
      sourceType: "visit_log",
      sourceRecordId: String(visitId),
      sourceLabel: nativeSignoffCurrentVisit.visitor_name || "Visit log",
      complianceNote: true,
      highlightedIdentityLinkId: status.identity_link_id || null
    }, event.currentTarget);
  });
  return button;
}

function appendLinkedIdentityContextAction(row, status) {
  const button = createLinkedIdentityContextButton(status);
  if (!button) return;
  const actions = document.createElement("div");
  actions.className = "document-signoff-linked-evidence-actions";
  actions.appendChild(button);
  row.appendChild(actions);
}

function signoffEvidenceActionRecordId(status) {
  return String(
    status && (
      status.evidence_record_id ||
      evidenceRecordIdFromStatus(status) ||
      ""
    ) || ""
  ).trim();
}

function hasSignoffEvidenceLookupContext(status) {
  if (!status) return false;
  if (signoffEvidenceActionRecordId(status)) return true;
  return !!(
    (evidenceVisitLogIdFromStatus(status) ||
      (nativeSignoffCurrentVisit && (nativeSignoffCurrentVisit.visit_log_id || nativeSignoffCurrentVisit.id))) &&
    (status.agreement_type_id || status.agreement_version_id || status.active_agreement_version_id)
  );
}

function appendSignoffEvidenceActions(row, status, options) {
  const settings = options || {};
  const actions = document.createElement("div");
  actions.className = "document-signoff-linked-evidence-actions";
  const canLookupEvidence = hasSignoffEvidenceLookupContext(status);
  if (canLookupEvidence) {
    const viewEvidence = document.createElement("button");
    viewEvidence.type = "button";
    viewEvidence.textContent = settings.linked ? "View Sign-off Evidence" : "View Evidence";
    viewEvidence.addEventListener("click", async event => {
      const fallbackVisitId = nativeSignoffCurrentVisit && (nativeSignoffCurrentVisit.visit_log_id || nativeSignoffCurrentVisit.id);
      closeNativeSignoffWorkflow({
        restoreFocus: false,
        reset: false,
        reason: settings.linked ? "open_linked_signoff_evidence" : "open_signoff_evidence"
      });
      await openDocumentSignoffEvidencePreviewForStatus(status, fallbackVisitId, event.currentTarget);
    });
    actions.appendChild(viewEvidence);
  }
  if (!canLookupEvidence) {
    const unavailable = document.createElement("span");
    unavailable.className = "document-signoff-linked-evidence-unavailable";
    unavailable.textContent = "Evidence context unavailable.";
    actions.appendChild(unavailable);
  }
  const linkedContext = settings.linked ? createLinkedIdentityContextButton(status) : null;
  if (linkedContext) actions.appendChild(linkedContext);
  row.appendChild(actions);
}

function updateNativeSelectionSummary() {
  const checkboxes = nativeAgreementCheckboxes();
  const selected = checkboxes.filter(checkbox => checkbox.checked).length;
  const selectable = checkboxes.filter(checkbox => !checkbox.disabled).length;
  const locked = checkboxes.filter(checkbox => checkbox.checked && checkbox.disabled && checkbox.dataset.lockedSelected === "true").length;
  const selectedSignable = nativeSelectedSignableCheckboxes().length;
  const signable = nativeSignableAgreementCount();
  const parts = [
    selected + " selected",
    selectable + " optional/selectable",
    locked ? locked + " required locked" : "",
    signable ? signable + " signable" : "No signable agreements"
  ].filter(Boolean);
  setText("documentSignoffNativeSelectionSummary", parts.join(" | "));
  const startButton = $("documentSignoffNativeStartButton");
  if (startButton) {
    startButton.disabled = signable === 0;
  }
  updateDocumentSignoffDebug({
    selectedAgreementCount: selectedSignable,
    signableAgreementCount: signable,
    selectionContinueButtonDisabled: !!(startButton && startButton.disabled)
  });
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
    const startButton = $("documentSignoffNativeStartButton");
    if (startButton) startButton.disabled = true;
    setNativePanelStatus("No active agreement types are available. Legacy sign-off remains available.", "info");
    updateDocumentSignoffDebug({
      selectedAgreementCount: 0,
      signableAgreementCount: 0,
      selectionContinueButtonDisabled: true
    });
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
    if (status.evidence_source === "confirmed_identity_link") {
      const sourceNote = document.createElement("p");
      sourceNote.className = "document-signoff-linked-evidence-note";
      sourceNote.textContent = linkedEvidenceNoteText(status);
      row.appendChild(sourceNote);
      appendSignoffEvidenceActions(row, status, { linked: true });
    } else if (alreadyValid || evidenceRecordIdFromStatus(status)) {
      appendSignoffEvidenceActions(row, status, { linked: false });
    } else if (status.identity_link_lookup_note) {
      const sourceNote = document.createElement("p");
      sourceNote.className = "document-signoff-linked-evidence-note muted";
      sourceNote.textContent = status.identity_link_lookup_note;
      row.appendChild(sourceNote);
    }
    list.appendChild(row);
  });
  updateNativeSelectionSummary();
  if (nativeSignableAgreementCount() === 0) {
    setNativePanelStatus("No signable agreements are available for this visitor. Legacy sign-off remains available.", "info");
  }
}

async function openNativeSignoffPanel(visit, additionalOnly, trigger) {
  if (!canUseNativeVisitorSignoff()) return;
  nativeSignoffCurrentVisit = visit;
  nativeSignoffCurrentRequirement = null;
  nativeSignoffQueue = [];
  nativeSignoffQueueTotal = 0;
  nativeSignoffAdditionalOnly = !!additionalOnly;
  setVisible("documentSignoffNativeSelectionStep", true);
  setVisible("documentSignoffNativeReviewStep", false);
  setVisible("documentSignoffNativeSignatureStep", false);
  setVisible("documentSignoffNativeStartButton", true);
  setVisible("documentSignoffNativeSaveButton", false);
  setVisible("documentSignoffNativeBackButton", false);
  if ($("documentSignoffNativeStartButton")) $("documentSignoffNativeStartButton").disabled = true;
  setNativeWorkflowStep("selection");
  setText("documentSignoffNativePanelEyebrow", "Visitor Document Sign-off");
  setText("documentSignoffNativePanelTitle", additionalOnly ? "Sign Optional Agreement" : "Review / Sign Agreements");
  setText("documentSignoffNativeWizardMeta", formatWizardVisitorMeta(visit));
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
    if (nativeSignableAgreementCount() > 0) {
      setNativePanelStatus("", "");
    }
  } catch (err) {
    renderEmptyState("documentSignoffNativeAgreementList", {
      title: "Native sign-off unavailable",
      description: "This sign-off workflow is still completed in Legacy VMS."
    });
    setNativePanelStatus(err.message || "Agreement status could not be loaded.", "error");
  }
}

async function startNativeSignoffQueue() {
  updateDocumentSignoffDebug({ lastActionClicked: "next_review_document", lastError: "" });
  clearNativeValidationHighlights();
  if (!nativeSignoffCurrentVisit) {
    showNativeValidation("No visitor visit is selected.", "documentSignoffNativeVisitorMeta");
    return;
  }
  const selectedBoxes = nativeSelectedSignableCheckboxes();
  if (!selectedBoxes.length) {
    showNativeValidation("No signable agreement is selected. Select an optional agreement or continue with required agreements only.", "documentSignoffNativeAgreementList");
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

async function backToNativeAgreementSelection() {
  updateDocumentSignoffDebug({ lastActionClicked: "back_to_selection", lastError: "" });
  if (nativeSignoffCurrentVisit) {
    await openNativeSignoffPanel(nativeSignoffCurrentVisit, nativeSignoffAdditionalOnly, $("documentSignoffNativeBackButton"));
    updateDocumentSignoffDebug({ lastActionClicked: "back_to_selection", currentStep: "selection" });
    return;
  }
  nativeSignoffCurrentRequirement = null;
  nativeSignoffQueue = [];
  nativeSignoffQueueTotal = 0;
  setVisible("documentSignoffNativeSelectionStep", true);
  setVisible("documentSignoffNativeReviewStep", false);
  setVisible("documentSignoffNativeSignatureStep", false);
  setVisible("documentSignoffNativeStartButton", true);
  setVisible("documentSignoffNativeSaveButton", false);
  setVisible("documentSignoffNativeBackButton", false);
  setNativeWorkflowStep("selection");
}

async function renderNativeSigningStep(visit, requirement) {
  setNativeWorkflowStep("review");
  if ($("documentSignoffNativeStartButton")) $("documentSignoffNativeStartButton").disabled = false;
  updateDocumentSignoffDebug({
    documentStepOpened: false,
    lastActionClicked: "review_step_opened",
    lastError: ""
  });
  setText("documentSignoffNativePanelEyebrow", "Visitor Document Sign-off");
  setText("documentSignoffNativePanelTitle", textOrDash(requirement.agreement_name));
  setText("documentSignoffNativeWizardMeta", formatWizardVisitorMeta(visit));
  const completed = nativeSignoffQueueTotal - nativeSignoffQueue.length;
  const progress = "Document " + completed + " of " + nativeSignoffQueueTotal;
  setText("documentSignoffNativeQueueMeta", progress);
  setText("documentSignoffNativeSignatureQueueMeta", progress);
  setText("documentSignoffNativeAcceptedText", String(settingValue(
    "agreement_acceptance_text",
    "I confirm I have read and understood this document."
  )));
  if ($("documentSignoffNativeAcceptedCheck")) $("documentSignoffNativeAcceptedCheck").checked = false;
  setVisible("documentSignoffNativeSignatureBox", requirement.signature_required !== false);
  clearNativeVisitorSignature();
  clearNativeInductorSignature();
  clearNativeValidationHighlights();
  syncNativeDocumentReviewRequirement();
  syncNativeInductorPanel(nativeInductorEnabledForCurrentStep());
  const meta = [
    ["Agreement", requirement.agreement_title || requirement.agreement_name],
    ["Version", requirement.active_agreement_version_number],
    ["Requirement", requirement.reason],
    ["Visitor", visit.visitor_name],
    ["Company", visit.company]
  ];
  renderMetaList("documentSignoffNativeAgreementMeta", meta);
  renderMetaList("documentSignoffNativeSignatureMeta", meta);
  setNativePanelStatus("Loading agreement document...", "info");
  try {
    const version = await getNativeAgreementVersion(requirement.active_agreement_version_id);
    if ($("documentSignoffNativePdfFrame")) {
      $("documentSignoffNativePdfFrame").src = version && version.pdf_url ? version.pdf_url : "about:blank";
    }
    setNativePanelStatus("Ready for visitor sign-off.", "success");
  } catch (err) {
    if ($("documentSignoffNativePdfFrame")) $("documentSignoffNativePdfFrame").src = "about:blank";
    setText("documentSignoffNativeReviewStatus", "Document preview could not be loaded. Continue only if the document has been reviewed elsewhere.");
    setNativePanelStatus("Agreement document could not be previewed. The sign-off can continue if the document has been reviewed elsewhere.", "error");
  }
  setTimeout(() => {
    resizeSignatureCanvas("documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState);
    resizeSignatureCanvas("documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState);
    focusNativeElement($("documentSignoffNativeReviewStep"));
  }, 60);
}

function continueToNativeSignatureStep() {
  updateDocumentSignoffDebug({ lastActionClicked: "next_sign", lastError: "" });
  clearNativeValidationHighlights();
  if (!nativeSignoffCurrentVisit || !nativeSignoffCurrentRequirement) {
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
  setNativeWorkflowStep("signature");
  setNativePanelStatus("Ready for signature capture.", "success");
  updateDocumentSignoffDebug({
    documentStepOpened: true,
    lastActionClicked: "signature_step_opened",
    lastError: ""
  });
  setTimeout(() => {
    resizeSignatureCanvas("documentSignoffNativeSignatureCanvas", nativeVisitorSignatureState);
    resizeSignatureCanvas("documentSignoffNativeInductorSignatureCanvas", nativeInductorSignatureState);
    focusNativeElement($("documentSignoffNativeSignatureCanvas") || $("documentSignoffNativeSaveButton"));
  }, 60);
}

function backToNativeDocumentReview() {
  updateDocumentSignoffDebug({ lastActionClicked: "back_to_document", lastError: "" });
  clearNativeValidationHighlights();
  setNativeWorkflowStep("review");
  if ($("documentSignoffNativeStartButton")) $("documentSignoffNativeStartButton").disabled = false;
  setNativePanelStatus("Document review restored.", "info");
  setTimeout(() => focusNativeElement($("documentSignoffNativeReviewStep")), 60);
}

function handleNativeWizardPrimaryAction() {
  if (documentSignoffNativeCurrentStep === "review") {
    continueToNativeSignatureStep();
    return;
  }
  startNativeSignoffQueue();
}

function handleNativeWizardBackAction() {
  if (documentSignoffNativeCurrentStep === "signature") {
    backToNativeDocumentReview();
    return;
  }
  backToNativeAgreementSelection();
}

async function saveNativeVisitorAgreement() {
  updateDocumentSignoffDebug({ lastActionClicked: "save_agreement", lastError: "" });
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
  // Signature evidence currently stores the full captured canvas image; future polish can safely normalise/crop blank space.
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
      showNativeValidation("This agreement is no longer available for signing. Refresh and try again.", "documentSignoffNativeSignatureStep");
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
    appendActionButtonsCell(row, [
      {
        label: "View Details",
        handler: button => openEvidenceDetails(record, button)
      },
      {
        label: "View / Print Evidence",
        handler: () => openFullEvidencePreview(record)
      }
    ]);
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
    setStatus("", "");
  }
}

export async function loadDocumentSignoffOverview(options) {
  if (!canViewDocumentSignoffs()) return;
  const settings = options || {};
  const sequence = ++documentSignoffLoadSequence;
  setMetricPlaceholders("...");
  setStatus("", "");

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
  setVisible("documentSignoffNativePanelLegacyButton", canUseNative);
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
  let overlayRoot = $("documentSignoffOverlayRoot");
  if (!overlayRoot) {
    overlayRoot = document.createElement("div");
    overlayRoot.id = "documentSignoffOverlayRoot";
    overlayRoot.className = "document-signoff-overlay-root";
    document.body.appendChild(overlayRoot);
  } else if (overlayRoot.parentElement !== document.body) {
    document.body.appendChild(overlayRoot);
  }
  if (backdrop && backdrop.parentElement !== overlayRoot) {
    overlayRoot.appendChild(backdrop);
  }
  if (backdrop && backdrop.dataset.nativeSignoffInitialised !== "true") {
    backdrop.dataset.nativeSignoffInitialised = "true";
    backdrop.setAttribute("aria-hidden", "true");
    $("documentSignoffNativePanel").setAttribute("aria-hidden", "true");
    backdrop.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeNativeSignoffWorkflow({ reason: "backdrop" });
    });
  }
  clearNativeSignoffPanel();
  updateDocumentSignoffDebug({ overlayOpen: false, currentStep: "selection" });
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
      updateDocumentSignoffDebug({ lastActionClicked: "open_legacy_signoff", lastError: "" });
      guardedLegacyOpen(
        "document-signoffs-signoff",
        canOpenLegacySignoff,
        "Visitor agreement sign-off requires visitor sign-in or history access."
      );
    });
  }
  if ($("documentSignoffNativePanelClose")) {
    $("documentSignoffNativePanelClose").addEventListener("click", () => {
      updateDocumentSignoffDebug({ lastActionClicked: "close", lastError: "" });
      closeNativeSignoffWorkflow({ reason: "close" });
    });
  }
  if ($("documentSignoffNativeCancelButton")) {
    $("documentSignoffNativeCancelButton").addEventListener("click", () => {
      updateDocumentSignoffDebug({ lastActionClicked: "cancel", lastError: "" });
      closeNativeSignoffWorkflow({ reason: "cancel" });
    });
  }
  if ($("documentSignoffNativeStartButton")) {
    $("documentSignoffNativeStartButton").addEventListener("click", handleNativeWizardPrimaryAction);
  }
  if ($("documentSignoffNativeBackButton")) {
    $("documentSignoffNativeBackButton").addEventListener("click", handleNativeWizardBackAction);
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
      updateDocumentSignoffDebug({ documentReviewReachedEnd: true, lastActionClicked: "confirm_document_reviewed" });
      showToast("Document review confirmed", "You can now complete the visitor sign-off.", "success");
    });
  }
  if ($("documentSignoffNativeAcceptedCheck")) {
    $("documentSignoffNativeAcceptedCheck").addEventListener("change", () => {
      updateDocumentSignoffDebug({
        confirmationChecked: $("documentSignoffNativeAcceptedCheck").checked,
        lastActionClicked: "confirmation_changed"
      });
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
