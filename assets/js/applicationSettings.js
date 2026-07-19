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
import {
  applicationSettingJsonValue,
  listApplicationSettingCategories,
  listApplicationSettings,
  resetApplicationSettingToDefault,
  resetApplicationSettingsCategoryToDefaults,
  updateApplicationSetting
} from "./applicationSettingsService.js";
import {
  MODULE_SETTINGS_AREA_IDS,
  SETTINGS_OWNERSHIP_AREAS,
  settingsAreaById,
  settingsStatusCopy,
  settingsStatusLabel
} from "./settingsOwnershipMap.js";

const APPLICATION_SETTINGS_VIEW_CAPABILITIES = [
  "application_settings.view",
  "application_settings.manage",
  "form_requirements.view",
  "form_requirements.manage",
  "settings.view",
  "settings.edit",
  "module_configuration.view",
  "module_configuration.manage",
  "visitor.view",
  "devices.view",
  "devices.manage",
  "agreements.view",
  "agreements.manage",
  "document_signoff.manage",
  "people.view",
  "people.manage",
  "work_time_profiles.view",
  "work_time_profiles.manage",
  "workforce_calendar.manage",
  "session_security_settings.view",
  "session_security_settings.manage",
  "online_users.view",
  "admin_system_messages.view",
  "admin_system_messages.send",
  "admin_system_messages.force_action",
  "access_control.view",
  "capabilities.diagnose",
  "access_control.manage"
];
const APPLICATION_SETTINGS_MANAGE_CAPABILITIES = [
  "application_settings.manage",
  "settings.edit",
  "module_configuration.manage",
  "access_control.manage"
];
const APPLICATION_SETTINGS_REGISTRY_VIEW_CAPABILITIES = [
  "application_settings.view",
  "application_settings.manage",
  "settings.view",
  "settings.edit",
  "module_configuration.view",
  "module_configuration.manage",
  "access_control.view",
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

const SECTION_CATEGORY_BY_ID = Object.freeze({
  shared_terminal: "shared_terminal",
  people_assignments: "people_assignments",
  session_security: "session_security",
  future_lmt: "modules"
});

function sectionFromOwnershipArea(area) {
  return {
    id: area.id,
    title: area.label,
    description: area.description,
    category: SECTION_CATEGORY_BY_ID[area.id] || area.id,
    bridge: area.deepLinksToExistingPanel && !area.opensEmbeddedPanel ? area.id : "",
    status: area.status,
    area
  };
}

const SECTION_DEFINITIONS = [
  { id: "overview", title: "Overview", description: "A map of settings areas and migration status.", status: "native" },
  ...SETTINGS_OWNERSHIP_AREAS
    .filter(area => area.id !== "future_lmt")
    .map(sectionFromOwnershipArea)
];

const MODULE_SETTING_CARDS = MODULE_SETTINGS_AREA_IDS
  .map(settingsAreaById)
  .filter(Boolean);

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

function canViewApplicationSettingsRegistry() {
  return hasAnyCapability(APPLICATION_SETTINGS_REGISTRY_VIEW_CAPABILITIES);
}

function canViewFieldRequirements() {
  return hasAnyCapability(FIELD_REQUIREMENT_VIEW_CAPABILITIES);
}

function canManageFieldRequirements() {
  return hasAnyCapability(FIELD_REQUIREMENT_MANAGE_CAPABILITIES);
}

function canViewSettingsArea(area) {
  if (!area) return true;
  return hasAnyCapability(area.viewCapabilities || APPLICATION_SETTINGS_VIEW_CAPABILITIES);
}

function canOpenSettingsSection(sectionId) {
  const area = settingsAreaById(sectionId);
  return !area || canViewSettingsArea(area);
}

function statusBadge(status) {
  const meta = document.createElement("span");
  meta.className = "application-settings-card-status status-" + String(status || "linked").replace(/_/g, "-");
  meta.textContent = settingsStatusLabel(status);
  return meta;
}

function primaryActionLabel(area) {
  if (!area) return "Open";
  if (area.status === "future") return "Coming later";
  if (area.id === "branding") return "Open Branding";
  if (area.id === "visitors") return "Open Visitor Settings / Form Requirements";
  if (area.id === "people_assignments") return "Open Form Requirements";
  if (area.id === "working_time") return "Open Working Time Settings";
  if (area.id === "documents") return "Open Sign-off Settings";
  if (area.id === "session_security") return "Open Session Security";
  if (area.id === "notifications") return "Open Notifications";
  if (area.id === "advanced") return "Open Diagnostics";
  if (area.id === "shared_terminal") return "Open Shared Terminal Settings";
  return "Open";
}

function setStatus(message, type) {
  const status = $("applicationSettingsStatus");
  if (!status) return;
  status.textContent = message || "";
  status.className = "local-action-status" + (type ? " " + type : "");
}

function jsonValue(value) {
  return applicationSettingJsonValue(value);
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

  SECTION_DEFINITIONS.filter(section => section.id === "overview" || canViewSettingsArea(section.area)).forEach(section => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.title;
    button.className = section.id === activeSectionId ? "active" : "";
    button.addEventListener("click", () => openApplicationSettingsSection(section.id));
    decorateCapabilityAction(button, {
      actionId: "application_settings.section." + section.id + ".open",
      label: "Open Application Settings section",
      area: "Application Settings",
      requiredAny: section.area ? section.area.viewCapabilities : APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      actionType: "navigation"
    });
    nav.appendChild(button);
  });
}

