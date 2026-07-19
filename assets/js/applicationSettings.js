import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showAdministrationWorkspace } from "./shell.js";
import {
  listFormRequirementAreas,
  loadFormRequirements,
  resetFormRequirementsCache
} from "./formRequirements.js";

const APPLICATION_SETTINGS_VIEW_CAPABILITIES = [
  "application_settings.view",
  "application_settings.manage",
  "form_requirements.view",
  "form_requirements.manage",
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
  "form_requirements.view",
  "form_requirements.manage",
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
  "form_requirements.manage",
  "assignment_field_requirements.manage",
  "application_settings.manage",
  "work_time_profiles.manage",
  "workforce_calendar.manage",
  "settings.edit",
  "access_control.manage"
];

const SECTION_DEFINITIONS = [
  { id: "overview", title: "Overview", description: "A map of settings areas and migration status.", status: "Native in Application Settings" },
  { id: "general", title: "General", description: "Product name, platform defaults and application-level behaviour.", category: "general", status: "Native in Application Settings" },
  { id: "branding", title: "Branding", description: "Brand identity and appearance settings.", category: "branding", status: "Legacy-linked" },
  { id: "modules", title: "Modules", description: "Module-level settings and form requirements.", category: "modules", status: "Native in Application Settings" },
  { id: "visitors", title: "Visitors", description: "Visitor module settings, Form Requirements and legacy VMS configuration.", category: "visitors", bridge: "visitors", status: "Partially migrated" },
  { id: "shared_terminal", title: "Shared Terminal", description: "Trusted terminal and kiosk-device administration.", category: "visitors", bridge: "shared_terminal", status: "Linked to existing module settings" },
  { id: "documents", title: "Documents / Sign-off", description: "Document sign-off settings and compliance controls.", category: "documents", bridge: "documents", status: "Linked to existing module settings" },
  { id: "people_assignments", title: "People & Assignments", description: "Assignment Form Requirements and people-policy settings.", category: "people_assignments", status: "Partially migrated" },
  { id: "working_time", title: "Working Time", description: "Work Time Profiles, Break Rules and Unsociable Time rules.", category: "working_time", bridge: "working_time", status: "Linked to existing module settings" },
  { id: "session_security", title: "Session Security", description: "Staff inactivity, forced actions and Shared Terminal timeout settings.", category: "session_security", bridge: "session_security", status: "Native / embedded" },
  { id: "notifications", title: "Notifications", description: "Online users, system messages and system message history.", category: "notifications", bridge: "notifications", status: "Linked to existing module settings" },
  { id: "advanced", title: "Advanced / Technical", description: "Controlled technical settings and diagnostics.", category: "advanced", status: "Partially migrated" }
];

const MODULE_SETTING_CARDS = [
  { sectionId: "visitors", title: "Visitors", status: "Partially migrated", description: "Form Requirements live here. Complex visitor settings remain linked to the existing VMS settings area." },
  { sectionId: "people_assignments", title: "People & Assignments", status: "Native here", description: "Assignment Form Requirements are managed from Application Settings." },
  { sectionId: "working_time", title: "Working Time", status: "Linked to existing module settings", description: "Open Work Time Profiles, Break Rules, Unsociable Time Rules and Rule Sets." },
  { sectionId: "documents", title: "Documents / Sign-off", status: "Linked / partial", description: "Document sign-off settings remain in the specialist document area while migration continues." },
  { sectionId: "session_security", title: "Session Security", status: "Native / embedded", description: "Open the existing Session Security settings panel from the central hub." },
  { sectionId: "notifications", title: "Notifications", status: "Linked to System Messages", description: "Open Online Users, System Messages and Message History." },
  { sectionId: "future_lmt", title: "Future LMT", status: "Future", description: "Labour management rules will be added after the settings foundation settles." }
];

let dependencies = {};
let initialised = false;
let settingsLoaded = false;
let categories = [];
let settings = [];
let fieldRequirements = [];
let fieldRequirementAreas = [];
let activeRequirementAreaCode = "work_assignments";
let requirementDraft = new Map();
let requirementsDirty = false;
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

