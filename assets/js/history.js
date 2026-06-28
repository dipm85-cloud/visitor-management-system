import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { clearMessage, showMessage } from "./messages.js";
import { todayDate, safe, formatPersonName, normalisePlate } from "./utils.js";
import { writeAuditEvent } from "./audit.js";
import { refreshCoreData } from "./visitorFlow.js";
import {
  searchPlanned,
  loadSecurityPlanned,
  loadSuperPlanned
} from "./plannedVisits.js";

let historyDependencies;
let originalEditRecord = null;

export function configureHistory(dependencies) {
  historyDependencies = dependencies;
}

export async function searchHistory(targetBoxId, fromDate, toDate, name, allowEdit, allowDelete, securityOnly, filters) {
  filters = filters || {};
  const today = todayDate();

  let query = supabaseClient
    .from("visit_log")
    .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
    .order("sign_in_time", { ascending: false });

  if (name) query = query.ilike("visitor_name", "%" + formatPersonName(name) + "%");
  if (filters.company) query = query.ilike("company", "%" + filters.company.trim() + "%");
  if (filters.securityPass) query = query.ilike("security_pass_id", "%" + filters.securityPass.trim() + "%");
  if (filters.vehicle) query = query.ilike("vehicle_plate", "%" + normalisePlate(filters.vehicle) + "%");
  if (filters.contact) query = query.ilike("onsite_contact", "%" + formatPersonName(filters.contact) + "%");

  const result = await query;
  const box = $(targetBoxId);

  if (result.error) {
    box.innerHTML = "Could not search history.";
    console.error(result.error);
    return [];
  }

  let data = result.data || [];

  if (fromDate) data = data.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) >= fromDate);
  if (toDate) data = data.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) <= toDate);

  if (filters.status === "signed_in") {
    data = data.filter(r => !r.sign_out_time);
  }

  if (filters.status === "signed_out") {
    data = data.filter(r => !!r.sign_out_time);
  }

  if (filters.status === "overdue") {
    data = data.filter(r => r.sign_in_time && !r.sign_out_time && r.sign_in_time.slice(0,10) < today);
  }

  if (filters.origin) {
    data = data.filter(r => (r.visit_origin || (r.planned_visit_id ? "planned" : "walk_in")) === filters.origin);
  }

  renderHistoryResults(box, data, allowEdit, allowDelete, securityOnly);
  return data;
}

export function renderHistoryResults(box, data, allowEdit, allowDelete, securityOnly) {
  if (data.length === 0) {
    box.innerHTML = historyDependencies.buildResultSummary(0, "Visit history", "No matching records") +
      "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No history found.</div></div>";
    return;
  }

  const temp = document.createElement("div");
  data.forEach(log => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      "<div class='row-title'>" + safe(log.visitor_name) + "</div>" +
      "<div class='row-meta'>" +
      "Company: " + safe(log.company) + "<br>" +
      "Origin: " + safe((log.visit_origin || (log.planned_visit_id ? "planned" : "walk_in")).replace("_", " ")) + "<br>" +
      "Security pass: " + safe(log.security_pass_id) + "<br>" +
      "Privacy version: " + safe(log.privacy_notice_version || "-") + "<br>" +
      "Privacy accepted: " + (log.privacy_notice_accepted_at ? "Yes" : "No") + "<br>" +
      "Privacy accepted at: " + safe(log.privacy_notice_accepted_at ? new Date(log.privacy_notice_accepted_at).toLocaleString() : "-") + "<br>" +
      "Signed in: " + (log.sign_in_time ? new Date(log.sign_in_time).toLocaleString() : "-") + "<br>" +
      "Signed out: " + (log.sign_out_time ? new Date(log.sign_out_time).toLocaleString() : "-") + "<br>" +
      "Status: " + safe(log.visit_status) + "<br>" +
      "Automatic sign-out: " + (log.signed_out_automatically ? "Yes" : "No") + "<br>" +
      "Auto reason: " + safe(log.automatic_sign_out_reason) +
      "</div>";

    const actions = document.createElement("div");
    actions.className = "button-row";

    if (allowEdit || securityOnly) {
      const edit = document.createElement("button");
      edit.textContent = securityOnly ? "Edit Pass ID" : "Edit";
      edit.type = "button";
      edit.addEventListener("click", () => openEditModal("visit_log", log, securityOnly ? "security" : "full"));
      actions.appendChild(edit);
    }

    if (allowDelete) {
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.type = "button";
      del.className = "danger";
      del.addEventListener("click", () => deleteHistory(log.id));
      actions.appendChild(del);
    }

    row.appendChild(actions);
    temp.appendChild(row);
  });

  historyDependencies.setResultBox(
    box,
    historyDependencies.buildResultSummary(data.length, "Visit history", "Filtered result"),
    temp
  );
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fromDateTimeLocalValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function openEditModal(table, record, mode) {
  historyDependencies.clearEditModalMessage();
  originalEditRecord = JSON.parse(JSON.stringify(record || {}));
  if ($("editChangeReason")) $("editChangeReason").value = "";
  $("editTableName").value = table;
  $("editRecordId").value = record.id;
  $("editMode").value = mode;
  $("editModalTitle").textContent = mode === "security" ? "Edit Security Pass ID" : "Edit Visit";

  $("editFullFields").classList.toggle("hidden", mode === "security");

  $("editVisitorName").value = record.visitor_name || "";
  $("editCompany").value = record.company || "";
  $("editVisitDate").value = record.visit_date || "";
  $("editExpectedTime").value = record.expected_time || "";
  $("editReason").value = record.visit_reason || "";
  $("editVehicle").value = record.vehicle_plate || "";
  $("editContact").value = record.onsite_contact || "";
  $("editSecurityPass").value = record.security_pass_id || "";

  const canEditLogAdvanced = table === "visit_log" && mode === "full" && AppState.currentProfile && AppState.currentProfile.role === "super_user";
  ["editSignInTime","editSignOutTime","editVisitStatus","editVisitOrigin"].forEach(id => $(id).classList.toggle("hidden", !canEditLogAdvanced));
  $("editSignInTime").value = canEditLogAdvanced ? toDateTimeLocalValue(record.sign_in_time) : "";
  $("editSignOutTime").value = canEditLogAdvanced ? toDateTimeLocalValue(record.sign_out_time) : "";
  $("editVisitStatus").value = canEditLogAdvanced ? (record.visit_status || "") : "";
  $("editVisitOrigin").value = canEditLogAdvanced ? (record.visit_origin || "") : "";

  $("editModalBackdrop").classList.add("active");
  historyDependencies.focusFirstModalInput("editModalBackdrop");
}

