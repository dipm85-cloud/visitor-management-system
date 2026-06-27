import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showMessage, clearMessage } from "./messages.js";
import { showScreen } from "./navigation.js";
import { AppState } from "./state.js";

let authDependencies;

export function configureAuth(dependencies) {
  authDependencies = dependencies;
}

export function openLoginModal() {
  $("loginModalBackdrop").classList.add("active");
  $("loginStatus").textContent = "";
}

export function closeLoginModal() {
  $("loginModalBackdrop").classList.remove("active");
}

export function roleLabel(role) {
  return String(role || "").replace("_", " ");
}

export function isKioskProfile() {
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

export function updateHomeAccess() {
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

export function updateTopbarStaffStatus() {
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

export async function getCurrentSessionAndProfile() {
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

export async function loginStaff() {
  const {
    verifyKioskTokenOrLogout,
    writeAuditEvent,
    startKioskHeartbeat,
    runDailyMaintenanceIfDue
  } = authDependencies;

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

export function openChangePasswordModal() {
  $("newPassword").value = "";
  $("confirmNewPassword").value = "";
  $("changePasswordStatus").textContent = "";
  $("changePasswordModalBackdrop").classList.add("active");
}

export function closeChangePasswordModal() {
  $("changePasswordModalBackdrop").classList.remove("active");
}

export async function changeOwnPassword() {
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

export async function logoutStaff() {
  const {
    stopKioskHeartbeat,
    writeAuditEvent,
    clearWalkInForm
  } = authDependencies;

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

export async function openStaffAreaFromProfile() {
  const {
    setRole,
    loadAgreementVersions,
    showSuperSection
  } = authDependencies;

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
