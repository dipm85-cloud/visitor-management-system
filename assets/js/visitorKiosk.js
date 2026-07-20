import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { settingValue } from "./settings.js";
import {
  isRegisteredTerminal,
  syncTerminalNavigation
} from "./terminal.js";
import {
  hasMinimumVisitorSearchTerm,
  isValidVisitorFullName,
  VISITOR_FULL_NAME_MESSAGE
} from "./utils.js";

let visitorKioskDependencies;
let visitorKioskInitialised = false;
let plannedSearchTimer = null;
let signOutSearchTimer = null;
let plannedSearchSequence = 0;
let signOutSearchSequence = 0;

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
  message.className = "visitor-kiosk-empty oh-empty-state";

  const icon = document.createElement("span");
  icon.className = "oh-empty-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "—";

  const heading = document.createElement("strong");
  heading.className = "oh-empty-state-title";
  heading.textContent = title;
  message.append(icon, heading);

  if (detail) {
    const description = document.createElement("span");
    description.className = "oh-empty-state-description";
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

function renderPlannedMatches(matches) {
  const filterInput = $("visitorKioskPlannedSearch");
  const list = $("visitorKioskPlannedResults");

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
      walkIn.textContent = "Register as Walk-in";
      walkIn.addEventListener("click", () => {
        if (!isValidVisitorFullName(filterInput.value)) {
          showVisitorKioskStatus(VISITOR_FULL_NAME_MESSAGE, "error");
          return;
        }
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

async function searchPlannedMatches() {
  const query = $("visitorKioskPlannedSearch").value;
  if (!hasMinimumVisitorSearchTerm(query)) {
    setListMessage(
      "visitorKioskPlannedResults",
      "Type at least 3 letters",
      "Use three or more letters from any part of your name."
    );
    return;
  }

  const sequence = ++plannedSearchSequence;
  setListMessage(
    "visitorKioskPlannedResults",
    "Searching today's planned visits",
    "Please wait."
  );
  const matches = await visitorKioskDependencies.loadPlannedVisits({
    renderLegacyList: false,
    searchQuery: query
  });
  if (sequence !== plannedSearchSequence) return;
  if (matches === null) {
    setListMessage(
      "visitorKioskPlannedResults",
      "Planned visits unavailable",
      "Please ask reception for help."
    );
    return;
  }
  renderPlannedMatches(matches);
}

function queuePlannedSearch() {
  if (plannedSearchTimer) clearTimeout(plannedSearchTimer);
  plannedSearchSequence += 1;
  plannedSearchTimer = setTimeout(searchPlannedMatches, 250);
}

function renderSignOutMatches(matches) {
  const filterInput = $("visitorKioskSignOutSearch");
  const list = $("visitorKioskSignOutResults");

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

async function searchSignOutMatches() {
  const query = $("visitorKioskSignOutSearch").value.trim();
  if (query.length < 2) {
    setListMessage(
      "visitorKioskSignOutResults",
      "Type at least 2 characters",
      "Search using your name, company, or security pass."
    );
    return;
  }

  const sequence = ++signOutSearchSequence;
  setListMessage(
    "visitorKioskSignOutResults",
    "Searching signed-in visitors",
    "Please wait."
  );
  const matches = await visitorKioskDependencies.loadActiveVisits({
    renderLegacyList: false,
    searchQuery: query
  });
  if (sequence !== signOutSearchSequence) return;
  if (matches === null) {
    setListMessage(
      "visitorKioskSignOutResults",
      "Sign-out list unavailable",
      "Please ask reception for help."
    );
    return;
  }
  renderSignOutMatches(matches);
}

function queueSignOutSearch() {
  if (signOutSearchTimer) clearTimeout(signOutSearchTimer);
  signOutSearchSequence += 1;
  signOutSearchTimer = setTimeout(searchSignOutMatches, 250);
}

function armInactivityTimeout() {
  if (
    visitorKioskDependencies &&
    typeof visitorKioskDependencies.resetInactivityTimer === "function"
  ) {
    visitorKioskDependencies.resetInactivityTimer();
  }
}

async function openPlannedSignIn() {
  if (!publicTerminalAvailable()) return;
  showVisitorKioskStatus("");
  setView("planned");
  $("visitorKioskPlannedSearch").value = "";
  setListMessage(
    "visitorKioskPlannedResults",
    "Type at least 3 letters",
    "Use three or more letters from any part of your name."
  );
  $("visitorKioskPlannedSearch").focus();
  armInactivityTimeout();
}

async function openVisitorSignOut() {
  if (!publicTerminalAvailable()) return;
  showVisitorKioskStatus("");
  setView("sign-out");
  $("visitorKioskSignOutSearch").value = "";
  setListMessage(
    "visitorKioskSignOutResults",
    "Type at least 2 characters",
    "Search using your name, company, or security pass."
  );
  $("visitorKioskSignOutSearch").focus();
  armInactivityTimeout();
}

export function returnToVisitorKioskHome() {
  if (!publicTerminalAvailable()) return;
  if (plannedSearchTimer) clearTimeout(plannedSearchTimer);
  if (signOutSearchTimer) clearTimeout(signOutSearchTimer);
  plannedSearchSequence += 1;
  signOutSearchSequence += 1;
  $("visitorKioskPlannedSearch").value = "";
  $("visitorKioskSignOutSearch").value = "";
  $("visitorKioskPlannedResults").replaceChildren();
  $("visitorKioskSignOutResults").replaceChildren();
  AppState.plannedTodayCache = [];
  AppState.activeVisitCache = [];
  showVisitorKioskStatus("");
  visitorKioskDependencies.resetVisitorWorkflow();
  visitorKioskDependencies.showWorkspace();
  syncTerminalNavigation();
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

  document.querySelectorAll(".visitorKioskBackButton").forEach(button => {
    button.addEventListener("click", returnToVisitorKioskHome);
  });
  $("visitorKioskSignInButton").addEventListener("click", openPlannedSignIn);
  $("visitorKioskSignOutButton").addEventListener("click", openVisitorSignOut);
  $("visitorKioskPlannedSearch").addEventListener("input", queuePlannedSearch);
  $("visitorKioskSignOutSearch").addEventListener("input", queueSignOutSearch);
}
