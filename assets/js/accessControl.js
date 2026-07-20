import { supabaseClient } from "./api.js";
import { downloadCsv, downloadXlsx } from "./exports.js";
import {
  hasAnyCapability,
  loadUserCapabilities
} from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import {
  showAdministrationWorkspace,
  syncNavigationCapabilityVisibility
} from "./shell.js";
import {
  refreshSectionNavigator,
  registerModuleSections,
  selectModuleSection
} from "./sectionNavigation.js";
import { AppState } from "./state.js";
import { settingValue } from "./settings.js";
import { exportDateStamp } from "./utils.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";
import {
  canViewAdminPresence,
  refreshAdminPresenceWorkspace,
  syncAdminPresenceUi
} from "./adminPresence.js";

const ROLE_PRESET_VIEW_CAPABILITIES = [
  "role_presets.view",
  "role_presets.manage",
  "access_control.view",
  "access_control.manage",
  "module_configuration.manage",
  "settings.view"
];

const ROLE_PRESET_MANAGE_CAPABILITIES = [
  "role_presets.manage",
  "access_control.manage",
  "module_configuration.manage",
  "settings.edit"
];

const USER_ROLE_ASSIGNMENT_VIEW_CAPABILITIES = [
  "user_role_assignments.view",
  "user_role_assignments.manage",
  "capabilities.diagnose",
  "users.view",
  "users.manage",
  "access_control.view",
  "access_control.manage",
  "role_presets.view",
  "role_presets.manage",
  "module_configuration.manage",
  "settings.view"
];

const USER_ROLE_ASSIGNMENT_MANAGE_CAPABILITIES = [
  "user_role_assignments.manage",
  "users.manage",
  "access_control.manage",
  "module_configuration.manage",
  "settings.edit"
];

const ADMIN_PRESENCE_CAPABILITIES = [
  "online_users.view",
  "admin_system_messages.view",
  "admin_system_messages.send",
  "admin_system_messages.force_action",
  "session_security_settings.view",
  "session_security_settings.manage",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.view"
];

let accessControlData = {
  rolePresets: [],
  capabilities: [],
  groups: [],
  userAssignments: []
};
let accessControlInitialised = false;
let rolePresetPanelState = {
  mode: "details",
  role: null,
  userAssignment: null,
  capabilityCatalogue: [],
  selectedCapabilityCodes: new Set(),
  capabilityFilter: "",
  trigger: null
};
let roleCodeEditedByUser = false;
let rolePresetSearchTimer = null;
let userAssignmentSearchTimer = null;
let effectiveCapabilityState = {
  userAssignment: null,
  capabilities: [],
  searchText: "",
  groupFilter: "",
  effectiveOnly: false,
  testCode: ""
};

function hasActiveProfile() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active
  );
}

function hasAccessControlAccess() {
  return hasActiveProfile() && (
    hasAnyCapability(ROLE_PRESET_VIEW_CAPABILITIES) ||
    hasAnyCapability(USER_ROLE_ASSIGNMENT_VIEW_CAPABILITIES) ||
    hasAnyCapability(ADMIN_PRESENCE_CAPABILITIES)
  );
}

function hasAccessControlDataAccess() {
  return hasActiveProfile() && (
    hasAnyCapability(ROLE_PRESET_VIEW_CAPABILITIES) ||
    hasAnyCapability(USER_ROLE_ASSIGNMENT_VIEW_CAPABILITIES)
  );
}

function hasAccessControlManageAccess() {
  return hasActiveProfile() && hasAnyCapability(ROLE_PRESET_MANAGE_CAPABILITIES);
}

function hasUserRoleAssignmentAccess() {
  return hasActiveProfile() && hasAnyCapability(USER_ROLE_ASSIGNMENT_VIEW_CAPABILITIES);
}

function hasUserRoleAssignmentManageAccess() {
  return hasActiveProfile() && hasAnyCapability(USER_ROLE_ASSIGNMENT_MANAGE_CAPABILITIES);
}

function requireAccessControlAccess() {
  if (hasAccessControlAccess()) return true;
  showToast(
    "You do not have permission",
    "Access Control requires role preset or access-control view permission.",
    "error"
  );
  return false;
}

function requireAccessControlManageAccess() {
  if (hasAccessControlManageAccess()) return true;
  showToast(
    "You do not have permission",
    "Managing custom role presets requires role preset management permission.",
    "error"
  );
  return false;
}

function requireUserRoleAssignmentAccess() {
  if (hasUserRoleAssignmentAccess()) return true;
  showToast(
    "You do not have permission",
    "User role assignments require assignment or access-control view permission.",
    "error"
  );
  return false;
}