function renderModulesPanel() {
  const container = $("applicationSettingsModuleCards");
  if (!container) return;
  container.replaceChildren();

  MODULE_SETTING_CARDS.forEach(cardDefinition => {
    const card = document.createElement("article");
    card.className = "application-settings-card";
    const title = document.createElement("h4");
    title.textContent = cardDefinition.title;
    const description = document.createElement("p");
    description.textContent = cardDefinition.description;
    const status = document.createElement("span");
    status.className = "application-settings-card-status";
    status.textContent = cardDefinition.status;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = cardDefinition.sectionId === "future_lmt" ? "Not yet available" : "Open";
    button.disabled = cardDefinition.sectionId === "future_lmt";
    if (cardDefinition.sectionId !== "future_lmt") {
      button.addEventListener("click", () => openApplicationSettingsSection(cardDefinition.sectionId));
    }
    decorateCapabilityAction(button, {
      actionId: "application_settings.modules.open",
      label: cardDefinition.title === "People & Assignments"
        ? "Open People & Assignments settings"
        : cardDefinition.title === "Visitors"
          ? "Open Visitors settings bridge"
          : cardDefinition.title === "Working Time"
            ? "Open Working Time settings"
            : cardDefinition.title === "Session Security"
              ? "Open Session Security settings"
              : cardDefinition.title === "Notifications"
                ? "Open Notifications settings"
                : "Open Modules settings",
      area: "Application Settings",
      requiredAny: APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      actionType: "navigation"
    });
    card.append(title, description, status, button);
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

function currentRequirementArea() {
  return fieldRequirementAreas.find(area => area.area_code === activeRequirementAreaCode) || {
    area_code: activeRequirementAreaCode,
    area_name: "Assignments",
    description: "Form requirement configuration."
  };
}

function setRequirementsDirty(dirty) {
  requirementsDirty = dirty;
  const status = $("formRequirementsDirtyStatus");
  if (status) {
    status.textContent = dirty ? "Unsaved changes" : "";
    status.className = "local-action-status" + (dirty ? " warning" : "");
  }
  const save = $("formRequirementsSaveButton");
  if (save) save.disabled = !dirty || !canManageFieldRequirements();
  const revert = $("formRequirementsRevertButton");
  if (revert) revert.disabled = !dirty;
}

function renderRequirementAreaSelector() {
  const container = $("formRequirementsAreaSelector");
  if (!container) return;
  container.replaceChildren();
  fieldRequirementAreas.forEach(area => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = area.area_name;
    button.className = area.area_code === activeRequirementAreaCode ? "active" : "";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(area.area_code === activeRequirementAreaCode));
    button.addEventListener("click", () => selectFormRequirementArea(area.area_code));
    decorateCapabilityAction(button, {
      actionId: "form_requirements.area.switch",
      label: "Switch Form Requirement area",
      area: "Application Settings",
      requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
      actionType: "view"
    });
    container.appendChild(button);
  });
}

function renderFieldRequirements() {
  const body = $("assignmentFieldRequirementsBody");
  const empty = $("assignmentFieldRequirementsEmpty");
  if (!body || !empty) return;
  body.replaceChildren();
  empty.classList.toggle("hidden", fieldRequirements.length > 0);
  renderRequirementAreaSelector();
  const area = currentRequirementArea();
  const description = $("formRequirementsAreaDescription");
  if (description) description.textContent = area.description || "System-required fields stay locked. Configurable fields can be made required by business policy.";

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
    toggle.addEventListener("change", () => {
      requirementDraft.set(rule.field_key, toggle.checked);
      setRequirementsDirty(true);
    });
    required.appendChild(toggle);
    const help = document.createElement("td");
    help.textContent = rule.help_text || "";

    row.append(field, status, locked, configurable, required, help);
    body.appendChild(row);
  });
  setRequirementsDirty(requirementsDirty);
}

