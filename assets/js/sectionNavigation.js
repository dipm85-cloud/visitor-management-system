const moduleRegistrations = new Map();
const moduleControllers = new Map();

function debugEnabled() {
  try {
    return window.localStorage &&
      window.localStorage.getItem("oh_debug_module_sections") === "true";
  } catch (error) {
    return false;
  }
}

function debugLog(message, details) {
  if (!debugEnabled()) return;
  console.log("[OH module sections] " + message, details || {});
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function resolveElement(target, root) {
  if (!target) return null;
  if (typeof target !== "string") return target;
  const scope = root || document;
  return target.startsWith("#")
    ? scope.querySelector(target)
    : document.getElementById(target);
}

function boolFromSetting(value, fallback) {
  if (typeof value === "function") return value();
  if (typeof value === "boolean") return value;
  return fallback;
}

function normaliseSection(section) {
  const settings = section || {};
  return {
    id: String(settings.id || "").trim(),
    title: String(settings.title || "").trim(),
    fullTitle: String(settings.fullTitle || settings.title || "").trim(),
    icon: settings.icon ? String(settings.icon) : "",
    target: settings.target || settings.element || settings.id,
    order: Number.isFinite(settings.order) ? settings.order : 1000,
    visible: settings.visible,
    visibility: settings.visibility,
    default: settings.default === true,
    hideWhenEmpty: settings.hideWhenEmpty === true,
    visibleContentSelector: settings.visibleContentSelector || ""
  };
}

function sortedSections(sections) {
  return Array.from(sections || [])
    .map(normaliseSection)
    .filter(section => section.id && section.title)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function getSectionTarget(section, registration) {
  return resolveElement(section.target, registration.root);
}

function targetIsFrameworkHidden(element) {
  return element &&
    element.classList &&
    element.classList.contains("oh-module-section-panel-hidden");
}

function targetHasFrameworkAriaHidden(element) {
  return element &&
    element.classList &&
    element.classList.contains("oh-module-section-panel") &&
    element.getAttribute("aria-hidden") === "true";
}

function classListWithoutFrameworkState(className) {
  return String(className || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(name => name !== "oh-module-section-panel" && name !== "oh-module-section-panel-hidden")
    .sort();
}

function isFrameworkManagedMutation(mutation) {
  if (mutation.type !== "attributes") return false;
  if (mutation.attributeName === "aria-hidden") return true;
  if (mutation.attributeName !== "class") return false;

  return arraysEqual(
    classListWithoutFrameworkState(mutation.oldValue),
    classListWithoutFrameworkState(mutation.target.getAttribute("class"))
  );
}

function isCapabilityVisible(element) {
  if (!element) return false;
  if (element.hidden || element.classList.contains("hidden")) return false;
  if (element.getAttribute("aria-hidden") === "true" &&
      !targetHasFrameworkAriaHidden(element)) {
    return false;
  }
  return true;
}

function targetSummary(section, registration) {
  const target = getSectionTarget(section, registration);
  return {
    id: section.id,
    title: section.title,
    target: section.target,
    exists: Boolean(target),
    visible: isCapabilityVisible(target),
    frameworkHidden: targetIsFrameworkHidden(target),
    ariaHidden: target ? target.getAttribute("aria-hidden") : null
  };
}

function sectionTargetIsVisible(section, registration) {
  const target = getSectionTarget(section, registration);
  return Boolean(target) &&
    !target.classList.contains("oh-module-section-panel-hidden") &&
    target.getAttribute("aria-hidden") !== "true" &&
    !target.classList.contains("hidden");
}

function visibleSectionIds(registration) {
  return registration.sections
    .filter(section => sectionTargetIsVisible(section, registration))
    .map(section => section.id);
}

function updateDebugState(registration, controller, details) {
  const clickDiagnostics = controller && controller.lastClickDiagnostics
    ? controller.lastClickDiagnostics
    : {};
  const state = {
    moduleId: registration.moduleId,
    registeredSections: registration.sections.map(section => ({
      id: section.id,
      title: section.title,
      target: section.target,
      order: section.order,
      default: section.default
    })),
    availableSections: (registration.availableSections || []).map(section => section.id),
    defaultSectionId: registration.defaultSectionId ||
      ((registration.sections.find(section => section.default) || {}).id) ||
      null,
    activeSectionId: controller ? controller.activeSectionId : null,
    targets: registration.sections.map(section => targetSummary(section, registration)),
    sectionMenuRendered: Boolean(controller && controller.list && controller.list.children.length > 0),
    sectionMenuVisible: Boolean(controller && controller.shell && !controller.shell.classList.contains("hidden")),
    lastClickedSectionId: clickDiagnostics.lastClickedSectionId || null,
    clickEventFired: Boolean(clickDiagnostics.clickEventFired),
    clickedElementTag: clickDiagnostics.clickedElementTag || null,
    clickedElementDisabled: Boolean(clickDiagnostics.clickedElementDisabled),
    activeSectionBeforeClick: clickDiagnostics.activeSectionBeforeClick || null,
    activeSectionAfterClick: clickDiagnostics.activeSectionAfterClick || null,
    targetExistsForClickedSection: Boolean(clickDiagnostics.targetExistsForClickedSection),
    targetVisibleAfterClick: Boolean(clickDiagnostics.targetVisibleAfterClick),
    visibleSectionIdsAfterClick: clickDiagnostics.visibleSectionIdsAfterClick || [],
    clickError: clickDiagnostics.clickError || null,
    fallbackUsed: Boolean(details && details.fallbackUsed),
    errors: details && details.errors ? details.errors : []
  };

  window.__ohModuleSectionDebug = window.__ohModuleSectionDebug || {};
  window.__ohModuleSectionDebug[registration.moduleId] = state;
  window.__ohModuleSectionDebug.latest = state;
}

function hasAvailableDescendant(element, selector) {
  if (!selector) return true;
  return Array.from(element.querySelectorAll(selector)).some(isCapabilityVisible);
}

function sectionIsAvailable(section, registration) {
  if (!section.id || !section.title) return false;
  if (boolFromSetting(section.visibility, true) === false) return false;
  if (boolFromSetting(section.visible, true) === false) return false;

  const target = getSectionTarget(section, registration);
  if (!isCapabilityVisible(target)) return false;
  if (section.hideWhenEmpty && !hasAvailableDescendant(target, section.visibleContentSelector)) {
    return false;
  }
  return true;
}

function createButton(section) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "oh-section-nav-item";
  button.dataset.ohSectionNavItem = section.id;
  button.title = section.fullTitle || section.title;
  button.setAttribute("aria-label", section.fullTitle || section.title);

  const icon = document.createElement("span");
  icon.className = "oh-section-nav-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = section.icon || section.title.slice(0, 1).toUpperCase();

  const label = document.createElement("span");
  label.className = "oh-section-nav-label";
  label.textContent = section.title;

  button.append(icon, label);
  return button;
}

function focusButton(buttons, index) {
  const button = buttons[index];
  if (button) button.focus();
}

function handleListKeyboard(event, controller) {
  const buttons = Array.from(controller.list.querySelectorAll(".oh-section-nav-item"));
  const currentIndex = buttons.indexOf(document.activeElement);

  if (event.key === "Escape") {
    if (controller.shell.classList.contains("is-open")) {
      event.preventDefault();
      controller.closeMenu();
      controller.toggle.focus();
    }
    return;
  }

  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();

  if (event.key === "Home") {
    focusButton(buttons, 0);
  } else if (event.key === "End") {
    focusButton(buttons, buttons.length - 1);
  } else if (event.key === "ArrowDown") {
    focusButton(buttons, currentIndex < buttons.length - 1 ? currentIndex + 1 : 0);
  } else if (event.key === "ArrowUp") {
    focusButton(buttons, currentIndex > 0 ? currentIndex - 1 : buttons.length - 1);
  }
}

function createNavigator(registration) {
  const navId = "oh-section-nav-" + registration.moduleId;
  const shell = document.createElement("div");
  shell.className = "oh-section-nav-shell";
  shell.dataset.ohSectionNavigator = registration.moduleId;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "oh-section-nav-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", navId);

  const toggleLabel = document.createElement("span");
  toggleLabel.className = "oh-section-nav-toggle-label";
  toggleLabel.textContent = registration.toggleLabel || "Sections";

  const toggleCurrent = document.createElement("span");
  toggleCurrent.className = "oh-section-nav-toggle-current";

  toggle.append(toggleLabel, toggleCurrent);

  const nav = document.createElement("nav");
  nav.id = navId;
  nav.className = "oh-section-navigator";
  nav.setAttribute("aria-label", registration.label || "Module sections");

  const title = document.createElement("div");
  title.className = "oh-section-nav-title";
  const titleText = document.createElement("span");
  titleText.textContent = registration.title || "Sections";

  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "oh-section-nav-collapse";
  collapse.setAttribute("aria-label", "Collapse section navigation");
  collapse.setAttribute("title", "Collapse section navigation");
  collapse.textContent = "‹";
  title.append(titleText, collapse);

  const list = document.createElement("div");
  list.className = "oh-section-nav-list";
  list.setAttribute("role", "list");

  nav.append(title, list);
  shell.append(toggle, nav);

  return { shell, toggle, nav, list, collapse };
}

function installWorkspace(registration) {
  const content = resolveElement(registration.content, registration.root);
  if (!content || content.dataset.ohSectionNavigationInitialised === "true") {
    return null;
  }

  const navigator = createNavigator(registration);
  const layout = document.createElement("div");
  layout.className = "oh-section-nav-layout";

  const flow = document.createElement("div");
  flow.className = "oh-section-nav-flow";

  const emptyState = document.createElement("div");
  emptyState.className = "oh-module-section-empty hidden";
  emptyState.setAttribute("role", "status");
  emptyState.textContent = registration.emptyMessage ||
    "No sections are available for this module under your current access.";

  while (content.firstChild) {
    flow.appendChild(content.firstChild);
  }
  flow.appendChild(emptyState);

  layout.append(flow, navigator.shell);
  content.appendChild(layout);
  content.dataset.ohSectionNavigationInitialised = "true";

  return {
    ...navigator,
    content,
    layout,
    flow,
    emptyState,
    activeSectionId: null,
    mutationObserver: null,
    refreshQueued: false
  };
}

function collapsedPreferenceKey(registration) {
  return "oh_section_nav_collapsed_" + registration.moduleId;
}

function readCollapsedPreference(registration) {
  try {
    return window.localStorage &&
      window.localStorage.getItem(collapsedPreferenceKey(registration)) === "true";
  } catch (error) {
    return false;
  }
}

function writeCollapsedPreference(registration, collapsed) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(collapsedPreferenceKey(registration), collapsed ? "true" : "false");
    }
  } catch (error) {
    // Preference persistence is optional; layout should still work without it.
  }
}

