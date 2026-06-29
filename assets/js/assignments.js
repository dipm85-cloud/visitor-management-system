import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { todayDate } from "./utils.js";

const ASSIGNMENT_COLUMNS = [
  "id",
  "person_id",
  "site_id",
  "employer_organisation_id",
  "department_id",
  "contract_id",
  "job_role_id",
  "manager_person_id",
  "assignment_type",
  "shift_pattern_id",
  "break_rule_id",
  "shift_start_time",
  "shift_end_time",
  "cycle_anchor_date",
  "employment_start_date",
  "assignment_start_date",
  "assignment_end_date",
  "active",
  "notes",
  "created_at",
  "updated_at"
].join(", ");

const lookupDefinitions = {
  sites: {
    table: "sites",
    columns: "id, site_code, site_name, active",
    orderBy: "site_name",
    label(record) {
      return record.site_name + (record.site_code ? " (" + record.site_code + ")" : "");
    }
  },
  organisations: {
    table: "organisations",
    columns: "id, organisation_code, organisation_name, active",
    orderBy: "organisation_name",
    label(record) {
      return record.organisation_name +
        (record.organisation_code ? " (" + record.organisation_code + ")" : "");
    }
  },
  departments: {
    table: "departments",
    columns: "id, department_code, department_name, active",
    orderBy: "department_name",
    label(record) {
      return record.department_name +
        (record.department_code ? " (" + record.department_code + ")" : "");
    }
  },
  contracts: {
    table: "contracts",
    columns: "id, contract_code, contract_name, active",
    orderBy: "contract_name",
    label(record) {
      return record.contract_name + (record.contract_code ? " (" + record.contract_code + ")" : "");
    }
  },
  jobRoles: {
    table: "job_roles",
    columns: "id, role_code, role_name, active",
    orderBy: "role_name",
    label(record) {
      return record.role_name + (record.role_code ? " (" + record.role_code + ")" : "");
    }
  },
  shiftPatterns: {
    table: "shift_patterns",
    columns: "id, shift_code, shift_name, active",
    orderBy: "shift_name",
    label(record) {
      return record.shift_name + (record.shift_code ? " (" + record.shift_code + ")" : "");
    }
  },
  breakRules: {
    table: "break_rules",
    columns: "id, break_rule_code, break_rule_name, active",
    orderBy: "break_rule_name",
    label(record) {
      return record.break_rule_name +
        (record.break_rule_code ? " (" + record.break_rule_code + ")" : "");
    }
  }
};

const lookupControlMap = {
  sites: "assignmentSite",
  organisations: "assignmentEmployer",
  departments: "assignmentDepartment",
  contracts: "assignmentContract",
  jobRoles: "assignmentJobRole",
  shiftPatterns: "assignmentShiftPattern",
  breakRules: "assignmentBreakRule"
};

const assignmentLookups = {};
let assignmentsCache = [];
let selectedPersonId = null;
let selectedPersonName = "";
let assignmentsLoadedSuccessfully = false;
let assignmentEditorTrigger = null;
const ASSIGNMENT_DETAIL_ROW_ID = "inlineAssignmentDetailRow";

function hasAssignmentAccess() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role === "super_user"
  );
}

function requireAssignmentAccess() {
  if (hasAssignmentAccess()) return true;
  showToast("Access denied", "Assignments are currently available to SuperUsers only.", "error");
  return false;
}

function optionalValue(id) {
  const value = $(id).value.trim();
  return value || null;
}

function lookupLabel(lookupName, id) {
  if (!id) return "—";
  const item = (assignmentLookups[lookupName] || []).find(record => record.id === id);
  return item ? item.label : "Unknown";
}

function populateLookup(lookupName) {
  const control = $(lookupControlMap[lookupName]);
  const currentValue = control.value;
  control.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Not selected";
  control.appendChild(emptyOption);

  (assignmentLookups[lookupName] || []).forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label + (item.active === false ? " — inactive" : "");
    control.appendChild(option);
  });

  if (currentValue) control.value = currentValue;
}

export async function loadAssignmentLookups() {
  const entries = Object.entries(lookupDefinitions);
  const results = await Promise.all(entries.map(async ([lookupName, definition]) => {
    const result = await supabaseClient
      .from(definition.table)
      .select(definition.columns)
      .order(definition.orderBy, { ascending: true });

    if (result.error) throw result.error;
    return [
      lookupName,
      (result.data || []).map(record => ({
        id: record.id,
        label: definition.label(record),
        active: record.active
      }))
    ];
  }));

  results.forEach(([lookupName, records]) => {
    assignmentLookups[lookupName] = records;
    populateLookup(lookupName);
  });
}

export function getSelectedAssignmentPersonId() {
  return selectedPersonId;
}

export function detachAssignmentInlinePlacement() {
  const section = $("personAssignmentsSection");
  const existingRow = document.getElementById(ASSIGNMENT_DETAIL_ROW_ID);
  const fallback = document.querySelector(".people-workspace-layout");

  if (section && fallback && section.parentElement !== fallback) {
    fallback.appendChild(section);
  }
  if (existingRow) existingRow.remove();
}

