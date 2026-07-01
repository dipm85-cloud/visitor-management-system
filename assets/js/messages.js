import { $ } from "./dom.js";
import { AppState } from "./state.js";
import { safe } from "./utils.js";

let appSettings;
let confirmTimer = null;
const recentToastKeys = new Map();

export function configureMessages(settings) {
  appSettings = settings;
}

export function showMessage(text, type) {
  const box = $("message");
  box.textContent = text;
  box.className = "message " + type;

  if (text && AppState.currentProfile && AppState.currentProfile.role !== "kiosk_user") {
    showToast(type === "error" ? "Action failed" : "Action complete", text, type || "success");
  }
}

export function clearMessage() {
  const box = $("message");
  box.textContent = "";
  box.className = "message";
}

function isLowValueAutoToast(title, body, type) {
  if (type === "error") return false;
  const text = (String(title || "") + " " + String(body || "")).toLowerCase();
  return /\b(loading|loaded|refreshing|refreshed|searching|reloaded)\b/.test(text)
    && !/saved|created|deleted|updated|failed|error|cannot|could not|blocked|warning|missing/.test(text);
}

export function showToast(title, body, type) {
  // Staff/admin messages use toasts. Kiosk visitor messages still use the centre modal.
  const area = $("toastArea");
  if (!area) return;

  const toastType = type || "success";
  if (isLowValueAutoToast(title, body, toastType)) return;

  const key = toastType + "|" + String(title || "") + "|" + String(body || "");
  const nowMs = Date.now();
  const previous = recentToastKeys.get(key) || 0;
  if (nowMs - previous < 2500) return;
  recentToastKeys.set(key, nowMs);

  const toast = document.createElement("div");
  toast.className = "toast " + toastType;

  const content = document.createElement("div");
  content.innerHTML =
    "<div class='toast-title'>" + safe(title) + "</div>" +
    "<div class='toast-body'>" + safe(body) + "</div>";

  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.innerHTML = "&times;";
  close.addEventListener("click", function () {
    toast.remove();
  });

  toast.appendChild(content);
  toast.appendChild(close);
  area.appendChild(toast);

  setTimeout(function () {
    toast.remove();
  }, appSettings.confirmationAutoCloseMs);
}

export function showKioskConfirmation(title, body) {
  $("kioskConfirmTitle").textContent = title;
  $("kioskConfirmBody").textContent = body;
  $("kioskConfirmBackdrop").classList.add("active");

  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(closeKioskConfirmation, appSettings.confirmationAutoCloseMs);
}

export function closeKioskConfirmation() {
  $("kioskConfirmBackdrop").classList.remove("active");
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = null;
}

export function showWalkInModalMessage(text, type) {
  const box = $("walkInModalMessage");
  if (!box) {
    showMessage(text, type || "error");
    return;
  }
  box.textContent = text;
  box.className = "modal-message " + (type || "error");
}

export function clearWalkInModalMessage() {
  const box = $("walkInModalMessage");
  if (!box) return;
  box.textContent = "";
  box.className = "modal-message";
}

export function showEditModalMessage(text, type) {
  const box = $("editModalMessage");
  if (!box) {
    showMessage(text, type || "error");
    return;
  }
  box.textContent = text;
  box.className = "modal-message " + (type || "error");
}

export function clearEditModalMessage() {
  const box = $("editModalMessage");
  if (!box) return;
  box.textContent = "";
  box.className = "modal-message";
}

export function setLocalStatus(id, message, type) {
  const box = $(id);
  if (box) {
    box.textContent = message || "";
    if (!message) {
      box.className = "local-action-status";
      return;
    }
    box.className = "local-action-status " + (type || "info");
  }

  if (message) {
    const toastType = type === "error" ? "error" : (type === "success" ? "success" : "info");
    const toastTitle = type === "error" ? "Action failed" : (type === "success" ? "Action complete" : "Information");
    showToast(toastTitle, message, toastType);
  }
}

export function showKioskLogoutModalMessage(text, type) {
  const box = $("kioskLogoutModalMessage");
  if (!box) return;
  box.textContent = text;
  box.className = "modal-message " + (type || "error");
}

export function clearKioskLogoutModalMessage() {
  const box = $("kioskLogoutModalMessage");
  if (!box) return;
  box.textContent = "";
  box.className = "modal-message";
}
