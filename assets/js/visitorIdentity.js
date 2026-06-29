import { supabaseClient } from "./api.js";
import { $ } from "./dom.js";
import { showToast } from "./messages.js";
import { formatPersonName, safe } from "./utils.js";

const PERSON_COLUMNS = "id, external_person_number, first_name, last_name, preferred_name, display_name, email, phone, active";
const ORGANISATION_COLUMNS = "id, organisation_code, organisation_name, organisation_type, email, phone, active";

const lookupState = {};

function normaliseSearch(value) {
  return String(value || "").trim();
}

function splitPersonName(value) {
  const displayName = formatPersonName(value);
  const parts = displayName.split(" ").filter(Boolean);
  return {
    firstName: parts[0] || displayName,
    lastName: parts.slice(1).join(" ") || null,
    displayName
  };
}

function clearList(list) {
  if (!list) return;
  list.replaceChildren();
  list.classList.add("hidden");
}

function setStatus(state, message) {
  if (!state.status) return;
  state.status.textContent = message || "";
}

function describePerson(person) {
  return [
    person.external_person_number,
    person.email,
    person.phone
  ].filter(Boolean).join(" | ");
}

function describeOrganisation(organisation) {
  return [
    organisation.organisation_code,
    organisation.organisation_type,
    organisation.email,
    organisation.phone
  ].filter(Boolean).join(" | ");
}

function personSearchFilter(query) {
  const safeQuery = query.replace(/[%(),]/g, "");
  return [
    "display_name.ilike.%" + safeQuery + "%",
    "external_person_number.ilike.%" + safeQuery + "%",
    "email.ilike.%" + safeQuery + "%",
    "phone.ilike.%" + safeQuery + "%"
  ].join(",");
}

function organisationSearchFilter(query) {
  const safeQuery = query.replace(/[%(),]/g, "");
  return [
    "organisation_name.ilike.%" + safeQuery + "%",
    "organisation_code.ilike.%" + safeQuery + "%",
    "email.ilike.%" + safeQuery + "%",
    "phone.ilike.%" + safeQuery + "%"
  ].join(",");
}

async function searchPeople(query) {
  const result = await supabaseClient
    .from("people")
    .select(PERSON_COLUMNS)
    .eq("active", true)
    .or(personSearchFilter(query))
    .order("display_name", { ascending: true })
    .limit(8);

  if (result.error) throw result.error;
  return result.data || [];
}

async function searchOrganisations(query) {
  const result = await supabaseClient
    .from("organisations")
    .select(ORGANISATION_COLUMNS)
    .eq("active", true)
    .or(organisationSearchFilter(query))
    .order("organisation_name", { ascending: true })
    .limit(8);

  if (result.error) throw result.error;
  return result.data || [];
}

function createResultButton(primary, secondary, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "identity-lookup-result";

  const title = document.createElement("span");
  title.className = "identity-lookup-title";
  title.textContent = primary;
  button.appendChild(title);

  if (secondary) {
    const meta = document.createElement("span");
    meta.className = "identity-lookup-meta";
    meta.textContent = secondary;
    button.appendChild(meta);
  }

  button.addEventListener("click", onSelect);
  return button;
}

function renderPersonResults(state, rows, query) {
  state.list.replaceChildren();

  rows.forEach(person => {
    state.list.appendChild(createResultButton(person.display_name, describePerson(person), () => {
      state.selectedId.value = person.id;
      state.input.value = person.display_name;
      setStatus(state, "Linked to Person: " + person.display_name);
      clearList(state.list);
    }));
  });

  const exactMatch = rows.some(person => String(person.display_name || "").toLowerCase() === query.toLowerCase());
  if (query && !exactMatch) {
    const createButton = createResultButton("Create new person", query, async () => {
      await createPersonFromLookup(state, query);
    });
    createButton.classList.add("identity-lookup-create");
    state.list.appendChild(createButton);
  }

  state.list.classList.toggle("hidden", state.list.childElementCount === 0);
}

function renderOrganisationResults(state, rows, query) {
  state.list.replaceChildren();

  rows.forEach(organisation => {
    state.list.appendChild(createResultButton(organisation.organisation_name, describeOrganisation(organisation), () => {
      state.selectedId.value = organisation.id;
      state.input.value = organisation.organisation_name;
      setStatus(state, "Selected Organisation: " + organisation.organisation_name);
      clearList(state.list);
    }));
  });

  if (query) {
    const keepTyped = createResultButton("Use typed company", query, () => {
      state.selectedId.value = "";
      state.input.value = query;
      setStatus(state, "Company will be saved as text. Organisation can be created later.");
      clearList(state.list);
    });
    keepTyped.classList.add("identity-lookup-create");
    state.list.appendChild(keepTyped);
  }

  state.list.classList.toggle("hidden", state.list.childElementCount === 0);
}

