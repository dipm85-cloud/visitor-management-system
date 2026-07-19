import { supabaseClient } from "./api.js";
import { showToast } from "./messages.js";

const requirementsByArea = new Map();
let areasCache = [];
let areasLoaded = false;

function normaliseRules(rows) {
  return (rows || []).map(row => ({
    ...row,
    is_required: row.system_required === true || row.is_required === true,
    is_visible: row.is_visible !== false
  }));
}

function rulesForArea(areaCode) {
  return requirementsByArea.get(areaCode) || [];
}

function ruleByField(areaCode, fieldKey) {
  return rulesForArea(areaCode).find(rule => rule.field_key === fieldKey) || null;
}

function setBaseText(element) {
  if (!element) return "";
  if (!element.dataset.formRequirementBaseText) {
    element.dataset.formRequirementBaseText = element.textContent.replace(/\s+\*$/, "");
  }
  return element.dataset.formRequirementBaseText;
}

function setBasePlaceholder(element) {
  if (!element) return "";
  if (!element.dataset.formRequirementBasePlaceholder) {
    element.dataset.formRequirementBasePlaceholder = element.getAttribute("placeholder") || "";
  }
  return element.dataset.formRequirementBasePlaceholder;
}

function labelElementForMapping(mapping) {
  if (mapping.labelSelector) return document.querySelector(mapping.labelSelector);
  if (mapping.labelId) return document.getElementById(mapping.labelId);
  const input = document.getElementById(mapping.inputId);
  if (!input) return null;
  const explicit = document.querySelector("label[for='" + mapping.inputId + "']");
  if (explicit) return explicit;
  const wrapper = mapping.wrapperId ? document.getElementById(mapping.wrapperId) : input.closest("label");
  return wrapper ? wrapper.querySelector("span") || wrapper : null;
}

function resetMapping(mapping) {
  const input = document.getElementById(mapping.inputId);
  const label = labelElementForMapping(mapping);
  if (input) {
    input.required = Boolean(mapping.nativeRequired);
    input.classList.remove("assignment-required-missing", "form-requirement-missing");
    input.removeAttribute("aria-invalid");
    const placeholder = setBasePlaceholder(input);
    if (placeholder) input.setAttribute("placeholder", placeholder);
  }
  if (label) {
    label.textContent = setBaseText(label);
    label.classList.remove("form-requirement-required-label");
    label.removeAttribute("title");
  }
}

function requirementMessage(rule) {
  if (!rule) return "";
  if (rule.system_required) return "Locked by system";
  return rule.is_required ? "Required by configuration" : "";
}

export async function listFormRequirementAreas() {
  if (areasLoaded) return areasCache;
  try {
    const result = await supabaseClient.rpc("list_field_requirement_areas");
    if (result.error) throw result.error;
    areasCache = result.data || [];
    areasLoaded = true;
  } catch (err) {
    console.warn("Could not load form requirement areas.", err);
    areasCache = [];
  }
  return areasCache;
}

export async function loadFormRequirements(areaCode, options = {}) {
  if (!areaCode) return [];
  if (!options.force && requirementsByArea.has(areaCode)) return rulesForArea(areaCode);
  try {
    const result = await supabaseClient.rpc("list_field_requirements", {
      p_area_code: areaCode
    });
    if (result.error) throw result.error;
    requirementsByArea.set(areaCode, normaliseRules(result.data));
  } catch (err) {
    console.warn("Could not load form requirements for " + areaCode + ".", err);
    requirementsByArea.set(areaCode, []);
  }
  return rulesForArea(areaCode);
}

export function clearFormRequirementMarkers(mappings) {
  Object.values(mappings || {}).forEach(mapping => {
    const input = document.getElementById(mapping.inputId);
    if (!input) return;
    input.classList.remove("assignment-required-missing", "form-requirement-missing");
    input.removeAttribute("aria-invalid");
  });
}

export function markMissingFormRequirements(missingRows, mappings) {
  clearFormRequirementMarkers(mappings);
  (missingRows || []).forEach(row => {
    const mapping = mappings && mappings[row.field_key];
    const input = mapping ? document.getElementById(mapping.inputId) : null;
    if (!input) return;
    input.classList.add("form-requirement-missing");
    input.setAttribute("aria-invalid", "true");
  });
}

export async function applyFormRequirementIndicators(areaCode, mappings, options = {}) {
  const rules = await loadFormRequirements(areaCode, options);
  Object.entries(mappings || {}).forEach(([fieldKey, mapping]) => {
    resetMapping(mapping);
    const input = document.getElementById(mapping.inputId);
    if (!input) return;
    const rule = ruleByField(areaCode, fieldKey);
    if (!rule || rule.is_visible === false) return;
    const required = rule.is_required === true;
    input.required = required || Boolean(mapping.nativeRequired);
    input.dataset.formRequirementField = fieldKey;
    input.dataset.formRequirementArea = areaCode;
    input.dataset.formRequirementRequired = required ? "true" : "false";

    const label = labelElementForMapping(mapping);
    if (label) {
      const baseText = setBaseText(label);
      label.textContent = baseText + (required ? " *" : "");
      label.classList.toggle("form-requirement-required-label", required);
      if (required) label.title = requirementMessage(rule);
      else label.removeAttribute("title");
    } else {
      const placeholder = setBasePlaceholder(input);
      if (placeholder) input.setAttribute("placeholder", placeholder.replace(/\s+\*$/, "") + (required ? " *" : ""));
    }
  });
  return rules;
}

export function missingRequirementMessage(missingRows) {
  return (missingRows || [])
    .map(row => row.field_label || row.field_key)
    .join(", ") + " required.";
}

export async function validateFormRequirements(areaCode, rpcName, payload, mappings, options = {}) {
  clearFormRequirementMarkers(mappings);
  const result = await supabaseClient.rpc(rpcName, {
    p_payload: payload || {}
  });
  if (result.error) throw result.error;
  const missing = (result.data || []).filter(row => row.missing !== false);
  if (!missing.length) return { ok: true, missing: [] };
  markMissingFormRequirements(missing, mappings);
  if (options.toast !== false) {
    showToast(options.title || "Form incomplete", missingRequirementMessage(missing), "error");
  }
  return { ok: false, missing };
}

export function resetFormRequirementsCache() {
  areasLoaded = false;
  areasCache = [];
  requirementsByArea.clear();
}
