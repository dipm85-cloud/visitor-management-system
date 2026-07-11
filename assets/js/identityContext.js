import { supabaseClient } from "./api.js";
import { hasAnyCapability, hasCapability } from "./capabilities.js";
import { showToast } from "./messages.js";
import { createSidePanelController, renderEmptyState } from "./platformUi.js";
import { settingValue } from "./settings.js";

const DOCUMENT_COMPLIANCE_IDENTITY_LINK_SETTING =
  "document_signoff.use_confirmed_identity_links_for_compliance";

const IDENTITY_CONTEXT_CAPABILITIES = [
  "identity_resolution.view",
  "identity_resolution.request",
  "identity_resolution.manage",
  "privacy.case.view",
  "privacy.case.manage",
  "privacy.manage",
  "gdpr.manage",
  "module_configuration.manage",
  "settings.view"
];

const SOURCE_TYPE_LABELS = {
  visit_log: "Visit Log / Visitor History",
  visitor_history: "Visitor History",
  planned_visits: "Planned Visit",
  planned_visit: "Planned Visit",
  privacy_cases: "Privacy Case",
  privacy_case: "Privacy Case",
  document_evidence: "Document Evidence",
  agreement_evidence: "Agreement Evidence",
  document_signoff_evidence: "Document Sign-off Evidence",
  audit_events: "Audit Event",
  manual: "Manual Record",
  other: "Other Source"
};

let linkedIdentityPanelController = null;

