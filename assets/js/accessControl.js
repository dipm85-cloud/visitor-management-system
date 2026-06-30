import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showAdministrationWorkspace } from "./shell.js";
import { AppState } from "./state.js";

let accessControlData = {
  roles: [],
  capabilities: [],
  groups: [],
  assignments: []
};
let accessControlInitialised = false;

function hasAccessControlAccess() {
  const capabilityStateAvailable =
    AppState.userCapabilities instanceof Set &&
    AppState.userCapabilities.size > 0;
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role === "super_user" &&
    (
      !capabilityStateAvailable ||
      hasAnyCapability(["settings.view", "users.manage"])
    )
  );
}

function requireAccessControlAccess() {
  if (hasAccessControlAccess()) return true;
  showToast(
    "Access denied",
    "Access Control is currently available to authorised SuperUsers only.",
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
  setAdministrationSection("reference");
}

export function syncAccessControlVisibility() {
  const visible = hasAccessControlAccess();
  $("administrationAccessControlNav").classList.toggle("hidden", !visible);
  if (!visible && !$("accessControlSection").classList.contains("hidden")) {
    setAdministrationSection("reference");
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

function normaliseAccessControlData(groupRows, capabilityRows, roleRows, assignments) {
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
    assignments
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
    const [groupResult, capabilityResult, roleResult, assignmentResult] = await Promise.all([
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
        .from("v_role_preset_capabilities")
        .select("role_code, role_name, group_code, group_name, capability_code, capability_name, description")
    ]);

    const results = [groupResult, capabilityResult, roleResult, assignmentResult];
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
    const assignments = assignmentResult.error ? [] : (assignmentResult.data || []);
    const activeViewFallbackUsed = assignments.length > 0 && (
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
      assignments
    );
    renderAccessControl();
    $("accessControlStatus").textContent =
      accessControlData.roles.length + " role presets, " +
      accessControlData.capabilities.length + " capabilities and " +
      accessControlData.groups.length + " capability groups loaded." +
      (activeViewFallbackUsed ? " Active records were completed from the role capability view." : "");
  } catch (err) {
    accessControlData = { roles: [], capabilities: [], groups: [], assignments: [] };
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
  document.querySelectorAll("[data-access-control-view]").forEach(button => {
    button.addEventListener("click", () => {
      showAccessControlView(button.dataset.accessControlView);
    });
  });
}
