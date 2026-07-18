import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { renderEmptyState } from "./platformUi.js";
import { showAdministrationWorkspace } from "./shell.js";
import { auditDiffSummary, buildFieldDiff, writeAuditEvent } from "./audit.js";
import { downloadCsv, downloadXlsx } from "./exports.js";
import { showReferenceDataAdministrationSection } from "./accessControl.js";
import { hasAnyCapability } from "./capabilities.js";
import {
  refreshSectionNavigator,
  registerModuleSections,
  selectModuleSection
} from "./sectionNavigation.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";
import {
  normaliseBusinessCode,
  titleCaseText,
  exportDateStamp
} from "./utils.js";

const commonRecordColumns = ["id", "active", "notes", "created_at", "updated_at"];

const entityDefinitions = {
  sites: {
    table: "sites",
    singular: "Site",
    plural: "Sites",
    orderBy: "site_name",
    fields: [
      { key: "site_code", label: "Site Code", normalise: "code", placeholder: "SITE-01", help: "Business code; saved in uppercase." },
      { key: "site_name", label: "Site Name", required: true, normalise: "title" },
      {
        key: "timezone",
        label: "Timezone",
        required: true,
        defaultValue: "Europe/London",
        placeholder: "Europe/London",
        help: "Use an IANA timezone, for example Europe/London."
      },
      { key: "address_line_1", label: "Address Line 1" },
      { key: "address_line_2", label: "Address Line 2" },
      { key: "town_city", label: "Town / City" },
      { key: "county_region", label: "County / Region" },
      { key: "postcode", label: "Postcode" },
      {
        key: "country",
        label: "Country",
        defaultValue: "United Kingdom",
        placeholder: "United Kingdom",
        help: "For example United Kingdom."
      },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "site_code", label: "Code" },
      { key: "site_name", label: "Site" },
      { key: "timezone", label: "Timezone" },
      { key: "town_city", label: "Town / City" }
    ]
  },
  departments: {
    table: "departments",
    singular: "Department",
    plural: "Departments",
    orderBy: "department_name",
    fields: [
      { key: "site_id", label: "Site", type: "lookup", lookup: "sites" },
      { key: "department_code", label: "Department Code", normalise: "code", placeholder: "OPERATIONS", help: "Business code; saved in uppercase." },
      { key: "department_name", label: "Department Name", required: true, normalise: "title" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "department_code", label: "Code" },
      { key: "department_name", label: "Department" },
      { key: "site_id", label: "Site", lookup: "sites" }
    ]
  },
  contracts: {
    table: "contracts",
    singular: "Contract",
    plural: "Contracts",
    orderBy: "contract_name",
    fields: [
      { key: "site_id", label: "Site", type: "lookup", lookup: "sites" },
      { key: "customer_organisation_id", label: "Customer Organisation", type: "lookup", lookup: "organisations" },
      { key: "contract_code", label: "Contract Code", normalise: "code", placeholder: "CONTRACT-01", help: "Business code; saved in uppercase." },
      { key: "contract_name", label: "Contract Name", required: true },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "contract_code", label: "Code" },
      { key: "contract_name", label: "Contract" },
      { key: "site_id", label: "Site", lookup: "sites" },
      { key: "customer_organisation_id", label: "Customer", lookup: "organisations" }
    ]
  },
  jobRoles: {
    table: "job_roles",
    singular: "Job Role",
    plural: "Job Roles",
    orderBy: "role_name",
    fields: [
      { key: "role_code", label: "Role Code", normalise: "code", placeholder: "SUPERVISOR", help: "Business code; saved in uppercase." },
      { key: "role_name", label: "Role Name", required: true, normalise: "title" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "role_code", label: "Code" },
      { key: "role_name", label: "Job Role" }
    ]
  },
  shiftPatterns: {
    table: "shift_patterns",
    singular: "Shift Pattern",
    plural: "Shift Patterns",
    orderBy: "shift_name",
    fields: [
      { key: "shift_code", label: "Shift Code", normalise: "code", placeholder: "DAY-SHIFT", help: "Business code; saved in uppercase." },
      { key: "shift_name", label: "Shift Name", required: true, normalise: "title" },
      {
        key: "pattern_type",
        label: "Pattern Type",
        type: "select",
        required: true,
        defaultValue: "static",
        options: [
          { value: "static", label: "Static" },
          { value: "rotating", label: "Rotating" },
          { value: "ad_hoc", label: "Ad Hoc" }
        ]
      },
      {
        key: "static_weekdays",
        label: "Static Weekdays (JSON)",
        type: "json",
        placeholder: "[\"Monday\", \"Tuesday\", \"Wednesday\", \"Thursday\", \"Friday\"]",
        help: "Example: [\"Monday\", \"Tuesday\", \"Wednesday\", \"Thursday\", \"Friday\"]"
      },
      {
        key: "cycle_pattern",
        label: "Rotating Cycle (JSON)",
        type: "json",
        placeholder: "[{\"day\":1,\"shift\":\"day\"},{\"day\":2,\"shift\":\"night\"},{\"day\":3,\"shift\":\"off\"}]",
        help: "Use a JSON array of cycle days. Cycle length is calculated from the number of array items."
      },
      {
        key: "cycle_length_days",
        label: "Cycle Length Days (Derived)",
        type: "number",
        min: 1,
        readOnly: true,
        help: "Calculated automatically from a cycle array, or a JSON object containing a days or cycle array."
      },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "shift_code", label: "Code" },
      { key: "shift_name", label: "Shift Pattern" },
      { key: "pattern_type", label: "Type", format: "title" },
      { key: "cycle_length_days", label: "Cycle Days" }
    ]
  },
  breakRules: {
    table: "break_rules",
    customType: "breakRules",
    singular: "Break Rule",
    plural: "Break Rules",
    orderBy: "rule_name",
    viewCapabilities: [
      "break_rules.view",
      "break_rules.manage",
      "reference_data.view",
      "reference_data.manage",
      "work_time_profiles.view",
      "work_time_profiles.manage",
      "settings.view"
    ],
    editCapabilities: [
      "break_rules.manage",
      "reference_data.manage",
      "work_time_profiles.manage",
      "settings.edit"
    ],
    fields: [
      { key: "rule_name", label: "Rule Name", required: true, normalise: "title" },
      { key: "rule_code", label: "Rule Code", normalise: "code", placeholder: "STANDARD-BREAK", help: "Business code; saved in uppercase." },
      { key: "paid_break_minutes", label: "Paid Break Minutes", type: "number", required: true, min: 0, max: 1440, defaultValue: 0 },
      { key: "unpaid_break_minutes", label: "Unpaid Break Minutes", type: "number", required: true, min: 0, max: 1440, defaultValue: 0 },
      { key: "total_break_minutes", label: "Total Break Minutes", type: "number", min: 0, readOnly: true, defaultValue: 0 },
      { key: "display_order", label: "Display Order", type: "number", min: 0, defaultValue: 0 },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "rule_code", label: "Code" },
      { key: "rule_name", label: "Break Rule" },
      { key: "paid_break_minutes", label: "Paid" },
      { key: "unpaid_break_minutes", label: "Unpaid" },
      { key: "total_break_minutes", label: "Total" },
      { key: "display_order", label: "Order" },
      { key: "notes", label: "Notes" }
    ]
  },
  unsociableTimeRules: {
    table: "unsociable_time_rules",
    customType: "unsociableTimeRules",
    singular: "Unsociable Time Rule",
    plural: "Unsociable Time Rules",
    orderBy: "rule_name",
    viewCapabilities: [
      "unsociable_time_rules.view",
      "unsociable_time_rules.manage",
      "work_time_profiles.view",
      "work_time_profiles.manage",
      "settings.view"
    ],
    editCapabilities: [
      "unsociable_time_rules.manage",
      "work_time_profiles.manage",
      "settings.edit"
    ],
    fields: [
      { key: "rule_name", label: "Rule Name", required: true, normalise: "title" },
      { key: "rule_code", label: "Rule Code", normalise: "code", placeholder: "NIGHT-PREMIUM", help: "Business code; saved in uppercase." },
      { key: "start_time", label: "Start Time", type: "time", required: true, defaultValue: "00:00" },
      { key: "end_time", label: "End Time", type: "time", required: true, defaultValue: "00:00" },
      {
        key: "crosses_midnight",
        label: "Crosses Midnight",
        type: "select",
        defaultValue: "false",
        boolean: true,
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes - overnight" }
        ]
      },
      {
        key: "full_day",
        label: "Full Day",
        type: "select",
        defaultValue: "false",
        boolean: true,
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes" }
        ],
        help: "Use Full day for whole-day premiums such as Sunday or weekend rules.",
        sectionTitle: "Active days",
        sectionHelp: "Configure company-specific unsociable time bands. Rules can overlap; a minute is counted once when any active rule applies."
      },
      {
        key: "day_application_mode",
        label: "Day Application Mode",
        type: "select",
        required: true,
        defaultValue: "shift_start_day",
        options: [
          { value: "shift_start_day", label: "Shift start day" },
          { value: "calendar_minutes", label: "Calendar minutes" }
        ],
        help: "Shift start day applies the rule based on the day the shift begins. Calendar minutes applies the rule to each actual clock/calendar minute. For whole-day premiums such as Sunday/weekend, Shift start day is usually easiest when the whole shift should follow the start day. For strict calendar-time policies, use Calendar minutes."
      },
      { key: "applies_monday", label: "Applies Monday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_tuesday", label: "Applies Tuesday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_wednesday", label: "Applies Wednesday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_thursday", label: "Applies Thursday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_friday", label: "Applies Friday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_saturday", label: "Applies Saturday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "applies_sunday", label: "Applies Sunday", type: "select", defaultValue: "true", boolean: true, options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "display_order", label: "Display Order", type: "number", min: 0, defaultValue: 0 },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "rule_code", label: "Code" },
      { key: "rule_name", label: "Rule" },
      { key: "time_band", label: "Time", format: "unsociableTimeBand" },
      { key: "active_days", label: "Days", format: "unsociableDays" },
      { key: "day_application_mode", label: "Mode", format: "unsociableDayApplicationMode" },
      { key: "display_order", label: "Order" },
      { key: "notes", label: "Notes" }
    ]
  },
  unsociableRuleSets: {
    table: "unsociable_time_rule_sets",
    customType: "unsociableRuleSets",
    singular: "Unsociable Rule Set",
    plural: "Unsociable Rule Sets",
    orderBy: "rule_set_name",
    viewCapabilities: [
      "unsociable_time_rules.view",
      "unsociable_time_rules.manage",
      "work_time_profiles.view",
      "work_time_profiles.manage",
      "settings.view"
    ],
    editCapabilities: [
      "unsociable_time_rules.manage",
      "work_time_profiles.manage",
      "settings.edit"
    ],
    fields: [
      { key: "rule_set_name", label: "Rule Set Name", required: true, normalise: "title" },
      { key: "rule_set_code", label: "Rule Set Code", normalise: "code", placeholder: "STANDARD-WAREHOUSE-PREMIUM", help: "Business code; saved in uppercase." },
      { key: "display_order", label: "Display Order", type: "number", min: 0, defaultValue: 0 },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "rule_set_code", label: "Code" },
      { key: "rule_set_name", label: "Rule Set" },
      { key: "rule_count", label: "Rules" },
      { key: "rule_summary", label: "Summary", format: "compactSummary" },
      { key: "display_order", label: "Order" },
      { key: "notes", label: "Notes", format: "compactSummary" }
    ]
  },
  workTimeProfiles: {
    table: "work_time_profiles",
    customType: "workTimeProfiles",
    singular: "Work Time Profile",
    plural: "Work Time Profiles",
    orderBy: "profile_name",
    viewCapabilities: [
      "work_time_profiles.view",
      "work_time_profiles.manage",
      "reference_data.view",
      "reference_data.manage",
      "people.view",
      "people.manage",
      "module_configuration.manage",
      "settings.view"
    ],
    editCapabilities: [
      "work_time_profiles.manage",
      "reference_data.manage",
      "people.manage",
      "module_configuration.manage",
      "settings.edit"
    ],
    fields: [
      { key: "profile_name", label: "Profile Name", required: true, normalise: "title" },
      { key: "profile_code", label: "Profile Code", normalise: "code", placeholder: "DAY-0600-1430", help: "Auto-suggested from the name; saved in uppercase." },
      { key: "start_time", label: "Start Time", type: "time", required: true },
      { key: "end_time", label: "End Time", type: "time", required: true },
      {
        key: "crosses_midnight",
        label: "Crosses Midnight",
        type: "select",
        defaultValue: "false",
        boolean: true,
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes - overnight" }
        ]
      },
      {
        key: "break_rule_id",
        label: "Break Rule",
        type: "lookup",
        lookup: "workTimeProfileBreakRules",
        sectionTitle: "Break alignment",
        sectionHelp: "Break Rules define the normal break duration and paid/unpaid behaviour. Final paid hours can remain manual or follow the calculated suggestion.",
        help: "Select a standard Break Rule, or leave empty to use the legacy manual break minutes below."
      },
      { key: "break_minutes", label: "Legacy / Manual Break Minutes", type: "number", min: 0, max: 1440, defaultValue: 0, help: "Used when no Break Rule is selected." },
      {
        key: "paid_hours_manual_override",
        label: "Paid Hours Mode",
        type: "select",
        defaultValue: "true",
        boolean: true,
        options: [
          { value: "true", label: "Manual paid hours" },
          { value: "false", label: "Use calculated paid hours" }
        ]
      },
      { key: "paid_hours", label: "Manual Paid Hours / Final Paid Hours", type: "number", min: 0, max: 24, step: "0.25" },
      { key: "break_alignment_notes", label: "Break Alignment Notes", type: "textarea", allowEmptyString: true },
      {
        key: "unsociable_rule_set_id",
        label: "Unsociable Rule Set",
        type: "lookup",
        lookup: "workTimeProfileUnsociableRuleSets",
        sectionTitle: "Unsociable alignment",
        sectionHelp: "Unsociable Rule Sets group one or more unsociable time rules. Work Time Profiles use the selected rule set to suggest unsociable hours.",
        help: "Select the policy used to suggest unsociable hours. Leave empty when this profile has no automatic unsociable calculation."
      },
      {
        key: "unsociable_hours_manual_override",
        label: "Paid Unsociable Hours Mode",
        type: "select",
        defaultValue: "true",
        boolean: true,
        options: [
          { value: "true", label: "Manual paid unsociable hours" },
          { value: "false", label: "Use suggested paid unsociable hours" }
        ],
        help: "Calculated mode uses the selected Unsociable Rule Set and caps payable unsociable time by final paid hours."
      },
      { key: "unsociable_hours", label: "Manual / Final Paid Unsociable Hours", type: "number", min: 0, max: 24, step: "0.25", defaultValue: 0 },
      { key: "unsociable_alignment_notes", label: "Unsociable Alignment Notes", type: "textarea", allowEmptyString: true },
      {
        key: "custom_tag_1",
        label: "Tag 1",
        allowEmptyString: true,
        sectionTitle: "Calendar / filter tags",
        sectionHelp: "Optional labels for calendar filters, such as AM/PM, Blue/Red shift, Night, Weekend, or local team names."
      },
      { key: "custom_tag_2", label: "Tag 2", allowEmptyString: true },
      { key: "custom_tag_3", label: "Tag 3", allowEmptyString: true },
      { key: "display_order", label: "Display Order", type: "number", min: 0, defaultValue: 0 },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "profile_summary", label: "Profile", format: "workTimeProfileProfile" },
      { key: "time_summary", label: "Time", format: "workTimeProfileTimes" },
      { key: "break_rule_label", label: "Break Rule" },
      { key: "hours_summary", label: "Paid Hours", format: "workTimeProfileHours" },
      { key: "unsociable_rule_set_summary", label: "Unsociable Rule Set", format: "workTimeProfileRuleSet" },
      { key: "unsociable_summary", label: "Paid Unsociable", format: "workTimeProfileUnsociable" },
      { key: "custom_tags", label: "Tags", format: "workTimeTags" }
    ]
  }
};

