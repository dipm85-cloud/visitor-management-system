import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { APP_BUILD_LABEL } from "./config.js";
import { AppState } from "./state.js";

const shell = document.getElementById("operationsHubShell");
const layout = shell ? shell.querySelector(".oh-layout") : null;
const navigation = document.getElementById("ohNavigation");
const navToggle = document.getElementById("ohNavToggle");
const navScrim = document.getElementById("ohNavScrim");
const dashboardNav = document.getElementById("ohDashboardNav");
const visitorsNav = document.getElementById("ohVisitorsNav");
const legacyVmsNav = document.getElementById("ohLegacyVmsNav");
const peopleNav = document.getElementById("ohPeopleNav");
const workforceCalendarNav = document.getElementById("ohWorkforceCalendarNav");
const organisationsNav = document.getElementById("ohOrganisationsNav");
const reportingNav = document.getElementById("ohReportingNav");
const administrationGroup = document.getElementById("ohAdministrationGroup");
const administrationChildren = document.getElementById("ohAdministrationChildren");
const administrationNav = document.getElementById("ohAdministrationNav");
const settingsShortcut = document.getElementById("ohSettingsShortcut");
const currentUserButton = document.getElementById("ohCurrentUserButton");
const accountMenu = document.getElementById("ohAccountMenu");
const currentUser = document.getElementById("ohCurrentUser");
const accountDisplayName = document.getElementById("ohAccountDisplayName");
const accountDisplayRole = document.getElementById("ohAccountDisplayRole");
const accountChangePassword = document.getElementById("ohAccountChangePassword");
const accountLogout = document.getElementById("ohAccountLogout");
const workspaceCue = document.getElementById("ohWorkspaceCue");
const platformVersion = document.getElementById("ohPlatformVersion");
const environment = document.getElementById("ohEnvironment");
const dockedPanelIds = [
  "peoplePanel",
  "assignmentPanel",
  "organisationPanel",
  "referenceDataPanel",
  "rolePresetCapabilityPanel"
];

function isPhoneLayout() {
  return window.matchMedia("(max-width: 599px)").matches;
}

function isTabletLayout() {
  return window.matchMedia("(min-width: 600px) and (max-width: 1023px)").matches;
}

function currentLayout() {
  if (isPhoneLayout()) return "phone";
  if (isTabletLayout()) return "tablet";
  return "desktop";
}

function getDockedPanels() {
  return dockedPanelIds
    .map(id => document.getElementById(id))
    .filter(Boolean);
}

function dockWorkspacePanels() {
  if (!layout) return [];

  return getDockedPanels()
    .map(panel => {
      panel.dataset.ohDockedPanel = "true";
      if (panel.parentElement !== layout) {
        layout.appendChild(panel);
      }
      return panel;
    });
}

function syncDockedPanelState(panels) {
  if (!shell) return;
  const anyOpen = panels.some(panel => !panel.classList.contains("hidden"));
  shell.classList.toggle("oh-panel-open", anyOpen);
}

function closeDockedPanels() {
  const panels = getDockedPanels();
  panels.forEach(panel => {
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
  });
  syncDockedPanelState(panels);
}

