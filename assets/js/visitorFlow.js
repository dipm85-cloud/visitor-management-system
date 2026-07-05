import {
  callAnonymousTerminalRpc,
  supabaseClient
} from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import {
  showMessage,
  clearMessage,
  showToast,
  showKioskConfirmation,
  showWalkInModalMessage
} from "./messages.js";
import { ensureKioskToken } from "./kiosk.js";
import { showScreen } from "./navigation.js";
import {
  todayDate,
  safe,
  formatPersonName,
  isValidVisitorFullName,
  normalisePlate,
  VISITOR_FULL_NAME_MESSAGE
} from "./utils.js";
import { settingValue } from "./settings.js";
import { hasCapability } from "./capabilities.js";

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

function resetPlannedSignInSearch() {
  if ($("plannedFilter")) $("plannedFilter").value = "";
  if ($("plannedVisits")) {
    $("plannedVisits").innerHTML = "<div class='row'><div class='row-meta'>Type at least 2 letters of your name to search today's planned visitors.</div></div>";
  }
}

function resetSignOutSearch() {
  if ($("signOutFilter")) $("signOutFilter").value = "";
  if ($("activeVisits")) {
    $("activeVisits").innerHTML = "<div class='row'><div class='row-meta'>Type at least 2 letters of your name to search current signed-in visitors.</div></div>";
  }
}

