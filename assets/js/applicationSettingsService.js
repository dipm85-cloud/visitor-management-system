import { supabaseClient } from "./api.js";

const categoryCache = new Map();
const valueCache = new Map();
let categoriesCache = null;

export function applicationSettingJsonValue(value) {
  if (value == null) return null;
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
  return value;
}

function normaliseSetting(row) {
  const setting = { ...(row || {}) };
  setting.setting_value = applicationSettingJsonValue(setting.setting_value);
  setting.default_value = applicationSettingJsonValue(setting.default_value);
  return setting;
}

function cacheSettings(categoryCode, rows) {
  const settings = (rows || []).map(normaliseSetting);
  if (categoryCode != null) categoryCache.set(categoryCode, settings);
  settings.forEach(setting => {
    if (setting && setting.setting_key) valueCache.set(setting.setting_key, setting.setting_value);
  });
  return settings;
}

function runtimeObjectFromResult(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, applicationSettingJsonValue(value)])
  );
}

function cacheRuntimeApplicationSettings(values) {
  Object.entries(values || {}).forEach(([settingKey, value]) => {
    valueCache.set(settingKey, applicationSettingJsonValue(value));
  });
  return values || {};
}

export async function listApplicationSettingCategories(options = {}) {
  if (!options.force && categoriesCache) return categoriesCache;
  const result = await supabaseClient.rpc("list_application_setting_categories");
  if (result.error) throw result.error;
  categoriesCache = result.data || [];
  return categoriesCache;
}

export async function listApplicationSettings(categoryCode = null, searchText = null, options = {}) {
  if (!options.force && !searchText && categoryCode != null && categoryCache.has(categoryCode)) {
    return categoryCache.get(categoryCode);
  }
  const result = await supabaseClient.rpc("list_application_settings", {
    p_category_code: categoryCode,
    p_search_text: searchText
  });
  if (result.error) throw result.error;
  return cacheSettings(categoryCode, result.data || []);
}

export async function loadApplicationSettingsForRuntime(categoryCodes, options = {}) {
  const codes = categoryCodes || ["general", "branding", "visitors", "shared_terminal"];
  const results = await Promise.all(
    codes.map(code => listApplicationSettings(code, null, options).catch(err => {
      console.warn("Could not load Application Settings category " + code + ".", err);
      return [];
    }))
  );
  return results.flat();
}

export async function getRuntimeApplicationSettings() {
  const result = await supabaseClient.rpc("get_runtime_application_settings");
  if (result.error) throw result.error;
  return cacheRuntimeApplicationSettings(runtimeObjectFromResult(result.data));
}

export async function getRuntimeLegacyCompatSettings() {
  const result = await supabaseClient.rpc("get_runtime_legacy_compat_settings");
  if (result.error) throw result.error;
  return runtimeObjectFromResult(result.data);
}

export function getCachedApplicationSettingValue(settingKey, fallback) {
  return valueCache.has(settingKey) ? valueCache.get(settingKey) : fallback;
}

export async function updateApplicationSetting(settingKey, value) {
  const result = await supabaseClient.rpc("update_application_setting", {
    p_setting_key: settingKey,
    p_setting_value: value
  });
  if (result.error) throw result.error;
  clearApplicationSettingsCache();
  window.dispatchEvent(new CustomEvent("oh:application-settings-values-changed", {
    detail: { settingKey }
  }));
  return result.data;
}

export async function resetApplicationSettingToDefault(settingKey) {
  const result = await supabaseClient.rpc("reset_application_setting_to_default", {
    p_setting_key: settingKey
  });
  if (result.error) throw result.error;
  clearApplicationSettingsCache();
  window.dispatchEvent(new CustomEvent("oh:application-settings-values-changed", {
    detail: { settingKey, reset: true }
  }));
  return result.data;
}

export async function resetApplicationSettingsCategoryToDefaults(categoryCode) {
  const result = await supabaseClient.rpc("reset_application_settings_category_to_defaults", {
    p_category_code: categoryCode
  });
  if (result.error) throw result.error;
  clearApplicationSettingsCache();
  window.dispatchEvent(new CustomEvent("oh:application-settings-values-changed", {
    detail: { categoryCode, reset: true }
  }));
  return result.data || [];
}

export function clearApplicationSettingsCache() {
  categoryCache.clear();
  valueCache.clear();
  categoriesCache = null;
}
