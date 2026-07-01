import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { AppState } from "./state.js";

const shell = document.getElementById("operationsHubShell");
const layout = shell ? shell.querySelector(".oh-layout") : null;
const navigation = document.getElementById("ohNavigation");
const navToggle = document.getElementById("ohNavToggle");
const navScrim = document.getElementById("ohNavScrim");
const dashboardNav = document.getElementById("ohDashboardNav");
const visitorsNav = document.getElementById("ohVisitorsNav");
const peopleNav = document.getElementById("ohPeopleNav");
const organisationsNav = document.getElementById("ohOrganisationsNav");
const reportingNav = document.getElementById("ohReportingNav");
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
    people: "People",
    organisations: "Organisations",
    reporting: "Reporting Centre",
    administration: "Administration"
  };

  [
    ["dashboard", dashboardNav],
    ["visitors", visitorsNav],
    ["people", peopleNav],
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

  if (workspaceCue) {
    workspaceCue.textContent = "Operations Hub / " + (labels[appName] || "Workspace");
  }
}

function setNavItemCapabilityVisibility(item, visible) {
  if (!item) return;
  item.classList.toggle("hidden", !visible);
}

export function shouldShowPeopleNavigation() {
  return hasAnyCapability(["people.view", "people.manage"]);
}

export function shouldShowOrganisationNavigation() {
  return hasAnyCapability(["organisation.view", "organisation.manage"]);
}

function ensureVisibleWorkspace() {
  const activeNav = [
    dashboardNav,
    visitorsNav,
    peopleNav,
    organisationsNav,
    reportingNav,
    administrationNav
  ].find(item => item && item.classList.contains("active"));

  if (!activeNav || !activeNav.classList.contains("hidden")) return;

  if (dashboardNav && !dashboardNav.classList.contains("hidden")) {
    showDashboardWorkspace();
  } else if (visitorsNav && !visitorsNav.classList.contains("hidden")) {
    showVisitorWorkspace();
  } else if (peopleNav && !peopleNav.classList.contains("hidden")) {
    showPeopleWorkspace();
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
    setNavItemCapabilityVisibility(visitorsNav, true);
    setNavItemCapabilityVisibility(
      peopleNav,
      shouldShowPeopleNavigation()
    );
    setNavItemCapabilityVisibility(
      organisationsNav,
      shouldShowOrganisationNavigation()
    );
    setNavItemCapabilityVisibility(reportingNav, true);
    setNavItemCapabilityVisibility(administrationNav, hasAnyCapability([
      "settings.view",
      "settings.edit",
      "users.view",
      "users.manage",
      "devices.view",
      "devices.manage",
      "access_control.view",
      "access_control.manage"
    ]));
    ensureVisibleWorkspace();
    return;
  }

  setNavItemCapabilityVisibility(dashboardNav, hasCapability("dashboard.view"));
  setNavItemCapabilityVisibility(visitorsNav, hasCapability("visitor.view"));
  setNavItemCapabilityVisibility(peopleNav, shouldShowPeopleNavigation());
  setNavItemCapabilityVisibility(
    organisationsNav,
    shouldShowOrganisationNavigation()
  );
  setNavItemCapabilityVisibility(reportingNav, hasCapability("reports.view"));
  setNavItemCapabilityVisibility(administrationNav, hasAnyCapability([
    "settings.view",
    "settings.edit",
    "users.view",
    "users.manage",
    "devices.view",
    "devices.manage",
    "access_control.view",
    "access_control.manage"
  ]));
  ensureVisibleWorkspace();
}

function showOnlyWorkspace(workspaceId, appName) {
  [
    "dashboardWorkspace",
    "visitorsWorkspace",
    "peopleWorkspace",
    "organisationsWorkspace",
    "reportingWorkspace",
    "administrationWorkspace"
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

export function showVisitorWorkspace() {
  showOnlyWorkspace("visitorsWorkspace", "visitors");
}

export function showPeopleWorkspace() {
  showOnlyWorkspace("peopleWorkspace", "people");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
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

function showVisitorsHome() {
  showVisitorWorkspace();
  const backHomeButton = document.querySelector(".backHomeButton");
  const homeScreen = document.getElementById("homeScreen");

  if (backHomeButton) {
    backHomeButton.click();
  } else if (homeScreen) {
    homeScreen.style.display = "grid";
  }

  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
}

function openExistingSettingsArea() {
  showVisitorWorkspace();
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
    : "VMS_035A.1";
}

function setEnvironmentLabel() {
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  environment.textContent = localHosts.includes(window.location.hostname) ? "Local" : "Hosted";
}

navToggle.addEventListener("click", toggleNavigation);
navScrim.addEventListener("click", () => setNavigationOpen(false));
dashboardNav.addEventListener("click", showDashboardWorkspace);
visitorsNav.addEventListener("click", showVisitorsHome);
if (organisationsNav) organisationsNav.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("oh:organisations-nav-requested"));
});
if (reportingNav) reportingNav.addEventListener("click", showReportingWorkspace);
settingsShortcut.addEventListener("click", openExistingSettingsArea);
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