function resetWalkInPublicFlow() {
  ["walkInName","walkInCompany","walkInReason","walkInVehicle","walkInContact","walkInSecurityPass"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  resetPlannedSignInSearch();
}

async function queueVisitorArrivalNotificationBestEffort(visitId) {
  try {
    await visitorDependencies.queueVisitorArrivalNotification(visitId);
  } catch (err) {
    console.warn("Visitor arrival notification failed after successful sign-in. Visitor flow remains successful.", err);
  }
}

function isPublicKioskContext() {
  const superKioskTest = visitorDependencies.isSuperKioskTestProfile && visitorDependencies.isSuperKioskTestProfile();
  return !superKioskTest && (!AppState.currentProfile || AppState.currentProfile.role === "kiosk_user");
}

function isPublicKioskFlow() {
  return isPublicKioskContext();
}

function returnFromPublicVisitorAction() {
  if (
    isPublicKioskContext() &&
    typeof visitorDependencies.returnToVisitorKiosk === "function"
  ) {
    visitorDependencies.returnToVisitorKiosk();
    return;
  }
  showScreen("homeScreen");
}

function showKioskFlowMessage(message, type) {
  showMessage(message, type);
  if (
    isPublicKioskContext() &&
    typeof visitorDependencies.showVisitorKioskStatus === "function"
  ) {
    visitorDependencies.showVisitorKioskStatus(message, type);
  }
}

function callPublicKioskRpc(functionName, parameters, fallbackError, testFunctionName) {
  if (
    testFunctionName &&
    visitorDependencies.isSuperKioskTestProfile()
  ) {
    return supabaseClient.rpc(testFunctionName, parameters);
  }
  if (isPublicKioskContext()) {
    return callAnonymousTerminalRpc(
      functionName,
      parameters,
      fallbackError
    );
  }
  return supabaseClient.rpc(functionName, parameters);
}

function showStaffComplianceToast(title, body, type) {
  if (isPublicKioskContext()) {
    console.warn(title + ": " + body);
    return;
  }

  showToast(title, body, type);
}

export async function refreshCoreData() {
  await loadPlannedVisits();
  await loadActiveVisits();
  $("debugInfo").textContent = "Last refreshed: " + new Date().toLocaleTimeString();
}

export async function loadPlannedVisits(options) {
  const renderLegacyList = !options || options.renderLegacyList !== false;
  const today = todayDate();
  const nativeTerminalSearch = !!(
    options &&
    Object.prototype.hasOwnProperty.call(options, "searchQuery") &&
    isPublicKioskContext()
  );

  if (nativeTerminalSearch) {
    let kioskToken;
    try {
      kioskToken = ensureKioskToken();
    } catch (error) {
      showKioskFlowMessage(error.message, "error");
      return null;
    }
    const result = await callAnonymousTerminalRpc(
      "shared_terminal_search_planned_visits",
      {
        p_terminal_token: kioskToken,
        p_query: String(options.searchQuery || "")
      },
      "Planned visitor search failed."
    );
    if (result.error) {
      console.warn("Shared Terminal planned search failed.", result.error);
      return null;
    }
    AppState.plannedTodayCache = Array.isArray(result.data)
      ? result.data
      : (result.data == null ? [] : [result.data]);
    return AppState.plannedTodayCache;
  }

  // Preferred path: backend-controlled list that excludes any planned visit already used today.
  // This avoids showing signed-out/completed planned visitors to kiosk users.
  const availableResult = await callPublicKioskRpc(
    "get_kiosk_available_planned_visits",
    { p_visit_date: today },
    "Planned visitor search failed."
  );

  if (!availableResult.error && Array.isArray(availableResult.data)) {
    AppState.plannedTodayCache = availableResult.data || [];
    if (renderLegacyList) renderPlannedVisitorList();
    return AppState.plannedTodayCache;
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
    if (renderLegacyList) $("plannedVisits").innerHTML = "Could not load planned visits.";
    console.error(plannedResult.error);
    return null;
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
  if (renderLegacyList) renderPlannedVisitorList();
  return AppState.plannedTodayCache;
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
  if (isPublicKioskContext()) return null;

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
  if (isPublicKioskContext()) return null;

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

  if (!isPublicKioskFlow() && !hasCapability("visitor.sign_in")) {
    showToast("You do not have permission", "Staff sign-in requires visitor.sign_in.", "error");
    return;
  }

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
      showKioskFlowMessage(err.message, "error");
      return;
    }

    showKioskFlowMessage("Signing you in, please wait...", "success");
    if (actionButton && actionButton.parentElement) {
      const waitNote = document.createElement("div");
      waitNote.className = "row-meta kiosk-action-wait-note";
      waitNote.textContent = "Signing you in, please wait...";
      actionButton.parentElement.appendChild(waitNote);
    }

    const sharedTerminal = isPublicKioskContext();
    const result = await callPublicKioskRpc(
      sharedTerminal
        ? "shared_terminal_sign_in_planned"
        : "kiosk_sign_in_planned",
      sharedTerminal ? {
        p_terminal_token: kioskToken,
        p_planned_visit_id: visit.id,
        p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
        p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
      } : {
        p_kiosk_token: kioskToken,
        p_planned_visit_id: visit.id,
        p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
        p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
      },
      "Planned visitor sign-in failed.",
      "superuser_test_kiosk_sign_in_planned"
    );

    if (result.error) {
      const msg = "Could not sign in planned visitor: " + result.error.message;
      showKioskFlowMessage(msg, "error");
      console.error(result.error);
      return;
    }

    const plannedVisitLogId = await findVisitLogIdAfterPlannedSignIn(visit.id, result.data);
    await queueVisitorArrivalNotificationBestEffort(plannedVisitLogId);

    await visitorDependencies.sendKioskHeartbeat("visitor_signed_in_planned");

    await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", plannedVisitLogId || result.data || null, {
      origin: "planned",
      visitor_name: visit.visitor_name,
      planned_visit_id: visit.id
    });

    resetPlannedSignInSearch();
    returnFromPublicVisitorAction();
    if (!isPublicKioskContext()) await refreshCoreData();
    showKioskConfirmation("Welcome, " + safe(visit.visitor_name), appSettings.plannedSignInMessage);
  } catch (err) {
    showKioskFlowMessage("Could not sign in planned visitor: " + err.message, "error");
    console.error(err);
  } finally {
    endKioskAction(actionButton, "Sign In");
  }
}

async function validateStaffWalkInVisitorName(name) {
  const activeDuplicate = await supabaseClient
    .from("visit_log")
    .select("id")
    .ilike("visitor_name", name)
    .is("sign_out_time", null)
    .limit(1);

  if (activeDuplicate.error) {
    console.warn("[OH-028 active walk-in duplicate check unavailable]", activeDuplicate.error);
    return {
      code: "validation_unavailable",
      message: "Active visitor status could not be verified safely."
    };
  }
  if ((activeDuplicate.data || []).length) {
    return {
      code: "active_duplicate",
      message: "A visitor with this name is already signed in."
    };
  }

  const availablePlanned = await supabaseClient.rpc("get_kiosk_available_planned_visits", {
    p_visit_date: todayDate()
  });
  if (availablePlanned.error || !Array.isArray(availablePlanned.data)) {
    if (availablePlanned.error) {
      console.warn("[OH-028 planned visitor collision check unavailable]", availablePlanned.error);
    }
    return {
      code: "validation_unavailable",
      message: "Planned visitor status could not be verified safely."
    };
  }
  const plannedDuplicate = availablePlanned.data.find(
    visit => formatPersonName(visit.visitor_name) === name
  );
  if (plannedDuplicate) {
    return {
      code: "planned_duplicate",
      message: "A planned visitor with this name is expected today."
    };
  }

  return null;
}

