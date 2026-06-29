import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";

const rolePresetByProfileRole = {
  general_user: "general_user",
  security: "security",
  super_user: "superuser"
};

const fallbackCapabilitiesByRole = {
  general_user: [
    "dashboard.view",
    "visitor.view",
    "visitor.create",
    "visitor.edit"
  ],
  security: [
    "dashboard.view",
    "visitor.view",
    "visitor.create",
    "visitor.edit",
    "visitor.sign_in",
    "visitor.sign_out",
    "visitor.history.view",
    "visitor.history.edit",
    "visitor.export",
    "visitor.print",
    "reports.view",
    "audit.view",
    "devices.view"
  ],
  super_user: ["*"]
};

function normaliseCapabilityCode(code) {
  return String(code || "").trim();
}

function setLoadedCapabilities(codes) {
  AppState.userCapabilities = new Set((codes || []).map(normaliseCapabilityCode).filter(Boolean));
}

async function loadRolePresetCapabilities(profile) {
  const rolePresetCode = rolePresetByProfileRole[profile.role];
  if (!rolePresetCode) return [];

  const result = await supabaseClient
    .from("v_role_preset_capabilities")
    .select("capability_code")
    .eq("role_code", rolePresetCode);

  if (result.error) throw result.error;
  return (result.data || []).map(row => row.capability_code);
}

async function applyProfileCapabilityOverrides(profile, capabilitySet) {
  if (!profile || !profile.id) return;

  const result = await supabaseClient
    .from("profile_capabilities")
    .select("grant_state, capabilities(capability_code)")
    .eq("profile_id", profile.id);

  if (result.error) throw result.error;

  (result.data || []).forEach(row => {
    const code = normaliseCapabilityCode(row.capabilities && row.capabilities.capability_code);
    if (!code) return;

    if (row.grant_state === "allow") capabilitySet.add(code);
    if (row.grant_state === "deny") capabilitySet.delete(code);
  });
}

export async function loadUserCapabilities(profile) {
  if (!profile || !profile.active || profile.role === "kiosk_user") {
    setLoadedCapabilities([]);
    return AppState.userCapabilities;
  }

  const fallbackCapabilities = fallbackCapabilitiesByRole[profile.role] || [];

  try {
    const capabilitySet = new Set(await loadRolePresetCapabilities(profile));
    await applyProfileCapabilityOverrides(profile, capabilitySet);
    setLoadedCapabilities(capabilitySet);
  } catch (err) {
    console.warn("Capability load unavailable; using current role compatibility defaults.", err);
    setLoadedCapabilities(fallbackCapabilities);
  }

  return AppState.userCapabilities;
}

export function hasCapability(code) {
  const capabilityCode = normaliseCapabilityCode(code);
  if (!capabilityCode || !AppState.userCapabilities) return false;
  return AppState.userCapabilities.has("*") || AppState.userCapabilities.has(capabilityCode);
}

export function hasAnyCapability(codes) {
  return (codes || []).some(code => hasCapability(code));
}

export function hasAllCapabilities(codes) {
  return (codes || []).every(code => hasCapability(code));
}
