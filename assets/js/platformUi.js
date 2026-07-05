const SCROLL_REGION_VARIANTS = new Set([
  "operational",
  "history",
  "reporting"
]);

function resolveElement(target, root) {
  if (!target) return null;
  if (typeof target !== "string") return target;
  const scope = root || document;
  return target.startsWith("#")
    ? scope.querySelector(target)
    : document.getElementById(target);
}

export function setActionAvailable(target, available, options) {
  const element = resolveElement(target, options && options.root);
  if (!element) return false;

  const visible = available === true;
  element.classList.toggle("hidden", !visible);
  element.setAttribute("aria-hidden", String(!visible));
  return visible;
}

export function applyContextualActions(rules, options) {
  (rules || []).forEach(rule => {
    if (!rule) return;
    setActionAvailable(
      rule.element || rule.id,
      typeof rule.available === "function"
        ? rule.available()
        : rule.available,
      options
    );
  });
}

export function makeScrollableRegion(target, variant, options) {
  const element = resolveElement(target, options && options.root);
  if (!element) return null;

  const selectedVariant = SCROLL_REGION_VARIANTS.has(variant)
    ? variant
    : "operational";
  element.classList.add(
    "oh-scroll-region",
    "oh-scroll-region--" + selectedVariant
  );
  element.dataset.ohScrollVariant = selectedVariant;
  if (selectedVariant !== "operational") {
    element.dataset.ohPaginationReady = "true";
  }
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
  if (options && options.label) {
    element.setAttribute("aria-label", options.label);
  }
  return element;
}

export function createEmptyState(options) {
  const settings = options || {};
  const state = document.createElement("div");
  state.className = "oh-empty-state";

  const icon = document.createElement("span");
  icon.className = "oh-empty-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = settings.icon || "—";

  const title = document.createElement("strong");
  title.className = "oh-empty-state-title";
  title.textContent = settings.title || "Nothing to show";

  const description = document.createElement("span");
  description.className = "oh-empty-state-description";
  description.textContent = settings.description || "";

  state.append(icon, title);
  if (settings.description) state.appendChild(description);

  if (settings.action && settings.action.available !== false) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = settings.action.className || "secondary";
    action.textContent = settings.action.label;
    action.addEventListener("click", settings.action.onClick);
    state.appendChild(action);
  }

  return state;
}

export function renderEmptyState(target, options) {
  const container = resolveElement(target, options && options.root);
  if (!container) return null;
  const state = createEmptyState(options);
  container.classList.add("oh-empty-state");
  container.replaceChildren(...Array.from(state.childNodes));
  return container;
}

export function createOperationalFormReset(options) {
  const settings = options || {};
  return function resetOperationalForm() {
    const form = resolveElement(settings.form, settings.root);
    if (form && typeof form.reset === "function") form.reset();

    const scope = form || settings.root || document;
    scope.querySelectorAll(
      "[data-oh-validation], [data-oh-temporary-selection]"
    ).forEach(element => {
      if (element.matches("[data-oh-validation]")) {
        element.textContent = "";
        element.classList.remove("error", "success", "warning");
      }
      if (element.matches("[data-oh-temporary-selection]")) {
        if ("checked" in element) element.checked = false;
        if ("value" in element) element.value = "";
        element.removeAttribute("aria-selected");
      }
    });

    (settings.validationElements || []).forEach(target => {
      const element = resolveElement(target, settings.root);
      if (!element) return;
      element.textContent = "";
      element.classList.remove("error", "success", "warning");
    });

    (settings.selectionElements || []).forEach(target => {
      const element = resolveElement(target, settings.root);
      if (!element) return;
      if ("checked" in element) element.checked = false;
      if ("value" in element) element.value = "";
      element.removeAttribute("aria-selected");
    });

    if (typeof settings.onReset === "function") settings.onReset();
  };
}

export function createSidePanelController(options) {
  const settings = options || {};
  const panel = resolveElement(settings.panel, settings.root);
  const backdrop = resolveElement(settings.backdrop, settings.root);
  let returnFocus = null;

  if (panel) panel.classList.add("oh-side-panel");
  if (backdrop) backdrop.classList.add("oh-side-panel-backdrop");

  return {
    open(trigger) {
      returnFocus = trigger || document.activeElement;
      if (backdrop) backdrop.classList.remove("hidden");
      if (panel) {
        panel.classList.remove("hidden");
        panel.setAttribute("aria-hidden", "false");
      }
      const focusTarget = resolveElement(settings.initialFocus) ||
        (panel && panel.querySelector(
          "input:not([type='hidden']), select, textarea, button"
        ));
      if (focusTarget) focusTarget.focus();
    },
    close() {
      if (backdrop) backdrop.classList.add("hidden");
      if (panel) {
        panel.classList.add("hidden");
        panel.setAttribute("aria-hidden", "true");
      }
      if (typeof settings.onReset === "function") settings.onReset();
      if (returnFocus && typeof returnFocus.focus === "function") {
        returnFocus.focus();
      }
      returnFocus = null;
    }
  };
}