export async function signInWalkIn() {
  clearMessage();
  if (isPublicKioskFlow() && !settingValue("allow_walk_ins", true)) {
    showWalkInModalMessage("Walk-in registration is currently unavailable.", "error");
    return;
  }
  if (!isPublicKioskFlow() && (!hasCapability("visitor.create") || !hasCapability("visitor.sign_in"))) {
    showToast(
      "You do not have permission",
      "Staff walk-in sign-in requires visitor.create and visitor.sign_in.",
      "error"
    );
    return;
  }
  const actionButton = $("walkInButton");
  if (!beginKioskAction(actionButton, "Signing in...", "Sign In Walk-In")) {
    showWalkInModalMessage("Signing in, please wait...", "success");
    showToast("Please wait", "A kiosk action is already running.", "info");
    return;
  }
  try {
  const name = formatPersonName($("walkInName").value);

  if (!name) {
    showWalkInModalMessage(
      isPublicKioskFlow()
        ? VISITOR_FULL_NAME_MESSAGE
        : "Please enter visitor name.",
      "error"
    );
    return;
  }
  if (isPublicKioskFlow() && !isValidVisitorFullName(name)) {
    showWalkInModalMessage(VISITOR_FULL_NAME_MESSAGE, "error");
    return;
  }

  if (!visitorDependencies.validateRequiredField("walkInCompany", "Company", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInReason", "Reason for visit", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInVehicle", "Vehicle licence plate", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInContact", "On-site contact", true)) return;
  if (!visitorDependencies.validateRequiredField("walkInSecurityPass", "Security pass ID", true)) return;

  if (!isPublicKioskContext()) {
    const activeDuplicate = await supabaseClient
      .from("visit_log")
      .select("id, visitor_name, sign_out_time")
      .ilike("visitor_name", name)
      .is("sign_out_time", null)
      .limit(1);

    if (!activeDuplicate.error && activeDuplicate.data && activeDuplicate.data.length > 0) {
      showWalkInModalMessage("A visitor with this name is already signed in. Please ask Security for help if this is a different person.", "error");
      return;
    }

    const plannedDuplicate = AppState.plannedTodayCache.find(v => formatPersonName(v.visitor_name) === name);
    if (plannedDuplicate) {
      showWalkInModalMessage("A planned visitor with this name exists. Please select the planned visitor entry instead of creating a walk-in.", "error");
      return;
    }
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
    showWalkInModalMessage(err.message, "error");
    return;
  }

  showWalkInModalMessage("Signing you in, please wait...", "success");

  const sharedTerminal = isPublicKioskContext();
  const result = await callPublicKioskRpc(
    sharedTerminal
      ? "shared_terminal_sign_in_walk_in"
      : "kiosk_sign_in_walk_in",
    {
      [sharedTerminal ? "p_terminal_token" : "p_kiosk_token"]: kioskToken,
      p_visitor_name: name,
      p_company: visitorDependencies.fieldValueIfVisible("walkInCompany").trim() || null,
      p_visit_reason: visitorDependencies.fieldValueIfVisible("walkInReason").trim() || null,
      p_vehicle_plate: normalisePlate(visitorDependencies.fieldValueIfVisible("walkInVehicle")),
      p_onsite_contact: formatPersonName(visitorDependencies.fieldValueIfVisible("walkInContact")) || null,
      p_security_pass_id: visitorDependencies.fieldValueIfVisible("walkInSecurityPass").trim() || null,
      p_privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
      p_privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null
    },
    "Walk-in visitor sign-in failed.",
    "superuser_test_kiosk_sign_in_walk_in"
  );

  if (result.error) {
    showWalkInModalMessage("Could not sign in walk-in visitor: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  const walkInVisitLogId = await findVisitLogIdAfterWalkInSignIn(name, result.data);
  await queueVisitorArrivalNotificationBestEffort(walkInVisitLogId);

  await visitorDependencies.sendKioskHeartbeat("visitor_signed_in_walk_in");

  await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", walkInVisitLogId || result.data || null, {
    origin: "walk_in",
    visitor_name: name
  });

  resetWalkInPublicFlow();
  visitorDependencies.closeWalkInModal();
  returnFromPublicVisitorAction();
  if (!isPublicKioskContext()) await refreshCoreData();
  showKioskConfirmation("Welcome, " + safe(name), appSettings.walkInSignInMessage);
  } finally {
    endKioskAction(actionButton, "Sign In Walk-In");
  }
}

export async function createStaffWalkIn(input) {
  if (!hasCapability("visitor.create") || !hasCapability("visitor.sign_in")) {
    return {
      ok: false,
      code: "forbidden",
      message: "Staff walk-in sign-in requires visitor.create and visitor.sign_in."
    };
  }

  const name = formatPersonName(input && input.visitor_name);
  if (!name) {
    return { ok: false, code: "validation", message: "Visitor name is required." };
  }

  const duplicateValidation = await validateStaffWalkInVisitorName(name);
  if (duplicateValidation) {
    return {
      ok: false,
      code: duplicateValidation.code,
      message: duplicateValidation.code === "planned_duplicate"
        ? duplicateValidation.message + " Use the planned visitor workflow."
        : duplicateValidation.message
    };
  }

  const privacyOk = await visitorDependencies.requestPrivacyAcknowledgement();
  if (!privacyOk) {
    return {
      ok: false,
      code: "privacy_cancelled",
      message: "Privacy acknowledgement was not completed."
    };
  }

  const payload = {
    visitor_name: name,
    company: String(input.company || "").trim() || null,
    visit_reason: String(input.visit_reason || "").trim() || null,
    vehicle_plate: normalisePlate(input.vehicle_plate),
    onsite_contact: formatPersonName(input.onsite_contact) || null,
    security_pass_id: String(input.security_pass_id || "").trim() || null,
    privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
    privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null,
    sign_in_time: new Date().toISOString(),
    sign_out_time: null,
    visit_status: "signed_in",
    visit_origin: "walk_in"
  };
  const result = await supabaseClient
    .from("visit_log")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) {
    if (result.error) console.error("[OH-028 native walk-in insert failed]", result.error);
    return {
      ok: false,
      code: result.error && result.error.code === "23505" ? "duplicate" : "rejected",
      message: result.error && result.error.code === "23505"
        ? "This visitor already has an active visit."
        : "The walk-in was rejected by the current permissions or business rules."
    };
  }

  await queueVisitorArrivalNotificationBestEffort(result.data.id);
  await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", result.data.id, {
    origin: "walk_in",
    visitor_name: name,
    source: "native_visitors"
  });
  await refreshCoreData();

  return {
    ok: true,
    id: result.data.id,
    visitor_name: name
  };
}

