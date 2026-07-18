import { supabaseClient } from "./api.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { selectPersonForAssignments } from "./assignments.js";
import {
  buildExpectedWorkGrid,
  openPersonMonthlyRotaPrint,
  openWorkforceCalendar
} from "./workforceCalendar.js";
import { openDocumentSignoffEvidenceById } from "./documentSignoffs.js";
import { openPrivacyCaseRecordById } from "./privacyGdprAdmin.js";
import {
  canViewLinkedIdentityContext,
  friendlyIdentitySourceType,
  renderLinkedIdentityContext
} from "./identityContext.js";
import { todayDate } from "./utils.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";

const PERSON_COLUMNS = [
  "id",
  "external_person_number",
  "first_name",
  "last_name",
  "preferred_name",
  "display_name",
  "email",
  "phone",
  "active",
  "notes",
  "created_at",
  "updated_at"
].join(", ");

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

const sections = [
  { id: "overview", label: "Overview", visible: () => true },
  { id: "assignments", label: "Assignments", visible: () => hasAssignmentAccess() },
  { id: "rota", label: "Rota", visible: () => hasRotaAccess() },
  { id: "visits", label: "Visits", visible: () => hasVisitorContextAccess() },
  { id: "documents", label: "Documents", visible: () => hasDocumentContextAccess() },
  { id: "identity", label: "Identity", visible: () => hasIdentityAccess() },
  { id: "privacy", label: "Privacy", visible: () => hasPrivacyAccess() }
];

const profileState = {
  open: false,
  activeSection: "overview",
  person: null,
  assignments: [],
  lookups: null,
  rotaRows: null,
  linkedContext: {
    visits: null,
    documents: null,
    privacy: null
  }
};

const DOCUMENT_EVIDENCE_SOURCE_TYPES = new Set([
  "document_evidence",
  "agreement_evidence",
  "document_signoff_evidence"
]);
const VISIT_EVIDENCE_SOURCE_TYPES = new Set(["visit_log", "visitor_history"]);
const PLANNED_VISIT_EVIDENCE_SOURCE_TYPES = new Set(["planned_visits", "planned_visit"]);
const PERSON_DOCUMENT_CONTEXT_SOURCE_TYPES = ["people", "person", "people_record", "person_record"];
const documentEvidenceSearchCache = new Map();

const VISIT_LOG_DETAIL_COLUMNS = [
  "id",
  "planned_visit_id",
  "visitor_name",
  "company",
  "visit_reason",
  "vehicle_plate",
  "onsite_contact",
  "security_pass_id",
  "privacy_notice_version",
  "privacy_notice_accepted_at",
  "sign_in_time",
  "sign_out_time",
  "visit_status",
  "visit_origin",
  "signed_out_automatically",
  "automatic_sign_out_reason"
].join(", ");

const PLANNED_VISIT_DETAIL_COLUMNS = [
  "id",
  "visitor_name",
  "company",
  "host_id",
  "visit_date",
  "expected_time",
  "visit_reason",
  "vehicle_plate",
  "onsite_contact",
  "security_pass_id",
  "notes",
  "status",
  "created_by",
  "modified_by",
  "modified_at"
].join(", ");

function hasPeopleAccess() {
  return hasAnyCapability(["people.view", "people.manage"]);
}

function hasAssignmentAccess() {
  return hasAnyCapability(["assignment.view", "assignment.manage"]);
}

function hasRotaAccess() {
  return hasAnyCapability(["workforce_calendar.view", "workforce_calendar.manage"]);
}

function hasVisitorContextAccess() {
  return hasAnyCapability(["visitor.view", "visitor.history.view", "visitor.edit", "visitor.export"]) &&
    canViewLinkedIdentityContext();
}

function hasDocumentContextAccess() {
  return hasAnyCapability([
    "agreements.view",
    "agreements.manage",
    "document_signoff.manage",
    "audit.view",
    "module_configuration.manage"
  ]);
}

function hasIdentityAccess() {
  return hasAnyCapability(["identity_resolution.view", "identity_resolution.manage"]);
}

function hasPrivacyAccess() {
  return hasAnyCapability([
    "privacy.case.view",
    "privacy.case.manage",
    "privacy.view",
    "privacy.manage",
    "gdpr.view",
    "gdpr.manage"
  ]);
}

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? textOrDash(value) : date.toLocaleString();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(String(value) + "T00:00:00");
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return date.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function nextSevenDays() {
  const start = new Date(todayDate() + "T00:00:00");
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  return Array.from({ length: 7 }, (_, index) => dateKey(addDays(safeStart, index)));
}

function dateDaysAgo(days) {
  return dateKey(addDays(new Date(todayDate() + "T00:00:00"), -days));
}

function statusText(person) {
  return person && person.active === false ? "Inactive" : "Active";
}

function summaryObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function normaliseSourceType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "person" || type === "people_record" || type === "person_record") return "people";
  if (type === "document_signoff_evidence") return "document_evidence";
  if (type === "agreement_signature" || type === "agreement_signatures") return "agreement_evidence";
  if (type === "visitor_history") return "visit_log";
  if (type === "planned_visit") return "planned_visits";
  return type;
}

function evidenceRecordId(record) {
  return record && (
    record.id ||
    record.agreement_id ||
    record.agreement_signature_id ||
    record.document_evidence_id ||
    record.evidence_id ||
    ""
  );
}

function evidenceRecordMatches(record, sourceRecordId) {
  const id = String(sourceRecordId || "").trim();
  if (!id || !record) return false;
  return [
    record.id,
    record.agreement_id,
    record.agreement_signature_id,
    record.document_evidence_id,
    record.evidence_id
  ].some(value => String(value || "").trim() === id);
}

function evidenceRecordMatchesPerson(record, personId) {
  const id = String(personId || "").trim();
  if (!id || !record) return false;
  if ([
    record.person_id,
    record.people_id,
    record.profile_id,
    record.employee_person_id,
    record.contractor_person_id
  ].some(value => String(value || "").trim() === id)) {
    return true;
  }

  const sourceType = normaliseSourceType(
    record.source_type ||
    record.evidence_source_type ||
    record.source_table ||
    record.linked_entity_type ||
    record.related_source_type
  );
  if (sourceType !== "people") return false;
  return [
    record.source_record_id,
    record.source_id,
    record.evidence_source_record_id,
    record.linked_entity_id,
    record.related_source_record_id
  ].some(value => String(value || "").trim() === id);
}

function ensureOverlay() {
  let overlay = document.getElementById("peopleProfileWorkspaceOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("section");
  overlay.id = "peopleProfileWorkspaceOverlay";
  overlay.className = "people-profile-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "peopleProfileWorkspaceTitle");
  overlay.tabIndex = -1;
  overlay.innerHTML =
    "<div class=\"people-profile-shell\">" +
      "<header class=\"people-profile-header\">" +
        "<div class=\"people-profile-title-block\">" +
          "<p class=\"oh-app-eyebrow\">People Profile Workspace</p>" +
          "<h2 id=\"peopleProfileWorkspaceTitle\">Person Profile</h2>" +
          "<div id=\"peopleProfileHeaderMeta\" class=\"people-profile-header-meta\"></div>" +
        "</div>" +
        "<div class=\"people-profile-header-actions\">" +
          "<button id=\"peopleProfileRefreshButton\" class=\"secondary\" type=\"button\">Refresh</button>" +
          "<button id=\"peopleProfileCloseButton\" class=\"ghost\" type=\"button\">Back to People</button>" +
        "</div>" +
      "</header>" +
      "<nav id=\"peopleProfileNav\" class=\"people-profile-nav\" aria-label=\"People profile sections\"></nav>" +
      "<main id=\"peopleProfileContent\" class=\"people-profile-content\" tabindex=\"-1\"></main>" +
    "</div>";
  document.body.appendChild(overlay);

  document.getElementById("peopleProfileCloseButton").addEventListener("click", closePeopleProfileWorkspace);
  document.getElementById("peopleProfileRefreshButton").addEventListener("click", () => {
    if (profileState.person) void refreshPeopleProfileWorkspace();
  });

  return overlay;
}

function ensureContextPanel() {
  let panel = document.getElementById("peopleProfileContextPanelBackdrop");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "peopleProfileContextPanelBackdrop";
  panel.className = "people-profile-context-backdrop hidden";
  panel.innerHTML =
    "<aside class=\"people-profile-context-panel\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"peopleProfileContextTitle\" tabindex=\"-1\">" +
      "<header class=\"people-profile-context-header\">" +
        "<div><p id=\"peopleProfileContextEyebrow\" class=\"oh-app-eyebrow\">Profile detail</p><h3 id=\"peopleProfileContextTitle\">Details</h3></div>" +
        "<button id=\"peopleProfileContextClose\" class=\"ghost\" type=\"button\">Back to Profile</button>" +
      "</header>" +
      "<div id=\"peopleProfileContextBody\" class=\"people-profile-context-body\"></div>" +
    "</aside>";
  document.body.appendChild(panel);
  document.getElementById("peopleProfileContextClose").addEventListener("click", closeProfileContextPanel);
  panel.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeProfileContextPanel();
  });
  return panel;
}