function applyCollapsedState(registration, controller, collapsed) {
  controller.shell.classList.toggle("is-collapsed", collapsed);
  if (controller.layout) controller.layout.classList.toggle("has-collapsed-section-nav", collapsed);
  if (controller.collapse) {
    controller.collapse.setAttribute("aria-expanded", String(!collapsed));
    controller.collapse.setAttribute("aria-label", collapsed ? "Expand section navigation" : "Collapse section navigation");
    controller.collapse.setAttribute("title", collapsed ? "Expand section navigation" : "Collapse section navigation");
    controller.collapse.textContent = collapsed ? "›" : "‹";
  }
}

function markTarget(section, target) {
  target.classList.add("oh-module-section-panel");
  target.dataset.ohSectionId = section.id;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
}

function markAllTargets(registration) {
  registration.sections.forEach(section => {
    const target = getSectionTarget(section, registration);
    if (target) markTarget(section, target);
  });
}

function chooseDefaultSection(registration, availableSections) {
  if (availableSections.length === 0) return null;

  const defaultId = registration.defaultSectionId;
  if (defaultId) {
    const configured = availableSections.find(section => section.id === defaultId);
    if (configured) return configured;
  }

  return availableSections.find(section => section.default) || availableSections[0];
}

function setActiveButton(controller, sectionId) {
  let activeTitle = "";

  controller.list.querySelectorAll(".oh-section-nav-item").forEach(button => {
    const active = button.dataset.ohSectionNavItem === sectionId;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
      activeTitle = button.querySelector(".oh-section-nav-label").textContent;
    } else {
      button.removeAttribute("aria-current");
    }
  });

  const current = controller.toggle.querySelector(".oh-section-nav-toggle-current");
  if (current) current.textContent = activeTitle;
}

