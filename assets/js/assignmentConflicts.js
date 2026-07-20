const OPERATIONAL_CONTEXT_FIELDS = [
  "site_id",
  "employer_organisation_id",
  "contract_id",
  "department_id",
  "job_role_id",
  "assignment_type",
  "manager_person_id"
];

const DUPLICATE_DETAIL_FIELDS = [
  "shift_pattern_id",
  "work_time_profile_id",
  "break_rule_id"
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

function cleanValue(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function valuesMatch(a, b) {
  return cleanValue(a) === cleanValue(b);
}

function nonBlankValuesMatch(a, b) {
  const aValue = cleanValue(a);
  const bValue = cleanValue(b);
  return !!aValue && aValue === bValue;
}

function lookupById(lookups, id) {
  if (!id) return null;
  if (lookups instanceof Map) return lookups.get(id) || null;
  return (lookups || []).find(item => item.id === id) || null;
}

function dateKey(value) {
  return cleanValue(value);
}

export function normaliseAssignmentContext(assignment) {
  const source = assignment || {};
  const context = {};
  OPERATIONAL_CONTEXT_FIELDS.forEach(field => {
    context[field] = cleanValue(source[field]);
  });
  return context;
}

export function assignmentDateRangesOverlap(a, b) {
  const aStart = dateKey(a && a.assignment_start_date);
  const bStart = dateKey(b && b.assignment_start_date);
  if (!aStart || !bStart) return false;

  const aEnd = dateKey(a && a.assignment_end_date) || "9999-12-31";
  const bEnd = dateKey(b && b.assignment_end_date) || "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

export function assignmentOperationalContextsMatch(a, b) {
  const aContext = normaliseAssignmentContext(a);
  const bContext = normaliseAssignmentContext(b);
  return OPERATIONAL_CONTEXT_FIELDS.every(field => aContext[field] === bContext[field]);
}

function normaliseWeekday(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  return WEEKDAYS.find(day => day === text || day.slice(0, 3) === text.slice(0, 3)) || "";
}

function parseStaticWeekdays(staticWeekdays) {
  if (Array.isArray(staticWeekdays)) {
    const days = staticWeekdays.map(normaliseWeekday).filter(Boolean);
    return days.length ? new Set(days) : null;
  }

  if (staticWeekdays && typeof staticWeekdays === "object") {
    const directDays = WEEKDAYS.filter(day => {
      const raw = staticWeekdays[day] ?? staticWeekdays[day.slice(0, 3)];
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    });
    if (directDays.length) return new Set(directDays);
    if (Array.isArray(staticWeekdays.days)) return parseStaticWeekdays(staticWeekdays.days);
    if (Array.isArray(staticWeekdays.weekdays)) return parseStaticWeekdays(staticWeekdays.weekdays);
    if (Array.isArray(staticWeekdays.working_days)) return parseStaticWeekdays(staticWeekdays.working_days);
    return null;
  }

  if (typeof staticWeekdays === "string") {
    const text = staticWeekdays.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      const parsedDays = parseStaticWeekdays(parsed);
      if (parsedDays) return parsedDays;
    } catch {
      // Fall through to delimiter parsing.
    }
    const days = text
      .split(/[\s,|\/;]+/)
      .map(normaliseWeekday)
      .filter(Boolean);
    return days.length ? new Set(days) : null;
  }

  return null;
}

export function assignmentWorkingDaysOverlap(a, b, shiftPatternLookups) {
  const aPatternId = cleanValue(a && a.shift_pattern_id);
  const bPatternId = cleanValue(b && b.shift_pattern_id);
  if (aPatternId && bPatternId && aPatternId === bPatternId) return true;

  const aPattern = lookupById(shiftPatternLookups, aPatternId);
  const bPattern = lookupById(shiftPatternLookups, bPatternId);
  if (!aPattern || !bPattern) return false;
  if (aPattern.pattern_type !== "static" || bPattern.pattern_type !== "static") return false;

  const aDays = parseStaticWeekdays(aPattern.static_weekdays);
  const bDays = parseStaticWeekdays(bPattern.static_weekdays);
  if (!aDays || !bDays) return false;
  return [...aDays].some(day => bDays.has(day));
}

function minutesFromTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function normaliseTimeValue(value) {
  const minutes = minutesFromTime(value);
  if (minutes === null) return null;
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
}

function timeWindow(startValue, endValue, crossesMidnight) {
  const start = minutesFromTime(startValue);
  const end = minutesFromTime(endValue);
  if (start === null || end === null || start === end) return null;
  return {
    start,
    end: crossesMidnight || end < start ? end + 1440 : end
  };
}

function assignmentTimeWindow(assignment, workTimeProfileLookups) {
  const profile = lookupById(workTimeProfileLookups, cleanValue(assignment && assignment.work_time_profile_id));
  if (profile && profile.start_time && profile.end_time) {
    return timeWindow(profile.start_time, profile.end_time, profile.crosses_midnight === true);
  }
  return timeWindow(assignment && assignment.shift_start_time, assignment && assignment.shift_end_time, false);
}

function timeWindowsOverlap(a, b) {
  if (!a || !b) return false;
  const aWindows = [a, { start: a.start + 1440, end: a.end + 1440 }];
  const bWindows = [b, { start: b.start + 1440, end: b.end + 1440 }];
  return aWindows.some(aWindow =>
    bWindows.some(bWindow => aWindow.start < bWindow.end && bWindow.start < aWindow.end)
  );
}

export function assignmentTimesOverlap(a, b, workTimeProfileLookups) {
  const aProfileId = cleanValue(a && a.work_time_profile_id);
  const bProfileId = cleanValue(b && b.work_time_profile_id);
  if (aProfileId && bProfileId && aProfileId === bProfileId) return true;
  return timeWindowsOverlap(
    assignmentTimeWindow(a, workTimeProfileLookups),
    assignmentTimeWindow(b, workTimeProfileLookups)
  );
}

function samePerson(a, b) {
  return valuesMatch(a && a.person_id, b && b.person_id);
}

function activePair(a, b) {
  return a && b && a.active === true && b.active === true;
}

function sameAssignmentRecord(a, b) {
  const aId = cleanValue(a && a.id);
  const bId = cleanValue(b && b.id);
  return aId && bId && aId === bId;
}

export function isClearDuplicateAssignment(a, b) {
  if (sameAssignmentRecord(a, b)) return false;
  const aProfileId = cleanValue(a && a.work_time_profile_id);
  const bProfileId = cleanValue(b && b.work_time_profile_id);
  const legacyTimesMatch = aProfileId && bProfileId
    ? true
    : normaliseTimeValue(a && a.shift_start_time) === normaliseTimeValue(b && b.shift_start_time) &&
      normaliseTimeValue(a && a.shift_end_time) === normaliseTimeValue(b && b.shift_end_time);
  return activePair(a, b) &&
    samePerson(a, b) &&
    assignmentDateRangesOverlap(a, b) &&
    assignmentOperationalContextsMatch(a, b) &&
    DUPLICATE_DETAIL_FIELDS.every(field => valuesMatch(a && a[field], b && b[field])) &&
    legacyTimesMatch;
}

export function isClearConflictingAssignment(a, b, lookups = {}) {
  if (sameAssignmentRecord(a, b)) return false;
  return activePair(a, b) &&
    samePerson(a, b) &&
    assignmentDateRangesOverlap(a, b) &&
    assignmentOperationalContextsMatch(a, b) &&
    assignmentWorkingDaysOverlap(a, b, lookups.shiftPatterns) &&
    assignmentTimesOverlap(a, b, lookups.workTimeProfiles);
}

export function isLikelyRotaConflictAssignment(a, b, lookups = {}) {
  if (sameAssignmentRecord(a, b)) return false;
  if (!activePair(a, b) || !samePerson(a, b) || !assignmentDateRangesOverlap(a, b)) return false;

  const sameEmployer = nonBlankValuesMatch(a && a.employer_organisation_id, b && b.employer_organisation_id);
  const sameContract = nonBlankValuesMatch(a && a.contract_id, b && b.contract_id);
  const sameShiftPattern = nonBlankValuesMatch(a && a.shift_pattern_id, b && b.shift_pattern_id);
  const sameWorkTimeProfile = nonBlankValuesMatch(a && a.work_time_profile_id, b && b.work_time_profile_id);
  if (sameEmployer && sameContract && sameShiftPattern && sameWorkTimeProfile) return true;

  return assignmentOperationalContextsMatch(a, b) &&
    assignmentWorkingDaysOverlap(a, b, lookups.shiftPatterns) &&
    assignmentTimesOverlap(a, b, lookups.workTimeProfiles);
}

function hasBlankOperationalContext(assignment) {
  const context = normaliseAssignmentContext(assignment);
  return OPERATIONAL_CONTEXT_FIELDS
    .filter(field => field !== "assignment_type")
    .every(field => !context[field]);
}

export function assignmentBlockingMessage(block) {
  if (!block) return "";
  if (block.type === "duplicate") {
    return hasBlankOperationalContext(block.assignment)
      ? "This person already has an active matching assignment with the same blank context."
      : "This person already has an active matching assignment for the same context.";
  }
  return "This person already has an active assignment that may overlap this assignment's date range, shift pattern and work time profile.";
}

export function classifyAssignmentConflict(candidate, existingAssignments, lookups = {}) {
  if (!candidate || candidate.active !== true) return { status: "valid" };
  const activeCandidate = { ...candidate, active: true };
  const assignments = existingAssignments || [];
  const duplicate = assignments.find(existing => isClearDuplicateAssignment(activeCandidate, existing));
  if (duplicate) {
    return {
      status: "duplicate_block",
      type: "duplicate",
      reason: "duplicate_exact_context",
      assignment: duplicate
    };
  }
  const conflict = assignments.find(existing => isLikelyRotaConflictAssignment(activeCandidate, existing, lookups));
  if (conflict) {
    return {
      status: "likely_conflict_override_required",
      type: "conflict",
      reason: "overlap_same_employer_contract_pattern_profile",
      assignment: conflict
    };
  }
  return { status: "valid" };
}

export function findBlockingActiveAssignment(candidate, existingAssignments, lookups = {}) {
  const classification = classifyAssignmentConflict(candidate, existingAssignments, lookups);
  return classification.status === "valid" ? null : classification;
}
