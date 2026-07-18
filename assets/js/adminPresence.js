import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
import { $, focusFirstModalInput } from "./dom.js";
import { showToast } from "./messages.js";
import { AppState } from "./state.js";
import { safe } from "./utils.js";
import { decorateCapabilityAction } from "./capabilityInspector.js";

const PRESENCE_VIEW_CAPABILITIES = [
  "online_users.view",
  "admin_system_messages.view",
  "admin_system_messages.send",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.view"
];
const MESSAGE_SEND_CAPABILITIES = [
  "admin_system_messages.send",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.edit"
];
const FORCE_ACTION_CAPABILITIES = [
  "admin_system_messages.force_action",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.edit"
];
const MESSAGE_HISTORY_CAPABILITIES = [
  "admin_system_messages.view",
  "admin_system_messages.send",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.view"
];
const SESSION_SECURITY_VIEW_CAPABILITIES = [
  "session_security_settings.view",
  "session_security_settings.manage",
  "access_control.manage",
  "settings.view",
  "settings.edit"
];
const SESSION_SECURITY_MANAGE_CAPABILITIES = [
  "session_security_settings.manage",
  "access_control.manage",
  "settings.edit"
];
const ADMIN_PRESENCE_CAPABILITIES = [
  ...PRESENCE_VIEW_CAPABILITIES,
  ...SESSION_SECURITY_VIEW_CAPABILITIES
];
const SESSION_KEY = "oh_session_key";
const HEARTBEAT_MS = 30000;
const PENDING_POLL_MS = 90000;
const ONLINE_WINDOW_SECONDS = 120;
const MESSAGE_TYPES = ["info", "warning", "maintenance", "access_update", "refresh_required"];
const ADVISORY_ACTION_HINTS = ["acknowledge_only", "refresh_now", "sign_out_now", "sign_out_and_back_in", "none"];
const REQUIRED_ACTIONS = ["acknowledge_only", "refresh_required", "sign_out_required", "sign_out_and_back_in_required"];
const DEFAULT_SECURITY_SETTINGS = {
  staff_inactivity_enabled: true,
  staff_idle_timeout_minutes: 30,
  staff_warning_seconds: 60,
  staff_auto_sign_out_enabled: true,
  shared_terminal_idle_reset_enabled: false,
  shared_terminal_idle_reset_seconds: 120,
  shared_terminal_excluded_from_staff_timeout: true,
  notes: ""
};

let initialised = false;
let heartbeatTimer = null;
let pendingPollTimer = null;
let onlineRealtimeChannel = null;
let messageRealtimeChannel = null;
let inactivityTimer = null;
let inactivityWarningTimer = null;
let requiredActionTimer = null;
let lastHeartbeatAt = 0;
let lastStaffActivityAt = Date.now();
let sessionKey = null;
let onlineSessions = [];
let messageHistory = [];
let selectedRecipient = null;
let messageQueue = [];
let activeMessage = null;
let sendMode = "profile";
let securitySettings = { ...DEFAULT_SECURITY_SETTINGS };
let adminSecuritySettings = null;
let inactivityWarningActive = false;
let inactivityLogoutInProgress = false;

function uniqueCodes(codes) {
  return Array.from(new Set(codes));
}

