import { AppState } from "./state.js";
import { showMessage } from "./messages.js";
import { printEscape, formatPrintDate, formatPrintTime } from "./utils.js";
import { buildOperationsPrintDocument } from "./platformUi.js";
import { getPrintLogoUrl } from "./brandingThemeService.js";

let appSettings;
let printingDependencies;

export function configurePrinting(options) {
  appSettings = options.appSettings;
  printingDependencies = options.dependencies;
}

export function buildCompactPlannedPrintHtml(rows, selectedDate, printedBy) {
  const generatedAt = new Date().toLocaleString();
  const companyName = appSettings.companyName || "Visitor Management";
  const bodyRows = (rows || []).map((row, index) => {
    return "<tr>" +
      "<td class='num'>" + (index + 1) + "</td>" +
      "<td>" + printEscape(row.visitor_name) + "</td>" +
      "<td>" + printEscape(row.company) + "</td>" +
      "<td>" + printEscape(formatPrintTime(row.expected_time)) + "</td>" +
      "<td>" + printEscape(row.vehicle_plate) + "</td>" +
      "<td>" + printEscape(row.onsite_contact) + "</td>" +
      "<td>" + printEscape(row.security_pass_id) + "</td>" +
    "</tr>";
  }).join("");

  const bodyHtml =
    "<div class='summary'><span>Total planned visitors: " + (rows ? rows.length : 0) +
    "</span><span>Security morning printout</span></div>" +
    "<table><thead><tr>" +
    "<th class='num'>#</th><th class='visitor'>Visitor</th><th class='companyCol'>Company</th><th class='time'>Time</th><th class='vehicle'>Vehicle</th><th class='contact'>On-site Contact</th><th class='pass'>Security Pass</th>" +
    "</tr></thead><tbody>" + bodyRows + "</tbody></table>";

  return buildOperationsPrintDocument({
    title: "Planned Visitor List",
    subtitle: "Security morning printout",
    kicker: "Operations Hub / Visitors",
    companyName,
    logoUrl: getPrintLogoUrl(appSettings),
    generatedAt,
    orientation: "landscape",
    contextFields: [
      { label: "Selected date", value: formatPrintDate(selectedDate) },
      { label: "Printed by", value: printedBy || "-" }
    ],
    footerText: "Visitor operations",
    bodyHtml,
    extraStyles:
    ".summary{display:flex;justify-content:space-between;border:1px solid #d1d5db;background:#f9fafb;padding:6px 8px;margin-bottom:8px;font-weight:800;}" +
    "table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
    "th{background:#e5e7eb;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.03em;border:1px solid #9ca3af;padding:5px 6px;}" +
    "td{border:1px solid #d1d5db;padding:5px 6px;vertical-align:top;word-wrap:break-word;}" +
    "tr:nth-child(even) td{background:#f9fafb;}" +
    ".num{width:28px;text-align:center;color:#6b7280;}" +
    ".visitor{width:19%;}.companyCol{width:18%;}.time{width:8%;}.vehicle{width:13%;}.contact{width:19%;}.pass{width:12%;}"
  });
}

export function buildDailyPlannedVisitorPrintHtml(rows, options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toLocaleString();
  const companyName = options.companyName || "Visitor Management";
  const siteName = options.siteName || "";
  const logoUrl = options.logoUrl || "";
  const bodyRows = (rows || []).map(row => {
    return "<tr>" +
      "<td class='visitor'>" + printEscape(row.visitor_name) + "</td>" +
      "<td class='company-col'>" + printEscape(row.company) + "</td>" +
      "<td class='contact'>" + printEscape(row.onsite_contact) + "</td>" +
      "<td class='time'>" + printEscape(formatPrintTime(row.expected_time)) + "</td>" +
      "<td class='vehicle'>" + printEscape(row.vehicle_plate) + "</td>" +
      "<td class='pass'>" + printEscape(row.security_pass_id) + "</td>" +
      "<td class='status'>" + printEscape(row.document_status) + "</td>" +
      "<td class='notes'>" + printEscape(row.notes || row.visit_reason) + "</td>" +
    "</tr>";
  }).join("");
  const bodyHtml =
    "<div class='document-summary'><span>Planned visitors: " + (rows || []).length +
    "</span><span>Reception / Security operational document</span></div>" +
    "<table class='document-table'><thead><tr><th class='visitor'>Visitor</th><th class='company-col'>Company</th>" +
    "<th class='contact'>Host / On-site Contact</th><th class='time'>Expected Time</th>" +
    "<th class='vehicle'>Vehicle Registration</th><th class='pass'>Security Pass</th>" +
    "<th class='status'>Status</th><th class='notes'>Notes</th></tr></thead><tbody>" +
    bodyRows + "</tbody></table>";

  return buildOperationsPrintDocument({
    title: "Daily Planned Visitor List",
    subtitle: "Reception / Security operational document",
    kicker: "Operations Hub / Visitors",
    companyName,
    siteName,
    logoUrl,
    generatedAt,
    orientation: "landscape",
    contextFields: [
      { label: "Planned visit date", value: formatPrintDate(options.selectedDate) },
      { label: "Printed by", value: options.printedBy || "-" }
    ],
    footerText: "Visitor operations",
    bodyHtml,
    extraStyles:
    ".document-summary{display:flex;justify-content:space-between;gap:12px;padding:5px 0 7px;border-bottom:1px solid #777;margin-bottom:7px;font-weight:700;}" +
    ".document-table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
    "th{padding:5px 5px;border:1px solid #555;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.025em;background:#eee;color:#111;}" +
    "td{padding:5px;border:1px solid #999;vertical-align:top;overflow-wrap:anywhere;}" +
    ".visitor{width:14%;}.company-col{width:13%;}.contact{width:16%;}.time{width:7%;}.vehicle{width:11%;}.pass{width:9%;}.status{width:9%;}.notes{width:21%;}"
  });
}

export function openPrintDocument(html) {
  const printWindow = window.open("", "_blank", "width=1200,height=800");
  if (!printWindow || !printWindow.document) return false;
  printWindow.document.open("text/html", "replace");
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
}

export function printPlannedList(rows, selectedDate) {
  if (!rows || rows.length === 0) {
    showMessage("No planned visits are loaded. Please load or search a planned visitor list before printing.", "error");
    return;
  }

  const printedBy = AppState.currentProfile
    ? AppState.currentProfile.display_name + " (" + printingDependencies.roleLabel(AppState.currentProfile.role) + ")"
    : "-";

  const html = buildCompactPlannedPrintHtml(rows, selectedDate, printedBy);

  // Do not use noopener/noreferrer here. Some browsers open the tab but block script
  // access to the new document, which leaves the print page blank.
  const printWindow = window.open("", "_blank", "width=1200,height=800");
  if (!printWindow || !printWindow.document) {
    showMessage("The browser blocked the print window. Please allow pop-ups for this site and try again.", "error");
    return;
  }

  printWindow.document.open("text/html", "replace");
  printWindow.document.write(html);
  printWindow.document.close();

  // Fallback for browsers that do not fire load reliably after document.write.
  setTimeout(function () {
    try {
      printWindow.focus();
      if (printWindow.document && printWindow.document.body && printWindow.document.body.children.length > 0) {
        printWindow.print();
      }
    } catch (err) {
      console.warn("Print fallback failed:", err);
    }
  }, 500);
}
