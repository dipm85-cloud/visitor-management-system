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
import { formatPersonName, normalisePlate, todayDate } from "./utils.js";

let visitorsDependencies = {};
let nativePlannedVisits = [];
let nativePlannedLoadSequence = 0;
let plannedPanelReturnFocus = null;

const plannedFieldDefaults = {
  reason: { visible: true, required: false },
  vehicle: { visible: true, required: false },
  contact: { visible: true, required: true },
  pass: { visible: false, required: false }
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

function textOrDash(value) {
  const text = String(value || "").trim();
  return text || "—";
}

function plannedStatusFor(visit) {
  const status = visit.native_status || plannedVisitDisplayStatus(visit);
  return status === "planned" ? "pending" : status;
}

function plannedStatusLabel(status) {
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
  nativePlannedVisits = visits.map(visit => ({
    ...visit,
    native_status: statusMap[visit.id]
      ? statusMap[visit.id].status
      : plannedVisitDisplayStatus(visit)
  }));
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
  if (!canView || (!hasCapability("visitor.create") && !hasCapability("visitor.edit"))) {
    if ($("visitorsPlannedPanelBackdrop") && !$("visitorsPlannedPanelBackdrop").classList.contains("hidden")) {
      closePlannedPanel();
    }
  }
  if (canView && $("visitorsPlannedTableBody")) renderNativePlannedVisits();
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
  await Promise.all([loadVisitorsWorkspaceMetrics(), loadNativePlannedVisits()]);
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
    ["visitorsCreateWalkInButton", "create-walk-in"],
    ["visitorsStaffSignInButton", "staff-sign-in"],
    ["visitorsStaffSignOutButton", "staff-sign-out"],
    ["visitorsToolLegacyButton", "legacy-home"],
    ["visitorsSignedInLegacyButton", "signed-in"],
    ["visitorsWalkInLegacyButton", "walk-ins"],
    ["visitorsOverdueLegacyButton", "overdue"]
  ].forEach(([id, action]) => {
    if ($(id)) $(id).addEventListener("click", () => openLegacy(action));
  });

  if ($("visitorsCreatePlannedButton")) {
    $("visitorsCreatePlannedButton").addEventListener("click", event => {
      openPlannedPanel(null, "full", event.currentTarget);
    });
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
  if ($("visitorsPlannedForm")) {
    $("visitorsPlannedForm").addEventListener("submit", saveNativePlannedVisit);
  }
  ["visitorsPlannedPanelClose", "visitorsPlannedCancel"].forEach(id => {
    if ($(id)) $(id).addEventListener("click", closePlannedPanel);
  });
  if ($("visitorsPlannedPanelBackdrop")) {
    $("visitorsPlannedPanelBackdrop").addEventListener("click", event => {
      if (event.target === event.currentTarget) closePlannedPanel();
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
