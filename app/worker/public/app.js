(() => {
  "use strict";
  for (const button of document.querySelectorAll("[data-copy-target]")) {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.getAttribute("data-copy-target") || "");
      if (!target) return;
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText((target.textContent || "").trim());
        button.textContent = "copied";
      } catch {
        button.textContent = "select it";
      }
      setTimeout(() => { button.textContent = original; }, 1800);
    });
  }
})();
