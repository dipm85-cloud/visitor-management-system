import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { clearMessage, showMessage } from "./messages.js";
import { writeAuditEvent } from "./audit.js";
import { safe } from "./utils.js";

let userDependencies;

export function configureUsers(dependencies) {
  userDependencies = dependencies;
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

export function clearProfileForm() {
  $("profileUserId").value = "";
  $("profileDisplayName").value = "";
  $("profileRole").value = "general_user";
  $("profileActive").value = "true";
  $("profileStatus").textContent = "";
}

export function editProfile(profile) {
  $("profileUserId").value = profile.id || "";
  $("profileDisplayName").value = profile.display_name || "";
  $("profileRole").value = profile.role || "general_user";
  $("profileActive").value = profile.active ? "true" : "false";
  $("profileStatus").textContent = "Editing profile: " + safe(profile.display_name);
}

export async function saveProfileFromForm() {
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

export async function loadProfiles() {
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

  renderProfiles(normalisePlannedVisitRows(result.data || []));
}

export function renderProfiles(data) {
  const { buildResultSummary, setResultBox } = userDependencies;
  const box = $("profilesList");
  if (!box) return;

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
    edit.addEventListener("click", () => editProfile(profile));
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
    toggle.addEventListener("click", () => setProfileActive(profile.id, !profile.active));
    actions.appendChild(toggle);

    row.appendChild(actions);
    temp.appendChild(row);
  });

  setResultBox(box, buildResultSummary(data.length, "Profiles", "Staff accounts"), temp);
}

export async function resetProfileAttempts(userId) {
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

export async function setProfileActive(userId, active) {
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
