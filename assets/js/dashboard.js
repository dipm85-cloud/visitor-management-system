import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { todayDate } from "./utils.js";

let dashboardDependencies = {};

function isStaffUser() {
  return AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";
}

function canViewVisitors() {
  return hasCapability("visitor.view");
}

function canViewPeople() {
  return hasAnyCapability(["people.view", "people.manage"]);
}

function canUseReferenceData() {
  return hasAnyCapability(["settings.view", "settings.edit"]);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setSectionVisible(id, visible) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !visible);
}

function showDashboardError(message) {
  console.warn("Dashboard load issue:", message);
  if (isStaffUser()) showToast("Dashboard", message, "error");
}

async function countRows(table, configureQuery) {
  let query = supabaseClient
    .from(table)
    .select("id", { count: "exact", head: true });

  query = configureQuery ? configureQuery(query) : query;
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

async function loadVisitorMetrics() {
  const today = todayDate();
  const startOfToday = today + "T00:00:00";

  const [plannedToday, signedIn, overdue] = await Promise.all([
    countRows("planned_visits", query => query.eq("visit_date", today)),
    countRows("visit_log", query => query.is("sign_out_time", null)),
    countRows("visit_log", query => query.is("sign_out_time", null).lt("sign_in_time", startOfToday))
  ]);

  setText("dashboardPlannedTodayCount", plannedToday);
  setText("dashboardSignedInCount", signedIn);
  setText("dashboardOverdueCount", overdue);
}

async function loadPeopleMetrics() {
  const [peopleCount, activePeopleCount] = await Promise.all([
    countRows("people"),
    countRows("people", query => query.eq("active", true))
  ]);

  setText("dashboardPeopleCount", peopleCount);
  setText("dashboardActivePeopleCount", activePeopleCount);
}

function syncDashboardCapabilities() {
  const visitorVisible = canViewVisitors();
  const peopleVisible = canViewPeople();
  const referenceVisible = canUseReferenceData();

  setSectionVisible("dashboardVisitorWidgets", visitorVisible);
  setSectionVisible("dashboardPeopleWidgets", peopleVisible);
  setSectionVisible("dashboardAdminWidgets", referenceVisible);
  setSectionVisible("dashboardOpenVisitorsButton", visitorVisible);
  setSectionVisible("dashboardOpenPeopleButton", peopleVisible);
  setSectionVisible("dashboardOpenReferenceButton", referenceVisible);
  setSectionVisible("dashboardNoWidgets", !visitorVisible && !peopleVisible && !referenceVisible);
}

function setDashboardLoading() {
  [
    "dashboardPlannedTodayCount",
    "dashboardSignedInCount",
    "dashboardOverdueCount",
    "dashboardPeopleCount",
    "dashboardActivePeopleCount"
  ].forEach(id => setText(id, "..."));
}

export function configureDashboard(dependencies) {
  dashboardDependencies = dependencies || {};
}

export async function loadDashboard() {
  syncDashboardCapabilities();
  setDashboardLoading();
  setText("dashboardLastUpdated", "Refreshing...");

  const work = [];

  if (canViewVisitors()) {
    work.push(loadVisitorMetrics().catch(err => {
      showDashboardError("Visitor widgets could not be loaded: " + (err.message || String(err)));
      ["dashboardPlannedTodayCount", "dashboardSignedInCount", "dashboardOverdueCount"].forEach(id => setText(id, "-"));
    }));
  }

  if (canViewPeople()) {
    work.push(loadPeopleMetrics().catch(err => {
      showDashboardError("People widgets could not be loaded: " + (err.message || String(err)));
      ["dashboardPeopleCount", "dashboardActivePeopleCount"].forEach(id => setText(id, "-"));
    }));
  }

  await Promise.all(work);
  setText("dashboardLastUpdated", "Last updated " + new Date().toLocaleTimeString());
}

export function initialiseDashboard() {
  if ($("dashboardRefreshButton")) $("dashboardRefreshButton").addEventListener("click", loadDashboard);
  if ($("dashboardOpenVisitorsButton")) $("dashboardOpenVisitorsButton").addEventListener("click", () => {
    if (dashboardDependencies.openVisitors) dashboardDependencies.openVisitors();
  });
  if ($("dashboardOpenPeopleButton")) $("dashboardOpenPeopleButton").addEventListener("click", () => {
    if (dashboardDependencies.openPeople) dashboardDependencies.openPeople();
  });
  if ($("dashboardOpenReferenceButton")) $("dashboardOpenReferenceButton").addEventListener("click", () => {
    if (dashboardDependencies.openReferenceData) dashboardDependencies.openReferenceData();
  });

  window.addEventListener("oh:dashboard-opened", loadDashboard);
  syncDashboardCapabilities();
}