function requireUserRoleAssignmentManageAccess() {
  if (hasUserRoleAssignmentManageAccess()) return true;
  showToast(
    "You do not have permission",
    "Assigning role presets requires user role assignment management permission.",
    "error"
  );
  return false;
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

export function showReferenceDataAdministrationSection() {
  syncAccessControlVisibility();
  if (!hasAnyCapability(["settings.view", "settings.edit"])) return;
  setAdministrationSection("reference");
}

export function syncAccessControlVisibility() {
  const visible = hasAccessControlAccess();
  const referenceVisible = hasAnyCapability(["settings.view", "settings.edit"]);
  $("administrationAccessControlNav").classList.toggle("hidden", !visible);
  $("administrationReferenceNav").classList.toggle("hidden", !referenceVisible);
  if (!visible && !$("accessControlSection").classList.contains("hidden")) {
    closeRolePresetPanel(false);
    if (referenceVisible) setAdministrationSection("reference");
  } else if (
    !referenceVisible &&
    !$("referenceDataSection").classList.contains("hidden") &&
    visible
  ) {
    setAdministrationSection("access");
  }
  syncAccessControlPermissionUi();
  syncAdminPresenceUi();
}

function syncAccessControlPermissionUi() {
  const canManage = hasAccessControlManageAccess();
  const canManageAssignments = hasUserRoleAssignmentManageAccess();
  const badge = $("accessControlPermissionBadge");
  if (badge) {
    badge.textContent = canManage || canManageAssignments
      ? "Access control editable"
      : "Read only";
  }
  const newButton = $("accessControlNewRolePresetButton");
  if (newButton) {
    newButton.classList.toggle("hidden", !canManage);
    newButton.disabled = !canManage;
  }
  [
    $("accessControlUserAssignmentExportCsvButton"),
    $("accessControlUserAssignmentExportXlsxButton"),
    $("accessControlDiagnosticsExportCsvButton")
  ].forEach(button => {
    if (button) button.classList.toggle("hidden", !hasUserRoleAssignmentAccess());
  });
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text === null || text === undefined || text === "" ? "-" : String(text);
  return cell;
}

function createActiveStatus(active) {
  const status = document.createElement("span");
  status.className = "people-status " + (active === false ? "inactive" : "active");
  status.textContent = active === false ? "Inactive" : "Active";
  return status;
}

function createYesNoStatus(value) {
  const status = document.createElement("span");
  status.className = "people-status " + (value ? "active" : "inactive");
  status.textContent = value ? "Yes" : "No";
  return status;
}

function createRoleTypeBadge(role) {
  const badge = document.createElement("span");
  badge.className = "access-control-type-badge " + (role.is_system ? "system" : "custom");
  badge.textContent = role.is_system ? "System / Protected" : "Custom";
  return badge;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normaliseRolePreset(row) {
  return {
    role_preset_id: row.role_preset_id || row.id || "",
    role_code: row.role_code || "",
    role_name: row.role_name || "",
    description: row.description || "",
    active: row.active !== false,
    is_system: row.is_system === true || row.is_system_role === true,
    capability_count: Number(row.capability_count || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function normaliseCapability(row) {
  return {
    capability_id: row.capability_id || row.id || "",
    capability_code: row.capability_code || "",
    capability_name: row.capability_name || "",
    capability_description: row.capability_description || row.description || "",
    capability_active: row.capability_active !== undefined ? row.capability_active : row.active,
    group_code: row.group_code || "ungrouped",
    group_name: row.group_name || "Ungrouped",
    group_display_order: Number(row.group_display_order || row.display_order || 9999),
    assigned: row.assigned === true
  };
}

function normaliseUserRoleAssignment(row) {
  return {
    profile_id: row.profile_id || "",
    display_name: row.display_name || "",
    legacy_role: row.legacy_role || "",
    active: row.active !== false,
    assigned_role_preset_id: row.assigned_role_preset_id || "",
    assigned_role_code: row.assigned_role_code || "",
    assigned_role_name: row.assigned_role_name || "",
    assigned_role_is_system: row.assigned_role_is_system === true,
    effective_role_preset_id: row.effective_role_preset_id || "",
    effective_role_code: row.effective_role_code || "",
    effective_role_name: row.effective_role_name || "",
    effective_role_is_system: row.effective_role_is_system === true,
    direct_allow_count: Number(row.direct_allow_count || 0),
    direct_deny_count: Number(row.direct_deny_count || 0),
    effective_capability_count: Number(row.effective_capability_count || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function normaliseEffectiveCapability(row) {
  return {
    capability_id: row.capability_id || "",
    capability_code: row.capability_code || "",
    capability_name: row.capability_name || "",
    capability_description: row.capability_description || "",
    group_code: row.group_code || "ungrouped",
    group_name: row.group_name || "Ungrouped",
    role_preset_id: row.role_preset_id || "",
    role_code: row.role_code || "",
    role_name: row.role_name || "",
    role_assigned: row.role_assigned === true,
    direct_grant_state: row.direct_grant_state || "",
    effective: row.effective === true,
    effective_source: row.effective_source || "not_granted"
  };
}

function rolePresetFilters() {
  return {
    searchText: $("accessControlRoleSearch") ? $("accessControlRoleSearch").value.trim() : "",
    includeInactive: $("accessControlIncludeInactive") ? $("accessControlIncludeInactive").checked : true
  };
}

function userAssignmentFilters() {
  return {
    searchText: $("accessControlUserAssignmentSearch")
      ? $("accessControlUserAssignmentSearch").value.trim()
      : "",
    includeInactive: $("accessControlUserAssignmentIncludeInactive")
      ? $("accessControlUserAssignmentIncludeInactive").checked
      : defaultUserAssignmentIncludeInactive()
  };
}

function accessDiagnosticsBool(settingKey, fallback) {
  const value = settingValue(settingKey, fallback);
  return value === true || value === "true";
}

function defaultUserAssignmentIncludeInactive() {
  return accessDiagnosticsBool("access_diagnostics.default_user_assignment_include_inactive", true);
}

function showEffectiveCapabilitySource() {
  return accessDiagnosticsBool("access_diagnostics.show_effective_capability_source", true);
}

function groupCapabilities(capabilities) {
  const grouped = new Map();
  [...(capabilities || [])]
    .sort((a, b) =>
      Number(a.group_display_order || 9999) - Number(b.group_display_order || 9999) ||
      String(a.group_name || "").localeCompare(String(b.group_name || "")) ||
      String(a.capability_code || "").localeCompare(String(b.capability_code || ""))
    )
    .forEach(capability => {
      const groupName = capability.group_name || "Ungrouped";
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(capability);
    });
  return grouped;
}

function renderRolePresets() {
  const body = $("accessControlRolePresets");
  body.replaceChildren();
  const canManage = hasAccessControlManageAccess();

  accessControlData.rolePresets.forEach(role => {
    const row = document.createElement("tr");

    const roleCell = document.createElement("td");
    const name = document.createElement("strong");
    name.className = "access-control-table-primary";
    name.textContent = role.role_name || "-";
    const description = document.createElement("span");
    description.className = "access-control-table-secondary";
    description.textContent = role.description || "No description.";
    roleCell.append(name, description);

    const codeCell = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = role.role_code || "-";
    codeCell.appendChild(code);

    const typeCell = document.createElement("td");
    typeCell.appendChild(createRoleTypeBadge(role));

    const statusCell = document.createElement("td");
    statusCell.appendChild(createActiveStatus(role.active));

    const countCell = createCell(role.capability_count);
    const updatedCell = createCell(formatDate(role.updated_at || role.created_at));

    const actionCell = document.createElement("td");
    actionCell.className = "access-control-row-actions";

    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "secondary";
    detailsButton.textContent = "View Details";
    decorateCapabilityAction(detailsButton, {
      actionId: "access_control.role_presets.view_details",
      label: "View Role Preset Details",
      area: "Access Control",
      requiredAny: ["role_presets.view", "role_presets.manage", "access_control.view", "access_control.manage"],
      actionType: "view"
    });
    detailsButton.addEventListener("click", event => {
      openRolePresetDetails(role.role_preset_id, event.currentTarget);
    });
    actionCell.appendChild(detailsButton);

    if (canManage && !role.is_system) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary";
      editButton.textContent = "Edit Custom Role";
      decorateCapabilityAction(editButton, {
        actionId: "access_control.role_presets.edit_custom",
        label: "Edit Custom Role Preset",
        area: "Access Control",
        requiredAny: ["role_presets.manage", "access_control.manage"],
        actionType: "edit"
      });
      editButton.addEventListener("click", event => {
        openRolePresetForm("edit", role.role_preset_id, event.currentTarget);
      });

      const capabilitiesButton = document.createElement("button");
      capabilitiesButton.type = "button";
      capabilitiesButton.className = "secondary";
      capabilitiesButton.textContent = "Manage Capabilities";
      decorateCapabilityAction(capabilitiesButton, {
        actionId: "access_control.role_presets.manage_capabilities",
        label: "Manage Role Preset Capabilities",
        area: "Access Control",
        requiredAny: ["role_presets.manage", "access_control.manage"],
        actionType: "manage"
      });
      capabilitiesButton.addEventListener("click", event => {
        openManageCapabilities(role.role_preset_id, event.currentTarget);
      });

      actionCell.append(editButton, capabilitiesButton);
    }

    row.append(
      roleCell,
      codeCell,
      typeCell,
      statusCell,
      countCell,
      updatedCell,
      actionCell
    );
    body.appendChild(row);
  });

  const empty = accessControlData.rolePresets.length === 0;
  $("accessControlRolesEmpty").classList.toggle("hidden", !empty);
  $("accessControlRolePresetSummary").textContent = empty
    ? ""
    : accessControlData.rolePresets.length + " role preset" +
      (accessControlData.rolePresets.length === 1 ? "" : "s");
}

function rolePresetLabelFromParts(name, code) {
  const safeName = String(name || "").trim();
  const safeCode = String(code || "").trim();
  if (safeName && safeCode) return safeName + " (" + safeCode + ")";
  return safeName || safeCode || "-";
}

function renderUserRoleAssignments() {
  const body = $("accessControlUserAssignments");
  if (!body) return;
  body.replaceChildren();
  const canManage = hasUserRoleAssignmentManageAccess();

  accessControlData.userAssignments.forEach(assignment => {
    const row = document.createElement("tr");

    const userCell = document.createElement("td");
    const name = document.createElement("strong");
    name.className = "access-control-table-primary";
    name.textContent = assignment.display_name || "Unnamed profile";
    const id = document.createElement("span");
    id.className = "access-control-table-secondary access-control-monospace";
    id.textContent = assignment.profile_id;
    userCell.append(name, id);

    const statusCell = document.createElement("td");
    statusCell.appendChild(createActiveStatus(assignment.active));

    const assignedCell = document.createElement("td");
    assignedCell.appendChild(createRoleAssignmentPresetBadge(
      assignment.assigned_role_name,
      assignment.assigned_role_code,
      assignment.assigned_role_is_system,
      "Fallback to legacy role"
    ));

    const effectiveCell = document.createElement("td");
    effectiveCell.appendChild(createRoleAssignmentPresetBadge(
      assignment.effective_role_name,
      assignment.effective_role_code,
      assignment.effective_role_is_system,
      "No effective preset"
    ));

    const actionCell = document.createElement("td");
    actionCell.className = "access-control-row-actions";

    if (canManage) {
      const assign = document.createElement("button");
      assign.type = "button";
      assign.className = "secondary";
      assign.textContent = "Assign Role Preset";
      decorateCapabilityAction(assign, {
        actionId: "access_control.user_role_assignments.assign",
        label: "Assign Role Preset",
        area: "Access Control",
        requiredAny: ["user_role_assignments.manage", "users.manage", "access_control.manage"],
        actionType: "manage"
      });
      assign.addEventListener("click", event => {
        openUserRoleAssignmentPanel(assignment, event.currentTarget);
      });
      actionCell.appendChild(assign);
    }

    const capabilities = document.createElement("button");
    capabilities.type = "button";
    capabilities.className = "secondary";
    capabilities.textContent = "View Effective Capabilities";
    decorateCapabilityAction(capabilities, {
      actionId: "access_control.user_role_assignments.view_effective_capabilities",
      label: "View Effective Capabilities",
      area: "Access Control",
      requiredAny: ["capabilities.diagnose", "user_role_assignments.view", "user_role_assignments.manage"],
      actionType: "view"
    });
    capabilities.addEventListener("click", () => {
      openEffectiveCapabilitiesForUser(assignment);
    });
    actionCell.appendChild(capabilities);

    if (canManage && assignment.assigned_role_preset_id) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "secondary";
      clear.textContent = "Clear Explicit Assignment";
      decorateCapabilityAction(clear, {
        actionId: "access_control.user_role_assignments.clear",
        label: "Clear Explicit Role Preset Assignment",
        area: "Access Control",
        requiredAny: ["user_role_assignments.manage", "users.manage", "access_control.manage"],
        actionType: "manage"
      });
      clear.addEventListener("click", () => clearUserRoleAssignment(assignment));
      actionCell.appendChild(clear);
    }

    row.append(
      userCell,
      statusCell,
      createCell(assignment.legacy_role),
      assignedCell,
      effectiveCell,
      createCell(assignment.effective_capability_count),
      createCell("Allow " + assignment.direct_allow_count + " / Deny " + assignment.direct_deny_count),
      createCell(formatDate(assignment.updated_at || assignment.created_at)),
      actionCell
    );
    body.appendChild(row);
  });

  const empty = accessControlData.userAssignments.length === 0;
  $("accessControlUserAssignmentsEmpty").classList.toggle("hidden", !empty);
  $("accessControlUserAssignmentSummary").textContent = empty
    ? ""
    : accessControlData.userAssignments.length + " profile" +
      (accessControlData.userAssignments.length === 1 ? "" : "s");
}

function createRoleAssignmentPresetBadge(name, code, isSystem, fallbackText) {
  const wrapper = document.createElement("span");
  wrapper.className = "access-control-preset-stack";
  const label = document.createElement("span");
  label.className = "access-control-table-primary";
  label.textContent = rolePresetLabelFromParts(name, code);
  wrapper.appendChild(label);
  if (name || code) {
    const badge = document.createElement("span");
    badge.className = "access-control-type-badge " + (isSystem ? "system" : "custom");
    badge.textContent = isSystem ? "System" : "Custom";
    wrapper.appendChild(badge);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "access-control-table-secondary";
    fallback.textContent = fallbackText || "-";
    wrapper.appendChild(fallback);
  }
  return wrapper;
}

function renderCapabilities() {
  const body = $("accessControlCapabilities");
  body.replaceChildren();

  accessControlData.capabilities.forEach(capability => {
    const row = document.createElement("tr");
    row.appendChild(createCell(capability.capability_code));
    row.appendChild(createCell(capability.capability_name));
    row.appendChild(createCell(capability.group_name));
    row.appendChild(createCell(capability.description || capability.capability_description));
    const activeCell = document.createElement("td");
    activeCell.appendChild(createActiveStatus(capability.active));
    row.appendChild(activeCell);
    body.appendChild(row);
  });

  $("accessControlCapabilitiesEmpty").classList.toggle(
    "hidden",
    accessControlData.capabilities.length > 0
  );
}

function renderCapabilityGroups() {
  const body = $("accessControlGroups");
  body.replaceChildren();

  accessControlData.groups.forEach(group => {
    const capabilityCount = accessControlData.capabilities.filter(
      capability => capability.group_code === group.group_code
    ).length;
    const row = document.createElement("tr");
    row.appendChild(createCell(group.group_name));
    row.appendChild(createCell(group.group_code));
    row.appendChild(createCell(group.description));
    row.appendChild(createCell(capabilityCount));
    const activeCell = document.createElement("td");
    activeCell.appendChild(createActiveStatus(group.active));
    row.appendChild(activeCell);
    body.appendChild(row);
  });

  $("accessControlGroupsEmpty").classList.toggle(
    "hidden",
    accessControlData.groups.length > 0
  );
}

function effectiveCapabilityMatchesFilter(capability) {
  const filterText = String(effectiveCapabilityState.searchText || "").toLowerCase();
  const groupFilter = String(effectiveCapabilityState.groupFilter || "");
  if (effectiveCapabilityState.effectiveOnly && !capability.effective) return false;
  if (groupFilter && capability.group_code !== groupFilter) return false;
  if (!filterText) return true;
  return [
    capability.capability_code,
    capability.capability_name,
    capability.capability_description,
    capability.group_code,
    capability.group_name,
    capability.effective_source,
    capability.direct_grant_state,
    capability.role_code,
    capability.role_name
  ].some(value => String(value || "").toLowerCase().includes(filterText));
}

function renderEffectiveCapabilityGroupFilter() {
  const select = $("accessControlCapabilityDiagnosticGroup");
  if (!select) return;
  const current = effectiveCapabilityState.groupFilter;
  const groups = new Map();
  effectiveCapabilityState.capabilities.forEach(capability => {
    groups.set(capability.group_code, capability.group_name);
  });
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All groups";
  select.appendChild(all);
  Array.from(groups.entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .forEach(([code, name]) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name || code;
      select.appendChild(option);
    });
  select.value = groups.has(current) ? current : "";
  effectiveCapabilityState.groupFilter = select.value;
}

function renderEffectiveCapabilityDiagnostics() {
  const body = $("accessControlEffectiveCapabilities");
  if (!body) return;
  body.replaceChildren();
  renderEffectiveCapabilityGroupFilter();

  const selected = effectiveCapabilityState.userAssignment;
  const selectedUser = $("accessControlDiagnosticsSelectedUser");
  if (selectedUser) {
    selectedUser.textContent = selected
      ? (selected.display_name || "Unnamed profile") + " - " + selected.profile_id
      : "No user profile selected.";
  }

  const rows = effectiveCapabilityState.capabilities.filter(effectiveCapabilityMatchesFilter);
  rows.forEach(capability => {
    const row = document.createElement("tr");

    const capabilityCell = document.createElement("td");
    const name = document.createElement("strong");
    name.className = "access-control-table-primary";
    name.textContent = capability.capability_name || capability.capability_code;
    const code = document.createElement("code");
    code.textContent = capability.capability_code;
    const description = document.createElement("span");
    description.className = "access-control-table-secondary";
    description.textContent = capability.capability_description || "";
    capabilityCell.append(name, code, description);

    const effectiveCell = document.createElement("td");
    effectiveCell.appendChild(createYesNoStatus(capability.effective));

    row.append(
      createCell(capability.group_name),
      capabilityCell,
      effectiveCell,
      createCell(showEffectiveCapabilitySource() ? capability.effective_source : "Hidden by setting"),
      createCell(rolePresetLabelFromParts(capability.role_name, capability.role_code)),
      createCell(capability.direct_grant_state || "-")
    );
    body.appendChild(row);
  });

  const empty = $("accessControlEffectiveCapabilitiesEmpty");
  if (empty) {
    empty.textContent = selected
      ? "No capabilities match the current filters."
      : "Select a user profile to view effective capabilities.";
  }
  empty.classList.toggle(
    "hidden",
    Boolean(selected) && rows.length > 0
  );
  $("accessControlDiagnosticsSummary").textContent = selected
    ? rows.length + " of " + effectiveCapabilityState.capabilities.length + " capabilities shown"
    : "";
}

function renderAccessControl() {
  renderRolePresets();
  renderUserRoleAssignments();
  renderEffectiveCapabilityDiagnostics();
  renderCapabilities();
  renderCapabilityGroups();
  syncAccessControlPermissionUi();
}

function setPanelBusy(isBusy, label) {
  const saveButton = $("rolePresetCapabilitySaveButton");
  const cancelButton = $("rolePresetCapabilityCancelButton");
  const closeButton = $("rolePresetCapabilityPanelCloseButton");
  if (saveButton) {
    saveButton.disabled = isBusy;
    if (label) saveButton.textContent = label;
  }
  if (cancelButton) cancelButton.disabled = isBusy;
  if (closeButton) closeButton.disabled = isBusy;
}

function setPanelActions(options) {
  const settings = options || {};
  const saveButton = $("rolePresetCapabilitySaveButton");
  const cancelButton = $("rolePresetCapabilityCancelButton");
  if (saveButton) {
    saveButton.classList.toggle("hidden", settings.saveVisible === false);
    saveButton.textContent = settings.saveLabel || "Save";
  }
  if (cancelButton) {
    cancelButton.textContent = settings.cancelLabel || "Cancel";
  }
}

function openPanel(options) {
  const settings = options || {};
  rolePresetPanelState.trigger = settings.trigger instanceof HTMLElement
    ? settings.trigger
    : document.activeElement;
  $("rolePresetCapabilityPanelTitle").textContent = settings.title || "Role Preset";
  $("rolePresetCapabilityPanelRole").textContent = settings.subtitle || "";
  $("rolePresetCapabilityPanel").classList.remove("hidden");
  $("rolePresetCapabilityPanel").setAttribute("aria-hidden", "false");
  setPanelActions({
    saveVisible: settings.saveVisible,
    saveLabel: settings.saveLabel,
    cancelLabel: settings.cancelLabel
  });
  setTimeout(() => {
    const first = $("rolePresetCapabilityPanel").querySelector(
      "input:not([disabled]), textarea:not([disabled]), button:not([disabled])"
    );
    if (first) first.focus({ preventScroll: true });
  }, 0);
}

function closeRolePresetPanel(restoreFocus = true) {
  const returnFocus = rolePresetPanelState.trigger;
  $("rolePresetCapabilityPanel").classList.add("hidden");
  $("rolePresetCapabilityPanel").setAttribute("aria-hidden", "true");
  rolePresetPanelState = {
    mode: "details",
    role: null,
    userAssignment: null,
    capabilityCatalogue: [],
    selectedCapabilityCodes: new Set(),
    capabilityFilter: "",
    trigger: null
  };
  roleCodeEditedByUser = false;
  setPanelBusy(false);
  if (
    restoreFocus &&
    returnFocus &&
    returnFocus.isConnected
  ) {
    returnFocus.focus({ preventScroll: true });
  }
}

function clearPanelBody() {
  $("rolePresetCapabilitySafetyNotice").textContent = "";
  $("rolePresetCapabilitySafetyNotice").classList.add("hidden");
  $("rolePresetCapabilityGroups").replaceChildren();
}

function setPanelNotice(message, type) {
  const notice = $("rolePresetCapabilitySafetyNotice");
  notice.textContent = message || "";
  notice.className = "assignment-editor-notice";
  if (type) notice.classList.add(type);
  notice.classList.toggle("hidden", !message);
}

function rolePresetById(rolePresetId) {
  return accessControlData.rolePresets.find(
    role => role.role_preset_id === rolePresetId
  );
}

async function fetchRolePreset(rolePresetId) {
  const result = await supabaseClient.rpc("get_role_preset_for_management", {
    p_role_preset_id: rolePresetId
  });
  if (result.error) throw result.error;
  return normaliseRolePreset((result.data || [])[0] || {});
}

async function fetchAssignedCapabilities(rolePresetId) {
  const result = await supabaseClient.rpc("list_role_preset_assigned_capabilities", {
    p_role_preset_id: rolePresetId
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normaliseCapability);
}

async function fetchCapabilityCatalogue(rolePresetId) {
  const result = await supabaseClient.rpc("list_capability_catalogue_for_role_preset", {
    p_role_preset_id: rolePresetId || null,
    p_search_text: null,
    p_include_inactive: false
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normaliseCapability);
}

async function fetchActiveRolePresetsForAssignment() {
  const result = await supabaseClient.rpc("list_role_presets_for_management", {
    p_include_inactive: false,
    p_search_text: null
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normaliseRolePreset);
}

async function fetchEffectiveCapabilities(profileId) {
  const result = await supabaseClient.rpc("list_profile_effective_capabilities", {
    p_profile_id: profileId
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normaliseEffectiveCapability);
}

function createDetailRow(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value === null || value === undefined || value === "" ? "-" : String(value);
  wrapper.append(term, description);
  return wrapper;
}

function renderRoleAssignmentPanel(assignment, presets) {
  const container = $("rolePresetCapabilityGroups");
  container.replaceChildren();

  const summary = document.createElement("dl");
  summary.className = "access-control-detail-list";
  summary.append(
    createDetailRow("User", assignment.display_name || "Unnamed profile"),
    createDetailRow("Profile ID", assignment.profile_id),
    createDetailRow("Legacy role", assignment.legacy_role),
    createDetailRow("Current assigned preset", rolePresetLabelFromParts(assignment.assigned_role_name, assignment.assigned_role_code)),
    createDetailRow("Effective preset", rolePresetLabelFromParts(assignment.effective_role_name, assignment.effective_role_code)),
    createDetailRow("Effective capabilities", assignment.effective_capability_count)
  );

  const form = document.createElement("form");
  form.id = "userRoleAssignmentForm";
  form.className = "access-control-role-form";
  form.noValidate = true;

  const presetLabel = document.createElement("label");
  presetLabel.className = "access-control-panel-field";
  presetLabel.setAttribute("for", "userRolePresetSelect");
  presetLabel.textContent = "Role preset";
  const select = document.createElement("select");
  select.id = "userRolePresetSelect";
  select.required = true;
  presets.forEach(preset => {
    const option = document.createElement("option");
    option.value = preset.role_preset_id;
    option.textContent = rolePresetLabelFromParts(preset.role_name, preset.role_code) +
      (preset.is_system ? " - system" : " - custom") +
      " - " + preset.capability_count + " capabilities";
    select.appendChild(option);
  });
  select.value = assignment.assigned_role_preset_id ||
    assignment.effective_role_preset_id ||
    (presets[0] && presets[0].role_preset_id) ||
    "";
  presetLabel.appendChild(select);

  const details = document.createElement("dl");
  details.className = "access-control-detail-list access-control-selected-preset-details";

  function refreshSelectedPresetDetails() {
    const preset = presets.find(item => item.role_preset_id === select.value);
    details.replaceChildren(
      createDetailRow("Description", preset && preset.description ? preset.description : "No description."),
      createDetailRow("Type", preset && preset.is_system ? "System / Protected" : "Custom"),
      createDetailRow("Capability count", preset ? preset.capability_count : "-"),
      createDetailRow("Status", preset && preset.active ? "Active" : "Inactive")
    );
  }

  select.addEventListener("change", refreshSelectedPresetDetails);
  form.append(presetLabel, details);
  form.addEventListener("submit", event => {
    event.preventDefault();
    saveRolePresetPanel();
  });

  container.append(summary, form);
  refreshSelectedPresetDetails();

  if (AppState.currentProfile && AppState.currentProfile.id === assignment.profile_id) {
    setPanelNotice(
      "For safety, you cannot assign a non-SuperUser preset to your own profile in this milestone.",
      "warning"
    );
  }
}

function renderCapabilitySummary(capabilities) {
  const container = document.createElement("div");
  container.className = "access-control-detail-capabilities";
  const grouped = groupCapabilities(capabilities);
  if (grouped.size === 0) {
    const empty = document.createElement("p");
    empty.className = "access-control-role-empty";
    empty.textContent = "No capabilities are assigned.";
    container.appendChild(empty);
    return container;
  }

  grouped.forEach((items, groupName) => {
    const section = document.createElement("section");
    section.className = "access-control-role-group";
    const title = document.createElement("h4");
    title.textContent = groupName;
    const list = document.createElement("ul");
    items.forEach(item => {
      const listItem = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.capability_name || item.capability_code;
      const code = document.createElement("code");
      code.textContent = item.capability_code;
      listItem.append(name, code);
      list.appendChild(listItem);
    });
    section.append(title, list);
    container.appendChild(section);
  });
  return container;
}

async function openRolePresetDetails(rolePresetId, trigger) {
  if (!requireAccessControlAccess()) return;
  clearPanelBody();
  rolePresetPanelState.mode = "details";
  openPanel({
    trigger,
    title: "Role Preset Details",
    subtitle: "Loading...",
    saveVisible: false,
    cancelLabel: "Close"
  });

  try {
    const [role, assignedCapabilities] = await Promise.all([
      fetchRolePreset(rolePresetId),
      fetchAssignedCapabilities(rolePresetId)
    ]);
    rolePresetPanelState.role = role;
    $("rolePresetCapabilityPanelRole").textContent =
      role.role_name + " (" + role.role_code + ")";
    if (role.is_system) {
      setPanelNotice("System presets are protected and are not editable here.", "info");
    }

    const container = $("rolePresetCapabilityGroups");
    const summary = document.createElement("dl");
    summary.className = "access-control-detail-list";
    summary.append(
      createDetailRow("Role name", role.role_name),
      createDetailRow("Role code", role.role_code),
      createDetailRow("Description", role.description || "No description."),
      createDetailRow("Status", role.active ? "Active" : "Inactive"),
      createDetailRow("Type", role.is_system ? "System / Protected" : "Custom"),
      createDetailRow("Capability count", role.capability_count),
      createDetailRow("Created", formatDate(role.created_at)),
      createDetailRow("Updated", formatDate(role.updated_at))
    );
    container.appendChild(summary);

    const assignmentNote = document.createElement("p");
    assignmentNote.className = "access-control-assignment-note";
    assignmentNote.textContent =
      "User assignment visibility will use the existing user access model when available.";
    container.appendChild(assignmentNote);

    const heading = document.createElement("h3");
    heading.className = "access-control-panel-subtitle";
    heading.textContent = "Assigned capabilities";
    container.append(heading, renderCapabilitySummary(assignedCapabilities));

    if (!role.is_system && hasAccessControlManageAccess()) {
      const actions = document.createElement("div");
      actions.className = "access-control-detail-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit Custom Role";
      editButton.addEventListener("click", () => {
        openRolePresetForm("edit", role.role_preset_id, editButton);
      });
      const manageButton = document.createElement("button");
      manageButton.type = "button";
      manageButton.className = "secondary";
      manageButton.textContent = "Manage Capabilities";
      manageButton.addEventListener("click", () => {
        openManageCapabilities(role.role_preset_id, manageButton);
      });
      actions.append(editButton, manageButton);
      container.appendChild(actions);
    }
  } catch (err) {
    closeRolePresetPanel(false);
    showToast(
      "Role preset details unavailable",
      err.message || "Could not load role preset details.",
      "error"
    );
  }
}

async function openUserRoleAssignmentPanel(assignment, trigger) {
  if (!requireUserRoleAssignmentManageAccess()) return;
  clearPanelBody();
  rolePresetPanelState.mode = "assign-profile-role";
  rolePresetPanelState.userAssignment = assignment;
  openPanel({
    trigger,
    title: "Assign Role Preset",
    subtitle: assignment.display_name || assignment.profile_id,
    saveVisible: true,
    saveLabel: "Save Assignment"
  });

  try {
    const presets = await fetchActiveRolePresetsForAssignment();
    if (!presets.length) {
      showToast("Role presets unavailable", "No active role presets are available for assignment.", "error");
      closeRolePresetPanel(false);
      return;
    }
    rolePresetPanelState.capabilityCatalogue = presets;
    renderRoleAssignmentPanel(assignment, presets);
  } catch (err) {
    showToast(
      "Role assignment unavailable",
      err.message || "Could not load role presets for assignment.",
      "error"
    );
    closeRolePresetPanel(false);
  }
}

function normaliseRoleCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function capabilityMatchesFilter(capability, filterText) {
  const filter = String(filterText || "").trim().toLowerCase();
  if (!filter) return true;
  return [
    capability.capability_code,
    capability.capability_name,
    capability.capability_description,
    capability.group_code,
    capability.group_name
  ].some(value => String(value || "").toLowerCase().includes(filter));
}

function updateSelectedCapabilityCount() {
  const count = $("rolePresetSelectedCapabilityCount");
  if (count) {
    const selected = rolePresetPanelState.selectedCapabilityCodes.size;
    count.textContent = selected + " selected";
  }
}

function renderCapabilityPicker() {
  const host = $("rolePresetCapabilityPicker");
  if (!host) return;
  host.replaceChildren();

  const visibleCapabilities = rolePresetPanelState.capabilityCatalogue.filter(
    capability => capabilityMatchesFilter(capability, rolePresetPanelState.capabilityFilter)
  );
  const grouped = groupCapabilities(visibleCapabilities);
  if (grouped.size === 0) {
    const empty = document.createElement("div");
    empty.className = "people-empty-state";
    empty.textContent = "No capabilities match the current filter.";
    host.appendChild(empty);
    updateSelectedCapabilityCount();
    return;
  }

  grouped.forEach((capabilities, groupName) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "role-capability-group";
    const legend = document.createElement("legend");
    legend.textContent = groupName;
    fieldset.appendChild(legend);

    const groupActions = document.createElement("div");
    groupActions.className = "role-capability-group-actions";
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "secondary";
    selectButton.textContent = "Select group";
    selectButton.addEventListener("click", () => {
      capabilities.forEach(capability => {
        rolePresetPanelState.selectedCapabilityCodes.add(capability.capability_code);
      });
      renderCapabilityPicker();
    });
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "secondary";
    clearButton.textContent = "Clear group";
    clearButton.addEventListener("click", () => {
      capabilities.forEach(capability => {
        rolePresetPanelState.selectedCapabilityCodes.delete(capability.capability_code);
      });
      renderCapabilityPicker();
    });
    groupActions.append(selectButton, clearButton);
    fieldset.appendChild(groupActions);

    capabilities.forEach(capability => {
      const label = document.createElement("label");
      label.className = "role-capability-option";
      label.title = capability.capability_description || capability.capability_name;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = capability.capability_code;
      checkbox.checked = rolePresetPanelState.selectedCapabilityCodes.has(capability.capability_code);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          rolePresetPanelState.selectedCapabilityCodes.add(capability.capability_code);
        } else {
          rolePresetPanelState.selectedCapabilityCodes.delete(capability.capability_code);
        }
        updateSelectedCapabilityCount();
      });

      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = capability.capability_name || capability.capability_code;
      const code = document.createElement("code");
      code.textContent = capability.capability_code;
      const description = document.createElement("small");
      description.textContent = capability.capability_description || "No description available.";
      text.append(name, code, description);

      label.append(checkbox, text);
      fieldset.appendChild(label);
    });

    host.appendChild(fieldset);
  });
  updateSelectedCapabilityCount();
}

function createCapabilityPickerControls() {
  const wrapper = document.createElement("section");
  wrapper.className = "access-control-capability-picker";

  const header = document.createElement("div");
  header.className = "access-control-picker-header";
  const title = document.createElement("h3");
  title.className = "access-control-panel-subtitle";
  title.textContent = "Capabilities";
  const count = document.createElement("span");
  count.id = "rolePresetSelectedCapabilityCount";
  count.className = "access-control-result-summary";
  header.append(title, count);

  const filter = document.createElement("label");
  filter.className = "access-control-panel-field";
  filter.setAttribute("for", "rolePresetCapabilitySearchInput");
  filter.textContent = "Filter capabilities";
  const input = document.createElement("input");
  input.id = "rolePresetCapabilitySearchInput";
  input.type = "search";
  input.placeholder = "Capability code, name, description or group";
  input.autocomplete = "off";
  input.value = rolePresetPanelState.capabilityFilter;
  input.addEventListener("input", () => {
    rolePresetPanelState.capabilityFilter = input.value;
    renderCapabilityPicker();
  });
  filter.appendChild(input);

  const picker = document.createElement("div");
  picker.id = "rolePresetCapabilityPicker";
  picker.className = "role-capability-groups";

  wrapper.append(header, filter, picker);
  return wrapper;
}

function populateFormFromRole(role) {
  $("rolePresetNameInput").value = role ? role.role_name : "";
  $("rolePresetCodeInput").value = role ? role.role_code : "";
  $("rolePresetDescriptionInput").value = role ? role.description || "" : "";
  const active = $("rolePresetActiveInput");
  if (active) active.checked = !role || role.active !== false;
}

function renderRolePresetForm(mode, role) {
  const container = $("rolePresetCapabilityGroups");
  container.replaceChildren();

  const form = document.createElement("form");
  form.id = "rolePresetForm";
  form.className = "access-control-role-form";
  form.noValidate = true;

  const nameLabel = document.createElement("label");
  nameLabel.className = "access-control-panel-field";
  nameLabel.setAttribute("for", "rolePresetNameInput");
  nameLabel.textContent = "Role name";
  const nameInput = document.createElement("input");
  nameInput.id = "rolePresetNameInput";
  nameInput.required = true;
  nameInput.autocomplete = "off";
  nameLabel.appendChild(nameInput);

  const codeLabel = document.createElement("label");
  codeLabel.className = "access-control-panel-field";
  codeLabel.setAttribute("for", "rolePresetCodeInput");
  codeLabel.textContent = "Role code";
  const codeInput = document.createElement("input");
  codeInput.id = "rolePresetCodeInput";
  codeInput.required = true;
  codeInput.autocomplete = "off";
  codeInput.spellcheck = false;
  codeInput.pattern = "[a-z0-9_]+";
  codeLabel.appendChild(codeInput);

  const descriptionLabel = document.createElement("label");
  descriptionLabel.className = "access-control-panel-field";
  descriptionLabel.setAttribute("for", "rolePresetDescriptionInput");
  descriptionLabel.textContent = "Description";
  const descriptionInput = document.createElement("textarea");
  descriptionInput.id = "rolePresetDescriptionInput";
  descriptionInput.rows = 4;
  descriptionLabel.appendChild(descriptionInput);

  form.append(nameLabel, codeLabel, descriptionLabel);

  if (mode === "edit") {
    const activeLabel = document.createElement("label");
    activeLabel.className = "access-control-check-option access-control-panel-check";
    activeLabel.setAttribute("for", "rolePresetActiveInput");
    const activeInput = document.createElement("input");
    activeInput.id = "rolePresetActiveInput";
    activeInput.type = "checkbox";
    const activeText = document.createElement("span");
    activeText.textContent = "Active";
    activeLabel.append(activeInput, activeText);
    form.appendChild(activeLabel);
  }

  container.append(form, createCapabilityPickerControls());
  populateFormFromRole(role);

  nameInput.addEventListener("input", () => {
    if (!roleCodeEditedByUser) codeInput.value = normaliseRoleCode(nameInput.value);
  });
  codeInput.addEventListener("input", () => {
    roleCodeEditedByUser = true;
    codeInput.value = normaliseRoleCode(codeInput.value);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    saveRolePresetPanel();
  });
}

async function openRolePresetForm(mode, rolePresetId, trigger) {
  if (!requireAccessControlManageAccess()) return;
  clearPanelBody();
  rolePresetPanelState.mode = mode;
  rolePresetPanelState.capabilityFilter = "";
  rolePresetPanelState.selectedCapabilityCodes = new Set();
  roleCodeEditedByUser = mode === "edit";

  const existingRole = mode === "edit" ? rolePresetById(rolePresetId) : null;
  if (existingRole && existingRole.is_system) {
    showToast(
      "System preset protected",
      "System role presets cannot be edited through custom role preset management.",
      "error"
    );
    openRolePresetDetails(rolePresetId, trigger);
    return;
  }

  openPanel({
    trigger,
    title: mode === "edit" ? "Edit Custom Role" : "New Role Preset",
    subtitle: mode === "edit" && existingRole
      ? existingRole.role_name + " (" + existingRole.role_code + ")"
      : "Create a custom reusable preset",
    saveVisible: true,
    saveLabel: mode === "edit" ? "Save Custom Role" : "Create Role Preset"
  });

  try {
    const [role, catalogue] = await Promise.all([
      mode === "edit" ? fetchRolePreset(rolePresetId) : Promise.resolve(null),
      fetchCapabilityCatalogue(mode === "edit" ? rolePresetId : null)
    ]);
    if (role && role.is_system) {
      showToast(
        "System preset protected",
        "System role presets cannot be edited through custom role preset management.",
        "error"
      );
      openRolePresetDetails(rolePresetId, trigger);
      return;
    }
    rolePresetPanelState.role = role;
    rolePresetPanelState.capabilityCatalogue = catalogue;
    rolePresetPanelState.selectedCapabilityCodes = new Set(
      catalogue.filter(capability => capability.assigned).map(capability => capability.capability_code)
    );
    renderRolePresetForm(mode, role);
    renderCapabilityPicker();
  } catch (err) {
    showToast(
      "Role preset editor unavailable",
      err.message || "Could not load the role preset editor.",
      "error"
    );
    closeRolePresetPanel(false);
  }
}

async function openManageCapabilities(rolePresetId, trigger) {
  if (!requireAccessControlManageAccess()) return;
  clearPanelBody();
  rolePresetPanelState.mode = "manage";
  rolePresetPanelState.capabilityFilter = "";

  const existingRole = rolePresetById(rolePresetId);
  if (existingRole && existingRole.is_system) {
    showToast(
      "System preset protected",
      "System role presets cannot be edited through custom role preset management.",
      "error"
    );
    openRolePresetDetails(rolePresetId, trigger);
    return;
  }

  openPanel({
    trigger,
    title: "Manage Capabilities",
    subtitle: existingRole
      ? existingRole.role_name + " (" + existingRole.role_code + ")"
      : "Loading...",
    saveVisible: true,
    saveLabel: "Save Capabilities"
  });

  try {
    const [role, catalogue] = await Promise.all([
      fetchRolePreset(rolePresetId),
      fetchCapabilityCatalogue(rolePresetId)
    ]);
    if (role.is_system) {
      showToast(
        "System preset protected",
        "System role presets cannot be edited through custom role preset management.",
        "error"
      );
      openRolePresetDetails(rolePresetId, trigger);
      return;
    }
    rolePresetPanelState.role = role;
    rolePresetPanelState.capabilityCatalogue = catalogue;
    rolePresetPanelState.selectedCapabilityCodes = new Set(
      catalogue.filter(capability => capability.assigned).map(capability => capability.capability_code)
    );
    $("rolePresetCapabilityPanelRole").textContent =
      role.role_name + " (" + role.role_code + ")";
    $("rolePresetCapabilityGroups").appendChild(createCapabilityPickerControls());
    renderCapabilityPicker();
  } catch (err) {
    showToast(
      "Capability editor unavailable",
      err.message || "Could not load capabilities for this role preset.",
      "error"
    );
    closeRolePresetPanel(false);
  }
}

function readRolePresetForm() {
  return {
    roleName: $("rolePresetNameInput") ? $("rolePresetNameInput").value.trim() : "",
    roleCode: $("rolePresetCodeInput") ? normaliseRoleCode($("rolePresetCodeInput").value) : "",
    description: $("rolePresetDescriptionInput") ? $("rolePresetDescriptionInput").value.trim() : "",
    active: $("rolePresetActiveInput") ? $("rolePresetActiveInput").checked : true,
    capabilityCodes: Array.from(rolePresetPanelState.selectedCapabilityCodes).sort()
  };
}

function validateRolePresetForm(values) {
  if (!values.roleName) {
    showToast("Role name required", "Enter a role name before saving.", "error");
    return false;
  }
  if (!values.roleCode) {
    showToast("Role code required", "Enter a snake_case role code before saving.", "error");
    return false;
  }
  if (!/^[a-z0-9_]+$/.test(values.roleCode)) {
    showToast("Role code invalid", "Role code must use lowercase letters, numbers and underscores.", "error");
    return false;
  }
  return true;
}

async function refreshCurrentUserCapabilitiesIfNeeded(role) {
  if (!role || AppState.currentProfile?.role !== role.role_code) return;
  await loadUserCapabilities(AppState.currentProfile);
  syncNavigationCapabilityVisibility();
  syncAccessControlVisibility();
  window.dispatchEvent(new CustomEvent("oh:capabilities-changed"));
}

async function refreshCurrentUserCapabilitiesForProfile(profileId) {
  if (!AppState.currentProfile || AppState.currentProfile.id !== profileId) return;
  await loadUserCapabilities(AppState.currentProfile);
  syncNavigationCapabilityVisibility();
  syncAccessControlVisibility();
  window.dispatchEvent(new CustomEvent("oh:capabilities-changed"));
}

async function saveRolePresetPanel() {
  if (rolePresetPanelState.mode === "details") return;

  const mode = rolePresetPanelState.mode;
  if (mode === "assign-profile-role") {
    if (!requireUserRoleAssignmentManageAccess()) return;
    const assignment = rolePresetPanelState.userAssignment;
    const select = $("userRolePresetSelect");
    const rolePresetId = select ? select.value : "";
    if (!assignment || !assignment.profile_id || !rolePresetId) {
      showToast("Assignment incomplete", "Select a user and role preset before saving.", "error");
      return;
    }
    setPanelBusy(true, "Saving...");
    try {
      const result = await supabaseClient.rpc("assign_profile_role_preset", {
        p_profile_id: assignment.profile_id,
        p_role_preset_id: rolePresetId
      });
      if (result.error) throw result.error;
      await loadUserRoleAssignments();
      renderUserRoleAssignments();
      await refreshCurrentUserCapabilitiesForProfile(assignment.profile_id);
      if (
        effectiveCapabilityState.userAssignment &&
        effectiveCapabilityState.userAssignment.profile_id === assignment.profile_id
      ) {
        const updated = accessControlData.userAssignments.find(item => item.profile_id === assignment.profile_id) || assignment;
        await openEffectiveCapabilitiesForUser(updated, { preserveSection: true });
      }
      showToast(
        "Role preset assigned",
        "The user role preset assignment was saved. The user may need to refresh or sign in again for all navigation changes.",
        "success"
      );
      closeRolePresetPanel(false);
    } catch (err) {
      showToast(
        "Role preset not assigned",
        err.message || "Could not assign this role preset.",
        "error"
      );
    } finally {
      setPanelBusy(false, "Save Assignment");
    }
    return;
  }

  if (!requireAccessControlManageAccess()) return;

  const role = rolePresetPanelState.role;
  const capabilityCodes = Array.from(rolePresetPanelState.selectedCapabilityCodes).sort();

  if (mode === "manage") {
    if (!role || role.is_system) {
      showToast("System preset protected", "System role presets cannot be edited here.", "error");
      return;
    }
    setPanelBusy(true, "Saving...");
    try {
      const result = await supabaseClient.rpc("set_custom_role_preset_capabilities", {
        p_role_preset_id: role.role_preset_id,
        p_capability_codes: capabilityCodes
      });
      if (result.error) throw result.error;
      await refreshCurrentUserCapabilitiesIfNeeded(role);
      await loadAccessControl();
      showToast(
        "Capabilities saved",
        role.role_name + " capability assignments were updated.",
        "success"
      );
      await openRolePresetDetails(role.role_preset_id, rolePresetPanelState.trigger);
    } catch (err) {
      showToast(
        "Capabilities not saved",
        err.message || "Could not update role preset capabilities.",
        "error"
      );
    } finally {
      setPanelBusy(false, "Save Capabilities");
    }
    return;
  }

  const values = readRolePresetForm();
  if (!validateRolePresetForm(values)) return;
  setPanelBusy(true, mode === "edit" ? "Saving..." : "Creating...");

  try {
    if (mode === "create") {
      const result = await supabaseClient.rpc("create_custom_role_preset", {
        p_role_code: values.roleCode,
        p_role_name: values.roleName,
        p_description: values.description || null,
        p_capability_codes: values.capabilityCodes
      });
      if (result.error) throw result.error;
      await loadAccessControl();
      showToast(
        "Role preset created",
        values.roleName + " was created.",
        "success"
      );
      if (result.data) {
        await openRolePresetDetails(result.data, rolePresetPanelState.trigger);
      } else {
        closeRolePresetPanel(false);
      }
      return;
    }

    if (!role || role.is_system) {
      showToast("System preset protected", "System role presets cannot be edited here.", "error");
      return;
    }
    const result = await supabaseClient.rpc("update_custom_role_preset", {
      p_role_preset_id: role.role_preset_id,
      p_role_code: values.roleCode,
      p_role_name: values.roleName,
      p_description: values.description || null,
      p_active: values.active,
      p_capability_codes: values.capabilityCodes
    });
    if (result.error) throw result.error;
    await refreshCurrentUserCapabilitiesIfNeeded({ ...role, role_code: values.roleCode });
    await loadAccessControl();
    showToast(
      "Role preset saved",
      values.roleName + " was updated.",
      "success"
    );
    await openRolePresetDetails(role.role_preset_id, rolePresetPanelState.trigger);
  } catch (err) {
    showToast(
      mode === "create" ? "Role preset not created" : "Role preset not saved",
      err.message || "Could not save this role preset.",
      "error"
    );
  } finally {
    setPanelBusy(false, mode === "edit" ? "Save Custom Role" : "Create Role Preset");
  }
}

async function loadRolePresetsForManagement() {
  const filters = rolePresetFilters();
  const result = await supabaseClient.rpc("list_role_presets_for_management", {
    p_include_inactive: filters.includeInactive,
    p_search_text: filters.searchText || null
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normaliseRolePreset);
}

async function loadUserRoleAssignments() {
  if (!hasUserRoleAssignmentAccess()) {
    accessControlData.userAssignments = [];
    return [];
  }
  const filters = userAssignmentFilters();
  const result = await supabaseClient.rpc("list_user_role_assignments", {
    p_include_inactive: filters.includeInactive,
    p_search_text: filters.searchText || null
  });
  if (result.error) throw result.error;
  accessControlData.userAssignments = (result.data || []).map(normaliseUserRoleAssignment);
  return accessControlData.userAssignments;
}

async function loadCapabilityCatalogueTables() {
  const [groupResult, capabilityResult] = await Promise.all([
    supabaseClient
      .from("capability_groups")
      .select("id, group_code, group_name, description, display_order, active")
      .order("display_order", { ascending: true }),
    supabaseClient
      .from("capabilities")
      .select("id, capability_code, capability_name, group_id, description, active, capability_groups(group_code, group_name, display_order)")
      .order("capability_code", { ascending: true })
  ]);

  if (groupResult.error) throw groupResult.error;
  if (capabilityResult.error) throw capabilityResult.error;

  const groups = groupResult.data || [];
  const groupById = new Map(groups.map(group => [group.id, group]));
  const capabilities = (capabilityResult.data || []).map(capability => {
    const relatedGroup = capability.capability_groups || groupById.get(capability.group_id) || {};
    return {
      ...capability,
      group_code: relatedGroup.group_code || "ungrouped",
      group_name: relatedGroup.group_name || "Ungrouped"
    };
  });

  return { groups, capabilities };
}

function userRoleAssignmentExportRows() {
  return accessControlData.userAssignments.map(row => ({
    "Display Name": row.display_name || "",
    "Profile ID": row.profile_id || "",
    "Active": row.active ? "Active" : "Inactive",
    "Legacy Role": row.legacy_role || "",
    "Assigned Role Code": row.assigned_role_code || "",
    "Assigned Role Name": row.assigned_role_name || "",
    "Effective Role Code": row.effective_role_code || "",
    "Effective Role Name": row.effective_role_name || "",
    "Direct Allow Count": row.direct_allow_count,
    "Direct Deny Count": row.direct_deny_count,
    "Effective Capability Count": row.effective_capability_count
  }));
}

function effectiveCapabilityExportRows() {
  return effectiveCapabilityState.capabilities
    .filter(effectiveCapabilityMatchesFilter)
    .map(row => ({
      "Group": row.group_name || "",
      "Capability Code": row.capability_code || "",
      "Capability Name": row.capability_name || "",
      "Effective": row.effective ? "Yes" : "No",
      "Source": showEffectiveCapabilitySource() ? row.effective_source || "" : "Hidden by setting",
      "Role Code": row.role_code || "",
      "Role Name": row.role_name || "",
      "Role Assigned": row.role_assigned ? "Yes" : "No",
      "Direct Override": row.direct_grant_state || ""
    }));
}

function exportUserRoleAssignments(format) {
  const rows = userRoleAssignmentExportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No user role assignment rows are available.", "error");
    return;
  }
  if (format === "xlsx") {
    downloadXlsx("user-role-assignments-" + exportDateStamp() + ".xlsx", rows, "User Roles");
  } else {
    downloadCsv("user-role-assignments-" + exportDateStamp() + ".csv", rows);
  }
  showToast("Export ready", "User role assignments were exported.", "success");
}

function exportEffectiveCapabilitiesCsv() {
  const rows = effectiveCapabilityExportRows();
  if (!rows.length) {
    showToast("Nothing to export", "No effective capability rows are available.", "error");
    return;
  }
  downloadCsv("effective-capabilities-" + exportDateStamp() + ".csv", rows);
  showToast("Export ready", "Effective capabilities were exported.", "success");
}

async function clearUserRoleAssignment(assignment) {
  if (!requireUserRoleAssignmentManageAccess()) return;
  if (!assignment || !assignment.profile_id) return;
  const message = "Clear the explicit role preset assignment for " +
    (assignment.display_name || assignment.profile_id) +
    "? The user will fall back to their legacy role.";
  if (!window.confirm(message)) return;

  try {
    const result = await supabaseClient.rpc("clear_profile_role_preset_assignment", {
      p_profile_id: assignment.profile_id
    });
    if (result.error) throw result.error;
    await loadUserRoleAssignments();
    renderUserRoleAssignments();
    await refreshCurrentUserCapabilitiesForProfile(assignment.profile_id);
    if (
      effectiveCapabilityState.userAssignment &&
      effectiveCapabilityState.userAssignment.profile_id === assignment.profile_id
    ) {
      const updated = accessControlData.userAssignments.find(item => item.profile_id === assignment.profile_id) || assignment;
      await openEffectiveCapabilitiesForUser(updated, { preserveSection: true });
    }
    showToast(
      "Assignment cleared",
      "The explicit role preset assignment was cleared. The user may need to refresh or sign in again.",
      "success"
    );
  } catch (err) {
    showToast(
      "Assignment not cleared",
      err.message || "Could not clear this role preset assignment.",
      "error"
    );
  }
}

async function openEffectiveCapabilitiesForUser(assignment, options = {}) {
  if (!requireUserRoleAssignmentAccess()) return;
  effectiveCapabilityState.userAssignment = assignment;
  effectiveCapabilityState.capabilities = [];
  effectiveCapabilityState.testCode = "";
  if ($("accessControlCapabilityTestInput")) $("accessControlCapabilityTestInput").value = "";
  if ($("accessControlCapabilityTestResult")) $("accessControlCapabilityTestResult").textContent = "";
  renderEffectiveCapabilityDiagnostics();
  if (!options.preserveSection) showAccessControlView("diagnostics");

  try {
    effectiveCapabilityState.capabilities = await fetchEffectiveCapabilities(assignment.profile_id);
    renderEffectiveCapabilityDiagnostics();
  } catch (err) {
    effectiveCapabilityState.capabilities = [];
    renderEffectiveCapabilityDiagnostics();
    showToast(
      "Effective capabilities unavailable",
      err.message || "Could not load effective capabilities for this user.",
      "error"
    );
  }
}

function testSelectedUserCapability() {
  const input = $("accessControlCapabilityTestInput");
  const output = $("accessControlCapabilityTestResult");
  const code = input ? input.value.trim() : "";
  if (!output) return;
  if (!effectiveCapabilityState.userAssignment) {
    showToast("Select a user", "Open effective capabilities for a user before testing a capability.", "error");
    return;
  }
  if (!code) {
    showToast("Capability code required", "Enter a capability code to test.", "error");
    return;
  }
  const match = effectiveCapabilityState.capabilities.find(
    capability => capability.capability_code === code
  );
  if (!match) {
    output.textContent = code + ": not in the active capability catalogue.";
    return;
  }
  output.textContent = code + ": " +
    (match.effective ? "effective" : "not granted") +
    " via " + (match.effective_source || "not_granted") + ".";
}

export async function loadAccessControl() {
  if (!requireAccessControlAccess()) return;
  if (!hasAccessControlDataAccess()) {
    refreshAdminPresenceWorkspace();
    return;
  }
  $("accessControlStatus").textContent = "Loading...";
  $("accessControlRefreshButton").disabled = true;
  $("accessControlRolePresetRefreshButton").disabled = true;
  if ($("accessControlUserAssignmentRefreshButton")) $("accessControlUserAssignmentRefreshButton").disabled = true;

  try {
    const [rolePresets, userAssignments, catalogue] = await Promise.all([
      hasAnyCapability(ROLE_PRESET_VIEW_CAPABILITIES)
        ? loadRolePresetsForManagement()
        : fetchActiveRolePresetsForAssignment().catch(() => []),
      loadUserRoleAssignments().catch(err => {
        showToast(
          "User role assignments unavailable",
          err.message || "Could not load user role assignments.",
          "error"
        );
        return [];
      }),
      hasAnyCapability(ROLE_PRESET_VIEW_CAPABILITIES)
        ? loadCapabilityCatalogueTables().catch(err => {
          showToast(
            "Capability catalogue unavailable",
            err.message || "Could not load the read-only capability catalogue.",
            "error"
          );
          return { groups: [], capabilities: [] };
        })
        : Promise.resolve({ groups: [], capabilities: [] })
    ]);

    accessControlData = {
      rolePresets,
      userAssignments,
      capabilities: catalogue.capabilities,
      groups: catalogue.groups
    };
    renderAccessControl();
    $("accessControlStatus").textContent = "";
  } catch (err) {
    accessControlData = {
      rolePresets: [],
      userAssignments: [],
      capabilities: [],
      groups: []
    };
    renderAccessControl();
    $("accessControlStatus").textContent = "Access Control data could not be loaded.";
    showToast(
      "Access Control unavailable",
      err.message || "Could not load role preset management data.",
      "error"
    );
  } finally {
    $("accessControlRefreshButton").disabled = false;
    $("accessControlRolePresetRefreshButton").disabled = false;
    if ($("accessControlUserAssignmentRefreshButton")) $("accessControlUserAssignmentRefreshButton").disabled = false;
  }
}

function resetRolePresetFilters() {
  $("accessControlRoleSearch").value = "";
  $("accessControlIncludeInactive").checked = true;
  loadAccessControl();
}

function resetUserAssignmentFilters() {
  $("accessControlUserAssignmentSearch").value = "";
  $("accessControlUserAssignmentIncludeInactive").checked = defaultUserAssignmentIncludeInactive();
  loadAccessControl();
}

function scheduleRolePresetSearch() {
  if (rolePresetSearchTimer) window.clearTimeout(rolePresetSearchTimer);
  rolePresetSearchTimer = window.setTimeout(() => {
    rolePresetSearchTimer = null;
    loadAccessControl();
  }, 250);
}

function scheduleUserAssignmentSearch() {
  if (userAssignmentSearchTimer) window.clearTimeout(userAssignmentSearchTimer);
  userAssignmentSearchTimer = window.setTimeout(() => {
    userAssignmentSearchTimer = null;
    loadAccessControl();
  }, 250);
}

function updateEffectiveCapabilityFilters() {
  effectiveCapabilityState.searchText = $("accessControlCapabilityDiagnosticSearch")
    ? $("accessControlCapabilityDiagnosticSearch").value.trim()
    : "";
  effectiveCapabilityState.groupFilter = $("accessControlCapabilityDiagnosticGroup")
    ? $("accessControlCapabilityDiagnosticGroup").value
    : "";
  effectiveCapabilityState.effectiveOnly = $("accessControlCapabilityDiagnosticEffectiveOnly")
    ? $("accessControlCapabilityDiagnosticEffectiveOnly").checked
    : false;
  renderEffectiveCapabilityDiagnostics();
}

export function showAccessControlView(viewName) {
  selectModuleSection("access-control", viewName || "roles", { focus: false });
}

export async function openAccessControlWorkspace() {
  syncAccessControlVisibility();
  if (!requireAccessControlAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("access");
  refreshSectionNavigator("access-control");
  if ($("accessControlUserAssignmentIncludeInactive")) {
    $("accessControlUserAssignmentIncludeInactive").checked = defaultUserAssignmentIncludeInactive();
  }
  if (hasAccessControlDataAccess()) {
    showAccessControlView("roles");
    await loadAccessControl();
  } else if (canViewAdminPresence()) {
    showAccessControlView("presence");
    refreshAdminPresenceWorkspace();
  }
}

function registerAccessControlSections() {
  registerModuleSections("access-control", [
    {
      id: "roles",
      title: "Role Presets",
      icon: "RP",
      target: "accessControlRolesView",
      order: 10,
      default: true
    },
    {
      id: "assignments",
      title: "Users",
      fullTitle: "User Role Assignments",
      icon: "UR",
      target: "accessControlAssignmentsView",
      order: 20
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      fullTitle: "Effective Capability Diagnostics",
      icon: "D",
      target: "accessControlDiagnosticsView",
      order: 30
    },
    {
      id: "capabilities",
      title: "Capabilities",
      icon: "C",
      target: "accessControlCapabilitiesView",
      order: 40
    },
    {
      id: "groups",
      title: "Groups",
      fullTitle: "Capability Groups",
      icon: "G",
      target: "accessControlGroupsView",
      order: 50
    },
    {
      id: "presence",
      title: "Online Users",
      fullTitle: "Online Users / System Messages",
      icon: "OU",
      target: "adminPresenceSection",
      order: 60,
      visibility: canViewAdminPresence,
      capabilityAction: "admin_presence.section.open",
      capabilityLabel: "Online Users / System Messages",
      capabilityArea: "Access Control",
      capabilityAny: ADMIN_PRESENCE_CAPABILITIES,
      capabilityType: "view"
    }
  ], {
    content: "accessControlWorkspaceContent",
    title: "Access Control",
    label: "Access Control section navigation",
    toggleLabel: "Access Control section",
    defaultSection: "roles"
  });
}

export function initialiseAccessControl() {
  if (accessControlInitialised) return;
  accessControlInitialised = true;

  registerAccessControlSections();
  syncAccessControlVisibility();
  syncAdminPresenceUi();
  $("administrationAccessControlNav").addEventListener("click", openAccessControlWorkspace);
  $("accessControlRefreshButton").addEventListener("click", loadAccessControl);
  $("accessControlRolePresetRefreshButton").addEventListener("click", loadAccessControl);
  $("accessControlRolePresetResetButton").addEventListener("click", resetRolePresetFilters);
  $("accessControlRoleSearch").addEventListener("input", scheduleRolePresetSearch);
  $("accessControlIncludeInactive").addEventListener("change", loadAccessControl);
  $("accessControlUserAssignmentRefreshButton").addEventListener("click", loadAccessControl);
  $("accessControlUserAssignmentResetButton").addEventListener("click", resetUserAssignmentFilters);
  $("accessControlUserAssignmentSearch").addEventListener("input", scheduleUserAssignmentSearch);
  if ($("accessControlUserAssignmentIncludeInactive")) {
    $("accessControlUserAssignmentIncludeInactive").checked = defaultUserAssignmentIncludeInactive();
  }
  $("accessControlUserAssignmentIncludeInactive").addEventListener("change", loadAccessControl);
  $("accessControlUserAssignmentExportCsvButton").addEventListener("click", () => exportUserRoleAssignments("csv"));
  $("accessControlUserAssignmentExportXlsxButton").addEventListener("click", () => exportUserRoleAssignments("xlsx"));
  $("accessControlCapabilityDiagnosticSearch").addEventListener("input", updateEffectiveCapabilityFilters);
  $("accessControlCapabilityDiagnosticGroup").addEventListener("change", updateEffectiveCapabilityFilters);
  $("accessControlCapabilityDiagnosticEffectiveOnly").addEventListener("change", updateEffectiveCapabilityFilters);
  $("accessControlCapabilityTestButton").addEventListener("click", testSelectedUserCapability);
  $("accessControlCapabilityTestInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      testSelectedUserCapability();
    }
  });
  $("accessControlDiagnosticsExportCsvButton").addEventListener("click", exportEffectiveCapabilitiesCsv);
  $("accessControlNewRolePresetButton").addEventListener("click", event => {
    openRolePresetForm("create", null, event.currentTarget);
  });
  $("rolePresetCapabilityPanelCloseButton").addEventListener(
    "click",
    () => closeRolePresetPanel()
  );
  $("rolePresetCapabilityCancelButton").addEventListener(
    "click",
    () => closeRolePresetPanel()
  );
  $("rolePresetCapabilitySaveButton").addEventListener(
    "click",
    saveRolePresetPanel
  );
}