function renderOverview() {
  const container = $("applicationSettingsOverviewCards");
  if (!container) return;
  container.replaceChildren();

  SETTINGS_OWNERSHIP_AREAS.filter(canViewSettingsArea).forEach(area => {
    const section = sectionDefinition(area.id);
    const relatedSettings = settings.filter(item => item.category_code === section.category);
    const card = document.createElement("article");
    card.className = "application-settings-card";

    const title = document.createElement("h4");
    title.textContent = area.label;
    const description = document.createElement("p");
    description.textContent = area.description;
    const meta = statusBadge(area.status);
    meta.title = settingsStatusCopy(area.status);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = primaryActionLabel(area);
    button.disabled = area.status === "future";
    if (area.status !== "future") {
      button.addEventListener("click", () => openApplicationSettingsSection(area.id));
    }
    decorateCapabilityAction(button, {
      actionId: "application_settings.section." + area.id + ".open",
      label: "Open " + area.label + " settings",
      area: "Application Settings",
      requiredAny: area.viewCapabilities,
      notes: relatedSettings.length ? relatedSettings.length + " registry setting(s)" : settingsStatusCopy(area.status),
      actionType: "navigation"
    });

    card.append(title, description, meta, button);
    container.appendChild(card);
  });
}

function renderModulesPanel() {
  const container = $("applicationSettingsModuleCards");
  if (!container) return;
  container.replaceChildren();

  MODULE_SETTING_CARDS.filter(canViewSettingsArea).forEach(cardDefinition => {
    const card = document.createElement("article");
    card.className = "application-settings-card";
    const title = document.createElement("h4");
    title.textContent = cardDefinition.label;
    const description = document.createElement("p");
    description.textContent = cardDefinition.description;
    const status = statusBadge(cardDefinition.status);
    status.title = settingsStatusCopy(cardDefinition.status);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = primaryActionLabel(cardDefinition);
    button.disabled = cardDefinition.status === "future";
    if (cardDefinition.status !== "future") {
      button.addEventListener("click", () => openApplicationSettingsSection(cardDefinition.id));
    }
    decorateCapabilityAction(button, {
      actionId: "application_settings.modules." + cardDefinition.id + ".open",
      label: primaryActionLabel(cardDefinition),
      area: "Application Settings",
      requiredAny: cardDefinition.viewCapabilities,
      notes: settingsStatusCopy(cardDefinition.status),
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
  const component = setting.ui_component || setting.value_type;

  if (setting.sensitive) {
    control = document.createElement("input");
    control.type = "password";
    control.value = "";
    control.placeholder = "Sensitive value hidden";
  } else if (setting.value_type === "boolean") {
    control = document.createElement("input");
    control.type = "checkbox";
    control.checked = value === true || value === "true";
  } else if (component === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
    control.value = value == null ? "" : String(value);
  } else if (component === "colour") {
    control = document.createElement("input");
    control.type = "color";
    control.value = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : "#2563eb";
  } else if (component === "url") {
    control = document.createElement("input");
    control.type = "url";
    control.value = value == null ? "" : String(value);
  } else if (component === "time") {
    control = document.createElement("input");
    control.type = "time";
    control.value = value == null ? "" : String(value);
  } else if (setting.value_type === "integer" || setting.value_type === "numeric") {
    control = document.createElement("input");
    control.type = "number";
    control.value = value == null ? "" : String(value);
    const validation = setting.validation_json || {};
    if (validation.min != null) control.min = String(validation.min);
    if (validation.max != null) control.max = String(validation.max);
    if (validation.step != null) control.step = String(validation.step);
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
  return String(control.value || "");
}

function settingActionId(setting, suffix) {
  return "application_settings." + String(setting.category_code || "setting") + "." +
    String(setting.setting_key || "setting").replace(/[^a-z0-9]+/gi, "_") + "." + suffix;
}

function canResetSetting(setting) {
  return canManageApplicationSettings() && setting && !setting.locked_by_system && !setting.sensitive;
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
    const headingText = document.createElement("div");
    headingText.append(title, count);
    const resetCategory = document.createElement("button");
    resetCategory.type = "button";
    resetCategory.className = "secondary";
    resetCategory.textContent = "Reset Category";
    resetCategory.disabled = !canManageApplicationSettings() || !items.some(canResetSetting);
    resetCategory.addEventListener("click", () => resetApplicationSettingsCategory(categoryCode));
    decorateCapabilityAction(resetCategory, {
      actionId: "application_settings." + categoryCode + ".reset_defaults",
      label: "Reset " + categoryLabel(categoryCode) + " defaults",
      area: "Application Settings",
      requiredAny: APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
      actionType: "reset"
    });
    heading.append(headingText, resetCategory);
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
        actionId: settingActionId(setting, "save"),
        label: "Save " + (setting.setting_name || setting.setting_key),
        area: "Application Settings",
        requiredAny: APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
        actionType: "update"
      });
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "secondary";
      reset.textContent = "Reset";
      reset.disabled = !canResetSetting(setting);
      reset.addEventListener("click", () => resetApplicationSetting(setting.setting_key));
      decorateCapabilityAction(reset, {
        actionId: settingActionId(setting, "reset_default"),
        label: "Reset " + (setting.setting_name || setting.setting_key),
        area: "Application Settings",
        requiredAny: APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
        actionType: "reset"
      });
      const actions = document.createElement("div");
      actions.className = "application-settings-row-actions";
      actions.append(save, reset);

      row.append(summary, field, actions);
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
      {
        label: "Visitor Walk-ins Form Requirements",
        actionId: "application_settings.visitors.walk_ins.form_requirements.open",
        capabilityLabel: "Open Form Requirements",
        description: "Manage required fields for visitor walk-in forms.",
        requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
        handler: () => openFormRequirementsArea("visitor_walk_ins")
      },
      {
        label: "Planned Visits Form Requirements",
        actionId: "application_settings.visitors.planned.form_requirements.open",
        capabilityLabel: "Open Form Requirements",
        description: "Manage required fields for planned visit forms.",
        requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
        handler: () => openFormRequirementsArea("planned_visits")
      },
      {
        label: "Open Visitor Settings",
        actionId: "application_settings.visitors.legacy.open",
        capabilityLabel: "Open Visitor settings bridge",
        description: "Open the existing visitor settings area while migration continues.",
        requiredAny: settingsAreaById("visitors").viewCapabilities,
        handler: () => dependencies.openLegacySettings?.()
      },
      {
        label: "Open Legacy VMS Settings",
        actionId: "application_settings.visitors.vms.open",
        capabilityLabel: "Open legacy VMS settings",
        description: "Open the legacy VMS settings area.",
        requiredAny: ["settings.view", "settings.edit", "visitor.view"],
        handler: () => dependencies.openLegacySettings?.()
      }
    ];
  }
  if (sectionId === "branding") {
    return [{
      label: "Open Legacy Branding Settings",
      actionId: "application_settings.branding.legacy.open",
      capabilityLabel: "Open Branding legacy bridge",
      description: "Logo, theme and background still open in legacy VMS settings.",
      requiredAny: settingsAreaById("branding").viewCapabilities,
      handler: () => dependencies.openLegacySettings?.()
    }];
  }
  if (sectionId === "shared_terminal") {
    return [{
      label: "Open Shared Terminals",
      actionId: "application_settings.shared_terminal.open",
      capabilityLabel: "Open Shared Terminal settings",
      description: "Open the existing Shared Terminals administration panel.",
      requiredAny: settingsAreaById("shared_terminal").viewCapabilities,
      handler: () => dependencies.openSharedTerminals?.()
    }];
  }
  if (sectionId === "documents") {
    return [{
      label: "Open Document Sign-off Settings",
      actionId: "application_settings.documents.open",
      capabilityLabel: "Open Document Sign-off settings",
      description: "Open the existing document and sign-off settings panel.",
      requiredAny: settingsAreaById("documents").viewCapabilities,
      handler: () => dependencies.openDocuments?.()
    }];
  }
  if (sectionId === "working_time") {
    return [
      {
        label: "Work Time Profiles",
        actionId: "application_settings.working_time.profiles.open",
        capabilityLabel: "Open Work Time Profiles",
        description: "Open the existing Work Time Profiles settings.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("workTimeProfiles")
      },
      {
        label: "Break Rules",
        actionId: "application_settings.working_time.break_rules.open",
        capabilityLabel: "Open Break Rules",
        description: "Open the existing Break Rules settings.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("breakRules")
      },
      {
        label: "Unsociable Time Rules",
        actionId: "application_settings.working_time.unsociable_rules.open",
        capabilityLabel: "Open Unsociable Time Rules",
        description: "Open the existing Unsociable Time Rules settings.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("unsociableTimeRules")
      },
      {
        label: "Unsociable Rule Sets",
        actionId: "application_settings.working_time.unsociable_sets.open",
        capabilityLabel: "Open Unsociable Rule Sets",
        description: "Open the existing Unsociable Rule Sets settings.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("unsociableRuleSets")
      }
    ];
  }
  if (sectionId === "session_security") {
    return [{
      label: "Open Session Security",
      actionId: "application_settings.session_security.open",
      capabilityLabel: "Open Session Security settings",
      description: "Open the existing Session Security settings card.",
      requiredAny: settingsAreaById("session_security").viewCapabilities,
      handler: () => dependencies.openSessionSecurity?.()
    }];
  }
  if (sectionId === "notifications") {
    return [
      {
        label: "Online Users / System Messages",
        actionId: "application_settings.notifications.online.open",
        capabilityLabel: "Open Notification settings",
        description: "Open Online Users and System Messages.",
        requiredAny: settingsAreaById("notifications").viewCapabilities,
        handler: () => dependencies.openNotifications?.("presence")
      },
      {
        label: "System Message History",
        actionId: "application_settings.notifications.history.open",
        capabilityLabel: "Open System Message History",
        description: "Open the existing message history panel.",
        requiredAny: settingsAreaById("notifications").viewCapabilities,
        handler: () => dependencies.openNotifications?.("history")
      }
    ];
  }
  if (sectionId === "advanced") {
    return [{
      label: "Open Access Control / Diagnostics",
      actionId: "application_settings.advanced.diagnostics.open",
      capabilityLabel: "Open Access Control / Diagnostics settings",
      description: "Open the existing Access Control diagnostics workspace.",
      requiredAny: settingsAreaById("advanced").viewCapabilities,
      handler: () => dependencies.openAccessControlDiagnostics?.()
    }];
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

  bridgeActionsFor(sectionId).filter(action => hasAnyCapability(action.requiredAny || APPLICATION_SETTINGS_VIEW_CAPABILITIES)).forEach(action => {
    const card = document.createElement("article");
    card.className = "application-settings-card";
    const h4 = document.createElement("h4");
    h4.textContent = action.label;
    const p = document.createElement("p");
    p.textContent = action.description || settingsStatusCopy(definition.status);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open";
    button.addEventListener("click", action.handler);
    decorateCapabilityAction(button, {
      actionId: action.actionId,
      label: action.capabilityLabel,
      area: "Application Settings",
      requiredAny: action.requiredAny || APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      notes: settingsStatusCopy(definition.status),
      actionType: "navigation"
    });
    card.append(h4, p, button);
    container.appendChild(card);
  });
}

function renderRegistryBridgeActions(sectionId) {
  const container = $("applicationSettingsRegistryBridgeCards");
  if (!container) return;
  container.replaceChildren();

  const actions = bridgeActionsFor(sectionId)
    .filter(action => hasAnyCapability(action.requiredAny || APPLICATION_SETTINGS_VIEW_CAPABILITIES));
  container.classList.toggle("hidden", !actions.length);

  actions.forEach(action => {
    const card = document.createElement("article");
    card.className = "application-settings-card";
    const h4 = document.createElement("h4");
    h4.textContent = action.label;
    const p = document.createElement("p");
    p.textContent = action.description || "Open related settings that are still managed in their existing workspace.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Open";
    button.addEventListener("click", action.handler);
    decorateCapabilityAction(button, {
      actionId: action.actionId,
      label: action.capabilityLabel,
      area: "Application Settings",
      requiredAny: action.requiredAny || APPLICATION_SETTINGS_VIEW_CAPABILITIES,
      notes: "Related settings workspace",
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
    renderRegistryBridgeActions(activeSectionId);
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
  if (!canViewApplicationSettingsRegistry()) {
    categories = [];
    settings = [];
    settingsLoaded = true;
    setStatus("");
    renderActiveSection();
    return;
  }
  setStatus("Loading settings...", "info");
  try {
    const [categoryRows, settingRows] = await Promise.all([
      listApplicationSettingCategories({ force: true }),
      listApplicationSettings(null, null, { force: true })
    ]);
    categories = categoryRows || [];
    settings = settingRows || [];
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
  try {
    await updateApplicationSetting(settingKey, value);
    showToast("Setting saved", "The application setting was updated.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Setting not saved", err.message || "Could not save this setting.", "error");
  }
}

async function resetApplicationSetting(settingKey) {
  if (!canManageApplicationSettings()) {
    showToast("Setting not reset", "Application Settings manage capability is required.", "error");
    return;
  }
  const setting = settings.find(item => item.setting_key === settingKey);
  if (!canResetSetting(setting)) return;
  try {
    await resetApplicationSettingToDefault(settingKey);
    showToast("Setting reset", "The application setting was restored to its default.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Setting not reset", err.message || "Could not reset this setting.", "error");
  }
}

async function resetApplicationSettingsCategory(categoryCode) {
  if (!canManageApplicationSettings()) {
    showToast("Settings not reset", "Application Settings manage capability is required.", "error");
    return;
  }
  const label = categoryLabel(categoryCode);
  if (!window.confirm("Reset " + label + " settings to defaults?")) return;
  try {
    await resetApplicationSettingsCategoryToDefaults(categoryCode);
    showToast("Settings reset", label + " settings were restored to defaults.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Settings not reset", err.message || "Could not reset this settings category.", "error");
  }
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
  const nextSectionId = sectionId === "future_lmt" ? "modules" : (sectionId || "overview");
  if (!canOpenSettingsSection(nextSectionId)) {
    const area = settingsAreaById(nextSectionId);
    showToast(
      "You do not have permission",
      (area ? area.label : "This settings area") + " is not available for your current capabilities.",
      "error"
    );
    activeSectionId = "overview";
  } else {
    activeSectionId = nextSectionId;
  }
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

  window.addEventListener("oh:application-settings-requested", event => {
    const detail = event.detail || {};
    void openApplicationSettingsWorkspace(detail.sectionId || detail.section || "overview");
  });
  window.addEventListener("oh:capabilities-changed", syncApplicationSettingsVisibility);
  syncApplicationSettingsVisibility();
  renderActiveSection();
}
