export const SETTINGS_STATUS_LABELS = Object.freeze({
  native: "Native",
  partially_migrated: "Partially migrated",
  linked: "Linked",
  legacy_bridge: "Legacy bridge",
  future: "Future"
});

export const SETTINGS_STATUS_COPY = Object.freeze({
  native: "Settings are managed here.",
  partially_migrated: "Some settings are managed here; others open existing module settings.",
  linked: "This opens the existing module settings panel.",
  legacy_bridge: "This still opens the legacy VMS settings area while migration continues.",
  future: "This settings area is reserved for a future module."
});

export const SETTINGS_OWNERSHIP_AREAS = Object.freeze([
  {
    id: "general",
    label: "General",
    description: "Product name, platform defaults and application-level behaviour.",
    status: "native",
    owner: "Application Settings",
    currentLocation: "Application Settings -> General",
    targetLocation: "Application Settings -> General",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "settings.view", "settings.edit"],
    manageCapabilities: ["application_settings.manage", "settings.edit"],
    nativeInApplicationSettings: true,
    opensEmbeddedPanel: true,
    deepLinksToExistingPanel: false,
    migrationRisk: "Low",
    futureMilestone: "OHP-017C",
    notes: "Keep controlled registry values in Application Settings."
  },
  {
    id: "branding",
    label: "Branding",
    description: "Brand identity, logo and appearance settings.",
    status: "legacy_bridge",
    owner: "Application Settings",
    currentLocation: "Legacy VMS settings",
    targetLocation: "Application Settings -> Branding",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "settings.view", "settings.edit"],
    manageCapabilities: ["application_settings.manage", "settings.edit"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "Medium",
    futureMilestone: "OHP-017C",
    notes: "Logo, theme and background remain in legacy VMS settings until migrated."
  },
  {
    id: "modules",
    label: "Modules",
    description: "Central entry point for module-level configuration.",
    status: "native",
    owner: "Application Settings",
    currentLocation: "Application Settings -> Modules",
    targetLocation: "Application Settings -> Modules",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "module_configuration.view", "module_configuration.manage"],
    manageCapabilities: ["application_settings.manage", "module_configuration.manage"],
    nativeInApplicationSettings: true,
    opensEmbeddedPanel: true,
    deepLinksToExistingPanel: true,
    migrationRisk: "Low",
    futureMilestone: "OHP-017D",
    notes: "The duplicate Administration Module Configuration nav item was removed; Application Settings -> Modules is the visible entry point."
  },
  {
    id: "visitors",
    label: "Visitors",
    description: "Visitor settings, Form Requirements and existing VMS configuration links.",
    status: "partially_migrated",
    owner: "Application Settings",
    currentLocation: "Visitors workspace, legacy VMS settings and Form Requirements",
    targetLocation: "Application Settings -> Visitors",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "form_requirements.view", "form_requirements.manage", "settings.view", "settings.edit", "visitor.view"],
    manageCapabilities: ["application_settings.manage", "form_requirements.manage", "settings.edit"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "High",
    futureMilestone: "OHP-017C",
    notes: "Keep risky visitor and legacy VMS controls bridged until backend ownership is moved."
  },
  {
    id: "shared_terminal",
    label: "Shared Terminal",
    description: "Trusted terminal and kiosk-device administration.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Administration -> Shared Terminals",
    targetLocation: "Application Settings -> Shared Terminal",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "devices.view", "devices.manage"],
    manageCapabilities: ["application_settings.manage", "devices.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "Medium",
    futureMilestone: "OHP-017C",
    notes: "Open the existing Shared Terminals administration panel."
  },
  {
    id: "documents",
    label: "Documents / Sign-off",
    description: "Document sign-off settings and compliance controls.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Document Sign-offs administration and legacy agreement settings",
    targetLocation: "Application Settings -> Documents / Sign-off",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "agreements.view", "agreements.manage", "document_signoff.manage"],
    manageCapabilities: ["application_settings.manage", "agreements.manage", "document_signoff.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "High",
    futureMilestone: "TBD",
    notes: "Keep specialist document and sign-off settings in their current panels."
  },
  {
    id: "people_assignments",
    label: "People & Assignments",
    description: "Assignment Form Requirements and people-policy settings.",
    status: "partially_migrated",
    owner: "Application Settings",
    currentLocation: "Application Settings -> People & Assignments",
    targetLocation: "Application Settings -> People & Assignments",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "form_requirements.view", "form_requirements.manage", "assignment_field_requirements.view", "assignment_field_requirements.manage", "people.view", "people.manage"],
    manageCapabilities: ["application_settings.manage", "form_requirements.manage", "assignment_field_requirements.manage", "people.manage"],
    nativeInApplicationSettings: true,
    opensEmbeddedPanel: true,
    deepLinksToExistingPanel: false,
    migrationRisk: "Medium",
    futureMilestone: "OHP-017C",
    notes: "Form Requirements are native here; broader people-policy settings remain future work."
  },
  {
    id: "working_time",
    label: "Working Time",
    description: "Work Time Profiles, Break Rules and Unsociable Time rules.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Reference Data working-time entities",
    targetLocation: "Application Settings -> Working Time",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "work_time_profiles.view", "work_time_profiles.manage", "workforce_calendar.manage"],
    manageCapabilities: ["application_settings.manage", "work_time_profiles.manage", "workforce_calendar.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "High",
    futureMilestone: "TBD",
    notes: "Open existing working-time entities; do not alter calculation logic."
  },
  {
    id: "session_security",
    label: "Session Security",
    description: "Staff inactivity, forced actions and Shared Terminal timeout settings.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Access Control -> Online Users / System Messages",
    targetLocation: "Application Settings -> Session Security",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "session_security_settings.view", "session_security_settings.manage", "access_control.view", "access_control.manage"],
    manageCapabilities: ["application_settings.manage", "session_security_settings.manage", "access_control.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "Medium",
    futureMilestone: "TBD",
    notes: "Open the existing Session Security settings card without changing timeout behaviour."
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Online users, system messages and system message history.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Access Control -> Online Users / System Messages",
    targetLocation: "Application Settings -> Notifications",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "online_users.view", "admin_system_messages.view", "admin_system_messages.send", "admin_system_messages.force_action"],
    manageCapabilities: ["application_settings.manage", "admin_system_messages.send", "admin_system_messages.force_action"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "Medium",
    futureMilestone: "TBD",
    notes: "Open the existing online users, system message and history workspace."
  },
  {
    id: "advanced",
    label: "Access Control / Diagnostics",
    description: "Access control, diagnostics and controlled technical settings.",
    status: "linked",
    owner: "Application Settings",
    currentLocation: "Administration -> Access Control",
    targetLocation: "Application Settings -> Access Control / Diagnostics",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "access_control.view", "access_control.manage", "capabilities.diagnose", "module_configuration.view", "module_configuration.manage"],
    manageCapabilities: ["application_settings.manage", "access_control.manage", "module_configuration.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: true,
    migrationRisk: "Medium",
    futureMilestone: "TBD",
    notes: "Keep diagnostics in Access Control; Application Settings owns the front door."
  },
  {
    id: "future_lmt",
    label: "Future LMT",
    description: "Labour management settings reserved for a future module.",
    status: "future",
    owner: "Application Settings",
    currentLocation: "Not available",
    targetLocation: "Application Settings -> Modules -> Future LMT",
    viewCapabilities: ["application_settings.view", "application_settings.manage", "module_configuration.view", "module_configuration.manage"],
    manageCapabilities: ["application_settings.manage", "module_configuration.manage"],
    nativeInApplicationSettings: false,
    opensEmbeddedPanel: false,
    deepLinksToExistingPanel: false,
    migrationRisk: "Low",
    futureMilestone: "Future",
    notes: "Reserved only; no runtime behaviour should be introduced yet."
  }
]);

export const MODULE_SETTINGS_AREA_IDS = Object.freeze([
  "visitors",
  "people_assignments",
  "working_time",
  "documents",
  "session_security",
  "notifications",
  "advanced",
  "branding",
  "future_lmt"
]);

export function settingsStatusLabel(status) {
  return SETTINGS_STATUS_LABELS[status] || String(status || "Linked");
}

export function settingsStatusCopy(status) {
  return SETTINGS_STATUS_COPY[status] || "This opens an existing settings area.";
}

export function settingsAreaById(areaId) {
  return SETTINGS_OWNERSHIP_AREAS.find(area => area.id === areaId) || null;
}
