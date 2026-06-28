import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showAdministrationWorkspace } from "./shell.js";
import { AppState } from "./state.js";

const commonRecordColumns = ["id", "active", "notes", "created_at", "updated_at"];

const entityDefinitions = {
  sites: {
    table: "sites",
    singular: "Site",
    plural: "Sites",
    orderBy: "site_name",
    fields: [
      { key: "site_code", label: "Site Code" },
      { key: "site_name", label: "Site Name", required: true },
      { key: "timezone", label: "Timezone", required: true, defaultValue: "Europe/London" },
      { key: "address_line_1", label: "Address Line 1" },
      { key: "address_line_2", label: "Address Line 2" },
      { key: "town_city", label: "Town / City" },
      { key: "county_region", label: "County / Region" },
      { key: "postcode", label: "Postcode" },
      { key: "country", label: "Country", defaultValue: "United Kingdom" },
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
      { key: "department_code", label: "Department Code" },
      { key: "department_name", label: "Department Name", required: true },
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
      { key: "contract_code", label: "Contract Code" },
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
      { key: "role_code", label: "Role Code" },
      { key: "role_name", label: "Role Name", required: true },
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
      { key: "shift_code", label: "Shift Code" },
      { key: "shift_name", label: "Shift Name", required: true },
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
      { key: "static_weekdays", label: "Static Weekdays (JSON)", type: "json", help: "Optional JSON describing the static working weekdays." },
      { key: "cycle_pattern", label: "Cycle Pattern (JSON)", type: "json", help: "Optional JSON describing the rotating cycle." },
      { key: "cycle_length_days", label: "Cycle Length Days", type: "number", min: 1 },
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
    singular: "Break Rule",
    plural: "Break Rules",
    orderBy: "break_rule_name",
    fields: [
      { key: "break_rule_code", label: "Break Rule Code" },
      { key: "break_rule_name", label: "Break Rule Name", required: true },
      { key: "break_minutes", label: "Break Minutes", type: "number", required: true, min: 0, defaultValue: 0 },
      {
        key: "paid_break",
        label: "Paid Break",
        type: "select",
        defaultValue: "false",
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes" }
        ],
        boolean: true
      },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    columns: [
      { key: "break_rule_code", label: "Code" },
      { key: "break_rule_name", label: "Break Rule" },
      { key: "break_minutes", label: "Minutes" },
      { key: "paid_break", label: "Paid", format: "boolean" }
    ]
  }
};

const referenceCache = {};
const lookupCache = {
  sites: [],
  organisations: []
};

let currentEntityKey = "sites";

function currentDefinition() {
  return entityDefinitions[currentEntityKey];
}

function hasAdministrationAccess() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role === "super_user"
  );
}

function requireAdministrationAccess() {
  if (hasAdministrationAccess()) return true;
  showToast("Access denied", "Reference Data is currently available to SuperUsers only.", "error");
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
  if (column.format === "title") {
    return String(record[column.key] || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, character => character.toUpperCase()) || "—";
  }
  const value = record[column.key];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function createTextCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

async function loadReferenceLookups(definition) {
  const requiredLookups = [
    ...new Set(definition.fields.filter(field => field.lookup).map(field => field.lookup))
  ];

  await Promise.all(requiredLookups.map(async lookupName => {
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
  }));
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
    control.type = field.type === "number" ? "number" : "text";
    if (field.min !== undefined) control.min = String(field.min);
  }

  control.id = "referenceField_" + field.key;
  control.dataset.referenceField = field.key;
  if (field.required) control.required = true;
  return control;
}

