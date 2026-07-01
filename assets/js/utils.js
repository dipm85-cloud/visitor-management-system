export function todayDate() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

export function safe(value) {
  const text = String(value || "").trim();
  return text === "" ? "-" : text;
}

export function safeAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function titleCaseText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

export function formatPersonName(value) {
  return titleCaseText(value);
}

export function normaliseBusinessCode(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

export function normaliseEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

export function normalisePlate(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  return text === "" ? null : text;
}

export function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

export function exportDateStamp() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

export function boolString(value) {
  return value ? "true" : "false";
}

export function printEscape(value) {
  return String(value == null || value === "" ? "-" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPrintDate(value) {
  if (!value) return "Not selected";
  const parts = String(value).split("-");
  if (parts.length === 3) return parts[2] + "/" + parts[1] + "/" + parts[0];
  return value;
}

export function formatPrintTime(value) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

export function localDateKey() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

export function addOneMonthDate(value) {
  const d = value ? new Date(value + "T00:00:00") : new Date();
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}
