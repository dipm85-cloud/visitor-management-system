import { safe } from "./utils.js";

export function $(id) {
  return document.getElementById(id);
}

export function buildResultSummary(count, label, extraText) {
  return "<div class='results-summary'>" +
    "<span>" + safe(label) + ": " + count + " row(s)</span>" +
    "<span>" + safe(extraText || "") + "</span>" +
    "</div>";
}

export function setResultBox(box, summaryHtml, rowsContainer) {
  box.innerHTML = summaryHtml + "<div class='results-scroll'></div>";
  const scroll = box.querySelector(".results-scroll");
  if (rowsContainer) {
    while (rowsContainer.firstChild) {
      scroll.appendChild(rowsContainer.firstChild);
    }
  }
  return scroll;
}

export function focusFirstModalInput(modalBackdropId) {
  const modal = $(modalBackdropId);
  if (!modal) return;

  setTimeout(() => {
    let firstInput = null;

    if (modalBackdropId === "loginModalBackdrop" && $("loginEmail")) {
      firstInput = $("loginEmail");
    } else {
      firstInput = Array.from(modal.querySelectorAll("input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])"))
        .find(el => el.offsetParent !== null);
    }

    if (firstInput) {
      firstInput.focus({ preventScroll: true });
      if (typeof firstInput.select === "function") firstInput.select();
    }
  }, 120);
}

function getActiveModalConfig() {
  const modalKeyboardMap = [
    { backdrop: "assignmentEndModalBackdrop", enter: "assignmentEndConfirmButton", escape: "assignmentEndCancelButton" },
    { backdrop: "kioskLogoutModalBackdrop", enter: "confirmKioskLogoutButton", escape: "cancelKioskLogoutButton" },
    { backdrop: "notificationTemplateModalBackdrop", enter: "saveNotificationTemplateButton", escape: "cancelNotificationTemplateButton" },
    { backdrop: "gdprCaseModalBackdrop", enter: "saveGdprCaseButton", escape: "cancelGdprCaseButton" },
    { backdrop: "gdprAnonymiseModalBackdrop", enter: "confirmGdprAnonymiseButton", escape: "cancelGdprAnonymiseButton" },
    { backdrop: "retentionConfirmModalBackdrop", enter: "confirmRetentionRunButton", escape: "cancelRetentionRunButton" },
    { backdrop: "privacyNoticeModalBackdrop", enter: "confirmPrivacyNoticeButton", escape: "cancelPrivacyNoticeButton" },
    { backdrop: "walkInModalBackdrop", enter: "walkInButton", escape: "cancelWalkInButton" },
    { backdrop: "loginModalBackdrop", enter: "loginButton", escape: "closeLoginModalButton" },
    { backdrop: "changePasswordModalBackdrop", enter: "savePasswordButton", escape: "cancelPasswordButton" },
    { backdrop: "editModalBackdrop", enter: "saveEditButton", escape: "closeEditModalButton" },
    { backdrop: "auditDetailsModalBackdrop", enter: "closeAuditDetailsBottomButton", escape: "closeAuditDetailsModalButton" },
    { backdrop: "kioskConfirmBackdrop", enter: "closeKioskConfirmButton", escape: "closeKioskConfirmButton" }
  ];

  return modalKeyboardMap.find(config => {
    const el = $(config.backdrop);
    return el && el.classList.contains("active");
  });
}

export function handleGlobalModalKeyboard(event) {
  if (event.key !== "Enter" && event.key !== "Escape") return;

  const active = getActiveModalConfig();
  if (!active) return;

  if (event.key === "Enter") {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tag === "textarea") return;

    const btn = $(active.enter);
    if (btn) {
      event.preventDefault();
      btn.click();
    }
  }

  if (event.key === "Escape") {
    const btn = $(active.escape);
    if (btn) {
      event.preventDefault();
      btn.click();
    }
  }
}