function closeProfileContextPanel() {
  const panel = document.getElementById("peopleProfileContextPanelBackdrop");
  if (panel) panel.classList.add("hidden");
  document.body.classList.remove("people-profile-context-open");
  const content = document.getElementById("peopleProfileContent");
  if (content) content.focus({ preventScroll: true });
}

function openProfileContextPanel(settings) {
  const options = settings || {};
  const panel = ensureContextPanel();
  const title = document.getElementById("peopleProfileContextTitle");
  const eyebrow = document.getElementById("peopleProfileContextEyebrow");
  const body = document.getElementById("peopleProfileContextBody");
  if (title) title.textContent = options.title || "Details";
  if (eyebrow) eyebrow.textContent = options.eyebrow || "Profile detail";
  if (body) {
    body.replaceChildren();
    if (options.content instanceof Node) body.appendChild(options.content);
  }
  panel.classList.remove("hidden");
  document.body.classList.add("people-profile-context-open");
  const panelBody = panel.querySelector(".people-profile-context-panel");
  if (panelBody) panelBody.focus({ preventScroll: true });
}

function detailList(fields) {
  const dl = document.createElement("dl");
  dl.className = "people-profile-context-list";
  (fields || []).filter(([, value]) => String(value == null ? "" : value).trim()).forEach(([label, value]) => {
    dl.appendChild(createDetailItem(label, value));
  });
  return dl;
}

function createMetaChip(text, tone) {
  const chip = document.createElement("span");
  chip.className = "people-profile-chip" + (tone ? " " + tone : "");
  chip.textContent = textOrDash(text);
  return chip;
}

function renderHeader() {
  const person = profileState.person || {};
  document.getElementById("peopleProfileWorkspaceTitle").textContent = person.display_name || "Person Profile";

  const meta = document.getElementById("peopleProfileHeaderMeta");
  meta.replaceChildren();
  if (person.external_person_number) meta.appendChild(createMetaChip(person.external_person_number));
  meta.appendChild(createMetaChip(statusText(person), person.active === false ? "inactive" : "active"));
  if (person.email) meta.appendChild(createMetaChip(person.email));
  if (person.phone) meta.appendChild(createMetaChip(person.phone));
}

function visibleSections() {
  return sections.filter(section => section.visible());
}

function renderNav() {
  const nav = document.getElementById("peopleProfileNav");
  nav.replaceChildren();
  const available = visibleSections();
  if (!available.some(section => section.id === profileState.activeSection)) {
    profileState.activeSection = "overview";
  }

  available.forEach(section => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "people-profile-nav-button";
    button.textContent = section.label;
    button.dataset.profileSection = section.id;
    button.classList.toggle("active", section.id === profileState.activeSection);
    button.setAttribute("aria-current", section.id === profileState.activeSection ? "page" : "false");
    button.addEventListener("click", () => {
      profileState.activeSection = section.id;
      void renderActiveSection();
    });
    nav.appendChild(button);
  });
}

function createDetailItem(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = textOrDash(value);
  item.append(term, detail);
  return item;
}

function createSummaryTile(label, value, detail) {
  const tile = document.createElement("article");
  tile.className = "people-profile-summary-tile";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = textOrDash(value);
  const detailNode = document.createElement("p");
  detailNode.textContent = detail || "";
  tile.append(labelNode, valueNode, detailNode);
  return tile;
}

function createWorkspaceEmpty(title, description) {
  const empty = document.createElement("div");
  empty.className = "people-profile-empty";
  renderEmptyState(empty, { title, description });
  return empty;
}

function assignmentCounts() {
  const active = profileState.assignments.filter(assignment => assignment.active === true).length;
  return {
    active,
    historical: profileState.assignments.length - active
  };
}

function renderOverview(content) {
  const person = profileState.person || {};
  const counts = assignmentCounts();
  const detailGrid = document.createElement("dl");
  detailGrid.className = "people-profile-detail-grid";
  [
    ["Display name", person.display_name],
    ["Preferred name", person.preferred_name],
    ["First name", person.first_name],
    ["Last name", person.last_name],
    ["External person number", person.external_person_number],
    ["Email", person.email],
    ["Phone", person.phone],
    ["Status", statusText(person)],
    ["Notes", person.notes],
    ["Created", formatDateTime(person.created_at)],
    ["Updated", formatDateTime(person.updated_at)]
  ].forEach(([label, value]) => detailGrid.appendChild(createDetailItem(label, value)));

  const summary = document.createElement("div");
  summary.className = "people-profile-summary-grid";
  summary.append(
    createSummaryTile("Active assignments", hasAssignmentAccess() ? counts.active : "-", hasAssignmentAccess() ? "Current work context." : "Assignments hidden by capability."),
    createSummaryTile("Historical assignments", hasAssignmentAccess() ? counts.historical : "-", hasAssignmentAccess() ? "Retained assignment history." : "Assignments hidden by capability."),
    createSummaryTile("Rota snapshot", hasRotaAccess() ? "Available" : "-", hasRotaAccess() ? "Open Rota for the next 7 days." : "Rota hidden by capability."),
    createSummaryTile("Identity links", canViewLinkedIdentityContext() ? "Checked in Identity" : "-", canViewLinkedIdentityContext() ? "Confirmed-link context only." : "Identity context hidden by capability.")
  );

  content.append(summary, detailGrid);
}

function lookupLabel(list, id, field) {
  if (!id) return "-";
  const record = (list || []).find(item => item.id === id);
  return record ? textOrDash(record[field]) : "Unknown";
}

function assignmentSubtitle(assignment) {
  const lookups = profileState.lookups || {};
  return [
    lookupLabel(lookups.sites, assignment.site_id, "site_name"),
    lookupLabel(lookups.departments, assignment.department_id, "department_name"),
    lookupLabel(lookups.roles, assignment.job_role_id, "role_name"),
    lookupLabel(lookups.contracts, assignment.contract_id, "contract_name")
  ].filter(value => value && value !== "-").join(" | ") || "No assignment context";
}

function workProfileLabel(assignment) {
  const profiles = profileState.lookups ? profileState.lookups.workTimeProfiles : [];
  const profile = (profiles || []).find(item => item.id === assignment.work_time_profile_id);
  if (!profile) return "No Work Time Profile";
  return profile.profile_name || profile.profile_code || "Work Time Profile";
}

function renderAssignments(content) {
  const counts = assignmentCounts();
  const summary = document.createElement("div");
  summary.className = "people-profile-summary-grid compact";
  summary.append(
    createSummaryTile("Active", counts.active, "Current records"),
    createSummaryTile("Historical", counts.historical, "Retained records")
  );

  const actions = document.createElement("div");
  actions.className = "people-profile-action-row";
  const manage = document.createElement("button");
  manage.type = "button";
  manage.textContent = "Manage Assignments";
  decorateCapabilityAction(manage, {
    actionId: "people.profile.assignments.manage",
    label: "Manage Assignments",
    area: "People Profile",
    requiredAny: ["assignment.view", "assignment.manage"],
    actionType: "manage"
  });
  manage.addEventListener("click", async () => {
    const person = profileState.person;
    closePeopleProfileWorkspace();
    await selectPersonForAssignments(
      person.id,
      person.display_name,
      person.external_person_number,
      {
        returnContext: {
          returnTo: "peopleProfile",
          personId: person.id,
          activeSection: "assignments"
        }
      }
    );
  });
  actions.appendChild(manage);

  const active = profileState.assignments.filter(assignment => assignment.active === true).slice(0, 5);
  const list = document.createElement("div");
  list.className = "people-profile-record-list";
  if (!active.length) {
    list.appendChild(createWorkspaceEmpty(
      "No active assignments",
      "No current assignment records are available for this person."
    ));
  } else {
    active.forEach(assignment => {
      const item = document.createElement("article");
      item.className = "people-profile-record";
      const heading = document.createElement("div");
      heading.className = "people-profile-record-heading";
      const title = document.createElement("strong");
      title.textContent = assignmentSubtitle(assignment);
      const badge = createMetaChip("Active", "active");
      heading.append(title, badge);
      const meta = document.createElement("p");
      meta.textContent = [
        workProfileLabel(assignment),
        "Start " + textOrDash(assignment.assignment_start_date),
        assignment.assignment_end_date ? "End " + assignment.assignment_end_date : "Open ended"
      ].join(" | ");
      item.append(heading, meta);
      list.appendChild(item);
    });
  }

  content.append(summary, actions, list);
}

function rotaCellLabel(cell) {
  if (cell.status === "working") {
    return String(cell.start_time || "").slice(0, 5) + "-" + String(cell.end_time || "").slice(0, 5);
  }
  return {
    off: "Off",
    no_assignment: "No assignment",
    no_profile: "No Work Time Profile",
    pattern_not_configured: "Needs rota pattern",
    assignment_inactive: "Assignment inactive"
  }[cell.status] || "Unknown";
}

