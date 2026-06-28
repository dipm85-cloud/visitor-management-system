import { showMessage } from "./messages.js";
import { csvEscape } from "./utils.js";

export function downloadCsv(filename, rows) {
  if (!rows || rows.length === 0) {
    showMessage("Nothing to download.", "error");
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function normaliseExportRows(rows, type) {
  if (!rows || rows.length === 0) return [];

  if (type === "planned") {
    return rows.map(row => ({
      "Visitor": row.visitor_name || "",
      "Company": row.company || "",
      "Visit Date": row.visit_date || "",
      "Expected Time": row.expected_time || "",
      "Reason": row.visit_reason || "",
      "Vehicle": row.vehicle_plate || "",
      "On-site Contact": row.onsite_contact || "",
      "Security Pass": row.security_pass_id || "",
      "Created By": row.created_by || "",
      "Modified By": row.modified_by || "",
      "Modified At": row.modified_at || ""
    }));
  }

  return rows.map(row => ({
    "Visitor": row.visitor_name || "",
    "Company": row.company || "",
    "Origin": (row.visit_origin || (row.planned_visit_id ? "planned" : "walk_in")).replace("_", " "),
    "Security Pass": row.security_pass_id || "",
    "Vehicle": row.vehicle_plate || "",
    "On-site Contact": row.onsite_contact || "",
    "Sign In": row.sign_in_time ? new Date(row.sign_in_time).toLocaleString() : "",
    "Sign Out": row.sign_out_time ? new Date(row.sign_out_time).toLocaleString() : "",
    "Status": row.visit_status || "",
    "Auto Signed Out": row.signed_out_automatically ? "Yes" : "No",
    "Auto Sign-Out Reason": row.automatic_sign_out_reason || ""
  }));
}

export function autoSizeWorksheetColumns(ws, rows) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  ws["!cols"] = headers.map(header => {
    const maxLen = Math.max(
      header.length,
      ...rows.map(row => String(row[header] == null ? "" : row[header]).length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 12), 42) };
  });
}

export function exportToExcel(rows, filename, type) {
  const formattedRows = type === "agreements"
    ? (rows || [])
    : type === "audit"
      ? normaliseAuditExportRows(rows)
      : normaliseExportRows(rows, type);

  if (!formattedRows || formattedRows.length === 0) {
    showMessage("Nothing to export.", "error");
    return;
  }

  if (!window.XLSX) {
    showMessage("Excel export library could not be loaded.", "error");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(formattedRows);
  autoSizeWorksheetColumns(ws, formattedRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === "planned" ? "Planned Visits" : type === "audit" ? "Audit Events" : "Visit History");

  XLSX.writeFile(wb, filename);
}

export function normaliseAuditExportRows(rows) {
  return (rows || []).map(evt => ({
    "Time": evt.created_at ? new Date(evt.created_at).toLocaleString() : "",
    "Event Type": evt.event_type || "",
    "Actor": evt.actor_display_name || "",
    "Actor ID": evt.actor_id || "",
    "Entity Type": evt.entity_type || "",
    "Entity ID": evt.entity_id || "",
    "Details": JSON.stringify(evt.details || {})
  }));
}
