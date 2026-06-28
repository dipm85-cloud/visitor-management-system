import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { clearMessage, showMessage } from "./messages.js";
import { todayDate, safe, formatPersonName, normalisePlate } from "./utils.js";
import { writeAuditEvent } from "./audit.js";
import { refreshCoreData } from "./visitorFlow.js";

let plannedVisitDependencies;

export function configurePlannedVisits(dependencies) {
  plannedVisitDependencies = dependencies;
}

export async function createPlannedVisit() {
  clearMessage();

  const name = formatPersonName($("plannedName").value);
  const visitDate = $("plannedDate").value;

  if (!name || !visitDate) {
    showMessage("Visitor name and visit date are required.", "error");
    return;
  }

  if (!plannedVisitDependencies.validateRequiredField("plannedReason", "Reason for visit")) return;
  if (!plannedVisitDependencies.validateRequiredField("plannedVehicle", "Vehicle licence plate")) return;
  if (!plannedVisitDependencies.validateRequiredField("plannedContact", "On-site contact")) return;
  if (!plannedVisitDependencies.validateRequiredField("plannedSecurityPass", "Security pass ID")) return;

  const result = await supabaseClient.from("planned_visits").insert({
    visitor_name: name,
    company: $("plannedCompany").value.trim() || null,
    host_id: null,
    visit_date: visitDate,
    expected_time: $("plannedTime").value || null,
    visit_reason: plannedVisitDependencies.fieldValueIfVisible("plannedReason").trim() || null,
    vehicle_plate: normalisePlate(plannedVisitDependencies.fieldValueIfVisible("plannedVehicle")),
    onsite_contact: formatPersonName(plannedVisitDependencies.fieldValueIfVisible("plannedContact")) || null,
    security_pass_id: plannedVisitDependencies.fieldValueIfVisible("plannedSecurityPass").trim() || null,
    notes: null,
    status: "planned",
    created_by: AppState.currentProfile ? AppState.currentProfile.id : null
  });

  if (result.error) {
    if (result.error.code === "23505") {
      showMessage("This visitor already has a planned visit for this date.", "error");
    } else {
      showMessage("Could not create planned visit: " + result.error.message, "error");
    }
    console.error(result.error);
    return;
  }

  ["plannedName","plannedCompany","plannedTime","plannedReason","plannedVehicle","plannedContact","plannedSecurityPass"].forEach(id => $(id).value = "");
  $("plannedDate").value = todayDate();
  await writeAuditEvent("planned_visit_created", "planned_visits", result.data && result.data[0] ? result.data[0].id : null, {
    action: "create",
    after: payload,
    summary: "Planned visit created."
  });

  showMessage("Planned visit created.", "success");
  await refreshCoreData();
}

async function getProfileNameMap(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const map = {};
  if (uniqueIds.length === 0) return map;

  const result = await supabaseClient
    .from("profiles")
    .select("id, display_name")
    .in("id", uniqueIds);

  if (result.data) {
    result.data.forEach(p => map[p.id] = p.display_name);
  }

  return map;
}

export async function searchPlanned(targetBoxId, date, name, allowEdit, allowDelete, securityOnly) {
  let query = supabaseClient
    .from("planned_visits")
    .select("id, visitor_name, company, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, created_by, modified_by, modified_at")
    .order("visit_date", { ascending: false });

  if (date) query = query.eq("visit_date", date);
  if (name) query = query.ilike("visitor_name", "%" + formatPersonName(name) + "%");

  const result = await query;
  const box = $(targetBoxId);

  if (result.error) {
    box.innerHTML = "Could not search planned visits.";
    console.error(result.error);
    return [];
  }

  const data = result.data || [];
  const statusMap = await getPlannedVisitStatusMap(data.map(v => v.id));
  const profileMap = await getProfileNameMap([
    ...data.map(v => v.created_by),
    ...data.map(v => v.modified_by)
  ]);
  const isSuper = AppState.currentProfile && AppState.currentProfile.role === "super_user";
  renderPlannedResults(box, data, allowEdit || isSuper, allowDelete || isSuper, securityOnly, statusMap, profileMap);
  return data;
}

export async function getPlannedVisitStatusMap(ids) {
  if (!ids || ids.length === 0) return {};

  const result = await supabaseClient
    .from("visit_log")
    .select("planned_visit_id, sign_in_time, sign_out_time, visit_status, visit_origin")
    .in("planned_visit_id", ids);

  const statusMap = {};
  if (result.data) {
    result.data.forEach(log => {
      if (!log.planned_visit_id || !log.sign_in_time) return;

      if (log.sign_out_time) {
        statusMap[log.planned_visit_id] = {
          status: "signed_out",
          label: "Signed out"
        };
      } else {
        statusMap[log.planned_visit_id] = {
          status: "signed_in",
          label: "Currently signed in"
        };
      }
    });
  }

  return statusMap;
}