async function ensureRotaData() {
  if (profileState.rotaRows) return;
  const dates = nextSevenDays();
  const [profilesResult, shiftPatternsResult] = await Promise.all([
    supabaseClient.rpc("list_work_time_profiles", {
      p_include_inactive: true,
      p_search_text: null
    }),
    supabaseClient
      .from("shift_patterns")
      .select("id, shift_name, pattern_type, static_weekdays, cycle_pattern, cycle_length_days, active")
      .order("shift_name", { ascending: true })
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (shiftPatternsResult.error) throw shiftPatternsResult.error;

  const lookups = {
    ...(profileState.lookups || {}),
    shiftPatterns: shiftPatternsResult.data || [],
    workTimeProfiles: profilesResult.data || []
  };
  const activeAssignments = profileState.person && profileState.person.active === false
    ? []
    : profileState.assignments.filter(assignment => assignment.active === true);
  profileState.lookups = lookups;
  profileState.rotaRows = buildExpectedWorkGrid(
    [profileState.person],
    activeAssignments,
    lookups.workTimeProfiles,
    dates,
    lookups
  );
}

async function renderRota(content) {
  const actions = document.createElement("div");
  actions.className = "people-profile-action-row";
  const printMonthly = document.createElement("button");
  printMonthly.type = "button";
  printMonthly.textContent = "Print Monthly Rota";
  decorateCapabilityAction(printMonthly, {
    actionId: "people.profile.rota.print_monthly",
    label: "Print Monthly Rota",
    area: "People Profile",
    requiredAny: ["workforce_calendar.view", "workforce_calendar.manage"],
    actionType: "print"
  });
  printMonthly.addEventListener("click", async () => {
    if (!profileState.person) return;
    profileState.activeSection = "rota";
    await openPersonMonthlyRotaPrint(profileState.person.id);
  });
  const openCalendar = document.createElement("button");
  openCalendar.type = "button";
  openCalendar.className = "secondary";
  openCalendar.textContent = "Open Workforce Calendar";
  decorateCapabilityAction(openCalendar, {
    actionId: "people.profile.rota.open_calendar",
    label: "Open Workforce Calendar",
    area: "People Profile",
    requiredAny: ["workforce_calendar.view", "workforce_calendar.manage"],
    actionType: "view"
  });
  openCalendar.addEventListener("click", async () => {
    closePeopleProfileWorkspace();
    await openWorkforceCalendar();
  });
  actions.append(printMonthly, openCalendar);

  const loading = createWorkspaceEmpty("Loading rota snapshot", "Checking expected-work context for the next 7 days.");
  content.append(actions, loading);

  try {
    await ensureRotaData();
  } catch (error) {
    showToast("Rota snapshot unavailable", error.message || "Could not load rota context.", "error");
    content.replaceChildren(actions, createWorkspaceEmpty(
      "Rota unavailable",
      "The rota snapshot could not be loaded under current permissions."
    ));
    return;
  }

  const dates = nextSevenDays();
  if (!profileState.rotaRows.length) {
    content.replaceChildren(actions, createWorkspaceEmpty(
      "No rota rows",
      "No active assignment covers the next 7 days for this person."
    ));
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "people-profile-rota-wrap";
  const table = document.createElement("table");
  table.className = "people-profile-rota-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  dates.forEach(date => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = formatDate(date);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  profileState.rotaRows.forEach(row => {
    const tr = document.createElement("tr");
    const assignment = document.createElement("th");
    assignment.scope = "row";
    assignment.textContent = assignmentSubtitle(row.assignment);
    tr.appendChild(assignment);
    row.cells.forEach(cell => {
      const td = document.createElement("td");
      td.className = "people-profile-rota-cell is-" + String(cell.status || "").replace(/_/g, "-");
      const strong = document.createElement("strong");
      strong.textContent = rotaCellLabel(cell);
      td.appendChild(strong);
      if (cell.status === "working" && cell.profile) {
        const detail = document.createElement("span");
        detail.textContent = cell.profile.profile_name || cell.profile.profile_code || "Work Time Profile";
        td.appendChild(detail);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  tableWrap.appendChild(table);
  content.replaceChildren(actions, tableWrap);
}

async function loadLinkedContext(contextKey, sourceTypes) {
  if (profileState.linkedContext[contextKey]) return profileState.linkedContext[contextKey];
  const result = await supabaseClient.rpc("list_active_identity_linked_source_records", {
    p_source_type: "people",
    p_source_record_id: profileState.person.id,
    p_source_type_filter: sourceTypes,
    p_include_requested_source: false
  });
  if (result.error) throw result.error;
  profileState.linkedContext[contextKey] = result.data || [];
  return profileState.linkedContext[contextKey];
}

async function searchDocumentEvidenceRows(days = 36500) {
  const key = String(days);
  if (documentEvidenceSearchCache.has(key)) return documentEvidenceSearchCache.get(key);
  const result = await supabaseClient.rpc("search_visitor_agreements", {
    p_date_from: dateDaysAgo(days),
    p_date_to: todayDate(),
    p_visitor_name: null,
    p_company: null,
    p_agreement_version_id: null,
    p_agreement_type_id: null
  });
  if (result.error) throw result.error;
  const rows = result.data || [];
  documentEvidenceSearchCache.set(key, rows);
  return rows;
}

function documentEvidenceMatchesLinkedSource(record, source) {
  const sourceType = normaliseSourceType(source && source.linked_source_type);
  const sourceRecordId = String(source && source.linked_source_record_id || "").trim();
  if (!sourceRecordId || !record) return false;
  if (DOCUMENT_EVIDENCE_SOURCE_TYPES.has(sourceType)) return evidenceRecordMatches(record, sourceRecordId);
  if (VISIT_EVIDENCE_SOURCE_TYPES.has(sourceType)) {
    return String(record.visit_log_id || record.visitor_log_id || "").trim() === sourceRecordId;
  }
  if (PLANNED_VISIT_EVIDENCE_SOURCE_TYPES.has(sourceType)) {
    return [
      record.planned_visit_id,
      record.planned_visits_id,
      record.visit_request_id
    ].some(value => String(value || "").trim() === sourceRecordId);
  }
  return false;
}

function summaryLooksLikeDocumentEvidence(summary) {
  const data = summaryObject(summary);
  return Boolean(
    data.document ||
    data.agreement_name ||
    data.agreement_title ||
    data.evidence_document_title ||
    data.agreement_version_number ||
    data.signed_at ||
    data.signed_by_name ||
    data.document_evidence_id ||
    data.agreement_id ||
    data.agreement_signature_id ||
    data.evidence_id
  );
}

function labelLooksLikeDocumentEvidence(label) {
  const text = String(label || "").trim().toLowerCase();
  if (!text) return false;
  // Fallback only: some legacy/manual identity records carry evidence context in the label.
  return text.includes("document evidence") ||
    text.includes("agreement evidence") ||
    text.includes("document sign-off evidence") ||
    text.includes("document signoff evidence");
}

function inferredDocumentSourceType(source) {
  const sourceType = normaliseSourceType(source && source.linked_source_type);
  if (DOCUMENT_EVIDENCE_SOURCE_TYPES.has(sourceType)) return sourceType;
  const summary = summaryObject(source && source.linked_source_summary);
  const label = source && source.linked_source_label;
  if (
    summary.document_evidence_id ||
    summary.evidence_document_title ||
    labelLooksLikeDocumentEvidence(label)
  ) {
    return "document_evidence";
  }
  if (
    summary.agreement_id ||
    summary.agreement_signature_id ||
    summary.agreement_name ||
    summary.agreement_title
  ) {
    return "agreement_evidence";
  }
  return "";
}

function identityLinkedRecordIsDocumentEvidence(source) {
  const sourceType = normaliseSourceType(source && source.linked_source_type);
  return DOCUMENT_EVIDENCE_SOURCE_TYPES.has(sourceType) ||
    summaryLooksLikeDocumentEvidence(source && source.linked_source_summary) ||
    labelLooksLikeDocumentEvidence(source && source.linked_source_label);
}

function evidenceTypeLabel(record) {
  if (!record) return "Evidence";
  if (record.has_signature || record.has_visitor_signature) return "Signature";
  if (record.accepted_without_signature) return "Tick acceptance";
  return "Evidence recorded";
}

function documentContextTitle(item) {
  const record = item.record || {};
  const source = item.source || {};
  const sourceSummary = summaryObject(source.linked_source_summary);
  return record.agreement_name ||
    record.agreement_title ||
    sourceSummary.document ||
    sourceSummary.agreement_name ||
    sourceSummary.agreement_title ||
    source.linked_source_label ||
    friendlyIdentitySourceType(source.linked_source_type) + " record";
}

function documentContextMetaLine(item) {
  const record = item.record || {};
  const source = item.source || {};
  const sourceSummary = summaryObject(source.linked_source_summary);
  const signedAt = record.signed_at || sourceSummary.signed_at || sourceSummary.visit_date || "";
  const version = record.agreement_version_number || sourceSummary.agreement_version_number || "";
  const signedBy = record.signed_by_name || sourceSummary.signed_by_name || sourceSummary.visitor_name || "";
  const company = record.company || sourceSummary.company || "";
  const canonical = source.canonical_label || source.link_reference || "";
  const context = item.sourceContextLabel || source.link_context_label || "";
  return [
    context,
    signedAt ? "Signed " + formatDateTime(signedAt) : "",
    version ? "Version " + version : "",
    signedBy ? "Signed as " + signedBy : "",
    company,
    canonical ? "Confirmed identity " + canonical : ""
  ].filter(Boolean).join(" | ") || "Confirmed identity-linked document context.";
}

function createDocumentContextItem(record, source) {
  const sourceType = inferredDocumentSourceType(source) || normaliseSourceType(source && source.linked_source_type);
  const evidenceId = evidenceRecordId(record);
  const summary = summaryObject(source && source.linked_source_summary);
  const directSourceId = [
    evidenceId,
    summary.document_evidence_id,
    summary.agreement_id,
    summary.agreement_signature_id,
    summary.evidence_id,
    source && source.linked_source_record_id
  ].find(value => String(value || "").trim()) || "";
  const isDirectPeopleEvidence = Boolean(source && source.direct_people_evidence);
  return {
    record: record || null,
    source: source || {},
    sourceType,
    sourceRecordId: evidenceId || directSourceId,
    sourceContextLabel: isDirectPeopleEvidence
      ? "Direct People link"
      : source && source.identity_link_id
        ? "Confirmed identity link"
        : "Linked source record",
    openSourceType: sourceType === "document_evidence" || sourceType === "agreement_evidence"
      ? sourceType
      : "agreement_evidence"
  };
}

function directPeopleEvidenceSource(record) {
  const person = profileState.person || {};
  return {
    direct_people_evidence: true,
    link_context_label: "Direct People link",
    canonical_label: person.display_name || person.external_person_number || "People record",
    linked_source_type: "agreement_evidence",
    linked_source_record_id: evidenceRecordId(record),
    linked_source_label: "Direct People link",
    linked_source_summary: {
      agreement_name: record.agreement_name || null,
      agreement_title: record.agreement_title || null,
      agreement_version_number: record.agreement_version_number || null,
      signed_at: record.signed_at || null,
      signed_by_name: record.signed_by_name || null,
      visitor_name: record.visitor_name || null,
      company: record.company || null
    },
    compliance_lookup_hint: "direct_people_evidence"
  };
}

async function buildPersonDocumentEvidenceSources(personId) {
  // Supported safe paths: confirmed links seeded as people/person aliases,
  // direct evidence source records from those links, and explicit person_id evidence rows.
  const results = await Promise.allSettled(PERSON_DOCUMENT_CONTEXT_SOURCE_TYPES.map(sourceType =>
    supabaseClient.rpc("list_document_compliance_identity_link_sources", {
      p_source_type: sourceType,
      p_source_record_id: personId
    })
  ));
  const sources = [];
  const errors = [];
  const seenSources = new Set();
  results.forEach(result => {
    if (result.status === "rejected") {
      errors.push(result.reason);
      return;
    }
    if (result.value.error) {
      errors.push(result.value.error);
      return;
    }
    (result.value.data || []).forEach(source => {
      const key = [
        source.identity_link_id || "",
        normaliseSourceType(source.linked_source_type),
        source.linked_source_record_id || ""
      ].join("::");
      if (seenSources.has(key)) return;
      seenSources.add(key);
      sources.push(source);
    });
  });
  if (!sources.length && errors.length === results.length) throw errors[0];
  return sources;
}

async function loadPersonConfirmedIdentityLinkedRecords(personId) {
  const results = await Promise.allSettled(PERSON_DOCUMENT_CONTEXT_SOURCE_TYPES.map(sourceType =>
    supabaseClient.rpc("list_identity_context_for_source_record", {
      p_source_type: sourceType,
      p_source_record_id: personId,
      p_include_revoked: false
    })
  ));
  const rows = [];
  const seen = new Set();
  results.forEach(result => {
    if (result.status === "rejected" || result.value.error) return;
    (result.value.data || []).forEach(row => {
      if (row.is_requested_source) return;
      const key = [
        row.link_record_id || "",
        row.identity_link_id || "",
        normaliseSourceType(row.linked_source_type),
        row.linked_source_record_id || ""
      ].join("::");
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    });
  });
  return rows;
}

async function loadDocumentContext() {
  if (profileState.linkedContext.documents) return profileState.linkedContext.documents;

  let sources = [];
  if (canViewLinkedIdentityContext()) {
    try {
      sources = await buildPersonDocumentEvidenceSources(profileState.person.id);
    } catch (error) {
      console.warn("Could not load People Profile document compliance link sources.", error);
    }
    try {
      const identityRows = await loadPersonConfirmedIdentityLinkedRecords(profileState.person.id);
      sources = sources.concat(
        identityRows
          .filter(identityLinkedRecordIsDocumentEvidence)
          .map(row => ({
            ...row,
            compliance_lookup_hint: "confirmed_identity_context"
          }))
      );
    } catch (error) {
      console.warn("Could not load People Profile identity-linked document records.", error);
    }
  }
  const items = [];
  const seen = new Set();
  let evidenceRows = [];
  try {
    evidenceRows = await searchDocumentEvidenceRows();
  } catch (error) {
    if (!sources.length) throw error;
    console.warn("Could not enrich People Profile document evidence rows.", error);
  }

  function addItem(record, source) {
    const item = createDocumentContextItem(record, source);
    const key = item.sourceRecordId
      ? "evidence::" + item.sourceRecordId
      : [
        source.identity_link_id || "source",
        normaliseSourceType(source.linked_source_type),
        source.linked_source_record_id || ""
      ].join("::");
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  evidenceRows
    .filter(record => evidenceRecordMatchesPerson(record, profileState.person.id))
    .forEach(record => addItem(record, directPeopleEvidenceSource(record)));

  sources.forEach(source => {
    const sourceType = normaliseSourceType(source.linked_source_type);
    const matches = evidenceRows.filter(record => documentEvidenceMatchesLinkedSource(record, source));
    matches.forEach(record => addItem(record, source));
    if (!matches.length && (DOCUMENT_EVIDENCE_SOURCE_TYPES.has(sourceType) || identityLinkedRecordIsDocumentEvidence(source))) {
      addItem(null, source);
    }
  });

  items.sort((a, b) => {
    const aDate = Date.parse((a.record && a.record.signed_at) || summaryObject(a.source.linked_source_summary).signed_at || "");
    const bDate = Date.parse((b.record && b.record.signed_at) || summaryObject(b.source.linked_source_summary).signed_at || "");
    return (Number.isNaN(bDate) ? 0 : bDate) - (Number.isNaN(aDate) ? 0 : aDate);
  });
  profileState.linkedContext.documents = items;
  return items;
}

function sourceSummaryLine(record) {
  const summary = summaryObject(record.linked_source_summary);
  const parts = [
    summary.visitor_name || summary.subject_name || summary.person_display_name || summary.display_name,
    summary.company || summary.subject_company,
    summary.visit_date || summary.sign_in_time || summary.signed_at || summary.request_received_date,
    summary.status || summary.visit_status || summary.case_type
  ];
  return parts.filter(Boolean).map(textOrDash).join(" | ");
}

function isPrivacyCaseSourceType(value) {
  const sourceType = normaliseSourceType(value);
  return sourceType === "privacy_cases" || sourceType === "privacy_case";
}

function firstNonBlank(values) {
  return (values || []).find(value => String(value || "").trim()) || "";
}

function privacyCaseIdFromLinkedRecord(record) {
  const summary = summaryObject(record && record.linked_source_summary);
  if (isPrivacyCaseSourceType(record && record.linked_source_type)) {
    return firstNonBlank([
      record && record.linked_source_record_id,
      record && record.source_record_id,
      record && record.privacy_case_id,
      record && record.case_id,
      summary.source_record_id,
      summary.linked_source_record_id,
      summary.privacy_case_id,
      summary.privacy_cases_id,
      summary.case_id,
      summary.case_record_id,
      summary.record_id,
      summary.id
    ]);
  }
  return firstNonBlank([
    summary.privacy_case_id,
    summary.privacy_cases_id,
    summary.case_id,
    summary.case_record_id,
    record && record.privacy_case_id,
    record && record.case_id
  ]);
}

function peopleProfilePrivacyCaseField(caseRecord, keys) {
  const source = caseRecord || {};
  for (const key of keys || []) {
    const value = source[key];
    if (String(value == null ? "" : value).trim()) return value;
  }
  return "";
}

async function loadPeopleProfilePrivacyCaseRecord(caseId) {
  const id = String(caseId || "").trim();
  if (!id) throw new Error("The case id was missing.");
  const result = await supabaseClient
    .from("privacy_cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (result.error) {
    console.error("People Profile privacy case query failed.", result.error);
    throw result.error;
  }
  return result.data || null;
}

function createPeopleProfilePrivacyCaseDetailContent(caseRecord, sourceRecord) {
  const sourceSummary = summaryObject(sourceRecord && sourceRecord.linked_source_summary);
  const container = document.createElement("div");
  container.className = "people-profile-context-stack";

  const reference = peopleProfilePrivacyCaseField(caseRecord, ["case_reference", "reference", "id"]);
  const intro = document.createElement("p");
  intro.className = "people-profile-context-summary";
  intro.textContent = reference
    ? "Privacy case " + reference + " opened from confirmed People Profile context."
    : "Privacy case details opened from confirmed People Profile context.";
  container.appendChild(intro);

  container.appendChild(detailList([
    ["Case reference", reference],
    ["Case type", peopleProfilePrivacyCaseField(caseRecord, ["case_type", "request_type", "type"])],
    ["Status", peopleProfilePrivacyCaseField(caseRecord, ["case_status", "status", "workflow_status"])],
    ["Subject", peopleProfilePrivacyCaseField(caseRecord, ["subject_name", "data_subject_name", "requester_name"])],
    ["Subject email", peopleProfilePrivacyCaseField(caseRecord, ["subject_email", "email", "requester_email"])],
    ["Received", peopleProfilePrivacyCaseField(caseRecord, ["received_at", "request_received_at", "request_received_date", "created_at"])],
    ["Due", peopleProfilePrivacyCaseField(caseRecord, ["due_at", "due_date"])],
    ["Closed", peopleProfilePrivacyCaseField(caseRecord, ["closed_at", "closed_date", "completed_at", "completed_date"])],
    ["Notes / reason", peopleProfilePrivacyCaseField(caseRecord, ["notes", "reason", "outcome_summary"])],
    ["Technical case id", caseRecord && caseRecord.id]
  ]));

  const sourceFields = detailList([
    ["Linked source label", sourceRecord && sourceRecord.linked_source_label],
    ["Linked context", sourceRecord && (sourceRecord.link_context_label || sourceRecord.canonical_label || sourceRecord.link_reference)],
    ["Summary case reference", sourceSummary.case_reference || sourceSummary.reference],
    ["Summary subject", sourceSummary.subject_summary || sourceSummary.subject_name || sourceSummary.person_display_name || sourceSummary.display_name],
    ["Summary status", sourceSummary.case_status || sourceSummary.status || sourceSummary.workflow_status],
    ["Summary received", sourceSummary.received_at || sourceSummary.request_received_at || sourceSummary.request_received_date || sourceSummary.created_at]
  ]);
  if (sourceFields.childElementCount) {
    const sourceIntro = document.createElement("p");
    sourceIntro.className = "people-profile-context-summary";
    sourceIntro.textContent = "Confirmed identity-linked source context.";
    container.append(sourceIntro, sourceFields);
  }

  const actions = document.createElement("div");
  actions.className = "people-profile-record-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "secondary";
  close.textContent = "Close";
  close.addEventListener("click", closeProfileContextPanel);
  actions.appendChild(close);
  const openModule = document.createElement("button");
  openModule.type = "button";
  openModule.className = "secondary";
  openModule.textContent = "Open Privacy Module";
  openModule.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void openPrivacyModuleFromProfileCaseId(caseRecord && caseRecord.id, event.currentTarget);
  });
  actions.appendChild(openModule);
  container.appendChild(actions);

  return container;
}

async function openPeopleProfilePrivacyCaseDetail(caseId, sourceRecord, trigger) {
  const id = String(caseId || "").trim();
  try {
    if (!id) {
      showToast("Privacy case could not be opened", "The case id was missing.", "error");
      return;
    }
    const loading = createWorkspaceEmpty("Loading privacy case", "Opening the privacy case detail from People Profile context.");
    openProfileContextPanel({
      eyebrow: "Privacy case",
      title: "Privacy Case Details",
      content: loading
    });
    const caseRecord = await loadPeopleProfilePrivacyCaseRecord(id);
    if (!caseRecord) {
      showToast(
        "Privacy case could not be opened",
        "Privacy case could not be found or you do not have permission to view it.",
        "error"
      );
      openProfileContextPanel({
        eyebrow: "Privacy case",
        title: "Privacy Case Details",
        content: createWorkspaceEmpty(
          "Privacy case unavailable",
          "Privacy case could not be found or you do not have permission to view it."
        )
      });
      return;
    }
    openProfileContextPanel({
      eyebrow: "Privacy case",
      title: peopleProfilePrivacyCaseField(caseRecord, ["case_reference", "reference"]) || "Privacy Case Details",
      content: createPeopleProfilePrivacyCaseDetailContent(caseRecord, sourceRecord)
    });
  } catch (error) {
    console.error("People Profile privacy case detail failed.", error);
    showToast(
      "Privacy case could not be displayed",
      error && error.message ? error.message : "The case detail could not be displayed.",
      "error"
    );
  }
}

async function openPrivacyModuleFromProfileCaseId(caseId, trigger) {
  const id = String(caseId || "").trim();
  if (!id) {
    showToast("Privacy case could not be opened", "The case id was missing.", "error");
    return;
  }
  if (typeof openPrivacyCaseRecordById !== "function") {
    showToast("Privacy case could not be opened", "The Privacy module opener is unavailable.", "error");
    return;
  }
  const personId = profileState.person && profileState.person.id;
  try {
    closeProfileContextPanel();
    closePeopleProfileWorkspace();
    await openPrivacyCaseRecordById(id, trigger, {
      returnContext: {
        returnTo: "peopleProfile",
        personId,
        activeSection: "privacy"
      }
    });
  } catch (error) {
    showToast(
      "Privacy case could not be opened",
      error && error.message ? error.message : "The Privacy module could not open this case.",
      "error"
    );
  }
}

function privacyCaseSummaryValue(record, keys) {
  const summary = summaryObject(record && record.linked_source_summary);
  for (const key of keys) {
    const value = summary[key] || record && record[key];
    if (String(value || "").trim()) return value;
  }
  return "";
}

function privacyCaseTitle(record) {
  return privacyCaseSummaryValue(record, [
    "case_reference",
    "reference",
    "case_number",
    "request_reference",
    "title"
  ]) || record.linked_source_label || "Privacy case";
}

function privacyCaseMetaLine(record) {
  return [
    privacyCaseSummaryValue(record, ["case_type", "request_type", "type"]),
    privacyCaseSummaryValue(record, ["status", "case_status", "workflow_status"]),
    privacyCaseSummaryValue(record, ["request_received_date", "received_at", "request_date", "created_at"]),
    privacyCaseSummaryValue(record, ["subject_summary", "subject_name", "person_display_name", "display_name"])
  ].filter(Boolean).map(textOrDash).join(" | ") || "Confirmed identity-linked privacy case.";
}

function renderPrivacyCaseRows(content, rows) {
  if (!rows.length) {
    content.appendChild(createWorkspaceEmpty(
      "No confirmed privacy cases",
      "No privacy/SAR case context is linked to this person by confirmed identity metadata."
    ));
    return;
  }

  const list = document.createElement("div");
  list.className = "people-profile-record-list";
  rows.slice(0, 8).forEach(record => {
    const caseId = privacyCaseIdFromLinkedRecord(record);
    const article = document.createElement("article");
    article.className = "people-profile-record";

    const heading = document.createElement("div");
    heading.className = "people-profile-record-heading";
    const title = document.createElement("strong");
    title.textContent = privacyCaseTitle(record);
    heading.append(
      title,
      createMetaChip(privacyCaseSummaryValue(record, ["case_type", "request_type", "type"]) || "Privacy case"),
      createMetaChip(privacyCaseSummaryValue(record, ["status", "case_status", "workflow_status"]) || "Linked")
    );

    const meta = document.createElement("p");
    meta.textContent = privacyCaseMetaLine(record);
    article.append(heading, meta);
    article.appendChild(detailList([
      ["Case reference", privacyCaseSummaryValue(record, ["case_reference", "reference", "case_number", "request_reference"])],
      ["Case type", privacyCaseSummaryValue(record, ["case_type", "request_type", "type"])],
      ["Status", privacyCaseSummaryValue(record, ["status", "case_status", "workflow_status"])],
      ["Received", privacyCaseSummaryValue(record, ["request_received_date", "received_at", "request_date", "created_at"])],
      ["Subject summary", privacyCaseSummaryValue(record, ["subject_summary", "subject_name", "person_display_name", "display_name"])],
      ["Linked context", record.link_context_label || record.linked_source_label || record.canonical_label || record.link_reference]
    ]));

    const actions = document.createElement("div");
    actions.className = "people-profile-record-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "people-profile-privacy-case-action";
    open.dataset.action = "open-people-profile-privacy-case";
    open.dataset.caseId = caseId;
    open.textContent = "View Case Details";
    decorateCapabilityAction(open, {
      actionId: "people.profile.privacy.view_case",
      label: "View Privacy Case Details",
      area: "People Profile",
      requiredAny: ["privacy.case.view", "privacy.case.manage", "privacy.view", "privacy.manage", "gdpr.view", "gdpr.manage"],
      actionType: "view"
    });
    open.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.currentTarget;
      const resolvedCaseId = privacyCaseIdFromLinkedRecord(record);
      button.dataset.caseId = resolvedCaseId;
      const originalText = button.textContent;
      button.textContent = "Opening...";
      button.disabled = true;
      try {
        await openPeopleProfilePrivacyCaseDetail(resolvedCaseId, record, button);
      } finally {
        button.textContent = originalText;
        button.disabled = false;
      }
    });
    actions.appendChild(open);

    const module = document.createElement("button");
    module.type = "button";
    module.className = "secondary";
    module.textContent = "Open Privacy Module";
    decorateCapabilityAction(module, {
      actionId: "people.profile.privacy.open_module",
      label: "Open Privacy Module",
      area: "People Profile",
      requiredAny: ["privacy.view", "privacy.manage", "privacy.case.view", "privacy.case.manage", "gdpr.view", "gdpr.manage"],
      actionType: "view"
    });
    module.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void openPrivacyModuleFromProfileCaseId(privacyCaseIdFromLinkedRecord(record), event.currentTarget);
    });
    actions.appendChild(module);

    article.appendChild(actions);
    list.appendChild(article);
  });
  content.appendChild(list);
}

function firstFieldValue(record, keys) {
  const source = record || {};
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) return value;
  }
  return "";
}

