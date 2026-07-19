const ENABLED_KEY = "oh_render_diagnostics_enabled";
const ACTIONS_KEY = "oh_render_diagnostics_recent_actions";
const MUTATIONS_KEY = "oh_render_diagnostics_recent_mutations";
const LAST_REPORT_KEY = "oh_render_diagnostics_last_report";
const MAX_ACTIONS = 50;
const MAX_MUTATIONS = 40;
const MAX_REPORT_ACTIONS = 20;
const DRIFT_THRESHOLD_PX = 2;

let enabled = false;
let initialised = false;
let actions = [];
let mutations = [];
let baselines = [];
let observers = [];
let compareTimer = null;
let lastDriftSignature = "";
let lastDriftLogAt = 0;
let eventListenersSetup = false;
let observedBrandingStyles = new WeakSet();

const WATCHED_STYLE_ATTRIBUTES = [
  "class",
  "style",
  "data-theme",
  "data-branding-theme-mode",
  "data-brand-contrast-mode",
  "data-oh-branding-background-mode",
  "data-oh-public-branding-background-mode",
  "data-logo-size"
];

const BASELINE_TARGETS = [
  { key: "side_nav_label", label: "Side navigation label", selector: "#ohNavigation .oh-nav-item .oh-nav-label" },
  { key: "active_nav_label", label: "Active navigation label", selector: "#ohNavigation .oh-nav-item.active .oh-nav-label, #ohNavigation .oh-nav-child-item.active" },
  { key: "administration_nav_item", label: "Administration child nav item", selector: "#ohAdministrationChildren .oh-nav-child-item" },
  { key: "application_settings_card_title", label: "Application Settings card title", selector: "#applicationSettingsSection .application-settings-card h4" },
  { key: "application_settings_description", label: "Application Settings description", selector: "#applicationSettingsSection .application-settings-card p, #applicationSettingsSection .application-settings-heading p" },
  { key: "setting_label", label: "Setting label/title", selector: "#applicationSettingsSection .application-settings-control span, #applicationSettingsSection label span" },
  { key: "button_text", label: "Button text", selector: "#operationsHubShell button" }
];

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function persistRollingState() {
  try {
    sessionStorage.setItem(ACTIONS_KEY, JSON.stringify(actions));
    sessionStorage.setItem(MUTATIONS_KEY, JSON.stringify(mutations));
  } catch {
    // Storage is best-effort only.
  }
}

function loadRollingState() {
  actions = safeJsonParse(sessionStorage.getItem(ACTIONS_KEY), []).slice(-MAX_ACTIONS);
  mutations = safeJsonParse(sessionStorage.getItem(MUTATIONS_KEY), []).slice(-MAX_MUTATIONS);
}

function trimText(value, limit = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "..." : text;
}

function classSummary(element) {
  return trimText(element && element.className ? String(element.className) : "", 160);
}

