import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { settingValue } from "./settings.js";
import { isRegisteredTerminal } from "./terminal.js";
import { formatPersonName } from "./utils.js";

let visitorKioskDependencies;
let visitorKioskInitialised = false;

export function configureVisitorKiosk(dependencies) {
  visitorKioskDependencies = dependencies;
}

function publicTerminalAvailable() {
  const profile = AppState.currentProfile;
  return isRegisteredTerminal() && (
    !profile ||
    profile.role === "kiosk_user"
  );
}

function walkInsAllowed() {
  return !!settingValue("allow_walk_ins", true);
}

export function showVisitorKioskStatus(message, type) {
  const status = $("visitorKioskStatus");
  if (!message) {
    status.textContent = "";
    status.className = "visitor-kiosk-status hidden";
    return;
  }
  status.textContent = message;
  status.className = "visitor-kiosk-status " + (type || "info");
}

function setView(viewName) {
  document.querySelectorAll("[data-visitor-kiosk-view]").forEach(view => {
    view.classList.toggle(
      "hidden",
      view.getAttribute("data-visitor-kiosk-view") !== viewName
    );
  });
}

function setListMessage(containerId, title, detail) {
  const container = $(containerId);
  container.replaceChildren();

  const message = document.createElement("div");
  message.className = "visitor-kiosk-empty";

  const heading = document.createElement("strong");
  heading.textContent = title;
  message.appendChild(heading);

  if (detail) {
    const description = document.createElement("span");
    description.textContent = detail;
    message.appendChild(description);
  }

  container.appendChild(message);
}

function createVisitorRow(primary, secondary, actionText, actionClass, onAction) {
  const row = document.createElement("article");
  row.className = "visitor-kiosk-result";

  const identity = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = primary;
  const meta = document.createElement("span");
  meta.textContent = secondary;
  identity.append(title, meta);

  const action = document.createElement("button");
  action.type = "button";
  action.textContent = actionText;
  if (actionClass) action.className = actionClass;
  action.addEventListener("click", () => onAction(action));

  row.append(identity, action);
  return row;
}

function renderPlannedMatches() {
  const filterInput = $("visitorKioskPlannedSearch");
  const filter = formatPersonName(filterInput.value);
  const list = $("visitorKioskPlannedResults");

  if (filter.length < 2) {
    setListMessage(
      "visitorKioskPlannedResults",
      "Type at least 2 letters",
      "Search using your name or company."
    );
    return;
  }

  const matches = AppState.plannedTodayCache.filter(visit =>
    formatPersonName(visit.visitor_name).includes(filter) ||
    formatPersonName(visit.company).includes(filter)
  );

  list.replaceChildren();
  if (!matches.length) {
    setListMessage(
      "visitorKioskPlannedResults",
      "No planned visit found",
      walkInsAllowed()
        ? "Try another spelling or continue as a walk-in."
        : "Try another spelling or ask reception for help."
    );
    if (walkInsAllowed()) {
      const walkIn = document.createElement("button");
      walkIn.type = "button";
      walkIn.className = "visitor-kiosk-inline-action";
      walkIn.textContent = "Continue as Walk-In";
      walkIn.addEventListener("click", () => {
        visitorKioskDependencies.openWalkInModal(filterInput.value);
      });
      list.appendChild(walkIn);
    }
    return;
  }

  matches.forEach(visit => {
    list.appendChild(createVisitorRow(
      visit.visitor_name || "Visitor",
      visit.company || "Planned for today",
      "Sign In",
      "",
      action => visitorKioskDependencies.signInPlanned(visit, action)
    ));
  });
}

