import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { getKioskToken } from "./kiosk.js";
import { AppState } from "./state.js";

const terminalWorkflowRegistry = new Map();

export function registerTerminalWorkflow(workflow) {
  if (!workflow || !workflow.id || !workflow.name) {
    throw new Error("Terminal workflow registrations require id and name.");
  }
  terminalWorkflowRegistry.set(workflow.id, {
    description: "",
    icon: workflow.name.slice(0, 1),
    enabled: true,
    ...workflow
  });
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

  const result = await supabaseClient.rpc("validate_kiosk_device_token", {
    p_kiosk_token: token
  });
  const registered = !result.error && result.data === true;
  AppState.terminalRegistration = {
    checked: true,
    registered
  };
  if (result.error) {
    console.warn("[OH-033 terminal registration check failed]", result.error);
  }
  return registered;
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

export function renderTerminalHome() {
  const container = $("terminalWorkflowCards");
  if (!container) return;
  container.replaceChildren();
  const workflows = Array.from(terminalWorkflowRegistry.values())
    .filter(workflowEnabled);

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