const referenceCache = {};
const lookupCache = {
  sites: [],
  organisations: [],
  workTimeProfileBreakRules: [],
  workTimeProfileUnsociableRuleSets: []
};

let currentEntityKey = "sites";
let referenceSectionsRegistered = false;
let workTimeProfileUnsociablePreviewRows = [];
let unsociableRuleSetRuleChoices = [];
let selectedUnsociableRuleSetRuleIds = new Set();

function currentDefinition() {
  return entityDefinitions[currentEntityKey];
}

function referenceEntityIcon(key, definition) {
  if (key === "jobRoles") return "JR";
  if (key === "shiftPatterns") return "SP";
  if (key === "breakRules") return "BR";
  if (key === "unsociableTimeRules") return "UT";
  if (key === "unsociableRuleSets") return "US";
  return definition.plural.slice(0, 1).toUpperCase();
}

function registerReferenceDataSections() {
  if (referenceSectionsRegistered) return;
  referenceSectionsRegistered = true;

  registerModuleSections(
    "reference-data",
    Object.entries(entityDefinitions).filter(([, definition]) => canViewDefinition(definition)).map(([key, definition], index) => ({
      id: key,
      title: definition.plural,
      icon: referenceEntityIcon(key, definition),
      target: "referenceDataEntityWorkspace",
      order: (index + 1) * 10,
      default: key === "sites"
    })),
    {
      content: "referenceDataWorkspaceContent",
      title: "Reference Data",
      label: "Reference Data section navigation",
      toggleLabel: "Reference Data section",
      defaultSection: "sites",
      filterOnly: true,
      onSelect: sectionId => {
        if (sectionId !== currentEntityKey) void selectReferenceEntity(sectionId);
      }
    }
  );
}

function syncReferenceEntityNavigation() {
  refreshSectionNavigator("reference-data");
  selectModuleSection("reference-data", currentEntityKey, {
    focus: false,
    resetScroll: false,
    notify: false
  });
}

function referenceAuditFields(definition) {
  return ["active", ...definition.fields
    .map(field => field.key)
    .filter(field => field !== "notes")];
}

function referenceAuditRecord(record, fields) {
  if (!record) return null;
  return fields.reduce((auditRecord, field) => {
    const value = record[field];
    auditRecord[field] = value && typeof value === "object"
      ? JSON.stringify(value)
      : value;
    return auditRecord;
  }, {});
}

function referenceRecordCode(record, definition) {
  const codeField = definition.fields.find(field => field.key.endsWith("_code"));
  return codeField && record ? record[codeField.key] || null : null;
}

function definitionViewCapabilities(definition) {
  return definition.viewCapabilities || ["settings.view", "settings.edit"];
}

function definitionEditCapabilities(definition) {
  return definition.editCapabilities || ["settings.edit"];
}

function canViewDefinition(definition) {
  return hasAnyCapability(definitionViewCapabilities(definition));
}

function canEditDefinition(definition) {
  return hasAnyCapability(definitionEditCapabilities(definition));
}

function hasReferenceDataAccess() {
  return Object.values(entityDefinitions).some(canViewDefinition);
}

function hasReferenceDataEditAccess() {
  return canEditDefinition(currentDefinition());
}

function requireReferenceDataAccess() {
  if (hasReferenceDataAccess()) return true;
  showToast("You do not have permission", "Reference Data requires an authorised reference capability.", "error");
  return false;
}

function requireReferenceEntityAccess(definition) {
  if (canViewDefinition(definition)) return true;
  showToast("You do not have permission", definition.plural + " cannot be viewed by your current access.", "error");
  return false;
}

function requireReferenceDataEditAccess() {
  if (hasReferenceDataEditAccess()) return true;
  showToast("You do not have permission", "This action requires a manage capability for this reference data.", "error");
  return false;
}

function definitionColumns(definition) {
  return [
    ...new Set([
      ...commonRecordColumns,
      ...definition.fields.map(field => field.key)
    ])
  ].join(", ");
}

function setListStatus(message) {
  $("referenceListStatus").textContent = message;
}

function lookupLabel(lookupName, id) {
  if (!id) return "—";
  const record = (lookupCache[lookupName] || []).find(item => item.id === id);
  return record ? record.label : "Unknown";
}

