// ============================================================================
// VMS NextGen - Application Map
// ============================================================================
//
// This file is the mechanically extracted JavaScript from VMS_020D.
//
// Current refactor rule:
// - Do not change functionality.
// - Do not rename DOM IDs.
// - Do not change Supabase table/RPC names.
// - Do not redesign UI.
// - Split into modules only after the structure is mapped.
//
// Planned module boundaries:
// 1. Configuration and constants
// 2. Application state/cache
// 3. System settings and branding
// 4. Staff authentication and profile loading
// 5. Screen navigation and role panels
// 6. Kiosk token/device behaviour
// 7. Visitor sign-in/sign-out
// 8. Planned visit management
// 9. History search and editing
// 10. Analytics/dashboard
// 11. Audit events
// 12. Kiosk device management
// 13. User/profile management
// 14. Printing and exports
// 15. Utility helpers
// 16. Event binding and startup
//
window.addEventListener("load", async function () {
  try {
    const SUPABASE_URL = "https://fozfvgdmrxygbzuhnojm.supabase.co/";
	const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvemZ2Z2Rtcnh5Z2J6dWhub2ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTgxNTgsImV4cCI6MjA5NTI5NDE1OH0.GWjcFVFzUkp0dG6Gj6ZnnY20Eqi0nNJaNSggjEGnVPo";

    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let plannedTodayCache = [];
    let visitLogCache = [];
    let securityPlannedCache = [];
    let securityHistoryCache = [];
    let superPlannedCache = [];
    let superHistoryCache = [];
    let auditEventsCache = [];
    let opportunisticAutoSignOutChecked = false;
    let currentProfile = null;

    // Settings are loaded from public.system_settings.
    // Defaults are used if a setting is missing or cannot be loaded.
    function getDefaultAppSettings() {
      return {
        confirmationAutoCloseMs: 5000,
        kioskIdleTimeoutMs: 45000,
        plannedSignInMessage: "You have been signed in successfully. Please collect your security pass if required.",
        walkInSignInMessage: "Walk-in visitor signed in successfully. Please collect your security pass if required.",
        signOutMessage: "You have been signed out successfully. Please return your security pass before leaving.",
        companyName: "Visitor Management",
        primaryColour: "#1f4f8f",
        accentColour: "#18a999",
        logoUrl: null,
        backgroundUrl: null,
        backgroundOpacity: 0.18,
        logoTransparentBackground: false,
        pageBackgroundColour: "#eef3f8",
      maxLoginAttempts: 5
      };
    }

    const appSettings = getDefaultAppSettings();

    let systemSettingsRaw = {};

    const KIOSK_TOKEN_STORAGE_KEY = "vms_kiosk_token";
    let kioskIdleTimer = null;

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
      systemSettingsRaw = settings;

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
          brandText.innerHTML = appSettings.companyName + "<br><span style='font-size:12px;color:var(--muted);font-weight:700;'>Prototype VMS_020D</span>";
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

      applyBrandAssets();
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
      return systemSettingsRaw[key] == null ? fallback : systemSettingsRaw[key];
    }

    function boolString(value) {
      return value ? "true" : "false";
    }

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

      if (!currentProfile || currentProfile.role !== "super_user") {
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
        ["kiosk_device_required", $("settingRequireKioskDevice").value === "true", "Require kiosk token for public kiosk actions"]
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

        await loadSystemSettings();
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

      if (!currentProfile || currentProfile.role !== "super_user") {
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

      const data = result.data || [];

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

      await writeAuditEvent("failed_attempts_reset", "profiles", userId, {});
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

    async function loadKioskDevices() {
      const box = $("kioskDevicesList");
      if (!box) return;

      box.innerHTML = "Loading kiosk devices...";

      const result = await supabaseClient.rpc("superuser_list_kiosk_devices");

      if (result.error) {
        box.innerHTML = "Could not load kiosk devices: " + result.error.message;
        showMessage("Could not load kiosk devices: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      const data = result.data || [];

      if (data.length === 0) {
        box.innerHTML = buildResultSummary(0, "Kiosk devices", "No registered devices") +
          "<div class='results-scroll'><div class='row-meta' style='padding:14px 0;'>No kiosk devices found.</div></div>";
        return;
      }

      const temp = document.createElement("div");

      data.forEach(device => {
        const row = document.createElement("div");
        row.className = "row";

        row.innerHTML =
          "<div class='row-title'>" + safe(device.device_name) + "</div>" +
          "<div class='row-meta'>" +
          "Location: " + safe(device.location_name || device.location) + "<br>" +
          "Description: " + safe(device.description) + "<br>" +
          "Status: " + (device.active ? "Active" : "Disabled") + "<br>" +
          "Created: " + (device.created_at ? new Date(device.created_at).toLocaleString() : "-") + "<br>" +
          "Last used: " + (device.last_seen_at || device.last_used_at ? new Date(device.last_seen_at || device.last_used_at).toLocaleString() : "-") + "<br>" +
          "Transactions: " + safe(device.total_transactions) + "<br>" +
          "Token: " + maskToken(device.kiosk_token) +
          "</div>";

        const actions = document.createElement("div");
        actions.className = "button-row";

        if (device.kiosk_token) {
          const reveal = document.createElement("button");
          reveal.textContent = "Reveal Token";
          reveal.type = "button";
          reveal.className = "secondary";
          reveal.addEventListener("click", () => {
            if (!confirm("Reveal this kiosk token? Only do this on a trusted screen.")) return;
            alert(device.kiosk_token);
          });
          actions.appendChild(reveal);

          const copy = document.createElement("button");
          copy.textContent = "Copy Token";
          copy.type = "button";
          copy.className = "secondary";
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(device.kiosk_token);
              showMessage("Kiosk token copied.", "success");
            } catch (err) {
              alert("Copy this token manually:\n\n" + device.kiosk_token);
            }
          });
          actions.appendChild(copy);
        }

        const regen = document.createElement("button");
        regen.textContent = "Regenerate Token";
        regen.type = "button";
        regen.className = "danger";
        regen.addEventListener("click", () => regenerateKioskToken(device.id));
        actions.appendChild(regen);

        const toggle = document.createElement("button");
        toggle.textContent = device.active ? "Disable" : "Enable";
        toggle.type = "button";
        toggle.className = device.active ? "danger" : "secondary";
        toggle.addEventListener("click", () => setKioskDeviceStatus(device.id, !device.active));
        actions.appendChild(toggle);

        row.appendChild(actions);
        temp.appendChild(row);
      });

      setResultBox(box, buildResultSummary(data.length, "Kiosk devices", "Registered devices"), temp);
    }

    async function createKioskDevice() {
      clearMessage();

      if (!currentProfile || currentProfile.role !== "super_user") {
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

      await writeAuditEvent("kiosk_device_created", "kiosk_devices", null, { device_name: name, location: location });
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
      await writeAuditEvent("kiosk_token_regenerated", "kiosk_devices", deviceId, {});
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

      await writeAuditEvent("kiosk_device_status_changed", "kiosk_devices", deviceId, { active: active, reason: reason });
      showMessage("Kiosk device status updated.", "success");
      await loadKioskDevices();
    }


    async function writeAuditEvent(eventType, entityType, entityId, details) {
      try {
        await supabaseClient.rpc("write_audit_event", {
          p_event_type: eventType,
          p_entity_type: entityType || null,
          p_entity_id: entityId || null,
          p_details: details || {}
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

      auditEventsCache = result.data || [];
      renderAuditEvents(box, auditEventsCache);
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

        row.innerHTML =
          "<div class='row-title'>" + safe(evt.event_type) + "</div>" +
          "<div class='row-meta'>" +
          "Time: " + (evt.created_at ? new Date(evt.created_at).toLocaleString() : "-") + "<br>" +
          "Actor: " + safe(evt.actor_display_name) + "<br>" +
          "Entity: " + safe(evt.entity_type) + " / " + safe(evt.entity_id) + "<br>" +
          "Details: <code style='word-break:break-word;'>" + safe(JSON.stringify(evt.details || {})) + "</code>" +
          "</div>";

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
      if (!currentProfile || currentProfile.role !== "super_user") {
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
    }

    function clearMessage() {
      const box = $("message");
      box.textContent = "";
      box.className = "message";
    }

    function showToast(title, body, type) {
      // Kept for staff/admin messages. Kiosk visitor messages use the centre modal.
      const area = $("toastArea");
      if (!area) return;

      const toast = document.createElement("div");
      toast.className = "toast " + (type || "success");

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

    function resetKioskIdleTimer() {
      if (kioskIdleTimer) clearTimeout(kioskIdleTimer);

      const onKioskScreen =
        $("signInScreen").classList.contains("active") ||
        $("signOutScreen").classList.contains("active");

      if (!onKioskScreen) return;

      kioskIdleTimer = setTimeout(function () {
        showScreen("homeScreen");
      }, appSettings.kioskIdleTimeoutMs);
    }

    function ensureKioskToken() {
      const token = getKioskToken();
      if (token) return token;

      const entered = prompt("Enter kiosk device token for this tablet:");
      if (entered && entered.trim()) {
        setKioskToken(entered.trim());
        return entered.trim();
      }

      updateKioskTokenWarning();
      throw new Error("Kiosk device token is required.");
    }

    function todayDate() {
      const d = new Date();
      return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
    }

    function safe(value) {
      const text = String(value || "").trim();
      return text === "" ? "-" : text;
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

    function formatPersonName(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function normalisePlate(value) {
      const text = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
      return text === "" ? null : text;
    }

    function csvEscape(value) {
      const text = String(value == null ? "" : value);
      return '"' + text.replace(/"/g, '""') + '"';
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


    function openLoginModal() {
      $("loginModalBackdrop").classList.add("active");
      $("loginStatus").textContent = "";
    }

    function closeLoginModal() {
      $("loginModalBackdrop").classList.remove("active");
    }

    function updateTopbarStaffStatus() {
      if (currentProfile && currentProfile.active) {
        $("topbarStaffStatus").textContent = currentProfile.display_name + " (" + currentProfile.role.replace("_", " ") + ")";
        $("topbarLogoutButton").classList.remove("hidden");
        $("changePasswordTopButton").classList.remove("hidden");
      } else {
        $("topbarStaffStatus").textContent = "";
        $("topbarLogoutButton").classList.add("hidden");
        $("changePasswordTopButton").classList.add("hidden");
      }
    }

    async function getCurrentSessionAndProfile() {
      const sessionResult = await supabaseClient.auth.getSession();
      const session = sessionResult.data ? sessionResult.data.session : null;

      if (!session || !session.user) {
        currentProfile = null;
        updateTopbarStaffStatus();
        return null;
      }

      const profileResult = await supabaseClient
        .from("profiles")
        .select("id, display_name, role, active")
        .eq("id", session.user.id)
        .single();

      if (profileResult.error) {
        currentProfile = null;
        updateTopbarStaffStatus();
        console.error("Profile load error:", profileResult.error);
        return null;
      }

      currentProfile = profileResult.data;
      updateTopbarStaffStatus();
      return currentProfile;
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
        currentProfile = null;
        updateTopbarStaffStatus();
        return;
      }

      if (!profile.active) {
        $("loginStatus").textContent =
          "This staff profile is inactive or locked. Ask a SuperUser to reactivate it.";
        await supabaseClient.auth.signOut();
        currentProfile = null;
        updateTopbarStaffStatus();
        return;
      }

      try {
        await supabaseClient.rpc("record_successful_login", { p_user_id: profile.id });
      } catch (successErr) {
        console.warn("Could not reset failed attempts:", successErr);
      }

      await openStaffAreaFromProfile();
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

    async function logoutStaff() {
      await supabaseClient.auth.signOut();
      currentProfile = null;
      updateTopbarStaffStatus();
      $("staffIdentity").textContent = "Login required. Your role will decide which tools are available.";
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
      if (profile.role === "security") setRole("security");
      if (profile.role === "super_user") setRole("super");
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
      const formattedRows = normaliseExportRows(rows, type);

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

    function exportDateStamp() {
      const d = new Date();
      return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
    }

    function showScreen(screenId) {
      $("homeScreen").style.display = screenId === "homeScreen" ? "grid" : "none";
      ["signInScreen", "signOutScreen", "staffScreen"].forEach(id => {
        $(id).classList.toggle("active", id === screenId);
      });
      clearMessage();

      if (kioskIdleTimer) {
        clearTimeout(kioskIdleTimer);
        kioskIdleTimer = null;
      }

      if (screenId === "signInScreen" || screenId === "signOutScreen") {
        resetKioskIdleTimer();
      }
    }

    function setRole(role) {
      $("roleGeneral").classList.toggle("active", role === "general");
      $("roleSecurity").classList.toggle("active", role === "security");
      $("roleSuper").classList.toggle("active", role === "super");

      $("generalPanel").classList.toggle("active", role === "general");
      $("securityPanel").classList.toggle("active", role === "security");
      $("superPanel").classList.toggle("active", role === "super");

      if (role === "security") {
        runOpportunisticAutoSignOutCheck();
        loadSecurityDashboard();
        loadAnalytics("");
      }
      if (role === "super") {
        loadSuperDashboard();
        fillSettingsForm();
        loadProfiles();
        loadKioskDevices();
        runOpportunisticAutoSignOutCheck();
        loadAuditEvents();
        loadAnalytics("super");
      }
    }

    async function refreshCoreData() {
      await loadPlannedVisits();
      await loadActiveVisits();
      debugInfo.textContent = "Last refreshed: " + new Date().toLocaleTimeString();
    }

    async function loadPlannedVisits() {
      const today = todayDate();

      const plannedResult = await supabaseClient
        .from("planned_visits")
        .select("id, visitor_name, company, host_id, visit_date, expected_time, visit_reason, vehicle_plate, onsite_contact, security_pass_id, notes, created_by, modified_by, modified_at")
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
        .not("planned_visit_id", "is", null);

      visitLogCache = logsResult.data || [];
      const used = {};
      visitLogCache.forEach(log => {
        if (log.sign_in_time) used[log.planned_visit_id] = true;
      });

      plannedTodayCache = (plannedResult.data || []).filter(v => !used[v.id]);
      renderPlannedVisitorList();
    }

    function renderPlannedVisitorList() {
      const box = $("plannedVisits");
      const filter = formatPersonName($("plannedFilter").value);

      let rows = plannedTodayCache;
      if (filter) {
        rows = rows.filter(v =>
          formatPersonName(v.visitor_name).includes(filter) ||
          formatPersonName(v.company).includes(filter)
        );
      }

      if (rows.length === 0) {
        if (plannedTodayCache.length === 0) {
          box.innerHTML = "<div class='row'><div class='row-meta'>No planned visitors are currently available for sign-in. They may already be signed in/signed out, or there may be no visits planned for today.</div></div>";
        } else {
          box.innerHTML = "<div class='row'><div class='row-meta'>No matching planned visitors. Try typing less of the name, or ask Security for help.</div></div>";
        }
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
        btn.addEventListener("click", () => signInPlanned(visit));

        row.appendChild(btn);
        box.appendChild(row);
      });
    }

    async function signInPlanned(visit) {
      clearMessage();

      let kioskToken;
      try {
        kioskToken = ensureKioskToken();
      } catch (err) {
        showMessage(err.message, "error");
        return;
      }

      const result = await supabaseClient.rpc("kiosk_sign_in_planned", {
        p_kiosk_token: kioskToken,
        p_planned_visit_id: visit.id
      });

      if (result.error) {
        showMessage("Could not sign in planned visitor: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      showMessage("Signed in successfully.", "success");
      showKioskConfirmation("Welcome, " + safe(visit.visitor_name), appSettings.plannedSignInMessage);
      await refreshCoreData();
      showScreen("homeScreen");
    }


    async function signInWalkIn() {
      clearMessage();
      const name = formatPersonName($("walkInName").value);

      if (!name) {
        showMessage("Please enter visitor name.", "error");
        return;
      }

      let kioskToken;
      try {
        kioskToken = ensureKioskToken();
      } catch (err) {
        showMessage(err.message, "error");
        return;
      }

      const result = await supabaseClient.rpc("kiosk_sign_in_walk_in", {
        p_kiosk_token: kioskToken,
        p_visitor_name: name,
        p_company: $("walkInCompany").value.trim() || null,
        p_visit_reason: $("walkInReason").value.trim() || null,
        p_vehicle_plate: normalisePlate($("walkInVehicle").value),
        p_onsite_contact: formatPersonName($("walkInContact").value) || null,
        p_security_pass_id: $("walkInSecurityPass").value.trim() || null
      });

      if (result.error) {
        showMessage("Could not sign in walk-in visitor: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      ["walkInName","walkInCompany","walkInReason","walkInVehicle","walkInContact","walkInSecurityPass"].forEach(id => $(id).value = "");
      showMessage("Walk-in visitor signed in successfully.", "success");
      showKioskConfirmation("Welcome, " + safe(name), appSettings.walkInSignInMessage);
      await refreshCoreData();
      showScreen("homeScreen");
    }


    async function loadActiveVisits() {
      const result = await supabaseClient
        .from("visit_log")
        .select("id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, sign_in_time")
        .is("sign_out_time", null)
        .order("sign_in_time", { ascending: true });

      const box = $("activeVisits");

      if (result.error) {
        box.innerHTML = "Could not load active visitors.";
        console.error(result.error);
        return;
      }

      const data = result.data || [];
      if (data.length === 0) {
        box.innerHTML = "<div class='row-meta'>No visitors currently signed in.</div>";
        return;
      }

      box.innerHTML = "";
      data.forEach(visit => {
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
        btn.addEventListener("click", () => signOut(visit.id));

        row.appendChild(btn);
        box.appendChild(row);
      });
    }

    async function signOut(id) {
      clearMessage();

      let kioskToken;
      try {
        kioskToken = ensureKioskToken();
      } catch (err) {
        showMessage(err.message, "error");
        return;
      }

      const result = await supabaseClient.rpc("kiosk_sign_out", {
        p_kiosk_token: kioskToken,
        p_visit_log_id: id
      });

      if (result.error) {
        showMessage("Could not sign visitor out: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      showMessage("Visitor signed out successfully.", "success");
      showKioskConfirmation("Thank you for your visit", appSettings.signOutMessage);
      await refreshCoreData();
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

      const result = await supabaseClient.from("planned_visits").insert({
        visitor_name: name,
        company: $("plannedCompany").value.trim() || null,
        host_id: null,
        visit_date: visitDate,
        expected_time: $("plannedTime").value || null,
        visit_reason: $("plannedReason").value.trim() || null,
        vehicle_plate: normalisePlate($("plannedVehicle").value),
        onsite_contact: formatPersonName($("plannedContact").value) || null,
        security_pass_id: $("plannedSecurityPass").value.trim() || null,
        notes: null,
        status: "planned",
        created_by: currentProfile ? currentProfile.id : null
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
      const isSuper = currentProfile && currentProfile.role === "super_user";
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
        const isSuper = currentProfile && currentProfile.role === "super_user";

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
        .select("id, planned_visit_id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, sign_in_time, sign_out_time, visit_status, visit_origin, signed_out_automatically, automatic_sign_out_reason")
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

    function openEditModal(table, record, mode) {
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

      $("editModalBackdrop").classList.add("active");
    }

    function closeEditModal() {
      $("editModalBackdrop").classList.remove("active");
    }

    async function saveEdit() {
      clearMessage();

      const table = $("editTableName").value;
      const id = $("editRecordId").value;
      const mode = $("editMode").value;
      const securityPass = $("editSecurityPass").value.trim() || null;

      let result;

      // Security mode uses secure RPC functions.
      // This means Security can only change Security Pass ID at database level.
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
          showMessage("Unknown edit target.", "error");
          return;
        }
      } else {
        let payload = {
          security_pass_id: securityPass,
          visitor_name: formatPersonName($("editVisitorName").value),
          company: $("editCompany").value.trim() || null,
          visit_reason: $("editReason").value.trim() || null,
          vehicle_plate: normalisePlate($("editVehicle").value),
          onsite_contact: formatPersonName($("editContact").value) || null,
          modified_by: currentProfile ? currentProfile.id : null,
          modified_at: new Date().toISOString()
        };

        if (table === "planned_visits") {
          payload.visit_date = $("editVisitDate").value;
          payload.expected_time = $("editExpectedTime").value || null;
        }

        result = await supabaseClient.from(table).update(payload).eq("id", id);
      }

      if (result.error) {
        showMessage("Could not save changes: " + result.error.message, "error");
        console.error(result.error);
        return;
      }

      await writeAuditEvent("visit_changed", table, id, { mode: mode, action: "edit" });
      closeEditModal();
      showMessage("Changes saved.", "success");
      await refreshCoreData();
      await reloadOpenStaffPanel();
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

      await writeAuditEvent("visit_changed", "planned_visits", id, { action: "delete" });
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

      await writeAuditEvent("visit_changed", "visit_log", id, { action: "delete" });
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
      if (opportunisticAutoSignOutChecked) return;
      opportunisticAutoSignOutChecked = true;

      if (!currentProfile || !(currentProfile.role === "security" || currentProfile.role === "super_user")) return;

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
      securityPlannedCache = await searchPlanned("securityPlannedResults", $("securityPlannedDate").value, "", false, false, true);
    }

    async function loadSecurityHistory() {
      securityHistoryCache = await searchHistory(
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
      superPlannedCache = await searchPlanned("superPlannedResults", $("superPlannedDate").value, $("superNameSearch").value, true, true, false);
    }

    async function loadSuperHistory() {
      superHistoryCache = await searchHistory(
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

    function printEscape(value) {
      return String(value == null || value === "" ? "-" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatPrintDate(value) {
      if (!value) return "Not selected";
      const parts = String(value).split("-");
      if (parts.length === 3) return parts[2] + "/" + parts[1] + "/" + parts[0];
      return value;
    }

    function formatPrintTime(value) {
      if (!value) return "-";
      return String(value).slice(0, 5);
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
        "<div class='footer'><span>VMS_020D compact planned visit printout</span><span>Printed from Visitor Management Solution</span></div>" +
        "<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},150);});<\/script>" +
        "</body></html>";
    }

    function printPlannedList(rows, selectedDate) {
      if (!rows || rows.length === 0) {
        showMessage("No planned visits are loaded. Please load or search a planned visitor list before printing.", "error");
        return;
      }

      const printedBy = currentProfile
        ? currentProfile.display_name + " (" + currentProfile.role.replace("_", " ") + ")"
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

    $("openSignInButton").addEventListener("click", () => { showScreen("signInScreen"); refreshCoreData(); });
    $("openSignOutButton").addEventListener("click", () => { showScreen("signOutScreen"); refreshCoreData(); });
    $("staffButton").addEventListener("click", openStaffAreaFromProfile);
    $("topbarLogoutButton").addEventListener("click", logoutStaff);
    $("changePasswordTopButton").addEventListener("click", openChangePasswordModal);
    $("staffHeaderLogoutButton").addEventListener("click", logoutStaff);
    document.querySelectorAll(".backHomeButton").forEach(b => b.addEventListener("click", () => showScreen("homeScreen")));

    $("plannedFilter").addEventListener("input", renderPlannedVisitorList);
    $("walkInButton").addEventListener("click", signInWalkIn);
    $("createPlannedButton").addEventListener("click", createPlannedVisit);

    $("roleGeneral").addEventListener("click", () => setRole("general"));
    $("roleSecurity").addEventListener("click", () => setRole("security"));
    $("roleSuper").addEventListener("click", () => setRole("super"));

    $("generalSearchButton").addEventListener("click", () => searchPlanned("generalResults", $("generalSearchDate").value, "", true, true, false));

    $("securityLoadPlannedButton").addEventListener("click", loadSecurityPlanned);
    $("securityHistorySearchButton").addEventListener("click", loadSecurityHistory);
    $("securityRunAutoSignOutButton").addEventListener("click", () => runAutoSignOut("securityAutoSignOutStatus"));
    $("securityOverdueButton").addEventListener("click", showSecurityOverdue);
    $("securityCurrentSignedInButton").addEventListener("click", showSecurityCurrentlySignedIn);
    $("securityPrintPlannedButton").addEventListener("click", () => printPlannedList(securityPlannedCache, $("securityPlannedDate").value));
    $("securityDownloadPlannedButton").addEventListener("click", () => downloadCsv("planned_visits.csv", securityPlannedCache));
    $("securityExcelPlannedButton").addEventListener("click", () => exportToExcel(securityPlannedCache, "VMS_PlannedVisitors_" + ($("securityPlannedDate").value || exportDateStamp()) + ".xlsx", "planned"));
    $("securityDownloadHistoryButton").addEventListener("click", () => downloadCsv("visit_history.csv", securityHistoryCache));
    $("securityExcelHistoryButton").addEventListener("click", () => exportToExcel(securityHistoryCache, "VMS_VisitHistory_" + exportDateStamp() + ".xlsx", "history"));

    $("superSearchPlannedButton").addEventListener("click", loadSuperPlanned);
    $("superSearchHistoryButton").addEventListener("click", loadSuperHistory);
    $("superRunAutoSignOutButton").addEventListener("click", () => runAutoSignOut("superAutoSignOutStatus"));
    $("superOverdueButton").addEventListener("click", showSuperOverdue);
    $("superCurrentSignedInButton").addEventListener("click", showSuperCurrentlySignedIn);
    if ($("superPrintPlannedButton")) $("superPrintPlannedButton").addEventListener("click", () => printPlannedList(superPlannedCache, $("superPlannedDate").value));
    $("superDownloadPlannedButton").addEventListener("click", () => downloadCsv("super_planned_visits.csv", superPlannedCache));
    $("superExcelPlannedButton").addEventListener("click", () => exportToExcel(superPlannedCache, "VMS_Super_PlannedVisits_" + exportDateStamp() + ".xlsx", "planned"));
    $("superDownloadHistoryButton").addEventListener("click", () => downloadCsv("super_visit_history.csv", superHistoryCache));
    $("superExcelHistoryButton").addEventListener("click", () => exportToExcel(superHistoryCache, "VMS_Super_VisitHistory_" + exportDateStamp() + ".xlsx", "history"));

    $("kioskConfirmCloseButton").addEventListener("click", closeKioskConfirmation);
    if ($("clearLocalKioskTokenButton")) $("clearLocalKioskTokenButton").addEventListener("click", clearKioskTokenForThisTablet);
    if ($("setLocalKioskTokenButton")) $("setLocalKioskTokenButton").addEventListener("click", promptSetKioskTokenForThisTablet);
    if ($("saveSettingsButton")) $("saveSettingsButton").addEventListener("click", saveSettingsForm);
    if ($("loadSettingsButton")) $("loadSettingsButton").addEventListener("click", reloadSettingsForm);
    if ($("resetSettingsButton")) $("resetSettingsButton").addEventListener("click", resetSettingsDefaults);
    if ($("saveProfileButton")) $("saveProfileButton").addEventListener("click", saveProfileFromForm);
    if ($("clearProfileFormButton")) $("clearProfileFormButton").addEventListener("click", clearProfileForm);
    if ($("loadProfilesButton")) $("loadProfilesButton").addEventListener("click", loadProfiles);
    if ($("createKioskDeviceButton")) $("createKioskDeviceButton").addEventListener("click", createKioskDevice);
    if ($("loadKioskDevicesButton")) $("loadKioskDevicesButton").addEventListener("click", loadKioskDevices);
    if ($("loadAuditEventsButton")) $("loadAuditEventsButton").addEventListener("click", loadAuditEvents);
    if ($("loadAnalyticsButton")) $("loadAnalyticsButton").addEventListener("click", () => loadAnalytics(""));
    if ($("superLoadAnalyticsButton")) $("superLoadAnalyticsButton").addEventListener("click", () => loadAnalytics("super"));
    if ($("downloadAuditCsvButton")) $("downloadAuditCsvButton").addEventListener("click", () => downloadCsv("audit_events.csv", normaliseAuditExportRows(auditEventsCache)));
    if ($("downloadAuditExcelButton")) $("downloadAuditExcelButton").addEventListener("click", () => exportToExcel(normaliseAuditExportRows(auditEventsCache), "VMS_AuditEvents_" + exportDateStamp() + ".xlsx", "history"));

    $("closeLoginModalButton").addEventListener("click", closeLoginModal);
    $("closeChangePasswordModalButton").addEventListener("click", closeChangePasswordModal);
    $("saveNewPasswordButton").addEventListener("click", changeOwnPassword);
    $("loginButton").addEventListener("click", loginStaff);
    $("logoutButton").addEventListener("click", logoutStaff);

    $("closeEditModalButton").addEventListener("click", closeEditModal);
    $("cancelEditButton").addEventListener("click", closeEditModal);
    $("saveEditButton").addEventListener("click", saveEdit);

    ["plannedDate","generalSearchDate","securityPlannedDate","securityFromDate","securityToDate","superPlannedDate","superFromDate","superToDate","analyticsFromDate","analyticsToDate","superAnalyticsFromDate","superAnalyticsToDate"].forEach(id => { if ($(id)) $(id).value = todayDate(); });

    await loadSystemSettings();

    supabaseClient.auth.onAuthStateChange(function () {
      getCurrentSessionAndProfile();
    });

    getCurrentSessionAndProfile();
    updateKioskTokenWarning();
    debugInfo.textContent = "Script loaded. Settings loaded.";
    refreshCoreData();

  } catch (err) {
    document.getElementById("message").textContent = "Page script error: " + err.message;
    document.getElementById("message").className = "message error";
    document.getElementById("debugInfo").textContent = "Script failed.";
    console.error(err);
  }
});
