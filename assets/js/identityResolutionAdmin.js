import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { createSidePanelController, renderEmptyState, requestPlatformConfirmation } from "./platformUi.js";
import { refreshSectionNavigator, registerModuleSections } from "./sectionNavigation.js";
import { showAdministrationWorkspace } from "./shell.js";
import { AppState } from "./state.js";
import {
  canonicalIdentitySourceType,
  enrichIdentityLinkRowsForDisplay,
  friendlyIdentitySourceType,
  getIdentityLinkDetailRows
} from "./identityContext.js";

const IDENTITY_VIEW_CAPABILITIES = [
  "identity_resolution.view",
  "identity_resolution.request",
  "identity_resolution.manage",
  "module_configuration.manage",
  "privacy.case.view",
  "privacy.case.manage",
  "privacy.manage",
  "gdpr.manage"
];

const IDENTITY_RECORD_VIEW_CAPABILITIES = [
  "identity_resolution.view",
  "identity_resolution.manage",
  "module_configuration.manage",
  "privacy.case.view",
  "privacy.case.manage",
  "privacy.manage",
  "gdpr.manage"
];

const IDENTITY_MANAGE_CAPABILITIES = [
  "identity_resolution.manage",
  "module_configuration.manage",
  "privacy.case.manage",
  "privacy.manage",
  "gdpr.manage"
];

const IDENTITY_REQUEST_CAPABILITIES = [
  "identity_resolution.request",
  "identity_resolution.manage",
  "privacy.case.manage",
  "privacy.manage",
  "gdpr.manage",
  "module_configuration.manage",
  "settings.edit"
];

const CANDIDATE_STATUSES = ["pending", "confirmed", "rejected", "deferred", "ignored"];
const REQUEST_STATUSES = ["pending", "in_review", "candidate_created", "closed", "cancelled"];
const CANDIDATE_TYPES = ["person", "organisation", "vehicle", "email", "other"];
const SOURCE_AREA_LABELS = {
  privacy_cases: "Privacy Case",
  privacy_case: "Privacy Case",
  visitor_history: "Visitor History",
  planned_visits: "Planned Visit",
  planned_visit: "Planned Visit",
  visit_log: "Visit Log / Visitor History",
  document_evidence: "Document Evidence",
  agreement_evidence: "Agreement Evidence",
  document_signoff_evidence: "Document Sign-off Evidence",
  audit_events: "Audit Event",
  manual: "Manual / Other",
  other: "Manual / Other"
};

let identityResolutionInitialised = false;
let identityReviewRequests = [];
let identityOverviewRequests = [];
let identityCandidates = [];
let identityOverviewCandidates = [];
let identityLinks = [];
let identityOverviewLinks = [];
let identityDecisions = [];
let selectedCandidate = null;
let selectedLink = null;
let detailPanelController = null;
let candidatePanelController = null;
let requestPanelController = null;
let decisionPanelController = null;

function hasActiveStaffUser() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

function canViewIdentityResolution() {
  return hasActiveStaffUser() && hasAnyCapability(IDENTITY_VIEW_CAPABILITIES);
}

function canViewIdentityResolutionRecords() {
  return hasActiveStaffUser() && hasAnyCapability(IDENTITY_RECORD_VIEW_CAPABILITIES);
}

function canManageIdentityResolution() {
  return hasActiveStaffUser() && hasAnyCapability(IDENTITY_MANAGE_CAPABILITIES);
}