function visitRecordDate(record) {
  if (record.visit_date) return String(record.visit_date).slice(0, 10);
  if (record.sign_in_time) return String(record.sign_in_time).slice(0, 10);
  return "";
}

function visitRecordStatus(record) {
  if (record.sign_out_time) return "signed_out";
  if (record.sign_in_time) return record.visit_status || "signed_in";
  const status = record.visit_status || record.status || "";
  return status === "pending" ? "planned" : status;
}

function visitStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "signed_in") return "Signed In";
  if (value === "signed_out") return "Signed Out";
  if (value === "planned" || value === "pending") return "Planned";
  if (value === "no_show") return "No-show";
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function visitOriginLabel(record) {
  const origin = String(record.visit_origin || "").trim().toLowerCase();
  if (origin === "walk_in") return "Walk-in";
  if (origin === "planned") return "Planned";
  if (record.planned_visit_id || record.visit_date) return "Planned";
  if (record.sign_in_time) return "Walk-in";
  return "";
}

function formatVisitTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function formatDateTimeIfPresent(value) {
  return value ? formatDateTime(value) : "";
}

function visitContextTitle(linkedRecord, visitRecord) {
  return firstFieldValue(visitRecord, ["visitor_name", "subject_name", "display_name"]) ||
    linkedRecord.linked_source_label ||
    "Visit details";
}

