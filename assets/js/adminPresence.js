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
const MESSAGE_HISTORY_CAPABILITIES = [
  "admin_system_messages.view",
  "admin_system_messages.send",
  "access_control.manage",
  "users.manage",
  "module_configuration.manage",
  "settings.view"
];
const SESSION_KEY = "oh_session_key";
const HEARTBEAT_MS = 30000;
const PENDING_POLL_MS = 90000;
const ONLINE_WINDOW_SECONDS = 120;
const MESSAGE_TYPES = ["info", "warning", "maintenance", "access_update", "refresh_required"];
const ACTION_HINTS = ["acknowledge_only", "refresh_now", "sign_out_now", "sign_out_and_back_in", "none"];

let initialised = false;
let heartbeatTimer = null;
let pendingPollTimer = null;
let onlineRealtimeChannel = null;
let messageRealtimeChannel = null;
let lastHeartbeatAt = 0;
let sessionKey = null;
let onlineSessions = [];
let messageHistory = [];
let selectedRecipient = null;
let messageQueue = [];
let activeMessage = null;
let sendMode = "profile";

function hasActiveStaffProfile() {
  return Boolean(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user"
  );
}

export function canViewAdminPresence() {
  return hasActiveStaffProfile() && hasAnyCapability(PRESENCE_VIEW_CAPABILITIES);
}

function canSendSystemMessages() {
  return hasActiveStaffProfile() && hasAnyCapability(MESSAGE_SEND_CAPABILITIES);
}