export function closeEditModal() {
  $("editModalBackdrop").classList.remove("active");
  historyDependencies.clearEditModalMessage();
}

export async function saveEdit() {
  clearMessage();
  historyDependencies.clearEditModalMessage();

  try {
    const table = $("editTableName").value;
    const id = $("editRecordId").value;
    const mode = $("editMode").value;
    const changeReason = $("editChangeReason") ? $("editChangeReason").value.trim() : "";

    if (!changeReason) {
      historyDependencies.showEditModalMessage("Change reason is required.", "error");
      return;
    }

    historyDependencies.showEditModalMessage("Saving changes...", "success");

    const securityPass = $("editSecurityPass").value.trim() || null;

    let result;
    let payloadForAudit = {
      security_pass_id: securityPass
    };

    // Security mode uses secure RPC functions.
    // This means Security can only change Security Pass ID at database level.
    const trackedFields = table === "visit_log"
      ? ["visitor_name", "company", "visit_reason", "vehicle_plate", "onsite_contact", "security_pass_id", "sign_in_time", "sign_out_time", "visit_status", "visit_origin"]
      : ["visitor_name", "company", "visit_date", "expected_time", "visit_reason", "vehicle_plate", "onsite_contact", "security_pass_id"];

    let payload = null;

    if (mode === "security") {
      payloadForAudit = {
        security_pass_id: securityPass
      };
    } else {
      payload = {
        security_pass_id: securityPass,
        visitor_name: formatPersonName($("editVisitorName").value),
        company: $("editCompany").value.trim() || null,
        visit_reason: $("editReason").value.trim() || null,
        vehicle_plate: normalisePlate($("editVehicle").value),
        onsite_contact: formatPersonName($("editContact").value) || null,
        modified_by: AppState.currentProfile ? AppState.currentProfile.id : null,
        modified_at: new Date().toISOString()
      };

      if (table === "planned_visits") {
        payload.visit_date = $("editVisitDate").value;
        payload.expected_time = $("editExpectedTime").value || null;
      }

      if (table === "visit_log" && AppState.currentProfile && AppState.currentProfile.role === "super_user") {
        payload.sign_in_time = fromDateTimeLocalValue($("editSignInTime").value);
        payload.sign_out_time = fromDateTimeLocalValue($("editSignOutTime").value);
        if ($("editVisitStatus").value) payload.visit_status = $("editVisitStatus").value;
        if ($("editVisitOrigin").value) payload.visit_origin = $("editVisitOrigin").value;
      }

      payloadForAudit = payload;
    }

    const afterRecord = Object.assign({}, originalEditRecord || {}, payloadForAudit);
    const changes = historyDependencies.buildFieldDiff(originalEditRecord, afterRecord, trackedFields);

    if (Object.keys(changes).length === 0) {
      historyDependencies.showEditModalMessage("No field changes detected. Nothing was saved and no audit event was created.", "error");
      return;
    }

    if (mode === "security") {
      if (table === "planned_visits") {
        result = await supabaseClient.rpc("update_planned_security_pass", {
          p_planned_visit_id: id,
          p_security_pass_id: securityPass
        });
      } else if (table === "visit_log") {
        result = await supabaseClient.rpc("update_visit_log_security_pass", {
          p_visit_log_id: id,
          p_security_pass_id: securityPass
        });
      } else {
        historyDependencies.showEditModalMessage("Unknown edit target.", "error");
        return;
      }
    } else {
      result = await supabaseClient.from(table).update(payload).eq("id", id);
    }

    if (result.error) {
      historyDependencies.showEditModalMessage("Could not save changes: " + result.error.message, "error");
      showMessage("Could not save changes. See edit window for details.", "error");
      console.error(result.error);
      return;
    }

    await writeAuditEvent("visit_changed", table, id, {
      mode: mode,
      action: "edit",
      reason: changeReason,
      changes: changes,
      summary: historyDependencies.auditDiffSummary(changes)
    });

    closeEditModal();
    showMessage("Changes saved.", "success");
    await refreshCoreData();
    await reloadOpenStaffPanel();
  } catch (err) {
    historyDependencies.showEditModalMessage("Unexpected save error: " + (err.message || String(err)), "error");
    showMessage("Could not save changes. See edit window for details.", "error");
    console.error("saveEdit failed:", err);
  }
}

