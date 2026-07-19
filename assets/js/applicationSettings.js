import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showAdministrationWorkspace } from "./shell.js";

const APPLICATION_SETTINGS_VIEW_CAPABILITIES = [
  "application_settings.view",
  "application_settings.manage",
  "settings.view",
  "settings.edit",
  "module_configuration.view",
  "module_configuration.manage",
  "access_control.manage"
];
const APPLICATION_SETTINGS_MANAGE_CAPABILITIES = [
  "application_settings.manage",
  "settings.edit",
  "module_configuration.manage",
  "access_control.manage"
];
const FIELD_REQUIREMENT_VIEW_CAPABILITIES = [
  "assignment_field_requirements.view",
  "assignment_field_requirements.manage",
  "application_settings.view",
  "application_settings.manage",
  "settings.view",
  "settings.edit",
  "work_time_profiles.view",
  "work_time_profiles.manage",
  "workforce_calendar.manage",
  "access_control.manage"
];
const FIELD_REQUIREMENT_MANAGE_CAPABILITIES = [
  "assignment_field_requirements.manage",
  "application_settings.manage",
  "work_time_profiles.manage",
  "workforce_calendar.manage",
  "settings.edit",
  "access_control.manage"
];

const SECTION_DEFINITIONS = [
  { id: "overview", title: "Overview", description: "A map of settings areas and migration status.", status: "Central workspace" },
  { id: "general", title: "General", description: "Product name, platform defaults and application-level behaviour.", category: "general" },
  { id: "branding", title: "Branding", description: "Brand identity and appearance settings.", category: "branding" },
  { id: "modules", title: "Modules", description: "Module availability and module-level configuration.", category: "modules", bridge: "modules" },
  { id: "visitors", title: "Visitors", description: "Visitor module settings and legacy VMS configuration.", category: "visitors", bridge: "visitors", status: "Legacy-backed" },
  { id: "shared_terminal", title: "Shared Terminal", description: "Trusted terminal and kiosk-device administration.", category: "visitors", bridge: "shared_terminal", status: "Linked" },
  { id: "documents", title: "Documents / Sign-off", description: "Document sign-off settings and compliance controls.", category: "documents", bridge: "documents", status: "Linked" },
  { id: "people_assignments", title: "People & Assignments", description: "Assignment field requirements and people-policy settings.", category: "people_assignments", status: "Configurable" },
  { id: "working_time", title: "Working Time", description: "Work Time Profiles, Break Rules and Unsociable Time rules.", category: "working_time", bridge: "working_time", status: "Linked" },
  { id: "session_security", title: "Session Security", description: "Staff inactivity, forced actions and Shared Terminal timeout settings.", category: "session_security", bridge: "session_security", status: "Linked" },
  { id: "notifications", title: "Notifications", description: "Online users, system messages and system message history.", category: "notifications", bridge: "notifications", status: "Linked" },
  { id: "advanced", title: "Advanced / Technical", description: "Controlled technical settings and diagnostics.", category: "advanced" }
];

let dependencies = {};
let initialised = false;
let settingsLoaded = false;
let categories = [];
let settings = [];
let fieldRequirements = [];
let activeSectionId = "overview";

function canViewApplicationSettings() {
  return hasAnyCapability(APPLICATION_SETTINGS_VIEW_CAPABILITIES);
}

function canManageApplicationSettings() {
  return hasAnyCapability(APPLICATION_SETTINGS_MANAGE_CAPABILITIES);
}

function canViewFieldRequirements() {
  return hasAnyCapability(FIELD_REQUIREMENT_VIEW_CAPABILITIES);
}

function canManageFieldRequirements() {
  return hasAnyCapability(FIELD_REQUIREMENT_MANAGE_CAPABILITIES);
}

function setStatus(message, type) {
  const status = $("applicationSettingsStatus");
  if (!status) return;
  status.textContent = message || "";
  status.className = "local-action-status" + (type ? " " + type : "");
}

function jsonValue(value) {
  if (value == null) return null;
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
  return value;
}

function settingInputId(settingKey) {
  return "applicationSetting_" + String(settingKey || "").replace(/[^a-z0-9]+/gi, "_");
}

