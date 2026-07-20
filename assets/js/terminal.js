import {
  diagnoseTerminalToken,
  validateTerminalToken
} from "./api.js";
import { $ } from "./dom.js";
import { getKioskToken } from "./kiosk.js";
import { AppState } from "./state.js";
import { setActionAvailable } from "./platformUi.js";
import {
  recordTerminalValidationCalled,
  recordTerminalValidationResult,
  recordTerminalSqlDiagnostic,
  startupDebugEnabled
} from "./startupDebug.js";

const terminalWorkflowRegistry = new Map();
let terminalRegistrationCheck = null;
let terminalRegistrationToken = null;

export function registerTerminalWorkflow(workflow) {
  if (!workflow || !workflow.id || !workflow.name) {
    throw new Error("Terminal workflow registrations require id and name.");
  }
  terminalWorkflowRegistry.set(workflow.id, {
    description: "",
    icon: workflow.name.slice(0, 1),
    enabled: true,
    surfaceId: "",
    reset: null,
    ...workflow
  });

  if (workflow.surfaceId) {
    const surface = document.getElementById(workflow.surfaceId);
    if (surface) surface.dataset.ohTerminalSurface = "true";
  }
}

export function isRegisteredTerminal() {
  return !!(
    AppState.terminalRegistration &&
    AppState.terminalRegistration.registered
  );
}

export async function refreshTerminalRegistration() {
  const token = getKioskToken();
  if (!token) {
    AppState.terminalRegistration = {
      checked: true,
      registered: false
    };
    return false;
  }

  if (terminalRegistrationCheck && terminalRegistrationToken === token) {
    return terminalRegistrationCheck;
  }

  terminalRegistrationToken = token;
  terminalRegistrationCheck = (async function () {
    recordTerminalValidationCalled();
    const result = await validateTerminalToken(token);
    recordTerminalValidationResult(result.data, result.error);
    if (startupDebugEnabled()) {
      const sqlDiagnostic = await diagnoseTerminalToken(token);
      recordTerminalSqlDiagnostic(sqlDiagnostic.data, sqlDiagnostic.error);
    }
    const registered = !result.error && result.data === true;
    const tokenIsCurrent = getKioskToken() === token;

    // Do not let a response for a replaced/cleared token overwrite the current
    // device registration state.
    if (tokenIsCurrent) {
      AppState.terminalRegistration = {
        checked: true,
        registered
      };
    }
    if (result.error) {
      console.warn("[OH-033 terminal registration check failed]", result.error);
    }
    return tokenIsCurrent && registered;
  })();

  try {
    return await terminalRegistrationCheck;
  } finally {
    if (terminalRegistrationToken === token) {
      terminalRegistrationCheck = null;
      terminalRegistrationToken = null;
    }
  }
}

function workflowEnabled(workflow) {
  if (!isRegisteredTerminal()) return false;
  return typeof workflow.enabled === "function"
    ? workflow.enabled()
    : workflow.enabled !== false;
}

function openWorkflow(workflow) {
  if (!workflowEnabled(workflow)) return;
  if (typeof workflow.open === "function") workflow.open();
}

export function enabledTerminalWorkflows() {
  return Array.from(terminalWorkflowRegistry.values()).filter(workflowEnabled);
}

export function hasMultipleEnabledTerminalWorkflows() {
  return enabledTerminalWorkflows().length > 1;
}

export function resetTerminalWorkflowState(reason) {
  terminalWorkflowRegistry.forEach(workflow => {
    if (typeof workflow.reset === "function") {
      try {
        workflow.reset(reason || "terminal-entry");
      } catch (error) {
        console.warn(
          "Terminal workflow reset failed:",
          workflow.id,
          error
        );
      }
    }
  });
}

export function syncTerminalNavigation() {
  const homeButton = $("terminalHomeTopButton");
  setActionAvailable(
    homeButton,
    hasMultipleEnabledTerminalWorkflows()
  );
}

export function openSingleEnabledTerminalWorkflow(workflowId) {
  const workflows = enabledTerminalWorkflows();
  if (
    workflows.length !== 1 ||
    (workflowId && workflows[0].id !== workflowId)
  ) {
    return false;
  }
  openWorkflow(workflows[0]);
  return true;
}

export function renderTerminalHome() {
  const container = $("terminalWorkflowCards");
  if (!container) return;
  container.replaceChildren();
  const workflows = enabledTerminalWorkflows();
  syncTerminalNavigation();

  workflows.forEach(workflow => {
    const card = document.createElement("article");
    card.className = "terminal-workflow-card";

    const icon = document.createElement("span");
    icon.className = "terminal-workflow-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = workflow.icon;

    const title = document.createElement("h2");
    title.textContent = workflow.name;

    const description = document.createElement("p");
    description.textContent = workflow.description;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open " + workflow.name;
    button.addEventListener("click", () => openWorkflow(workflow));

    card.append(icon, title, description, button);
    container.appendChild(card);
  });

  $("terminalWorkflowEmpty").classList.toggle("hidden", workflows.length > 0);
}