export async function deleteHistory(id) {
  if (!confirm("Delete this visit history row?")) return;

  const result = await supabaseClient.from("visit_log").delete().eq("id", id);
  if (result.error) {
    showMessage("Could not delete history: " + result.error.message, "error");
    return;
  }

  await writeAuditEvent("visit_changed", "visit_log", id, {
    action: "delete",
    summary: "Visit history deleted."
  });
  showMessage("History deleted.", "success");
  await refreshCoreData();
  await reloadOpenStaffPanel();
}

export async function reloadOpenStaffPanel() {
  if ($("generalPanel").classList.contains("active")) {
    await searchPlanned("generalResults", $("generalSearchDate").value, "", true, true, false);
  }

  if ($("securityPanel").classList.contains("active")) {
    await historyDependencies.loadSecurityDashboard();
    await loadSecurityPlanned();
    await loadSecurityHistory();
  }

  if ($("superPanel").classList.contains("active")) {
    await historyDependencies.loadSuperDashboard();
    await loadSuperPlanned();
    await loadSuperHistory();
  }
}

export async function loadSecurityHistory() {
  AppState.securityHistoryCache = await searchHistory(
    "securityHistoryResults",
    $("securityFromDate").value,
    $("securityToDate").value,
    $("securityNameSearch").value,
    false,
    false,
    true,
    {
      status: $("securityStatusFilter").value,
      origin: $("securityOriginFilter").value,
      company: $("securityCompanySearch").value,
      securityPass: $("securityPassSearch").value,
      vehicle: $("securityVehicleSearch").value,
      contact: $("securityContactSearch").value
    }
  );
}

export async function showSecurityOverdue() {
  $("securityStatusFilter").value = "overdue";
  $("securityFromDate").value = "";
  $("securityToDate").value = todayDate();
  await loadSecurityHistory();
}

export async function showSecurityCurrentlySignedIn() {
  $("securityStatusFilter").value = "signed_in";
  $("securityFromDate").value = "";
  $("securityToDate").value = "";
  await loadSecurityHistory();
}

export async function loadSuperHistory() {
  AppState.superHistoryCache = await searchHistory(
    "superHistoryResults",
    $("superFromDate").value,
    $("superToDate").value,
    $("superHistoryNameSearch").value,
    true,
    true,
    false,
    {
      status: $("superStatusFilter").value,
      origin: $("superOriginFilter").value,
      company: $("superCompanySearch").value,
      securityPass: $("superPassSearch").value,
      vehicle: $("superVehicleSearch").value,
      contact: $("superContactSearch").value
    }
  );
}

export async function showSuperOverdue() {
  $("superStatusFilter").value = "overdue";
  $("superFromDate").value = "";
  $("superToDate").value = todayDate();
  await loadSuperHistory();
}

export async function showSuperCurrentlySignedIn() {
  $("superStatusFilter").value = "signed_in";
  $("superFromDate").value = "";
  $("superToDate").value = "";
  await loadSuperHistory();
}