export async function signInStaffPlannedVisit(plannedVisitId) {
  if (!hasCapability("visitor.sign_in")) {
    return {
      ok: false,
      code: "forbidden",
      message: "Signing in a planned visitor requires visitor.sign_in."
    };
  }

  const plannedResult = await supabaseClient
    .from("planned_visits")
    .select("id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, visit_date, expected_time, status")
    .eq("id", plannedVisitId)
    .maybeSingle();
  if (plannedResult.error || !plannedResult.data) {
    if (plannedResult.error) console.warn("[OH-029 planned visit lookup failed]", plannedResult.error);
    return {
      ok: false,
      code: "unavailable",
      message: "The planned visit is unavailable or cannot be accessed."
    };
  }

  const plannedVisit = plannedResult.data;
  const rawStatus = String(plannedVisit.status || "planned").trim().toLowerCase();
  if (!["", "planned", "pending", "upcoming", "expected", "scheduled", "active", "open"].includes(rawStatus)) {
    return {
      ok: false,
      code: "invalid_state",
      message: "Only an active planned visit can be signed in."
    };
  }
  if (plannedVisit.visit_date !== todayDate()) {
    return {
      ok: false,
      code: "invalid_date",
      message: "Only planned visits scheduled for today can be signed in."
    };
  }

  const activeByPlan = await supabaseClient
    .from("visit_log")
    .select("id")
    .eq("planned_visit_id", plannedVisit.id)
    .is("sign_out_time", null)
    .limit(1);
  const activeByName = await supabaseClient
    .from("visit_log")
    .select("id")
    .ilike("visitor_name", formatPersonName(plannedVisit.visitor_name))
    .is("sign_out_time", null)
    .limit(1);
  if (activeByPlan.error || activeByName.error) {
    console.warn("[OH-029 planned sign-in duplicate check unavailable]", activeByPlan.error || activeByName.error);
    return {
      ok: false,
      code: "validation_unavailable",
      message: "Active visitor status could not be verified safely."
    };
  }
  if ((activeByPlan.data || []).length || (activeByName.data || []).length) {
    return {
      ok: false,
      code: "active_duplicate",
      message: "This visitor is already signed in."
    };
  }

  const privacyOk = await visitorDependencies.requestPrivacyAcknowledgement();
  if (!privacyOk) {
    return {
      ok: false,
      code: "privacy_cancelled",
      message: "Privacy acknowledgement was not completed."
    };
  }

  const payload = {
    planned_visit_id: plannedVisit.id,
    visitor_name: formatPersonName(plannedVisit.visitor_name),
    company: String(plannedVisit.company || "").trim() || null,
    visit_reason: String(plannedVisit.visit_reason || "").trim() || null,
    vehicle_plate: normalisePlate(plannedVisit.vehicle_plate),
    onsite_contact: formatPersonName(plannedVisit.onsite_contact) || null,
    security_pass_id: String(plannedVisit.security_pass_id || "").trim() || null,
    privacy_notice_version: latestPrivacyAcceptance ? latestPrivacyAcceptance.version : null,
    privacy_notice_accepted_at: latestPrivacyAcceptance ? latestPrivacyAcceptance.acceptedAt : null,
    sign_in_time: new Date().toISOString(),
    sign_out_time: null,
    visit_status: "signed_in",
    visit_origin: "planned"
  };
  const result = await supabaseClient
    .from("visit_log")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    if (result.error) console.error("[OH-029 native planned sign-in failed]", result.error);
    return {
      ok: false,
      code: result.error && result.error.code === "23505" ? "active_duplicate" : "rejected",
      message: result.error && result.error.code === "23505"
        ? "This visitor is already signed in."
        : "Sign-in was rejected by the current permissions or business rules."
    };
  }

  await queueVisitorArrivalNotificationBestEffort(result.data.id);
  await visitorDependencies.writeAuditEvent("visitor_signed_in", "visit_log", result.data.id, {
    origin: "planned",
    visitor_name: payload.visitor_name,
    planned_visit_id: plannedVisit.id,
    source: "native_visitors"
  });
  await refreshCoreData();
  return {
    ok: true,
    id: result.data.id,
    visitor_name: payload.visitor_name
  };
}

