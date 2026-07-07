const SCROLL_REGION_VARIANTS = new Set([
  "operational",
  "history",
  "reporting"
]);

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

let bodyScrollLockCount = 0;
let platformConfirmResolve = null;
let platformConfirmReturnFocus = null;
let platformConfirmKeyHandler = null;

function resolveElement(target, root) {
  if (!target) return null;
  if (typeof target !== "string") return target;
  const scope = root || document;
  return target.startsWith("#")
    ? scope.querySelector(target)
    : document.getElementById(target);
}

function visibleFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(element => {
      if (element.disabled || element.getAttribute("aria-hidden") === "true") {
        return false;
      }
      return !!(
        element.offsetWidth ||
        element.offsetHeight ||
        element.getClientRects().length
      );
    });
}

function focusSafely(element) {
  if (!element || typeof element.focus !== "function") return false;
  try {
    element.focus({ preventScroll: true });
  } catch (error) {
    element.focus();
  }
  return true;
}

function lockBodyScroll() {
  bodyScrollLockCount += 1;
  document.body.classList.add("oh-transient-ui-open");
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount > 0) return;
  document.body.classList.remove("oh-transient-ui-open");
  document.body.style.overflow = "";
}

function trapFocus(event, container) {
  if (event.key !== "Tab" || !container) return;
  const focusable = visibleFocusableElements(container);
  if (!focusable.length) {
    event.preventDefault();
    focusSafely(container);
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focusSafely(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focusSafely(first);
  }
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
  if (element.querySelector("table")) {
    element.classList.add("oh-responsive-table-wrap");
    element.querySelectorAll("table").forEach(table => {
      table.classList.add("oh-responsive-table");
    });
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
  const closeOnEscape = settings.closeOnEscape !== false;
  const closeOnBackdrop = settings.closeOnBackdrop !== false;
  const resetOnClose = settings.resetOnClose !== false;
  let returnFocus = null;
  let open = false;

  if (panel) panel.classList.add("oh-side-panel");
  if (panel && !panel.hasAttribute("role")) panel.setAttribute("role", "dialog");
  if (panel && !panel.hasAttribute("aria-modal")) panel.setAttribute("aria-modal", "true");
  if (panel && !panel.hasAttribute("tabindex")) panel.tabIndex = -1;
  if (panel) panel.setAttribute("aria-hidden", "true");
  if (backdrop) {
    backdrop.classList.add("oh-side-panel-backdrop");
    backdrop.setAttribute("aria-hidden", "true");
  }

  const titleElement = panel
    ? resolveElement(settings.title, settings.root) ||
      panel.querySelector("[data-oh-side-panel-title]") ||
      (
        panel.getAttribute("aria-labelledby")
          ? document.getElementById(panel.getAttribute("aria-labelledby"))
          : null
      )
    : null;

  function resetPanel() {
    if (typeof settings.reset === "function") {
      settings.reset();
    } else if (typeof settings.onReset === "function") {
      settings.onReset();
    }
  }

  function setTitle(title) {
    if (titleElement && title != null) titleElement.textContent = String(title);
  }

  function setMode(mode, type) {
    if (!panel) return;
    if (mode) panel.dataset.ohSidePanelMode = mode;
    else delete panel.dataset.ohSidePanelMode;
    if (type) panel.dataset.ohSidePanelType = type;
    else delete panel.dataset.ohSidePanelType;
  }

  function setState(state, details) {
    if (!panel) return;
    const selectedState = state || "ready";
    panel.dataset.ohSidePanelState = selectedState;
    panel.setAttribute("aria-busy", selectedState === "loading" ? "true" : "false");
    panel.querySelectorAll("[data-oh-panel-state]").forEach(element => {
      element.classList.toggle(
        "hidden",
        element.dataset.ohPanelState !== selectedState
      );
    });
    if (details && details.message) {
      const message = panel.querySelector("[data-oh-panel-state-message]");
      if (message) message.textContent = details.message;
    }
  }

  function focusInitial(target) {
    const focusTarget = resolveElement(target, settings.root) ||
      resolveElement(settings.initialFocus, settings.root) ||
      (
        panel &&
        panel.querySelector("[data-oh-side-panel-close], [data-oh-panel-close]")
      ) ||
      (panel && visibleFocusableElements(panel)[0]) ||
      panel;
    setTimeout(() => focusSafely(focusTarget), 0);
  }

  function closePanel(closeOptions) {
    if (!open) return;
    const closeSettings = closeOptions || {};
    open = false;
    if (backdrop) {
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
    }
    if (panel) {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
    }
    document.removeEventListener("keydown", handleKeydown, true);
    unlockBodyScroll();
    if (resetOnClose && closeSettings.reset !== false) resetPanel();
    if (closeSettings.restoreFocus !== false) {
      const focusTarget = closeSettings.returnFocus || returnFocus;
      if (
        focusTarget &&
        focusTarget.isConnected !== false &&
        typeof focusTarget.focus === "function"
      ) {
        focusSafely(focusTarget);
      }
    }
    returnFocus = null;
    if (typeof settings.onClose === "function") settings.onClose(closeSettings);
  }

  function handleKeydown(event) {
    if (!open || !panel) return;
    if (event.key === "Escape" && closeOnEscape) {
      event.preventDefault();
      closePanel({ reason: "escape" });
      return;
    }
    trapFocus(event, panel);
  }

  if (backdrop && closeOnBackdrop) {
    backdrop.addEventListener("click", event => {
      if (event.target === event.currentTarget) closePanel({ reason: "backdrop" });
    });
  }

  (settings.closeTriggers || []).forEach(target => {
    const trigger = resolveElement(target, settings.root);
    if (trigger) trigger.addEventListener("click", () => closePanel({ reason: "action" }));
  });

  return {
    open(triggerOrOptions) {
      const openOptions = triggerOrOptions &&
        typeof triggerOrOptions === "object" &&
        !(triggerOrOptions instanceof HTMLElement)
        ? triggerOrOptions
        : { trigger: triggerOrOptions };
      if (open && panel) closePanel({ reset: false, restoreFocus: false });
      returnFocus = openOptions.trigger || document.activeElement;
      if (openOptions.title != null) setTitle(openOptions.title);
      setMode(openOptions.mode || "", openOptions.type || "");
      setState(openOptions.state || "ready");
      if (backdrop) {
        backdrop.classList.remove("hidden");
        backdrop.setAttribute("aria-hidden", "false");
      }
      if (panel) {
        panel.classList.remove("hidden");
        panel.setAttribute("aria-hidden", "false");
      }
      open = true;
      lockBodyScroll();
      document.addEventListener("keydown", handleKeydown, true);
      focusInitial(openOptions.initialFocus);
      if (typeof settings.onOpen === "function") settings.onOpen(openOptions);
    },
    close: closePanel,
    reset: resetPanel,
    setTitle,
    setMode,
    setState,
    isOpen() {
      return open;
    }
  };
}

function ensurePlatformConfirmDialog() {
  let backdrop = document.getElementById("ohPlatformConfirmBackdrop");
  if (backdrop) return backdrop;

  backdrop = document.createElement("div");
  backdrop.id = "ohPlatformConfirmBackdrop";
  backdrop.className = "oh-dialog-backdrop hidden";
  backdrop.innerHTML =
    "<div class='oh-dialog' role='dialog' aria-modal='true' " +
      "aria-labelledby='ohPlatformConfirmTitle' " +
      "aria-describedby='ohPlatformConfirmMessage' tabindex='-1'>" +
      "<header class='oh-dialog-header'>" +
        "<h2 id='ohPlatformConfirmTitle'>Confirm action</h2>" +
        "<button id='ohPlatformConfirmClose' class='ghost' type='button' " +
          "aria-label='Close confirmation dialog'>Close</button>" +
      "</header>" +
      "<div id='ohPlatformConfirmMessage' class='oh-dialog-message'></div>" +
      "<div class='oh-dialog-actions'>" +
        "<button id='ohPlatformConfirmCancel' class='secondary' type='button'>Cancel</button>" +
        "<button id='ohPlatformConfirmOk' type='button'>Confirm</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(backdrop);
  return backdrop;
}

function closePlatformConfirmation(result) {
  const backdrop = document.getElementById("ohPlatformConfirmBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
  if (platformConfirmKeyHandler) {
    document.removeEventListener("keydown", platformConfirmKeyHandler, true);
    platformConfirmKeyHandler = null;
  }
  unlockBodyScroll();
  if (
    platformConfirmReturnFocus &&
    platformConfirmReturnFocus.isConnected !== false &&
    typeof platformConfirmReturnFocus.focus === "function"
  ) {
    focusSafely(platformConfirmReturnFocus);
  }
  platformConfirmReturnFocus = null;
  if (platformConfirmResolve) {
    platformConfirmResolve(!!result);
    platformConfirmResolve = null;
  }
}

export function requestPlatformConfirmation(options) {
  const settings = options || {};
  const backdrop = ensurePlatformConfirmDialog();
  const dialog = backdrop.querySelector(".oh-dialog");
  const title = backdrop.querySelector("#ohPlatformConfirmTitle");
  const message = backdrop.querySelector("#ohPlatformConfirmMessage");
  const closeButton = backdrop.querySelector("#ohPlatformConfirmClose");
  const cancelButton = backdrop.querySelector("#ohPlatformConfirmCancel");
  const confirmButton = backdrop.querySelector("#ohPlatformConfirmOk");

  if (platformConfirmResolve) closePlatformConfirmation(false);

  title.textContent = settings.title || "Confirm action";
  message.textContent = settings.message || "";
  cancelButton.textContent = settings.cancelText || "Cancel";
  confirmButton.textContent = settings.confirmText || "Confirm";
  confirmButton.className = settings.danger ? "danger" : "";
  dialog.classList.toggle("oh-dialog--danger", !!settings.danger);
  backdrop.classList.remove("hidden");
  platformConfirmReturnFocus = settings.trigger || document.activeElement;

  const cancel = () => closePlatformConfirmation(false);
  const confirm = () => closePlatformConfirmation(true);
  closeButton.onclick = cancel;
  cancelButton.onclick = cancel;
  confirmButton.onclick = confirm;
  backdrop.onclick = event => {
    if (event.target === event.currentTarget) cancel();
  };
  platformConfirmKeyHandler = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    trapFocus(event, dialog);
  };
  document.addEventListener("keydown", platformConfirmKeyHandler, true);
  lockBodyScroll();
  setTimeout(() => focusSafely(settings.initialFocus === "confirm" ? confirmButton : cancelButton), 0);

  return new Promise(resolve => {
    platformConfirmResolve = resolve;
  });
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
