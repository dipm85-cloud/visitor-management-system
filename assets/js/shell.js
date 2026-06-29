import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { AppState } from "./state.js";

const shell = document.getElementById("operationsHubShell");
const navigation = document.getElementById("ohNavigation");
const navToggle = document.getElementById("ohNavToggle");
const navScrim = document.getElementById("ohNavScrim");
const visitorsNav = document.getElementById("ohVisitorsNav");
const peopleNav = document.getElementById("ohPeopleNav");
const administrationNav = document.getElementById("ohAdministrationNav");
const settingsShortcut = document.getElementById("ohSettingsShortcut");
const currentUser = document.getElementById("ohCurrentUser");
const platformVersion = document.getElementById("ohPlatformVersion");
const environment = document.getElementById("ohEnvironment");

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
  [
    ["visitors", visitorsNav],
    ["people", peopleNav],
    ["administration", administrationNav]
  ].forEach(([name, item]) => {
    const active = appName === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function setNavItemCapabilityVisibility(item, visible) {
  if (!item) return;
  item.classList.toggle("hidden", !visible);
}

export function syncNavigationCapabilityVisibility() {
  const activeStaffProfile = AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role !== "kiosk_user";

  if (!activeStaffProfile) {
    setNavItemCapabilityVisibility(visitorsNav, true);
    setNavItemCapabilityVisibility(peopleNav, true);
    setNavItemCapabilityVisibility(administrationNav, true);
    return;
  }

  setNavItemCapabilityVisibility(visitorsNav, hasCapability("visitor.view"));
  setNavItemCapabilityVisibility(peopleNav, hasAnyCapability(["people.view", "people.manage"]));
  setNavItemCapabilityVisibility(administrationNav, hasAnyCapability([
    "settings.view",
    "users.view",
    "devices.view"
  ]));
}

function showOnlyWorkspace(workspaceId, appName) {
  ["visitorsWorkspace", "peopleWorkspace", "administrationWorkspace"].forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== workspaceId);
  });
  setActiveApp(appName);
  setNavigationOpen(false);
}

export function showVisitorWorkspace() {
  showOnlyWorkspace("visitorsWorkspace", "visitors");
}

export function showPeopleWorkspace() {
  showOnlyWorkspace("peopleWorkspace", "people");
  document.getElementById("operationsHubWorkspace").focus({ preventScroll: true });
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
visitorsNav.addEventListener("click", showVisitorsHome);
settingsShortcut.addEventListener("click", openExistingSettingsArea);

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

if (userSource) new MutationObserver(syncCurrentUser).observe(userSource, { childList: true, subtree: true });
if (versionSource) new MutationObserver(syncPlatformVersion).observe(versionSource, { childList: true, subtree: true });

if (activeLayout === "tablet") {
  shell.classList.add("oh-nav-collapsed");
  navToggle.setAttribute("aria-expanded", "false");
} else if (activeLayout === "desktop") {
  navToggle.setAttribute("aria-expanded", "true");
}
syncCurrentUser();
syncPlatformVersion();
setEnvironmentLabel();