function setNavigationOpen(open) {
  shell.classList.toggle("oh-nav-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
}

function navigationGroups() {
  return Array.from(document.querySelectorAll("[data-oh-nav-group]"));
}

function setNavigationGroupOpen(groupName, open) {
  navigationGroups().forEach(group => {
    const selected = group.dataset.ohNavGroup === groupName;
    const expanded = selected && open;
    const toggle = group.querySelector(".oh-nav-group-toggle");
    group.classList.toggle("is-open", expanded);
    if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
  });
}

function syncAdministrationGroupVisibility(visible) {
  if (administrationGroup) administrationGroup.classList.toggle("hidden", !visible);
  setNavItemCapabilityVisibility(administrationNav, visible);
}

function toggleNavigation() {
  if (isPhoneLayout()) {
    setNavigationOpen(!shell.classList.contains("oh-nav-open"));
    return;
  }

  if (isTabletLayout()) {
    shell.classList.toggle("oh-nav-collapsed");
    navToggle.setAttribute("aria-expanded", String(!shell.classList.contains("oh-nav-collapsed")));
    return;
  }

  shell.classList.toggle("oh-nav-collapsed");
  navToggle.setAttribute("aria-expanded", String(!shell.classList.contains("oh-nav-collapsed")));
}

function setActiveApp(appName) {
  const labels = {
    dashboard: "Dashboard",
    visitors: "Visitors",
    legacyVms: "Legacy VMS",
    people: "People",
    workforceCalendar: "Workforce Calendar",
    organisations: "Organisations",
    reporting: "Reporting Centre",
    administration: "Administration",
    applicationSettings: "Application Settings",
    terminal: "Terminal Home",
    visitorKiosk: "Visitor Kiosk",
    login: "Staff Login"
  };

  [
    ["dashboard", dashboardNav],
    ["visitors", visitorsNav],
    ["legacyVms", legacyVmsNav],
    ["people", peopleNav],
    ["workforceCalendar", workforceCalendarNav],
    ["organisations", organisationsNav],
    ["reporting", reportingNav],
    ["administration", administrationNav]
  ].forEach(([name, item]) => {
    if (!item) return;
    const active = appName === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  if (appName === "administration") {
    setNavigationGroupOpen("administration", true);
  } else {
    setNavigationGroupOpen("", false);
  }

  if (workspaceCue) {
    workspaceCue.textContent = "Operations Hub / " + (labels[appName] || "Workspace");
  }
  window.dispatchEvent(new CustomEvent("oh:workspace-changed", {
    detail: {
      appName,
      workspace: labels[appName] || "Workspace"
    }
  }));
}

function setNavItemCapabilityVisibility(item, visible) {
  if (!item) return;
  item.classList.toggle("hidden", !visible);
}

export function shouldShowPeopleNavigation() {
  return hasAnyCapability(["people.view", "people.manage"]);
}

export function shouldShowWorkforceCalendarNavigation() {
  return hasAnyCapability([
    "workforce_calendar.view",
    "workforce_calendar.manage",
    "people.view",
    "people.manage"
  ]);
}

export function shouldShowOrganisationNavigation() {
  return hasAnyCapability(["organisation.view", "organisation.manage"]);
}

export function shouldShowAdministrationNavigation() {
  return hasAnyCapability([
    "application_settings.view",
    "application_settings.manage",
    "assignment_field_requirements.view",
    "assignment_field_requirements.manage",
    "form_requirements.view",
    "form_requirements.manage",
    "settings.view",
    "settings.edit",
    "module_configuration.view",
    "module_configuration.manage",
    "visitor.housekeeping.run",
    "devices.view",
    "devices.manage",
    "document_signoff.manage",
    "agreements.manage",
    "gdpr.view",
    "gdpr.manage",
    "privacy.view",
    "privacy.manage",
    "identity_resolution.view",
    "identity_resolution.manage",
    "audit.view",
    "access_control.view",
    "access_control.manage",
    "capabilities.diagnose",
    "online_users.view",
    "admin_system_messages.view",
    "admin_system_messages.send",
    "admin_system_messages.force_action",
    "session_security_settings.view",
    "session_security_settings.manage"
  ]);
}

function ensureVisibleWorkspace() {
  const activeNav = [
    dashboardNav,
    visitorsNav,
    legacyVmsNav,
    peopleNav,
    workforceCalendarNav,
    organisationsNav,
    reportingNav,
    administrationNav
  ].find(item => item && item.classList.contains("active"));

  if (!activeNav || !activeNav.classList.contains("hidden")) return;

  if (dashboardNav && !dashboardNav.classList.contains("hidden")) {
    showDashboardWorkspace();
  } else if (visitorsNav && !visitorsNav.classList.contains("hidden")) {
    showVisitorWorkspace();
  } else if (legacyVmsNav && !legacyVmsNav.classList.contains("hidden")) {
    showLegacyVmsWorkspace();
  } else if (peopleNav && !peopleNav.classList.contains("hidden")) {
    showPeopleWorkspace();
  } else if (workforceCalendarNav && !workforceCalendarNav.classList.contains("hidden")) {
    showWorkforceCalendarWorkspace();
  } else if (organisationsNav && !organisationsNav.classList.contains("hidden")) {
    showOrganisationsWorkspace();
  } else if (reportingNav && !reportingNav.classList.contains("hidden")) {
    showReportingWorkspace();
  } else if (administrationNav && !administrationNav.classList.contains("hidden")) {
    showAdministrationWorkspace();
  }
}

export function syncNavigationCapabilityVisibility() {
  const activeStaffProfile = AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";

  if (!activeStaffProfile) {
    setNavItemCapabilityVisibility(dashboardNav, true);
    setNavItemCapabilityVisibility(visitorsNav, false);
    setNavItemCapabilityVisibility(legacyVmsNav, false);
    setNavItemCapabilityVisibility(
      peopleNav,
      shouldShowPeopleNavigation()
    );
    setNavItemCapabilityVisibility(
      workforceCalendarNav,
      shouldShowWorkforceCalendarNavigation()
    );
    setNavItemCapabilityVisibility(
      organisationsNav,
      shouldShowOrganisationNavigation()
    );
    setNavItemCapabilityVisibility(reportingNav, true);
    syncAdministrationGroupVisibility(shouldShowAdministrationNavigation());
    ensureVisibleWorkspace();
    return;
  }

  setNavItemCapabilityVisibility(dashboardNav, hasCapability("dashboard.view"));
  setNavItemCapabilityVisibility(visitorsNav, hasCapability("visitor.view"));
  setNavItemCapabilityVisibility(legacyVmsNav, hasCapability("visitor.view"));
  setNavItemCapabilityVisibility(peopleNav, shouldShowPeopleNavigation());
  setNavItemCapabilityVisibility(workforceCalendarNav, shouldShowWorkforceCalendarNavigation());
  setNavItemCapabilityVisibility(
    organisationsNav,
    shouldShowOrganisationNavigation()
  );
  setNavItemCapabilityVisibility(reportingNav, hasCapability("reports.view"));
  syncAdministrationGroupVisibility(shouldShowAdministrationNavigation());
  ensureVisibleWorkspace();
}

function showOnlyWorkspace(workspaceId, appName) {
  [
    "dashboardWorkspace",
    "visitorsWorkspace",
    "legacyVmsWorkspace",
    "peopleWorkspace",
    "workforceCalendarWorkspace",
    "organisationsWorkspace",
    "reportingWorkspace",
    "administrationWorkspace",
    "terminalHomeWorkspace",
    "visitorKioskWorkspace",
    "staffLoginWorkspace"
  ].forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== workspaceId);
  });
  closeDockedPanels();
  setActiveApp(appName);
  closeAccountMenu();
  setNavigationOpen(false);
}

