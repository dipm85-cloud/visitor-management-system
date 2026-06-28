import { getDefaultAppSettings } from "./config.js";
import { AppState } from "./state.js";
import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showMessage, clearMessage, showWalkInModalMessage } from "./messages.js";
import { writeAuditEvent } from "./audit.js";
import { boolString } from "./utils.js";

let appSettings;
let appVersion;
let dependencies;

export function configureSettings(options) {
  appSettings = options.appSettings;
  appVersion = options.appVersion;
  dependencies = options.dependencies;
}

export function initialiseCollapsibleSettings() {
  document.querySelectorAll(".settings-section").forEach(section => {
    const heading = section.querySelector(":scope > .settings-heading");
    if (!heading || section.dataset.collapsibleReady === "true") return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-toggle-button";
    toggle.textContent = "−";
    toggle.setAttribute("aria-label", "Collapse section");
    heading.appendChild(toggle);

    const toggleSection = () => {
      section.classList.toggle("is-collapsed");
      const collapsed = section.classList.contains("is-collapsed");
      toggle.textContent = collapsed ? "+" : "−";
      toggle.setAttribute("aria-label", collapsed ? "Expand section" : "Collapse section");
    };

    heading.addEventListener("click", event => {
      if (["INPUT","SELECT","BUTTON","TEXTAREA","LABEL"].includes(event.target.tagName)) return;
      toggleSection();
    });

    toggle.addEventListener("click", event => {
      event.stopPropagation();
      toggleSection();
    });

    section.classList.add("is-collapsed");
    toggle.textContent = "+";
    toggle.setAttribute("aria-label", "Expand section");

    section.dataset.collapsibleReady = "true";
  });
}

function getSettingBool(key, fallback) {
  const value = settingValue(key, fallback);
  return value === true || value === "true";
}

function getFieldRule(prefix, field, kind) {
  const key = prefix + "_" + field + "_" + kind;
  const fallback = appSettings.fieldRules[key];
  return getSettingBool(key, fallback);
}

function setSelectBool(id, value) {
  if (!$(id)) return;
  if ($(id).type === "checkbox") {
    $(id).checked = !!value;
  } else {
    $(id).value = value ? "true" : "false";
  }
}

export function readBoolInput(id) {
  if (!$(id)) return false;
  return $(id).type === "checkbox" ? $(id).checked : $(id).value === "true";
}

export function applyFieldRules() {
  const mappings = [
    ["planned_reason", "planned", "reason"],
    ["planned_vehicle", "planned", "vehicle"],
    ["planned_contact", "planned", "contact"],
    ["planned_pass", "planned", "pass"],
    ["walkin_company", "walkin", "company"],
    ["walkin_reason", "walkin", "reason"],
    ["walkin_vehicle", "walkin", "vehicle"],
    ["walkin_contact", "walkin", "contact"],
    ["walkin_pass", "walkin", "pass"]
  ];

  mappings.forEach(([ruleName, prefix, field]) => {
    const el = document.querySelector('[data-field-rule="' + ruleName + '"]');
    if (!el) return;

    const visible = getFieldRule(prefix, field, "visible");
    const required = getFieldRule(prefix, field, "required") && visible;

    el.classList.toggle("field-hidden-by-setting", !visible);
    el.required = required;

    const basePlaceholder = el.getAttribute("data-base-placeholder") || el.getAttribute("placeholder") || "";
    if (!el.getAttribute("data-base-placeholder")) el.setAttribute("data-base-placeholder", basePlaceholder);
    el.setAttribute("placeholder", basePlaceholder.replace(/ \\*$/, "") + (required ? " *" : ""));
  });
}

export function fieldValueIfVisible(id) {
  const el = $(id);
  if (!el || el.classList.contains("field-hidden-by-setting")) return "";
  return el.value;
}

export function validateRequiredField(id, label, useModalMessage) {
  const el = $(id);
  if (!el || el.classList.contains("field-hidden-by-setting") || !el.required) return true;
  if (String(el.value || "").trim()) return true;

  if (useModalMessage) {
    showWalkInModalMessage(label + " is required.", "error");
  } else {
    showMessage(label + " is required.", "error");
  }

  return false;
}

function syncKioskManagerSettingsControls() {}
function syncKioskManagerSettingsBack() {}

