import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";

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

let capabilityLoadSequence = 0;

function logCapabilityQueryStart(step, source, filters) {
  console.log("[OH-021 capability query start]", {
    step,
    source,
    filters: filters || {}
  });
}

function logCapabilityQueryResult(step, source, result) {
  if (result.error) {
    console.error("[OH-021 capability query failed]", {
      step,
      source,
      error: result.error
    });
    return;
  }

  console.log("[OH-021 capability query succeeded]", {
    step,
    source,
    rowCount: Array.isArray(result.data) ? result.data.length : null
  });
}

function normaliseCapabilityCode(code) {
  return String(code || "").trim();
}

function setLoadedCapabilities(codes) {
  AppState.userCapabilities = new Set(
    Array.from(codes || []).map(normaliseCapabilityCode).filter(Boolean)
  );
}

export function rolePresetCodeForProfileRole(profileRole) {
  const roleCode = String(profileRole || "").trim();
  return roleCode || null;
}

async function loadRolePresetCapabilities(profile) {
  const rolePresetCode = rolePresetCodeForProfileRole(profile.role);
  if (!rolePresetCode) return [];

  const step = "load_role_preset_capabilities";
  const source = "view:public.v_role_preset_capabilities";
  logCapabilityQueryStart(step, source, { role_code: rolePresetCode });
  const result = await supabaseClient
    .from("v_role_preset_capabilities")
    .select("capability_code")
    .eq("role_code", rolePresetCode);

  logCapabilityQueryResult(step, source, result);
  if (result.error) throw result.error;
  return (result.data || []).map(row => row.capability_code);
}

async function applyProfileCapabilityOverrides(profile, capabilitySet) {
  if (!profile || !profile.id) return;

  const step = "load_profile_capability_overrides";
  const source = "table:public.profile_capabilities + relation:public.capabilities";
  logCapabilityQueryStart(step, source, { profile_id: profile.id });
  const result = await supabaseClient
    .from("profile_capabilities")
    .select("grant_state, capabilities(capability_code)")
    .eq("profile_id", profile.id);

  logCapabilityQueryResult(step, source, result);
  if (result.error) throw result.error;

  (result.data || []).forEach(row => {
    const code = normaliseCapabilityCode(row.capabilities && row.capabilities.capability_code);
    if (!code) return;

    if (row.grant_state === "allow") capabilitySet.add(code);
    if (row.grant_state === "deny") capabilitySet.delete(code);
  });
}

export async function loadUserCapabilities(profile) {
  const loadSequence = ++capabilityLoadSequence;

  if (!profile || !profile.active || profile.role === "kiosk_user") {
    setLoadedCapabilities([]);
    return AppState.userCapabilities;
  }

  const fallbackCapabilities = fallbackCapabilitiesByRole[profile.role] || [];

  try {
    const capabilitySet = new Set(await loadRolePresetCapabilities(profile));

    try {
      await applyProfileCapabilityOverrides(profile, capabilitySet);
    } catch (err) {
      // A role preset is independently authoritative. An unavailable optional
      // profile-override read must not discard capabilities already loaded
      // from that preset (notably for non-SuperUser profiles).
      console.warn("Profile capability overrides unavailable; using role preset capabilities.", err);
    }

    if (loadSequence !== capabilityLoadSequence) return AppState.userCapabilities;
    setLoadedCapabilities(capabilitySet);
  } catch (err) {
    if (loadSequence !== capabilityLoadSequence) return AppState.userCapabilities;
    console.error("[OH-021 capability fallback activated]", {
      step: "load_role_preset_capabilities",
      profileRole: profile.role,
      mappedRolePresetCode: rolePresetCodeForProfileRole(profile.role),
      error: err
    });
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