export async function loadActiveVisits(options) {
  const renderLegacyList = !options || options.renderLegacyList !== false;
  const nativeTerminalSearch = !!(
    options &&
    Object.prototype.hasOwnProperty.call(options, "searchQuery") &&
    isPublicKioskContext()
  );

  if (nativeTerminalSearch) {
    let kioskToken;
    try {
      kioskToken = ensureKioskToken();
    } catch (error) {
      showKioskFlowMessage(error.message, "error");
      return null;
    }
    const terminalResult = await callAnonymousTerminalRpc(
      "shared_terminal_search_active_visits",
      {
        p_terminal_token: kioskToken,
        p_query: String(options.searchQuery || "")
      },
      "Visitor sign-out search failed."
    );
    if (terminalResult.error) {
      console.warn("Shared Terminal sign-out search failed.", terminalResult.error);
      return null;
    }
    AppState.activeVisitCache = Array.isArray(terminalResult.data)
      ? terminalResult.data
      : (terminalResult.data == null ? [] : [terminalResult.data]);
    return AppState.activeVisitCache;
  }

  const result = await supabaseClient
    .from("visit_log")
    .select("id, visitor_name, company, visit_reason, vehicle_plate, onsite_contact, security_pass_id, privacy_notice_version, privacy_notice_accepted_at, sign_in_time")
    .is("sign_out_time", null)
    .order("sign_in_time", { ascending: true });

  if (result.error) {
    if (renderLegacyList) $("activeVisits").innerHTML = "Could not load active visitors.";
    console.error(result.error);
    return null;
  }

  AppState.activeVisitCache = result.data || [];
  if (renderLegacyList) renderActiveVisitorList();
  return AppState.activeVisitCache;
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

export async function signOutStaffVisit(visitLogId) {
  if (!hasCapability("visitor.sign_out")) {
    return {
      ok: false,
      code: "forbidden",
      message: "Signing out a visitor requires visitor.sign_out."
    };
  }

  const activeResult = await supabaseClient
    .from("visit_log")
    .select("id, visitor_name, sign_in_time")
    .eq("id", visitLogId)
    .is("sign_out_time", null)
    .maybeSingle();
  if (activeResult.error || !activeResult.data) {
    if (activeResult.error) console.warn("[OH-029 active visitor lookup failed]", activeResult.error);
    return {
      ok: false,
      code: "invalid_state",
      message: "This visitor is no longer actively signed in."
    };
  }

  let warning = null;
  const complianceSummary = await getVisitMissingAgreementSummary(visitLogId);
  if (complianceSummary && complianceSummary.error) {
    warning = "Agreement compliance could not be checked before sign-out.";
  } else if (complianceSummary && Number(complianceSummary.missing_count || 0) > 0) {
    const missingText = complianceSummary.missing_agreements || "required agreement(s)";
    if (settingValue("block_sign_out_if_required_agreements_missing", false)) {
      return {
        ok: false,
        code: "compliance_blocked",
        message: "Sign-out is blocked. Missing required agreement(s): " + missingText
      };
    }
    warning = "Visitor signed out with missing required agreement(s): " + missingText;
  }

  const signOutTime = new Date().toISOString();
  const result = await supabaseClient
    .from("visit_log")
    .update({
      sign_out_time: signOutTime,
      visit_status: "signed_out"
    })
    .eq("id", visitLogId)
    .is("sign_out_time", null)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    if (result.error) console.error("[OH-029 native sign-out failed]", result.error);
    return {
      ok: false,
      code: "rejected",
      message: "Sign-out was rejected by the current permissions or business rules."
    };
  }

  await visitorDependencies.writeAuditEvent("visitor_signed_out", "visit_log", visitLogId, {
    visitor_name: activeResult.data.visitor_name,
    source: "native_visitors"
  });
  await refreshCoreData();
  return {
    ok: true,
    id: visitLogId,
    visitor_name: activeResult.data.visitor_name,
    warning
  };
}

