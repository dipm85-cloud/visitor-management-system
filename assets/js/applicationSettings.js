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
import { saveSetting } from "./settings.js";
import {
  brandedContrastColour,
  brandingImplementationStatus,
  getCurrentBranding,
  isHexColour
} from "./brandingThemeService.js";
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
  "privacy.case.view",
  "privacy.case.manage",
  "privacy.view",
  "privacy.manage",
  "gdpr.view",
  "gdpr.manage",
  "audit.view",
  "identity_resolution.view",
  "identity_resolution.manage",
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
  "role_presets.view",
  "role_presets.manage",
  "user_role_assignments.view",
  "user_role_assignments.manage",
  "capabilities.diagnose",
  "access_control.manage"
];
const APPLICATION_SETTINGS_MANAGE_CAPABILITIES = [
  "application_settings.manage",
  "settings.edit",
  "module_configuration.manage",
  "access_control.manage"
];
const APPLICATION_SETTINGS_MANAGE_ONLY_CAPABILITY = ["application_settings.manage"];
const APPLICATION_SETTINGS_CATEGORY_MANAGE_CAPABILITIES = Object.freeze({
  documents: [
    ...APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
    "agreements.manage",
    "document_signoff.manage"
  ],
  notifications: [
    ...APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
    "admin_system_messages.send",
    "admin_system_messages.force_action"
  ],
  privacy_data_governance: [
    ...APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
    "privacy.case.manage",
    "privacy.manage",
    "gdpr.manage"
  ],
  access_diagnostics: [
    ...APPLICATION_SETTINGS_MANAGE_CAPABILITIES,
    "role_presets.manage",
    "user_role_assignments.manage"
  ]
});
const APPLICATION_SETTINGS_REGISTRY_VIEW_CAPABILITIES = [
  "application_settings.view",
  "application_settings.manage",
  "settings.view",
  "settings.edit",
  "module_configuration.view",
  "module_configuration.manage",
  "agreements.view",
  "agreements.manage",
  "document_signoff.manage",
  "privacy.case.view",
  "privacy.case.manage",
  "privacy.view",
  "privacy.manage",
  "gdpr.view",
  "gdpr.manage",
  "audit.view",
  "online_users.view",
  "admin_system_messages.view",
  "admin_system_messages.send",
  "admin_system_messages.force_action",
  "access_control.view",
  "access_control.manage",
  "role_presets.view",
  "role_presets.manage",
  "user_role_assignments.view",
  "user_role_assignments.manage",
  "capabilities.diagnose"
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
  privacy_gdpr: "privacy_data_governance",
  advanced: "access_diagnostics",
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

const MODULE_CARD_DETAILS = Object.freeze({
  visitors: {
    owner: "Application Settings",
    statusText: "Partially migrated setting",
    configurationState: "Application settings: visitor behaviour and Form Requirements. Reference data: visitor reason codes/dropdowns when implemented. Operational visitor workflows remain in Visitors.",
    indicators: ["Behaviour settings", "Form Requirements", "Reference data future", "Visitor workspace"],
    primaryActionLabel: "Configure"
  },
  people_assignments: {
    owner: "Application Settings",
    statusText: "Partially migrated setting",
    configurationState: "Application settings: assignment Form Requirements. Reference data: sites, departments, contracts, employers and work-time context.",
    indicators: ["Form Requirements", "People workspace", "Reference Data"],
    primaryActionLabel: "Configure"
  },
  working_time: {
    owner: "Reference / Configuration Data",
    statusText: "Managed in Reference Data",
    configurationState: "Application settings: future working-time defaults only. Reference data: Work Time Profiles, Break Rules, Unsociable Time Rules and Rule Sets. Workspace: Rota Calendar.",
    indicators: ["Reference Data", "Work Time Profiles", "Break Rules", "Rota Calendar"],
    primaryActionLabel: "Open Reference Data"
  },
  documents: {
    owner: "Application Settings",
    statusText: "Partially migrated setting",
    configurationState: "Application settings: sign-off behaviour, compliance, evidence display and print defaults. Reference data: agreement/document types. Operational data: sign-off evidence.",
    indicators: ["Behaviour settings", "Agreement types", "Evidence workspace"],
    primaryActionLabel: "Configure"
  },
  privacy_gdpr: {
    owner: "Application Settings",
    statusText: "Partially migrated setting",
    configurationState: "Application settings: privacy guardrails, SAR defaults and reference-display defaults. Specialist workspaces: cases, SAR evidence and anonymisation review.",
    indicators: ["Guardrails", "SAR defaults", "Privacy workspace"],
    primaryActionLabel: "Configure"
  },
  identity_resolution: {
    owner: "Specialist workspace",
    statusText: "Linked specialist workspace",
    configurationState: "Application Settings provides the shortcut. Identity review queues, candidates, confirmed links and decisions remain operational/specialist data.",
    indicators: ["Review queue", "Candidate matching", "Operational data"],
    primaryActionLabel: "Open module"
  },
  notifications: {
    owner: "Application Settings",
    statusText: "Partially migrated setting",
    configurationState: "Application settings: message defaults, expiry, grace and history rows. Operational/admin workspace: online users, sending messages and history.",
    indicators: ["Notification defaults", "Online users", "Message history", "Groups future"],
    primaryActionLabel: "Configure"
  },
  shared_terminal: {
    owner: "Application Settings",
    statusText: "Partially configured",
    configurationState: "Terminal display and idle reset settings are native; device/token administration stays linked.",
    indicators: ["Terminal settings", "Public branding", "Device tokens", "Idle reset"],
    primaryActionLabel: "Configure"
  },
  advanced: {
    owner: "Application Settings",
    statusText: "Diagnostics native",
    configurationState: "Application settings: diagnostics defaults and Capability Inspector status. Security configuration: Role Presets, capability assignment and User Role Assignments in Access Control.",
    indicators: ["Diagnostics defaults", "Security Configuration", "Role Presets", "User assignments"],
    primaryActionLabel: "Configure"
  },
  future_lmt: {
    owner: "Future",
    statusText: "Future",
    configurationState: "Future LMT behaviour settings belong here. Exception reasons and contract policies belong in Reference / Configuration Data when the module exists.",
    indicators: ["Behaviour settings future", "Reference data future", "No runtime behaviour yet"],
    primaryActionLabel: "Coming later"
  }
});

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

const BRANDING_THEME_RESET_KEYS = Object.freeze([
  "branding.theme_mode",
  "branding.primary_color",
  "branding.accent_color",
  "branding.brand_contrast_mode",
  "branding.background_mode",
  "branding.background_color",
  "branding.background_gradient_start_color",
  "branding.background_gradient_end_color",
  "branding.background_gradient_direction",
  "branding.background_gradient_strength",
  "branding.background_image_url",
  "branding.background_opacity",
  "branding.public_screen_background_mode",
  "branding.public_screen_background_color",
  "branding.public_screen_gradient_start_color",
  "branding.public_screen_gradient_end_color",
  "branding.public_screen_gradient_direction",
  "branding.public_screen_gradient_strength",
  "branding.public_screen_background_image_url",
  "branding.public_screen_background_opacity",
  "branding.corner_style"
]);

const SELECT_VALUE_LABELS = Object.freeze({
  "branding.brand_contrast_mode": Object.freeze({
    auto: "Auto contrast",
    light_text: "Light text",
    dark_text: "Dark text"
  }),
  "document_signoff.default_evidence_detail_level": Object.freeze({
    compact: "Compact",
    standard: "Standard",
    detailed: "Detailed"
  }),
  "notifications.default_message_type": Object.freeze({
    info: "Info",
    warning: "Warning",
    maintenance: "Maintenance",
    access_update: "Access update",
    refresh_required: "Refresh required"
  })
});

const SETTING_HELP_TEXT = Object.freeze({
  "branding.brand_contrast_mode": "Auto is recommended. This controls text on branded buttons and active navigation only.",
  "document_signoff.require_scroll_to_end_before_signing": "Locked by system / Future controlled document viewer.",
  "privacy.anonymisation_requires_preview": "Locked by system. Anonymisation preview remains mandatory.",
  "privacy.anonymisation_requires_confirmation_phrase": "Locked by system. The confirmation phrase guardrail remains mandatory.",
  "access_diagnostics.capability_inspector_available": "Locked by system. Access still requires diagnostic capability.",
  "access_diagnostics.capability_inspector_session_only": "Locked by system. Capability Inspector is not persisted."
});

function canViewApplicationSettings() {
  return hasAnyCapability(APPLICATION_SETTINGS_VIEW_CAPABILITIES);
}

function canManageApplicationSettings() {
  return hasAnyCapability(APPLICATION_SETTINGS_MANAGE_CAPABILITIES);
}

function canManageApplicationSettingsOnly() {
  return hasAnyCapability(APPLICATION_SETTINGS_MANAGE_ONLY_CAPABILITY);
}

function categoryManageCapabilities(categoryCode) {
  return APPLICATION_SETTINGS_CATEGORY_MANAGE_CAPABILITIES[categoryCode] || APPLICATION_SETTINGS_MANAGE_CAPABILITIES;
}

function canManageApplicationSettingsCategory(categoryCode) {
  return hasAnyCapability(categoryManageCapabilities(categoryCode));
}

function settingManageCapabilities(setting) {
  return setting && setting.setting_key === "branding.brand_contrast_mode"
    ? APPLICATION_SETTINGS_MANAGE_ONLY_CAPABILITY
    : categoryManageCapabilities(setting?.category_code);
}

function canManageApplicationSetting(setting) {
  return hasAnyCapability(settingManageCapabilities(setting));
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

function canManageApplicationSettingsSection(sectionId) {
  const definition = sectionDefinition(sectionId);
  return canManageApplicationSettingsCategory(definition?.category || sectionId);
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
  if (area.id === "working_time") return "Open Working Time Reference Data";
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
      label: "Open Application Settings -> " + section.title,
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
  container.classList.add("application-settings-module-grid");

  MODULE_SETTING_CARDS.filter(canViewSettingsArea).forEach(cardDefinition => {
    container.appendChild(createModuleSettingsCard(cardDefinition));
  });
}

function moduleDetailsFor(area) {
  return MODULE_CARD_DETAILS[area.id] || {
    owner: area.owner || "Application Settings",
    statusText: settingsStatusLabel(area.status),
    configurationState: area.notes || settingsStatusCopy(area.status),
    indicators: [area.targetLocation || area.label],
    primaryActionLabel: primaryActionLabel(area)
  };
}

function createModuleSettingsCard(area) {
  const details = moduleDetailsFor(area);
  const card = document.createElement("article");
  card.className = "application-settings-card application-settings-module-card";
  card.dataset.moduleSettingsArea = area.id;

  const heading = document.createElement("div");
  heading.className = "application-settings-module-heading";
  const headingText = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = area.label;
  const description = document.createElement("p");
  description.textContent = area.description;
  headingText.append(title, description);
  const badges = document.createElement("div");
  badges.className = "application-settings-module-badges";
  const status = statusBadge(area.status);
  status.textContent = details.statusText || settingsStatusLabel(area.status);
  status.title = settingsStatusCopy(area.status);
  const owner = document.createElement("span");
  owner.className = "application-settings-card-status";
  owner.textContent = details.owner;
  badges.append(status, owner);
  heading.append(headingText, badges);
  card.appendChild(heading);

  const state = document.createElement("p");
  state.className = "application-settings-module-state";
  state.textContent = details.configurationState;
  card.appendChild(state);

  const indicators = document.createElement("div");
  indicators.className = "application-settings-module-indicators";
  (details.indicators || []).forEach(item => {
    const chip = document.createElement("span");
    chip.textContent = item;
    indicators.appendChild(chip);
  });
  card.appendChild(indicators);

  const actions = document.createElement("div");
  actions.className = "application-settings-module-actions";
  moduleActionsFor(area).forEach(action => {
    if (action.hidden || !hasAnyCapability(action.requiredAny || area.viewCapabilities || APPLICATION_SETTINGS_VIEW_CAPABILITIES)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.secondary ? "secondary" : "";
    button.textContent = action.label;
    button.disabled = !!action.disabled;
    if (!action.disabled && typeof action.handler === "function") {
      button.addEventListener("click", action.handler);
    }
    decorateCapabilityAction(button, {
      actionId: action.actionId,
      label: action.capabilityLabel || action.label,
      area: "Application Settings",
      requiredAny: action.requiredAny || area.viewCapabilities,
      notes: action.description || details.configurationState,
      actionType: action.actionType || "navigation"
    });
    actions.appendChild(button);
  });
  card.appendChild(actions);

  return card;
}

function moduleActionsFor(area) {
  const details = moduleDetailsFor(area);
  if (area.status === "future") {
    return [{
      label: details.primaryActionLabel || "Coming later",
      actionId: "application_settings.modules." + area.id + ".open",
      capabilityLabel: "Open Future LMT card",
      description: details.configurationState,
      requiredAny: area.viewCapabilities,
      secondary: true,
      handler: () => showToast("Coming later", details.configurationState, "info")
    }];
  }
  const sectionAction = {
    label: details.primaryActionLabel || "Configure",
    actionId: "application_settings.modules." + area.id + ".configure",
    capabilityLabel: area.status === "managed_reference_data"
      ? "Open Reference Data -> " + area.label
      : "Open/configure " + area.label + " module",
    description: details.configurationState,
    requiredAny: area.viewCapabilities,
    handler: area.status === "managed_reference_data"
      ? () => dependencies.openWorkingTimeEntity?.("workTimeProfiles")
      : () => openApplicationSettingsSection(area.id)
  };
  const actions = [sectionAction];
  moduleQuickActionsFor(area.id).forEach(action => actions.push(action));
  return actions;
}

function moduleQuickActionsFor(sectionId) {
  if (sectionId === "visitors") {
    return [
      {
        label: "Planned requirements",
        actionId: "application_settings.modules.visitors.planned_requirements.open",
        description: "Open planned visit Form Requirements.",
        requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
        secondary: true,
        handler: () => openFormRequirementsArea("planned_visits")
      },
      {
        label: "Walk-in requirements",
        actionId: "application_settings.modules.visitors.walk_in_requirements.open",
        description: "Open visitor walk-in Form Requirements.",
        requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
        secondary: true,
        handler: () => openFormRequirementsArea("visitor_walk_ins")
      },
      {
        label: "Shared Terminal",
        actionId: "application_settings.modules.visitors.shared_terminal.open",
        description: "Open Shared Terminal settings related to visitor flow.",
        requiredAny: settingsAreaById("shared_terminal").viewCapabilities,
        secondary: true,
        handler: () => openApplicationSettingsSection("shared_terminal")
      }
    ];
  }
  if (sectionId === "people_assignments") {
    return [
      {
        label: "Assignment requirements",
        actionId: "application_settings.modules.people_assignments.requirements.open",
        description: "Open assignment Form Requirements.",
        requiredAny: FIELD_REQUIREMENT_VIEW_CAPABILITIES,
        secondary: true,
        handler: () => openFormRequirementsArea("work_assignments")
      }
    ];
  }
  if (sectionId === "privacy_gdpr") {
    return [{
      label: "Open governance",
      actionId: "application_settings.modules.privacy_gdpr.open",
      description: "Open Privacy / Data Governance.",
      requiredAny: settingsAreaById("privacy_gdpr").viewCapabilities,
      secondary: true,
      handler: () => dependencies.openPrivacyGdpr?.()
    }];
  }
  if (sectionId === "identity_resolution") {
    return [{
      label: "Open identity queue",
      actionId: "application_settings.modules.identity_resolution.open",
      description: "Open Identity Resolution.",
      requiredAny: settingsAreaById("identity_resolution").viewCapabilities,
      secondary: true,
      handler: () => dependencies.openIdentityResolution?.()
    }];
  }
  if (sectionId === "shared_terminal") {
    return [
      {
        label: "Device admin",
        actionId: "application_settings.modules.shared_terminal.devices.open",
        description: "Open terminal and token administration.",
        requiredAny: settingsAreaById("shared_terminal").viewCapabilities,
        secondary: true,
        handler: () => dependencies.openSharedTerminals?.()
      },
      {
        label: "Public branding",
        actionId: "application_settings.modules.shared_terminal.branding.open",
        description: "Open branding controls used by public terminal screens.",
        requiredAny: settingsAreaById("branding").viewCapabilities,
        secondary: true,
        handler: () => openApplicationSettingsSection("branding")
      }
    ];
  }
  if (sectionId === "advanced") {
    return [
      {
        label: "Security configuration",
        actionId: "application_settings.modules.advanced.access_control.open",
        capabilityLabel: "Open Access Control security configuration",
        description: "Open Access Control for Role Presets and User Role Assignments.",
        requiredAny: ["access_control.view", "access_control.manage", "user_role_assignments.view", "user_role_assignments.manage"],
        secondary: true,
        handler: () => dependencies.openAccessControl?.()
      },
      {
        label: "Diagnostics",
        actionId: "application_settings.modules.advanced.diagnostics.open",
        description: "Open capability diagnostics and effective capability tools.",
        requiredAny: ["capabilities.diagnose", "access_control.view", "access_control.manage"],
        secondary: true,
        handler: () => dependencies.openAccessControlDiagnostics?.()
      }
    ];
  }
  return bridgeActionsFor(sectionId).map(action => ({
    label: action.label,
    actionId: action.actionId.replace("application_settings.", "application_settings.modules."),
    capabilityLabel: "Open/configure " + sectionDefinition(sectionId).title + " module",
    description: action.description,
    requiredAny: action.requiredAny,
    secondary: true,
    handler: action.handler
  }));
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
  const disabled = !canManageApplicationSetting(setting) || setting.locked_by_system || setting.sensitive;
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
    control.value = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : "#475569";
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
      option.textContent = selectOptionLabel(setting, item);
      control.appendChild(option);
    });
    const selectValue = value == null ? "" : String(value);
    control.value = selectValue;
    if (setting.setting_key === "branding.brand_contrast_mode" && !control.value) {
      control.value = "auto";
    }
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.value = value == null ? "" : String(value);
  }

  control.id = settingInputId(setting.setting_key);
  control.disabled = disabled;
  return control;
}