export function renderPlannedResults(box, data, allowEdit, allowDelete, securityOnly, statusMap, profileMap) {
  statusMap = statusMap || {};
  profileMap = profileMap || {};

  if (data.length === 0) {
    box.innerHTML = plannedVisitDependencies.buildResultSummary(0, "Planned visits", "No matching records") +
      "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No planned visits found.</div></div>";
    return;
  }

  const temp = document.createElement("div");
  data.forEach(visit => {
    const statusInfo = statusMap[visit.id] || { status: "pending", label: "Pending / not arrived" };
    const hasStarted = statusInfo.status !== "pending";
    const statusClass =
      statusInfo.status === "signed_in" ? "status-in" :
      statusInfo.status === "signed_out" ? "status-out" :
      "status-pending";
    const isSuper = AppState.currentProfile && AppState.currentProfile.role === "super_user";

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      "<div class='row-title'>" + safe(visit.visitor_name) + "</div>" +
      "<div class='row-meta'>" +
      "Date: " + safe(visit.visit_date) + " " + safe(visit.expected_time) + "<br>" +
      "Company: " + safe(visit.company) + "<br>" +
      "Reason: " + safe(visit.visit_reason) + "<br>" +
      "Vehicle: " + safe(visit.vehicle_plate) + "<br>" +
      "Contact: " + safe(visit.onsite_contact) + "<br>" +
      "Security pass: " + safe(visit.security_pass_id) + "<br>" +
      "Created by: " + safe(profileMap[visit.created_by]) + "<br>" +
      "Last modified by: " + safe(profileMap[visit.modified_by]) + "<br>" +
      "Last modified: " + (visit.modified_at ? new Date(visit.modified_at).toLocaleString() : "-") + "<br>" +
      "<span class='status-badge " + statusClass + "'>" + statusInfo.label + "</span>" +
      "</div>";

    const actions = document.createElement("div");
    actions.className = "button-row";

    if (securityOnly) {
      const edit = document.createElement("button");
      edit.textContent = "Edit Pass ID";
      edit.type = "button";
      edit.addEventListener("click", () => plannedVisitDependencies.openEditModal("planned_visits", visit, "security"));
      actions.appendChild(edit);
    } else {
      if ((allowEdit || isSuper) && (!hasStarted || isSuper)) {
        const edit = document.createElement("button");
        edit.textContent = "Edit";
        edit.type = "button";
        edit.addEventListener("click", () => plannedVisitDependencies.openEditModal("planned_visits", visit, "full"));
        actions.appendChild(edit);
      }

      if ((allowDelete || isSuper) && (!hasStarted || isSuper)) {
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.type = "button";
        del.className = "danger";
        del.addEventListener("click", () => deletePlannedVisit(visit.id));
        actions.appendChild(del);
      }

      if ((allowEdit || allowDelete) && hasStarted && !isSuper) {
        const note = document.createElement("div");
        note.className = "lock-note";
        note.textContent = "Locked: visitor has already signed in.";
        actions.appendChild(note);
      }
    }

    row.appendChild(actions);
    temp.appendChild(row);
  });

  plannedVisitDependencies.setResultBox(
    box,
    plannedVisitDependencies.buildResultSummary(data.length, "Planned visits", "Filtered result"),
    temp
  );
}

export async function deletePlannedVisit(id) {
  if (!confirm("Delete this planned visit and any linked history?")) return;

  const logDelete = await supabaseClient.from("visit_log").delete().eq("planned_visit_id", id);
  if (logDelete.error) {
    showMessage("Could not delete linked history: " + logDelete.error.message, "error");
    return;
  }

  const plannedDelete = await supabaseClient.from("planned_visits").delete().eq("id", id);
  if (plannedDelete.error) {
    showMessage("Could not delete planned visit: " + plannedDelete.error.message, "error");
    return;
  }

  await writeAuditEvent("visit_changed", "planned_visits", id, {
    action: "delete",
    summary: "Planned visit deleted."
  });
  showMessage("Planned visit deleted.", "success");
  await refreshCoreData();
  await plannedVisitDependencies.reloadOpenStaffPanel();
}

export async function loadSecurityPlanned() {
  AppState.securityPlannedCache = await searchPlanned("securityPlannedResults", $("securityPlannedDate").value, "", false, false, true);
}

export async function loadSuperPlanned() {
  AppState.superPlannedCache = await searchPlanned("superPlannedResults", $("superPlannedDate").value, $("superNameSearch").value, true, true, false);
}