function renderSignOutMatches() {
  const filterInput = $("visitorKioskSignOutSearch");
  const filterRaw = filterInput.value;
  const filter = formatPersonName(filterRaw);
  const list = $("visitorKioskSignOutResults");

  if (filter.length < 2) {
    setListMessage(
      "visitorKioskSignOutResults",
      "Type at least 2 letters",
      "Search using your name, company, or security pass."
    );
    return;
  }

  const matches = AppState.activeVisitCache.filter(visit =>
    formatPersonName(visit.visitor_name).includes(filter) ||
    formatPersonName(visit.company).includes(filter) ||
    String(visit.security_pass_id || "")
      .toLowerCase()
      .includes(String(filterRaw).toLowerCase())
  );

  list.replaceChildren();
  if (!matches.length) {
    setListMessage(
      "visitorKioskSignOutResults",
      "No signed-in visitor found",
      "Try another spelling or ask reception for help."
    );
    return;
  }

  matches.forEach(visit => {
    const signedInTime = visit.sign_in_time
      ? new Date(visit.sign_in_time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
      : "";
    const detail = [
      visit.company,
      visit.security_pass_id ? "Pass " + visit.security_pass_id : "",
      signedInTime ? "Signed in " + signedInTime : ""
    ].filter(Boolean).join(" · ");

    list.appendChild(createVisitorRow(
      visit.visitor_name || "Visitor",
      detail || "Currently signed in",
      "Sign Out",
      "danger",
      action => visitorKioskDependencies.signOut(visit.id, action)
    ));
  });
}

async function openPlannedSignIn() {
  if (!publicTerminalAvailable()) return;
  showVisitorKioskStatus("");
  setView("planned");
  $("visitorKioskPlannedSearch").value = "";
  setListMessage(
    "visitorKioskPlannedResults",
    "Loading today's visitors",
    "Please wait."
  );
  const visits = await visitorKioskDependencies.loadPlannedVisits({
    renderLegacyList: false
  });
  if (visits === null) {
    setListMessage(
      "visitorKioskPlannedResults",
      "Planned visits unavailable",
      "Please ask reception for help."
    );
    return;
  }
  renderPlannedMatches();
  $("visitorKioskPlannedSearch").focus();
}

async function openVisitorSignOut() {
  if (!publicTerminalAvailable()) return;
  showVisitorKioskStatus("");
  setView("sign-out");
  $("visitorKioskSignOutSearch").value = "";
  setListMessage(
    "visitorKioskSignOutResults",
    "Loading signed-in visitors",
    "Please wait."
  );
  const visits = await visitorKioskDependencies.loadActiveVisits({
    renderLegacyList: false
  });
  if (visits === null) {
    setListMessage(
      "visitorKioskSignOutResults",
      "Sign-out list unavailable",
      "Please ask reception for help."
    );
    return;
  }
  renderSignOutMatches();
  $("visitorKioskSignOutSearch").focus();
}

function openWalkIn() {
  if (!publicTerminalAvailable() || !walkInsAllowed()) return;
  showVisitorKioskStatus("");
  visitorKioskDependencies.openWalkInModal("");
}

function syncWalkInAvailability() {
  const button = $("visitorKioskWalkInButton");
  const available = walkInsAllowed();
  button.disabled = !available;
  button.setAttribute("aria-disabled", String(!available));
  const detail = button.querySelector("span");
  if (detail) {
    detail.textContent = available
      ? "Register without a planned visit"
      : "Walk-in registration is unavailable";
  }
}

export function returnToVisitorKioskHome() {
  if (!publicTerminalAvailable()) return;
  visitorKioskDependencies.showWorkspace();
  syncWalkInAvailability();
  setView("home");
  $("visitorKioskWorkspace").focus({ preventScroll: true });
}

export function openVisitorKiosk() {
  showVisitorKioskStatus("");
  returnToVisitorKioskHome();
}

export function initialiseVisitorKiosk() {
  if (visitorKioskInitialised) return;
  visitorKioskInitialised = true;

  $("visitorKioskTerminalHomeButton").addEventListener(
    "click",
    () => visitorKioskDependencies.returnToTerminalHome("visitor-kiosk")
  );
  document.querySelectorAll(".visitorKioskBackButton").forEach(button => {
    button.addEventListener("click", returnToVisitorKioskHome);
  });
  $("visitorKioskPlannedButton").addEventListener("click", openPlannedSignIn);
  $("visitorKioskWalkInButton").addEventListener("click", openWalkIn);
  $("visitorKioskSignOutButton").addEventListener("click", openVisitorSignOut);
  $("visitorKioskPlannedSearch").addEventListener("input", renderPlannedMatches);
  $("visitorKioskSignOutSearch").addEventListener("input", renderSignOutMatches);
}