export function syncAssignmentInlinePlacement() {
  const section = $("personAssignmentsSection");
  const existingRow = document.getElementById(ASSIGNMENT_DETAIL_ROW_ID);
  if (existingRow) existingRow.remove();
  if (!section) return false;

  if (!selectedPersonId) {
    section.classList.add("hidden");
    return false;
  }

  const selectedRow = document.querySelector('#peopleResults tr[data-person-id="' + selectedPersonId + '"]');
  if (!selectedRow) {
    section.classList.add("hidden");
    closeAssignmentEditor();
    return false;
  }

  const detailRow = document.createElement("tr");
  detailRow.id = ASSIGNMENT_DETAIL_ROW_ID;
  detailRow.className = "assignment-inline-row";

  const detailCell = document.createElement("td");
  detailCell.className = "assignment-inline-cell";
  detailCell.colSpan = selectedRow.cells.length || 5;
  detailCell.appendChild(section);
  detailRow.appendChild(detailCell);

  selectedRow.insertAdjacentElement("afterend", detailRow);
  section.classList.remove("hidden");
  return true;
}

export async function selectPersonForAssignments(personId, displayName) {
  if (!requireAssignmentAccess()) return;

  selectedPersonId = personId;
  selectedPersonName = displayName || "Selected person";
  assignmentsLoadedSuccessfully = false;
  $("personAssignmentsName").textContent = selectedPersonName;
  closeAssignmentEditor();

  document.querySelectorAll("#peopleResults tr[data-person-id]").forEach(row => {
    row.classList.toggle("selected", row.dataset.personId === selectedPersonId);
  });

  syncAssignmentInlinePlacement();

  await loadAssignments();
}

