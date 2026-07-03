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
  exportToExcel,
  normaliseExportRows
} from "./exports.js";

let visitorsDependencies = {};
let nativePlannedVisits = [];
let nativePlannedLoadSequence = 0;
let nativeActiveVisitors = [];
let nativeActiveLoadSequence = 0;
let nativeHistoryRecords = [];
let nativeHistoryLoadSequence = 0;
let activeHistoryQuickFilter = null;
let selectedNativeReportType = "history";
let nativeReportRows = [];
let plannedPanelReturnFocus = null;
let walkInPanelReturnFocus = null;
let detailsPanelReturnFocus = null;

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
  setVisible("visitorsPlannedTableWrap", state === "ready");
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

function canOpenFullPlannedEdit(visit) {
  if (AppState.currentProfile && AppState.currentProfile.role === "super_user") return true;
  return plannedStatusFor(visit) === "pending";
}

function editModeForCurrentUser() {
  return AppState.currentProfile && AppState.currentProfile.role === "security"
    ? "security"
    : "full";
}

function renderNativePlannedVisits() {
  const body = $("visitorsPlannedTableBody");
  if (!body) return;
  body.replaceChildren();

  const search = String($("visitorsPlannedSearch").value || "").trim().toLowerCase();
  const date = $("visitorsPlannedDateFilter").value;
  const status = $("visitorsPlannedStatusFilter").value;
  const filtered = nativePlannedVisits.filter(visit => {
    const searchable = [
      visit.visitor_name,
      visit.company,
      visit.onsite_contact,
      visit.visit_reason,
      visit.vehicle_plate
    ].join(" ").toLowerCase();
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
    const mode = editModeForCurrentUser();
    if (
      visitStatus === "pending" &&
      visit.visit_date === todayDate() &&
      hasCapability("visitor.sign_in")
    ) {
      const signInButton = document.createElement("button");
      signInButton.type = "button";
      signInButton.textContent = "Sign In";
      signInButton.addEventListener("click", () => signInNativePlannedVisit(visit, signInButton));
      actionCell.appendChild(signInButton);
    }
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "secondary";
    detailsButton.textContent = "View Details";
    detailsButton.addEventListener("click", () => openVisitorDetails(visit, visitStatus, detailsButton));
    actionCell.appendChild(detailsButton);
    if (
      hasCapability("visitor.edit") &&
      (mode === "security" || canOpenFullPlannedEdit(visit))
    ) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary";
      editButton.textContent = mode === "security" ? "Edit Pass ID" : "Edit";
      editButton.addEventListener("click", () => openPlannedPanel(visit, mode, editButton));
      actionCell.appendChild(editButton);
    } else if (hasCapability("visitor.edit") && plannedStatusFor(visit) !== "pending") {
      const locked = document.createElement("span");
      locked.className = "visitors-planned-table-secondary";
      locked.textContent = "Locked after sign-in";
      actionCell.appendChild(locked);
    }
    if (isSuperUserRecoveryAllowed(visit)) {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "danger";
      cancelButton.textContent = "Cancel Visit";
      cancelButton.addEventListener("click", () => cancelNativePlannedVisit(visit, cancelButton));
      actionCell.appendChild(cancelButton);
    }
    row.appendChild(actionCell);
    body.appendChild(row);
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
  setVisible("visitorsOnSiteTableWrap", state === "ready");
}

function renderNativeActiveVisitors() {
  const body = $("visitorsOnSiteTableBody");
  if (!body) return;
  body.replaceChildren();
  const search = String($("visitorsOnSiteSearch").value || "").trim().toLowerCase();
  const statusFilter = $("visitorsOnSiteStatusFilter").value;
  const filtered = nativeActiveVisitors.filter(visit => {
    const status = activeVisitorStatus(visit);
    const searchable = [
      visit.visitor_name,
      visit.company,
      visit.onsite_contact,
      visit.security_pass_id,
      visit.vehicle_plate
    ].join(" ").toLowerCase();
    return (!search || searchable.includes(search)) &&
      (statusFilter === "all" || statusFilter === status);
  });

  if (!filtered.length) {
    setActiveListState("empty");
    return;
  }

  filtered.forEach(visit => {
    const row = document.createElement("tr");
    appendTextCell(row, visit.visitor_name, visit.company || "");
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
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "visitors-planned-row-action";
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "secondary";
    detailsButton.textContent = "View Details";
    detailsButton.addEventListener("click", () => openVisitorDetails(visit, status, detailsButton));
    actionCell.appendChild(detailsButton);
    if (hasCapability("visitor.sign_out")) {
      const signOutButton = document.createElement("button");
      signOutButton.type = "button";
      signOutButton.className = "danger";
      signOutButton.textContent = "Sign Out";
      signOutButton.addEventListener("click", () => signOutNativeVisitor(visit, signOutButton));
      actionCell.appendChild(signOutButton);
    }
    row.appendChild(actionCell);
    body.appendChild(row);
  });

  setActiveListState("ready");
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
  nativeActiveVisitors = result.data || [];
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
  return plannedStatusLabel(status);
}

function historyStatusClass(status) {
  if (status === "overdue") return "status-overdue";
  if (status === "signed_in") return "status-in";
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
  setVisible("visitorsHistoryTableWrap", state === "ready");
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
    const searchable = [
      record.visitor_name,
      record.company,
      record.onsite_contact
    ].join(" ").toLowerCase();
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
  });

  setText(
    "visitorsHistoryResultSummary",
    filtered.length + " of " + nativeHistoryRecords.length + " available records shown"
  );
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