function applySectionVisibility(registration, controller) {
  const activeSectionId = controller.activeSectionId;
  const hasAvailableSections = registration.availableSections.length > 0;

  controller.applyingFrameworkVisibility = true;
  registration.sections.forEach(section => {
    const target = getSectionTarget(section, registration);
    if (!target) return;

    const available = registration.availableSections.some(item => item.id === section.id);
    const active = available && section.id === activeSectionId;
    target.classList.toggle("oh-module-section-panel-hidden", !active);
    target.setAttribute("aria-hidden", String(!active));
  });
  window.setTimeout(() => {
    controller.applyingFrameworkVisibility = false;
  }, 0);

  if (controller.emptyState) {
    controller.emptyState.classList.toggle("hidden", hasAvailableSections);
  }
}

function focusActiveSection(registration, controller) {
  const active = registration.availableSections.find(section => section.id === controller.activeSectionId);
  const target = active ? getSectionTarget(active, registration) : null;
  if (!target || typeof target.focus !== "function") return;

  window.setTimeout(() => target.focus({ preventScroll: true }), 0);
}

function resetWorkspaceScroll(registration) {
  const scrollRoot = resolveElement(registration.scrollRoot);
  if (scrollRoot && "scrollTop" in scrollRoot) {
    scrollRoot.scrollTop = 0;
  }
}