export async function loadSystemSettings() {
  Object.assign(appSettings, getDefaultAppSettings());

  const result = await supabaseClient
    .from("system_settings")
    .select("setting_key, setting_value");

  if (result.error) {
    console.warn("Could not load system settings. Defaults will be used.", result.error);
    return;
  }

  const settings = {};
  (result.data || []).forEach(row => {
    settings[row.setting_key] = row.setting_value;
  });
  AppState.systemSettingsRaw = settings;

  if (settings.confirmation_auto_close_seconds != null) {
    appSettings.confirmationAutoCloseMs = Number(settings.confirmation_auto_close_seconds) * 1000;
  }

  if (settings.kiosk_idle_timeout_seconds != null) {
    appSettings.kioskIdleTimeoutMs = Number(settings.kiosk_idle_timeout_seconds) * 1000;
  }

  if (settings.sign_in_confirmation_message) {
    appSettings.plannedSignInMessage = String(settings.sign_in_confirmation_message);
  }

  if (settings.walk_in_confirmation_message) {
    appSettings.walkInSignInMessage = String(settings.walk_in_confirmation_message);
  }

  if (settings.sign_out_confirmation_message) {
    appSettings.signOutMessage = String(settings.sign_out_confirmation_message);
  }

  if (settings.max_login_attempts != null) {
    appSettings.maxLoginAttempts = Number(settings.max_login_attempts);
  }

  if (settings.company_name) {
    appSettings.companyName = String(settings.company_name);
    const brandText = document.querySelector(".brand div:last-child");
    if (brandText) {
      brandText.innerHTML = appSettings.companyName + "<br><span style='font-size:12px;color:var(--muted);font-weight:700;'>Prototype VMS_035A.1</span>";
    }
  }

  if (settings.primary_colour) {
    appSettings.primaryColour = String(settings.primary_colour);
    document.documentElement.style.setProperty("--brand", appSettings.primaryColour);
  }

  if (settings.accent_colour) {
    appSettings.accentColour = String(settings.accent_colour);
    document.documentElement.style.setProperty("--accent", appSettings.accentColour);
  }

  appSettings.logoUrl = settings.logo_url || null;
  appSettings.backgroundUrl = settings.background_url || null;
  appSettings.backgroundOpacity =
    settings.background_opacity == null ? appSettings.backgroundOpacity : Number(settings.background_opacity);
  appSettings.logoTransparentBackground =
    settings.logo_transparent_background == null ? appSettings.logoTransparentBackground : !!settings.logo_transparent_background;
  appSettings.pageBackgroundColour =
    settings.page_background_colour == null ? appSettings.pageBackgroundColour : String(settings.page_background_colour);

  dependencies.setLastSettingsRefreshAt(new Date());
  applyBrandAssets();
  if ($("settingCurrentAppVersion")) $("settingCurrentAppVersion").value = settingValue("current_app_version", appSettings.currentAppVersion || appVersion);
  if ($("settingOutdatedDeviceWarning")) $("settingOutdatedDeviceWarning").value = boolString(!!settingValue("outdated_device_warning_enabled", true));
  if ($("settingEmailDeliveryEnabled")) $("settingEmailDeliveryEnabled").value = boolString(!!settingValue("email_delivery_enabled", appSettings.emailDeliveryEnabled || false));
  if ($("settingEmailEdgeFunctionUrl")) $("settingEmailEdgeFunctionUrl").value = settingValue("email_edge_function_url", appSettings.emailEdgeFunctionUrl || "");
  if ($("settingEmailSenderName")) $("settingEmailSenderName").value = settingValue("email_sender_name", appSettings.emailSenderName || "Visitor Management");
  if ($("settingEmailSenderAddress")) $("settingEmailSenderAddress").value = settingValue("email_sender_address", appSettings.emailSenderAddress || "onboarding@resend.dev");
  if ($("settingNotifyHostOnVisitorArrival")) $("settingNotifyHostOnVisitorArrival").value = boolString(!!settingValue("notify_host_on_visitor_arrival", appSettings.notifyHostOnVisitorArrival));
  if ($("settingImmediateHostEmailOnSignIn")) $("settingImmediateHostEmailOnSignIn").value = boolString(!!settingValue("immediate_host_email_on_sign_in", appSettings.immediateHostEmailOnSignIn));
  if ($("settingNotifyGdprDueSoon")) $("settingNotifyGdprDueSoon").value = boolString(!!settingValue("notify_gdpr_due_soon", appSettings.notifyGdprDueSoon));
  if ($("settingGdprDueSoonDays")) $("settingGdprDueSoonDays").value = settingValue("gdpr_due_soon_days", appSettings.gdprDueSoonDays);
  if ($("settingNotifyKioskOffline")) $("settingNotifyKioskOffline").value = boolString(!!settingValue("notify_kiosk_offline", appSettings.notifyKioskOffline));
  if ($("settingKioskOfflineMinutes")) $("settingKioskOfflineMinutes").value = settingValue("kiosk_offline_minutes", appSettings.kioskOfflineMinutes);
  if ($("settingEmailProcessorMode")) $("settingEmailProcessorMode").value = settingValue("email_processor_mode", appSettings.emailProcessorMode || "manual");
  if ($("settingEmailProcessorBatchSize")) $("settingEmailProcessorBatchSize").value = settingValue("email_processor_batch_size", appSettings.emailProcessorBatchSize || 25);
  if ($("settingEmailProcessorSchedule")) $("settingEmailProcessorSchedule").value = settingValue("email_processor_schedule", appSettings.emailProcessorSchedule || "Every 5 minutes");
  dependencies.syncAgreementSettingsControls();
  applyFieldRules();
  syncKioskManagerSettingsControls();
}