function textOrDash(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? textOrDash(value) : date.toLocaleString();
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function shortReference(value) {
  const text = String(value || "").trim();
  return text.length > 8 ? text.slice(0, 8) + "..." : text;
}

function summaryObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function canViewLinkedIdentityContext() {
  return hasAnyCapability(IDENTITY_CONTEXT_CAPABILITIES);
}

function useIdentityLinksForDocumentCompliance() {
  const value = settingValue(DOCUMENT_COMPLIANCE_IDENTITY_LINK_SETTING, false);
  return value === true || value === "true";
}

export function friendlyIdentitySourceType(value) {
  const key = String(value || "").trim();
  return SOURCE_TYPE_LABELS[key] || textOrDash(key).replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function createMetaItem(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = textOrDash(value);
  item.append(term, detail);
  return item;
}

function usefulSummaryFields(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  const labels = {
    result_label: "Label",
    display_label: "Label",
    case_reference: "Case reference",
    source_area: "Source area",
    visitor_name: "Visitor / subject",
    company: "Company",
    document: "Document",
    version: "Version",
    status: "Status",
    visit_status: "Visit status",
    visit_origin: "Visit origin",
    visit_date: "Visit date",
    expected_time: "Expected time",
    host: "Host",
    host_name: "Host",
    onsite_contact: "Host / contact",
    sign_in_time: "Sign in",
    sign_out_time: "Sign out",
    agreement_name: "Agreement",
    agreement_title: "Agreement title",
    agreement_version_number: "Version",
    evidence_document_title: "Document",
    evidence_document_version: "Version",
    signed_at: "Signed",
    signed_by_name: "Signed by",
    created_at: "Created",
    event_type: "Event type",
    evidence_type: "Evidence type"
  };
  return Object.entries(labels)
    .filter(([key]) => source[key] !== null && source[key] !== undefined && String(source[key]).trim())
    .filter(([key]) => !["result_label", "display_label"].includes(key) || !isUuidLike(source[key]))
    .map(([key, label]) => ({ label, value: /_time$|_at$/.test(key) ? formatDate(source[key]) : source[key] }));
}

function friendlySourceLabel(sourceType, sourceRecordId, sourceLabel, sourceSummary) {
  const type = String(sourceType || "").trim();
  const summary = summaryObject(sourceSummary);
  const storedLabel = String(sourceLabel || "").trim();
  if (storedLabel && !isUuidLike(storedLabel)) return storedLabel;

  const sourceArea = friendlyIdentitySourceType(type);
  const subject = [summary.visitor_name || summary.subject_name, summary.company].filter(Boolean).join(" / ");

  if (type === "visit_log" || type === "visitor_history") {
    const signedIn = summary.sign_in_time ? "Signed in " + formatDate(summary.sign_in_time) : "";
    const signedOut = summary.sign_out_time ? "Signed out " + formatDate(summary.sign_out_time) : "";
    return [sourceArea, subject, signedIn || signedOut].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(sourceRecordId);
  }

  if (type === "planned_visits" || type === "planned_visit") {
    const date = summary.visit_date ? "Visit date " + summary.visit_date : "";
    const host = summary.host || summary.host_name || summary.onsite_contact;
    return [sourceArea, subject, date, host ? "Host " + host : ""].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(sourceRecordId);
  }

  if (type === "document_evidence" || type === "agreement_evidence" || type === "document_signoff_evidence") {
    const documentTitle = summary.document || summary.agreement_title || summary.agreement_name || summary.evidence_document_title;
    const version = summary.version || summary.agreement_version_number || summary.evidence_document_version;
    const signed = summary.signed_at ? "Signed " + formatDate(summary.signed_at) : "";
    const documentLabel = [documentTitle, version ? "version " + version : ""].filter(Boolean).join(" ");
    return [sourceArea, documentLabel, subject, signed].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(sourceRecordId);
  }

  if (type === "privacy_cases" || type === "privacy_case") {
    const caseReference = summary.case_reference || summary.case_id;
    const subjectLabel = summary.search_text || summary.subject_reference || summary.result_label;
    return [sourceArea, caseReference, subjectLabel].filter(Boolean).join(" - ") ||
      sourceArea + " record - reference " + shortReference(sourceRecordId);
  }

  return storedLabel || sourceArea + " record - reference " + shortReference(sourceRecordId);
}

function sourceTypeForRow(row) {
  return row && (row.linked_source_type || row.source_type || "");
}

function sourceRecordIdForRow(row) {
  return row && (row.linked_source_record_id || row.source_record_id || "");
}

async function lookupSourceRecordSummary(sourceType, sourceRecordId) {
  const type = String(sourceType || "").trim();
  const id = String(sourceRecordId || "").trim();
  if (!type || !id) return null;

  try {
    if (type === "visit_log" || type === "visitor_history") {
      const result = await supabaseClient
        .from("visit_log")
        .select("id, visitor_name, company, onsite_contact, sign_in_time, sign_out_time, visit_status, visit_origin")
        .eq("id", id)
        .maybeSingle();
      if (result.error || !result.data) return null;
      return {
        visitor_name: result.data.visitor_name || null,
        company: result.data.company || null,
        onsite_contact: result.data.onsite_contact || null,
        sign_in_time: result.data.sign_in_time || null,
        sign_out_time: result.data.sign_out_time || null,
        visit_status: result.data.visit_status || null,
        visit_origin: result.data.visit_origin || null
      };
    }

    if (type === "planned_visits" || type === "planned_visit") {
      const result = await supabaseClient
        .from("planned_visits")
        .select("id, visitor_name, company, onsite_contact, visit_date, expected_time, status")
        .eq("id", id)
        .maybeSingle();
      if (result.error || !result.data) return null;
      return {
        visitor_name: result.data.visitor_name || null,
        company: result.data.company || null,
        onsite_contact: result.data.onsite_contact || null,
        visit_date: result.data.visit_date || null,
        expected_time: result.data.expected_time || null,
        status: result.data.status || null
      };
    }

    if (type === "privacy_cases" || type === "privacy_case") {
      const result = await supabaseClient
        .from("privacy_cases")
        .select("id, case_reference, case_type, status, subject_name, subject_company, subject_reference, search_text, request_received_date")
        .eq("id", id)
        .maybeSingle();
      if (result.error || !result.data) return null;
      return {
        case_reference: result.data.case_reference || null,
        case_type: result.data.case_type || null,
        status: result.data.status || null,
        subject_name: result.data.subject_name || null,
        company: result.data.subject_company || null,
        subject_reference: result.data.subject_reference || null,
        search_text: result.data.search_text || null,
        request_received_date: result.data.request_received_date || null
      };
    }

    if (type === "document_evidence" || type === "agreement_evidence" || type === "document_signoff_evidence") {
      const evidence = await lookupAgreementEvidenceSummary(id);
      if (evidence) return evidence;
    }
  } catch (error) {
    console.warn("Linked identity source label enrichment failed.", { sourceType: type, sourceRecordId: id, error });
  }

  return null;
}

async function lookupAgreementEvidenceSummary(sourceRecordId) {
  const searchWindows = [3650, 36500];
  for (const days of searchWindows) {
    const result = await supabaseClient.rpc("search_visitor_agreements", {
      p_date_from: dateDaysAgo(days),
      p_date_to: todayDate(),
      p_visitor_name: null,
      p_company: null,
      p_agreement_version_id: null,
      p_agreement_type_id: null
    });
    if (result.error) return null;
    const record = (result.data || []).find(row => evidenceRecordMatches(row, sourceRecordId));
    if (record) {
      return {
        visitor_name: record.visitor_name || null,
        company: record.company || null,
        document: record.agreement_name || record.agreement_title || null,
        agreement_name: record.agreement_name || null,
        agreement_title: record.agreement_title || null,
        agreement_version_number: record.agreement_version_number || null,
        signed_at: record.signed_at || null,
        signed_by_name: record.signed_by_name || null,
        inductor_name: record.inductor_name || null,
        visit_log_id: record.visit_log_id || record.visitor_log_id || null,
        evidence_type: record.has_signature || record.has_visitor_signature
          ? "Signature"
          : record.accepted_without_signature
            ? "Tick acceptance"
            : "Evidence recorded"
      };
    }
  }
  return null;
}

function evidenceRecordMatches(row, sourceRecordId) {
  const id = String(sourceRecordId || "").trim();
  if (!id || !row) return false;
  return [
    row.id,
    row.agreement_id,
    row.agreement_signature_id,
    row.document_evidence_id,
    row.evidence_id
  ].some(value => String(value || "").trim() === id);
}

function todayDate() {
  const date = new Date();
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

export async function enrichIdentityLinkRowsForDisplay(rows) {
  const sourceCache = new Map();
  const records = Array.isArray(rows) ? rows : [];

  return Promise.all(records.map(async row => {
    const sourceType = sourceTypeForRow(row);
    const sourceRecordId = sourceRecordIdForRow(row);
    const cacheKey = sourceType + ":" + sourceRecordId;
    let enrichment = sourceCache.get(cacheKey);
    if (enrichment === undefined) {
      enrichment = await lookupSourceRecordSummary(sourceType, sourceRecordId);
      sourceCache.set(cacheKey, enrichment || null);
    }
    if (!enrichment) return row;

    const summaryField = row.linked_source_summary !== undefined ? "linked_source_summary" : "source_summary";
    const labelField = row.linked_source_label !== undefined ? "linked_source_label" : "source_label";
    const mergedSummary = {
      ...summaryObject(row[summaryField]),
      ...enrichment
    };
    return {
      ...row,
      [summaryField]: mergedSummary,
      [labelField]: friendlySourceLabel(sourceType, sourceRecordId, "", mergedSummary)
    };
  }));
}

function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value)
      .then(() => showToast("Technical ID copied", "The record reference was copied.", "success"))
      .catch(() => showToast("Copy failed", "The record reference could not be copied.", "error"));
    return;
  }
  showToast("Copy unavailable", "Clipboard access is not available in this browser.", "error");
}

