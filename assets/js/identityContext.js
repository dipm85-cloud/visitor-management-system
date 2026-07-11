import { supabaseClient } from "./api.js";
import { hasAnyCapability } from "./capabilities.js";
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
  privacy_cases: "Privacy Case",
  document_evidence: "Document Evidence",
  agreement_evidence: "Agreement Evidence",
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
    sign_in_time: "Sign in",
    sign_out_time: "Sign out",
    signed_at: "Signed",
    event_type: "Event type",
    evidence_type: "Evidence type"
  };
  return Object.entries(labels)
    .filter(([key]) => source[key] !== null && source[key] !== undefined && String(source[key]).trim())
    .map(([key, label]) => ({ label, value: /_time$|_at$/.test(key) ? formatDate(source[key]) : source[key] }));
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
  parent.appendChild(details);
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
    const recordHeading = document.createElement("h4");
    recordHeading.textContent = (record.is_requested_source ? "Current source" : "Linked record") + " " + (index + 1);
    const recordMeta = document.createElement("dl");
    recordMeta.className = "identity-resolution-meta-grid";
    recordMeta.append(
      createMetaItem("Source area", friendlyIdentitySourceType(record.linked_source_type || record.source_type)),
      createMetaItem("Source label", record.linked_source_label || record.source_label),
      createMetaItem("Linked", formatDate(record.linked_record_created_at || record.source_record_linked_at))
    );
    usefulSummaryFields(record.linked_source_summary || record.source_summary).forEach(field => {
      recordMeta.appendChild(createMetaItem(field.label, field.value));
    });
    block.append(recordHeading, recordMeta);
    appendTechnicalDetails(block, "Advanced / Technical Details", [
      { label: "Source type", value: record.linked_source_type || record.source_type },
      { label: "Source record ID", value: record.linked_source_record_id || record.source_record_id },
      { label: "Link record ID", value: record.link_record_id }
    ], record.linked_source_summary || record.source_summary);
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
    const rows = await loadContextRows(settings.sourceType, settings.sourceRecordId);
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
    card.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "linked-identity-context-heading";
    const title = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = "Confirmed identity link metadata";
    const sub = document.createElement("span");
    sub.textContent = textOrDash(summary.primary_canonical_label || settings.sourceLabel || "Linked records");
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
    const details = document.createElement("button");
    details.type = "button";
    details.className = "secondary";
    details.textContent = "View Linked Records";
    details.addEventListener("click", event => openLinkedIdentityContextDetails(settings, event.currentTarget));
    actions.appendChild(details);
    card.append(heading, meta, note, actions);
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
  return Array.isArray(result.data) ? result.data : [];
}
