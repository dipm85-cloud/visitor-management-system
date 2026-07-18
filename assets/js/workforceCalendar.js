import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { downloadCsv, downloadXlsx } from "./exports.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { showWorkforceCalendarWorkspace } from "./shell.js";
import { hasAnyCapability } from "./capabilities.js";
import { exportDateStamp, todayDate } from "./utils.js";
import {
  isClearDuplicateAssignment,
  isLikelyRotaConflictAssignment
} from "./assignmentConflicts.js";

const DISPLAY_MODE_KEY = "oh_workforce_calendar_display_mode";
const MAX_RANGE_DAYS = 31;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const PRINT_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
    sites: [],
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

const monthlyPrintState = {
  open: false,
  lastPreview: null
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

function currentMonthValue() {
  const today = parseDateKey(todayDate()) || new Date();
  return today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
}

function parseMonthValue(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

function monthRange(value) {
  const parsed = parseMonthValue(value);
  if (!parsed) return null;
  const start = new Date(parsed.year, parsed.monthIndex, 1);
  const end = new Date(parsed.year, parsed.monthIndex + 1, 0);
  return {
    from: dateKey(start),
    to: dateKey(end),
    monthName: MONTH_NAMES[parsed.monthIndex],
    year: parsed.year,
    monthIndex: parsed.monthIndex
  };
}

function monthCalendarDays(value) {
  const range = monthRange(value);
  if (!range) return [];
  const start = mondayFor(parseDateKey(range.from));
  const endDate = parseDateKey(range.to);
  const endDay = endDate.getDay();
  const daysToSunday = endDay === 0 ? 0 : 7 - endDay;
  const end = addDays(endDate, daysToSunday);
  const days = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push({
      date: dateKey(cursor),
      dayNumber: cursor.getDate(),
      inMonth: cursor.getMonth() === range.monthIndex
    });
  }
  return days;
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

function formatCompactDate(value) {
  const date = parseDateKey(value);
  if (!date) return value || "-";
  return DAY_NAMES[date.getDay()].slice(0, 3) + " " +
    String(date.getDate()).padStart(2, "0");
}

function formatCompactMonth(value) {
  const date = parseDateKey(value);
  if (!date) return "";
  return date.toLocaleString("en-GB", { month: "short" });
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

    if (!personAssignments.length) return;

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
  filters.includeInactiveAssignments = $("workforceCalendarIncludeInactiveAssignments")
    ? $("workforceCalendarIncludeInactiveAssignments").checked
    : false;
  return filters;
}

function filterMatches(row, filters) {
  if (filters.activePeopleOnly && row.person.active === false) return false;
  const assignment = row.assignment || {};
  if (!filters.includeInactiveAssignments && assignment.id && assignment.active === false) return false;
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
  const includeInactiveAssignments = $("workforceCalendarIncludeInactiveAssignments")
    ? $("workforceCalendarIncludeInactiveAssignments").checked
    : false;
  if (!activePeopleOnly) parts.push("inactive people included");
  if (includeInactiveAssignments) parts.push("inactive assignments included");
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

  const inactiveAssignmentLabel = document.createElement("label");
  inactiveAssignmentLabel.className = "workforce-calendar-check";
  inactiveAssignmentLabel.htmlFor = "workforceCalendarIncludeInactiveAssignments";
  const inactiveAssignmentInput = document.createElement("input");
  inactiveAssignmentInput.id = "workforceCalendarIncludeInactiveAssignments";
  inactiveAssignmentInput.type = "checkbox";
  inactiveAssignmentInput.checked = previous.includeInactiveAssignments;
  inactiveAssignmentInput.addEventListener("change", renderCalendar);
  inactiveAssignmentLabel.append(inactiveAssignmentInput, document.createTextNode(" Include inactive assignments"));
  workContainer.appendChild(inactiveAssignmentLabel);

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
  const profile = calendarState.lookups.workTimeProfiles.find(item => item.id === assignment.work_time_profile_id) || null;
  return [
    labelFor(calendarState.lookups.departments, assignment.department_id, "department_name"),
    labelFor(calendarState.lookups.roles, assignment.job_role_id, "role_name"),
    labelFor(calendarState.lookups.contracts, assignment.contract_id, "contract_name"),
    labelFor(calendarState.lookups.employers, assignment.employer_organisation_id, "organisation_name"),
    profile && (profile.profile_name || profile.profile_code)
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

function cellTitle(cell) {
  const person = cell.person || {};
  const profile = cell.profile || {};
  const parts = [
    person.display_name || "Person",
    formatDisplayDate(cell.date),
    stateLabel(cell.status)
  ];
  if (profile.profile_name || profile.profile_code) {
    parts.push("Profile: " + (profile.profile_name || profile.profile_code));
  }
  if (cell.status === "working") {
    parts.push("Time: " + formatTime(cell.start_time) + "-" + formatTime(cell.end_time));
    parts.push("Paid: " + formatHours(cell.paid_hours) + "h");
    if (cell.unsociable_hours > 0) parts.push("Unsociable: " + formatHours(cell.unsociable_hours) + "h");
    if (cell.tags && cell.tags.length) parts.push("Tags: " + cell.tags.join(", "));
  }
  return parts.join("\n");
}

function compactWorkingLabel(cell) {
  if (cell.unsociable_hours > 0) return "N";
  const startText = String(cell.start_time || "").slice(0, 2);
  const start = /^\d{2}$/.test(startText) ? Number(startText) : null;
  if (start !== null) return start < 12 ? "AM" : "PM";
  return "W";
}

function personSearchText(person) {
  return [
    person && person.display_name,
    person && person.external_person_number
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderMonthlyPrintPeopleOptions() {
  const select = $("personMonthlyRotaPersonSelect");
  if (!select) return;
  const previous = select.value;
  const query = $("personMonthlyRotaPersonSearch")
    ? $("personMonthlyRotaPersonSearch").value.trim().toLowerCase()
    : "";
  const people = calendarState.people
    .filter(person => !query || personSearchText(person).includes(query))
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = people.length ? "Select a person" : "No people match";
  select.appendChild(placeholder);

  people.forEach(person => {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = (person.display_name || "Unnamed person") +
      (person.external_person_number ? " (" + person.external_person_number + ")" : "") +
      (person.active === false ? " - inactive" : "");
    select.appendChild(option);
  });

  if (previous && people.some(person => person.id === previous)) select.value = previous;
  else if (people.length === 1) select.value = people[0].id;
}

function assignmentLegendContext(assignment) {
  return [
    labelFor(calendarState.lookups.sites, assignment.site_id, "site_name"),
    labelFor(calendarState.lookups.contracts, assignment.contract_id, "contract_name"),
    labelFor(calendarState.lookups.departments, assignment.department_id, "department_name"),
    labelFor(calendarState.lookups.roles, assignment.job_role_id, "role_name"),
    labelFor(calendarState.lookups.employers, assignment.employer_organisation_id, "organisation_name")
  ].filter(Boolean).join(" | ") || "Assignment context";
}

function assignmentProfileLabel(assignment) {
  const profile = calendarState.lookups.workTimeProfiles.find(item => item.id === assignment.work_time_profile_id) || {};
  const pattern = calendarState.lookups.shiftPatterns.find(item => item.id === assignment.shift_pattern_id) || {};
  return [
    profile.profile_name || profile.profile_code,
    pattern.shift_name
  ].filter(Boolean).join(" | ");
}

function assignmentDateLabel(assignment) {
  const start = assignment.assignment_start_date || "open";
  const end = assignment.assignment_end_date || "open";
  return start + " to " + end;
}

function assignmentHasOverrideNote(assignment) {
  return /\[assignment conflict override/i.test(String(assignment && assignment.notes || ""));
}

function dayConflictWarning(dayEntries) {
  const entries = dayEntries.filter(entry =>
    entry.cell.status === "working" ||
    entry.cell.status === "no_profile" ||
    entry.cell.status === "pattern_not_configured"
  );
  if (entries.length < 2) return false;
  const lookups = {
    shiftPatterns: calendarState.lookups.shiftPatterns,
    workTimeProfiles: calendarState.lookups.workTimeProfiles
  };
  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      if (
        isClearDuplicateAssignment(entries[first].row.assignment, entries[second].row.assignment) ||
        isLikelyRotaConflictAssignment(entries[first].row.assignment, entries[second].row.assignment, lookups)
      ) {
        return true;
      }
    }
  }
  return entries.filter(entry => entry.cell.status === "working").length > 1;
}

function monthlyDayStatus(dayEntries) {
  if (!dayEntries.length) return "no_assignment";
  if (dayEntries.some(entry => entry.cell.status === "working")) return "working";
  if (dayEntries.some(entry => entry.cell.status === "no_profile")) return "no_profile";
  if (dayEntries.some(entry => entry.cell.status === "pattern_not_configured")) return "pattern_not_configured";
  if (dayEntries.some(entry => entry.cell.status === "assignment_inactive")) return "assignment_inactive";
  return "off";
}

function createMonthlyPrintModel(personId, monthValue, options = {}) {
  const person = calendarState.people.find(item => item.id === personId);
  const range = monthRange(monthValue);
  if (!person || !range) return null;

  const monthDates = rangeDays(range.from, range.to);
  const activeAssignments = calendarState.assignments
    .filter(assignment => assignment.person_id === person.id)
    .filter(assignment => assignment.active !== false)
    .filter(assignment => monthDates.some(dateValue => assignmentCoversDate(assignment, dateValue)));
  const rows = buildExpectedWorkGrid(
    [person],
    activeAssignments,
    calendarState.lookups.workTimeProfiles,
    monthDates,
    calendarState.lookups
  );
  const assignmentMarkers = new Map();
  rows.forEach((row, index) => {
    if (!assignmentMarkers.has(row.assignment.id)) {
      assignmentMarkers.set(row.assignment.id, "A" + (index + 1));
    }
  });

  const daysByDate = new Map();
  monthDates.forEach((dateValue, dateIndex) => {
    const entries = rows
      .map(row => ({
        row,
        marker: assignmentMarkers.get(row.assignment.id) || "A",
        cell: row.cells[dateIndex]
      }))
      .filter(entry => entry.cell && entry.cell.status !== "no_assignment");
    const workingEntries = entries.filter(entry => entry.cell.status === "working");
    const issueEntries = entries.filter(entry =>
      entry.cell.status === "no_profile" ||
      entry.cell.status === "pattern_not_configured" ||
      entry.cell.status === "assignment_inactive"
    );
    const warning = dayConflictWarning(entries);
    const overrideRecorded = entries.some(entry => assignmentHasOverrideNote(entry.row.assignment));
    daysByDate.set(dateValue, {
      date: dateValue,
      status: monthlyDayStatus(entries),
      entries,
      workingEntries,
      issueEntries,
      warning,
      overrideRecorded
    });
  });

  const workingCells = [...daysByDate.values()].flatMap(day => day.workingEntries.map(entry => entry.cell));
  return {
    person,
    range,
    monthValue,
    monthDates,
    calendarDays: monthCalendarDays(monthValue),
    daysByDate,
    rows,
    assignments: rows.map(row => row.assignment),
    assignmentMarkers,
    options,
    summary: {
      activeAssignments: rows.length,
      workingDays: [...daysByDate.values()].filter(day => day.workingEntries.length).length,
      paidHours: workingCells.reduce((sum, cell) => sum + Number(cell.paid_hours || 0), 0),
      unsociableHours: workingCells.reduce((sum, cell) => sum + Number(cell.unsociable_hours || 0), 0),
      warnings: [...daysByDate.values()].filter(day => day.warning).length
    }
  };
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function createMonthlyDayCell(model, day) {
  const cell = document.createElement("div");
  cell.className = "monthly-rota-day";
  if (!day.inMonth) {
    cell.classList.add("is-outside-month");
    return cell;
  }

  const detail = model.daysByDate.get(day.date) || { status: "no_assignment", workingEntries: [], issueEntries: [] };
  cell.classList.add("is-" + detail.status.replace(/_/g, "-"));
  if (detail.warning) cell.classList.add("has-warning");
  if (detail.overrideRecorded) cell.classList.add("has-override");

  const header = document.createElement("div");
  header.className = "monthly-rota-day-header";
  appendText(header, "span", "monthly-rota-day-number", String(day.dayNumber));
  if (detail.warning) appendText(header, "span", "monthly-rota-day-warning", "!");
  else if (detail.overrideRecorded) appendText(header, "span", "monthly-rota-day-override", "Override");
  cell.appendChild(header);

  const body = document.createElement("div");
  body.className = "monthly-rota-day-body";
  if (detail.workingEntries.length) {
    detail.workingEntries.slice(0, 3).forEach(entry => {
      const item = document.createElement("div");
      item.className = "monthly-rota-work-item";
      appendText(item, "span", "monthly-rota-marker", entry.marker);
      appendText(item, "span", "monthly-rota-time", formatTime(entry.cell.start_time) + "-" + formatTime(entry.cell.end_time));
      const tags = entry.cell.tags && entry.cell.tags.length ? entry.cell.tags.join(" ") : "";
      if (tags) appendText(item, "span", "monthly-rota-tags", tags);
      body.appendChild(item);
    });
    if (detail.workingEntries.length > 3) {
      appendText(body, "span", "monthly-rota-more", "+" + (detail.workingEntries.length - 3) + " more");
    }
  } else if (detail.issueEntries.length) {
    const issue = detail.issueEntries[0];
    const item = document.createElement("div");
    item.className = "monthly-rota-work-item is-issue";
    appendText(item, "span", "monthly-rota-marker", issue.marker);
    appendText(item, "span", "monthly-rota-time", stateLabel(issue.cell.status));
    body.appendChild(item);
  } else {
    appendText(body, "span", "monthly-rota-state-label", stateLabel(detail.status));
  }
  cell.appendChild(body);
  return cell;
}

function renderMonthlyPrintLegend(model, page) {
  if (!model.options.showLegend) return;
  const legend = document.createElement("section");
  legend.className = "monthly-rota-legend";
  appendText(legend, "h3", "", "Assignment legend");

  if (!model.rows.length) {
    appendText(legend, "p", "monthly-rota-legend-empty", "No active assignments are expected in this month.");
    page.appendChild(legend);
    return;
  }

  const list = document.createElement("div");
  list.className = "monthly-rota-legend-list";
  model.rows.forEach(row => {
    const item = document.createElement("div");
    item.className = "monthly-rota-legend-item";
    appendText(item, "span", "monthly-rota-marker", model.assignmentMarkers.get(row.assignment.id) || "A");
    const detail = document.createElement("div");
    appendText(detail, "strong", "", assignmentLegendContext(row.assignment));
    const profileText = assignmentProfileLabel(row.assignment);
    appendText(detail, "span", "", [
      profileText,
      assignmentDateLabel(row.assignment),
      assignmentHasOverrideNote(row.assignment) ? "Override recorded" : ""
    ].filter(Boolean).join(" | "));
    item.appendChild(detail);
    list.appendChild(item);
  });
  legend.appendChild(list);
  page.appendChild(legend);
}

function renderMonthlyPrintNotes(model, page) {
  if (!model.options.showNotes) return;
  const notes = document.createElement("section");
  notes.className = "monthly-rota-notes";
  appendText(notes, "span", "", "Working days show expected assignment time and marker. Off means an active assignment is present but the pattern is not working that day. No assignment means no active assignment covers the date.");
  if (model.summary.warnings) {
    appendText(notes, "span", "", "! indicates a possible overlap or duplicate assignment context for that day.");
  }
  page.appendChild(notes);
}

function monthlyPrintBranding() {
  const brandText = document.querySelector(".brand div:last-child");
  const logoImg = $("brandLogoImg");
  const companyName = brandText
    ? String(brandText.textContent || "").split(/\s*Operations Hub\b/)[0].trim()
    : "";
  const logoVisible = logoImg &&
    logoImg.getAttribute("src") &&
    logoImg.style.display !== "none";
  return {
    companyName: companyName || "Operations Hub",
    logoUrl: logoVisible ? logoImg.getAttribute("src") : ""
  };
}

function renderMonthlyPrintBrand(page) {
  const branding = monthlyPrintBranding();
  const brand = document.createElement("div");
  brand.className = "monthly-rota-brand";

  if (branding.logoUrl) {
    const logo = document.createElement("img");
    logo.className = "monthly-rota-brand-logo";
    logo.src = branding.logoUrl;
    logo.alt = branding.companyName + " logo";
    logo.addEventListener("error", () => {
      logo.remove();
      brand.classList.add("has-fallback-text");
      if (!brand.querySelector(".monthly-rota-brand-fallback")) {
        appendText(brand, "span", "monthly-rota-brand-fallback", branding.companyName);
      }
    });
    brand.appendChild(logo);
  } else {
    brand.classList.add("has-fallback-text");
    appendText(brand, "span", "monthly-rota-brand-fallback", branding.companyName);
  }
  page.appendChild(brand);
}

function createMonthlyRotaDocument(model, options = {}) {
  const page = document.createElement("article");
  page.className = "monthly-rota-print-page";
  if (options.printDocument) page.classList.add("monthly-rota-print-document");
  if (model.options.density === "compact") page.classList.add("is-compact");

  const header = document.createElement("header");
  header.className = "monthly-rota-page-header";
  renderMonthlyPrintBrand(header);
  const titleBlock = document.createElement("div");
  titleBlock.className = "monthly-rota-title-block";
  appendText(titleBlock, "h2", "", "MONTHLY ROTA");
  appendText(titleBlock, "p", "monthly-rota-person-name", model.person.display_name || "Person");
  appendText(titleBlock, "p", "monthly-rota-month-label", model.range.monthName + " " + model.range.year);
  const meta = document.createElement("div");
  meta.className = "monthly-rota-page-meta";
  appendText(meta, "span", "", "Printed " + new Date().toLocaleDateString("en-GB"));
  appendText(meta, "span", "", model.summary.activeAssignments + " active assignment" + (model.summary.activeAssignments === 1 ? "" : "s"));
  appendText(meta, "span", "", model.summary.workingDays + " working day" + (model.summary.workingDays === 1 ? "" : "s"));
  appendText(meta, "span", "", formatHours(model.summary.paidHours) + " paid hours");
  header.append(titleBlock, meta);
  page.appendChild(header);

  const grid = document.createElement("section");
  const weekCount = Math.max(1, Math.ceil(model.calendarDays.length / 7));
  grid.className = "monthly-rota-grid monthly-rota-grid-" + weekCount + "-weeks";
  PRINT_WEEKDAY_NAMES.forEach(dayName => appendText(grid, "div", "monthly-rota-weekday", dayName));
  model.calendarDays.forEach(day => grid.appendChild(createMonthlyDayCell(model, day)));
  page.appendChild(grid);

  appendText(page, "footer", "monthly-rota-print-footer", "Generated by Operations Hub");
  renderMonthlyPrintLegend(model, page);
  renderMonthlyPrintNotes(model, page);
  return page;
}

function renderMonthlyRotaPreview(model) {
  const wrap = $("personMonthlyRotaPreviewWrap");
  const empty = $("personMonthlyRotaPreviewEmpty");
  if (!wrap || !empty) return;
  wrap.replaceChildren();
  empty.classList.add("hidden");
  wrap.appendChild(createMonthlyRotaDocument(model));
}

function ensureMonthlyPrintRoot() {
  let root = $("personMonthlyRotaPrintRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "personMonthlyRotaPrintRoot";
    root.className = "monthly-rota-print-root";
    root.setAttribute("aria-hidden", "true");
  }
  if (root.parentElement !== document.body) document.body.appendChild(root);
  return root;
}

function renderMonthlyRotaPrintDocument(model) {
  const root = ensureMonthlyPrintRoot();
  root.replaceChildren();
  root.appendChild(createMonthlyRotaDocument(model, { printDocument: true }));
}

function createCompactCellContent(cell) {
  const wrapper = document.createElement("div");
  wrapper.className = "workforce-calendar-cell-content workforce-calendar-compact-content";
  const marker = document.createElement("span");
  marker.className = "workforce-calendar-compact-marker";
  marker.title = cellTitle(cell);
  if (cell.status === "working") {
    marker.textContent = compactWorkingLabel(cell);
  } else if (cell.status === "no_profile") {
    marker.textContent = "!";
  } else if (cell.status === "pattern_not_configured") {
    marker.textContent = "?";
  } else if (cell.status === "assignment_inactive") {
    marker.textContent = "X";
  }
  wrapper.appendChild(marker);
  return wrapper;
}

function createCellContent(cell) {
  const wrapper = document.createElement("div");
  wrapper.className = "workforce-calendar-cell-content";

  const mode = currentDisplayMode();
  if (mode === "compact") return createCompactCellContent(cell);
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
  const mode = $("workforceCalendarDisplayMode") ? $("workforceCalendarDisplayMode").value : "detailed";
  return ["detailed", "visual", "compact"].includes(mode) ? mode : "detailed";
}

function updateDisplayModeChrome(mode) {
  const compact = mode === "compact";
  ["workforceCalendarCompactLegend", "workforceCalendarFullscreenCompactLegend"].forEach(id => {
    const legend = $(id);
    if (legend) legend.classList.toggle("hidden", !compact);
  });
}

function renderCalendar() {
  const filters = currentFilters();
  const rows = calendarState.grid.filter(row => filterMatches(row, filters));
  const mode = currentDisplayMode();
  updateDisplayModeChrome(mode);
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
  const compact = currentDisplayMode() === "compact";
  table.classList.toggle("is-compact", compact);

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
    th.title = formatDisplayDate(dateValue);
    if (compact) {
      const day = document.createElement("span");
      day.className = "workforce-calendar-compact-date-day";
      day.textContent = formatCompactDate(dateValue);
      const month = document.createElement("span");
      month.className = "workforce-calendar-compact-date-month";
      month.textContent = formatCompactMonth(dateValue);
      th.append(day, month);
    } else {
      th.textContent = formatDisplayDate(dateValue);
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    const personCell = document.createElement("th");
    personCell.scope = "row";
    personCell.className = "workforce-calendar-person-column";
    personCell.title = rowMeta(row)
      ? (row.person.display_name || "Person") + "\n" + rowMeta(row)
      : (row.person.display_name || "Person");
    const name = document.createElement("strong");
    name.textContent = row.person.display_name || "Person";
    if (compact) {
      personCell.appendChild(name);
    } else {
      const meta = document.createElement("span");
      meta.textContent = rowMeta(row) || "No assignment context";
      personCell.append(name, meta);
    }
    tr.appendChild(personCell);

    row.cells.forEach(cell => {
      const td = document.createElement("td");
      td.className = "workforce-calendar-cell is-" + cell.status.replace(/_/g, "-");
      if (cell.unsociable_hours > 0) td.classList.add("is-unsociable");
      td.title = cellTitle(cell);
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
  const activeAssignments = rows.filter(row => row.assignment && row.assignment.active !== false).length;
  const inactiveAssignments = rows.filter(row => row.assignment && row.assignment.active === false).length;
  const cells = rows.flatMap(row => row.cells);
  const working = cells.filter(cell => cell.status === "working");
  const paid = working.reduce((sum, cell) => sum + Number(cell.paid_hours || 0), 0);
  const unsociable = working.reduce((sum, cell) => sum + Number(cell.unsociable_hours || 0), 0);
  const text =
    peopleCount + " people shown | " +
    activeAssignments + " active assignments" +
    (inactiveAssignments ? " | " + inactiveAssignments + " inactive assignments" : "") + " | " +
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
      sitesResult,
      departmentsResult,
      rolesResult,
      contractsResult,
      employersResult,
      shiftPatternsResult,
      workProfiles
    ] = await Promise.all([
      supabaseClient.from("people").select("id, external_person_number, display_name, active").order("display_name", { ascending: true }),
      supabaseClient.from("work_assignments").select(ASSIGNMENT_COLUMNS).order("assignment_start_date", { ascending: false }),
      supabaseClient.from("sites").select("id, site_code, site_name, active").order("site_name", { ascending: true }),
      supabaseClient.from("departments").select("id, department_name, active").order("department_name", { ascending: true }),
      supabaseClient.from("job_roles").select("id, role_name, active").order("role_name", { ascending: true }),
      supabaseClient.from("contracts").select("id, contract_name, active").order("contract_name", { ascending: true }),
      supabaseClient.from("organisations").select("id, organisation_name, active").order("organisation_name", { ascending: true }),
      supabaseClient.from("shift_patterns").select("id, shift_name, pattern_type, static_weekdays, cycle_pattern, cycle_length_days, active").order("shift_name", { ascending: true }),
      loadWorkTimeProfiles()
    ]);

    [peopleResult, assignmentsResult, sitesResult, departmentsResult, rolesResult, contractsResult, employersResult, shiftPatternsResult]
      .forEach(result => {
        if (result.error) throw result.error;
      });

    calendarState.people = peopleResult.data || [];
    calendarState.assignments = assignmentsResult.data || [];
    calendarState.lookups = {
      sites: sitesResult.data || [],
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
  const inactiveAssignments = $("workforceCalendarIncludeInactiveAssignments");
  if (inactiveAssignments) inactiveAssignments.checked = false;
  void loadCalendarData();
}

function clearFilterSelections() {
  closeOpenFilterDropdowns();
  document.querySelectorAll("[data-workforce-filter]").forEach(input => {
    input.checked = false;
  });
  const active = $("workforceCalendarActivePeopleOnly");
  if (active) active.checked = true;
  const inactiveAssignments = $("workforceCalendarIncludeInactiveAssignments");
  if (inactiveAssignments) inactiveAssignments.checked = false;
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

function ensureMonthlyPrintOverlayRoot() {
  const overlay = $("personMonthlyRotaPrintOverlay");
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
}

async function openMonthlyPrintOverlay() {
  if (!requireWorkforceCalendarAccess()) return;
  setFullscreen(false);
  ensureMonthlyPrintOverlayRoot();
  const overlay = $("personMonthlyRotaPrintOverlay");
  if (!overlay) return;
  monthlyPrintState.open = true;
  monthlyPrintState.lastPreview = null;
  overlay.classList.remove("hidden");
  document.body.classList.add("monthly-rota-print-open");
  if ($("personMonthlyRotaPreviewWrap")) $("personMonthlyRotaPreviewWrap").replaceChildren();
  ensureMonthlyPrintRoot().replaceChildren();
  if ($("personMonthlyRotaMonth") && !$("personMonthlyRotaMonth").value) {
    $("personMonthlyRotaMonth").value = currentMonthValue();
  }
  if (!calendarState.loaded) await loadCalendarData();
  renderMonthlyPrintPeopleOptions();
  if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").disabled = true;
  if ($("personMonthlyRotaPrintStatus")) {
    $("personMonthlyRotaPrintStatus").textContent = "Select a person and month, then preview the rota.";
  }
  overlay.focus({ preventScroll: true });
}

export async function openPersonMonthlyRotaPrint(personId) {
  const selectedPersonId = String(personId || "").trim();
  if (!selectedPersonId) {
    showToast("Person required", "Open a person profile before printing a monthly rota.", "error");
    return;
  }
  await openMonthlyPrintOverlay();
  if ($("personMonthlyRotaPersonSearch")) $("personMonthlyRotaPersonSearch").value = "";
  if ($("personMonthlyRotaMonth")) $("personMonthlyRotaMonth").value = currentMonthValue();
  renderMonthlyPrintPeopleOptions();
  if ($("personMonthlyRotaPersonSelect")) {
    $("personMonthlyRotaPersonSelect").value = selectedPersonId;
  }
  monthlyPrintState.lastPreview = null;
  if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").disabled = true;
  if ($("personMonthlyRotaPrintStatus")) {
    const person = calendarState.people.find(item => item.id === selectedPersonId);
    $("personMonthlyRotaPrintStatus").textContent = (person ? person.display_name : "Selected person") +
      " is selected. Preview the current month before printing.";
  }
}

function closeMonthlyPrintOverlay() {
  const overlay = $("personMonthlyRotaPrintOverlay");
  if (overlay) overlay.classList.add("hidden");
  document.body.classList.remove("monthly-rota-print-open", "monthly-rota-printing");
  monthlyPrintState.open = false;
}

async function previewMonthlyRotaPrint() {
  if (!calendarState.loaded) await loadCalendarData();
  renderMonthlyPrintPeopleOptions();
  const personId = $("personMonthlyRotaPersonSelect") ? $("personMonthlyRotaPersonSelect").value : "";
  const monthValue = $("personMonthlyRotaMonth") ? $("personMonthlyRotaMonth").value : "";
  if (!personId) {
    showToast("Person required", "Choose a person before previewing the monthly rota.", "error");
    return;
  }
  if (!monthRange(monthValue)) {
    showToast("Month required", "Choose a valid month before previewing the monthly rota.", "error");
    return;
  }
  const model = createMonthlyPrintModel(personId, monthValue, {
    density: $("personMonthlyRotaDensity") ? $("personMonthlyRotaDensity").value : "standard",
    showLegend: $("personMonthlyRotaShowLegend") ? $("personMonthlyRotaShowLegend").checked : true,
    showNotes: $("personMonthlyRotaShowNotes") ? $("personMonthlyRotaShowNotes").checked : true
  });
  if (!model) {
    showToast("Preview unavailable", "The selected person or month could not be found.", "error");
    return;
  }
  monthlyPrintState.lastPreview = model;
  renderMonthlyRotaPreview(model);
  if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").disabled = false;
  if ($("personMonthlyRotaPrintStatus")) {
    $("personMonthlyRotaPrintStatus").textContent =
      model.person.display_name + " | " +
      model.range.monthName + " " + model.range.year + " | " +
      model.summary.workingDays + " working day" + (model.summary.workingDays === 1 ? "" : "s") + " | " +
      formatHours(model.summary.paidHours) + " paid hours";
  }
}

function printMonthlyRota() {
  if (!monthlyPrintState.lastPreview) {
    showToast("Preview required", "Preview the monthly rota before printing.", "error");
    return;
  }
  renderMonthlyRotaPrintDocument(monthlyPrintState.lastPreview);
  document.body.classList.add("monthly-rota-printing");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("monthly-rota-printing");
  }, 1000);
}

function handleFullscreenKeydown(event) {
  if (event.key !== "Escape") return;
  const hasOpenFilter = document.querySelector(".workforce-calendar-multi-filter[open]");
  if (hasOpenFilter) {
    closeOpenFilterDropdowns();
    event.preventDefault();
    return;
  }
  if (monthlyPrintState.open) {
    closeMonthlyPrintOverlay();
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

function handleWorkforceCalendarClick(event) {
  const target = event.target && event.target.closest ? event.target : null;
  const printButton = target ? target.closest("#workforceCalendarPersonPrintButton") : null;
  if (!printButton) return;
  event.preventDefault();
  void openMonthlyPrintOverlay();
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

function handleAfterPrint() {
  document.body.classList.remove("monthly-rota-printing");
}

export async function openWorkforceCalendar() {
  if (!requireWorkforceCalendarAccess()) return;
  showWorkforceCalendarWorkspace();
  if (!calendarState.loaded) await loadCalendarData();
  else renderCalendar();
}

export function initialiseWorkforceCalendar() {
  ensureFullscreenOverlayRoot();
  ensureMonthlyPrintOverlayRoot();
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
  if ($("personMonthlyRotaPersonSearch")) {
    $("personMonthlyRotaPersonSearch").addEventListener("input", () => {
      monthlyPrintState.lastPreview = null;
      if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").disabled = true;
      renderMonthlyPrintPeopleOptions();
    });
  }
  if ($("personMonthlyRotaPreviewButton")) $("personMonthlyRotaPreviewButton").addEventListener("click", previewMonthlyRotaPrint);
  if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").addEventListener("click", printMonthlyRota);
  if ($("personMonthlyRotaPrintCloseButton")) $("personMonthlyRotaPrintCloseButton").addEventListener("click", closeMonthlyPrintOverlay);
  ["personMonthlyRotaPersonSelect", "personMonthlyRotaMonth", "personMonthlyRotaDensity", "personMonthlyRotaShowLegend", "personMonthlyRotaShowNotes"].forEach(id => {
    if ($(id)) {
      $(id).addEventListener("change", () => {
        monthlyPrintState.lastPreview = null;
        if ($("personMonthlyRotaPrintButton")) $("personMonthlyRotaPrintButton").disabled = true;
      });
    }
  });
  window.addEventListener("afterprint", handleAfterPrint);
  document.addEventListener("click", handleWorkforceCalendarClick);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleFullscreenKeydown);
}
