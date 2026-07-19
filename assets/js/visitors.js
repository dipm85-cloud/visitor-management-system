import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { settingValue } from "./settings.js";
import { buildFieldDiff, auditDiffSummary, writeAuditEvent } from "./audit.js";
import {
  getPlannedVisitStatusMap,
  plannedVisitDisplayStatus,
  plannedVisitStatusLabel
} from "./plannedVisits.js";
import { resetVisitorIdentitySelection } from "./visitorIdentity.js";
import {
  exportDateStamp,
  formatPersonName,
  normalisePlate,
  todayDate
} from "./utils.js";
import {
  downloadCsv,
  downloadXlsx,
  exportToExcel,
  normaliseExportRows
} from "./exports.js";
import {
  buildDailyPlannedVisitorPrintHtml,
  openPrintDocument
} from "./printing.js";
import {
  refreshSectionNavigator,
  registerModuleSections,
  selectModuleSection
} from "./sectionNavigation.js";
import {
  createDetailActions,
  createOperationalFormReset,
  createSidePanelController,
  requestPlatformConfirmation
} from "./platformUi.js";
import {
  canViewDocumentSignoffs,
  initialiseDocumentSignoffs,
  loadDocumentSignoffOverview,
  syncDocumentSignoffVisibility
} from "./documentSignoffs.js";
import { openIdentityReviewRequestFromContext } from "./identityResolutionAdmin.js";
import {
  getLinkedIdentityActiveVisitConflict,
  renderLinkedIdentityContext
} from "./identityContext.js";
import {
  applyFormRequirementIndicators,
  missingRequirementMessage,
  validateFormRequirements
} from "./formRequirements.js";

let visitorsDependencies = {};
let nativePlannedVisits = [];
let nativePlannedFilteredRows = [];
let nativePlannedLoadSequence = 0;
let nativePlannedVisitsLoaded = false;
let nativeActiveVisitors = [];
let nativeActiveFilteredRows = [];
let nativeActiveLoadSequence = 0;
let nativeHistoryRecords = [];
let nativeHistoryFilteredRows = [];
let nativeHistoryLoadSequence = 0;
let activeHistoryQuickFilter = null;
let selectedNativeReportType = "history";
let nativeReportRows = [];
let plannedPanelController = null;
let walkInPanelController = null;
let detailsPanelController = null;
let resetPlannedPanelForm = null;
let resetWalkInPanelForm = null;

const NATIVE_WALK_IN_REQUIREMENT_MAPPINGS = {
  visitor_name: { inputId: "visitorsWalkInVisitorName", nativeRequired: true },
  company: { inputId: "visitorsWalkInCompany" },
  reason: { inputId: "visitorsWalkInReason" },
  vehicle_registration: { inputId: "visitorsWalkInVehicle" },
  on_site_contact: { inputId: "visitorsWalkInContact" },
  security_pass_id: { inputId: "visitorsWalkInPass" }
};

const NATIVE_PLANNED_REQUIREMENT_MAPPINGS = {
  visitor_name: { inputId: "visitorsPlannedVisitorName", nativeRequired: true },
  visit_date: { inputId: "visitorsPlannedVisitDate", nativeRequired: true },
  company: { inputId: "visitorsPlannedCompany" },
  expected_time: { inputId: "visitorsPlannedExpectedTime" },
  reason: { inputId: "visitorsPlannedReason" },
  vehicle_registration: { inputId: "visitorsPlannedVehicle" },
  on_site_contact: { inputId: "visitorsPlannedContact" }
};

const plannedFieldDefaults = {
  reason: { visible: true, required: false },
  vehicle: { visible: true, required: false },
  contact: { visible: true, required: true },
  pass: { visible: false, required: false }
};

const walkInFieldDefaults = {
  company: { visible: true, required: false },
  reason: { visible: true, required: false },
  vehicle: { visible: true, required: false },
  contact: { visible: true, required: false },
  pass: { visible: true, required: false }
};

const IDENTITY_REVIEW_REQUEST_CAPABILITIES = [
  "identity_resolution.request",
  "identity_resolution.manage",
  "privacy.manage",
  "gdpr.manage",
  "module_configuration.manage",
  "settings.edit"
];