function appendTechnicalDetails(parent, title, fields, summary) {
  const details = document.createElement("details");
  details.className = "linked-identity-technical identity-resolution-request-details identity-resolution-request-advanced";
  const header = document.createElement("summary");
  header.textContent = title || "Advanced / Technical Details";
  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  (fields || []).forEach(field => meta.appendChild(createMetaItem(field.label, field.value)));
  details.append(header, meta);
  if (summary && typeof summary === "object" && Object.keys(summary).length) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(summary, null, 2);
    details.appendChild(pre);
  }
  const sourceIdField = (fields || []).find(field => /record id/i.test(field.label || "") && field.value);
  if (sourceIdField) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary";
    copy.textContent = "Copy Technical ID";
    copy.addEventListener("click", () => copyTextToClipboard(sourceIdField.value));
    details.appendChild(copy);
    const note = document.createElement("p");
    note.className = "linked-identity-readiness-note";
    note.textContent = "Future platform rule: operational searches should support authorised internal reference lookup. Use this technical ID for support/admin lookup when a direct Open Record action is not available.";
    details.appendChild(note);
  }
  parent.appendChild(details);
}

function appendLinkedSourceActions(parent, sourceType, sourceRecordId) {
  const type = String(sourceType || "").trim();
  const id = String(sourceRecordId || "").trim();
  if (!id) return;
  const isVisitLog = type === "visit_log" || type === "visitor_history";
  const isPlannedVisit = type === "planned_visits" || type === "planned_visit";
  const isPrivacyCase = type === "privacy_cases" || type === "privacy_case";
  const isEvidence = type === "document_evidence" || type === "agreement_evidence" || type === "document_signoff_evidence";
  const canOpenPrivacyCase = isPrivacyCase && hasAnyCapability([
    "privacy.case.view",
    "privacy.case.manage",
    "privacy.view",
    "privacy.manage",
    "gdpr.view",
    "gdpr.manage"
  ]);
  const canOpenEvidence = isEvidence &&
    hasCapability("visitor.view") &&
    hasAnyCapability(["agreements.view", "audit.view", "visitor.history.view", "module_configuration.manage"]);
  if (!isVisitLog && !isPlannedVisit && !isPrivacyCase && !isEvidence) return;
  if (isPrivacyCase && !canOpenPrivacyCase) return;
  if (isEvidence && !canOpenEvidence) return;

  const actions = document.createElement("div");
  actions.className = "identity-resolution-card-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "secondary";
  open.textContent = isVisitLog
    ? "Open Visitor History Record"
    : isPlannedVisit
      ? "Open Planned Visit"
      : isPrivacyCase
        ? "Open Privacy Case"
        : "Open Document Evidence";
  open.addEventListener("click", () => {
    if (linkedIdentityPanelController) {
      linkedIdentityPanelController.close({ restoreFocus: false });
    }
    window.dispatchEvent(new CustomEvent("oh:linked-source-record-requested", {
      detail: {
        sourceType: type,
        sourceRecordId: id
      }
    }));
  });
  actions.appendChild(open);
  parent.appendChild(actions);
}

