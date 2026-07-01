import { KIOSK_TOKEN_STORAGE_KEY } from "./config.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { showMessage } from "./messages.js";
import { showScreen } from "./navigation.js";

let appSettings;
let kioskDependencies;

export function configureKiosk(options) {
  appSettings = options.appSettings;
  kioskDependencies = options.dependencies;
}

export function getKioskToken() {
  return localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY) || "";
}

export function setKioskToken(token) {
  localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, token);
  updateKioskTokenWarning();
}

export function updateKioskTokenWarning() {
  const warning = $("kioskTokenWarning");
  if (!warning) return;
  warning.classList.toggle("hidden", !!getKioskToken());

  const status = $("localKioskTokenStatus");
  if (status) {
    status.textContent = getKioskToken()
      ? "This browser/tablet has a kiosk token saved."
      : "No kiosk token is saved in this browser/tablet.";
  }
}

export function clearKioskTokenForThisTablet() {
  if (!confirm("Clear the saved kiosk token from this browser/tablet?")) return;
  localStorage.removeItem(KIOSK_TOKEN_STORAGE_KEY);
  updateKioskTokenWarning();
  showMessage("This tablet kiosk token has been cleared.", "success");
}

export function promptSetKioskTokenForThisTablet() {
  const entered = prompt("Enter kiosk device token for this tablet:");
  if (entered && entered.trim()) {
    setKioskToken(entered.trim());
    showMessage("This tablet kiosk token has been saved.", "success");
  }
}

export function bindKioskIdleActivityReset() {
  const resetEvents = ["input", "change", "keydown", "pointerdown", "touchstart", "focusin"];

  const containers = [
    "signInScreen",
    "signOutScreen",
    "walkInModalBackdrop",
    "privacyNoticeModalBackdrop",
    "kioskConfirmBackdrop"
  ];

  containers.forEach(id => {
    const el = $(id);
    if (!el || el.dataset.idleResetBound === "true") return;

    resetEvents.forEach(eventName => {
      el.addEventListener(eventName, () => {
        if (kioskDependencies.isKioskProfile()) resetKioskIdleTimer();
      }, true);
    });

    el.dataset.idleResetBound = "true";
  });
}

export function resetKioskIdleTimer() {
  if (AppState.kioskIdleTimer) clearTimeout(AppState.kioskIdleTimer);

  const onKioskScreen =
    $("signInScreen").classList.contains("active") ||
    $("signOutScreen").classList.contains("active");

  if (!onKioskScreen) return;

  AppState.kioskIdleTimer = setTimeout(function () {
    showScreen("homeScreen");
  }, appSettings.kioskIdleTimeoutMs);
}

export function ensureKioskToken() {
  const superUserKioskTestAllowed = kioskDependencies.isSuperKioskTestProfile();
  if (!kioskDependencies.isKioskProfile() && !superUserKioskTestAllowed) {
    throw new Error("Kiosk login is required before public sign-in/out can be used.");
  }

  const token = getKioskToken();
  if (token) return token;

  updateKioskTokenWarning();
  throw new Error("Kiosk device token is required. Set this tablet token from Settings > Kiosk Device Manager first.");
}
