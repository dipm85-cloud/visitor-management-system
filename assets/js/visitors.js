import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { todayDate } from "./utils.js";

let visitorsDependencies = {};

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
  setVisible("visitorsPermissionState", !canView);
  setVisible("visitorsWorkspaceContent", canView);

  setVisible("visitorsCreatePlannedButton", canView && hasCapability("visitor.create"));
  setVisible("visitorsCreateWalkInButton", canView && hasCapability("visitor.create"));
  setVisible("visitorsStaffSignInButton", canView && hasCapability("visitor.sign_in"));
  setVisible("visitorsStaffSignOutButton", canView && hasCapability("visitor.sign_out"));
  setVisible("visitorsReportsShortcut", canView && hasCapability("visitor.history.view"));
  setVisible(
    "visitorsConfigurationShortcut",
    canView && hasAnyCapability(["settings.view", "settings.edit"])
  );
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

export async function loadVisitorsWorkspace() {
  syncVisitorsWorkspaceCapabilities();
  if (!isActiveStaffUser() || !hasCapability("visitor.view")) return;

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

  if ($("visitorsRefreshButton")) {
    $("visitorsRefreshButton").addEventListener("click", loadVisitorsWorkspace);
  }

  [
    ["visitorsCreatePlannedButton", "create-planned"],
    ["visitorsCreateWalkInButton", "create-walk-in"],
    ["visitorsStaffSignInButton", "staff-sign-in"],
    ["visitorsStaffSignOutButton", "staff-sign-out"],
    ["visitorsOpenLegacyButton", "legacy-home"],
    ["visitorsToolLegacyButton", "legacy-home"],
    ["visitorsPlannedLegacyButton", "planned-visits"],
    ["visitorsSignedInLegacyButton", "signed-in"],
    ["visitorsWalkInLegacyButton", "walk-ins"],
    ["visitorsOverdueLegacyButton", "overdue"]
  ].forEach(([id, action]) => {
    if ($(id)) $(id).addEventListener("click", () => openLegacy(action));
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
  window.addEventListener("oh:capabilities-changed", syncVisitorsWorkspaceCapabilities);
  syncVisitorsWorkspaceCapabilities();
}