function selectSection(registration, controller, sectionId, options) {
  const next = registration.availableSections.find(section => section.id === sectionId);
  if (!next) return false;

  controller.activeSectionId = next.id;
  setActiveButton(controller, next.id);
  applySectionVisibility(registration, controller);
  controller.closeMenu();

  if (!options || options.focus !== false) focusActiveSection(registration, controller);
  if (!options || options.resetScroll !== false) resetWorkspaceScroll(registration);
  return true;
}

function activateSectionFromEvent(registration, controller, event) {
  const button = event.target && event.target.closest
    ? event.target.closest(".oh-section-nav-item")
    : null;
  if (!button || !controller.list.contains(button)) return;

  event.preventDefault();
  event.stopPropagation();

  const sectionId = button.dataset.ohSectionNavItem || "";
  const before = controller.activeSectionId;
  const diagnostics = {
    lastClickedSectionId: sectionId,
    clickEventFired: true,
    clickedElementTag: button.tagName,
    clickedElementDisabled: Boolean(button.disabled),
    activeSectionBeforeClick: before,
    activeSectionAfterClick: before,
    targetExistsForClickedSection: false,
    targetVisibleAfterClick: false,
    visibleSectionIdsAfterClick: [],
    clickError: null
  };

  try {
    if (button.disabled) return;
    const section = registration.availableSections.find(item => item.id === sectionId);
    const target = section ? getSectionTarget(section, registration) : null;
    diagnostics.targetExistsForClickedSection = Boolean(target);

    const switched = selectSection(registration, controller, sectionId);
    diagnostics.activeSectionAfterClick = controller.activeSectionId;
    diagnostics.targetVisibleAfterClick = section ? sectionTargetIsVisible(section, registration) : false;
    diagnostics.visibleSectionIdsAfterClick = visibleSectionIds(registration);
    if (!switched) diagnostics.clickError = "Section is not available.";
  } catch (error) {
    diagnostics.clickError = error && error.message ? error.message : String(error);
    debugLog("section activation failed", {
      moduleId: registration.moduleId,
      sectionId,
      error
    });
  } finally {
    controller.lastClickDiagnostics = diagnostics;
    updateDebugState(registration, controller, {
      fallbackUsed: false,
      errors: diagnostics.clickError ? [diagnostics.clickError] : []
    });
    debugLog("section click", diagnostics);
  }
}

function renderNavigator(registration, controller) {
  const errors = [];
  let fallbackUsed = false;

  try {
    markAllTargets(registration);
    const availableSections = registration.sections.filter(section => sectionIsAvailable(section, registration));
    const availableIds = availableSections.map(section => section.id);

    const defaultSection = chooseDefaultSection(registration, availableSections);
    const activeAvailable = availableSections.some(section => section.id === controller.activeSectionId);
    const nextActiveSectionId = activeAvailable
      ? controller.activeSectionId
      : (defaultSection ? defaultSection.id : null);
    const hasUsefulNavigation = availableSections.length > 1;
    const nextSignature = [
      availableIds.join(","),
      nextActiveSectionId || "",
      String(hasUsefulNavigation)
    ].join("|");

    if (controller.renderSignature === nextSignature) {
      return;
    }

    registration.availableSections = availableSections;
    controller.activeSectionId = nextActiveSectionId;
    controller.renderSignature = nextSignature;
    controller.list.replaceChildren();

    availableSections.forEach(section => {
      const target = getSectionTarget(section, registration);
      if (!target) return;

      const item = document.createElement("div");
      item.setAttribute("role", "listitem");
      const button = createButton(section);
      button.setAttribute("aria-controls", target.id || "");
      item.appendChild(button);
      controller.list.appendChild(item);
    });

    fallbackUsed = !activeAvailable && Boolean(controller.activeSectionId);

    controller.shell.classList.toggle("hidden", !hasUsefulNavigation);
    controller.toggle.disabled = !hasUsefulNavigation;
    setActiveButton(controller, controller.activeSectionId);
    applySectionVisibility(registration, controller);
    if (!controller.initializationLogged) {
      controller.initializationLogged = true;
      debugLog("initialized", {
        moduleId: registration.moduleId,
        availableSections: availableIds,
        activeSectionId: controller.activeSectionId
      });
    }
  } catch (error) {
    fallbackUsed = true;
    errors.push(error && error.message ? error.message : String(error));
    debugLog("render failed", { moduleId: registration.moduleId, error });
    registration.availableSections = registration.sections.filter(section => getSectionTarget(section, registration));
    const fallback = chooseDefaultSection(registration, registration.availableSections);
    controller.activeSectionId = fallback ? fallback.id : null;
    controller.shell.classList.add("hidden");
    applySectionVisibility(registration, controller);
  }

  updateDebugState(registration, controller, { fallbackUsed, errors });
}