function isActiveStaffUser() {
  return AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setVisible(id, visible) {
  const element = $(id);
  if (element) element.classList.toggle("hidden", !visible);
}

function setResultCount(id, count, label, total) {
  const suffix = count === 1 ? label : label + "s";
  const text = total != null && total !== count
    ? count + " of " + total + " " + suffix
    : count + " " + suffix;
  setText(id, text);
}

function searchTextFromRecord(record, fields) {
  return fields.map(field => record && record[field]).filter(Boolean).join(" ").toLowerCase();
}

function canViewVisitorsWorkspace() {
  return isActiveStaffUser() && hasCapability("visitor.view");
}

function canViewVisitorHistory() {
  return canViewVisitorsWorkspace() && hasCapability("visitor.history.view");
}

function canViewVisitorReporting() {
  return canViewVisitorHistory() && hasCapability("reports.view");
}

function canRequestIdentityReviewFromVisitors() {
  return isActiveStaffUser() && hasAnyCapability(IDENTITY_REVIEW_REQUEST_CAPABILITIES);
}

function canOpenVisitorConfiguration() {
  return canViewVisitorsWorkspace() && hasAnyCapability([
    "module_configuration.view",
    "module_configuration.manage"
  ]);
}

function hasVisitorQuickActions() {
  return canViewVisitorsWorkspace() && (
    (hasCapability("visitor.create") && hasCapability("visitor.sign_in")) ||
    hasCapability("visitor.sign_in") ||
    hasCapability("visitor.sign_out")
  );
}

function registerVisitorsSectionNavigation() {
  registerModuleSections("visitors", [
    {
      id: "overview",
      title: "Overview",
      icon: "O",
      target: "visitorsDashboardSection",
      order: 10,
      default: true,
      visible: canViewVisitorsWorkspace
    },
    {
      id: "quick-actions",
      title: "Quick Actions",
      icon: "QA",
      target: "visitorsQuickActionsSection",
      order: 20,
      visible: hasVisitorQuickActions
    },
    {
      id: "planned-visits",
      title: "Planned Visits",
      icon: "P",
      target: "visitorsPlannedSection",
      order: 30,
      visible: canViewVisitorsWorkspace
    },
    {
      id: "current-visitors",
      title: "Current Visitors",
      icon: "C",
      target: "visitorsOnSiteSection",
      order: 40,
      visible: canViewVisitorsWorkspace
    },
    {
      id: "visitor-history",
      title: "Visitor History",
      icon: "H",
      target: "visitorsHistorySection",
      order: 50,
      visible: canViewVisitorHistory
    },
    {
      id: "reporting",
      title: "Reporting",
      icon: "R",
      target: "visitorsReportingSection",
      order: 60,
      visible: canViewVisitorReporting
    },
    {
      id: "document-signoffs",
      title: "Document Sign-offs",
      icon: "DS",
      target: "visitorsDocumentSignoffsSection",
      order: 65,
      visible: canViewDocumentSignoffs
    },
    {
      id: "operational-documents",
      title: "Operational Documents",
      icon: "OD",
      target: "visitorsOperationalDocumentsSection",
      order: 70,
      visible: canViewVisitorReporting
    },
    {
      id: "configuration",
      title: "Configuration",
      icon: "CFG",
      target: "visitorsConfigurationSection",
      order: 80,
      visible: canOpenVisitorConfiguration
    }
  ], {
    root: "visitorsWorkspace",
    content: "visitorsWorkspaceContent",
    defaultSection: "overview",
    scrollRoot: "operationsHubWorkspace",
    label: "Visitors section navigation",
    title: "Sections",
    toggleLabel: "Visitor sections"
  });
}

function settingIsTrue(key, fallback) {
  const value = settingValue(key, fallback);
  return value === true || value === "true";
}

function fieldRule(field, kind) {
  return settingIsTrue(
    "planned_" + field + "_" + kind,
    plannedFieldDefaults[field][kind]
  );
}

function walkInFieldRule(field, kind) {
  return settingIsTrue(
    "walkin_" + field + "_" + kind,
    walkInFieldDefaults[field][kind]
  );
}

function textOrDash(value) {
  const text = String(value || "").trim();
  return text || "—";
}

function plannedStatusFor(visit) {
  const status = visit.native_status || plannedVisitDisplayStatus(visit);
  return status === "planned" ? "pending" : status;
}

function plannedStatusLabel(status) {
  if (status === "pending") return "Planned";
  if (status === "signed_in") return "Signed In";
  if (status === "signed_out") return "Signed Out";
  return plannedVisitStatusLabel({ status });
}

function isActivePlannedStatus(status) {
  return status === "pending" || status === "signed_in";
}

function isSuperUserRecoveryAllowed(visit) {
  return AppState.currentProfile &&
    AppState.currentProfile.role === "super_user" &&
    hasCapability("visitor.edit") &&
    hasCapability("visitor.delete") &&
    plannedStatusFor(visit) === "pending";
}

function setPlannedListState(state) {
  setVisible("visitorsPlannedLoading", state === "loading");
  setVisible("visitorsPlannedError", state === "error");
  setVisible("visitorsPlannedEmpty", state === "empty");
  setVisible("visitorsPlannedResultCount", state === "ready" || state === "empty");
  setVisible("visitorsPlannedTableWrap", state === "ready");
  setVisible("visitorsPlannedCards", state === "ready");
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

function createVisitorResultCard(options) {
  const settings = options || {};
  const card = document.createElement("article");
  card.className = "oh-result-card";
  if (settings.ariaLabel) card.setAttribute("aria-label", settings.ariaLabel);

  const header = document.createElement("div");
  header.className = "oh-result-card-header";

  const titleBlock = document.createElement("div");
  const title = document.createElement("strong");
  title.className = "oh-result-card-title";
  title.textContent = textOrDash(settings.title);
  titleBlock.appendChild(title);

  if (settings.meta) {
    const meta = document.createElement("span");
    meta.className = "oh-result-card-meta";
    meta.textContent = settings.meta;
    titleBlock.appendChild(meta);
  }
  header.appendChild(titleBlock);

  if (settings.statusLabel) {
    const status = document.createElement("span");
    status.className = "visitors-planned-status " + (settings.statusClass || "");
    status.textContent = settings.statusLabel;
    header.appendChild(status);
  }

  const fields = document.createElement("div");
  fields.className = "oh-result-card-fields";
  const actions = document.createElement("div");
  actions.className = "oh-result-card-actions";

  card.append(header, fields, actions);
  return { card, fields, actions };
}

function appendResultCardField(container, label, value) {
  if (!container) return;
  const field = document.createElement("div");
  field.className = "oh-result-card-field";
  const fieldLabel = document.createElement("span");
  fieldLabel.textContent = label;
  const fieldValue = document.createElement("strong");
  fieldValue.textContent = textOrDash(value);
  field.append(fieldLabel, fieldValue);
  container.appendChild(field);
}

function appendResultCardAction(container, label, className, onClick) {
  if (!container) return null;
  const button = document.createElement("button");
  button.type = "button";
  if (className) button.className = className;
  button.textContent = label;
  button.addEventListener("click", event => onClick(button, event));
  container.appendChild(button);
  return button;
}

function canOpenFullPlannedEdit(visit) {
  if (AppState.currentProfile && AppState.currentProfile.role === "super_user") return true;
  return plannedStatusFor(visit) === "pending";
}

function editModeForCurrentUser() {
  return AppState.currentProfile && AppState.currentProfile.role === "security"
    ? "security"
    : "full";
}

function appendPlannedVisitActions(container, visit, visitStatus) {
  const mode = editModeForCurrentUser();
  if (
    visitStatus === "pending" &&
    visit.visit_date === todayDate() &&
    hasCapability("visitor.sign_in")
  ) {
    appendResultCardAction(
      container,
      "Sign In",
      "",
      button => signInNativePlannedVisit(visit, button)
    );
  }
  appendResultCardAction(
    container,
    "View Details",
    "secondary",
    button => openVisitorDetails(visit, visitStatus, button)
  );
  if (
    hasCapability("visitor.edit") &&
    (mode === "security" || canOpenFullPlannedEdit(visit))
  ) {
    appendResultCardAction(
      container,
      mode === "security" ? "Edit Pass ID" : "Edit",
      "secondary",
      button => openPlannedPanel(visit, mode, button)
    );
  } else if (hasCapability("visitor.edit") && plannedStatusFor(visit) !== "pending") {
    const locked = document.createElement("span");
    locked.className = "visitors-planned-table-secondary";
    locked.textContent = "Locked after sign-in";
    container.appendChild(locked);
  }
  if (isSuperUserRecoveryAllowed(visit)) {
    appendResultCardAction(
      container,
      "Cancel Visit",
      "danger",
      button => cancelNativePlannedVisit(visit, button)
    );
  }
}

function appendActiveVisitorActions(container, visit, status) {
  appendResultCardAction(
    container,
    "View Details",
    "secondary",
    button => openVisitorDetails(visit, status, button)
  );
  if (hasCapability("visitor.sign_out")) {
    appendResultCardAction(
      container,
      "Sign Out",
      "danger",
      button => signOutNativeVisitor(visit, button)
    );
  }
}

function renderNativePlannedVisits() {
  const body = $("visitorsPlannedTableBody");
  if (!body) return;
  body.replaceChildren();
  const cards = $("visitorsPlannedCards");
  if (cards) cards.replaceChildren();

  const search = String($("visitorsPlannedSearch").value || "").trim().toLowerCase();
  const date = $("visitorsPlannedDateFilter").value;
  const status = $("visitorsPlannedStatusFilter").value;
  const filtered = nativePlannedVisits.filter(visit => {
    const searchable = searchTextFromRecord(visit, [
      "id",
      "planned_visit_id",
      "visitor_name",
      "company",
      "onsite_contact",
      "visit_reason",
      "vehicle_plate",
      "security_pass_id",
      "host_id",
      "created_by",
      "modified_by"
    ]);
    const visitStatus = plannedStatusFor(visit);
    const statusMatches =
      status === "all" ||
      (status === "active" && isActivePlannedStatus(visitStatus)) ||
      (status === "inactive" && !isActivePlannedStatus(visitStatus)) ||
      visitStatus === status;
    return (!search || searchable.includes(search)) &&
      (!date || visit.visit_date === date) &&
      statusMatches;
  });
  nativePlannedFilteredRows = filtered;
  setResultCount("visitorsPlannedResultCount", filtered.length, "record", nativePlannedVisits.length);

  if (!filtered.length) {
    setPlannedListState("empty");
    return;
  }

  filtered.forEach(visit => {
    const row = document.createElement("tr");
    appendTextCell(row, visit.visitor_name, visit.company || "");
    appendTextCell(
      row,
      visit.visit_date,
      visit.expected_time ? String(visit.expected_time).slice(0, 5) : "Time not set"
    );
    appendTextCell(row, visit.onsite_contact);
    appendTextCell(row, visit.visit_reason);
    appendTextCell(row, visit.vehicle_plate);

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    const visitStatus = plannedStatusFor(visit);
    statusBadge.className = "visitors-planned-status " +
      (visitStatus === "signed_in"
        ? "status-in"
        : isActivePlannedStatus(visitStatus)
          ? ""
          : "status-inactive");
    statusBadge.textContent = plannedStatusLabel(visitStatus);
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "visitors-planned-row-action";
    appendPlannedVisitActions(actionCell, visit, visitStatus);
    row.appendChild(actionCell);
    body.appendChild(row);

    if (cards) {
      const expectedTime = visit.expected_time ? String(visit.expected_time).slice(0, 5) : "Time not set";
      const result = createVisitorResultCard({
        title: visit.visitor_name,
        meta: [visit.company, visit.visit_date, expectedTime].filter(Boolean).join(" • "),
        statusLabel: plannedStatusLabel(visitStatus),
        statusClass: statusBadge.className.replace("visitors-planned-status", "").trim(),
        ariaLabel: "Planned visit for " + textOrDash(visit.visitor_name)
      });
      appendResultCardField(result.fields, "Date and time", visit.visit_date + " · " + expectedTime);
      appendResultCardField(result.fields, "Host / contact", visit.onsite_contact);
      appendResultCardField(result.fields, "Reason", visit.visit_reason);
      appendResultCardField(result.fields, "Vehicle", visit.vehicle_plate);
      appendPlannedVisitActions(result.actions, visit, visitStatus);
      cards.appendChild(result.card);
    }
  });

  setPlannedListState("ready");
}

function activeVisitorStatus(visit) {
  if (!visit || !visit.sign_in_time) return "signed_in";
  const signedInAt = new Date(visit.sign_in_time).getTime();
  const todayStartedAt = new Date(localDayBounds().start).getTime();
  return signedInAt < todayStartedAt ? "overdue" : "signed_in";
}

function activeVisitorStatusLabel(status) {
  return status === "overdue" ? "Overdue" : "Signed In";
}

function visitorOrigin(record) {
  return record.visit_origin || (record.planned_visit_id || record.visit_date ? "planned" : "walk_in");
}

function setActiveListState(state) {
  setVisible("visitorsOnSiteLoading", state === "loading");
  setVisible("visitorsOnSiteError", state === "error");
  setVisible("visitorsOnSiteEmpty", state === "empty");
  setVisible("visitorsOnSiteResultCount", state === "ready" || state === "empty");
  setVisible("visitorsOnSiteTableWrap", state === "ready");
  setVisible("visitorsOnSiteCards", state === "ready");
}

function renderNativeActiveVisitors() {
  const body = $("visitorsOnSiteTableBody");
  if (!body) return;
  body.replaceChildren();
  const cards = $("visitorsOnSiteCards");
  if (cards) cards.replaceChildren();
  const search = String($("visitorsOnSiteSearch").value || "").trim().toLowerCase();
  const statusFilter = $("visitorsOnSiteStatusFilter").value;
  const filtered = nativeActiveVisitors.filter(visit => {
    const status = activeVisitorStatus(visit);
    const searchable = searchTextFromRecord(visit, [
      "id",
      "planned_visit_id",
      "visitor_name",
      "company",
      "onsite_contact",
      "security_pass_id",
      "vehicle_plate",
      "visit_reason"
    ]);
    return (!search || searchable.includes(search)) &&
      (statusFilter === "all" || statusFilter === status);
  });
  nativeActiveFilteredRows = filtered;
  setText(
    "visitorsOnSiteResultCount",
    (nativeActiveVisitors.length !== filtered.length
      ? filtered.length + " of " + nativeActiveVisitors.length
      : String(filtered.length)) + " currently signed in"
  );

  if (!filtered.length) {
    setActiveListState("empty");
    return;
  }

  filtered.forEach(visit => {
    const row = document.createElement("tr");
    const activeConflict = visit.linked_identity_active_visit_conflict;
    appendTextCell(
      row,
      visit.visitor_name,
      activeConflict && activeConflict.hasConflict
        ? [visit.company, "Possible duplicate active visit: this confirmed identity has more than one currently signed-in visit."]
          .filter(Boolean)
          .join(" | ")
        : visit.company || ""
    );
    appendTextCell(
      row,
      visit.sign_in_time ? new Date(visit.sign_in_time).toLocaleString() : null
    );
    appendTextCell(row, visit.onsite_contact);
    appendTextCell(
      row,
      visitorOrigin(visit) === "walk_in" ? "Walk-in" : "Planned"
    );

    const status = activeVisitorStatus(visit);
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "visitors-planned-status " +
      (status === "overdue" ? "status-overdue" : "status-in");
    badge.textContent = activeVisitorStatusLabel(status);
    statusCell.appendChild(badge);
    if (activeConflict && activeConflict.hasConflict) {
      const warning = document.createElement("span");
      warning.className = "visitors-planned-status status-overdue";
      warning.textContent = activeConflict.activeVisitCount + " active visits";
      statusCell.appendChild(warning);
    }
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "visitors-planned-row-action";
    appendActiveVisitorActions(actionCell, visit, status);
    row.appendChild(actionCell);
    body.appendChild(row);

    if (cards) {
      const signedInAt = visit.sign_in_time ? new Date(visit.sign_in_time).toLocaleString() : "";
      const result = createVisitorResultCard({
        title: visit.visitor_name,
        meta: [visit.company, signedInAt].filter(Boolean).join(" • "),
        statusLabel: activeVisitorStatusLabel(status),
        statusClass: badge.className.replace("visitors-planned-status", "").trim(),
        ariaLabel: "Current visitor " + textOrDash(visit.visitor_name)
      });
      appendResultCardField(result.fields, "Signed in", signedInAt);
      appendResultCardField(result.fields, "Host / contact", visit.onsite_contact);
      appendResultCardField(result.fields, "Origin", visitorOrigin(visit) === "walk_in" ? "Walk-in" : "Planned");
      appendResultCardField(result.fields, "Pass ID", visit.security_pass_id);
      if (activeConflict && activeConflict.hasConflict) {
        appendResultCardField(
          result.fields,
          "Identity warning",
          "Another active visit exists for this confirmed identity. Review linked records before proceeding."
        );
      }
      appendActiveVisitorActions(result.actions, visit, status);
      cards.appendChild(result.card);
    }
  });

  setActiveListState("ready");
}

async function addActiveVisitIdentityConflictContext(visits) {
  const rows = Array.isArray(visits) ? visits : [];
  return Promise.all(rows.map(async visit => {
    if (!visit || !visit.id) return visit;
    try {
      const conflict = await getLinkedIdentityActiveVisitConflict("visit_log", visit.id);
      return {
        ...visit,
        linked_identity_active_visit_conflict: conflict
      };
    } catch (error) {
      console.warn("Could not check linked identity active visit conflict.", error);
      return visit;
    }
  }));
}

async function loadNativeActiveVisitors() {
  if (!isActiveStaffUser() || !hasCapability("visitor.view")) return;
  const loadSequence = ++nativeActiveLoadSequence;
  setActiveListState("loading");
  const result = await supabaseClient
    .from("visit_log")
    .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin")
    .is("sign_out_time", null)
    .order("sign_in_time", { ascending: true });
  if (loadSequence !== nativeActiveLoadSequence) return;
  if (result.error) {
    nativeActiveVisitors = [];
    setActiveListState("error");
    showToast("Active visitors unavailable", "The currently on-site list could not be loaded.", "error");
    console.error("[OH-029 active visitors load failed]", result.error);
    return;
  }
  nativeActiveVisitors = await addActiveVisitIdentityConflictContext(result.data || []);
  if (loadSequence !== nativeActiveLoadSequence) return;
  renderNativeActiveVisitors();
}

function historyRecordStatus(record) {
  if (record.sign_out_time) return "signed_out";
  if (record.sign_in_time) return activeVisitorStatus(record);
  const status = plannedVisitDisplayStatus(record);
  return status === "pending" ? "planned" : status;
}

function historyStatusLabel(status) {
  if (status === "overdue") return "Overdue";
  if (status === "planned") return "Planned";
  if (status === "no_show") return "No-show";
  return plannedStatusLabel(status);
}

function historyStatusClass(status) {
  if (status === "overdue") return "status-overdue";
  if (status === "signed_in") return "status-in";
  if (status === "no_show") return "status-no-show";
  if (status === "signed_out") return "status-inactive";
  if (["cancelled", "closed", "completed", "inactive"].includes(status)) return "status-inactive";
  return "";
}

function historyRecordDate(record) {
  if (record.visit_date) return String(record.visit_date).slice(0, 10);
  if (record.sign_in_time) return String(record.sign_in_time).slice(0, 10);
  return "";
}

function historySortValue(record) {
  return record.sign_in_time ||
    (historyRecordDate(record) + "T" + (record.expected_time || "00:00:00"));
}

function mergeNativeHistoryRecords(logs, plannedVisits) {
  const plannedById = new Map(
    (plannedVisits || []).map(visit => [visit.id, visit])
  );
  const startedPlannedIds = new Set();
  const records = (logs || []).map(log => {
    const plannedVisit = log.planned_visit_id
      ? plannedById.get(log.planned_visit_id)
      : null;
    if (log.planned_visit_id) startedPlannedIds.add(log.planned_visit_id);
    return {
      ...(plannedVisit || {}),
      ...log,
      visit_date: plannedVisit && plannedVisit.visit_date
        ? plannedVisit.visit_date
        : historyRecordDate(log),
      expected_time: plannedVisit ? plannedVisit.expected_time : null,
      notes: plannedVisit ? plannedVisit.notes : null,
      history_record_type: "visit_log"
    };
  });

  (plannedVisits || []).forEach(visit => {
    if (startedPlannedIds.has(visit.id)) return;
    records.push({
      ...visit,
      planned_visit_id: visit.id,
      history_record_type: "planned_visit",
      visit_origin: "planned",
      sign_in_time: null,
      sign_out_time: null
    });
  });

  return records.sort((a, b) =>
    String(historySortValue(b)).localeCompare(String(historySortValue(a)))
  );
}

function setHistoryListState(state) {
  setVisible("visitorsHistoryLoading", state === "loading");
  setVisible("visitorsHistoryError", state === "error");
  setVisible("visitorsHistoryEmpty", state === "empty");
  setVisible("visitorsHistoryResultSummary", state === "ready" || state === "empty");
  setVisible("visitorsHistoryTableWrap", state === "ready");
  setVisible("visitorsHistoryCards", state === "ready");
}

function updateHistoryQuickFilterButtons() {
  document.querySelectorAll("[data-history-quick-filter]").forEach(button => {
    const active = button.dataset.historyQuickFilter === activeHistoryQuickFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function historyMatchesQuickFilter(record, status) {
  const today = todayDate();
  if (activeHistoryQuickFilter === "today") return historyRecordDate(record) === today;
  if (activeHistoryQuickFilter === "on_site") {
    return status === "signed_in" || status === "overdue";
  }
  if (activeHistoryQuickFilter === "overdue") return status === "overdue";
  if (activeHistoryQuickFilter === "signed_out_today") {
    return status === "signed_out" &&
      String(record.sign_out_time || "").slice(0, 10) === today;
  }
  if (activeHistoryQuickFilter === "planned") return status === "planned";
  return true;
}

function renderNativeHistory() {
  const body = $("visitorsHistoryTableBody");
  if (!body) return;
  body.replaceChildren();
  const cards = $("visitorsHistoryCards");
  if (cards) cards.replaceChildren();

  const search = String($("visitorsHistorySearch").value || "").trim().toLowerCase();
  const fromDate = $("visitorsHistoryFromDate").value;
  const toDate = $("visitorsHistoryToDate").value;
  const statusFilter = $("visitorsHistoryStatus").value;
  const originFilter = $("visitorsHistoryOrigin").value;
  const closedStatuses = ["cancelled", "closed", "completed", "inactive"];
  const filtered = nativeHistoryRecords.filter(record => {
    const status = historyRecordStatus(record);
    const origin = visitorOrigin(record);
    const date = historyRecordDate(record);
    const searchable = searchTextFromRecord(record, [
      "id",
      "planned_visit_id",
      "visitor_name",
      "company",
      "onsite_contact",
      "security_pass_id",
      "vehicle_plate",
      "visit_reason",
      "created_by",
      "modified_by"
    ]);
    const statusMatches =
      statusFilter === "all" ||
      status === statusFilter ||
      (statusFilter === "closed" && closedStatuses.includes(status));
    return (!search || searchable.includes(search)) &&
      (!fromDate || (date && date >= fromDate)) &&
      (!toDate || (date && date <= toDate)) &&
      statusMatches &&
      (originFilter === "all" || origin === originFilter) &&
      historyMatchesQuickFilter(record, status);
  });
  nativeHistoryFilteredRows = filtered;
  setText(
    "visitorsHistoryResultSummary",
    filtered.length + " of " + nativeHistoryRecords.length + " available records shown"
  );
  updateHistoryQuickFilterButtons();
  if (!filtered.length) {
    setHistoryListState("empty");
    return;
  }

  filtered.forEach(record => {
    const status = historyRecordStatus(record);
    const row = document.createElement("tr");
    row.className = "visitors-history-row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "Open visitor history details for " + textOrDash(record.visitor_name));
    appendTextCell(row, record.visitor_name, record.company || "");
    appendTextCell(
      row,
      historyRecordDate(record),
      record.expected_time ? String(record.expected_time).slice(0, 5) : ""
    );
    appendTextCell(row, record.onsite_contact);
    appendTextCell(row, formatVisitorDateTime(record.sign_in_time));
    appendTextCell(row, formatVisitorDateTime(record.sign_out_time));

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "visitors-planned-status " + historyStatusClass(status);
    badge.textContent = historyStatusLabel(status);
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    appendTextCell(row, visitorOrigin(record) === "walk_in" ? "Walk-in" : "Planned");
    appendTextCell(row, record.security_pass_id);

    const openDetails = () => openVisitorDetails(record, status, row);
    row.addEventListener("click", openDetails);
    row.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDetails();
    });
    body.appendChild(row);

    if (cards) {
      const result = createVisitorResultCard({
        title: record.visitor_name,
        meta: [record.company, historyRecordDate(record)].filter(Boolean).join(" • "),
        statusLabel: historyStatusLabel(status),
        statusClass: historyStatusClass(status),
        ariaLabel: "Visitor history record for " + textOrDash(record.visitor_name)
      });
      appendResultCardField(
        result.fields,
        "Visit date",
        [
          historyRecordDate(record),
          record.expected_time ? String(record.expected_time).slice(0, 5) : ""
        ].filter(Boolean).join(" · ")
      );
      appendResultCardField(result.fields, "Host / contact", record.onsite_contact);
      appendResultCardField(result.fields, "Sign in", formatVisitorDateTime(record.sign_in_time));
      appendResultCardField(result.fields, "Sign out", formatVisitorDateTime(record.sign_out_time));
      appendResultCardField(result.fields, "Origin", visitorOrigin(record) === "walk_in" ? "Walk-in" : "Planned");
      appendResultCardField(result.fields, "Pass ID", record.security_pass_id);
      appendResultCardAction(
        result.actions,
        "View Details",
        "secondary",
        button => openVisitorDetails(record, status, button)
      );
      cards.appendChild(result.card);
    }
  });

  setHistoryListState("ready");
}

async function loadNativeHistory() {
  if (!isActiveStaffUser() || !hasCapability("visitor.history.view")) return;
  const loadSequence = ++nativeHistoryLoadSequence;
  setHistoryListState("loading");

  const [logsResult, plannedResult] = await Promise.all([
    supabaseClient
      .from("visit_log")
      .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
      .order("sign_in_time", { ascending: false })
      .limit(1000),
    supabaseClient
      .from("planned_visits")
      .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, status, created_by, modified_by, modified_at")
      .order("visit_date", { ascending: false })
      .limit(1000)
  ]);

  if (loadSequence !== nativeHistoryLoadSequence) return;
  if (logsResult.error || plannedResult.error) {
    nativeHistoryRecords = [];
    setHistoryListState("error");
    renderNativeReporting();
    showToast("Visitor history unavailable", "Visitor activity could not be loaded.", "error");
    console.error("[OH-030 native visitor history load failed]", logsResult.error || plannedResult.error);
    return;
  }

  nativeHistoryRecords = mergeNativeHistoryRecords(
    logsResult.data || [],
    plannedResult.data || []
  );
  renderNativeHistory();
  renderNativeReporting();
}

function localDateValue(date) {
  const offsetDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return offsetDate.toISOString().slice(0, 10);
}

function resetNativeHistoryFilters() {
  const recentStart = new Date();
  recentStart.setDate(recentStart.getDate() - 30);
  $("visitorsHistorySearch").value = "";
  $("visitorsHistoryFromDate").value = localDateValue(recentStart);
  $("visitorsHistoryToDate").value = todayDate();
  $("visitorsHistoryStatus").value = "all";
  $("visitorsHistoryOrigin").value = "all";
  activeHistoryQuickFilter = null;
  renderNativeHistory();
}

function applyNativeHistoryQuickFilter(filter) {
  activeHistoryQuickFilter = filter;
  $("visitorsHistorySearch").value = "";
  $("visitorsHistoryFromDate").value = "";
  $("visitorsHistoryToDate").value = "";
  $("visitorsHistoryStatus").value = "all";
  $("visitorsHistoryOrigin").value = filter === "planned" ? "planned" : "all";
  renderNativeHistory();
}

async function openVisitorHistoryRecordById(recordId) {
  const id = String(recordId || "").trim();
  if (!id) return false;

  let record = nativeHistoryRecords.find(item => item.history_record_type === "visit_log" && item.id === id);
  if (!record) {
    const result = await supabaseClient
      .from("visit_log")
      .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
      .eq("id", id)
      .maybeSingle();
    if (result.error) {
      showToast("Visitor history unavailable", "The exact visitor history record could not be loaded.", "error");
      return false;
    }
    record = result.data ? { ...result.data, history_record_type: "visit_log" } : null;
  }

  if (!record) {
    showToast("Visitor history unavailable", "No visitor history record was found for this reference.", "error");
    return false;
  }

  openVisitorDetails(record, historyRecordStatus(record), $("visitorsHistorySearch"));
  return true;
}

async function openNativeHistory(event) {
  if (!hasCapability("visitor.history.view")) {
    showToast("You do not have permission", "Visitor history requires visitor.history.view.", "error");
    return;
  }
  selectModuleSection("visitors", "visitor-history", { focus: true, resetScroll: false });
  const section = $("visitorsHistorySection");
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  const detail = event && event.detail ? event.detail : {};
  const sourceRecordId = detail.sourceRecordId || detail.visitLogId || "";
  if (sourceRecordId) {
    await openVisitorHistoryRecordById(sourceRecordId);
    return;
  }
  setTimeout(() => $("visitorsHistorySearch").focus({ preventScroll: true }), 0);
}

const nativeReportDefinitions = {
  history: {
    label: "Visitor history export",
    countId: "visitorsReportHistoryCount"
  },
  on_site: {
    label: "Currently on site",
    countId: "visitorsReportOnSiteCount"
  },
  overdue: {
    label: "Overdue visitors",
    countId: "visitorsReportOverdueCount"
  },
  planned: {
    label: "Planned visits",
    countId: "visitorsReportPlannedCount"
  },
  signed_out: {
    label: "Signed-out visitors",
    countId: "visitorsReportSignedOutCount"
  },
  no_show: {
    label: "No-show visits",
    countId: "visitorsReportNoShowCount"
  },
  walk_ins: {
    label: "Walk-ins",
    countId: "visitorsReportWalkInsCount"
  }
};

function nativeReportTypeMatches(record, reportType) {
  const status = historyRecordStatus(record);
  if (reportType === "on_site") return status === "signed_in" || status === "overdue";
  if (reportType === "overdue") return status === "overdue";
  if (reportType === "planned") return status === "planned";
  if (reportType === "signed_out") return status === "signed_out";
  if (reportType === "no_show") return status === "no_show";
  if (reportType === "walk_ins") return visitorOrigin(record) === "walk_in";
  return true;
}

function nativeReportingFilteredRows() {
  const search = String($("visitorsReportingSearch").value || "").trim().toLowerCase();
  const fromDate = $("visitorsReportingFromDate").value;
  const toDate = $("visitorsReportingToDate").value;
  const statusFilter = $("visitorsReportingStatus").value;
  const originFilter = $("visitorsReportingOrigin").value;
  const closedStatuses = ["cancelled", "closed", "completed", "inactive"];

  return nativeHistoryRecords.filter(record => {
    const status = historyRecordStatus(record);
    const date = historyRecordDate(record);
    const origin = visitorOrigin(record);
    const searchable = searchTextFromRecord(record, [
      "id",
      "planned_visit_id",
      "visitor_name",
      "company",
      "onsite_contact",
      "security_pass_id",
      "vehicle_plate",
      "visit_reason",
      "created_by",
      "modified_by"
    ]);
    const statusMatches =
      statusFilter === "all" ||
      status === statusFilter ||
      (statusFilter === "closed" && closedStatuses.includes(status));
    return (!search || searchable.includes(search)) &&
      (!fromDate || (date && date >= fromDate)) &&
      (!toDate || (date && date <= toDate)) &&
      statusMatches &&
      (originFilter === "all" || origin === originFilter);
  });
}

function renderNativeReporting() {
  if (!$("visitorsReportingSection")) return;
  const filteredRows = nativeReportingFilteredRows();

  Object.entries(nativeReportDefinitions).forEach(([reportType, definition]) => {
    const reportRows = filteredRows.filter(record =>
      nativeReportTypeMatches(record, reportType)
    );
    setText(definition.countId, reportRows.length);
  });

  nativeReportRows = filteredRows.filter(record =>
    nativeReportTypeMatches(record, selectedNativeReportType)
  );
  document.querySelectorAll("[data-native-report]").forEach(card => {
    card.classList.toggle(
      "active",
      card.dataset.nativeReport === selectedNativeReportType
    );
  });
  const definition = nativeReportDefinitions[selectedNativeReportType];
  setText("visitorsReportingSelection", definition.label);
  setText(
    "visitorsReportingResultSummary",
    nativeReportRows.length + " records match the current filters."
  );
}

function selectNativeReport(reportType) {
  if (!nativeReportDefinitions[reportType]) return;
  selectedNativeReportType = reportType;
  renderNativeReporting();
}

function resetNativeReportingFilters() {
  $("visitorsReportingSearch").value = "";
  $("visitorsReportingFromDate").value = "";
  $("visitorsReportingToDate").value = "";
  $("visitorsReportingStatus").value = "all";
  $("visitorsReportingOrigin").value = "all";
  selectedNativeReportType = "history";
  renderNativeReporting();
}

function nativeReportExportSource() {
  return nativeReportRows.map(record => ({
    ...record,
    visit_date: historyRecordDate(record),
    visit_status: historyRecordStatus(record),
    visit_origin: visitorOrigin(record)
  }));
}

function exportNativeReport(format) {
  if (!hasCapability("visitor.export")) {
    showToast("You do not have permission", "Visitor exports require visitor.export.", "error");
    return;
  }
  renderNativeReporting();
  const rows = nativeReportExportSource();
  if (!rows.length) {
    showToast("Nothing to export", "No records match the selected report and filters.", "error");
    return;
  }
  const reportName = selectedNativeReportType.replace(/_/g, "-");
  const filename = "VMS_" + reportName + "_" + exportDateStamp();

  if (format === "excel") {
    if (!window.XLSX) {
      showToast("Excel export unavailable", "The Excel export library could not be loaded.", "error");
      return;
    }
    exportToExcel(rows, filename + ".xlsx", "history");
    showToast("Excel export ready", rows.length + " visitor records were exported.", "success");
    return;
  }

  downloadCsv(filename + ".csv", normaliseExportRows(rows, "history"));
  showToast("CSV export ready", rows.length + " visitor records were exported.", "success");
}

function visitorOperationalExportRows(source, type) {
  return (source || []).map(record => ({
    ...record,
    visit_date: record.visit_date || historyRecordDate(record),
    visit_status: type === "planned"
      ? plannedStatusLabel(plannedStatusFor(record))
      : historyStatusLabel(historyRecordStatus(record)),
    visit_origin: visitorOrigin(record)
  }));
}

function exportVisitorOperationalRows(source, type, filenameBase, format) {
  if (!hasCapability("visitor.export")) {
    showToast("You do not have permission", "Visitor exports require visitor.export.", "error");
    return;
  }
  const rows = visitorOperationalExportRows(source, type);
  if (!rows.length) {
    showToast("Nothing to export", "No visitor records match the current filters.", "error");
    return;
  }
  const filename = filenameBase + "-" + exportDateStamp();
  const formattedRows = normaliseExportRows(rows, type);
  if (format === "xlsx") {
    downloadXlsx(filename + ".xlsx", formattedRows, type === "planned" ? "Planned Visits" : "Visitor Records");
  } else {
    downloadCsv(filename + ".csv", formattedRows);
  }
  showToast("Export created", rows.length + " visitor records were exported.", "success");
}

function openNativeReporting(event) {
  if (!hasCapability("reports.view") || !hasCapability("visitor.history.view")) {
    showToast(
      "You do not have permission",
      "Visitor reporting requires reports.view and visitor.history.view.",
      "error"
    );
    return;
  }
  const section = $("visitorsReportingSection");
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  const shortcut = event && event.detail ? event.detail.shortcut : null;
  const focusTarget = shortcut === "visitor-excel"
    ? $("visitorsReportingExcel")
    : shortcut === "visitor-csv"
      ? $("visitorsReportingCsv")
      : $("visitorsReportingSearch");
  setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);
}

function dailyPlannedDocumentRows(selectedDate) {
  const excludedStatuses = [
    "cancelled",
    "canceled",
    "closed",
    "inactive",
    "no_show",
    "no-show",
    "noshow"
  ];
  return nativePlannedVisits
    .filter(visit => {
      const status = plannedStatusFor(visit);
      return visit.visit_date === selectedDate && !excludedStatuses.includes(status);
    })
    .sort((a, b) => {
      const timeOrder = String(a.expected_time || "").localeCompare(String(b.expected_time || ""));
      return timeOrder || String(a.visitor_name || "").localeCompare(String(b.visitor_name || ""));
    })
    .map(visit => ({
      ...visit,
      document_status: plannedStatusLabel(plannedStatusFor(visit))
    }));
}

async function printDailyPlannedVisitorList() {
  if (!hasCapability("reports.view")) {
    showToast("You do not have permission", "Operational documents require reports.view.", "error");
    return;
  }
  const selectedDate = $("visitorsDailyPlannedDate").value;
  if (!selectedDate) {
    showToast("Select a date", "Choose a planned visit date before printing.", "error");
    return;
  }
  if (!nativePlannedVisitsLoaded) await loadNativePlannedVisits();
  if (!nativePlannedVisitsLoaded) {
    showToast("Document unavailable", "Planned visits could not be loaded.", "error");
    return;
  }

  const rows = dailyPlannedDocumentRows(selectedDate);
  if (!rows.length) {
    showToast("Nothing to print", "No eligible planned visits were found for the selected date.", "error");
    return;
  }

  const profile = AppState.currentProfile;
  const printedBy = profile
    ? profile.display_name || profile.email || profile.id
    : "";
  const html = buildDailyPlannedVisitorPrintHtml(rows, {
    selectedDate,
    printedBy,
    companyName: settingValue("company_name", "Visitor Management"),
    siteName: settingValue("site_name", settingValue("default_site_name", "")),
    logoUrl: settingValue("logo_url", "")
  });
  if (!openPrintDocument(html)) {
    showToast("Print window blocked", "Allow pop-ups for this site, then try again.", "error");
    return;
  }
  showToast("Print document opened", rows.length + " planned visitors are ready to print.", "success");
}

async function loadNativePlannedVisits() {
  if (!isActiveStaffUser() || !hasCapability("visitor.view")) return;
  const loadSequence = ++nativePlannedLoadSequence;
  setPlannedListState("loading");

  const result = await supabaseClient
    .from("planned_visits")
    .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, status, created_by, modified_by, modified_at")
    .order("visit_date", { ascending: true })
    .order("expected_time", { ascending: true });

  if (loadSequence !== nativePlannedLoadSequence) return;
  if (result.error) {
    nativePlannedVisits = [];
    nativePlannedVisitsLoaded = false;
    setPlannedListState("error");
    showToast("Planned visits unavailable", "The planned visits list could not be loaded.", "error");
    console.error("[OH-027 planned visits load failed]", result.error);
    return;
  }

  const visits = result.data || [];
  let statusMap;
  try {
    statusMap = await getPlannedVisitStatusMap(
      visits.map(visit => visit.id),
      { throwOnError: true }
    );
  } catch (error) {
    if (loadSequence !== nativePlannedLoadSequence) return;
    nativePlannedVisits = [];
    nativePlannedVisitsLoaded = false;
    setPlannedListState("error");
    showToast(
      "Planned visit statuses unavailable",
      "The active planned visit list could not be verified safely.",
      "error"
    );
    console.error("[OH-027A planned visit status load failed]", error);
    return;
  }
  if (loadSequence !== nativePlannedLoadSequence) return;
  nativePlannedVisits = visits.map(visit => {
    const statusInfo = statusMap[visit.id] || null;
    return {
      ...visit,
      native_status: statusInfo
        ? statusInfo.status
        : plannedVisitDisplayStatus(visit),
      sign_in_time: statusInfo ? statusInfo.sign_in_time : null,
      sign_out_time: statusInfo ? statusInfo.sign_out_time : null
    };
  });
  nativePlannedVisitsLoaded = true;
  renderNativePlannedVisits();
}

function applyNativePlannedFieldRules(mode) {
  ["reason", "vehicle", "contact", "pass"].forEach(field => {
    const wrapper = $("visitorsPlanned" + (field === "pass" ? "Pass" : field[0].toUpperCase() + field.slice(1)) + "Field");
    const input = $("visitorsPlanned" + (field === "pass" ? "Pass" : field[0].toUpperCase() + field.slice(1)));
    if (!wrapper || !input) return;
    const visible = mode === "security" ? field === "pass" : fieldRule(field, "visible");
    const required = mode !== "security" && visible && fieldRule(field, "required");
    wrapper.classList.toggle("hidden", !visible);
    input.required = required;
    const label = wrapper.querySelector("span");
    if (label) {
      const baseLabel = label.dataset.baseLabel || label.textContent.replace(/\s+\*$/, "");
      label.dataset.baseLabel = baseLabel;
      label.textContent = baseLabel + (required ? " *" : "");
    }
  });
}

function clearPlannedForm() {
  if (resetPlannedPanelForm) {
    resetPlannedPanelForm();
  } else {
    $("visitorsPlannedForm").reset();
  }
  resetVisitorIdentitySelection("native_planned");
  $("visitorsPlannedRecordId").value = "";
  $("visitorsPlannedEditMode").value = "full";
  $("visitorsPlannedVisitDate").value = todayDate();
  $("visitorsPlannedChangeReason").required = false;
  $("visitorsPlannedChangeReasonField").classList.add("hidden");
}

async function cancelNativePlannedVisit(visit, sourceButton) {
  if (!isSuperUserRecoveryAllowed(visit)) {
    showToast("Planned visit not cancelled", "Only a SuperUser can cancel a pending planned visit.", "error");
    return;
  }
  const confirmed = await requestPlatformConfirmation({
    title: "Cancel planned visit",
    message: "Cancel this pending planned visit? It will be removed from the default active list.",
    confirmText: "Cancel Visit",
    cancelText: "Keep Visit",
    danger: true,
    trigger: sourceButton
  });
  if (!confirmed) return;

  sourceButton.disabled = true;
  try {
    const startedResult = await supabaseClient
      .from("visit_log")
      .select("id")
      .eq("planned_visit_id", visit.id)
      .not("sign_in_time", "is", null)
      .limit(1);
    if (startedResult.error) throw startedResult.error;
    if ((startedResult.data || []).length) {
      showToast(
        "Planned visit not cancelled",
        "This visitor has already signed in, so the planned visit is no longer pending.",
        "error"
      );
      await loadNativePlannedVisits();
      return;
    }

    const payload = {
      status: "cancelled",
      modified_by: AppState.currentProfile.id,
      modified_at: new Date().toISOString()
    };
    let query = supabaseClient
      .from("planned_visits")
      .update(payload)
      .eq("id", visit.id);
    query = visit.status == null
      ? query.is("status", null)
      : query.eq("status", visit.status);
    const result = await query.select("id, status").maybeSingle();
    if (result.error || !result.data) {
      if (result.error) console.error("[OH-027A planned visit cancel failed]", result.error);
      showToast(
        "Planned visit not cancelled",
        "The visit changed or the current security rules rejected the action.",
        "error"
      );
      await loadNativePlannedVisits();
      return;
    }

    const changes = buildFieldDiff(visit, { ...visit, ...payload }, ["status"]);
    await writeAuditEvent("visit_changed", "planned_visits", visit.id, {
      mode: "super_user_recovery",
      action: "cancel",
      changes,
      summary: auditDiffSummary(changes)
    });
    showToast(
      "Planned visit cancelled",
      "The visit was closed and removed from the active list.",
      "success"
    );
    await Promise.all([loadNativePlannedVisits(), loadVisitorsWorkspaceMetrics()]);
  } catch (error) {
    showToast(
      "Planned visit not cancelled",
      "The planned visit could not be cancelled. Please try again.",
      "error"
    );
    console.error("[OH-027A unexpected planned visit cancel failure]", error);
  } finally {
    sourceButton.disabled = false;
  }
}

function openPlannedPanel(visit, mode, returnFocus) {
  const isEdit = !!visit;
  const effectiveMode = mode || "full";
  const requiredCapability = isEdit ? "visitor.edit" : "visitor.create";
  if (!hasCapability(requiredCapability)) {
    showToast("You do not have permission", "This action requires " + requiredCapability + ".", "error");
    return;
  }

  clearPlannedForm();
  $("visitorsPlannedRecordId").value = isEdit ? visit.id : "";
  $("visitorsPlannedEditMode").value = effectiveMode;
  $("visitorsPlannedPanelTitle").textContent = isEdit
    ? (effectiveMode === "security" ? "Edit Security Pass ID" : "Edit Planned Visit")
    : "Create Planned Visit";
  $("visitorsPlannedSave").textContent = isEdit ? "Save Changes" : "Create Planned Visit";
  $("visitorsPlannedChangeReasonField").classList.toggle("hidden", !isEdit);
  $("visitorsPlannedChangeReason").required = isEdit;
  document.querySelectorAll("[data-native-planned-field='full']").forEach(element => {
    element.classList.toggle("hidden", effectiveMode === "security");
  });
  applyNativePlannedFieldRules(effectiveMode);
  void applyFormRequirementIndicators("planned_visits", NATIVE_PLANNED_REQUIREMENT_MAPPINGS);

  if (isEdit) {
    $("visitorsPlannedVisitorName").value = visit.visitor_name || "";
    $("visitorsPlannedCompany").value = visit.company || "";
    $("visitorsPlannedVisitDate").value = visit.visit_date || "";
    $("visitorsPlannedExpectedTime").value = visit.expected_time || "";
    $("visitorsPlannedContact").value = visit.onsite_contact || "";
    $("visitorsPlannedReason").value = visit.visit_reason || "";
    $("visitorsPlannedVehicle").value = visit.vehicle_plate || "";
    $("visitorsPlannedPass").value = visit.security_pass_id || "";
  }

  const firstInput = effectiveMode === "security"
    ? $("visitorsPlannedPass")
    : $("visitorsPlannedVisitorName");
  if (plannedPanelController) {
    plannedPanelController.open({
      trigger: returnFocus,
      title: $("visitorsPlannedPanelTitle").textContent,
      mode: isEdit ? "edit" : "create",
      type: "form",
      initialFocus: firstInput
    });
  }
}

function closePlannedPanel() {
  if (plannedPanelController) plannedPanelController.close();
}

function walkInFieldIds(field) {
  const suffix = field === "pass"
    ? "Pass"
    : field[0].toUpperCase() + field.slice(1);
  return {
    wrapper: "visitorsWalkIn" + suffix + "Field",
    input: "visitorsWalkIn" + suffix
  };
}

function applyNativeWalkInFieldRules() {
  ["company", "reason", "vehicle", "contact", "pass"].forEach(field => {
    const ids = walkInFieldIds(field);
    const wrapper = $(ids.wrapper);
    const input = $(ids.input);
    if (!wrapper || !input) return;
    const visible = walkInFieldRule(field, "visible");
    const required = visible && walkInFieldRule(field, "required");
    wrapper.classList.toggle("hidden", !visible);
    input.required = required;
    const label = wrapper.querySelector("span");
    if (label) {
      const baseLabel = label.dataset.baseLabel || label.textContent.replace(/\s+\*$/, "");
      label.dataset.baseLabel = baseLabel;
      label.textContent = baseLabel + (required ? " *" : "");
    }
  });
}

function clearWalkInForm() {
  if (resetWalkInPanelForm) {
    resetWalkInPanelForm();
  } else {
    $("visitorsWalkInForm").reset();
  }
  resetVisitorIdentitySelection("native_walk_in");
}

function openWalkInPanel(returnFocus) {
  if (!hasCapability("visitor.create") || !hasCapability("visitor.sign_in")) {
    showToast(
      "You do not have permission",
      "Creating a walk-in requires visitor.create and visitor.sign_in.",
      "error"
    );
    return;
  }
  clearWalkInForm();
  applyNativeWalkInFieldRules();
  void applyFormRequirementIndicators("visitor_walk_ins", NATIVE_WALK_IN_REQUIREMENT_MAPPINGS);
  if (walkInPanelController) {
    walkInPanelController.open({
      trigger: returnFocus,
      title: "Create Walk-in Visitor",
      mode: "create",
      type: "form",
      initialFocus: "visitorsWalkInVisitorName"
    });
  }
}

function closeWalkInPanel() {
  if (walkInPanelController) walkInPanelController.close();
}

function formatVisitorDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function clearVisitorDetailsPanel() {
  [
    "visitorsDetailsStatus",
    "visitorsDetailsCompany",
    "visitorsDetailsVisitDate",
    "visitorsDetailsExpectedTime",
    "visitorsDetailsSignIn",
    "visitorsDetailsSignOut",
    "visitorsDetailsContact",
    "visitorsDetailsReason",
    "visitorsDetailsVehicle",
    "visitorsDetailsPass",
    "visitorsDetailsOrigin",
    "visitorsDetailsPrivacy",
    "visitorsDetailsLastUpdated",
    "visitorsDetailsCreatedBy",
    "visitorsDetailsModifiedBy",
    "visitorsDetailsAutomaticSignOut"
  ].forEach(id => setText(id, "â€”"));
  setText("visitorsDetailsPanelTitle", "Visitor");
  const linkedContext = $("visitorsDetailsLinkedIdentityContext");
  if (linkedContext) linkedContext.replaceChildren();
  const advanced = $("visitorsDetailsAdvanced");
  if (advanced) advanced.replaceChildren();
  renderVisitorHistoryIdentityReviewAction(null);
}

function openVisitorDetails(record, status, returnFocus) {
  setText("visitorsDetailsPanelTitle", textOrDash(record.visitor_name));
  setText(
    "visitorsDetailsStatus",
    status === "overdue" ? "Overdue" : plannedStatusLabel(status)
  );
  setText("visitorsDetailsCompany", textOrDash(record.company));
  setText("visitorsDetailsVisitDate", textOrDash(historyRecordDate(record)));
  setText(
    "visitorsDetailsExpectedTime",
    record.expected_time ? String(record.expected_time).slice(0, 5) : "—"
  );
  setText("visitorsDetailsSignIn", formatVisitorDateTime(record.sign_in_time));
  setText("visitorsDetailsSignOut", formatVisitorDateTime(record.sign_out_time));
  setText("visitorsDetailsContact", textOrDash(record.onsite_contact));
  setText("visitorsDetailsReason", textOrDash(record.visit_reason || record.notes));
  setText("visitorsDetailsVehicle", textOrDash(record.vehicle_plate));
  setText("visitorsDetailsPass", textOrDash(record.security_pass_id));
  setText(
    "visitorsDetailsOrigin",
    visitorOrigin(record) === "walk_in"
      ? "Walk-in"
      : "Planned"
  );
  setText(
    "visitorsDetailsPrivacy",
    record.privacy_notice_accepted_at
      ? formatVisitorDateTime(record.privacy_notice_accepted_at) +
        (record.privacy_notice_version ? " (" + record.privacy_notice_version + ")" : "")
      : "—"
  );
  setText("visitorsDetailsLastUpdated", formatVisitorDateTime(record.modified_at));
  setText("visitorsDetailsCreatedBy", textOrDash(record.created_by));
  setText("visitorsDetailsModifiedBy", textOrDash(record.modified_by));
  setText(
    "visitorsDetailsAutomaticSignOut",
    record.signed_out_automatically
      ? "Yes" + (record.automatic_sign_out_reason ? " — " + record.automatic_sign_out_reason : "")
      : "No"
  );
  renderVisitorHistoryLinkedIdentityContext(record);
  renderVisitorDetailsAdvanced(record);
  renderVisitorHistoryIdentityReviewAction(record);
  if (detailsPanelController) {
    detailsPanelController.open({
      trigger: returnFocus,
      title: textOrDash(record.visitor_name),
      mode: "details",
      type: "details",
      initialFocus: "visitorsDetailsPanelClose"
    });
  }
}

function renderVisitorDetailsAdvanced(record) {
  const host = $("visitorsDetailsAdvanced");
  if (!host) return;
  host.replaceChildren();
  if (!record) return;
  const details = document.createElement("details");
  details.className = "oh-detail-advanced identity-resolution-request-details identity-resolution-request-advanced";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced / Technical Details";
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  [
    ["Record ID", record.id],
    ["Planned visit ID", record.planned_visit_id],
    ["History record type", record.history_record_type],
    ["Created", formatVisitorDateTime(record.created_at)],
    ["Updated", formatVisitorDateTime(record.modified_at)]
  ].filter(([, value]) => value != null && String(value).trim()).forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = textOrDash(value);
    wrapper.append(dt, dd);
    meta.appendChild(wrapper);
  });
  details.append(summary, meta);
  if (record.id) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy Technical ID";
    copy.addEventListener("click", () => {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        showToast("Copy unavailable", "Clipboard access is not available in this browser.", "error");
        return;
      }
      navigator.clipboard.writeText(String(record.id))
        .then(() => showToast("Technical ID copied", "The visitor record reference was copied.", "success"))
        .catch(() => showToast("Copy failed", "The visitor record reference could not be copied.", "error"));
    });
    details.appendChild(copy);
  }
  host.appendChild(details);
}