function formatValue(record, column) {
  if (column.lookup) return lookupLabel(column.lookup, record[column.key]);
  if (column.format === "boolean") return record[column.key] ? "Yes" : "No";
  if (column.format === "time") return formatReferenceTime(record[column.key]);
  if (column.format === "hours") return formatReferenceHours(record[column.key]);
  if (column.format === "workTimeProfileTimes") {
    return formatReferenceTime(record.start_time) + "-" + formatReferenceTime(record.end_time) +
      (record.crosses_midnight ? " overnight" : "");
  }
  if (column.format === "workTimeProfileHours") {
    return "Final " + formatReferenceHours(record.paid_hours) +
      " | Suggested " + formatReferenceHours(record.calculated_paid_hours) +
      " | Gross " + formatReferenceHours(record.gross_hours) +
      " | Unsoc " + formatReferenceHours(record.unsociable_hours);
  }
  if (column.format === "workTimeProfileUnsociable") {
    return "Final " + formatReferenceHours(record.unsociable_hours) +
      " | Suggested " + formatReferenceHours(record.calculated_unsociable_hours) +
      " | " + (record.unsociable_hours_manual_override ? "manual" : "calculated");
  }
  if (column.format === "workTimeProfileRuleSet") {
    return record.unsociable_rule_set_name || "No rule set";
  }
  if (column.format === "unsociableTimeBand") return unsociableTimeBandText(record);
  if (column.format === "unsociableDays") return unsociableDaysText(record);
  if (column.format === "unsociableDayApplicationMode") return unsociableDayApplicationModeText(record);
  if (column.format === "compactSummary") return compactText(record[column.key]);
  if (column.format === "title") {
    return String(record[column.key] || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, character => character.toUpperCase()) || "—";
  }
  const value = record[column.key];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function compactText(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatReferenceTime(value) {
  return value ? String(value).slice(0, 5) : "-";
}

function formatReferenceHours(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "-";
}

function formatReferenceMinutes(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) + " min" : "-";
}

function workTimeProfileId(record) {
  return record && (record.id || record.profile_id);
}

function normaliseWorkTimeProfileRecord(record) {
  const item = record || {};
  const ruleSetOption = item.unsociable_rule_set_id
    ? (lookupCache.workTimeProfileUnsociableRuleSets || [])
      .find(ruleSet => ruleSet.id === item.unsociable_rule_set_id)
    : null;
  return {
    ...item,
    id: workTimeProfileId(item),
    break_minutes: item.break_minutes ?? item.legacy_break_minutes ?? 0,
    paid_hours_manual_override: item.paid_hours_manual_override !== false,
    unsociable_hours_manual_override: item.unsociable_hours_manual_override !== false,
    break_rule_label: item.break_rule_label || "",
    break_rule_paid_minutes: item.break_rule_paid_minutes ?? item.effective_paid_break_minutes ?? 0,
    break_rule_unpaid_minutes: item.break_rule_unpaid_minutes ?? item.effective_unpaid_break_minutes ?? 0,
    break_rule_total_minutes: item.break_rule_total_minutes ?? item.effective_break_minutes ?? 0,
    effective_paid_break_minutes: item.effective_paid_break_minutes ?? item.break_rule_paid_minutes ?? 0,
    effective_unpaid_break_minutes: item.effective_unpaid_break_minutes ?? item.break_rule_unpaid_minutes ?? 0,
    effective_break_minutes: item.effective_break_minutes ??
      ((item.effective_paid_break_minutes ?? item.break_rule_paid_minutes ?? 0) +
        (item.effective_unpaid_break_minutes ?? item.break_rule_unpaid_minutes ?? item.break_minutes ?? 0)),
    calculated_unsociable_hours: item.calculated_unsociable_hours ?? null,
    unsociable_rule_set_id: item.unsociable_rule_set_id || null,
    unsociable_rule_set_name: item.unsociable_rule_set_name || (ruleSetOption && ruleSetOption.rule_set_name) || "",
    unsociable_rule_set_code: item.unsociable_rule_set_code || (ruleSetOption && ruleSetOption.rule_set_code) || "",
    unsociable_rule_set_summary: item.unsociable_rule_set_summary || (ruleSetOption && ruleSetOption.rule_summary) || "",
    legacy_break_minutes: item.legacy_break_minutes ?? item.break_minutes ?? 0
  };
}

function workTimeProfileBreakRuleLabel(record) {
  if (record.break_rule_name) return record.break_rule_name;
  if (record.break_rule_label) return String(record.break_rule_label).split(" â€” ")[0].split(" - ")[0];
  if (record.break_rule_id) return "Selected Break Rule";
  return "Manual break minutes";
}

function appendCompactLine(stack, label, value, options = {}) {
  const line = document.createElement(options.strong ? "strong" : "span");
  line.textContent = label ? label + " " + value : value;
  if (options.title) line.title = options.title;
  stack.appendChild(line);
}

function createCompactStackCell(className = "") {
  const cell = document.createElement("td");
  const stack = document.createElement("div");
  stack.className = "work-time-profile-compact-stack" + (className ? " " + className : "");
  cell.appendChild(stack);
  return { cell, stack };
}

function createWorkTimeProfileProfileCell(record) {
  const { cell, stack } = createCompactStackCell("work-time-profile-profile-stack");
  appendCompactLine(stack, "", record.profile_name || "Work Time Profile", { strong: true, title: record.profile_name });
  appendCompactLine(stack, "", record.profile_code || "-", { title: record.profile_code });
  return cell;
}

function createWorkTimeProfileTimeCell(record) {
  const { cell, stack } = createCompactStackCell();
  appendCompactLine(
    stack,
    "",
    formatReferenceTime(record.start_time) + "-" + formatReferenceTime(record.end_time),
    { strong: true }
  );
  appendCompactLine(stack, "", record.crosses_midnight ? "Overnight" : "Same day");
  return cell;
}

function createWorkTimeProfileHoursCell(record) {
  const { cell, stack } = createCompactStackCell();
  appendCompactLine(stack, "Final", formatReferenceHours(record.paid_hours) + "h", { strong: true });
  appendCompactLine(stack, "Suggested", formatReferenceHours(record.calculated_paid_hours) + "h");
  appendCompactLine(stack, "Gross", formatReferenceHours(record.gross_hours) + "h");
  return cell;
}

function createWorkTimeProfileUnsociableCell(record) {
  const { cell, stack } = createCompactStackCell();
  appendCompactLine(stack, "Final", formatReferenceHours(record.unsociable_hours) + "h", { strong: true });
  appendCompactLine(stack, "Suggested paid", formatReferenceHours(record.calculated_unsociable_hours) + "h");
  appendCompactLine(stack, "Mode", record.unsociable_hours_manual_override ? "manual" : "calculated");
  return cell;
}

function createWorkTimeProfileBreakCell(record) {
  const { cell, stack } = createCompactStackCell("work-time-profile-break-stack");
  appendCompactLine(stack, "", workTimeProfileBreakRuleLabel(record), {
    strong: true,
    title: record.break_rule_label || workTimeProfileBreakRuleLabel(record)
  });
  appendCompactLine(stack, "", formatReferenceMinutes(record.effective_break_minutes));
  appendCompactLine(
    stack,
    "",
    String(record.effective_paid_break_minutes ?? 0) + " paid / " +
      String(record.effective_unpaid_break_minutes ?? 0) + " unpaid"
  );
  return cell;
}

function createWorkTimeProfileRuleSetCell(record) {
  const { cell, stack } = createCompactStackCell("work-time-profile-rule-set-stack");
  const name = record.unsociable_rule_set_name || "No rule set";
  appendCompactLine(stack, "", name, { strong: true, title: name });
  const summary = record.unsociable_rule_set_summary || "";
  appendCompactLine(stack, "", summary ? compactRuleSummary(summary) : "No automatic rules", { title: summary });
  return cell;
}

function workTimeProfileTags(record) {
  return ["custom_tag_1", "custom_tag_2", "custom_tag_3"]
    .map(key => String(record && record[key] ? record[key] : "").trim())
    .filter(Boolean);
}

function normaliseWorkTimeProfileCode(value) {
  return normaliseBusinessCode(
    String(value || "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function isWorkTimeProfilesDefinition(definition = currentDefinition()) {
  return definition.customType === "workTimeProfiles";
}

function isBreakRulesDefinition(definition = currentDefinition()) {
  return definition.customType === "breakRules";
}

function isUnsociableTimeRulesDefinition(definition = currentDefinition()) {
  return definition.customType === "unsociableTimeRules";
}

function isUnsociableRuleSetsDefinition(definition = currentDefinition()) {
  return definition.customType === "unsociableRuleSets";
}

function isWorkingTimeRuleDefinition(definition = currentDefinition()) {
  return isBreakRulesDefinition(definition) ||
    isUnsociableTimeRulesDefinition(definition) ||
    isUnsociableRuleSetsDefinition(definition);
}

function createTextCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

const UNSOCIABLE_DAY_FIELDS = [
  ["applies_monday", "Mon"],
  ["applies_tuesday", "Tue"],
  ["applies_wednesday", "Wed"],
  ["applies_thursday", "Thu"],
  ["applies_friday", "Fri"],
  ["applies_saturday", "Sat"],
  ["applies_sunday", "Sun"]
];

function unsociableDaysText(record) {
  const days = UNSOCIABLE_DAY_FIELDS
    .filter(([key]) => record && record[key])
    .map(([, label]) => label);
  return days.length === 7 ? "Mon-Sun" : days.join(", ") || "-";
}

function unsociableTimeBandText(record) {
  if (record.full_day) return "Full day";
  return formatReferenceTime(record.start_time) + "-" + formatReferenceTime(record.end_time) +
    (record.crosses_midnight ? " overnight" : "");
}

function unsociableDayApplicationModeText(record) {
  const mode = record && record.day_application_mode ? record.day_application_mode : "shift_start_day";
  return mode === "calendar_minutes" ? "Calendar minutes" : "Shift start day";
}

function normaliseBreakRuleRecord(record) {
  const item = record || {};
  return {
    ...item,
    id: item.id || item.break_rule_id,
    paid_break_minutes: item.paid_break_minutes ?? 0,
    unpaid_break_minutes: item.unpaid_break_minutes ?? 0,
    total_break_minutes: item.total_break_minutes ??
      (Number(item.paid_break_minutes || 0) + Number(item.unpaid_break_minutes || 0)),
    active: item.active !== false
  };
}

function normaliseUnsociableTimeRuleRecord(record) {
  const item = record || {};
  return {
    ...item,
    id: item.id || item.rule_id,
    day_application_mode: item.day_application_mode || "shift_start_day",
    active: item.active !== false
  };
}

function normaliseUnsociableRuleSetRecord(record) {
  const item = record || {};
  return {
    ...item,
    id: item.id || item.rule_set_id,
    active: item.active !== false,
    rule_count: item.rule_count ?? 0,
    rule_summary: item.rule_summary || ""
  };
}

function createWorkTimeProfileTagsCell(record) {
  const cell = document.createElement("td");
  const tags = workTimeProfileTags(record);
  if (!tags.length) {
    cell.textContent = "-";
    return cell;
  }

  const list = document.createElement("div");
  list.className = "work-time-profile-tags";
  tags.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "work-time-profile-tag";
    chip.textContent = tag;
    list.appendChild(chip);
  });
  cell.appendChild(list);
  return cell;
}

async function loadReferenceLookups(definition) {
  const requiredLookups = [
    ...new Set(definition.fields.filter(field => field.lookup).map(field => field.lookup))
  ];

  const results = await Promise.allSettled(requiredLookups.map(async lookupName => {
    if (lookupName === "sites") {
      const result = await supabaseClient
        .from("sites")
        .select("id, site_code, site_name, active")
        .order("site_name", { ascending: true });
      if (result.error) throw result.error;

      lookupCache.sites = (result.data || []).map(site => ({
        id: site.id,
        label: site.site_name + (site.site_code ? " (" + site.site_code + ")" : ""),
        active: site.active
      }));
    }

    if (lookupName === "organisations") {
      const result = await supabaseClient
        .from("organisations")
        .select("id, organisation_code, organisation_name, active")
        .order("organisation_name", { ascending: true });
      if (result.error) throw result.error;

      lookupCache.organisations = (result.data || []).map(organisation => ({
        id: organisation.id,
        label: organisation.organisation_name +
          (organisation.organisation_code ? " (" + organisation.organisation_code + ")" : ""),
        active: organisation.active
      }));
    }

    if (lookupName === "workTimeProfileBreakRules") {
      const result = await supabaseClient.rpc("list_work_time_profile_break_rule_options");
      if (result.error) throw result.error;

      lookupCache.workTimeProfileBreakRules = (result.data || []).map(rule => ({
        id: rule.break_rule_id,
        label: rule.break_rule_label,
        break_minutes: rule.break_rule_total_minutes ?? rule.break_minutes,
        paid_break_minutes: rule.break_rule_paid_minutes ?? rule.paid_break_minutes ?? 0,
        unpaid_break_minutes: rule.break_rule_unpaid_minutes ?? rule.unpaid_break_minutes ??
          (rule.paid_break ? 0 : rule.break_minutes),
        total_break_minutes: rule.break_rule_total_minutes ?? rule.total_break_minutes ?? rule.break_minutes,
        paid_break: rule.paid_break,
        active: true
      }));
    }

    if (lookupName === "workTimeProfileUnsociableRuleSets") {
      const result = await supabaseClient.rpc("list_work_time_profile_unsociable_rule_set_options");
      if (result.error) throw result.error;

      lookupCache.workTimeProfileUnsociableRuleSets = (result.data || []).map(ruleSet => ({
        id: ruleSet.rule_set_id,
        label: ruleSet.option_label || ruleSet.rule_set_name,
        rule_set_code: ruleSet.rule_set_code,
        rule_set_name: ruleSet.rule_set_name,
        rule_count: ruleSet.rule_count ?? 0,
        rule_summary: ruleSet.rule_summary || "",
        active: true
      }));
    }
  }));

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      lookupCache[requiredLookups[index]] = [];
    }
  });
}

function createFieldControl(field) {
  let control;

  if (field.type === "textarea" || field.type === "json") {
    control = document.createElement("textarea");
    control.rows = field.type === "json" ? 6 : 4;
    if (field.type === "json") control.spellcheck = false;
  } else if (field.type === "select" || field.type === "lookup") {
    control = document.createElement("select");

    if (field.type === "lookup") {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Not selected";
      control.appendChild(emptyOption);

      (lookupCache[field.lookup] || []).forEach(item => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label + (item.active === false ? " — inactive" : "");
        control.appendChild(option);
      });
    } else {
      field.options.forEach(item => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        control.appendChild(option);
      });
    }
  } else {
    control = document.createElement("input");
    control.type = field.type === "number"
      ? "number"
      : field.type === "time"
        ? "time"
        : "text";
    if (field.min !== undefined) control.min = String(field.min);
    if (field.max !== undefined) control.max = String(field.max);
    if (field.step !== undefined) control.step = String(field.step);
  }

  control.id = "referenceField_" + field.key;
  control.dataset.referenceField = field.key;
  if (field.placeholder) control.placeholder = field.placeholder;
  if (field.readOnly) control.readOnly = true;
  if (field.normalise === "code") {
    control.dataset.businessCode = "true";
    control.autocapitalize = "characters";
  }
  if (field.required) control.required = true;
  if (field.key === "day_application_mode") {
    decorateCapabilityAction(control, {
      actionId: "reference_data.unsociable_time_rules.day_application_mode",
      label: "Set Unsociable Time Rule Day Application Mode",
      area: "Reference Data",
      requiredAny: definitionEditCapabilities(currentDefinition()),
      actionType: "edit"
    });
  }
  if (field.key === "unsociable_rule_set_id") {
    decorateCapabilityAction(control, {
      actionId: "reference_data.work_time_profiles.unsociable_rule_set.select",
      label: "Select Unsociable Rule Set on Work Time Profile",
      area: "Reference Data",
      requiredAny: definitionEditCapabilities(currentDefinition()),
      actionType: "edit"
    });
  }
  if (field.key === "cycle_pattern") {
    control.addEventListener("input", () => syncDerivedCycleLength(true));
  }
  return control;
}

function derivedCycleLength(value) {
  if (Array.isArray(value)) return value.length;
  if (value && Array.isArray(value.days)) return value.days.length;
  if (value && Array.isArray(value.cycle)) return value.cycle.length;
  return null;
}

function syncDerivedCycleLength(clearWhenUnknown) {
  const patternControl = $("referenceField_cycle_pattern");
  const lengthControl = $("referenceField_cycle_length_days");
  if (!patternControl || !lengthControl) return;

  const rawValue = patternControl.value.trim();
  if (!rawValue) {
    if (clearWhenUnknown) lengthControl.value = "";
    return;
  }

  try {
    const length = derivedCycleLength(JSON.parse(rawValue));
    if (length !== null) lengthControl.value = String(length);
    else if (clearWhenUnknown) lengthControl.value = "";
  } catch {
    if (clearWhenUnknown) lengthControl.value = "";
  }
}

function renderReferenceFormFields() {
  const definition = currentDefinition();
  const container = $("referenceFormFields");
  container.replaceChildren();

  definition.fields.forEach(field => {
    if (field.sectionTitle) {
      const section = document.createElement("div");
      section.className = "reference-form-section";
      const title = document.createElement("h3");
      title.textContent = field.sectionTitle;
      section.appendChild(title);
      if (field.sectionHelp) {
        const help = document.createElement("p");
        help.textContent = field.sectionHelp;
        section.appendChild(help);
      }
      container.appendChild(section);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "reference-form-field";

    const label = document.createElement("label");
    label.htmlFor = "referenceField_" + field.key;
    label.textContent = field.label + (field.required ? " *" : "");
    wrapper.appendChild(label);

    wrapper.appendChild(createFieldControl(field));

    if (field.help) {
      const help = document.createElement("small");
      help.textContent = field.help;
      wrapper.appendChild(help);
    }

    container.appendChild(wrapper);
  });

  if (isWorkTimeProfilesDefinition(definition)) {
    container.appendChild(createWorkTimeProfileCalculationPreview());
    setupWorkTimeProfileFormBehaviour();
  }
  if (isUnsociableRuleSetsDefinition(definition)) {
    container.appendChild(createUnsociableRuleSetRulePicker());
  }
  if (isBreakRulesDefinition(definition)) setupBreakRuleFormBehaviour();
  if (isUnsociableTimeRulesDefinition(definition)) setupUnsociableTimeRuleFormBehaviour();
}

function createUnsociableRuleSetRulePicker() {
  const section = document.createElement("section");
  section.id = "unsociableRuleSetRulePicker";
  section.className = "reference-rule-picker";
  decorateCapabilityAction(section, {
    actionId: "reference_data.unsociable_rule_sets.rules.view",
    label: "View Unsociable Rule Set Rules",
    area: "Reference Data",
    requiredAny: definitionViewCapabilities(currentDefinition()),
    actionType: "view"
  });

  const heading = document.createElement("h3");
  heading.textContent = "Rules in this set";
  const help = document.createElement("p");
  help.textContent = "Choose the Unsociable Time Rules included in this policy.";
  const list = document.createElement("div");
  list.id = "unsociableRuleSetRuleList";
  list.className = "reference-rule-picker-list";
  list.textContent = "Loading rules...";

  section.append(heading, help, list);
  return section;
}

function unsociableRuleOptionText(rule) {
  return (rule.rule_name || rule.rule_code || "Unsociable rule") + " - " +
    unsociableTimeBandText(rule) + " - " + unsociableDaysText(rule) +
    " - Mode: " + unsociableDayApplicationModeText(rule) +
    (rule.active === false ? " - inactive" : "");
}

function renderUnsociableRuleSetRulePicker(readOnly = false) {
  const list = $("unsociableRuleSetRuleList");
  if (!list) return;
  list.replaceChildren();
  if (!unsociableRuleSetRuleChoices.length) {
    list.textContent = "No Unsociable Time Rules are available.";
    return;
  }

  unsociableRuleSetRuleChoices.forEach(rule => {
    const label = document.createElement("label");
    label.className = "reference-rule-picker-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = rule.id;
    checkbox.checked = selectedUnsociableRuleSetRuleIds.has(rule.id);
    checkbox.disabled = readOnly || !hasReferenceDataEditAccess();
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedUnsociableRuleSetRuleIds.add(rule.id);
      else selectedUnsociableRuleSetRuleIds.delete(rule.id);
    });
    const text = document.createElement("span");
    text.textContent = unsociableRuleOptionText(rule);
    label.append(checkbox, text);
    list.appendChild(label);
  });
}