function createLinkCard(link, requestedSource) {
  const card = document.createElement("article");
  card.className = "linked-identity-link-card";
  const header = document.createElement("div");
  header.className = "linked-identity-link-header";
  const title = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = link.link_reference || "Reviewed link";
  const subtitle = document.createElement("p");
  subtitle.textContent = textOrDash(link.canonical_label || "Confirmed identity link metadata");
  title.append(heading, subtitle);
  const badge = document.createElement("span");
  badge.className = "identity-resolution-badge " + (link.link_status === "active" ? "confirmed" : "deferred");
  badge.textContent = textOrDash(link.link_status).replace(/_/g, " ");
  header.append(title, badge);

  const meta = document.createElement("dl");
  meta.className = "identity-resolution-meta-grid";
  meta.append(
    createMetaItem("Identity type", textOrDash(link.identity_type).replace(/_/g, " ")),
    createMetaItem("Link reason", link.link_reason),
    createMetaItem("Created", formatDate(link.link_created_at)),
    createMetaItem("Created from candidate", link.created_from_candidate_id)
  );

  const records = document.createElement("div");
  records.className = "identity-resolution-source-grid";
  (link.records || []).forEach((record, index) => {
    const block = document.createElement("section");
    block.className = "identity-resolution-source-block";
    const sourceType = record.linked_source_type || record.source_type;
    const sourceRecordId = record.linked_source_record_id || record.source_record_id;
    const sourceSummary = summaryObject(record.linked_source_summary || record.source_summary);
    const sourceLabel = friendlySourceLabel(
      sourceType,
      sourceRecordId,
      record.linked_source_label || record.source_label,
      sourceSummary
    );
    const recordHeading = document.createElement("h4");
    recordHeading.textContent = (record.is_requested_source ? "Current source" : "Linked record") + " " + (index + 1);
    const recordMeta = document.createElement("dl");
    recordMeta.className = "identity-resolution-meta-grid";
    recordMeta.append(
      createMetaItem("Source area", friendlyIdentitySourceType(sourceType)),
      createMetaItem("Source label", sourceLabel),
      createMetaItem("Linked", formatDate(record.linked_record_created_at || record.source_record_linked_at))
    );
    usefulSummaryFields(sourceSummary).forEach(field => {
      recordMeta.appendChild(createMetaItem(field.label, field.value));
    });
    block.append(recordHeading, recordMeta);
    appendLinkedSourceActions(block, sourceType, sourceRecordId);
    appendTechnicalDetails(block, "Advanced / Technical Details", [
      { label: "Source type", value: sourceType },
      { label: "Source record ID", value: sourceRecordId },
      { label: "Link record ID", value: record.link_record_id }
    ], sourceSummary);
    records.appendChild(block);
  });

  card.append(header, meta, records);
  if (requestedSource) {
    const note = document.createElement("p");
    note.className = "linked-identity-readiness-note";
    note.textContent = "Source records are not modified. Confirmed identity links are currently shown for review context only.";
    card.appendChild(note);
  }
  return card;
}