function renderVisitorHistoryLinkedIdentityContext(record) {
  const sourceId = record && record.id && (record.history_record_type === "visit_log" || record.sign_in_time)
    ? record.id
    : null;
  renderLinkedIdentityContext("visitorsDetailsLinkedIdentityContext", {
    sourceType: "visit_log",
    sourceRecordId: sourceId,
    sourceLabel: record ? visitorIdentityReviewLabel(record) : "",
    complianceNote: true
  });
}

function visitorHistoryIdentityReviewLabel(record) {
  const subject = [record.visitor_name, record.company].filter(Boolean).join(" / ");
  const date = record.sign_in_time ? "Signed in " + formatVisitorDateTime(record.sign_in_time) : historyRecordDate(record);
  return ["Visitor History", subject, date].filter(Boolean).join(" - ");
}

function currentVisitorIdentityReviewLabel(record) {
  const subject = [record.visitor_name, record.company].filter(Boolean).join(" / ");
  const date = record.sign_in_time ? "Signed in " + formatVisitorDateTime(record.sign_in_time) : "";
  return ["Current Visitor", subject, date].filter(Boolean).join(" - ");
}

function visitorIdentityReviewLabel(record) {
  return record && record.sign_in_time && !record.sign_out_time
    ? currentVisitorIdentityReviewLabel(record)
    : visitorHistoryIdentityReviewLabel(record);
}