async function loadUnsociableRuleSetRulePicker(ruleSetId, readOnly = false) {
  unsociableRuleSetRuleChoices = [];
  selectedUnsociableRuleSetRuleIds = new Set();
  renderUnsociableRuleSetRulePicker(readOnly);

  const rulesResult = await supabaseClient.rpc("list_unsociable_time_rules", {
    p_include_inactive: true,
    p_search_text: null
  });
  if (rulesResult.error) throw rulesResult.error;
  unsociableRuleSetRuleChoices = (rulesResult.data || []).map(normaliseUnsociableTimeRuleRecord);

  if (ruleSetId) {
    const selectedResult = await supabaseClient.rpc("list_unsociable_time_rule_set_rules", {
      p_rule_set_id: ruleSetId
    });
    if (selectedResult.error) throw selectedResult.error;
    selectedUnsociableRuleSetRuleIds = new Set((selectedResult.data || []).map(rule => rule.rule_id));
  }
  renderUnsociableRuleSetRulePicker(readOnly);
}

function selectedUnsociableRuleSetRuleIdsFromForm() {
  const list = $("unsociableRuleSetRuleList");
  if (!list) return [];
  return [...list.querySelectorAll("input[type='checkbox']:checked")].map(control => control.value);
}

function createWorkTimeProfileCalculationPreview() {
  const preview = document.createElement("section");
  preview.id = "workTimeProfileCalculationPreview";
  preview.className = "work-time-profile-preview";
  preview.setAttribute("aria-live", "polite");
  const heading = document.createElement("h3");
  heading.textContent = "Calculation preview";
  const help = document.createElement("p");
  help.textContent = "Suggested paid unsociable hours are capped by final paid hours. Rule Set day mode is handled by each Unsociable Time Rule.";
  const grid = document.createElement("dl");
  grid.className = "work-time-profile-preview-grid";
  [
    ["Gross hours", "gross"],
    ["Break rule", "rule"],
    ["Paid break", "paidBreak"],
    ["Unpaid break", "unpaidBreak"],
    ["Total break", "break"],
    ["Suggested paid", "calculated"],
    ["Final paid", "final"],
    ["Suggested paid unsociable", "calculatedUnsociable"],
    ["Final paid unsociable", "finalUnsociable"]
  ].forEach(([label, key]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.id = "workTimeProfilePreview_" + key;
    detail.textContent = "-";
    item.append(term, detail);
    grid.appendChild(item);
  });

  const unsociableHeader = document.createElement("div");
  unsociableHeader.className = "work-time-profile-preview-actions";
  const unsociableTitle = document.createElement("h3");
  unsociableTitle.textContent = "Preview by shift start day";
  const refreshButton = document.createElement("button");
  refreshButton.id = "workTimeProfileUnsociablePreviewRefresh";
  refreshButton.className = "secondary";
  refreshButton.type = "button";
  refreshButton.textContent = "Refresh";
  decorateCapabilityAction(refreshButton, {
    actionId: "reference_data.work_time_profiles.unsociable_preview",
    label: "Preview Work Time Profile unsociable hours",
    area: "Reference Data",
    requiredAny: [
      "work_time_profiles.view",
      "work_time_profiles.manage"
    ],
    actionType: "view"
  });
  refreshButton.addEventListener("click", () => {
    const recordId = $("referenceRecordId") ? $("referenceRecordId").value : "";
    void loadWorkTimeProfileUnsociablePreview(recordId);
  });
  unsociableHeader.append(unsociableTitle, refreshButton);

  const dayPreview = document.createElement("div");
  dayPreview.id = "workTimeProfileUnsociableDayPreview";
  dayPreview.className = "work-time-profile-unsociable-days";
  dayPreview.textContent = "-";

  preview.append(heading, help, grid, unsociableHeader, dayPreview);
  return preview;
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function selectedWorkTimeProfileBreakRule() {
  const control = $("referenceField_break_rule_id");
  const id = control ? control.value : "";
  return (lookupCache.workTimeProfileBreakRules || []).find(rule => rule.id === id) || null;
}

function selectedWorkTimeProfileUnsociableRuleSet() {
  const control = $("referenceField_unsociable_rule_set_id");
  const id = control ? control.value : "";
  return (lookupCache.workTimeProfileUnsociableRuleSets || []).find(ruleSet => ruleSet.id === id) || null;
}

function currentReferenceRecord() {
  const recordId = $("referenceRecordId") ? $("referenceRecordId").value : "";
  if (!recordId) return null;
  return (referenceCache[currentEntityKey] || []).find(record => record.id === recordId) || null;
}

function numericControlValue(id) {
  const control = $(id);
  if (!control) return null;
  const text = control.value.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function roundedHoursFromMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const value = Number(minutes);
  return Number.isFinite(value) ? Number((value / 60).toFixed(2)) : null;
}

function rawSuggestedUnsociableHoursFromPreview() {
  const selectedRuleSet = selectedWorkTimeProfileUnsociableRuleSet();
  if (!selectedRuleSet) return 0;
  const rowValues = workTimeProfileUnsociablePreviewRows
    .map(row => Number(row.calculated_unsociable_hours))
    .filter(Number.isFinite);
  if (rowValues.length) return Number(Math.max(...rowValues).toFixed(2));
  const record = currentReferenceRecord();
  if (!record || record.calculated_unsociable_hours === null || record.calculated_unsociable_hours === undefined) {
    return null;
  }
  const storedValue = Number(record.calculated_unsociable_hours);
  return Number.isFinite(storedValue) ? storedValue : null;
}

function calculateWorkTimeProfilePreviewValues() {
  const start = timeToMinutes($("referenceField_start_time") && $("referenceField_start_time").value);
  const end = timeToMinutes($("referenceField_end_time") && $("referenceField_end_time").value);
  const crossesMidnight = $("referenceField_crosses_midnight") && $("referenceField_crosses_midnight").value === "true";
  const breakRule = selectedWorkTimeProfileBreakRule();
  const legacyBreakMinutes = Math.max(0, numericControlValue("referenceField_break_minutes") ?? 0);
  const manualOverride = !$("referenceField_paid_hours_manual_override") ||
    $("referenceField_paid_hours_manual_override").value !== "false";
  const manualPaidHours = numericControlValue("referenceField_paid_hours");
  const unsociableManualOverride = !$("referenceField_unsociable_hours_manual_override") ||
    $("referenceField_unsociable_hours_manual_override").value !== "false";
  const manualUnsociableHours = numericControlValue("referenceField_unsociable_hours");
  const unsociableRuleSet = selectedWorkTimeProfileUnsociableRuleSet();

  let grossMinutes = null;
  if (start !== null && end !== null) {
    let adjustedEnd = end;
    if (crossesMidnight || end < start) adjustedEnd += 24 * 60;
    grossMinutes = Math.max(adjustedEnd - start, 0);
  }

  const paidBreakMinutes = breakRule ? Math.max(0, Number(breakRule.paid_break_minutes || 0)) : 0;
  const unpaidBreakMinutesRaw = breakRule
    ? Math.max(0, Number(breakRule.unpaid_break_minutes || 0))
    : legacyBreakMinutes;
  const effectiveBreakMinutes = paidBreakMinutes + unpaidBreakMinutesRaw;
  const unpaidBreakMinutes = grossMinutes === null
    ? unpaidBreakMinutesRaw
    : Math.min(unpaidBreakMinutesRaw, grossMinutes);
  const calculatedPaidMinutes = grossMinutes === null ? null : Math.max(grossMinutes - unpaidBreakMinutes, 0);
  const calculatedPaidHours = roundedHoursFromMinutes(calculatedPaidMinutes);
  const finalPaidHours = manualOverride ? manualPaidHours : calculatedPaidHours;
  const rawCalculatedUnsociableHours = rawSuggestedUnsociableHoursFromPreview();
  const calculatedUnsociableHours = rawCalculatedUnsociableHours === null
    ? null
    : finalPaidHours === null
      ? rawCalculatedUnsociableHours
      : Math.min(rawCalculatedUnsociableHours, finalPaidHours);
  const finalUnsociableHours = unsociableManualOverride ? manualUnsociableHours : calculatedUnsociableHours;

  return {
    breakRule,
    unsociableRuleSet,
    manualOverride,
    unsociableManualOverride,
    grossMinutes,
    grossHours: roundedHoursFromMinutes(grossMinutes),
    paidBreakMinutes,
    effectiveBreakMinutes,
    unpaidBreakMinutes,
    calculatedPaidHours,
    finalPaidHours,
    rawCalculatedUnsociableHours,
    calculatedUnsociableHours,
    finalUnsociableHours
  };
}

function setPreviewText(key, value) {
  const target = $("workTimeProfilePreview_" + key);
  if (target) target.textContent = value;
}

function updateWorkTimeProfileCalculationPreview() {
  const values = calculateWorkTimeProfilePreviewValues();
  const paidHours = $("referenceField_paid_hours");
  if (paidHours) {
    paidHours.readOnly = values.manualOverride === false;
    if (values.manualOverride === false && values.calculatedPaidHours !== null) {
      paidHours.value = String(values.calculatedPaidHours);
    }
  }
  const unsociableHours = $("referenceField_unsociable_hours");
  if (unsociableHours) {
    unsociableHours.readOnly = values.unsociableManualOverride === false;
    if (values.unsociableManualOverride === false && values.calculatedUnsociableHours !== null) {
      unsociableHours.value = String(values.calculatedUnsociableHours);
    }
  }

  setPreviewText("gross", values.grossHours === null ? "-" : formatReferenceHours(values.grossHours) + "h");
  setPreviewText("rule", values.breakRule ? values.breakRule.label : "Manual break minutes");
  setPreviewText("paidBreak", formatReferenceMinutes(values.paidBreakMinutes));
  setPreviewText("break", formatReferenceMinutes(values.effectiveBreakMinutes));
  setPreviewText("unpaidBreak", formatReferenceMinutes(values.unpaidBreakMinutes));
  setPreviewText("calculated", values.calculatedPaidHours === null ? "-" : formatReferenceHours(values.calculatedPaidHours) + "h");
  setPreviewText("final", values.finalPaidHours === null ? "-" : formatReferenceHours(values.finalPaidHours) + "h");
  setPreviewText(
    "calculatedUnsociable",
    values.calculatedUnsociableHours === null ? "-" : formatReferenceHours(values.calculatedUnsociableHours) + "h"
  );
  setPreviewText(
    "finalUnsociable",
    values.finalUnsociableHours === null ? "-" : formatReferenceHours(values.finalUnsociableHours) + "h"
  );
}

function compactRuleSummary(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

function renderWorkTimeProfileUnsociablePreview(profileId, error) {
  const container = $("workTimeProfileUnsociableDayPreview");
  if (!container) return;
  container.replaceChildren();

  if (error) {
    container.textContent = error;
    return;
  }
  if (!workTimeProfileUnsociablePreviewRows.length) {
    container.textContent = selectedWorkTimeProfileUnsociableRuleSet()
      ? "Suggested paid unsociable hours depend on the shift start day."
      : "No unsociable rule set selected.";
    return;
  }

  const selectedRuleSet = selectedWorkTimeProfileUnsociableRuleSet();
  const heading = document.createElement("strong");
  heading.textContent = "Rule Set: " + (selectedRuleSet ? selectedRuleSet.rule_set_name : "Selected rule set") +
    ". Day mode is handled by individual rules.";
  container.appendChild(heading);

  const values = calculateWorkTimeProfilePreviewValues();
  workTimeProfileUnsociablePreviewRows.forEach(row => {
    const rowHours = Number(row.calculated_unsociable_hours);
    const displayHours = Number.isFinite(rowHours) && values.finalPaidHours !== null
      ? Math.min(rowHours, values.finalPaidHours)
      : row.calculated_unsociable_hours;
    const item = document.createElement("span");
    item.textContent = String(row.day_name || "-").slice(0, 3) + " " +
      formatReferenceHours(displayHours) + "h";
    container.appendChild(item);
  });
}

async function loadWorkTimeProfileUnsociablePreview(profileId) {
  workTimeProfileUnsociablePreviewRows = [];
  renderWorkTimeProfileUnsociablePreview(profileId);
  updateWorkTimeProfileCalculationPreview();
  const ruleSet = selectedWorkTimeProfileUnsociableRuleSet();
  if (!ruleSet) {
    renderWorkTimeProfileUnsociablePreview(profileId, "No unsociable rule set selected.");
    updateWorkTimeProfileCalculationPreview();
    return;
  }

  const refreshButton = $("workTimeProfileUnsociablePreviewRefresh");
  if (refreshButton) refreshButton.disabled = true;
  try {
    const days = [
      [1, "Monday"],
      [2, "Tuesday"],
      [3, "Wednesday"],
      [4, "Thursday"],
      [5, "Friday"],
      [6, "Saturday"],
      [7, "Sunday"]
    ];
    const results = await Promise.all(days.map(([isoDow, dayName]) =>
      supabaseClient.rpc("calculate_work_time_profile_values_v3", {
        p_start_time: $("referenceField_start_time") ? $("referenceField_start_time").value || null : null,
        p_end_time: $("referenceField_end_time") ? $("referenceField_end_time").value || null : null,
        p_crosses_midnight: $("referenceField_crosses_midnight") &&
          $("referenceField_crosses_midnight").value === "true",
        p_break_rule_id: $("referenceField_break_rule_id") ? $("referenceField_break_rule_id").value || null : null,
        p_break_minutes: numericControlValue("referenceField_break_minutes"),
        p_paid_hours_manual_override: $("referenceField_paid_hours_manual_override") ?
          $("referenceField_paid_hours_manual_override").value !== "false" : true,
        p_manual_paid_hours: numericControlValue("referenceField_paid_hours"),
        p_unsociable_hours_manual_override: $("referenceField_unsociable_hours_manual_override") ?
          $("referenceField_unsociable_hours_manual_override").value !== "false" : true,
        p_manual_unsociable_hours: numericControlValue("referenceField_unsociable_hours"),
        p_iso_dow: isoDow,
        p_unsociable_rule_set_id: ruleSet.id
      }).then(result => {
        if (result.error) throw result.error;
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return {
          iso_dow: isoDow,
          day_name: dayName,
          unsociable_rule_set_id: ruleSet.id,
          unsociable_rule_set_name: ruleSet.rule_set_name,
          calculated_unsociable_minutes: row ? row.calculated_unsociable_minutes : 0,
          calculated_unsociable_hours: row ? row.calculated_unsociable_hours : 0
        };
      })
    ));
    workTimeProfileUnsociablePreviewRows = results;
    renderWorkTimeProfileUnsociablePreview(profileId);
    updateWorkTimeProfileCalculationPreview();
  } catch (err) {
    renderWorkTimeProfileUnsociablePreview(profileId, err.message || "Unsociable preview could not be loaded.");
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

function setupWorkTimeProfileFormBehaviour() {
  const nameControl = $("referenceField_profile_name");
  const codeControl = $("referenceField_profile_code");
  if (!nameControl || !codeControl) return;

  codeControl.addEventListener("input", () => {
    codeControl.dataset.userEdited = "true";
  });
  nameControl.addEventListener("input", () => {
    if (codeControl.dataset.userEdited === "true" || codeControl.value.trim()) return;
    codeControl.value = normaliseWorkTimeProfileCode(nameControl.value) || "";
  });

  [
    "referenceField_start_time",
    "referenceField_end_time",
    "referenceField_crosses_midnight",
    "referenceField_break_rule_id",
    "referenceField_break_minutes",
    "referenceField_paid_hours_manual_override",
    "referenceField_paid_hours",
    "referenceField_unsociable_hours_manual_override",
    "referenceField_unsociable_hours",
    "referenceField_unsociable_rule_set_id"
  ].forEach(id => {
    const control = $(id);
    if (control) control.addEventListener("input", () => {
      updateWorkTimeProfileCalculationPreview();
      if (id !== "referenceField_paid_hours") void loadWorkTimeProfileUnsociablePreview(
        $("referenceRecordId") ? $("referenceRecordId").value : ""
      );
    });
    if (control) control.addEventListener("change", () => {
      updateWorkTimeProfileCalculationPreview();
      void loadWorkTimeProfileUnsociablePreview($("referenceRecordId") ? $("referenceRecordId").value : "");
    });
  });
  updateWorkTimeProfileCalculationPreview();
}

function syncBreakRuleTotalMinutes() {
  const paidControl = $("referenceField_paid_break_minutes");
  const unpaidControl = $("referenceField_unpaid_break_minutes");
  const totalControl = $("referenceField_total_break_minutes");
  if (!paidControl || !unpaidControl || !totalControl) return;
  const total = Math.max(0, Number(paidControl.value || 0)) +
    Math.max(0, Number(unpaidControl.value || 0));
  totalControl.value = String(total);
}

function setupBreakRuleFormBehaviour() {
  ["referenceField_paid_break_minutes", "referenceField_unpaid_break_minutes"].forEach(id => {
    const control = $(id);
    if (!control) return;
    control.addEventListener("input", syncBreakRuleTotalMinutes);
    control.addEventListener("change", syncBreakRuleTotalMinutes);
  });
  syncBreakRuleTotalMinutes();
}

function syncUnsociableTimeRuleFullDay() {
  const fullDay = $("referenceField_full_day");
  const start = $("referenceField_start_time");
  const end = $("referenceField_end_time");
  const crossesMidnight = $("referenceField_crosses_midnight");
  if (!fullDay || !start || !end || !crossesMidnight) return;
  const isFullDay = fullDay.value === "true";
  start.readOnly = isFullDay;
  end.readOnly = isFullDay;
  crossesMidnight.disabled = isFullDay;
  if (isFullDay) {
    start.value = "00:00";
    end.value = "00:00";
    crossesMidnight.value = "false";
  }
}

function setupUnsociableTimeRuleFormBehaviour() {
  const fullDay = $("referenceField_full_day");
  if (fullDay) fullDay.addEventListener("change", syncUnsociableTimeRuleFullDay);
  syncUnsociableTimeRuleFullDay();
}

function referenceActionNamespace(definition = currentDefinition()) {
  if (isWorkTimeProfilesDefinition(definition)) return "work_time_profiles";
  if (isBreakRulesDefinition(definition)) return "break_rules";
  if (isUnsociableTimeRulesDefinition(definition)) return "unsociable_time_rules";
  if (isUnsociableRuleSetsDefinition(definition)) return "unsociable_rule_sets";
  return currentEntityKey;
}

function referenceExportLabel(definition = currentDefinition()) {
  if (isWorkTimeProfilesDefinition(definition)) return "Work Time Profiles";
  if (isBreakRulesDefinition(definition)) return "Break Rules";
  if (isUnsociableTimeRulesDefinition(definition)) return "Unsociable Time Rules";
  if (isUnsociableRuleSetsDefinition(definition)) return "Unsociable Rule Sets";
  return definition.plural;
}

function updateReferencePageLabels() {
  const definition = currentDefinition();
  $("referenceResultsTitle").textContent = definition.plural;
  $("referenceSearchEntityLabel").textContent = definition.plural.toLowerCase();
  $("referenceSearch").placeholder = "Search " + definition.plural.toLowerCase();
  $("referenceCreateButton").textContent = "Create " + definition.singular;
  $("referenceCreateButton").classList.toggle("hidden", !hasReferenceDataEditAccess());
  const isWorkTimeProfiles = isWorkTimeProfilesDefinition(definition);
  const isExportable = isWorkTimeProfiles ||
    isBreakRulesDefinition(definition) ||
    isUnsociableTimeRulesDefinition(definition) ||
    isUnsociableRuleSetsDefinition(definition);
  ["referenceIncludeInactiveWrapper", "referenceExportCsvButton", "referenceExportXlsxButton"].forEach(id => {
    const element = $(id);
    if (element) element.classList.toggle("hidden", !isExportable);
  });
  if ($("referenceCreateButton")) {
    decorateCapabilityAction($("referenceCreateButton"), {
      actionId: "reference_data." + referenceActionNamespace(definition) + ".create",
      label: "Create " + definition.singular,
      area: "Reference Data",
      requiredAny: definitionEditCapabilities(definition),
      actionType: "create"
    });
  }
  if ($("referenceExportCsvButton")) {
    decorateCapabilityAction($("referenceExportCsvButton"), {
      actionId: "reference_data." + referenceActionNamespace(definition) + ".export_csv",
      label: "Export " + referenceExportLabel(definition),
      area: "Reference Data",
      requiredAny: definitionViewCapabilities(definition),
      actionType: "export"
    });
  }
  if ($("referenceExportXlsxButton")) {
    decorateCapabilityAction($("referenceExportXlsxButton"), {
      actionId: "reference_data." + referenceActionNamespace(definition) + ".export_xlsx",
      label: "Export " + referenceExportLabel(definition),
      area: "Reference Data",
      requiredAny: definitionViewCapabilities(definition),
      actionType: "export"
    });
  }
  if ($("referenceSaveButton")) {
    const isRuleSets = isUnsociableRuleSetsDefinition(definition);
    const isUnsociableRules = isUnsociableTimeRulesDefinition(definition);
    decorateCapabilityAction($("referenceSaveButton"), {
      actionId: isWorkTimeProfiles
        ? "reference_data.work_time_profiles.working_time_alignment.save"
        : isRuleSets
          ? "reference_data.unsociable_rule_sets.save"
          : isUnsociableRules
            ? "reference_data.unsociable_time_rules.save"
            : "reference_data." + referenceActionNamespace(definition) + ".save",
      label: isWorkTimeProfiles
        ? "Save Work Time Profile alignment"
        : isRuleSets
          ? "Save Unsociable Rule Set"
          : isUnsociableRules
            ? "Save Unsociable Time Rule"
            : "Save Reference Data Record",
      area: "Reference Data",
      requiredAny: definitionEditCapabilities(definition),
      actionType: "save"
    });
  }
  syncReferenceEntityNavigation();
}

function recordSearchText(record, definition) {
  const fieldText = definition.fields
    .map(field => {
      if (field.type === "lookup") return lookupLabel(field.lookup, record[field.key]);
      const value = record[field.key];
      return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value || "");
    })
    .join(" ")
    .toLowerCase();

  return fieldText + (record.active ? " active" : " inactive");
}

function includeInactiveWorkTimeProfiles() {
  const control = $("referenceIncludeInactive");
  return Boolean(control && control.checked);
}

async function loadWorkTimeProfiles(requestedEntityKey, definition) {
  setListStatus("Loading " + definition.plural.toLowerCase() + "...");
  $("referenceResults").replaceChildren();
  $("referenceEmptyState").classList.add("hidden");

  try {
    await loadReferenceLookups(definition);
    const result = await supabaseClient.rpc("list_work_time_profiles_with_break_alignment", {
      p_include_inactive: includeInactiveWorkTimeProfiles(),
      p_search_text: null
    });

    if (result.error) throw result.error;
    if (requestedEntityKey !== currentEntityKey) return;

    referenceCache[requestedEntityKey] = (result.data || []).map(normaliseWorkTimeProfileRecord);
    renderReferenceDataList();
  } catch (err) {
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = [];
    renderReferenceDataList();
    setListStatus(definition.plural + " could not be loaded.");
    showToast("Work Time Profiles load failed", err.message || "Could not load work time profiles.", "error");
  }
}

async function loadBreakRules(requestedEntityKey, definition) {
  setListStatus("Loading " + definition.plural.toLowerCase() + "...");
  $("referenceResults").replaceChildren();
  $("referenceEmptyState").classList.add("hidden");

  try {
    const result = await supabaseClient.rpc("list_break_rules_with_paid_unpaid", {
      p_include_inactive: includeInactiveWorkTimeProfiles(),
      p_search_text: null
    });
    if (result.error) throw result.error;
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = (result.data || []).map(normaliseBreakRuleRecord);
    renderReferenceDataList();
  } catch (err) {
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = [];
    renderReferenceDataList();
    setListStatus(definition.plural + " could not be loaded.");
    showToast("Break Rules load failed", err.message || "Could not load break rules.", "error");
  }
}

async function loadUnsociableTimeRules(requestedEntityKey, definition) {
  setListStatus("Loading " + definition.plural.toLowerCase() + "...");
  $("referenceResults").replaceChildren();
  $("referenceEmptyState").classList.add("hidden");

  try {
    const result = await supabaseClient.rpc("list_unsociable_time_rules", {
      p_include_inactive: includeInactiveWorkTimeProfiles(),
      p_search_text: null
    });
    if (result.error) throw result.error;
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = (result.data || []).map(normaliseUnsociableTimeRuleRecord);
    renderReferenceDataList();
  } catch (err) {
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = [];
    renderReferenceDataList();
    setListStatus(definition.plural + " could not be loaded.");
    showToast("Unsociable Time Rules load failed", err.message || "Could not load unsociable time rules.", "error");
  }
}

async function loadUnsociableRuleSets(requestedEntityKey, definition) {
  setListStatus("Loading " + definition.plural.toLowerCase() + "...");
  $("referenceResults").replaceChildren();
  $("referenceEmptyState").classList.add("hidden");

  try {
    const result = await supabaseClient.rpc("list_unsociable_time_rule_sets", {
      p_include_inactive: includeInactiveWorkTimeProfiles(),
      p_search_text: null
    });
    if (result.error) throw result.error;
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = (result.data || []).map(normaliseUnsociableRuleSetRecord);
    renderReferenceDataList();
  } catch (err) {
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = [];
    renderReferenceDataList();
    setListStatus(definition.plural + " could not be loaded.");
    showToast("Unsociable Rule Sets load failed", err.message || "Could not load unsociable rule sets.", "error");
  }
}

function breakRuleSearchText(record) {
  return [
    record.rule_code,
    record.rule_name,
    record.paid_break_minutes,
    record.unpaid_break_minutes,
    record.total_break_minutes,
    record.active ? "active" : "inactive",
    record.notes
  ].join(" ").toLowerCase();
}

function unsociableTimeRuleSearchText(record) {
  return [
    record.rule_code,
    record.rule_name,
    unsociableTimeBandText(record),
    unsociableDaysText(record),
    unsociableDayApplicationModeText(record),
    record.active ? "active" : "inactive",
    record.notes
  ].join(" ").toLowerCase();
}

function unsociableRuleSetSearchText(record) {
  return [
    record.rule_set_code,
    record.rule_set_name,
    record.rule_count,
    record.rule_summary,
    record.active ? "active" : "inactive",
    record.notes
  ].join(" ").toLowerCase();
}

function workTimeProfileSearchText(record) {
  return [
    record.profile_name,
    record.profile_code,
    formatReferenceTime(record.start_time),
    formatReferenceTime(record.end_time),
    record.crosses_midnight ? "overnight crosses midnight night" : "day",
    record.break_rule_label,
    record.break_rule_paid_break ? "paid break" : "unpaid break",
    record.unsociable_rule_set_name,
    record.unsociable_rule_set_summary,
    record.effective_break_minutes,
    record.gross_hours,
    record.calculated_paid_hours,
    record.calculated_unsociable_hours,
    record.paid_hours_manual_override ? "manual override manual paid hours" : "calculated paid hours",
    record.unsociable_hours_manual_override ? "manual override manual unsociable hours" : "calculated unsociable hours",
    record.break_minutes,
    record.legacy_break_minutes,
    record.paid_hours,
    record.unsociable_hours,
    record.custom_tag_1,
    record.custom_tag_2,
    record.custom_tag_3,
    record.active ? "active" : "inactive",
    record.notes
  ].join(" ").toLowerCase();
}

function filteredWorkTimeProfiles() {
  const records = referenceCache[currentEntityKey] || [];
  const query = $("referenceSearch").value.trim().toLowerCase();
  return records.filter(record => !query || workTimeProfileSearchText(record).includes(query));
}

function renderWorkTimeProfileList() {
  const definition = currentDefinition();
  const filtered = filteredWorkTimeProfiles();
  const tableHead = $("referenceTableHead");
  tableHead.replaceChildren();

  definition.columns.forEach(column => {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = column.label;
    tableHead.appendChild(heading);
  });

  const statusHeading = document.createElement("th");
  statusHeading.scope = "col";
  statusHeading.textContent = "Status";
  tableHead.appendChild(statusHeading);

  const actionHeading = document.createElement("th");
  actionHeading.scope = "col";
  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "sr-only";
  hiddenLabel.textContent = "Actions";
  actionHeading.appendChild(hiddenLabel);
  tableHead.appendChild(actionHeading);

  const body = $("referenceResults");
  body.replaceChildren();

  filtered.forEach(record => {
    const row = document.createElement("tr");
    definition.columns.forEach(column => {
      if (column.format === "workTimeProfileProfile") row.appendChild(createWorkTimeProfileProfileCell(record));
      else if (column.format === "workTimeProfileTimes") row.appendChild(createWorkTimeProfileTimeCell(record));
      else if (column.format === "workTimeTags") row.appendChild(createWorkTimeProfileTagsCell(record));
      else if (column.format === "workTimeProfileHours") row.appendChild(createWorkTimeProfileHoursCell(record));
      else if (column.format === "workTimeProfileUnsociable") row.appendChild(createWorkTimeProfileUnsociableCell(record));
      else if (column.format === "workTimeProfileRuleSet") row.appendChild(createWorkTimeProfileRuleSetCell(record));
      else if (column.key === "break_rule_label") row.appendChild(createWorkTimeProfileBreakCell(record));
      else row.appendChild(createTextCell(formatValue(record, column)));
    });

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "people-status " + (record.active ? "active" : "inactive");
    status.textContent = record.active ? "Active" : "Inactive";
    statusCell.appendChild(status);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "reference-row-actions";
    if (hasReferenceDataEditAccess()) {
      const editButton = document.createElement("button");
      editButton.className = "ghost";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.setAttribute("aria-label", "Edit " + (record.profile_name || "work time profile"));
      decorateCapabilityAction(editButton, {
        actionId: "reference_data.work_time_profiles.break_alignment.edit",
        label: "Edit Work Time Profile break alignment",
        area: "Reference Data",
        requiredAny: definitionEditCapabilities(definition),
        actionType: "edit"
      });
      editButton.addEventListener("click", () => openReferenceDataPanel(record.id));
      actionCell.appendChild(editButton);
    } else {
      const viewButton = document.createElement("button");
      viewButton.className = "ghost";
      viewButton.type = "button";
      viewButton.textContent = "View";
      viewButton.setAttribute("aria-label", "View " + (record.profile_name || "work time profile") + " break alignment");
      decorateCapabilityAction(viewButton, {
        actionId: "reference_data.work_time_profiles.break_alignment.view",
        label: "View Work Time Profile break alignment",
        area: "Reference Data",
        requiredAny: definitionViewCapabilities(definition),
        actionType: "view"
      });
      viewButton.addEventListener("click", () => openWorkTimeProfileAlignmentDetails(record.id, viewButton));
      actionCell.appendChild(viewButton);
    }
    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $("referenceEmptyState").classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    renderEmptyState("referenceEmptyState", {
      title: "No work time profiles found",
      description: $("referenceSearch").value.trim()
        ? "Try a different profile name, code, time, note or tag."
        : hasReferenceDataEditAccess()
          ? "Create a work time profile to reuse daily working-time settings on assignments."
          : "No work time profiles are available."
    });
  }

  setListStatus(filtered.length + " work time profile" + (filtered.length === 1 ? "" : "s") + " shown.");
}

function workTimeProfileExportRows() {
  return filteredWorkTimeProfiles().map(record => ({
    "Profile Name": record.profile_name || "",
    "Profile Code": record.profile_code || "",
    "Start Time": formatReferenceTime(record.start_time),
    "End Time": formatReferenceTime(record.end_time),
    "Crosses Midnight": record.crosses_midnight ? "Yes" : "No",
    "break_rule_id": record.break_rule_id || "",
    "break_rule_label": record.break_rule_label || "",
    "break_rule_paid_minutes": record.break_rule_paid_minutes ?? "",
    "break_rule_unpaid_minutes": record.break_rule_unpaid_minutes ?? "",
    "break_rule_total_minutes": record.break_rule_total_minutes ?? "",
    "legacy_break_minutes": record.legacy_break_minutes ?? record.break_minutes ?? "",
    "effective_paid_break_minutes": record.effective_paid_break_minutes ?? "",
    "effective_unpaid_break_minutes": record.effective_unpaid_break_minutes ?? "",
    "effective_break_minutes": record.effective_break_minutes ?? "",
    "gross_hours": formatReferenceHours(record.gross_hours),
    "calculated_paid_hours": formatReferenceHours(record.calculated_paid_hours),
    "paid_hours_manual_override": record.paid_hours_manual_override ? "Yes" : "No",
    "paid_hours": formatReferenceHours(record.paid_hours),
    "unsociable_rule_set_id": record.unsociable_rule_set_id || "",
    "unsociable_rule_set_code": record.unsociable_rule_set_code || "",
    "unsociable_rule_set_name": record.unsociable_rule_set_name || "",
    "unsociable_rule_set_summary": record.unsociable_rule_set_summary || "",
    "suggested_paid_unsociable_hours": formatReferenceHours(record.calculated_unsociable_hours),
    "unsociable_hours_manual_override": record.unsociable_hours_manual_override ? "Yes" : "No",
    "final_paid_unsociable_hours": formatReferenceHours(record.unsociable_hours),
    "tags": workTimeProfileTags(record).join(" | "),
    "Tag 1": record.custom_tag_1 || "",
    "Tag 2": record.custom_tag_2 || "",
    "Tag 3": record.custom_tag_3 || "",
    "active": record.active ? "Yes" : "No",
    "Display Order": record.display_order ?? "",
    "Break Alignment Notes": record.break_alignment_notes || "",
    "Unsociable Alignment Notes": record.unsociable_alignment_notes || "",
    "Notes": record.notes || ""
  }));
}

function filteredBreakRules() {
  const query = $("referenceSearch").value.trim().toLowerCase();
  return (referenceCache[currentEntityKey] || [])
    .filter(record => !query || breakRuleSearchText(record).includes(query));
}

function filteredUnsociableTimeRules() {
  const query = $("referenceSearch").value.trim().toLowerCase();
  return (referenceCache[currentEntityKey] || [])
    .filter(record => !query || unsociableTimeRuleSearchText(record).includes(query));
}

function filteredUnsociableRuleSets() {
  const query = $("referenceSearch").value.trim().toLowerCase();
  return (referenceCache[currentEntityKey] || [])
    .filter(record => !query || unsociableRuleSetSearchText(record).includes(query));
}

function breakRuleExportRows() {
  return filteredBreakRules().map(record => ({
    "Rule Code": record.rule_code || "",
    "Rule Name": record.rule_name || "",
    "Paid Break Minutes": record.paid_break_minutes ?? "",
    "Unpaid Break Minutes": record.unpaid_break_minutes ?? "",
    "Total Break Minutes": record.total_break_minutes ?? "",
    "Active": record.active ? "Yes" : "No",
    "Display Order": record.display_order ?? "",
    "Notes": record.notes || ""
  }));
}

function unsociableTimeRuleExportRows() {
  return filteredUnsociableTimeRules().map(record => ({
    "Rule Code": record.rule_code || "",
    "Rule Name": record.rule_name || "",
    "Start Time": formatReferenceTime(record.start_time),
    "End Time": formatReferenceTime(record.end_time),
    "Crosses Midnight": record.crosses_midnight ? "Yes" : "No",
    "Full Day": record.full_day ? "Yes" : "No",
    "Day Application Mode": unsociableDayApplicationModeText(record),
    "Applies Monday": record.applies_monday ? "Yes" : "No",
    "Applies Tuesday": record.applies_tuesday ? "Yes" : "No",
    "Applies Wednesday": record.applies_wednesday ? "Yes" : "No",
    "Applies Thursday": record.applies_thursday ? "Yes" : "No",
    "Applies Friday": record.applies_friday ? "Yes" : "No",
    "Applies Saturday": record.applies_saturday ? "Yes" : "No",
    "Applies Sunday": record.applies_sunday ? "Yes" : "No",
    "Active Days": unsociableDaysText(record),
    "Active": record.active ? "Yes" : "No",
    "Display Order": record.display_order ?? "",
    "Notes": record.notes || ""
  }));
}

function unsociableRuleSetExportRows() {
  return filteredUnsociableRuleSets().map(record => ({
    "Rule Set Code": record.rule_set_code || "",
    "Rule Set Name": record.rule_set_name || "",
    "Active": record.active ? "Yes" : "No",
    "Rule Count": record.rule_count ?? "",
    "Rule Summary": record.rule_summary || "",
    "Display Order": record.display_order ?? "",
    "Notes": record.notes || ""
  }));
}

function exportableReferenceRows() {
  if (isWorkTimeProfilesDefinition()) return workTimeProfileExportRows();
  if (isBreakRulesDefinition()) return breakRuleExportRows();
  if (isUnsociableTimeRulesDefinition()) return unsociableTimeRuleExportRows();
  if (isUnsociableRuleSetsDefinition()) return unsociableRuleSetExportRows();
  return [];
}

function referenceExportBaseName() {
  if (isWorkTimeProfilesDefinition()) return "work-time-profiles";
  if (isBreakRulesDefinition()) return "break-rules";
  if (isUnsociableTimeRulesDefinition()) return "unsociable-time-rules";
  if (isUnsociableRuleSetsDefinition()) return "unsociable-rule-sets";
  return "reference-data";
}

export function exportReferenceDataCsv() {
  const rows = exportableReferenceRows();
  if (!rows.length) {
    showToast("Nothing to export", "No " + currentDefinition().plural + " match the current filters.", "error");
    return;
  }
  downloadCsv(referenceExportBaseName() + "-" + exportDateStamp() + ".csv", rows);
  showToast("Export started", currentDefinition().plural + " CSV export is being downloaded.", "success");
}

export function exportReferenceDataXlsx() {
  const rows = exportableReferenceRows();
  if (!rows.length) {
    showToast("Nothing to export", "No " + currentDefinition().plural + " match the current filters.", "error");
    return;
  }
  downloadXlsx(
    referenceExportBaseName() + "-" + exportDateStamp() + ".xlsx",
    rows,
    referenceExportLabel()
  );
  showToast("Export started", currentDefinition().plural + " Excel export is being downloaded.", "success");
}

export function handleReferenceSearchInput() {
  renderReferenceDataList();
}

export async function openReferenceDataWorkspace() {
  if (!requireReferenceDataAccess()) return;
  registerReferenceDataSections();
  showAdministrationWorkspace();
  showReferenceDataAdministrationSection();
  if (!canViewDefinition(currentDefinition())) {
    currentEntityKey = Object.keys(entityDefinitions)
      .find(key => canViewDefinition(entityDefinitions[key])) || currentEntityKey;
  }
  $("referenceCreateButton").classList.toggle("hidden", !hasReferenceDataEditAccess());
  closeReferenceDataPanel();
  await selectReferenceEntity(currentEntityKey);
}

export async function selectReferenceEntity(entityKey) {
  if (!entityDefinitions[entityKey] || !requireReferenceDataAccess()) return;
  if (!requireReferenceEntityAccess(entityDefinitions[entityKey])) return;
  currentEntityKey = entityKey;
  $("referenceSearch").value = "";
  closeReferenceDataPanel();
  updateReferencePageLabels();
  renderReferenceFormFields();
  await loadReferenceData();
}

export async function loadReferenceData() {
  if (!requireReferenceDataAccess()) return;

  const requestedEntityKey = currentEntityKey;
  const definition = entityDefinitions[requestedEntityKey];
  if (!requireReferenceEntityAccess(definition)) return;
  if (isWorkTimeProfilesDefinition(definition)) {
    await loadWorkTimeProfiles(requestedEntityKey, definition);
    return;
  }
  if (isBreakRulesDefinition(definition)) {
    await loadBreakRules(requestedEntityKey, definition);
    return;
  }
  if (isUnsociableTimeRulesDefinition(definition)) {
    await loadUnsociableTimeRules(requestedEntityKey, definition);
    return;
  }
  if (isUnsociableRuleSetsDefinition(definition)) {
    await loadUnsociableRuleSets(requestedEntityKey, definition);
    return;
  }
  setListStatus("Loading " + definition.plural.toLowerCase() + "…");
  $("referenceResults").replaceChildren();
  $("referenceEmptyState").classList.add("hidden");

  try {
    await loadReferenceLookups(definition);
    const result = await supabaseClient
      .from(definition.table)
      .select(definitionColumns(definition))
      .order(definition.orderBy, { ascending: true });

    if (result.error) throw result.error;
    if (requestedEntityKey !== currentEntityKey) return;

    referenceCache[requestedEntityKey] = result.data || [];
    renderReferenceDataList();
  } catch (err) {
    if (requestedEntityKey !== currentEntityKey) return;
    referenceCache[requestedEntityKey] = [];
    renderReferenceDataList();
    setListStatus(definition.plural + " could not be loaded.");
    showToast("Reference data load failed", err.message || "Could not load reference data.", "error");
  }
}

export function renderReferenceDataList() {
  const definition = currentDefinition();
  if (isWorkTimeProfilesDefinition(definition)) {
    renderWorkTimeProfileList();
    return;
  }
  const records = referenceCache[currentEntityKey] || [];
  const query = $("referenceSearch").value.trim().toLowerCase();
  const filtered = records.filter(record => {
    if (!query) return true;
    if (isBreakRulesDefinition(definition)) return breakRuleSearchText(record).includes(query);
    if (isUnsociableTimeRulesDefinition(definition)) return unsociableTimeRuleSearchText(record).includes(query);
    if (isUnsociableRuleSetsDefinition(definition)) return unsociableRuleSetSearchText(record).includes(query);
    return recordSearchText(record, definition).includes(query);
  });

  const tableHead = $("referenceTableHead");
  tableHead.replaceChildren();
  definition.columns.forEach(column => {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = column.label;
    tableHead.appendChild(heading);
  });

  const statusHeading = document.createElement("th");
  statusHeading.scope = "col";
  statusHeading.textContent = "Status";
  tableHead.appendChild(statusHeading);

  const actionHeading = document.createElement("th");
  actionHeading.scope = "col";
  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "sr-only";
  hiddenLabel.textContent = "Actions";
  actionHeading.appendChild(hiddenLabel);
  tableHead.appendChild(actionHeading);

  const body = $("referenceResults");
  body.replaceChildren();

  filtered.forEach(record => {
    const row = document.createElement("tr");
    const recordLabel = String(record[definition.orderBy] || definition.singular);
    definition.columns.forEach(column => {
      row.appendChild(createTextCell(formatValue(record, column)));
    });

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "people-status " + (record.active ? "active" : "inactive");
    status.textContent = record.active ? "Active" : "Inactive";
    statusCell.appendChild(status);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "reference-row-actions";

    const editButton = document.createElement("button");
    editButton.className = "ghost";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", "Edit " + recordLabel);
    if (isBreakRulesDefinition(definition)) {
      decorateCapabilityAction(editButton, {
        actionId: "reference_data.break_rules.edit",
        label: "Create/Edit Break Rule",
        area: "Reference Data",
        requiredAny: definitionEditCapabilities(definition),
        actionType: "edit"
      });
    } else if (isUnsociableTimeRulesDefinition(definition)) {
      decorateCapabilityAction(editButton, {
        actionId: "reference_data.unsociable_time_rules.edit",
        label: "Create/Edit Unsociable Time Rule",
        area: "Reference Data",
        requiredAny: definitionEditCapabilities(definition),
        actionType: "edit"
      });
    } else if (isUnsociableRuleSetsDefinition(definition)) {
      decorateCapabilityAction(editButton, {
        actionId: "reference_data.unsociable_rule_sets.edit",
        label: "Create/Edit Unsociable Rule Set",
        area: "Reference Data",
        requiredAny: definitionEditCapabilities(definition),
        actionType: "edit"
      });
    }
    editButton.addEventListener("click", () => openReferenceDataPanel(record.id));
    if (hasReferenceDataEditAccess()) {
      actionCell.appendChild(editButton);
    } else if (isUnsociableTimeRulesDefinition(definition) || isUnsociableRuleSetsDefinition(definition)) {
      const viewButton = document.createElement("button");
      viewButton.className = "ghost";
      viewButton.type = "button";
      viewButton.textContent = "View";
      viewButton.setAttribute("aria-label", "View " + recordLabel);
      const isTimeRules = isUnsociableTimeRulesDefinition(definition);
      decorateCapabilityAction(viewButton, {
        actionId: isTimeRules
          ? "reference_data.unsociable_time_rules.view"
          : "reference_data.unsociable_rule_sets.view",
        label: isTimeRules
          ? "View Unsociable Time Rules"
          : "View Unsociable Rule Sets",
        area: "Reference Data",
        requiredAny: definitionViewCapabilities(definition),
        actionType: "view"
      });
      viewButton.addEventListener("click", () => openReferenceDataPanel(record.id, { readOnly: true }));
      actionCell.appendChild(viewButton);
    }

    const activeButton = document.createElement("button");
    activeButton.className = "secondary";
    activeButton.type = "button";
    activeButton.textContent = record.active ? "Deactivate" : "Activate";
    activeButton.setAttribute(
      "aria-label",
      (record.active ? "Deactivate " : "Activate ") + recordLabel
    );
    activeButton.addEventListener("click", () => setReferenceRecordActive(record.id, !record.active));
    if (hasReferenceDataEditAccess()) actionCell.appendChild(activeButton);

    if (!hasReferenceDataEditAccess() && !actionCell.childElementCount) actionCell.textContent = "Read only";

    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $("referenceEmptyState").classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    renderEmptyState("referenceEmptyState", {
      title: "No " + definition.plural.toLowerCase() + " found",
      description: query
        ? "Try a different code or name."
        : hasReferenceDataEditAccess()
          ? "Create the first " + definition.singular.toLowerCase() +
            " to establish this reference list."
          : "No " + definition.plural.toLowerCase() + " are available."
    });
  }
  setListStatus(filtered.length + " of " + records.length + " records shown.");
}

function setReferencePanelReadOnly(readOnly) {
  const form = $("referenceDataForm");
  if (!form) return;
  form.querySelectorAll("input, select, textarea").forEach(control => {
    if (control.id === "referenceRecordId") return;
    control.disabled = readOnly;
  });
  if ($("referenceSaveButton")) $("referenceSaveButton").classList.toggle("hidden", readOnly);
  if ($("referenceClearButton")) $("referenceClearButton").classList.toggle("hidden", readOnly);
}

function openWorkTimeProfileAlignmentDetails(recordId) {
  openReferenceDataPanel(recordId, { readOnly: true });
}

export function openReferenceDataPanel(recordId, options = {}) {
  const readOnly = options.readOnly === true;
  if (!readOnly && !requireReferenceDataEditAccess()) return;
  if (readOnly && !requireReferenceEntityAccess(currentDefinition())) return;

  workTimeProfileUnsociablePreviewRows = [];
  clearReferenceForm();
  const definition = currentDefinition();
  const record = (referenceCache[currentEntityKey] || []).find(item => item.id === recordId);

  if (record) {
    $("referenceRecordId").value = record.id;
    definition.fields.forEach(field => {
      const control = $("referenceField_" + field.key);
      const value = record[field.key];
      if (field.type === "json") {
        control.value = value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
      } else if (field.boolean) {
        control.value = value ? "true" : "false";
      } else {
        control.value = value === null || value === undefined ? "" : String(value);
      }
    });
    $("referenceRecordActive").value = record.active === false ? "false" : "true";
    $("referencePanelTitle").textContent = readOnly ? "View " + definition.singular : "Edit " + definition.singular;
    syncDerivedCycleLength(false);
    if (isBreakRulesDefinition(definition)) syncBreakRuleTotalMinutes();
    if (isUnsociableTimeRulesDefinition(definition)) syncUnsociableTimeRuleFullDay();
    if (isWorkTimeProfilesDefinition(definition)) updateWorkTimeProfileCalculationPreview();
  }

  $("referenceDataPanel").classList.remove("hidden");
  $("referenceDataPanel").setAttribute("aria-hidden", "false");
  if (isWorkTimeProfilesDefinition(definition)) {
    renderWorkTimeProfileUnsociablePreview(record ? record.id : "");
    if (record) void loadWorkTimeProfileUnsociablePreview(record.id);
  }
  if (isUnsociableRuleSetsDefinition(definition)) {
    void loadUnsociableRuleSetRulePicker(record ? record.id : "", readOnly)
      .catch(err => showToast(
        "Rule set rules not loaded",
        err.message || "Could not load rules for this set.",
        "error"
      ));
  }
  setReferencePanelReadOnly(readOnly);
  if (!readOnly && isUnsociableTimeRulesDefinition(definition)) syncUnsociableTimeRuleFullDay();
  const firstControl = $("referenceFormFields").querySelector("input, select, textarea");
  if (firstControl) setTimeout(() => firstControl.focus(), 0);
}

export function closeReferenceDataPanel() {
  $("referenceDataPanel").classList.add("hidden");
  $("referenceDataPanel").setAttribute("aria-hidden", "true");
}

export function clearReferenceForm() {
  workTimeProfileUnsociablePreviewRows = [];
  renderReferenceFormFields();
  const definition = currentDefinition();
  $("referenceRecordId").value = "";
  $("referenceRecordActive").value = "true";
  $("referencePanelTitle").textContent = "Create " + definition.singular;
  setReferencePanelReadOnly(false);

  definition.fields.forEach(field => {
    const control = $("referenceField_" + field.key);
    if (field.defaultValue !== undefined) control.value = String(field.defaultValue);
  });
  if (isBreakRulesDefinition(definition)) syncBreakRuleTotalMinutes();
  if (isUnsociableTimeRulesDefinition(definition)) syncUnsociableTimeRuleFullDay();
  if (isWorkTimeProfilesDefinition(definition)) updateWorkTimeProfileCalculationPreview();
  if (isUnsociableRuleSetsDefinition(definition)) {
    void loadUnsociableRuleSetRulePicker("")
      .catch(err => showToast(
        "Rule set rules not loaded",
        err.message || "Could not load unsociable rules.",
        "error"
      ));
  }
}

function fieldValue(field) {
  const control = $("referenceField_" + field.key);
  const rawValue = control.value.trim();

  if (field.required && rawValue === "") {
    throw new Error(field.label + " is required.");
  }

  if (rawValue === "") return field.allowEmptyString ? "" : null;

  if (field.type === "number") {
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) throw new Error(field.label + " must be a number.");
    if (field.min !== undefined && numberValue < field.min) {
      throw new Error(field.label + " must be at least " + field.min + ".");
    }
    if (field.max !== undefined && numberValue > field.max) {
      throw new Error(field.label + " must be no more than " + field.max + ".");
    }
    return numberValue;
  }

  if (field.type === "json") {
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(field.label + " must contain valid JSON.");
    }
  }

  if (field.boolean) return rawValue === "true";
  if (field.normalise === "code") {
    const value = normaliseBusinessCode(rawValue);
    control.value = value || "";
    return value;
  }
  if (field.normalise === "title") {
    const value = titleCaseText(rawValue);
    control.value = value;
    return value;
  }
  return rawValue;
}

function buildWorkTimeProfilePayload() {
  const payload = {};
  currentDefinition().fields.forEach(field => {
    payload[field.key] = fieldValue(field);
  });
  payload.active = $("referenceRecordActive").value === "true";
  payload.paid_hours_manual_override = payload.paid_hours_manual_override !== false;

  if (payload.unsociable_hours === null) payload.unsociable_hours = 0;
  if (payload.break_minutes === null) payload.break_minutes = 0;
  if (payload.display_order === null) payload.display_order = 0;
  if (payload.profile_code) payload.profile_code = normaliseWorkTimeProfileCode(payload.profile_code);
  if (!payload.profile_code) payload.profile_code = normaliseWorkTimeProfileCode(payload.profile_name);

  payload.calculation = calculateWorkTimeProfilePreviewValues();
  if (!payload.paid_hours_manual_override) {
    if (payload.calculation.calculatedPaidHours === null) {
      throw new Error("Start time and end time are required before calculated paid hours can be used.");
    }
    payload.paid_hours = payload.calculation.calculatedPaidHours;
  }
  if (payload.paid_hours_manual_override && payload.paid_hours === null) {
    throw new Error("Manual paid hours is required when manual paid hours mode is selected.");
  }
  payload.unsociable_hours_manual_override = payload.unsociable_hours_manual_override !== false;
  if (!payload.unsociable_hours_manual_override) {
    if (payload.calculation.calculatedUnsociableHours !== null) {
      payload.unsociable_hours = payload.calculation.calculatedUnsociableHours;
    }
  }
  if (payload.unsociable_hours_manual_override && payload.unsociable_hours === null) {
    throw new Error("Manual paid unsociable hours is required when manual mode is selected.");
  }

  if (payload.unsociable_hours > payload.paid_hours) {
    throw new Error("Final paid unsociable hours cannot exceed final paid working hours.");
  }
  if (
    payload.start_time &&
    payload.end_time &&
    payload.end_time < payload.start_time &&
    !payload.crosses_midnight
  ) {
    payload.crosses_midnight = true;
    $("referenceField_crosses_midnight").value = "true";
    showToast(
      "Profile marked overnight",
      "End time is earlier than start time, so Crosses Midnight was set to Yes.",
      "warning"
    );
  }

  return payload;
}

async function saveWorkTimeProfileBreakAlignment(profileId, payload) {
  const result = await supabaseClient.rpc("update_work_time_profile_break_alignment", {
    p_profile_id: profileId,
    p_break_rule_id: payload.break_rule_id || null,
    p_use_break_rule: Boolean(payload.break_rule_id),
    p_legacy_break_minutes: payload.break_minutes,
    p_paid_hours_manual_override: payload.paid_hours_manual_override,
    p_paid_hours: payload.paid_hours,
    p_break_alignment_notes: payload.break_alignment_notes || null,
    p_unsociable_rule_set_id: payload.unsociable_rule_set_id || null,
    p_unsociable_hours_manual_override: payload.unsociable_hours_manual_override,
    p_unsociable_hours: payload.unsociable_hours,
    p_unsociable_alignment_notes: payload.unsociable_alignment_notes || null
  });
  if (result.error) throw result.error;
  return result.data;
}

async function saveWorkTimeProfile() {
  if (!requireReferenceDataEditAccess()) return;

  const recordId = $("referenceRecordId").value;
  const previousRecord = recordId
    ? (referenceCache[currentEntityKey] || []).find(record => record.id === recordId) || null
    : null;
  let payload;

  try {
    payload = buildWorkTimeProfilePayload();
  } catch (err) {
    showToast("Work Time Profile not saved", err.message, "error");
    return;
  }

  const saveButton = $("referenceSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  const rpcName = recordId ? "update_work_time_profile" : "create_work_time_profile";
  const rpcPayload = {
    p_profile_code: payload.profile_code,
    p_profile_name: payload.profile_name,
    p_start_time: payload.start_time,
    p_end_time: payload.end_time,
    p_crosses_midnight: payload.crosses_midnight,
    p_break_minutes: payload.break_minutes,
    p_paid_hours: payload.paid_hours,
    p_unsociable_hours: payload.unsociable_hours,
    p_active: payload.active,
    p_display_order: payload.display_order,
    p_notes: payload.notes,
    p_custom_tag_1: payload.custom_tag_1,
    p_custom_tag_2: payload.custom_tag_2,
    p_custom_tag_3: payload.custom_tag_3,
    p_metadata: {}
  };
  if (recordId) rpcPayload.p_work_time_profile_id = recordId;

  try {
    const result = await supabaseClient.rpc(rpcName, rpcPayload);
    if (result.error) throw result.error;
    const savedRecord = Array.isArray(result.data) ? result.data[0] : result.data;
    const savedRecordId = workTimeProfileId(savedRecord);
    await saveWorkTimeProfileBreakAlignment(savedRecordId, payload);

    const auditFields = referenceAuditFields(currentDefinition());
    const changes = buildFieldDiff(
      referenceAuditRecord(previousRecord, auditFields),
      referenceAuditRecord(savedRecord, auditFields),
      auditFields
    );
    void writeAuditEvent(
      recordId ? "work_time_profile.updated" : "work_time_profile.created",
      "work_time_profiles",
      savedRecord.id,
      {
        entity_type: "workTimeProfiles",
        entity_id: savedRecord.id,
        display_name: savedRecord.profile_name,
        code: savedRecord.profile_code || null,
        old_active: previousRecord ? previousRecord.active : null,
        new_active: savedRecord.active,
        changes,
        summary: auditDiffSummary(changes)
      }
    );

    showToast(
      recordId ? "Work Time Profile updated" : "Work Time Profile created",
      "The profile was saved successfully.",
      "success"
    );
    closeReferenceDataPanel();
    await loadReferenceData();
  } catch (err) {
    showToast("Work Time Profile not saved", err.message || "Could not save this profile.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Record";
  }
}

function buildReferencePayloadFromFields(definition = currentDefinition()) {
  const payload = {
    active: $("referenceRecordActive").value === "true"
  };
  definition.fields.forEach(field => {
    payload[field.key] = fieldValue(field);
  });
  if (Object.prototype.hasOwnProperty.call(payload, "display_order") && payload.display_order === null) {
    payload.display_order = 0;
  }
  return payload;
}

async function upsertBreakRuleRecord(recordId, payload) {
  const result = await supabaseClient.rpc("upsert_break_rule_paid_unpaid", {
    p_break_rule_id: recordId || null,
    p_rule_code: payload.rule_code || null,
    p_rule_name: payload.rule_name,
    p_paid_break_minutes: payload.paid_break_minutes || 0,
    p_unpaid_break_minutes: payload.unpaid_break_minutes || 0,
    p_active: payload.active,
    p_display_order: payload.display_order,
    p_notes: payload.notes || null
  });
  if (result.error) throw result.error;
  return result.data;
}

async function upsertUnsociableTimeRuleRecord(recordId, payload) {
  const result = await supabaseClient.rpc("upsert_unsociable_time_rule", {
    p_rule_id: recordId || null,
    p_rule_code: payload.rule_code || null,
    p_rule_name: payload.rule_name,
    p_start_time: payload.start_time || "00:00",
    p_end_time: payload.end_time || "00:00",
    p_crosses_midnight: payload.crosses_midnight === true,
    p_full_day: payload.full_day === true,
    p_applies_monday: payload.applies_monday === true,
    p_applies_tuesday: payload.applies_tuesday === true,
    p_applies_wednesday: payload.applies_wednesday === true,
    p_applies_thursday: payload.applies_thursday === true,
    p_applies_friday: payload.applies_friday === true,
    p_applies_saturday: payload.applies_saturday === true,
    p_applies_sunday: payload.applies_sunday === true,
    p_active: payload.active,
    p_display_order: payload.display_order,
    p_notes: payload.notes || null,
    p_day_application_mode: payload.day_application_mode || "shift_start_day"
  });
  if (result.error) throw result.error;
  return result.data;
}

async function upsertUnsociableRuleSetRecord(recordId, payload) {
  const result = await supabaseClient.rpc("upsert_unsociable_time_rule_set", {
    p_rule_set_id: recordId || null,
    p_rule_set_code: payload.rule_set_code || null,
    p_rule_set_name: payload.rule_set_name,
    p_active: payload.active,
    p_display_order: payload.display_order,
    p_notes: payload.notes || null
  });
  if (result.error) throw result.error;
  return result.data;
}

async function setUnsociableRuleSetRules(ruleSetId, ruleIds) {
  const result = await supabaseClient.rpc("set_unsociable_time_rule_set_rules", {
    p_rule_set_id: ruleSetId,
    p_rule_ids: ruleIds
  });
  if (result.error) throw result.error;
  return result.data;
}

async function saveWorkingTimeRule() {
  if (!requireReferenceDataEditAccess()) return;

  const entityKey = currentEntityKey;
  const definition = currentDefinition();
  const recordId = $("referenceRecordId").value;
  const previousRecord = recordId
    ? (referenceCache[entityKey] || []).find(record => record.id === recordId) || null
    : null;
  let payload;

  try {
    payload = buildReferencePayloadFromFields(definition);
    if (isBreakRulesDefinition(definition)) {
      payload.total_break_minutes =
        Math.max(0, Number(payload.paid_break_minutes || 0)) +
        Math.max(0, Number(payload.unpaid_break_minutes || 0));
      if (payload.total_break_minutes <= 0) {
        throw new Error("Break Rule requires paid and/or unpaid break minutes.");
      }
    }
    if (isUnsociableTimeRulesDefinition(definition)) {
      if (payload.full_day) {
        payload.start_time = "00:00";
        payload.end_time = "00:00";
        payload.crosses_midnight = false;
      }
      if (!UNSOCIABLE_DAY_FIELDS.some(([key]) => payload[key])) {
        throw new Error("Unsociable Time Rule must apply to at least one day.");
      }
    }
    if (isUnsociableRuleSetsDefinition(definition)) {
      payload.rule_ids = selectedUnsociableRuleSetRuleIdsFromForm();
    }
  } catch (err) {
    showToast(definition.singular + " not saved", err.message, "error");
    return;
  }

  const saveButton = $("referenceSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    let savedId;
    if (isBreakRulesDefinition(definition)) {
      savedId = await upsertBreakRuleRecord(recordId, payload);
    } else if (isUnsociableTimeRulesDefinition(definition)) {
      savedId = await upsertUnsociableTimeRuleRecord(recordId, payload);
    } else {
      savedId = await upsertUnsociableRuleSetRecord(recordId, payload);
      await setUnsociableRuleSetRules(savedId, payload.rule_ids);
    }
    const auditFields = referenceAuditFields(definition);
    const auditRecord = { ...previousRecord, ...payload, id: savedId };
    const changes = buildFieldDiff(
      referenceAuditRecord(previousRecord, auditFields),
      referenceAuditRecord(auditRecord, auditFields),
      auditFields
    );
    void writeAuditEvent(
      recordId ? "reference_data.updated" : "reference_data.created",
      definition.table,
      savedId,
      {
        entity_type: entityKey,
        entity_id: savedId,
        display_name: payload[definition.orderBy] || definition.singular,
        code: referenceRecordCode(payload, definition),
        old_active: previousRecord ? previousRecord.active : null,
        new_active: payload.active,
        changes,
        summary: auditDiffSummary(changes)
      }
    );

    showToast(
      recordId ? definition.singular + " updated" : definition.singular + " created",
      "The reference record was saved successfully.",
      "success"
    );
    closeReferenceDataPanel();
    await loadReferenceData();
  } catch (err) {
    const duplicateCode = err && (
      err.code === "23505" ||
      /duplicate key|unique constraint|already exists/i.test(String(err.message || ""))
    );
    showToast(
      definition.singular + " not saved",
      duplicateCode
        ? "That business code is already in use. Enter a unique code."
        : (err.message || "Could not save this reference record."),
      "error"
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Record";
  }
}

export async function saveReferenceRecord() {
  if (!requireReferenceDataEditAccess()) return;
  if (isWorkTimeProfilesDefinition()) {
    await saveWorkTimeProfile();
    return;
  }
  if (isWorkingTimeRuleDefinition()) {
    await saveWorkingTimeRule();
    return;
  }

  const entityKey = currentEntityKey;
  const definition = currentDefinition();
  let payload;

  try {
    payload = buildReferencePayloadFromFields(definition);
  } catch (err) {
    showToast("Record not saved", err.message, "error");
    return;
  }

  const recordId = $("referenceRecordId").value;
  const previousRecord = recordId
    ? (referenceCache[entityKey] || []).find(record => record.id === recordId) || null
    : null;
  const saveButton = $("referenceSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  try {
    let query = supabaseClient.from(definition.table);
    query = recordId
      ? query.update(payload).eq("id", recordId)
      : query.insert(payload);

    const result = await query.select(definitionColumns(definition)).single();
    if (result.error) throw result.error;

    const auditFields = referenceAuditFields(definition);
    const changes = buildFieldDiff(
      referenceAuditRecord(previousRecord, auditFields),
      referenceAuditRecord(result.data, auditFields),
      auditFields
    );
    void writeAuditEvent(
      recordId ? "reference_data.updated" : "reference_data.created",
      definition.table,
      result.data.id,
      {
        entity_type: entityKey,
        entity_id: result.data.id,
        display_name: result.data[definition.orderBy] || definition.singular,
        code: referenceRecordCode(result.data, definition),
        old_active: previousRecord ? previousRecord.active : null,
        new_active: result.data.active,
        changes,
        summary: auditDiffSummary(changes)
      }
    );

    showToast(
      recordId ? definition.singular + " updated" : definition.singular + " created",
      "The reference record was saved successfully.",
      "success"
    );
    closeReferenceDataPanel();
    await loadReferenceData();
  } catch (err) {
    const duplicateCode = err && (
      err.code === "23505" ||
      /duplicate key|unique constraint|already exists/i.test(String(err.message || ""))
    );
    showToast(
      "Record not saved",
      duplicateCode
        ? "That business code is already in use. Enter a unique code."
        : (err.message || "Could not save this reference record."),
      "error"
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Record";
  }
}

export async function setReferenceRecordActive(recordId, active) {
  if (!requireReferenceDataEditAccess()) return;

  const entityKey = currentEntityKey;
  const definition = currentDefinition();
  const previousRecord = (referenceCache[entityKey] || [])
    .find(record => record.id === recordId) || null;
  if (!previousRecord) {
    showToast("Status not changed", "The selected record could not be found.", "error");
    return;
  }

  try {
    let resultData;
    if (isBreakRulesDefinition(definition)) {
      const payload = {
        ...previousRecord,
        active,
        display_order: previousRecord.display_order ?? null
      };
      const savedId = await upsertBreakRuleRecord(recordId, payload);
      resultData = { id: savedId, active };
    } else if (isUnsociableTimeRulesDefinition(definition)) {
      const payload = {
        ...previousRecord,
        active,
        display_order: previousRecord.display_order ?? null
      };
      const savedId = await upsertUnsociableTimeRuleRecord(recordId, payload);
      resultData = { id: savedId, active };
    } else if (isUnsociableRuleSetsDefinition(definition)) {
      const payload = {
        ...previousRecord,
        active,
        display_order: previousRecord.display_order ?? null
      };
      const savedId = await upsertUnsociableRuleSetRecord(recordId, payload);
      resultData = { id: savedId, active };
    } else {
      const result = await supabaseClient
        .from(definition.table)
        .update({ active })
        .eq("id", recordId)
        .select("id, active")
        .single();

      if (result.error) throw result.error;
      resultData = result.data;
    }

    const changes = buildFieldDiff(
      { active: previousRecord ? previousRecord.active : !active },
      { active: resultData.active },
      ["active"]
    );
    void writeAuditEvent(
      active ? "reference_data.activated" : "reference_data.deactivated",
      definition.table,
      resultData.id,
      {
        entity_type: entityKey,
        entity_id: resultData.id,
        display_name: previousRecord
          ? previousRecord[definition.orderBy] || definition.singular
          : definition.singular,
        code: referenceRecordCode(previousRecord, definition),
        old_active: previousRecord ? previousRecord.active : !active,
        new_active: resultData.active,
        changes,
        summary: auditDiffSummary(changes)
      }
    );

    showToast(
      active ? definition.singular + " activated" : definition.singular + " deactivated",
      "The record status was updated successfully.",
      "success"
    );
    await loadReferenceData();
  } catch (err) {
    showToast("Status not changed", err.message || "Could not update this record.", "error");
  }
}
