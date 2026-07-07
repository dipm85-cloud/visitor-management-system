import {
  hasAllCapabilities,
  hasAnyCapability
} from "./capabilities.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showAdministrationWorkspace } from "./shell.js";

const moduleRegistry = new Map();
const sourceSectionCache = new Map();
let initialised = false;
let activeModuleId = null;
let registrationsFinalised = false;

function hasModuleConfigurationAccess() {
  return hasAnyCapability([
    "module_configuration.view",
    "module_configuration.manage",
    "visitor.housekeeping.run"
  ]);
}

function canViewModule(moduleDefinition) {
  const capabilities = moduleDefinition.viewCapabilities || [];
  return hasModuleConfigurationAccess() &&
    (!capabilities.length || hasAnyCapability(capabilities));
}

function canManageModule(moduleDefinition) {
  const capabilities = moduleDefinition.manageCapabilities || [];
  return capabilities.length > 0 && hasAllCapabilities(capabilities);
}

function setAdministrationSection(sectionName) {
  const sections = {
    reference: $("referenceDataSection"),
    modules: $("moduleConfigurationSection"),
    access: $("accessControlSection")
  };
  const navigation = {
    reference: $("administrationReferenceNav"),
    modules: $("administrationModuleConfigurationNav"),
    access: $("administrationAccessControlNav")
  };

  Object.entries(sections).forEach(([name, section]) => {
    if (section) section.classList.toggle("hidden", name !== sectionName);
  });
  Object.entries(navigation).forEach(([name, button]) => {
    if (!button) return;
    const selected = name === sectionName;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function createModuleCard(moduleDefinition) {
  const card = document.createElement("article");
  card.className = "module-configuration-card" +
    (moduleDefinition.placeholder ? " placeholder" : "");

  const icon = document.createElement("span");
  icon.className = "module-configuration-card-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = moduleDefinition.icon || moduleDefinition.name.slice(0, 1);
  card.appendChild(icon);

  const title = document.createElement("h3");
  title.textContent = moduleDefinition.name;
  card.appendChild(title);

  const description = document.createElement("p");
  description.textContent = moduleDefinition.description;
  card.appendChild(description);

  const button = document.createElement("button");
  button.type = "button";
  button.className = moduleDefinition.placeholder ? "secondary" : "";
  button.textContent = moduleDefinition.placeholder ? "Not yet available" : "Configure";
  button.disabled = !!moduleDefinition.placeholder;
  if (!moduleDefinition.placeholder) {
    button.addEventListener("click", () => openRegisteredModule(moduleDefinition.id));
  }
  card.appendChild(button);
  return card;
}

function renderModuleCatalogue() {
  const container = $("moduleConfigurationCards");
  if (!container) return;
  container.replaceChildren();
  const visibleModules = Array.from(moduleRegistry.values()).filter(canViewModule);
  visibleModules.forEach(moduleDefinition => {
    container.appendChild(createModuleCard(moduleDefinition));
  });
  $("moduleConfigurationEmpty").classList.toggle("hidden", visibleModules.length > 0);
}

function sourceSectionForAnchor(anchorId) {
  if (sourceSectionCache.has(anchorId)) return sourceSectionCache.get(anchorId);
  const anchor = $(anchorId);
  const section = anchor ? anchor.closest(".settings-section") : null;
  if (section) sourceSectionCache.set(anchorId, section);
  return section;
}

function relocateRegisteredContent(moduleDefinition) {
  const content = $("moduleConfigurationContent");
  content.replaceChildren();
  const sourceCards = new Set();

  (moduleDefinition.groups || []).forEach(groupDefinition => {
    const group = document.createElement("section");
    group.className = "module-configuration-group";

    const heading = document.createElement("div");
    heading.className = "module-configuration-group-heading";
    const title = document.createElement("h3");
    title.textContent = groupDefinition.name;
    const description = document.createElement("p");
    description.textContent = groupDefinition.description || "";
    heading.append(title, description);
    group.appendChild(heading);

    const seenSections = new Set();
    (groupDefinition.sourceAnchors || []).forEach(anchorId => {
      const sourceSection = sourceSectionForAnchor(anchorId);
      if (!sourceSection || seenSections.has(sourceSection)) return;
      seenSections.add(sourceSection);
      const sourceCard = sourceSection.closest(".card");
      if (sourceCard) sourceCards.add(sourceCard);
      group.appendChild(sourceSection);
    });

    if (seenSections.size) content.appendChild(group);
  });

  sourceCards.forEach(card => {
    if (!card.querySelector(".settings-section")) card.classList.add("hidden");
  });
}

function applyModuleEditability(moduleDefinition) {
  const editable = canManageModule(moduleDefinition);
  const workspace = $("moduleConfigurationWorkspace");
  workspace.classList.toggle("module-configuration-read-only", !editable);
  $("moduleConfigurationReadOnlyNotice").classList.toggle("hidden", editable);
  workspace.querySelectorAll(
    "input, select, textarea, .settings-actions button, .button-row button"
  ).forEach(control => {
    if (control.matches("[data-module-configuration-preserve-enabled]")) return;
    control.disabled = !editable;
  });
}

function showModuleCatalogue() {
  activeModuleId = null;
  $("moduleConfigurationCatalogue").classList.remove("hidden");
  $("moduleConfigurationWorkspace").classList.add("hidden");
  renderModuleCatalogue();
}

function openRegisteredModule(moduleId) {
  const moduleDefinition = moduleRegistry.get(moduleId);
  if (!moduleDefinition || moduleDefinition.placeholder || !canViewModule(moduleDefinition)) {
    showToast(
      "You do not have permission",
      "This module configuration is not available for your current capabilities.",
      "error"
    );
    return;
  }

  activeModuleId = moduleId;
  $("moduleConfigurationCatalogue").classList.add("hidden");
  $("moduleConfigurationWorkspace").classList.remove("hidden");
  $("moduleConfigurationWorkspaceIcon").textContent =
    moduleDefinition.icon || moduleDefinition.name.slice(0, 1);
  $("moduleConfigurationWorkspaceTitle").textContent = moduleDefinition.name;
  $("moduleConfigurationWorkspaceDescription").textContent =
    moduleDefinition.description;
  relocateRegisteredContent(moduleDefinition);
  applyModuleEditability(moduleDefinition);
  if (typeof moduleDefinition.onOpen === "function") moduleDefinition.onOpen();
}

export function registerModuleConfiguration(moduleDefinition) {
  if (!moduleDefinition || !moduleDefinition.id || !moduleDefinition.name) {
    throw new Error("Module configuration registrations require id and name.");
  }
  moduleRegistry.set(moduleDefinition.id, {
    description: "",
    icon: "",
    groups: [],
    placeholder: false,
    viewCapabilities: [],
    manageCapabilities: [],
    ...moduleDefinition
  });
  if (initialised) renderModuleCatalogue();
}

export function finaliseModuleConfigurationRegistrations() {
  if (registrationsFinalised) return;
  registrationsFinalised = true;
  const sourceCards = new Set();

  Array.from(moduleRegistry.values())
    .filter(moduleDefinition => !moduleDefinition.placeholder)
    .forEach(moduleDefinition => {
      const seenSections = new Set();
      (moduleDefinition.groups || []).forEach(groupDefinition => {
        (groupDefinition.sourceAnchors || []).forEach(anchorId => {
          const sourceSection = sourceSectionForAnchor(anchorId);
          if (!sourceSection || seenSections.has(sourceSection)) return;
          seenSections.add(sourceSection);
          const sourceCard = sourceSection.closest(".card");
          if (sourceCard) sourceCards.add(sourceCard);
          sourceSection.remove();
        });
      });
    });

  sourceCards.forEach(card => {
    if (!card.querySelector(".settings-section")) card.classList.add("hidden");
  });
}

export function syncModuleConfigurationVisibility() {
  const visible = hasModuleConfigurationAccess();
  const nav = $("administrationModuleConfigurationNav");
  if (nav) nav.classList.toggle("hidden", !visible);
  if (!visible && $("moduleConfigurationSection") &&
      !$("moduleConfigurationSection").classList.contains("hidden")) {
    showModuleCatalogue();
    $("moduleConfigurationSection").classList.add("hidden");
  }
  if (visible && activeModuleId) {
    const moduleDefinition = moduleRegistry.get(activeModuleId);
    if (!moduleDefinition || !canViewModule(moduleDefinition)) showModuleCatalogue();
    else applyModuleEditability(moduleDefinition);
  }
}

export function openModuleConfigurationAdministration(moduleId) {
  syncModuleConfigurationVisibility();
  if (!hasModuleConfigurationAccess()) {
    showToast(
      "You do not have permission",
      "Module Configuration requires module_configuration.view.",
      "error"
    );
    return;
  }
  showAdministrationWorkspace();
  setAdministrationSection("modules");
  renderModuleCatalogue();
  if (moduleId) openRegisteredModule(moduleId);
  else showModuleCatalogue();
}

export function initialiseModuleConfigurationFramework() {
  if (initialised) return;
  initialised = true;
  $("administrationModuleConfigurationNav").addEventListener(
    "click",
    () => openModuleConfigurationAdministration()
  );
  $("moduleConfigurationBackButton").addEventListener("click", showModuleCatalogue);
  window.addEventListener(
    "oh:module-configuration-requested",
    event => openModuleConfigurationAdministration(event.detail && event.detail.moduleId)
  );
  window.addEventListener(
    "oh:capabilities-changed",
    syncModuleConfigurationVisibility
  );
  syncModuleConfigurationVisibility();
  renderModuleCatalogue();
}