export function showDashboardWorkspace() {
  showOnlyWorkspace("dashboardWorkspace", "dashboard");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("oh:dashboard-opened"));
}

export function showTerminalHomeWorkspace() {
  showOnlyWorkspace("terminalHomeWorkspace", "terminal");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function showVisitorKioskWorkspace() {
  showOnlyWorkspace("visitorKioskWorkspace", "visitorKiosk");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function showStaffLoginWorkspace() {
  showOnlyWorkspace("staffLoginWorkspace", "login");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function showVisitorWorkspace() {
  showOnlyWorkspace("visitorsWorkspace", "visitors");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("oh:visitors-opened"));
}

export function showLegacyVmsWorkspace() {
  showOnlyWorkspace("legacyVmsWorkspace", "legacyVms");
}

export function showPeopleWorkspace() {
  showOnlyWorkspace("peopleWorkspace", "people");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function showWorkforceCalendarWorkspace() {
  showOnlyWorkspace("workforceCalendarWorkspace", "workforceCalendar");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("oh:workforce-calendar-opened"));
}

export function showOrganisationsWorkspace() {
  showOnlyWorkspace("organisationsWorkspace", "organisations");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function showReportingWorkspace() {
  showOnlyWorkspace("reportingWorkspace", "reporting");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("oh:reporting-opened"));
}

export function showAdministrationWorkspace() {
  showOnlyWorkspace("administrationWorkspace", "administration");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

export function openExistingSettingsArea() {
  showLegacyVmsWorkspace();
  const staffButton = document.getElementById("staffButton");
  if (!staffButton || staffButton.classList.contains("hidden")) return;

  staffButton.click();

  let checks = 0;
  const settingsCheck = window.setInterval(function () {
    checks += 1;
    const staffScreen = document.getElementById("staffScreen");
    const superPanel = document.getElementById("superPanel");
    const settingsButton = document.getElementById("superNavSettings");
    const superPanelVisible = superPanel && window.getComputedStyle(superPanel).display !== "none";

    if (staffScreen && staffScreen.classList.contains("active") && superPanelVisible && settingsButton) {
      settingsButton.click();
      window.clearInterval(settingsCheck);
    } else if (checks >= 30 || (staffScreen && staffScreen.classList.contains("active") && checks >= 5)) {
      window.clearInterval(settingsCheck);
    }
  }, 100);
}

function openApplicationSettingsShortcut() {
  window.dispatchEvent(new CustomEvent("oh:application-settings-requested"));
}

function syncCurrentUser() {
  const source = document.getElementById("topbarStaffStatus");
  const name = source ? source.textContent.trim() : "";
  currentUser.textContent = name || "Not signed in";
  currentUser.title = name || "Not signed in";

  if (accountDisplayName) accountDisplayName.textContent = AppState.currentProfile && AppState.currentProfile.display_name
    ? AppState.currentProfile.display_name
    : "Not signed in";
  if (accountDisplayRole) accountDisplayRole.textContent = AppState.currentProfile && AppState.currentProfile.role
    ? String(AppState.currentProfile.role).replace("_", " ")
    : "No active staff session";
  const staffSession = AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";
  if (accountChangePassword) accountChangePassword.classList.toggle("hidden", !staffSession);
  if (accountLogout) accountLogout.classList.toggle("hidden", !AppState.currentProfile);
}

export function closeAccountMenu() {
  if (!accountMenu || !currentUserButton) return;
  accountMenu.classList.add("hidden");
  currentUserButton.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (!accountMenu || !currentUserButton) return;
  const open = accountMenu.classList.toggle("hidden") === false;
  currentUserButton.setAttribute("aria-expanded", String(open));
}

function syncPlatformVersion() {
  const source = document.getElementById("appVersionText");
  platformVersion.textContent = source && source.textContent.trim()
    ? source.textContent.trim()
    : APP_BUILD_LABEL;
}

function setEnvironmentLabel() {
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  environment.textContent = localHosts.includes(window.location.hostname) ? "Local" : "Hosted";
}

navToggle.addEventListener("click", toggleNavigation);
navScrim.addEventListener("click", () => setNavigationOpen(false));
dashboardNav.addEventListener("click", showDashboardWorkspace);
visitorsNav.addEventListener("click", showVisitorWorkspace);
legacyVmsNav.addEventListener("click", () => {
  showLegacyVmsWorkspace();
  window.dispatchEvent(new CustomEvent("oh:legacy-vms-opened"));
});
if (organisationsNav) organisationsNav.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("oh:organisations-nav-requested"));
});
if (reportingNav) reportingNav.addEventListener("click", showReportingWorkspace);
if (administrationNav) {
  administrationNav.addEventListener("click", () => {
    setNavigationGroupOpen("administration", true);
  });
}
if (administrationChildren) {
  administrationChildren.addEventListener("click", event => {
    if (event.target && event.target.closest(".oh-nav-child-item")) {
      setNavigationGroupOpen("administration", true);
    }
  });
}
settingsShortcut.addEventListener("click", openApplicationSettingsShortcut);
if (currentUserButton) currentUserButton.addEventListener("click", event => {
  event.stopPropagation();
  toggleAccountMenu();
});
document.addEventListener("click", event => {
  if (!accountMenu || accountMenu.classList.contains("hidden")) return;
  if (accountMenu.contains(event.target) || (currentUserButton && currentUserButton.contains(event.target))) return;
  closeAccountMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAccountMenu();
});