function elementSummary(element) {
  if (!element || element.nodeType !== 1) return "unknown";
  const parts = [element.tagName.toLowerCase()];
  if (element.id) parts.push("#" + element.id);
  const classes = String(element.className || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (classes.length) parts.push("." + classes.join("."));
  return parts.join("");
}

function parentClassSummary(element) {
  const parent = element && element.parentElement;
  if (!parent) return "";
  const relevant = parent.closest("#operationsHubShell, #ohNavigation, #applicationSettingsSection, .oh-layout, .oh-workspace, .application-settings-card");
  return relevant ? elementSummary(relevant) + " " + classSummary(relevant) : elementSummary(parent) + " " + classSummary(parent);
}

function safeTargetMetadata(target, eventType) {
  const element = target instanceof Element ? target : null;
  if (!element) return { target: "unknown" };
  const data = element.dataset || {};
  const metadata = {
    target: elementSummary(element),
    id: element.id || "",
    tag: element.tagName.toLowerCase(),
    type: element.getAttribute("type") || "",
    name: element.getAttribute("name") || "",
    role: element.getAttribute("role") || "",
    capabilityAction: data.capabilityAction || data.navAction || "",
    capabilityLabel: data.capabilityLabel || ""
  };
  if (eventType === "click") {
    const labelled = data.capabilityLabel || element.getAttribute("aria-label") || element.getAttribute("title") || "";
    const safeTextScope = element.closest("#ohNavigation, #applicationSettingsSection, #referenceDataSection");
    if (labelled) metadata.text = trimText(labelled, 90);
    else if (safeTextScope && !element.matches("input, textarea, select")) metadata.text = trimText(element.textContent, 90);
  }
  return metadata;
}

function recordAction(type, details = {}) {
  if (!enabled) return;
  actions.push({
    ts: nowIso(),
    type,
    ...details
  });
  actions = actions.slice(-MAX_ACTIONS);
  persistRollingState();
}

function recordMutation(details = {}) {
  if (!enabled) return;
  mutations.push({
    ts: nowIso(),
    lastAction: actions[actions.length - 1] || null,
    ...details
  });
  mutations = mutations.slice(-MAX_MUTATIONS);
  persistRollingState();
}

function readComputedSample(target) {
  const element = document.querySelector(target.selector);
  if (!element) {
    return {
      key: target.key,
      label: target.label,
      selector: target.selector,
      found: false
    };
  }
  const style = window.getComputedStyle(element);
  return {
    key: target.key,
    label: target.label,
    selector: target.selector,
    found: true,
    element: elementSummary(element),
    className: classSummary(element),
    parentClasses: parentClassSummary(element),
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily
  };
}

function establishBaseline(reason = "initial") {
  baselines = BASELINE_TARGETS.map(readComputedSample);
  recordAction("typography-baseline", {
    reason,
    found: baselines.filter(item => item.found).length,
    total: baselines.length
  });
}

function pxValue(value) {
  const number = Number.parseFloat(String(value || ""));
  return Number.isFinite(number) ? number : null;
}

function compareSample(baseline, current) {
  if (!baseline || !baseline.found || !current || !current.found) return null;
  const changes = {};
  const beforeFont = pxValue(baseline.fontSize);
  const afterFont = pxValue(current.fontSize);
  if (beforeFont != null && afterFont != null && Math.abs(afterFont - beforeFont) > DRIFT_THRESHOLD_PX) {
    changes.fontSize = { before: baseline.fontSize, after: current.fontSize };
  }
  const beforeLine = pxValue(baseline.lineHeight);
  const afterLine = pxValue(current.lineHeight);
  if (beforeLine != null && afterLine != null && Math.abs(afterLine - beforeLine) > DRIFT_THRESHOLD_PX) {
    changes.lineHeight = { before: baseline.lineHeight, after: current.lineHeight };
  }
  return Object.keys(changes).length ? {
    key: baseline.key,
    label: baseline.label,
    selector: baseline.selector,
    element: current.element,
    before: baseline,
    after: current,
    changes
  } : null;
}

function brandingStyleTagCount() {
  return document.querySelectorAll("style[data-oh-owned='branding-theme'], #oh-branding-theme-guard").length;
}

function rootState() {
  const html = document.documentElement;
  const body = document.body;
  const shell = document.getElementById("operationsHubShell");
  return {
    htmlClass: classSummary(html),
    bodyClass: classSummary(body),
    shellClass: classSummary(shell),
    htmlData: { ...(html ? html.dataset : {}) },
    bodyData: { ...(body ? body.dataset : {}) },
    brandingStyleTagCount: brandingStyleTagCount(),
    location: window.location.pathname + window.location.search + window.location.hash
  };
}

function snapshot(reason = "manual") {
  return {
    ts: nowIso(),
    reason,
    enabled,
    root: rootState(),
    baselines,
    current: BASELINE_TARGETS.map(readComputedSample),
    recentActions: actions.slice(-MAX_REPORT_ACTIONS),
    recentMutations: mutations.slice(-MAX_MUTATIONS)
  };
}

function storeReport(report) {
  try {
    sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify(report));
  } catch {
    // Ignore storage failures.
  }
}

function logReport(report, heading = "Render diagnostics report") {
  if (typeof console === "undefined") return;
  console.groupCollapsed(heading);
  console.log(report);
  console.table(report.drift || report.current || []);
  console.groupEnd();
}

function buildReport(reason = "manual", drift = []) {
  const report = {
    ...snapshot(reason),
    drift
  };
  storeReport(report);
  return report;
}