function observeVisibilityChanges(registration, controller) {
  if (!("MutationObserver" in window)) return;
  if (controller.mutationObserver) controller.mutationObserver.disconnect();

  controller.mutationObserver = new MutationObserver(mutations => {
    if (controller.applyingFrameworkVisibility) return;
    if (mutations.every(mutation => isFrameworkManagedMutation(mutation))) return;
    if (controller.refreshQueued) return;
    controller.refreshQueued = true;
    window.requestAnimationFrame(() => {
      controller.refreshQueued = false;
      refreshSectionNavigator(registration.moduleId);
    });
  });

  registration.sections.forEach(section => {
    const target = getSectionTarget(section, registration);
    if (target) {
      controller.mutationObserver.observe(target, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
        attributeOldValue: true
      });
    }
  });
}

function initialiseController(registration) {
  const existing = moduleControllers.get(registration.moduleId);
  if (existing) return existing;

  const controller = installWorkspace(registration);
  if (!controller) return null;

  applyCollapsedState(registration, controller, readCollapsedPreference(registration));

  controller.closeMenu = () => {
    controller.shell.classList.remove("is-open");
    controller.toggle.setAttribute("aria-expanded", "false");
  };

  controller.toggle.addEventListener("click", () => {
    const open = !controller.shell.classList.contains("is-open");
    controller.shell.classList.toggle("is-open", open);
    controller.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const active = controller.list.querySelector(".oh-section-nav-item.active") ||
        controller.list.querySelector(".oh-section-nav-item");
      if (active) active.focus();
    }
  });

  if (controller.collapse) {
    controller.collapse.addEventListener("click", () => {
      const collapsed = !controller.shell.classList.contains("is-collapsed");
      applyCollapsedState(registration, controller, collapsed);
      writeCollapsedPreference(registration, collapsed);
    });
  }

  controller.list.addEventListener("click", event => activateSectionFromEvent(registration, controller, event));
  controller.list.addEventListener("keydown", event => handleListKeyboard(event, controller));
  moduleControllers.set(registration.moduleId, controller);
  observeVisibilityChanges(registration, controller);
  return controller;
}

export function registerModuleSections(moduleId, sections, options) {
  const registration = {
    ...(options || {}),
    moduleId: String(moduleId || "").trim(),
    root: resolveElement(options && options.root) || document,
    content: options && options.content,
    defaultSectionId: options && options.defaultSection,
    availableSections: [],
    sections: sortedSections(sections)
  };

  if (!registration.moduleId || !registration.content) return null;
  moduleRegistrations.set(registration.moduleId, registration);
  updateDebugState(registration, null, { fallbackUsed: false, errors: [] });

  const controller = initialiseController(registration);
  if (controller) renderNavigator(registration, controller);
  return registration;
}

export function refreshSectionNavigator(moduleId) {
  const registration = moduleRegistrations.get(moduleId);
  const controller = moduleControllers.get(moduleId);
  if (!registration || !controller) return;
  observeVisibilityChanges(registration, controller);
  renderNavigator(registration, controller);
}

export function selectModuleSection(moduleId, sectionId, options) {
  const registration = moduleRegistrations.get(moduleId);
  const controller = moduleControllers.get(moduleId);
  if (!registration || !controller) return false;

  renderNavigator(registration, controller);
  const switched = selectSection(registration, controller, sectionId, options);
  updateDebugState(registration, controller, {
    fallbackUsed: false,
    errors: switched ? [] : ["Section is not available."]
  });
  return switched;
}
