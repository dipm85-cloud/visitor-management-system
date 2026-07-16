import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { downloadCsv, downloadXlsx } from "./exports.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { showWorkforceCalendarWorkspace } from "./shell.js";
import { hasAnyCapability } from "./capabilities.js";
import { exportDateStamp, todayDate } from "./utils.js";

const DISPLAY_MODE_KEY = "oh_workforce_calendar_display_mode";
const MAX_RANGE_DAYS = 31;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ASSIGNMENT_COLUMNS = [
  "id",
  "person_id",
  "site_id",
  "employer_organisation_id",
  "department_id",
  "contract_id",
  "job_role_id",
  "assignment_type",
  "shift_pattern_id",
  "work_time_profile_id",
  "shift_start_time",
  "shift_end_time",
  "cycle_anchor_date",
  "employment_start_date",
  "assignment_start_date",
  "assignment_end_date",
  "active",
  "notes"
].join(", ");

const FILTER_DEFINITIONS = [
  { key: "department", label: "Department", group: "people", emptyLabel: "All departments" },
  { key: "role", label: "Role", group: "people", emptyLabel: "All roles" },
  { key: "contract", label: "Contract", group: "people", emptyLabel: "All contracts" },
  { key: "employer", label: "Employer", group: "people", emptyLabel: "All employers" },
  { key: "shiftPattern", label: "Shift Pattern", group: "work", emptyLabel: "All patterns" },
  { key: "workTimeProfile", label: "Work Time Profile", group: "work", emptyLabel: "All profiles" },
  { key: "tag1", label: "Tag 1", group: "work", emptyLabel: "All Tag 1 values" },
  { key: "tag2", label: "Tag 2", group: "work", emptyLabel: "All Tag 2 values" },
  { key: "tag3", label: "Tag 3", group: "work", emptyLabel: "All Tag 3 values" }
];

const calendarState = {
  people: [],
  assignments: [],
  lookups: {
    departments: [],
    roles: [],
    contracts: [],
    employers: [],
    shiftPatterns: [],
    workTimeProfiles: []
  },
  rows: [],
  grid: [],
  dateRange: [],
  loaded: false,
  fullscreen: false
};

function hasWorkforceCalendarAccess() {
  return hasAnyCapability([
    "workforce_calendar.view",
    "workforce_calendar.manage",
    "people.view",
    "people.manage"
  ]);
}

function requireWorkforceCalendarAccess() {
  if (hasWorkforceCalendarAccess()) return true;
  showToast("You do not have permission", "Workforce Calendar requires workforce calendar or People access.", "error");
  return false;
}