let activeLayout = currentLayout();

window.addEventListener("resize", function () {
  const nextLayout = currentLayout();
  if (nextLayout === activeLayout) return;

  activeLayout = nextLayout;
  setNavigationOpen(false);
  if (nextLayout === "tablet") {
    shell.classList.add("oh-nav-collapsed");
    navToggle.setAttribute("aria-expanded", "false");
  } else if (nextLayout === "desktop") {
    shell.classList.remove("oh-nav-collapsed");
    navToggle.setAttribute("aria-expanded", "true");
  }
});

const userSource = document.getElementById("topbarStaffStatus");
const versionSource = document.getElementById("appVersionText");
const dockedPanels = dockWorkspacePanels();

if (userSource) new MutationObserver(syncCurrentUser).observe(userSource, { childList: true, subtree: true });
if (versionSource) new MutationObserver(syncPlatformVersion).observe(versionSource, { childList: true, subtree: true });
dockedPanels.forEach(panel => {
  new MutationObserver(() => syncDockedPanelState(dockedPanels)).observe(panel, {
    attributes: true,
    attributeFilter: ["class"]
  });
});

if (activeLayout === "tablet") {
  shell.classList.add("oh-nav-collapsed");
  navToggle.setAttribute("aria-expanded", "false");
} else if (activeLayout === "desktop") {
  navToggle.setAttribute("aria-expanded", "true");
}
syncCurrentUser();
syncPlatformVersion();
setEnvironmentLabel();
syncDockedPanelState(dockedPanels);