function visitorIdentityReviewContext(record) {
  const isCurrent = record.sign_in_time && !record.sign_out_time;
  const label = visitorIdentityReviewLabel(record);
  return {
    candidateType: "person",
    requestReason: isCurrent
      ? "Current visitor requires identity review."
      : "Visitor history record requires identity review.",
    sourceType: "visit_log",
    sourceRecordId: record.id,
    sourceLabel: label,
    sourceSummary: {
      result_label: label,
      visitor_name: record.visitor_name || null,
      company: record.company || null,
      sign_in_time: record.sign_in_time || null,
      sign_out_time: record.sign_out_time || null,
      visit_status: historyRecordStatus(record),
      visit_origin: visitorOrigin(record)
    },
    contextType: isCurrent ? "current_visitor" : "visitor_history",
    contextRecordId: record.id,
    contextSummary: {
      context_label: isCurrent ? "Current Visitor" : "Visitor History",
      result_label: label
    },
    metadata: {
      launched_from: isCurrent ? "current_visitor_detail" : "visitor_history_detail"
    }
  };
}

function renderVisitorHistoryIdentityReviewAction(record) {
  const actions = $("visitorsDetailsActions");
  if (!actions) return;
  actions.replaceChildren();
  const canRequest = canRequestIdentityReviewFromVisitors() &&
    record &&
    record.id &&
    (record.history_record_type === "visit_log" || record.sign_in_time);
  const section = createDetailActions([{
    label: "Request Identity Review",
    primary: false,
    available: canRequest,
    handler: button => {
      if (detailsPanelController) detailsPanelController.close({ restoreFocus: false });
      openIdentityReviewRequestFromContext(visitorIdentityReviewContext(record), button);
    }
  }], {
    title: "Contextual Actions",
    description: "Actions for this exact visitor record. Source visitor data is not modified."
  });
  if (section) actions.append(...Array.from(section.childNodes));
  actions.classList.toggle("hidden", !section);
}