function groupRowsByLink(rows) {
  const links = new Map();
  (rows || []).forEach(row => {
    const key = row.identity_link_id || row.link_reference || "link";
    if (!links.has(key)) {
      links.set(key, {
        identity_link_id: row.identity_link_id,
        link_reference: row.link_reference,
        identity_type: row.identity_type,
        link_status: row.link_status,
        canonical_label: row.canonical_label,
        link_reason: row.link_reason,
        created_from_candidate_id: row.created_from_candidate_id,
        link_created_at: row.link_created_at,
        link_updated_at: row.link_updated_at,
        records: []
      });
    }
    links.get(key).records.push(row);
  });
  return Array.from(links.values());
}

function ensureLinkedIdentityPanel() {
  let backdrop = document.getElementById("linkedIdentityContextPanelBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "linkedIdentityContextPanelBackdrop";
    backdrop.className = "visitors-panel-backdrop hidden";
    backdrop.setAttribute("data-oh-side-panel-backdrop", "");
    backdrop.innerHTML =
      "<aside id=\"linkedIdentityContextPanel\" class=\"visitors-side-panel identity-resolution-panel linked-identity-panel\" aria-labelledby=\"linkedIdentityContextPanelTitle\" aria-modal=\"true\" role=\"dialog\" data-oh-side-panel>" +
        "<header class=\"visitors-side-panel-header\" data-oh-side-panel-header>" +
          "<div><p class=\"oh-app-eyebrow\">Linked identity context</p><h2 id=\"linkedIdentityContextPanelTitle\" data-oh-side-panel-title>Linked Records</h2></div>" +
          "<button id=\"linkedIdentityContextPanelClose\" class=\"ghost\" type=\"button\" aria-label=\"Close linked identity context\" data-oh-side-panel-close>Close</button>" +
        "</header>" +
        "<div id=\"linkedIdentityContextPanelBody\" class=\"identity-resolution-panel-body linked-identity-panel-body\"></div>" +
      "</aside>";
    document.body.appendChild(backdrop);
  }
  if (!linkedIdentityPanelController) {
    linkedIdentityPanelController = createSidePanelController({
      backdrop: "linkedIdentityContextPanelBackdrop",
      panel: "linkedIdentityContextPanel",
      title: "linkedIdentityContextPanelTitle",
      closeTriggers: ["linkedIdentityContextPanelClose"]
    });
  }
  return linkedIdentityPanelController;
}

