import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { exportDateStamp, todayDate } from "./utils.js";
import { downloadCsv, downloadXlsx } from "./exports.js";
import { auditDiffSummary, buildFieldDiff, writeAuditEvent } from "./audit.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import {
  assignmentBlockingMessage,
  classifyAssignmentConflict
} from "./assignmentConflicts.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";

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
  "work_time_profile_id",
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

const ASSIGNMENT_AUDIT_FIELDS = [
  "site_id",
  "employer_organisation_id",
  "department_id",
  "contract_id",
  "job_role_id",
  "assignment_type",
  "shift_pattern_id",
  "break_rule_id",
  "work_time_profile_id",
  "shift_start_time",
  "shift_end_time",
  "cycle_anchor_date",
  "employment_start_date",
  "assignment_start_date",
  "assignment_end_date",
  "active"
];

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
    columns: "id, shift_code, shift_name, pattern_type, static_weekdays, active",
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
let selectedPersonReference = "";
let assignmentsLoadedSuccessfully = false;
let assignmentReturnContext = null;
let assignmentEditorTrigger = null;
let assignmentEndTrigger = null;
let assignmentPendingEnd = null;
let assignmentOverrideResolver = null;
const ASSIGNMENT_DETAIL_ROW_ID = "inlineAssignmentDetailRow";
const ASSIGNMENT_OVERRIDE_NOTE_MARKER = "[Assignment conflict override ";

function hasAssignmentAccess() {
  return hasAnyCapability(["assignment.view", "assignment.manage"]);
}

function hasAssignmentManageAccess() {
  return hasCapability("assignment.manage");
}

function requireAssignmentViewAccess() {
  if (hasAssignmentAccess()) return true;
  showToast(
    "You do not have permission",
    "Assignments require assignment.view.",
    "error"
  );
  return false;
}