export function applyBrandAssets() {
  document.documentElement.style.setProperty("--brand", appSettings.primaryColour || "#1f4f8f");
  document.documentElement.style.setProperty("--accent", appSettings.accentColour || "#18a999");

  const logoImg = $("brandLogoImg");
  const logoFallback = $("brandLogoFallback");
  const brandMark = document.querySelector(".brand-mark");

  if (logoImg && logoFallback) {
    if (appSettings.logoUrl) {
      logoImg.src = appSettings.logoUrl;
      logoImg.style.display = "block";
      logoFallback.style.display = "none";
    } else {
      logoImg.removeAttribute("src");
      logoImg.style.display = "none";
      logoFallback.style.display = "block";
    }
  }

  if (brandMark) {
    brandMark.classList.toggle("transparent-logo", !!appSettings.logoTransparentBackground);
  }

  document.body.style.backgroundColor = appSettings.pageBackgroundColour || "#eef3f8";
  document.body.style.backgroundImage = "";
  document.body.style.backgroundSize = "";
  document.body.style.backgroundPosition = "";

  if (appSettings.backgroundUrl) {
    document.body.style.backgroundImage =
      "linear-gradient(rgba(238,243,248," + (1 - appSettings.backgroundOpacity) + "), rgba(248,251,255," + (1 - appSettings.backgroundOpacity) + ")), url('" + appSettings.backgroundUrl + "')";
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
  } else {
    document.body.style.backgroundImage =
      "radial-gradient(circle at top left, rgba(31,79,143,.18), transparent 32%), linear-gradient(135deg, " +
      (appSettings.pageBackgroundColour || "#eef3f8") + " 0%, #f8fbff 100%)";
  }
}

export function settingValue(key, fallback) {
  return AppState.systemSettingsRaw[key] == null ? fallback : AppState.systemSettingsRaw[key];
}