function closeVisitorDetails() {
  if (detailsPanelController) detailsPanelController.close();
}

async function refreshNativeVisitorWorkflows() {
  await loadVisitorsWorkspace();
  window.dispatchEvent(new CustomEvent("oh:visitor-data-changed"));
}

async function signInNativePlannedVisit(visit, sourceButton) {
  if (!hasCapability("visitor.sign_in")) {
    showToast("You do not have permission", "Signing in visitors requires visitor.sign_in.", "error");
    return;
  }
  if (typeof visitorsDependencies.signInPlannedVisit !== "function") {
    showToast("Visitor not signed in", "The planned visitor sign-in service is unavailable.", "error");
    return;
  }

  sourceButton.disabled = true;
  try {
    const result = await visitorsDependencies.signInPlannedVisit(visit.id);
    if (!result || result.ok !== true) {
      const privacyCancelled = result && result.code === "privacy_cancelled";
      showToast(
        privacyCancelled ? "Sign-in not completed" : "Visitor not signed in",
        result && result.message ? result.message : "The visitor could not be signed in.",
        privacyCancelled ? "info" : "error"
      );
      return;
    }
    showToast("Visitor signed in", result.visitor_name + " is now on site.", "success");
    await refreshNativeVisitorWorkflows();
  } catch (error) {
    showToast("Visitor not signed in", "The visitor could not be signed in. Please try again.", "error");
    console.error("[OH-029 unexpected planned sign-in failure]", error);
  } finally {
    sourceButton.disabled = false;
  }
}

