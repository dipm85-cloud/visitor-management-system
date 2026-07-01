import { supabaseClient } from "./api.js";
import {
  hasAnyCapability,
  loadUserCapabilities
} from "./capabilities.js";
import { writeAuditEvent } from "./audit.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import {
  showAdministrationWorkspace,
  syncNavigationCapabilityVisibility
} from "./shell.js";
import { AppState } from "./state.js";

const SUPER_USER_ROLE_CODE = "super_user";
const REQUIRED_SUPERUSER_CAPABILITIES = [
  "access_control.view",
  "access_control.manage",
  "settings.view",
  "settings.edit",
  "users.view",
  "users.manage",
  "people.manage",
  "organisation.manage",
  "assignment.manage",
  "audit.view"
];
let accessControlData = {
  roles: [],
  capabilities: [],
  groups: [],
  assignments: [],
  junctionRows: []
};
let accessControlInitialised = false;
let editingRolePresetId = null;
let roleEditorTrigger = null;

function hasActiveProfile() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active
  );
}

function hasAccessControlAccess() {
  return hasActiveProfile() &&
    hasAnyCapability(["access_control.view", "access_control.manage"]);
}

function hasAccessControlManageAccess() {
  return hasActiveProfile() && hasAnyCapability(["access_control.manage"]);
}

function requireAccessControlAccess() {
  if (hasAccessControlAccess()) return true;
  showToast(
    "You do not have permission",
    "Access Control requires access_control.view.",
    "error"
  );
  return false;
}

function requireAccessControlManageAccess() {
  if (hasAccessControlManageAccess()) return true;
  showToast(
    "You do not have permission",
    "Managing role preset assignments requires access_control.manage.",
    "error"
  );
  return false;
}

function setAdministrationSection(sectionName) {
  const referenceSelected = sectionName === "reference";
  $("referenceDataSection").classList.toggle("hidden", !referenceSelected);
  $("accessControlSection").classList.toggle("hidden", referenceSelected);

  $("administrationReferenceNav").classList.toggle("active", referenceSelected);
  $("administrationAccessControlNav").classList.toggle("active", !referenceSelected);

  if (referenceSelected) {
    $("administrationReferenceNav").setAttribute("aria-current", "page");
    $("administrationAccessControlNav").removeAttribute("aria-current");
  } else {
    $("administrationAccessControlNav").setAttribute("aria-current", "page");
    $("administrationReferenceNav").removeAttribute("aria-current");
  }
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
    closeRolePresetCapabilityEditor(false);
    if (referenceVisible) setAdministrationSection("reference");
  } else if (
    !referenceVisible &&
    !$("referenceDataSection").classList.contains("hidden") &&
    visible
  ) {
    setAdministrationSection("access");
  }
}

