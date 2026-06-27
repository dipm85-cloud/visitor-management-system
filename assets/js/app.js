import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getDefaultAppSettings,
  KIOSK_TOKEN_STORAGE_KEY
} from "./config.js";
import { AppState } from "./state.js";
import {
  todayDate,
  safe,
  formatPersonName,
  normalisePlate,
  csvEscape,
  exportDateStamp,
  boolString,
  printEscape,
  formatPrintDate,
  formatPrintTime
} from "./utils.js";

window.addEventListener("load", async function () {
  try {
    const APP_VERSION = getDefaultAppSettings().currentAppVersion;
    let lastSettingsRefreshAt = null;
    let lastDataRefreshAt = null;
    let lastHealthCheck = null;
    let kioskHeartbeatTimer = null;
    let lastKioskHeartbeatAt = null;
    let lastKioskHeartbeatResult = null;

    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let activeVisitCache = [];
    let agreementSearchCache = [];
    let securityAgreementSearchCache = [];
    let agreementVersionsCache = [];
    let agreementTypesCache = [];
    let pendingAgreementVersionOverrideId = null;
    let currentAgreementLinkVisit = null;
    let agreementPreviousMatchesCache = [];
    let agreementComplianceMissingCache = [];
    let agreementComplianceMatrixCache = [];
    let outstandingInductionsCache = [];
    let evidenceAuditCache = [];
    let currentAgreementVisit = null;
    let currentAgreementQueue = [];
    let currentAgreementQueueScope = null;
    let currentAgreementSelectionVisit = null;
    let signaturePadState = { drawing: false, hasInk: false };
    let opportunisticMaintenanceCheckedThisSession = false;
    let superKioskTestMode = false;
    let kioskActionInProgress = false;

    function isSuperKioskTestProfile() {
      return AppState.currentProfile && AppState.currentProfile.active && AppState.currentProfile.role === "super_user" && superKioskTestMode === true;
    }

    function setKioskActionButtonBusy(button, busy, busyText, normalText) {
      if (!button) return;
      if (busy) {
        if (!button.dataset.normalText) button.dataset.normalText = normalText || button.textContent || "Continue";
        button.disabled = true;
        button.textContent = busyText || "Please wait...";
        button.setAttribute("aria-busy", "true");
      } else {
        button.disabled = false;
        button.textContent = normalText || button.dataset.normalText || button.textContent || "Continue";
        button.removeAttribute("aria-busy");
        delete button.dataset.normalText;
      }
    }

    function beginKioskAction(button, busyText, normalText) {
      if (kioskActionInProgress) return false;
      kioskActionInProgress = true;
      setKioskActionButtonBusy(button, true, busyText, normalText);
      return true;
    }

    function endKioskAction(button, normalText) {
      kioskActionInProgress = false;
      setKioskActionButtonBusy(button, false, null, normalText);
    }

    // Settings are loaded from public.system_settings.
    // Defaults are used if a setting is missing or cannot be loaded.
    const appSettings = getDefaultAppSettings();

    const debugInfo = document.getElementById("debugInfo");

    function $(id) { return document.getElementById(id); }

    async function loadSystemSettings() {
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

      lastSettingsRefreshAt = new Date();
      applyBrandAssets();
      if ($("settingCurrentAppVersion")) $("settingCurrentAppVersion").value = settingValue("current_app_version", appSettings.currentAppVersion || APP_VERSION);
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
      syncAgreementSettingsControls();
      applyFieldRules();
      syncKioskManagerSettingsControls();
    }

    function applyBrandAssets() {
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

    function settingValue(key, fallback) {
      return AppState.systemSettingsRaw[key] == null ? fallback : AppState.systemSettingsRaw[key];
    }

    function initialiseCollapsibleSettings() {
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

    function readBoolInput(id) {
      if (!$(id)) return false;
      return $(id).type === "checkbox" ? $(id).checked : $(id).value === "true";
    }

    function applyFieldRules() {
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

    function fieldValueIfVisible(id) {
      const el = $(id);
      if (!el || el.classList.contains("field-hidden-by-setting")) return "";
      return el.value;
    }

    function validateRequiredField(id, label, useModalMessage) {
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


    function fillSettingsForm() {
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

    async function saveSetting(key, value, description) {
      const result = await supabaseClient.rpc("superuser_save_setting", {
        p_setting_key: key,
        p_setting_value: value,
        p_description: description || null
      });

      if (result.error) throw result.error;
    }

    async function saveSettingsForm() {
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

        if ($("appVersionText")) $("appVersionText").textContent = APP_VERSION;
    bindKioskIdleActivityReset();
        simplifyPlannedQueueFilters();
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

    const settingGroups = {
      kioskBehaviour: [
        ["kiosk_idle_timeout_seconds", () => Number($("settingKioskTimeout").value), "Seconds before kiosk screens return to main"],
        ["confirmation_auto_close_seconds", () => Number($("settingConfirmTimeout").value), "Seconds before confirmation popup closes"],
        ["allow_walk_ins", () => $("settingAllowWalkIns").value === "true", "Enable walk-in sign-in"],
        ["kiosk_device_required", () => $("settingRequireKioskDevice").value === "true", "Require kiosk token for public kiosk actions"]
      ],
      messages: [
        ["sign_in_confirmation_message", () => $("settingSignInMessage").value, "Message shown after planned sign-in"],
        ["walk_in_confirmation_message", () => $("settingWalkInMessage").value, "Message shown after walk-in sign-in"],
        ["sign_out_confirmation_message", () => $("settingSignOutMessage").value, "Message shown after sign-out"]
      ],
      branding: [
        ["company_name", () => $("settingCompanyName").value, "Company/display name"],
        ["primary_colour", () => $("settingPrimaryColour").value, "Main brand colour"],
        ["accent_colour", () => $("settingAccentColour").value, "Accent brand colour"],
        ["page_background_colour", () => $("settingPageBackgroundColour").value, "Page background colour"],
        ["logo_transparent_background", () => $("settingLogoTransparent").value === "true", "Use transparent background behind logo"],
        ["logo_url", () => $("settingLogoUrl").value.trim() || null, "Logo URL"],
        ["background_url", () => $("settingBackgroundUrl").value.trim() || null, "Background URL"],
        ["background_opacity", () => Number($("settingBackgroundOpacity").value), "Background opacity"]
      ],
      fieldRules: [
        ["planned_reason_visible", () => readBoolInput("settingPlannedReasonVisible"), "Show reason field when creating planned visits"],
        ["planned_reason_required", () => readBoolInput("settingPlannedReasonRequired"), "Require reason field when creating planned visits"],
        ["planned_vehicle_visible", () => readBoolInput("settingPlannedVehicleVisible"), "Show vehicle field when creating planned visits"],
        ["planned_vehicle_required", () => readBoolInput("settingPlannedVehicleRequired"), "Require vehicle field when creating planned visits"],
        ["planned_contact_visible", () => readBoolInput("settingPlannedContactVisible"), "Show on-site contact field when creating planned visits"],
        ["planned_contact_required", () => readBoolInput("settingPlannedContactRequired"), "Require on-site contact field when creating planned visits"],
        ["planned_pass_visible", () => readBoolInput("settingPlannedPassVisible"), "Show security pass field when creating planned visits"],
        ["planned_pass_required", () => readBoolInput("settingPlannedPassRequired"), "Require security pass field when creating planned visits"],
        ["walkin_company_visible", () => readBoolInput("settingWalkinCompanyVisible"), "Show company field for walk-ins"],
        ["walkin_company_required", () => readBoolInput("settingWalkinCompanyRequired"), "Require company field for walk-ins"],
        ["walkin_reason_visible", () => readBoolInput("settingWalkinReasonVisible"), "Show reason field for walk-ins"],
        ["walkin_reason_required", () => readBoolInput("settingWalkinReasonRequired"), "Require reason field for walk-ins"],
        ["walkin_vehicle_visible", () => readBoolInput("settingWalkinVehicleVisible"), "Show vehicle field for walk-ins"],
        ["walkin_vehicle_required", () => readBoolInput("settingWalkinVehicleRequired"), "Require vehicle field for walk-ins"],
        ["walkin_contact_visible", () => readBoolInput("settingWalkinContactVisible"), "Show on-site contact field for walk-ins"],
        ["walkin_contact_required", () => readBoolInput("settingWalkinContactRequired"), "Require on-site contact field for walk-ins"],
        ["walkin_pass_visible", () => readBoolInput("settingWalkinPassVisible"), "Show security pass field for walk-ins"],
        ["walkin_pass_required", () => readBoolInput("settingWalkinPassRequired"), "Require security pass field for walk-ins"]
      ],
      retention: [
        ["retention_planned_days", () => Number($("settingRetentionPlannedDays").value), "Days to keep old planned visits"],
        ["retention_visit_log_days", () => Number($("settingRetentionVisitLogDays").value), "Days to keep visit history before anonymisation"],
        ["retention_audit_days", () => Number($("settingRetentionAuditDays").value), "Days to keep audit events"],
        ["retention_mode", () => $("settingRetentionMode").value, "Retention run mode"]
      ],
      plannedLifecycle: [
        ["planned_completed_cleanup_mode", () => $("settingPlannedCompletedCleanupMode").value, "Completed planned visits cleanup mode"],
        ["planned_no_show_retention_days", () => Number($("settingPlannedNoShowRetentionDays").value), "No-show planned visit retention days"],
        ["daily_maintenance_enabled", () => $("settingDailyMaintenanceEnabled").value === "true", "Enable opportunistic daily maintenance"],
        ["daily_maintenance_roles", () => $("settingDailyMaintenanceRoles").value, "Roles that trigger daily maintenance"]
      ],
      privacyNotice: [
        ["privacy_notice_enabled", () => $("settingPrivacyNoticeEnabled").value === "true", "Show visitor privacy notice"],
        ["privacy_acknowledgement_required", () => $("settingPrivacyAcknowledgementRequired").value === "true", "Require visitor acknowledgement"],
        ["privacy_notice_version", () => $("settingPrivacyNoticeVersion").value.trim() || "2026.1", "Privacy notice version"],
        ["privacy_notice_text", () => $("settingPrivacyNoticeText").value.trim(), "Visitor privacy notice text"],
        ["privacy_display_mode", () => $("settingPrivacyDisplayMode").value, "Privacy display mode"]
      ],
      emailProcessor: [
        ["email_processor_mode", () => $("settingEmailProcessorMode").value, "Email processor mode"],
        ["email_processor_batch_size", () => Number($("settingEmailProcessorBatchSize").value || 25), "Email processor batch size"],
        ["email_processor_schedule", () => $("settingEmailProcessorSchedule").value.trim() || "Every 5 minutes", "Email processor schedule note"]
      ],
      notificationTriggers: [
        ["notify_host_on_visitor_arrival", () => $("settingNotifyHostOnVisitorArrival").value === "true", "Queue host email when visitor signs in"],
        ["notify_gdpr_due_soon", () => $("settingNotifyGdprDueSoon").value === "true", "Queue GDPR due-soon notifications"],
        ["gdpr_due_soon_days", () => Number($("settingGdprDueSoonDays").value || 7), "GDPR due-soon threshold in days"],
        ["notify_kiosk_offline", () => $("settingNotifyKioskOffline").value === "true", "Queue kiosk offline notifications"],
        ["kiosk_offline_minutes", () => Number($("settingKioskOfflineMinutes").value || 60), "Kiosk offline threshold minutes"]
      ],
      emailDelivery: [
        ["email_delivery_enabled", () => $("settingEmailDeliveryEnabled") ? $("settingEmailDeliveryEnabled").value === "true" : false, "Enable email delivery"],
        ["email_edge_function_url", () => $("settingEmailEdgeFunctionUrl") ? $("settingEmailEdgeFunctionUrl").value.trim() : "", "Supabase Edge Function email endpoint"],
        ["email_sender_name", () => $("settingEmailSenderName") ? $("settingEmailSenderName").value.trim() || "Visitor Management" : "Visitor Management", "Email sender name"],
        ["email_sender_address", () => $("settingEmailSenderAddress") ? $("settingEmailSenderAddress").value.trim() || "onboarding@resend.dev" : "onboarding@resend.dev", "Email sender address"]
      ],
      agreementSettings: [
        ["visitor_agreements_enabled", () => $("settingVisitorAgreementsEnabled") ? $("settingVisitorAgreementsEnabled").value === "true" : true, "Enable visitor agreement sign-off"],
        ["agreement_validity_mode", () => $("settingAgreementValidityMode") ? $("settingAgreementValidityMode").value : "version", "Visitor agreement validity mode"],
        ["agreement_validity_days", () => $("settingAgreementValidityDays") ? Number($("settingAgreementValidityDays").value || 365) : 365, "Agreement validity days"],
        ["signature_required", () => $("settingSignatureRequired") ? $("settingSignatureRequired").value === "true" : true, "Require handwritten visitor signature"],
        ["inductor_signoff_enabled", () => $("settingInductorSignoffEnabled") ? $("settingInductorSignoffEnabled").value === "true" : false, "Require inductor sign-off"],
        ["inductor_signoff_mode", () => $("settingInductorSignoffMode") ? $("settingInductorSignoffMode").value : "typed_name", "Inductor sign-off mode"],
        ["agreement_acceptance_text", () => $("settingAgreementAcceptanceText") ? $("settingAgreementAcceptanceText").value.trim() || "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction." : "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction.", "Visitor acceptance wording"],
        ["agreement_print_header", () => $("settingAgreementPrintHeader") ? $("settingAgreementPrintHeader").value.trim() || "Visitor Agreement / Induction Evidence" : "Visitor Agreement / Induction Evidence", "Agreement evidence print header"],
        ["agreement_print_company_name", () => $("settingAgreementPrintCompanyName") ? $("settingAgreementPrintCompanyName").value.trim() || appSettings.companyName || "Visitor Management" : appSettings.companyName || "Visitor Management", "Agreement evidence company name"],
        ["agreement_print_show_logo", () => $("settingAgreementPrintShowLogo") ? $("settingAgreementPrintShowLogo").value === "true" : true, "Show logo on agreement evidence"],
        ["show_compliance_warnings", () => $("settingShowComplianceWarnings") ? $("settingShowComplianceWarnings").value === "true" : true, "Show agreement compliance warnings"],
        ["highlight_overdue_agreements", () => $("settingHighlightOverdueAgreements") ? $("settingHighlightOverdueAgreements").value === "true" : true, "Highlight overdue agreement compliance items"],
        ["block_sign_out_if_required_agreements_missing", () => $("settingBlockSignOutMissingAgreements") ? $("settingBlockSignOutMissingAgreements").value === "true" : false, "Block sign-out when required agreements are missing"]
      ],
      deployment: [
        ["current_app_version", () => $("settingCurrentAppVersion").value.trim() || APP_VERSION, "Expected production app version"],
        ["outdated_device_warning_enabled", () => $("settingOutdatedDeviceWarning").value === "true", "Warn when kiosks run an outdated version"]
      ],
      operationalRules: [
        ["auto_end_of_day_sign_out_enabled", () => $("settingAutoEod").value === "true", "Automatically sign out visitors left signed in"],
        ["auto_end_of_day_sign_out_time", () => $("settingAutoEodTime").value, "Time used for automatic sign-out"],
        ["max_login_attempts", () => Number($("settingMaxLoginAttempts").value), "Failed login attempts before profile deactivation"],
        ["require_security_pass", () => $("settingRequirePass").value === "true", "Require security pass during sign-in"],
        ["require_vehicle_plate", () => $("settingRequireVehicle").value === "true", "Require vehicle plate during sign-in"],
        ["require_onsite_contact", () => $("settingRequireContact").value === "true", "Require on-site contact during sign-in"]
      ]
    };

    async function saveSettingsGroup(groupName, label) {
      clearMessage();

      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
        showMessage("Only Super Users can save settings.", "error");
        return;
      }

      const group = settingGroups[groupName] || [];
      const statusTargetByGroup = {
        kioskBehaviour: "kioskBehaviourStatus",
        messages: "messagesSettingsStatus",
        branding: "brandingSettingsStatus",
        fieldRules: "fieldRulesSettingsStatus",
        operationalRules: "operationalRulesSettingsStatus",
        deployment: "deploymentSettingsStatus",
        emailDelivery: "emailSettingsStatus",
        notificationTriggers: "notificationTriggerStatus",
        emailProcessor: "emailProcessorStatus",
        emailProcessor: "emailProcessorStatus",
        plannedLifecycle: "plannedLifecycleStatus",
        retention: "retentionSettingsStatus",
        privacyNotice: "privacyNoticeSettingsStatus"
      };
      const statusTarget = statusTargetByGroup[groupName] || "settingsStatus";

      setLocalStatus(statusTarget, "Saving " + label + "...", "info");
      if ($("settingsStatus")) $("settingsStatus").textContent = "Saving " + label + "...";

      try {
        const beforeSettings = {};
        const afterSettings = {};

        for (const item of group) {
          beforeSettings[item[0]] = AppState.systemSettingsRaw ? AppState.systemSettingsRaw[item[0]] : null;
          afterSettings[item[0]] = item[1]();
          await saveSetting(item[0], afterSettings[item[0]], item[2]);
        }

        const changes = buildObjectDiff(beforeSettings, afterSettings, Object.keys(afterSettings));

        await loadSystemSettings();
        fillSettingsForm();
        applyFieldRules();

        if (Object.keys(changes).length > 0) {
          await writeAuditEvent("settings_changed", "system_settings", null, {
            action: "settings_group_saved",
            group: groupName,
            changes: changes,
            summary: auditDiffSummary(changes)
          });
        }
        setLocalStatus(statusTarget, label + " saved.", "success");
        if ($("settingsStatus")) $("settingsStatus").textContent = label + " saved.";
        showMessage(label + " saved.", "success");
      } catch (err) {
        setLocalStatus(statusTarget, "Could not save " + label + ": " + err.message, "error");
        if ($("settingsStatus")) $("settingsStatus").textContent = err.message;
        showMessage("Could not save " + label + ": " + err.message, "error");
      }
    }

    async function resetSettingsGroup(groupName, label) {
      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
        showMessage("Only Super Users can reset settings.", "error");
        return;
      }

      if (!confirm("Restore defaults for " + label + "?")) return;

      const defaults = getDefaultAppSettings();
      const defaultValues = {
        kioskBehaviour: {
          kiosk_idle_timeout_seconds: defaults.kioskIdleTimeoutMs / 1000,
          confirmation_auto_close_seconds: defaults.confirmationAutoCloseMs / 1000,
          allow_walk_ins: true,
          kiosk_device_required: true
        },
        messages: {
          sign_in_confirmation_message: defaults.plannedSignInMessage,
          walk_in_confirmation_message: defaults.walkInSignInMessage,
          sign_out_confirmation_message: defaults.signOutMessage
        },
        branding: {
          company_name: defaults.companyName,
          primary_colour: defaults.primaryColour,
          accent_colour: defaults.accentColour,
          page_background_colour: defaults.pageBackgroundColour,
          logo_transparent_background: defaults.logoTransparentBackground,
          logo_url: defaults.logoUrl,
          background_url: defaults.backgroundUrl,
          background_opacity: defaults.backgroundOpacity
        },
        fieldRules: defaults.fieldRules,
        retention: {
          retention_planned_days: defaults.retentionPlannedDays,
          retention_visit_log_days: defaults.retentionVisitLogDays,
          retention_audit_days: defaults.retentionAuditDays,
          retention_mode: defaults.retentionMode
        },
        plannedLifecycle: {
          planned_completed_cleanup_mode: defaults.plannedCompletedCleanupMode,
          planned_no_show_retention_days: defaults.plannedNoShowRetentionDays,
          daily_maintenance_enabled: defaults.dailyMaintenanceEnabled,
          daily_maintenance_roles: defaults.dailyMaintenanceRoles
        },
        privacyNotice: {
          privacy_notice_enabled: defaults.privacyNoticeEnabled,
          privacy_acknowledgement_required: defaults.privacyAcknowledgementRequired,
          privacy_notice_version: defaults.privacyNoticeVersion,
          privacy_notice_text: defaults.privacyNoticeText,
          privacy_display_mode: defaults.privacyDisplayMode
        },
        emailProcessor: {
          email_processor_mode: defaults.emailProcessorMode || "manual",
          email_processor_batch_size: defaults.emailProcessorBatchSize || 25,
          email_processor_schedule: defaults.emailProcessorSchedule || "Every 5 minutes"
        },
        notificationTriggers: {
          notify_host_on_visitor_arrival: defaults.notifyHostOnVisitorArrival,
          notify_gdpr_due_soon: defaults.notifyGdprDueSoon,
          gdpr_due_soon_days: defaults.gdprDueSoonDays,
          notify_kiosk_offline: defaults.notifyKioskOffline,
          kiosk_offline_minutes: defaults.kioskOfflineMinutes
        },
        emailDelivery: {
          email_delivery_enabled: defaults.emailDeliveryEnabled || false,
          email_edge_function_url: defaults.emailEdgeFunctionUrl || "",
          email_sender_name: defaults.emailSenderName || "Visitor Management",
          email_sender_address: defaults.emailSenderAddress || "onboarding@resend.dev"
        },
        agreementSettings: {
          visitor_agreements_enabled: defaults.visitorAgreementsEnabled,
          agreement_validity_mode: defaults.agreementValidityMode,
          agreement_validity_days: defaults.agreementValidityDays,
          signature_required: defaults.signatureRequired,
          inductor_signoff_enabled: false,
          inductor_signoff_mode: "typed_name",
          agreement_acceptance_text: "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction.",
          agreement_print_header: "Visitor Agreement / Induction Evidence",
          agreement_print_company_name: defaults.companyName || "Visitor Management",
          agreement_print_show_logo: true
        },
        deployment: {
          current_app_version: defaults.currentAppVersion || APP_VERSION,
          outdated_device_warning_enabled: defaults.outdatedDeviceWarningEnabled !== false
        },
        operationalRules: {
          auto_end_of_day_sign_out_enabled: true,
          auto_end_of_day_sign_out_time: "23:59",
          max_login_attempts: defaults.maxLoginAttempts,
          require_security_pass: false,
          require_vehicle_plate: false,
          require_onsite_contact: false
        }
      };

      try {
        const values = defaultValues[groupName] || {};
        const beforeSettings = {};
        const afterSettings = {};

        for (const key of Object.keys(values)) {
          beforeSettings[key] = AppState.systemSettingsRaw ? AppState.systemSettingsRaw[key] : null;
          afterSettings[key] = values[key];
          await saveSetting(key, values[key], "Default " + label + " setting");
        }

        const changes = buildObjectDiff(beforeSettings, afterSettings, Object.keys(afterSettings));

        await loadSystemSettings();
        fillSettingsForm();
        applyFieldRules();

        if (Object.keys(changes).length > 0) {
          await writeAuditEvent("settings_changed", "system_settings", null, {
            action: "settings_group_reset",
            group: groupName,
            changes: changes,
            summary: auditDiffSummary(changes)
          });
        }
        showMessage(label + " restored to defaults.", "success");
      } catch (err) {
        showMessage("Could not restore " + label + ": " + err.message, "error");
      }
    }

    async function saveKioskBehaviourFromManager() {
      await saveSettingsGroup("kioskBehaviour", "Kiosk Behaviour");
    }

    async function resetKioskBehaviourFromManager() {
      await resetSettingsGroup("kioskBehaviour", "Kiosk Behaviour");
    }

    async function saveFieldRulesOnly() {
      await saveSettingsGroup("fieldRules", "Field Rules");
    }

    async function resetFieldRulesDefaults() {
      await resetSettingsGroup("fieldRules", "Field Rules");
    }

    function clearProfileForm() {
      $("profileUserId").value = "";
      $("profileDisplayName").value = "";
      $("profileRole").value = "general_user";
      $("profileActive").value = "true";
      $("profileStatus").textContent = "";
    }

    function fillProfileForm(profile) {
      $("profileUserId").value = profile.id || "";
      $("profileDisplayName").value = profile.display_name || "";
      $("profileRole").value = profile.role || "general_user";
      $("profileActive").value = profile.active ? "true" : "false";
      $("profileStatus").textContent = "Editing profile: " + safe(profile.display_name);
    }

    async function saveProfileFromForm() {
      clearMessage();

      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
        showMessage("Only Super Users can manage profiles.", "error");
        return;
      }

      const userId = $("profileUserId").value.trim();
      const displayName = $("profileDisplayName").value.trim();
      const role = $("profileRole").value;
      const active = $("profileActive").value === "true";

      if (!userId || !displayName || !role) {
        showMessage("Auth User ID, display name, and role are required.", "error");
        return;
      }

      $("profileStatus").textContent = "Saving profile...";

      const result = await supabaseClient.rpc("superuser_upsert_profile", {
        p_user_id: userId,
        p_display_name: displayName,
        p_role: role,
        p_active: active
      });

      if (result.error) {
        $("profileStatus").textContent = "Could not save profile.";
        showMessage("Could not save profile: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("profile_changed", "profiles", userId, { display_name: displayName, role: role, active: active });
      $("profileStatus").textContent = "Profile saved.";
      showMessage("Profile saved successfully.", "success");
      await loadProfiles();
    }

    async function loadProfiles() {
      const box = $("profilesList");
      if (!box) return;

      box.innerHTML = "Loading profiles...";

      const result = await supabaseClient.rpc("superuser_list_profiles");

      if (result.error) {
        box.innerHTML = "Could not load profiles.";
        showMessage("Could not load profiles: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const data = normalisePlannedVisitRows(result.data || []);

      if (data.length === 0) {
        box.innerHTML = buildResultSummary(0, "Profiles", "No records") +
          "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No profiles found.</div></div>";
        return;
      }

      const temp = document.createElement("div");

      data.forEach(profile => {
        const row = document.createElement("div");
        row.className = "row";

        row.innerHTML =
          "<div class='row-title'>" + safe(profile.display_name) + "</div>" +
          "<div class='row-meta'>" +
          "Role: " + safe(profile.role) + "<br>" +
          "Status: " + (profile.active ? "Active" : "Inactive") + "<br>" +
          "Failed attempts: " + safe(profile.failed_login_attempts) + "<br>" +
          "User ID: " + safe(profile.id) + "<br>" +
          "Created: " + (profile.created_at ? new Date(profile.created_at).toLocaleString() : "-") +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        const edit = document.createElement("button");
        edit.textContent = "Edit";
        edit.type = "button";
        edit.addEventListener("click", () => fillProfileForm(profile));
        actions.appendChild(edit);

        const resetAttempts = document.createElement("button");
        resetAttempts.textContent = "Reset Attempts";
        resetAttempts.type = "button";
        resetAttempts.className = "secondary";
        resetAttempts.addEventListener("click", () => resetProfileAttempts(profile.id));
        actions.appendChild(resetAttempts);

        const toggle = document.createElement("button");
        toggle.textContent = profile.active ? "Deactivate" : "Activate";
        toggle.type = "button";
        toggle.className = profile.active ? "danger" : "secondary";
        toggle.addEventListener("click", () => toggleProfileActive(profile.id, !profile.active));
        actions.appendChild(toggle);

        row.appendChild(actions);
        temp.appendChild(row);
      });

      setResultBox(box, buildResultSummary(data.length, "Profiles", "Staff accounts"), temp);

    }

    async function resetProfileAttempts(userId) {
      const result = await supabaseClient.rpc("superuser_reset_failed_login_attempts", {
        p_user_id: userId
      });

      if (result.error) {
        showMessage("Could not reset failed attempts: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("failed_attempts_reset", "profiles", userId, {
        action: "failed_attempts_reset",
        summary: "Failed login attempts reset."
      });
      showMessage("Failed login attempts reset.", "success");
      await loadProfiles();
    }

    async function toggleProfileActive(userId, active) {
      if (!confirm((active ? "Activate" : "Deactivate") + " this profile?")) return;

      const result = await supabaseClient.rpc("superuser_set_profile_active", {
        p_user_id: userId,
        p_active: active
      });

      if (result.error) {
        showMessage("Could not update profile status: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("profile_changed", "profiles", userId, { active: active });
      showMessage("Profile status updated.", "success");
      await loadProfiles();
    }

    function maskToken(token) {
      if (!token) return "-";
      const text = String(token);
      if (text.length <= 8) return "********";
      return "************" + text.slice(-6);
    }

    function kioskConnectionStatus(device) {
      if (!device.active) return { label: "Disabled", className: "muted", icon: "⚫" };
      if (!device.last_seen_at) return { label: "Never connected", className: "muted", icon: "⚪" };

      const minutes = (Date.now() - new Date(device.last_seen_at).getTime()) / 60000;

      if (minutes <= 10) return { label: "Online", className: "success", icon: "🟢" };
      if (minutes <= 1440) return { label: "Idle", className: "warning", icon: "🟡" };
      return { label: "Offline", className: "danger", icon: "🔴" };
    }

    function formatDeviceDate(value) {
      return value ? new Date(value).toLocaleString() : "-";
    }

    async function loadKioskDevices() {
      const box = $("kioskDevicesList");
      if (!box) return;

      box.innerHTML = "Loading kiosk devices...";

      try {
        const result = await supabaseClient.rpc("superuser_list_kiosk_devices");

        if (result.error) {
          box.innerHTML = "Could not load kiosk devices: " + safe(result.error.message);
          showMessage("Could not load kiosk devices: " + result.error.message, "error");
          console.error(result.error);
          return;
        }

        const data = result.data || [];

        if (data.length === 0) {
          box.innerHTML = "<div class='row-meta'>No kiosk devices registered.</div>";
          return;
        }

        box.innerHTML = "";

        data.forEach(device => {
          const health = kioskConnectionStatus(device);

          const row = document.createElement("div");
          row.className = "row";

          row.innerHTML =
            "<div class='row-title'>" + safe(device.device_name) + "</div>" +
            "<div class='row-meta'>" +
            "<strong>Device status:</strong> " + (device.active ? "🟢 Active" : "⚫ Disabled") + "<br>" +
            "<strong>Connection:</strong> " + health.icon + " " + safe(health.label) + "<br>" +
            "<strong>Location:</strong> " + safe(device.location_name) + "<br>" +
            "<strong>Description:</strong> " + safe(device.description) + "<br>" +
            "<strong>Last seen:</strong> " + safe(formatDeviceDate(device.last_seen_at)) + "<br>" +
            "<strong>Last visitor activity:</strong> " + safe(formatDeviceDate(device.last_used_at)) + "<br>" +
            "<strong>Last heartbeat reason:</strong> " + safe(device.last_heartbeat_reason || "-") + "<br>" +
            "<strong>App version:</strong> " + safe(device.last_app_version || "-") + "<br>" +
            "<strong>Screen:</strong> " + safe(device.last_screen || "-") + "<br>" +
            "<strong>Browser:</strong> " + safe(device.last_browser || "-") + "<br>" +
            "<strong>Total transactions:</strong> " + safe(device.total_transactions || 0) + "<br>" +
            "<strong>Force logout:</strong> " + (device.force_logout ? "Yes" : "No") + "<br>" +
            "<strong>Token:</strong> <code style='word-break:break-word;'>" + safe(device.kiosk_token) + "</code>" +
            "</div>";

          const actions = document.createElement("div");
          actions.className = "button-row";

          const regen = document.createElement("button");
          regen.textContent = "Regenerate Token";
          regen.type = "button";
          regen.className = "secondary";
          regen.addEventListener("click", () => regenerateKioskToken(device.id));
          actions.appendChild(regen);

          const toggle = document.createElement("button");
          toggle.textContent = device.active ? "Disable" : "Enable";
          toggle.type = "button";
          toggle.className = device.active ? "danger" : "secondary";
          toggle.addEventListener("click", () => setKioskDeviceStatus(device.id, !device.active));
          actions.appendChild(toggle);

          const delDevice = document.createElement("button");
          delDevice.textContent = "Delete Device";
          delDevice.type = "button";
          delDevice.className = "danger";
          delDevice.addEventListener("click", () => deleteKioskDevice(device.id, device.device_name));
          actions.appendChild(delDevice);

          row.appendChild(actions);
          box.appendChild(row);
        });
      } catch (err) {
        box.innerHTML = "Could not load kiosk devices: " + safe(err.message || String(err));
        showMessage("Could not load kiosk devices. See registered devices card.", "error");
        console.error("loadKioskDevices failed:", err);
      }
    }


    async function deleteKioskDevice(deviceId, deviceName) {
      clearMessage();

      if (!confirm("Permanently delete kiosk device '" + safe(deviceName) + "'? This cannot be undone.")) return;

      const result = await supabaseClient.rpc("superuser_delete_kiosk_device", {
        p_device_id: deviceId
      });

      if (result.error) {
        showMessage("Could not delete kiosk device: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("kiosk_device_deleted", "kiosk_devices", deviceId, {
        action: "delete",
        before: { device_name: deviceName },
        summary: "Kiosk device deleted."
      });
      showMessage("Kiosk device deleted.", "success");
      await loadKioskDevices();
    }

    async function createKioskDevice() {
      clearMessage();

      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
        showMessage("Only Super Users can create kiosk devices.", "error");
        return;
      }

      const name = $("kioskDeviceName").value.trim();
      const location = $("kioskLocationName").value.trim();
      const description = $("kioskDescription").value.trim();

      if (!name) {
        showMessage("Device name is required.", "error");
        return;
      }

      $("newKioskTokenBox").textContent = "Creating kiosk device...";

      const result = await supabaseClient.rpc("superuser_create_kiosk_device", {
        p_device_name: name,
        p_location_name: location,
        p_description: description
      });

      if (result.error) {
        $("newKioskTokenBox").textContent = "Could not create kiosk device: " + result.error.message;
        showMessage("Could not create kiosk device: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const token = result.data;

      $("newKioskTokenBox").innerHTML =
        "<strong>New token generated. Copy it now:</strong><br>" +
        "<code style='word-break:break-all;'>" + safe(token) + "</code>";

      $("kioskDeviceName").value = "";
      $("kioskLocationName").value = "";
      $("kioskDescription").value = "";

      await writeAuditEvent("kiosk_device_created", "kiosk_devices", null, {
        action: "create",
        after: { device_name: name, location_name: location, description: description, active: true },
        summary: "Kiosk device created."
      });
      showMessage("Kiosk device created. Copy the token into the tablet.", "success");
      await loadKioskDevices();
    }

    async function regenerateKioskToken(deviceId) {
      clearMessage();

      if (!confirm("Regenerate this kiosk token? The old token will stop working immediately.")) return;

      const result = await supabaseClient.rpc("superuser_regenerate_kiosk_token", {
        p_device_id: deviceId
      });

      if (result.error) {
        showMessage("Could not regenerate token: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      alert("New token. Copy it now:\\n\\n" + result.data);
      await writeAuditEvent("kiosk_token_regenerated", "kiosk_devices", deviceId, {
        action: "regenerate_token",
        summary: "Kiosk token regenerated."
      });
      showMessage("Kiosk token regenerated.", "success");
      await loadKioskDevices();
    }

    async function setKioskDeviceStatus(deviceId, active) {
      clearMessage();

      const reason = active ? "" : prompt("Reason for disabling this device:", "Disabled by SuperUser") || "";

      const result = await supabaseClient.rpc("superuser_set_kiosk_status", {
        p_device_id: deviceId,
        p_active: active,
        p_reason: reason
      });

      if (result.error) {
        showMessage("Could not update kiosk status: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("kiosk_device_status_changed", "kiosk_devices", deviceId, {
        action: "set_status",
        changes: { active: { old: !active, new: active } },
        reason: reason,
        summary: "Kiosk device status changed."
      });
      showMessage("Kiosk device status updated.", "success");
      await loadKioskDevices();
    }


    function getBrowserAuditContext() {
      return {
        app_version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
        captured_at: new Date().toISOString(),
        page_url: window.location.href,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent || null,
        platform: navigator.platform || null,
        language: navigator.language || null,
        languages: navigator.languages || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        screen: window.screen ? {
          width: window.screen.width,
          height: window.screen.height,
          avail_width: window.screen.availWidth,
          avail_height: window.screen.availHeight,
          color_depth: window.screen.colorDepth
        } : null,
        touch_points: navigator.maxTouchPoints || 0,
        online: navigator.onLine,
        session_profile: AppState.currentProfile ? {
          id: AppState.currentProfile.id,
          display_name: AppState.currentProfile.display_name,
          role: AppState.currentProfile.role
        } : null,
        kiosk_token_present: !!getKioskToken()
      };
    }

    async function writeAuditEvent(eventType, entityType, entityId, details) {
      try {
        const enrichedDetails = Object.assign({}, details || {}, {
          client_context: getBrowserAuditContext()
        });

        await supabaseClient.rpc("write_audit_event", {
          p_event_type: eventType,
          p_entity_type: entityType || null,
          p_entity_id: entityId || null,
          p_details: enrichedDetails
        });
      } catch (err) {
        console.warn("Audit event write failed:", err);
      }
    }

    async function loadAuditEvents() {
      const box = $("auditEventsResults");
      if (!box) return;

      box.innerHTML = "Loading audit events...";

      const result = await supabaseClient.rpc("superuser_list_audit_events", {
        p_from_date: $("auditFromDate").value || null,
        p_to_date: $("auditToDate").value || null,
        p_event_type: $("auditEventType").value || null,
        p_search_text: $("auditSearchText").value.trim() || null
      });

      if (result.error) {
        box.innerHTML = "Could not load audit events: " + result.error.message;
        showMessage("Could not load audit events: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      AppState.auditEventsCache = result.data || [];
      renderAuditEvents(box, AppState.auditEventsCache);
    }

    function openAuditDetailsModal(eventRecord) {
      const details = eventRecord.details || {};
      const changes = details.changes || {};
      const rows = Object.keys(changes).map(field => {
        const c = changes[field] || {};
        return "<tr><td>" + safe(field.replaceAll("_", " ")) + "</td><td>" + safe(c.old) + "</td><td>" + safe(c.new) + "</td></tr>";
      }).join("");

      $("auditDetailsContent").innerHTML =
        "<div class='row-meta'>" +
        "<strong>Event:</strong> " + safe(eventRecord.event_type) + "<br>" +
        "<strong>Time:</strong> " + (eventRecord.created_at ? new Date(eventRecord.created_at).toLocaleString() : "-") + "<br>" +
        "<strong>Actor:</strong> " + safe(eventRecord.actor_display_name) + "<br>" +
        "<strong>Entity:</strong> " + safe(eventRecord.entity_type) + " / " + safe(eventRecord.entity_id) + "<br>" +
        "<strong>Reason:</strong> " + safe(details.reason || "-") +
        "</div>" +
        (rows ? "<table><thead><tr><th>Field</th><th>Old</th><th>New</th></tr></thead><tbody>" + rows + "</tbody></table>" : "<div class='row-meta'>No field-level changes recorded.</div>") +
        "<h3>Raw Audit Details</h3><pre style='white-space:pre-wrap;word-break:break-word;'>" + safe(JSON.stringify(details, null, 2)) + "</pre>";

      $("auditDetailsModalBackdrop").classList.add("active");
    }

    function closeAuditDetailsModal() {
      $("auditDetailsModalBackdrop").classList.remove("active");
    }

    function renderAuditEvents(box, data) {
      if (!data || data.length === 0) {
        box.innerHTML = buildResultSummary(0, "Audit events", "No matching records") +
          "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No audit events found.</div></div>";
        return;
      }

      const temp = document.createElement("div");

      data.forEach(evt => {
        const row = document.createElement("div");
        row.className = "row";

        const details = evt.details || {};
        const summary = details.summary || auditDiffSummary(details.changes || {});

        row.innerHTML =
          "<div class='row-title'>" + safe(evt.event_type) + "</div>" +
          "<div class='row-meta'>" +
          "Time: " + (evt.created_at ? new Date(evt.created_at).toLocaleString() : "-") + "<br>" +
          "Actor: " + safe(evt.actor_display_name) + "<br>" +
          "Entity: " + safe(evt.entity_type) + " / " + safe(evt.entity_id) + "<br>" +
          "Summary: " + safe(summary) +
          "</div>";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "secondary";
        btn.textContent = "View Details";
        btn.addEventListener("click", () => openAuditDetailsModal(evt));
        row.appendChild(btn);

        temp.appendChild(row);
      });

      setResultBox(box, buildResultSummary(data.length, "Audit events", "Filtered result"), temp);
    }

    function normaliseAuditExportRows(rows) {
      return (rows || []).map(evt => ({
        "Time": evt.created_at ? new Date(evt.created_at).toLocaleString() : "",
        "Event Type": evt.event_type || "",
        "Actor": evt.actor_display_name || "",
        "Actor ID": evt.actor_id || "",
        "Entity Type": evt.entity_type || "",
        "Entity ID": evt.entity_id || "",
        "Details": JSON.stringify(evt.details || {})
      }));
    }

    async function resetSettingsDefaults() {
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

      // Force a clean repaint from database defaults.
      Object.assign(appSettings, getDefaultAppSettings());
      await loadSystemSettings();
      applyBrandAssets();
      applyFieldRules();
      fillSettingsForm();

      await writeAuditEvent("settings_changed", "system_settings", null, { action: "settings_reset_defaults" });
      $("settingsStatus").textContent = "Settings reset to defaults.";
      showMessage("Settings reset to defaults.", "success");
    }


    async function reloadSettingsForm() {
      await loadSystemSettings();
      fillSettingsForm();
      showMessage("Settings reloaded.", "success");
    }

    function showMessage(text, type) {
      const box = $("message");
      box.textContent = text;
      box.className = "message " + type;

      if (text && AppState.currentProfile && AppState.currentProfile.role !== "kiosk_user") {
        showToast(type === "error" ? "Action failed" : "Action complete", text, type || "success");
      }
    }

    function clearMessage() {
      const box = $("message");
      box.textContent = "";
      box.className = "message";
    }


    function showWalkInModalMessage(text, type) {
      const box = $("walkInModalMessage");
      if (!box) {
        showMessage(text, type || "error");
        return;
      }
      box.textContent = text;
      box.className = "modal-message " + (type || "error");
    }

    function clearWalkInModalMessage() {
      const box = $("walkInModalMessage");
      if (!box) return;
      box.textContent = "";
      box.className = "modal-message";
    }

    function showEditModalMessage(text, type) {
      const box = $("editModalMessage");
      if (!box) {
        showMessage(text, type || "error");
        return;
      }
      box.textContent = text;
      box.className = "modal-message " + (type || "error");
    }

    function clearEditModalMessage() {
      const box = $("editModalMessage");
      if (!box) return;
      box.textContent = "";
      box.className = "modal-message";
    }


    const recentToastKeys = new Map();

    function isLowValueAutoToast(title, body, type) {
      if (type === "error") return false;
      const text = (String(title || "") + " " + String(body || "")).toLowerCase();
      return /\b(loading|loaded|refreshing|refreshed|searching|reloaded)\b/.test(text)
        && !/saved|created|deleted|updated|failed|error|cannot|could not|blocked|warning|missing/.test(text);
    }

    function showToast(title, body, type) {
      // Staff/admin messages use toasts. Kiosk visitor messages still use the centre modal.
      const area = $("toastArea");
      if (!area) return;

      const toastType = type || "success";
      if (isLowValueAutoToast(title, body, toastType)) return;

      const key = toastType + "|" + String(title || "") + "|" + String(body || "");
      const nowMs = Date.now();
      const previous = recentToastKeys.get(key) || 0;
      if (nowMs - previous < 2500) return;
      recentToastKeys.set(key, nowMs);

      const toast = document.createElement("div");
      toast.className = "toast " + toastType;

      const content = document.createElement("div");
      content.innerHTML =
        "<div class='toast-title'>" + safe(title) + "</div>" +
        "<div class='toast-body'>" + safe(body) + "</div>";

      const close = document.createElement("button");
      close.className = "toast-close";
      close.type = "button";
      close.innerHTML = "&times;";
      close.addEventListener("click", function () {
        toast.remove();
      });

      toast.appendChild(content);
      toast.appendChild(close);
      area.appendChild(toast);

      setTimeout(function () {
        toast.remove();
      }, appSettings.confirmationAutoCloseMs);
    }

    let confirmTimer = null;

    function showKioskConfirmation(title, body) {
      $("kioskConfirmTitle").textContent = title;
      $("kioskConfirmBody").textContent = body;
      $("kioskConfirmBackdrop").classList.add("active");

      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(closeKioskConfirmation, appSettings.confirmationAutoCloseMs);
    }

    function closeKioskConfirmation() {
      $("kioskConfirmBackdrop").classList.remove("active");
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = null;
    }

    function getKioskToken() {
      return localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY) || "";
    }

    function setKioskToken(token) {
      localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, token);
      updateKioskTokenWarning();
    }

    function updateKioskTokenWarning() {
      const warning = $("kioskTokenWarning");
      if (!warning) return;
      warning.classList.toggle("hidden", !!getKioskToken());

      const status = $("localKioskTokenStatus");
      if (status) {
        status.textContent = getKioskToken()
          ? "This browser/tablet has a kiosk token saved."
          : "No kiosk token is saved in this browser/tablet.";
      }
    }

    function clearKioskTokenForThisTablet() {
      if (!confirm("Clear the saved kiosk token from this browser/tablet?")) return;
      localStorage.removeItem(KIOSK_TOKEN_STORAGE_KEY);
      updateKioskTokenWarning();
      showMessage("This tablet kiosk token has been cleared.", "success");
    }

    function promptSetKioskTokenForThisTablet() {
      const entered = prompt("Enter kiosk device token for this tablet:");
      if (entered && entered.trim()) {
        setKioskToken(entered.trim());
        showMessage("This tablet kiosk token has been saved.", "success");
      }
    }


    function bindKioskIdleActivityReset() {
      const resetEvents = ["input", "change", "keydown", "pointerdown", "touchstart", "focusin"];

      const containers = [
        "signInScreen",
        "signOutScreen",
        "walkInModalBackdrop",
        "privacyNoticeModalBackdrop",
        "kioskConfirmBackdrop"
      ];

      containers.forEach(id => {
        const el = $(id);
        if (!el || el.dataset.idleResetBound === "true") return;

        resetEvents.forEach(eventName => {
          el.addEventListener(eventName, () => {
            if (isKioskProfile()) resetKioskIdleTimer();
          }, true);
        });

        el.dataset.idleResetBound = "true";
      });
    }

    function resetKioskIdleTimer() {
      if (AppState.kioskIdleTimer) clearTimeout(AppState.kioskIdleTimer);

      const onKioskScreen =
        $("signInScreen").classList.contains("active") ||
        $("signOutScreen").classList.contains("active");

      if (!onKioskScreen) return;

      AppState.kioskIdleTimer = setTimeout(function () {
        showScreen("homeScreen");
      }, appSettings.kioskIdleTimeoutMs);
    }

    function ensureKioskToken() {
      const superUserKioskTestAllowed = isSuperKioskTestProfile();
      if (!isKioskProfile() && !superUserKioskTestAllowed) {
        throw new Error("Kiosk login is required before public sign-in/out can be used.");
      }

      const token = getKioskToken();
      if (token) return token;

      updateKioskTokenWarning();
      throw new Error("Kiosk device token is required. Set this tablet token from Settings > Kiosk Device Manager first.");
    }

    function kioskScreenInfo() {
      if (!window.screen) return null;
      return window.screen.width + "x" + window.screen.height + " / viewport " + window.innerWidth + "x" + window.innerHeight;
    }

    async function sendKioskHeartbeat(triggerReason) {
      if (!AppState.currentProfile || AppState.currentProfile.role !== "kiosk_user") return null;

      const token = getKioskToken();
      if (!token) return null;

      const result = await supabaseClient.rpc("kiosk_heartbeat", {
        p_kiosk_token: token,
        p_app_version: APP_VERSION,
        p_browser: navigator.userAgent || null,
        p_screen: kioskScreenInfo(),
        p_trigger_reason: triggerReason || "timer"
      });

      lastKioskHeartbeatAt = new Date();
      lastKioskHeartbeatResult = result;

      if (result.error) {
        console.warn("Kiosk heartbeat failed:", result.error);
        return result;
      }

      if (result.data && result.data.force_logout === true) {
        await writeAuditEvent("kiosk_force_logout_executed", "kiosk_devices", result.data.device_id || null, {
          reason: "force_logout_flag_detected",
          trigger: triggerReason || "timer"
        });

        clearKioskToken();
        await supabaseClient.auth.signOut({ scope: "local" });
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
      if (AppState.currentProfile && AppState.currentProfile.role === "kiosk_user") startKioskHeartbeat();
        showScreen("homeScreen");
        showMessage("This kiosk device was remotely logged out by a SuperUser.", "error");
      }

      return result;
    }

    function startKioskHeartbeat() {
      stopKioskHeartbeat();

      if (!AppState.currentProfile || AppState.currentProfile.role !== "kiosk_user") return;

      sendKioskHeartbeat("start");

      kioskHeartbeatTimer = setInterval(() => {
        sendKioskHeartbeat("timer");
      }, 5 * 60 * 1000);
    }

    function stopKioskHeartbeat() {
      if (kioskHeartbeatTimer) {
        clearInterval(kioskHeartbeatTimer);
        kioskHeartbeatTimer = null;
      }
    }

    async function verifyKioskTokenOrLogout() {
      const token = getKioskToken();

      if (!token) {
        await supabaseClient.auth.signOut();
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        throw new Error("Kiosk device token is required before kiosk login can be completed.");
      }

      const result = await supabaseClient.rpc("validate_kiosk_device_token", {
        p_kiosk_token: token
      });

      if (result.error || result.data !== true) {
        await supabaseClient.auth.signOut();
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        throw new Error("This kiosk device token is invalid or disabled. Ask a SuperUser to set or replace this tablet token.");
      }

      return true;
    }

    function safeAttr(value) {
      return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function buildResultSummary(count, label, extraText) {
      return "<div class='results-summary'>" +
        "<span>" + safe(label) + ": " + count + " row(s)</span>" +
        "<span>" + safe(extraText || "") + "</span>" +
        "</div>";
    }

    function setResultBox(box, summaryHtml, rowsContainer) {
      box.innerHTML = summaryHtml + "<div class='results-scroll'></div>";
      const scroll = box.querySelector(".results-scroll");
      if (rowsContainer) {
        while (rowsContainer.firstChild) {
          scroll.appendChild(rowsContainer.firstChild);
        }
      }
      return scroll;
    }

    function downloadTextFile(filename, content, mimeType) {
      const blob = new Blob([content], { type: mimeType || "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function downloadCsv(filename, rows) {
      if (!rows || rows.length === 0) {
        showMessage("Nothing to download.", "error");
        return;
      }

      const headers = Object.keys(rows[0]);
      const csv = [
        headers.map(csvEscape).join(","),
        ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }


    function focusFirstModalInput(modalBackdropId) {
      const modal = $(modalBackdropId);
      if (!modal) return;

      setTimeout(() => {
        let firstInput = null;

        if (modalBackdropId === "loginModalBackdrop" && $("loginEmail")) {
          firstInput = $("loginEmail");
        } else {
          firstInput = Array.from(modal.querySelectorAll("input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])"))
            .find(el => el.offsetParent !== null);
        }

        if (firstInput) {
          firstInput.focus({ preventScroll: true });
          if (typeof firstInput.select === "function") firstInput.select();
        }
      }, 120);
    }

    function getActiveModalConfig() {
      const modalKeyboardMap = [
        { backdrop: "kioskLogoutModalBackdrop", enter: "confirmKioskLogoutButton", escape: "cancelKioskLogoutButton" },
        { backdrop: "notificationTemplateModalBackdrop", enter: "saveNotificationTemplateButton", escape: "cancelNotificationTemplateButton" },
        { backdrop: "gdprCaseModalBackdrop", enter: "saveGdprCaseButton", escape: "cancelGdprCaseButton" },
        { backdrop: "gdprAnonymiseModalBackdrop", enter: "confirmGdprAnonymiseButton", escape: "cancelGdprAnonymiseButton" },
        { backdrop: "retentionConfirmModalBackdrop", enter: "confirmRetentionRunButton", escape: "cancelRetentionRunButton" },
        { backdrop: "privacyNoticeModalBackdrop", enter: "confirmPrivacyNoticeButton", escape: "cancelPrivacyNoticeButton" },
        { backdrop: "walkInModalBackdrop", enter: "walkInButton", escape: "cancelWalkInButton" },
        { backdrop: "loginModalBackdrop", enter: "loginButton", escape: "closeLoginModalButton" },
        { backdrop: "changePasswordModalBackdrop", enter: "savePasswordButton", escape: "cancelPasswordButton" },
        { backdrop: "editModalBackdrop", enter: "saveEditButton", escape: "closeEditModalButton" },
        { backdrop: "auditDetailsModalBackdrop", enter: "closeAuditDetailsBottomButton", escape: "closeAuditDetailsModalButton" },
        { backdrop: "kioskConfirmBackdrop", enter: "closeKioskConfirmButton", escape: "closeKioskConfirmButton" }
      ];

      return modalKeyboardMap.find(config => {
        const el = $(config.backdrop);
        return el && el.classList.contains("active");
      });
    }

    function handleGlobalModalKeyboard(event) {
      if (event.key !== "Enter" && event.key !== "Escape") return;

      const active = getActiveModalConfig();
      if (!active) return;

      if (event.key === "Enter") {
        const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
        if (tag === "textarea") return;

        const btn = $(active.enter);
        if (btn) {
          event.preventDefault();
          btn.click();
        }
      }

      if (event.key === "Escape") {
        const btn = $(active.escape);
        if (btn) {
          event.preventDefault();
          btn.click();
        }
      }
    }

    function openLoginModal() {
      $("loginModalBackdrop").classList.add("active");
      $("loginStatus").textContent = "";
    }

    function closeLoginModal() {
      $("loginModalBackdrop").classList.remove("active");
    }

    function roleLabel(role) {
      return String(role || "").replace("_", " ");
    }

    function isKioskProfile() {
      return AppState.currentProfile && AppState.currentProfile.active && AppState.currentProfile.role === "kiosk_user";
    }

    function isStaffProfile() {
      return AppState.currentProfile && AppState.currentProfile.active && AppState.currentProfile.role !== "kiosk_user";
    }

    function updateIdentityChip() {
      const chip = $("identityChip");
      if (!chip) return;

      if (!AppState.currentProfile || !AppState.currentProfile.active) {
        chip.className = "identity-chip hidden";
        chip.textContent = "";
        return;
      }

      const role = AppState.currentProfile.role;
      chip.className = "identity-chip " + (role === "kiosk_user" ? "kiosk" : "staff");
      chip.textContent = (role === "kiosk_user" ? "🟢 Kiosk" : "🟢 " + roleLabel(role)) + ": " + AppState.currentProfile.display_name;
    }

    function updateHomeAccess() {
      const loggedOut = !AppState.currentProfile || !AppState.currentProfile.active;
      const kiosk = isKioskProfile();
      const staff = isStaffProfile();

      $("loggedOutHomeActions").classList.toggle("hidden", !loggedOut);
      $("kioskHomeActions").classList.toggle("hidden", !kiosk);
      $("staffHomeActions").classList.toggle("hidden", !staff);

      if ($("staffButton")) {
        $("staffButton").classList.toggle("hidden", kiosk);
      }

      updateIdentityChip();

      document.body.classList.toggle("kiosk-mode", kiosk);

      if (loggedOut) $("homeSubtitle").textContent = "Please login to continue.";
      if (kiosk) $("homeSubtitle").textContent = "Kiosk mode active and device verified. Visitors can sign in or sign out.";
      if (staff) $("homeSubtitle").textContent = "Staff session active. Open the staff area or logout.";
    }

    function updateTopbarStaffStatus() {
      if (AppState.currentProfile && AppState.currentProfile.active) {
        $("topbarStaffStatus").textContent = AppState.currentProfile.display_name + " (" + roleLabel(AppState.currentProfile.role) + ")";
        $("topbarLogoutButton").classList.remove("hidden");
        $("changePasswordTopButton").classList.toggle("hidden", AppState.currentProfile.role === "kiosk_user");
      } else {
        $("topbarStaffStatus").textContent = "";
        $("topbarLogoutButton").classList.add("hidden");
        $("changePasswordTopButton").classList.add("hidden");
      }

      updateHomeAccess();
    }

    async function getCurrentSessionAndProfile() {
      const sessionResult = await supabaseClient.auth.getSession();
      const session = sessionResult.data ? sessionResult.data.session : null;

      if (!session || !session.user) {
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        return null;
      }

      const profileResult = await supabaseClient
        .from("profiles")
        .select("id, display_name, role, active")
        .eq("id", session.user.id)
        .single();

      if (profileResult.error) {
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        console.error("Profile load error:", profileResult.error);
        return null;
      }

      AppState.currentProfile = profileResult.data;
      updateTopbarStaffStatus();
      return AppState.currentProfile;
    }

    async function loginStaff() {
      clearMessage();
      $("loginStatus").textContent = "Checking login...";

      const email = $("loginEmail").value.trim();
      const password = $("loginPassword").value;

      if (!email || !password) {
        $("loginStatus").textContent = "Email and password are required.";
        return;
      }

      const result = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (result.error) {
        $("loginStatus").textContent =
          "Login failed. Please check your email and password. Too many failed attempts may deactivate the staff profile.";
        console.error(result.error);

        // Best-effort failed login tracking. This only works if the email belongs to a profile.
        try {
          await supabaseClient.rpc("record_failed_login_attempt", { p_email: email });
        } catch (trackErr) {
          console.warn("Failed login tracking unavailable:", trackErr);
        }

        return;
      }

      const profile = await getCurrentSessionAndProfile();

      if (!profile) {
        $("loginStatus").textContent =
          "Login succeeded, but no staff profile exists for this account. Ask a SuperUser to create your profile.";
        await supabaseClient.auth.signOut();
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        return;
      }

      if (!profile.active) {
        $("loginStatus").textContent =
          "This staff profile is inactive or locked. Ask a SuperUser to reactivate it.";
        await supabaseClient.auth.signOut();
        AppState.currentProfile = null;
        updateTopbarStaffStatus();
        return;
      }

      try {
        await supabaseClient.rpc("record_successful_login", { p_user_id: profile.id });
      } catch (successErr) {
        console.warn("Could not reset failed attempts:", successErr);
      }

      if (profile.role === "kiosk_user") {
        try {
          await verifyKioskTokenOrLogout();
        } catch (err) {
          $("loginStatus").textContent = err.message;
          showMessage(err.message, "error");
          return;
        }

        await writeAuditEvent("login_success", "profiles", profile.id, { role: profile.role, login_type: "kiosk" });
        $("loginPassword").value = "";
        closeLoginModal();
        showMessage("Kiosk logged in and device verified.", "success");
        startKioskHeartbeat();
        showScreen("homeScreen");
        updateHomeAccess();
        return;
      }

      await writeAuditEvent("login_success", "profiles", profile.id, { role: profile.role, login_type: "staff" });
      await openStaffAreaFromProfile();
      await runDailyMaintenanceIfDue("opportunistic_staff_login");
      $("loginPassword").value = "";
      closeLoginModal();
      showMessage("Logged in successfully.", "success");
    }


    function openChangePasswordModal() {
      $("newPassword").value = "";
      $("confirmNewPassword").value = "";
      $("changePasswordStatus").textContent = "";
      $("changePasswordModalBackdrop").classList.add("active");
    }

    function closeChangePasswordModal() {
      $("changePasswordModalBackdrop").classList.remove("active");
    }

    async function changeOwnPassword() {
      const newPassword = $("newPassword").value;
      const confirmPassword = $("confirmNewPassword").value;

      if (!newPassword || newPassword.length < 8) {
        $("changePasswordStatus").textContent = "Password must be at least 8 characters.";
        return;
      }

      if (newPassword !== confirmPassword) {
        $("changePasswordStatus").textContent = "Passwords do not match.";
        return;
      }

      $("changePasswordStatus").textContent = "Updating password...";

      const result = await supabaseClient.auth.updateUser({
        password: newPassword
      });

      if (result.error) {
        $("changePasswordStatus").textContent = "Could not update password: " + result.error.message;
        console.error(result.error);
        return;
      }

      $("changePasswordStatus").textContent = "Password updated.";
      showMessage("Password updated successfully.", "success");
      closeChangePasswordModal();
    }

    function clearStaffSearchCaches() {
      AppState.securityPlannedCache = [];
      AppState.securityHistoryCache = [];
      AppState.superPlannedCache = [];
      AppState.superHistoryCache = [];
      AppState.auditEventsCache = [];

      ["generalResults","securityPlannedResults","securityHistoryResults","superPlannedResults","superHistoryResults","auditEventsResults","profilesList","kioskDevicesList"].forEach(id => {
        if ($(id)) $(id).innerHTML = "No data loaded.";
      });

      ["securityNameSearch","securityCompanySearch","securityPassSearch","securityVehicleSearch","securityContactSearch",
       "superNameSearch","superHistoryNameSearch","superCompanySearch","superPassSearch","superVehicleSearch","superContactSearch",
       "auditSearchText"].forEach(id => { if ($(id)) $(id).value = ""; });
    }

    let pendingKioskLogoutResolve = null;

    function showKioskLogoutModalMessage(text, type) {
      const box = $("kioskLogoutModalMessage");
      if (!box) return;
      box.textContent = text;
      box.className = "modal-message " + (type || "error");
    }

    function clearKioskLogoutModalMessage() {
      const box = $("kioskLogoutModalMessage");
      if (!box) return;
      box.textContent = "";
      box.className = "modal-message";
    }

    function openKioskLogoutModal() {
      clearKioskLogoutModalMessage();
      $("kioskLogoutPassword").value = "";
      $("kioskLogoutModalBackdrop").classList.add("active");
      focusFirstModalInput("kioskLogoutModalBackdrop");

      return new Promise(resolve => {
        pendingKioskLogoutResolve = resolve;
      });
    }

    function closeKioskLogoutModal(result) {
      $("kioskLogoutModalBackdrop").classList.remove("active");
      if (pendingKioskLogoutResolve) {
        pendingKioskLogoutResolve(result || null);
        pendingKioskLogoutResolve = null;
      }
    }

    async function requestProtectedLogout() {
      if (AppState.currentProfile && AppState.currentProfile.role === "kiosk_user") {
        const password = await openKioskLogoutModal();

        if (!password) return;

        const sessionResult = await supabaseClient.auth.getSession();
        const session = sessionResult.data ? sessionResult.data.session : null;
        const email = session && session.user ? session.user.email : null;

        if (!email) {
          showKioskLogoutModalMessage("Could not verify kiosk logout session.", "error");
          return;
        }

        // Verify the password with a separate temporary client so the main kiosk
        // session is not refreshed/re-authenticated during the logout check.
        const verifyClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: {
              getItem: function () { return null; },
              setItem: function () {},
              removeItem: function () {}
            }
          }
        });

        const verify = await verifyClient.auth.signInWithPassword({
          email: email,
          password: password
        });

        if (verify.error) {
          showMessage("Incorrect password. Kiosk logout cancelled.", "error");
          return;
        }

        await verifyClient.auth.signOut();
      }

      await logoutStaff();
    }

    async function logoutStaff() {
      stopKioskHeartbeat();

      if (AppState.currentProfile && AppState.currentProfile.id) {
        await writeAuditEvent("logout", "profiles", AppState.currentProfile.id, { role: AppState.currentProfile.role });
      }

      await supabaseClient.auth.signOut({ scope: "local" });

      AppState.currentProfile = null;
      updateTopbarStaffStatus();

      $("staffIdentity").textContent = "Login required. Your role will decide which tools are available.";

      if ($("walkInModalBackdrop")) $("walkInModalBackdrop").classList.remove("active");
      if ($("loginModalBackdrop")) $("loginModalBackdrop").classList.remove("active");
      if ($("kioskLogoutModalBackdrop")) $("kioskLogoutModalBackdrop").classList.remove("active");
      if ($("changePasswordModalBackdrop")) $("changePasswordModalBackdrop").classList.remove("active");
      if ($("editModalBackdrop")) $("editModalBackdrop").classList.remove("active");

      clearStaffSearchCaches();
      clearWalkInForm();
      showScreen("homeScreen");
      showMessage("Logged out.", "success");
      closeLoginModal();
    }

    async function openStaffAreaFromProfile() {
      const profile = await getCurrentSessionAndProfile();

      if (!profile || !profile.active) {
        openLoginModal();
        $("loginStatus").textContent = "Login session found, but no active staff profile was found for this user.";
        return;
      }

      showScreen("staffScreen");

      $("staffIdentity").textContent =
        "Logged in as " + profile.display_name + " (" + profile.role.replace("_", " ") + "). Use Logout before returning kiosk to visitors.";

      // Role tabs remain hidden for normal users.
      // Super users can temporarily see tabs for development/testing.
      $("roleTabs").classList.toggle("hidden", profile.role !== "super_user");

      if (profile.role === "general_user") setRole("general");
      if (profile.role === "security") { setRole("security"); loadAgreementVersions(); }
      if (profile.role === "super_user") { setRole("super"); showSuperSection("dashboard"); }
    }


    function normaliseExportRows(rows, type) {
      if (!rows || rows.length === 0) return [];

      if (type === "planned") {
        return rows.map(row => ({
          "Visitor": row.visitor_name || "",
          "Company": row.company || "",
          "Visit Date": row.visit_date || "",
          "Expected Time": row.expected_time || "",
          "Reason": row.visit_reason || "",
          "Vehicle": row.vehicle_plate || "",
          "On-site Contact": row.onsite_contact || "",
          "Security Pass": row.security_pass_id || "",
          "Created By": row.created_by || "",
          "Modified By": row.modified_by || "",
          "Modified At": row.modified_at || ""
        }));
      }

      return rows.map(row => ({
        "Visitor": row.visitor_name || "",
        "Company": row.company || "",
        "Origin": (row.visit_origin || (row.planned_visit_id ? "planned" : "walk_in")).replace("_", " "),
        "Security Pass": row.security_pass_id || "",
        "Vehicle": row.vehicle_plate || "",
        "On-site Contact": row.onsite_contact || "",
        "Sign In": row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "",
        "Sign Out": row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "",
        "Status": row.visit_status || "",
        "Auto Signed Out": row.signed_out_automatically ? "Yes" : "No",
        "Auto Sign-Out Reason": row.automatic_sign_out_reason || ""
      }));
    }

    function autoSizeWorksheetColumns(ws, rows) {
      if (!rows || rows.length === 0) return;
      const headers = Object.keys(rows[0]);
      ws["!cols"] = headers.map(header => {
        const maxLen = Math.max(
          header.length,
          ...rows.map(row => String(row[header] == null ? "" : row[header]).length)
        );
        return { wch: Math.min(Math.max(maxLen + 2, 12), 42) };
      });
    }

    function exportToExcel(rows, filename, type) {
      const formattedRows = type === "agreements" ? (rows || []) : normaliseExportRows(rows, type);

      if (!formattedRows || formattedRows.length === 0) {
        showMessage("Nothing to export.", "error");
        return;
      }

      if (!window.XLSX) {
        showMessage("Excel export library could not be loaded.", "error");
        return;
      }

      const ws = XLSX.utils.json_to_sheet(formattedRows);
      autoSizeWorksheetColumns(ws, formattedRows);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, type === "planned" ? "Planned Visits" : "Visit History");

      XLSX.writeFile(wb, filename);
    }

    function showScreen(screenId) {
      if (screenId === "staffScreen") {
        superKioskTestMode = false;
        document.body.classList.toggle("kiosk-mode", isKioskProfile());
      }
      $("homeScreen").style.display = screenId === "homeScreen" ? "grid" : "none";
      ["signInScreen", "signOutScreen", "staffScreen"].forEach(id => {
        $(id).classList.toggle("active", id === screenId);
      });
      clearMessage();

      if (AppState.kioskIdleTimer) {
        clearTimeout(AppState.kioskIdleTimer);
        AppState.kioskIdleTimer = null;
      }

      if (screenId === "homeScreen" || screenId === "staffScreen" || screenId === "signOutScreen") {
        if ($("walkInModalBackdrop")) $("walkInModalBackdrop").classList.remove("active");
        clearWalkInForm();
      }

      if (screenId === "signInScreen" || screenId === "signOutScreen") {
        bindKioskIdleActivityReset();
        resetKioskIdleTimer();
      }
    }


    function ensureSuperReportingCards() {
      const reporting = $("superReportingSection");
      if (!reporting) return;

      document.querySelectorAll(".card").forEach(card => {
        const title = card.querySelector("h2");
        if (!title) return;

        const text = title.textContent.trim();
        if (text === "Planned Visit Queue" || text === "Super User Advanced History") {
          if (card.parentElement !== reporting) reporting.appendChild(card);
        }
      });
    }


    function simplifyPlannedQueueFilters() {
      const plannedOnlyDateIds = [
        "generalPlannedFromDate", "generalPlannedToDate",
        "securityPlannedFromDate", "securityPlannedToDate",
        "superPlannedFromDate", "superPlannedToDate"
      ];

      plannedOnlyDateIds.forEach(id => {
        const el = $(id);
        if (!el) return;
        const field = el.closest(".setting-field") || el;
        field.classList.add("planned-date-filter-hidden");
      });

      const advancedHistoryDateIds = [
        "generalFromDate", "generalToDate",
        "securityFromDate", "securityToDate",
        "superFromDate", "superToDate",
        "superHistoryFromDate", "superHistoryToDate"
      ];

      advancedHistoryDateIds.forEach(id => {
        const el = $(id);
        if (!el) return;
        const field = el.closest(".setting-field") || el;
        field.classList.remove("planned-date-filter-hidden");
      });
    }



    function moveGdprWorkspaceParts() {
      const holder = $("gdprOriginalRightsHolder");
      if (!holder || holder.dataset.moved === "true") return;

      const rightsCard = holder.querySelector(".card");
      if (!rightsCard) return;

      const searchSection = rightsCard.querySelector("#gdprVisitorName")?.closest(".settings-section");
      const erasureSection = rightsCard.querySelector("#gdprResults")?.closest(".settings-section");

      const sarSection = rightsCard.querySelector("#sarPackagePreview")?.closest(".settings-section");
      const evidenceSection = rightsCard.querySelector("#gdprEvidencePreview")?.closest(".settings-section");

      if (searchSection && $("gdprSearchWorkspaceMount")) $("gdprSearchWorkspaceMount").appendChild(searchSection);
      if (sarSection && $("gdprSarWorkspaceMount")) $("gdprSarWorkspaceMount").appendChild(sarSection);
      if (erasureSection && $("gdprErasureWorkspaceMount")) $("gdprErasureWorkspaceMount").appendChild(erasureSection);
      if (evidenceSection && $("gdprEvidenceWorkspaceMount")) $("gdprEvidenceWorkspaceMount").appendChild(evidenceSection);

      holder.dataset.moved = "true";
    }

    function showGdprStep(stepName) {
      moveGdprWorkspaceParts();

      const steps = {
        cases: "gdprStepCases",
        search: "gdprStepSearch",
        sar: "gdprStepSar",
        erasure: "gdprStepErasure",
        evidence: "gdprStepEvidence"
      };

      Object.keys(steps).forEach(key => {
        if ($(steps[key])) $(steps[key]).classList.toggle("hidden", key !== stepName);
      });

      [
        ["gdprStepCasesButton", "cases"],
        ["gdprStepSearchButton", "search"],
        ["gdprStepSarButton", "sar"],
        ["gdprStepErasureButton", "erasure"],
        ["gdprStepEvidenceButton", "evidence"]
      ].forEach(([id, key]) => {
        if ($(id)) $(id).classList.toggle("active", key === stepName);
      });
    }


    let agreementConfirmResolve = null;
    let currentEvidenceRecord = null;
    const inductorSignaturePadState = { isDrawing:false, hasInk:false, lastX:0, lastY:0, pixelRatio:1 };

    function setAgreementConfirmMessage(text, type) {
      const box = $("agreementConfirmMessage");
      if (!box) return;
      box.textContent = text || "";
      box.className = text ? "modal-message " + (type || "info") : "modal-message";
    }

    function openAgreementConfirmModal(options) {
      const cfg = options || {};
      if ($("agreementConfirmTitle")) $("agreementConfirmTitle").textContent = cfg.title || "Confirm Action";
      if ($("agreementConfirmBody")) $("agreementConfirmBody").innerHTML = cfg.body || "";
      if ($("agreementConfirmOkButton")) $("agreementConfirmOkButton").textContent = cfg.confirmText || "Confirm";
      setAgreementConfirmMessage("", "");
      if ($("agreementConfirmModalBackdrop")) $("agreementConfirmModalBackdrop").classList.add("active");
      return new Promise(resolve => { agreementConfirmResolve = resolve; });
    }

    function closeAgreementConfirmModal(result) {
      if ($("agreementConfirmModalBackdrop")) $("agreementConfirmModalBackdrop").classList.remove("active");
      if (agreementConfirmResolve) { agreementConfirmResolve(!!result); agreementConfirmResolve = null; }
    }

    function syncAgreementSettingsControls() {
      if ($("settingVisitorAgreementsEnabled")) $("settingVisitorAgreementsEnabled").value = boolString(!!settingValue("visitor_agreements_enabled", true));
      if ($("settingAgreementValidityMode")) $("settingAgreementValidityMode").value = String(settingValue("agreement_validity_mode", "version"));
      if ($("settingAgreementValidityDays")) $("settingAgreementValidityDays").value = Number(settingValue("agreement_validity_days", 365));
      if ($("settingSignatureRequired")) $("settingSignatureRequired").value = boolString(!!settingValue("signature_required", true));
      if ($("settingInductorSignoffEnabled")) $("settingInductorSignoffEnabled").value = boolString(!!settingValue("inductor_signoff_enabled", false));
      if ($("settingInductorSignoffMode")) $("settingInductorSignoffMode").value = String(settingValue("inductor_signoff_mode", "typed_name"));
      if ($("settingAgreementAcceptanceText")) $("settingAgreementAcceptanceText").value = String(settingValue("agreement_acceptance_text", "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction."));
      if ($("settingAgreementPrintHeader")) $("settingAgreementPrintHeader").value = String(settingValue("agreement_print_header", "Visitor Agreement / Induction Evidence"));
      if ($("settingAgreementPrintCompanyName")) $("settingAgreementPrintCompanyName").value = String(settingValue("agreement_print_company_name", appSettings.companyName || "Visitor Management"));
      if ($("settingAgreementPrintShowLogo")) $("settingAgreementPrintShowLogo").value = boolString(!!settingValue("agreement_print_show_logo", true));
      if ($("settingShowComplianceWarnings")) $("settingShowComplianceWarnings").value = boolString(!!settingValue("show_compliance_warnings", true));
      if ($("settingHighlightOverdueAgreements")) $("settingHighlightOverdueAgreements").value = boolString(!!settingValue("highlight_overdue_agreements", true));
      if ($("settingBlockSignOutMissingAgreements")) $("settingBlockSignOutMissingAgreements").value = boolString(!!settingValue("block_sign_out_if_required_agreements_missing", false));
    }

    function showAgreementTab(tabName) {
      const tabs = { pending:"agreementPendingPanel", search:"agreementSearchPanel", versions:"agreementVersionsPanel", compliance:"agreementCompliancePanel" };
      Object.keys(tabs).forEach(key => { if ($(tabs[key])) $(tabs[key]).classList.toggle("hidden", key !== tabName); });
      [["agreementTabPending","pending"],["agreementTabSearch","search"],["agreementTabVersions","versions"],["agreementTabCompliance","compliance"]].forEach(([id,key]) => { if ($(id)) $(id).classList.toggle("active", key === tabName); });
      if (tabName === "search") { loadAgreementTypes(); loadAgreementVersionOptions(); }
      if (tabName === "versions") { loadAgreementTypes(); loadAgreementVersions(); syncAgreementSettingsControls(); }
      if (tabName === "compliance") { loadAgreementTypes(); populateAgreementTypeSelects(); loadAgreementComplianceSummary(); }
    }

    function agreementStatusBadge(req) {
      const required = !!req.agreement_required;
      const reason = String(req.reason || "").toLowerCase();
      let cls = required ? "agreement-status-required" : "agreement-status-valid";
      if (reason.includes("disabled") || reason.includes("no active")) cls = "agreement-status-disabled";
      return "<span class='status-badge " + cls + "'>" + (required ? "Agreement required" : "Agreement OK") + "</span>";
    }

    async function loadAgreementTypes() {
      const result = await supabaseClient.rpc("list_agreement_types");
      if (result.error) { showToast("Agreement types", "Could not load agreement types: " + result.error.message, "error"); return []; }
      agreementTypesCache = result.data || [];
      renderAgreementTypesList();
      populateAgreementTypeSelects();
      return agreementTypesCache;
    }

    function populateAgreementTypeSelects() {
      const selectIds = ["agreementVersionType", "agreementSearchType", "securityAgreementSearchType", "missingAgreementType", "evidenceAuditType"];
      selectIds.forEach(id => {
        const sel = $(id); if (!sel) return;
        const current = sel.value;
        const allLabel = id === "agreementVersionType" ? "Select agreement type" : "All agreement types";
        sel.innerHTML = "<option value=''>" + allLabel + "</option>" + agreementTypesCache.map(t => "<option value='" + safe(t.agreement_type_id) + "'>" + safe(t.agreement_name) + "</option>").join("");
        if (current) sel.value = current;
      });
    }

    function clearAgreementTypeForm() {
      ["agreementTypeId","agreementTypeName","agreementTypeTitle","agreementTypeDescription"].forEach(id => { if ($(id)) $(id).value = ""; });
      if ($("agreementTypeActive")) $("agreementTypeActive").value = "true";
      if ($("agreementTypeDefaultRequired")) $("agreementTypeDefaultRequired").value = "true";
      if ($("agreementTypeDisplayOrder")) $("agreementTypeDisplayOrder").value = "100";
      setLocalStatus("agreementTypeStatus", "Agreement type form cleared.", "info");
    }

    function fillAgreementTypeForm(t) {
      if (!t) return;
      $("agreementTypeId").value = t.agreement_type_id || "";
      $("agreementTypeName").value = t.agreement_name || "";
      $("agreementTypeTitle").value = t.agreement_title || "";
      $("agreementTypeDescription").value = t.description || "";
      $("agreementTypeActive").value = boolString(t.is_active !== false);
      $("agreementTypeDefaultRequired").value = boolString(t.default_required !== false);
      $("agreementTypeDisplayOrder").value = Number(t.display_order || 100);
      setLocalStatus("agreementTypeStatus", "Editing agreement type: " + safe(t.agreement_name), "info");
    }

    function renderAgreementTypesList() {
      const box = $("agreementTypesList"); if (!box) return;
      if (!agreementTypesCache.length) { box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No agreement types loaded.</div>"; return; }
      box.innerHTML = "";
      agreementTypesCache.forEach(t => {
        const row = document.createElement("div"); row.className = "row";
        const stateBadge = t.is_active ? "<span class='status-badge status-in'>Active</span>" : "<span class='status-badge status-pending'>Inactive</span>";
        const reqBadge = t.default_required ? "<span class='status-badge agreement-status-required'>Required by default</span>" : "<span class='status-badge agreement-status-disabled'>Optional</span>";
        row.innerHTML = "<div class='row-title'>" + safe(t.agreement_name) + " " + stateBadge + " " + reqBadge + "</div>" +
          "<div class='row-meta'>Title: " + safe(t.agreement_title) + "<br>Order: " + safe(t.display_order) + "<br>" + safe(t.description) + "</div>";
        const actions = document.createElement("div"); actions.className = "button-row";
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "secondary"; edit.textContent = "Edit Type"; edit.addEventListener("click", () => fillAgreementTypeForm(t));
        actions.appendChild(edit);
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = t.is_active ? "danger" : "secondary"; toggle.textContent = t.is_active ? "Deactivate Type" : "Reactivate Type";
        toggle.addEventListener("click", () => setAgreementTypeActive(t, !t.is_active));
        actions.appendChild(toggle);
        row.appendChild(actions); box.appendChild(row);
      });
    }

    async function saveAgreementTypeFromForm() {
      setLocalStatus("agreementTypeStatus", "Saving agreement type...", "info");
      const result = await supabaseClient.rpc("superuser_save_agreement_type", {
        p_agreement_type_id: $("agreementTypeId").value || null,
        p_agreement_name: $("agreementTypeName").value.trim(),
        p_agreement_title: $("agreementTypeTitle").value.trim(),
        p_description: $("agreementTypeDescription").value.trim() || null,
        p_is_active: $("agreementTypeActive").value === "true",
        p_default_required: $("agreementTypeDefaultRequired").value === "true",
        p_display_order: Number($("agreementTypeDisplayOrder").value || 100)
      });
      if (result.error) { setLocalStatus("agreementTypeStatus", result.error.message, "error"); showToast("Agreement type failed", result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { const msg = response && response.message ? response.message : "Agreement type save failed."; setLocalStatus("agreementTypeStatus", msg, "error"); showToast("Agreement type failed", msg, "error"); return; }
      setLocalStatus("agreementTypeStatus", response.message || "Agreement type saved.", "success"); showToast("Agreement type saved", response.message || "Agreement type saved.", "success");
      clearAgreementTypeForm(); await loadAgreementTypes(); await loadAgreementVersions();
    }

    async function setAgreementTypeActive(t, makeActive) {
      const actionText = makeActive ? "reactivate" : "deactivate";
      const proceed = await openAgreementConfirmModal({
        title: (makeActive ? "Reactivate" : "Deactivate") + " agreement type",
        body: "<p>" + (makeActive ? "Reactivate" : "Deactivate") + " <strong>" + safe(t.agreement_name) + "</strong>?</p>" + (!makeActive && t.default_required ? "<p>If visitor agreements are enabled, at least one active required agreement must remain.</p>" : ""),
        confirmText: makeActive ? "Reactivate" : "Deactivate"
      });
      if (!proceed) return;
      setLocalStatus("agreementTypeStatus", "Updating agreement type...", "info");
      const result = await supabaseClient.rpc("superuser_set_agreement_type_active", { p_agreement_type_id: t.agreement_type_id, p_is_active: makeActive });
      if (result.error) { setLocalStatus("agreementTypeStatus", result.error.message, "error"); showToast("Agreement type failed", result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { const msg = response && response.message ? response.message : "Agreement type update failed."; setLocalStatus("agreementTypeStatus", msg, "error"); showToast("Agreement type failed", msg, "error"); return; }
      setLocalStatus("agreementTypeStatus", response.message || "Agreement type updated.", "success");
      showToast("Agreement type updated", response.message || "Agreement type updated.", "success");
      await loadAgreementTypes(); await loadAgreementVersions();
    }

    async function getAgreementRequirementForVisit(visitId, agreementTypeId) {
      const result = await supabaseClient.rpc("get_visit_agreement_requirement_for_type", { p_visit_log_id: visitId, p_agreement_type_id: agreementTypeId });
      if (result.error) throw result.error;
      return Array.isArray(result.data) ? result.data[0] : result.data;
    }

    async function getAgreementStatusesForVisit(visitId) {
      const result = await supabaseClient.rpc("get_visit_agreement_status_all", { p_visit_log_id: visitId });
      if (result.error) throw result.error;
      return result.data || [];
    }

    async function loadPendingAgreements(scope) {
      const statusId = scope === "security" ? "securityAgreementStatus" : "superAgreementStatus";
      const resultId = scope === "security" ? "securityPendingAgreementResults" : "superPendingAgreementResults";
      const box = $(resultId); if (!box) return;
      setLocalStatus(statusId, "Loading visitors requiring agreement action...", "info");
      const result = await supabaseClient.rpc("get_pending_agreement_visitors");
      if (result.error) { box.innerHTML = "Could not load pending agreements."; setLocalStatus(statusId, result.error.message, "error"); showToast("Pending agreements failed", result.error.message, "error"); return; }
      const rows = (result.data || []).map(row => ({ id:row.visit_log_id, visit_log_id:row.visit_log_id, visitor_name:row.visitor_name, company:row.company, sign_in_time:row.sign_in_time, agreement_requirement:row }));
      renderPendingAgreements(box, rows);
      setLocalStatus(statusId, rows.length + " agreement action(s) required.", rows.length ? "info" : "success");
    }

    function renderPendingAgreements(box, rows) {
      if (!rows || rows.length === 0) {
        box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No visitors currently require agreement action.</div>";
        return;
      }

      const grouped = [];
      const byVisit = {};
      rows.forEach(row => {
        const key = row.visit_log_id || row.id;
        if (!byVisit[key]) {
          byVisit[key] = {
            id: key,
            visit_log_id: key,
            visitor_name: row.visitor_name,
            company: row.company,
            sign_in_time: row.sign_in_time,
            required_requirements: []
          };
          grouped.push(byVisit[key]);
        }
        if (row.agreement_requirement) byVisit[key].required_requirements.push(row.agreement_requirement);
      });

      box.innerHTML = "";
      grouped.forEach(visit => {
        const row = document.createElement("div");
        row.className = "row";
        const requiredNames = visit.required_requirements.map(r => safe(r.agreement_name)).join(", ") || "Required agreement";
        row.innerHTML =
          "<div class='row-title'>" + safe(visit.visitor_name) + "</div>" +
          "<div class='row-meta'>Company: " + safe(visit.company) +
          "<br>Signed in: " + safe(visit.sign_in_time ? new Date(visit.sign_in_time).toLocaleString() : "-") +
          "<br>Required agreement(s): " + safe(requiredNames) +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";
        const sign = document.createElement("button");
        sign.type = "button";
        sign.textContent = "Review / Sign Agreement";
        sign.addEventListener("click", () => openAgreementSelectionModal(visit, false));
        actions.appendChild(sign);

        const additional = document.createElement("button");
        additional.type = "button";
        additional.className = "secondary";
        additional.textContent = "Sign Additional Agreement";
        additional.addEventListener("click", () => openAgreementSelectionModal(visit, true));
        actions.appendChild(additional);

        const link = document.createElement("button");
        link.type = "button";
        link.className = "secondary";
        link.textContent = "Link Active Visit";
        link.addEventListener("click", () => openAgreementLinkModal(visit));
        actions.appendChild(link);
        row.appendChild(actions);
        box.appendChild(row);
      });
    }

    function setAgreementSelectionModalMessage(text, type) {
      const box = $("agreementSelectionModalMessage"); if (!box) return;
      box.textContent = text || "";
      box.className = text ? "modal-message " + (type || "info") : "modal-message";
      if (text) showToast(type === "error" ? "Agreement selection failed" : "Agreement selection", text, type || "info");
    }

    function closeAgreementSelectionModal() {
      if ($("agreementSelectionModalBackdrop")) $("agreementSelectionModalBackdrop").classList.remove("active");
      currentAgreementSelectionVisit = null;
    }

    async function openAgreementSelectionModal(visit, additionalOnly) {
      currentAgreementSelectionVisit = visit;
      const visitId = visit.visit_log_id || visit.id;
      $("agreementSelectionVisitLogId").value = visitId;
      $("agreementSelectionModalTitle").textContent = additionalOnly ? "Sign Additional Agreement" : "Select Agreements to Sign";
      $("agreementSelectionVisitorMeta").innerHTML = "<strong>Visitor:</strong> " + safe(visit.visitor_name) + "<br><strong>Company:</strong> " + safe(visit.company) + "<br><strong>Signed in:</strong> " + safe(visit.sign_in_time ? new Date(visit.sign_in_time).toLocaleString() : "-");
      const list = $("agreementSelectionList");
      list.innerHTML = "Loading agreement types...";
      setAgreementSelectionModalMessage("", "");
      $("agreementSelectionModalBackdrop").classList.add("active");

      try {
        await loadAgreementTypes();
        const statuses = await getAgreementStatusesForVisit(visitId);
        const activeTypes = (agreementTypesCache || []).filter(t => t.is_active !== false);

        if (!activeTypes.length) {
          list.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No active agreement types found.</div>";
          return;
        }

        const statusMap = {};
        statuses.forEach(st => { statusMap[st.agreement_type_id] = st; });

        list.innerHTML = "";
        activeTypes.forEach(t => {
          const st = statusMap[t.agreement_type_id] || {
            agreement_type_id: t.agreement_type_id,
            agreement_name: t.agreement_name,
            agreement_title: t.agreement_title,
            default_required: t.default_required,
            can_select: false,
            selected_by_default: false,
            locked_selected: false,
            already_valid: false,
            reason: "status could not be calculated"
          };

          const isRequiredType = t.default_required === true;
          const alreadyValid = st.already_valid === true;
          const hasActiveVersion = !!st.active_agreement_version_id;
          const canSelect = st.can_select === true && hasActiveVersion && !alreadyValid;
          const selected = st.selected_by_default === true && !additionalOnly && canSelect;
          const locked = st.locked_selected === true && !additionalOnly && canSelect;
          const disabled = alreadyValid || !hasActiveVersion || !canSelect || locked;

          const row = document.createElement("div");
          row.className = "row";

          let stateBadge = "";
          if (alreadyValid) stateBadge = " <span class='status-badge agreement-status-valid'>Already valid</span>";
          else if (!hasActiveVersion) stateBadge = " <span class='status-badge agreement-status-disabled'>No active version</span>";
          else if (isRequiredType) stateBadge = " <span class='status-badge agreement-status-required'>Required</span>";
          else stateBadge = " <span class='status-badge agreement-status-disabled'>Optional</span>";

          row.innerHTML =
            "<label class='agreement-row-header' style='cursor:" + (disabled && !locked ? "not-allowed" : "pointer") + ";'>" +
            "<input class='agreement-type-select' type='checkbox' data-agreement-type-id='" + safe(t.agreement_type_id) + "' data-active-version-id='" + safe(st.active_agreement_version_id || "") + "' data-active-version-number='" + safe(st.active_agreement_version_number || "") + "' " +
            (selected ? "checked " : "") + (disabled ? "disabled " : "") + ">" +
            "<span class='row-title'>" + safe(t.agreement_name) + "</span>" + stateBadge +
            "</label>" +
            "<div class='row-meta'>Title: " + safe(t.agreement_title) +
            "<br>Status: " + safe(st.reason || (isRequiredType ? "Required agreement" : "Optional agreement")) +
            "<br>Active version: " + safe(st.active_agreement_version_number || "-") +
            (st.last_signed_at ? "<br>Last signed: " + safe(new Date(st.last_signed_at).toLocaleString()) : "") +
            "</div>";
          list.appendChild(row);
        });
      } catch (err) {
        list.innerHTML = "<div class='row-meta' style='padding:14px 0;'>Could not load agreement selection.</div>";
        setAgreementSelectionModalMessage(err.message, "error");
      }
    }

    async function startAgreementSelectionQueue() {
      const visit = currentAgreementSelectionVisit;
      if (!visit) { setAgreementSelectionModalMessage("No visit selected.", "error"); return; }
      const selectedBoxes = Array.from($("agreementSelectionList").querySelectorAll(".agreement-type-select:checked:not(:disabled)"));
      const lockedSelectedBoxes = Array.from($("agreementSelectionList").querySelectorAll(".agreement-type-select:checked:disabled"));
      const allSelectedBoxes = lockedSelectedBoxes.concat(selectedBoxes);

      if (!allSelectedBoxes.length) {
        setAgreementSelectionModalMessage("No agreements are available to sign. Already-valid agreements are disabled.", "error");
        return;
      }

      const visitId = visit.visit_log_id || visit.id;
      const statuses = await getAgreementStatusesForVisit(visitId);
      const statusMap = {};
      statuses.forEach(st => { statusMap[st.agreement_type_id] = st; });

      const queue = [];
      for (const cb of allSelectedBoxes) {
        const typeId = cb.dataset.agreementTypeId;
        const st = statusMap[typeId];
        const typeMeta = (agreementTypesCache || []).find(t => t.agreement_type_id === typeId) || {};

        if (!st) {
          setAgreementSelectionModalMessage("Agreement status could not be calculated for '" + safe(typeMeta.agreement_name || typeId) + "'.", "error");
          return;
        }
        if (st.already_valid === true) {
          setAgreementSelectionModalMessage("Agreement '" + safe(st.agreement_name) + "' is already valid and cannot be signed again.", "error");
          return;
        }
        if (!st.active_agreement_version_id) {
          setAgreementSelectionModalMessage("Agreement '" + safe(st.agreement_name) + "' has no active version.", "error");
          return;
        }
        if (st.can_select !== true) {
          setAgreementSelectionModalMessage("Agreement '" + safe(st.agreement_name) + "' is not available: " + safe(st.reason), "error");
          return;
        }

        queue.push({
          id: visitId,
          visit_log_id: visitId,
          visitor_name: visit.visitor_name,
          company: visit.company,
          sign_in_time: visit.sign_in_time,
          agreement_requirement: {
            agreement_type_id: typeId,
            agreement_name: st.agreement_name || typeMeta.agreement_name,
            agreement_title: st.agreement_title || typeMeta.agreement_title,
            active_agreement_version_id: st.active_agreement_version_id,
            active_agreement_version_number: st.active_agreement_version_number,
            signature_required: st.signature_required,
            reason: st.reason
          }
        });
      }

      closeAgreementSelectionModal();
      currentAgreementQueue = queue.slice(1);
      currentAgreementQueueScope = "agreements";
      await openAgreementSignModal(queue[0], queue[0].agreement_requirement);
    }

    function startSelectedAgreementQueue(box, rows) {
      showToast("Agreement selection", "Use Review / Sign Agreement on the visitor row to select required and optional agreements.", "info");
    }

    async function openNextQueuedAgreementIfAny() {
      if (!currentAgreementQueue || currentAgreementQueue.length === 0) {
        currentAgreementQueueScope = null;
        return;
      }
      const next = currentAgreementQueue.shift();
      await openAgreementSignModal(next, next.agreement_requirement);
    }

    async function openAgreementSignModal(visit, requirement) {
      currentAgreementVisit = visit;
      $("agreementSignVisitLogId").value = visit.id;
      $("agreementSignTypeId").value = requirement.agreement_type_id || "";
      $("agreementSignVersionId").value = requirement.active_agreement_version_id || "";
      $("agreementSignModalTitle").textContent = safe(requirement.agreement_name || "Agreement") + " - " + safe(visit.visitor_name);
      $("agreementSignVisitorMeta").innerHTML = "<strong>Visitor:</strong> " + safe(visit.visitor_name) + "<br><strong>Company:</strong> " + safe(visit.company) + "<br><strong>Agreement:</strong> " + safe(requirement.agreement_title || requirement.agreement_name) + "<br><strong>Version:</strong> " + safe(requirement.active_agreement_version_number || "-") + "<br><strong>Requirement:</strong> " + safe(requirement.reason || "-");
      $("agreementAcceptedCheck").checked = false;
      $("agreementAcceptedText").textContent = String(settingValue("agreement_acceptance_text", "I confirm that I have read, understood, and agree to follow the requirements of this agreement/induction."));
      setAgreementModalMessage("", ""); clearAgreementSignature(); clearInductorSignature();
      $("agreementSignatureBox").classList.toggle("hidden", requirement.signature_required === false);
      const isFinalAgreementInQueue = !currentAgreementQueue || currentAgreementQueue.length === 0;
      const inductorEnabled = shouldShowInductorSignoffForCurrentStep();
      const inductorMode = String(settingValue("inductor_signoff_mode", "typed_name"));
      syncInductorSignoffPanel(inductorEnabled, inductorMode);
      if ($("saveVisitorAgreementButton")) $("saveVisitorAgreementButton").textContent = isFinalAgreementInQueue ? "Save Agreement" : "Save & Continue";
      const version = await getAgreementVersion(requirement.active_agreement_version_id);
      $("agreementPdfFrame").src = version && version.pdf_url ? version.pdf_url : "about:blank";
      $("agreementSignModalBackdrop").classList.add("active");
      setTimeout(() => { resizeAgreementSignatureCanvas(); resizeInductorSignatureCanvas(); }, 60);
    }

    function closeAgreementSignModal() { $("agreementSignModalBackdrop").classList.remove("active"); currentAgreementVisit = null; }
    function setAgreementModalMessage(text, type) { const box = $("agreementSignModalMessage"); if (!box) return; box.textContent = text || ""; box.className = text ? "modal-message " + (type || "info") : "modal-message"; if (text) showToast(type === "error" ? "Agreement action failed" : "Agreement action", text, type || "info"); }

    async function getAgreementVersion(versionId) {
      if (!versionId) return null;
      const result = await supabaseClient.from("agreement_versions").select("id, version_number, pdf_url, file_name, is_active, agreement_type_id").eq("id", versionId).single();
      if (result.error) throw result.error; return result.data;
    }

    function shouldShowInductorSignoffForCurrentStep() {
      const inductorSettingEnabled = !!settingValue("inductor_signoff_enabled", false);
      const isFinalAgreementInQueue = !currentAgreementQueue || currentAgreementQueue.length === 0;
      return inductorSettingEnabled && isFinalAgreementInQueue;
    }

    function syncInductorSignoffPanel(inductorEnabled, inductorMode) {
      const box = $("inductorSignoffBox");
      const typedBox = $("inductorTypedNameBox");
      const signatureBox = $("inductorSignatureBox");
      if (box) box.classList.toggle("hidden", !inductorEnabled);
      if (typedBox) typedBox.classList.toggle("hidden", !inductorEnabled || inductorMode !== "typed_name");
      if (signatureBox) signatureBox.classList.toggle("hidden", !inductorEnabled || inductorMode !== "manual_signature");
      if (inductorEnabled && $("inductorName")) {
        $("inductorName").value = AppState.currentProfile && AppState.currentProfile.display_name ? AppState.currentProfile.display_name : "";
      }
      if (!inductorEnabled) {
        clearInductorSignature();
      }
    }

    function resizeAgreementSignatureCanvas() { resizeSignatureCanvas("agreementSignatureCanvas", signaturePadState); }
    function resizeInductorSignatureCanvas() { resizeSignatureCanvas("inductorSignatureCanvas", inductorSignaturePadState); }
    function resizeSignatureCanvas(canvasId, state) {
      const canvas = $(canvasId); if (!canvas) return; const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * ratio); canvas.height = Math.floor(rect.height * ratio); canvas.style.width = rect.width + "px"; canvas.style.height = rect.height + "px";
      const ctx = canvas.getContext("2d"); ctx.setTransform(1,0,0,1,0,0); ctx.lineWidth = 2.4 * ratio; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#172033"; state.pixelRatio = ratio; state.hasInk = false;
    }
    function clearAgreementSignature() { clearSignatureCanvas("agreementSignatureCanvas", signaturePadState); }
    function clearInductorSignature() { clearSignatureCanvas("inductorSignatureCanvas", inductorSignaturePadState); }
    function clearSignatureCanvas(canvasId, state) { const canvas = $(canvasId); if (!canvas) return; const ctx = canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height); state.hasInk = false; }
    function signaturePointFor(event, canvasId) { const canvas = $(canvasId); const rect = canvas.getBoundingClientRect(); const source = event.touches && event.touches.length ? event.touches[0] : event; return { x:(source.clientX - rect.left) * (canvas.width / rect.width), y:(source.clientY - rect.top) * (canvas.height / rect.height) }; }
    function beginAgreementSignature(event) { beginSignature(event, "agreementSignatureCanvas", signaturePadState); }
    function drawAgreementSignature(event) { drawSignature(event, "agreementSignatureCanvas", signaturePadState); }
    function endAgreementSignature() { signaturePadState.isDrawing = false; }
    function beginInductorSignature(event) { beginSignature(event, "inductorSignatureCanvas", inductorSignaturePadState); }
    function drawInductorSignature(event) { drawSignature(event, "inductorSignatureCanvas", inductorSignaturePadState); }
    function endInductorSignature() { inductorSignaturePadState.isDrawing = false; }
    function beginSignature(event, canvasId, state) { if (event.cancelable) event.preventDefault(); const pt = signaturePointFor(event, canvasId); state.isDrawing = true; state.lastX = pt.x; state.lastY = pt.y; state.hasInk = true; }
    function drawSignature(event, canvasId, state) { if (!state.isDrawing) return; if (event.cancelable) event.preventDefault(); const pt = signaturePointFor(event, canvasId); const canvas = $(canvasId); const ctx = canvas.getContext("2d"); ctx.beginPath(); ctx.moveTo(state.lastX, state.lastY); ctx.lineTo(pt.x, pt.y); ctx.stroke(); state.lastX = pt.x; state.lastY = pt.y; state.hasInk = true; }

    async function saveVisitorAgreementFromModal() {
      const visitLogId = $("agreementSignVisitLogId").value; const agreementTypeId = $("agreementSignTypeId").value;
      if (!visitLogId || !agreementTypeId) { setAgreementModalMessage("No visit/agreement type selected.", "error"); return; }
      if (!$("agreementAcceptedCheck").checked) { setAgreementModalMessage("Visitor acceptance tick is required.", "error"); return; }
      const signatureRequired = !$("agreementSignatureBox").classList.contains("hidden");
      const visitorSignature = signatureRequired && signaturePadState.hasInk ? $("agreementSignatureCanvas").toDataURL("image/png") : null;
      if (signatureRequired && !visitorSignature) { setAgreementModalMessage("Visitor signature is required.", "error"); return; }
      const inductorMode = String(settingValue("inductor_signoff_mode", "typed_name"));
      const inductorEnabled = shouldShowInductorSignoffForCurrentStep();
      syncInductorSignoffPanel(inductorEnabled, inductorMode);
      const inductorName = inductorEnabled ? ($("inductorName") ? $("inductorName").value.trim() : "") : null;
      const inductorSignature = inductorEnabled && inductorMode === "manual_signature" && inductorSignaturePadState.hasInk ? $("inductorSignatureCanvas").toDataURL("image/png") : null;
      if (inductorEnabled && inductorMode === "typed_name" && !inductorName) { setAgreementModalMessage("Inductor name is required.", "error"); return; }
      if (inductorEnabled && inductorMode === "manual_signature" && !inductorSignature) { setAgreementModalMessage("Inductor signature is required.", "error"); return; }
      setAgreementModalMessage("Saving agreement evidence...", "info");
      const result = await supabaseClient.rpc("save_visitor_agreement", { p_visit_log_id:visitLogId, p_agreement_type_id:agreementTypeId, p_signature_data:visitorSignature, p_accepted_without_signature:!signatureRequired, p_inductor_name:inductorName, p_inductor_signature_data:inductorSignature });
      if (result.error) { setAgreementModalMessage("Could not save agreement: " + result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { setAgreementModalMessage(response && response.message ? response.message : "Agreement save failed.", "error"); return; }
      if (inductorEnabled) {
        const applyResult = await supabaseClient.rpc("apply_inductor_signoff_to_visit_agreements", {
          p_visit_log_id: visitLogId,
          p_inductor_name: inductorName,
          p_inductor_signature_data: inductorSignature
        });
        if (applyResult.error) { setAgreementModalMessage("Agreement saved, but inductor sign-off could not be applied to all selected agreements: " + applyResult.error.message, "error"); return; }
      }
      showToast("Agreement saved", response.message || "Agreement saved successfully.", "success");
      closeAgreementSignModal();
      await loadPendingAgreements("security");
      await loadPendingAgreements("super");
      if (currentAgreementQueue && currentAgreementQueue.length) {
        showToast("Next agreement", "Opening the next selected agreement.", "info");
        await openNextQueuedAgreementIfAny();
      }
    }

    async function loadAgreementVersions() {
      await loadAgreementTypes();
      const result = await supabaseClient.rpc("list_agreement_versions");
      if (result.error) { setLocalStatus("agreementVersionsListStatus", result.error.message, "error"); showToast("Agreement versions failed", result.error.message, "error"); return; }
      agreementVersionsCache = result.data || []; renderAgreementVersions(); loadAgreementVersionOptions(); setLocalStatus("agreementVersionsListStatus", agreementVersionsCache.length + " version(s) loaded.", "success");
    }

    function renderAgreementVersions() {
      const box = $("agreementVersionsList");
      if (!box) return;
      if (!agreementVersionsCache.length) {
        box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No agreement versions found.</div>";
        return;
      }
      box.innerHTML = "";
      agreementVersionsCache.forEach(version => {
        const typeMeta = (agreementTypesCache || []).find(t => t.agreement_type_id === version.agreement_type_id) || {};
        const row = document.createElement("div");
        row.className = "row";
        const activeBadge = version.is_active ? " <span class='status-badge status-in'>Active</span>" : " <span class='status-badge status-pending'>Inactive</span>";
        row.innerHTML =
          "<div class='row-title'>" + safe(version.agreement_name) + " — v" + safe(version.version_number) + activeBadge + "</div>" +
          "<div class='row-meta'>" +
          "Title: " + safe(version.agreement_title) +
          "<br>Required by default: " + (typeMeta.default_required ? "Yes" : "No") +
          "<br>Agreement type active: " + (typeMeta.is_active === false ? "No" : "Yes") +
          "<br>PDF: " + safe(version.pdf_url) +
          "<br>File: " + safe(version.file_name) +
          "<br>Uploaded: " + safe(version.uploaded_at ? new Date(version.uploaded_at).toLocaleString() : "-") +
          "<br>Notes: " + safe(version.notes) +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";
        if (!version.is_active) {
          const activate = document.createElement("button");
          activate.type = "button";
          activate.className = "secondary";
          activate.textContent = "Activate";
          activate.addEventListener("click", () => activateAgreementVersion(version.agreement_version_id));
          actions.appendChild(activate);

          const del = document.createElement("button");
          del.type = "button";
          del.className = "danger";
          del.textContent = "Delete";
          del.addEventListener("click", () => deleteAgreementVersion(version.agreement_version_id, version.version_number));
          actions.appendChild(del);
        } else {
          const active = document.createElement("span");
          active.className = "status-badge status-in";
          active.textContent = "Active version";
          actions.appendChild(active);
        }

        if (typeMeta && typeMeta.agreement_type_id) {
          const typeToggle = document.createElement("button");
          typeToggle.type = "button";
          typeToggle.className = typeMeta.is_active === false ? "secondary" : "danger";
          typeToggle.textContent = typeMeta.is_active === false ? "Reactivate Agreement Type" : "Deactivate Agreement Type";
          typeToggle.addEventListener("click", () => setAgreementTypeActive(typeMeta, typeMeta.is_active === false));
          actions.appendChild(typeToggle);
        }

        row.appendChild(actions);
        box.appendChild(row);
      });
    }

    function loadAgreementVersionOptions() {
      const versionSelects = ["agreementSearchVersion", "securityAgreementSearchVersion"];
      versionSelects.forEach(id => {
        const sel = $(id); if (!sel) return; const current = sel.value;
        sel.innerHTML = "<option value=''>All versions</option>" + agreementVersionsCache.map(v => "<option value='" + safe(v.agreement_version_id) + "'>" + safe(v.agreement_name) + " v" + safe(v.version_number) + "</option>").join(""); if (current) sel.value = current;
      });
    }

    async function createAgreementVersionFromForm() {
      if (!$("agreementVersionType").value) { setLocalStatus("agreementVersionStatus", "Agreement type is required.", "error"); showToast("Agreement version failed", "Agreement type is required.", "error"); return; }
      setLocalStatus("agreementVersionStatus", "Creating agreement version...", "info");
      const result = await supabaseClient.rpc("create_agreement_version", { p_version_number:$("agreementVersionNumber").value.trim(), p_pdf_url:$("agreementPdfUrl").value.trim(), p_file_name:$("agreementFileName").value.trim() || null, p_notes:$("agreementVersionNotes").value.trim() || null, p_activate_now:$("agreementActivateNow").value === "true", p_agreement_type_id:$("agreementVersionType").value });
      if (result.error) { setLocalStatus("agreementVersionStatus", result.error.message, "error"); showToast("Agreement version failed", result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (response && response.duplicate_found) { pendingAgreementVersionOverrideId = response.agreement_version_id; const proceed = await openAgreementConfirmModal({ title:"Agreement version already exists", body:"<p>This agreement type already has version <strong>" + safe($("agreementVersionNumber").value) + "</strong>.</p><p>Do you want to update the existing version with the PDF/details entered here?</p>", confirmText:"Update Existing" }); if (proceed) await updateExistingAgreementVersionFromForm(); return; }
      if (!response || response.success !== true) { const msg = response && response.message ? response.message : "Could not create agreement version."; setLocalStatus("agreementVersionStatus", msg, "error"); showToast("Agreement version failed", msg, "error"); return; }
      setLocalStatus("agreementVersionStatus", response.message, "success"); showToast("Agreement version saved", response.message, "success"); await loadAgreementVersions();
    }

    async function updateExistingAgreementVersionFromForm() {
      const versionId = pendingAgreementVersionOverrideId; if (!versionId) return;
      const result = await supabaseClient.rpc("update_agreement_version", { p_agreement_version_id:versionId, p_version_number:$("agreementVersionNumber").value.trim(), p_pdf_url:$("agreementPdfUrl").value.trim(), p_file_name:$("agreementFileName").value.trim() || null, p_notes:$("agreementVersionNotes").value.trim() || null, p_activate_now:$("agreementActivateNow").value === "true" });
      if (result.error) { setLocalStatus("agreementVersionStatus", result.error.message, "error"); showToast("Agreement version failed", result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { const msg = response && response.message ? response.message : "Could not update agreement version."; setLocalStatus("agreementVersionStatus", msg, "error"); showToast("Agreement version failed", msg, "error"); return; }
      pendingAgreementVersionOverrideId = null; setLocalStatus("agreementVersionStatus", response.message, "success"); showToast("Agreement version updated", response.message, "success"); await loadAgreementVersions();
    }

    async function activateAgreementVersion(versionId) {
      const proceed = await openAgreementConfirmModal({ title:"Activate agreement version", body:"<p>Activate this version for its agreement type?</p>", confirmText:"Activate" }); if (!proceed) return;
      const result = await supabaseClient.rpc("activate_agreement_version", { p_agreement_version_id:versionId });
      if (result.error) { setLocalStatus("agreementVersionsListStatus", result.error.message, "error"); showToast("Activate failed", result.error.message, "error"); return; }
      showToast("Agreement version activated", "Agreement version activated.", "success"); await loadAgreementVersions();
    }

    async function deleteAgreementVersion(versionId, versionNumber) {
      const proceed = await openAgreementConfirmModal({ title:"Delete agreement version", body:"<p>Delete version <strong>" + safe(versionNumber) + "</strong>?</p><p>Only inactive, unused versions can be deleted.</p>", confirmText:"Delete" }); if (!proceed) return;
      const result = await supabaseClient.rpc("delete_agreement_version", { p_agreement_version_id:versionId });
      if (result.error) { setLocalStatus("agreementVersionsListStatus", result.error.message, "error"); showToast("Delete failed", result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { const msg = response && response.message ? response.message : "Could not delete agreement version."; setLocalStatus("agreementVersionsListStatus", msg, "error"); showToast("Delete failed", msg, "error"); return; }
      setLocalStatus("agreementVersionsListStatus", response.message, "success"); showToast("Agreement version deleted", response.message, "success"); await loadAgreementVersions();
    }

    function closeAgreementLinkModal() { $("agreementLinkModalBackdrop").classList.remove("active"); currentAgreementLinkVisit = null; }
    function setAgreementLinkModalMessage(text, type) { const box = $("agreementLinkModalMessage"); if (!box) return; box.textContent = text || ""; box.className = text ? "modal-message " + (type || "info") : "modal-message"; if (text) showToast(type === "error" ? "Agreement link failed" : "Agreement link", text, type || "info"); }
    function openAgreementLinkModal(visit) {
      currentAgreementLinkVisit = visit;
      $("agreementLinkVisitLogId").value = visit.id || visit.visit_log_id;
      $("agreementLinkSelectedAgreementId").value = "";
      $("agreementLinkVisitMeta").innerHTML = "<strong>Current record:</strong> " + safe(visit.visitor_name) + "<br><strong>Company:</strong> " + safe(visit.company) + "<br><strong>Signed in / signed:</strong> " + safe(visit.sign_in_time ? new Date(visit.sign_in_time).toLocaleString() : (visit.signed_at ? new Date(visit.signed_at).toLocaleString() : "-"));
      $("agreementLinkSearchText").value = (visit.visitor_name || "") + (visit.company ? " " + visit.company : "");
      $("agreementLinkReason").value = "Visitor identity correction/consolidation. Linked to previous agreement record and corrected visitor details.";
      $("agreementPreviousResults").innerHTML = "No search yet.";
      const isSignedOutRecord = !!(visit.sign_out_time || (visit.visit_status && String(visit.visit_status).toLowerCase() === "signed_out"));
      if ($("confirmAgreementLinkButton")) {
        $("confirmAgreementLinkButton").textContent = isSignedOutRecord ? "Link Active Visit Only" : "Link Active Visit";
        $("confirmAgreementLinkButton").disabled = isSignedOutRecord;
        $("confirmAgreementLinkButton").title = isSignedOutRecord ? "Use SuperUser consolidation for signed-out/history records." : "Correct this active visit only.";
      }
      if ($("confirmAgreementConsolidateButton")) {
        $("confirmAgreementConsolidateButton").classList.toggle("hidden", !(AppState.currentProfile && AppState.currentProfile.role === "super_user"));
        $("confirmAgreementConsolidateButton").textContent = "Consolidate Historical Identity";
      }
      setAgreementLinkModalMessage(isSignedOutRecord ? "This is a signed-out/history record. Use SuperUser consolidation rather than Link Active Visit." : "", isSignedOutRecord ? "info" : "");
      $("agreementLinkModalBackdrop").classList.add("active");
      searchPreviousAgreementsForCurrentVisit();
    }
    async function searchPreviousAgreementsForCurrentVisit() { const visitLogId = $("agreementLinkVisitLogId").value; if (!visitLogId) { setAgreementLinkModalMessage("No current visit selected.", "error"); return; } setAgreementLinkModalMessage("Searching previous agreements...", "info"); const result = await supabaseClient.rpc("search_previous_agreements_for_visit", { p_visit_log_id:visitLogId, p_search_text:$("agreementLinkSearchText").value.trim() || null }); if (result.error) { setAgreementLinkModalMessage("Could not search previous agreements: " + result.error.message, "error"); return; } agreementPreviousMatchesCache = result.data || []; renderPreviousAgreementMatches(); setAgreementLinkModalMessage(agreementPreviousMatchesCache.length + " possible previous agreement(s) found.", agreementPreviousMatchesCache.length ? "success" : "error"); }
    function renderPreviousAgreementMatches() {
      const box = $("agreementPreviousResults");
      if (!box) return;
      if (!agreementPreviousMatchesCache.length) {
        box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No previous agreements found. Try a different spelling, company name, or agreement title.</div>";
        return;
      }
      box.innerHTML = "";
      agreementPreviousMatchesCache.forEach(agreement => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<div class='row-title'>" + safe(agreement.visitor_name) + "</div>" +
          "<div class='row-meta'>" +
          "Company: " + safe(agreement.company) + "<br>" +
          "Agreement type: " + safe(agreement.agreement_name || agreement.agreement_type_name || "-") + "<br>" +
          "Agreement title: " + safe(agreement.agreement_title || "-") + "<br>" +
          "Version: " + safe(agreement.agreement_version_number || agreement.version_number) + "<br>" +
          "Signed: " + safe(agreement.signed_at ? new Date(agreement.signed_at).toLocaleString() : "-") +
          "</div>";
        const actions = document.createElement("div");
        actions.className = "button-row";
        const select = document.createElement("button");
        select.type = "button";
        select.className = "secondary";
        select.textContent = "Select This Agreement";
        select.addEventListener("click", () => {
          $("agreementLinkSelectedAgreementId").value = agreement.agreement_id;
          setAgreementLinkModalMessage("Selected previous agreement for " + safe(agreement.visitor_name) + ". Confirm link or SuperUser consolidation.", "success");
        });
        actions.appendChild(select);
        row.appendChild(actions);
        box.appendChild(row);
      });
    }
    async function confirmAgreementLink() { const visitLogId = $("agreementLinkVisitLogId").value; const agreementId = $("agreementLinkSelectedAgreementId").value; const reason = $("agreementLinkReason").value.trim(); if (!visitLogId || !agreementId) { setAgreementLinkModalMessage("Select a previous agreement first.", "error"); return; } if (!reason) { setAgreementLinkModalMessage("Correction reason is required.", "error"); return; } const selected = agreementPreviousMatchesCache.find(a => a.agreement_id === agreementId); const proceed = await openAgreementConfirmModal({ title:"Link active visit", body:"<p>Link this signed-in visit to the previous agreement for <strong>" + safe(selected && selected.visitor_name) + "</strong>?</p><p>The current visit name/company will be corrected to match the selected agreement record.</p>", confirmText:"Link Active Visit" }); if (!proceed) return; setAgreementLinkModalMessage("Linking previous agreement...", "info"); const result = await supabaseClient.rpc("link_visit_to_previous_agreement", { p_visit_log_id:visitLogId, p_agreement_id:agreementId, p_change_reason:reason }); if (result.error) { setAgreementLinkModalMessage("Could not link agreement: " + result.error.message, "error"); return; } const response = Array.isArray(result.data) ? result.data[0] : result.data; if (!response || response.success !== true) { setAgreementLinkModalMessage(response && response.message ? response.message : "Agreement link failed.", "error"); return; } showToast("Active visit linked", response.message || "Visitor details corrected.", "success"); closeAgreementLinkModal(); await loadPendingAgreements("security"); await loadPendingAgreements("super"); await refreshAgreementComplianceViewsAfterIdentityChange(); }

    async function refreshAgreementComplianceViewsAfterIdentityChange() {
      const tasks = [];
      if (typeof loadMissingRequiredAgreements === "function") tasks.push(loadMissingRequiredAgreements());
      if (typeof loadAgreementComplianceMatrix === "function") tasks.push(loadAgreementComplianceMatrix());
      if (typeof loadOutstandingInductions === "function") tasks.push(loadOutstandingInductions());
      if (typeof loadAgreementComplianceSummary === "function") tasks.push(loadAgreementComplianceSummary());
      if (typeof loadAgreementEvidenceAudit === "function") tasks.push(loadAgreementEvidenceAudit());
      await Promise.allSettled(tasks);
    }

    async function confirmAgreementConsolidation() {
      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
        setAgreementLinkModalMessage("Only SuperUsers can consolidate agreement identities.", "error");
        return;
      }
      const visitLogId = $("agreementLinkVisitLogId").value;
      const agreementId = $("agreementLinkSelectedAgreementId").value;
      const reason = $("agreementLinkReason").value.trim();
      if (!visitLogId || !agreementId) { setAgreementLinkModalMessage("Select a previous agreement first.", "error"); return; }
      if (!reason) { setAgreementLinkModalMessage("Consolidation reason is required.", "error"); return; }
      const selected = agreementPreviousMatchesCache.find(a => a.agreement_id === agreementId);
      const proceed = await openAgreementConfirmModal({
        title:"Consolidate agreement identity",
        body:"<p>Consolidate this visit/agreement identity to <strong>" + safe(selected && selected.visitor_name) + "</strong>?</p><p>This is a SuperUser audit correction. Newer or higher agreement versions are protected and will not be downgraded.</p>",
        confirmText:"Consolidate Identity"
      });
      if (!proceed) return;
      setAgreementLinkModalMessage("Consolidating agreement identity...", "info");
      const result = await supabaseClient.rpc("superuser_consolidate_agreement_identity", { p_source_visit_log_id:visitLogId, p_target_agreement_id:agreementId, p_change_reason:reason });
      if (result.error) { setAgreementLinkModalMessage("Could not consolidate identity: " + result.error.message, "error"); return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { setAgreementLinkModalMessage(response && response.message ? response.message : "Agreement identity consolidation failed.", "error"); return; }
      showToast("Identity consolidated", response.message || "Agreement identity consolidated. Compliance status has been recalculated. Newer/higher versions were protected.", "success");
      closeAgreementLinkModal();
      await loadPendingAgreements("security");
      await loadPendingAgreements("super");
      if (typeof loadAgreementSearch === "function") await loadAgreementSearch();
      await refreshAgreementComplianceViewsAfterIdentityChange();
    }

    async function loadSecurityAgreementSearch() { await loadAgreementVersions(); setLocalStatus("securityAgreementSearchStatus", "Searching agreements...", "info"); const result = await supabaseClient.rpc("search_visitor_agreements", { p_date_from:$("securityAgreementSearchFromDate").value || null, p_date_to:$("securityAgreementSearchToDate").value || null, p_visitor_name:$("securityAgreementSearchVisitorName").value.trim() || null, p_company:$("securityAgreementSearchCompany").value.trim() || null, p_agreement_version_id:$("securityAgreementSearchVersion").value || null, p_agreement_type_id:$("securityAgreementSearchType") ? ($("securityAgreementSearchType").value || null) : null }); if (result.error) { setLocalStatus("securityAgreementSearchStatus", result.error.message, "error"); showToast("Agreement search failed", result.error.message, "error"); return; } securityAgreementSearchCache = result.data || []; renderAgreementSearchResultsToBox("securityAgreementSearchResults", securityAgreementSearchCache); setLocalStatus("securityAgreementSearchStatus", securityAgreementSearchCache.length + " agreement record(s) found.", "success"); }
    async function loadAgreementSearch() { setLocalStatus("agreementSearchStatus", "Searching agreements...", "info"); const result = await supabaseClient.rpc("search_visitor_agreements", { p_date_from:$("agreementSearchFromDate").value || null, p_date_to:$("agreementSearchToDate").value || null, p_visitor_name:$("agreementSearchVisitorName").value.trim() || null, p_company:$("agreementSearchCompany").value.trim() || null, p_agreement_version_id:$("agreementSearchVersion").value || null, p_agreement_type_id:$("agreementSearchType") ? ($("agreementSearchType").value || null) : null }); if (result.error) { setLocalStatus("agreementSearchStatus", result.error.message, "error"); showToast("Agreement search failed", result.error.message, "error"); return; } agreementSearchCache = result.data || []; renderAgreementSearchResults(); setLocalStatus("agreementSearchStatus", agreementSearchCache.length + " agreement record(s) found.", "success"); }
    function renderAgreementSearchResults() { renderAgreementSearchResultsToBox("agreementSearchResults", agreementSearchCache); }
    function renderAgreementSearchResultsToBox(boxId, rows) { const box = $(boxId); if (!box) return; if (!rows || !rows.length) { box.innerHTML = buildResultSummary(0, "Agreements", "No matching records") + "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No agreements found.</div></div>"; return; } const temp = document.createElement("div"); rows.forEach(agreement => { const row = document.createElement("div"); row.className = "row"; row.innerHTML = "<div class='row-title'>" + safe(agreement.visitor_name) + "</div><div class='row-meta'>Company: " + safe(agreement.company) + "<br>Agreement: " + safe(agreement.agreement_name) + "<br>Title: " + safe(agreement.agreement_title) + "<br>Version: " + safe(agreement.agreement_version_number) + "<br>Signed: " + safe(agreement.signed_at ? new Date(agreement.signed_at).toLocaleString() : "-") + "<br>Signed by: " + safe(agreement.signed_by_name) + "<br>Evidence: " + (agreement.has_signature ? "Visitor signature" : (agreement.accepted_without_signature ? "Tick acceptance" : "Unknown")) + "<br>Inductor: " + (agreement.inductor_signoff_required ? safe(agreement.inductor_name || (agreement.inductor_signature_data ? "Signature captured" : "-")) : "Not required") + "</div>"; const actions = document.createElement("div"); actions.className = "button-row"; const view = document.createElement("button"); view.type = "button"; view.className = "secondary"; view.textContent = "View / Print Evidence"; view.addEventListener("click", () => openAgreementEvidenceModal(agreement)); actions.appendChild(view); const extra = document.createElement("button"); extra.type = "button"; extra.className = "secondary"; extra.textContent = "Sign Additional Agreement"; extra.addEventListener("click", () => openAgreementSelectionModal({ id:agreement.visit_log_id, visit_log_id:agreement.visit_log_id, visitor_name:agreement.visitor_name, company:agreement.company, sign_in_time:agreement.signed_at }, true)); actions.appendChild(extra); if (AppState.currentProfile && AppState.currentProfile.role === "super_user") { const relink = document.createElement("button"); relink.type = "button"; relink.className = "secondary"; relink.textContent = "Relink / Consolidate"; relink.addEventListener("click", () => openAgreementLinkModal({ id:agreement.visit_log_id, visit_log_id:agreement.visit_log_id, visitor_name:agreement.visitor_name, company:agreement.company, sign_in_time:agreement.signed_at, signed_at:agreement.signed_at })); actions.appendChild(relink); } row.appendChild(actions); temp.appendChild(row); }); setResultBox(box, buildResultSummary(rows.length, "Agreements", "Filtered result"), temp); }

    function agreementExportRows(rows) { return (rows || []).map(row => ({ "Signed At": row.signed_at ? new Date(row.signed_at).toLocaleString() : "", "Visitor": row.visitor_name || "", "Company": row.company || "", "Agreement Type": row.agreement_name || "", "Agreement Title": row.agreement_title || "", "Version": row.agreement_version_number || "", "Signed By": row.signed_by_name || "", "Evidence": row.has_signature ? "Signature" : (row.accepted_without_signature ? "Tick acceptance" : "Unknown"), "Inductor": row.inductor_signoff_required ? (row.inductor_name || (row.inductor_signature_data ? "Signature captured" : "")) : "Not required", "Visit Log ID": row.visit_log_id || "", "Agreement ID": row.agreement_id || "" })); }

    function evidenceHtml(record) {
      const logoUrl = appSettings.logoUrl || "";
      const showLogo = !!settingValue("agreement_print_show_logo", true) && logoUrl;
      const header = safe(settingValue("agreement_print_header", "Visitor Agreement / Induction Evidence"));
      const companyName = safe(settingValue("agreement_print_company_name", appSettings.companyName || "Visitor Management"));
      return "<div class='agreement-evidence-print'>" +
        "<div class='agreement-evidence-header'><div><h1 style='margin:0;'>" + header + "</h1><div style='font-weight:900;margin-top:6px;'>" + companyName + "</div></div>" + (showLogo ? "<img class='agreement-evidence-logo' src='" + safe(logoUrl) + "' alt='Logo'>" : "") + "</div>" +
        "<h2>" + safe(record.agreement_title || record.agreement_name) + "</h2>" +
        "<div class='grid-2 agreement-evidence-grid'><div><strong>Visitor</strong><br>" + safe(record.visitor_name) + "</div><div><strong>Company</strong><br>" + safe(record.company) + "</div><div><strong>Agreement type</strong><br>" + safe(record.agreement_name) + "</div><div><strong>Version</strong><br>" + safe(record.agreement_version_number) + "</div><div><strong>Signed at</strong><br>" + safe(record.signed_at ? new Date(record.signed_at).toLocaleString() : "-") + "</div><div><strong>Recorded by</strong><br>" + safe(record.signed_by_name) + "</div></div>" +
        "<div class='signature-preview-box'><strong>Visitor acceptance</strong><br><div style='margin-top:6px;'>" + safe(record.visitor_acceptance_text || settingValue("agreement_acceptance_text", "Visitor accepted the agreement.")) + "</div>" + (record.signature_data ? "<img class='signature-image' src='" + record.signature_data + "' alt='Visitor signature'>" : "<div style='margin-top:6px;'>Tick acceptance recorded.</div>") + "</div>" +
        (record.inductor_signoff_required ? "<div class='signature-preview-box'><strong>Inductor sign-off</strong><br>Mode: " + safe(record.inductor_signoff_mode) + "<br>Inductor: " + safe(record.inductor_name) + "<br>Signed at: " + safe(record.inductor_signed_at ? new Date(record.inductor_signed_at).toLocaleString() : "-") + (record.inductor_signature_data ? "<br><img class='signature-image' src='" + record.inductor_signature_data + "' alt='Inductor signature'>" : "") + "</div>" : "") +
        "<div class='agreement-evidence-footer'><strong>Agreement Reference</strong><br>" + safe(record.agreement_id) + "<br><strong>Visit Reference</strong><br>" + safe(record.visit_log_id) + "</div>" +
      "</div>";
    }
    function openAgreementEvidenceModal(record) { currentEvidenceRecord = record; $("agreementEvidenceContent").innerHTML = evidenceHtml(record); $("agreementEvidenceModalBackdrop").classList.add("active"); }
    function closeAgreementEvidenceModal() { $("agreementEvidenceModalBackdrop").classList.remove("active"); currentEvidenceRecord = null; }
    function printAgreementEvidence() {
      if (!currentEvidenceRecord) return;
      const win = window.open("", "_blank");
      if (!win) { showToast("Print blocked", "Browser blocked the print window.", "error"); return; }
      win.document.write("<!doctype html><html><head><title>Agreement Evidence</title><style>" +
        "@page{size:A4 portrait;margin:10mm;}*{box-sizing:border-box;}body{font-family:Arial,sans-serif;color:#111827;margin:0;font-size:11px;line-height:1.25}.agreement-evidence-print{width:100%;}.agreement-evidence-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:8px;margin-bottom:10px}.agreement-evidence-header h1{font-size:18px;line-height:1.1}.agreement-evidence-logo{max-width:95px;max-height:52px;object-fit:contain}.agreement-evidence-print h2{font-size:15px;margin:8px 0}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.signature-preview-box{border:1px solid #cbd5e1;border-radius:8px;padding:8px;margin-top:8px;page-break-inside:avoid}.signature-image{max-width:100%;max-height:105px;border:1px solid #cbd5e1;border-radius:6px;padding:4px;margin-top:5px}.row-meta{color:#475467;font-size:9px}.agreement-evidence-footer{margin-top:8px;padding-top:6px;border-top:1px solid #cbd5e1;color:#64748b;font-size:8px;word-break:break-all;line-height:1.25}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}" +
        "</style></head><body>" + evidenceHtml(currentEvidenceRecord) + "</body></html>");
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 250);
    }



    function complianceStatCard(label, value) {
      return "<div class='stat-card'><div class='stat-value'>" + safe(value) + "</div><div class='stat-label'>" + safe(label) + "</div></div>";
    }

    async function loadAgreementComplianceSummary() {
      const box = $("agreementComplianceSummary");
      if (!box) return;
      setLocalStatus("agreementComplianceStatus", "Loading compliance summary...", "info");
      const result = await supabaseClient.rpc("get_agreement_compliance_summary");
      if (result.error) {
        setLocalStatus("agreementComplianceStatus", "Could not load compliance summary: " + result.error.message, "error");
        showToast("Compliance", "Could not load compliance summary: " + result.error.message, "error");
        return;
      }
      const row = (result.data || [])[0] || {};
      box.innerHTML =
        complianceStatCard("Currently Signed In", row.currently_signed_in || 0) +
        complianceStatCard("Missing Required", row.visitors_missing_required || 0) +
        complianceStatCard("Fully Compliant", row.fully_compliant_visitors || 0) +
        complianceStatCard("Signed Today", row.agreements_signed_today || 0) +
        complianceStatCard("Signed This Week", row.agreements_signed_this_week || 0) +
        complianceStatCard("Signed This Month", row.agreements_signed_this_month || 0) +
        complianceStatCard("Active Types", row.active_agreement_types || 0) +
        complianceStatCard("Active Versions", row.active_agreement_versions || 0);
      setLocalStatus("agreementComplianceStatus", "Compliance summary loaded.", "success");
      showToast("Compliance", "Compliance summary loaded.", "success");
    }

    async function loadMissingRequiredAgreements() {
      const box = $("missingAgreementResults");
      if (!box) return;
      box.innerHTML = "Loading missing agreements...";
      setLocalStatus("missingAgreementStatus", "Loading missing agreements...", "info");
      const result = await supabaseClient.rpc("get_missing_required_agreements", {
        p_date_from: $("missingAgreementFromDate").value || null,
        p_date_to: $("missingAgreementToDate").value || null,
        p_visitor_name: $("missingAgreementVisitor").value.trim() || null,
        p_company: $("missingAgreementCompany").value.trim() || null,
        p_agreement_type_id: $("missingAgreementType").value || null,
        p_currently_signed_in_only: $("missingAgreementCurrentOnly").value === "true"
      });
      if (result.error) {
        box.innerHTML = "Could not load missing agreements.";
        setLocalStatus("missingAgreementStatus", result.error.message, "error");
        showToast("Missing agreements", result.error.message, "error");
        return;
      }
      agreementComplianceMissingCache = result.data || [];
      renderMissingRequiredAgreements();
      setLocalStatus("missingAgreementStatus", agreementComplianceMissingCache.length + " missing item(s) loaded.", "success");
      showToast("Missing agreements", agreementComplianceMissingCache.length + " missing item(s) loaded.", "success");
    }

    function renderMissingRequiredAgreements() {
      const box = $("missingAgreementResults");
      if (!box) return;
      if (!agreementComplianceMissingCache.length) {
        box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No missing required agreements found.</div>";
        return;
      }
      const temp = document.createElement("div");
      agreementComplianceMissingCache.forEach(row => {
        const div = document.createElement("div");
        div.className = "row";
        const missingLabel = row.status === "outdated" || row.status === "outdated_required" ? "Outdated" : "Missing";
        div.innerHTML = "<div class='row-title'>" + safe(row.visitor_name) + "</div>" +
          "<div class='row-meta'>Company: " + safe(row.company) + "<br>Signed in: " + safe(row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "-") + "<br>Agreement: <strong>" + safe(row.agreement_name) + "</strong><br>Status: <strong>" + safe(missingLabel) + "</strong>" + (row.reason_text ? "<br>Reason: " + safe(row.reason_text) : "") + "</div>";
        const actions = document.createElement("div");
        actions.className = "button-row";
        const signBtn = document.createElement("button");
        signBtn.type = "button";
        signBtn.textContent = "Sign Agreement";
        signBtn.addEventListener("click", () => openAgreementSelectionModal(row, "additional"));
        actions.appendChild(signBtn);

        const linkBtn = document.createElement("button");
        linkBtn.type = "button";
        linkBtn.className = "secondary";
        linkBtn.textContent = AppState.currentProfile && AppState.currentProfile.role === "super_user" ? "Consolidate Historical Identity" : "Link Active Visit";
        linkBtn.addEventListener("click", () => openAgreementLinkModal({
          id: row.visit_log_id,
          visit_log_id: row.visit_log_id,
          visitor_name: row.visitor_name,
          company: row.company,
          sign_in_time: row.sign_in_time,
          sign_out_time: row.sign_out_time,
          visit_status: row.sign_out_time ? "signed_out" : "signed_in"
        }));
        actions.appendChild(linkBtn);

        div.appendChild(actions);
        temp.appendChild(div);
      });
      setResultBox(box, buildResultSummary(agreementComplianceMissingCache.length, "Missing required agreements", "Filtered result"), temp);
    }

    async function loadAgreementComplianceMatrix() {
      const box = $("agreementMatrixResults");
      if (!box) return;
      box.innerHTML = "Loading identity compliance matrix...";
      setLocalStatus("agreementMatrixStatus", "Loading identity matrix...", "info");
      const result = await supabaseClient.rpc("get_agreement_compliance_matrix_identity", {
        p_currently_signed_in_only: $("agreementMatrixCurrentOnly") ? $("agreementMatrixCurrentOnly").value === "true" : false
      });
      if (result.error) {
        box.innerHTML = "Could not load matrix.";
        setLocalStatus("agreementMatrixStatus", result.error.message, "error");
        showToast("Compliance matrix", result.error.message, "error");
        return;
      }
      agreementComplianceMatrixCache = result.data || [];
      renderAgreementComplianceMatrix();
      setLocalStatus("agreementMatrixStatus", "Identity matrix loaded.", "success");
      showToast("Compliance matrix", "Identity matrix loaded.", "success");
    }

    function matrixStatusDisplay(status, required) {
      const normalized = status || (required ? "missing" : "not_signed");
      if (normalized === "compliant") return { icon: "✓", text: "Compliant", color: "#15803d" };
      if (normalized === "signed") return { icon: "✓", text: "Signed", color: "#15803d" };
      if (normalized === "outdated") return { icon: "⚠", text: "Outdated", color: "#d97706" };
      if (normalized === "missing") return { icon: "✗", text: "Missing", color: "#dc2626" };
      return { icon: "—", text: "Not signed", color: "#111827" };
    }

    function renderAgreementComplianceMatrix() {
      const box = $("agreementMatrixResults");
      if (!box) return;
      if (!agreementComplianceMatrixCache.length) { box.innerHTML = "No matrix data."; return; }
      const types = [];
      agreementComplianceMatrixCache.forEach(r => { if (!types.find(t => t.id === r.agreement_type_id)) types.push({ id:r.agreement_type_id, name:r.agreement_name, required:r.is_required }); });
      const identities = {};
      agreementComplianceMatrixCache.forEach(r => {
        const key = r.identity_key || ((r.visitor_name || "").toLowerCase().trim() + "|" + (r.company || "").toLowerCase().trim());
        if (!identities[key]) identities[key] = { identity_key:key, visitor_name:r.visitor_name || "", company:r.company || "", latest_visit_log_id:r.latest_visit_log_id || null, latest_sign_in_time:r.latest_sign_in_time || null, statuses:{} };
        identities[key].statuses[r.agreement_type_id] = r;
      });
      const filterText = (($("agreementMatrixTextFilter") && $("agreementMatrixTextFilter").value) || "").trim().toLowerCase();
      const identityRows = Object.values(identities)
        .filter(v => {
          if (!filterText) return true;
          let haystack = ((v.visitor_name || "") + " " + (v.company || "")).toLowerCase();
          types.forEach(t => {
            const s = v.statuses[t.id];
            const d = matrixStatusDisplay(s && s.status, t.required);
            haystack += " " + (t.name || "") + " " + d.text;
          });
          return haystack.indexOf(filterText) >= 0;
        })
        .sort((a,b) => ((a.visitor_name||"").localeCompare(b.visitor_name||"", undefined, {sensitivity:"base"}) || (a.company||"").localeCompare(b.company||"", undefined, {sensitivity:"base"})));
      let html = "<div class='row-meta' style='margin:0 0 10px;'>One row per unique visitor/company identity. Click a row to view visit/agreement history and validity reasons." + (AppState.currentProfile && AppState.currentProfile.role === "super_user" ? " SuperUsers can also correct the identity globally from the detail view." : "") + "</div>";
      html += "<div style='overflow:auto;'><table style='width:100%;border-collapse:collapse;'><thead><tr><th style='text-align:left;'>Visitor</th><th style='text-align:left;'>Company</th>";
      types.forEach(t => { html += "<th style='text-align:left;'>" + safe(t.name) + (t.required ? " *" : "") + "</th>"; });
      html += "</tr></thead><tbody>";
      identityRows.forEach(v => {
        html += "<tr class='matrix-identity-row' data-identity-key='" + safeAttr(v.identity_key) + "' style='cursor:pointer;'><td>" + safe(v.visitor_name) + "</td><td>" + safe(v.company) + "</td>";
        types.forEach(t => {
          const s = v.statuses[t.id];
          const display = matrixStatusDisplay(s && s.status, t.required);
          html += "<td style='font-weight:900;text-align:left;white-space:nowrap;'><span style='color:" + display.color + ";font-weight:1000;'>" + safe(display.icon) + "</span> <span>" + safe(display.text) + "</span></td>";
        });
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      const summaryText = filterText ? ("Active agreement types: " + types.length + " • Filter: " + safe(filterText)) : ("Active agreement types: " + types.length);
      box.innerHTML = buildResultSummary(identityRows.length, "Unique identities", summaryText) + html;
      box.querySelectorAll(".matrix-identity-row").forEach(row => {
        row.addEventListener("click", () => openAgreementIdentityDetail(row.getAttribute("data-identity-key")));
      });
    }

    function matrixExportRows() {
      const rows = [];
      const types = [];
      agreementComplianceMatrixCache.forEach(r => { if (!types.find(t => t.id === r.agreement_type_id)) types.push({ id:r.agreement_type_id, name:r.agreement_name, required:r.is_required }); });
      const identities = {};
      agreementComplianceMatrixCache.forEach(r => {
        const key = r.identity_key || ((r.visitor_name || "").toLowerCase().trim() + "|" + (r.company || "").toLowerCase().trim());
        if (!identities[key]) identities[key] = { "Identity Key":key, "Visitor":r.visitor_name || "", "Company":r.company || "", "Latest Visit":r.latest_sign_in_time ? new Date(r.latest_sign_in_time).toLocaleString() : "", statuses:{} };
        identities[key].statuses[r.agreement_type_id] = r;
      });
      Object.values(identities).sort((a,b) => (a["Visitor"].localeCompare(b["Visitor"], undefined, {sensitivity:"base"}) || a["Company"].localeCompare(b["Company"], undefined, {sensitivity:"base"}))).forEach(identity => {
        const out = { "Identity Key": identity["Identity Key"], "Visitor": identity["Visitor"], "Company": identity["Company"], "Latest Visit": identity["Latest Visit"] };
        types.forEach(t => {
          const item = identity.statuses[t.id];
          const status = item && item.status;
          out[t.name] = status === "compliant" ? "Compliant" : status === "signed" ? "Signed" : status === "outdated" ? "Outdated" : status === "missing" ? "Missing" : "Not signed";
        });
        rows.push(out);
      });
      return rows;
    }

    function ensureAgreementIdentityModal() {
      let modal = $("agreementIdentityModalBackdrop");
      if (modal) return modal;
      modal = document.createElement("div");
      modal.id = "agreementIdentityModalBackdrop";
      modal.className = "modal-backdrop priority-modal";
      modal.innerHTML = "<div class='modal identity-profile-modal'>" +
        "<div class='modal-header'><h2>Identity Profile</h2><button id='closeAgreementIdentityModalButton' class='ghost' type='button'>Close</button></div>" +
        "<div class='identity-profile-modal-body'>" +
          "<div id='agreementIdentityModalMessage' class='modal-message'></div>" +
          "<div id='agreementIdentityHeader' class='row-meta'></div>" +
          "<div class='button-row identity-profile-tabs'>" +
            "<button type='button' class='secondary agreement-identity-tab active' data-tab='overview'>Overview</button>" +
            "<button type='button' class='secondary agreement-identity-tab' data-tab='visits'>Visits</button>" +
            "<button type='button' class='secondary agreement-identity-tab' data-tab='agreements'>Agreements</button>" +
            "<button type='button' class='secondary agreement-identity-tab' data-tab='activity'>Activity</button>" +
            (AppState.currentProfile && AppState.currentProfile.role === "super_user" ? "<button type='button' class='secondary agreement-identity-tab' data-tab='edit'>Edit Identity</button>" : "") +
          "</div>" +
          "<div id='agreementIdentityDetails' class='identity-profile-content'>Loading...</div>" +
        "</div>" +
      "</div>";
      document.body.appendChild(modal);
      $("closeAgreementIdentityModalButton").addEventListener("click", closeAgreementIdentityModal);
      modal.querySelectorAll(".agreement-identity-tab").forEach(btn => {
        btn.addEventListener("click", () => showAgreementIdentityTab(btn.getAttribute("data-tab")));
      });
      return modal;
    }

    function closeAgreementIdentityModal() {
      const modal = $("agreementIdentityModalBackdrop");
      if (modal) modal.classList.remove("active");
    }

    function setAgreementIdentityMessage(text, type) {
      const box = $("agreementIdentityModalMessage");
      if (!box) return;
      box.textContent = text || "";
      box.className = text ? "modal-message " + (type || "info") : "modal-message";
      if (text) showToast(type === "error" ? "Identity update" : "Identity detail", text, type || "info");
    }

    async function openAgreementIdentityDetail(identityKey) {
      ensureAgreementIdentityModal();
      $("agreementIdentityDetails").innerHTML = "Loading identity detail...";
      $("agreementIdentityHeader").innerHTML = "Identity key: " + safe(identityKey);
      setAgreementIdentityMessage("Loading identity detail...", "info");
      $("agreementIdentityModalBackdrop").classList.add("active");
      const matrixRows = agreementComplianceMatrixCache.filter(r => r.identity_key === identityKey);
      const first = matrixRows[0] || {};
      const result = await supabaseClient.rpc("get_agreement_identity_detail", { p_identity_key: identityKey });
      if (result.error) {
        $("agreementIdentityDetails").innerHTML = "Could not load identity detail.";
        setAgreementIdentityMessage(result.error.message, "error");
        return;
      }
      const rows = result.data || [];
      renderAgreementIdentityDetail(rows, first);
      setAgreementIdentityMessage(rows.length + " record(s) loaded.", "success");
    }

    let currentAgreementIdentityProfile = null;

    function renderAgreementIdentityDetail(rows, identity) {
      const box = $("agreementIdentityDetails");
      if (!box) return;
      const visits = rows.filter(r => r.section === "visit");
      const agreements = rows.filter(r => r.section === "agreement");
      const matrixRows = agreementComplianceMatrixCache.filter(r => r.identity_key === identity.identity_key);
      const requiredRows = matrixRows.filter(r => r.is_required === true);
      const missingRows = matrixRows.filter(r => r.is_required === true && (r.status === "missing" || r.status === "outdated"));
      const outdatedRows = matrixRows.filter(r => r.status === "outdated");
      const signedRows = matrixRows.filter(r => r.status === "compliant" || r.status === "signed");
      const dates = visits.map(v => v.event_time ? new Date(v.event_time) : null).filter(Boolean).sort((a,b) => a - b);
      const firstVisit = dates.length ? dates[0] : null;
      const lastVisit = dates.length ? dates[dates.length - 1] : null;
      const signedInNow = visits.some(v => String(v.detail_1 || "").toLowerCase() === "signed_in");
      currentAgreementIdentityProfile = { rows, visits, agreements, matrixRows, requiredRows, missingRows, outdatedRows, signedRows, identity, firstVisit, lastVisit, signedInNow };
      const complianceBadge = missingRows.length ? "<span class='badge danger'>Requires action " + missingRows.length + "</span>" : "<span class='badge success'>Fully compliant</span>";
      $("agreementIdentityHeader").innerHTML = "<strong>" + safe(identity.visitor_name) + "</strong><br>Company: " + safe(identity.company || "-") + "<br>Compliance: " + complianceBadge;
      showAgreementIdentityTab("overview");
    }

    function showAgreementIdentityTab(tabName) {
      const profile = currentAgreementIdentityProfile;
      const box = $("agreementIdentityDetails");
      if (!profile || !box) return;
      document.querySelectorAll(".agreement-identity-tab").forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName));
      if (tabName === "overview") return renderAgreementIdentityOverview(profile, box);
      if (tabName === "visits") return renderAgreementIdentityRows(profile.visits, box, "Visits");
      if (tabName === "agreements") return renderAgreementIdentityAgreements(profile, box);
      if (tabName === "edit") return renderAgreementIdentityEdit(profile, box);
      renderAgreementIdentityRows(profile.rows, box, "Activity");
    }

    function renderAgreementIdentityOverview(profile, box) {
      const cards = document.createElement("div");
      cards.className = "dashboard-grid";
      const addCard = (label, value) => {
        const card = document.createElement("div");
        card.className = "stat-card";
        card.innerHTML = "<div class='stat-label'>" + safe(label) + "</div><div class='stat-value' style='font-size:1.4rem;'>" + value + "</div>";
        cards.appendChild(card);
      };
      addCard("Total visits", safe(String(profile.visits.length)));
      addCard("First visit", safe(profile.firstVisit ? profile.firstVisit.toLocaleString() : "-"));
      addCard("Last visit", safe(profile.lastVisit ? profile.lastVisit.toLocaleString() : "-"));
      addCard("Signed in now", profile.signedInNow ? "<span class='badge success'>Yes</span>" : "<span class='badge'>No</span>");
      addCard("Required agreements", safe(String(profile.requiredRows.length - profile.missingRows.length)) + " / " + safe(String(profile.requiredRows.length)));
      addCard("Optional signed", safe(String(profile.matrixRows.filter(r => r.is_required !== true && r.status === "signed").length)));
      addCard("Current compliance", profile.missingRows.length ? "<span class='badge danger'>Action required</span>" : "<span class='badge success'>Compliant</span>");
      addCard("Outdated agreements", safe(String(profile.outdatedRows ? profile.outdatedRows.length : 0)));
      addCard("Agreement evidence", safe(String(profile.agreements.length)));
      const wrap = document.createElement("div");
      wrap.appendChild(cards);
      const reasonRows = profile.matrixRows.filter(r => r.status === "missing" || r.status === "outdated" || r.reason_text);
      if (reasonRows.length) {
        const reasonBox = document.createElement("div");
        reasonBox.className = "settings-section";
        reasonBox.style.marginTop = "12px";
        let reasonHtml = "<div class='settings-heading'><div class='settings-icon'>ℹ️</div><div><h3>Agreement validity reasons</h3><p>Single source of truth from the unified compliance engine.</p></div></div>";
        reasonRows.forEach(r => {
          const label = r.status === "compliant" ? "Compliant" : r.status === "signed" ? "Signed" : r.status === "outdated" ? "Outdated" : r.status === "missing" ? "Missing" : "Not signed";
          reasonHtml += "<div class='row' style='margin-top:8px;'><div class='row-title'>" + safe(r.agreement_name) + " <span class='badge " + (r.status === "outdated" || r.status === "missing" ? "danger" : "") + "'>" + safe(label) + "</span></div><div class='row-meta'>" + safe(r.reason_text || "-") + (r.signed_version_number || r.active_version_number ? "<br>Signed version: " + safe(r.signed_version_number || "-") + " | Active version: " + safe(r.active_version_number || "-") : "") + (r.expiry_date ? "<br>Expiry: " + safe(new Date(r.expiry_date).toLocaleString()) : "") + (typeof r.days_remaining === "number" ? "<br>Days remaining: " + safe(String(r.days_remaining)) : "") + "</div></div>";
        });
        reasonBox.innerHTML = reasonHtml;
        wrap.appendChild(reasonBox);
      }
      setResultBox(box, buildResultSummary(profile.visits.length + profile.agreements.length, "Identity profile", "One profile per visitor/company identity"), wrap);
    }

    function renderAgreementIdentityRows(rows, box, title) {
      if (!rows.length) { box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No records found.</div>"; return; }
      const temp = document.createElement("div");
      rows.forEach(r => {
        const div = document.createElement("div");
        div.className = "row";
        const isAgreement = r.section === "agreement";
        div.innerHTML = "<div class='row-title'>" + (isAgreement ? "Agreement" : "Visit") + "</div>" +
          "<div class='row-meta'>" +
          "Visitor: " + safe(r.visitor_name) + "<br>" +
          "Company: " + safe(r.company || "-") + "<br>" +
          (isAgreement ? "Agreement: " + safe(r.detail_1) + "<br>" + safe(r.detail_2) + "<br>Signed: " : "Status: " + safe(r.detail_1) + "<br>Origin: " + safe(r.detail_2) + "<br>Visit time: ") +
          safe(r.event_time ? new Date(r.event_time).toLocaleString() : "-") +
          "<br>Record ID: " + safe(r.record_id) +
          "</div>";
        temp.appendChild(div);
      });
      setResultBox(box, buildResultSummary(rows.length, title || "Identity records", "Sorted newest first"), temp);
    }

    function renderAgreementIdentityAgreements(profile, box) {
      const temp = document.createElement("div");
      profile.matrixRows.sort((a,b) => ((a.agreement_name || "").localeCompare(b.agreement_name || "", undefined, {sensitivity:"base"}))).forEach(r => {
        const div = document.createElement("div");
        div.className = "row";
        const signed = r.status === "compliant" || r.status === "signed";
        const label = r.status === "compliant" ? "Compliant" : r.status === "signed" ? "Signed" : r.status === "outdated" ? "Outdated" : r.status === "missing" ? "Missing" : "Not signed";
        const badgeClass = signed ? "success" : ((r.status === "missing" || r.status === "outdated") ? "danger" : "");
        div.innerHTML = "<div class='row-title'>" + safe(r.agreement_name) + " " + (r.is_required ? "<span class='badge danger'>Required</span>" : "<span class='badge'>Optional</span>") + "</div>" +
          "<div class='row-meta'>Title: " + safe(r.agreement_title || "-") + "<br>Status: <span class='badge " + badgeClass + "'>" + safe(label) + "</span><br>Reason: " + safe(r.reason_text || "-") + "<br>Signed: " + safe(r.signed_at ? new Date(r.signed_at).toLocaleString() : "-") + "<br>Signed version: " + safe(r.signed_version_number || "-") + " | Active version: " + safe(r.active_version_number || "-") + (r.expiry_date ? "<br>Expiry: " + safe(new Date(r.expiry_date).toLocaleString()) : "") + (typeof r.days_remaining === "number" ? "<br>Days remaining: " + safe(String(r.days_remaining)) : "") + "</div>";
        temp.appendChild(div);
      });
      setResultBox(box, buildResultSummary(profile.matrixRows.length, "Agreement status", "Required and optional agreement status for this identity"), temp);
    }

    function renderAgreementIdentityEdit(profile, box) {
      if (!(AppState.currentProfile && AppState.currentProfile.role === "super_user")) {
        box.innerHTML = "<div class='row-meta'>Only SuperUsers can edit identities.</div>";
        return;
      }
      const oldName = profile.identity && profile.identity.visitor_name ? profile.identity.visitor_name : "";
      const oldCompany = profile.identity && profile.identity.company ? profile.identity.company : "";
      box.innerHTML =
        "<div class='settings-section' style='margin:0;'>" +
          "<div class='settings-heading'><div class='settings-icon'>✏️</div><div><h3>Edit / Correct Identity</h3><p>SuperUser only. Updates matching visitor name/company across visit logs, agreements and planned visits. This action is audited.</p></div></div>" +
          "<div class='form-grid'>" +
            "<input id='identityOldVisitorName' placeholder='Old visitor name' readonly value='" + safeAttr(oldName) + "' />" +
            "<input id='identityOldCompany' placeholder='Old company' readonly value='" + safeAttr(oldCompany) + "' />" +
            "<input id='identityNewVisitorName' placeholder='New visitor name' value='" + safeAttr(oldName) + "' />" +
            "<input id='identityNewCompany' placeholder='New company' value='" + safeAttr(oldCompany) + "' />" +
            "<textarea id='identityChangeReason' class='full' rows='3' placeholder='Reason for change'>Visitor identity correction from compliance matrix.</textarea>" +
            "<input id='identityConfirmText' class='full' placeholder='Type UPDATE IDENTITY to enable update' />" +
          "</div>" +
          "<div class='row-meta' style='margin-top:10px;'>Type <strong>UPDATE IDENTITY</strong> exactly before the update button becomes available.</div>" +
          "<div class='button-row' style='margin-top:12px;'><button id='confirmIdentityUpdateButton' class='danger' type='button' disabled>Update Identity</button></div>" +
        "</div>";
      const confirmInput = $("identityConfirmText");
      const updateButton = $("confirmIdentityUpdateButton");
      const syncUpdateButton = () => {
        const ok = confirmInput && confirmInput.value.trim() === "UPDATE IDENTITY";
        if (updateButton) {
          updateButton.disabled = !ok;
          updateButton.textContent = ok ? "Confirm Identity Update" : "Update Identity";
        }
      };
      if (confirmInput) confirmInput.addEventListener("input", syncUpdateButton);
      if (updateButton) updateButton.addEventListener("click", confirmAgreementIdentityUpdate);
      syncUpdateButton();
    }

    async function confirmAgreementIdentityUpdate() {
      const oldName = $("identityOldVisitorName") ? $("identityOldVisitorName").value : "";
      const oldCompany = $("identityOldCompany") ? $("identityOldCompany").value : "";
      const newName = $("identityNewVisitorName") ? $("identityNewVisitorName").value.trim() : "";
      const newCompany = $("identityNewCompany") ? $("identityNewCompany").value.trim() : "";
      const reason = $("identityChangeReason") ? $("identityChangeReason").value.trim() : "";
      const confirmText = $("identityConfirmText") ? $("identityConfirmText").value.trim() : "";
      if (!newName) { setAgreementIdentityMessage("New visitor name is required.", "error"); return; }
      if (!reason) { setAgreementIdentityMessage("Change reason is required.", "error"); return; }
      if (confirmText !== "UPDATE IDENTITY") { setAgreementIdentityMessage("Type UPDATE IDENTITY exactly before updating this identity.", "error"); return; }
      const btn = $("confirmIdentityUpdateButton");
      if (btn) { btn.disabled = true; btn.textContent = "Updating identity..."; }
      setAgreementIdentityMessage("Updating identity...", "info");
      const result = await supabaseClient.rpc("superuser_update_visitor_identity", { p_old_visitor_name:oldName, p_old_company:oldCompany || null, p_new_visitor_name:newName, p_new_company:newCompany || null, p_change_reason:reason, p_confirm_text:confirmText });
      if (result.error) { setAgreementIdentityMessage(result.error.message, "error"); if (btn) { btn.disabled = false; btn.textContent = "Confirm Identity Update"; } return; }
      const response = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!response || response.success !== true) { setAgreementIdentityMessage(response && response.message ? response.message : "Identity update failed.", "error"); if (btn) { btn.disabled = false; btn.textContent = "Confirm Identity Update"; } return; }
      showToast("Identity updated", response.message + " Visit rows: " + response.visit_log_rows_updated + ", agreement rows: " + response.visitor_agreement_rows_updated + ", planned rows: " + response.planned_visit_rows_updated + ".", "success");
      await refreshAgreementComplianceViewsAfterIdentityChange();
      const newKey = newName.toLowerCase().trim() + "|" + (newCompany || "").toLowerCase().trim();
      await openAgreementIdentityDetail(newKey);
    }

    async function loadOutstandingInductions() {
      const box = $("outstandingInductionResults");
      if (!box) return;
      box.innerHTML = "Loading outstanding inductions...";
      setLocalStatus("outstandingInductionStatus", "Loading outstanding inductions...", "info");
      const result = await supabaseClient.rpc("get_outstanding_inductions");
      if (result.error) {
        box.innerHTML = "Could not load outstanding inductions.";
        setLocalStatus("outstandingInductionStatus", result.error.message, "error");
        showToast("Outstanding inductions", result.error.message, "error");
        return;
      }
      outstandingInductionsCache = result.data || [];
      if (!outstandingInductionsCache.length) { box.innerHTML = "<div class='row-meta' style='padding:14px 0;'>No outstanding inductions.</div>"; }
      else {
        const temp = document.createElement("div");
        outstandingInductionsCache.forEach(row => {
          const div = document.createElement("div"); div.className = "row";
          div.innerHTML = "<div class='row-title'>" + safe(row.visitor_name) + " <span class='status-badge status-pending'>" + safe(row.risk_level) + " risk</span></div>" +
            "<div class='row-meta'>Company: " + safe(row.company) + "<br>Days since sign-in: " + safe(row.days_since_sign_in) + "<br>Missing: " + safe(row.missing_agreement_names) + "</div>";
          temp.appendChild(div);
        });
        setResultBox(box, buildResultSummary(outstandingInductionsCache.length, "Outstanding inductions", "Currently signed in"), temp);
      }
      setLocalStatus("outstandingInductionStatus", outstandingInductionsCache.length + " outstanding item(s).", "success");
      showToast("Outstanding inductions", outstandingInductionsCache.length + " outstanding item(s).", "success");
    }

    async function loadEvidenceAudit() {
      const box = $("evidenceAuditResults");
      if (!box) return;
      box.innerHTML = "Loading evidence audit...";
      setLocalStatus("evidenceAuditStatus", "Loading evidence audit...", "info");
      const result = await supabaseClient.rpc("search_agreement_evidence_audit", {
        p_date_from: $("evidenceAuditFromDate").value || null,
        p_date_to: $("evidenceAuditToDate").value || null,
        p_visitor_name: $("evidenceAuditVisitor").value.trim() || null,
        p_company: $("evidenceAuditCompany").value.trim() || null,
        p_agreement_type_id: $("evidenceAuditType").value || null,
        p_inductor: $("evidenceAuditInductor").value.trim() || null
      });
      if (result.error) {
        box.innerHTML = "Could not load evidence audit.";
        setLocalStatus("evidenceAuditStatus", result.error.message, "error");
        showToast("Evidence audit", result.error.message, "error");
        return;
      }
      evidenceAuditCache = (result.data || []).map(row => Object.assign({}, row, {
        has_signature: row.has_visitor_signature || row.has_signature,
        signature_data: row.signature_data || null,
        inductor_signature_data: row.inductor_signature_data || null
      }));
      renderAgreementSearchResultsToBox("evidenceAuditResults", evidenceAuditCache);
      setLocalStatus("evidenceAuditStatus", evidenceAuditCache.length + " evidence record(s) loaded.", "success");
      showToast("Evidence audit", evidenceAuditCache.length + " evidence record(s) loaded.", "success");
    }

    function evidenceAuditExportRows(rows) {
      return (rows || []).map(row => ({
        "Signed At": row.signed_at ? new Date(row.signed_at).toLocaleString() : "",
        "Visitor": row.visitor_name || "",
        "Company": row.company || "",
        "Agreement Type": row.agreement_name || "",
        "Agreement Title": row.agreement_title || "",
        "Version": row.agreement_version_number || "",
        "Signed By": row.signed_by_name || "",
        "Inductor": row.inductor_name || "",
        "Visitor Signature": row.has_visitor_signature ? "Yes" : "No",
        "Inductor Signature": row.has_inductor_signature ? "Yes" : "No",
        "Agreement ID": row.agreement_id || "",
        "Visit Log ID": row.visit_log_id || ""
      }));
    }

    async function saveAgreementSettings() { await saveSettingsGroup("agreementSettings", "Agreement Settings"); syncAgreementSettingsControls(); }

    function showSuperSection(sectionName) {
      ensureSuperReportingCards();
      simplifyPlannedQueueFilters();
      const sections = {
        dashboard: "superDashboardSection",
        reporting: "superReportingSection",
        gdpr: "superGdprSection",
        agreements: "superAgreementsSection",
        notifications: "superNotificationsSection",
        settings: "superSettingsSection"
      };

      if (sectionName === "settings") {
        setTimeout(refreshDeploymentVersionStatus, 50);
      }

      if (sectionName === "gdpr") {
        moveGdprWorkspaceParts();
        showGdprStep("cases");
      }

      if (sectionName === "agreements") {
        showAgreementTab("pending");
        loadPendingAgreements("super");
        loadAgreementVersions();
        syncAgreementSettingsControls();
      }

      Object.keys(sections).forEach(key => {
        if ($(sections[key])) $(sections[key]).classList.toggle("hidden", key !== sectionName);
      });

      [
        ["superNavDashboard", "dashboard"],
        ["superNavReporting", "reporting"],
        ["superNavAgreements", "agreements"],
        ["superNavGdpr", "gdpr"],
        ["superNavNotifications", "notifications"],
        ["superNavSettings", "settings"]
      ].forEach(([id, key]) => {
        if ($(id)) $(id).classList.toggle("active", key === sectionName);
      });
    }

    async function openSuperKioskSignIn() {
      superKioskTestMode = true;
      document.body.classList.add("kiosk-mode");
      try {
        ensureKioskToken();
        await loadPlannedVisits();
        showScreen("signInScreen");
        setLocalStatus("kioskTestStatus", "Kiosk Sign In opened in SuperUser test mode.", "success");
        showToast("Kiosk test mode", "Kiosk Sign In opened in SuperUser test mode.", "success");
      } catch (err) {
        setLocalStatus("kioskTestStatus", err.message, "error");
        showToast("Kiosk test mode", err.message, "error");
      }
    }

    async function openSuperKioskSignOut() {
      superKioskTestMode = true;
      document.body.classList.add("kiosk-mode");
      try {
        ensureKioskToken();
        await loadActiveVisits();
        showScreen("signOutScreen");
        setLocalStatus("kioskTestStatus", "Kiosk Sign Out opened in SuperUser test mode.", "success");
        showToast("Kiosk test mode", "Kiosk Sign Out opened in SuperUser test mode.", "success");
      } catch (err) {
        setLocalStatus("kioskTestStatus", err.message, "error");
      }
    }

    function exitSuperKioskTestMode() {
      superKioskTestMode = false;
      document.body.classList.toggle("kiosk-mode", isKioskProfile());
      setRole("super");
    }

    function setRole(role) {
      superKioskTestMode = role === "kiosk";
      document.body.classList.toggle("kiosk-mode", superKioskTestMode || isKioskProfile());

      $("roleGeneral").classList.toggle("active", role === "general");
      $("roleSecurity").classList.toggle("active", role === "security");
      $("roleSuper").classList.toggle("active", role === "super");
      if ($("roleKiosk")) $("roleKiosk").classList.toggle("active", role === "kiosk");

      $("generalPanel").classList.toggle("active", role === "general");
      $("securityPanel").classList.toggle("active", role === "security");
      $("superPanel").classList.toggle("active", role === "super");
      if ($("kioskTestPanel")) $("kioskTestPanel").classList.toggle("active", role === "kiosk");

      if (role === "security") {
        runOpportunisticAutoSignOutCheck();
        loadSecurityDashboard();
        loadAnalytics("");
        loadPendingAgreements("security");
      }
      if (role === "super") {
        loadSuperDashboard();
        fillSettingsForm();
        initialiseCollapsibleSettings();
        runOpportunisticAutoSignOutCheck();
        refreshSystemHealth();

        if ($("profilesList")) $("profilesList").innerHTML = "Click Load Profiles to show data.";
        if ($("kioskDevicesList")) $("kioskDevicesList").innerHTML = "Click Reload Devices to show data.";
        if ($("auditEventsResults")) $("auditEventsResults").innerHTML = "Click Load Audit Events to show data.";
        if ($("superAnalyticsSummary")) $("superAnalyticsSummary").innerHTML = "";
        if ($("superAnalyticsTopCompanies")) $("superAnalyticsTopCompanies").innerHTML = "Click Load Analytics to show data.";
        if ($("superAnalyticsPeakHours")) $("superAnalyticsPeakHours").innerHTML = "Click Load Analytics to show data.";
      }
    }

    async function refreshCoreData() {
      await loadPlannedVisits();
      await loadActiveVisits();
      debugInfo.textContent = "Last refreshed: " + new Date().toLocaleTimeString();
    }

    async function loadPlannedVisits() {
      const today = todayDate();

      // Preferred path: backend-controlled list that excludes any planned visit already used today.
      // This avoids showing signed-out/completed planned visitors to kiosk users.
      const availableResult = await supabaseClient.rpc("get_kiosk_available_planned_visits", {
        p_visit_date: today
      });

      if (!availableResult.error && Array.isArray(availableResult.data)) {
        AppState.plannedTodayCache = availableResult.data || [];
        renderPlannedVisitorList();
        return;
      }

      if (availableResult.error) {
        console.warn("get_kiosk_available_planned_visits unavailable; using client fallback.", availableResult.error);
      }

      const plannedResult = await supabaseClient
        .from("planned_visits")
        .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, status, created_by, modified_by, modified_at")
        .eq("visit_date", today)
        .order("expected_time", { ascending: true });

      if (plannedResult.error) {
        $("plannedVisits").innerHTML = "Could not load planned visits.";
        console.error(plannedResult.error);
        return;
      }

      const logsResult = await supabaseClient
        .from("visit_log")
        .select("planned_visit_id, sign_in_time, sign_out_time")
        .not("planned_visit_id", "is", null)
        .gte("sign_in_time", today + "T00:00:00")
        .lt("sign_in_time", today + "T23:59:59");

      if (logsResult.error) {
        console.warn("Could not read visit_log for planned visit filtering. Falling back to planned visit status only.", logsResult.error);
      }

      AppState.visitLogCache = logsResult.data || [];
      const used = {};
      AppState.visitLogCache.forEach(log => {
        if (log.sign_in_time) used[log.planned_visit_id] = true;
      });

      AppState.plannedTodayCache = (plannedResult.data || []).filter(v => {
        const status = String(v.status || "planned").toLowerCase();
        const statusAllowsKioskSignIn = ["", "planned", "pending"].includes(status);
        return statusAllowsKioskSignIn && !used[v.id];
      });
      renderPlannedVisitorList();
    }

    function normalisePlannedVisitRows(rows) {
      return (rows || []).map(row => {
        const logs = Array.isArray(row.visit_log) ? row.visit_log : [];
        const latest = logs.length ? logs[0] : null;

        if (latest) {
          row.visit_log_id = latest.id;
          row.sign_in_time = latest.sign_in_time;
          row.sign_out_time = latest.sign_out_time;
          row.visit_status = latest.visit_status;
          row.status = latest.sign_out_time ? "signed_out" : (latest.sign_in_time ? "signed_in" : (latest.visit_status || row.status));
        }

        return row;
      });
    }

    function plannedVisitDisplayStatus(visit) {
      const rawStatus = String(visit.status || "").toLowerCase();

      if (visit.sign_out_time || rawStatus === "signed_out") return "signed_out";
      if (visit.sign_in_time || visit.visit_log_id || rawStatus === "signed_in") return "signed_in";
      return rawStatus || "planned";
    }

    function plannedVisitStatusLabel(visit) {
      const status = plannedVisitDisplayStatus(visit);
      if (status === "signed_in") return "Signed in";
      if (status === "signed_out") return "Signed out";
      if (status === "cancelled") return "Cancelled";
      return "Pending";
    }

    function renderPlannedVisitorList() {
      const box = $("plannedVisits");
      const filterRaw = $("plannedFilter").value;
      const filter = formatPersonName(filterRaw);

      if (!filter || filter.length < 2) {
        box.innerHTML = "<div class='row'><div class='row-meta'>Type at least 2 letters of your name to search today's planned visitors.</div></div>";
        return;
      }

      let rows = AppState.plannedTodayCache.filter(v =>
        formatPersonName(v.visitor_name).includes(filter) ||
        formatPersonName(v.company).includes(filter)
      );

      if (rows.length === 0) {
        box.innerHTML =
          "<div class='walkin-empty-state'>" +
          "<div class='row-title'>No matching planned visit found</div>" +
          "<div class='row-meta'>If you are not expected today, continue as a walk-in visitor.</div>" +
          "<button id='openWalkInFromSearchButton' type='button'>Continue as Walk-In</button>" +
          "</div>";

        $("openWalkInFromSearchButton").addEventListener("click", () => openWalkInModal(filterRaw));
        return;
      }

      box.innerHTML = "";
      rows.forEach(visit => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<div class='row-title'>" + safe(visit.visitor_name) + "</div>" +
          "<div class='row-meta'>" + safe(visit.company) + "</div>";

        const btn = document.createElement("button");
        btn.textContent = "Sign In";
        btn.type = "button";
        btn.addEventListener("click", () => signInPlanned(visit, btn));

        row.appendChild(btn);
        box.appendChild(row);
      });
    }

    function openWalkInModal(nameFromSearch) {
      clearWalkInModalMessage();
      $("walkInName").value = formatPersonName(nameFromSearch || $("plannedFilter").value || "");
      applyFieldRules();
      updateWalkInEmbeddedPrivacy();
      $("walkInModalBackdrop").classList.add("active");
      focusFirstModalInput("walkInModalBackdrop");
    }

    function clearWalkInForm() {
      ["walkInName","walkInCompany","walkInReason","walkInVehicle","walkInContact","walkInSecurityPass"].forEach(id => {
        if ($(id)) $(id).value = "";
      });
      clearWalkInModalMessage();
    }

    function closeWalkInModal() {
      $("walkInModalBackdrop").classList.remove("active");
    }



    let pendingPrivacyResolve = null;
    let latestPrivacyAcceptance = null;

    function currentPrivacyConfig() {
      return {
        enabled: !!settingValue("privacy_notice_enabled", appSettings.privacyNoticeEnabled),
        required: !!settingValue("privacy_acknowledgement_required", appSettings.privacyAcknowledgementRequired),
        version: settingValue("privacy_notice_version", appSettings.privacyNoticeVersion),
        text: settingValue("privacy_notice_text", appSettings.privacyNoticeText)
      };
    }

    function showPrivacyModalMessage(text, type) {
      const box = $("privacyNoticeModalMessage");
      if (!box) return;
      box.textContent = text || "";
      box.className = text ? ("modal-message " + (type || "error")) : "modal-message";
    }

    function privacyDisplayMode() {
      return settingValue("privacy_display_mode", appSettings.privacyDisplayMode || "modal");
    }

    function updateWalkInEmbeddedPrivacy() {
      const box = $("walkInEmbeddedPrivacyBox");
      if (!box) return;

      const cfg = currentPrivacyConfig();
      const embedded = cfg.enabled && privacyDisplayMode() === "embedded_walkin";

      box.classList.toggle("hidden", !embedded);

      if (embedded) {
        $("walkInEmbeddedPrivacyText").textContent = cfg.text + "\n\nVersion: " + cfg.version;
        $("walkInEmbeddedPrivacyAccepted").checked = false;
        $("walkInEmbeddedPrivacyMessage").textContent = "";
        $("walkInEmbeddedPrivacyMessage").className = "modal-message";
      }
    }

    function validateEmbeddedWalkInPrivacy() {
      const cfg = currentPrivacyConfig();

      if (!cfg.enabled || privacyDisplayMode() !== "embedded_walkin") {
        return null;
      }

      if (cfg.required && !$("walkInEmbeddedPrivacyAccepted").checked) {
        const box = $("walkInEmbeddedPrivacyMessage");
        box.textContent = "Please acknowledge the privacy notice before continuing.";
        box.className = "modal-message error";
        return false;
      }

      return {
        accepted: $("walkInEmbeddedPrivacyAccepted").checked,
        version: cfg.version,
        acceptedAt: new Date().toISOString()
      };
    }

    function requestPrivacyAcknowledgement() {
      const cfg = currentPrivacyConfig();
      latestPrivacyAcceptance = null;

      if (!cfg.enabled) {
        latestPrivacyAcceptance = { accepted: false, version: null, acceptedAt: null };
        return Promise.resolve(true);
      }

      $("privacyNoticeContent").textContent = cfg.text + "\n\nVersion: " + cfg.version;
      $("privacyNoticeAcceptedCheck").checked = false;
      showPrivacyModalMessage("", null);
      $("privacyNoticeModalBackdrop").classList.add("active");
      setTimeout(() => $("privacyNoticeAcceptedCheck").focus(), 50);

      return new Promise(resolve => {
        pendingPrivacyResolve = resolve;
      });
    }

    function closePrivacyNoticeModal(result) {
      $("privacyNoticeModalBackdrop").classList.remove("active");
      if (pendingPrivacyResolve) {
        pendingPrivacyResolve(result);
        pendingPrivacyResolve = null;
      }
    }

    function confirmPrivacyNotice() {
      const cfg = currentPrivacyConfig();
      if (cfg.required && !$("privacyNoticeAcceptedCheck").checked) {
        showPrivacyModalMessage("Please acknowledge the privacy notice before continuing.", "error");
        return;
      }

      latestPrivacyAcceptance = {
        accepted: $("privacyNoticeAcceptedCheck").checked,
        version: cfg.version,
        acceptedAt: new Date().toISOString()
      };

      closePrivacyNoticeModal(true);
    }


    function rpcVisitLogId(data) {
      if (!data) return null;
      if (typeof data === "string") return data;
      if (typeof data === "object") {
        return data.id || data.visit_log_id || data.p_visit_log_id || null;
      }
      return null;
    }

    async function findVisitLogIdAfterPlannedSignIn(plannedVisitId, rpcData) {
      const directId = rpcVisitLogId(rpcData);
      if (directId) return directId;

      const lookup = await supabaseClient
        .from("visit_log")
        .select("id")
        .eq("planned_visit_id", plannedVisitId)
        .is("sign_out_time", null)
        .order("sign_in_time", { ascending: false })
        .limit(1);

      if (!lookup.error && lookup.data && lookup.data.length > 0) return lookup.data[0].id;
      return null;
    }

    async function findVisitLogIdAfterWalkInSignIn(visitorName, rpcData) {
      const directId = rpcVisitLogId(rpcData);
      if (directId) return directId;

      const lookup = await supabaseClient
        .from("visit_log")
        .select("id")
        .ilike("visitor_name", visitorName)
        .is("sign_out_time", null)
        .order("sign_in_time", { ascending: false })
        .limit(1);

      if (!lookup.error && lookup.data && lookup.data.length > 0) return lookup.data[0].id;
      return null;
    }

    async function signInPlanned(visit, actionButton) {
      clearMessage();

      if (!beginKioskAction(actionButton, "Signing in...", "Sign In")) {
        showToast("Please wait", "A kiosk action is already running.", "info");
        return;
      }

      try {
        const privacyOk = await requestPrivacyAcknowledgement();
        if (!privacyOk) {
          endKioskAction(actionButton, "Sign In");
          return;
        }

        let kioskToken;
        try {
          kioskToken = ensureKioskToken();
        } catch (err) {
          showMessage(err.message, "error");
          endKioskAction(actionButton, "Sign In");
          return;
        }

        showMessage("Signing you in, please wait...", "success");
        if (actionButton && actionButton.parentElement) {
          const waitNote = document.createElement("div");
          waitNote.className = "row-meta kiosk-action-wait-note";
          waitNote.textContent = "Signing you in, please wait...";
          actionButton.parentElement.appendChild(waitNote);
        }

        const plannedSignInRpc = isSuperKioskTestProfile()
          ? "superuser_test_kiosk_sign_in_planned"
          : "kiosk_sign_in_planned";

        const result = await supabaseClient.rpc(plannedSignInRpc, {
          p_kiosk_token: kioskToken,
          p_planned_visit_id: visit.id,
          p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
          p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
        });

        if (result.error) {
          const msg = "Could not sign in planned visitor: " + result.error.message;
          showMessage(msg, "error");
          console.error(result.error);
          endKioskAction(actionButton, "Sign In");
          return;
        }

        const plannedVisitLogId = await findVisitLogIdAfterPlannedSignIn(visit.id, result.data);
        await queueVisitorArrivalNotification(plannedVisitLogId);

        await sendKioskHeartbeat("visitor_signed_in_planned");

        await writeAuditEvent("visitor_signed_in", "visit_log", plannedVisitLogId || result.data || null, {
          origin: "planned",
          visitor_name: visit.visitor_name,
          planned_visit_id: visit.id
        });

        showMessage("Signed in successfully.", "success");
        showKioskConfirmation("Welcome, " + safe(visit.visitor_name), appSettings.plannedSignInMessage);
        await refreshCoreData();
        showScreen("homeScreen");
      } catch (err) {
        showMessage("Could not sign in planned visitor: " + err.message, "error");
        console.error(err);
        endKioskAction(actionButton, "Sign In");
      }
    }


    async function signInWalkIn() {
      clearMessage();
      const actionButton = $("walkInButton");
      if (!beginKioskAction(actionButton, "Signing in...", "Sign In Walk-In")) {
        showWalkInModalMessage("Signing in, please wait...", "success");
        showToast("Please wait", "A kiosk action is already running.", "info");
        return;
      }
      const name = formatPersonName($("walkInName").value);

      if (!name) {
        showWalkInModalMessage("Please enter visitor name.", "error");
        endKioskAction(actionButton, "Sign In Walk-In");
        return;
      }

      if (!validateRequiredField("walkInCompany", "Company", true)) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
      if (!validateRequiredField("walkInReason", "Reason for visit", true)) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
      if (!validateRequiredField("walkInVehicle", "Vehicle licence plate", true)) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
      if (!validateRequiredField("walkInContact", "On-site contact", true)) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
      if (!validateRequiredField("walkInSecurityPass", "Security pass ID", true)) { endKioskAction(actionButton, "Sign In Walk-In"); return; }

      const activeDuplicate = await supabaseClient
        .from("visit_log")
        .select("id, visitor_name, sign_out_time")
        .ilike("visitor_name", name)
        .is("sign_out_time", null)
        .limit(1);

      if (!activeDuplicate.error && activeDuplicate.data && activeDuplicate.data.length > 0) {
        showWalkInModalMessage("A visitor with this name is already signed in. Please ask Security for help if this is a different person.", "error");
        endKioskAction(actionButton, "Sign In Walk-In");
        return;
      }

      const plannedDuplicate = AppState.plannedTodayCache.find(v => formatPersonName(v.visitor_name) === name);
      if (plannedDuplicate) {
        showWalkInModalMessage("A planned visitor with this name exists. Please select the planned visitor entry instead of creating a walk-in.", "error");
        endKioskAction(actionButton, "Sign In Walk-In");
        return;
      }

      if (currentPrivacyConfig().enabled && privacyDisplayMode() === "embedded_walkin") {
        const embeddedAcceptance = validateEmbeddedWalkInPrivacy();
        if (embeddedAcceptance === false) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
        latestPrivacyAcceptance = embeddedAcceptance;
      } else {
        const privacyOk = await requestPrivacyAcknowledgement();
        if (!privacyOk) { endKioskAction(actionButton, "Sign In Walk-In"); return; }
      }

      let kioskToken;
      try {
        kioskToken = ensureKioskToken();
      } catch (err) {
        showWalkInModalMessage(err.message, "error");
        endKioskAction(actionButton, "Sign In Walk-In");
        return;
      }

      showWalkInModalMessage("Signing you in, please wait...", "success");

      const walkInSignInRpc = isSuperKioskTestProfile()
        ? "superuser_test_kiosk_sign_in_walk_in"
        : "kiosk_sign_in_walk_in";

      const result = await supabaseClient.rpc(walkInSignInRpc, {
        p_kiosk_token: kioskToken,
        p_visitor_name: name,
        p_company: fieldValueIfVisible("walkInCompany").trim() || null,
        p_visit_reason: fieldValueIfVisible("walkInReason").trim() || null,
        p_vehicle_plate: normalisePlate(fieldValueIfVisible("walkInVehicle")),
        p_onsite_contact: formatPersonName(fieldValueIfVisible("walkInContact")) || null,
        p_security_pass_id: fieldValueIfVisible("walkInSecurityPass").trim() || null,
        p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
        p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
      });

      if (result.error) {
        showWalkInModalMessage("Could not sign in walk-in visitor: " + result.error.message, "error");
        console.error(result.error);
        endKioskAction(actionButton, "Sign In Walk-In");
        return;
      }

      const walkInVisitLogId = await findVisitLogIdAfterWalkInSignIn(name, result.data);
      await queueVisitorArrivalNotification(walkInVisitLogId);

      await sendKioskHeartbeat("visitor_signed_in_walk_in");

      await writeAuditEvent("visitor_signed_in", "visit_log", walkInVisitLogId || result.data || null, {
        origin: "walk_in",
        visitor_name: name
      });

      ["walkInName","walkInCompany","walkInReason","walkInVehicle","walkInContact","walkInSecurityPass"].forEach(id => $(id).value = "");
      closeWalkInModal();
      showMessage("Walk-in visitor signed in successfully.", "success");
      showKioskConfirmation("Welcome, " + safe(name), appSettings.walkInSignInMessage);
      await refreshCoreData();
      kioskActionInProgress = false;
      showScreen("homeScreen");
    }


    async function loadActiveVisits() {
      const result = await supabaseClient
        .from("visit_log")
        .select("id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time")
        .is("sign_out_time", null)
        .order("sign_in_time", { ascending: true });

      if (result.error) {
        $("activeVisits").innerHTML = "Could not load active visitors.";
        console.error(result.error);
        return;
      }

      activeVisitCache = result.data || [];
      renderActiveVisitorList();
    }

    function renderActiveVisitorList() {
      const box = $("activeVisits");
      if (!box) return;

      const filterRaw = $("signOutFilter") ? $("signOutFilter").value : "";
      const filter = formatPersonName(filterRaw);

      if (!filter || filter.length < 2) {
        box.innerHTML = "<div class='row'><div class='row-meta'>Type at least 2 letters of your name to search current signed-in visitors.</div></div>";
        return;
      }

      const rows = activeVisitCache.filter(visit =>
        formatPersonName(visit.visitor_name).includes(filter) ||
        formatPersonName(visit.company).includes(filter) ||
        String(visit.security_pass_id || "").toLowerCase().includes(String(filterRaw || "").toLowerCase())
      );

      if (rows.length === 0) {
        box.innerHTML =
          "<div class='walkin-empty-state'>" +
          "<div class='row-title'>No matching signed-in visitor found</div>" +
          "<div class='row-meta'>Please ask Security for help if you cannot find your name.</div>" +
          "</div>";
        return;
      }

      box.innerHTML = "";
      rows.forEach(visit => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<div class='row-title'>" + safe(visit.visitor_name) + "</div>" +
          "<div class='row-meta'>" +
          "Company: " + safe(visit.company) + "<br>" +
          "Security pass: " + safe(visit.security_pass_id) + "<br>" +
          "Signed in: " + new Date(visit.sign_in_time).toLocaleTimeString() +
          "</div>";

        const btn = document.createElement("button");
        btn.className = "danger";
        btn.textContent = "Sign Out";
        btn.type = "button";
        btn.addEventListener("click", () => signOut(visit.id, btn));

        row.appendChild(btn);
        box.appendChild(row);
      });
    }


    async function getVisitMissingAgreementSummary(visitLogId) {
      try {
        const result = await supabaseClient.rpc("get_visit_missing_required_agreement_summary", { p_visit_log_id: visitLogId });
        if (result.error) return { error: result.error };
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return row || { missing_count: 0, missing_agreements: "" };
      } catch (err) {
        return { error: err };
      }
    }

    async function signOut(id, actionButton) {
      clearMessage();

      if (!beginKioskAction(actionButton, "Signing out...", "Sign Out")) {
        showToast("Please wait", "A kiosk action is already running.", "info");
        return;
      }

      let kioskToken;
      try {
        kioskToken = ensureKioskToken();
      } catch (err) {
        showMessage(err.message, "error");
        endKioskAction(actionButton, "Sign Out");
        return;
      }

      const complianceSummary = await getVisitMissingAgreementSummary(id);
      if (complianceSummary && complianceSummary.error) {
        showToast("Compliance check warning", "Could not check agreement compliance before sign-out: " + complianceSummary.error.message, "error");
      } else if (complianceSummary && Number(complianceSummary.missing_count || 0) > 0) {
        const missingText = complianceSummary.missing_agreements || "required agreement(s)";
        const blockSignOut = !!settingValue("block_sign_out_if_required_agreements_missing", false);
        if (blockSignOut) {
          showMessage("Cannot sign out. Missing required agreement(s): " + missingText, "error");
          showToast("Sign-out blocked", "Missing required agreement(s): " + missingText, "error");
          endKioskAction(actionButton, "Sign Out");
          return;
        }
        showToast("Compliance warning", "Signing out with missing required agreement(s): " + missingText, "error");
      }

      showMessage("Signing you out, please wait...", "success");

      const signOutRpc = isSuperKioskTestProfile()
        ? "superuser_test_kiosk_sign_out"
        : "kiosk_sign_out";

      const result = await supabaseClient.rpc(signOutRpc, {
        p_kiosk_token: kioskToken,
        p_visit_log_id: id
      });

      if (result.error) {
        showMessage("Could not sign visitor out: " + result.error.message, "error");
        console.error(result.error);
        endKioskAction(actionButton, "Sign Out");
        return;
      }

      await sendKioskHeartbeat("visitor_signed_out");

      await writeAuditEvent("visitor_signed_out", "visit_log", id, {});

      showMessage("Visitor signed out successfully.", "success");
      showKioskConfirmation("Thank you for your visit", appSettings.signOutMessage);
      await refreshCoreData();
      kioskActionInProgress = false;
      showScreen("homeScreen");
    }


    async function createPlannedVisit() {
      clearMessage();

      const name = formatPersonName($("plannedName").value);
      const visitDate = $("plannedDate").value;

      if (!name || !visitDate) {
        showMessage("Visitor name and visit date are required.", "error");
        return;
      }

      if (!validateRequiredField("plannedReason", "Reason for visit")) return;
      if (!validateRequiredField("plannedVehicle", "Vehicle licence plate")) return;
      if (!validateRequiredField("plannedContact", "On-site contact")) return;
      if (!validateRequiredField("plannedSecurityPass", "Security pass ID")) return;

      const result = await supabaseClient.from("planned_visits").insert({
        visitor_name: name,
        company: $("plannedCompany").value.trim() || null,
        host_id: null,
        visit_date: visitDate,
        expected_time: $("plannedTime").value || null,
        visit_reason: fieldValueIfVisible("plannedReason").trim() || null,
        vehicle_plate: normalisePlate(fieldValueIfVisible("plannedVehicle")),
        onsite_contact: formatPersonName(fieldValueIfVisible("plannedContact")) || null,
        security_pass_id: fieldValueIfVisible("plannedSecurityPass").trim() || null,
        notes: null,
        status: "planned",
        created_by: AppState.currentProfile ? AppState.currentProfile.id : null
      });

      if (result.error) {
        if (result.error.code === "23505") {
          showMessage("This visitor already has a planned visit for this date.", "error");
        } else {
          showMessage("Could not create planned visit: " + result.error.message, "error");
        }
        console.error(result.error);
        return;
      }

      ["plannedName","plannedCompany","plannedTime","plannedReason","plannedVehicle","plannedContact","plannedSecurityPass"].forEach(id => $(id).value = "");
      $("plannedDate").value = todayDate();
      await writeAuditEvent("planned_visit_created", "planned_visits", result.data && result.data[0] ? result.data[0].id : null, {
        action: "create",
        after: payload,
        summary: "Planned visit created."
      });

      showMessage("Planned visit created.", "success");
      await refreshCoreData();
    }

    async function getProfileNameMap(ids) {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      const map = {};
      if (uniqueIds.length === 0) return map;

      const result = await supabaseClient
        .from("profiles")
        .select("id, display_name")
        .in("id", uniqueIds);

      if (result.data) {
        result.data.forEach(p => map[p.id] = p.display_name);
      }

      return map;
    }

    async function searchPlanned(targetBoxId, date, name, allowEdit, allowDelete, securityOnly) {
      let query = supabaseClient
        .from("planned_visits")
        .select("id, visitor_name, company, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, created_by, modified_by, modified_at")
        .order("visit_date", { ascending: false });

      if (date) query = query.eq("visit_date", date);
      if (name) query = query.ilike("visitor_name", "%" + formatPersonName(name) + "%");

      const result = await query;
      const box = $(targetBoxId);

      if (result.error) {
        box.innerHTML = "Could not search planned visits.";
        console.error(result.error);
        return [];
      }

      const data = result.data || [];
      const statusMap = await getPlannedVisitStatusMap(data.map(v => v.id));
      const profileMap = await getProfileNameMap([
        ...data.map(v => v.created_by),
        ...data.map(v => v.modified_by)
      ]);
      const isSuper = AppState.currentProfile && AppState.currentProfile.role === "super_user";
      renderPlannedResults(box, data, allowEdit || isSuper, allowDelete || isSuper, securityOnly, statusMap, profileMap);
      return data;
    }

    async function getPlannedVisitStatusMap(ids) {
      if (!ids || ids.length === 0) return {};

      const result = await supabaseClient
        .from("visit_log")
        .select("planned_visit_id, sign_in_time, sign_out_time, visit_status, visit_origin")
        .in("planned_visit_id", ids);

      const statusMap = {};
      if (result.data) {
        result.data.forEach(log => {
          if (!log.planned_visit_id || !log.sign_in_time) return;

          if (log.sign_out_time) {
            statusMap[log.planned_visit_id] = {
              status: "signed_out",
              label: "Signed out"
            };
          } else {
            statusMap[log.planned_visit_id] = {
              status: "signed_in",
              label: "Currently signed in"
            };
          }
        });
      }

      return statusMap;
    }


    function renderPlannedResults(box, data, allowEdit, allowDelete, securityOnly, statusMap, profileMap) {
      statusMap = statusMap || {};
      profileMap = profileMap || {};

      if (data.length === 0) {
        box.innerHTML = buildResultSummary(0, "Planned visits", "No matching records") +
          "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No planned visits found.</div></div>";
        return;
      }

      const temp = document.createElement("div");
      data.forEach(visit => {
        const statusInfo = statusMap[visit.id] || { status: "pending", label: "Pending / not arrived" };
        const hasStarted = statusInfo.status !== "pending";
        const statusClass =
          statusInfo.status === "signed_in" ? "status-in" :
          statusInfo.status === "signed_out" ? "status-out" :
          "status-pending";
        const isSuper = AppState.currentProfile && AppState.currentProfile.role === "super_user";

        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<div class='row-title'>" + safe(visit.visitor_name) + "</div>" +
          "<div class='row-meta'>" +
          "Date: " + safe(visit.visit_date) + " " + safe(visit.expected_time) + "<br>" +
          "Company: " + safe(visit.company) + "<br>" +
          "Reason: " + safe(visit.visit_reason) + "<br>" +
          "Vehicle: " + safe(visit.vehicle_plate) + "<br>" +
          "Contact: " + safe(visit.onsite_contact) + "<br>" +
          "Security pass: " + safe(visit.security_pass_id) + "<br>" +
          "Created by: " + safe(profileMap[visit.created_by]) + "<br>" +
          "Last modified by: " + safe(profileMap[visit.modified_by]) + "<br>" +
          "Last modified: " + (visit.modified_at ? new Date(visit.modified_at).toLocaleString() : "-") + "<br>" +
          "<span class='status-badge " + statusClass + "'>" + statusInfo.label + "</span>" +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        if (securityOnly) {
          const edit = document.createElement("button");
          edit.textContent = "Edit Pass ID";
          edit.type = "button";
          edit.addEventListener("click", () => openEditModal("planned_visits", visit, "security"));
          actions.appendChild(edit);
        } else {
          if ((allowEdit || isSuper) && (!hasStarted || isSuper)) {
            const edit = document.createElement("button");
            edit.textContent = "Edit";
            edit.type = "button";
            edit.addEventListener("click", () => openEditModal("planned_visits", visit, "full"));
            actions.appendChild(edit);
          }

          if ((allowDelete || isSuper) && (!hasStarted || isSuper)) {
            const del = document.createElement("button");
            del.textContent = "Delete";
            del.type = "button";
            del.className = "danger";
            del.addEventListener("click", () => deletePlannedVisit(visit.id));
            actions.appendChild(del);
          }

          if ((allowEdit || allowDelete) && hasStarted && !isSuper) {
            const note = document.createElement("div");
            note.className = "lock-note";
            note.textContent = "Locked: visitor has already signed in.";
            actions.appendChild(note);
          }
        }

        row.appendChild(actions);
        temp.appendChild(row);
      });

      setResultBox(box, buildResultSummary(data.length, "Planned visits", "Filtered result"), temp);

    }
    async function searchHistory(targetBoxId, fromDate, toDate, name, allowEdit, allowDelete, securityOnly, filters) {
      filters = filters || {};
      const today = todayDate();

      let query = supabaseClient
        .from("visit_log")
        .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
        .order("sign_in_time", { ascending: false });

      if (name) query = query.ilike("visitor_name", "%" + formatPersonName(name) + "%");
      if (filters.company) query = query.ilike("company", "%" + filters.company.trim() + "%");
      if (filters.securityPass) query = query.ilike("security_pass_id", "%" + filters.securityPass.trim() + "%");
      if (filters.vehicle) query = query.ilike("vehicle_plate", "%" + normalisePlate(filters.vehicle) + "%");
      if (filters.contact) query = query.ilike("onsite_contact", "%" + formatPersonName(filters.contact) + "%");

      const result = await query;
      const box = $(targetBoxId);

      if (result.error) {
        box.innerHTML = "Could not search history.";
        console.error(result.error);
        return [];
      }

      let data = result.data || [];

      if (fromDate) data = data.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) >= fromDate);
      if (toDate) data = data.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) <= toDate);

      if (filters.status === "signed_in") {
        data = data.filter(r => !r.sign_out_time);
      }

      if (filters.status === "signed_out") {
        data = data.filter(r => !!r.sign_out_time);
      }

      if (filters.status === "overdue") {
        data = data.filter(r => r.sign_in_time && !r.sign_out_time && r.sign_in_time.slice(0,10) < today);
      }

      if (filters.origin) {
        data = data.filter(r => (r.visit_origin || (r.planned_visit_id ? "planned" : "walk_in")) === filters.origin);
      }

      renderHistoryResults(box, data, allowEdit, allowDelete, securityOnly);
      return data;
    }

    function renderHistoryResults(box, data, allowEdit, allowDelete, securityOnly) {
      if (data.length === 0) {
        box.innerHTML = buildResultSummary(0, "Visit history", "No matching records") +
          "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No history found.</div></div>";
        return;
      }

      const temp = document.createElement("div");
      data.forEach(log => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<div class='row-title'>" + safe(log.visitor_name) + "</div>" +
          "<div class='row-meta'>" +
          "Company: " + safe(log.company) + "<br>" +
          "Origin: " + safe((log.visit_origin || (log.planned_visit_id ? "planned" : "walk_in")).replace("_", " ")) + "<br>" +
          "Security pass: " + safe(log.security_pass_id) + "<br>" +
          "Privacy version: " + safe(log.privacy_notice_version || "-") + "<br>" +
          "Privacy accepted: " + (log.privacy_notice_accepted_at ? "Yes" : "No") + "<br>" +
          "Privacy accepted at: " + safe(log.privacy_notice_accepted_at ? new Date(log.privacy_notice_accepted_at).toLocaleString() : "-") + "<br>" +
          "Signed in: " + (log.sign_in_time ? new Date(log.sign_in_time).toLocaleString() : "-") + "<br>" +
          "Signed out: " + (log.sign_out_time ? new Date(log.sign_out_time).toLocaleString() : "-") + "<br>" +
          "Status: " + safe(log.visit_status) + "<br>" +
          "Automatic sign-out: " + (log.signed_out_automatically ? "Yes" : "No") + "<br>" +
          "Auto reason: " + safe(log.automatic_sign_out_reason) +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        if (allowEdit || securityOnly) {
          const edit = document.createElement("button");
          edit.textContent = securityOnly ? "Edit Pass ID" : "Edit";
          edit.type = "button";
          edit.addEventListener("click", () => openEditModal("visit_log", log, securityOnly ? "security" : "full"));
          actions.appendChild(edit);
        }

        if (allowDelete) {
          const del = document.createElement("button");
          del.textContent = "Delete";
          del.type = "button";
          del.className = "danger";
          del.addEventListener("click", () => deleteHistory(log.id));
          actions.appendChild(del);
        }

        row.appendChild(actions);
        temp.appendChild(row);
      });

      setResultBox(box, buildResultSummary(data.length, "Visit history", "Filtered result"), temp);

    }

    function toDateTimeLocalValue(value) {
      if (!value) return "";
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      const pad = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function fromDateTimeLocalValue(value) {
      if (!value) return null;
      const d = new Date(value);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    }

    let originalEditRecord = null;

    function normaliseAuditValue(value, fieldName) {
      if (value === undefined || value === "") return null;

      const isDateTimeField = ["sign_in_time", "sign_out_time", "created_at", "modified_at"].includes(fieldName);

      if (isDateTimeField && value) {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          // Compare datetime fields by actual instant, not by string format.
          // Example equivalent values:
          // 2026-06-20T18:03:00+00:00
          // 2026-06-20T18:03:00.000Z
          return parsed.toISOString();
        }
      }

      return value;
    }

    function displayAuditValue(value, fieldName) {
      if (value === undefined || value === "") return null;

      const isDateTimeField = ["sign_in_time", "sign_out_time", "created_at", "modified_at"].includes(fieldName);

      if (isDateTimeField && value) {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }

      return value;
    }

    function buildFieldDiff(beforeRecord, afterRecord, fields) {
      const diff = {};

      fields.forEach(field => {
        const beforeCompare = normaliseAuditValue(beforeRecord ? beforeRecord[field] : null, field);
        const afterCompare = normaliseAuditValue(afterRecord ? afterRecord[field] : null, field);

        if (String(beforeCompare ?? "") !== String(afterCompare ?? "")) {
          diff[field] = {
            old: displayAuditValue(beforeRecord ? beforeRecord[field] : null, field),
            new: displayAuditValue(afterRecord ? afterRecord[field] : null, field)
          };
        }
      });

      return diff;
    }

    function auditDiffSummary(diff) {
      const keys = Object.keys(diff || {});
      if (keys.length === 0) return "No field changes detected.";
      return keys.map(k => k.replaceAll("_", " ")).join(", ") + " changed.";
    }

    function buildObjectDiff(beforeObj, afterObj, fields) {
      const diff = {};
      (fields || Object.keys(Object.assign({}, beforeObj || {}, afterObj || {}))).forEach(field => {
        const oldValue = normaliseAuditValue(beforeObj ? beforeObj[field] : null, field);
        const newValue = normaliseAuditValue(afterObj ? afterObj[field] : null, field);

        if (String(oldValue ?? "") !== String(newValue ?? "")) {
          diff[field] = {
            old: displayAuditValue(beforeObj ? beforeObj[field] : null, field),
            new: displayAuditValue(afterObj ? afterObj[field] : null, field)
          };
        }
      });
      return diff;
    }


    function openEditModal(table, record, mode) {
      clearEditModalMessage();
      originalEditRecord = JSON.parse(JSON.stringify(record || {}));
      if ($("editChangeReason")) $("editChangeReason").value = "";
      $("editTableName").value = table;
      $("editRecordId").value = record.id;
      $("editMode").value = mode;
      $("editModalTitle").textContent = mode === "security" ? "Edit Security Pass ID" : "Edit Visit";

      $("editFullFields").classList.toggle("hidden", mode === "security");

      $("editVisitorName").value = record.visitor_name || "";
      $("editCompany").value = record.company || "";
      $("editVisitDate").value = record.visit_date || "";
      $("editExpectedTime").value = record.expected_time || "";
      $("editReason").value = record.visit_reason || "";
      $("editVehicle").value = record.vehicle_plate || "";
      $("editContact").value = record.onsite_contact || "";
      $("editSecurityPass").value = record.security_pass_id || "";

      const canEditLogAdvanced = table === "visit_log" && mode === "full" && AppState.currentProfile && AppState.currentProfile.role === "super_user";
      ["editSignInTime","editSignOutTime","editVisitStatus","editVisitOrigin"].forEach(id => $(id).classList.toggle("hidden", !canEditLogAdvanced));
      $("editSignInTime").value = canEditLogAdvanced ? toDateTimeLocalValue(record.sign_in_time) : "";
      $("editSignOutTime").value = canEditLogAdvanced ? toDateTimeLocalValue(record.sign_out_time) : "";
      $("editVisitStatus").value = canEditLogAdvanced ? (record.visit_status || "") : "";
      $("editVisitOrigin").value = canEditLogAdvanced ? (record.visit_origin || "") : "";

      $("editModalBackdrop").classList.add("active");
      focusFirstModalInput("editModalBackdrop");
    }

    function closeEditModal() {
      $("editModalBackdrop").classList.remove("active");
      clearEditModalMessage();
    }

    async function saveEdit() {
      clearMessage();
      clearEditModalMessage();

      try {
        const table = $("editTableName").value;
        const id = $("editRecordId").value;
        const mode = $("editMode").value;
        const changeReason = $("editChangeReason") ? $("editChangeReason").value.trim() : "";

        if (!changeReason) {
          showEditModalMessage("Change reason is required.", "error");
          return;
        }

        showEditModalMessage("Saving changes...", "success");

        const securityPass = $("editSecurityPass").value.trim() || null;

        let result;
        let payloadForAudit = {
          security_pass_id: securityPass
        };

        // Security mode uses secure RPC functions.
        // This means Security can only change Security Pass ID at database level.
        const trackedFields = table === "visit_log"
          ? ["visitor_name", "company", "visit_reason", "vehicle_plate", "onsite_contact", "security_pass_id", "sign_in_time", "sign_out_time", "visit_status", "visit_origin"]
          : ["visitor_name", "company", "visit_date", "expected_time", "visit_reason", "vehicle_plate", "onsite_contact", "security_pass_id"];

        let payload = null;

        if (mode === "security") {
          payloadForAudit = {
            security_pass_id: securityPass
          };
        } else {
          payload = {
            security_pass_id: securityPass,
            visitor_name: formatPersonName($("editVisitorName").value),
            company: $("editCompany").value.trim() || null,
            visit_reason: $("editReason").value.trim() || null,
            vehicle_plate: normalisePlate($("editVehicle").value),
            onsite_contact: formatPersonName($("editContact").value) || null,
            modified_by: AppState.currentProfile ? AppState.currentProfile.id : null,
            modified_at: new Date().toISOString()
          };

          if (table === "planned_visits") {
            payload.visit_date = $("editVisitDate").value;
            payload.expected_time = $("editExpectedTime").value || null;
          }

          if (table === "visit_log" && AppState.currentProfile && AppState.currentProfile.role === "super_user") {
            payload.sign_in_time = fromDateTimeLocalValue($("editSignInTime").value);
            payload.sign_out_time = fromDateTimeLocalValue($("editSignOutTime").value);
            if ($("editVisitStatus").value) payload.visit_status = $("editVisitStatus").value;
            if ($("editVisitOrigin").value) payload.visit_origin = $("editVisitOrigin").value;
          }

          payloadForAudit = payload;
        }

        const afterRecord = Object.assign({}, originalEditRecord || {}, payloadForAudit);
        const changes = buildFieldDiff(originalEditRecord, afterRecord, trackedFields);

        if (Object.keys(changes).length === 0) {
          showEditModalMessage("No field changes detected. Nothing was saved and no audit event was created.", "error");
          return;
        }

        if (mode === "security") {
          if (table === "planned_visits") {
            result = await supabaseClient.rpc("update_planned_security_pass", {
              p_planned_visit_id: id,
              p_security_pass_id: securityPass
            });
          } else if (table === "visit_log") {
            result = await supabaseClient.rpc("update_visit_log_security_pass", {
              p_visit_log_id: id,
              p_security_pass_id: securityPass
            });
          } else {
            showEditModalMessage("Unknown edit target.", "error");
            return;
          }
        } else {
          result = await supabaseClient.from(table).update(payload).eq("id", id);
        }

        if (result.error) {
          showEditModalMessage("Could not save changes: " + result.error.message, "error");
          showMessage("Could not save changes. See edit window for details.", "error");
          console.error(result.error);
          return;
        }

        await writeAuditEvent("visit_changed", table, id, {
          mode: mode,
          action: "edit",
          reason: changeReason,
          changes: changes,
          summary: auditDiffSummary(changes)
        });

        closeEditModal();
        showMessage("Changes saved.", "success");
        await refreshCoreData();
        await reloadOpenStaffPanel();
      } catch (err) {
        showEditModalMessage("Unexpected save error: " + (err.message || String(err)), "error");
        showMessage("Could not save changes. See edit window for details.", "error");
        console.error("saveEdit failed:", err);
      }
    }


    async function deletePlannedVisit(id) {
      if (!confirm("Delete this planned visit and any linked history?")) return;

      const logDelete = await supabaseClient.from("visit_log").delete().eq("planned_visit_id", id);
      if (logDelete.error) {
        showMessage("Could not delete linked history: " + logDelete.error.message, "error");
        return;
      }

      const plannedDelete = await supabaseClient.from("planned_visits").delete().eq("id", id);
      if (plannedDelete.error) {
        showMessage("Could not delete planned visit: " + plannedDelete.error.message, "error");
        return;
      }

      await writeAuditEvent("visit_changed", "planned_visits", id, {
        action: "delete",
        summary: "Planned visit deleted."
      });
      showMessage("Planned visit deleted.", "success");
      await refreshCoreData();
      await reloadOpenStaffPanel();
    }

    async function deleteHistory(id) {
      if (!confirm("Delete this visit history row?")) return;

      const result = await supabaseClient.from("visit_log").delete().eq("id", id);
      if (result.error) {
        showMessage("Could not delete history: " + result.error.message, "error");
        return;
      }

      await writeAuditEvent("visit_changed", "visit_log", id, {
        action: "delete",
        summary: "Visit history deleted."
      });
      showMessage("History deleted.", "success");
      await refreshCoreData();
      await reloadOpenStaffPanel();
    }

    async function loadAnalytics(prefix) {
      const fromEl = prefix ? $(prefix + "AnalyticsFromDate") : $("analyticsFromDate");
      const toEl = prefix ? $(prefix + "AnalyticsToDate") : $("analyticsToDate");
      const summaryEl = prefix ? $(prefix + "AnalyticsSummary") : $("analyticsSummary");
      const companiesEl = prefix ? $(prefix + "AnalyticsTopCompanies") : $("analyticsTopCompanies");
      const hoursEl = prefix ? $(prefix + "AnalyticsPeakHours") : $("analyticsPeakHours");

      if (!summaryEl) return;

      summaryEl.innerHTML = "Loading analytics...";
      companiesEl.innerHTML = "Loading...";
      hoursEl.innerHTML = "Loading...";

      const result = await supabaseClient.rpc("get_visitor_analytics", {
        p_from_date: fromEl.value || null,
        p_to_date: toEl.value || null
      });

      if (result.error) {
        summaryEl.innerHTML = "";
        companiesEl.innerHTML = "Could not load analytics.";
        hoursEl.innerHTML = result.error.message;
        showMessage("Could not load analytics: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const data = result.data || {};
      const summary = data.summary || {};
      const topCompanies = data.top_companies || [];
      const peakHours = data.peak_hours || [];

      summaryEl.innerHTML =
        statCard("Total Visits", summary.total_visits || 0) +
        statCard("Planned", summary.planned_visits || 0) +
        statCard("Walk-ins", summary.walk_in_visits || 0) +
        statCard("Auto Signed Out", summary.auto_signed_out || 0);

      renderSimpleMetricList(companiesEl, topCompanies, "company", "visits");
      renderSimpleMetricList(hoursEl, peakHours, "hour", "visits");
    }

    function renderSimpleMetricList(box, rows, labelKey, valueKey) {
      if (!rows || rows.length === 0) {
        box.innerHTML = "<div class='row-meta'>No data found.</div>";
        return;
      }

      const temp = document.createElement("div");
      rows.forEach(row => {
        const item = document.createElement("div");
        item.className = "row";
        item.innerHTML =
          "<div class='row-title'>" + safe(row[labelKey]) + "</div>" +
          "<div class='row-meta'>Visits: " + safe(row[valueKey]) + "</div>";
        temp.appendChild(item);
      });

      setResultBox(box, buildResultSummary(rows.length, "Rows", "Analytics result"), temp);
    }

    async function loadSecurityDashboard() {
      const today = todayDate();

      const planned = await supabaseClient.from("planned_visits").select("id").eq("visit_date", today);
      const active = await supabaseClient.from("visit_log").select("id").is("sign_out_time", null);
      const todayLogs = await supabaseClient.from("visit_log").select("id, sign_in_time");
      const visitsToday = (todayLogs.data || []).filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) === today);

      $("securityDashboard").innerHTML =
        statCard("Planned Today", (planned.data || []).length) +
        statCard("Currently On Site", (active.data || []).length) +
        statCard("Visits Today", visitsToday.length) +
        statCard("Audit Mode", "ON");
    }

    function healthItem(label, value) {
      return "<div class='health-item'><div class='health-label'>" + safe(label) + "</div><div class='health-value'>" + safe(value) + "</div></div>";
    }




    function localDateKey() {
      const now = new Date();
      return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    }

    function shouldCurrentRoleRunDailyMaintenance() {
      if (!AppState.currentProfile || !AppState.currentProfile.role) return false;
      const mode = settingValue("daily_maintenance_roles", appSettings.dailyMaintenanceRoles);
      if (mode === "super_user_only") return AppState.currentProfile.role === "super_user";
      return AppState.currentProfile.role === "super_user" || AppState.currentProfile.role === "security";
    }

    function renderDailyMaintenanceStatus(data) {
      const box = $("dailyMaintenanceStatus");
      if (!box) return;

      const lastRunDate = settingValue("last_daily_maintenance_date", "-");
      const lastRunAt = settingValue("last_daily_maintenance_at", "-");
      const lastSummary = settingValue("last_daily_maintenance_summary", "-");

      box.innerHTML =
        healthItem("Enabled", settingValue("daily_maintenance_enabled", appSettings.dailyMaintenanceEnabled) ? "Yes" : "No") +
        healthItem("Trigger roles", settingValue("daily_maintenance_roles", appSettings.dailyMaintenanceRoles)) +
        healthItem("Last run date", lastRunDate || "-") +
        healthItem("Last run at", lastRunAt || "-") +
        healthItem("Last result", lastSummary || "-");

      if (data) {
        box.innerHTML +=
          healthItem("Completed planned deleted", data.completed_planned_to_delete ?? "-") +
          healthItem("No-shows deleted", data.no_show_planned_to_delete ?? "-");
      }
    }

    async function saveSystemSettingValue(key, value, description) {
      await supabaseClient.rpc("superuser_save_setting", {
        p_setting_key: key,
        p_setting_value: value,
        p_description: description || key
      });
    }

    async function runDailyMaintenance(reason) {
      if (!AppState.currentProfile || (AppState.currentProfile.role !== "super_user" && AppState.currentProfile.role !== "security")) return null;

      const result = await supabaseClient.rpc("superuser_run_planned_visit_cleanup");
      if (result.error) {
        renderDailyMaintenanceStatus({ error: result.error.message });
        showMessage("Daily maintenance failed: " + result.error.message, "error");
        console.error(result.error);
        return null;
      }

      const data = result.data || {};
      const summary =
        "Completed planned deleted: " + (data.completed_planned_to_delete ?? 0) +
        "; No-shows deleted: " + (data.no_show_planned_to_delete ?? 0);

      if (AppState.currentProfile.role === "super_user") {
        await saveSystemSettingValue("last_daily_maintenance_date", localDateKey(), "Last daily maintenance local date");
        await saveSystemSettingValue("last_daily_maintenance_at", new Date().toISOString(), "Last daily maintenance timestamp");
        await saveSystemSettingValue("last_daily_maintenance_summary", summary, "Last daily maintenance summary");
        await loadSystemSettings();
      }

      renderDailyMaintenanceStatus(data);

      await writeAuditEvent("daily_maintenance_run", "system_settings", null, {
        action: reason || "manual",
        summary: summary,
        result: data
      });

      return data;
    }

    async function runDailyMaintenanceIfDue(reason) {
      if (!settingValue("daily_maintenance_enabled", appSettings.dailyMaintenanceEnabled)) {
        renderDailyMaintenanceStatus();
        return;
      }

      if (!shouldCurrentRoleRunDailyMaintenance()) {
        renderDailyMaintenanceStatus();
        return;
      }

      const today = localDateKey();
      const lastRun = settingValue("last_daily_maintenance_date", "");

      if (lastRun === today) {
        renderDailyMaintenanceStatus();
        return;
      }

      await runDailyMaintenance(reason || "opportunistic_login");
    }

    function renderPlannedLifecycleResult(data, title) {
      const box = $("plannedLifecycleResults");
      if (!box) return;
      data = data || {};
      box.innerHTML =
        healthItem("Result", title || "Planned Cleanup Preview") +
        healthItem("Completed planned visits eligible", data.completed_planned_to_delete ?? "-") +
        healthItem("No-show planned visits eligible", data.no_show_planned_to_delete ?? "-") +
        healthItem("No-show cutoff", data.no_show_cutoff || "-") +
        healthItem("Mode", data.mode || "-");
    }

    async function savePlannedLifecycleSettings() {
      setLocalStatus("plannedLifecycleStatus", "Saving planned lifecycle settings...", "info");
      await saveSettingsGroup("plannedLifecycle", "Planned Lifecycle");
      setLocalStatus("plannedLifecycleStatus", "Planned lifecycle settings saved.", "success");
    }

    async function previewPlannedLifecycleCleanup() {
      setLocalStatus("plannedLifecycleStatus", "Previewing planned cleanup...", "info");
      const result = await supabaseClient.rpc("superuser_preview_planned_visit_cleanup");
      if (result.error) {
        setLocalStatus("plannedLifecycleStatus", "Could not preview planned cleanup: " + result.error.message, "error");
        return;
      }
      renderPlannedLifecycleResult(result.data || {}, "Preview only");
      setLocalStatus("plannedLifecycleStatus", "Planned cleanup preview loaded.", "success");
    }

    async function runPlannedLifecycleCleanup() {
      const confirmation = confirm("Run planned visit cleanup now? Completed old planned records and no-shows may be deleted.");
      if (!confirmation) return;

      setLocalStatus("plannedLifecycleStatus", "Running planned cleanup...", "info");
      const result = await supabaseClient.rpc("superuser_run_planned_visit_cleanup");
      if (result.error) {
        setLocalStatus("plannedLifecycleStatus", "Could not run planned cleanup: " + result.error.message, "error");
        return;
      }
      renderPlannedLifecycleResult(result.data || {}, "Cleanup applied");
      setLocalStatus("plannedLifecycleStatus", "Planned cleanup completed.", "success");
      await writeAuditEvent("planned_visit_cleanup_run", "planned_visits", null, {
        action: "manual_apply",
        summary: "Planned visit lifecycle cleanup manually applied.",
        result: result.data || {}
      });
      await refreshCoreData();
    }



    let gdprSelectedCaseId = null;
    let gdprCasesCache = [];

    function addOneMonthDate(value) {
      const d = value ? new Date(value + "T00:00:00") : new Date();
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== day) d.setDate(0);
      return d.toISOString().slice(0, 10);
    }

    function openGdprCaseModal(caseRecord) {
      const today = new Date().toISOString().slice(0, 10);
      const isEdit = !!caseRecord;

      $("gdprCaseModalTitle").textContent = isEdit ? "Edit GDPR Case" : "Create GDPR Case";
      $("gdprCaseId").value = isEdit ? caseRecord.id : "";
      $("gdprCaseRequestType").value = caseRecord?.request_type || "erasure";
      $("gdprCaseStatusField").value = caseRecord?.status || "open";
      $("gdprCaseRequesterName").value = caseRecord?.requester_name || "";
      $("gdprCaseRequesterContact").value = caseRecord?.requester_contact || "";
      $("gdprCaseReceivedDate").value = caseRecord?.request_received_at ? String(caseRecord.request_received_at).slice(0, 10) : today;
      $("gdprCaseDueDate").value = caseRecord?.due_date || addOneMonthDate(today);
      $("gdprCaseIdentityVerified").value = String(!!caseRecord?.identity_verified);
      $("gdprCaseVerificationMethod").value = caseRecord?.identity_verification_method || "";
      $("gdprCasePriority").value = caseRecord?.priority || "normal";
      $("gdprCaseDecision").value = caseRecord?.decision || "";
      $("gdprCaseDecisionReason").value = caseRecord?.decision_reason || "";
      $("gdprCaseModalMessage").textContent = "";
      $("gdprCaseModalMessage").className = "modal-message";
      $("gdprCaseModalBackdrop").classList.add("active");
      setTimeout(() => $("gdprCaseRequesterName").focus(), 50);
    }

    function closeGdprCaseModal() {
      $("gdprCaseModalBackdrop").classList.remove("active");
    }

    function gdprCasePayload() {
      return {
        p_case_id: $("gdprCaseId").value || null,
        p_request_type: $("gdprCaseRequestType").value,
        p_requester_name: $("gdprCaseRequesterName").value.trim(),
        p_requester_contact: $("gdprCaseRequesterContact").value.trim() || null,
        p_request_received_at: $("gdprCaseReceivedDate").value || null,
        p_due_date: $("gdprCaseDueDate").value || null,
        p_identity_verified: $("gdprCaseIdentityVerified").value === "true",
        p_identity_verification_method: $("gdprCaseVerificationMethod").value.trim() || null,
        p_status: $("gdprCaseStatusField").value,
        p_priority: $("gdprCasePriority").value,
        p_decision: $("gdprCaseDecision").value || null,
        p_decision_reason: $("gdprCaseDecisionReason").value.trim() || null
      };
    }

    async function saveGdprCase() {
      const payload = gdprCasePayload();

      if (!payload.p_requester_name) {
        $("gdprCaseModalMessage").textContent = "Requester / data subject name is required.";
        $("gdprCaseModalMessage").className = "modal-message error";
        return;
      }

      const result = await supabaseClient.rpc("superuser_upsert_gdpr_case", payload);

      if (result.error) {
        $("gdprCaseModalMessage").textContent = result.error.message;
        $("gdprCaseModalMessage").className = "modal-message error";
        console.error(result.error);
        return;
      }

      closeGdprCaseModal();
      setLocalStatus("gdprCaseStatus", "GDPR case saved.", "success");
      await loadGdprCases();
    }

    function renderGdprCaseDashboard(data) {
      const box = $("gdprCaseDashboard");
      if (!box) return;

      const rows = data || [];
      const now = new Date();
      const month = now.getMonth();
      const year = now.getFullYear();

      const open = rows.filter(r => !["completed", "rejected"].includes(r.status)).length;
      const dueSoon = rows.filter(r => r.due_date && !["completed", "rejected"].includes(r.status) && ((new Date(r.due_date) - now) / 86400000) <= 7 && ((new Date(r.due_date) - now) / 86400000) >= 0).length;
      const overdue = rows.filter(r => r.due_date && !["completed", "rejected"].includes(r.status) && new Date(r.due_date) < now).length;
      const completedThisMonth = rows.filter(r => r.completed_at && new Date(r.completed_at).getMonth() === month && new Date(r.completed_at).getFullYear() === year).length;

      box.innerHTML =
        statCard("Open Cases", open) +
        statCard("Due Within 7 Days", dueSoon) +
        statCard("Overdue", overdue) +
        statCard("Completed This Month", completedThisMonth);
    }

    function renderGdprCaseList(data) {
      const box = $("gdprCaseList");
      if (!box) return;

      const displayRows = data || [];
      renderGdprCaseDashboard(gdprCasesCache && gdprCasesCache.length ? gdprCasesCache : displayRows);

      if (displayRows.length === 0) {
        box.innerHTML = "<div class='row-meta'>No GDPR cases found.</div>";
        return;
      }

      box.innerHTML = "";

      displayRows.forEach(row => {
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML =
          "<div class='row-title'>" + safe(row.case_reference) + " — " + safe(row.requester_name) + "</div>" +
          "<div class='row-meta'>" +
          "Type: " + safe(row.request_type) + "<br>" +
          "Status: " + safe(row.status) + "<br>" +
          "Priority: " + safe(row.priority) + "<br>" +
          "Received: " + safe(row.request_received_at ? String(row.request_received_at).slice(0, 10) : "-") + "<br>" +
          "Due: " + safe(row.due_date || "-") + "<br>" +
          "Identity verified: " + (row.identity_verified ? "Yes" : "No") + "<br>" +
          "Decision: " + safe(row.decision || "-") +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary";
        edit.textContent = "Edit Case";
        edit.addEventListener("click", () => openGdprCaseModal(row));
        actions.appendChild(edit);

        const timeline = document.createElement("button");
        timeline.type = "button";
        timeline.className = "secondary";
        timeline.textContent = "Load Timeline";
        timeline.addEventListener("click", () => loadGdprCaseTimeline(row.id));
        actions.appendChild(timeline);

        const useForSearch = document.createElement("button");
        useForSearch.type = "button";
        useForSearch.className = "secondary";
        useForSearch.textContent = "Use in GDPR Search";
        useForSearch.addEventListener("click", () => {
          gdprSelectedCaseId = row.id;
          if ($("gdprVisitorName")) $("gdprVisitorName").value = row.requester_name || "";
          setLocalStatus("gdprSearchStatus", "Case linked to GDPR search: " + row.case_reference, "success");
          showSuperSection("gdpr");
          showGdprStep("search");
        });
        actions.appendChild(useForSearch);

        div.appendChild(actions);
        box.appendChild(div);
      });
    }



    let sarPackageHtml = "";
    let sarPackageJson = null;

    function sarSelectedCaseOrWarning() {
      const caseRecord = gdprSelectedCase();
      if (!caseRecord) {
        setLocalStatus("sarPackageStatus", "Select a GDPR case first using Load Timeline or Use in GDPR Search.", "error");
        return null;
      }
      return caseRecord;
    }

    function buildSarPackageHtml(caseRecord, data) {
      const generatedAt = new Date().toLocaleString();
      const visits = (data && data.visit_log) || [];
      const future = (data && data.future_planned_visits) || [];

      function visitRowsHtml() {
        if (!visits.length) return "<p>No visit history records found for the search criteria.</p>";

        return visits.map(row =>
          "<div class='record'>" +
          "<h3>" + safe(row.sign_in_time ? new Date(row.sign_in_time).toLocaleDateString() : "Visit Record") + "</h3>" +
          "<table>" +
          evidenceField("Visitor name", row.visitor_name) +
          evidenceField("Company", row.company) +
          evidenceField("Visit reason", row.visit_reason) +
          evidenceField("Vehicle registration", row.vehicle_plate) +
          evidenceField("Security pass ID", row.security_pass_id) +
          evidenceField("On-site contact", row.onsite_contact) +
          evidenceField("Sign in time", row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "-") +
          evidenceField("Sign out time", row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "-") +
          evidenceField("Visit status", row.visit_status) +
          evidenceField("Visit origin", row.visit_origin) +
          evidenceField("Privacy notice version", row.privacy_notice_version || "-") +
          evidenceField("Privacy notice accepted at", row.privacy_notice_accepted_at ? new Date(row.privacy_notice_accepted_at).toLocaleString() : "-") +
          "</table></div>"
        ).join("");
      }

      function plannedRowsHtml() {
        if (!future.length) return "<p>No future planned visits found for the search criteria.</p>";

        return future.map(row =>
          "<div class='record'>" +
          "<h3>Planned Visit — " + safe(row.visit_date) + "</h3>" +
          "<table>" +
          evidenceField("Visitor name", row.visitor_name) +
          evidenceField("Company", row.company) +
          evidenceField("Visit date", row.visit_date) +
          evidenceField("Expected time", row.expected_time || "-") +
          evidenceField("Visit reason", row.visit_reason || row.notes || "-") +
          evidenceField("Vehicle registration", row.vehicle_plate) +
          evidenceField("Security pass ID", row.security_pass_id) +
          evidenceField("On-site contact", row.onsite_contact) +
          evidenceField("Status", row.status || "planned") +
          "</table></div>"
        ).join("");
      }

      return "<!doctype html><html><head><meta charset='utf-8'>" +
        "<title>SAR Data Package - " + safe(caseRecord.case_reference) + "</title>" +
        "<style>" +
        "body{font-family:Arial,sans-serif;margin:32px;color:#111827;line-height:1.45;}" +
        "h1,h2,h3{color:#0f172a;} table{border-collapse:collapse;width:100%;margin:12px 0 24px;}" +
        "th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top;} th{background:#f3f4f6;width:260px;}" +
        ".warning{background:#fffbeb;border:1px solid #f59e0b;padding:12px;border-radius:10px;margin:14px 0;}" +
        ".record{page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0;}" +
        ".muted{color:#6b7280;} @media print{button{display:none;} body{margin:18mm;}}" +
        "</style></head><body>" +
        "<h1>Subject Access Request Data Package</h1>" +
        "<p class='muted'>Generated: " + safe(generatedAt) + "</p>" +
        "<div class='warning'><strong>Review before release.</strong> This package may contain personal data and should be checked before sending externally.</div>" +
        "<h2>Case Summary</h2><table>" +
        evidenceField("Case reference", caseRecord.case_reference) +
        evidenceField("Request type", caseRecord.request_type) +
        evidenceField("Data subject / requester", caseRecord.requester_name) +
        evidenceField("Requester contact", caseRecord.requester_contact) +
        evidenceField("Status", caseRecord.status) +
        evidenceField("Identity verified", caseRecord.identity_verified ? "Yes" : "No") +
        evidenceField("Verification method", caseRecord.identity_verification_method || "-") +
        evidenceField("Decision", caseRecord.decision || "-") +
        evidenceField("Decision reason", caseRecord.decision_reason || "-") +
        "</table>" +
        "<h2>Data Categories Included</h2><ul>" +
        "<li>Visitor identity and company details where retained.</li>" +
        "<li>Visit dates, sign-in/sign-out times and status.</li>" +
        "<li>Vehicle, security pass and visit reason where retained.</li>" +
        "<li>Privacy notice version and acceptance timestamp.</li>" +
        "<li>Future planned visits still present in the operational queue.</li>" +
        "</ul>" +
        "<h2>Visit History</h2>" + visitRowsHtml() +
        "<h2>Future Planned Visits</h2>" + plannedRowsHtml() +
        "<h2>Retention Note</h2>" +
        "<p>Planned visits are maintained as a short-lived operational queue. Long-term history is held in visit records according to the configured retention and anonymisation policies.</p>" +
        "</body></html>";
    }

    function buildSarJson(caseRecord, data) {
      return {
        generated_at: new Date().toISOString(),
        case: caseRecord,
        data_categories: [
          "visitor_history",
          "future_planned_visits",
          "privacy_notice_evidence",
          "operational_metadata"
        ],
        visitor_history: (data && data.visit_log) || [],
        future_planned_visits: (data && data.future_planned_visits) || [],
        summary: (data && data.summary) || {}
      };
    }

    async function generateSarPackage() {
      const caseRecord = sarSelectedCaseOrWarning();
      if (!caseRecord) return;

      const payload = gdprLastSearchPayload || gdprSearchPayload();
      if (!gdprHasSearchCriteria(payload)) {
        setLocalStatus("sarPackageStatus", "Run a GDPR data subject search first.", "error");
        return;
      }

      setLocalStatus("sarPackageStatus", "Generating SAR package...", "info");

      const result = await supabaseClient.rpc("superuser_search_data_subject", {
        p_visitor_name: payload.visitor_name || null,
        p_company: payload.company || null,
        p_vehicle_plate: payload.vehicle_plate || null,
        p_security_pass_id: payload.security_pass_id || null,
        p_date_from: payload.date_from,
        p_date_to: payload.date_to
      });

      if (result.error) {
        setLocalStatus("sarPackageStatus", "Could not generate SAR package: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      sarPackageJson = buildSarJson(caseRecord, result.data || {});
      sarPackageHtml = buildSarPackageHtml(caseRecord, result.data || {});

      const preview = $("sarPackagePreview");
      if (preview) {
        preview.innerHTML = sarPackageHtml
          .replace("<!doctype html><html><head><meta charset='utf-8'>", "")
          .replace(/<title>.*?<\/title>/, "")
          .replace(/<style>[\s\S]*?<\/style><\/head><body>/, "")
          .replace("</body></html>", "");
      }

      await supabaseClient.rpc("superuser_add_gdpr_case_note", {
        p_case_id: caseRecord.id,
        p_note_text: "SAR data package generated.",
        p_note_type: "sar_package_generated",
        p_details: {
          visit_records: (result.data?.visit_log || []).length,
          future_planned_visits: (result.data?.future_planned_visits || []).length
        }
      });

      await writeAuditEvent("GDPR_SAR_PACKAGE_GENERATED", "gdpr_requests", caseRecord.id, {
        case_reference: caseRecord.case_reference,
        visit_records: (result.data?.visit_log || []).length,
        future_planned_visits: (result.data?.future_planned_visits || []).length
      });

      setLocalStatus("sarPackageStatus", "SAR package generated.", "success");
      await loadGdprCaseTimeline(caseRecord.id);
    }

    function downloadSarHtml() {
      if (!sarPackageHtml) {
        setLocalStatus("sarPackageStatus", "Generate the SAR package first.", "error");
        return;
      }

      const caseRecord = gdprSelectedCase();
      downloadTextFile((caseRecord ? caseRecord.case_reference : "sar-package") + "-SAR.html", sarPackageHtml, "text/html");
      setLocalStatus("sarPackageStatus", "SAR HTML downloaded.", "success");
    }

    function downloadSarJson() {
      if (!sarPackageJson) {
        setLocalStatus("sarPackageStatus", "Generate the SAR package first.", "error");
        return;
      }

      const caseRecord = gdprSelectedCase();
      downloadTextFile((caseRecord ? caseRecord.case_reference : "sar-package") + "-SAR.json", JSON.stringify(sarPackageJson, null, 2), "application/json");
      setLocalStatus("sarPackageStatus", "SAR JSON downloaded.", "success");
    }

    function printSarPackage() {
      if (!sarPackageHtml) {
        setLocalStatus("sarPackageStatus", "Generate the SAR package first.", "error");
        return;
      }

      const w = window.open("", "_blank");
      w.document.open();
      w.document.write(sarPackageHtml);
      w.document.close();
      w.focus();
      w.print();
    }

    function gdprCaseFilterPayload() {
      return {
        reference: $("gdprCaseFilterReference") ? $("gdprCaseFilterReference").value.trim().toLowerCase() : "",
        requester: $("gdprCaseFilterRequester") ? $("gdprCaseFilterRequester").value.trim().toLowerCase() : "",
        status: $("gdprCaseFilterStatus") ? $("gdprCaseFilterStatus").value : "",
        type: $("gdprCaseFilterType") ? $("gdprCaseFilterType").value : "",
        received_from: $("gdprCaseFilterReceivedFrom") ? $("gdprCaseFilterReceivedFrom").value : "",
        received_to: $("gdprCaseFilterReceivedTo") ? $("gdprCaseFilterReceivedTo").value : "",
        due_from: $("gdprCaseFilterDueFrom") ? $("gdprCaseFilterDueFrom").value : "",
        due_to: $("gdprCaseFilterDueTo") ? $("gdprCaseFilterDueTo").value : ""
      };
    }

    function applyGdprCaseFilters(rows) {
      const f = gdprCaseFilterPayload();

      return (rows || []).filter(row => {
        if (f.reference && String(row.case_reference || "").toLowerCase().indexOf(f.reference) === -1) return false;
        if (f.requester && String(row.requester_name || "").toLowerCase().indexOf(f.requester) === -1) return false;
        if (f.status && row.status !== f.status) return false;
        if (f.type && row.request_type !== f.type) return false;

        const received = row.request_received_at ? String(row.request_received_at).slice(0, 10) : "";
        const due = row.due_date || "";

        if (f.received_from && (!received || received < f.received_from)) return false;
        if (f.received_to && (!received || received > f.received_to)) return false;
        if (f.due_from && (!due || due < f.due_from)) return false;
        if (f.due_to && (!due || due > f.due_to)) return false;

        return true;
      });
    }

    function clearGdprCaseFilters() {
      [
        "gdprCaseFilterReference",
        "gdprCaseFilterRequester",
        "gdprCaseFilterStatus",
        "gdprCaseFilterType",
        "gdprCaseFilterReceivedFrom",
        "gdprCaseFilterReceivedTo",
        "gdprCaseFilterDueFrom",
        "gdprCaseFilterDueTo"
      ].forEach(id => {
        if ($(id)) $(id).value = "";
      });
      renderGdprCaseList(gdprCasesCache || []);
      setLocalStatus("gdprCaseStatus", "Case filters cleared.", "success");
    }

    function gdprSelectedCase() {
      return (gdprCasesCache || []).find(c => c.id === gdprSelectedCaseId) || null;
    }

    function evidenceField(label, value) {
      return "<tr><th>" + safe(label) + "</th><td>" + safe(value ?? "-") + "</td></tr>";
    }

    function buildGdprEvidenceHtml(caseRecord, timelineRows) {
      const generatedAt = new Date().toLocaleString();
      const timeline = timelineRows || [];

      return "<!doctype html><html><head><meta charset='utf-8'>" +
        "<title>GDPR Evidence Pack - " + safe(caseRecord.case_reference) + "</title>" +
        "<style>" +
        "body{font-family:Arial,sans-serif;margin:32px;color:#111827;line-height:1.45;}" +
        "h1,h2{color:#0f172a;} table{border-collapse:collapse;width:100%;margin:12px 0 24px;}" +
        "th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top;} th{background:#f3f4f6;width:260px;}" +
        ".note{border:1px solid #d1d5db;border-radius:10px;padding:12px;margin:10px 0;}" +
        ".muted{color:#6b7280;} .warning{background:#fffbeb;border:1px solid #f59e0b;padding:12px;border-radius:10px;}" +
        "@media print{button{display:none;} body{margin:18mm;}}" +
        "</style></head><body>" +
        "<h1>GDPR Evidence Pack</h1>" +
        "<p class='muted'>Generated: " + safe(generatedAt) + "</p>" +
        "<div class='warning'><strong>Internal compliance evidence.</strong> Review before sharing externally.</div>" +
        "<h2>Case Summary</h2><table>" +
        evidenceField("Case reference", caseRecord.case_reference) +
        evidenceField("Request type", caseRecord.request_type) +
        evidenceField("Requester / data subject", caseRecord.requester_name) +
        evidenceField("Requester contact", caseRecord.requester_contact) +
        evidenceField("Status", caseRecord.status) +
        evidenceField("Priority", caseRecord.priority) +
        evidenceField("Received", caseRecord.request_received_at ? String(caseRecord.request_received_at).slice(0, 10) : "-") +
        evidenceField("Due date", caseRecord.due_date || "-") +
        evidenceField("Identity verified", caseRecord.identity_verified ? "Yes" : "No") +
        evidenceField("Verification method", caseRecord.identity_verification_method || "-") +
        evidenceField("Decision", caseRecord.decision || "-") +
        evidenceField("Decision reason", caseRecord.decision_reason || "-") +
        evidenceField("Completed at", caseRecord.completed_at ? new Date(caseRecord.completed_at).toLocaleString() : "-") +
        "</table>" +
        "<h2>Case Timeline</h2>" +
        (timeline.length ? timeline.map(note =>
          "<div class='note'><strong>" + safe(note.note_type) + "</strong><br>" +
          "<span class='muted'>" + safe(note.created_at ? new Date(note.created_at).toLocaleString() : "-") +
          " by " + safe(note.created_by_name || "-") + "</span><br>" +
          safe(note.note_text || "") +
          (note.details ? "<pre>" + safe(JSON.stringify(note.details, null, 2)) + "</pre>" : "") +
          "</div>"
        ).join("") : "<p>No timeline notes found.</p>") +
        "<h2>Evidence Statement</h2>" +
        "<p>This pack records the GDPR case details and workflow timeline held in the Visitor Management System. " +
        "It should be retained according to the organisation's GDPR/compliance policy.</p>" +
        "</body></html>";
    }

    let gdprEvidenceHtml = "";

    async function generateGdprEvidencePack() {
      const caseRecord = gdprSelectedCase();

      if (!caseRecord) {
        setLocalStatus("gdprEvidenceStatus", "Select a case first by loading its timeline.", "error");
        return;
      }

      setLocalStatus("gdprEvidenceStatus", "Generating evidence pack...", "info");

      const result = await supabaseClient.rpc("superuser_list_gdpr_case_notes", {
        p_case_id: caseRecord.id
      });

      if (result.error) {
        setLocalStatus("gdprEvidenceStatus", "Could not load case timeline: " + result.error.message, "error");
        return;
      }

      gdprEvidenceHtml = buildGdprEvidenceHtml(caseRecord, result.data || []);

      const preview = $("gdprEvidencePreview");
      if (preview) {
        preview.innerHTML = gdprEvidenceHtml
          .replace("<!doctype html><html><head><meta charset='utf-8'>", "")
          .replace(/<title>.*?<\/title>/, "")
          .replace(/<style>[\s\S]*?<\/style><\/head><body>/, "")
          .replace("</body></html>", "");
      }

      setLocalStatus("gdprEvidenceStatus", "Evidence pack generated.", "success");
    }

    function downloadGdprEvidencePack() {
      if (!gdprEvidenceHtml) {
        setLocalStatus("gdprEvidenceStatus", "Generate the evidence pack first.", "error");
        return;
      }

      const caseRecord = gdprSelectedCase();
      const fileName = (caseRecord ? caseRecord.case_reference : "gdpr-evidence") + ".html";
      downloadTextFile(fileName, gdprEvidenceHtml, "text/html");
      setLocalStatus("gdprEvidenceStatus", "Evidence HTML downloaded.", "success");
    }

    function printGdprEvidencePack() {
      if (!gdprEvidenceHtml) {
        setLocalStatus("gdprEvidenceStatus", "Generate the evidence pack first.", "error");
        return;
      }

      const w = window.open("", "_blank");
      w.document.open();
      w.document.write(gdprEvidenceHtml);
      w.document.close();
      w.focus();
      w.print();
    }

    async function loadGdprCases() {
      setLocalStatus("gdprCaseStatus", "Loading GDPR cases...", "info");

      const result = await supabaseClient.rpc("superuser_list_gdpr_cases");

      if (result.error) {
        setLocalStatus("gdprCaseStatus", "Could not load GDPR cases: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      gdprCasesCache = result.data || [];
      renderGdprCaseList(applyGdprCaseFilters(gdprCasesCache));
      setLocalStatus("gdprCaseStatus", "GDPR cases loaded.", "success");
    }

    async function loadGdprCaseTimeline(caseId) {
      gdprSelectedCaseId = caseId;
      const box = $("gdprCaseTimeline");
      if (box) box.innerHTML = "Loading timeline...";

      const result = await supabaseClient.rpc("superuser_list_gdpr_case_notes", {
        p_case_id: caseId
      });

      if (result.error) {
        if (box) box.innerHTML = "Could not load timeline: " + safe(result.error.message);
        console.error(result.error);
        return;
      }

      const data = result.data || [];

      if (data.length === 0) {
        if (box) box.innerHTML = "<div class='row-meta'>No timeline entries yet.</div>";
        return;
      }

      box.innerHTML = data.map(note =>
        "<div class='row'>" +
        "<div class='row-title'>" + safe(note.note_type) + "</div>" +
        "<div class='row-meta'>" +
        "Time: " + safe(note.created_at ? new Date(note.created_at).toLocaleString() : "-") + "<br>" +
        "By: " + safe(note.created_by_name || "-") + "<br>" +
        safe(note.note_text || "") +
        "</div></div>"
      ).join("");
    }

    let gdprLastSearchPayload = null;
    let gdprLastPreview = null;

    function gdprSearchPayload() {
      return {
        visitor_name: $("gdprVisitorName") ? $("gdprVisitorName").value.trim() : "",
        company: $("gdprCompany") ? $("gdprCompany").value.trim() : "",
        vehicle_plate: $("gdprVehicle") ? normalisePlate($("gdprVehicle").value) : "",
        security_pass_id: $("gdprSecurityPass") ? $("gdprSecurityPass").value.trim() : "",
        date_from: $("gdprDateFrom") ? ($("gdprDateFrom").value || null) : null,
        date_to: $("gdprDateTo") ? ($("gdprDateTo").value || null) : null
      };
    }

    function gdprHasSearchCriteria(payload) {
      return !!(
        payload.visitor_name ||
        payload.company ||
        payload.vehicle_plate ||
        payload.security_pass_id ||
        payload.date_from ||
        payload.date_to
      );
    }

    function renderGdprResults(data, title) {
      const box = $("gdprResults");
      if (!box) return;

      const visitRows = (data && data.visit_log) || [];
      const plannedRows = (data && data.future_planned_visits) || [];
      const summary = (data && data.summary) || {};
      const preview = data && data.preview ? data.preview : null;

      function anonymisedPreviewTable(row) {
        return (
          "<table style='margin-top:10px;'>" +
          "<thead><tr><th>Field</th><th>Current</th><th>After anonymisation</th></tr></thead>" +
          "<tbody>" +
          "<tr><td>Visitor name</td><td>" + safe(row.visitor_name) + "</td><td>ANONYMISED</td></tr>" +
          "<tr><td>Company</td><td>" + safe(row.company) + "</td><td>-</td></tr>" +
          "<tr><td>Vehicle</td><td>" + safe(row.vehicle_plate) + "</td><td>-</td></tr>" +
          "<tr><td>Security pass</td><td>" + safe(row.security_pass_id) + "</td><td>-</td></tr>" +
          "<tr><td>Visit reason</td><td>" + safe(row.visit_reason) + "</td><td>-</td></tr>" +
          "<tr><td>On-site contact</td><td>" + safe(row.onsite_contact) + "</td><td>-</td></tr>" +
          "<tr><td>Signed in</td><td>" + safe(row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "-") + "</td><td>" + safe(row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "-") + "</td></tr>" +
          "<tr><td>Signed out</td><td>" + safe(row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "-") + "</td><td>" + safe(row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "-") + "</td></tr>" +
          "<tr><td>Privacy version</td><td>" + safe(row.privacy_notice_version || "-") + "</td><td>" + safe(row.privacy_notice_version || "-") + "</td></tr>" +
          "<tr><td>Privacy accepted at</td><td>" + safe(row.privacy_notice_accepted_at ? new Date(row.privacy_notice_accepted_at).toLocaleString() : "-") + "</td><td>" + safe(row.privacy_notice_accepted_at ? new Date(row.privacy_notice_accepted_at).toLocaleString() : "-") + "</td></tr>" +
          "</tbody></table>"
        );
      }

      let htmlParts =
        "<div class='callout info'>" +
        "<strong>" + safe(title || "GDPR Search Results") + "</strong><br>" +
        "Visit records: " + safe(summary.visit_log_count ?? visitRows.length) + "<br>" +
        "Future planned visits: " + safe(summary.future_planned_count ?? plannedRows.length) +
        "</div>";

      if (preview) {
        const removed = preview.fields_removed_from_visit_log || [];
        const retained = preview.fields_retained || [];

        htmlParts +=
          "<div class='callout warning' style='margin-top:14px;'>" +
          "<strong>Anonymisation Preview</strong><br>" +
          "This is a preview only. Records below remain unchanged until anonymisation is applied.<br><br>" +
          "Visit records to anonymise: " + safe(preview.visit_records_to_anonymise ?? visitRows.length) + "<br>" +
          "Future planned visits found: " + safe(preview.future_planned_visits_found ?? plannedRows.length) + "<br><br>" +
          "<strong>Fields that will be removed from visit history:</strong><br>" +
          (removed.length ? removed.map(x => "✓ " + safe(String(x).replaceAll('_', ' '))).join("<br>") : "-") +
          "<br><br><strong>Fields that will be retained:</strong><br>" +
          (retained.length ? retained.map(x => "✓ " + safe(String(x).replaceAll('_', ' '))).join("<br>") : "-") +
          "<br><br><strong>Future planned recommendation:</strong><br>" +
          safe(preview.future_planned_recommendation || "Cancel future planned visits rather than anonymising them.") +
          "</div>";

        if (visitRows.length > 0) {
          htmlParts += "<h3>Before / After Simulation</h3>";
          visitRows.forEach((row, index) => {
            htmlParts +=
              "<div class='row'>" +
              "<div class='row-title'>Record " + safe(index + 1) + " — " + safe(row.visitor_name) + "</div>" +
              "<div class='row-meta'>This table simulates what the record will look like after anonymisation.</div>" +
              anonymisedPreviewTable(row) +
              "</div>";
          });
        }
      }

      if (visitRows.length > 0) {
        htmlParts += "<h3>" + (preview ? "Current Visit History" : "Visit History") + "</h3>";
        visitRows.forEach(row => {
          htmlParts +=
            "<div class='row'>" +
            "<div class='row-title'>" + safe(row.visitor_name) + "</div>" +
            "<div class='row-meta'>" +
            "Company: " + safe(row.company) + "<br>" +
            "Vehicle: " + safe(row.vehicle_plate) + "<br>" +
            "Security pass: " + safe(row.security_pass_id) + "<br>" +
            "Reason: " + safe(row.visit_reason) + "<br>" +
            "On-site contact: " + safe(row.onsite_contact) + "<br>" +
            "Signed in: " + safe(row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "-") + "<br>" +
            "Signed out: " + safe(row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "-") + "<br>" +
            "Privacy version: " + safe(row.privacy_notice_version || "-") + "<br>" +
            "Privacy accepted at: " + safe(row.privacy_notice_accepted_at ? new Date(row.privacy_notice_accepted_at).toLocaleString() : "-") +
            "</div></div>";
        });
      }

      if (plannedRows.length > 0) {
        htmlParts += "<h3>Future Planned Visits</h3>";
        plannedRows.forEach(row => {
          htmlParts +=
            "<div class='row'>" +
            "<div class='row-title'>" + safe(row.visitor_name) + "</div>" +
            "<div class='row-meta'>" +
            "Company: " + safe(row.company) + "<br>" +
            "Date: " + safe(row.visit_date) + "<br>" +
            "Reason: " + safe(row.visit_reason || row.notes) + "<br>" +
            "Vehicle: " + safe(row.vehicle_plate) + "<br>" +
            "On-site contact: " + safe(row.onsite_contact) + "<br>" +
            "Status: " + safe(row.status || "planned") +
            "</div></div>";
        });
      }

      if (visitRows.length === 0 && plannedRows.length === 0) {
        htmlParts += "<div class='row-meta'>No matching records found.</div>";
      }

      box.innerHTML = htmlParts;
    }


    async function gdprSearchDataSubject() {
      const payload = gdprSearchPayload();
      gdprLastSearchPayload = payload;
      gdprLastPreview = null;

      if (!gdprHasSearchCriteria(payload)) {
        setLocalStatus("gdprSearchStatus", "Enter at least one search criterion.", "error");
        return;
      }

      setLocalStatus("gdprSearchStatus", "Searching data subject records...", "info");

      const result = await supabaseClient.rpc("superuser_search_data_subject", {
        p_visitor_name: payload.visitor_name || null,
        p_company: payload.company || null,
        p_vehicle_plate: payload.vehicle_plate || null,
        p_security_pass_id: payload.security_pass_id || null,
        p_date_from: payload.date_from,
        p_date_to: payload.date_to
      });

      if (result.error) {
        setLocalStatus("gdprSearchStatus", "Search failed: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      renderGdprResults(result.data || {}, "GDPR Data Subject Search");
      setLocalStatus("gdprSearchStatus", "Search complete.", "success");
    }

    function gdprClearSearch() {
      ["gdprVisitorName", "gdprCompany", "gdprVehicle", "gdprSecurityPass", "gdprDateFrom", "gdprDateTo"].forEach(id => {
        if ($(id)) $(id).value = "";
      });
      gdprLastSearchPayload = null;
      gdprLastPreview = null;
      if ($("gdprResults")) $("gdprResults").innerHTML = "No GDPR search yet.";
      setLocalStatus("gdprSearchStatus", "", "");
      setLocalStatus("gdprActionStatus", "", "");
    }

    async function gdprPreviewAnonymisation() {
      const payload = gdprLastSearchPayload || gdprSearchPayload();

      if (!gdprHasSearchCriteria(payload)) {
        setLocalStatus("gdprActionStatus", "Run a GDPR search first.", "error");
        return;
      }

      setLocalStatus("gdprActionStatus", "Previewing anonymisation...", "info");

      const result = await supabaseClient.rpc("superuser_preview_data_subject_anonymisation", {
        p_visitor_name: payload.visitor_name || null,
        p_company: payload.company || null,
        p_vehicle_plate: payload.vehicle_plate || null,
        p_security_pass_id: payload.security_pass_id || null,
        p_date_from: payload.date_from,
        p_date_to: payload.date_to
      });

      if (result.error) {
        setLocalStatus("gdprActionStatus", "Preview failed: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      gdprLastPreview = result.data || {};

      if (!gdprLastPreview.preview) {
        const visitCount = (gdprLastPreview.visit_log || []).length;
        const plannedCount = (gdprLastPreview.future_planned_visits || []).length;

        gdprLastPreview.preview = {
          visit_records_to_anonymise: visitCount,
          future_planned_visits_found: plannedCount,
          fields_removed_from_visit_log: [
            "visitor_name",
            "company",
            "visit_reason",
            "vehicle_plate",
            "onsite_contact",
            "security_pass_id"
          ],
          fields_retained: [
            "sign_in_time",
            "sign_out_time",
            "visit_status",
            "visit_origin",
            "host_id",
            "kiosk_device_id",
            "privacy_notice_version",
            "privacy_notice_accepted_at"
          ],
          future_planned_recommendation: "Cancel future planned visits rather than anonymising them."
        };

        gdprLastPreview.summary = Object.assign({}, gdprLastPreview.summary || {}, {
          visit_log_count: visitCount,
          future_planned_count: plannedCount,
          preview_generated: true
        });
      }

      renderGdprResults(gdprLastPreview, "Anonymisation Preview");
      setLocalStatus("gdprActionStatus", "Anonymisation preview generated. Review removed/retained fields before anonymising.", "success");
    }

    function openGdprAnonymiseModal() {
      const payload = gdprLastSearchPayload || gdprSearchPayload();

      if (!gdprHasSearchCriteria(payload)) {
        setLocalStatus("gdprActionStatus", "Run a GDPR search first.", "error");
        return;
      }

      $("gdprAnonymiseReason").value = "";
      $("gdprAnonymiseConfirmText").value = "";
      $("gdprFuturePlannedAction").value = "cancel";
      $("gdprAnonymiseModalMessage").textContent = "";
      $("gdprAnonymiseModalMessage").className = "modal-message";
      $("gdprAnonymiseModalBackdrop").classList.add("active");
      setTimeout(() => $("gdprAnonymiseReason").focus(), 50);
    }

    function closeGdprAnonymiseModal() {
      $("gdprAnonymiseModalBackdrop").classList.remove("active");
    }

    async function confirmGdprAnonymisation() {
      const payload = gdprLastSearchPayload || gdprSearchPayload();
      const reason = $("gdprAnonymiseReason").value.trim();
      const confirmText = $("gdprAnonymiseConfirmText").value.trim();
      const futureAction = $("gdprFuturePlannedAction").value;

      if (!reason) {
        $("gdprAnonymiseModalMessage").textContent = "Reason is required.";
        $("gdprAnonymiseModalMessage").className = "modal-message error";
        return;
      }

      if (confirmText !== "ANONYMISE VISITOR DATA") {
        $("gdprAnonymiseModalMessage").textContent = "Confirmation text does not match.";
        $("gdprAnonymiseModalMessage").className = "modal-message error";
        return;
      }

      setLocalStatus("gdprActionStatus", "Applying anonymisation...", "info");

      const result = await supabaseClient.rpc("superuser_anonymise_data_subject", {
        p_visitor_name: payload.visitor_name || null,
        p_company: payload.company || null,
        p_vehicle_plate: payload.vehicle_plate || null,
        p_security_pass_id: payload.security_pass_id || null,
        p_date_from: payload.date_from,
        p_date_to: payload.date_to,
        p_reason: reason,
        p_future_planned_action: futureAction,
        p_gdpr_case_id: gdprSelectedCaseId || null
      });

      if (result.error) {
        $("gdprAnonymiseModalMessage").textContent = result.error.message;
        $("gdprAnonymiseModalMessage").className = "modal-message error";
        setLocalStatus("gdprActionStatus", "Anonymisation failed: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      closeGdprAnonymiseModal();
      gdprLastPreview = result.data || {};
      renderGdprResults(gdprLastPreview, "Anonymisation Applied");
      setLocalStatus("gdprActionStatus", "Anonymisation applied.", "success");
      showMessage("GDPR anonymisation applied.", "success");
      await refreshCoreData();
    }

    function renderRetentionResult(resultData, title) {
      const box = $("retentionResults");
      if (!box) return;
      const data = resultData || {};
      box.innerHTML =
        healthItem("Result", title || "Retention Preview") +
        healthItem("Planned visits eligible for deletion", data.planned_visits_to_delete ?? "-") +
        healthItem("Visit logs eligible for anonymisation", data.visit_logs_to_anonymise ?? "-") +
        healthItem("Audit events eligible for deletion", data.audit_events_to_delete ?? "-") +
        healthItem("Planned cutoff", data.planned_cutoff || "-") +
        healthItem("Visit log cutoff", data.visit_log_cutoff || "-") +
        healthItem("Audit cutoff", data.audit_cutoff || "-") +
        healthItem("Mode", data.mode || settingValue("retention_mode", appSettings.retentionMode));
    }


    function loadRetentionRecommendedDefaults() {
      $("settingRetentionPlannedDays").value = 90;
      $("settingRetentionVisitLogDays").value = 730;
      $("settingRetentionAuditDays").value = 1825;
      $("settingRetentionMode").value = "preview_only";
      if ($("dataGovernanceStatus")) $("dataGovernanceStatus").textContent = "UK GDPR recommended retention defaults loaded. Review and save when ready.";
      showMessage("UK GDPR recommended retention defaults loaded. Review and save when ready.", "success");
    }

    function loadPrivacyRecommendedDefaults() {
      const defaultText = "We collect your personal information for site security, visitor management, health and safety, and compliance purposes. Your information will be stored securely, accessed only by authorised personnel, and retained according to our data retention policy.";

      if ($("settingPrivacyNoticeEnabled")) $("settingPrivacyNoticeEnabled").value = "true";
      if ($("settingPrivacyAcknowledgementRequired")) $("settingPrivacyAcknowledgementRequired").value = "true";
      if ($("settingPrivacyNoticeVersion")) $("settingPrivacyNoticeVersion").value = "2026.1";
      if ($("settingPrivacyNoticeText")) $("settingPrivacyNoticeText").value = defaultText;
      if ($("settingPrivacyDisplayMode")) $("settingPrivacyDisplayMode").value = "embedded_walkin";

      setLocalStatus("privacyNoticeSettingsStatus", "Recommended privacy notice loaded. Review wording, then save.", "success");
    }


    async function savePrivacyNoticeSettings() {
      await saveSettingsGroup("privacyNotice", "Privacy Notice");
      if ($("dataGovernanceStatus")) $("dataGovernanceStatus").textContent = "Privacy Notice saved successfully.";
      showMessage("Privacy Notice saved successfully.", "success");
    }

    async function resetPrivacyNoticeSettings() {
      await resetSettingsGroup("privacyNotice", "Privacy Notice");
      if ($("dataGovernanceStatus")) $("dataGovernanceStatus").textContent = "Privacy Notice restored to defaults.";
    }


    function setLocalStatus(id, message, type) {
      const box = $(id);
      if (box) {
        box.textContent = message || "";
        if (!message) {
          box.className = "local-action-status";
          return;
        }
        box.className = "local-action-status " + (type || "info");
      }

      if (message) {
        const toastType = type === "error" ? "error" : (type === "success" ? "success" : "info");
        const toastTitle = type === "error" ? "Action failed" : (type === "success" ? "Action complete" : "Information");
        showToast(toastTitle, message, toastType);
      }
    }


    let pendingRetentionConfirmResolve = null;

    function requestRetentionCleanupConfirmation() {
      $("retentionConfirmText").value = "";
      setLocalStatus("retentionConfirmMessage", "", "");
      $("retentionConfirmModalBackdrop").classList.add("active");
      setTimeout(() => $("retentionConfirmText").focus(), 50);
      return new Promise(resolve => {
        pendingRetentionConfirmResolve = resolve;
      });
    }

    function closeRetentionConfirmModal(result) {
      $("retentionConfirmModalBackdrop").classList.remove("active");
      if (pendingRetentionConfirmResolve) {
        pendingRetentionConfirmResolve(result);
        pendingRetentionConfirmResolve = null;
      }
    }

    async function saveRetentionSettings() {
      await saveSettingsGroup("retention", "Retention Settings");
      if ($("dataGovernanceStatus")) $("dataGovernanceStatus").textContent = "Retention Settings saved successfully.";
      showMessage("Retention Settings saved successfully.", "success");
    }

    async function resetRetentionSettings() {
      await resetSettingsGroup("retention", "Retention Settings");
      if ($("dataGovernanceStatus")) $("dataGovernanceStatus").textContent = "Retention Settings restored to defaults.";
    }

    async function previewRetentionCleanup() {
      clearMessage();
      const result = await supabaseClient.rpc("superuser_preview_retention_cleanup");
      if (result.error) {
        showMessage("Could not preview retention cleanup: " + result.error.message, "error");
        console.error(result.error);
        return;
      }
      renderRetentionResult(result.data || {}, "Preview only");
      await writeAuditEvent("retention_preview", "system_settings", null, {
        action: "preview",
        summary: "Retention cleanup preview run.",
        result: result.data || {}
      });
    }

    async function runRetentionCleanup() {
      clearMessage();
      const mode = settingValue("retention_mode", appSettings.retentionMode);
      if (mode !== "allow_manual_apply") {
        showMessage("Retention cleanup is in Preview only mode. Change Retention run mode before applying.", "error");
        return;
      }
      const confirmed = await requestRetentionCleanupConfirmation();
      if (!confirmed) return;

      const result = await supabaseClient.rpc("superuser_run_retention_cleanup");
      if (result.error) {
        showMessage("Could not run retention cleanup: " + result.error.message, "error");
        console.error(result.error);
        return;
      }
      renderRetentionResult(result.data || {}, "Cleanup applied");
      await writeAuditEvent("retention_cleanup_run", "system_settings", null, {
        action: "manual_apply",
        summary: "Retention cleanup manually applied.",
        result: result.data || {}
      });
      setLocalStatus("retentionSettingsStatus", "Retention cleanup completed.", "success");
      showMessage("Retention cleanup completed.", "success");
    }


    function loadCurrentFileVersionIntoSettings() {
      if ($("settingCurrentAppVersion")) $("settingCurrentAppVersion").value = APP_VERSION;
      setLocalStatus("deploymentSettingsStatus", "Current file version loaded. Save to make it expected production version.", "success");
    }

    async function saveDeploymentSettings() {
      setLocalStatus("deploymentSettingsStatus", "Saving deployment settings...", "info");
      await saveSettingsGroup("deployment", "Deployment Settings");
      setLocalStatus("deploymentSettingsStatus", "Deployment settings saved.", "success");
      await refreshDeploymentVersionStatus();
    }

    function renderDeploymentVersionStatus(devices) {
      const box = $("deploymentVersionStatus");
      if (!box) return;

      const expected = settingValue("current_app_version", appSettings.currentAppVersion || APP_VERSION);
      const warnEnabled = !!settingValue("outdated_device_warning_enabled", true);
      const rows = devices || [];

      if (!rows.length) {
        box.innerHTML = "<div class='row-meta'>No kiosk devices found.</div>";
        return;
      }

      box.innerHTML = rows.map(d => {
        const actual = d.last_app_version || "-";
        const status = !d.active ? "Disabled" : (actual === expected ? "Up to date" : (warnEnabled ? "Outdated / unknown" : "Warning disabled"));
        return "<div class='health-item'><strong>" + safe(d.device_name || d.id) + "</strong><span>" +
          "Status: " + safe(status) + "<br>" +
          "Expected: " + safe(expected) + "<br>" +
          "Actual: " + safe(actual) + "<br>" +
          "Last seen: " + safe(d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "-") +
          "</span></div>";
      }).join("");
    }

    async function refreshDeploymentVersionStatus() {
      if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") return;
      const result = await supabaseClient.rpc("superuser_list_kiosk_devices");
      if (result.error) {
        if ($("deploymentVersionStatus")) $("deploymentVersionStatus").innerHTML = "Could not load kiosk devices: " + safe(result.error.message);
        return;
      }
      renderDeploymentVersionStatus(result.data || []);
    }





    async function saveEmailProcessorSettings() {
      setLocalStatus("emailProcessorStatus", "Saving email processor settings...", "info");
      await saveSettingsGroup("emailProcessor", "Email Processor");
      setLocalStatus("emailProcessorStatus", "Email processor settings saved.", "success");
    }

    async function runEmailProcessorNow() {
      try {
        const url = settingValue("email_edge_function_url", appSettings.emailEdgeFunctionUrl || "");

        if (!url) {
          setLocalStatus("emailProcessorStatus", "Email Edge Function URL is not configured.", "error");
          return;
        }

        setLocalStatus("emailProcessorStatus", "Running email processor...", "info");

        const result = await callEmailEdgeFunction({
          mode: "processor",
          sender_name: settingValue("email_sender_name", appSettings.emailSenderName || "Visitor Management"),
          sender_email: settingValue("email_sender_address", appSettings.emailSenderAddress || "onboarding@resend.dev"),
          limit: Number(settingValue("email_processor_batch_size", appSettings.emailProcessorBatchSize || 25))
        });

        const message = "Email processor complete. Sent: " + (result.sent || 0) +
          ", failed: " + (result.failed || 0) +
          ", skipped: " + (result.skipped || 0) +
          (result.results ? ", processed: " + result.results.length : "");

        setLocalStatus("emailProcessorStatus", message, "success");
        setLocalStatus("notificationStatus", message, "success");
        showMessage(message, "success");
        await loadNotificationQueue();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setLocalStatus("emailProcessorStatus", "Email processor failed: " + message, "error");
        showMessage("Email processor failed: " + message, "error");
        await loadNotificationQueue();
      }
    }

    async function saveNotificationTriggerSettings() {
      setLocalStatus("notificationTriggerStatus", "Saving notification trigger settings...", "info");
      await saveSettingsGroup("notificationTriggers", "Notification Triggers");
      setLocalStatus("notificationTriggerStatus", "Notification trigger settings saved.", "success");
    }

    async function runNotificationTriggerCheckNow() {
      setLocalStatus("notificationTriggerStatus", "Running notification trigger check...", "info");

      const result = await supabaseClient.rpc("superuser_run_notification_trigger_check");

      if (result.error) {
        setLocalStatus("notificationTriggerStatus", "Trigger check failed: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const data = result.data || {};
      setLocalStatus(
        "notificationTriggerStatus",
        "Trigger check complete. GDPR queued: " + (data.gdpr_due_queued || 0) +
          ", kiosk offline queued: " + (data.kiosk_offline_queued || 0) + ".",
        "success"
      );

      await loadNotificationQueue();
    }

    async function saveEmailSettings() {
      setLocalStatus("emailSettingsStatus", "Saving email settings...", "info");
      await saveSettingsGroup("emailDelivery", "Email Delivery");
      setLocalStatus("emailSettingsStatus", "Email settings saved.", "success");
    }

    async function callEmailEdgeFunction(payload) {
      const url = settingValue("email_edge_function_url", appSettings.emailEdgeFunctionUrl || "");
      if (!url) throw new Error("Email Edge Function URL is not configured.");

      const sessionResult = await supabaseClient.auth.getSession();
      const token = sessionResult && sessionResult.data && sessionResult.data.session
        ? sessionResult.data.session.access_token
        : null;

      if (!token) throw new Error("No authenticated session token available.");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      });

      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }

      if (!response.ok) throw new Error(data.error || data.message || ("Email function failed: HTTP " + response.status));
      return data;
    }

    async function sendTestEmail() {
      try {
        const recipient = $("testEmailRecipient") ? $("testEmailRecipient").value.trim() : "";
        if (!recipient) {
          setLocalStatus("emailSettingsStatus", "Enter a test recipient email.", "error");
          return;
        }

        setLocalStatus("emailSettingsStatus", "Sending test email...", "info");
        await callEmailEdgeFunction({
          mode: "single",
          notification_type: "test_email",
          to: recipient,
          sender_name: settingValue("email_sender_name", appSettings.emailSenderName || "Visitor Management"),
          sender_email: settingValue("email_sender_address", appSettings.emailSenderAddress || "onboarding@resend.dev"),
          subject: "VMS test email",
          body: "This is a test email from the Visitor Management System.",
          payload: { source: "VMS_035A.1" }
        });

        setLocalStatus("emailSettingsStatus", "Test email sent.", "success");
        showMessage("Test email sent.", "success");
      } catch (err) {
        setLocalStatus("emailSettingsStatus", err.message, "error");
        showMessage("Could not send test email: " + err.message, "error");
      }
    }

    async function sendPendingEmails() {
      try {
        const url = settingValue("email_edge_function_url", appSettings.emailEdgeFunctionUrl || "");

        if (!url) {
          setLocalStatus("emailSettingsStatus", "Email Edge Function URL is not configured.", "error");
          setLocalStatus("notificationStatus", "Email Edge Function URL is not configured.", "error");
          return;
        }

        if (!settingValue("email_delivery_enabled", appSettings.emailDeliveryEnabled || false)) {
          setLocalStatus("emailSettingsStatus", "Email delivery is disabled. Enable it before sending pending emails.", "error");
          setLocalStatus("notificationStatus", "Email delivery is disabled. Enable it before sending pending emails.", "error");
          return;
        }

        setLocalStatus("emailSettingsStatus", "Calling Edge Function to send pending email notifications...", "info");
        setLocalStatus("notificationStatus", "Calling Edge Function to send pending email notifications...", "info");

        const result = await callEmailEdgeFunction({
          mode: "processor",
          sender_name: settingValue("email_sender_name", appSettings.emailSenderName || "Visitor Management"),
          sender_email: settingValue("email_sender_address", appSettings.emailSenderAddress || "onboarding@resend.dev"),
          limit: 25
        });

        const message =
          "Pending email send completed. Sent: " + (result.sent || 0) +
          ", failed: " + (result.failed || 0) +
          (result.results ? ", processed: " + result.results.length : "");

        setLocalStatus("emailSettingsStatus", message, "success");
        setLocalStatus("notificationStatus", message, "success");
        showMessage(message, "success");
        await loadNotificationQueue();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setLocalStatus("emailSettingsStatus", message, "error");
        setLocalStatus("notificationStatus", "Could not send pending emails: " + message, "error");
        showMessage("Could not send pending emails: " + message, "error");
        await loadNotificationQueue();
      }
    }



    async function processVisitorArrivalEmailImmediately(visitId) {
      try {
        if (!visitId) return null;

        if (!settingValue("immediate_host_email_on_sign_in", appSettings.immediateHostEmailOnSignIn)) {
          console.log("Immediate host email skipped: setting disabled.");
          return null;
        }

        const url = settingValue("email_edge_function_url", appSettings.emailEdgeFunctionUrl || "");
        if (!url) {
          console.warn("Immediate host email skipped: Edge Function URL is not configured.");
          return null;
        }

        const result = await callEmailEdgeFunction({
          mode: "visitor_arrival_only",
          visit_log_id: visitId,
          sender_name: settingValue("email_sender_name", appSettings.emailSenderName || "Visitor Management"),
          sender_email: settingValue("email_sender_address", appSettings.emailSenderAddress || "onboarding@resend.dev"),
          limit: 10
        });

        console.log("Immediate visitor-arrival email processor result", result);

        if (AppState.currentProfile && AppState.currentProfile.role === "super_user") {
          setLocalStatus(
            "emailProcessorStatus",
            "Immediate visitor-arrival email result. Sent: " + (result.sent || 0) +
              ", failed: " + (result.failed || 0) +
              ", skipped: " + (result.skipped || 0),
            result.failed ? "error" : "success"
          );
        }

        return result;
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.warn("Immediate host email failed. Notification remains in queue for retry.", err);

        if (AppState.currentProfile && AppState.currentProfile.role === "super_user") {
          setLocalStatus("emailProcessorStatus", "Immediate host email failed: " + message, "error");
        }

        return null;
      }
    }

    async function queueVisitorArrivalNotification(visitId) {
      try {
        if (!visitId) {
          console.warn("Visitor arrival notification skipped: no visit_log_id found.");
          return;
        }

        if (!settingValue("notify_host_on_visitor_arrival", appSettings.notifyHostOnVisitorArrival)) {
          console.log("Visitor arrival notification skipped: trigger disabled.");
          return;
        }

        const result = await supabaseClient.rpc("create_visitor_arrival_notification", {
          p_visit_log_id: visitId
        });

        if (result.error) {
          console.warn("Could not queue visitor arrival notification", result.error);
          return;
        }

        if (result.data) {
          console.log("Visitor arrival notification queued", result.data);
          await processVisitorArrivalEmailImmediately(visitId);
        } else {
          console.log("Visitor arrival notification not queued: no valid recipient or template disabled.");
        }
      } catch (err) {
        console.warn("Could not queue visitor arrival notification", err);
      }
    }

    let notificationTemplatesCache = [];
    let notificationQueueCache = [];

    function renderNotificationDashboard(items) {
      const box = $("notificationDashboard");
      if (!box) return;

      const rows = items || [];
      const pending = rows.filter(n => n.status === "pending").length;
      const sent = rows.filter(n => n.status === "sent").length;
      const failed = rows.filter(n => n.status === "failed").length;

      box.innerHTML =
        statCard("Pending", pending) +
        statCard("Sent", sent) +
        statCard("Failed", failed) +
        statCard("Total Loaded", rows.length);
    }


    let lastNotificationTemplateField = null;

    const notificationPlaceholders = [
      { token: "{{visitor_name}}", description: "Visitor full name" },
      { token: "{{company}}", description: "Visitor company" },
      { token: "{{host_name}}", description: "Host / person being visited" },
      { token: "{{location}}", description: "Reception or kiosk location" },
      { token: "{{device_name}}", description: "Kiosk device name" },
      { token: "{{last_seen_at}}", description: "Last kiosk heartbeat time" },
      { token: "{{case_reference}}", description: "GDPR case reference" },
      { token: "{{requester_name}}", description: "GDPR requester / data subject" },
      { token: "{{due_date}}", description: "GDPR due date" },
      { token: "{{app_version}}", description: "Application version" },
      { token: "{{sign_in_time}}", description: "Visitor sign-in time" },
      { token: "{{sign_out_time}}", description: "Visitor sign-out time" },
      { token: "{{visit_reason}}", description: "Visit reason" },
      { token: "{{vehicle_plate}}", description: "Vehicle registration" },
      { token: "{{security_pass_id}}", description: "Security pass ID" }
    ];

    function trackNotificationTemplateFieldFocus() {
      ["notificationTemplateSubject", "notificationTemplateBody"].forEach(id => {
        const el = $(id);
        if (!el || el.dataset.placeholderFocusBound === "true") return;
        el.addEventListener("focus", () => {
          lastNotificationTemplateField = el;
        });
        el.addEventListener("click", () => {
          lastNotificationTemplateField = el;
        });
        el.addEventListener("keyup", () => {
          lastNotificationTemplateField = el;
        });
        el.dataset.placeholderFocusBound = "true";
      });
    }

    function insertNotificationPlaceholder(token) {
      const target = lastNotificationTemplateField || $("notificationTemplateBody") || $("notificationTemplateSubject");
      if (!target) return;

      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const before = target.value.slice(0, start);
      const after = target.value.slice(end);

      target.value = before + token + after;
      target.focus();
      target.selectionStart = target.selectionEnd = start + token.length;
    }

    function renderNotificationPlaceholders() {
      const box = $("notificationPlaceholderList");
      if (!box) return;

      box.innerHTML = "";
      notificationPlaceholders.forEach(item => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "placeholder-token";
        chip.textContent = item.token;
        chip.title = item.description;
        chip.addEventListener("click", () => insertNotificationPlaceholder(item.token));
        chip.addEventListener("dblclick", () => insertNotificationPlaceholder(item.token));
        box.appendChild(chip);
      });
    }

    function openNotificationTemplateModal(template) {
      $("notificationTemplateModalTitle").textContent = template ? "Edit Notification Template" : "Create Notification Template";
      $("notificationTemplateId").value = template?.id || "";
      $("notificationTemplateKey").value = template?.template_key || "";
      $("notificationTemplateChannel").value = template?.channel || "email";
      $("notificationTemplateSubject").value = template?.subject || "";
      $("notificationTemplateBody").value = template?.body || "";
      $("notificationTemplateEnabled").value = String(template?.enabled !== false);
      $("notificationTemplateModalMessage").textContent = "";
      $("notificationTemplateModalMessage").className = "modal-message";
      renderNotificationPlaceholders();
      trackNotificationTemplateFieldFocus();
      lastNotificationTemplateField = $("notificationTemplateBody");
      $("notificationTemplateModalBackdrop").classList.add("active");
      setTimeout(() => $("notificationTemplateKey").focus(), 50);
    }

    function closeNotificationTemplateModal() {
      $("notificationTemplateModalBackdrop").classList.remove("active");
    }

    async function saveNotificationTemplate() {
      const payload = {
        p_template_id: $("notificationTemplateId").value || null,
        p_template_key: $("notificationTemplateKey").value.trim(),
        p_channel: $("notificationTemplateChannel").value,
        p_subject: $("notificationTemplateSubject").value.trim(),
        p_body: $("notificationTemplateBody").value.trim(),
        p_enabled: $("notificationTemplateEnabled").value === "true"
      };

      if (!payload.p_template_key || !payload.p_subject || !payload.p_body) {
        $("notificationTemplateModalMessage").textContent = "Template key, subject and body are required.";
        $("notificationTemplateModalMessage").className = "modal-message error";
        return;
      }

      const result = await supabaseClient.rpc("superuser_upsert_notification_template", payload);

      if (result.error) {
        $("notificationTemplateModalMessage").textContent = result.error.message;
        $("notificationTemplateModalMessage").className = "modal-message error";
        console.error(result.error);
        return;
      }

      closeNotificationTemplateModal();
      setLocalStatus("notificationStatus", "Notification template saved.", "success");
      await loadNotificationTemplates();
    }

    function renderNotificationTemplates(rows) {
      const box = $("notificationTemplateList");
      if (!box) return;

      notificationTemplatesCache = rows || [];

      if (!notificationTemplatesCache.length) {
        box.innerHTML = "<div class='row-meta'>No notification templates found.</div>";
        return;
      }

      box.innerHTML = "";

      notificationTemplatesCache.forEach(row => {
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML =
          "<div class='row-title'>" + safe(row.template_key) + "</div>" +
          "<div class='row-meta'>" +
          "Channel: " + safe(row.channel) + "<br>" +
          "Enabled: " + (row.enabled ? "Yes" : "No") + "<br>" +
          "Subject: " + safe(row.subject) + "<br>" +
          "Updated: " + safe(row.updated_at ? new Date(row.updated_at).toLocaleString() : "-") +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary";
        edit.textContent = "Edit Template";
        edit.addEventListener("click", () => openNotificationTemplateModal(row));
        actions.appendChild(edit);
        div.appendChild(actions);
        box.appendChild(div);
      });
    }

    async function loadNotificationTemplates() {
      const result = await supabaseClient.rpc("superuser_list_notification_templates");

      if (result.error) {
        setLocalStatus("notificationStatus", "Could not load templates: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      renderNotificationTemplates(result.data || []);
    }

    function renderNotificationQueue(rows) {
      const box = $("notificationQueueList");
      if (!box) return;

      notificationQueueCache = (rows || []).filter(n => n.channel !== "in_app");
      renderNotificationDashboard(notificationQueueCache);

      if (!notificationQueueCache.length) {
        box.innerHTML = "<div class='row-meta'>No notifications found.</div>";
        return;
      }

      box.innerHTML = "";

      notificationQueueCache.forEach(row => {
        const div = document.createElement("div");
        div.className = "row";
        div.dataset.notificationId = row.id;

        div.innerHTML =
          "<div class='row-title'>" + safe(row.notification_type) + " — " + safe(row.status) + "</div>" +
          "<div class='row-meta'>" +
          "ID: " + safe(row.id || "-") + "<br>" +
          "Channel: " + safe(row.channel || "-") + "<br>" +
          "Recipient: " + safe(row.recipient || "-") + "<br>" +
          "Subject: " + safe(row.subject || "-") + "<br>" +
          "Created: " + safe(row.created_at ? new Date(row.created_at).toLocaleString() : "-") + "<br>" +
          "Sent: " + safe(row.sent_at ? new Date(row.sent_at).toLocaleString() : "-") + "<br>" +
          "Error: " + safe(row.error_message || "-") +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        if (row.status === "failed" || row.status === "cancelled") {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "secondary";
          retry.textContent = "Retry";
          retry.addEventListener("click", () => updateNotificationQueueItem(row.id, "retry", retry));
          actions.appendChild(retry);
        }

        if (row.status === "pending" || row.status === "failed") {
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "secondary";
          cancel.textContent = "Cancel";
          cancel.addEventListener("click", () => updateNotificationQueueItem(row.id, "cancel", cancel));
          actions.appendChild(cancel);
        }

        const del = document.createElement("button");
        del.type = "button";
        del.className = "danger";
        del.textContent = "Delete";
        del.addEventListener("click", () => updateNotificationQueueItem(row.id, "delete", del));
        actions.appendChild(del);

        div.appendChild(actions);
        box.appendChild(div);
      });
    }

    async function updateNotificationQueueItem(notificationId, action, sourceButton, sourceArea) {
      if (!notificationId || !action) {
        setLocalStatus("notificationStatus", "Missing notification id/action.", "error");
        return;
      }

      if (sourceButton) {
        sourceButton.disabled = true;
        sourceButton.textContent = action === "delete" ? "Deleting..." : action === "cancel" ? "Cancelling..." : "Retrying...";
      }

      setLocalStatus("notificationStatus", "Applying queue action: " + action + "...", "info");

      const result = await supabaseClient.rpc("superuser_update_notification_status", {
        p_notification_id: notificationId,
        p_action: action
      });

      if (result.error) {
        const message = "Could not update notification: " + result.error.message;
        setLocalStatus("notificationStatus", message, "error");
        showMessage(message, "error");
        console.error(result.error);
        if (sourceButton) {
          sourceButton.disabled = false;
          sourceButton.textContent = action === "delete" ? "Delete" : action === "cancel" ? "Cancel" : "Retry";
        }
        return;
      }

      setLocalStatus("notificationStatus", "Notification action applied: " + action + ".", "success");
      showMessage("Notification action applied: " + action + ".", "success");
      await loadNotificationQueue();
    }


    async function loadNotificationQueue() {
      const result = await supabaseClient.rpc("superuser_list_notifications", {
        p_status: $("notificationStatusFilter") ? $("notificationStatusFilter").value || null : null,
        p_notification_type: $("notificationTypeFilter") ? $("notificationTypeFilter").value.trim() || null : null
      });

      if (result.error) {
        setLocalStatus("notificationStatus", "Could not load notifications: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      renderNotificationQueue(result.data || []);
      setLocalStatus("notificationStatus", "Notifications loaded.", "success");
    }


    let inAppNotificationsCache = [];

    function renderInAppNotifications(rows) {
      const box = $("inAppNotificationList");
      if (!box) return;

      inAppNotificationsCache = rows || [];

      if (!inAppNotificationsCache.length) {
        box.innerHTML = "<div class='row-meta'>No in-app notifications found.</div>";
        return;
      }

      box.innerHTML = "";

      inAppNotificationsCache.forEach(row => {
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML =
          "<div class='row-title'>" + safe(row.subject || row.notification_type) + "</div>" +
          "<div class='row-meta'>" +
          "Type: " + safe(row.notification_type || "-") + "<br>" +
          "Status: " + safe(row.status || "-") + "<br>" +
          "Created: " + safe(row.created_at ? new Date(row.created_at).toLocaleString() : "-") + "<br>" +
          safe(row.body || "") +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        if (row.status === "pending") {
          const ack = document.createElement("button");
          ack.type = "button";
          ack.className = "secondary";
          ack.textContent = "Acknowledge";
          ack.addEventListener("click", () => updateNotificationQueueItem(row.id, "acknowledge", ack, "in_app"));
          actions.appendChild(ack);
        }

        const del = document.createElement("button");
        del.type = "button";
        del.className = "danger";
        del.textContent = "Delete";
        del.addEventListener("click", () => updateNotificationQueueItem(row.id, "delete", del, "in_app"));
        actions.appendChild(del);

        div.appendChild(actions);
        box.appendChild(div);
      });
    }

    async function loadInAppNotifications() {
      const result = await supabaseClient.rpc("superuser_list_notifications", {
        p_status: null,
        p_notification_type: null
      });

      if (result.error) {
        setLocalStatus("inAppNotificationStatus", "Could not load in-app notifications: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const rows = (result.data || []).filter(n => n.channel === "in_app");
      renderInAppNotifications(rows);
      setLocalStatus("inAppNotificationStatus", "In-app notifications loaded.", "success");
    }

    async function acknowledgeAllInAppNotifications() {
      setLocalStatus("inAppNotificationStatus", "Acknowledging in-app notifications...", "info");

      const result = await supabaseClient.rpc("superuser_acknowledge_all_in_app_notifications");

      if (result.error) {
        setLocalStatus("inAppNotificationStatus", "Could not acknowledge notifications: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      setLocalStatus("inAppNotificationStatus", "In-app notifications acknowledged: " + (result.data?.updated || 0), "success");
      if (typeof loadInAppNotifications === "function") await loadInAppNotifications();
      await loadNotificationQueue();
    }

    async function refreshNotifications() {
      setLocalStatus("notificationStatus", "Refreshing notifications...", "info");
      await loadNotificationTemplates();
      await loadNotificationQueue();
      if (typeof loadInAppNotifications === "function") await loadInAppNotifications();
      setLocalStatus("notificationStatus", "Notification centre refreshed.", "success");
    }

    async function createTestNotification() {
      const recipient = $("testEmailRecipient") ? $("testEmailRecipient").value.trim() : "";

      if (!recipient) {
        setLocalStatus("notificationStatus", "Enter a real email address in Test recipient first.", "error");
        setLocalStatus("emailSettingsStatus", "Enter a real email address in Test recipient first.", "error");
        return;
      }

      const result = await supabaseClient.rpc("superuser_create_notification", {
        p_notification_type: "test_email_queue",
        p_channel: "email",
        p_recipient: recipient,
        p_subject: "VMS queued test email",
        p_body: "This queued test email was generated from the VMS Notification Centre.",
        p_payload: { source: "VMS_035A.1", test_type: "queued_email" }
      });

      if (result.error) {
        setLocalStatus("notificationStatus", "Could not create queued test email: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      setLocalStatus("notificationStatus", "Queued test email created for " + recipient + ".", "success");
      await loadNotificationQueue();
    }


    async function refreshSystemHealth() {
      const box = $("systemHealthResults");
      if (!box) return;

      box.innerHTML = "<div class='row-meta'>Running health check...</div>";

      try {
        const safePlanned = (typeof AppState.plannedTodayCache !== "undefined" && Array.isArray(AppState.plannedTodayCache)) ? AppState.plannedTodayCache : [];
        const safeActive = (typeof activeVisitCache !== "undefined" && Array.isArray(activeVisitCache)) ? activeVisitCache : [];
        const safeSettings = (typeof AppState.systemSettingsRaw !== "undefined" && AppState.systemSettingsRaw) ? AppState.systemSettingsRaw : {};

        const health = {
          appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
          checkedAt: new Date().toISOString(),
          currentUser: AppState.currentProfile ? AppState.currentProfile.display_name : null,
          currentRole: AppState.currentProfile ? AppState.currentProfile.role : null,
          supabaseConnected: false,
          authSession: false,
          kioskTokenPresent: false,
          kioskTokenValid: false,
          settingsCount: Object.keys(safeSettings).length,
          lastSettingsRefreshAt: lastSettingsRefreshAt ? lastSettingsRefreshAt.toISOString() : null,
          lastDataRefreshAt: lastDataRefreshAt ? lastDataRefreshAt.toISOString() : null,
          plannedToday: safePlanned.length,
          currentlySignedIn: safeActive.length,
          browser_context: null,
          browser: navigator.userAgent,
          url: window.location.href,
          screen: window.screen ? (window.screen.width + "x" + window.screen.height) : "",
          viewport: window.innerWidth + "x" + window.innerHeight
        };

        try {
          health.kioskTokenPresent = !!getKioskToken();
        } catch (tokenErr) {
          health.kioskTokenError = tokenErr.message;
        }

        try {
          health.browser_context = getBrowserAuditContext();
        } catch (ctxErr) {
          health.browserContextError = ctxErr.message;
        }

        const session = await supabaseClient.auth.getSession();
        health.authSession = !!(session.data && session.data.session);

        const ping = await supabaseClient.from("system_settings").select("setting_key").limit(1);
        health.supabaseConnected = !ping.error;
        if (ping.error) health.supabaseError = ping.error.message;

        if (health.kioskTokenPresent && AppState.currentProfile && AppState.currentProfile.role === "kiosk_user") {
          const tokenCheck = await supabaseClient.rpc("validate_kiosk_device_token", { p_kiosk_token: getKioskToken() });
          health.kioskTokenValid = !tokenCheck.error && tokenCheck.data === true;
          if (tokenCheck.error) health.kioskTokenError = tokenCheck.error.message;
        }

        if (AppState.currentProfile && AppState.currentProfile.role === "super_user") {
          const devicesResult = await supabaseClient.rpc("superuser_list_kiosk_devices");
          if (!devicesResult.error) {
            const devices = devicesResult.data || [];
            const seenDevices = devices.filter(d => d.last_seen_at);
            seenDevices.sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());

            if (seenDevices.length > 0) {
              health.latestSavedKioskDevice = seenDevices[0].device_name || seenDevices[0].id;
              health.latestSavedKioskHeartbeatAt = seenDevices[0].last_seen_at;
              health.latestSavedKioskAppVersion = seenDevices[0].last_app_version || "-";
            }
          } else {
            health.kioskDeviceListError = devicesResult.error.message;
          }
        }

        lastHealthCheck = health;

        box.innerHTML =
          healthItem("Application Version", health.appVersion) +
          healthItem("Database Connection", health.supabaseConnected ? "🟢 Connected" : "🔴 Failed") +
          healthItem("Authentication Session", health.authSession ? "🟢 Valid" : "🔴 Not signed in") +
          healthItem("Current User", (health.currentUser || "-") + " / " + (health.currentRole || "-")) +
          healthItem("Kiosk Token Present", health.kioskTokenPresent ? "Yes" : "No") +
          healthItem("Kiosk Token Valid", health.kioskTokenValid ? "Yes" : (health.currentRole === "kiosk_user" ? "No" : "N/A")) +
          healthItem("Last Kiosk Heartbeat This Session", health.lastKioskHeartbeatAt || "-") +
          healthItem("This Session Heartbeat Status", health.lastKioskHeartbeatStatus || "-") +
          healthItem("Latest Saved Kiosk Device", health.latestSavedKioskDevice || "-") +
          healthItem("Latest Saved Kiosk Heartbeat", health.latestSavedKioskHeartbeatAt || "-") +
          healthItem("Latest Saved Kiosk Version", health.latestSavedKioskAppVersion || "-") +
          healthItem("Settings Loaded", health.settingsCount + " setting(s)") +
          healthItem("Retention Planned Days", settingValue("retention_planned_days", appSettings.retentionPlannedDays)) +
          healthItem("Retention Visit Log Days", settingValue("retention_visit_log_days", appSettings.retentionVisitLogDays)) +
          healthItem("Retention Audit Days", settingValue("retention_audit_days", appSettings.retentionAuditDays)) +
          healthItem("Planned No-Show Retention Days", settingValue("planned_no_show_retention_days", appSettings.plannedNoShowRetentionDays)) +
          healthItem("Last Daily Maintenance", settingValue("last_daily_maintenance_date", "-")) +
          healthItem("Last Settings Refresh", health.lastSettingsRefreshAt || "-") +
          healthItem("Last Data Refresh", health.lastDataRefreshAt || "-") +
          healthItem("Planned Today Cache", health.plannedToday) +
          healthItem("Currently Signed In Cache", health.currentlySignedIn) +
          healthItem("Screen / Viewport", health.screen + " / " + health.viewport) +
          healthItem("Hosting URL", health.url);

        if (health.supabaseError || health.browserContextError || health.kioskTokenError) {
          box.innerHTML += healthItem("Warnings", [health.supabaseError, health.browserContextError, health.kioskTokenError, health.kioskDeviceListError].filter(Boolean).join(" | "));
        }
      } catch (err) {
        box.innerHTML =
          healthItem("Health Check", "🔴 Failed") +
          healthItem("Error", err.message || String(err));
        console.error("System health check failed:", err);
      }
    }


    function exportSystemHealth() {
      if (!lastHealthCheck) {
        showMessage("Run the health check before exporting diagnostics.", "error");
        return;
      }

      const blob = new Blob([JSON.stringify(lastHealthCheck, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "VMS_Diagnostics_" + APP_VERSION + "_" + exportDateStamp() + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function loadSuperDashboard() {
      const today = todayDate();

      const plannedToday = await supabaseClient
        .from("planned_visits")
        .select("id")
        .eq("visit_date", today);

      const allLogs = await supabaseClient
        .from("visit_log")
        .select("id, sign_in_time, sign_out_time");

      const logs = allLogs.data || [];
      const active = logs.filter(r => !r.sign_out_time);
      const visitsToday = logs.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) === today);
      const overdue = active.filter(r => r.sign_in_time && r.sign_in_time.slice(0,10) < today);

      $("superDashboard").innerHTML =
        statCard("Expected Today", (plannedToday.data || []).length) +
        statCard("Visits Today", visitsToday.length) +
        statCard("Currently On Site", active.length) +
        statCard("Overdue Sign Outs", overdue.length);

      if ($("superAlertContent")) {
        if (overdue.length > 0) {
          $("superAlertContent").innerHTML =
            "<div class='lock-note'>⚠ " + overdue.length + " visitor(s) are still signed in from previous days.</div>";
        } else {
          $("superAlertContent").innerHTML =
            "<div class='row-meta'>No overdue sign-outs detected.</div>";
        }
      }
    }

    function statCard(label, value) {
      return "<div class='stat-card'><div class='stat-value'>" + value + "</div><div class='stat-label'>" + label + "</div></div>";
    }

    async function reloadOpenStaffPanel() {
      if ($("generalPanel").classList.contains("active")) {
        await searchPlanned("generalResults", $("generalSearchDate").value, "", true, true, false);
      }

      if ($("securityPanel").classList.contains("active")) {
        await loadSecurityDashboard();
        await loadSecurityPlanned();
        await loadSecurityHistory();
      }

      if ($("superPanel").classList.contains("active")) {
        await loadSuperDashboard();
        await loadSuperPlanned();
        await loadSuperHistory();
      }
    }

    async function runOpportunisticAutoSignOutCheck() {
      if (AppState.opportunisticAutoSignOutChecked) return;
      AppState.opportunisticAutoSignOutChecked = true;

      if (!AppState.currentProfile || !(AppState.currentProfile.role === "security" || AppState.currentProfile.role === "super_user")) return;

      const enabled = settingValue("auto_end_of_day_sign_out_enabled", true);
      if (!enabled) return;

      const result = await supabaseClient.rpc("run_end_of_day_auto_sign_out");

      if (result.error) {
        console.warn("Opportunistic auto sign-out check failed:", result.error);
        return;
      }

      const count = result.data == null ? 0 : result.data;

      if (count > 0) {
        await writeAuditEvent("auto_sign_out_run", "visit_log", null, {
          records_updated: count,
          trigger: "opportunistic_staff_open"
        });

        showMessage("Automatic sign-out completed for " + count + " overdue visitor(s).", "success");
        await refreshCoreData();
      }
    }

    async function runAutoSignOut(statusElementId) {
      clearMessage();

      if (!confirm("Automatically sign out overdue active visitors?")) return;

      const statusBox = $(statusElementId);
      if (statusBox) statusBox.textContent = "Running automatic sign-out...";

      const result = await supabaseClient.rpc("run_end_of_day_auto_sign_out");

      if (result.error) {
        if (statusBox) statusBox.textContent = "Auto sign-out failed.";
        showMessage("Auto sign-out failed: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const count = result.data == null ? 0 : result.data;
      await writeAuditEvent("auto_sign_out_run", "visit_log", null, { records_updated: count });
      if (statusBox) statusBox.textContent = "Auto sign-out completed. Records updated: " + count;
      showMessage("Auto sign-out completed. Records updated: " + count, "success");

      await refreshCoreData();
      await reloadOpenStaffPanel();
    }

    async function loadSecurityPlanned() {
      AppState.securityPlannedCache = await searchPlanned("securityPlannedResults", $("securityPlannedDate").value, "", false, false, true);
    }

    async function loadSecurityHistory() {
      AppState.securityHistoryCache = await searchHistory(
        "securityHistoryResults",
        $("securityFromDate").value,
        $("securityToDate").value,
        $("securityNameSearch").value,
        false,
        false,
        true,
        {
          status: $("securityStatusFilter").value,
          origin: $("securityOriginFilter").value,
          company: $("securityCompanySearch").value,
          securityPass: $("securityPassSearch").value,
          vehicle: $("securityVehicleSearch").value,
          contact: $("securityContactSearch").value
        }
      );
    }

    async function showSecurityOverdue() {
      $("securityStatusFilter").value = "overdue";
      $("securityFromDate").value = "";
      $("securityToDate").value = todayDate();
      await loadSecurityHistory();
    }

    async function showSecurityCurrentlySignedIn() {
      $("securityStatusFilter").value = "signed_in";
      $("securityFromDate").value = "";
      $("securityToDate").value = "";
      await loadSecurityHistory();
    }

    async function loadSuperPlanned() {
      AppState.superPlannedCache = await searchPlanned("superPlannedResults", $("superPlannedDate").value, $("superNameSearch").value, true, true, false);
    }

    async function loadSuperHistory() {
      AppState.superHistoryCache = await searchHistory(
        "superHistoryResults",
        $("superFromDate").value,
        $("superToDate").value,
        $("superHistoryNameSearch").value,
        true,
        true,
        false,
        {
          status: $("superStatusFilter").value,
          origin: $("superOriginFilter").value,
          company: $("superCompanySearch").value,
          securityPass: $("superPassSearch").value,
          vehicle: $("superVehicleSearch").value,
          contact: $("superContactSearch").value
        }
      );
    }

    async function showSuperOverdue() {
      $("superStatusFilter").value = "overdue";
      $("superFromDate").value = "";
      $("superToDate").value = todayDate();
      await loadSuperHistory();
    }

    async function showSuperCurrentlySignedIn() {
      $("superStatusFilter").value = "signed_in";
      $("superFromDate").value = "";
      $("superToDate").value = "";
      await loadSuperHistory();
    }

    function buildCompactPlannedPrintHtml(rows, selectedDate, printedBy) {
      const generatedAt = new Date().toLocaleString();
      const companyName = appSettings.companyName || "Visitor Management";
      const bodyRows = (rows || []).map((row, index) => {
        return "<tr>" +
          "<td class='num'>" + (index + 1) + "</td>" +
          "<td>" + printEscape(row.visitor_name) + "</td>" +
          "<td>" + printEscape(row.company) + "</td>" +
          "<td>" + printEscape(formatPrintTime(row.expected_time)) + "</td>" +
          "<td>" + printEscape(row.vehicle_plate) + "</td>" +
          "<td>" + printEscape(row.onsite_contact) + "</td>" +
          "<td>" + printEscape(row.security_pass_id) + "</td>" +
        "</tr>";
      }).join("");

      return "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Planned Visitor List</title>" +
        "<style>" +
        "@page{size:A4 landscape;margin:10mm;}" +
        "*{box-sizing:border-box;}" +
        "body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;font-size:11px;}" +
        ".header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:8px;margin-bottom:8px;}" +
        ".company{font-size:18px;font-weight:900;letter-spacing:-.02em;}" +
        ".title{font-size:15px;font-weight:800;margin-top:2px;}" +
        ".meta{text-align:right;line-height:1.45;color:#374151;font-size:10.5px;}" +
        ".summary{display:flex;justify-content:space-between;border:1px solid #d1d5db;background:#f9fafb;padding:6px 8px;margin-bottom:8px;font-weight:800;}" +
        "table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
        "th{background:#e5e7eb;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.03em;border:1px solid #9ca3af;padding:5px 6px;}" +
        "td{border:1px solid #d1d5db;padding:5px 6px;vertical-align:top;word-wrap:break-word;}" +
        "tr:nth-child(even) td{background:#f9fafb;}" +
        ".num{width:28px;text-align:center;color:#6b7280;}" +
        ".visitor{width:19%;}.companyCol{width:18%;}.time{width:8%;}.vehicle{width:13%;}.contact{width:19%;}.pass{width:12%;}" +
        ".footer{margin-top:8px;color:#6b7280;font-size:9.5px;display:flex;justify-content:space-between;}" +
        "</style></head><body>" +
        "<div class='header'><div><div class='company'>" + printEscape(companyName) + "</div><div class='title'>Planned Visitor List</div></div>" +
        "<div class='meta'>Selected date: <strong>" + printEscape(formatPrintDate(selectedDate)) + "</strong><br>Generated: " + printEscape(generatedAt) + "<br>Generated by: " + printEscape(printedBy || "-") + "</div></div>" +
        "<div class='summary'><span>Total planned visitors: " + (rows ? rows.length : 0) + "</span><span>Security morning printout</span></div>" +
        "<table><thead><tr>" +
        "<th class='num'>#</th><th class='visitor'>Visitor</th><th class='companyCol'>Company</th><th class='time'>Time</th><th class='vehicle'>Vehicle</th><th class='contact'>On-site Contact</th><th class='pass'>Security Pass</th>" +
        "</tr></thead><tbody>" + bodyRows + "</tbody></table>" +
        "<div class='footer'><span>VMS_035A.1 compact planned visit printout</span><span>Printed from Visitor Management Solution</span></div>" +
        "<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},150);});<\/script>" +
        "</body></html>";
    }

    function printPlannedList(rows, selectedDate) {
      if (!rows || rows.length === 0) {
        showMessage("No planned visits are loaded. Please load or search a planned visitor list before printing.", "error");
        return;
      }

      const printedBy = AppState.currentProfile
        ? AppState.currentProfile.display_name + " (" + roleLabel(AppState.currentProfile.role) + ")"
        : "-";

      const html = buildCompactPlannedPrintHtml(rows, selectedDate, printedBy);

      // Do not use noopener/noreferrer here. Some browsers open the tab but block script
      // access to the new document, which leaves the print page blank.
      const printWindow = window.open("", "_blank", "width=1200,height=800");
      if (!printWindow || !printWindow.document) {
        showMessage("The browser blocked the print window. Please allow pop-ups for this site and try again.", "error");
        return;
      }

      printWindow.document.open("text/html", "replace");
      printWindow.document.write(html);
      printWindow.document.close();

      // Fallback for browsers that do not fire load reliably after document.write.
      setTimeout(function () {
        try {
          printWindow.focus();
          if (printWindow.document && printWindow.document.body && printWindow.document.body.children.length > 0) {
            printWindow.print();
          }
        } catch (err) {
          console.warn("Print fallback failed:", err);
        }
      }, 500);
    }

    ["click", "input", "touchstart", "keydown"].forEach(function (eventName) {
      $("signInScreen").addEventListener(eventName, resetKioskIdleTimer);
      $("signOutScreen").addEventListener(eventName, resetKioskIdleTimer);
    });

    $("homeLoginButton").addEventListener("click", openLoginModal);
    $("homeRefreshButton").addEventListener("click", async () => { await loadSystemSettings(); updateHomeAccess(); showMessage("Refreshed.", "success"); });
    $("homeLogoutButton").addEventListener("click", requestProtectedLogout);

    $("openStaffHomeButton").addEventListener("click", openStaffAreaFromProfile);

    $("openSignInButton").addEventListener("click", () => {
      if (!isKioskProfile() && !isSuperKioskTestProfile()) { openLoginModal(); return; }
      try { ensureKioskToken(); } catch (err) { showMessage(err.message, "error"); return; }
      $("plannedFilter").value = "";
      showScreen("signInScreen"); refreshCoreData(); renderPlannedVisitorList();
      setTimeout(() => { if ($("plannedFilter")) $("plannedFilter").focus(); }, 80);
    });
    $("openSignOutButton").addEventListener("click", () => {
      if (!isKioskProfile() && !isSuperKioskTestProfile()) { openLoginModal(); return; }
      try { ensureKioskToken(); } catch (err) { showMessage(err.message, "error"); return; }

      if ($("signOutFilter")) $("signOutFilter").value = "";
      showScreen("signOutScreen");
      refreshCoreData();
      renderActiveVisitorList();
      setTimeout(() => { if ($("signOutFilter")) $("signOutFilter").focus(); }, 80);
    });
    $("staffButton").addEventListener("click", () => {
      if (isKioskProfile()) {
        showScreen("homeScreen");
        showMessage("Kiosk accounts do not have Staff Area access.", "error");
        return;
      }
      openStaffAreaFromProfile();
    });
    $("topbarLogoutButton").addEventListener("click", requestProtectedLogout);
    $("changePasswordTopButton").addEventListener("click", openChangePasswordModal);
    $("staffHeaderLogoutButton").addEventListener("click", requestProtectedLogout);
    document.querySelectorAll(".backHomeButton").forEach(b => b.addEventListener("click", () => showScreen("homeScreen")));

    $("plannedFilter").addEventListener("input", renderPlannedVisitorList);
    if ($("signOutFilter")) $("signOutFilter").addEventListener("input", renderActiveVisitorList);
    $("walkInButton").addEventListener("click", signInWalkIn);
    $("closeWalkInModalButton").addEventListener("click", closeWalkInModal);
    $("cancelWalkInButton").addEventListener("click", closeWalkInModal);
    $("createPlannedButton").addEventListener("click", createPlannedVisit);

    $("roleGeneral").addEventListener("click", () => setRole("general"));
    $("roleSecurity").addEventListener("click", () => setRole("security"));
    $("roleSuper").addEventListener("click", () => setRole("super"));
    if ($("roleKiosk")) $("roleKiosk").addEventListener("click", () => setRole("kiosk"));
    if ($("superOpenKioskSignInButton")) $("superOpenKioskSignInButton").addEventListener("click", openSuperKioskSignIn);
    if ($("superOpenKioskSignOutButton")) $("superOpenKioskSignOutButton").addEventListener("click", openSuperKioskSignOut);
    if ($("superExitKioskTestButton")) $("superExitKioskTestButton").addEventListener("click", exitSuperKioskTestMode);

    $("generalSearchButton").addEventListener("click", () => searchPlanned("generalResults", $("generalSearchDate").value, "", true, true, false));

    $("securityLoadPlannedButton").addEventListener("click", loadSecurityPlanned);
    $("securityHistorySearchButton").addEventListener("click", loadSecurityHistory);
    $("securityRunAutoSignOutButton").addEventListener("click", () => runAutoSignOut("securityAutoSignOutStatus"));
    $("securityOverdueButton").addEventListener("click", showSecurityOverdue);
    $("securityCurrentSignedInButton").addEventListener("click", showSecurityCurrentlySignedIn);
    $("securityPrintPlannedButton").addEventListener("click", () => printPlannedList(AppState.securityPlannedCache, $("securityPlannedDate").value));
    $("securityDownloadPlannedButton").addEventListener("click", () => downloadCsv("planned_visits.csv", AppState.securityPlannedCache));
    $("securityExcelPlannedButton").addEventListener("click", () => exportToExcel(AppState.securityPlannedCache, "VMS_PlannedVisitors_" + ($("securityPlannedDate").value || exportDateStamp()) + ".xlsx", "planned"));
    $("securityDownloadHistoryButton").addEventListener("click", () => downloadCsv("visit_history.csv", AppState.securityHistoryCache));
    $("securityExcelHistoryButton").addEventListener("click", () => exportToExcel(AppState.securityHistoryCache, "VMS_VisitHistory_" + exportDateStamp() + ".xlsx", "history"));

    $("superSearchPlannedButton").addEventListener("click", loadSuperPlanned);
    $("superSearchHistoryButton").addEventListener("click", loadSuperHistory);
    $("superRunAutoSignOutButton").addEventListener("click", () => runAutoSignOut("superAutoSignOutStatus"));
    $("superOverdueButton").addEventListener("click", showSuperOverdue);
    $("superCurrentSignedInButton").addEventListener("click", showSuperCurrentlySignedIn);
    if ($("superPrintPlannedButton")) $("superPrintPlannedButton").addEventListener("click", () => printPlannedList(AppState.superPlannedCache, $("superPlannedDate").value));
    $("superDownloadPlannedButton").addEventListener("click", () => downloadCsv("super_planned_visits.csv", AppState.superPlannedCache));
    $("superExcelPlannedButton").addEventListener("click", () => exportToExcel(AppState.superPlannedCache, "VMS_Super_PlannedVisits_" + exportDateStamp() + ".xlsx", "planned"));
    $("superDownloadHistoryButton").addEventListener("click", () => downloadCsv("super_visit_history.csv", AppState.superHistoryCache));
    $("superExcelHistoryButton").addEventListener("click", () => exportToExcel(AppState.superHistoryCache, "VMS_Super_VisitHistory_" + exportDateStamp() + ".xlsx", "history"));

    if ($("securityLoadPendingAgreementsButton")) $("securityLoadPendingAgreementsButton").addEventListener("click", () => loadPendingAgreements("security"));
    if ($("securityAgreementSearchButton")) $("securityAgreementSearchButton").addEventListener("click", loadSecurityAgreementSearch);
    if ($("securityAgreementDownloadCsvButton")) $("securityAgreementDownloadCsvButton").addEventListener("click", () => downloadCsv("visitor_agreements_security.csv", agreementExportRows(securityAgreementSearchCache)));
    if ($("securityAgreementDownloadExcelButton")) $("securityAgreementDownloadExcelButton").addEventListener("click", () => exportToExcel(agreementExportRows(securityAgreementSearchCache), "VMS_VisitorAgreements_Security_" + exportDateStamp() + ".xlsx", "agreements"));
    if ($("superNavAgreements")) $("superNavAgreements").addEventListener("click", () => showSuperSection("agreements"));
    if ($("agreementTabPending")) $("agreementTabPending").addEventListener("click", () => showAgreementTab("pending"));
    if ($("agreementTabSearch")) $("agreementTabSearch").addEventListener("click", () => showAgreementTab("search"));
    if ($("agreementTabVersions")) $("agreementTabVersions").addEventListener("click", () => showAgreementTab("versions"));
    if ($("agreementTabCompliance")) $("agreementTabCompliance").addEventListener("click", () => showAgreementTab("compliance"));
    if ($("superLoadPendingAgreementsButton")) $("superLoadPendingAgreementsButton").addEventListener("click", () => loadPendingAgreements("super"));

    if ($("loadAgreementComplianceButton")) $("loadAgreementComplianceButton").addEventListener("click", loadAgreementComplianceSummary);
    if ($("loadMissingAgreementsButton")) $("loadMissingAgreementsButton").addEventListener("click", loadMissingRequiredAgreements);
    if ($("downloadMissingAgreementsCsvButton")) $("downloadMissingAgreementsCsvButton").addEventListener("click", () => downloadCsv("VMS_MissingAgreements_" + exportDateStamp() + ".csv", agreementComplianceMissingCache));
    if ($("loadAgreementMatrixButton")) $("loadAgreementMatrixButton").addEventListener("click", loadAgreementComplianceMatrix);
    if ($("agreementMatrixTextFilter")) $("agreementMatrixTextFilter").addEventListener("input", renderAgreementComplianceMatrix);
    if ($("agreementMatrixCurrentOnly")) $("agreementMatrixCurrentOnly").addEventListener("change", loadAgreementComplianceMatrix);
    if ($("downloadAgreementMatrixCsvButton")) $("downloadAgreementMatrixCsvButton").addEventListener("click", () => downloadCsv("VMS_AgreementComplianceMatrix_" + exportDateStamp() + ".csv", matrixExportRows()));
    if ($("loadOutstandingInductionsButton")) $("loadOutstandingInductionsButton").addEventListener("click", loadOutstandingInductions);
    if ($("downloadOutstandingInductionsCsvButton")) $("downloadOutstandingInductionsCsvButton").addEventListener("click", () => downloadCsv("VMS_OutstandingInductions_" + exportDateStamp() + ".csv", outstandingInductionsCache));
    if ($("loadEvidenceAuditButton")) $("loadEvidenceAuditButton").addEventListener("click", loadEvidenceAudit);
    if ($("downloadEvidenceAuditCsvButton")) $("downloadEvidenceAuditCsvButton").addEventListener("click", () => downloadCsv("VMS_AgreementEvidenceAudit_" + exportDateStamp() + ".csv", evidenceAuditExportRows(evidenceAuditCache)));

    if ($("loadAgreementSearchButton")) $("loadAgreementSearchButton").addEventListener("click", loadAgreementSearch);
    if ($("downloadAgreementSearchCsvButton")) $("downloadAgreementSearchCsvButton").addEventListener("click", () => downloadCsv("visitor_agreements.csv", agreementExportRows(agreementSearchCache)));
    if ($("downloadAgreementSearchExcelButton")) $("downloadAgreementSearchExcelButton").addEventListener("click", () => exportToExcel(agreementExportRows(agreementSearchCache), "VMS_VisitorAgreements_" + exportDateStamp() + ".xlsx", "agreements"));
    if ($("createAgreementVersionButton")) $("createAgreementVersionButton").addEventListener("click", createAgreementVersionFromForm);
    if ($("updateExistingAgreementVersionButton")) $("updateExistingAgreementVersionButton").addEventListener("click", updateExistingAgreementVersionFromForm);
    if ($("loadAgreementVersionsButton")) $("loadAgreementVersionsButton").addEventListener("click", loadAgreementVersions);
    if ($("saveAgreementSettingsButton")) $("saveAgreementSettingsButton").addEventListener("click", saveAgreementSettings);
    if ($("closeAgreementSelectionModalButton")) $("closeAgreementSelectionModalButton").addEventListener("click", closeAgreementSelectionModal);
    if ($("cancelAgreementSelectionButton")) $("cancelAgreementSelectionButton").addEventListener("click", closeAgreementSelectionModal);
    if ($("startAgreementSelectionButton")) $("startAgreementSelectionButton").addEventListener("click", startAgreementSelectionQueue);
    if ($("closeAgreementSignModalButton")) $("closeAgreementSignModalButton").addEventListener("click", closeAgreementSignModal);
    if ($("cancelVisitorAgreementButton")) $("cancelVisitorAgreementButton").addEventListener("click", closeAgreementSignModal);
    if ($("saveVisitorAgreementButton")) $("saveVisitorAgreementButton").addEventListener("click", saveVisitorAgreementFromModal);
    if ($("closeAgreementLinkModalButton")) $("closeAgreementLinkModalButton").addEventListener("click", closeAgreementLinkModal);
    if ($("cancelAgreementLinkButton")) $("cancelAgreementLinkButton").addEventListener("click", closeAgreementLinkModal);
    if ($("searchPreviousAgreementsButton")) $("searchPreviousAgreementsButton").addEventListener("click", searchPreviousAgreementsForCurrentVisit);
    if ($("confirmAgreementLinkButton")) $("confirmAgreementLinkButton").addEventListener("click", confirmAgreementLink);
    if ($("confirmAgreementConsolidateButton")) $("confirmAgreementConsolidateButton").addEventListener("click", confirmAgreementConsolidation);
    if ($("clearAgreementSignatureButton")) $("clearAgreementSignatureButton").addEventListener("click", clearAgreementSignature);
    if ($("clearInductorSignatureButton")) $("clearInductorSignatureButton").addEventListener("click", clearInductorSignature);
    if ($("saveAgreementTypeButton")) $("saveAgreementTypeButton").addEventListener("click", saveAgreementTypeFromForm);
    if ($("clearAgreementTypeButton")) $("clearAgreementTypeButton").addEventListener("click", clearAgreementTypeForm);
    if ($("loadAgreementTypesButton")) $("loadAgreementTypesButton").addEventListener("click", loadAgreementTypes);
    if ($("closeAgreementEvidenceModalButton")) $("closeAgreementEvidenceModalButton").addEventListener("click", closeAgreementEvidenceModal);
    if ($("closeAgreementEvidenceBottomButton")) $("closeAgreementEvidenceBottomButton").addEventListener("click", closeAgreementEvidenceModal);
    if ($("printAgreementEvidenceButton")) $("printAgreementEvidenceButton").addEventListener("click", printAgreementEvidence);
    if ($("agreementConfirmOkButton")) $("agreementConfirmOkButton").addEventListener("click", () => closeAgreementConfirmModal(true));
    if ($("agreementConfirmCancelButton")) $("agreementConfirmCancelButton").addEventListener("click", () => closeAgreementConfirmModal(false));
    if ($("agreementConfirmCloseButton")) $("agreementConfirmCloseButton").addEventListener("click", () => closeAgreementConfirmModal(false));

    if ($("agreementSignatureCanvas")) {
      $("agreementSignatureCanvas").addEventListener("mousedown", beginAgreementSignature);
      $("agreementSignatureCanvas").addEventListener("mousemove", drawAgreementSignature);
      window.addEventListener("mouseup", endAgreementSignature);
      $("agreementSignatureCanvas").addEventListener("touchstart", beginAgreementSignature, { passive:false });
      $("agreementSignatureCanvas").addEventListener("touchmove", drawAgreementSignature, { passive:false });
      window.addEventListener("touchend", endAgreementSignature);
      $("inductorSignatureCanvas").addEventListener("mousedown", beginInductorSignature);
      $("inductorSignatureCanvas").addEventListener("mousemove", drawInductorSignature);
      window.addEventListener("mouseup", endInductorSignature);
      $("inductorSignatureCanvas").addEventListener("touchstart", beginInductorSignature, { passive:false });
      $("inductorSignatureCanvas").addEventListener("touchmove", drawInductorSignature, { passive:false });
      window.addEventListener("touchend", endInductorSignature);
    }

    $("kioskConfirmCloseButton").addEventListener("click", closeKioskConfirmation);
    if ($("clearLocalKioskTokenButton")) $("clearLocalKioskTokenButton").addEventListener("click", clearKioskTokenForThisTablet);
    if ($("setLocalKioskTokenButton")) $("setLocalKioskTokenButton").addEventListener("click", promptSetKioskTokenForThisTablet);
    if ($("saveSettingsButton")) $("saveSettingsButton").addEventListener("click", saveSettingsForm);
    if ($("saveFieldRulesButton")) $("saveFieldRulesButton").addEventListener("click", saveFieldRulesOnly);
    if ($("resetFieldRulesButton")) $("resetFieldRulesButton").addEventListener("click", resetFieldRulesDefaults);
    if ($("saveKioskBehaviourButton")) $("saveKioskBehaviourButton").addEventListener("click", () => saveSettingsGroup("kioskBehaviour", "Kiosk Behaviour"));
    if ($("resetKioskBehaviourButton")) $("resetKioskBehaviourButton").addEventListener("click", () => resetSettingsGroup("kioskBehaviour", "Kiosk Behaviour"));
    if ($("saveKioskBehaviourManagerButton")) $("saveKioskBehaviourManagerButton").addEventListener("click", saveKioskBehaviourFromManager);
    if ($("resetKioskBehaviourManagerButton")) $("resetKioskBehaviourManagerButton").addEventListener("click", resetKioskBehaviourFromManager);
    if ($("saveMessagesButton")) $("saveMessagesButton").addEventListener("click", () => saveSettingsGroup("messages", "Confirmation Messages"));
    if ($("resetMessagesButton")) $("resetMessagesButton").addEventListener("click", () => resetSettingsGroup("messages", "Confirmation Messages"));
    if ($("saveBrandingButton")) $("saveBrandingButton").addEventListener("click", () => saveSettingsGroup("branding", "Branding"));
    if ($("resetBrandingButton")) $("resetBrandingButton").addEventListener("click", () => resetSettingsGroup("branding", "Branding"));
    if ($("saveOperationalRulesButton")) $("saveOperationalRulesButton").addEventListener("click", () => saveSettingsGroup("operationalRules", "Operational Rules"));
    if ($("resetOperationalRulesButton")) $("resetOperationalRulesButton").addEventListener("click", () => resetSettingsGroup("operationalRules", "Operational Rules"));
    if ($("loadSettingsButton")) $("loadSettingsButton").addEventListener("click", reloadSettingsForm);
    if ($("resetSettingsButton")) $("resetSettingsButton").addEventListener("click", resetSettingsDefaults);
    if ($("saveProfileButton")) $("saveProfileButton").addEventListener("click", saveProfileFromForm);
    if ($("clearProfileFormButton")) $("clearProfileFormButton").addEventListener("click", clearProfileForm);
    if ($("loadProfilesButton")) $("loadProfilesButton").addEventListener("click", loadProfiles);
    if ($("createKioskDeviceButton")) $("createKioskDeviceButton").addEventListener("click", createKioskDevice);
    if ($("loadKioskDevicesButton")) $("loadKioskDevicesButton").addEventListener("click", loadKioskDevices);
    if ($("loadAuditEventsButton")) $("loadAuditEventsButton").addEventListener("click", loadAuditEvents);
    if ($("loadAnalyticsButton")) $("loadAnalyticsButton").addEventListener("click", () => loadAnalytics(""));

    if ($("openGdprCaseModalButton")) $("openGdprCaseModalButton").addEventListener("click", () => openGdprCaseModal(null));
    if ($("loadGdprCasesButton")) $("loadGdprCasesButton").addEventListener("click", loadGdprCases);
    if ($("closeGdprCaseModalButton")) $("closeGdprCaseModalButton").addEventListener("click", closeGdprCaseModal);
    if ($("cancelGdprCaseButton")) $("cancelGdprCaseButton").addEventListener("click", closeGdprCaseModal);
    if ($("saveGdprCaseButton")) $("saveGdprCaseButton").addEventListener("click", saveGdprCase);
    if ($("gdprStepCasesButton")) $("gdprStepCasesButton").addEventListener("click", () => showGdprStep("cases"));
    if ($("gdprStepSearchButton")) $("gdprStepSearchButton").addEventListener("click", () => showGdprStep("search"));
    if ($("gdprStepSarButton")) $("gdprStepSarButton").addEventListener("click", () => showGdprStep("sar"));
    if ($("gdprStepErasureButton")) $("gdprStepErasureButton").addEventListener("click", () => showGdprStep("erasure"));
    if ($("gdprStepEvidenceButton")) $("gdprStepEvidenceButton").addEventListener("click", () => showGdprStep("evidence"));
    if ($("clearGdprCaseFiltersButton")) $("clearGdprCaseFiltersButton").addEventListener("click", clearGdprCaseFilters);
    if ($("generateGdprEvidenceButton")) $("generateGdprEvidenceButton").addEventListener("click", generateGdprEvidencePack);
    if ($("downloadGdprEvidenceButton")) $("downloadGdprEvidenceButton").addEventListener("click", downloadGdprEvidencePack);
    if ($("printGdprEvidenceButton")) $("printGdprEvidenceButton").addEventListener("click", printGdprEvidencePack);
    if ($("generateSarPackageButton")) $("generateSarPackageButton").addEventListener("click", generateSarPackage);
    if ($("downloadSarHtmlButton")) $("downloadSarHtmlButton").addEventListener("click", downloadSarHtml);
    if ($("downloadSarJsonButton")) $("downloadSarJsonButton").addEventListener("click", downloadSarJson);
    if ($("printSarPackageButton")) $("printSarPackageButton").addEventListener("click", printSarPackage);
    if ($("gdprSearchButton")) $("gdprSearchButton").addEventListener("click", gdprSearchDataSubject);
    if ($("gdprClearButton")) $("gdprClearButton").addEventListener("click", gdprClearSearch);
    if ($("gdprPreviewButton")) $("gdprPreviewButton").addEventListener("click", gdprPreviewAnonymisation);
    if ($("gdprAnonymiseButton")) $("gdprAnonymiseButton").addEventListener("click", openGdprAnonymiseModal);
    if ($("closeGdprAnonymiseModalButton")) $("closeGdprAnonymiseModalButton").addEventListener("click", closeGdprAnonymiseModal);
    if ($("cancelGdprAnonymiseButton")) $("cancelGdprAnonymiseButton").addEventListener("click", closeGdprAnonymiseModal);
    if ($("confirmGdprAnonymiseButton")) $("confirmGdprAnonymiseButton").addEventListener("click", confirmGdprAnonymisation);
    if ($("superNavDashboard")) $("superNavDashboard").addEventListener("click", () => showSuperSection("dashboard"));
    if ($("superNavReporting")) $("superNavReporting").addEventListener("click", () => showSuperSection("reporting"));
    if ($("superNavGdpr")) $("superNavGdpr").addEventListener("click", () => showSuperSection("gdpr"));
    if ($("superNavNotifications")) $("superNavNotifications").addEventListener("click", () => { showSuperSection("notifications"); refreshNotifications(); });
    if ($("superNavSettings")) $("superNavSettings").addEventListener("click", () => showSuperSection("settings"));
    if ($("refreshHealthButton")) $("refreshHealthButton").addEventListener("click", refreshSystemHealth);
    if ($("exportHealthButton")) $("exportHealthButton").addEventListener("click", exportSystemHealth);
    if ($("saveEmailProcessorSettingsButton")) $("saveEmailProcessorSettingsButton").addEventListener("click", () => saveEmailProcessorSettings());
    if ($("runEmailProcessorNowButton")) $("runEmailProcessorNowButton").addEventListener("click", () => runEmailProcessorNow());
    if ($("saveNotificationTriggerSettingsButton")) $("saveNotificationTriggerSettingsButton").addEventListener("click", saveNotificationTriggerSettings);
    if ($("runNotificationTriggerCheckButton")) $("runNotificationTriggerCheckButton").addEventListener("click", runNotificationTriggerCheckNow);
    if ($("saveEmailSettingsButton")) $("saveEmailSettingsButton").addEventListener("click", saveEmailSettings);
    if ($("sendTestEmailButton")) $("sendTestEmailButton").addEventListener("click", sendTestEmail);
    if ($("sendPendingEmailsButton")) $("sendPendingEmailsButton").addEventListener("click", sendPendingEmails);
    if ($("sendPendingEmailsFromQueueButton")) $("sendPendingEmailsFromQueueButton").addEventListener("click", sendPendingEmails);
    if ($("refreshNotificationsButton")) $("refreshNotificationsButton").addEventListener("click", refreshNotifications);
    if ($("openNotificationTemplateModalButton")) $("openNotificationTemplateModalButton").addEventListener("click", () => openNotificationTemplateModal(null));
    if ($("createTestNotificationButton")) $("createTestNotificationButton").addEventListener("click", createTestNotification);
    if ($("loadNotificationQueueButton")) $("loadNotificationQueueButton").addEventListener("click", loadNotificationQueue);
    if ($("loadInAppNotificationsButton")) $("loadInAppNotificationsButton").addEventListener("click", () => loadInAppNotifications());
    if ($("ackAllInAppNotificationsButton")) $("ackAllInAppNotificationsButton").addEventListener("click", () => acknowledgeAllInAppNotifications());
    if ($("closeNotificationTemplateModalButton")) $("closeNotificationTemplateModalButton").addEventListener("click", closeNotificationTemplateModal);
    if ($("cancelNotificationTemplateButton")) $("cancelNotificationTemplateButton").addEventListener("click", closeNotificationTemplateModal);
    if ($("saveNotificationTemplateButton")) $("saveNotificationTemplateButton").addEventListener("click", saveNotificationTemplate);
    if ($("saveDeploymentSettingsButton")) $("saveDeploymentSettingsButton").addEventListener("click", saveDeploymentSettings);
    if ($("loadCurrentVersionButton")) $("loadCurrentVersionButton").addEventListener("click", loadCurrentFileVersionIntoSettings);
    if ($("refreshDeploymentStatusButton")) $("refreshDeploymentStatusButton").addEventListener("click", refreshDeploymentVersionStatus);
    if ($("saveRetentionSettingsButton")) $("saveRetentionSettingsButton").addEventListener("click", saveRetentionSettings);
    if ($("resetRetentionSettingsButton")) $("resetRetentionSettingsButton").addEventListener("click", resetRetentionSettings);
    if ($("previewRetentionButton")) $("previewRetentionButton").addEventListener("click", previewRetentionCleanup);
    if ($("runRetentionButton")) $("runRetentionButton").addEventListener("click", runRetentionCleanup);
    if ($("savePlannedLifecycleButton")) $("savePlannedLifecycleButton").addEventListener("click", savePlannedLifecycleSettings);
    if ($("previewPlannedLifecycleCleanupButton")) $("previewPlannedLifecycleCleanupButton").addEventListener("click", previewPlannedLifecycleCleanup);
    if ($("runPlannedLifecycleCleanupButton")) $("runPlannedLifecycleCleanupButton").addEventListener("click", runPlannedLifecycleCleanup);
    if ($("runDailyMaintenanceNowButton")) $("runDailyMaintenanceNowButton").addEventListener("click", async () => {
      await runDailyMaintenance("manual_dashboard_button");
      showMessage("Daily maintenance completed.", "success");
    });
    if ($("closeRetentionConfirmModalButton")) $("closeRetentionConfirmModalButton").addEventListener("click", () => closeRetentionConfirmModal(false));
    if ($("cancelRetentionRunButton")) $("cancelRetentionRunButton").addEventListener("click", () => closeRetentionConfirmModal(false));
    if ($("confirmRetentionRunButton")) $("confirmRetentionRunButton").addEventListener("click", () => {
      if ($("retentionConfirmText").value !== "RUN RETENTION CLEANUP") {
        setLocalStatus("retentionConfirmMessage", "Confirmation text does not match.", "error");
        return;
      }
      closeRetentionConfirmModal(true);
    });
    if ($("loadRetentionRecommendedButton")) $("loadRetentionRecommendedButton").addEventListener("click", loadRetentionRecommendedDefaults);
    if ($("savePrivacyNoticeButton")) $("savePrivacyNoticeButton").addEventListener("click", savePrivacyNoticeSettings);
    if ($("resetPrivacyNoticeButton")) $("resetPrivacyNoticeButton").addEventListener("click", resetPrivacyNoticeSettings);
    if ($("loadPrivacyRecommendedButton")) $("loadPrivacyRecommendedButton").addEventListener("click", loadPrivacyRecommendedDefaults);
    if ($("confirmPrivacyNoticeButton")) $("confirmPrivacyNoticeButton").addEventListener("click", confirmPrivacyNotice);
    if ($("cancelPrivacyNoticeButton")) $("cancelPrivacyNoticeButton").addEventListener("click", () => closePrivacyNoticeModal(false));
    if ($("closePrivacyNoticeModalButton")) $("closePrivacyNoticeModalButton").addEventListener("click", () => closePrivacyNoticeModal(false));
    if ($("superLoadAnalyticsButton")) $("superLoadAnalyticsButton").addEventListener("click", () => loadAnalytics("super"));
    if ($("downloadAuditCsvButton")) $("downloadAuditCsvButton").addEventListener("click", () => downloadCsv("audit_events.csv", normaliseAuditExportRows(AppState.auditEventsCache)));
    if ($("downloadAuditExcelButton")) $("downloadAuditExcelButton").addEventListener("click", () => exportToExcel(normaliseAuditExportRows(AppState.auditEventsCache), "VMS_AuditEvents_" + exportDateStamp() + ".xlsx", "history"));


    ["settingPlannedReasonVisible","settingPlannedReasonRequired","settingPlannedVehicleVisible","settingPlannedVehicleRequired",
     "settingPlannedContactVisible","settingPlannedContactRequired","settingPlannedPassVisible","settingPlannedPassRequired",
     "settingWalkinCompanyVisible","settingWalkinCompanyRequired","settingWalkinReasonVisible","settingWalkinReasonRequired",
     "settingWalkinVehicleVisible","settingWalkinVehicleRequired","settingWalkinContactVisible","settingWalkinContactRequired",
     "settingWalkinPassVisible","settingWalkinPassRequired"].forEach(id => {
       if ($(id)) $(id).addEventListener("change", applyFieldRules);
    });

    if ($("closeAuditDetailsModalButton")) $("closeAuditDetailsModalButton").addEventListener("click", closeAuditDetailsModal);
    if ($("closeAuditDetailsBottomButton")) $("closeAuditDetailsBottomButton").addEventListener("click", closeAuditDetailsModal);

    $("closeKioskLogoutModalButton").addEventListener("click", () => closeKioskLogoutModal(null));
    $("cancelKioskLogoutButton").addEventListener("click", () => closeKioskLogoutModal(null));
    $("confirmKioskLogoutButton").addEventListener("click", () => {
      const password = $("kioskLogoutPassword").value;
      if (!password) {
        showKioskLogoutModalMessage("Password is required.", "error");
        return;
      }
      closeKioskLogoutModal(password);
    });
    document.addEventListener("keydown", handleGlobalModalKeyboard);

    $("closeLoginModalButton").addEventListener("click", closeLoginModal);
    $("closeChangePasswordModalButton").addEventListener("click", closeChangePasswordModal);
    $("saveNewPasswordButton").addEventListener("click", changeOwnPassword);
    $("loginButton").addEventListener("click", loginStaff);
    $("logoutButton").addEventListener("click", requestProtectedLogout);

    $("closeEditModalButton").addEventListener("click", closeEditModal);
    $("cancelEditButton").addEventListener("click", closeEditModal);
    $("saveEditButton").addEventListener("click", saveEdit);

    ["plannedDate","generalSearchDate","securityPlannedDate","securityFromDate","securityToDate","superPlannedDate","superFromDate","superToDate","analyticsFromDate","analyticsToDate","superAnalyticsFromDate","superAnalyticsToDate"].forEach(id => { if ($(id)) $(id).value = todayDate(); });

    await loadSystemSettings();
    initialiseCollapsibleSettings();

    supabaseClient.auth.onAuthStateChange(async function (event) {
      await getCurrentSessionAndProfile();

      if (event === "SIGNED_OUT") {
        showScreen("homeScreen");
        updateHomeAccess();
      }
    });

    getCurrentSessionAndProfile();
    updateKioskTokenWarning();
    debugInfo.textContent = "Script loaded. Settings loaded.";
    refreshCoreData();

  } catch (err) {
    document.getElementById("message").textContent = "Page script error: " + err.message;
    document.getElementById("message").className = "message error";
    document.getElementById("debugInfo").textContent = "Script failed: " + (err && err.stack ? err.stack : err.message);
    console.error(err);
  }
});