async function signOutNativeVisitor(visit, sourceButton) {
  if (!hasCapability("visitor.sign_out")) {
    showToast("You do not have permission", "Signing out visitors requires visitor.sign_out.", "error");
    return;
  }
  if (typeof visitorsDependencies.signOutVisit !== "function") {
    showToast("Visitor not signed out", "The visitor sign-out service is unavailable.", "error");
    return;
  }
  const confirmed = await requestPlatformConfirmation({
    title: "Sign out visitor",
    message: "Sign out " + textOrDash(visit.visitor_name) + "?",
    confirmText: "Sign Out",
    cancelText: "Cancel",
    danger: true,
    trigger: sourceButton
  });
  if (!confirmed) return;

  sourceButton.disabled = true;
  try {
    const result = await visitorsDependencies.signOutVisit(visit.id);
    if (!result || result.ok !== true) {
      showToast(
        "Visitor not signed out",
        result && result.message ? result.message : "The visitor could not be signed out.",
        "error"
      );
      return;
    }
    if (result.warning) showToast("Compliance warning", result.warning, "info");
    showToast("Visitor signed out", result.visitor_name + " has left the site.", "success");
    await refreshNativeVisitorWorkflows();
  } catch (error) {
    showToast("Visitor not signed out", "The visitor could not be signed out. Please try again.", "error");
    console.error("[OH-029 unexpected sign-out failure]", error);
  } finally {
    sourceButton.disabled = false;
  }
}

function nativeWalkInFieldValue(field) {
  const ids = walkInFieldIds(field);
  const wrapper = $(ids.wrapper);
  const input = $(ids.input);
  if (!wrapper || wrapper.classList.contains("hidden")) return "";
  return String(input.value || "");
}

function nativeWalkInRequirementPayload() {
  return {
    visitor_name: formatPersonName($("visitorsWalkInVisitorName").value),
    name: formatPersonName($("visitorsWalkInVisitorName").value),
    company: nativeWalkInFieldValue("company").trim() || null,
    visit_reason: nativeWalkInFieldValue("reason").trim() || null,
    reason: nativeWalkInFieldValue("reason").trim() || null,
    vehicle_plate: normalisePlate(nativeWalkInFieldValue("vehicle")),
    vehicle_registration: normalisePlate(nativeWalkInFieldValue("vehicle")),
    onsite_contact: formatPersonName(nativeWalkInFieldValue("contact")) || null,
    on_site_contact: formatPersonName(nativeWalkInFieldValue("contact")) || null,
    security_pass_id: nativeWalkInFieldValue("pass").trim() || null
  };
}

async function validateNativeWalkInRequirements() {
  const result = await validateFormRequirements(
    "visitor_walk_ins",
    "validate_visitor_walk_in_requirements_payload",
    nativeWalkInRequirementPayload(),
    NATIVE_WALK_IN_REQUIREMENT_MAPPINGS,
    { toast: false }
  );
  if (result.ok) return true;
  showToast("Walk-in incomplete", missingRequirementMessage(result.missing), "error");
  return false;
}

function nativeWalkInFormIsValid() {
  const requiredInputs = Array.from(
    $("visitorsWalkInForm").querySelectorAll("input[required], textarea[required]")
  ).filter(input => !input.closest(".hidden"));
  return requiredInputs.every(input => String(input.value || "").trim());
}

async function saveNativeWalkIn(event) {
  event.preventDefault();
  if (!hasCapability("visitor.create") || !hasCapability("visitor.sign_in")) {
    showToast(
      "You do not have permission",
      "Creating a walk-in requires visitor.create and visitor.sign_in.",
      "error"
    );
    return;
  }
  if (!nativeWalkInFormIsValid()) {
    showToast(
      "Check required fields",
      "Visitor name and all configured required fields must be completed.",
      "error"
    );
    return;
  }
  if (!(await validateNativeWalkInRequirements())) return;
  if (typeof visitorsDependencies.createWalkIn !== "function") {
    showToast("Walk-in not created", "The walk-in service is unavailable.", "error");
    return;
  }

  const saveButton = $("visitorsWalkInSave");
  saveButton.disabled = true;
  try {
    const result = await visitorsDependencies.createWalkIn({
      visitor_name: $("visitorsWalkInVisitorName").value,
      company: nativeWalkInFieldValue("company"),
      onsite_contact: nativeWalkInFieldValue("contact"),
      visit_reason: nativeWalkInFieldValue("reason"),
      vehicle_plate: nativeWalkInFieldValue("vehicle"),
      security_pass_id: nativeWalkInFieldValue("pass")
    });
    if (!result || result.ok !== true) {
      const privacyCancelled = result && result.code === "privacy_cancelled";
      showToast(
        privacyCancelled ? "Walk-in not completed" : "Walk-in not created",
        result && result.message ? result.message : "The walk-in could not be created.",
        privacyCancelled ? "info" : "error"
      );
      return;
    }

    closeWalkInPanel();
    showToast(
      "Walk-in visitor signed in",
      result.visitor_name + " was signed in successfully.",
      "success"
    );
    await refreshNativeVisitorWorkflows();
  } catch (error) {
    showToast("Walk-in not created", "The walk-in could not be created. Please try again.", "error");
    console.error("[OH-028 unexpected native walk-in failure]", error);
  } finally {
    saveButton.disabled = false;
  }
}

function nativePlannedFieldValue(field) {
  const wrapper = $("visitorsPlanned" + (field === "pass" ? "Pass" : field[0].toUpperCase() + field.slice(1)) + "Field");
  const input = $("visitorsPlanned" + (field === "pass" ? "Pass" : field[0].toUpperCase() + field.slice(1)));
  if (!wrapper || wrapper.classList.contains("hidden")) return "";
  return String(input.value || "");
}

function nativePlannedRequirementPayload(payload = {}) {
  const visitReason = Object.prototype.hasOwnProperty.call(payload, "visit_reason")
    ? payload.visit_reason
    : nativePlannedFieldValue("reason").trim() || null;
  const vehiclePlate = Object.prototype.hasOwnProperty.call(payload, "vehicle_plate")
    ? payload.vehicle_plate
    : normalisePlate(nativePlannedFieldValue("vehicle"));
  const onsiteContact = Object.prototype.hasOwnProperty.call(payload, "onsite_contact")
    ? payload.onsite_contact
    : formatPersonName(nativePlannedFieldValue("contact")) || null;
  return {
    ...payload,
    visitor_name: payload.visitor_name || formatPersonName($("visitorsPlannedVisitorName").value),
    name: payload.visitor_name || formatPersonName($("visitorsPlannedVisitorName").value),
    visit_date: payload.visit_date || $("visitorsPlannedVisitDate").value,
    date: payload.visit_date || $("visitorsPlannedVisitDate").value,
    company: Object.prototype.hasOwnProperty.call(payload, "company")
      ? payload.company
      : $("visitorsPlannedCompany").value.trim() || null,
    expected_time: Object.prototype.hasOwnProperty.call(payload, "expected_time")
      ? payload.expected_time
      : $("visitorsPlannedExpectedTime").value || null,
    visit_reason: visitReason,
    reason: visitReason,
    purpose: visitReason,
    vehicle_plate: vehiclePlate,
    vehicle_registration: vehiclePlate,
    onsite_contact: onsiteContact,
    on_site_contact: onsiteContact
  };
}

async function validateNativePlannedRequirements(payload) {
  const result = await validateFormRequirements(
    "planned_visits",
    "validate_planned_visit_requirements_payload",
    nativePlannedRequirementPayload(payload),
    NATIVE_PLANNED_REQUIREMENT_MAPPINGS,
    { toast: false }
  );
  if (result.ok) return true;
  showToast("Planned visit incomplete", missingRequirementMessage(result.missing), "error");
  return false;
}

function nativePlannedFormIsValid() {
  const requiredInputs = Array.from(
    $("visitorsPlannedForm").querySelectorAll("input[required], textarea[required]")
  ).filter(input => !input.closest(".hidden"));
  return requiredInputs.every(input => String(input.value || "").trim());
}

function nativePlannedEditFieldValue(field, existingValue) {
  const wrapper = $("visitorsPlanned" + (field === "pass" ? "Pass" : field[0].toUpperCase() + field.slice(1)) + "Field");
  if (!wrapper || wrapper.classList.contains("hidden")) return existingValue || null;
  if (field === "vehicle") return normalisePlate(nativePlannedFieldValue(field));
  if (field === "contact") return formatPersonName(nativePlannedFieldValue(field)) || null;
  return nativePlannedFieldValue(field).trim() || null;
}

function plannedSaveError(error, action) {
  if (error && error.code === "23505") {
    showToast("Duplicate planned visit", "This visitor already has a planned visit for this date.", "error");
  } else {
    showToast(
      action === "create" ? "Planned visit not created" : "Changes not saved",
      "The planned visit was rejected by the current permissions or business rules.",
      "error"
    );
  }
  console.error("[OH-027 planned visit save failed]", error);
}

async function createNativePlannedVisit() {
  if (!hasCapability("visitor.create")) {
    showToast("You do not have permission", "Creating planned visits requires visitor.create.", "error");
    return false;
  }

  const visitorName = formatPersonName($("visitorsPlannedVisitorName").value);
  const visitDate = $("visitorsPlannedVisitDate").value;
  if (!visitorName || !visitDate || !nativePlannedFormIsValid()) {
    showToast("Check required fields", "Visitor name, visit date and configured required fields must be completed.", "error");
    return false;
  }

  const payload = {
    visitor_name: visitorName,
    company: $("visitorsPlannedCompany").value.trim() || null,
    host_id: null,
    visit_date: visitDate,
    expected_time: $("visitorsPlannedExpectedTime").value || null,
    visit_reason: nativePlannedFieldValue("reason").trim() || null,
    vehicle_plate: normalisePlate(nativePlannedFieldValue("vehicle")),
    onsite_contact: formatPersonName(nativePlannedFieldValue("contact")) || null,
    security_pass_id: nativePlannedFieldValue("pass").trim() || null,
    notes: null,
    status: "planned",
    created_by: AppState.currentProfile ? AppState.currentProfile.id : null
  };
  if (!(await validateNativePlannedRequirements(payload))) return false;
  const result = await supabaseClient
    .from("planned_visits")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    plannedSaveError(result.error, "create");
    return false;
  }

  await writeAuditEvent("planned_visit_created", "planned_visits", result.data.id, {
    action: "create",
    after: payload,
    summary: "Planned visit created."
  });
  showToast("Planned visit created", visitorName + " has been added for " + visitDate + ".", "success");
  return true;
}