async function loadContextRows(sourceType, sourceRecordId) {
  const result = await supabaseClient.rpc("list_identity_context_for_source_record", {
    p_source_type: sourceType,
    p_source_record_id: String(sourceRecordId),
    p_include_revoked: false
  });
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

export async function openLinkedIdentityContextDetails(options, trigger) {
  const settings = options || {};
  if (!canViewLinkedIdentityContext() || !settings.sourceType || !settings.sourceRecordId) return;
  const controller = ensureLinkedIdentityPanel();
  const body = document.getElementById("linkedIdentityContextPanelBody");
  if (!body) return;
  body.replaceChildren();
  renderEmptyState(body, {
    title: "Loading linked records",
    description: "Checking confirmed identity link metadata for this source record."
  });
  controller.open({
    trigger,
    title: "Linked Records",
    initialFocus: "linkedIdentityContextPanelClose"
  });
  try {
    const rows = await enrichIdentityLinkRowsForDisplay(
      await loadContextRows(settings.sourceType, settings.sourceRecordId)
    );
    body.replaceChildren();
    body.classList.remove("oh-empty-state");
    const notice = document.createElement("div");
    notice.className = "assignment-editor-notice";
    notice.textContent = "Confirmed identity links are metadata only. Source records are not merged, rewritten, erased or used to update compliance automatically.";
    body.appendChild(notice);
    if (!rows.length) {
      renderEmptyState(body, {
        title: "No confirmed identity links",
        description: "No confirmed identity link metadata was found for this record."
      });
      return;
    }
    groupRowsByLink(rows).forEach(link => body.appendChild(createLinkCard(link, true)));
  } catch (error) {
    showToast("Linked identity context unavailable", error && error.message ? error.message : "Linked records could not be loaded.", "error");
    body.replaceChildren();
    renderEmptyState(body, {
      title: "Linked context unavailable",
      description: "The linked identity context could not be loaded under current permissions."
    });
  }
}

export function renderLinkedIdentityContext(target, options) {
  const host = typeof target === "string" ? document.getElementById(target) : target;
  const settings = options || {};
  if (!host) return null;
  host.replaceChildren();
  host.classList.add("linked-identity-context-host");
  if (!canViewLinkedIdentityContext() || !settings.sourceType || !settings.sourceRecordId) return null;

  const card = document.createElement("section");
  card.className = "linked-identity-context-card hidden";
  host.appendChild(card);

  supabaseClient.rpc("get_identity_context_summary_for_source_record", {
    p_source_type: settings.sourceType,
    p_source_record_id: String(settings.sourceRecordId),
    p_include_revoked: false
  }).then(result => {
    if (result.error) throw result.error;
    const summary = Array.isArray(result.data) ? result.data[0] : result.data;
    const activeCount = Number(summary && summary.active_link_count || 0);
    if (!activeCount) {
      if (settings.showEmpty) {
        card.classList.remove("hidden");
        card.classList.add("is-empty");
        card.textContent = "No confirmed identity links found for this record.";
      }
      return;
    }
    card.classList.remove("hidden");
    card.classList.add("is-compact");
    card.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "linked-identity-context-heading";
    const title = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = "Confirmed identity links found";
    const sub = document.createElement("span");
    sub.textContent = [
      summary.linked_record_count ? summary.linked_record_count + " linked record" + (Number(summary.linked_record_count) === 1 ? "" : "s") : ""
    ].filter(Boolean).join(" - ") || "This record has confirmed linked identity context.";
    title.append(label, sub);
    const badge = document.createElement("span");
    badge.className = "identity-resolution-badge confirmed";
    badge.textContent = activeCount + " reviewed link" + (activeCount === 1 ? "" : "s");
    heading.append(title, badge);

    const meta = document.createElement("dl");
    meta.className = "identity-resolution-meta-grid";
    meta.append(
      createMetaItem("Latest link", summary.latest_link_reference),
      createMetaItem("Linked records", summary.linked_record_count),
      createMetaItem("Latest link date", formatDate(summary.latest_link_created_at))
    );
    const sourceSummary = document.createElement("p");
    sourceSummary.className = "linked-identity-expanded-summary";
    sourceSummary.textContent = [
      summary.primary_canonical_label || settings.sourceLabel || "Linked records",
      summary.latest_link_reference ? "Link " + summary.latest_link_reference : ""
    ].filter(Boolean).join(" - ");

    const note = document.createElement("p");
    note.className = "linked-identity-readiness-note";
    note.textContent = settings.complianceNote
      ? (
        useIdentityLinksForDocumentCompliance()
          ? "Confirmed identity links may be used for compliance only when linked evidence satisfies the existing document and induction validity rules. Source records are not modified."
          : "Confirmed identity links are shown for context only. Compliance is not using identity links."
      )
      : "Source records are not modified by confirmed identity link metadata.";

    const actions = document.createElement("div");
    actions.className = "identity-resolution-card-actions";
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "secondary";
    expand.textContent = "Expand Linked Context";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "secondary";
    details.textContent = "View Linked Records";
    details.addEventListener("click", event => openLinkedIdentityContextDetails(settings, event.currentTarget));
    actions.append(expand, details);

    const compactDetails = document.createElement("div");
    compactDetails.className = "linked-identity-context-expanded hidden";
    const inlineRecords = document.createElement("div");
    inlineRecords.className = "linked-identity-context-inline-records";
    compactDetails.append(sourceSummary, meta, note, inlineRecords);
    let inlineRecordsLoaded = false;
    let inlineRecordsLoading = false;
    expand.addEventListener("click", async event => {
      const expanded = compactDetails.classList.toggle("hidden") === false;
      expand.textContent = expanded ? "Collapse Linked Context" : "Expand Linked Context";
      if (!expanded || inlineRecordsLoaded || inlineRecordsLoading) return;
      inlineRecordsLoading = true;
      inlineRecords.textContent = "Loading linked records...";
      try {
        const rows = await enrichIdentityLinkRowsForDisplay(
          await loadContextRows(settings.sourceType, settings.sourceRecordId)
        );
        inlineRecords.replaceChildren();
        groupRowsByLink(rows).forEach(link => inlineRecords.appendChild(createLinkCard(link, true)));
        inlineRecordsLoaded = true;
      } catch (error) {
        inlineRecords.textContent = "";
        showToast(
          "Linked identity context unavailable",
          error && error.message ? error.message : "Linked records could not be loaded.",
          "error"
        );
        event.currentTarget.focus({ preventScroll: true });
      } finally {
        inlineRecordsLoading = false;
      }
    });
    card.append(heading, actions, compactDetails);
  }).catch(() => {
    if (settings.showEmpty) {
      card.classList.remove("hidden");
      card.classList.add("is-empty");
      card.textContent = "Linked identity context is unavailable.";
    }
  });

  return card;
}

export async function getIdentityLinkDetailRows(linkId) {
  const result = await supabaseClient.rpc("get_identity_link_detail", {
    p_identity_link_id: linkId
  });
  if (result.error) throw result.error;
  return enrichIdentityLinkRowsForDisplay(Array.isArray(result.data) ? result.data : []);
}