export async function loadAssignments() {
  if (!requireAssignmentAccess() || !selectedPersonId) return;

  $("assignmentListStatus").textContent = "Loading assignments…";
  assignmentsLoadedSuccessfully = false;
  $("assignmentResults").replaceChildren();
  $("assignmentEmptyState").classList.add("hidden");

  try {
    await loadAssignmentLookups();
    const result = await supabaseClient
      .from("work_assignments")
      .select(ASSIGNMENT_COLUMNS)
      .eq("person_id", selectedPersonId)
      .order("assignment_start_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;

    assignmentsCache = result.data || [];
    assignmentsLoadedSuccessfully = true;
    renderAssignmentList();
  } catch (err) {
    assignmentsCache = [];
    renderAssignmentList();
    $("assignmentListStatus").textContent = "Assignments could not be loaded.";
    showToast("Assignments load failed", err.message || "Could not load assignments.", "error");
  }
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

export function renderAssignmentList() {
  const body = $("assignmentResults");
  body.replaceChildren();

  assignmentsCache.forEach(assignment => {
    const row = document.createElement("tr");
    row.appendChild(createCell(lookupLabel("sites", assignment.site_id)));
    row.appendChild(createCell(lookupLabel("organisations", assignment.employer_organisation_id)));
    row.appendChild(createCell(lookupLabel("contracts", assignment.contract_id)));
    row.appendChild(createCell(lookupLabel("departments", assignment.department_id)));
    row.appendChild(createCell(lookupLabel("jobRoles", assignment.job_role_id)));
    row.appendChild(createCell(lookupLabel("shiftPatterns", assignment.shift_pattern_id)));
    row.appendChild(createCell(assignment.assignment_start_date));
    row.appendChild(createCell(assignment.assignment_end_date));

    const activeCell = document.createElement("td");
    const activeStatus = document.createElement("span");
    activeStatus.className = "people-status " + (assignment.active ? "active" : "inactive");
    activeStatus.textContent = assignment.active ? "Active" : "Historical";
    activeCell.appendChild(activeStatus);
    row.appendChild(activeCell);

    const actionCell = document.createElement("td");
    actionCell.className = "assignment-row-action";
    const editButton = document.createElement("button");
    editButton.className = "ghost";
    editButton.type = "button";
    editButton.textContent = "Edit as New";
    editButton.setAttribute("aria-label", "Create a new assignment from this assignment");
    editButton.addEventListener("click", () => openAssignmentEditor(assignment.id));
    actionCell.appendChild(editButton);
    row.appendChild(actionCell);

    body.appendChild(row);
  });

  $("assignmentEmptyState").classList.toggle("hidden", assignmentsCache.length > 0);
  $("assignmentEmptyState").textContent =
    "No assignments yet for " + selectedPersonName +
    ". Create one to add current or historical work context.";
  $("assignmentListStatus").textContent =
    assignmentsCache.length + " assignment" + (assignmentsCache.length === 1 ? "" : "s") + " shown.";
}

function setLookupValues(assignment) {
  $("assignmentSite").value = assignment.site_id || "";
  $("assignmentEmployer").value = assignment.employer_organisation_id || "";
  $("assignmentDepartment").value = assignment.department_id || "";
  $("assignmentContract").value = assignment.contract_id || "";
  $("assignmentJobRole").value = assignment.job_role_id || "";
  $("assignmentShiftPattern").value = assignment.shift_pattern_id || "";
  $("assignmentBreakRule").value = assignment.break_rule_id || "";
}

export function openAssignmentEditor(sourceAssignmentId) {
  if (!requireAssignmentAccess() || !selectedPersonId) return;

  assignmentEditorTrigger = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  clearAssignmentForm();
  syncAssignmentInlinePlacement();
  $("assignmentPanelPerson").textContent = selectedPersonName;
  const source = assignmentsCache.find(assignment => assignment.id === sourceAssignmentId);

  if (source) {
    $("assignmentSourceId").value = source.id;
    setLookupValues(source);
    $("assignmentType").value = source.assignment_type || "direct_employee";
    $("assignmentEmploymentStart").value = source.employment_start_date || "";
    $("assignmentStart").value = source.assignment_start_date || todayDate();
    $("assignmentEnd").value = source.assignment_end_date || "";
    $("assignmentShiftStart").value = source.shift_start_time || "";
    $("assignmentShiftEnd").value = source.shift_end_time || "";
    $("assignmentCycleAnchor").value = source.cycle_anchor_date || "";
    $("assignmentNotes").value = source.notes || "";
    $("assignmentActive").value = "false";
    $("assignmentPanelTitle").textContent = "Create Assignment from Existing";
    $("assignmentEditorNotice").textContent =
      "The original assignment will remain unchanged. Saving creates a new historical assignment.";
  }

  $("assignmentPanel").classList.remove("hidden");
  $("assignmentPanel").setAttribute("aria-hidden", "false");
  setTimeout(() => $("assignmentSite").focus({ preventScroll: true }), 0);
}

export function closeAssignmentEditor() {
  $("assignmentPanel").classList.add("hidden");
  $("assignmentPanel").setAttribute("aria-hidden", "true");
  if (assignmentEditorTrigger && assignmentEditorTrigger.isConnected) {
    assignmentEditorTrigger.focus({ preventScroll: true });
  }
  assignmentEditorTrigger = null;
}

export async function cancelAssignmentEditor() {
  closeAssignmentEditor();
  if (selectedPersonId) await loadAssignments();
}

export function clearAssignmentForm() {
  $("assignmentForm").reset();
  $("assignmentSourceId").value = "";
  $("assignmentPersonId").value = selectedPersonId || "";
  $("assignmentType").value = "direct_employee";
  $("assignmentStart").value = todayDate();
  $("assignmentActive").value = "true";
  $("assignmentPanelTitle").textContent = "Create Assignment";
  $("assignmentPanelPerson").textContent = selectedPersonName || "No person selected";
  $("assignmentEditorNotice").textContent = "Saving creates a new assignment record.";
}

function validateAssignmentDates(startDate, endDate) {
  if (!startDate) throw new Error("Assignment Start Date is required.");
  if (endDate && endDate < startDate) {
    throw new Error("Assignment End Date cannot be before Assignment Start Date.");
  }
}

export async function saveAssignment() {
  if (!requireAssignmentAccess() || !selectedPersonId) return;

  if (!assignmentsLoadedSuccessfully) {
    showToast(
      "Assignment not saved",
      "Reload this person's assignments before creating a new record.",
      "error"
    );
    return;
  }

  const assignmentStart = $("assignmentStart").value;
  const assignmentEnd = optionalValue("assignmentEnd");
  const active = $("assignmentActive").value === "true";

  try {
    validateAssignmentDates(assignmentStart, assignmentEnd);
    if (active && assignmentsCache.some(assignment => assignment.active === true)) {
      throw new Error(
        "This person already has an active assignment. Create this record as Historical or end the existing assignment first."
      );
    }
  } catch (err) {
    showToast("Assignment not saved", err.message, "error");
    return;
  }

  const payload = {
    person_id: selectedPersonId,
    site_id: optionalValue("assignmentSite"),
    employer_organisation_id: optionalValue("assignmentEmployer"),
    department_id: optionalValue("assignmentDepartment"),
    contract_id: optionalValue("assignmentContract"),
    job_role_id: optionalValue("assignmentJobRole"),
    assignment_type: $("assignmentType").value,
    shift_pattern_id: optionalValue("assignmentShiftPattern"),
    break_rule_id: optionalValue("assignmentBreakRule"),
    shift_start_time: optionalValue("assignmentShiftStart"),
    shift_end_time: optionalValue("assignmentShiftEnd"),
    cycle_anchor_date: optionalValue("assignmentCycleAnchor"),
    employment_start_date: optionalValue("assignmentEmploymentStart"),
    assignment_start_date: assignmentStart,
    assignment_end_date: assignmentEnd,
    active,
    notes: optionalValue("assignmentNotes")
  };

  const saveButton = $("assignmentSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  try {
    const result = await supabaseClient
      .from("work_assignments")
      .insert(payload)
      .select(ASSIGNMENT_COLUMNS)
      .single();

    if (result.error) throw result.error;

    showToast("Assignment created", "The new assignment record was saved successfully.", "success");
    closeAssignmentEditor();
    await loadAssignments();
  } catch (err) {
    showToast("Assignment not saved", err.message || "Could not save this assignment.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Create Assignment";
  }
}