export function fillSettingsForm() {
  if (!$("settingKioskTimeout")) return;

  $("settingKioskTimeout").value = Number(settingValue("kiosk_idle_timeout_seconds", 45));
  $("settingConfirmTimeout").value = Number(settingValue("confirmation_auto_close_seconds", 5));
  $("settingSignInMessage").value = String(settingValue("sign_in_confirmation_message", appSettings.plannedSignInMessage));
  $("settingWalkInMessage").value = String(settingValue("walk_in_confirmation_message", appSettings.walkInSignInMessage));
  $("settingSignOutMessage").value = String(settingValue("sign_out_confirmation_message", appSettings.signOutMessage));
  $("settingCompanyName").value = String(settingValue("company_name", appSettings.companyName));
  $("settingPrimaryColour").value = String(settingValue("primary_colour", appSettings.primaryColour));
  $("settingAccentColour").value = String(settingValue("accent_colour", appSettings.accentColour));
  $("settingPageBackgroundColour").value = String(settingValue("page_background_colour", appSettings.pageBackgroundColour));
  $("settingLogoTransparent").value = boolString(!!settingValue("logo_transparent_background", false));
  $("settingLogoUrl").value = settingValue("logo_url", "") || "";
  $("settingBackgroundUrl").value = settingValue("background_url", "") || "";
  $("settingBackgroundOpacity").value = Number(settingValue("background_opacity", 0.18));
  $("settingAutoEod").value = boolString(!!settingValue("auto_end_of_day_sign_out_enabled", true));
  $("settingAutoEodTime").value = String(settingValue("auto_end_of_day_sign_out_time", "23:59"));
  $("settingMaxLoginAttempts").value = Number(settingValue("max_login_attempts", appSettings.maxLoginAttempts));
  $("settingAllowWalkIns").value = boolString(!!settingValue("allow_walk_ins", true));
  $("settingRequirePass").value = boolString(!!settingValue("require_security_pass", false));
  $("settingRequireVehicle").value = boolString(!!settingValue("require_vehicle_plate", false));
  $("settingRequireContact").value = boolString(!!settingValue("require_onsite_contact", false));
  $("settingRequireKioskDevice").value = boolString(!!settingValue("kiosk_device_required", true));
  if ($("settingRetentionPlannedDays")) $("settingRetentionPlannedDays").value = Number(settingValue("retention_planned_days", appSettings.retentionPlannedDays));
  if ($("settingRetentionVisitLogDays")) $("settingRetentionVisitLogDays").value = Number(settingValue("retention_visit_log_days", appSettings.retentionVisitLogDays));
  if ($("settingRetentionAuditDays")) $("settingRetentionAuditDays").value = Number(settingValue("retention_audit_days", appSettings.retentionAuditDays));
  if ($("settingRetentionMode")) $("settingRetentionMode").value = settingValue("retention_mode", appSettings.retentionMode);
  if ($("settingPlannedCompletedCleanupMode")) $("settingPlannedCompletedCleanupMode").value = settingValue("planned_completed_cleanup_mode", appSettings.plannedCompletedCleanupMode);
  if ($("settingPlannedNoShowRetentionDays")) $("settingPlannedNoShowRetentionDays").value = Number(settingValue("planned_no_show_retention_days", appSettings.plannedNoShowRetentionDays));
  if ($("settingDailyMaintenanceEnabled")) $("settingDailyMaintenanceEnabled").value = boolString(!!settingValue("daily_maintenance_enabled", appSettings.dailyMaintenanceEnabled));
  if ($("settingDailyMaintenanceRoles")) $("settingDailyMaintenanceRoles").value = settingValue("daily_maintenance_roles", appSettings.dailyMaintenanceRoles);
  if ($("settingPrivacyNoticeEnabled")) $("settingPrivacyNoticeEnabled").value = boolString(!!settingValue("privacy_notice_enabled", appSettings.privacyNoticeEnabled));
  if ($("settingPrivacyAcknowledgementRequired")) $("settingPrivacyAcknowledgementRequired").value = boolString(!!settingValue("privacy_acknowledgement_required", appSettings.privacyAcknowledgementRequired));
  if ($("settingPrivacyNoticeVersion")) $("settingPrivacyNoticeVersion").value = settingValue("privacy_notice_version", appSettings.privacyNoticeVersion);
  if ($("settingPrivacyNoticeText")) $("settingPrivacyNoticeText").value = settingValue("privacy_notice_text", appSettings.privacyNoticeText);
  if ($("settingPrivacyDisplayMode")) $("settingPrivacyDisplayMode").value = settingValue("privacy_display_mode", appSettings.privacyDisplayMode);

  setSelectBool("settingPlannedReasonVisible", getFieldRule("planned", "reason", "visible"));
  setSelectBool("settingPlannedReasonRequired", getFieldRule("planned", "reason", "required"));
  setSelectBool("settingPlannedVehicleVisible", getFieldRule("planned", "vehicle", "visible"));
  setSelectBool("settingPlannedVehicleRequired", getFieldRule("planned", "vehicle", "required"));
  setSelectBool("settingPlannedContactVisible", getFieldRule("planned", "contact", "visible"));
  setSelectBool("settingPlannedContactRequired", getFieldRule("planned", "contact", "required"));
  setSelectBool("settingPlannedPassVisible", getFieldRule("planned", "pass", "visible"));
  setSelectBool("settingPlannedPassRequired", getFieldRule("planned", "pass", "required"));

  setSelectBool("settingWalkinCompanyVisible", getFieldRule("walkin", "company", "visible"));
  setSelectBool("settingWalkinCompanyRequired", getFieldRule("walkin", "company", "required"));
  setSelectBool("settingWalkinReasonVisible", getFieldRule("walkin", "reason", "visible"));
  setSelectBool("settingWalkinReasonRequired", getFieldRule("walkin", "reason", "required"));
  setSelectBool("settingWalkinVehicleVisible", getFieldRule("walkin", "vehicle", "visible"));
  setSelectBool("settingWalkinVehicleRequired", getFieldRule("walkin", "vehicle", "required"));
  setSelectBool("settingWalkinContactVisible", getFieldRule("walkin", "contact", "visible"));
  setSelectBool("settingWalkinContactRequired", getFieldRule("walkin", "contact", "required"));
  setSelectBool("settingWalkinPassVisible", getFieldRule("walkin", "pass", "visible"));
  setSelectBool("settingWalkinPassRequired", getFieldRule("walkin", "pass", "required"));

  applyFieldRules();
  $("settingsStatus").textContent = "Settings loaded.";
}

