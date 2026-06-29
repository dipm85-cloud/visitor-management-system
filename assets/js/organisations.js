import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showOrganisationsWorkspace } from "./shell.js";
import { AppState } from "./state.js";
import {
  normaliseBusinessCode,
  titleCaseText
} from "./utils.js";

const ORGANISATION_COLUMNS = [
  "id",
  "organisation_code",
  "organisation_name",
  "organisation_type",
  "active",
  "notes",
  "created_at",
  "updated_at"
].join(", ");

let organisationsCache = [];
let selectedOrganisationId = null;

function hasOrganisationAccess() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role === "super_user"
  );
}

function requireOrganisationAccess() {
  if (hasOrganisationAccess()) return true;
  showToast("Access denied", "Organisations is currently available to SuperUsers only.", "error");
  return false;
}

function optionalValue(id) {
  const value = $(id).value.trim();
  return value || null;
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "-";
  return cell;
}

function setListStatus(message) {
  $("organisationListStatus").textContent = message;
}

function selectedOrganisation() {
  return organisationsCache.find(item => item.id === selectedOrganisationId) || null;
}

export async function openOrganisationsWorkspace() {
  if (!requireOrganisationAccess()) return;
  showOrganisationsWorkspace();
  closeOrganisationPanel();
  await loadOrganisations();
}

export async function loadOrganisations() {
  if (!requireOrganisationAccess()) return;

  setListStatus("Loading organisations...");
  $("organisationResults").replaceChildren();
  $("organisationEmptyState").classList.add("hidden");

  try {
    const result = await supabaseClient
      .from("organisations")
      .select(ORGANISATION_COLUMNS)
      .order("organisation_name", { ascending: true });

    if (result.error) throw result.error;

    organisationsCache = result.data || [];
    renderOrganisationList();
  } catch (err) {
    organisationsCache = [];
    renderOrganisationList();
    setListStatus("Organisations could not be loaded.");
    showToast("Organisations load failed", err.message || "Could not load organisations.", "error");
  }
}

export function renderOrganisationList() {
  const query = $("organisationSearch").value.trim().toLowerCase();
  const statusFilter = $("organisationStatusFilter").value;
  const filtered = organisationsCache.filter(organisation => {
    if (statusFilter === "active" && organisation.active === false) return false;
    if (statusFilter === "inactive" && organisation.active !== false) return false;
    if (!query) return true;
    return [
      organisation.organisation_name,
      organisation.organisation_code,
      organisation.organisation_type,
      organisation.notes,
      organisation.active ? "active" : "inactive"
    ].some(value => String(value || "").toLowerCase().includes(query));
  });

  const body = $("organisationResults");
  body.replaceChildren();

  filtered.forEach(organisation => {
    const row = document.createElement("tr");
    row.dataset.organisationId = organisation.id;
    row.classList.toggle("selected", organisation.id === selectedOrganisationId);
    row.appendChild(createCell(organisation.organisation_name));
    row.appendChild(createCell(organisation.organisation_code));
    row.appendChild(createCell(organisation.organisation_type));

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "people-status " + (organisation.active === false ? "inactive" : "active");
    status.textContent = organisation.active === false ? "Inactive" : "Active";
    statusCell.appendChild(status);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "organisation-row-action";

    const detailsButton = document.createElement("button");
    detailsButton.className = "ghost";
    detailsButton.type = "button";
    detailsButton.textContent = "Details";
    detailsButton.setAttribute("aria-label", "View details for " + organisation.organisation_name);
    detailsButton.addEventListener("click", () => selectOrganisation(organisation.id));
    actionCell.appendChild(detailsButton);

    const editButton = document.createElement("button");
    editButton.className = "ghost";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", "Edit " + organisation.organisation_name);
    editButton.addEventListener("click", () => openOrganisationPanel(organisation.id));
    actionCell.appendChild(editButton);
    row.appendChild(actionCell);

    body.appendChild(row);
  });

  $("organisationEmptyState").classList.toggle("hidden", filtered.length > 0);
  $("organisationEmptyState").textContent = query || statusFilter !== "all"
    ? "No organisations match the current filters."
    : "No organisation records yet. Create the first organisation to start the shared directory.";
  setListStatus(filtered.length + " of " + organisationsCache.length + " organisations shown.");
}

async function countRows(table, column, value) {
  const result = await supabaseClient
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);

  if (result.error) throw result.error;
  return result.count || 0;
}

async function loadAssignmentRelationshipCounts(organisationId) {
  const result = await supabaseClient
    .from("work_assignments")
    .select("person_id, site_id")
    .eq("employer_organisation_id", organisationId);

  if (result.error) throw result.error;
  const assignments = result.data || [];
  return {
    people: new Set(assignments.map(row => row.person_id).filter(Boolean)).size,
    sites: new Set(assignments.map(row => row.site_id).filter(Boolean)).size
  };
}

function setRelationshipValue(id, value) {
  $(id).textContent = value;
}