function canRequestIdentityResolution() {
  return hasActiveStaffUser() && hasAnyCapability(IDENTITY_REQUEST_CAPABILITIES);
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

function requireIdentityResolutionAccess() {
  if (canViewIdentityResolution()) return true;
  showToast(
    "You do not have permission",
    "Identity Resolution requires identity, privacy or module configuration access.",
    "error"
  );
  return false;
}

function requireIdentityResolutionManageAccess() {
  if (canManageIdentityResolution()) return true;
  showToast(
    "You do not have permission",
    "Managing Identity Resolution requires identity resolution management access.",
    "error"
  );
  return false;
}

function requireIdentityResolutionRequestAccess() {
  if (canRequestIdentityResolution()) return true;
  showToast(
    "You do not have permission",
    "Requesting identity review requires identity review request access.",
    "error"
  );
  return false;
}

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function titleCase(value) {
  return textOrDash(value).replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function sourceAreaLabel(value) {
  const key = canonicalIdentitySourceType(value);
  return SOURCE_AREA_LABELS[key] || titleCase(key);
}

function displayReference(recordType, recordId) {
  const type = sourceAreaLabel(recordType);
  const id = textOrDash(recordId);
  return [type === "-" ? "" : type, id === "-" ? "" : id].filter(Boolean).join(" - ") || "-";
}

function summaryValue(summary, keys) {
  const source = summary && typeof summary === "object" ? summary : {};
  const values = Array.isArray(keys) ? keys : [keys];
  for (const key of values) {
    const value = source[key];
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return "";
}

function requestSourceLabel(request) {
  return request.source_label ||
    summaryValue(request.source_summary, ["display_label", "source_label", "result_label", "case_reference"]) ||
    displayReference(request.source_type, request.source_record_id);
}

function requestSuggestedLabel(request) {
  if (!request.suggested_match_type && !request.suggested_match_record_id && !request.suggested_match_label) return "-";
  return request.suggested_match_label ||
    summaryValue(request.suggested_match_summary, ["display_label", "source_label", "result_label"]) ||
    displayReference(request.suggested_match_type, request.suggested_match_record_id);
}

function requestContextLabel(request) {
  if (!request.context_type && !request.context_record_id) return "-";
  return summaryValue(request.context_summary, ["context_label", "display_label", "result_label", "case_reference"]) ||
    sourceAreaLabel(request.context_type);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? textOrDash(value) : date.toLocaleString();
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(number % 1 ? 2 : 0) + "%" : textOrDash(value);
}

function safeJson(value, fallback) {
  const source = String(value || "").trim();
  if (!source) return fallback || {};
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Enter valid JSON or leave the field blank.");
  }
}

function summaryText(value) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function fieldValue(id) {
  const element = $(id);
  return element ? element.value.trim() : "";
}

function sourceTypeValue(selectId, customId) {
  const selected = fieldValue(selectId);
  if (selected === "custom") return canonicalIdentitySourceType(fieldValue(customId));
  return canonicalIdentitySourceType(selected);
}

function normalisedSourceKey(sourceType, recordId) {
  return canonicalIdentitySourceType(sourceType) + "::" + (recordId || "").trim().toLowerCase();
}

function syncSourceTypeCustomField(selectId, customFieldId, customInputId) {
  const select = $(selectId);
  const customField = $(customFieldId);
  const customInput = $(customInputId);
  const custom = select && select.value === "custom";
  if (customField) customField.classList.toggle("hidden", !custom);
  if (!custom && customInput) customInput.value = "";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function statusClass(status) {
  if (CANDIDATE_STATUSES.includes(status) || REQUEST_STATUSES.includes(status)) return status;
  return "pending";
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = "identity-resolution-badge " + (className || "");
  badge.textContent = textOrDash(text);
  return badge;
}

function createMetaItem(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = textOrDash(value);
  item.append(term, detail);
  return item;
}

function candidateSourceRecord(record) {
  return {
    source_type: canonicalIdentitySourceType(record.type),
    source_record_id: record.id,
    source_label: record.label,
    source_summary: record.summary
  };
}

function createSourceBlock(label, record) {
  const sourceRecord = candidateSourceRecord(record || {});
  const sourceLabel = linkedRecordFriendlyLabel(sourceRecord);
  const sourceSummary = sourceRecord.source_summary && typeof sourceRecord.source_summary === "object"
    ? sourceRecord.source_summary
    : {};
  const block = document.createElement("section");
  block.className = "identity-resolution-source-block";
  const heading = document.createElement("h4");
  heading.textContent = label;
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  meta.append(
    createMetaItem("Source area", friendlyIdentitySourceType(sourceRecord.source_type)),
    createMetaItem("Label", sourceLabel)
  );
  usefulLinkSummaryFields(sourceSummary).forEach(field => {
    meta.appendChild(createMetaItem(field.label, field.value));
  });
  block.append(heading, meta);
  appendLinkedRecordActions(block, sourceRecord);

  const technical = document.createElement("details");
  technical.className = "identity-resolution-request-details identity-resolution-request-advanced";
  const technicalSummary = document.createElement("summary");
  technicalSummary.textContent = "Advanced / Technical Details";
  const technicalMeta = document.createElement("dl");
  technicalMeta.className = "identity-resolution-meta-grid";
  technicalMeta.append(
    createMetaItem("Source type", sourceRecord.source_type),
    createMetaItem("Source record ID", sourceRecord.source_record_id),
    createMetaItem("Stored source label", sourceRecord.source_label),
    createMetaItem("Source summary", summaryText(sourceSummary))
  );
  technical.append(technicalSummary, technicalMeta);
  if (sourceSummary && Object.keys(sourceSummary).length) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(sourceSummary, null, 2);
    technical.appendChild(pre);
  }
  if (sourceRecord.source_record_id) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy Technical ID";
    copy.addEventListener("click", () => copyTechnicalId(sourceRecord.source_record_id));
    technical.appendChild(copy);
  }
  block.appendChild(technical);
  return block;
}

function renderEmpty(targetId, options) {
  const element = $(targetId);
  if (!element) return;
  element.classList.remove("hidden");
  renderEmptyState(element, options);
}

function hideEmpty(targetId) {
  const element = $(targetId);
  if (element) element.classList.add("hidden");
}

function setManageControls() {
  const manage = canManageIdentityResolution();
  const request = canRequestIdentityResolution();
  if ($("identityResolutionNewRequestButton")) {
    $("identityResolutionNewRequestButton").classList.toggle("hidden", !request);
  }
  if ($("identityResolutionNewCandidateButton")) {
    $("identityResolutionNewCandidateButton").classList.toggle("hidden", !manage);
  }
  if ($("identityResolutionReadOnlyNotice")) {
    $("identityResolutionReadOnlyNotice").classList.toggle("hidden", manage);
  }
  document.querySelectorAll("[data-identity-manage-only]").forEach(element => {
    element.classList.toggle("hidden", !manage);
  });
}

function registerIdentityResolutionSections() {
  registerModuleSections("identity-resolution", [
    {
      id: "overview",
      title: "Overview",
      icon: "O",
      target: "identityResolutionOverviewSection",
      order: 10,
      default: true
    },
    {
      id: "requests",
      title: "Review Requests",
      icon: "RR",
      target: "identityResolutionRequestsSection",
      order: 20
    },
    {
      id: "queue",
      title: "Candidate Queue",
      icon: "CQ",
      target: "identityResolutionQueueSection",
      order: 30,
      visible: canViewIdentityResolutionRecords
    },
    {
      id: "links",
      title: "Confirmed Links",
      icon: "CL",
      target: "identityResolutionLinksSection",
      order: 40,
      visible: canViewIdentityResolutionRecords
    },
    {
      id: "decisions",
      title: "Decision History",
      icon: "DH",
      target: "identityResolutionDecisionsSection",
      order: 50,
      visible: canViewIdentityResolutionRecords
    },
    {
      id: "legacy",
      title: "Legacy Tools",
      fullTitle: "Legacy / Future Tools",
      icon: "LT",
      target: "identityResolutionLegacySection",
      order: 60
    }
  ], {
    content: "identityResolutionWorkspaceContent",
    title: "Identity Resolution",
    label: "Identity Resolution section navigation",
    toggleLabel: "Identity Resolution section",
    defaultSection: "overview"
  });
}

function candidateFilterPayload(options) {
  const settings = options || {};
  return {
    p_status: settings.status !== undefined ? settings.status : fieldValue("identityResolutionCandidateStatus"),
    p_candidate_type: settings.type !== undefined ? settings.type : fieldValue("identityResolutionCandidateType"),
    p_search_text: settings.search !== undefined ? settings.search : fieldValue("identityResolutionCandidateSearch"),
    p_limit: settings.limit !== undefined ? settings.limit : Number(fieldValue("identityResolutionCandidateLimit") || 50)
  };
}

function requestFilterPayload(options) {
  const settings = options || {};
  return {
    p_status: settings.status !== undefined ? settings.status : fieldValue("identityResolutionRequestStatus"),
    p_candidate_type: settings.type !== undefined ? settings.type : fieldValue("identityResolutionRequestType"),
    p_search_text: settings.search !== undefined ? settings.search : fieldValue("identityResolutionRequestSearch"),
    p_limit: settings.limit !== undefined ? settings.limit : Number(fieldValue("identityResolutionRequestLimit") || 50)
  };
}

function linkFilterPayload(options) {
  const settings = options || {};
  return {
    p_identity_type: settings.type !== undefined ? settings.type : fieldValue("identityResolutionLinkType"),
    p_search_text: settings.search !== undefined ? settings.search : fieldValue("identityResolutionLinkSearch"),
    p_link_status: settings.status !== undefined ? settings.status : fieldValue("identityResolutionLinkStatus"),
    p_limit: settings.limit !== undefined ? settings.limit : Number(fieldValue("identityResolutionLinkLimit") || 50)
  };
}

async function loadCandidateQueue() {
  const result = await supabaseClient.rpc("list_identity_resolution_candidates", candidateFilterPayload());
  if (result.error) throw result.error;
  identityCandidates = await enrichCandidatesForDisplay(Array.isArray(result.data) ? result.data : []);
  renderCandidateQueue();
}

async function loadReviewRequests() {
  const result = await supabaseClient.rpc("list_identity_resolution_requests", requestFilterPayload());
  if (result.error) throw result.error;
  identityReviewRequests = Array.isArray(result.data) ? result.data : [];
  renderReviewRequests();
}

async function loadOverviewData() {
  const canLoadRecords = canViewIdentityResolutionRecords();
  const [requestResult, candidateResult, linkResult] = await Promise.all([
    supabaseClient.rpc("list_identity_resolution_requests", requestFilterPayload({
      status: "all",
      type: "all",
      search: "",
      limit: 500
    })),
    canLoadRecords
      ? supabaseClient.rpc("list_identity_resolution_candidates", candidateFilterPayload({
        status: "all",
        type: "all",
        search: "",
        limit: 500
      }))
      : Promise.resolve({ data: [], error: null }),
    canLoadRecords
      ? supabaseClient.rpc("list_identity_links", linkFilterPayload({
        type: "all",
        search: "",
        status: "active",
        limit: 500
      }))
      : Promise.resolve({ data: [], error: null })
  ]);
  if (requestResult.error) throw requestResult.error;
  if (candidateResult.error) throw candidateResult.error;
  if (linkResult.error) throw linkResult.error;
  identityOverviewRequests = Array.isArray(requestResult.data) ? requestResult.data : [];
  identityOverviewCandidates = await enrichCandidatesForDisplay(Array.isArray(candidateResult.data) ? candidateResult.data : []);
  identityOverviewLinks = Array.isArray(linkResult.data) ? linkResult.data : [];
  renderOverview();
}

async function loadConfirmedLinks() {
  const result = await supabaseClient.rpc("list_identity_links", linkFilterPayload());
  if (result.error) throw result.error;
  identityLinks = Array.isArray(result.data) ? result.data : [];
  renderConfirmedLinks();
}

async function loadDecisionHistory() {
  const result = await supabaseClient.rpc("list_identity_resolution_decisions", {
    p_candidate_id: null,
    p_identity_link_id: null
  });
  if (result.error) throw result.error;
  identityDecisions = Array.isArray(result.data) ? result.data : [];
  renderDecisionHistory();
}

async function enrichCandidateForDisplay(candidate) {
  if (!candidate) return candidate;
  const rows = await enrichIdentityLinkRowsForDisplay([
    {
      source_type: candidate.source_a_type,
      source_record_id: candidate.source_a_record_id,
      source_label: candidate.source_a_label,
      source_summary: candidate.source_a_summary
    },
    {
      source_type: candidate.source_b_type,
      source_record_id: candidate.source_b_record_id,
      source_label: candidate.source_b_label,
      source_summary: candidate.source_b_summary
    }
  ]);
  const sourceA = rows[0] || {};
  const sourceB = rows[1] || {};
  return {
    ...candidate,
    source_a_label: sourceA.source_label || candidate.source_a_label,
    source_a_summary: sourceA.source_summary || candidate.source_a_summary,
    source_b_label: sourceB.source_label || candidate.source_b_label,
    source_b_summary: sourceB.source_summary || candidate.source_b_summary
  };
}

async function enrichCandidatesForDisplay(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  return Promise.all(rows.map(candidate => enrichCandidateForDisplay(candidate)));
}

function renderOverview() {
  setText("identityResolutionRequestPendingCount", String(identityOverviewRequests.filter(item => item.status === "pending").length));
  setText("identityResolutionRequestInReviewCount", String(identityOverviewRequests.filter(item => item.status === "in_review").length));
  setText("identityResolutionRequestCandidateCount", String(identityOverviewRequests.filter(item => item.candidate_id || item.status === "candidate_created").length));
  setText("identityResolutionRequestClosedCount", String(identityOverviewRequests.filter(item => item.status === "closed" || item.status === "cancelled").length));
  setText("identityResolutionPendingCount", String(identityOverviewCandidates.filter(item => item.status === "pending").length));
  setText("identityResolutionDeferredCount", String(identityOverviewCandidates.filter(item => item.status === "deferred").length));
  setText("identityResolutionConfirmedLinksCount", String(identityOverviewLinks.length));
  setText(
    "identityResolutionRejectedIgnoredCount",
    String(identityOverviewCandidates.filter(item => item.status === "rejected" || item.status === "ignored").length)
  );
}

function renderReviewRequests() {
  const container = $("identityResolutionRequestResults");
  if (!container) return;
  container.replaceChildren();
  setText("identityResolutionRequestCount", identityReviewRequests.length + " shown");

  if (!identityReviewRequests.length) {
    renderEmpty("identityResolutionRequestsEmpty", {
      title: "No matching review requests",
      description: "No identity review requests are available for the selected filters."
    });
    return;
  }
  hideEmpty("identityResolutionRequestsEmpty");

  identityReviewRequests.forEach(request => {
    const card = document.createElement("article");
    card.className = "identity-resolution-result-card identity-resolution-request-card";

    const header = document.createElement("div");
    header.className = "identity-resolution-result-header";
    const title = document.createElement("div");
    const heading = document.createElement("h4");
    heading.textContent = request.request_reference || "Review request";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Possible identity review - " + titleCase(request.candidate_type);
    title.append(heading, subtitle);
    header.append(title, createBadge(titleCase(request.status), statusClass(request.status)));

    const meta = document.createElement("dl");
    meta.className = "identity-resolution-meta-grid";
    meta.append(
      createMetaItem("Source", requestSourceLabel(request)),
      createMetaItem("Source area", sourceAreaLabel(request.source_type)),
      createMetaItem("Context", requestContextLabel(request)),
      createMetaItem("Reason", request.request_reason),
      createMetaItem("Requester notes", request.requester_notes),
      createMetaItem("Created", formatDate(request.created_at)),
      createMetaItem("Candidate", request.candidate_id ? "Candidate linked" : "-"),
      createMetaItem("Suggested match", requestSuggestedLabel(request))
    );

    const reason = document.createElement("p");
    reason.className = "identity-resolution-reason";
    reason.textContent = request.request_reason || "No request reason recorded.";

    const actions = document.createElement("div");
    actions.className = "identity-resolution-card-actions";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "secondary";
    details.textContent = "View Details";
    details.addEventListener("click", event => openRequestDetail(request.id, event.currentTarget));
    actions.appendChild(details);

    if (request.candidate_id && canViewIdentityResolutionRecords()) {
      const openCandidate = document.createElement("button");
      openCandidate.type = "button";
      openCandidate.className = "secondary";
      openCandidate.textContent = "Open Candidate";
      openCandidate.addEventListener("click", event => openCandidateDetail(request.candidate_id, event.currentTarget));
      actions.appendChild(openCandidate);
    }

    if (canManageIdentityResolution()) {
      [
        ["in_review", "Mark In Review"],
        ["closed", "Close Request"],
        ["cancelled", "Cancel Request"]
      ].forEach(([status, label]) => {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "secondary";
        action.textContent = label;
        action.disabled = request.status === status;
        action.addEventListener("click", event => updateRequestStatus(request, status, event.currentTarget));
        actions.appendChild(action);
      });
    }

    card.append(header, meta, reason, actions);
    container.appendChild(card);
  });
}

function renderCandidateQueue() {
  const container = $("identityResolutionCandidateResults");
  if (!container) return;
  container.replaceChildren();
  setText("identityResolutionCandidateCount", identityCandidates.length + " shown");

  if (!identityCandidates.length) {
    renderEmpty("identityResolutionCandidateEmpty", {
      title: "No matching candidates",
      description: "No possible match candidates are available for the selected filters."
    });
    return;
  }
  hideEmpty("identityResolutionCandidateEmpty");

  identityCandidates.forEach(candidate => {
    const card = document.createElement("article");
    card.className = "identity-resolution-result-card";

    const header = document.createElement("div");
    header.className = "identity-resolution-result-header";
    const title = document.createElement("div");
    const heading = document.createElement("h4");
    heading.textContent = candidate.candidate_reference || "Identity candidate";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Possible match - " + titleCase(candidate.candidate_type);
    title.append(heading, subtitle);
    header.append(title, createBadge(titleCase(candidate.status), statusClass(candidate.status)));

    const meta = document.createElement("dl");
    meta.className = "identity-resolution-meta-grid";
    meta.append(
      createMetaItem("Confidence", formatScore(candidate.confidence_score)),
      createMetaItem("Suggested by", candidate.suggested_by),
      createMetaItem("Suggested date", formatDate(candidate.suggested_at)),
      createMetaItem("Decision", candidate.decision_type ? titleCase(candidate.decision_type) : "-")
    );

    const reason = document.createElement("p");
    reason.className = "identity-resolution-reason";
    reason.textContent = candidate.match_reason || "No match reason recorded.";

    const sources = document.createElement("div");
    sources.className = "identity-resolution-source-grid";
    sources.append(
      createSourceBlock("Source A", {
        type: candidate.source_a_type,
        id: candidate.source_a_record_id,
        label: candidate.source_a_label,
        summary: candidate.source_a_summary
      }),
      createSourceBlock("Source B", {
        type: candidate.source_b_type,
        id: candidate.source_b_record_id,
        label: candidate.source_b_label,
        summary: candidate.source_b_summary
      })
    );

    const actions = document.createElement("div");
    actions.className = "identity-resolution-card-actions";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "secondary";
    details.textContent = "View Details";
    details.addEventListener("click", event => openCandidateDetail(candidate.id, event.currentTarget));
    actions.appendChild(details);
    if (canManageIdentityResolution()) {
      ["confirmed", "rejected", "deferred", "ignored"].forEach(decisionType => {
        const action = document.createElement("button");
        action.type = "button";
        action.className = decisionType === "confirmed" ? "" : "secondary";
        action.textContent = decisionLabel(decisionType);
        action.disabled = candidate.status === "confirmed" && decisionType === "confirmed";
        action.addEventListener("click", event => openDecisionPanel(candidate, decisionType, event.currentTarget));
        actions.appendChild(action);
      });
    }

    card.append(header, meta, reason, sources, actions);
    container.appendChild(card);
  });
}

function renderConfirmedLinks() {
  const container = $("identityResolutionLinkResults");
  if (!container) return;
  container.replaceChildren();
  setText("identityResolutionLinksCount", identityLinks.length + " shown");

  if (!identityLinks.length) {
    renderEmpty("identityResolutionLinksEmpty", {
      title: "No confirmed links",
      description: "No confirmed identity link metadata is available for the selected filters."
    });
    return;
  }
  hideEmpty("identityResolutionLinksEmpty");

  identityLinks.forEach(link => {
    const card = document.createElement("article");
    card.className = "identity-resolution-result-card";
    const header = document.createElement("div");
    header.className = "identity-resolution-result-header";
    const title = document.createElement("div");
    const heading = document.createElement("h4");
    heading.textContent = link.link_reference || "Identity link";
    const subtitle = document.createElement("p");
    subtitle.textContent = textOrDash(link.canonical_label);
    title.append(heading, subtitle);
    header.append(title, createBadge(titleCase(link.link_status), link.link_status === "active" ? "confirmed" : "deferred"));

    const meta = document.createElement("dl");
    meta.className = "identity-resolution-meta-grid";
    meta.append(
      createMetaItem("Identity type", titleCase(link.identity_type)),
      createMetaItem("Created date", formatDate(link.created_at)),
      createMetaItem("Link reason", link.link_reason),
      createMetaItem("Created from candidate", link.created_from_candidate_id)
    );

    const actions = document.createElement("div");
    actions.className = "identity-resolution-card-actions";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "secondary";
    details.textContent = "View Details";
    details.addEventListener("click", event => openLinkDetail(link.id, event.currentTarget));
    actions.appendChild(details);

    card.append(header, meta, actions);
    container.appendChild(card);
  });
}

function renderDecisionHistory() {
  const container = $("identityResolutionDecisionResults");
  if (!container) return;
  container.replaceChildren();
  setText("identityResolutionDecisionCount", identityDecisions.length + " shown");

  if (!identityDecisions.length) {
    renderEmpty("identityResolutionDecisionsEmpty", {
      title: "No decisions recorded",
      description: "Decision history will appear after candidates are deferred, rejected, ignored or confirmed."
    });
    return;
  }
  hideEmpty("identityResolutionDecisionsEmpty");

  identityDecisions.slice(0, 100).forEach(decision => {
    const item = document.createElement("article");
    item.className = "identity-resolution-decision-item";
    const heading = document.createElement("div");
    heading.append(createBadge(titleCase(decision.decision_type), statusClass(decision.decision_type)));
    const created = document.createElement("span");
    created.textContent = formatDate(decision.created_at);
    heading.appendChild(created);
    const reason = document.createElement("p");
    reason.textContent = decision.decision_reason || "No reason recorded.";
    const meta = document.createElement("small");
    meta.textContent = "Candidate: " + textOrDash(decision.candidate_id) +
      " | Link: " + textOrDash(decision.identity_link_id);
    item.append(heading, reason, meta);
    container.appendChild(item);
  });
}

function decisionLabel(type) {
  if (type === "confirmed") return "Confirm Link";
  if (type === "rejected") return "Reject";
  if (type === "deferred") return "Defer";
  if (type === "ignored") return "Ignore";
  return "Decide";
}

async function openRequestDetail(requestId, trigger) {
  if (!requireIdentityResolutionAccess()) return;
  try {
    const result = await supabaseClient.rpc("get_identity_resolution_request", {
      p_request_id: requestId
    });
    if (result.error) throw result.error;
    selectedCandidate = null;
    selectedLink = null;
    renderRequestDetail(result.data);
    detailPanelController.open({
      trigger,
      title: "Review Request " + textOrDash(result.data && result.data.request_reference),
      initialFocus: "identityResolutionDetailPanelClose"
    });
  } catch (err) {
    showToast("Review request unavailable", err.message || "The review request could not be loaded.", "error");
  }
}

async function openCandidateDetail(candidateId, trigger) {
  if (!requireIdentityResolutionAccess()) return;
  try {
    const [candidateResult, decisionsResult] = await Promise.all([
      supabaseClient.rpc("get_identity_resolution_candidate", { p_candidate_id: candidateId }),
      supabaseClient.rpc("list_identity_resolution_decisions", {
        p_candidate_id: candidateId,
        p_identity_link_id: null
      })
    ]);
    if (candidateResult.error) throw candidateResult.error;
    if (decisionsResult.error) throw decisionsResult.error;
    selectedCandidate = await enrichCandidateForDisplay(candidateResult.data);
    selectedLink = null;
    renderCandidateDetail(selectedCandidate, Array.isArray(decisionsResult.data) ? decisionsResult.data : []);
    detailPanelController.open({
      trigger,
      title: "Candidate " + textOrDash(selectedCandidate.candidate_reference),
      initialFocus: "identityResolutionDetailPanelClose"
    });
  } catch (err) {
    showToast("Candidate details unavailable", err.message || "The identity candidate could not be loaded.", "error");
  }
}

async function openLinkDetail(linkId, trigger) {
  if (!requireIdentityResolutionAccess()) return;
  const link = identityLinks.find(item => item.id === linkId) || identityOverviewLinks.find(item => item.id === linkId);
  if (!link) {
    showToast("Link unavailable", "Reload confirmed links before viewing this record.", "error");
    return;
  }
  try {
    const [recordsResult, decisionsResult] = await Promise.all([
      getIdentityLinkDetailRows(linkId),
      supabaseClient.rpc("list_identity_resolution_decisions", {
        p_candidate_id: null,
        p_identity_link_id: linkId
      })
    ]);
    if (decisionsResult.error) throw decisionsResult.error;
    const detailRows = Array.isArray(recordsResult) ? recordsResult : [];
    selectedLink = Object.assign({}, link, detailRows[0] || {});
    selectedCandidate = null;
    renderLinkDetail(selectedLink, detailRows, Array.isArray(decisionsResult.data) ? decisionsResult.data : []);
    detailPanelController.open({
      trigger,
      title: "Link " + textOrDash(link.link_reference),
      initialFocus: "identityResolutionDetailPanelClose"
    });
  } catch (err) {
    showToast("Link details unavailable", err.message || "The confirmed link could not be loaded.", "error");
  }
}

function renderCandidateDetail(candidate, decisions) {
  const body = $("identityResolutionDetailPanelBody");
  body.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "assignment-editor-notice";
  notice.textContent = "This is a review candidate. Viewing or deciding it does not modify source records. Confirmation creates link metadata only.";
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  meta.append(
    createMetaItem("Reference", candidate.candidate_reference),
    createMetaItem("Type", titleCase(candidate.candidate_type)),
    createMetaItem("Status", titleCase(candidate.status)),
    createMetaItem("Confidence", formatScore(candidate.confidence_score)),
    createMetaItem("Match reason", candidate.match_reason),
    createMetaItem("Suggested by", candidate.suggested_by),
    createMetaItem("Suggested date", formatDate(candidate.suggested_at)),
    createMetaItem("Decision", candidate.decision_type ? titleCase(candidate.decision_type) : "-"),
    createMetaItem("Decision reason", candidate.decision_reason),
    createMetaItem("Decision date", formatDate(candidate.decided_at))
  );
  const sources = document.createElement("div");
  sources.className = "identity-resolution-source-grid";
  sources.append(
    createSourceBlock("Source A", {
      type: candidate.source_a_type,
      id: candidate.source_a_record_id,
      label: candidate.source_a_label,
      summary: candidate.source_a_summary
    }),
    createSourceBlock("Source B", {
      type: candidate.source_b_type,
      id: candidate.source_b_record_id,
      label: candidate.source_b_label,
      summary: candidate.source_b_summary
    })
  );
  body.append(notice, meta, sources, createDecisionList(decisions));
  updateDetailActions();
}

function createFriendlyContextBlock(title, fields) {
  const block = document.createElement("section");
  block.className = "identity-resolution-source-block";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  (fields || []).forEach(field => {
    meta.appendChild(createMetaItem(field.label, field.value));
  });
  block.append(heading, meta);
  return block;
}

function appendTechnicalDetails(parent, request) {
  const details = document.createElement("details");
  details.className = "identity-resolution-request-details identity-resolution-request-advanced";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced / Technical Details";
  const grid = document.createElement("div");
  grid.className = "identity-resolution-source-grid";
  grid.appendChild(createSourceBlock("Technical source record", {
    type: request.source_type,
    id: request.source_record_id,
    label: request.source_label,
    summary: request.source_summary
  }));
  if (request.suggested_match_type || request.suggested_match_record_id || request.suggested_match_label) {
    grid.appendChild(createSourceBlock("Technical suggested match", {
      type: request.suggested_match_type,
      id: request.suggested_match_record_id,
      label: request.suggested_match_label,
      summary: request.suggested_match_summary
    }));
  }
  if (request.context_type || request.context_record_id) {
    grid.appendChild(createSourceBlock("Technical request context", {
      type: request.context_type,
      id: request.context_record_id,
      label: request.context_type,
      summary: request.context_summary
    }));
  }
  details.append(summary, grid);
  parent.appendChild(details);
}

function renderRequestDetail(request) {
  const body = $("identityResolutionDetailPanelBody");
  body.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "assignment-editor-notice";
  notice.textContent = "This is a request for identity review. Source records are not modified, and request-only users cannot approve identity links.";

  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  meta.append(
    createMetaItem("Request reference", request.request_reference),
    createMetaItem("Status", titleCase(request.status)),
    createMetaItem("Candidate type", titleCase(request.candidate_type)),
    createMetaItem("Request reason", request.request_reason),
    createMetaItem("Requester notes", request.requester_notes),
    createMetaItem("Created", formatDate(request.created_at)),
    createMetaItem("Reviewed", formatDate(request.reviewed_at)),
    createMetaItem("Review notes", request.review_notes)
  );

  const sources = document.createElement("div");
  sources.className = "identity-resolution-source-grid";
  sources.appendChild(createFriendlyContextBlock("Source record", [
    { label: "Source", value: requestSourceLabel(request) },
    { label: "Source area", value: sourceAreaLabel(request.source_type) },
    { label: "Reference", value: summaryValue(request.source_summary, ["display_reference", "case_reference"]) || request.source_label || "-" }
  ]));
  if (request.suggested_match_type || request.suggested_match_record_id || request.suggested_match_label) {
    sources.appendChild(createFriendlyContextBlock("Suggested match", [
      { label: "Suggested match", value: requestSuggestedLabel(request) },
      { label: "Source area", value: sourceAreaLabel(request.suggested_match_type) }
    ]));
  }
  if (request.context_type || request.context_record_id) {
    sources.appendChild(createFriendlyContextBlock("Request context", [
      { label: "Context", value: requestContextLabel(request) },
      { label: "Context area", value: sourceAreaLabel(request.context_type) },
      { label: "Reference", value: summaryValue(request.context_summary, ["case_reference", "display_reference"]) || "-" }
    ]));
  }

  body.append(notice, meta, sources);
  appendTechnicalDetails(body, request);

  const actions = document.createElement("div");
  actions.className = "identity-resolution-card-actions";
  if (request.candidate_id && canViewIdentityResolutionRecords()) {
    const candidateNote = document.createElement("p");
    candidateNote.className = "identity-resolution-note";
    candidateNote.textContent = "Managers must review and decide linked candidates through the Candidate Queue.";
    body.appendChild(candidateNote);
    const openCandidate = document.createElement("button");
    openCandidate.type = "button";
    openCandidate.className = "secondary";
    openCandidate.textContent = "Open Candidate";
    openCandidate.addEventListener("click", event => openCandidateDetail(request.candidate_id, event.currentTarget));
    actions.appendChild(openCandidate);
  }

  if (canManageIdentityResolution()) {
    [
      ["in_review", "Mark In Review"],
      ["closed", "Close Request"],
      ["cancelled", "Cancel Request"]
    ].forEach(([status, label]) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary";
      action.textContent = label;
      action.disabled = request.status === status;
      action.addEventListener("click", event => updateRequestStatus(request, status, event.currentTarget));
      actions.appendChild(action);
    });
  }
  if (actions.children.length) body.appendChild(actions);
  updateDetailActions();
}