function createVisitContextContent(linkedRecord, visitRecord, settings = {}) {
  const summary = summaryObject(linkedRecord.linked_source_summary);
  const data = { ...summary, ...(visitRecord || {}) };
  const loaded = settings.loaded === true;
  const container = document.createElement("div");
  container.className = "people-profile-context-stack";

  const intro = document.createElement("p");
  intro.className = "people-profile-context-summary";
  intro.textContent = loaded
    ? "Full visitor history details loaded from the confirmed identity-linked source record."
    : "Confirmed identity-linked source record. Full visitor history details could not be loaded, so the safe link summary is shown.";
  container.appendChild(intro);

  if (settings.warning) {
    const warning = document.createElement("p");
    warning.className = "people-profile-context-summary";
    warning.textContent = settings.warning;
    container.appendChild(warning);
  }

  container.appendChild(detailList([
    ["Visitor", firstFieldValue(data, ["visitor_name", "subject_name", "person_display_name", "display_name"])],
    ["Company", firstFieldValue(data, ["company", "subject_company"])],
    ["Host / onsite contact", firstFieldValue(data, ["onsite_contact", "host_name", "host_display_name", "host_id"])],
    ["Visit date", firstFieldValue(data, ["visit_date"]) || visitRecordDate(data)],
    ["Expected time", formatVisitTime(firstFieldValue(data, ["expected_time", "expected_arrival_time"]))],
    ["Sign-in time", formatDateTimeIfPresent(firstFieldValue(data, ["sign_in_time", "signed_in_at"]))],
    ["Sign-out time", formatDateTimeIfPresent(firstFieldValue(data, ["sign_out_time", "signed_out_at"]))],
    ["Current status", visitStatusLabel(visitRecordStatus(data)) || firstFieldValue(data, ["status", "visit_status"])],
    ["Origin", visitOriginLabel(data) || firstFieldValue(data, ["visit_origin", "origin"])],
    ["Reason / notes", firstFieldValue(data, ["visit_reason", "notes", "comments", "reason"])],
    ["Vehicle registration", firstFieldValue(data, ["vehicle_plate", "vehicle_registration", "vehicle_reg"])],
    ["Security pass ID", firstFieldValue(data, ["security_pass_id", "pass_id", "badge_number"])],
    ["Privacy notice accepted", data.privacy_notice_accepted_at
      ? formatDateTime(data.privacy_notice_accepted_at) + (data.privacy_notice_version ? " (" + data.privacy_notice_version + ")" : "")
      : ""],
    ["Automatic sign-out", data.signed_out_automatically
      ? "Yes" + (data.automatic_sign_out_reason ? " - " + data.automatic_sign_out_reason : "")
      : ""],
    ["Document / agreement", firstFieldValue(data, ["agreement_name", "agreement_title", "document", "evidence_document_title"])],
    ["Signed document at", formatDateTimeIfPresent(firstFieldValue(data, ["signed_at", "accepted_at"]))],
    ["Created by", firstFieldValue(data, ["created_by"])],
    ["Modified by", firstFieldValue(data, ["modified_by"])],
    ["Created", formatDateTimeIfPresent(firstFieldValue(data, ["created_at"]))],
    ["Updated", formatDateTimeIfPresent(firstFieldValue(data, ["modified_at", "updated_at"]))],
    ["Confirmed identity", linkedRecord.canonical_label || linkedRecord.link_reference]
  ]));

  container.appendChild(detailList([
    ["Source", friendlyIdentitySourceType(linkedRecord.linked_source_type)],
    ["Source label", linkedRecord.linked_source_label],
    ["Source record ID", linkedRecord.linked_source_record_id || data.id],
    ["Planned visit ID", firstFieldValue(data, ["planned_visit_id"])],
    ["History record type", firstFieldValue(data, ["history_record_type"])]
  ]));

  return container;
}

