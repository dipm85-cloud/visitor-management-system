import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showMessage } from "./messages.js";
import { todayDate, safe } from "./utils.js";

let analyticsDependencies;

export function configureAnalytics(dependencies) {
  analyticsDependencies = dependencies;
}

export async function loadAnalytics(prefix) {
  const fromEl = prefix ? $(prefix + "AnalyticsFromDate") : $("analyticsFromDate");
  const toEl = prefix ? $(prefix + "AnalyticsToDate") : $("analyticsToDate");
  const summaryEl = prefix ? $(prefix + "AnalyticsSummary") : $("analyticsSummary");
  const companiesEl = prefix ? $(prefix + "AnalyticsTopCompanies") : $("analyticsTopCompanies");
  const hoursEl = prefix ? $(prefix + "AnalyticsPeakHours") : $("analyticsPeakHours");

  if (!summaryEl) return;

  summaryEl.innerHTML = "Loading analytics...";
  companiesEl.innerHTML = "Loading...";
  hoursEl.innerHTML = "Loading...";

  const result = await supabaseClient.rpc("get_visitor_analytics", {
    p_from_date: fromEl.value || null,
    p_to_date: toEl.value || null
  });

  if (result.error) {
    summaryEl.innerHTML = "";
    companiesEl.innerHTML = "Could not load analytics.";
    hoursEl.innerHTML = result.error.message;
    showMessage("Could not load analytics: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  const data = result.data || {};
  const summary = data.summary || {};
  const topCompanies = data.top_companies || [];
  const peakHours = data.peak_hours || [];

  summaryEl.innerHTML =
    statCard("Total Visits", summary.total_visits || 0) +
    statCard("Planned", summary.planned_visits || 0) +
    statCard("Walk-ins", summary.walk_in_visits || 0) +
    statCard("Auto Signed Out", summary.auto_signed_out || 0);

  renderSimpleMetricList(companiesEl, topCompanies, "company", "visits");
  renderSimpleMetricList(hoursEl, peakHours, "hour", "visits");
}

export function renderSimpleMetricList(box, rows, labelKey, valueKey) {
  if (!rows || rows.length === 0) {
    box.innerHTML = "<div class='row-meta'>No data found.</div>";
    return;
  }

  const temp = document.createElement("div");
  rows.forEach(row => {
    const item = document.createElement("div");
    item.className = "row";
    item.innerHTML =
      "<div class='row-title'>" + safe(row[labelKey]) + "</div>" +
      "<div class='row-meta'>Visits: " + safe(row[valueKey]) + "</div>";
    temp.appendChild(item);
  });

  analyticsDependencies.setResultBox(
    box,
    analyticsDependencies.buildResultSummary(rows.length, "Rows", "Analytics result"),
    temp
  );
}

export async function loadSecurityDashboard() {
  const today = todayDate();

  const planned = await supabaseClient.from("planned_visits").select("id").eq("visit_date", today);
  const active = await supabaseClient.from("visit_log").select("id").is("sign_out_time", null);
  const todayLogs = await supabaseClient.from("visit_log").select("id, sign_in_time");
  const visitsToday = (todayLogs.data || []).filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) === today);

  $("securityDashboard").innerHTML =
    statCard("Planned Today", (planned.data || []).length) +
    statCard("Currently On Site", (active.data || []).length) +
    statCard("Visits Today", visitsToday.length) +
    statCard("Audit Mode", "ON");
}

export async function loadSuperDashboard() {
  const today = todayDate();

  const plannedToday = await supabaseClient
    .from("planned_visits")
    .select("id")
    .eq("visit_date", today);

  const allLogs = await supabaseClient
    .from("visit_log")
    .select("id, sign_in_time, sign_out_time");

  const logs = allLogs.data || [];
  const active = logs.filter(r => !r.sign_out_time);
  const visitsToday = logs.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) === today);
  const overdue = active.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) < today);

  $("superDashboard").innerHTML =
    statCard("Expected Today", (plannedToday.data || []).length) +
    statCard("Visits Today", visitsToday.length) +
    statCard("Currently On Site", active.length) +
    statCard("Overdue Sign Outs", overdue.length);

  if ($("superAlertContent")) {
    if (overdue.length > 0) {
      $("superAlertContent").innerHTML =
        "<div class='lock-note'>⚠ " + overdue.length + " visitor(s) are still signed in from previous days.</div>";
    } else {
      $("superAlertContent").innerHTML =
        "<div class='row-meta'>No overdue sign-outs detected.</div>";
    }
  }
}

export function statCard(label, value) {
  return "<div class='stat-card'><div class='stat-value'>" + value + "</div><div class='stat-label'>" + label + "</div></div>";
}