function renderLinkDetail(link, records, decisions) {
  const body = $("identityResolutionDetailPanelBody");
  body.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "assignment-editor-notice";
  notice.textContent = "This confirmed identity link is reviewed metadata for one active identity group. Source records have not been merged, modified or rewritten.";
  const activeReferences = Array.from(new Set((records || [])
    .filter(record => record.link_status === "active")
    .map(record => record.link_reference)
    .filter(Boolean)));
  const linkedRecordCount = uniqueLinkedIdentityRecords(records).length;
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  meta.append(
    createMetaItem("Active root / group reference", activeReferences[0] || link.link_reference),
    createMetaItem("Canonical label", link.canonical_label),
    createMetaItem("Identity type", titleCase(link.identity_type)),
    createMetaItem("Status", titleCase(link.link_status)),
    createMetaItem("Linked records in group", linkedRecordCount),
    createMetaItem("Link reason", link.link_reason),
    createMetaItem("Created date", formatDate(link.link_created_at || link.created_at)),
    createMetaItem("Created from candidate", link.created_from_candidate_id)
  );
  const recordWrap = document.createElement("div");
  recordWrap.className = "identity-resolution-source-grid";
  uniqueLinkedIdentityRecords(records).forEach((record, index) => {
    recordWrap.appendChild(createLinkedIdentityRecordBlock(record, index));
  });
  body.append(notice, meta, recordWrap, createDecisionList(decisions));
  updateDetailActions();
}

