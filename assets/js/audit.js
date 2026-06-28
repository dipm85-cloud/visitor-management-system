import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";

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