async function loadVisitRecordForContext(linkedRecord) {
  const sourceType = normaliseSourceType(linkedRecord.linked_source_type);
  const sourceRecordId = String(linkedRecord.linked_source_record_id || "").trim();
  if (!sourceRecordId) return null;

  if (sourceType === "visit_log") {
    const logResult = await supabaseClient
      .from("visit_log")
      .select(VISIT_LOG_DETAIL_COLUMNS)
      .eq("id", sourceRecordId)
      .maybeSingle();
    if (logResult.error) throw logResult.error;
    if (!logResult.data) return null;

    let record = {
      ...logResult.data,
      visit_date: visitRecordDate(logResult.data),
      history_record_type: "visit_log"
    };
    if (record.planned_visit_id) {
      const plannedResult = await supabaseClient
        .from("planned_visits")
        .select(PLANNED_VISIT_DETAIL_COLUMNS)
        .eq("id", record.planned_visit_id)
        .maybeSingle();
      if (!plannedResult.error && plannedResult.data) {
        record = {
          ...plannedResult.data,
          ...record,
          visit_date: plannedResult.data.visit_date || record.visit_date,
          expected_time: plannedResult.data.expected_time || record.expected_time,
          notes: plannedResult.data.notes || record.notes,
          history_record_type: "visit_log"
        };
      }
    }
    return record;
  }

  if (sourceType === "planned_visits") {
    const plannedResult = await supabaseClient
      .from("planned_visits")
      .select(PLANNED_VISIT_DETAIL_COLUMNS)
      .eq("id", sourceRecordId)
      .maybeSingle();
    if (plannedResult.error) throw plannedResult.error;
    return plannedResult.data
      ? {
        ...plannedResult.data,
        planned_visit_id: plannedResult.data.id,
        visit_origin: "planned",
        history_record_type: "planned_visit"
      }
      : null;
  }

  return null;
}

