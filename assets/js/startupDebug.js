import { KIOSK_TOKEN_STORAGE_KEY } from "./config.js";

const STARTUP_DEBUG_STORAGE_KEY = "oh_debug_startup";

function debugEnabled() {
  try {
    return localStorage.getItem(STARTUP_DEBUG_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function createDiagnostic() {
  return {
    enabled: debugEnabled(),
    localStorageKeyChecked: KIOSK_TOKEN_STORAGE_KEY,
    tokenExists: false,
    tokenPreview: null,
    staffSessionExists: null,
    terminalValidationRpcCalled: false,
    terminalValidationResult: null,
    finalChosenStartupRoute: null,
    currentRoute: null,
    laterRouteOverrides: [],
    authEvents: [],
    routeHistory: []
  };
}

function diagnostic() {
  if (!window.__ohStartupDebug) {
    window.__ohStartupDebug = createDiagnostic();
  }
  return window.__ohStartupDebug;
}

function logDebug(eventName, detail) {
  if (!debugEnabled()) return;
  console.debug("[OH startup]", eventName, detail);
}

function tokenPreview(token) {
  const value = String(token || "");
  if (!value) return null;
  if (value.length <= 8) return "******** (" + value.length + " chars)";
  return value.slice(0, 3) + "…" + value.slice(-3) + " (" + value.length + " chars)";
}

export function initialiseStartupDebug() {
  window.__ohStartupDebug = createDiagnostic();
  logDebug("diagnostic-initialised", window.__ohStartupDebug);
}

export function recordTerminalTokenLookup(token) {
  const state = diagnostic();
  state.localStorageKeyChecked = KIOSK_TOKEN_STORAGE_KEY;
  state.tokenExists = !!token;
  state.tokenPreview = tokenPreview(token);
  logDebug("terminal-token-read", {
    localStorageKeyChecked: state.localStorageKeyChecked,
    tokenExists: state.tokenExists,
    tokenPreview: state.tokenPreview
  });
}

export function recordStaffSession(exists) {
  const state = diagnostic();
  state.staffSessionExists = !!exists;
  logDebug("staff-session-read", { exists: state.staffSessionExists });
}

export function recordTerminalValidationCalled() {
  const state = diagnostic();
  state.terminalValidationRpcCalled = true;
  state.terminalValidationResult = "pending";
  logDebug("terminal-validation-called", { called: true });
}

export function recordTerminalValidationResult(result, error) {
  const state = diagnostic();
  state.terminalValidationResult = error
    ? { valid: false, error: "request_failed" }
    : { valid: result === true, error: null };
  logDebug("terminal-validation-result", state.terminalValidationResult);
}

export function recordFinalStartupRoute(route) {
  const state = diagnostic();
  state.finalChosenStartupRoute = route;
  logDebug("startup-route-chosen", { route });
}

export function recordAppliedRoute(route, source) {
  const state = diagnostic();
  const previousRoute = state.currentRoute;
  const entry = {
    route,
    source: source || "unspecified",
    at: new Date().toISOString()
  };

  state.currentRoute = route;
  state.routeHistory.push(entry);

  if (
    state.finalChosenStartupRoute &&
    previousRoute &&
    route !== previousRoute
  ) {
    state.laterRouteOverrides.push({
      from: previousRoute,
      to: route,
      source: entry.source,
      at: entry.at
    });
  }
  logDebug("route-applied", entry);
}

export function recordStartupAuthEvent(event, ignoredDuringStartup) {
  const state = diagnostic();
  const entry = {
    event,
    ignoredDuringStartup: !!ignoredDuringStartup,
    at: new Date().toISOString()
  };
  state.authEvents.push(entry);
  logDebug("auth-event", entry);
}