function report(reason = "manual") {
  const current = BASELINE_TARGETS.map(readComputedSample);
  const drift = baselines
    .map((baseline, index) => compareSample(baseline, current[index]))
    .filter(Boolean);
  const output = buildReport(reason, drift);
  logReport(output, drift.length ? "Render drift detected" : "Render diagnostics report");
  return output;
}

function compareTypography(reason = "scheduled") {
  if (!enabled || !baselines.length) return;
  const current = BASELINE_TARGETS.map(readComputedSample);
  const drift = baselines
    .map((baseline, index) => compareSample(baseline, current[index]))
    .filter(Boolean);
  if (!drift.length) return;
  const signature = JSON.stringify(drift.map(item => [item.key, item.changes]));
  const nowMs = Date.now();
  if (signature === lastDriftSignature && nowMs - lastDriftLogAt < 30000) return;
  lastDriftSignature = signature;
  lastDriftLogAt = nowMs;
  const driftReport = buildReport(reason, drift);
  logReport(driftReport, "Render drift detected");
}

function scheduleCompare(reason) {
  if (!enabled) return;
  if (compareTimer) window.clearTimeout(compareTimer);
  compareTimer = window.setTimeout(() => {
    compareTimer = null;
    compareTypography(reason);
  }, 180);
}

function mutationAttributeValue(target, attributeName) {
  if (!target || target.nodeType !== 1 || !attributeName) return "";
  return target.getAttribute(attributeName) || "";
}

function watchAttributes(target, label) {
  if (!target) return;
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type !== "attributes") return;
      recordMutation({
        type: "attribute",
        element: label || elementSummary(record.target),
        attribute: record.attributeName,
        oldValue: trimText(record.oldValue || "", 220),
        newValue: trimText(mutationAttributeValue(record.target, record.attributeName), 220)
      });
    });
    scheduleCompare("attribute-mutation");
  });
  observer.observe(target, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: WATCHED_STYLE_ATTRIBUTES
  });
  observers.push(observer);
}

function watchBrandingStyleTag(styleElement) {
  if (!styleElement || observedBrandingStyles.has(styleElement)) return;
  observedBrandingStyles.add(styleElement);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      recordMutation({
        type: "branding-style",
        element: elementSummary(styleElement),
        mutationType: record.type
      });
    });
    scheduleCompare("branding-style-mutation");
  });
  observer.observe(styleElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
  observers.push(observer);
}

function refreshBrandingStyleWatchers() {
  document
    .querySelectorAll("style[data-oh-owned='branding-theme'], #oh-branding-theme-guard")
    .forEach(watchBrandingStyleTag);
}

function setupMutationObservers() {
  watchAttributes(document.documentElement, "documentElement");
  watchAttributes(document.body, "body");
  watchAttributes(document.getElementById("operationsHubShell"), "operationsHubShell");
  watchAttributes(document.getElementById("ohNavigation"), "ohNavigation");
  watchAttributes(document.getElementById("applicationSettingsSection"), "applicationSettingsSection");
  refreshBrandingStyleWatchers();
  const headObserver = new MutationObserver(records => {
    records.forEach(record => {
      Array.from(record.addedNodes || []).forEach(node => {
        if (node.nodeType === 1 && node.matches && node.matches("style[data-oh-owned='branding-theme'], #oh-branding-theme-guard")) {
          recordMutation({ type: "branding-style-added", element: elementSummary(node) });
          watchBrandingStyleTag(node);
        }
      });
      Array.from(record.removedNodes || []).forEach(node => {
        if (node.nodeType === 1 && node.matches && node.matches("style[data-oh-owned='branding-theme'], #oh-branding-theme-guard")) {
          recordMutation({ type: "branding-style-removed", element: elementSummary(node) });
        }
      });
    });
    scheduleCompare("head-style-mutation");
  });
  headObserver.observe(document.head, { childList: true });
  observers.push(headObserver);
}