async function openVisitRecordInContext(record) {
  const sourceType = normaliseSourceType(record.linked_source_type);
  if (sourceType !== "visit_log" && sourceType !== "planned_visits") {
    openLinkedRecordInContext(record);
    return;
  }

  openProfileContextPanel({
    eyebrow: friendlyIdentitySourceType(record.linked_source_type),
    title: record.linked_source_label || "Visit details",
    content: createWorkspaceEmpty("Loading visit details", "Opening the confirmed visitor history source record.")
  });

  try {
    const visitRecord = await loadVisitRecordForContext(record);
    openProfileContextPanel({
      eyebrow: friendlyIdentitySourceType(record.linked_source_type),
      title: visitContextTitle(record, visitRecord || summaryObject(record.linked_source_summary)),
      content: createVisitContextContent(record, visitRecord, { loaded: Boolean(visitRecord) })
    });
    if (!visitRecord) {
      showToast("Visit details limited", "The linked visit source record could not be found under current permissions.", "error");
    }
  } catch (error) {
    showToast(
      "Visit details limited",
      error && error.message ? error.message : "The linked visit source record could not be loaded.",
      "error"
    );
    openProfileContextPanel({
      eyebrow: friendlyIdentitySourceType(record.linked_source_type),
      title: record.linked_source_label || "Visit details",
      content: createVisitContextContent(record, null, {
        loaded: false,
        warning: "The full source record could not be loaded under current permissions."
      })
    });
  }
}

function openLinkedRecordInContext(record) {
  const summary = summaryObject(record.linked_source_summary);
  const container = document.createElement("div");
  container.className = "people-profile-context-stack";
  const intro = document.createElement("p");
  intro.className = "people-profile-context-summary";
  intro.textContent = sourceSummaryLine(record) || "Confirmed identity-linked source record.";
  container.appendChild(intro);
  container.appendChild(detailList([
    ["Source", friendlyIdentitySourceType(record.linked_source_type)],
    ["Label", record.linked_source_label],
    ["Visitor / subject", summary.visitor_name || summary.subject_name || summary.display_name],
    ["Company", summary.company || summary.subject_company],
    ["Date", summary.visit_date || summary.sign_in_time || summary.signed_at || summary.request_received_date],
    ["Status", summary.status || summary.visit_status || summary.case_type],
    ["Confirmed identity", record.canonical_label || record.link_reference]
  ]));
  openProfileContextPanel({
    eyebrow: friendlyIdentitySourceType(record.linked_source_type),
    title: record.linked_source_label || "Linked source details",
    content: container
  });
}

function openLinkedRecordModule(record) {
  closePeopleProfileWorkspace();
  window.dispatchEvent(new CustomEvent("oh:linked-source-record-requested", {
    detail: {
      sourceType: record.linked_source_type,
      sourceRecordId: record.linked_source_record_id
    }
  }));
}

function moduleActionLabel(sourceType) {
  const type = normaliseSourceType(sourceType);
  if (type === "visit_log") return "Open Visitor History Module";
  if (type === "planned_visits") return "Open Planned Visits Module";
  if (type === "privacy_cases") return "Open Privacy Module";
  if (type === "document_evidence" || type === "agreement_evidence") return "Open Document Sign-off Module";
  return "Open Full Module";
}

function linkedRecordCapabilityMetadata(record, label, actionType = "view") {
  const type = normaliseSourceType(record && record.linked_source_type);
  if (type === "visit_log" || type === "planned_visits") {
    return {
      actionId: "people.profile.visits." + actionType,
      label,
      area: "People Profile",
      requiredAny: ["visitor.view", "visitor.history.view", "visitor.edit", "visitor.export"],
      actionType
    };
  }
  if (type === "document_evidence" || type === "agreement_evidence") {
    return {
      actionId: "people.profile.documents." + actionType,
      label,
      area: "People Profile",
      requiredAny: ["agreements.view", "agreements.manage", "document_signoff.manage", "audit.view", "module_configuration.manage"],
      actionType
    };
  }
  if (type === "privacy_cases") {
    return {
      actionId: "people.profile.privacy." + actionType,
      label,
      area: "People Profile",
      requiredAny: ["privacy.case.view", "privacy.case.manage", "privacy.view", "privacy.manage", "gdpr.view", "gdpr.manage"],
      actionType
    };
  }
  return {
    actionId: "people.profile.linked_record." + actionType,
    label,
    area: "People Profile",
    requiredAny: ["identity_resolution.view", "identity_resolution.manage"],
    actionType
  };
}

function renderLinkedRows(content, rows, emptyTitle, emptyDescription, options = {}) {
  if (!rows.length) {
    content.appendChild(createWorkspaceEmpty(emptyTitle, emptyDescription));
    return;
  }

  const list = document.createElement("div");
  list.className = "people-profile-record-list";
  rows.slice(0, 8).forEach(record => {
    const item = document.createElement("article");
    item.className = "people-profile-record";
    const heading = document.createElement("div");
    heading.className = "people-profile-record-heading";
    const title = document.createElement("strong");
    title.textContent = record.linked_source_label ||
      friendlyIdentitySourceType(record.linked_source_type) + " record";
    heading.append(title, createMetaChip(friendlyIdentitySourceType(record.linked_source_type)));
    const meta = document.createElement("p");
    meta.textContent = sourceSummaryLine(record) || "Confirmed identity-linked source record.";
    item.append(heading, meta);

    const actions = document.createElement("div");
    actions.className = "people-profile-record-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = options.primaryLabel || "View Details";
    decorateCapabilityAction(open, linkedRecordCapabilityMetadata(record, open.textContent, "view"));
    if (typeof options.decoratePrimaryButton === "function") {
      options.decoratePrimaryButton(open, record);
    }
    open.addEventListener("click", event => {
      if (options.primaryActionStopsPropagation) event.stopPropagation();
      if (typeof options.primaryAction === "function") {
        options.primaryAction(record, event.currentTarget);
      } else {
        openLinkedRecordInContext(record);
      }
    });
    actions.appendChild(open);
    if (options.showModuleAction !== false) {
      const module = document.createElement("button");
      module.type = "button";
      module.className = "secondary";
      module.textContent = options.moduleLabel || moduleActionLabel(record.linked_source_type);
      decorateCapabilityAction(module, linkedRecordCapabilityMetadata(record, module.textContent, "module"));
      module.addEventListener("click", () => openLinkedRecordModule(record));
      actions.appendChild(module);
    }
    item.appendChild(actions);
    list.appendChild(item);
  });
  content.appendChild(list);
}

async function renderLinkedSection(content, contextKey, sourceTypes, emptyTitle, emptyDescription, options = {}) {
  if (!canViewLinkedIdentityContext()) {
    content.appendChild(createWorkspaceEmpty(
      "Confirmed identity context unavailable",
      "This section only uses confirmed identity links and is hidden by current identity permissions."
    ));
    return;
  }

  const loading = createWorkspaceEmpty("Loading confirmed links", "Checking reviewed identity-link context.");
  content.appendChild(loading);
  try {
    const rows = await loadLinkedContext(contextKey, sourceTypes);
    content.replaceChildren();
    renderLinkedRows(content, rows, emptyTitle, emptyDescription, options);
  } catch (error) {
    showToast("Linked context unavailable", error.message || "Could not load confirmed identity links.", "error");
    content.replaceChildren(createWorkspaceEmpty(
      "Linked context unavailable",
      "Confirmed identity context could not be loaded under current permissions."
    ));
  }
}

async function renderDocuments(content) {
  const loading = createWorkspaceEmpty("Loading document evidence", "Checking safe linked document context.");
  content.appendChild(loading);
  try {
    const rows = await loadDocumentContext();
    content.replaceChildren();
    if (!rows.length) {
      content.appendChild(createWorkspaceEmpty(
        "No linked document evidence found for this person",
        "No safe confirmed document or sign-off evidence links are available."
      ));
      return;
    }

    const list = document.createElement("div");
    list.className = "people-profile-record-list";
    rows.slice(0, 8).forEach(item => {
      const record = item.record || {};
      const source = item.source || {};
      const article = document.createElement("article");
      article.className = "people-profile-record";

      const heading = document.createElement("div");
      heading.className = "people-profile-record-heading";
      const title = document.createElement("strong");
      title.textContent = documentContextTitle(item);
      heading.append(
        title,
        createMetaChip(evidenceTypeLabel(record)),
        createMetaChip(friendlyIdentitySourceType(source.linked_source_type))
      );

      const meta = document.createElement("p");
      meta.textContent = documentContextMetaLine(item);
      article.append(heading, meta);

      if (item.sourceRecordId) {
        const actions = document.createElement("div");
        actions.className = "people-profile-record-actions";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Open Evidence";
        decorateCapabilityAction(open, {
          actionId: "people.profile.documents.open_evidence",
          label: "Open Document Evidence",
          area: "People Profile",
          requiredAny: ["agreements.view", "agreements.manage", "document_signoff.manage", "audit.view", "module_configuration.manage"],
          actionType: "view"
        });
        open.addEventListener("click", event => {
          void openDocumentEvidenceInContext(item, event.currentTarget);
        });
        actions.appendChild(open);
        const module = document.createElement("button");
        module.type = "button";
        module.className = "secondary";
        module.textContent = "Open Document Sign-off Module";
        decorateCapabilityAction(module, {
          actionId: "people.profile.documents.open_module",
          label: "Open Document Sign-off Module",
          area: "People Profile",
          requiredAny: ["agreements.view", "agreements.manage", "document_signoff.manage", "audit.view", "module_configuration.manage"],
          actionType: "view"
        });
        module.addEventListener("click", () => {
          closePeopleProfileWorkspace();
          window.dispatchEvent(new CustomEvent("oh:linked-source-record-requested", {
            detail: {
              sourceType: item.openSourceType,
              sourceRecordId: item.sourceRecordId
            }
          }));
        });
        actions.appendChild(module);
        article.appendChild(actions);
      }

      list.appendChild(article);
    });
    content.appendChild(list);
  } catch (error) {
    showToast("Document evidence unavailable", error.message || "Could not load linked document evidence.", "error");
    content.replaceChildren(createWorkspaceEmpty(
      "Document evidence unavailable",
      "Linked document evidence could not be loaded under current permissions."
    ));
  }
}