function hasActiveStaffProfile() {
  return Boolean(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

export function canViewAdminPresence() {
  return hasActiveStaffProfile() && hasAnyCapability(uniqueCodes(ADMIN_PRESENCE_CAPABILITIES));
}

function canViewOnlineUsers() {
  return hasActiveStaffProfile() && hasAnyCapability(PRESENCE_VIEW_CAPABILITIES);
}

function canSendSystemMessages() {
  return hasActiveStaffProfile() && hasAnyCapability(MESSAGE_SEND_CAPABILITIES);
}

function canSendForcedActions() {
  return hasActiveStaffProfile() && hasAnyCapability(FORCE_ACTION_CAPABILITIES);
}

function canViewSystemMessageHistory() {
  return hasActiveStaffProfile() && hasAnyCapability(MESSAGE_HISTORY_CAPABILITIES);
}

function canViewSessionSecuritySettings() {
  return hasActiveStaffProfile() && hasAnyCapability(SESSION_SECURITY_VIEW_CAPABILITIES);
}

function canManageSessionSecuritySettings() {
  return hasActiveStaffProfile() && hasAnyCapability(SESSION_SECURITY_MANAGE_CAPABILITIES);
}

function ensureSessionKey() {
  if (sessionKey) return sessionKey;
  sessionKey = sessionStorage.getItem(SESSION_KEY);
  if (!sessionKey) {
    sessionKey = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : "session-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    sessionStorage.setItem(SESSION_KEY, sessionKey);
  }
  return sessionKey;
}

function isSharedTerminalRuntime() {
  return document.body.dataset.operationsHubMode === "terminal" ||
    Boolean(AppState.terminalRegistration && AppState.terminalRegistration.registered);
}

function isKioskRuntime() {
  return Boolean(
    AppState.currentProfile &&
    AppState.currentProfile.role === "kiosk_user"
  ) || document.getElementById("operationsHubShell")?.classList.contains("oh-kiosk-mode");
}

function isStaffSessionRuntime() {
  return hasActiveStaffProfile() &&
    document.body.dataset.operationsHubMode === "workspace" &&
    !isSharedTerminalRuntime() &&
    !isKioskRuntime();
}

function currentWorkspaceLabel() {
  if (document.body.classList.contains("people-profile-workspace-open")) return "People Profile Workspace";
  if (document.body.classList.contains("assignment-workspace-open")) return "Assignment Workspace";
  if (document.body.classList.contains("workforce-calendar-fullscreen-active")) return "Workforce Calendar";
  if (document.body.classList.contains("monthly-rota-print-open")) return "Monthly Rota Print";
  if (document.body.classList.contains("document-signoff-overlay-open")) return "Document Sign-off Detail";
  const cue = $("ohWorkspaceCue");
  const text = cue ? cue.textContent.replace(/^Operations Hub\s*\/\s*/i, "").trim() : "";
  if (text) return text;
  const activeNav = document.querySelector("#ohNavigation .active .oh-nav-label, #ohNavigation .oh-nav-child-item.active");
  return activeNav ? activeNav.textContent.trim() : "Operations Hub";
}

function currentRouteLabel() {
  const visibleAdmin = Array.from(document.querySelectorAll("#administrationWorkspace > section"))
    .find(section => !section.classList.contains("hidden"));
  if (visibleAdmin) {
    const heading = visibleAdmin.querySelector("h1, h2, h3");
    if (heading && heading.textContent.trim()) return heading.textContent.trim();
  }
  return currentWorkspaceLabel();
}

function deviceLabel() {
  const width = window.innerWidth || 0;
  if (width < 600) return "Mobile browser tab";
  if (width < 1024) return "Tablet browser tab";
  return "Desktop browser tab";
}

async function sendPresenceHeartbeat(options = {}) {
  if (!hasActiveStaffProfile()) return;
  const now = Date.now();
  if (!options.force && now - lastHeartbeatAt < 10000) return;
  lastHeartbeatAt = now;
  try {
    await supabaseClient.rpc("upsert_app_user_presence", {
      p_session_key: ensureSessionKey(),
      p_current_workspace: currentWorkspaceLabel(),
      p_current_route: currentRouteLabel(),
      p_user_agent: navigator.userAgent || null,
      p_device_label: deviceLabel(),
      p_metadata: {
        app: "operations_hub",
        source: "frontend_presence_heartbeat"
      }
    });
  } catch (err) {
    if (options.notify) {
      showToast("Presence unavailable", err.message || "Could not update online presence.", "warning");
    }
  }
}

async function endPresence() {
  if (!sessionKey) sessionKey = sessionStorage.getItem(SESSION_KEY);
  if (!sessionKey || !AppState.currentProfile) return;
  try {
    await supabaseClient.rpc("end_app_user_presence", {
      p_session_key: sessionKey
    });
  } catch (err) {
    // Presence is best-effort and must not block sign-out/unload.
  }
}

function startHeartbeat() {
  stopHeartbeat();
  if (!hasActiveStaffProfile()) return;
  ensureSessionKey();
  void sendPresenceHeartbeat({ force: true });
  heartbeatTimer = window.setInterval(() => {
    void sendPresenceHeartbeat();
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  lastHeartbeatAt = 0;
}

function secondsLabel(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return value + "s ago";
  return Math.floor(value / 60) + "m ago";
}

function messageTypeLabel(value) {
  return String(value || "info").replace(/_/g, " ");
}

function requiredActionLabel(value) {
  return String(value || "acknowledge_only").replace(/_/g, " ");
}

function syncAdminPresenceVisibility() {
  const visible = canViewAdminPresence();
  const section = $("adminPresenceSection");
  if (section) section.classList.toggle("hidden", !visible);
  const online = $("adminPresenceOnlineCard");
  if (online) online.classList.toggle("hidden", !canViewOnlineUsers());
  const refresh = $("adminPresenceRefreshButton");
  if (refresh) {
    refresh.classList.toggle("hidden", !canViewOnlineUsers());
    refresh.disabled = !canViewOnlineUsers();
  }
  const sendAll = $("adminPresenceSendAllButton");
  if (sendAll) {
    sendAll.classList.toggle("hidden", !canSendSystemMessages());
    sendAll.disabled = !canSendSystemMessages();
  }
  const history = $("adminPresenceMessageHistoryCard");
  if (history) history.classList.toggle("hidden", !canViewSystemMessageHistory());
  const settings = $("adminPresenceSessionSecurityCard");
  if (settings) settings.classList.toggle("hidden", !canViewSessionSecuritySettings());
  syncForceActionControls();
  syncSessionSecurityFormState();
}

function syncForceActionControls() {
  const mode = $("adminPresenceMessageMode") ? $("adminPresenceMessageMode").value : "advisory";
  const required = mode === "required";
  const forceAllowed = canSendForcedActions();
  const actionRow = $("adminPresenceRequiredActionRow");
  const forceRow = $("adminPresenceForceActionRow");
  const grace = $("adminPresenceGraceSeconds");
  const hint = $("adminPresenceActionHint");
  if (actionRow) actionRow.classList.toggle("hidden", !required);
  if (forceRow) forceRow.classList.toggle("hidden", !required || !forceAllowed);
  if (grace) grace.disabled = !required;
  if (hint) hint.disabled = required;
  const forceMode = $("adminPresenceForceMode");
  if (forceMode && (!forceAllowed || !required)) forceMode.value = "request";
  updateSendAllConfirmationText();
}

function updateSendAllConfirmationText() {
  const confirmation = $("adminPresenceSendAllConfirmText");
  if (!confirmation) return;
  const mode = $("adminPresenceMessageMode") ? $("adminPresenceMessageMode").value : "advisory";
  const forceMode = $("adminPresenceForceMode") ? $("adminPresenceForceMode").value : "request";
  const messageKind = mode === "required"
    ? (forceMode === "force" && canSendForcedActions() ? "forced required action message" : "required action message")
    : "advisory system message";
  confirmation.textContent = "Send this " + messageKind + " to all currently connected users.";
}

function renderOnlineSessions() {
  const list = $("adminPresenceOnlineList");
  const summary = $("adminPresenceOnlineSummary");
  if (!list || !summary) return;
  list.innerHTML = "";
  summary.textContent = onlineSessions.length
    ? onlineSessions.length + " probably online session" + (onlineSessions.length === 1 ? "" : "s")
    : "No probably online sessions found.";

  onlineSessions.forEach(session => {
    const card = document.createElement("article");
    card.className = "admin-presence-session-card";

    const title = document.createElement("div");
    title.className = "admin-presence-session-title";
    title.innerHTML =
      "<strong>" + safe(session.display_name || "Unknown user") + "</strong>" +
      (session.is_current_user ? "<span class='admin-presence-current-user'>You</span>" : "");

    const meta = document.createElement("div");
    meta.className = "admin-presence-session-meta";
    meta.innerHTML =
      "<span>" + safe(session.current_workspace || "Operations Hub") + "</span>" +
      "<span>" + safe(secondsLabel(session.seconds_since_seen)) + "</span>" +
      "<span>" + safe(session.device_label || "Browser tab") + "</span>";

    const action = document.createElement("button");
    action.type = "button";
    action.className = "secondary";
    action.textContent = "Send Message";
    action.disabled = !canSendSystemMessages();
    decorateCapabilityAction(action, {
      actionId: "admin_presence.send_direct_message",
      label: "Send Message to " + (session.display_name || "selected user"),
      area: "Online Users / System Messages",
      requiredAny: MESSAGE_SEND_CAPABILITIES,
      actionType: "send"
    });
    action.addEventListener("click", () => openSendMessageModal("profile", session));

    card.append(title, meta, action);
    list.appendChild(card);
  });
}

async function loadOnlineSessions(options = {}) {
  if (!canViewOnlineUsers()) {
    onlineSessions = [];
    renderOnlineSessions();
    return;
  }
  const button = $("adminPresenceRefreshButton");
  if (button) button.disabled = true;
  try {
    const result = await supabaseClient.rpc("list_online_user_sessions", {
      p_online_seconds: ONLINE_WINDOW_SECONDS,
      p_include_current_user: true,
      p_search_text: $("adminPresenceSearch") ? $("adminPresenceSearch").value.trim() || null : null
    });
    if (result.error) throw result.error;
    onlineSessions = result.data || [];
    renderOnlineSessions();
  } catch (err) {
    onlineSessions = [];
    renderOnlineSessions();
    showToast("Online users unavailable", err.message || "Could not load probably online users.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadMessageHistory() {
  if (!canViewSystemMessageHistory()) return;
  try {
    const result = await supabaseClient.rpc("list_admin_system_message_history", {
      p_limit: 50,
      p_search_text: $("adminPresenceHistorySearch") ? $("adminPresenceHistorySearch").value.trim() || null : null
    });
    if (result.error) throw result.error;
    messageHistory = result.data || [];
    renderMessageHistory();
  } catch (err) {
    try {
      const fallback = await supabaseClient
        .from("admin_system_messages")
        .select("id, target_scope, target_profile_id, message_type, title, sent_at, expires_at, sent_by, requires_action, required_action, force_after_grace, required_action_deadline_at")
        .order("sent_at", { ascending: false })
        .limit(20);
      if (fallback.error) throw fallback.error;
      messageHistory = (fallback.data || []).map(row => ({
        message_id: row.id,
        ...row,
        acknowledgement_count: 0,
        action_completed_count: 0,
        auto_completed_count: 0
      }));
      renderMessageHistory();
    } catch (fallbackErr) {
      messageHistory = [];
      renderMessageHistory();
    }
  }
}

function renderMessageHistory() {
  const list = $("adminPresenceMessageHistoryList");
  const summary = $("adminPresenceHistorySummary");
  if (!list) return;
  list.innerHTML = "";
  if (summary) {
    summary.textContent = messageHistory.length
      ? messageHistory.length + " recent system message" + (messageHistory.length === 1 ? "" : "s")
      : "No recent system messages are available.";
  }
  if (!messageHistory.length) {
    list.innerHTML = "<div class='people-empty-state'>No recent system messages are available.</div>";
    return;
  }
  messageHistory.forEach(message => {
    const item = document.createElement("article");
    item.className = "admin-presence-history-item";
    const target = message.target_scope === "all_connected"
      ? "All connected"
      : (message.target_display_name || "Selected user" + (message.target_profile_id ? " " + String(message.target_profile_id).slice(0, 8) : ""));
    const sender = message.sent_by_name || (message.sent_by ? String(message.sent_by).slice(0, 8) : "System");
    const forced = message.force_after_grace ? "Forced" : (message.requires_action ? "Required" : "Advisory");
    item.innerHTML =
      "<div><strong>" + safe(message.title) + "</strong><span>" + safe(messageTypeLabel(message.message_type)) + "</span><span>" + safe(forced) + "</span></div>" +
      "<p>" + safe(new Date(message.sent_at).toLocaleString()) + " - " +
      safe("Sent by " + sender) + " - " +
      safe(target) + " - " +
      safe(message.required_action ? requiredActionLabel(message.required_action) : "no required action") + "</p>" +
      "<p>" + safe(String(message.acknowledgement_count || 0)) + " acknowledged - " +
      safe(String(message.action_completed_count || 0)) + " completed - " +
      safe(String(message.auto_completed_count || 0)) + " auto-completed" +
      (message.required_action_deadline_at ? " - Deadline " + safe(new Date(message.required_action_deadline_at).toLocaleString()) : "") + "</p>";
    list.appendChild(item);
  });
}

function resetMessageForm() {
  ["adminPresenceMessageTitle", "adminPresenceMessageBody"].forEach(id => {
    const input = $(id);
    if (input) input.value = "";
  });
  const mode = $("adminPresenceMessageMode");
  const type = $("adminPresenceMessageType");
  const hint = $("adminPresenceActionHint");
  const requiredAction = $("adminPresenceRequiredAction");
  const forceMode = $("adminPresenceForceMode");
  const expiry = $("adminPresenceExpiresMinutes");
  const grace = $("adminPresenceGraceSeconds");
  const confirm = $("adminPresenceSendAllConfirm");
  if (mode) mode.value = "advisory";
  if (type) type.value = "info";
  if (hint) hint.value = "acknowledge_only";
  if (requiredAction) requiredAction.value = "refresh_required";
  if (forceMode) forceMode.value = "request";
  if (expiry) expiry.value = "60";
  if (grace) grace.value = "300";
  if (confirm) confirm.checked = false;
  syncForceActionControls();
}

function openSendMessageModal(mode, session = null) {
  if (!canSendSystemMessages()) {
    showToast("You do not have permission", "Sending system messages requires admin system message permission.", "error");
    return;
  }
  sendMode = mode;
  selectedRecipient = session;
  resetMessageForm();
  const backdrop = $("adminPresenceMessageModalBackdrop");
  const target = $("adminPresenceMessageTarget");
  const allConfirm = $("adminPresenceSendAllConfirmRow");
  const recipientCount = $("adminPresenceMessageRecipientCount");
  if (target) {
    target.textContent = mode === "all_connected"
      ? "All currently connected users"
      : (session && session.display_name ? session.display_name : "Selected user");
  }
  if (allConfirm) allConfirm.classList.toggle("hidden", mode !== "all_connected");
  if (recipientCount) {
    recipientCount.textContent = mode === "all_connected"
      ? onlineSessions.length + " probably online session" + (onlineSessions.length === 1 ? "" : "s")
      : "";
  }
  if (backdrop) {
    backdrop.classList.add("active");
    focusFirstModalInput("adminPresenceMessageModalBackdrop");
  }
}

function closeSendMessageModal() {
  const backdrop = $("adminPresenceMessageModalBackdrop");
  if (backdrop) backdrop.classList.remove("active");
  selectedRecipient = null;
}

async function sendSystemMessage() {
  if (!canSendSystemMessages()) return;
  const title = $("adminPresenceMessageTitle") ? $("adminPresenceMessageTitle").value.trim() : "";
  const body = $("adminPresenceMessageBody") ? $("adminPresenceMessageBody").value.trim() : "";
  const messageMode = $("adminPresenceMessageMode") ? $("adminPresenceMessageMode").value : "advisory";
  const messageType = $("adminPresenceMessageType") ? $("adminPresenceMessageType").value : "info";
  const actionHint = $("adminPresenceActionHint") ? $("adminPresenceActionHint").value : "acknowledge_only";
  const requiredAction = $("adminPresenceRequiredAction") ? $("adminPresenceRequiredAction").value : "refresh_required";
  const forceMode = $("adminPresenceForceMode") ? $("adminPresenceForceMode").value : "request";
  const expiresMinutes = $("adminPresenceExpiresMinutes") ? Number($("adminPresenceExpiresMinutes").value || 60) : 60;
  const graceSeconds = $("adminPresenceGraceSeconds") ? Number($("adminPresenceGraceSeconds").value || 300) : 300;
  const forceAfterGrace = messageMode === "required" && forceMode === "force";
  const confirmAll = $("adminPresenceSendAllConfirm");
  if (!title || !body) {
    showToast("Message incomplete", "Enter a title and body before sending.", "error");
    return;
  }
  if (sendMode === "profile" && (!selectedRecipient || !selectedRecipient.profile_id)) {
    showToast("Recipient missing", "Select an online user before sending.", "error");
    return;
  }
  if (forceAfterGrace && !canSendForcedActions()) {
    showToast("Forced action unavailable", "Forcing action after grace requires forced system action permission.", "error");
    return;
  }
  if (sendMode === "all_connected" && (!confirmAll || !confirmAll.checked)) {
    showToast("Confirmation required", "Confirm before sending to all connected users.", "error");
    return;
  }

  const button = $("adminPresenceMessageSendButton");
  if (button) button.disabled = true;
  try {
    const targetScope = sendMode === "all_connected" ? "all_connected" : "profile";
    const targetProfileId = sendMode === "all_connected" ? null : selectedRecipient.profile_id;
    const rpcName = messageMode === "required"
      ? "send_required_admin_system_message"
      : "send_admin_system_message";
    const params = messageMode === "required"
      ? {
          p_target_scope: targetScope,
          p_target_profile_id: targetProfileId,
          p_title: title,
          p_body: body,
          p_message_type: MESSAGE_TYPES.includes(messageType) ? messageType : "access_update",
          p_required_action: REQUIRED_ACTIONS.includes(requiredAction) ? requiredAction : "refresh_required",
          p_force_after_grace: forceAfterGrace,
          p_grace_seconds: Math.max(30, Number.isFinite(graceSeconds) ? graceSeconds : 300),
          p_expires_minutes: Number.isFinite(expiresMinutes) ? expiresMinutes : 60,
          p_metadata: {
            source: "operations_hub_required_admin_presence",
            recipient_preview_count: sendMode === "all_connected" ? onlineSessions.length : 1
          }
        }
      : {
          p_target_scope: targetScope,
          p_target_profile_id: targetProfileId,
          p_title: title,
          p_body: body,
          p_message_type: MESSAGE_TYPES.includes(messageType) ? messageType : "info",
          p_action_hint: ADVISORY_ACTION_HINTS.includes(actionHint) ? actionHint : "acknowledge_only",
          p_expires_minutes: Number.isFinite(expiresMinutes) ? expiresMinutes : 60,
          p_metadata: {
            source: "operations_hub_admin_presence",
            recipient_preview_count: sendMode === "all_connected" ? onlineSessions.length : 1
          }
        };
    const result = await supabaseClient.rpc(rpcName, params);
    if (result.error) throw result.error;
    showToast(
      "System message sent",
      sendMode === "all_connected"
        ? (messageMode === "required" ? "Required system message sent to all connected users." : "System message sent to all connected users.")
        : "System message sent to " + (selectedRecipient.display_name || "the selected user") + ".",
      "success"
    );
    closeSendMessageModal();
    await loadMessageHistory();
  } catch (err) {
    showToast("System message not sent", err.message || "Could not send this system message.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function normaliseIncomingMessage(row) {
  if (!row) return null;
  return {
    message_id: row.message_id || row.id,
    target_scope: row.target_scope,
    message_type: row.message_type || "info",
    title: row.title || "System Message",
    body: row.body || "",
    action_hint: row.action_hint || row.required_action || "acknowledge_only",
    sent_at: row.sent_at,
    expires_at: row.expires_at,
    requires_action: row.requires_action === true,
    required_action: row.required_action || "",
    required_action_grace_seconds: row.required_action_grace_seconds || null,
    required_action_deadline_at: row.required_action_deadline_at || null,
    force_after_grace: row.force_after_grace === true
  };
}

function messageAlreadyQueued(messageId) {
  return activeMessage && activeMessage.message_id === messageId ||
    messageQueue.some(message => message.message_id === messageId);
}

function enqueueSystemMessage(rawMessage) {
  const message = normaliseIncomingMessage(rawMessage);
  if (!message || !message.message_id || messageAlreadyQueued(message.message_id)) return;
  if (message.expires_at && new Date(message.expires_at).getTime() <= Date.now()) return;
  messageQueue.push(message);
  showNextSystemMessage();
}

function actionButtonLabel(message) {
  const action = message.required_action || message.action_hint || "acknowledge_only";
  if (action === "refresh_required" || action === "refresh_now") return "Refresh now";
  if (action === "sign_out_and_back_in_required" || action === "sign_out_and_back_in") return "Sign out and back in";
  if (action === "sign_out_required" || action === "sign_out_now") return "Sign out now";
  return "Acknowledge";
}

function actionTakenForMessage(message) {
  const action = message.required_action || message.action_hint || "acknowledge_only";
  if (action === "refresh_required" || action === "refresh_now") return "refresh_now";
  if (action === "sign_out_and_back_in_required" || action === "sign_out_and_back_in") return "sign_out_and_back_in_now";
  if (action === "sign_out_required" || action === "sign_out_now") return "sign_out_now";
  return "acknowledge_only";
}

function updateRequiredActionCountdown() {
  if (!activeMessage) return;
  const countdown = $("adminSystemMessageCountdown");
  if (!countdown) return;
  if (!activeMessage.requires_action) {
    countdown.classList.add("hidden");
    countdown.textContent = "";
    return;
  }
  if (!activeMessage.force_after_grace || !activeMessage.required_action_deadline_at) {
    countdown.classList.remove("hidden");
    countdown.textContent = "Required action: " + requiredActionLabel(activeMessage.required_action) + ".";
    return;
  }
  const remaining = Math.max(0, Math.ceil((new Date(activeMessage.required_action_deadline_at).getTime() - Date.now()) / 1000));
  countdown.classList.remove("hidden");
  countdown.textContent = remaining
    ? "Required action: " + requiredActionLabel(activeMessage.required_action) + ". Forced in " + remaining + " seconds."
    : "Required action deadline reached.";
  if (remaining <= 0) {
    void completeActiveMessageAction({ autoCompleted: true });
  }
}

function startRequiredActionCountdown() {
  stopRequiredActionCountdown();
  updateRequiredActionCountdown();
  if (!activeMessage || !activeMessage.requires_action) return;
  requiredActionTimer = window.setInterval(updateRequiredActionCountdown, 1000);
}

function stopRequiredActionCountdown() {
  if (requiredActionTimer) window.clearInterval(requiredActionTimer);
  requiredActionTimer = null;
}

function showNextSystemMessage() {
  if (activeMessage || !messageQueue.length) return;
  activeMessage = messageQueue.shift();
  const backdrop = $("adminSystemMessageModalBackdrop");
  if (!backdrop) return;
  $("adminSystemMessageType").textContent = messageTypeLabel(activeMessage.message_type);
  $("adminSystemMessageTitle").textContent = activeMessage.title || "System Message";
  $("adminSystemMessageBody").textContent = activeMessage.body || "";
  const ack = $("adminSystemMessageAcknowledgeButton");
  const action = $("adminSystemMessageActionButton");
  const later = $("adminSystemMessageCloseButton");
  const activeActionTaken = actionTakenForMessage(activeMessage);
  if (ack) {
    ack.classList.toggle("hidden", activeMessage.requires_action && (
      activeMessage.force_after_grace || activeActionTaken !== "acknowledge_only"
    ));
    ack.textContent = activeMessage.requires_action ? "Complete required action" : "Acknowledge";
  }
  if (action) {
    const showAction = (activeMessage.requires_action && (
      activeMessage.force_after_grace || activeActionTaken !== "acknowledge_only"
    )) ||
      ["refresh_now", "sign_out_now", "sign_out_and_back_in"].includes(activeMessage.action_hint);
    action.classList.toggle("hidden", !showAction);
    action.textContent = actionButtonLabel(activeMessage);
  }
  if (later) {
    const allowLater = !activeMessage.requires_action ||
      (activeMessage.force_after_grace && activeMessage.required_action_deadline_at &&
        new Date(activeMessage.required_action_deadline_at).getTime() > Date.now());
    later.classList.toggle("hidden", !allowLater);
    later.textContent = activeMessage.requires_action && activeMessage.force_after_grace
      ? "Later"
      : "Later / Acknowledge";
  }
  backdrop.classList.add("active");
  startRequiredActionCountdown();
}

function closeSystemMessageModal() {
  const backdrop = $("adminSystemMessageModalBackdrop");
  if (backdrop) backdrop.classList.remove("active");
  stopRequiredActionCountdown();
  activeMessage = null;
  showNextSystemMessage();
}

async function acknowledgeActiveSystemMessage(options = {}) {
  if (!activeMessage || !activeMessage.message_id) return;
  if (activeMessage.requires_action &&
    (activeMessage.force_after_grace || actionTakenForMessage(activeMessage) !== "acknowledge_only") &&
    !options.forceAcknowledge) {
    await completeActiveMessageAction({ autoCompleted: false });
    return;
  }
  const message = activeMessage;
  try {
    const rpcName = message.requires_action
      ? "complete_admin_system_message_action"
      : "acknowledge_admin_system_message";
    const params = message.requires_action
      ? {
          p_message_id: message.message_id,
          p_session_key: ensureSessionKey(),
          p_action_taken: "acknowledge_only",
          p_auto_completed: false
        }
      : {
          p_message_id: message.message_id,
          p_session_key: ensureSessionKey()
        };
    const result = await supabaseClient.rpc(rpcName, params);
    if (result.error) throw result.error;
    if (!options.silent) showToast("System message acknowledged", "Thank you.", "success");
  } catch (err) {
    showToast("Acknowledgement failed", err.message || "Could not acknowledge this system message.", "error");
    return;
  }
  closeSystemMessageModal();
}

async function completeActiveMessageAction(options = {}) {
  if (!activeMessage || activeMessage.__completionInProgress) return;
  activeMessage.__completionInProgress = true;
  const message = activeMessage;
  const actionTaken = actionTakenForMessage(message);
  try {
    const rpcName = message.requires_action
      ? "complete_admin_system_message_action"
      : "acknowledge_admin_system_message";
    const params = message.requires_action
      ? {
          p_message_id: message.message_id,
          p_session_key: ensureSessionKey(),
          p_action_taken: actionTaken,
          p_auto_completed: options.autoCompleted === true
        }
      : {
          p_message_id: message.message_id,
          p_session_key: ensureSessionKey()
        };
    const result = await supabaseClient.rpc(rpcName, params);
    if (result.error) throw result.error;
  } catch (err) {
    activeMessage.__completionInProgress = false;
    showToast("Required action not recorded", err.message || "Could not record the required action.", "error");
    return;
  }
  closeSystemMessageModal();
  if (actionTaken === "refresh_now") {
    window.location.reload();
    return;
  }
  if (actionTaken === "sign_out_now" || actionTaken === "sign_out_and_back_in_now") {
    requestExistingLogout();
  }
}

function requestExistingLogout() {
  const logoutButton = $("ohAccountLogout") || $("topbarLogoutButton") || $("logoutButton");
  if (logoutButton) logoutButton.click();
}

async function runActiveMessageAction() {
  if (!activeMessage) return;
  await completeActiveMessageAction({ autoCompleted: false });
}

function postponeActiveMessage() {
  if (!activeMessage) return;
  if (activeMessage.requires_action && activeMessage.force_after_grace) {
    const deadline = activeMessage.required_action_deadline_at
      ? new Date(activeMessage.required_action_deadline_at).getTime()
      : 0;
    if (deadline <= Date.now()) {
      void completeActiveMessageAction({ autoCompleted: true });
      return;
    }
    const message = activeMessage;
    const backdrop = $("adminSystemMessageModalBackdrop");
    if (backdrop) backdrop.classList.remove("active");
    activeMessage = null;
    window.setTimeout(() => {
      enqueueSystemMessage(message);
    }, Math.min(Math.max(1000, deadline - Date.now()), 60000));
    stopRequiredActionCountdown();
    showNextSystemMessage();
    return;
  }
  void acknowledgeActiveSystemMessage();
}

async function loadPendingMessages() {
  if (!hasActiveStaffProfile()) return;
  try {
    const result = await supabaseClient.rpc("list_my_pending_system_messages_v2", {
      p_session_key: ensureSessionKey()
    });
    if (result.error) throw result.error;
    (result.data || []).forEach(enqueueSystemMessage);
  } catch (err) {
    try {
      const fallback = await supabaseClient.rpc("list_my_pending_system_messages");
      if (fallback.error) throw fallback.error;
      (fallback.data || []).forEach(enqueueSystemMessage);
    } catch (fallbackErr) {
      // Pending message fallback must stay quiet unless the user receives a message.
    }
  }
}

function startPendingPolling() {
  stopPendingPolling();
  if (!hasActiveStaffProfile()) return;
  void loadPendingMessages();
  pendingPollTimer = window.setInterval(loadPendingMessages, PENDING_POLL_MS);
}

function stopPendingPolling() {
  if (pendingPollTimer) window.clearInterval(pendingPollTimer);
  pendingPollTimer = null;
}

async function loadMySessionSecuritySettings() {
  if (!hasActiveStaffProfile()) return;
  try {
    const result = await supabaseClient.rpc("get_my_session_security_settings");
    if (result.error) throw result.error;
    securitySettings = {
      ...DEFAULT_SECURITY_SETTINGS,
      ...((result.data && result.data[0]) || {})
    };
  } catch (err) {
    securitySettings = { ...DEFAULT_SECURITY_SETTINGS };
  }
  scheduleStaffInactivityCheck();
}

async function loadSessionSecurityAdminSettings() {
  if (!canViewSessionSecuritySettings()) return;
  try {
    const result = await supabaseClient.rpc("get_session_security_admin_settings");
    if (result.error) throw result.error;
    adminSecuritySettings = (result.data && result.data[0]) || null;
    renderSessionSecuritySettings();
  } catch (err) {
    adminSecuritySettings = null;
    renderSessionSecuritySettings();
  }
}

function renderSessionSecuritySettings() {
  const settings = adminSecuritySettings || securitySettings || DEFAULT_SECURITY_SETTINGS;
  [
    ["adminPresenceStaffInactivityEnabled", settings.staff_inactivity_enabled],
    ["adminPresenceStaffAutoSignOutEnabled", settings.staff_auto_sign_out_enabled],
    ["adminPresenceTerminalIdleResetEnabled", settings.shared_terminal_idle_reset_enabled],
    ["adminPresenceTerminalExcluded", settings.shared_terminal_excluded_from_staff_timeout]
  ].forEach(([id, value]) => {
    const input = $(id);
    if (input) input.checked = value === true;
  });
  [
    ["adminPresenceStaffIdleMinutes", settings.staff_idle_timeout_minutes],
    ["adminPresenceStaffWarningSeconds", settings.staff_warning_seconds],
    ["adminPresenceTerminalIdleSeconds", settings.shared_terminal_idle_reset_seconds]
  ].forEach(([id, value]) => {
    const input = $(id);
    if (input) input.value = value == null ? "" : String(value);
  });
  const notes = $("adminPresenceSessionSecurityNotes");
  if (notes) notes.value = settings.notes || "";
  const meta = $("adminPresenceSessionSecurityMeta");
  if (meta) {
    meta.textContent = adminSecuritySettings && adminSecuritySettings.updated_at
      ? "Updated " + new Date(adminSecuritySettings.updated_at).toLocaleString() +
        (adminSecuritySettings.updated_by_name ? " by " + adminSecuritySettings.updated_by_name : "")
      : "Using default session security settings.";
  }
  syncSessionSecurityFormState();
}

function syncSessionSecurityFormState() {
  const canManage = canManageSessionSecuritySettings();
  [
    "adminPresenceStaffInactivityEnabled",
    "adminPresenceStaffIdleMinutes",
    "adminPresenceStaffWarningSeconds",
    "adminPresenceStaffAutoSignOutEnabled",
    "adminPresenceTerminalIdleResetEnabled",
    "adminPresenceTerminalIdleSeconds",
    "adminPresenceTerminalExcluded",
    "adminPresenceSessionSecurityNotes",
    "adminPresenceSessionSecuritySaveButton"
  ].forEach(id => {
    const element = $(id);
    if (element) element.disabled = !canManage;
  });
}

async function saveSessionSecuritySettings() {
  if (!canManageSessionSecuritySettings()) {
    showToast("You do not have permission", "Updating session security settings requires management permission.", "error");
    return;
  }
  const button = $("adminPresenceSessionSecuritySaveButton");
  if (button) button.disabled = true;
  try {
    const result = await supabaseClient.rpc("update_session_security_settings", {
      p_staff_inactivity_enabled: $("adminPresenceStaffInactivityEnabled").checked,
      p_staff_idle_timeout_minutes: Number($("adminPresenceStaffIdleMinutes").value || 30),
      p_staff_warning_seconds: Number($("adminPresenceStaffWarningSeconds").value || 60),
      p_staff_auto_sign_out_enabled: $("adminPresenceStaffAutoSignOutEnabled").checked,
      p_shared_terminal_idle_reset_enabled: $("adminPresenceTerminalIdleResetEnabled").checked,
      p_shared_terminal_idle_reset_seconds: Number($("adminPresenceTerminalIdleSeconds").value || 120),
      p_shared_terminal_excluded_from_staff_timeout: $("adminPresenceTerminalExcluded").checked,
      p_notes: $("adminPresenceSessionSecurityNotes").value.trim() || null
    });
    if (result.error) throw result.error;
    showToast("Session security saved", "Staff session security settings were updated.", "success");
    await loadMySessionSecuritySettings();
    await loadSessionSecurityAdminSettings();
  } catch (err) {
    showToast("Session security not saved", err.message || "Could not update session security settings.", "error");
  } finally {
    if (button) button.disabled = !canManageSessionSecuritySettings();
  }
}

function scheduleStaffInactivityCheck() {
  if (inactivityTimer) window.clearTimeout(inactivityTimer);
  inactivityTimer = null;
  if (!isStaffSessionRuntime()) return;
  if (!securitySettings.staff_inactivity_enabled || !securitySettings.staff_auto_sign_out_enabled) return;
  if (inactivityWarningActive || inactivityLogoutInProgress) return;
  const idleMs = Math.max(5, Number(securitySettings.staff_idle_timeout_minutes || 30)) * 60000;
  const remaining = Math.max(1000, lastStaffActivityAt + idleMs - Date.now());
  inactivityTimer = window.setTimeout(showInactivityWarning, remaining);
}

function recordStaffActivity() {
  if (!isStaffSessionRuntime() || inactivityWarningActive || inactivityLogoutInProgress) return;
  lastStaffActivityAt = Date.now();
  scheduleStaffInactivityCheck();
}

function showInactivityWarning() {
  if (!isStaffSessionRuntime()) return;
  inactivityWarningActive = true;
  const backdrop = $("staffInactivityWarningModalBackdrop");
  if (!backdrop) return;
  backdrop.classList.add("active");
  const deadline = Date.now() + Math.max(15, Number(securitySettings.staff_warning_seconds || 60)) * 1000;
  if (inactivityWarningTimer) window.clearInterval(inactivityWarningTimer);
  inactivityWarningTimer = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const countdown = $("staffInactivityWarningCountdown");
    if (countdown) countdown.textContent = String(remaining);
    if (remaining <= 0) {
      void performInactivityLogout();
    }
  }, 1000);
}

function closeInactivityWarning() {
  const backdrop = $("staffInactivityWarningModalBackdrop");
  if (backdrop) backdrop.classList.remove("active");
  if (inactivityWarningTimer) window.clearInterval(inactivityWarningTimer);
  inactivityWarningTimer = null;
  inactivityWarningActive = false;
}

function staySignedIn() {
  closeInactivityWarning();
  lastStaffActivityAt = Date.now();
  showToast("Session extended", "Your staff session remains active.", "success");
  scheduleStaffInactivityCheck();
}

async function performInactivityLogout() {
  if (inactivityLogoutInProgress) return;
  inactivityLogoutInProgress = true;
  closeInactivityWarning();
  showToast("Signing out", "You are being signed out due to inactivity.", "warning");
  requestExistingLogout();
}

function startRealtimeSubscriptions() {
  stopRealtimeSubscriptions();
  if (!hasActiveStaffProfile()) return;
  try {
    messageRealtimeChannel = supabaseClient
      .channel("oh-admin-system-messages-" + ensureSessionKey())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_system_messages" },
        payload => {
          const message = payload.new || {};
          const isDirect = message.target_scope === "profile" &&
            AppState.currentProfile &&
            message.target_profile_id === AppState.currentProfile.id;
          const isAllConnected = message.target_scope === "all_connected";
          if (isDirect || isAllConnected) enqueueSystemMessage(message);
        }
      )
      .subscribe();
  } catch (err) {
    messageRealtimeChannel = null;
  }

  if (!canViewOnlineUsers()) return;
  try {
    onlineRealtimeChannel = supabaseClient
      .channel("oh-admin-presence-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_user_sessions" },
        () => {
          if (canViewOnlineUsers()) void loadOnlineSessions();
        }
      )
      .subscribe();
  } catch (err) {
    onlineRealtimeChannel = null;
  }
}

function stopRealtimeSubscriptions() {
  [onlineRealtimeChannel, messageRealtimeChannel].forEach(channel => {
    if (channel) supabaseClient.removeChannel(channel);
  });
  onlineRealtimeChannel = null;
  messageRealtimeChannel = null;
}

export function syncAdminPresenceUi() {
  syncAdminPresenceVisibility();
  if (canViewAdminPresence()) {
    if (canViewOnlineUsers()) renderOnlineSessions();
    if (canViewSystemMessageHistory()) renderMessageHistory();
    if (canViewSessionSecuritySettings()) renderSessionSecuritySettings();
  }
}

export function refreshAdminPresenceWorkspace() {
  syncAdminPresenceUi();
  if (!canViewAdminPresence()) return;
  if (canViewOnlineUsers()) void loadOnlineSessions();
  if (canViewSystemMessageHistory()) void loadMessageHistory();
  if (canViewSessionSecuritySettings()) void loadSessionSecurityAdminSettings();
}

export function resetAdminPresence() {
  stopHeartbeat();
  stopPendingPolling();
  stopRealtimeSubscriptions();
  stopRequiredActionCountdown();
  if (inactivityTimer) window.clearTimeout(inactivityTimer);
  if (inactivityWarningTimer) window.clearInterval(inactivityWarningTimer);
  inactivityTimer = null;
  inactivityWarningTimer = null;
  inactivityWarningActive = false;
  inactivityLogoutInProgress = false;
  onlineSessions = [];
  messageHistory = [];
  messageQueue = [];
  activeMessage = null;
  closeSendMessageModal();
  const systemModal = $("adminSystemMessageModalBackdrop");
  if (systemModal) systemModal.classList.remove("active");
  const inactivityModal = $("staffInactivityWarningModalBackdrop");
  if (inactivityModal) inactivityModal.classList.remove("active");
}

export function initialiseAdminPresence() {
  if (initialised) return;
  initialised = true;

  [
    ["adminPresenceRefreshButton", "admin_presence.online_users.refresh", "Refresh Online Users", PRESENCE_VIEW_CAPABILITIES, "view"],
    ["adminPresenceSendAllButton", "admin_presence.send_all_connected", "Send to All Connected", MESSAGE_SEND_CAPABILITIES, "send"],
    ["adminPresenceMessageHistoryRefreshButton", "admin_presence.message_history.refresh", "View System Message History", MESSAGE_HISTORY_CAPABILITIES, "view"],
    ["adminPresenceMessageSendButton", "admin_presence.system_message.send", "Send System Message", MESSAGE_SEND_CAPABILITIES, "send"],
    ["adminSystemMessageAcknowledgeButton", "admin_presence.system_message.acknowledge", "Acknowledge System Message", [], "acknowledge"],
    ["adminSystemMessageActionButton", "admin_presence.system_message.complete_required_action", "Complete Required System Message Action", [], "complete"],
    ["adminPresenceSessionSecurityRefreshButton", "admin_presence.session_security.refresh", "View Session Security Settings", SESSION_SECURITY_VIEW_CAPABILITIES, "view"],
    ["adminPresenceSessionSecuritySaveButton", "admin_presence.session_security.update", "Update Session Security Settings", SESSION_SECURITY_MANAGE_CAPABILITIES, "update"],
    ["staffInactivityStaySignedInButton", "admin_presence.staff_inactivity.stay_signed_in", "Stay Signed In", [], "session"],
    ["staffInactivitySignOutButton", "admin_presence.staff_inactivity.sign_out_now", "Sign Out Now", [], "session"]
  ].forEach(([id, actionId, label, requiredAny, actionType]) => {
    const element = $(id);
    if (element) {
      decorateCapabilityAction(element, {
        actionId,
        label,
        area: "Online Users / System Messages",
        requiredAny,
        actionType
      });
    }
  });

  const refresh = $("adminPresenceRefreshButton");
  if (refresh) refresh.addEventListener("click", () => loadOnlineSessions({ notify: true }));
  const search = $("adminPresenceSearch");
  if (search) search.addEventListener("input", () => loadOnlineSessions());
  const sendAll = $("adminPresenceSendAllButton");
  if (sendAll) sendAll.addEventListener("click", () => openSendMessageModal("all_connected"));
  const historyRefresh = $("adminPresenceMessageHistoryRefreshButton");
  if (historyRefresh) historyRefresh.addEventListener("click", loadMessageHistory);
  const historySearch = $("adminPresenceHistorySearch");
  if (historySearch) historySearch.addEventListener("input", loadMessageHistory);
  const messageMode = $("adminPresenceMessageMode");
  if (messageMode) messageMode.addEventListener("change", syncForceActionControls);
  const forceMode = $("adminPresenceForceMode");
  if (forceMode) forceMode.addEventListener("change", updateSendAllConfirmationText);
  const modalClose = $("adminPresenceMessageModalClose");
  if (modalClose) modalClose.addEventListener("click", closeSendMessageModal);
  const modalCancel = $("adminPresenceMessageCancelButton");
  if (modalCancel) modalCancel.addEventListener("click", closeSendMessageModal);
  const modalSend = $("adminPresenceMessageSendButton");
  if (modalSend) modalSend.addEventListener("click", sendSystemMessage);
  const ack = $("adminSystemMessageAcknowledgeButton");
  if (ack) ack.addEventListener("click", () => acknowledgeActiveSystemMessage());
  const action = $("adminSystemMessageActionButton");
  if (action) action.addEventListener("click", runActiveMessageAction);
  const close = $("adminSystemMessageCloseButton");
  if (close) close.addEventListener("click", postponeActiveMessage);
  const securityRefresh = $("adminPresenceSessionSecurityRefreshButton");
  if (securityRefresh) securityRefresh.addEventListener("click", loadSessionSecurityAdminSettings);
  const securitySave = $("adminPresenceSessionSecuritySaveButton");
  if (securitySave) securitySave.addEventListener("click", saveSessionSecuritySettings);
  const stay = $("staffInactivityStaySignedInButton");
  if (stay) stay.addEventListener("click", staySignedIn);
  const signOut = $("staffInactivitySignOutButton");
  if (signOut) signOut.addEventListener("click", performInactivityLogout);

  ["click", "keydown", "pointerdown", "touchstart", "input", "change", "scroll"].forEach(eventName => {
    document.addEventListener(eventName, recordStaffActivity, { passive: true });
  });

  window.addEventListener("oh:capabilities-changed", () => {
    syncAdminPresenceUi();
    startRealtimeSubscriptions();
  });
  window.addEventListener("oh:session-signed-out", resetAdminPresence);
  window.addEventListener("oh:workspace-changed", () => {
    void sendPresenceHeartbeat({ force: true });
    recordStaffActivity();
  });
  window.addEventListener("beforeunload", () => {
    void endPresence();
  });

  startHeartbeat();
  startPendingPolling();
  startRealtimeSubscriptions();
  void loadMySessionSecuritySettings();
  syncAdminPresenceUi();
}

export function startAdminPresenceSession() {
  lastStaffActivityAt = Date.now();
  inactivityLogoutInProgress = false;
  startHeartbeat();
  startPendingPolling();
  startRealtimeSubscriptions();
  syncAdminPresenceUi();
  void loadMySessionSecuritySettings();
  void loadPendingMessages();
}

export async function stopAdminPresenceSession() {
  await endPresence();
  resetAdminPresence();
}