function bridgeActionsFor(sectionId) {
  if (sectionId === "visitors") {
    return [
      ["Visitor Walk-ins Form Requirements", "application_settings.visitors.walk_ins.form_requirements.open", "Open Form Requirements", () => openFormRequirementsArea("visitor_walk_ins")],
      ["Planned Visits Form Requirements", "application_settings.visitors.planned.form_requirements.open", "Open Form Requirements", () => openFormRequirementsArea("planned_visits")],
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
  } else if (activeSectionId === "modules") {
    selectPanel("modules");
    renderModulesPanel();
  } else if (activeSectionId === "people_assignments") {
    selectPanel("form_requirements");
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
    fieldRequirementAreas = await listFormRequirementAreas();
    if (!fieldRequirementAreas.some(area => area.area_code === activeRequirementAreaCode)) {
      activeRequirementAreaCode = fieldRequirementAreas[0]?.area_code || "work_assignments";
    }
    fieldRequirements = await loadFormRequirements(activeRequirementAreaCode, { force: true });
    requirementDraft = new Map(
      fieldRequirements
        .filter(rule => rule.configurable)
        .map(rule => [rule.field_key, rule.is_required === true])
    );
    setRequirementsDirty(false);
    renderFieldRequirements();
  } catch (err) {
    showToast("Form requirements not loaded", err.message || "Could not load form requirements.", "error");
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

async function selectFormRequirementArea(areaCode) {
  if (!areaCode || areaCode === activeRequirementAreaCode) return;
  if (requirementsDirty) {
    showToast("Unsaved changes", "Save or revert the current Form Requirements changes before switching area.", "warning");
    return;
  }
  activeRequirementAreaCode = areaCode;
  await loadFieldRequirements();
}

async function saveFormRequirementsBatch() {
  if (!canManageFieldRequirements()) {
    showToast("Requirements not saved", "Form Requirements manage capability is required.", "error");
    return;
  }
  const changedRules = fieldRequirements
    .filter(rule => rule.configurable)
    .filter(rule => requirementDraft.get(rule.field_key) !== (rule.is_required === true))
    .map(rule => ({
      field_key: rule.field_key,
      is_required: requirementDraft.get(rule.field_key) === true,
      is_visible: rule.is_visible !== false
    }));

  if (!changedRules.length) {
    setRequirementsDirty(false);
    showToast("No changes to save", "Form Requirements are already up to date.", "info");
    return;
  }

  const result = await supabaseClient.rpc("update_field_requirements_batch", {
    p_area_code: activeRequirementAreaCode,
    p_rules: changedRules
  });
  if (result.error) {
    showToast("Requirements not saved", result.error.message || "Could not save Form Requirements.", "error");
    return;
  }
  resetFormRequirementsCache();
  showToast("Requirements saved", "Form Requirements were updated.", "success");
  await loadFieldRequirements();
}

function revertFormRequirementChanges() {
  requirementDraft = new Map(
    fieldRequirements
      .filter(rule => rule.configurable)
      .map(rule => [rule.field_key, rule.is_required === true])
  );
  setRequirementsDirty(false);
  renderFieldRequirements();
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

async function openFormRequirementsArea(areaCode) {
  activeRequirementAreaCode = areaCode || "work_assignments";
  await openApplicationSettingsSection("people_assignments");
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
  const saveRequirements = $("formRequirementsSaveButton");
  if (saveRequirements) saveRequirements.addEventListener("click", saveFormRequirementsBatch);
  const revertRequirements = $("formRequirementsRevertButton");
  if (revertRequirements) revertRequirements.addEventListener("click", revertFormRequirementChanges);

  window.addEventListener("oh:application-settings-requested", () => {
    void openApplicationSettingsWorkspace();
  });
  window.addEventListener("oh:capabilities-changed", syncApplicationSettingsVisibility);
  syncApplicationSettingsVisibility();
  renderActiveSection();
}