function selectOptionLabel(setting, item) {
  const value = String(jsonValue(item));
  return SELECT_VALUE_LABELS[setting.setting_key]?.[value] || value;
}

function readSettingControlValue(setting) {
  const control = $(settingInputId(setting.setting_key));
  if (!control) return null;
  if (setting.value_type === "boolean") return control.checked;
  if (setting.value_type === "integer") return Number.parseInt(control.value, 10);
  if (setting.value_type === "numeric") return Number(control.value);
  return String(control.value || "");
}

function brandingSettingValue(settingKey, fallback) {
  const setting = settings.find(item => item.setting_key === settingKey);
  const control = setting ? $(settingInputId(setting.setting_key)) : null;
  if (control) {
    if (setting.value_type === "boolean") return control.checked;
    if (setting.value_type === "integer") return Number.parseInt(control.value, 10);
    if (setting.value_type === "numeric") return Number(control.value);
    return String(control.value || "");
  }
  return setting ? jsonValue(setting.setting_value) : fallback;
}

function brandingPreviewLogo(container, logoUrl, transparent) {
  container.replaceChildren();
  container.classList.toggle("transparent", !!transparent && !!logoUrl);
  if (!logoUrl) {
    container.textContent = "OH";
    return;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.src = logoUrl;
  img.addEventListener("error", () => {
    container.replaceChildren();
    container.classList.remove("transparent");
    container.textContent = "OH";
  });
  container.appendChild(img);
}

function brandingPreviewBackground(mode, fallbackBackground, prefix) {
  if (mode === "gradient") {
    const start = String(brandingSettingValue(prefix + "gradient_start_color", "#f8fafc") || "#f8fafc");
    const end = String(brandingSettingValue(prefix + "gradient_end_color", "#e2e8f0") || "#e2e8f0");
    const direction = String(brandingSettingValue(prefix + "gradient_direction", "135deg") || "135deg");
    const strength = String(brandingSettingValue(prefix + "gradient_strength", "subtle") || "subtle");
    const overlay = strength === "medium" ? 0.62 : 0.78;
    return "linear-gradient(" + direction + ", rgba(255,255,255," + overlay + "), rgba(255,255,255," + (overlay - 0.08) + ")), linear-gradient(" + direction + ", " + start + " 0%, " + end + " 100%)";
  }
  return fallbackBackground;
}

function brandingPreviewColour(settingKey, fallback) {
  const value = String(brandingSettingValue(settingKey, fallback) || fallback);
  return isHexColour(value) ? value : fallback;
}

function renderBrandingPreview() {
  const root = $("brandingPreviewRoot");
  if (!root) return;
  root.classList.toggle("hidden", activeSectionId !== "branding");
  if (activeSectionId !== "branding") {
    root.replaceChildren();
    return;
  }

  const current = getCurrentBranding();
  const productName = String(brandingSettingValue("application.product_name", current.productName || "Operations Hub") || "Operations Hub");
  const productSubtitle = String(brandingSettingValue("application.product_subtitle", current.productSubtitle || "Operational workspace") || "Operational workspace");
  const logoUrl = String(brandingSettingValue("branding.logo_url", current.logoUrl || "") || "");
  const printLogoUrl = String(brandingSettingValue("branding.print_logo_url", current.printLogoUrl || "") || "");
  const displayMode = String(brandingSettingValue("branding.header_logo_display_mode", current.headerLogoDisplayMode || "logo_and_name") || "logo_and_name");
  const primaryColour = brandingPreviewColour("branding.primary_color", current.primaryColour || "#475569");
  const accentColour = brandingPreviewColour("branding.accent_color", current.accentColour || "#18a999");
  const contrastMode = String(brandingSettingValue("branding.brand_contrast_mode", current.brandContrastMode || "auto") || "auto");
  const primaryContrast = brandedContrastColour(primaryColour, contrastMode);
  const accentContrast = brandedContrastColour(accentColour, contrastMode);
  const appBackgroundMode = String(brandingSettingValue("branding.background_mode", current.backgroundMode || "default") || "default");
  const appGradientStrength = String(brandingSettingValue("branding.background_gradient_strength", current.backgroundGradientStrength || "subtle") || "subtle");
  const publicBackgroundMode = String(brandingSettingValue("branding.public_screen_background_mode", current.publicScreenBackgroundMode || "inherit_app") || "inherit_app");
  const publicGradientStrength = String(brandingSettingValue("branding.public_screen_gradient_strength", current.publicScreenGradientStrength || "subtle") || "subtle");
  const transparent = brandingSettingValue("branding.logo_transparent_background", current.logoTransparentBackground) === true ||
    brandingSettingValue("branding.logo_transparent_background", current.logoTransparentBackground) === "true";

  root.replaceChildren();
  const preview = document.createElement("section");
  preview.className = "branding-preview";
  preview.setAttribute("aria-label", "Branding preview");
  preview.style.setProperty("--oh-brand-primary", primaryColour);
  preview.style.setProperty("--oh-brand-primary-contrast", primaryContrast);
  preview.style.setProperty("--oh-brand-accent", accentColour);
  preview.style.setProperty("--oh-brand-accent-contrast", accentContrast);
  preview.style.setProperty("--oh-nav-active-background", primaryColour);
  preview.style.setProperty("--oh-nav-active-text", primaryContrast);
  preview.style.setProperty("--oh-nav-active-icon-background", primaryContrast === "#101828" ? "rgba(16,24,40,.10)" : "rgba(255,255,255,.18)");
  preview.style.background = brandingPreviewBackground(appBackgroundMode, "", "branding.background_");

  const appSurface = document.createElement("article");
  appSurface.className = "branding-preview-surface";
  const header = document.createElement("div");
  header.className = "branding-preview-header";
  const logo = document.createElement("div");
  logo.className = "branding-preview-logo";
  const title = document.createElement("div");
  title.className = "branding-preview-title";
  const titleStrong = document.createElement("strong");
  titleStrong.textContent = productName;
  const subtitle = document.createElement("span");
  subtitle.textContent = productSubtitle;
  title.append(titleStrong, subtitle);
  if (displayMode !== "name_only") {
    brandingPreviewLogo(logo, displayMode === "default_mark_and_name" ? "" : logoUrl, transparent);
    header.appendChild(logo);
  }
  if (displayMode !== "logo_only") header.appendChild(title);
  appSurface.appendChild(header);

  const row = document.createElement("div");
  row.className = "branding-preview-row";
  const button = document.createElement("span");
  button.className = "branding-preview-button";
  button.textContent = "Primary action";
  const accent = document.createElement("span");
  accent.className = "branding-preview-accent";
  accent.textContent = "Accent chip";
  const nav = document.createElement("span");
  nav.className = "branding-preview-nav";
  nav.textContent = "Active navigation";
  row.append(button, accent, nav);
  const card = document.createElement("div");
  card.className = "branding-preview-card";
  const cardTitle = document.createElement("strong");
  cardTitle.textContent = "Sample branded card";
  const cardBody = document.createElement("span");
  cardBody.textContent = "App background mode: " + appBackgroundMode.replace(/_/g, " ") +
    (appBackgroundMode === "gradient" ? " (" + appGradientStrength + ")" : "");
  card.append(cardTitle, cardBody);
  appSurface.append(row, card);

  const publicSurface = document.createElement("article");
  publicSurface.className = "branding-preview-surface branding-preview-public";
  publicSurface.style.background = brandingPreviewBackground(publicBackgroundMode, "", "branding.public_screen_");
  const publicTitle = document.createElement("strong");
  publicTitle.textContent = "Shared Terminal / public screen";
  const publicBody = document.createElement("span");
  publicBody.textContent = "Public background mode: " + publicBackgroundMode.replace(/_/g, " ") +
    (publicBackgroundMode === "gradient" ? " (" + publicGradientStrength + ")" : "");
  const printText = document.createElement("span");
  printText.textContent = printLogoUrl
    ? "Print logo configured for supported print outputs."
    : "Print logo falls back to main logo or OH mark.";
  publicSurface.append(publicTitle, publicBody, printText);

  preview.append(appSurface, publicSurface);
  root.appendChild(preview);
}

function settingActionId(setting, suffix) {
  return "application_settings." + String(setting.category_code || "setting") + "." +
    String(setting.setting_key || "setting").replace(/[^a-z0-9]+/gi, "_") + "." + suffix;
}

function canResetSetting(setting) {
  return canManageApplicationSetting(setting) && setting && !setting.locked_by_system && !setting.sensitive;
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
    const headingActions = document.createElement("div");
    headingActions.className = "application-settings-heading-actions";
    if (categoryCode === "branding") {
      const resetTheme = document.createElement("button");
      resetTheme.type = "button";
      resetTheme.className = "secondary";
      resetTheme.textContent = "Reset Theme Colours";
      resetTheme.disabled = !canManageApplicationSettingsOnly();
      resetTheme.addEventListener("click", resetBrandingThemeColours);
      decorateCapabilityAction(resetTheme, {
        actionId: "application_settings.branding.reset_theme_colours",
        label: "Reset theme colours",
        area: "Application Settings",
        requiredAny: APPLICATION_SETTINGS_MANAGE_ONLY_CAPABILITY,
        actionType: "reset"
      });
      headingActions.appendChild(resetTheme);
    }
    const resetCategory = document.createElement("button");
    resetCategory.type = "button";
    resetCategory.className = "secondary";
    resetCategory.textContent = categoryCode === "branding" ? "Reset All Branding" : "Reset Category";
    resetCategory.disabled = !(categoryCode === "branding" ? canManageApplicationSettingsOnly() : canManageApplicationSettingsCategory(categoryCode)) || !items.some(canResetSetting);
    resetCategory.addEventListener("click", () => resetApplicationSettingsCategory(categoryCode));
    decorateCapabilityAction(resetCategory, {
      actionId: "application_settings." + categoryCode + ".reset_defaults",
      label: categoryCode === "branding" ? "Reset all branding" : "Reset " + categoryLabel(categoryCode) + " defaults",
      area: "Application Settings",
      requiredAny: categoryCode === "branding"
        ? APPLICATION_SETTINGS_MANAGE_ONLY_CAPABILITY
        : categoryManageCapabilities(categoryCode),
      actionType: "reset"
    });
    headingActions.appendChild(resetCategory);
    heading.append(headingText, headingActions);
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
          : canManageApplicationSetting(setting)
            ? "Editable"
            : "Read only";
      summary.append(name, description, meta);
      const implementationStatus = brandingImplementationStatus(setting.setting_key);
      if (implementationStatus) {
        const status = document.createElement("span");
        status.className = "application-settings-card-status is-" +
          (implementationStatus.label === "Applied" ? "applied" : "partial");
        status.textContent = implementationStatus.label;
        status.title = implementationStatus.detail;
        summary.appendChild(status);
      }

      const field = document.createElement("label");
      field.className = "application-settings-control";
      const label = document.createElement("span");
      label.textContent = setting.setting_key === "branding.brand_contrast_mode"
        ? "Branded text contrast mode"
        : setting.setting_key;
      const control = createSettingControl(setting);
      if (setting.category_code === "branding") {
        control.addEventListener("input", renderBrandingPreview);
        control.addEventListener("change", renderBrandingPreview);
      }
      field.append(label, control);
      const settingHelpText = SETTING_HELP_TEXT[setting.setting_key];
      if (settingHelpText) {
        const help = document.createElement("small");
        help.textContent = settingHelpText;
        field.appendChild(help);
      }

      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.disabled = !canManageApplicationSetting(setting) || setting.locked_by_system || setting.sensitive;
      save.addEventListener("click", () => saveApplicationSetting(setting.setting_key));
      decorateCapabilityAction(save, {
        actionId: settingActionId(setting, "save"),
        label: setting.setting_key === "branding.brand_contrast_mode"
          ? "Save branded text contrast mode"
          : "Save " + (setting.setting_name || setting.setting_key),
        area: "Application Settings",
        requiredAny: settingManageCapabilities(setting),
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
        label: setting.setting_key === "branding.brand_contrast_mode"
          ? "Reset branded text contrast mode"
          : "Reset " + (setting.setting_name || setting.setting_key),
        area: "Application Settings",
        requiredAny: settingManageCapabilities(setting),
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
    return [
      {
        label: "Document Sign-off Admin",
        actionId: "application_settings.documents.admin.open",
        capabilityLabel: "Open Documents / Sign-off settings",
        description: "Open document/sign-off behaviour and specialist sign-off administration.",
        requiredAny: settingsAreaById("documents").viewCapabilities,
        handler: () => dependencies.openDocuments?.("overview")
      },
      {
        label: "Agreement / Document Types",
        actionId: "application_settings.documents.types.open",
        capabilityLabel: "Open Agreement/document type configuration",
        description: "Open customer-specific agreement/document type configuration.",
        requiredAny: settingsAreaById("documents").viewCapabilities,
        handler: () => dependencies.openDocuments?.("document-types")
      },
      {
        label: "Evidence workspace",
        actionId: "application_settings.documents.evidence.open",
        capabilityLabel: "Open document evidence workspace",
        description: "Open operational sign-off evidence and compliance detail areas.",
        requiredAny: settingsAreaById("documents").viewCapabilities,
        handler: () => dependencies.openDocuments?.("legacy-tools")
      }
    ];
  }
  if (sectionId === "privacy_gdpr") {
    return [
      {
        label: "Privacy Case Workspace",
        actionId: "application_settings.privacy_gdpr.cases.open",
        capabilityLabel: "Open Privacy / Data Governance settings",
        description: "Open the specialist privacy case operational workspace.",
        requiredAny: settingsAreaById("privacy_gdpr").viewCapabilities,
        handler: () => dependencies.openPrivacyGdpr?.("cases")
      },
      {
        label: "SAR Evidence Pack",
        actionId: "application_settings.privacy_gdpr.sar_pack.open",
        capabilityLabel: "Open SAR Evidence Pack",
        description: "Open SAR evidence pack specialist workflow.",
        requiredAny: settingsAreaById("privacy_gdpr").viewCapabilities,
        handler: () => dependencies.openPrivacyGdpr?.("evidence-pack")
      },
      {
        label: "Anonymisation Preview",
        actionId: "application_settings.privacy_gdpr.anonymisation_preview.open",
        capabilityLabel: "Open Anonymisation Preview",
        description: "Open controlled anonymisation preview. Native anonymisation remains disabled.",
        requiredAny: settingsAreaById("privacy_gdpr").manageCapabilities,
        handler: () => dependencies.openPrivacyGdpr?.("anonymisation-preview")
      },
      {
        label: "Anonymisation Rules Matrix",
        actionId: "application_settings.privacy_gdpr.anonymisation_rules.open",
        capabilityLabel: "Open Anonymisation Rules Matrix",
        description: "Open read-only source-by-source anonymisation readiness rules.",
        requiredAny: settingsAreaById("privacy_gdpr").manageCapabilities,
        handler: () => dependencies.openPrivacyGdpr?.("anonymisation-rules")
      },
      {
        label: "Privacy Search",
        actionId: "application_settings.privacy_gdpr.search.open",
        capabilityLabel: "Open Privacy search/source-specific search areas",
        description: "Open source-specific privacy search areas.",
        requiredAny: settingsAreaById("privacy_gdpr").viewCapabilities,
        handler: () => dependencies.openPrivacyGdpr?.("search")
      }
    ];
  }
  if (sectionId === "identity_resolution") {
    return [{
      label: "Open Identity Resolution",
      actionId: "application_settings.identity_resolution.open",
      capabilityLabel: "Open Identity Resolution settings",
      description: "Open the existing Identity Resolution workspace.",
      requiredAny: settingsAreaById("identity_resolution").viewCapabilities,
      handler: () => dependencies.openIdentityResolution?.()
    }];
  }
  if (sectionId === "working_time") {
    return [
      {
        label: "Work Time Profiles",
        actionId: "application_settings.working_time.profiles.open",
        capabilityLabel: "Open Reference Data -> Work Time Profiles",
        description: "Open Work Time Profiles in Reference Data / Working Time Configuration.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("workTimeProfiles")
      },
      {
        label: "Break Rules",
        actionId: "application_settings.working_time.break_rules.open",
        capabilityLabel: "Open Reference Data -> Break Rules",
        description: "Open Break Rules in Reference Data / Working Time Configuration.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("breakRules")
      },
      {
        label: "Unsociable Time Rules",
        actionId: "application_settings.working_time.unsociable_rules.open",
        capabilityLabel: "Open Reference Data -> Unsociable Time Rules",
        description: "Open Unsociable Time Rules in Reference Data / Working Time Configuration.",
        requiredAny: settingsAreaById("working_time").viewCapabilities,
        handler: () => dependencies.openWorkingTimeEntity?.("unsociableTimeRules")
      },
      {
        label: "Unsociable Rule Sets",
        actionId: "application_settings.working_time.unsociable_sets.open",
        capabilityLabel: "Open Reference Data -> Unsociable Rule Sets",
        description: "Open Unsociable Rule Sets in Reference Data / Working Time Configuration.",
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
        label: "Online Users",
        actionId: "application_settings.notifications.online.open",
        capabilityLabel: "Open Online Users",
        description: "Open the operational Online Users workspace.",
        requiredAny: settingsAreaById("notifications").viewCapabilities,
        handler: () => dependencies.openNotifications?.("presence")
      },
      {
        label: "Send System Message",
        actionId: "application_settings.notifications.send_message.open",
        capabilityLabel: "Open Send System Message",
        description: "Open the operational send system message workflow.",
        requiredAny: ["admin_system_messages.send", "admin_system_messages.force_action", "access_control.manage"],
        handler: () => dependencies.openNotifications?.("send")
      },
      {
        label: "System Message History",
        actionId: "application_settings.notifications.history.open",
        capabilityLabel: "Open System Message History",
        description: "Open the operational system message history panel.",
        requiredAny: settingsAreaById("notifications").viewCapabilities,
        handler: () => dependencies.openNotifications?.("history")
      },
      {
        label: "Notification Groups",
        actionId: "application_settings.notifications.groups.future",
        capabilityLabel: "Open future Notification Groups placeholder",
        description: "Future Reference / Configuration Data for notification groups. No runtime behaviour in OHP-017F.",
        requiredAny: settingsAreaById("notifications").manageCapabilities,
        handler: () => showToast("Coming later", "Notification Groups are reserved for a future notification-routing milestone.", "info")
      }
    ];
  }
  if (sectionId === "advanced") {
    return [
      {
        label: "Access Control Workspace",
        actionId: "application_settings.advanced.access_control.open",
        capabilityLabel: "Open Access Control workspace",
        description: "Open Access Control for security configuration.",
        requiredAny: settingsAreaById("advanced").viewCapabilities,
        handler: () => dependencies.openAccessControl?.()
      },
      {
        label: "Role Presets",
        actionId: "application_settings.advanced.role_presets.open",
        capabilityLabel: "Open Role Presets",
        description: "Open Security Configuration for role presets because they affect permissions.",
        requiredAny: ["role_presets.view", "role_presets.manage", "access_control.view", "access_control.manage"],
        handler: () => dependencies.openAccessControl?.("roles")
      },
      {
        label: "User Role Assignments",
        actionId: "application_settings.advanced.user_assignments.open",
        capabilityLabel: "Open User Role Assignments",
        description: "Open Security Configuration for user role assignments.",
        requiredAny: ["user_role_assignments.view", "user_role_assignments.manage", "access_control.view", "access_control.manage"],
        handler: () => dependencies.openAccessControl?.("assignments")
      },
      {
        label: "Effective Capability Viewer",
        actionId: "application_settings.advanced.effective_capabilities.open",
        capabilityLabel: "Open Effective Capability Viewer",
        description: "Open effective capability diagnostics.",
        requiredAny: ["capabilities.diagnose", "user_role_assignments.view", "user_role_assignments.manage", "access_control.view", "access_control.manage"],
        handler: () => dependencies.openAccessControl?.("diagnostics")
      },
      {
        label: "Capability Inspector Status",
        actionId: "application_settings.advanced.capability_inspector_status.open",
        capabilityLabel: "Open Capability Inspector status/help",
        description: "Open capability diagnostics; Capability Inspector itself remains session-only.",
        requiredAny: ["capabilities.diagnose", "access_control.view", "access_control.manage"],
        handler: () => dependencies.openAccessControlDiagnostics?.()
      }
    ];
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
    renderBrandingPreview();
    renderRegistryBridgeActions(activeSectionId);
  }

  const badge = $("applicationSettingsModeBadge");
  if (badge) {
    badge.textContent = canManageApplicationSettingsSection(activeSectionId)
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
  const setting = settings.find(item => item.setting_key === settingKey);
  if (!canManageApplicationSetting(setting)) {
    showToast("Setting not saved", "The required manage capability is missing.", "error");
    return;
  }
  if (!setting || setting.locked_by_system || setting.sensitive) return;
  const value = readSettingControlValue(setting);
  if (setting.ui_component === "colour" && value && !isHexColour(value)) {
    showToast("Setting not saved", "Use a valid hex colour such as #475569.", "error");
    return;
  }
  try {
    await updateApplicationSetting(settingKey, value);
    if (settingKey === "document_signoff.use_confirmed_identity_links_for_compliance") {
      await syncLegacyDocumentComplianceSetting(value);
    }
    showToast("Setting saved", "The application setting was updated.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Setting not saved", err.message || "Could not save this setting.", "error");
  }
}

async function resetApplicationSetting(settingKey) {
  const setting = settings.find(item => item.setting_key === settingKey);
  if (!canManageApplicationSetting(setting)) {
    showToast("Setting not reset", "The required manage capability is missing.", "error");
    return;
  }
  if (!canResetSetting(setting)) return;
  try {
    await resetApplicationSettingToDefault(settingKey);
    if (settingKey === "document_signoff.use_confirmed_identity_links_for_compliance") {
      await syncLegacyDocumentComplianceSetting(false);
    }
    showToast("Setting reset", "The application setting was restored to its default.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Setting not reset", err.message || "Could not reset this setting.", "error");
  }
}

async function resetApplicationSettingsCategory(categoryCode) {
  if (!(categoryCode === "branding" ? canManageApplicationSettingsOnly() : canManageApplicationSettingsCategory(categoryCode))) {
    showToast("Settings not reset", "The required manage capability is missing.", "error");
    return;
  }
  const label = categoryLabel(categoryCode);
  if (!window.confirm("Reset " + label + " settings to defaults?")) return;
  try {
    await resetApplicationSettingsCategoryToDefaults(categoryCode);
    if (categoryCode === "documents") {
      await syncLegacyDocumentComplianceSetting(false);
    }
    showToast("Settings reset", label + " settings were restored to defaults.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Settings not reset", err.message || "Could not reset this settings category.", "error");
  }
}

async function syncLegacyDocumentComplianceSetting(value) {
  try {
    await saveSetting(
      "document_signoff.use_confirmed_identity_links_for_compliance",
      value,
      "Use confirmed identity links for document/induction compliance"
    );
  } catch (err) {
    console.warn("Could not sync legacy document compliance setting.", err);
  }
}

async function resetBrandingThemeColours() {
  if (!canManageApplicationSettingsOnly()) {
    showToast("Theme colours not reset", "Application Settings manage capability is required.", "error");
    return;
  }
  if (!window.confirm("Reset theme colours, backgrounds and corner style to defaults? Logos, favicon, print logo and header logo settings will be preserved.")) return;
  try {
    await Promise.all(BRANDING_THEME_RESET_KEYS.map(settingKey => resetApplicationSettingToDefault(settingKey)));
    showToast("Theme colours reset", "Theme colours, backgrounds and corner style were restored to defaults. Logo settings were preserved.", "success");
    await loadApplicationSettingsData();
  } catch (err) {
    showToast("Theme colours not reset", err.message || "Could not reset theme colour settings.", "error");
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