function setupEventListeners() {
  if (eventListenersSetup) return;
  eventListenersSetup = true;
  document.addEventListener("click", event => {
    recordAction("click", safeTargetMetadata(event.target, "click"));
    scheduleCompare("click");
  }, true);
  document.addEventListener("input", event => {
    recordAction("input", safeTargetMetadata(event.target, "input"));
  }, true);
  document.addEventListener("change", event => {
    recordAction("change", safeTargetMetadata(event.target, "change"));
    scheduleCompare("change");
  }, true);
  document.addEventListener("visibilitychange", () => {
    recordAction("visibilitychange", { visibilityState: document.visibilityState });
    scheduleCompare("visibilitychange");
  });
  window.addEventListener("focus", () => {
    recordAction("window-focus");
    scheduleCompare("window-focus");
  });
  window.addEventListener("blur", () => recordAction("window-blur"));
  window.addEventListener("hashchange", () => {
    recordAction("hashchange", { hash: window.location.hash });
    scheduleCompare("hashchange");
  });
  window.addEventListener("popstate", () => {
    recordAction("popstate", { path: window.location.pathname + window.location.search });
    scheduleCompare("popstate");
  });
  window.addEventListener("oh:branding-theme-applied", event => {
    recordAction("branding-theme-applied", {
      themeMode: event.detail?.branding?.themeMode || "",
      backgroundMode: event.detail?.branding?.backgroundMode || "",
      cornerStyle: event.detail?.branding?.cornerStyle || ""
    });
    refreshBrandingStyleWatchers();
    scheduleCompare("branding-theme-applied");
  });
  window.addEventListener("oh:application-settings-values-changed", event => {
    recordAction("application-settings-values-changed", {
      settingKey: event.detail?.settingKey || "",
      categoryCode: event.detail?.categoryCode || "",
      reset: event.detail?.reset === true
    });
    scheduleCompare("application-settings-values-changed");
  });
  window.addEventListener("oh:toast-shown", event => {
    recordAction("toast", {
      title: trimText(event.detail?.title || "", 80),
      type: event.detail?.type || ""
    });
  });
}

function clear() {
  actions = [];
  mutations = [];
  baselines = [];
  lastDriftSignature = "";
  lastDriftLogAt = 0;
  sessionStorage.removeItem(ACTIONS_KEY);
  sessionStorage.removeItem(MUTATIONS_KEY);
  sessionStorage.removeItem(LAST_REPORT_KEY);
  if (enabled) establishBaseline("manual-clear");
}

function disable() {
  enabled = false;
  sessionStorage.removeItem(ENABLED_KEY);
  observers.forEach(observer => observer.disconnect());
  observers = [];
  observedBrandingStyles = new WeakSet();
  if (compareTimer) window.clearTimeout(compareTimer);
  compareTimer = null;
  window.ohRenderDiagnostics = {
    enable
  };
  if (typeof console !== "undefined") {
    console.info("Render diagnostics disabled.");
  }
}

function enable() {
  if (enabled) return window.ohRenderDiagnostics;
  enabled = true;
  sessionStorage.setItem(ENABLED_KEY, "true");
  loadRollingState();
  setupMutationObservers();
  setupEventListeners();
  establishBaseline("enabled");
  window.setTimeout(() => establishBaseline("post-startup"), 600);
  window.setTimeout(() => scheduleCompare("post-startup-check"), 1400);
  window.ohRenderDiagnostics = {
    enable,
    disable,
    snapshot,
    report,
    clear,
    getLastReport() {
      return safeJsonParse(sessionStorage.getItem(LAST_REPORT_KEY), null);
    }
  };
  console.info("Render diagnostics enabled. Run ohRenderDiagnostics.report() to capture a snapshot.");
  return window.ohRenderDiagnostics;
}

export function initialiseRenderDiagnostics() {
  if (initialised) return;
  initialised = true;

  const params = new URLSearchParams(window.location.search);
  if (params.get("renderDebug") === "1") {
    sessionStorage.setItem(ENABLED_KEY, "true");
  }

  if (sessionStorage.getItem(ENABLED_KEY) === "true") {
    enable();
    return;
  }

  window.ohRenderDiagnostics = { enable };
  if (typeof console !== "undefined") {
    console.info("Render diagnostics disabled. Enable with sessionStorage.setItem(\"oh_render_diagnostics_enabled\", \"true\"); location.reload(); or add ?renderDebug=1.");
  }
}