function renderReferenceFormFields() {
  const definition = currentDefinition();
  const container = $("referenceFormFields");
  container.replaceChildren();

  definition.fields.forEach(field => {
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
}

function updateReferencePageLabels() {
  const definition = currentDefinition();
  $("referenceResultsTitle").textContent = definition.plural;
  $("referenceSearchEntityLabel").textContent = definition.plural.toLowerCase();
  $("referenceSearch").placeholder = "Search " + definition.plural.toLowerCase();
  $("referenceCreateButton").textContent = "Create " + definition.singular;

  document.querySelectorAll("[data-reference-entity]").forEach(button => {
    const selected = button.dataset.referenceEntity === currentEntityKey;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
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

export async function openReferenceDataWorkspace() {
  if (!requireAdministrationAccess()) return;
  showAdministrationWorkspace();
  closeReferenceDataPanel();
  await selectReferenceEntity(currentEntityKey);
}

export async function selectReferenceEntity(entityKey) {
  if (!entityDefinitions[entityKey] || !requireAdministrationAccess()) return;
  currentEntityKey = entityKey;
  $("referenceSearch").value = "";
  closeReferenceDataPanel();
  updateReferencePageLabels();
  renderReferenceFormFields();
  await loadReferenceData();
}

export async function loadReferenceData() {
  if (!requireAdministrationAccess()) return;

  const requestedEntityKey = currentEntityKey;
  const definition = entityDefinitions[requestedEntityKey];
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
  const records = referenceCache[currentEntityKey] || [];
  const query = $("referenceSearch").value.trim().toLowerCase();
  const filtered = records.filter(record => !query || recordSearchText(record, definition).includes(query));

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
    editButton.addEventListener("click", () => openReferenceDataPanel(record.id));
    actionCell.appendChild(editButton);

    const activeButton = document.createElement("button");
    activeButton.className = "secondary";
    activeButton.type = "button";
    activeButton.textContent = record.active ? "Deactivate" : "Activate";
    activeButton.setAttribute(
      "aria-label",
      (record.active ? "Deactivate " : "Activate ") + recordLabel
    );
    activeButton.addEventListener("click", () => setReferenceRecordActive(record.id, !record.active));
    actionCell.appendChild(activeButton);

    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $("referenceEmptyState").classList.toggle("hidden", filtered.length > 0);
  $("referenceEmptyState").textContent = query
    ? "No records match this search."
    : "No " + definition.plural.toLowerCase() + " found.";
  setListStatus(filtered.length + " of " + records.length + " records shown.");
}

export function openReferenceDataPanel(recordId) {
  if (!requireAdministrationAccess()) return;

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
    $("referencePanelTitle").textContent = "Edit " + definition.singular;
  }

  $("referenceDataPanel").classList.remove("hidden");
  $("referenceDataPanel").setAttribute("aria-hidden", "false");
  const firstControl = $("referenceFormFields").querySelector("input, select, textarea");
  if (firstControl) setTimeout(() => firstControl.focus(), 0);
}

export function closeReferenceDataPanel() {
  $("referenceDataPanel").classList.add("hidden");
  $("referenceDataPanel").setAttribute("aria-hidden", "true");
}

export function clearReferenceForm() {
  renderReferenceFormFields();
  const definition = currentDefinition();
  $("referenceRecordId").value = "";
  $("referenceRecordActive").value = "true";
  $("referencePanelTitle").textContent = "Create " + definition.singular;

  definition.fields.forEach(field => {
    const control = $("referenceField_" + field.key);
    if (field.defaultValue !== undefined) control.value = String(field.defaultValue);
  });
}

function fieldValue(field) {
  const control = $("referenceField_" + field.key);
  const rawValue = control.value.trim();

  if (field.required && rawValue === "") {
    throw new Error(field.label + " is required.");
  }

  if (rawValue === "") return null;

  if (field.type === "number") {
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) throw new Error(field.label + " must be a number.");
    if (field.min !== undefined && numberValue < field.min) {
      throw new Error(field.label + " must be at least " + field.min + ".");
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
  return rawValue;
}

export async function saveReferenceRecord() {
  if (!requireAdministrationAccess()) return;

  const definition = currentDefinition();
  const payload = {
    active: $("referenceRecordActive").value === "true"
  };

  try {
    definition.fields.forEach(field => {
      payload[field.key] = fieldValue(field);
    });
  } catch (err) {
    showToast("Record not saved", err.message, "error");
    return;
  }

  const recordId = $("referenceRecordId").value;
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

    showToast(
      recordId ? definition.singular + " updated" : definition.singular + " created",
      "The reference record was saved successfully.",
      "success"
    );
    closeReferenceDataPanel();
    await loadReferenceData();
  } catch (err) {
    showToast("Record not saved", err.message || "Could not save this reference record.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Record";
  }
}

export async function setReferenceRecordActive(recordId, active) {
  if (!requireAdministrationAccess()) return;

  const definition = currentDefinition();

  try {
    const result = await supabaseClient
      .from(definition.table)
      .update({ active })
      .eq("id", recordId)
      .select("id, active")
      .single();

    if (result.error) throw result.error;

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