function setAdministrationSection(sectionName) {
  const sections = {
    applicationSettings: $("applicationSettingsSection"),
    reference: $("referenceDataSection"),
    identityResolution: $("identityResolutionSection"),
    documentSignoffs: $("documentSignoffAdminSection"),
    privacyGdpr: $("privacyGdprSection"),
    terminals: $("sharedTerminalsSection"),
    modules: $("moduleConfigurationSection"),
    access: $("accessControlSection")
  };
  const navigation = {
    applicationSettings: $("administrationApplicationSettingsNav"),
    reference: $("administrationReferenceNav"),
    identityResolution: $("administrationIdentityResolutionNav"),
    documentSignoffs: $("administrationDocumentSignoffsNav"),
    privacyGdpr: $("administrationPrivacyGdprNav"),
    terminals: $("administrationSharedTerminalsNav"),
    modules: $("administrationModuleConfigurationNav"),
    access: $("administrationAccessControlNav")
  };

  Object.entries(sections).forEach(([name, section]) => {
    if (section) section.classList.toggle("hidden", name !== sectionName);
  });
  Object.entries(navigation).forEach(([name, button]) => {
    if (!button) return;
    const selected = name === sectionName;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function selectPanel(panelName) {
  document.querySelectorAll("[data-application-settings-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.applicationSettingsPanel !== panelName);
  });
}

function sectionDefinition(sectionId) {
  return SECTION_DEFINITIONS.find(section => section.id === sectionId) || SECTION_DEFINITIONS[0];
}

function renderSectionNavigation() {
  const nav = $("applicationSettingsNav");
  if (!nav) return;
  nav.replaceChildren();

  SECTION_DEFINITIONS.forEach(section => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.title;
    button.className = section.id === activeSectionId ? "active" : "";
    button.addEventListener("click", () => openApplicationSettingsSection(section.id));
    decorateCapabilityAction(button, {
      actionId: "application_settings.category.view",
      label: "View Application Settings category",
      area: "Application Settings",
      requiredAny: APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      actionType: "view"
    });
    nav.appendChild(button);
  });
}

function renderOverview() {
  const container = $("applicationSettingsOverviewCards");
  if (!container) return;
  container.replaceChildren();

  SECTION_DEFINITIONS.filter(section => section.id !== "overview").forEach(section => {
    const relatedSettings = settings.filter(item => item.category_code === section.category);
    const card = document.createElement("article");
    card.className = "application-settings-card";

    const title = document.createElement("h4");
    title.textContent = section.title;
    const description = document.createElement("p");
    description.textContent = section.description;
    const meta = document.createElement("span");
    meta.className = "application-settings-card-status";
    meta.textContent = section.status || (relatedSettings.length ? relatedSettings.length + " registry setting(s)" : "Prepared");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("click", () => openApplicationSettingsSection(section.id));
    decorateCapabilityAction(button, {
      actionId: "application_settings.category.view",
      label: "View Application Settings category",
      area: "Application Settings",
      requiredAny: APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      actionType: "view"
    });

    card.append(title, description, meta, button);
    container.appendChild(card);
  });
}

function groupedSettings(filterCategory) {
  const source = filterCategory
    ? settings.filter(setting => setting.category_code === filterCategory)
    : settings;
  return source.reduce((groups, setting) => {
    const key = setting.category_code || "advanced";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(setting);
    return groups;
  }, new Map());
}

function categoryLabel(categoryCode) {
  const category = categories.find(item => item.category_code === categoryCode);
  return category ? category.category_name : categoryCode;
}

function createSettingControl(setting) {
  const value = jsonValue(setting.setting_value);
  const disabled = !canManageApplicationSettings() || setting.locked_by_system || setting.sensitive;
  let control;

  if (setting.sensitive) {
    control = document.createElement("input");
    control.type = "password";
    control.value = "";
    control.placeholder = "Sensitive value hidden";
  } else if (setting.value_type === "boolean") {
    control = document.createElement("input");
    control.type = "checkbox";
    control.checked = value === true || value === "true";
  } else if (setting.value_type === "integer" || setting.value_type === "numeric") {
    control = document.createElement("input");
    control.type = "number";
    control.value = value == null ? "" : String(value);
  } else if (setting.value_type === "select" && Array.isArray(setting.allowed_values)) {
    control = document.createElement("select");
    setting.allowed_values.forEach(item => {
      const option = document.createElement("option");
      option.value = String(jsonValue(item));
      option.textContent = String(jsonValue(item));
      control.appendChild(option);
    });
    control.value = value == null ? "" : String(value);
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.value = value == null ? "" : String(value);
  }

  control.id = settingInputId(setting.setting_key);
  control.disabled = disabled;
  return control;
}

function readSettingControlValue(setting) {
  const control = $(settingInputId(setting.setting_key));
  if (!control) return null;
  if (setting.value_type === "boolean") return control.checked;
  if (setting.value_type === "integer") return Number.parseInt(control.value, 10);
  if (setting.value_type === "numeric") return Number(control.value);
  return control.value;
}

function renderRegistry(filterCategory, targetId = "applicationSettingsRegistry") {
  const container = $(targetId);
  if (!container) return;
  container.replaceChildren();

  const groups = groupedSettings(filterCategory);
  if (!groups.size) {
    const empty = document.createElement("div");
    empty.className = "people-empty-state";
    empty.textContent = "No registry settings are defined for this section yet.";
    container.appendChild(empty);
    return;
  }

  groups.forEach((items, categoryCode) => {
    const group = document.createElement("section");
    group.className = "application-settings-registry-group";
    const heading = document.createElement("div");
    heading.className = "application-settings-subsection-heading";
    const title = document.createElement("h4");
    title.textContent = categoryLabel(categoryCode);
    const count = document.createElement("p");
    count.textContent = items.length + " platform-defined setting" + (items.length === 1 ? "" : "s");
    heading.append(title, count);
    group.appendChild(heading);

    items.forEach(setting => {
      const row = document.createElement("article");
      row.className = "application-settings-registry-row";
      if (setting.locked_by_system) row.classList.add("is-locked");

      const summary = document.createElement("div");
      const name = document.createElement("h5");
      name.textContent = setting.setting_name || setting.setting_key;
      const description = document.createElement("p");
      description.textContent = setting.description || setting.help_text || setting.setting_key;
      const meta = document.createElement("span");
      meta.className = "application-settings-card-status";
      meta.textContent = setting.locked_by_system
        ? "Locked by system"
        : setting.sensitive
          ? "Sensitive"
          : canManageApplicationSettings()
            ? "Editable"
            : "Read only";
      summary.append(name, description, meta);

      const field = document.createElement("label");
      field.className = "application-settings-control";
      const label = document.createElement("span");
      label.textContent = setting.setting_key;
      const control = createSettingControl(setting);
      field.append(label, control);

      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.disabled = !canManageApplicationSettings() || setting.locked_by_system || setting.sensitive;
      save.addEventListener("click", () => saveApplicationSetting(setting.setting_key));
      decorateCapabilityAction(save, {
        actionId: "application_settings.setting.save",
        label: "Save Application Setting",
        area: "Application Settings",
        requiredAny: APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
        actionType: "update"
      });

      row.append(summary, field, save);
      group.appendChild(row);
    });
    container.appendChild(group);
  });
}

function renderFieldRequirements() {
  const body = $("assignmentFieldRequirementsBody");
  const empty = $("assignmentFieldRequirementsEmpty");
  if (!body || !empty) return;
  body.replaceChildren();
  empty.classList.toggle("hidden", fieldRequirements.length > 0);

  fieldRequirements.forEach(rule => {
    const row = document.createElement("tr");
    row.dataset.fieldKey = rule.field_key;
    const currentRule = rule.system_required
      ? "Required, locked by system"
      : rule.is_required
        ? "Required by configuration"
        : "Optional by configuration";

    const field = document.createElement("td");
    field.innerHTML = "<strong></strong><span></span>";
    field.querySelector("strong").textContent = rule.field_label || rule.field_key;
    field.querySelector("span").textContent = rule.description || "";

    const status = document.createElement("td");
    status.textContent = currentRule;
    const locked = document.createElement("td");
    locked.textContent = rule.system_required ? "Locked by system" : "No";
    const configurable = document.createElement("td");
    configurable.textContent = rule.configurable ? "Yes" : "No";
    const required = document.createElement("td");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = rule.is_required === true || rule.system_required === true;
    toggle.disabled = rule.system_required || !rule.configurable || !canManageFieldRequirements();
    toggle.dataset.fieldRequirementToggle = rule.field_key;
    required.appendChild(toggle);
    const help = document.createElement("td");
    help.textContent = rule.help_text || "";
    const action = document.createElement("td");
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Update";
    save.disabled = toggle.disabled;
    save.addEventListener("click", () => updateFieldRequirement(rule.field_key));
    decorateCapabilityAction(save, {
      actionId: "assignment_field_requirements.update",
      label: "Update Assignment Field Requirement",
      area: "Application Settings",
      requiredAny: FIELD_REQUIREMENT_MANAGE_CAPABILITIES,
      actionType: "update"
    });
    action.appendChild(save);

    row.append(field, status, locked, configurable, required, help, action);
    body.appendChild(row);
  });
}

function bridgeActionsFor(sectionId) {
  if (sectionId === "visitors") {
    return [
      ["Open Visitor Settings", "application_settings.visitors.legacy.open", "Open legacy Visitor Settings link", () => dependencies.openLegacySettings?.()],
      ["Open Legacy VMS Settings", "application_settings.visitors.vms.open", "Open legacy VMS Settings link", () => dependencies.openLegacySettings?.()]
    ];
  }
  if (sectionId === "shared_terminal") {
    return [["Open Shared Terminals", "application_settings.shared_terminal.open", "Open Shared Terminal settings", () => dependencies.openSharedTerminals?.()]];
  }
  if (sectionId === "documents") {
    return [["Open Document Sign-off Settings", "application_settings.documents.open", "Open Document Sign-off settings", () => dependencies.openDocuments?.()]];
  }
  if (sectionId === "working_time") {
    return [
      ["Work Time Profiles", "application_settings.working_time.profiles.open", "Open Working Time settings", () => dependencies.openWorkingTimeEntity?.("workTimeProfiles")],
      ["Break Rules", "application_settings.working_time.break_rules.open", "Open Working Time settings", () => dependencies.openWorkingTimeEntity?.("breakRules")],
      ["Unsociable Time Rules", "application_settings.working_time.unsociable_rules.open", "Open Working Time settings", () => dependencies.openWorkingTimeEntity?.("unsociableTimeRules")],
      ["Unsociable Rule Sets", "application_settings.working_time.unsociable_sets.open", "Open Working Time settings", () => dependencies.openWorkingTimeEntity?.("unsociableRuleSets")]
    ];
  }
  if (sectionId === "session_security") {
    return [["Open Session Security", "application_settings.session_security.open", "Open Session Security settings", () => dependencies.openSessionSecurity?.()]];
  }
  if (sectionId === "notifications") {
    return [
      ["Online Users / System Messages", "application_settings.notifications.online.open", "Open Notification settings/history", () => dependencies.openNotifications?.("presence")],
      ["System Message History", "application_settings.notifications.history.open", "Open Notification settings/history", () => dependencies.openNotifications?.("history")]
    ];
  }
  if (sectionId === "modules") {
    return [["Open Module Configuration", "application_settings.modules.open", "Open Module Configuration", () => dependencies.openModuleConfiguration?.()]];
  }
  return [];
}

function renderBridge(sectionId) {
  const definition = sectionDefinition(sectionId);
  const title = $("applicationSettingsBridgeTitle");
  const description = $("applicationSettingsBridgeDescription");
  const container = $("applicationSettingsBridgeCards");
  if (title) title.textContent = definition.title;
  if (description) description.textContent = definition.description;
  if (!container) return;
  container.replaceChildren();

  bridgeActionsFor(sectionId).forEach(([label, actionId, capabilityLabel, handler]) => {
    const card = document.createElement("article");
    card.className = "application-settings-card";
    const h4 = document.createElement("h4");
    h4.textContent = label;
    const p = document.createElement("p");
    p.textContent = definition.status === "Legacy-backed"
      ? "This area is still managed in the existing legacy-backed workspace."
      : "This opens the existing specialist settings workspace.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("click", handler);
    decorateCapabilityAction(button, {
      actionId,
      label: capabilityLabel,
      area: "Application Settings",
      requiredAny: APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      actionType: "navigation"
    });
    card.append(h4, p, button);
    container.appendChild(card);
  });
}

function renderActiveSection() {
  renderSectionNavigation();
  renderOverview();
  const definition = sectionDefinition(activeSectionId);

  if (activeSectionId === "overview") {
    selectPanel("overview");
  } else if (activeSectionId === "people_assignments") {
    selectPanel("people_assignments");
    renderRegistry("people_assignments", "applicationSettingsPeopleRegistry");
    renderFieldRequirements();
  } else if (definition.bridge) {
    selectPanel("bridge");
    renderBridge(activeSectionId);
  } else {
    selectPanel("registry");
    renderRegistry(definition.category);
  }

  const badge = $("applicationSettingsModeBadge");
  if (badge) {
    badge.textContent = canManageApplicationSettings()
      ? "Settings editable"
      : "Read only";
  }
}

async function loadApplicationSettingsData() {
  if (!canViewApplicationSettings()) return;
  setStatus("Loading settings...", "info");
  try {
    const [categoryResult, settingsResult] = await Promise.all([
      supabaseClient.rpc("list_application_setting_categories"),
      supabaseClient.rpc("list_application_settings", {
        p_category_code: null,
        p_search_text: null
      })
    ]);
    if (categoryResult.error) throw categoryResult.error;
    if (settingsResult.error) throw settingsResult.error;
    categories = categoryResult.data || [];
    settings = settingsResult.data || [];
    settingsLoaded = true;
    setStatus("");
    renderActiveSection();
  } catch (err) {
    setStatus("Could not load application settings: " + (err.message || err), "error");
    showToast("Application Settings not loaded", err.message || "Could not load settings.", "error");
  }
}

async function loadFieldRequirements() {
  if (!canViewFieldRequirements()) return;
  try {
    const result = await supabaseClient.rpc("list_field_requirements", {
      p_area_code: "work_assignments"
    });
    if (result.error) throw result.error;
    fieldRequirements = result.data || [];
    renderFieldRequirements();
  } catch (err) {
    showToast("Field requirements not loaded", err.message || "Could not load assignment field requirements.", "error");
  }
}

async function saveApplicationSetting(settingKey) {
  if (!canManageApplicationSettings()) {
    showToast("Setting not saved", "Application Settings manage capability is required.", "error");
    return;
  }
  const setting = settings.find(item => item.setting_key === settingKey);
  if (!setting || setting.locked_by_system || setting.sensitive) return;
  const value = readSettingControlValue(setting);
  const result = await supabaseClient.rpc("update_application_setting", {
    p_setting_key: settingKey,
    p_setting_value: value
  });
  if (result.error) {
    showToast("Setting not saved", result.error.message || "Could not save this setting.", "error");
    return;
  }
  showToast("Setting saved", "The application setting was updated.", "success");
  await loadApplicationSettingsData();
}

async function updateFieldRequirement(fieldKey) {
  if (!canManageFieldRequirements()) {
    showToast("Requirement not updated", "Assignment field requirement manage capability is required.", "error");
    return;
  }
  const rule = fieldRequirements.find(item => item.field_key === fieldKey);
  const toggle = document.querySelector("[data-field-requirement-toggle='" + fieldKey + "']");
  if (!rule || !toggle || rule.system_required || !rule.configurable) return;

  const result = await supabaseClient.rpc("update_field_requirement", {
    p_area_code: "work_assignments",
    p_field_key: fieldKey,
    p_is_required: toggle.checked,
    p_is_visible: rule.is_visible !== false
  });
  if (result.error) {
    showToast("Requirement not updated", result.error.message || "Could not update this field requirement.", "error");
    return;
  }
  showToast("Requirement updated", (rule.field_label || fieldKey) + " is now " + (toggle.checked ? "required" : "optional") + " by configuration.", "success");
  await loadFieldRequirements();
}

export async function openApplicationSettingsSection(sectionId) {
  if (!canViewApplicationSettings()) {
    showToast("You do not have permission", "Application Settings requires application_settings.view or an equivalent settings capability.", "error");
    return;
  }
  activeSectionId = sectionId || "overview";
  renderActiveSection();
  if (!settingsLoaded) await loadApplicationSettingsData();
  if (activeSectionId === "people_assignments") await loadFieldRequirements();
}

export async function openApplicationSettingsWorkspace(sectionId = "overview") {
  if (!canViewApplicationSettings()) {
    showToast("You do not have permission", "Application Settings requires application_settings.view or an equivalent settings capability.", "error");
    return;
  }
  showAdministrationWorkspace();
  setAdministrationSection("applicationSettings");
  await openApplicationSettingsSection(sectionId);
}

export function syncApplicationSettingsVisibility() {
  const visible = canViewApplicationSettings();
  const nav = $("administrationApplicationSettingsNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  if (!visible && $("applicationSettingsSection") && !$("applicationSettingsSection").classList.contains("hidden")) {
    $("applicationSettingsSection").classList.add("hidden");
  }
  renderActiveSection();
}

export function initialiseApplicationSettings(options = {}) {
  if (initialised) return;
  initialised = true;
  dependencies = options;

  const nav = $("administrationApplicationSettingsNav");
  if (nav) nav.addEventListener("click", () => openApplicationSettingsWorkspace());
  const refresh = $("applicationSettingsRefreshButton");
  if (refresh) refresh.addEventListener("click", async () => {
    settingsLoaded = false;
    await loadApplicationSettingsData();
    if (activeSectionId === "people_assignments") await loadFieldRequirements();
  });
  const requirementsRefresh = $("assignmentFieldRequirementsRefreshButton");
  if (requirementsRefresh) requirementsRefresh.addEventListener("click", loadFieldRequirements);

  window.addEventListener("oh:application-settings-requested", () => {
    void openApplicationSettingsWorkspace();
  });
  window.addEventListener("oh:capabilities-changed", syncApplicationSettingsVisibility);
  syncApplicationSettingsVisibility();
  renderActiveSection();
}