export function buildPlatformPrintStyles(options) {
  const settings = options || {};
  const orientation = settings.orientation === "landscape"
    ? "landscape"
    : "portrait";
  const margin = settings.margin || "10mm";

  return (
    "@page{size:A4 " + orientation + ";margin:" + margin + ";" +
      "@bottom-right{content:'Page ' counter(page) ' of ' counter(pages);}" +
    "}" +
    ".oh-print-page-frame{width:100%;border:0;border-collapse:collapse;}" +
    ".oh-print-page-frame>thead{display:table-header-group;}" +
    ".oh-print-page-frame>tfoot{display:table-footer-group;}" +
    ".oh-print-page-frame>thead>tr>td," +
    ".oh-print-page-frame>tbody>tr>td," +
    ".oh-print-page-frame>tfoot>tr>td{padding:0;border:0;}" +
    ".oh-print-document-header{break-inside:avoid;page-break-inside:avoid;}" +
    ".oh-print-document-footer{break-inside:avoid;page-break-inside:avoid;}" +
    ".oh-print-logo{object-fit:contain;}" +
    ".oh-print-page-frame table>thead{display:table-header-group;}" +
    ".oh-print-page-frame table>tfoot{display:table-footer-group;}" +
    ".oh-print-page-frame table tr{" +
      "break-inside:avoid;page-break-inside:avoid;" +
    "}"
  );
}

export function buildPlatformPrintFrame(options) {
  const settings = options || {};
  return (
    "<table class='oh-print-page-frame'>" +
      "<thead><tr><td>" + (settings.headerHtml || "") + "</td></tr></thead>" +
      "<tbody><tr><td>" + (settings.bodyHtml || "") + "</td></tr></tbody>" +
      "<tfoot><tr><td>" + (settings.footerHtml || "") + "</td></tr></tfoot>" +
    "</table>"
  );
}

function enhanceEmptyStates(root) {
  root.querySelectorAll("[data-oh-empty-state]").forEach(element => {
    element.classList.add("oh-empty-state");
    if (element.querySelector(".oh-empty-state-title")) return;

    const existingDescription = element.textContent.trim();
    const icon = document.createElement("span");
    icon.className = "oh-empty-state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = element.dataset.ohEmptyIcon || "—";

    const title = document.createElement("strong");
    title.className = "oh-empty-state-title";
    title.textContent = element.dataset.ohEmptyTitle || "Nothing to show";

    const description = document.createElement("span");
    description.className = "oh-empty-state-description";
    description.textContent = existingDescription;

    element.replaceChildren(icon, title);
    if (existingDescription) element.appendChild(description);
  });
}

function enhanceSidePanels(root) {
  root.querySelectorAll("[data-oh-side-panel-backdrop]").forEach(element => {
    element.classList.add("oh-side-panel-backdrop");
  });
  root.querySelectorAll("[data-oh-side-panel]").forEach(element => {
    element.classList.add("oh-side-panel");
  });
  root.querySelectorAll("[data-oh-side-panel-header]").forEach(element => {
    element.classList.add("oh-side-panel-header");
  });
  root.querySelectorAll("[data-oh-side-panel-actions]").forEach(element => {
    element.classList.add("oh-side-panel-actions");
  });
}

function enhanceScrollRegions(root) {
  root.querySelectorAll("[data-oh-scroll-region]").forEach(element => {
    makeScrollableRegion(
      element,
      element.dataset.ohScrollRegion,
      { root, label: element.getAttribute("aria-label") || "" }
    );
  });
}

export function initialisePlatformUi(root) {
  const scope = root || document;
  enhanceEmptyStates(scope);
  enhanceSidePanels(scope);
  enhanceScrollRegions(scope);

  const toastArea = scope.getElementById
    ? scope.getElementById("toastArea")
    : document.getElementById("toastArea");
  if (toastArea) {
    toastArea.setAttribute("aria-live", "polite");
    toastArea.setAttribute("aria-relevant", "additions");
  }
}
