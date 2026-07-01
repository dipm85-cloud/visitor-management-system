import { $ } from "./dom.js";

function reportSearchText(card) {
  const title = card.querySelector("h3");
  const description = card.querySelector("p");
  const module = card.querySelector(".report-card-module");
  return [
    title ? title.textContent : "",
    description ? description.textContent : "",
    module ? module.textContent : ""
  ].join(" ").toLowerCase();
}

export function filterReportCards() {
  const search = $("reportSearch");
  if (!search) return;

  const query = search.value.trim().toLowerCase();
  const cards = Array.from(document.querySelectorAll("[data-report-card]"));
  let visibleCount = 0;

  cards.forEach(card => {
    const visible = !query || reportSearchText(card).includes(query);
    card.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });

  document.querySelectorAll("[data-report-group]").forEach(group => {
    const hasVisibleCard = Array.from(group.querySelectorAll("[data-report-card]"))
      .some(card => !card.classList.contains("hidden"));
    group.classList.toggle("hidden", !hasVisibleCard);
  });

  $("reportingEmptyState").classList.toggle("hidden", visibleCount > 0);
  $("reportSearchStatus").textContent = query
    ? visibleCount + " of " + cards.length + " reports shown."
    : "All " + cards.length + " report cards shown.";
}

export function initialiseReportingCentre() {
  const search = $("reportSearch");
  if (!search || search.dataset.reportingInitialised === "true") return;

  search.dataset.reportingInitialised = "true";
  search.addEventListener("input", filterReportCards);

  document.querySelectorAll("[data-report-shortcut]").forEach(button => {
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("oh:report-shortcut-requested", {
        detail: {
          shortcut: button.dataset.reportShortcut
        }
      }));
    });
  });

  window.addEventListener("oh:reporting-opened", () => {
    filterReportCards();
    setTimeout(() => search.focus({ preventScroll: true }), 0);
  });

  filterReportCards();
}
