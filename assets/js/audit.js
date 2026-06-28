import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { showMessage } from "./messages.js";
import { safe } from "./utils.js";

let auditDependencies;

export function configureAudit(dependencies) {
  auditDependencies = dependencies;
}

export function getBrowserAuditContext() {
  const { appVersion, getKioskToken } = auditDependencies;

  return {
    app_version: typeof appVersion !== "undefined" ? appVersion : "unknown",
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

export async function writeAuditEvent(eventType, entityType, entityId, details) {
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

export async function loadAuditEvents() {
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

export function openAuditDetailsModal(eventRecord) {
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

export function closeAuditDetailsModal() {
  $("auditDetailsModalBackdrop").classList.remove("active");
}

export function renderAuditEvents(box, data) {
  const { buildResultSummary, setResultBox, auditDiffSummary } = auditDependencies;

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
