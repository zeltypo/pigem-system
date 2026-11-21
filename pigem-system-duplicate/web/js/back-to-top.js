(function () {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-red back-to-top";
  button.setAttribute("aria-label", "Back to top");
  button.title = "Back to top";
  button.textContent = "↑";
  if (document.currentScript.hasAttribute("data-phone-only")) {
    button.classList.add("back-to-top-phone-only");
  }

  function updateVisibility() {
    button.hidden = window.scrollY < 240;
  }

  button.addEventListener("click", function () {
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
  });
  updateVisibility();
  document.body.appendChild(button);
  window.addEventListener("scroll", updateVisibility, { passive: true });
  window.addEventListener("pageshow", updateVisibility);
}());
