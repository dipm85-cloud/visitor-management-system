import { $ } from "./dom.js";
import { clearMessage } from "./messages.js";
import { AppState } from "./state.js";

let navigationDependencies;

export function configureNavigation(dependencies) {
  navigationDependencies = dependencies;
}

export function showScreen(screenId) {
  const {
    isKioskProfile,
    clearWalkInForm,
    bindKioskIdleActivityReset,
    resetKioskIdleTimer,
    setSuperKioskTestMode
  } = navigationDependencies;

  if (screenId === "staffScreen") {
    setSuperKioskTestMode(false);
    document.body.classList.toggle("kiosk-mode", isKioskProfile());
  }
  $("homeScreen").style.display = screenId === "homeScreen" ? "grid" : "none";
  ["signInScreen", "signOutScreen", "staffScreen"].forEach(id => {
    $(id).classList.toggle("active", id === screenId);
  });
  clearMessage();

  if (AppState.kioskIdleTimer) {
    clearTimeout(AppState.kioskIdleTimer);
    AppState.kioskIdleTimer = null;
  }

  if (screenId === "homeScreen" || screenId === "staffScreen" || screenId === "signOutScreen") {
    if ($("walkInModalBackdrop")) $("walkInModalBackdrop").classList.remove("active");
    clearWalkInForm();
  }

  if (screenId === "signInScreen" || screenId === "signOutScreen") {
    bindKioskIdleActivityReset();
    resetKioskIdleTimer();
  }
}