export async function signOut(id, actionButton) {
  clearMessage();

  if (!isPublicKioskFlow() && !hasCapability("visitor.sign_out")) {
    showToast("You do not have permission", "Staff sign-out requires visitor.sign_out.", "error");
    return;
  }

  if (!beginKioskAction(actionButton, "Signing out...", "Sign Out")) {
    showToast("Please wait", "A kiosk action is already running.", "info");
    return;
  }

  try {
  let kioskToken;
  try {
    kioskToken = ensureKioskToken();
  } catch (err) {
    showKioskFlowMessage(err.message, "error");
    return;
  }

  if (!isPublicKioskContext()) {
    const complianceSummary = await getVisitMissingAgreementSummary(id);
    if (complianceSummary && complianceSummary.error) {
      showStaffComplianceToast("Compliance check warning", "Could not check agreement compliance before sign-out: " + complianceSummary.error.message, "error");
    } else if (complianceSummary && Number(complianceSummary.missing_count || 0) > 0) {
      const missingText = complianceSummary.missing_agreements || "required agreement(s)";
      const blockSignOut = !!settingValue("block_sign_out_if_required_agreements_missing", false);
      if (blockSignOut) {
        showKioskFlowMessage("Cannot sign out. Missing required agreement(s): " + missingText, "error");
        showStaffComplianceToast("Sign-out blocked", "Missing required agreement(s): " + missingText, "error");
        return;
      }
      showStaffComplianceToast("Compliance warning", "Signing out with missing required agreement(s): " + missingText, "error");
    }
  }

  showKioskFlowMessage("Signing you out, please wait...", "success");

  const sharedTerminal = isPublicKioskContext();
  const result = await callPublicKioskRpc(
    sharedTerminal ? "shared_terminal_sign_out" : "kiosk_sign_out",
    {
      [sharedTerminal ? "p_terminal_token" : "p_kiosk_token"]: kioskToken,
      p_visit_log_id: id
    },
    "Visitor sign-out failed.",
    "superuser_test_kiosk_sign_out"
  );

  if (result.error) {
    showKioskFlowMessage("Could not sign visitor out: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  await visitorDependencies.sendKioskHeartbeat("visitor_signed_out");

  await visitorDependencies.writeAuditEvent("visitor_signed_out", "visit_log", id, {});

  resetSignOutSearch();
  returnFromPublicVisitorAction();
  if (!isPublicKioskContext()) await refreshCoreData();
  showKioskConfirmation("Thank you for your visit", appSettings.signOutMessage);
  } finally {
    endKioskAction(actionButton, "Sign Out");
  }
}