function openNativeHistory() {
  if (!hasCapability("visitor.history.view")) {
    showToast("You do not have permission", "Visitor history requires visitor.history.view.", "error");
    return;
  }
  const section = $("visitorsHistorySection");
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const searchable = [
      record.visitor_name,
      record.company,
      record.onsite_contact
    ].join(" ").toLowerCase();
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
  $("visitorsPlannedForm").reset();
  resetVisitorIdentitySelection("native_planned");
  $("visitorsPlannedRecordId").value = "";
  $("visitorsPlannedEditMode").value = "full";
  $("visitorsPlannedVisitDate").value = todayDate();
}

async function cancelNativePlannedVisit(visit, sourceButton) {
  if (!isSuperUserRecoveryAllowed(visit)) {
    showToast("Planned visit not cancelled", "Only a SuperUser can cancel a pending planned visit.", "error");
    return;
  }
  if (!confirm("Cancel this pending planned visit? It will be removed from the default active list.")) return;

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
  plannedPanelReturnFocus = returnFocus || document.activeElement;
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

  $("visitorsPlannedPanelBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const firstInput = effectiveMode === "security"
    ? $("visitorsPlannedPass")
    : $("visitorsPlannedVisitorName");
  if (firstInput) firstInput.focus();
}

function closePlannedPanel() {
  $("visitorsPlannedPanelBackdrop").classList.add("hidden");
  document.body.style.overflow = "";
  if (plannedPanelReturnFocus && typeof plannedPanelReturnFocus.focus === "function") {
    plannedPanelReturnFocus.focus();
  }
  plannedPanelReturnFocus = null;
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
  $("visitorsWalkInForm").reset();
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
  walkInPanelReturnFocus = returnFocus || document.activeElement;
  $("visitorsWalkInPanelBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("visitorsWalkInVisitorName").focus();
}

function closeWalkInPanel() {
  $("visitorsWalkInPanelBackdrop").classList.add("hidden");
  document.body.style.overflow = "";
  if (walkInPanelReturnFocus && typeof walkInPanelReturnFocus.focus === "function") {
    walkInPanelReturnFocus.focus();
  }
  walkInPanelReturnFocus = null;
}

function formatVisitorDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function openVisitorDetails(record, status, returnFocus) {
  detailsPanelReturnFocus = returnFocus || document.activeElement;
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
  setText("visitorsDetailsRecordId", textOrDash(record.id));
  setText("visitorsDetailsPlannedId", textOrDash(record.planned_visit_id));
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
  $("visitorsDetailsPanelBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("visitorsDetailsPanelClose").focus();
}

function closeVisitorDetails() {
  $("visitorsDetailsPanelBackdrop").classList.add("hidden");
  document.body.style.overflow = "";
  if (detailsPanelReturnFocus && typeof detailsPanelReturnFocus.focus === "function") {
    detailsPanelReturnFocus.focus();
  }
  detailsPanelReturnFocus = null;
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
  if (!confirm("Sign out " + textOrDash(visit.visitor_name) + "?")) return;

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
  const canView = isActiveStaffUser() && hasCapability("visitor.view");
  const canViewHistory = canView && hasCapability("visitor.history.view");
  const canViewReporting = canViewHistory && hasCapability("reports.view");
  const canExportVisitors = canViewReporting && hasCapability("visitor.export");
  setVisible("visitorsPermissionState", !canView);
  setVisible("visitorsWorkspaceContent", canView);
  setVisible("visitorsHistorySection", canViewHistory);
  setVisible("visitorsReportingSection", canViewReporting);

  setVisible("visitorsCreatePlannedButton", canView && hasCapability("visitor.create"));
  setVisible(
    "visitorsCreateWalkInButton",
    canView && hasCapability("visitor.create") && hasCapability("visitor.sign_in")
  );
  setVisible("visitorsStaffSignInButton", canView && hasCapability("visitor.sign_in"));
  setVisible("visitorsStaffSignOutButton", canView && hasCapability("visitor.sign_out"));
  setVisible("visitorsReportsShortcut", canView && hasCapability("visitor.history.view"));
  setVisible("visitorsReportingShortcut", canViewReporting);
  setVisible("visitorsReportingCsv", canExportVisitors);
  setVisible("visitorsReportingExcel", canExportVisitors);
  setVisible(
    "visitorsConfigurationShortcut",
    canView && hasAnyCapability(["settings.view", "settings.edit"])
  );
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
    loadNativeHistory()
  ]);
}

function showNativeOnSite(status) {
  $("visitorsOnSiteStatusFilter").value = status || "all";
  renderNativeActiveVisitors();
  $("visitorsOnSiteSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showNativePlannedSignIn() {
  $("visitorsPlannedStatusFilter").value = "pending";
  renderNativePlannedVisits();
  $("visitorsPlannedTitle").scrollIntoView({ behavior: "smooth", block: "start" });
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

export function initialiseVisitorsWorkspace() {
  const workspace = $("visitorsWorkspace");
  if (!workspace || workspace.dataset.visitorsInitialised === "true") return;
  workspace.dataset.visitorsInitialised = "true";
  resetNativeHistoryFilters();
  resetNativeReportingFilters();

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
  if ($("visitorsPlannedForm")) {
    $("visitorsPlannedForm").addEventListener("submit", saveNativePlannedVisit);
  }
  if ($("visitorsWalkInForm")) {
    $("visitorsWalkInForm").addEventListener("submit", saveNativeWalkIn);
  }
  ["visitorsPlannedPanelClose", "visitorsPlannedCancel"].forEach(id => {
    if ($(id)) $(id).addEventListener("click", closePlannedPanel);
  });
  if ($("visitorsPlannedPanelBackdrop")) {
    $("visitorsPlannedPanelBackdrop").addEventListener("click", event => {
      if (event.target === event.currentTarget) closePlannedPanel();
    });
  }
  ["visitorsWalkInPanelClose", "visitorsWalkInCancel"].forEach(id => {
    if ($(id)) $(id).addEventListener("click", closeWalkInPanel);
  });
  if ($("visitorsWalkInPanelBackdrop")) {
    $("visitorsWalkInPanelBackdrop").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeWalkInPanel();
    });
  }
  if ($("visitorsDetailsPanelClose")) {
    $("visitorsDetailsPanelClose").addEventListener("click", closeVisitorDetails);
  }
  if ($("visitorsDetailsPanelBackdrop")) {
    $("visitorsDetailsPanelBackdrop").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeVisitorDetails();
    });
  }
  document.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      $("visitorsPlannedPanelBackdrop") &&
      !$("visitorsPlannedPanelBackdrop").classList.contains("hidden")
    ) {
      closePlannedPanel();
    }
    if (
      event.key === "Escape" &&
      $("visitorsWalkInPanelBackdrop") &&
      !$("visitorsWalkInPanelBackdrop").classList.contains("hidden")
    ) {
      closeWalkInPanel();
    }
    if (
      event.key === "Escape" &&
      $("visitorsDetailsPanelBackdrop") &&
      !$("visitorsDetailsPanelBackdrop").classList.contains("hidden")
    ) {
      closeVisitorDetails();
    }
  });

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
      if (!hasAnyCapability(["settings.view", "settings.edit"])) {
        showToast("You do not have permission", "Visitor configuration requires settings.view or settings.edit.", "error");
        return;
      }
      const settingsShortcut = $("ohSettingsShortcut");
      if (settingsShortcut) settingsShortcut.click();
    });
  }

  window.addEventListener("oh:visitors-opened", loadVisitorsWorkspace);
  window.addEventListener("oh:visitor-history-requested", openNativeHistory);
  window.addEventListener("oh:visitor-reporting-requested", openNativeReporting);
  window.addEventListener("oh:capabilities-changed", syncVisitorsWorkspaceCapabilities);
  syncVisitorsWorkspaceCapabilities();
}