function uniqueLinkedIdentityRecords(records) {
  const seen = new Set();
  return (records || []).filter(record => {
    const sourceType = canonicalIdentitySourceType(record.source_type);
    const key = sourceType + "::" + String(record.source_record_id || "").trim();
    if (!record.source_record_id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function shortReference(value) {
  const text = String(value || "").trim();
  return text.length > 8 ? text.slice(0, 8) + "..." : text;
}

function linkedRecordFriendlyLabel(record) {
  const summary = record.source_summary && typeof record.source_summary === "object" ? record.source_summary : {};
  const storedLabel = String(record.source_label || "").trim();
  if (storedLabel && !isUuidLike(storedLabel)) return storedLabel;
  const sourceType = canonicalIdentitySourceType(record.source_type);
  const sourceArea = friendlyIdentitySourceType(sourceType);
  const subject = [summary.visitor_name || summary.subject_name, summary.company].filter(Boolean).join(" / ");

  if (sourceType === "visit_log") {
    const signedIn = summary.sign_in_time ? "Signed in " + formatDate(summary.sign_in_time) : "";
    return [sourceArea, subject, signedIn].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(record.source_record_id);
  }

  if (sourceType === "planned_visits") {
    const date = summary.visit_date ? "Visit date " + summary.visit_date : "";
    const host = summary.host || summary.host_name || summary.onsite_contact;
    return [sourceArea, subject, date, host ? "Host " + host : ""].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(record.source_record_id);
  }

  if (sourceType === "document_evidence" || sourceType === "agreement_evidence") {
    const documentTitle = summary.document || summary.agreement_title || summary.agreement_name || summary.evidence_document_title;
    const version = summary.version || summary.agreement_version_number || summary.evidence_document_version;
    const signed = summary.signed_at ? "Signed " + formatDate(summary.signed_at) : "";
    const documentLabel = [documentTitle, version ? "version " + version : ""].filter(Boolean).join(" ");
    return [sourceArea, documentLabel, subject, signed].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(record.source_record_id);
  }

  if (sourceType === "privacy_cases") {
    const caseReference = summary.case_reference || summary.case_id;
    const subjectLabel = summary.search_text || summary.subject_reference || summary.result_label;
    return [sourceArea, caseReference, subjectLabel].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(record.source_record_id);
  }

  return storedLabel || sourceArea + " record - reference " + shortReference(record.source_record_id);
}

function copyTechnicalId(value) {
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

function appendLinkedRecordActions(block, record) {
  if (!record.source_record_id) return;
  const sourceType = canonicalIdentitySourceType(record.source_type);
  const isVisitLog = sourceType === "visit_log";
  const isPlannedVisit = sourceType === "planned_visits";
  const isPrivacyCase = sourceType === "privacy_cases";
  const isEvidence = sourceType === "document_evidence" || sourceType === "agreement_evidence";
  const canOpenPrivacyCase = isPrivacyCase && hasAnyCapability([
    "privacy.case.view",
    "privacy.case.manage",
    "privacy.view",
    "privacy.manage",
    "gdpr.view",
    "gdpr.manage"
  ]);
  const canOpenEvidence = isEvidence &&
    hasCapability("visitor.view") &&
    hasAnyCapability(["agreements.view", "audit.view", "visitor.history.view", "module_configuration.manage"]);
  if (!isVisitLog && !isPlannedVisit && !isPrivacyCase && !isEvidence) return;
  if (isPrivacyCase && !canOpenPrivacyCase) return;
  if (isEvidence && !canOpenEvidence) return;
  const actions = document.createElement("div");
  actions.className = "identity-resolution-card-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "secondary";
  open.textContent = isVisitLog
    ? "Open Visitor History Record"
    : isPlannedVisit
      ? "Open Planned Visit"
      : isPrivacyCase
        ? "Open Privacy Case"
        : "Open Document Evidence";
  open.addEventListener("click", () => {
    if (detailPanelController) {
      detailPanelController.close({ restoreFocus: false });
    }
    window.dispatchEvent(new CustomEvent("oh:linked-source-record-requested", {
      detail: {
        sourceType,
        sourceRecordId: record.source_record_id
      }
    }));
  });
  actions.appendChild(open);
  block.appendChild(actions);
}

function createLinkedIdentityRecordBlock(record, index) {
  const block = document.createElement("section");
  block.className = "identity-resolution-source-block";
  const heading = document.createElement("h4");
  heading.textContent = "Linked record " + (index + 1);
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  const sourceType = canonicalIdentitySourceType(record.source_type);
  meta.append(
    createMetaItem("Source area", friendlyIdentitySourceType(sourceType)),
    createMetaItem("Source label", linkedRecordFriendlyLabel(record)),
    createMetaItem("Linked date", formatDate(record.source_record_linked_at))
  );
  usefulLinkSummaryFields(record.source_summary).forEach(field => {
    meta.appendChild(createMetaItem(field.label, field.value));
  });
  block.append(heading, meta);
  appendLinkedRecordActions(block, record);
  const technical = document.createElement("details");
  technical.className = "identity-resolution-request-details identity-resolution-request-advanced";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced / Technical Details";
  const technicalMeta = document.createElement("dl");
  technicalMeta.className = "identity-resolution-meta-grid";
  technicalMeta.append(
    createMetaItem("Source type", sourceType),
    createMetaItem("Source record ID", record.source_record_id),
    createMetaItem("Link record ID", record.link_record_id)
  );
  technical.append(summary, technicalMeta);
  if (record.source_summary && typeof record.source_summary === "object" && Object.keys(record.source_summary).length) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(record.source_summary, null, 2);
    technical.appendChild(pre);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary";
  copy.textContent = "Copy Technical ID";
  copy.addEventListener("click", () => copyTechnicalId(record.source_record_id));
  technical.appendChild(copy);
  const note = document.createElement("p");
  note.className = "linked-identity-readiness-note";
  note.textContent = "Future platform rule: operational searches should support authorised internal reference lookup. Use this technical ID for support/admin lookup when a direct Open Record action is not available.";
  technical.appendChild(note);
  block.appendChild(technical);
  return block;
}

function usefulLinkSummaryFields(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  return [
    ["result_label", "Label"],
    ["display_label", "Label"],
    ["case_reference", "Case reference"],
    ["visitor_name", "Visitor / subject"],
    ["company", "Company"],
    ["document", "Document"],
    ["agreement_name", "Agreement"],
    ["agreement_title", "Agreement title"],
    ["agreement_version_number", "Version"],
    ["version", "Version"],
    ["status", "Status"],
    ["visit_status", "Visit status"],
    ["visit_date", "Visit date"],
    ["expected_time", "Expected time"],
    ["host", "Host"],
    ["host_name", "Host"],
    ["onsite_contact", "Host / contact"],
    ["sign_in_time", "Sign in"],
    ["sign_out_time", "Sign out"],
    ["evidence_document_title", "Document"],
    ["evidence_document_version", "Version"],
    ["signed_at", "Signed"],
    ["signed_by_name", "Signed by"],
    ["evidence_type", "Evidence type"]
  ].filter(([key]) => source[key] !== null && source[key] !== undefined && String(source[key]).trim())
    .filter(([key]) => !["result_label", "display_label"].includes(key) || !isUuidLike(source[key]))
    .map(([key, label]) => ({
      label,
      value: /_time$|_at$/.test(key) ? formatDate(source[key]) : source[key]
    }));
}

function createDecisionList(decisions) {
  const section = document.createElement("section");
  section.className = "identity-resolution-detail-decisions";
  const heading = document.createElement("h3");
  heading.textContent = "Decision history";
  section.appendChild(heading);
  if (!decisions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No decisions recorded.";
    section.appendChild(empty);
    return section;
  }
  decisions.forEach(decision => {
    const item = document.createElement("article");
    item.className = "identity-resolution-decision-item";
    const title = document.createElement("strong");
    title.textContent = titleCase(decision.decision_type) + " - " + formatDate(decision.created_at);
    const reason = document.createElement("p");
    reason.textContent = decision.decision_reason || "No reason recorded.";
    item.append(title, reason);
    section.appendChild(item);
  });
  return section;
}

function updateDetailActions() {
  const showActions = canManageIdentityResolution() && !!selectedCandidate;
  [
    ["identityResolutionDetailConfirmButton", "confirmed"],
    ["identityResolutionDetailRejectButton", "rejected"],
    ["identityResolutionDetailDeferButton", "deferred"],
    ["identityResolutionDetailIgnoreButton", "ignored"]
  ].forEach(([id, decisionType]) => {
    const button = $(id);
    if (!button) return;
    button.classList.toggle("hidden", !showActions);
    button.disabled = showActions && selectedCandidate.status === decisionType;
  });
}

async function updateRequestStatus(request, status, trigger) {
  if (!requireIdentityResolutionManageAccess()) return;
  const confirmed = await requestPlatformConfirmation({
    title: titleCase(status),
    message: "This updates the review request status only. It does not modify source records or decide any identity candidate.",
    confirmText: titleCase(status),
    cancelText: "Cancel",
    danger: status === "cancelled"
  });
  if (!confirmed) return;

  const button = trigger instanceof HTMLButtonElement ? trigger : null;
  const originalLabel = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  try {
    const result = await supabaseClient.rpc("update_identity_resolution_request_status", {
      p_request_id: request.id,
      p_status: status,
      p_review_notes: null,
      p_candidate_id: request.candidate_id || null
    });
    if (result.error) throw result.error;
    showToast("Request status updated", "The identity review request was updated.", "success");
    await loadIdentityResolutionAdministration({ manual: false });
    if (detailPanelController && detailPanelController.isOpen()) {
      renderRequestDetail(result.data);
    }
  } catch (err) {
    showToast("Request status not updated", err.message || "Could not update the identity review request.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function resetCandidateForm() {
  if ($("identityResolutionCandidateForm")) $("identityResolutionCandidateForm").reset();
  ["identityResolutionFormSourceASummary", "identityResolutionFormSourceBSummary", "identityResolutionFormMetadata"].forEach(id => {
    if ($(id)) $(id).value = "{}";
  });
  if ($("identityResolutionFormSuggestedBy")) $("identityResolutionFormSuggestedBy").value = "manual";
  syncSourceTypeCustomField("identityResolutionFormSourceAType", "identityResolutionFormSourceATypeCustomField", "identityResolutionFormSourceATypeCustom");
  syncSourceTypeCustomField("identityResolutionFormSourceBType", "identityResolutionFormSourceBTypeCustomField", "identityResolutionFormSourceBTypeCustom");
}

function resetRequestForm() {
  if ($("identityResolutionRequestForm")) $("identityResolutionRequestForm").reset();
  [
    "identityResolutionRequestSourceSummary",
    "identityResolutionRequestSuggestedSummary",
    "identityResolutionRequestContextSummary",
    "identityResolutionRequestMetadata"
  ].forEach(id => {
    if ($(id)) $(id).value = "{}";
  });
  if ($("identityResolutionRequestCandidateType")) $("identityResolutionRequestCandidateType").value = "person";
  if ($("identityResolutionRequestCapturedContext")) $("identityResolutionRequestCapturedContext").classList.add("hidden");
  if ($("identityResolutionRequestCapturedFields")) $("identityResolutionRequestCapturedFields").replaceChildren();
  if ($("identityResolutionRequestStandardSource")) $("identityResolutionRequestStandardSource").classList.remove("hidden");
  if ($("identityResolutionRequestSuggestedSection")) $("identityResolutionRequestSuggestedSection").open = false;
  if ($("identityResolutionRequestAdvancedSection")) $("identityResolutionRequestAdvancedSection").open = false;
}

function setSelectValue(selectId, value) {
  const select = $(selectId);
  if (!select) return;
  const option = Array.from(select.options).find(item => item.value === value);
  select.value = option ? value : (value ? "manual" : "");
}

function appendContextField(list, label, value) {
  if (!list || !value) return;
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = textOrDash(value);
  wrapper.append(term, detail);
  list.appendChild(wrapper);
}

function renderCapturedRequestContext(settings) {
  const card = $("identityResolutionRequestCapturedContext");
  const label = $("identityResolutionRequestCapturedLabel");
  const fields = $("identityResolutionRequestCapturedFields");
  if (!card || !fields) return;
  const hasContext = Boolean(settings.sourceRecordId && settings.sourceType);
  card.classList.toggle("hidden", !hasContext);
  fields.replaceChildren();
  if (!hasContext) return;
  if (label) label.textContent = settings.sourceLabel || displayReference(settings.sourceType, settings.sourceRecordId);
  appendContextField(fields, "Source", sourceAreaLabel(settings.sourceType));
  appendContextField(fields, "Reference", settings.sourceSummary?.case_reference || settings.sourceLabel || settings.sourceRecordId);
  appendContextField(fields, "Subject/Search", settings.sourceSummary?.search_text || settings.sourceSummary?.subject_reference);
  appendContextField(fields, "Status", settings.sourceSummary?.status);
}

function standardSummary(area, reference, label) {
  const canonicalArea = canonicalIdentitySourceType(area);
  return {
    source_area: sourceAreaLabel(canonicalArea),
    display_reference: reference || null,
    display_label: label || null
  };
}

function syncStandardRequestFieldsToTechnical() {
  const sourceArea = canonicalIdentitySourceType(fieldValue("identityResolutionRequestSourceArea"));
  const sourceReference = fieldValue("identityResolutionRequestSourceReference");
  const sourceLabel = fieldValue("identityResolutionRequestSourceDisplayLabel") || sourceReference;
  const suggestedArea = canonicalIdentitySourceType(fieldValue("identityResolutionRequestSuggestedArea"));
  const suggestedReference = fieldValue("identityResolutionRequestSuggestedReference");
  const suggestedLabel = fieldValue("identityResolutionRequestSuggestedDisplayLabel") || suggestedReference;

  if ($("identityResolutionRequestSourceType")) $("identityResolutionRequestSourceType").value = sourceArea;
  if ($("identityResolutionRequestSourceId")) $("identityResolutionRequestSourceId").value = sourceReference;
  if ($("identityResolutionRequestSourceLabel")) $("identityResolutionRequestSourceLabel").value = sourceLabel;
  if ($("identityResolutionRequestSourceSummary")) {
    $("identityResolutionRequestSourceSummary").value = JSON.stringify(
      standardSummary(sourceArea, sourceReference, sourceLabel),
      null,
      2
    );
  }

  if ($("identityResolutionRequestSuggestedType")) $("identityResolutionRequestSuggestedType").value = suggestedArea;
  if ($("identityResolutionRequestSuggestedId")) $("identityResolutionRequestSuggestedId").value = suggestedReference;
  if ($("identityResolutionRequestSuggestedLabel")) $("identityResolutionRequestSuggestedLabel").value = suggestedLabel;
  if ($("identityResolutionRequestSuggestedSummary")) {
    $("identityResolutionRequestSuggestedSummary").value = JSON.stringify(
      standardSummary(suggestedArea, suggestedReference, suggestedLabel),
      null,
      2
    );
  }
}

function applyRequestContext(context) {
  const settings = context || {};
  const sourceType = canonicalIdentitySourceType(settings.sourceType || "");
  const suggestedMatchType = canonicalIdentitySourceType(settings.suggestedMatchType || "");
  if ($("identityResolutionRequestCandidateType")) {
    $("identityResolutionRequestCandidateType").value = settings.candidateType || "person";
  }
  if ($("identityResolutionRequestReason")) $("identityResolutionRequestReason").value = settings.requestReason || "";
  if ($("identityResolutionRequesterNotes")) $("identityResolutionRequesterNotes").value = settings.requesterNotes || "";
  setSelectValue("identityResolutionRequestSourceArea", sourceType);
  if ($("identityResolutionRequestSourceReference")) $("identityResolutionRequestSourceReference").value = settings.sourceRecordId || "";
  if ($("identityResolutionRequestSourceDisplayLabel")) $("identityResolutionRequestSourceDisplayLabel").value = settings.sourceLabel || "";
  if ($("identityResolutionRequestSourceType")) $("identityResolutionRequestSourceType").value = sourceType;
  if ($("identityResolutionRequestSourceId")) $("identityResolutionRequestSourceId").value = settings.sourceRecordId || "";
  if ($("identityResolutionRequestSourceLabel")) $("identityResolutionRequestSourceLabel").value = settings.sourceLabel || "";
  if ($("identityResolutionRequestSourceSummary")) {
    $("identityResolutionRequestSourceSummary").value = JSON.stringify(settings.sourceSummary || {}, null, 2);
  }
  setSelectValue("identityResolutionRequestSuggestedArea", suggestedMatchType);
  if ($("identityResolutionRequestSuggestedReference")) $("identityResolutionRequestSuggestedReference").value = settings.suggestedMatchRecordId || "";
  if ($("identityResolutionRequestSuggestedDisplayLabel")) $("identityResolutionRequestSuggestedDisplayLabel").value = settings.suggestedMatchLabel || "";
  if ($("identityResolutionRequestSuggestedType")) $("identityResolutionRequestSuggestedType").value = suggestedMatchType;
  if ($("identityResolutionRequestSuggestedId")) $("identityResolutionRequestSuggestedId").value = settings.suggestedMatchRecordId || "";
  if ($("identityResolutionRequestSuggestedLabel")) $("identityResolutionRequestSuggestedLabel").value = settings.suggestedMatchLabel || "";
  if ($("identityResolutionRequestSuggestedSummary")) {
    $("identityResolutionRequestSuggestedSummary").value = JSON.stringify(settings.suggestedMatchSummary || {}, null, 2);
  }
  if ($("identityResolutionRequestContextType")) $("identityResolutionRequestContextType").value = settings.contextType || "";
  if ($("identityResolutionRequestContextId")) $("identityResolutionRequestContextId").value = settings.contextRecordId || "";
  if ($("identityResolutionRequestContextSummary")) {
    $("identityResolutionRequestContextSummary").value = JSON.stringify(settings.contextSummary || {}, null, 2);
  }
  if ($("identityResolutionRequestMetadata")) {
    $("identityResolutionRequestMetadata").value = JSON.stringify(settings.metadata || {}, null, 2);
  }
  const lockedContext = Boolean(settings.sourceType && settings.sourceRecordId && settings.contextType);
  if ($("identityResolutionRequestStandardSource")) {
    $("identityResolutionRequestStandardSource").classList.toggle("hidden", lockedContext);
  }
  renderCapturedRequestContext(settings);
}

function openRequestPanel(trigger, context) {
  if (!requireIdentityResolutionRequestAccess()) return;
  if (!requestPanelController) {
    showToast("Request panel unavailable", "Identity review request controls are not ready.", "error");
    return;
  }
  resetRequestForm();
  applyRequestContext(context);
  requestPanelController.open({
    trigger,
    title: "Request Identity Review",
    initialFocus: "identityResolutionRequestCandidateType"
  });
}

export function openIdentityReviewRequestFromContext(context, trigger) {
  openRequestPanel(trigger, context);
}

function isIdentityResolutionWorkspaceVisible() {
  const workspace = $("administrationWorkspace");
  const section = $("identityResolutionSection");
  return Boolean(
    workspace &&
    section &&
    !workspace.classList.contains("hidden") &&
    !section.classList.contains("hidden")
  );
}

function requestPayloadFromForm() {
  const advancedOpen = $("identityResolutionRequestAdvancedSection")?.open === true;
  if (!advancedOpen) syncStandardRequestFieldsToTechnical();
  const suggestedType = fieldValue("identityResolutionRequestSuggestedType");
  const suggestedId = fieldValue("identityResolutionRequestSuggestedId");
  return {
    candidateType: fieldValue("identityResolutionRequestCandidateType") || "person",
    reason: fieldValue("identityResolutionRequestReason"),
    requesterNotes: fieldValue("identityResolutionRequesterNotes"),
    sourceType: canonicalIdentitySourceType(fieldValue("identityResolutionRequestSourceType")),
    sourceId: fieldValue("identityResolutionRequestSourceId"),
    sourceLabel: fieldValue("identityResolutionRequestSourceLabel"),
    sourceSummary: safeJson(fieldValue("identityResolutionRequestSourceSummary"), {}),
    suggestedType: canonicalIdentitySourceType(suggestedType),
    suggestedId,
    suggestedLabel: fieldValue("identityResolutionRequestSuggestedLabel"),
    suggestedSummary: safeJson(fieldValue("identityResolutionRequestSuggestedSummary"), {}),
    contextType: fieldValue("identityResolutionRequestContextType"),
    contextId: fieldValue("identityResolutionRequestContextId"),
    contextSummary: safeJson(fieldValue("identityResolutionRequestContextSummary"), {}),
    metadata: safeJson(fieldValue("identityResolutionRequestMetadata"), {})
  };
}

async function saveIdentityReviewRequest(event) {
  event.preventDefault();
  if (!requireIdentityResolutionRequestAccess()) return;

  let payload;
  try {
    payload = requestPayloadFromForm();
  } catch (err) {
    showToast("Invalid JSON", err.message, "error");
    return;
  }

  if (!payload.reason) {
    showToast("Request reason required", "Enter why this source record needs identity review.", "error");
    return;
  }
  if (!payload.sourceType || !payload.sourceId) {
    showToast("Source record required", "Choose a source area and enter the known source reference.", "error");
    return;
  }
  if ((payload.suggestedType && !payload.suggestedId) || (!payload.suggestedType && payload.suggestedId)) {
    showToast("Suggested match incomplete", "Suggested match area and reference must be provided together.", "error");
    return;
  }
  if (
    payload.suggestedType &&
    normalisedSourceKey(payload.sourceType, payload.sourceId) === normalisedSourceKey(payload.suggestedType, payload.suggestedId)
  ) {
    showToast("Suggested match is the source", "Source record and suggested match must be different records.", "error");
    return;
  }

  const button = $("identityResolutionCreateRequestButton");
  button.disabled = true;
  button.textContent = "Creating...";
  try {
    const result = await supabaseClient.rpc("create_identity_resolution_request", {
      p_candidate_type: payload.candidateType,
      p_request_reason: payload.reason,
      p_requester_notes: payload.requesterNotes || null,
      p_source_type: payload.sourceType,
      p_source_record_id: payload.sourceId,
      p_source_label: payload.sourceLabel || null,
      p_source_summary: payload.sourceSummary,
      p_suggested_match_type: payload.suggestedType || null,
      p_suggested_match_record_id: payload.suggestedId || null,
      p_suggested_match_label: payload.suggestedLabel || null,
      p_suggested_match_summary: payload.suggestedSummary,
      p_context_type: payload.contextType || null,
      p_context_record_id: payload.contextId || null,
      p_context_summary: payload.contextSummary,
      p_metadata: payload.metadata
    });
    if (result.error) throw result.error;
    requestPanelController.close({ restoreFocus: false });
    showToast("Review request created", "The identity review request was created.", "success");
    await loadIdentityResolutionAdministration({ manual: false });
    if (result.data && result.data.id && isIdentityResolutionWorkspaceVisible()) {
      await openRequestDetail(result.data.id, $("identityResolutionNewRequestButton") || button);
    }
  } catch (err) {
    showToast("Review request not created", err.message || "Could not create the identity review request.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Create Review Request";
  }
}

function openCandidatePanel(trigger) {
  if (!requireIdentityResolutionManageAccess()) return;
  resetCandidateForm();
  candidatePanelController.open({
    trigger,
    title: "Advanced Manual Candidate",
    initialFocus: "identityResolutionFormCandidateType"
  });
}

async function saveCandidate(event) {
  event.preventDefault();
  if (!requireIdentityResolutionManageAccess()) return;

  const matchReason = fieldValue("identityResolutionFormMatchReason");
  const sourceAType = sourceTypeValue("identityResolutionFormSourceAType", "identityResolutionFormSourceATypeCustom");
  const sourceAId = fieldValue("identityResolutionFormSourceAId");
  const sourceBType = sourceTypeValue("identityResolutionFormSourceBType", "identityResolutionFormSourceBTypeCustom");
  const sourceBId = fieldValue("identityResolutionFormSourceBId");
  if (!sourceAType || !sourceAId || !sourceBType || !sourceBId) {
    showToast("Candidate needs sources", "Both source records require a type and record ID.", "error");
    return;
  }
  if (normalisedSourceKey(sourceAType, sourceAId) === normalisedSourceKey(sourceBType, sourceBId)) {
    showToast("Candidate compares one record", "Source A and Source B must refer to two different source records.", "error");
    return;
  }

  let sourceASummary;
  let sourceBSummary;
  let metadata;
  try {
    sourceASummary = safeJson(fieldValue("identityResolutionFormSourceASummary"));
    sourceBSummary = safeJson(fieldValue("identityResolutionFormSourceBSummary"));
    metadata = safeJson(fieldValue("identityResolutionFormMetadata"));
  } catch (err) {
    showToast("Invalid JSON", err.message, "error");
    return;
  }

  const scoreText = fieldValue("identityResolutionFormConfidence");
  const score = scoreText === "" ? null : Number(scoreText);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    showToast("Invalid confidence score", "Confidence score must be between 0 and 100.", "error");
    return;
  }

  const sourceALabel = fieldValue("identityResolutionFormSourceALabel");
  const sourceBLabel = fieldValue("identityResolutionFormSourceBLabel");
  if (!matchReason || !sourceALabel || !sourceBLabel) {
    const confirmed = await requestPlatformConfirmation({
      title: "Create Manual Candidate",
      message: "This candidate is easier to review with a match reason and readable labels for both source records. Continue with the current advanced manual entry?",
      confirmText: "Create Manual Candidate",
      cancelText: "Review Details"
    });
    if (!confirmed) return;
  }

  const button = $("identityResolutionCreateCandidateButton");
  button.disabled = true;
  button.textContent = "Creating...";
  try {
    const result = await supabaseClient.rpc("create_identity_resolution_candidate", {
      p_candidate_type: fieldValue("identityResolutionFormCandidateType"),
      p_match_reason: matchReason,
      p_confidence_score: score,
      p_source_a_type: sourceAType,
      p_source_a_record_id: sourceAId,
      p_source_a_label: sourceALabel || null,
      p_source_a_summary: sourceASummary,
      p_source_b_type: sourceBType,
      p_source_b_record_id: sourceBId,
      p_source_b_label: sourceBLabel || null,
      p_source_b_summary: sourceBSummary,
      p_suggested_by: fieldValue("identityResolutionFormSuggestedBy") || "manual",
      p_metadata: metadata
    });
    if (result.error) throw result.error;
    candidatePanelController.close({ restoreFocus: false });
    showToast("Candidate created", "The possible match candidate was added to the queue.", "success");
    await loadIdentityResolutionAdministration({ manual: false });
  } catch (err) {
    showToast("Candidate not created", err.message || "Could not create identity resolution candidate.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Create Manual Candidate";
  }
}

function openDecisionPanel(candidate, decisionType, trigger) {
  if (!requireIdentityResolutionManageAccess()) return;
  const selected = candidate || selectedCandidate;
  if (!selected) {
    showToast("Select a candidate", "Open a candidate before recording a decision.", "error");
    return;
  }
  $("identityResolutionDecisionCandidateId").value = selected.id;
  $("identityResolutionDecisionType").value = decisionType;
  $("identityResolutionDecisionReason").value = "";
  $("identityResolutionDecisionCanonicalLabel").value = selected.source_a_label || selected.source_b_label || "";
  $("identityResolutionDecisionMetadata").value = "{}";
  $("identityResolutionDecisionContext").textContent =
    decisionLabel(decisionType) + " for " + textOrDash(selected.candidate_reference) +
    ". Source records will not be modified.";
  $("identityResolutionCanonicalLabelField").classList.toggle("hidden", decisionType !== "confirmed");
  $("identityResolutionSaveDecisionButton").textContent = decisionLabel(decisionType);
  decisionPanelController.open({
    trigger,
    title: decisionLabel(decisionType),
    initialFocus: "identityResolutionDecisionReason"
  });
}

async function saveDecision(event) {
  event.preventDefault();
  if (!requireIdentityResolutionManageAccess()) return;

  const candidateId = fieldValue("identityResolutionDecisionCandidateId");
  const decisionType = fieldValue("identityResolutionDecisionType");
  const reason = fieldValue("identityResolutionDecisionReason");
  if ((decisionType === "confirmed" || decisionType === "rejected") && !reason) {
    showToast("Decision needs reason", "Enter a reason before saving this decision.", "error");
    return;
  }

  let metadata;
  try {
    metadata = safeJson(fieldValue("identityResolutionDecisionMetadata"));
  } catch (err) {
    showToast("Invalid JSON", err.message, "error");
    return;
  }

  const confirmed = await requestPlatformConfirmation({
    title: decisionLabel(decisionType),
    message: decisionType === "confirmed"
      ? "Confirming creates identity-link metadata only. Source records will not be modified, merged or rewritten."
      : "This records a decision history entry. Source records will not be modified or deleted.",
    confirmText: decisionLabel(decisionType),
    cancelText: "Cancel",
    danger: decisionType === "rejected" || decisionType === "ignored"
  });
  if (!confirmed) return;

  const button = $("identityResolutionSaveDecisionButton");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await supabaseClient.rpc("decide_identity_resolution_candidate", {
      p_candidate_id: candidateId,
      p_decision_type: decisionType,
      p_decision_reason: reason || null,
      p_canonical_label: decisionType === "confirmed" ? fieldValue("identityResolutionDecisionCanonicalLabel") || null : null,
      p_metadata: metadata
    });
    if (result.error) throw result.error;
    decisionPanelController.close({ restoreFocus: false });
    if (detailPanelController && detailPanelController.isOpen()) {
      detailPanelController.close({ restoreFocus: false });
    }
    showToast("Decision recorded", "The identity resolution decision was saved.", "success");
    await loadIdentityResolutionAdministration({ manual: false });
  } catch (err) {
    showToast("Decision not saved", err.message || "Could not save this identity resolution decision.", "error");
  } finally {
    button.disabled = false;
    button.textContent = decisionLabel(decisionType);
  }
}

export async function loadIdentityResolutionAdministration(options) {
  if (!requireIdentityResolutionAccess()) return;
  const settings = options || {};
  setManageControls();
  try {
    const work = [
      loadOverviewData(),
      loadReviewRequests()
    ];
    if (canViewIdentityResolutionRecords()) {
      work.push(
        loadCandidateQueue(),
        loadConfirmedLinks(),
        loadDecisionHistory()
      );
    } else {
      identityCandidates = [];
      identityLinks = [];
      identityDecisions = [];
    }
    await Promise.all(work);
    refreshSectionNavigator("identity-resolution");
  } catch (err) {
    renderEmpty("identityResolutionCandidateEmpty", {
      title: "Identity Resolution unavailable",
      description: "The queue could not be loaded under current permissions."
    });
    if (settings.manual) {
      showToast("Identity Resolution not loaded", err.message || "Could not load identity resolution data.", "error");
    } else {
      showToast("Identity Resolution unavailable", err.message || "Could not load identity resolution data.", "error");
    }
  }
}

export async function openIdentityResolutionAdministration() {
  syncIdentityResolutionVisibility();
  if (!requireIdentityResolutionAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("identityResolution");
  refreshSectionNavigator("identity-resolution");
  await loadIdentityResolutionAdministration({ manual: false });
}

export function syncIdentityResolutionVisibility() {
  const visible = canViewIdentityResolution();
  const nav = $("administrationIdentityResolutionNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  if (!visible && $("identityResolutionSection") && !$("identityResolutionSection").classList.contains("hidden")) {
    if (hasAnyCapability(["settings.view", "settings.edit"])) setAdministrationSection("reference");
    else if (hasAnyCapability(["privacy.view", "privacy.manage", "gdpr.manage"])) setAdministrationSection("privacyGdpr");
    else if (hasAnyCapability(["module_configuration.view", "module_configuration.manage"])) setAdministrationSection("modules");
    else if (hasAnyCapability(["access_control.view", "access_control.manage"])) setAdministrationSection("access");
  }
  setManageControls();
  refreshSectionNavigator("identity-resolution");
}

export function initialiseIdentityResolutionAdministration() {
  if (identityResolutionInitialised) return;
  identityResolutionInitialised = true;

  registerIdentityResolutionSections();
  detailPanelController = createSidePanelController({
    backdrop: "identityResolutionDetailPanelBackdrop",
    panel: "identityResolutionDetailPanel",
    title: "identityResolutionDetailPanelTitle",
    closeTriggers: ["identityResolutionDetailPanelClose"]
  });
  candidatePanelController = createSidePanelController({
    backdrop: "identityResolutionCandidatePanelBackdrop",
    panel: "identityResolutionCandidatePanel",
    title: "identityResolutionCandidatePanelTitle",
    closeTriggers: ["identityResolutionCandidatePanelClose", "identityResolutionCandidateCancelButton"],
    reset: resetCandidateForm
  });
  requestPanelController = createSidePanelController({
    backdrop: "identityResolutionRequestPanelBackdrop",
    panel: "identityResolutionRequestPanel",
    title: "identityResolutionRequestPanelTitle",
    closeTriggers: ["identityResolutionRequestPanelClose", "identityResolutionRequestCancelButton"],
    reset: resetRequestForm
  });
  decisionPanelController = createSidePanelController({
    backdrop: "identityResolutionDecisionPanelBackdrop",
    panel: "identityResolutionDecisionPanel",
    title: "identityResolutionDecisionPanelTitle",
    closeTriggers: ["identityResolutionDecisionPanelClose", "identityResolutionDecisionCancelButton"]
  });

  if ($("administrationIdentityResolutionNav")) {
    $("administrationIdentityResolutionNav").addEventListener("click", openIdentityResolutionAdministration);
  }
  if ($("identityResolutionRefreshButton")) {
    $("identityResolutionRefreshButton").addEventListener("click", () => loadIdentityResolutionAdministration({ manual: true }));
  }
  if ($("identityResolutionNewCandidateButton")) {
    $("identityResolutionNewCandidateButton").addEventListener("click", event => openCandidatePanel(event.currentTarget));
  }
  if ($("identityResolutionNewRequestButton")) {
    $("identityResolutionNewRequestButton").addEventListener("click", event => openRequestPanel(event.currentTarget));
  }
  [
    ["identityResolutionFormSourceAType", "identityResolutionFormSourceATypeCustomField", "identityResolutionFormSourceATypeCustom"],
    ["identityResolutionFormSourceBType", "identityResolutionFormSourceBTypeCustomField", "identityResolutionFormSourceBTypeCustom"]
  ].forEach(([selectId, customFieldId, customInputId]) => {
    if ($(selectId)) {
      $(selectId).addEventListener("change", () => syncSourceTypeCustomField(selectId, customFieldId, customInputId));
      syncSourceTypeCustomField(selectId, customFieldId, customInputId);
    }
  });
  if ($("identityResolutionApplyFiltersButton")) {
    $("identityResolutionApplyFiltersButton").addEventListener("click", () => loadIdentityResolutionAdministration({ manual: true }));
  }
  if ($("identityResolutionResetFiltersButton")) {
    $("identityResolutionResetFiltersButton").addEventListener("click", () => {
      $("identityResolutionCandidateSearch").value = "";
      $("identityResolutionCandidateStatus").value = "pending";
      $("identityResolutionCandidateType").value = "all";
      $("identityResolutionCandidateLimit").value = "50";
      loadIdentityResolutionAdministration({ manual: true });
    });
  }
  if ($("identityResolutionApplyRequestFiltersButton")) {
    $("identityResolutionApplyRequestFiltersButton").addEventListener("click", () => loadIdentityResolutionAdministration({ manual: true }));
  }
  if ($("identityResolutionResetRequestFiltersButton")) {
    $("identityResolutionResetRequestFiltersButton").addEventListener("click", () => {
      $("identityResolutionRequestSearch").value = "";
      $("identityResolutionRequestStatus").value = "pending";
      $("identityResolutionRequestType").value = "all";
      $("identityResolutionRequestLimit").value = "50";
      loadIdentityResolutionAdministration({ manual: true });
    });
  }
  if ($("identityResolutionApplyLinkFiltersButton")) {
    $("identityResolutionApplyLinkFiltersButton").addEventListener("click", () => loadIdentityResolutionAdministration({ manual: true }));
  }
  if ($("identityResolutionResetLinkFiltersButton")) {
    $("identityResolutionResetLinkFiltersButton").addEventListener("click", () => {
      $("identityResolutionLinkSearch").value = "";
      $("identityResolutionLinkType").value = "all";
      $("identityResolutionLinkStatus").value = "active";
      $("identityResolutionLinkLimit").value = "50";
      loadIdentityResolutionAdministration({ manual: true });
    });
  }
  if ($("identityResolutionCandidateForm")) {
    $("identityResolutionCandidateForm").addEventListener("submit", saveCandidate);
  }
  if ($("identityResolutionRequestForm")) {
    $("identityResolutionRequestForm").addEventListener("submit", saveIdentityReviewRequest);
  }
  [
    "identityResolutionRequestSourceArea",
    "identityResolutionRequestSourceReference",
    "identityResolutionRequestSourceDisplayLabel",
    "identityResolutionRequestSuggestedArea",
    "identityResolutionRequestSuggestedReference",
    "identityResolutionRequestSuggestedDisplayLabel"
  ].forEach(id => {
    if ($(id)) $(id).addEventListener("input", syncStandardRequestFieldsToTechnical);
    if ($(id)) $(id).addEventListener("change", syncStandardRequestFieldsToTechnical);
  });
  if ($("identityResolutionDecisionForm")) {
    $("identityResolutionDecisionForm").addEventListener("submit", saveDecision);
  }
  [
    ["identityResolutionDetailConfirmButton", "confirmed"],
    ["identityResolutionDetailRejectButton", "rejected"],
    ["identityResolutionDetailDeferButton", "deferred"],
    ["identityResolutionDetailIgnoreButton", "ignored"]
  ].forEach(([id, decisionType]) => {
    if ($(id)) $(id).addEventListener("click", event => openDecisionPanel(selectedCandidate, decisionType, event.currentTarget));
  });

  window.addEventListener("oh:capabilities-changed", syncIdentityResolutionVisibility);
  syncIdentityResolutionVisibility();
}