function parseDateKey(value) {
  if (!value) return null;
  const date = new Date(String(value) + "T00:00:00");
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mondayFor(date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function currentWeekRange() {
  const start = mondayFor(parseDateKey(todayDate()) || new Date());
  return { from: dateKey(start), to: dateKey(addDays(start, 6)) };
}

function rangeDays(fromValue, toValue) {
  const from = parseDateKey(fromValue);
  const to = parseDateKey(toValue);
  if (!from || !to || to < from) return [];
  const days = [];
  for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) {
    days.push(dateKey(cursor));
  }
  return days;
}

function formatDisplayDate(value) {
  const date = parseDateKey(value);
  if (!date) return value || "-";
  return DAY_NAMES[date.getDay()].slice(0, 3) + " " +
    String(date.getDate()).padStart(2, "0") + "/" +
    String(date.getMonth() + 1).padStart(2, "0");
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : "-";
}

function formatHours(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "0.00";
}

function profileTags(profile) {
  return ["custom_tag_1", "custom_tag_2", "custom_tag_3"]
    .map(key => String(profile && profile[key] ? profile[key] : "").trim())
    .filter(Boolean);
}

function labelFor(list, id, field) {
  if (!id) return "";
  const record = (list || []).find(item => item.id === id);
  return record ? record[field] || "" : "";
}

function byId(list) {
  return new Map((list || []).map(item => [item.id, item]));
}

function normaliseWeekday(value) {
  const text = String(value || "").trim().toLowerCase();
  const match = DAY_NAMES.find(day => day.toLowerCase() === text || day.slice(0, 3).toLowerCase() === text.slice(0, 3));
  return match || "";
}

function weekdayAllowed(staticWeekdays, dateValue) {
  const date = parseDateKey(dateValue);
  if (!date) return null;
  const weekday = DAY_NAMES[date.getDay()];
  if (Array.isArray(staticWeekdays)) {
    const days = staticWeekdays.map(normaliseWeekday).filter(Boolean);
    return days.length ? days.includes(weekday) : null;
  }
  if (staticWeekdays && typeof staticWeekdays === "object") {
    const raw = staticWeekdays[weekday] ?? staticWeekdays[weekday.toLowerCase()] ?? staticWeekdays[weekday.slice(0, 3).toLowerCase()];
    if (typeof raw === "boolean") return raw;
    if (Array.isArray(staticWeekdays.days)) return weekdayAllowed(staticWeekdays.days, dateValue);
    if (Array.isArray(staticWeekdays.weekdays)) return weekdayAllowed(staticWeekdays.weekdays, dateValue);
  }
  return null;
}

function cycleItems(pattern) {
  if (Array.isArray(pattern)) return pattern;
  if (pattern && Array.isArray(pattern.days)) return pattern.days;
  if (pattern && Array.isArray(pattern.cycle)) return pattern.cycle;
  return [];
}

function cycleItemWorks(item) {
  if (typeof item === "boolean") return item;
  if (typeof item === "string") return !["off", "rest", "none", "non-working", "non_working"].includes(item.toLowerCase());
  if (!item || typeof item !== "object") return null;
  if (typeof item.working === "boolean") return item.working;
  if (typeof item.is_working === "boolean") return item.is_working;
  const status = String(item.status || item.shift || item.type || "").toLowerCase();
  if (!status) return null;
  return !["off", "rest", "none", "non-working", "non_working"].includes(status);
}

function dayDiff(fromValue, toValue) {
  const from = parseDateKey(fromValue);
  const to = parseDateKey(toValue);
  if (!from || !to) return null;
  return Math.floor((to - from) / 86400000);
}

function assignmentCoversDate(assignment, dateValue) {
  if (!assignment) return false;
  if (assignment.assignment_start_date && dateValue < assignment.assignment_start_date) return false;
  if (assignment.assignment_end_date && dateValue > assignment.assignment_end_date) return false;
  return true;
}

export function resolveExpectedWorkForDate(person, assignment, dateValue, context) {
  if (!assignment || !assignmentCoversDate(assignment, dateValue)) {
    return { status: "no_assignment", label: "No assignment", person, assignment, date: dateValue };
  }
  if (assignment.active === false) {
    return { status: "assignment_inactive", label: "Assignment inactive", person, assignment, date: dateValue };
  }

  const profile = context.profilesById.get(assignment.work_time_profile_id) || null;
  if (!profile) {
    return { status: "no_profile", label: "No Work Time Profile", person, assignment, date: dateValue };
  }

  const pattern = context.shiftPatternsById.get(assignment.shift_pattern_id) || null;
  if (!pattern) {
    return { status: "pattern_not_configured", label: "Needs rota pattern", person, assignment, profile, date: dateValue };
  }

  let working = null;
  if (pattern.pattern_type === "static") {
    working = weekdayAllowed(pattern.static_weekdays, dateValue);
  } else if (pattern.pattern_type === "rotating") {
    const items = cycleItems(pattern.cycle_pattern);
    const diff = dayDiff(assignment.cycle_anchor_date, dateValue);
    if (items.length && diff !== null) {
      const index = ((diff % items.length) + items.length) % items.length;
      working = cycleItemWorks(items[index]);
    }
  }

  if (working === false) {
    return { status: "off", label: "Off", person, assignment, profile, pattern, date: dateValue };
  }
  if (working !== true) {
    return { status: "pattern_not_configured", label: "Needs rota pattern", person, assignment, profile, pattern, date: dateValue };
  }

  return {
    status: "working",
    label: "Working",
    person,
    assignment,
    profile,
    pattern,
    date: dateValue,
    start_time: profile.start_time || assignment.shift_start_time || "",
    end_time: profile.end_time || assignment.shift_end_time || "",
    paid_hours: Number(profile.paid_hours || 0),
    unsociable_hours: Number(profile.unsociable_hours || 0),
    tags: profileTags(profile)
  };
}

export function buildExpectedWorkGrid(people, assignments, workTimeProfiles, dateRange, lookups) {
  const profilesById = byId(workTimeProfiles);
  const shiftPatternsById = byId(lookups.shiftPatterns);
  const assignmentsByPerson = new Map();
  assignments.forEach(assignment => {
    if (!assignmentsByPerson.has(assignment.person_id)) assignmentsByPerson.set(assignment.person_id, []);
    assignmentsByPerson.get(assignment.person_id).push(assignment);
  });

  const rows = [];
  people.forEach(person => {
    const personAssignments = (assignmentsByPerson.get(person.id) || [])
      .filter(assignment => dateRange.some(dateValue => assignmentCoversDate(assignment, dateValue)));

    if (!personAssignments.length) {
      rows.push({ person, assignment: null, cells: dateRange.map(dateValue => resolveExpectedWorkForDate(person, null, dateValue, { profilesById, shiftPatternsById })) });
      return;
    }

    personAssignments.forEach(assignment => {
      rows.push({
        person,
        assignment,
        cells: dateRange.map(dateValue => resolveExpectedWorkForDate(person, assignment, dateValue, { profilesById, shiftPatternsById }))
      });
    });
  });

  return rows;
}

function selectedFilterValues(key) {
  return Array.from(document.querySelectorAll("[data-workforce-filter='" + key + "']:checked"))
    .map(input => input.value)
    .filter(Boolean);
}

function closeOpenFilterDropdowns(except) {
  document.querySelectorAll(".workforce-calendar-multi-filter[open]").forEach(details => {
    if (details !== except) details.removeAttribute("open");
  });
}

function currentFilters() {
  const filters = {};
  FILTER_DEFINITIONS.forEach(definition => {
    filters[definition.key] = selectedFilterValues(definition.key);
  });
  filters.activePeopleOnly = $("workforceCalendarActivePeopleOnly")
    ? $("workforceCalendarActivePeopleOnly").checked
    : true;
  return filters;
}

function filterMatches(row, filters) {
  if (filters.activePeopleOnly && row.person.active === false) return false;
  const assignment = row.assignment || {};
  const profile = calendarState.lookups.workTimeProfiles.find(item => item.id === assignment.work_time_profile_id) || null;
  const values = {
    department: assignment.department_id || "",
    role: assignment.job_role_id || "",
    contract: assignment.contract_id || "",
    employer: assignment.employer_organisation_id || "",
    shiftPattern: assignment.shift_pattern_id || "",
    workTimeProfile: assignment.work_time_profile_id || "",
    tag1: profile && profile.custom_tag_1 ? profile.custom_tag_1 : "",
    tag2: profile && profile.custom_tag_2 ? profile.custom_tag_2 : "",
    tag3: profile && profile.custom_tag_3 ? profile.custom_tag_3 : ""
  };

  return FILTER_DEFINITIONS.every(definition => {
    const selected = filters[definition.key] || [];
    return !selected.length || selected.includes(values[definition.key]);
  });
}

function optionListFor(definition) {
  const lookups = calendarState.lookups;
  if (definition.key === "department") return lookups.departments.map(item => ({ value: item.id, label: item.department_name }));
  if (definition.key === "role") return lookups.roles.map(item => ({ value: item.id, label: item.role_name }));
  if (definition.key === "contract") return lookups.contracts.map(item => ({ value: item.id, label: item.contract_name }));
  if (definition.key === "employer") return lookups.employers.map(item => ({ value: item.id, label: item.organisation_name }));
  if (definition.key === "shiftPattern") return lookups.shiftPatterns.map(item => ({ value: item.id, label: item.shift_name }));
  if (definition.key === "workTimeProfile") return lookups.workTimeProfiles.map(item => ({ value: item.id, label: item.profile_name || item.profile_code }));
  if (definition.key === "tag1") return uniqueTagOptions("custom_tag_1");
  if (definition.key === "tag2") return uniqueTagOptions("custom_tag_2");
  if (definition.key === "tag3") return uniqueTagOptions("custom_tag_3");
  return [];
}

function uniqueTagOptions(key) {
  return [...new Set(calendarState.lookups.workTimeProfiles
    .map(profile => String(profile[key] || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map(value => ({ value, label: value }));
}

function filterSummaryText(definition, options, selectedValues) {
  if (!selectedValues.length) return definition.emptyLabel || "All";
  const labels = selectedValues
    .map(value => {
      const option = options.find(item => item.value === value);
      return option ? option.label : value;
    })
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(", ");
  return labels.slice(0, 2).join(", ") + " +" + (labels.length - 2);
}

function updateFilterSummaries() {
  const parts = [];
  const activePeopleOnly = $("workforceCalendarActivePeopleOnly")
    ? $("workforceCalendarActivePeopleOnly").checked
    : true;
  if (!activePeopleOnly) parts.push("inactive people included");
  FILTER_DEFINITIONS.forEach(definition => {
    const selected = selectedFilterValues(definition.key);
    const control = document.querySelector("[data-workforce-filter-control='" + definition.key + "']");
    if (control) {
      const text = control.querySelector("[data-workforce-filter-summary]");
      const options = optionListFor(definition)
        .filter(option => option.value && option.label);
      if (text) text.textContent = filterSummaryText(definition, options, selected);
      control.classList.toggle("has-selection", selected.length > 0);
    }
    if (selected.length) {
      parts.push(selected.length + " " + definition.label.toLowerCase());
    }
  });

  const summary = $("workforceCalendarFilterSummary");
  const fullscreenFilters = $("workforceCalendarFullscreenFilters");
  const text = parts.length
    ? parts.join(" | ") + " active"
    : "No filters active";
  if (summary) {
    summary.textContent = text;
  }
  if (fullscreenFilters) fullscreenFilters.textContent = text;
  const clear = $("workforceCalendarClearFilters");
  if (clear) clear.disabled = parts.length === 0;
}

function createMultiSelectControl(definition, options, selected) {
  const details = document.createElement("details");
  details.className = "workforce-calendar-multi-filter";
  details.dataset.workforceFilterControl = definition.key;
  details.addEventListener("toggle", () => {
    if (details.open) closeOpenFilterDropdowns(details);
  });

  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "workforce-calendar-filter-label";
  label.textContent = definition.label;
  const value = document.createElement("span");
  value.className = "workforce-calendar-filter-value";
  value.dataset.workforceFilterSummary = "true";
  value.textContent = filterSummaryText(definition, options, selected);
  summary.append(label, value);
  details.appendChild(summary);

  const panel = document.createElement("div");
  panel.className = "workforce-calendar-filter-menu";
  options.forEach(option => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "workforce-calendar-filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.value;
    checkbox.checked = selected.includes(option.value);
    checkbox.dataset.workforceFilter = definition.key;
    checkbox.addEventListener("change", () => {
      updateFilterSummaries();
      renderCalendar();
    });
    optionLabel.append(checkbox, document.createTextNode(option.label));
    panel.appendChild(optionLabel);
  });

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "ghost workforce-calendar-filter-clear";
  clear.textContent = "Clear";
  clear.addEventListener("click", event => {
    event.preventDefault();
    panel.querySelectorAll("input[type='checkbox']").forEach(input => {
      input.checked = false;
    });
    updateFilterSummaries();
    renderCalendar();
  });
  panel.appendChild(clear);
  details.appendChild(panel);
  details.classList.toggle("has-selection", selected.length > 0);
  return details;
}

function renderFilters() {
  const peopleContainer = $("workforceCalendarPeopleFilters");
  const workContainer = $("workforceCalendarWorkFilters");
  if (!peopleContainer || !workContainer) return;
  const previous = currentFilters();
  peopleContainer.replaceChildren();
  workContainer.replaceChildren();

  const activeLabel = document.createElement("label");
  activeLabel.className = "workforce-calendar-check";
  activeLabel.htmlFor = "workforceCalendarActivePeopleOnly";
  const activeInput = document.createElement("input");
  activeInput.id = "workforceCalendarActivePeopleOnly";
  activeInput.type = "checkbox";
  activeInput.checked = previous.activePeopleOnly;
  activeInput.addEventListener("change", renderCalendar);
  activeLabel.append(activeInput, document.createTextNode(" Active people only"));
  peopleContainer.appendChild(activeLabel);

  FILTER_DEFINITIONS.forEach(definition => {
    const options = optionListFor(definition)
      .filter(option => option.value && option.label)
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    if (!options.length) return;
    const control = createMultiSelectControl(definition, options, previous[definition.key] || []);
    if (definition.group === "people") peopleContainer.appendChild(control);
    else workContainer.appendChild(control);
  });
  updateFilterSummaries();
}

function rowMeta(row) {
  const assignment = row.assignment || {};
  return [
    labelFor(calendarState.lookups.departments, assignment.department_id, "department_name"),
    labelFor(calendarState.lookups.roles, assignment.job_role_id, "role_name"),
    labelFor(calendarState.lookups.contracts, assignment.contract_id, "contract_name")
  ].filter(Boolean).join(" | ");
}

function stateLabel(status) {
  return {
    working: "Working",
    off: "Off",
    no_assignment: "No assignment",
    no_profile: "No Work Time Profile",
    pattern_not_configured: "Needs rota pattern",
    assignment_inactive: "Assignment inactive"
  }[status] || "Unknown";
}

function createCellContent(cell) {
  const wrapper = document.createElement("div");
  wrapper.className = "workforce-calendar-cell-content";

  const mode = currentDisplayMode();
  if (mode === "visual") {
    const status = document.createElement("span");
    status.className = "workforce-calendar-visual-block";
    status.textContent = cell.status === "working"
      ? (cell.tags && cell.tags[0]) || (cell.profile && (cell.profile.profile_code || cell.profile.profile_name)) || "Work"
      : stateLabel(cell.status);
    wrapper.appendChild(status);
    return wrapper;
  }

  if (cell.status === "working") {
    const title = document.createElement("strong");
    title.textContent = formatTime(cell.start_time) + "-" + formatTime(cell.end_time);
    const hours = document.createElement("span");
    hours.textContent = formatHours(cell.paid_hours) + "h paid" +
      (cell.unsociable_hours > 0 ? " | " + formatHours(cell.unsociable_hours) + "h unsociable" : "");
    wrapper.append(title, hours);
    if (cell.tags && cell.tags.length) {
      const tags = document.createElement("span");
      tags.textContent = cell.tags.join(" | ");
      wrapper.appendChild(tags);
    }
    return wrapper;
  }

  const label = document.createElement("span");
  label.textContent = stateLabel(cell.status);
  wrapper.appendChild(label);
  return wrapper;
}

function currentDisplayMode() {
  return $("workforceCalendarDisplayMode") ? $("workforceCalendarDisplayMode").value : "detailed";
}

function renderCalendar() {
  const filters = currentFilters();
  const rows = calendarState.grid.filter(row => filterMatches(row, filters));
  updateFilterSummaries();
  renderCalendarTable($("workforceCalendarGrid"), $("workforceCalendarEmptyState"), "workforceCalendarEmptyState", rows);
  renderCalendarTable(
    $("workforceCalendarFullscreenGrid"),
    $("workforceCalendarFullscreenEmptyState"),
    "workforceCalendarFullscreenEmptyState",
    rows
  );
  updateSummary(rows);
}

function renderCalendarTable(table, empty, emptyStateId, rows) {
  if (!table || !empty) return;
  table.replaceChildren();

  if (!rows.length) {
    empty.classList.remove("hidden");
    renderEmptyState(emptyStateId, {
      title: calendarState.loaded ? "No calendar rows match" : "No calendar loaded",
      description: calendarState.loaded
        ? "Adjust the date range or filters to show workforce calendar rows."
        : "Open Workforce Calendar to load People assignments."
    });
    return;
  }

  empty.classList.add("hidden");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const personHead = document.createElement("th");
  personHead.scope = "col";
  personHead.className = "workforce-calendar-person-column";
  personHead.textContent = "Person";
  headRow.appendChild(personHead);
  calendarState.dateRange.forEach(dateValue => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = formatDisplayDate(dateValue);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    const personCell = document.createElement("th");
    personCell.scope = "row";
    personCell.className = "workforce-calendar-person-column";
    const name = document.createElement("strong");
    name.textContent = row.person.display_name || "Person";
    const meta = document.createElement("span");
    meta.textContent = rowMeta(row) || "No assignment context";
    personCell.append(name, meta);
    tr.appendChild(personCell);

    row.cells.forEach(cell => {
      const td = document.createElement("td");
      td.className = "workforce-calendar-cell is-" + cell.status.replace(/_/g, "-");
      td.appendChild(createCellContent(cell));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
}

function updateSummary(rows) {
  const summary = $("workforceCalendarSummary");
  const peopleCount = new Set(rows.map(row => row.person.id)).size;
  const cells = rows.flatMap(row => row.cells);
  const working = cells.filter(cell => cell.status === "working");
  const paid = working.reduce((sum, cell) => sum + Number(cell.paid_hours || 0), 0);
  const unsociable = working.reduce((sum, cell) => sum + Number(cell.unsociable_hours || 0), 0);
  const text =
    peopleCount + " people shown | " +
    calendarState.dateRange.length + " days | " +
    cells.length + " cells | " +
    working.length + " working days | " +
    paid.toFixed(2) + " paid hours | " +
    unsociable.toFixed(2) + " unsociable hours";
  if (summary) summary.textContent = text;
  if ($("workforceCalendarFullscreenSummary")) $("workforceCalendarFullscreenSummary").textContent = text;
  if ($("workforceCalendarFullscreenMeta")) {
    $("workforceCalendarFullscreenMeta").textContent =
      ($("workforceCalendarDateFrom") ? $("workforceCalendarDateFrom").value : "") +
      " to " +
      ($("workforceCalendarDateTo") ? $("workforceCalendarDateTo").value : "");
  }
}

function exportRows() {
  const filters = currentFilters();
  return calendarState.grid
    .filter(row => filterMatches(row, filters))
    .flatMap(row => row.cells.map(cell => {
      const assignment = row.assignment || {};
      const profile = cell.profile || calendarState.lookups.workTimeProfiles.find(item => item.id === assignment.work_time_profile_id) || {};
      return {
        "Person": row.person.display_name || "",
        "Department": labelFor(calendarState.lookups.departments, assignment.department_id, "department_name"),
        "Role": labelFor(calendarState.lookups.roles, assignment.job_role_id, "role_name"),
        "Contract": labelFor(calendarState.lookups.contracts, assignment.contract_id, "contract_name"),
        "Employer": labelFor(calendarState.lookups.employers, assignment.employer_organisation_id, "organisation_name"),
        "Date": cell.date,
        "Expected Status": stateLabel(cell.status),
        "Work Time Profile": profile.profile_name || profile.profile_code || "",
        "Start Time": cell.start_time ? formatTime(cell.start_time) : "",
        "End Time": cell.end_time ? formatTime(cell.end_time) : "",
        "Paid Hours": cell.status === "working" ? formatHours(cell.paid_hours) : "",
        "Unsociable Hours": cell.status === "working" ? formatHours(cell.unsociable_hours) : "",
        "Tag 1": profile.custom_tag_1 || "",
        "Tag 2": profile.custom_tag_2 || "",
        "Tag 3": profile.custom_tag_3 || ""
      };
    }));
}

function exportCsv() {
  const rows = exportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No Workforce Calendar rows match the current filters.", "error");
    return;
  }
  downloadCsv("workforce-rota-calendar-" + exportDateStamp() + ".csv", rows);
  showToast("Export created", rows.length + " calendar rows were exported.", "success");
}

function exportXlsx() {
  const rows = exportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No Workforce Calendar rows match the current filters.", "error");
    return;
  }
  downloadXlsx("workforce-rota-calendar-" + exportDateStamp() + ".xlsx", rows, "Rota Calendar");
  showToast("Export created", rows.length + " calendar rows were exported.", "success");
}

async function loadWorkTimeProfiles() {
  const result = await supabaseClient.rpc("list_work_time_profiles", {
    p_include_inactive: true,
    p_search_text: null
  });
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadCalendarData() {
  const from = $("workforceCalendarDateFrom").value;
  const to = $("workforceCalendarDateTo").value;
  const dates = rangeDays(from, to);
  if (!dates.length) {
    showToast("Date range invalid", "Choose a valid date from and date to.", "error");
    return;
  }
  if (dates.length > MAX_RANGE_DAYS) {
    showToast("Date range too large", "This first calendar view supports up to 31 days.", "warning");
    return;
  }

  $("workforceCalendarSummary").textContent = "Loading calendar...";
  $("workforceCalendarGrid").replaceChildren();
  if ($("workforceCalendarFullscreenGrid")) $("workforceCalendarFullscreenGrid").replaceChildren();
  $("workforceCalendarEmptyState").classList.add("hidden");
  if ($("workforceCalendarFullscreenEmptyState")) $("workforceCalendarFullscreenEmptyState").classList.add("hidden");

  try {
    const [
      peopleResult,
      assignmentsResult,
      departmentsResult,
      rolesResult,
      contractsResult,
      employersResult,
      shiftPatternsResult,
      workProfiles
    ] = await Promise.all([
      supabaseClient.from("people").select("id, external_person_number, display_name, active").order("display_name", { ascending: true }),
      supabaseClient.from("work_assignments").select(ASSIGNMENT_COLUMNS).order("assignment_start_date", { ascending: false }),
      supabaseClient.from("departments").select("id, department_name, active").order("department_name", { ascending: true }),
      supabaseClient.from("job_roles").select("id, role_name, active").order("role_name", { ascending: true }),
      supabaseClient.from("contracts").select("id, contract_name, active").order("contract_name", { ascending: true }),
      supabaseClient.from("organisations").select("id, organisation_name, active").order("organisation_name", { ascending: true }),
      supabaseClient.from("shift_patterns").select("id, shift_name, pattern_type, static_weekdays, cycle_pattern, cycle_length_days, active").order("shift_name", { ascending: true }),
      loadWorkTimeProfiles()
    ]);

    [peopleResult, assignmentsResult, departmentsResult, rolesResult, contractsResult, employersResult, shiftPatternsResult]
      .forEach(result => {
        if (result.error) throw result.error;
      });

    calendarState.people = peopleResult.data || [];
    calendarState.assignments = assignmentsResult.data || [];
    calendarState.lookups = {
      departments: departmentsResult.data || [],
      roles: rolesResult.data || [],
      contracts: contractsResult.data || [],
      employers: employersResult.data || [],
      shiftPatterns: shiftPatternsResult.data || [],
      workTimeProfiles: workProfiles
    };
    calendarState.dateRange = dates;
    calendarState.grid = buildExpectedWorkGrid(
      calendarState.people,
      calendarState.assignments,
      calendarState.lookups.workTimeProfiles,
      calendarState.dateRange,
      calendarState.lookups
    );
    calendarState.loaded = true;
    renderFilters();
    renderCalendar();
  } catch (err) {
    calendarState.grid = [];
    calendarState.loaded = false;
    renderCalendar();
    $("workforceCalendarSummary").textContent = "Workforce Calendar could not be loaded.";
    showToast("Calendar load failed", err.message || "Could not load Workforce Calendar data.", "error");
  }
}

function setRange(from, to) {
  $("workforceCalendarDateFrom").value = from;
  $("workforceCalendarDateTo").value = to;
}

function shiftWeek(delta) {
  const from = parseDateKey($("workforceCalendarDateFrom").value) || parseDateKey(todayDate()) || new Date();
  const start = addDays(from, delta * 7);
  setRange(dateKey(start), dateKey(addDays(start, 6)));
  void loadCalendarData();
}

function resetCalendar() {
  closeOpenFilterDropdowns();
  const range = currentWeekRange();
  setRange(range.from, range.to);
  renderFilters();
  clearFilterSelections();
  const active = $("workforceCalendarActivePeopleOnly");
  if (active) active.checked = true;
  void loadCalendarData();
}

function clearFilterSelections() {
  closeOpenFilterDropdowns();
  document.querySelectorAll("[data-workforce-filter]").forEach(input => {
    input.checked = false;
  });
  const active = $("workforceCalendarActivePeopleOnly");
  if (active) active.checked = true;
  updateFilterSummaries();
  renderCalendar();
}

function setFullscreen(enabled) {
  calendarState.fullscreen = enabled;
  closeOpenFilterDropdowns();
  ensureFullscreenOverlayRoot();
  const overlay = $("workforceCalendarFullscreenOverlay");
  if (overlay) overlay.classList.toggle("hidden", !enabled);
  document.body.classList.toggle("workforce-calendar-fullscreen-active", enabled);
  syncDisplayModeControls(currentDisplayMode());
  renderCalendar();
  if (overlay && enabled) overlay.focus({ preventScroll: true });
}

function ensureFullscreenOverlayRoot() {
  const overlay = $("workforceCalendarFullscreenOverlay");
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
}

function handleFullscreenKeydown(event) {
  if (event.key !== "Escape") return;
  const hasOpenFilter = document.querySelector(".workforce-calendar-multi-filter[open]");
  if (hasOpenFilter) {
    closeOpenFilterDropdowns();
    event.preventDefault();
    return;
  }
  if (calendarState.fullscreen) {
    setFullscreen(false);
    event.preventDefault();
  }
}

function handleDocumentPointerDown(event) {
  if (!event.target.closest(".workforce-calendar-multi-filter")) {
    closeOpenFilterDropdowns();
  }
}

function syncDisplayModeControls(value) {
  if ($("workforceCalendarDisplayMode")) $("workforceCalendarDisplayMode").value = value;
  if ($("workforceCalendarFullscreenDisplayMode")) $("workforceCalendarFullscreenDisplayMode").value = value;
}

function setDisplayMode(value) {
  syncDisplayModeControls(value);
  localStorage.setItem(DISPLAY_MODE_KEY, value);
  renderCalendar();
}

function exitFullscreenToFilters() {
  setFullscreen(false);
  const toolbar = document.querySelector(".workforce-calendar-toolbar");
  if (toolbar) toolbar.scrollIntoView({ block: "start" });
}

export async function openWorkforceCalendar() {
  if (!requireWorkforceCalendarAccess()) return;
  showWorkforceCalendarWorkspace();
  if (!calendarState.loaded) await loadCalendarData();
  else renderCalendar();
}

export function initialiseWorkforceCalendar() {
  ensureFullscreenOverlayRoot();
  const range = currentWeekRange();
  setRange(range.from, range.to);
  const mode = localStorage.getItem(DISPLAY_MODE_KEY) || "detailed";
  syncDisplayModeControls(mode);

  if ($("workforceCalendarRefreshButton")) $("workforceCalendarRefreshButton").addEventListener("click", loadCalendarData);
  if ($("workforceCalendarFullscreenButton")) $("workforceCalendarFullscreenButton").addEventListener("click", () => setFullscreen(true));
  if ($("workforceCalendarExitFullscreen")) $("workforceCalendarExitFullscreen").addEventListener("click", () => setFullscreen(false));
  if ($("workforceCalendarClearFilters")) $("workforceCalendarClearFilters").addEventListener("click", clearFilterSelections);
  if ($("workforceCalendarPreviousWeek")) $("workforceCalendarPreviousWeek").addEventListener("click", () => shiftWeek(-1));
  if ($("workforceCalendarNextWeek")) $("workforceCalendarNextWeek").addEventListener("click", () => shiftWeek(1));
  if ($("workforceCalendarToday")) $("workforceCalendarToday").addEventListener("click", () => {
    const todayRange = currentWeekRange();
    setRange(todayRange.from, todayRange.to);
    void loadCalendarData();
  });
  if ($("workforceCalendarApplyFilters")) $("workforceCalendarApplyFilters").addEventListener("click", loadCalendarData);
  if ($("workforceCalendarResetFilters")) $("workforceCalendarResetFilters").addEventListener("click", resetCalendar);
  if ($("workforceCalendarExportCsv")) $("workforceCalendarExportCsv").addEventListener("click", exportCsv);
  if ($("workforceCalendarExportXlsx")) $("workforceCalendarExportXlsx").addEventListener("click", exportXlsx);
  if ($("workforceCalendarFullscreenExportCsv")) $("workforceCalendarFullscreenExportCsv").addEventListener("click", exportCsv);
  if ($("workforceCalendarFullscreenExportXlsx")) $("workforceCalendarFullscreenExportXlsx").addEventListener("click", exportXlsx);
  if ($("workforceCalendarFullscreenEditFilters")) $("workforceCalendarFullscreenEditFilters").addEventListener("click", exitFullscreenToFilters);
  if ($("workforceCalendarDisplayMode")) {
    $("workforceCalendarDisplayMode").addEventListener("change", event => {
      setDisplayMode(event.target.value);
    });
  }
  if ($("workforceCalendarFullscreenDisplayMode")) {
    $("workforceCalendarFullscreenDisplayMode").addEventListener("change", event => {
      setDisplayMode(event.target.value);
    });
  }
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleFullscreenKeydown);
}