async function updateNativePlannedVisit(visit, mode) {
  if (!hasCapability("visitor.edit")) {
    showToast("You do not have permission", "Editing planned visits requires visitor.edit.", "error");
    return false;
  }
  const changeReason = $("visitorsPlannedChangeReason").value.trim();
  if (!changeReason) {
    showToast("Change reason required", "Add a reason before saving this edit.", "error");
    return false;
  }

  let result;
  let payload;
  if (mode === "security") {
    payload = { security_pass_id: $("visitorsPlannedPass").value.trim() || null };
  } else {
    const visitorName = formatPersonName($("visitorsPlannedVisitorName").value);
    const visitDate = $("visitorsPlannedVisitDate").value;
    if (!visitorName || !visitDate || !nativePlannedFormIsValid()) {
      showToast("Check required fields", "Visitor name, visit date and configured required fields must be completed.", "error");
      return false;
    }
    payload = {
      visitor_name: visitorName,
      company: $("visitorsPlannedCompany").value.trim() || null,
      visit_date: visitDate,
      expected_time: $("visitorsPlannedExpectedTime").value || null,
      visit_reason: nativePlannedEditFieldValue("reason", visit.visit_reason),
      vehicle_plate: nativePlannedEditFieldValue("vehicle", visit.vehicle_plate),
      onsite_contact: nativePlannedEditFieldValue("contact", visit.onsite_contact),
      security_pass_id: nativePlannedEditFieldValue("pass", visit.security_pass_id),
      modified_by: AppState.currentProfile ? AppState.currentProfile.id : null,
      modified_at: new Date().toISOString()
    };
    if (!(await validateNativePlannedRequirements(payload))) return false;
  }

  const trackedFields = Object.keys(payload).filter(key => !["modified_by", "modified_at"].includes(key));
  const changes = buildFieldDiff(visit, { ...visit, ...payload }, trackedFields);
  if (!Object.keys(changes).length) {
    showToast("No changes to save", "Update at least one field before saving.", "info");
    return false;
  }

  if (mode === "security") {
    result = await supabaseClient.rpc("update_planned_security_pass", {
      p_planned_visit_id: visit.id,
      p_security_pass_id: payload.security_pass_id
    });
  } else {
    result = await supabaseClient
      .from("planned_visits")
      .update(payload)
      .eq("id", visit.id)
      .select("id")
      .maybeSingle();
  }
  if (result.error || (mode !== "security" && !result.data)) {
    plannedSaveError(result.error, "edit");
    return false;
  }

  await writeAuditEvent("visit_changed", "planned_visits", visit.id, {
    mode,
    action: "edit",
    reason: changeReason,
    changes,
    summary: auditDiffSummary(changes)
  });
  showToast("Planned visit updated", "Changes were saved successfully.", "success");
  return true;
}

async function saveNativePlannedVisit(event) {
  event.preventDefault();
  const saveButton = $("visitorsPlannedSave");
  const recordId = $("visitorsPlannedRecordId").value;
  const visit = nativePlannedVisits.find(item => item.id === recordId);
  const mode = $("visitorsPlannedEditMode").value || "full";
  saveButton.disabled = true;
  try {
    const saved = recordId
      ? (visit ? await updateNativePlannedVisit(visit, mode) : false)
      : await createNativePlannedVisit();
    if (!saved) {
      if (recordId && !visit) {
        showToast("Planned visit unavailable", "Refresh the list and try again.", "error");
      }
      return;
    }
    closePlannedPanel();
    await Promise.all([loadNativePlannedVisits(), loadVisitorsWorkspaceMetrics()]);
  } catch (error) {
    showToast("Action failed", "The planned visit could not be saved. Please try again.", "error");
    console.error("[OH-027 unexpected planned visit save failure]", error);
  } finally {
    saveButton.disabled = false;
  }
}

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

