import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { showPeopleWorkspace } from "./shell.js";
import { AppState } from "./state.js";
import {
  detachAssignmentInlinePlacement,
  getSelectedAssignmentPersonId,
  selectPersonForAssignments,
  syncAssignmentInlinePlacement
} from "./assignments.js";
import {
  normaliseEmail,
  titleCaseText
} from "./utils.js";

const PERSON_COLUMNS = [
  "id",
  "external_person_number",
  "first_name",
  "last_name",
  "preferred_name",
  "display_name",
  "email",
  "phone",
  "active",
  "notes",
  "created_at",
  "updated_at"
].join(", ");

let peopleCache = [];

function hasPeopleAccess() {
  return !!(
    AppState.currentProfile &&
    AppState.currentProfile.active &&
    AppState.currentProfile.role === "super_user"
  );
}

function requirePeopleAccess() {
  if (hasPeopleAccess()) return true;
  showToast("Access denied", "People is currently available to SuperUsers only.", "error");
  return false;
}

function optionalValue(id) {
  const value = $(id).value.trim();
  return value || null;
}

function setListStatus(message) {
  $("peopleListStatus").textContent = message;
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

export async function openPeopleWorkspace() {
  if (!requirePeopleAccess()) return;
  showPeopleWorkspace();
  closePeoplePanel();
  await loadPeople();
}

export async function loadPeople() {
  if (!requirePeopleAccess()) return;

  setListStatus("Loading people…");
  $("peopleResults").replaceChildren();
  $("peopleEmptyState").classList.add("hidden");

  try {
    const result = await supabaseClient
      .from("people")
      .select(PERSON_COLUMNS)
      .order("display_name", { ascending: true });

    if (result.error) throw result.error;

    peopleCache = result.data || [];
    renderPeopleList();
  } catch (err) {
    peopleCache = [];
    renderPeopleList();
    setListStatus("People could not be loaded.");
    showToast("People load failed", err.message || "Could not load people.", "error");
  }
}

export function renderPeopleList() {
  const query = $("peopleSearch").value.trim().toLowerCase();
  const filtered = peopleCache.filter(person => {
    if (!query) return true;
    return [
      person.external_person_number,
      person.first_name,
      person.last_name,
      person.preferred_name,
      person.display_name,
      person.email,
      person.phone
    ].some(value => String(value || "").toLowerCase().includes(query));
  });

  const body = $("peopleResults");
  detachAssignmentInlinePlacement();
  body.replaceChildren();

  filtered.forEach(person => {
    const row = document.createElement("tr");
    row.dataset.personId = person.id;
    row.classList.toggle("selected", person.id === getSelectedAssignmentPersonId());
    row.appendChild(createCell(person.display_name));
    row.appendChild(createCell(person.external_person_number));

    const contact = [person.email, person.phone].filter(Boolean).join(" · ");
    row.appendChild(createCell(contact));

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "people-status " + (person.active ? "active" : "inactive");
    status.textContent = person.active ? "Active" : "Inactive";
    statusCell.appendChild(status);
    row.appendChild(statusCell);

    const actionCell = document.createElement("td");
    actionCell.className = "people-row-action";

    const assignmentsButton = document.createElement("button");
    assignmentsButton.className = "ghost";
    assignmentsButton.type = "button";
    assignmentsButton.textContent = "Assignments";
    assignmentsButton.setAttribute("aria-label", "View assignments for " + person.display_name);
    assignmentsButton.addEventListener("click", () => {
      selectPersonForAssignments(person.id, person.display_name);
    });
    actionCell.appendChild(assignmentsButton);

    const editButton = document.createElement("button");
    editButton.className = "ghost";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", "Edit " + person.display_name);
    editButton.addEventListener("click", () => {
      openPeoplePanel(person.id);
    });
    actionCell.appendChild(editButton);
    row.appendChild(actionCell);

    body.appendChild(row);
  });

  $("peopleEmptyState").classList.toggle("hidden", filtered.length > 0);
  $("peopleEmptyState").textContent = query
    ? "No people match this search. Try a different name, number, email or phone."
    : "No people records yet. Create the first person to start the shared directory.";
  setListStatus(filtered.length + " of " + peopleCache.length + " people shown.");
  syncAssignmentInlinePlacement();
}

export function openPeoplePanel(personId) {
  if (!requirePeopleAccess()) return;

  clearPersonForm();
  const person = peopleCache.find(item => item.id === personId);

  if (person) {
    $("personId").value = person.id;
    $("personExternalNumber").value = person.external_person_number || "";
    $("personFirstName").value = person.first_name || "";
    $("personLastName").value = person.last_name || "";
    $("personPreferredName").value = person.preferred_name || "";
    $("personDisplayName").value = person.display_name || "";
    $("personEmail").value = person.email || "";
    $("personPhone").value = person.phone || "";
    $("personActive").value = person.active === false ? "false" : "true";
    $("personNotes").value = person.notes || "";
    $("peoplePanelTitle").textContent = "Edit Person";
  }

  $("peoplePanel").classList.remove("hidden");
  $("peoplePanel").setAttribute("aria-hidden", "false");
  setTimeout(() => $("personFirstName").focus(), 0);
}

export function closePeoplePanel() {
  $("peoplePanel").classList.add("hidden");
  $("peoplePanel").setAttribute("aria-hidden", "true");
}

export function clearPersonForm() {
  $("peopleForm").reset();
  $("personId").value = "";
  $("personActive").value = "true";
  $("peoplePanelTitle").textContent = "Create Person";
}

export async function savePerson() {
  if (!requirePeopleAccess()) return;

  const firstName = titleCaseText($("personFirstName").value);
  const lastName = titleCaseText($("personLastName").value);
  const preferredName = titleCaseText($("personPreferredName").value);
  const displayName = titleCaseText($("personDisplayName").value);
  const email = normaliseEmail($("personEmail").value);
  const emailInput = $("personEmail");

  if (!firstName || !displayName) {
    showToast("Person not saved", "First Name and Display Name are required.", "error");
    return;
  }

  if (emailInput.value.trim() && !emailInput.validity.valid) {
    showToast("Person not saved", "Enter a valid email address.", "error");
    return;
  }

  $("personFirstName").value = firstName;
  $("personLastName").value = lastName;
  $("personPreferredName").value = preferredName;
  $("personDisplayName").value = displayName;
  $("personEmail").value = email || "";

  const payload = {
    external_person_number: optionalValue("personExternalNumber"),
    first_name: firstName,
    last_name: lastName || null,
    preferred_name: preferredName || null,
    display_name: displayName,
    email,
    phone: optionalValue("personPhone"),
    active: $("personActive").value === "true",
    notes: optionalValue("personNotes")
  };

  const personId = $("personId").value;
  const saveButton = $("peopleSaveButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  try {
    let query = supabaseClient.from("people");
    query = personId
      ? query.update(payload).eq("id", personId)
      : query.insert(payload);

    const result = await query.select(PERSON_COLUMNS).single();
    if (result.error) throw result.error;

    showToast(
      personId ? "Person updated" : "Person created",
      "The person record was saved successfully.",
      "success"
    );
    closePeoplePanel();
    await loadPeople();
  } catch (err) {
    const duplicate = err && (
      err.code === "23505" ||
      /duplicate key|unique constraint|already exists/i.test(String(err.message || ""))
    );
    showToast(
      "Person not saved",
      duplicate
        ? "That External Person Number is already in use."
        : (err.message || "Could not save this person."),
      "error"
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Person";
  }
}
