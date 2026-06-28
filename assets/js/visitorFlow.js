import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import {
  showMessage,
  clearMessage,
  showToast,
  showKioskConfirmation
} from "./messages.js";
import { ensureKioskToken } from "./kiosk.js";
import { showScreen } from "./navigation.js";
import { todayDate, safe, formatPersonName, normalisePlate } from "./utils.js";
import { settingValue } from "./settings.js";

let appSettings;
let visitorDependencies;
let latestPrivacyAcceptance = null;
let kioskActionInProgress = false;

export function configureVisitorFlow(options) {
  appSettings = options.appSettings;
  visitorDependencies = options.dependencies;
}

export function setLatestPrivacyAcceptance(value) {
  latestPrivacyAcceptance = value;
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

export async function refreshCoreData() {
  await loadPlannedVisits();
  await loadActiveVisits();
  $("debugInfo").textContent = "Last refreshed: " + new Date().toLocaleTimeString();
}

export async function loadPlannedVisits() {
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

export function renderPlannedVisitorList() {
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

    $("openWalkInFromSearchButton").addEventListener("click", () => visitorDependencies.openWalkInModal(filterRaw));
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

export async function signInPlanned(visit, actionButton) {
  clearMessage();

  if (!beginKioskAction(actionButton, "Signing in...", "Sign In")) {
    showToast("Please wait", "A kiosk action is already running.", "info");
    return;
  }

  try {
    const privacyOk = await visitorDependencies.requestPrivacyAcknowledgement();
    if (!privacyOk) {
      return;
    }

    let kioskToken;
    try {
      kioskToken = ensureKioskToken();
    } catch (err) {
      showMessage(err.message, "error");
      return;
    }

    showMessage("Signing you in, please wait...", "success");
    if (actionButton && actionButton.parentElement) {
      const waitNote = document.createElement("div");
      waitNote.className = "row-meta kiosk-action-wait-note";
      waitNote.textContent = "Signing you in, please wait...";
      actionButton.parentElement.appendChild(waitNote);
    }

    const plannedSignInRpc = visitorDependencies.isSuperKioskTestProfile()
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
      return;
    }

    const plannedVisitLogId = await findVisitLogIdAfterPlannedSignIn(visit.id, result.data);
    await visitorDependencies.queueVisitorArrivalNotification(plannedVisitLogId);

    await visitorDependencies.sendKioskHeartbeat("visitor_signed_in_planned");

    await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", plannedVisitLogId || result.data || null, {
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
  } finally {
    endKioskAction(actionButton, "Sign In");
  }
}

export async function signInWalkIn() {
  clearMessage();
  const actionButton = $("walkInButton");
  if (!beginKioskAction(actionButton, "Signing in...", "Sign In Walk-In")) {
    visitorDependencies.showWalkInModalMessage("Signing in, please wait...", "success");
    showToast("Please wait", "A kiosk action is already running.", "info");
    return;
  }
  try {
  const name = formatPersonName($("walkInName").value);

  if (!name) {
    visitorDependencies.showWalkInModalMessage("Please enter visitor name.", "error");
    return;
  }

  if (!visitorDependencies.validateRequiredField("walkInCompany", "Company", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInReason", "Reason for visit", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInVehicle", "Vehicle licence plate", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInContact", "On-site contact", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInSecurityPass", "Security pass ID", true)) return;

  const activeDuplicate = await supabaseClient
    .from("visit_log")
    .select("id, visitor_name, sign_out_time")
    .ilike("visitor_name", name)
    .is("sign_out_time", null)
    .limit(1);

  if (!activeDuplicate.error && activeDuplicate.data && activeDuplicate.data.length > 0) {
    visitorDependencies.showWalkInModalMessage("A visitor with this name is already signed in. Please ask Security for help if this is a different person.", "error");
    return;
  }

  const plannedDuplicate = AppState.plannedTodayCache.find(v => formatPersonName(v.visitor_name) === name);
  if (plannedDuplicate) {
    visitorDependencies.showWalkInModalMessage("A planned visitor with this name exists. Please select the planned visitor entry instead of creating a walk-in.", "error");
    return;
  }

  if (visitorDependencies.currentPrivacyConfig().enabled && visitorDependencies.privacyDisplayMode() === "embedded_walkin") {
    const embeddedAcceptance = visitorDependencies.validateEmbeddedWalkInPrivacy();
    if (embeddedAcceptance === false) return;
    latestPrivacyAcceptance = embeddedAcceptance;
  } else {
    const privacyOk = await visitorDependencies.requestPrivacyAcknowledgement();
    if (!privacyOk) return;
  }

  let kioskToken;
  try {
    kioskToken = ensureKioskToken();
  } catch (err) {
    visitorDependencies.showWalkInModalMessage(err.message, "error");
    return;
  }

  visitorDependencies.showWalkInModalMessage("Signing you in, please wait...", "success");

  const walkInSignInRpc = visitorDependencies.isSuperKioskTestProfile()
    ? "superuser_test_kiosk_sign_in_walk_in"
    : "kiosk_sign_in_walk_in";

  const result = await supabaseClient.rpc(walkInSignInRpc, {
    p_kiosk_token: kioskToken,
    p_visitor_name: name,
    p_company: visitorDependencies.fieldValueIfVisible("walkInCompany").trim() || null,
    p_visit_reason: visitorDependencies.fieldValueIfVisible("walkInReason").trim() || null,
    p_vehicle_plate: normalisePlate(visitorDependencies.fieldValueIfVisible("walkInVehicle")),
    p_onsite_contact: formatPersonName(visitorDependencies.fieldValueIfVisible("walkInContact")) || null,
    p_security_pass_id: visitorDependencies.fieldValueIfVisible("walkInSecurityPass").trim() || null,
    p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
    p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
  });

  if (result.error) {
    visitorDependencies.showWalkInModalMessage("Could not sign in walk-in visitor: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  const walkInVisitLogId = await findVisitLogIdAfterWalkInSignIn(name, result.data);
  await visitorDependencies.queueVisitorArrivalNotification(walkInVisitLogId);

  await visitorDependencies.sendKioskHeartbeat("visitor_signed_in_walk_in");

  await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", walkInVisitLogId || result.data || null, {
    origin: "walk_in",
    visitor_name: name
  });

  ["walkInName","walkInCompany","walkInReason","walkInVehicle","walkInContact","walkInSecurityPass"].forEach(id => $(id).value = "");
  visitorDependencies.closeWalkInModal();
  showMessage("Walk-in visitor signed in successfully.", "success");
  showKioskConfirmation("Welcome, " + safe(name), appSettings.walkInSignInMessage);
  await refreshCoreData();
  showScreen("homeScreen");
  } finally {
    endKioskAction(actionButton, "Sign In Walk-In");
  }
}

export async function loadActiveVisits() {
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

  AppState.activeVisitCache = result.data || [];
  renderActiveVisitorList();
}

export function renderActiveVisitorList() {
  const box = $("activeVisits");
  if (!box) return;

  const filterRaw = $("signOutFilter") ? $("signOutFilter").value : "";
  const filter = formatPersonName(filterRaw);

  if (!filter || filter.length < 2) {
    box.innerHTML = "<div class='row'><div class='row-meta'>Type at least 2 letters of your name to search current signed-in visitors.</div></div>";
    return;
  }

  const rows = AppState.activeVisitCache.filter(visit =>
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

export async function signOut(id, actionButton) {
  clearMessage();

  if (!beginKioskAction(actionButton, "Signing out...", "Sign Out")) {
    showToast("Please wait", "A kiosk action is already running.", "info");
    return;
  }

  try {
  let kioskToken;
  try {
    kioskToken = ensureKioskToken();
  } catch (err) {
    showMessage(err.message, "error");
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
      return;
    }
    showToast("Compliance warning", "Signing out with missing required agreement(s): " + missingText, "error");
  }

  showMessage("Signing you out, please wait...", "success");

  const signOutRpc = visitorDependencies.isSuperKioskTestProfile()
    ? "superuser_test_kiosk_sign_out"
    : "kiosk_sign_out";

  const result = await supabaseClient.rpc(signOutRpc, {
    p_kiosk_token: kioskToken,
    p_visit_log_id: id
  });

  if (result.error) {
    showMessage("Could not sign visitor out: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  await visitorDependencies.sendKioskHeartbeat("visitor_signed_out");

  await visitorDependencies.writeAuditEvent("visitor_signed_out", "visit_log", id, {});

  showMessage("Visitor signed out successfully.", "success");
  showKioskConfirmation("Thank you for your visit", appSettings.signOutMessage);
  await refreshCoreData();
  showScreen("homeScreen");
  } finally {
    endKioskAction(actionButton, "Sign Out");
  }
}