async function openDocumentEvidenceInContext(item, trigger) {
  if (!item || !item.sourceRecordId) return;
  try {
    await openDocumentSignoffEvidenceById(item.sourceRecordId, trigger);
  } catch (error) {
    showToast("Evidence unavailable", error.message || "Could not open document evidence.", "error");
  }
}

function renderIdentity(content) {
  const host = document.createElement("div");
  host.className = "people-profile-identity-host";
  content.appendChild(host);
  renderLinkedIdentityContext(host, {
    sourceType: "people",
    sourceRecordId: profileState.person.id,
    sourceLabel: profileState.person.display_name,
    sourceSummary: {
      display_name: profileState.person.display_name,
      external_person_number: profileState.person.external_person_number,
      email: profileState.person.email,
      phone: profileState.person.phone,
      status: statusText(profileState.person)
    },
    showEmpty: true
  });
}

async function renderPrivacy(content) {
  if (!canViewLinkedIdentityContext()) {
    content.appendChild(createWorkspaceEmpty(
      "Confirmed identity context unavailable",
      "This section only uses confirmed identity links and is hidden by current identity permissions."
    ));
    return;
  }

  const loading = createWorkspaceEmpty("Loading privacy cases", "Checking reviewed identity-linked privacy case context.");
  content.appendChild(loading);
  try {
    const rows = await loadLinkedContext("privacy", ["privacy_cases", "privacy_case"]);
    content.replaceChildren();
    renderPrivacyCaseRows(content, rows);
  } catch (error) {
    showToast("Privacy cases unavailable", error.message || "Could not load confirmed privacy case links.", "error");
    content.replaceChildren(createWorkspaceEmpty(
      "Privacy cases unavailable",
      "Confirmed privacy case context could not be loaded under current permissions."
    ));
  }
}

async function renderActiveSection() {
  renderNav();
  const content = document.getElementById("peopleProfileContent");
  content.replaceChildren();
  content.className = "people-profile-content is-" + profileState.activeSection;

  if (profileState.activeSection === "overview") renderOverview(content);
  else if (profileState.activeSection === "assignments") renderAssignments(content);
  else if (profileState.activeSection === "rota") await renderRota(content);
  else if (profileState.activeSection === "visits") {
    await renderLinkedSection(
      content,
      "visits",
      ["visit_log", "visitor_history", "planned_visits", "planned_visit"],
      "No confirmed visits",
      "No visitor records are linked to this person by confirmed identity metadata.",
      {
        primaryLabel: "View Details",
        primaryAction(record) {
          void openVisitRecordInContext(record);
        }
      }
    );
  } else if (profileState.activeSection === "documents") {
    await renderDocuments(content);
  } else if (profileState.activeSection === "identity") {
    renderIdentity(content);
  } else if (profileState.activeSection === "privacy") {
    await renderPrivacy(content);
  }
}

async function loadPerson(personId, fallbackPerson) {
  const result = await supabaseClient
    .from("people")
    .select(PERSON_COLUMNS)
    .eq("id", personId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || fallbackPerson;
}

async function loadAssignmentLookups() {
  const [
    sitesResult,
    departmentsResult,
    rolesResult,
    contractsResult,
    employersResult,
    profilesResult
  ] = await Promise.all([
    supabaseClient.from("sites").select("id, site_name, active").order("site_name", { ascending: true }),
    supabaseClient.from("departments").select("id, department_name, active").order("department_name", { ascending: true }),
    supabaseClient.from("job_roles").select("id, role_name, active").order("role_name", { ascending: true }),
    supabaseClient.from("contracts").select("id, contract_name, active").order("contract_name", { ascending: true }),
    supabaseClient.from("organisations").select("id, organisation_name, active").order("organisation_name", { ascending: true }),
    supabaseClient.rpc("list_work_time_profiles", {
      p_include_inactive: true,
      p_search_text: null
    })
  ]);
  [sitesResult, departmentsResult, rolesResult, contractsResult, employersResult, profilesResult].forEach(result => {
    if (result.error) throw result.error;
  });
  profileState.lookups = {
    sites: sitesResult.data || [],
    departments: departmentsResult.data || [],
    roles: rolesResult.data || [],
    contracts: contractsResult.data || [],
    employers: employersResult.data || [],
    workTimeProfiles: profilesResult.data || [],
    shiftPatterns: []
  };
}

async function loadAssignmentsForProfile() {
  if (!hasAssignmentAccess() && !hasRotaAccess()) {
    profileState.assignments = [];
    return;
  }
  await loadAssignmentLookups();
  const result = await supabaseClient
    .from("work_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("person_id", profileState.person.id)
    .order("assignment_start_date", { ascending: false });
  if (result.error) throw result.error;
  profileState.assignments = result.data || [];
}

async function loadProfile(personId, fallbackPerson) {
  profileState.person = await loadPerson(personId, fallbackPerson);
  profileState.assignments = [];
  profileState.lookups = null;
  profileState.rotaRows = null;
  profileState.linkedContext = { visits: null, documents: null, privacy: null };
  await loadAssignmentsForProfile();
}

export async function openPeopleProfileWorkspace(personId, fallbackPerson, options = {}) {
  const settings = options || {};
  if (!hasPeopleAccess()) {
    showToast("You do not have permission", "People Profile requires people.view.", "error");
    return;
  }
  if (!personId) {
    showToast("Person unavailable", "Select a person before opening the profile workspace.", "error");
    return;
  }

  const overlay = ensureOverlay();
  profileState.open = true;
  profileState.activeSection = settings.activeSection || settings.section || "overview";
  overlay.classList.remove("hidden");
  document.body.classList.add("people-profile-workspace-open");
  document.getElementById("peopleProfileContent").replaceChildren(
    createWorkspaceEmpty("Loading profile", "Preparing this person's operational context.")
  );
  overlay.focus({ preventScroll: true });

  try {
    await loadProfile(personId, fallbackPerson);
    renderHeader();
    renderNav();
    await renderActiveSection();
  } catch (error) {
    showToast("Profile unavailable", error.message || "Could not load this People profile.", "error");
    closePeopleProfileWorkspace();
  }
}

async function refreshPeopleProfileWorkspace() {
  if (!profileState.person) return;
  const personId = profileState.person.id;
  try {
    await loadProfile(personId, profileState.person);
    renderHeader();
    renderNav();
    await renderActiveSection();
    showToast("Profile refreshed", "The profile workspace was refreshed.", "success");
  } catch (error) {
    showToast("Refresh failed", error.message || "Could not refresh this profile.", "error");
  }
}

export function closePeopleProfileWorkspace() {
  const overlay = document.getElementById("peopleProfileWorkspaceOverlay");
  if (overlay) overlay.classList.add("hidden");
  document.body.classList.remove("people-profile-workspace-open");
  profileState.open = false;
}

document.addEventListener("keydown", event => {
  const contextPanel = document.getElementById("peopleProfileContextPanelBackdrop");
  if (
    event.key === "Escape" &&
    contextPanel &&
    !contextPanel.classList.contains("hidden")
  ) {
    event.preventDefault();
    closeProfileContextPanel();
    return;
  }
  if (event.key !== "Escape" || !profileState.open) return;
  const modal = document.querySelector(".modal-backdrop.active, .visitors-panel-backdrop:not(.hidden)");
  if (modal) return;
  event.preventDefault();
  closePeopleProfileWorkspace();
});

window.addEventListener("oh:people-profile-return-requested", event => {
  const detail = event.detail || {};
  if (!detail.personId) return;
  void openPeopleProfileWorkspace(detail.personId, null, {
    activeSection: detail.activeSection || "overview"
  });
});