async function createPersonFromLookup(state, query) {
  const parsed = splitPersonName(query);
  if (!parsed.displayName) return;

  try {
    const result = await supabaseClient
      .from("people")
      .insert({
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        display_name: parsed.displayName,
        active: true,
        notes: "Created from planned visit lookup."
      })
      .select(PERSON_COLUMNS)
      .single();

    if (result.error) throw result.error;

    state.selectedId.value = result.data.id;
    state.input.value = result.data.display_name;
    setStatus(state, "Created and linked to Person: " + result.data.display_name);
    clearList(state.list);
    showToast("Person created", result.data.display_name + " is now available in People.", "success");
  } catch (err) {
    state.selectedId.value = "";
    state.input.value = parsed.displayName;
    setStatus(state, "Person could not be created. The typed visitor name will still be saved.");
    clearList(state.list);
    showToast("Person not created", err.message || "The typed visitor name will still be saved.", "info");
  }
}

function bindLookup(config) {
  const state = {
    input: $(config.inputId),
    selectedId: $(config.selectedId),
    list: $(config.listId),
    status: $(config.statusId),
    kind: config.kind,
    timer: null
  };

  if (!state.input || !state.selectedId || !state.list) return;
  lookupState[config.inputId] = state;

  state.input.setAttribute("autocomplete", "off");
  state.input.setAttribute("aria-autocomplete", "list");
  state.input.setAttribute("aria-controls", config.listId);

  state.input.addEventListener("input", () => {
    state.selectedId.value = "";
    setStatus(state, "");
    window.clearTimeout(state.timer);

    const query = normaliseSearch(state.input.value);
    if (query.length < 2) {
      clearList(state.list);
      return;
    }

    state.timer = window.setTimeout(async () => {
      try {
        const rows = state.kind === "person"
          ? await searchPeople(query)
          : await searchOrganisations(query);

        if (state.kind === "person") renderPersonResults(state, rows, query);
        else renderOrganisationResults(state, rows, query);
      } catch (err) {
        clearList(state.list);
        setStatus(state, state.kind === "person"
          ? "Person lookup unavailable. The typed visitor name will still be saved."
          : "Organisation lookup unavailable. The typed company will still be saved.");
        console.warn("Visitor identity lookup unavailable:", err);
      }
    }, 200);
  });

  state.input.addEventListener("blur", () => {
    window.setTimeout(() => clearList(state.list), 180);
  });
}

export function initialiseVisitorIdentityLookups() {
  bindLookup({
    inputId: "plannedName",
    selectedId: "plannedPersonId",
    listId: "plannedPersonLookupResults",
    statusId: "plannedPersonLookupStatus",
    kind: "person"
  });
  bindLookup({
    inputId: "plannedCompany",
    selectedId: "plannedOrganisationId",
    listId: "plannedOrganisationLookupResults",
    statusId: "plannedOrganisationLookupStatus",
    kind: "organisation"
  });
  bindLookup({
    inputId: "editVisitorName",
    selectedId: "editPersonId",
    listId: "editPersonLookupResults",
    statusId: "editPersonLookupStatus",
    kind: "person"
  });
  bindLookup({
    inputId: "editCompany",
    selectedId: "editOrganisationId",
    listId: "editOrganisationLookupResults",
    statusId: "editOrganisationLookupStatus",
    kind: "organisation"
  });
}

export function resetVisitorIdentitySelection(scope) {
  const ids = scope === "edit"
    ? ["editPersonId", "editOrganisationId"]
    : ["plannedPersonId", "plannedOrganisationId"];
  const lists = scope === "edit"
    ? ["editPersonLookupResults", "editOrganisationLookupResults"]
    : ["plannedPersonLookupResults", "plannedOrganisationLookupResults"];

  ids.forEach(id => {
    if ($(id)) $(id).value = "";
  });

  lists.forEach(id => {
    if ($(id)) clearList($(id));
  });

  [
    scope === "edit" ? "editPersonLookupStatus" : "plannedPersonLookupStatus",
    scope === "edit" ? "editOrganisationLookupStatus" : "plannedOrganisationLookupStatus"
  ].forEach(id => {
    if ($(id)) $(id).textContent = "";
  });
}

export function visitorDisplayName(record) {
  return safe(record && (record.person_display_name || record.display_name || record.visitor_name));
}