export async function saveSetting(key, value, description) {
  const result = await supabaseClient.rpc("superuser_save_setting", {
    p_setting_key: key,
    p_setting_value: value,
    p_description: description || null
  });

  if (result.error) throw result.error;
}

export async function saveSettingsForm() {
  clearMessage();

  if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
    showMessage("Only Super Users can save settings.", "error");
    return;
  }

  $("settingsStatus").textContent = "Saving settings...";

  const settingsToSave = [
    ["kiosk_idle_timeout_seconds", Number($("settingKioskTimeout").value), "Seconds before kiosk screens return to main"],
    ["confirmation_auto_close_seconds", Number($("settingConfirmTimeout").value), "Seconds before confirmation popup closes"],
    ["sign_in_confirmation_message", $("settingSignInMessage").value, "Message shown after planned sign-in"],
    ["walk_in_confirmation_message", $("settingWalkInMessage").value, "Message shown after walk-in sign-in"],
    ["sign_out_confirmation_message", $("settingSignOutMessage").value, "Message shown after sign-out"],
    ["company_name", $("settingCompanyName").value, "Company/display name"],
    ["primary_colour", $("settingPrimaryColour").value, "Main brand colour"],
    ["accent_colour", $("settingAccentColour").value, "Accent brand colour"],
    ["page_background_colour", $("settingPageBackgroundColour").value, "Page background colour"],
    ["logo_transparent_background", $("settingLogoTransparent").value === "true", "Use transparent background behind logo"],
    ["logo_url", $("settingLogoUrl").value.trim() || null, "Logo URL"],
    ["background_url", $("settingBackgroundUrl").value.trim() || null, "Background URL"],
    ["background_opacity", Number($("settingBackgroundOpacity").value), "Background opacity"],
    ["auto_end_of_day_sign_out_enabled", $("settingAutoEod").value === "true", "Automatically sign out visitors left signed in"],
    ["auto_end_of_day_sign_out_time", $("settingAutoEodTime").value, "Time used for automatic sign-out"],
    ["max_login_attempts", Number($("settingMaxLoginAttempts").value), "Failed login attempts before profile deactivation"],
    ["allow_walk_ins", $("settingAllowWalkIns").value === "true", "Enable walk-in sign-in"],
    ["require_security_pass", $("settingRequirePass").value === "true", "Require security pass during sign-in"],
    ["require_vehicle_plate", $("settingRequireVehicle").value === "true", "Require vehicle plate during sign-in"],
    ["require_onsite_contact", $("settingRequireContact").value === "true", "Require on-site contact during sign-in"],
    ["kiosk_device_required", $("settingRequireKioskDevice").value === "true", "Require kiosk token for public kiosk actions"],

    ["planned_reason_visible", readBoolInput("settingPlannedReasonVisible"), "Show reason field when creating planned visits"],
    ["planned_reason_required", readBoolInput("settingPlannedReasonRequired"), "Require reason field when creating planned visits"],
    ["planned_vehicle_visible", readBoolInput("settingPlannedVehicleVisible"), "Show vehicle field when creating planned visits"],
    ["planned_vehicle_required", readBoolInput("settingPlannedVehicleRequired"), "Require vehicle field when creating planned visits"],
    ["planned_contact_visible", readBoolInput("settingPlannedContactVisible"), "Show on-site contact field when creating planned visits"],
    ["planned_contact_required", readBoolInput("settingPlannedContactRequired"), "Require on-site contact field when creating planned visits"],
    ["planned_pass_visible", readBoolInput("settingPlannedPassVisible"), "Show security pass field when creating planned visits"],
    ["planned_pass_required", readBoolInput("settingPlannedPassRequired"), "Require security pass field when creating planned visits"],

    ["walkin_company_visible", readBoolInput("settingWalkinCompanyVisible"), "Show company field for walk-ins"],
    ["walkin_company_required", readBoolInput("settingWalkinCompanyRequired"), "Require company field for walk-ins"],
    ["walkin_reason_visible", readBoolInput("settingWalkinReasonVisible"), "Show reason field for walk-ins"],
    ["walkin_reason_required", readBoolInput("settingWalkinReasonRequired"), "Require reason field for walk-ins"],
    ["walkin_vehicle_visible", readBoolInput("settingWalkinVehicleVisible"), "Show vehicle field for walk-ins"],
    ["walkin_vehicle_required", readBoolInput("settingWalkinVehicleRequired"), "Require vehicle field for walk-ins"],
    ["walkin_contact_visible", readBoolInput("settingWalkinContactVisible"), "Show on-site contact field for walk-ins"],
    ["walkin_contact_required", readBoolInput("settingWalkinContactRequired"), "Require on-site contact field for walk-ins"],
    ["walkin_pass_visible", readBoolInput("settingWalkinPassVisible"), "Show security pass field for walk-ins"],
    ["walkin_pass_required", readBoolInput("settingWalkinPassRequired"), "Require security pass field for walk-ins"]
  ];

  try {
    for (const item of settingsToSave) {
      const key = item[0];
      const value = item[1];
      const description = item[2];

      try {
        await saveSetting(key, value, description);
      } catch (settingErr) {
        throw new Error("Failed on setting '" + key + "': " + settingErr.message);
      }
    }

    if ($("appVersionText")) $("appVersionText").textContent = appVersion;
    dependencies.bindKioskIdleActivityReset();
    dependencies.simplifyPlannedQueueFilters();
    await loadSystemSettings();
    applyFieldRules();
    fillSettingsForm();

    await writeAuditEvent("settings_changed", "system_settings", null, { action: "settings_saved" });
    $("settingsStatus").textContent = "Settings saved.";
    showMessage("Settings saved successfully.", "success");
  } catch (err) {
    $("settingsStatus").textContent = err.message;
    showMessage("Could not save settings: " + err.message, "error");
    console.error(err);
  }
}

export async function resetSettingsDefaults() {
  if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
    showMessage("Only Super Users can reset settings.", "error");
    return;
  }

  if (!confirm("Reset system settings to default values?")) return;

  $("settingsStatus").textContent = "Resetting defaults...";

  const result = await supabaseClient.rpc("superuser_reset_default_settings");

  if (result.error) {
    showMessage("Could not reset settings: " + result.error.message, "error");
    $("settingsStatus").textContent = "Reset failed.";
    console.error(result.error);
    return;
  }

  Object.assign(appSettings, getDefaultAppSettings());
  await loadSystemSettings();
  applyBrandAssets();
  applyFieldRules();
  fillSettingsForm();

  await writeAuditEvent("settings_changed", "system_settings", null, { action: "settings_reset_defaults" });
  $("settingsStatus").textContent = "Settings reset to defaults.";
  showMessage("Settings reset to defaults.", "success");
}

export async function reloadSettingsForm() {
  await loadSystemSettings();
  fillSettingsForm();
  showMessage("Settings reloaded.", "success");
}