async function countRows(table, configureQuery) {
  let query = supabaseClient
    .from(table)
    .select("id", { count: "exact", head: true });
  if (configureQuery) query = configureQuery(query);
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

function setMetricLoading() {
  [
    "visitorsTodayCount",
    "visitorsPlannedCount",
    "visitorsSignedInCount",
    "visitorsWalkInCount",
    "visitorsOverdueCount"
  ].forEach(id => setText(id, "..."));
}

export function syncVisitorsWorkspaceCapabilities() {
  const canView = canViewVisitorsWorkspace();
  const canViewHistory = canViewVisitorHistory();
  const canViewReporting = canViewVisitorReporting();
  const canExportVisitors = canViewReporting && hasCapability("visitor.export");
  const canCreateWalkIn = canView && hasCapability("visitor.create") && hasCapability("visitor.sign_in");
  const canStaffSignIn = canView && hasCapability("visitor.sign_in");
  const canStaffSignOut = canView && hasCapability("visitor.sign_out");
  setVisible("visitorsPermissionState", !canView);
  setVisible("visitorsWorkspaceContent", canView);
  setVisible("visitorsDashboardSection", canView);
  setVisible("visitorsQuickActionsSection", canCreateWalkIn || canStaffSignIn || canStaffSignOut);
  setVisible("visitorsPlannedSection", canView);
  setVisible("visitorsOnSiteSection", canView);
  setVisible("visitorsHistorySection", canViewHistory);
  setVisible("visitorsReportingSection", canViewReporting);
  setVisible("visitorsDocumentSignoffsSection", canViewDocumentSignoffs());
  setVisible("visitorsOperationalDocumentsSection", canViewReporting);
  setVisible("visitorsConfigurationSection", canOpenVisitorConfiguration());
  syncDocumentSignoffVisibility();

  setVisible("visitorsCreatePlannedButton", canView && hasCapability("visitor.create"));
  setVisible("visitorsCreateWalkInButton", canCreateWalkIn);
  setVisible("visitorsStaffSignInButton", canStaffSignIn);
  setVisible("visitorsStaffSignOutButton", canStaffSignOut);
  setVisible("visitorsReportsShortcut", canView && hasCapability("visitor.history.view"));
  setVisible("visitorsReportingShortcut", canViewReporting);
  setVisible("visitorsPlannedExportCsv", canView && hasCapability("visitor.export"));
  setVisible("visitorsPlannedExportXlsx", canView && hasCapability("visitor.export"));
  setVisible("visitorsOnSiteExportCsv", canView && hasCapability("visitor.export"));
  setVisible("visitorsOnSiteExportXlsx", canView && hasCapability("visitor.export"));
  setVisible("visitorsHistoryExportCsv", canViewHistory && hasCapability("visitor.export"));
  setVisible("visitorsHistoryExportXlsx", canViewHistory && hasCapability("visitor.export"));
  setVisible("visitorsReportingCsv", canExportVisitors);
  setVisible("visitorsReportingExcel", canExportVisitors);
  setVisible("visitorsConfigurationShortcut", canOpenVisitorConfiguration());
  if (!canView || (!hasCapability("visitor.create") && !hasCapability("visitor.edit"))) {
    if ($("visitorsPlannedPanelBackdrop") && !$("visitorsPlannedPanelBackdrop").classList.contains("hidden")) {
      closePlannedPanel();
    }
  }
  if (
    (!canView || !hasCapability("visitor.create") || !hasCapability("visitor.sign_in")) &&
    $("visitorsWalkInPanelBackdrop") &&
    !$("visitorsWalkInPanelBackdrop").classList.contains("hidden")
  ) {
    closeWalkInPanel();
  }
  if (!canView && $("visitorsDetailsPanelBackdrop") && !$("visitorsDetailsPanelBackdrop").classList.contains("hidden")) {
    closeVisitorDetails();
  }
  if (canView && $("visitorsPlannedTableBody")) renderNativePlannedVisits();
  if (canView && $("visitorsOnSiteTableBody")) renderNativeActiveVisitors();
  if (canViewHistory && $("visitorsHistoryTableBody")) renderNativeHistory();
  if (canViewReporting && $("visitorsReportingSection")) renderNativeReporting();
  refreshSectionNavigator("visitors");
}

async function loadMetric(id, loader) {
  try {
    setText(id, await loader());
    return true;
  } catch (error) {
    setText(id, "Unavailable");
    console.warn("[OH-026 Visitors metric unavailable]", { metric: id, error });
    return false;
  }
}

async function loadVisitorsWorkspaceMetrics() {
  setMetricLoading();
  setText("visitorsLastUpdated", "Refreshing...");

  const today = todayDate();
  const bounds = localDayBounds();
  const results = await Promise.all([
    loadMetric("visitorsTodayCount", () => countRows(
      "visit_log",
      query => query.gte("sign_in_time", bounds.start).lt("sign_in_time", bounds.end)
    )),
    loadMetric("visitorsPlannedCount", () => countRows(
      "planned_visits",
      query => query.eq("visit_date", today)
    )),
    loadMetric("visitorsSignedInCount", () => countRows(
      "visit_log",
      query => query.is("sign_out_time", null)
    )),
    loadMetric("visitorsWalkInCount", () => countRows(
      "visit_log",
      query => query
        .eq("visit_origin", "walk_in")
        .gte("sign_in_time", bounds.start)
        .lt("sign_in_time", bounds.end)
    )),
    loadMetric("visitorsOverdueCount", () => countRows(
      "visit_log",
      query => query.is("sign_out_time", null).lt("sign_in_time", bounds.start)
    ))
  ]);

  const availableCount = results.filter(Boolean).length;
  setText(
    "visitorsLastUpdated",
    availableCount === results.length
      ? "Last updated " + new Date().toLocaleTimeString()
      : availableCount + " of " + results.length + " summaries available"
  );
}

export async function loadVisitorsWorkspace() {
  syncVisitorsWorkspaceCapabilities();
  if (!isActiveStaffUser() || !hasCapability("visitor.view")) return;
  await Promise.all([
    loadVisitorsWorkspaceMetrics(),
    loadNativePlannedVisits(),
    loadNativeActiveVisitors(),
    loadNativeHistory(),
    canViewDocumentSignoffs() ? loadDocumentSignoffOverview() : Promise.resolve()
  ]);
}

function showNativeOnSite(status) {
  selectModuleSection("visitors", "current-visitors", { focus: true, resetScroll: false });
  $("visitorsOnSiteStatusFilter").value = status || "all";
  renderNativeActiveVisitors();
  $("visitorsOnSiteSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showNativePlannedSignIn() {
  selectModuleSection("visitors", "planned-visits", { focus: true, resetScroll: false });
  $("visitorsPlannedStatusFilter").value = "pending";
  renderNativePlannedVisits();
  $("visitorsPlannedTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openPlannedVisitRecordById(recordId) {
  const id = String(recordId || "").trim();
  if (!id) return false;

  let record = nativePlannedVisits.find(item => item.id === id) ||
    nativeHistoryRecords.find(item => item.history_record_type === "planned_visit" && item.id === id);
  if (!record) {
    const result = await supabaseClient
      .from("planned_visits")
      .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, status, created_by, modified_by, modified_at")
      .eq("id", id)
      .maybeSingle();
    if (result.error) {
      showToast("Planned visit unavailable", "The exact planned visit could not be loaded.", "error");
      return false;
    }
    record = result.data ? { ...result.data, history_record_type: "planned_visit" } : null;
  }

  if (!record) {
    showToast("Planned visit unavailable", "No planned visit was found for this reference.", "error");
    return false;
  }

  openVisitorDetails(record, plannedStatusFor(record), $("visitorsPlannedSearch"));
  return true;
}

function openLegacy(action) {
  if (!hasCapability("visitor.view")) {
    showToast("You do not have permission", "Visitors requires visitor.view.", "error");
    return;
  }
  const actionCapability = {
    "create-planned": "visitor.create",
    "create-walk-in": "visitor.create",
    "staff-sign-in": "visitor.sign_in",
    "staff-sign-out": "visitor.sign_out"
  }[action];
  if (actionCapability && !hasCapability(actionCapability)) {
    showToast(
      "You do not have permission",
      "This action requires " + actionCapability + ".",
      "error"
    );
    return;
  }
  if (visitorsDependencies.openLegacyVms) visitorsDependencies.openLegacyVms(action);
}

export function configureVisitors(dependencies) {
  visitorsDependencies = dependencies || {};
}

function initialiseVisitorPanelControllers() {
  if (plannedPanelController) return;

  resetPlannedPanelForm = createOperationalFormReset({
    form: "visitorsPlannedForm",
    validationElements: [
      "visitorsPlannedPersonLookupStatus"
    ],
    onReset() {
      if ($("visitorsPlannedPersonLookupResults")) {
        $("visitorsPlannedPersonLookupResults").replaceChildren();
        $("visitorsPlannedPersonLookupResults").classList.add("hidden");
      }
    }
  });
  resetWalkInPanelForm = createOperationalFormReset({
    form: "visitorsWalkInForm",
    validationElements: [
      "visitorsWalkInPersonLookupStatus"
    ],
    onReset() {
      if ($("visitorsWalkInPersonLookupResults")) {
        $("visitorsWalkInPersonLookupResults").replaceChildren();
        $("visitorsWalkInPersonLookupResults").classList.add("hidden");
      }
    }
  });

  plannedPanelController = createSidePanelController({
    backdrop: "visitorsPlannedPanelBackdrop",
    panel: "visitorsPlannedPanel",
    title: "visitorsPlannedPanelTitle",
    initialFocus: "visitorsPlannedVisitorName",
    closeTriggers: [
      "visitorsPlannedPanelClose",
      "visitorsPlannedCancel"
    ],
    reset: clearPlannedForm
  });
  walkInPanelController = createSidePanelController({
    backdrop: "visitorsWalkInPanelBackdrop",
    panel: "visitorsWalkInPanel",
    title: "visitorsWalkInPanelTitle",
    initialFocus: "visitorsWalkInVisitorName",
    closeTriggers: [
      "visitorsWalkInPanelClose",
      "visitorsWalkInCancel"
    ],
    reset: clearWalkInForm
  });
  detailsPanelController = createSidePanelController({
    backdrop: "visitorsDetailsPanelBackdrop",
    panel: "visitorsDetailsPanel",
    title: "visitorsDetailsPanelTitle",
    initialFocus: "visitorsDetailsPanelClose",
    closeTriggers: [
      "visitorsDetailsPanelClose"
    ],
    reset: clearVisitorDetailsPanel
  });
}

export function initialiseVisitorsWorkspace() {
  const workspace = $("visitorsWorkspace");
  if (!workspace || workspace.dataset.visitorsInitialised === "true") return;
  workspace.dataset.visitorsInitialised = "true";
  registerVisitorsSectionNavigation();
  resetNativeHistoryFilters();
  resetNativeReportingFilters();
  initialiseDocumentSignoffs({
    openLegacyVms: action => openLegacy(action)
  });
  initialiseVisitorPanelControllers();
  $("visitorsDailyPlannedDate").value = todayDate();

  if ($("visitorsRefreshButton")) {
    $("visitorsRefreshButton").addEventListener("click", loadVisitorsWorkspace);
  }

  [
    ["visitorsToolLegacyButton", "legacy-home"],
    ["visitorsWalkInLegacyButton", "walk-ins"]
  ].forEach(([id, action]) => {
    if ($(id)) $(id).addEventListener("click", () => openLegacy(action));
  });

  if ($("visitorsCreatePlannedButton")) {
    $("visitorsCreatePlannedButton").addEventListener("click", event => {
      openPlannedPanel(null, "full", event.currentTarget);
    });
  }
  if ($("visitorsCreateWalkInButton")) {
    $("visitorsCreateWalkInButton").addEventListener("click", event => {
      openWalkInPanel(event.currentTarget);
    });
  }
  if ($("visitorsStaffSignInButton")) {
    $("visitorsStaffSignInButton").addEventListener("click", showNativePlannedSignIn);
  }
  if ($("visitorsStaffSignOutButton")) {
    $("visitorsStaffSignOutButton").addEventListener("click", () => showNativeOnSite("all"));
  }
  if ($("visitorsSignedInNativeButton")) {
    $("visitorsSignedInNativeButton").addEventListener("click", () => showNativeOnSite("all"));
  }
  if ($("visitorsOverdueNativeButton")) {
    $("visitorsOverdueNativeButton").addEventListener("click", () => showNativeOnSite("overdue"));
  }
  if ($("visitorsPlannedApplyFilters")) {
    $("visitorsPlannedApplyFilters").addEventListener("click", renderNativePlannedVisits);
  }
  if ($("visitorsPlannedClearFilters")) {
    $("visitorsPlannedClearFilters").addEventListener("click", () => {
      $("visitorsPlannedSearch").value = "";
      $("visitorsPlannedDateFilter").value = "";
      $("visitorsPlannedStatusFilter").value = "active";
      renderNativePlannedVisits();
    });
  }
  if ($("visitorsPlannedSearch")) {
    $("visitorsPlannedSearch").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        renderNativePlannedVisits();
      }
    });
  }
  if ($("visitorsPlannedExportCsv")) {
    $("visitorsPlannedExportCsv").addEventListener("click", () => {
      renderNativePlannedVisits();
      exportVisitorOperationalRows(nativePlannedFilteredRows, "planned", "planned-visits", "csv");
    });
  }
  if ($("visitorsPlannedExportXlsx")) {
    $("visitorsPlannedExportXlsx").addEventListener("click", () => {
      renderNativePlannedVisits();
      exportVisitorOperationalRows(nativePlannedFilteredRows, "planned", "planned-visits", "xlsx");
    });
  }
  if ($("visitorsOnSiteRefresh")) {
    $("visitorsOnSiteRefresh").addEventListener("click", loadNativeActiveVisitors);
  }
  if ($("visitorsOnSiteApplyFilters")) {
    $("visitorsOnSiteApplyFilters").addEventListener("click", renderNativeActiveVisitors);
  }
  if ($("visitorsOnSiteClearFilters")) {
    $("visitorsOnSiteClearFilters").addEventListener("click", () => {
      $("visitorsOnSiteSearch").value = "";
      $("visitorsOnSiteStatusFilter").value = "all";
      renderNativeActiveVisitors();
    });
  }
  if ($("visitorsOnSiteSearch")) {
    $("visitorsOnSiteSearch").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        renderNativeActiveVisitors();
      }
    });
  }
  if ($("visitorsOnSiteExportCsv")) {
    $("visitorsOnSiteExportCsv").addEventListener("click", () => {
      renderNativeActiveVisitors();
      exportVisitorOperationalRows(nativeActiveFilteredRows, "history", "current-visitors", "csv");
    });
  }
  if ($("visitorsOnSiteExportXlsx")) {
    $("visitorsOnSiteExportXlsx").addEventListener("click", () => {
      renderNativeActiveVisitors();
      exportVisitorOperationalRows(nativeActiveFilteredRows, "history", "current-visitors", "xlsx");
    });
  }
  if ($("visitorsHistoryRefresh")) {
    $("visitorsHistoryRefresh").addEventListener("click", loadNativeHistory);
  }
  if ($("visitorsHistoryApplyFilters")) {
    $("visitorsHistoryApplyFilters").addEventListener("click", () => {
      activeHistoryQuickFilter = null;
      renderNativeHistory();
    });
  }
  if ($("visitorsHistoryClearFilters")) {
    $("visitorsHistoryClearFilters").addEventListener("click", resetNativeHistoryFilters);
  }
  if ($("visitorsHistorySearch")) {
    $("visitorsHistorySearch").addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      activeHistoryQuickFilter = null;
      renderNativeHistory();
    });
  }
  document.querySelectorAll("[data-history-quick-filter]").forEach(button => {
    button.addEventListener("click", () => {
      applyNativeHistoryQuickFilter(button.dataset.historyQuickFilter);
    });
  });
  if ($("visitorsHistoryExportCsv")) {
    $("visitorsHistoryExportCsv").addEventListener("click", () => {
      renderNativeHistory();
      exportVisitorOperationalRows(nativeHistoryFilteredRows, "history", "visitor-history", "csv");
    });
  }
  if ($("visitorsHistoryExportXlsx")) {
    $("visitorsHistoryExportXlsx").addEventListener("click", () => {
      renderNativeHistory();
      exportVisitorOperationalRows(nativeHistoryFilteredRows, "history", "visitor-history", "xlsx");
    });
  }
  if ($("visitorsReportingRefresh")) {
    $("visitorsReportingRefresh").addEventListener("click", loadNativeHistory);
  }
  if ($("visitorsReportingApplyFilters")) {
    $("visitorsReportingApplyFilters").addEventListener("click", renderNativeReporting);
  }
  if ($("visitorsReportingClearFilters")) {
    $("visitorsReportingClearFilters").addEventListener("click", resetNativeReportingFilters);
  }
  if ($("visitorsReportingSearch")) {
    $("visitorsReportingSearch").addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      renderNativeReporting();
    });
  }
  document.querySelectorAll("[data-native-report-select]").forEach(button => {
    button.addEventListener("click", () => {
      selectNativeReport(button.dataset.nativeReportSelect);
    });
  });
  if ($("visitorsReportingCsv")) {
    $("visitorsReportingCsv").addEventListener("click", () => exportNativeReport("csv"));
  }
  if ($("visitorsReportingExcel")) {
    $("visitorsReportingExcel").addEventListener("click", () => exportNativeReport("excel"));
  }
  if ($("visitorsDailyPlannedPrint")) {
    $("visitorsDailyPlannedPrint").addEventListener("click", printDailyPlannedVisitorList);
  }
  if ($("visitorsPlannedForm")) {
    $("visitorsPlannedForm").addEventListener("submit", saveNativePlannedVisit);
  }
  if ($("visitorsWalkInForm")) {
    $("visitorsWalkInForm").addEventListener("submit", saveNativeWalkIn);
  }
  if ($("visitorsReportsButton")) {
    $("visitorsReportsButton").addEventListener("click", () => {
      if (!hasCapability("visitor.history.view")) {
        showToast("You do not have permission", "Visitor reports require visitor.history.view.", "error");
        return;
      }
      window.dispatchEvent(new CustomEvent("oh:report-shortcut-requested", {
        detail: { shortcut: "visitor-history" }
      }));
    });
  }

  if ($("visitorsReportingButton")) {
    $("visitorsReportingButton").addEventListener("click", openNativeReporting);
  }

  if ($("visitorsConfigurationButton")) {
    $("visitorsConfigurationButton").addEventListener("click", () => {
      if (!hasAnyCapability([
        "module_configuration.view",
        "module_configuration.manage"
      ])) {
        showToast(
          "You do not have permission",
          "Visitor configuration requires module_configuration.view.",
          "error"
        );
        return;
      }
      window.dispatchEvent(new CustomEvent("oh:application-settings-requested", {
        detail: { sectionId: "modules" }
      }));
    });
  }

  window.addEventListener("oh:visitors-opened", loadVisitorsWorkspace);
  window.addEventListener("oh:visitor-data-changed", loadVisitorsWorkspace);
  window.addEventListener("oh:visitor-history-requested", openNativeHistory);
  window.addEventListener("oh:planned-visit-record-requested", async event => {
    if (!hasCapability("visitor.view")) {
      showToast("You do not have permission", "Visitors requires visitor.view.", "error");
      return;
    }
    selectModuleSection("visitors", "planned-visits", { focus: true, resetScroll: false });
    const section = $("visitorsPlannedSection");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    const detail = event && event.detail ? event.detail : {};
    if (detail.sourceRecordId) {
      await openPlannedVisitRecordById(detail.sourceRecordId);
    }
  });
  window.addEventListener("oh:visitor-reporting-requested", openNativeReporting);
  window.addEventListener("oh:capabilities-changed", syncVisitorsWorkspaceCapabilities);
  syncVisitorsWorkspaceCapabilities();
}