function canViewSystemMessageHistory() {
  return hasActiveStaffProfile() && hasAnyCapability(MESSAGE_HISTORY_CAPABILITIES);
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

function actionHintLabel(value) {
  return String(value || "acknowledge_only").replace(/_/g, " ");
}

function syncAdminPresenceVisibility() {
  const visible = canViewAdminPresence();
  const section = $("adminPresenceSection");
  if (section) section.classList.toggle("hidden", !visible);
  const sendAll = $("adminPresenceSendAllButton");
  if (sendAll) {
    sendAll.classList.toggle("hidden", !canSendSystemMessages());
    sendAll.disabled = !canSendSystemMessages();
  }
  const history = $("adminPresenceMessageHistoryCard");
  if (history) history.classList.toggle("hidden", !canViewSystemMessageHistory());
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
  if (!canViewAdminPresence()) {
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
    const messageResult = await supabaseClient
      .from("admin_system_messages")
      .select("id, target_scope, target_profile_id, message_type, title, sent_at, expires_at, sent_by")
      .order("sent_at", { ascending: false })
      .limit(20);
    if (messageResult.error) throw messageResult.error;
    const acknowledgementResult = await supabaseClient
      .from("admin_system_message_acknowledgements")
      .select("message_id");
    const ackCounts = new Map();
    if (!acknowledgementResult.error) {
      (acknowledgementResult.data || []).forEach(row => {
        ackCounts.set(row.message_id, (ackCounts.get(row.message_id) || 0) + 1);
      });
    }
    messageHistory = (messageResult.data || []).map(row => ({
      ...row,
      acknowledgement_count: ackCounts.get(row.id) || 0
    }));
    renderMessageHistory();
  } catch (err) {
    messageHistory = [];
    renderMessageHistory();
  }
}

function renderMessageHistory() {
  const list = $("adminPresenceMessageHistoryList");
  if (!list) return;
  list.innerHTML = "";
  if (!messageHistory.length) {
    list.innerHTML = "<div class='people-empty-state'>No recent system messages are available.</div>";
    return;
  }
  messageHistory.forEach(message => {
    const item = document.createElement("article");
    item.className = "admin-presence-history-item";
    const target = message.target_scope === "all_connected"
      ? "All connected"
      : "Selected user" + (message.target_profile_id ? " " + String(message.target_profile_id).slice(0, 8) : "");
    const sender = message.sent_by ? String(message.sent_by).slice(0, 8) : "System";
    item.innerHTML =
      "<div><strong>" + safe(message.title) + "</strong><span>" + safe(messageTypeLabel(message.message_type)) + "</span></div>" +
      "<p>" + safe(new Date(message.sent_at).toLocaleString()) + " · " +
      safe("Sent by " + sender) + " · " +
      safe(target) + " · " +
      safe(String(message.acknowledgement_count || 0)) + " acknowledged</p>";
    list.appendChild(item);
  });
}

function resetMessageForm() {
  ["adminPresenceMessageTitle", "adminPresenceMessageBody"].forEach(id => {
    const input = $(id);
    if (input) input.value = "";
  });
  const type = $("adminPresenceMessageType");
  const hint = $("adminPresenceActionHint");
  const expiry = $("adminPresenceExpiresMinutes");
  const confirm = $("adminPresenceSendAllConfirm");
  if (type) type.value = "info";
  if (hint) hint.value = "acknowledge_only";
  if (expiry) expiry.value = "60";
  if (confirm) confirm.checked = false;
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
  const messageType = $("adminPresenceMessageType") ? $("adminPresenceMessageType").value : "info";
  const actionHint = $("adminPresenceActionHint") ? $("adminPresenceActionHint").value : "acknowledge_only";
  const expiresMinutes = $("adminPresenceExpiresMinutes") ? Number($("adminPresenceExpiresMinutes").value || 60) : 60;
  const confirmAll = $("adminPresenceSendAllConfirm");
  if (!title || !body) {
    showToast("Message incomplete", "Enter a title and body before sending.", "error");
    return;
  }
  if (sendMode === "profile" && (!selectedRecipient || !selectedRecipient.profile_id)) {
    showToast("Recipient missing", "Select an online user before sending.", "error");
    return;
  }
  if (sendMode === "all_connected" && (!confirmAll || !confirmAll.checked)) {
    showToast("Confirmation required", "Confirm before sending to all connected users.", "error");
    return;
  }

  const button = $("adminPresenceMessageSendButton");
  if (button) button.disabled = true;
  try {
    const result = await supabaseClient.rpc("send_admin_system_message", {
      p_target_scope: sendMode === "all_connected" ? "all_connected" : "profile",
      p_target_profile_id: sendMode === "all_connected" ? null : selectedRecipient.profile_id,
      p_title: title,
      p_body: body,
      p_message_type: MESSAGE_TYPES.includes(messageType) ? messageType : "info",
      p_action_hint: ACTION_HINTS.includes(actionHint) ? actionHint : "acknowledge_only",
      p_expires_minutes: Number.isFinite(expiresMinutes) ? expiresMinutes : 60,
      p_metadata: {
        source: "operations_hub_admin_presence",
        recipient_preview_count: sendMode === "all_connected" ? onlineSessions.length : 1
      }
    });
    if (result.error) throw result.error;
    showToast(
      "System message sent",
      sendMode === "all_connected"
        ? "System message sent to all connected users."
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
    action_hint: row.action_hint || "acknowledge_only",
    sent_at: row.sent_at,
    expires_at: row.expires_at
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

function showNextSystemMessage() {
  if (activeMessage || !messageQueue.length) return;
  activeMessage = messageQueue.shift();
  const backdrop = $("adminSystemMessageModalBackdrop");
  if (!backdrop) return;
  $("adminSystemMessageType").textContent = messageTypeLabel(activeMessage.message_type);
  $("adminSystemMessageTitle").textContent = activeMessage.title || "System Message";
  $("adminSystemMessageBody").textContent = activeMessage.body || "";
  const action = $("adminSystemMessageActionButton");
  if (action) {
    const hint = activeMessage.action_hint || "acknowledge_only";
    const showAction = ["refresh_now", "sign_out_now", "sign_out_and_back_in"].includes(hint);
    action.classList.toggle("hidden", !showAction);
    action.textContent = hint === "refresh_now"
      ? "Refresh now"
      : (hint === "sign_out_and_back_in" ? "Sign out and back in" : "Sign out now");
  }
  backdrop.classList.add("active");
}

function closeSystemMessageModal() {
  const backdrop = $("adminSystemMessageModalBackdrop");
  if (backdrop) backdrop.classList.remove("active");
  activeMessage = null;
  showNextSystemMessage();
}

async function acknowledgeActiveSystemMessage(options = {}) {
  if (!activeMessage || !activeMessage.message_id) return;
  const message = activeMessage;
  try {
    const result = await supabaseClient.rpc("acknowledge_admin_system_message", {
      p_message_id: message.message_id,
      p_session_key: ensureSessionKey()
    });
    if (result.error) throw result.error;
    if (!options.silent) showToast("System message acknowledged", "Thank you.", "success");
  } catch (err) {
    showToast("Acknowledgement failed", err.message || "Could not acknowledge this system message.", "error");
    return;
  }
  closeSystemMessageModal();
}

async function runActiveMessageAction() {
  if (!activeMessage) return;
  const hint = activeMessage.action_hint || "acknowledge_only";
  await acknowledgeActiveSystemMessage({ silent: true });
  if (hint === "refresh_now") {
    window.location.reload();
    return;
  }
  if (hint === "sign_out_now" || hint === "sign_out_and_back_in") {
    const logoutButton = $("ohAccountLogout") || $("topbarLogoutButton") || $("logoutButton");
    if (logoutButton) logoutButton.click();
  }
}

async function loadPendingMessages() {
  if (!hasActiveStaffProfile()) return;
  try {
    const result = await supabaseClient.rpc("list_my_pending_system_messages");
    if (result.error) throw result.error;
    (result.data || []).forEach(enqueueSystemMessage);
  } catch (err) {
    // Pending message fallback must stay quiet unless the user receives a message.
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

  if (!canViewAdminPresence()) return;
  try {
    onlineRealtimeChannel = supabaseClient
      .channel("oh-admin-presence-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_user_sessions" },
        () => {
          if (canViewAdminPresence()) void loadOnlineSessions();
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
    renderOnlineSessions();
    renderMessageHistory();
  }
}

export function refreshAdminPresenceWorkspace() {
  syncAdminPresenceUi();
  if (!canViewAdminPresence()) return;
  void loadOnlineSessions();
  void loadMessageHistory();
}

export function resetAdminPresence() {
  stopHeartbeat();
  stopPendingPolling();
  stopRealtimeSubscriptions();
  onlineSessions = [];
  messageHistory = [];
  messageQueue = [];
  activeMessage = null;
  closeSendMessageModal();
  const systemModal = $("adminSystemMessageModalBackdrop");
  if (systemModal) systemModal.classList.remove("active");
}

export function initialiseAdminPresence() {
  if (initialised) return;
  initialised = true;

  [
    ["adminPresenceRefreshButton", "admin_presence.online_users.refresh", "Refresh Online Users", PRESENCE_VIEW_CAPABILITIES, "view"],
    ["adminPresenceSendAllButton", "admin_presence.send_all_connected", "Send to All Connected", MESSAGE_SEND_CAPABILITIES, "send"],
    ["adminPresenceMessageHistoryRefreshButton", "admin_presence.message_history.refresh", "View System Message History", MESSAGE_HISTORY_CAPABILITIES, "view"],
    ["adminPresenceMessageSendButton", "admin_presence.system_message.send", "Send System Message", MESSAGE_SEND_CAPABILITIES, "send"],
    ["adminSystemMessageAcknowledgeButton", "admin_presence.system_message.acknowledge", "Acknowledge System Message", [], "acknowledge"]
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
  if (close) close.addEventListener("click", () => acknowledgeActiveSystemMessage());

  window.addEventListener("oh:capabilities-changed", () => {
    syncAdminPresenceUi();
    startRealtimeSubscriptions();
  });
  window.addEventListener("oh:session-signed-out", resetAdminPresence);
  window.addEventListener("oh:workspace-changed", () => {
    void sendPresenceHeartbeat({ force: true });
  });
  window.addEventListener("beforeunload", () => {
    void endPresence();
  });

  startHeartbeat();
  startPendingPolling();
  startRealtimeSubscriptions();
  syncAdminPresenceUi();
}

export function startAdminPresenceSession() {
  startHeartbeat();
  startPendingPolling();
  startRealtimeSubscriptions();
  syncAdminPresenceUi();
  void loadPendingMessages();
}

export async function stopAdminPresenceSession() {
  await endPresence();
  resetAdminPresence();
}