function requireAssignmentManageAccess() {
  if (hasAssignmentManageAccess()) return true;
  showToast(
    "You do not have permission",
    "This action requires assignment.manage.",
    "error"
  );
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

function formatAssignmentTime(value) {
  return value ? String(value).slice(0, 5) : "-";
}

function formatAssignmentHours(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "-";
}

function findWorkTimeProfile(profileId) {
  if (!profileId) return null;
  return (assignmentLookups.workTimeProfiles || []).find(profile => profile.id === profileId) || null;
}

function assignmentConflictLookups() {
  return {
    shiftPatterns: assignmentLookups.shiftPatterns || [],
    workTimeProfiles: assignmentLookups.workTimeProfiles || []
  };
}

function workTimeProfileTags(profile) {
  return ["custom_tag_1", "custom_tag_2", "custom_tag_3"]
    .map(key => String(profile && profile[key] ? profile[key] : "").trim())
    .filter(Boolean);
}

function workTimeProfileTagsText(profile) {
  const tags = workTimeProfileTags(profile);
  return tags.length ? "Tags: " + tags.join(" - ") : "";
}

function exportValue(lookupName, id) {
  if (!id) return "";
  const label = lookupLabel(lookupName, id);
  return label === "Unknown" ? "" : label;
}

function setFilterOptions(controlId, options, emptyLabel) {
  const control = $(controlId);
  if (!control) return;
  const currentValue = control.value;
  control.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = emptyLabel;
  control.appendChild(emptyOption);

  options.forEach(option => {
    if (!option.id || !option.label) return;
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.label;
    control.appendChild(item);
  });

  if (currentValue && options.some(option => option.id === currentValue)) {
    control.value = currentValue;
  }
}

function populateAssignmentFilters() {
  setFilterOptions("assignmentContractFilter", assignmentLookups.contracts || [], "All contracts");
  setFilterOptions("assignmentSiteFilter", assignmentLookups.sites || [], "All sites");
  setFilterOptions("assignmentDepartmentFilter", assignmentLookups.departments || [], "All departments");
  setFilterOptions(
    "assignmentWorkTimeProfileFilter",
    (assignmentLookups.workTimeProfiles || []).map(profile => ({
      id: profile.id,
      label: profile.profile_name || profile.profile_code || "Work Time Profile"
    })),
    "All work time profiles"
  );
}

function assignmentFilters() {
  return {
    search: $("assignmentSearchFilter") ? $("assignmentSearchFilter").value.trim().toLowerCase() : "",
    status: $("assignmentStatusFilter") ? $("assignmentStatusFilter").value : "active",
    contract: $("assignmentContractFilter") ? $("assignmentContractFilter").value : "",
    site: $("assignmentSiteFilter") ? $("assignmentSiteFilter").value : "",
    department: $("assignmentDepartmentFilter") ? $("assignmentDepartmentFilter").value : "",
    workTimeProfile: $("assignmentWorkTimeProfileFilter") ? $("assignmentWorkTimeProfileFilter").value : ""
  };
}

function assignmentSearchText(assignment) {
  const profile = findWorkTimeProfile(assignment.work_time_profile_id);
  return [
    selectedPersonName,
    selectedPersonReference,
    lookupLabel("sites", assignment.site_id),
    lookupLabel("organisations", assignment.employer_organisation_id),
    lookupLabel("contracts", assignment.contract_id),
    lookupLabel("departments", assignment.department_id),
    lookupLabel("jobRoles", assignment.job_role_id),
    lookupLabel("shiftPatterns", assignment.shift_pattern_id),
    assignment.assignment_type,
    profile && (profile.profile_name || profile.profile_code),
    workTimeProfileTags(profile).join(" "),
    assignment.assignment_start_date,
    assignment.assignment_end_date,
    assignment.notes
  ].join(" ").toLowerCase();
}

function assignmentMatchesFilters(assignment, filters) {
  if (filters.status === "active" && assignment.active !== true) return false;
  if (filters.status === "historical" && assignment.active === true) return false;
  if (filters.contract && assignment.contract_id !== filters.contract) return false;
  if (filters.site && assignment.site_id !== filters.site) return false;
  if (filters.department && assignment.department_id !== filters.department) return false;
  if (filters.workTimeProfile && assignment.work_time_profile_id !== filters.workTimeProfile) return false;
  return !filters.search || assignmentSearchText(assignment).includes(filters.search);
}

function filteredAssignments() {
  const filters = assignmentFilters();
  return assignmentsCache.filter(assignment => assignmentMatchesFilters(assignment, filters));
}

function updateAssignmentSummary(shownCount) {
  const activeCount = assignmentsCache.filter(assignment => assignment.active === true).length;
  const historicalCount = assignmentsCache.length - activeCount;
  if ($("assignmentActiveCount")) $("assignmentActiveCount").textContent = String(activeCount);
  if ($("assignmentHistoricalCount")) $("assignmentHistoricalCount").textContent = String(historicalCount);
  if ($("assignmentShownCount")) $("assignmentShownCount").textContent = String(shownCount);
}

function hasAssignmentOverrideNote(assignment) {
  return String(assignment && assignment.notes ? assignment.notes : "").includes(ASSIGNMENT_OVERRIDE_NOTE_MARKER);
}

function appendAssignmentOverrideReason(notes, reason) {
  const currentNotes = String(notes || "").trim();
  const overrideLine = ASSIGNMENT_OVERRIDE_NOTE_MARKER + todayDate() + "] Reason: " + reason.trim();
  return currentNotes ? currentNotes + "\n\n" + overrideLine : overrideLine;
}

function assignmentConflictWarningMessage() {
  return "This person already has an active assignment that may overlap this assignment's date range, shift pattern and work time profile.";
}

function classifyCandidateAssignment(candidate, assignments) {
  return classifyAssignmentConflict(
    candidate,
    assignments || [],
    assignmentConflictLookups()
  );
}

function classificationBlocksSave(classification) {
  return classification && classification.status === "duplicate_block";
}

function classificationRequiresOverride(classification) {
  return classification && classification.status === "likely_conflict_override_required";
}

function currentAssignmentConflictClassification(assignment) {
  if (!assignment || assignment.active !== true) return { status: "valid" };
  return classifyCandidateAssignment(assignment, assignmentsCache);
}

function workTimeProfileOptionLabel(profile) {
  const name = profile.profile_name || profile.profile_code || "Work Time Profile";
  return name + " " + formatAssignmentTime(profile.start_time) + "-" +
    formatAssignmentTime(profile.end_time) + " - " +
    formatAssignmentHours(profile.paid_hours) + " paid - " +
    "break " + workTimeProfileBreakText(profile) + " - " +
    formatAssignmentHours(profile.unsociable_hours) + " unsociable" +
    (profile.active === false ? " - inactive" : "");
}

function workTimeProfileBreakText(profile) {
  if (!profile) return "not selected";
  const paidRaw = profile.effective_paid_break_minutes ?? profile.break_rule_paid_minutes;
  const unpaidRaw = profile.effective_unpaid_break_minutes ?? profile.break_rule_unpaid_minutes;
  if (
    (paidRaw !== null && paidRaw !== undefined) ||
    (unpaidRaw !== null && unpaidRaw !== undefined)
  ) {
    const paid = Number(paidRaw);
    const unpaid = Number(unpaidRaw);
    const paidMinutes = Number.isFinite(paid) ? paid : 0;
    const unpaidMinutes = Number.isFinite(unpaid) ? unpaid : 0;
    return (paidMinutes + unpaidMinutes) + " min total (" +
      paidMinutes + " paid, " + unpaidMinutes + " unpaid)";
  }
  return profile.break_rule_label ||
    ((profile.effective_break_minutes ?? profile.break_minutes ?? 0) + " min from Work Time Profile");
}

function workTimeProfileSummaryText(profile) {
  if (!profile) return "No Work Time Profile selected";
  return formatAssignmentTime(profile.start_time) + "-" + formatAssignmentTime(profile.end_time) +
    (profile.crosses_midnight ? " overnight" : "") + " - " +
    formatAssignmentHours(profile.paid_hours) + " paid - " +
    formatAssignmentHours(profile.unsociable_hours) + " unsociable";
}

function legacyShiftText(assignment) {
  if (!assignment || (!assignment.shift_start_time && !assignment.shift_end_time)) return "";
  return "Legacy start/end: " + formatAssignmentTime(assignment.shift_start_time) +
    "-" + formatAssignmentTime(assignment.shift_end_time);
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

function populateWorkTimeProfileLookup(selectedProfileId) {
  const control = $("assignmentWorkTimeProfile");
  if (!control) return;
  const currentValue = selectedProfileId !== undefined ? selectedProfileId : control.value;
  control.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "No Work Time Profile selected";
  control.appendChild(emptyOption);

  (assignmentLookups.workTimeProfiles || [])
    .filter(profile => profile.active !== false || profile.id === currentValue)
    .forEach(profile => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = workTimeProfileOptionLabel(profile);
      control.appendChild(option);
    });

  control.value = currentValue || "";
  control.onchange = renderSelectedAssignmentWorkTimeProfileSummary;
}

export function renderSelectedAssignmentWorkTimeProfileSummary() {
  const summary = $("assignmentWorkTimeProfileSummary");
  if (!summary) return;
  const profile = findWorkTimeProfile($("assignmentWorkTimeProfile").value);
  const legacyStart = $("assignmentShiftStart").value;
  const legacyEnd = $("assignmentShiftEnd").value;
  const legacyText = legacyStart || legacyEnd
    ? "Legacy start/end: " + formatAssignmentTime(legacyStart) + "-" + formatAssignmentTime(legacyEnd)
    : "";

  summary.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = workTimeProfileSummaryText(profile);
  summary.appendChild(title);

  if (profile) {
    const details = document.createElement("span");
    const overrideRule = $("assignmentBreakRule") && $("assignmentBreakRule").value
      ? lookupLabel("breakRules", $("assignmentBreakRule").value)
      : "";
    details.textContent =
      "Start " + formatAssignmentTime(profile.start_time) +
      " - End " + formatAssignmentTime(profile.end_time) +
      " - Crosses midnight " + (profile.crosses_midnight ? "Yes" : "No") +
      " - Break source: " + (overrideRule ? "Assignment override (" + overrideRule + ")" : "Work Time Profile") +
      " - Break " + workTimeProfileBreakText(profile) +
      " - Paid " + formatAssignmentHours(profile.paid_hours) +
      " - Unsociable " + formatAssignmentHours(profile.unsociable_hours);
    summary.appendChild(details);

    const tagsText = workTimeProfileTagsText(profile);
    if (tagsText) {
      const tags = document.createElement("span");
      tags.className = "assignment-work-time-tags";
      tags.textContent = tagsText;
      summary.appendChild(tags);
    }
  } else if (legacyText) {
    const details = document.createElement("span");
    details.textContent = legacyText;
    summary.appendChild(details);
  }
}

export async function loadAssignmentLookups() {
  const entries = Object.entries(lookupDefinitions);
  const results = await Promise.allSettled(entries.map(async ([lookupName, definition]) => {
    const result = await supabaseClient
      .from(definition.table)
      .select(definition.columns)
      .order(definition.orderBy, { ascending: true });

    if (result.error) throw result.error;
    return [
      lookupName,
      (result.data || []).map(record => ({
        ...record,
        id: record.id,
        label: definition.label(record),
        active: record.active
      }))
    ];
  }));

  results.forEach((result, index) => {
    const lookupName = entries[index][0];
    const records = result.status === "fulfilled" ? result.value[1] : [];
    assignmentLookups[lookupName] = records;
    populateLookup(lookupName);
  });
}

export async function loadAssignmentWorkTimeProfiles() {
  const result = await supabaseClient.rpc("list_work_time_profiles_with_break_alignment", {
    p_include_inactive: true,
    p_search_text: null
  });

  if (result.error) throw result.error;
  assignmentLookups.workTimeProfiles = (result.data || []).map(profile => ({
    ...profile,
    id: profile.id || profile.profile_id
  }));
  populateWorkTimeProfileLookup();
}

export function getSelectedAssignmentPersonId() {
  return selectedPersonId;
}

export function detachAssignmentInlinePlacement() {
  const section = $("personAssignmentsSection");
  const existingRow = document.getElementById(ASSIGNMENT_DETAIL_ROW_ID);
  if (existingRow) existingRow.remove();
  if (section) section.classList.add("hidden");
  document.body.classList.remove("assignment-workspace-open");
}

export function syncAssignmentInlinePlacement() {
  const existingRow = document.getElementById(ASSIGNMENT_DETAIL_ROW_ID);
  if (existingRow) existingRow.remove();
  return false;
}

function ensureAssignmentWorkspaceRoot() {
  const section = $("personAssignmentsSection");
  if (section && section.parentElement !== document.body) document.body.appendChild(section);
  return section;
}

function ensureAssignmentPanelRoot() {
  const panel = $("assignmentPanel");
  if (panel && document.body.classList.contains("assignment-workspace-open") && panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }
  return panel;
}

function openAssignmentWorkspace() {
  const section = ensureAssignmentWorkspaceRoot();
  if (!section) return;
  const closeButton = $("assignmentWorkspaceCloseButton");
  if (closeButton) {
    closeButton.textContent = assignmentReturnContext && assignmentReturnContext.returnTo === "peopleProfile"
      ? "Back to Profile"
      : "Back to People";
  }
  section.classList.remove("hidden");
  document.body.classList.add("assignment-workspace-open");
  setTimeout(() => {
    if (closeButton) closeButton.focus({ preventScroll: true });
  }, 0);
}

export function closeAssignmentWorkspace() {
  const section = $("personAssignmentsSection");
  if (section) section.classList.add("hidden");
  document.body.classList.remove("assignment-workspace-open");
  closeAssignmentEditor();
  const returnContext = assignmentReturnContext;
  assignmentReturnContext = null;
  const closeButton = $("assignmentWorkspaceCloseButton");
  if (closeButton) closeButton.textContent = "Back to People";
  if (returnContext && returnContext.returnTo === "peopleProfile" && returnContext.personId) {
    window.dispatchEvent(new CustomEvent("oh:people-profile-return-requested", {
      detail: returnContext
    }));
  }
}

function handleAssignmentWorkspaceKeydown(event) {
  if (event.key !== "Escape") return;
  const section = $("personAssignmentsSection");
  if (!section || section.classList.contains("hidden")) return;

  const activeModal = document.querySelector(".modal-backdrop.active");
  if (activeModal) return;

  event.preventDefault();
  closeAssignmentWorkspace();
}

document.addEventListener("keydown", handleAssignmentWorkspaceKeydown);

function closeAssignmentOverrideDialog(reason) {
  const backdrop = $("assignmentConflictOverrideModalBackdrop");
  const input = $("assignmentConflictOverrideReason");
  const message = $("assignmentConflictOverrideMessage");
  if (backdrop) backdrop.classList.remove("active");
  if (message) {
    message.textContent = "";
    message.className = "modal-message";
  }
  if (input && reason !== undefined) input.value = "";
  if (assignmentOverrideResolver) {
    const resolver = assignmentOverrideResolver;
    assignmentOverrideResolver = null;
    resolver(reason || null);
  }
}

function requestAssignmentOverrideReason() {
  const backdrop = $("assignmentConflictOverrideModalBackdrop");
  const input = $("assignmentConflictOverrideReason");
  const message = $("assignmentConflictOverrideMessage");
  const warning = $("assignmentConflictOverrideWarning");
  if (!backdrop || !input) {
    return Promise.resolve(window.prompt("Enter the reason this overlapping assignment is valid.") || null);
  }

  if (warning) warning.textContent = assignmentConflictWarningMessage();
  if (message) {
    message.textContent = "";
    message.className = "modal-message";
  }
  input.value = "";
  backdrop.classList.add("active");
  setTimeout(() => input.focus({ preventScroll: true }), 0);

  return new Promise(resolve => {
    assignmentOverrideResolver = resolve;
  });
}

export function cancelAssignmentConflictOverride() {
  closeAssignmentOverrideDialog(null);
}

export function confirmAssignmentConflictOverride() {
  const input = $("assignmentConflictOverrideReason");
  const message = $("assignmentConflictOverrideMessage");
  const reason = input ? input.value.trim() : "";
  if (!reason) {
    if (message) {
      message.textContent = "Enter the reason this overlapping assignment is valid.";
      message.className = "modal-message error";
    }
    return;
  }
  closeAssignmentOverrideDialog(reason);
}

export async function selectPersonForAssignments(personId, displayName, externalPersonNumber, options = {}) {
  if (!requireAssignmentViewAccess()) return;

  selectedPersonId = personId;
  selectedPersonName = displayName || "Selected person";
  selectedPersonReference = externalPersonNumber || "";
  assignmentReturnContext = options.returnContext ? { ...options.returnContext } : null;
  assignmentsLoadedSuccessfully = false;
  $("personAssignmentsName").textContent = selectedPersonName +
    (selectedPersonReference ? " | " + selectedPersonReference : "");
  $("assignmentCreateButton").classList.toggle("hidden", !hasAssignmentManageAccess());
  closeAssignmentEditor();

  document.querySelectorAll("#peopleResults tr[data-person-id]").forEach(row => {
    row.classList.toggle("selected", row.dataset.personId === selectedPersonId);
  });

  openAssignmentWorkspace();

  await loadAssignments();
}

export async function loadAssignments() {
  if (!requireAssignmentViewAccess() || !selectedPersonId) return;

  $("assignmentListStatus").textContent = "Loading assignments…";
  assignmentsLoadedSuccessfully = false;
  $("assignmentResults").replaceChildren();
  $("assignmentEmptyState").classList.add("hidden");

  try {
    await Promise.all([
      loadAssignmentLookups(),
      loadAssignmentWorkTimeProfiles()
    ]);
    const result = await supabaseClient
      .from("work_assignments")
      .select(ASSIGNMENT_COLUMNS)
      .eq("person_id", selectedPersonId)
      .order("assignment_start_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;

    assignmentsCache = result.data || [];
    assignmentsLoadedSuccessfully = true;
    populateAssignmentFilters();
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

function createWorkTimeProfileCell(assignment) {
  const cell = document.createElement("td");
  cell.className = "assignment-work-time-cell";
  const profile = findWorkTimeProfile(assignment.work_time_profile_id);

  const primary = document.createElement("strong");
  primary.textContent = workTimeProfileSummaryText(profile);
  cell.appendChild(primary);

  if (profile) {
    const detail = document.createElement("span");
    const overrideRule = assignment.break_rule_id ? lookupLabel("breakRules", assignment.break_rule_id) : "";
    detail.textContent =
      "Break source: " + (overrideRule ? "Assignment override (" + overrideRule + ")" : "Work Time Profile") +
      " - Break " + workTimeProfileBreakText(profile) +
      " - Crosses midnight " + (profile.crosses_midnight ? "Yes" : "No");
    cell.appendChild(detail);

    const tagsText = workTimeProfileTagsText(profile);
    if (tagsText) {
      const tags = document.createElement("span");
      tags.className = "assignment-work-time-tags";
      tags.textContent = tagsText;
      cell.appendChild(tags);
    }
  } else {
    const legacyText = legacyShiftText(assignment);
    if (legacyText) {
      const detail = document.createElement("span");
      detail.textContent = legacyText;
      cell.appendChild(detail);
    }
  }

  return cell;
}

export function renderAssignmentList() {
  const body = $("assignmentResults");
  body.replaceChildren();
  const rows = filteredAssignments();
  updateAssignmentSummary(rows.length);

  rows.forEach(assignment => {
    const row = document.createElement("tr");
    row.appendChild(createCell(lookupLabel("sites", assignment.site_id)));
    row.appendChild(createCell(lookupLabel("organisations", assignment.employer_organisation_id)));
    row.appendChild(createCell(lookupLabel("contracts", assignment.contract_id)));
    row.appendChild(createCell(lookupLabel("departments", assignment.department_id)));
    row.appendChild(createCell(lookupLabel("jobRoles", assignment.job_role_id)));
    row.appendChild(createCell(lookupLabel("shiftPatterns", assignment.shift_pattern_id)));
    row.appendChild(createWorkTimeProfileCell(assignment));
    row.appendChild(createCell(assignment.assignment_start_date));
    row.appendChild(createCell(assignment.assignment_end_date));

    const activeCell = document.createElement("td");
    const activeStatus = document.createElement("span");
    activeStatus.className = "people-status " + (assignment.active ? "active" : "inactive");
    activeStatus.textContent = assignment.active ? "Active" : "Historical";
    activeCell.appendChild(activeStatus);
    if (assignment.active) {
      const currentBadge = document.createElement("span");
      currentBadge.className = "assignment-current-badge";
      currentBadge.textContent = "Current assignment";
      activeCell.appendChild(currentBadge);
    }
    const rowConflict = currentAssignmentConflictClassification(assignment);
    if (classificationRequiresOverride(rowConflict)) {
      const warningBadge = document.createElement("span");
      warningBadge.className = "assignment-warning-badge";
      warningBadge.textContent = "Possible overlap";
      activeCell.appendChild(warningBadge);
    }
    if (hasAssignmentOverrideNote(assignment)) {
      const overrideBadge = document.createElement("span");
      overrideBadge.className = "assignment-warning-badge override";
      overrideBadge.textContent = "Override recorded";
      activeCell.appendChild(overrideBadge);
    }
    row.appendChild(activeCell);

    const actionCell = document.createElement("td");
    actionCell.className = "assignment-row-action";
    if (hasAssignmentManageAccess()) {
      const actionGroup = document.createElement("div");
      actionGroup.className = "assignment-row-actions";
      const editButton = document.createElement("button");
      editButton.className = "ghost";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.setAttribute("aria-label", "Edit assignment");
      decorateCapabilityAction(editButton, {
        actionId: "assignments.edit",
        label: "Edit Assignment",
        area: "Assignments",
        requiredAny: ["assignment.manage"],
        actionType: "edit"
      });
      editButton.addEventListener("click", () => openAssignmentEditor(assignment.id));
      actionGroup.appendChild(editButton);

      if (assignment.active) {
        const endButton = document.createElement("button");
        endButton.className = "secondary";
        endButton.type = "button";
        endButton.textContent = "End Assignment";
        decorateCapabilityAction(endButton, {
          actionId: "assignments.end",
          label: "End Assignment",
          area: "Assignments",
          requiredAny: ["assignment.manage"],
          actionType: "edit"
        });
        endButton.addEventListener("click", event => {
          openEndAssignmentDialog(assignment.id, event.currentTarget);
        });
        actionGroup.appendChild(endButton);
      } else {
        const reactivateButton = document.createElement("button");
        reactivateButton.className = "secondary";
        reactivateButton.type = "button";
        reactivateButton.textContent = "Reactivate";
        decorateCapabilityAction(reactivateButton, {
          actionId: "assignments.reactivate",
          label: "Reactivate Assignment",
          area: "Assignments",
          requiredAny: ["assignment.manage"],
          actionType: "edit"
        });
        const reactivationClassification = classifyCandidateAssignment(
          { ...assignment, active: true, assignment_end_date: null },
          assignmentsCache
        );
        const reactivationBlocked = classificationBlocksSave(reactivationClassification);
        reactivateButton.disabled = reactivationBlocked;
        if (reactivationBlocked) {
          reactivateButton.title = assignmentBlockingMessage(reactivationClassification);
          reactivateButton.setAttribute(
            "aria-label",
            "Reactivate assignment unavailable: active matching assignment already exists"
          );
        }
        reactivateButton.addEventListener("click", () => reactivateAssignment(assignment.id));
        actionGroup.appendChild(reactivateButton);
        if (reactivationBlocked) {
          const unavailableReason = document.createElement("span");
          unavailableReason.className = "assignment-action-note";
          unavailableReason.textContent = "Matching assignment exists";
          actionGroup.appendChild(unavailableReason);
        }
      }
      actionCell.appendChild(actionGroup);
    } else {
      actionCell.textContent = "Read only";
    }
    row.appendChild(actionCell);

    body.appendChild(row);
  });

  $("assignmentEmptyState").classList.toggle("hidden", rows.length > 0);
  if (!rows.length) {
    renderEmptyState("assignmentEmptyState", {
      title: assignmentsCache.length ? "No assignments match" : "No assignments",
      description: assignmentsCache.length
        ? "Adjust the assignment filters to show more records."
        : hasAssignmentManageAccess()
        ? "Create an assignment for " + selectedPersonName +
          " to add current or historical work context."
        : "No assignments are available for " + selectedPersonName + "."
    });
  }
  $("assignmentListStatus").textContent =
    rows.length + " of " + assignmentsCache.length + " assignment" +
    (assignmentsCache.length === 1 ? "" : "s") + " shown.";
}

function assignmentExportRows() {
  return filteredAssignments().map(assignment => {
    const profile = findWorkTimeProfile(assignment.work_time_profile_id);
    const tags = workTimeProfileTags(profile);
    return {
      "Person": selectedPersonName,
      "Person Reference": selectedPersonReference,
      "Site": exportValue("sites", assignment.site_id),
      "Employer": exportValue("organisations", assignment.employer_organisation_id),
      "Contract": exportValue("contracts", assignment.contract_id),
      "Department": exportValue("departments", assignment.department_id),
      "Job Role": exportValue("jobRoles", assignment.job_role_id),
      "Assignment Type": assignment.assignment_type || "",
      "Shift Pattern": exportValue("shiftPatterns", assignment.shift_pattern_id),
      "Work Time Profile": profile ? profile.profile_name || profile.profile_code || "" : "",
      "Start Time": profile ? formatAssignmentTime(profile.start_time) : formatAssignmentTime(assignment.shift_start_time),
      "End Time": profile ? formatAssignmentTime(profile.end_time) : formatAssignmentTime(assignment.shift_end_time),
      "Paid Hours": profile ? formatAssignmentHours(profile.paid_hours) : "",
      "Unsociable Hours": profile ? formatAssignmentHours(profile.unsociable_hours) : "",
      "Tags": tags.join(" | "),
      "Assignment Start": assignment.assignment_start_date || "",
      "Assignment End": assignment.assignment_end_date || "",
      "Status": assignment.active ? "Active" : "Historical",
      "Notes": assignment.notes || ""
    };
  });
}

export function refreshAssignmentFilters() {
  renderAssignmentList();
}

export function exportAssignmentsCsv() {
  const rows = assignmentExportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No assignments match the current filters.", "error");
    return;
  }
  downloadCsv("assignments-" + exportDateStamp() + ".csv", rows);
  showToast("Export created", rows.length + " assignment rows were exported.", "success");
}

export function exportAssignmentsXlsx() {
  const rows = assignmentExportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No assignments match the current filters.", "error");
    return;
  }
  downloadXlsx("assignments-" + exportDateStamp() + ".xlsx", rows, "Assignments");
  showToast("Export created", rows.length + " assignment rows were exported.", "success");
}

function setLookupValues(assignment) {
  $("assignmentSite").value = assignment.site_id || "";
  $("assignmentEmployer").value = assignment.employer_organisation_id || "";
  $("assignmentDepartment").value = assignment.department_id || "";
  $("assignmentContract").value = assignment.contract_id || "";
  $("assignmentJobRole").value = assignment.job_role_id || "";
  $("assignmentShiftPattern").value = assignment.shift_pattern_id || "";
  $("assignmentBreakRule").value = assignment.break_rule_id || "";
  populateWorkTimeProfileLookup(assignment.work_time_profile_id || "");
}

export function openAssignmentEditor(sourceAssignmentId) {
  if (!requireAssignmentManageAccess() || !selectedPersonId) return;

  ensureAssignmentPanelRoot();
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
    renderSelectedAssignmentWorkTimeProfileSummary();
    $("assignmentCycleAnchor").value = source.cycle_anchor_date || "";
    $("assignmentNotes").value = source.notes || "";
    $("assignmentActive").value = source.active ? "true" : "false";
    $("assignmentPanelTitle").textContent = "Edit Assignment";
    $("assignmentEditorNotice").textContent =
      "Saving updates this assignment record. Assignments are retained as current or historical records.";
    $("assignmentSaveButton").textContent = "Save Assignment";
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
  populateWorkTimeProfileLookup("");
  renderSelectedAssignmentWorkTimeProfileSummary();
  $("assignmentPanelTitle").textContent = "Create Assignment";
  $("assignmentPanelPerson").textContent = selectedPersonName || "No person selected";
  $("assignmentEditorNotice").textContent = "Saving creates a new assignment record.";
  $("assignmentSaveButton").textContent = "Create Assignment";
}

function validateAssignmentDates(startDate, endDate) {
  if (!startDate) throw new Error("Assignment Start Date is required.");
  if (endDate && endDate < startDate) {
    throw new Error("Assignment End Date cannot be before Assignment Start Date.");
  }
}

function assignmentAuditDetails(beforeAssignment, afterAssignment) {
  const changes = buildFieldDiff(
    beforeAssignment,
    afterAssignment,
    ASSIGNMENT_AUDIT_FIELDS
  );
  return {
    entity_type: "work_assignment",
    entity_id: afterAssignment.id,
    person_id: afterAssignment.person_id,
    display_name: selectedPersonName,
    old_active: beforeAssignment ? beforeAssignment.active : null,
    new_active: afterAssignment.active,
    old_assignment_end_date: beforeAssignment
      ? beforeAssignment.assignment_end_date || null
      : null,
    new_assignment_end_date: afterAssignment.assignment_end_date || null,
    changes,
    summary: auditDiffSummary(changes)
  };
}

export async function saveAssignment() {
  if (!requireAssignmentManageAccess() || !selectedPersonId) return;

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
  const assignmentId = $("assignmentSourceId").value || null;
  const existingAssignment = assignmentId
    ? assignmentsCache.find(assignment => assignment.id === assignmentId)
    : null;

  try {
    validateAssignmentDates(assignmentStart, assignmentEnd);
    if (existingAssignment?.active && !active && !assignmentEnd) {
      throw new Error("Assignment End Date is required when ending an active assignment.");
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
    break_rule_id: existingAssignment ? existingAssignment.break_rule_id || null : null,
    work_time_profile_id: optionalValue("assignmentWorkTimeProfile"),
    shift_start_time: optionalValue("assignmentShiftStart"),
    shift_end_time: optionalValue("assignmentShiftEnd"),
    cycle_anchor_date: optionalValue("assignmentCycleAnchor"),
    employment_start_date: optionalValue("assignmentEmploymentStart"),
    assignment_start_date: assignmentStart,
    assignment_end_date: active ? null : assignmentEnd,
    active,
    notes: optionalValue("assignmentNotes")
  };

  const localClassification = classifyCandidateAssignment({ id: assignmentId, ...payload }, assignmentsCache);
  if (classificationBlocksSave(localClassification)) {
    showToast("Assignment not saved", assignmentBlockingMessage(localClassification), "error");
    return;
  }

  const saveButton = $("assignmentSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  let savedWithOverride = false;

  try {
    let overrideClassification = classificationRequiresOverride(localClassification)
      ? localClassification
      : null;
    const databaseClassification = await classifyAssignmentInDatabase({ id: assignmentId, ...payload });
    if (classificationBlocksSave(databaseClassification)) {
      throw new Error(assignmentBlockingMessage(databaseClassification));
    }
    if (!overrideClassification && classificationRequiresOverride(databaseClassification)) {
      overrideClassification = databaseClassification;
    }
    if (overrideClassification) {
      const reason = await requestAssignmentOverrideReason();
      if (!reason) {
        showToast("Assignment not saved", "Enter an overlap override reason to save this assignment.", "error");
        return;
      }
      payload.notes = appendAssignmentOverrideReason(payload.notes, reason);
      savedWithOverride = true;
    }

    const query = assignmentId
      ? supabaseClient
        .from("work_assignments")
        .update(payload)
        .eq("id", assignmentId)
        .eq("person_id", selectedPersonId)
      : supabaseClient
        .from("work_assignments")
        .insert(payload);
    const result = await query.select(ASSIGNMENT_COLUMNS).single();

    if (result.error) throw result.error;

    if (active && (!existingAssignment || !existingAssignment.active)) {
      await rollbackIfActivationConflicted(result.data, existingAssignment);
    }

    let auditEventType = assignmentId ? "assignment.updated" : "assignment.created";
    if (existingAssignment?.active && !result.data.active) {
      auditEventType = "assignment.ended";
    } else if (existingAssignment && !existingAssignment.active && result.data.active) {
      auditEventType = "assignment.reactivated";
    }
    void writeAuditEvent(
      auditEventType,
      "work_assignments",
      result.data.id,
      assignmentAuditDetails(existingAssignment, result.data)
    );

    showToast(
      savedWithOverride ? "Assignment saved with warning" : assignmentId ? "Assignment updated" : "Assignment created",
      savedWithOverride
        ? "This assignment was saved with an overlap override reason."
        : assignmentId
          ? "The assignment record was updated successfully."
          : "The new assignment record was saved successfully.",
      "success"
    );
    closeAssignmentEditor();
    await loadAssignments();
  } catch (err) {
    showToast("Assignment not saved", err.message || "Could not save this assignment.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = assignmentId ? "Save Assignment" : "Create Assignment";
  }
}

async function rollbackIfActivationConflicted(savedAssignment, previousAssignment) {
  const result = await supabaseClient
    .from("work_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("person_id", selectedPersonId)
    .eq("active", true);

  if (result.error) throw result.error;
  const classification = classifyCandidateAssignment(savedAssignment, result.data || []);
  if (!classificationBlocksSave(classification)) return;

  const rollback = await supabaseClient
    .from("work_assignments")
    .update({
      active: previousAssignment ? previousAssignment.active === true : false,
      assignment_end_date: previousAssignment ? previousAssignment.assignment_end_date : null
    })
    .eq("id", savedAssignment.id)
    .eq("person_id", selectedPersonId);

  if (rollback.error) throw rollback.error;
  throw new Error(
    "Another active matching assignment was saved at the same time. This assignment was not activated."
  );
}

async function classifyAssignmentInDatabase(candidate) {
  if (!candidate || candidate.active !== true) return { status: "valid" };
  const result = await supabaseClient
    .from("work_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("person_id", selectedPersonId)
    .eq("active", true);

  if (result.error) throw result.error;
  return classifyCandidateAssignment(candidate, result.data || []);
}

export function openEndAssignmentDialog(assignmentId, trigger) {
  if (!requireAssignmentManageAccess()) return;
  const assignment = assignmentsCache.find(record => record.id === assignmentId);
  if (!assignment || !assignment.active) return;

  assignmentPendingEnd = assignment;
  assignmentEndTrigger = trigger instanceof HTMLElement ? trigger : null;
  $("assignmentEndDate").value = todayDate();
  $("assignmentEndMessage").textContent = "";
  $("assignmentEndMessage").className = "modal-message";
  $("assignmentEndModalBackdrop").classList.add("active");
  setTimeout(() => $("assignmentEndDate").focus({ preventScroll: true }), 0);
}

export function closeEndAssignmentDialog() {
  $("assignmentEndModalBackdrop").classList.remove("active");
  assignmentPendingEnd = null;
  if (assignmentEndTrigger && assignmentEndTrigger.isConnected) {
    assignmentEndTrigger.focus({ preventScroll: true });
  }
  assignmentEndTrigger = null;
}

export async function confirmEndAssignment() {
  if (!requireAssignmentManageAccess() || !assignmentPendingEnd) return;
  const assignment = assignmentPendingEnd;
  const endDate = $("assignmentEndDate").value;

  try {
    if (!endDate) throw new Error("Assignment End Date is required.");
    validateAssignmentDates(assignment.assignment_start_date, endDate);
  } catch (err) {
    $("assignmentEndMessage").textContent = err.message;
    $("assignmentEndMessage").className = "modal-message error";
    return;
  }

  const confirmButton = $("assignmentEndConfirmButton");
  confirmButton.disabled = true;
  confirmButton.textContent = "Ending...";

  try {
    const result = await supabaseClient
      .from("work_assignments")
      .update({ active: false, assignment_end_date: endDate })
      .eq("id", assignment.id)
      .eq("person_id", selectedPersonId)
      .eq("active", true)
      .select("id")
      .single();

    if (result.error) throw result.error;
    const endedAssignment = {
      ...assignment,
      active: false,
      assignment_end_date: endDate
    };
    void writeAuditEvent(
      "assignment.ended",
      "work_assignments",
      assignment.id,
      assignmentAuditDetails(assignment, endedAssignment)
    );
    closeEndAssignmentDialog();
    await loadAssignments();
    showToast("Assignment ended", "The assignment is now Historical.", "success");
  } catch (err) {
    $("assignmentEndMessage").textContent = err.message || "Could not end this assignment.";
    $("assignmentEndMessage").className = "modal-message error";
    showToast("Assignment not ended", err.message || "Could not end this assignment.", "error");
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = "End Assignment";
  }
}

export async function reactivateAssignment(assignmentId) {
  if (!requireAssignmentManageAccess() || !selectedPersonId) return;
  const assignment = assignmentsCache.find(record => record.id === assignmentId);
  if (!assignment || assignment.active) return;

  try {
    const candidate = { ...assignment, active: true, assignment_end_date: null };
    const localClassification = classifyCandidateAssignment(candidate, assignmentsCache);
    if (classificationBlocksSave(localClassification)) {
      throw new Error(assignmentBlockingMessage(localClassification));
    }
    let overrideClassification = classificationRequiresOverride(localClassification)
      ? localClassification
      : null;
    const databaseClassification = await classifyAssignmentInDatabase(candidate);
    if (classificationBlocksSave(databaseClassification)) {
      throw new Error(assignmentBlockingMessage(databaseClassification));
    }
    if (!overrideClassification && classificationRequiresOverride(databaseClassification)) {
      overrideClassification = databaseClassification;
    }
    let reactivatedWithOverride = false;
    let updatePayload = { active: true, assignment_end_date: null };
    if (overrideClassification) {
      const reason = await requestAssignmentOverrideReason();
      if (!reason) {
        showToast("Assignment not reactivated", "Enter an overlap override reason to reactivate this assignment.", "error");
        return;
      }
      updatePayload = {
        ...updatePayload,
        notes: appendAssignmentOverrideReason(assignment.notes, reason)
      };
      reactivatedWithOverride = true;
    }

    const result = await supabaseClient
      .from("work_assignments")
      .update(updatePayload)
      .eq("id", assignment.id)
      .eq("person_id", selectedPersonId)
      .eq("active", false)
      .select(ASSIGNMENT_COLUMNS)
      .single();

    if (result.error) throw result.error;
    await rollbackIfActivationConflicted(result.data, assignment);
    void writeAuditEvent(
      "assignment.reactivated",
      "work_assignments",
      result.data.id,
      assignmentAuditDetails(assignment, result.data)
    );
    await loadAssignments();
    showToast(
      reactivatedWithOverride ? "Assignment reactivated with warning" : "Assignment reactivated",
      reactivatedWithOverride
        ? "This assignment was reactivated with an overlap override reason."
        : "The assignment is now Active.",
      "success"
    );
  } catch (err) {
    await loadAssignments();
    showToast("Assignment not reactivated", err.message || "Could not reactivate this assignment.", "error");
  }
}
