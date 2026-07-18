import { AppState } from "./state.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { showToast } from "./messages.js";
import { writeAuditEvent } from "./audit.js";

const INSPECTOR_ACCESS_CAPABILITIES = [
  "capabilities.diagnose",
  "user_role_assignments.manage",
  "access_control.manage",
  "module_configuration.manage"
];
const SESSION_KEY = "oh_capability_inspector_enabled";
const AUTO_DISABLE_MS = 12 * 60 * 1000;

let inspectorInitialised = false;
let inspectorEnabled = false;
let inspectorTimer = null;
let effectiveCapabilitySources = new Map();
let inspectorToggle = null;
let inspectorIndicator = null;
let inspectorGlobalIndicator = null;

export function canUseCapabilityInspector() {
  return AppState.currentProfile &&
    AppState.currentProfile.active &&
    hasAnyCapability(INSPECTOR_ACCESS_CAPABILITIES);
}

function parseCapabilities(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function actionMetadataFromElement(element) {
  if (!element) return null;
  const data = element.dataset || {};
  const actionId = data.capabilityAction || "";
  if (!actionId) return null;
  return {
    actionId,
    label: data.capabilityLabel || element.getAttribute("aria-label") || element.textContent || actionId,
    area: data.capabilityArea || "Operations Hub",
    requiredAny: parseCapabilities(data.capabilityAny),
    requiredAll: parseCapabilities(data.capabilityAll),
    notes: data.capabilityNotes || "",
    actionType: data.capabilityType || ""
  };
}

function evaluateCapabilities(metadata) {
  const any = metadata.requiredAny || [];
  const all = metadata.requiredAll || [];
  const anyAllowed = any.length ? hasAnyCapability(any) : true;
  const allAllowed = all.length ? all.every(code => hasCapability(code)) : true;
  const registered = any.length > 0 || all.length > 0;
  return {
    registered,
    allowed: registered ? anyAllowed && allAllowed : false,
    any,
    all
  };
}

function sourceForCapability(code) {
  const source = effectiveCapabilitySources.get(code);
  return source || (hasCapability(code) ? "unknown/local cache" : "not_granted");
}

function capabilitySourceSummary(metadata) {
  const codes = [...metadata.requiredAny, ...metadata.requiredAll];
  if (!codes.length) return "Source: metadata missing";
  return codes.map(code => code + " = " + sourceForCapability(code)).join("; ");
}

async function refreshInspectorCapabilitySources() {
  effectiveCapabilitySources = new Map();
  if (!AppState.currentProfile || !AppState.currentProfile.id) return;
  try {
    const { supabaseClient } = await import("./api.js");
    const result = await supabaseClient.rpc("list_profile_effective_capabilities", {
      p_profile_id: AppState.currentProfile.id
    });
    if (result.error) throw result.error;
    (result.data || []).forEach(row => {
      if (row && row.capability_code) {
        effectiveCapabilitySources.set(
          row.capability_code,
          row.effective_source || (row.effective ? "unknown/local cache" : "not_granted")
        );
      }
    });
  } catch (err) {
    console.warn("Capability inspector source lookup failed; using local capability cache.", err);
  }
}

function setInspectorVisualState() {
  document.body.classList.toggle("capability-inspector-active", inspectorEnabled);
  if (inspectorToggle) {
    inspectorToggle.checked = inspectorEnabled;
    inspectorToggle.disabled = !canUseCapabilityInspector();
  }
  if (inspectorIndicator) {
    inspectorIndicator.classList.toggle("hidden", !inspectorEnabled);
  }
  if (inspectorGlobalIndicator) {
    inspectorGlobalIndicator.classList.toggle("hidden", !inspectorEnabled);
  }
}

async function auditInspectorEvent(eventType, details) {
  try {
    await writeAuditEvent(
      eventType,
      "capability_inspector",
      AppState.currentProfile && AppState.currentProfile.id ? AppState.currentProfile.id : null,
      {
        ...(details || {}),
        current_profile_id: AppState.currentProfile && AppState.currentProfile.id ? AppState.currentProfile.id : null,
        timestamp: new Date().toISOString()
      }
    );
  } catch (err) {
    console.warn("Capability inspector audit failed.", err);
  }
}

function clearInspectorTimer() {
  if (inspectorTimer) window.clearTimeout(inspectorTimer);
  inspectorTimer = null;
}

async function setInspectorEnabled(enabled, options = {}) {
  const nextEnabled = Boolean(enabled);
  if (nextEnabled && !canUseCapabilityInspector()) {
    inspectorEnabled = false;
    sessionStorage.removeItem(SESSION_KEY);
    setInspectorVisualState();
    showToast("Inspector unavailable", "Capability Inspector requires diagnostic access.", "error");
    return;
  }

  if (inspectorEnabled === nextEnabled && !options.forceAudit) {
    setInspectorVisualState();
    return;
  }

  inspectorEnabled = nextEnabled;
  clearInspectorTimer();
  if (inspectorEnabled) {
    sessionStorage.setItem(SESSION_KEY, "true");
    await refreshInspectorCapabilitySources();
    inspectorTimer = window.setTimeout(() => {
      void setInspectorEnabled(false, { reason: "timeout" });
    }, AUTO_DISABLE_MS);
    showToast(
      "Capability Inspector active",
      "Registered actions will be inspected instead of executed.",
      "warning"
    );
    await auditInspectorEvent("capability_inspector.enabled", { reason: options.reason || "manual" });
  } else {
    sessionStorage.removeItem(SESSION_KEY);
    showToast("Capability Inspector off", "Actions will run normally.", "info");
    await auditInspectorEvent("capability_inspector.disabled", { reason: options.reason || "manual" });
  }
  setInspectorVisualState();
}

function inspectAction(element) {
  const metadata = actionMetadataFromElement(element);
  if (!metadata) return;
  const evaluation = evaluateCapabilities(metadata);
  const required = [
    metadata.requiredAny.length ? "Any: " + metadata.requiredAny.join(" or ") : "",
    metadata.requiredAll.length ? "All: " + metadata.requiredAll.join(" and ") : ""
  ].filter(Boolean).join("; ");

  const body = evaluation.registered
    ? "Action: " + metadata.label +
      " | Area: " + metadata.area +
      " | Required: " + required +
      " | Current user: " + (evaluation.allowed ? "Allowed" : "Not allowed") +
      " | " + capabilitySourceSummary(metadata)
    : "Action: " + metadata.label +
      " | Area: " + metadata.area +
      " | No capability metadata has been declared for this action yet.";

  showToast(
    evaluation.registered ? "Capability required" : "Capability metadata missing",
    body,
    evaluation.allowed ? "info" : "warning"
  );

  void auditInspectorEvent("capability_inspector.action_inspected", {
    actionId: metadata.actionId,
    label: metadata.label,
    area: metadata.area,
    requiredAny: metadata.requiredAny,
    requiredAll: metadata.requiredAll,
    actionType: metadata.actionType,
    allowed: evaluation.allowed
  });
}

function handleInspectorClick(event) {
  if (!inspectorEnabled || !canUseCapabilityInspector()) return;
  const target = event.target instanceof Element
    ? event.target.closest("[data-capability-action]")
    : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  inspectAction(target);
}

export function decorateCapabilityAction(element, metadata) {
  if (!element || !metadata || !metadata.actionId) return element;
  element.dataset.capabilityAction = metadata.actionId;
  if (metadata.label) element.dataset.capabilityLabel = metadata.label;
  if (metadata.area) element.dataset.capabilityArea = metadata.area;
  if (metadata.requiredAny) element.dataset.capabilityAny = metadata.requiredAny.join(" ");
  if (metadata.requiredAll) element.dataset.capabilityAll = metadata.requiredAll.join(" ");
  if (metadata.notes) element.dataset.capabilityNotes = metadata.notes;
  if (metadata.actionType) element.dataset.capabilityType = metadata.actionType;
  return element;
}

export function syncCapabilityInspectorUi() {
  const allowed = canUseCapabilityInspector();
  const controls = document.querySelectorAll("[data-capability-inspector-control]");
  controls.forEach(control => {
    control.classList.toggle("hidden", !allowed);
  });
  if (!allowed && inspectorEnabled) {
    void setInspectorEnabled(false, { reason: "access_lost" });
  } else {
    setInspectorVisualState();
  }
}

export function resetCapabilityInspector() {
  clearInspectorTimer();
  inspectorEnabled = false;
  effectiveCapabilitySources = new Map();
  sessionStorage.removeItem(SESSION_KEY);
  setInspectorVisualState();
}

export function initialiseCapabilityInspector() {
  if (inspectorInitialised) return;
  inspectorInitialised = true;
  inspectorToggle = document.getElementById("capabilityInspectorToggle");
  inspectorIndicator = document.getElementById("capabilityInspectorIndicator");
  inspectorGlobalIndicator = document.getElementById("capabilityInspectorGlobalIndicator");
  document.addEventListener("click", handleInspectorClick, true);
  if (inspectorToggle) {
    inspectorToggle.addEventListener("change", event => {
      void setInspectorEnabled(event.currentTarget.checked);
    });
  }
  window.addEventListener("oh:capabilities-changed", syncCapabilityInspectorUi);
  window.addEventListener("oh:session-signed-out", resetCapabilityInspector);
  inspectorEnabled = sessionStorage.getItem(SESSION_KEY) === "true" && canUseCapabilityInspector();
  if (inspectorEnabled) {
    void refreshInspectorCapabilitySources();
    inspectorTimer = window.setTimeout(() => {
      void setInspectorEnabled(false, { reason: "timeout" });
    }, AUTO_DISABLE_MS);
  }
  syncCapabilityInspectorUi();
}