function uniqueBy(records, key) {
  const seen = new Set();
  return records.filter(record => {
    const value = record[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function deriveGroups(assignments) {
  return uniqueBy(assignments.map(record => ({
    id: null,
    group_code: record.group_code || "ungrouped",
    group_name: record.group_name || "Ungrouped",
    description: null,
    display_order: 999,
    active: true
  })), "group_code");
}

function deriveCapabilities(assignments) {
  return uniqueBy(assignments.map(record => ({
    id: null,
    capability_code: record.capability_code,
    capability_name: record.capability_name,
    group_id: null,
    group_code: record.group_code || "ungrouped",
    group_name: record.group_name || "Ungrouped",
    description: record.description || null,
    active: true
  })), "capability_code");
}

function deriveRoles(assignments) {
  return uniqueBy(assignments.map(record => ({
    id: null,
    role_code: record.role_code,
    role_name: record.role_name,
    description: null,
    is_system_role: true,
    active: true
  })), "role_code");
}

function mapRolePresetAssignments(roleRows, capabilityRows, groupRows, junctionRows) {
  const rolesById = new Map(roleRows.map(role => [role.id, role]));
  const capabilitiesById = new Map(
    capabilityRows.map(capability => [capability.id, capability])
  );
  const groupsById = new Map(groupRows.map(group => [group.id, group]));

  const assignments = junctionRows.flatMap(junction => {
    const role = rolesById.get(junction.role_preset_id);
    const capability = capabilitiesById.get(junction.capability_id);
    if (!role || !capability) return [];

    const group = groupsById.get(capability.group_id);
    return [{
      role_preset_id: junction.role_preset_id,
      capability_id: junction.capability_id,
      role_code: role.role_code,
      role_name: role.role_name,
      group_code: group ? group.group_code : "ungrouped",
      group_name: group ? group.group_name : "Ungrouped",
      group_display_order: group ? group.display_order : 999,
      capability_code: capability.capability_code,
      capability_name: capability.capability_name,
      description: capability.description || null
    }];
  });

  if (assignments.length !== junctionRows.length) {
    console.warn(
      "Some role preset capability assignments could not be mapped.",
      {
        assignment_rows: junctionRows.length,
        mapped_rows: assignments.length
      }
    );
  }

  return assignments.sort((a, b) =>
    String(a.role_code).localeCompare(String(b.role_code)) ||
    Number(a.group_display_order) - Number(b.group_display_order) ||
    String(a.capability_code).localeCompare(String(b.capability_code))
  );
}

function normaliseAccessControlData(
  groupRows,
  capabilityRows,
  roleRows,
  assignments,
  junctionRows
) {
  const groups = groupRows.length ? groupRows : deriveGroups(assignments);
  const groupById = new Map(groups.filter(group => group.id).map(group => [group.id, group]));
  const groupByCode = new Map(groups.map(group => [group.group_code, group]));

  const capabilities = capabilityRows.length
    ? capabilityRows.map(capability => {
      const group = groupById.get(capability.group_id);
      return {
        ...capability,
        group_code: group ? group.group_code : "ungrouped",
        group_name: group ? group.group_name : "Ungrouped"
      };
    })
    : deriveCapabilities(assignments).map(capability => {
      const group = groupByCode.get(capability.group_code);
      return {
        ...capability,
        group_name: group ? group.group_name : capability.group_name
      };
    });

  return {
    groups: [...groups].sort((a, b) =>
      Number(a.display_order || 0) - Number(b.display_order || 0) ||
      String(a.group_name || "").localeCompare(String(b.group_name || ""))
    ),
    capabilities: [...capabilities].sort((a, b) =>
      String(a.group_name || "").localeCompare(String(b.group_name || "")) ||
      String(a.capability_code || "").localeCompare(String(b.capability_code || ""))
    ),
    roles: [...(roleRows.length ? roleRows : deriveRoles(assignments))].sort((a, b) =>
      String(a.role_name || "").localeCompare(String(b.role_name || ""))
    ),
    assignments,
    junctionRows
  };
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text === null || text === undefined || text === "" ? "—" : String(text);
  return cell;
}

function createActiveStatus(active) {
  const status = document.createElement("span");
  status.className = "people-status " + (active === false ? "inactive" : "active");
  status.textContent = active === false ? "Inactive" : "Active";
  return status;
}

function renderRolePresets() {
  const container = $("accessControlRolePresets");
  container.replaceChildren();

  accessControlData.roles.forEach(role => {
    const assignments = accessControlData.assignments.filter(
      assignment => assignment.role_code === role.role_code
    );
    const capabilityCount = new Set(assignments.map(item => item.capability_code)).size;
    const card = document.createElement("article");
    card.className = "access-control-role-card";

    const heading = document.createElement("div");
    heading.className = "access-control-role-heading";
    const title = document.createElement("div");
    const roleName = document.createElement("h3");
    roleName.textContent = role.role_name;
    const roleCode = document.createElement("code");
    roleCode.textContent = role.role_code;
    title.append(roleName, roleCode);
    heading.append(title, createActiveStatus(role.active));
    card.appendChild(heading);

    const count = document.createElement("p");
    count.className = "access-control-capability-count";
    count.textContent = capabilityCount + " assigned " +
      (capabilityCount === 1 ? "capability" : "capabilities");
    card.appendChild(count);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary access-control-edit-role";
    editButton.textContent = "Edit Capabilities";
    editButton.dataset.rolePresetId = role.id || "";
    editButton.disabled =
      !hasAccessControlManageAccess() ||
      !role.id ||
      !accessControlData.capabilities.some(capability => capability.id);
    if (editButton.disabled) {
      editButton.title = "Full role and capability records are required before assignments can be edited.";
    }
    editButton.addEventListener("click", event => {
      openRolePresetCapabilityEditor(role.id, event.currentTarget);
    });
    card.appendChild(editButton);

    const grouped = new Map();
    assignments.forEach(assignment => {
      const groupName = assignment.group_name || "Ungrouped";
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(assignment);
    });

    if (grouped.size === 0) {
      const empty = document.createElement("p");
      empty.className = "access-control-role-empty";
      empty.textContent = "No active capabilities assigned.";
      card.appendChild(empty);
    } else {
      grouped.forEach((items, groupName) => {
        const group = document.createElement("section");
        group.className = "access-control-role-group";
        const groupTitle = document.createElement("h4");
        groupTitle.textContent = groupName;
        const list = document.createElement("ul");
        items.forEach(item => {
          const listItem = document.createElement("li");
          const name = document.createElement("span");
          name.textContent = item.capability_name;
          const code = document.createElement("code");
          code.textContent = item.capability_code;
          listItem.append(name, code);
          list.appendChild(listItem);
        });
        group.append(groupTitle, list);
        card.appendChild(group);
      });
    }

    container.appendChild(card);
  });

  $("accessControlRolesEmpty").classList.toggle("hidden", accessControlData.roles.length > 0);
}

function renderCapabilities() {
  const body = $("accessControlCapabilities");
  body.replaceChildren();

  accessControlData.capabilities.forEach(capability => {
    const row = document.createElement("tr");
    row.appendChild(createCell(capability.capability_code));
    row.appendChild(createCell(capability.capability_name));
    row.appendChild(createCell(capability.group_name));
    row.appendChild(createCell(capability.description));
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

function renderAccessControl() {
  renderRolePresets();
  renderCapabilities();
  renderCapabilityGroups();
}

function setRoleCapabilityMessage(message, type) {
  const box = $("rolePresetCapabilityMessage");
  box.textContent = message || "";
  box.className = message ? "modal-message " + (type || "error") : "modal-message";
}

function assignedCapabilityIds(rolePresetId) {
  return new Set(
    accessControlData.junctionRows
      .filter(row => row.role_preset_id === rolePresetId)
      .map(row => row.capability_id)
  );
}

function renderRoleCapabilityCheckboxes(role) {
  const container = $("rolePresetCapabilityGroups");
  const selectedIds = assignedCapabilityIds(role.id);
  const grouped = new Map();
  container.replaceChildren();

  accessControlData.capabilities
    .filter(capability => capability.id)
    .forEach(capability => {
      const groupName = capability.group_name || "Ungrouped";
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(capability);
    });

  grouped.forEach((capabilities, groupName) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "role-capability-group";
    const legend = document.createElement("legend");
    legend.textContent = groupName;
    fieldset.appendChild(legend);

    capabilities.forEach(capability => {
      const label = document.createElement("label");
      label.className = "role-capability-option";
      label.title = capability.description || capability.capability_name;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = capability.id;
      checkbox.dataset.capabilityCode = capability.capability_code;
      checkbox.checked = selectedIds.has(capability.id);
      checkbox.disabled = capability.active === false;

      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = capability.capability_name;
      const code = document.createElement("code");
      code.textContent = capability.capability_code;
      const description = document.createElement("small");
      description.textContent = capability.description || "No description available.";
      text.append(name, code, description);

      label.append(checkbox, text);
      fieldset.appendChild(label);
    });

    container.appendChild(fieldset);
  });
}

export function openRolePresetCapabilityEditor(rolePresetId, trigger) {
  if (!requireAccessControlManageAccess()) return;
  const role = accessControlData.roles.find(item => item.id === rolePresetId);
  if (!role) {
    showToast("Role unavailable", "Reload Access Control before editing this role preset.", "error");
    return;
  }

  editingRolePresetId = role.id;
  roleEditorTrigger = trigger instanceof HTMLElement ? trigger : null;
  $("rolePresetCapabilityPanelTitle").textContent = "Edit Capabilities";
  $("rolePresetCapabilityPanelRole").textContent = role.role_name + " (" + role.role_code + ")";
  $("rolePresetCapabilitySafetyNotice").textContent = role.role_code === SUPER_USER_ROLE_CODE
    ? "SuperUser recovery access is protected. Required capabilities: " +
      REQUIRED_SUPERUSER_CAPABILITIES.join(", ") + "."
    : "Select the capabilities assigned to this role preset.";
  setRoleCapabilityMessage("");
  renderRoleCapabilityCheckboxes(role);
  $("rolePresetCapabilityPanel").classList.remove("hidden");
  $("rolePresetCapabilityPanel").setAttribute("aria-hidden", "false");

  const firstCheckbox = $("rolePresetCapabilityGroups").querySelector("input:not([disabled])");
  setTimeout(() => {
    if (firstCheckbox) firstCheckbox.focus({ preventScroll: true });
  }, 0);
}

export function closeRolePresetCapabilityEditor(restoreFocus = true) {
  $("rolePresetCapabilityPanel").classList.add("hidden");
  $("rolePresetCapabilityPanel").setAttribute("aria-hidden", "true");
  editingRolePresetId = null;
  if (restoreFocus && roleEditorTrigger && roleEditorTrigger.isConnected) {
    roleEditorTrigger.focus({ preventScroll: true });
  }
  roleEditorTrigger = null;
}

function selectedRoleCapabilities() {
  return Array.from(
    $("rolePresetCapabilityGroups").querySelectorAll('input[type="checkbox"]')
  )
    .filter(checkbox => checkbox.checked)
    .map(checkbox => ({
      id: checkbox.value,
      code: checkbox.dataset.capabilityCode
    }));
}

function validateRoleCapabilitySelection(role, selectedCapabilities) {
  if (role.role_code !== SUPER_USER_ROLE_CODE) return;
  if (selectedCapabilities.length === 0) {
    throw new Error("SuperUser must retain assigned capabilities.");
  }

  const selectedCodes = new Set(selectedCapabilities.map(capability => capability.code));
  const missingRequired = REQUIRED_SUPERUSER_CAPABILITIES.filter(
    capabilityCode => !selectedCodes.has(capabilityCode)
  );
  if (missingRequired.length) {
    throw new Error(
      "SuperUser must retain: " + missingRequired.join(", ") + "."
    );
  }
}

async function refreshCurrentUserCapabilitiesIfNeeded(role) {
  if (AppState.currentProfile?.role !== role.role_code) return;
  await loadUserCapabilities(AppState.currentProfile);
  syncNavigationCapabilityVisibility();
  syncAccessControlVisibility();
  window.dispatchEvent(new CustomEvent("oh:capabilities-changed"));
}

export async function saveRolePresetCapabilities() {
  if (!requireAccessControlManageAccess() || !editingRolePresetId) return;
  const role = accessControlData.roles.find(item => item.id === editingRolePresetId);
  if (!role) return;

  const selectedCapabilities = selectedRoleCapabilities();
  try {
    validateRoleCapabilitySelection(role, selectedCapabilities);
  } catch (err) {
    setRoleCapabilityMessage(err.message, "error");
    showToast("Unsafe capability change prevented", err.message, "error");
    return;
  }

  const currentIds = assignedCapabilityIds(role.id);
  const selectedIds = new Set(selectedCapabilities.map(capability => capability.id));
  const additions = [...selectedIds].filter(capabilityId => !currentIds.has(capabilityId));
  const removals = [...currentIds].filter(capabilityId => !selectedIds.has(capabilityId));

  if (additions.length === 0 && removals.length === 0) {
    setRoleCapabilityMessage("No capability changes to save.", "info");
    return;
  }

  const saveButton = $("rolePresetCapabilitySaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  $("rolePresetCapabilityCancelButton").disabled = true;
  $("rolePresetCapabilityPanelCloseButton").disabled = true;
  let additionsSaved = false;

  try {
    if (additions.length) {
      const addResult = await supabaseClient
        .from("role_preset_capabilities")
        .insert(additions.map(capabilityId => ({
          role_preset_id: role.id,
          capability_id: capabilityId
        })));
      if (addResult.error) throw addResult.error;
      additionsSaved = true;
    }

    if (removals.length) {
      const removeResult = await supabaseClient
        .from("role_preset_capabilities")
        .delete()
        .eq("role_preset_id", role.id)
        .in("capability_id", removals);
      if (removeResult.error) throw removeResult.error;
    }

    const capabilityById = new Map(
      accessControlData.capabilities.map(capability => [capability.id, capability])
    );
    void writeAuditEvent(
      "access_control.role_preset_capabilities.updated",
      "role_presets",
      role.id,
      {
        entity_type: "role_preset",
        entity_id: role.id,
        role_code: role.role_code,
        role_name: role.role_name,
        added_capabilities: additions.map(capabilityId =>
          capabilityById.get(capabilityId)?.capability_code || capabilityId
        ),
        removed_capabilities: removals.map(capabilityId =>
          capabilityById.get(capabilityId)?.capability_code || capabilityId
        ),
        summary: "Role preset capability assignments updated."
      }
    );

    await refreshCurrentUserCapabilitiesIfNeeded(role);
    closeRolePresetCapabilityEditor(false);
    await loadAccessControl();
    const refreshedTrigger = document.querySelector(
      '[data-role-preset-id="' + role.id + '"]'
    );
    if (refreshedTrigger) refreshedTrigger.focus({ preventScroll: true });
    showToast(
      "Role capabilities updated",
      role.role_name + " capability assignments were saved successfully.",
      "success"
    );
  } catch (err) {
    const partialMessage = additionsSaved
      ? " New capabilities were added, but removals could not be completed. Assignments were refreshed; review this role."
      : "";
    if (additionsSaved) {
      await loadAccessControl();
      const refreshedTrigger = document.querySelector(
        '[data-role-preset-id="' + role.id + '"]'
      );
      openRolePresetCapabilityEditor(role.id, refreshedTrigger);
    }
    setRoleCapabilityMessage(
      (err.message || "Could not save role capability assignments.") + partialMessage,
      "error"
    );
    showToast(
      "Role capabilities not saved",
      (err.message || "Could not save role capability assignments.") + partialMessage,
      "error"
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Capabilities";
    $("rolePresetCapabilityCancelButton").disabled = false;
    $("rolePresetCapabilityPanelCloseButton").disabled = false;
  }
}

export function showAccessControlView(viewName) {
  document.querySelectorAll("[data-access-control-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.accessControlPanel !== viewName);
  });
  document.querySelectorAll("[data-access-control-view]").forEach(button => {
    const active = button.dataset.accessControlView === viewName;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

export async function loadAccessControl() {
  if (!requireAccessControlAccess()) return;
  $("accessControlStatus").textContent = "Loading access control data…";
  $("accessControlRefreshButton").disabled = true;

  try {
    const [
      groupResult,
      capabilityResult,
      roleResult,
      junctionResult,
      assignmentViewResult
    ] = await Promise.all([
      supabaseClient
        .from("capability_groups")
        .select("id, group_code, group_name, description, display_order, active")
        .order("display_order", { ascending: true }),
      supabaseClient
        .from("capabilities")
        .select("id, capability_code, capability_name, group_id, description, active")
        .order("capability_code", { ascending: true }),
      supabaseClient
        .from("role_presets")
        .select("id, role_code, role_name, description, is_system_role, active")
        .order("role_name", { ascending: true }),
      supabaseClient
        .from("role_preset_capabilities")
        .select("role_preset_id, capability_id"),
      supabaseClient
        .from("v_role_preset_capabilities")
        .select("role_code, role_name, group_code, group_name, capability_code, capability_name, description")
    ]);

    const results = [
      groupResult,
      capabilityResult,
      roleResult,
      junctionResult,
      assignmentViewResult
    ];
    const errors = results.map(result => result.error).filter(Boolean);
    if (errors.length) {
      console.warn("Some Access Control sources were unavailable.", errors.map(error => ({
        code: error.code || null,
        message: error.message || "Unknown read error."
      })));
    }

    const groupRows = groupResult.error ? [] : (groupResult.data || []);
    const capabilityRows = capabilityResult.error ? [] : (capabilityResult.data || []);
    const roleRows = roleResult.error ? [] : (roleResult.data || []);
    const junctionRows = junctionResult.error ? [] : (junctionResult.data || []);
    const viewAssignments = assignmentViewResult.error
      ? []
      : (assignmentViewResult.data || []);
    const mappedAssignments = mapRolePresetAssignments(
      roleRows,
      capabilityRows,
      groupRows,
      junctionRows
    );
    const junctionMappingComplete =
      junctionRows.length > 0 &&
      mappedAssignments.length === junctionRows.length;
    const assignments = junctionMappingComplete
      ? mappedAssignments
      : (viewAssignments.length ? viewAssignments : mappedAssignments);
    const activeViewFallbackUsed = !junctionMappingComplete && viewAssignments.length > 0;
    const catalogueFallbackUsed = assignments.length > 0 && (
      groupRows.length === 0 ||
      capabilityRows.length === 0 ||
      roleRows.length === 0
    );

    if (
      groupRows.length === 0 &&
      capabilityRows.length === 0 &&
      roleRows.length === 0 &&
      assignments.length === 0 &&
      errors.length
    ) {
      throw errors[0];
    }

    accessControlData = normaliseAccessControlData(
      groupRows,
      capabilityRows,
      roleRows,
      assignments,
      junctionRows
    );
    renderAccessControl();
    $("accessControlStatus").textContent =
      accessControlData.roles.length + " role presets, " +
      accessControlData.capabilities.length + " capabilities and " +
      accessControlData.groups.length + " capability groups loaded." +
      (activeViewFallbackUsed ? " Role assignments were loaded from the active capability view." : "") +
      (catalogueFallbackUsed ? " Active catalogue records were completed from assignment data." : "");
  } catch (err) {
    accessControlData = {
      roles: [],
      capabilities: [],
      groups: [],
      assignments: [],
      junctionRows: []
    };
    renderAccessControl();
    $("accessControlStatus").textContent = "Access control data could not be loaded.";
    showToast(
      "Access Control unavailable",
      err.message || "Could not load role and capability data.",
      "error"
    );
  } finally {
    $("accessControlRefreshButton").disabled = false;
  }
}

export async function openAccessControlWorkspace() {
  syncAccessControlVisibility();
  if (!requireAccessControlAccess()) return;
  showAdministrationWorkspace();
  setAdministrationSection("access");
  showAccessControlView("roles");
  await loadAccessControl();
}

export function initialiseAccessControl() {
  if (accessControlInitialised) return;
  accessControlInitialised = true;

  syncAccessControlVisibility();
  $("administrationAccessControlNav").addEventListener("click", openAccessControlWorkspace);
  $("accessControlRefreshButton").addEventListener("click", loadAccessControl);
  $("rolePresetCapabilityPanelCloseButton").addEventListener(
    "click",
    () => closeRolePresetCapabilityEditor()
  );
  $("rolePresetCapabilityCancelButton").addEventListener(
    "click",
    () => closeRolePresetCapabilityEditor()
  );
  $("rolePresetCapabilitySaveButton").addEventListener(
    "click",
    saveRolePresetCapabilities
  );
  document.querySelectorAll("[data-access-control-view]").forEach(button => {
    button.addEventListener("click", () => {
      showAccessControlView(button.dataset.accessControlView);
    });
  });
}