async function loadOrganisationRelationships(organisationId) {
  setRelationshipValue("organisationContractsCount", "Loading");
  setRelationshipValue("organisationPeopleCount", "Loading");
  setRelationshipValue("organisationSitesCount", "Loading");
  setRelationshipValue("organisationVisitorsCount", "Future");

  try {
    const [contractsCount, assignmentCounts] = await Promise.all([
      countRows("contracts", "customer_organisation_id", organisationId),
      loadAssignmentRelationshipCounts(organisationId)
    ]);

    setRelationshipValue("organisationContractsCount", String(contractsCount));
    setRelationshipValue("organisationPeopleCount", String(assignmentCounts.people));
    setRelationshipValue("organisationSitesCount", String(assignmentCounts.sites));
  } catch (err) {
    setRelationshipValue("organisationContractsCount", "-");
    setRelationshipValue("organisationPeopleCount", "-");
    setRelationshipValue("organisationSitesCount", "-");
    showToast("Relationship summary unavailable", err.message || "Could not load organisation relationships.", "error");
  }
}

export async function selectOrganisation(organisationId) {
  if (!requireOrganisationAccess()) return;

  selectedOrganisationId = organisationId;
  renderOrganisationList();

  const organisation = selectedOrganisation();
  if (!organisation) {
    $("organisationDetailEmpty").classList.remove("hidden");
    $("organisationDetailContent").classList.add("hidden");
    return;
  }

  $("organisationDetailEmpty").classList.add("hidden");
  $("organisationDetailContent").classList.remove("hidden");
  $("organisationDetailName").textContent = organisation.organisation_name || "-";
  $("organisationDetailCode").textContent = organisation.organisation_code || "-";
  $("organisationDetailType").textContent = organisation.organisation_type || "-";
  $("organisationDetailStatus").textContent = organisation.active === false ? "Inactive" : "Active";
  $("organisationDetailStatus").className = "people-status " + (organisation.active === false ? "inactive" : "active");
  $("organisationDetailNotes").textContent = organisation.notes || "No notes recorded.";

  await loadOrganisationRelationships(organisationId);
}

export function openOrganisationPanel(organisationId) {
  if (!requireOrganisationAccess()) return;

  clearOrganisationForm();
  const organisation = organisationsCache.find(item => item.id === organisationId);

  if (organisation) {
    $("organisationId").value = organisation.id;
    $("organisationName").value = organisation.organisation_name || "";
    $("organisationCode").value = organisation.organisation_code || "";
    $("organisationType").value = organisation.organisation_type || "";
    $("organisationActive").value = organisation.active === false ? "false" : "true";
    $("organisationNotes").value = organisation.notes || "";
    $("organisationPanelTitle").textContent = "Edit Organisation";
  }

  $("organisationPanel").classList.remove("hidden");
  $("organisationPanel").setAttribute("aria-hidden", "false");
  setTimeout(() => $("organisationName").focus({ preventScroll: true }), 0);
}

export function closeOrganisationPanel() {
  $("organisationPanel").classList.add("hidden");
  $("organisationPanel").setAttribute("aria-hidden", "true");
}

export function clearOrganisationForm() {
  $("organisationForm").reset();
  $("organisationId").value = "";
  $("organisationActive").value = "true";
  $("organisationPanelTitle").textContent = "Create Organisation";
}

export async function saveOrganisation() {
  if (!requireOrganisationAccess()) return;

  const organisationName = titleCaseText($("organisationName").value);
  const organisationCode = normaliseBusinessCode($("organisationCode").value);
  const organisationType = titleCaseText($("organisationType").value);

  if (!organisationName || !organisationType) {
    showToast(
      "Organisation not saved",
      !organisationName ? "Organisation Name is required." : "Organisation Type is required.",
      "error"
    );
    return;
  }

  $("organisationName").value = organisationName;
  $("organisationCode").value = organisationCode || "";
  $("organisationType").value = organisationType || "";

  const payload = {
    organisation_name: organisationName,
    organisation_code: organisationCode,
    organisation_type: organisationType,
    active: $("organisationActive").value === "true",
    notes: optionalValue("organisationNotes")
  };

  const organisationId = $("organisationId").value;
  const saveButton = $("organisationSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    let query = supabaseClient.from("organisations");
    query = organisationId
      ? query.update(payload).eq("id", organisationId)
      : query.insert(payload);

    const result = await query.select(ORGANISATION_COLUMNS).single();
    if (result.error) throw result.error;

    showToast(
      organisationId ? "Organisation updated" : "Organisation created",
      "The organisation record was saved successfully.",
      "success"
    );

    closeOrganisationPanel();
    await loadOrganisations();
    await selectOrganisation(result.data.id);
  } catch (err) {
    const duplicate = err && (
      err.code === "23505" ||
      /duplicate key|unique constraint|already exists/i.test(String(err.message || ""))
    );
    showToast(
      "Organisation not saved",
      duplicate
        ? "That Organisation Code is already in use."
        : (err.message || "Could not save this organisation."),
      "error"
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Organisation";
  }
}
