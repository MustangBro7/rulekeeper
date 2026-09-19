(() => {
  "use strict";

  const nav = document.querySelector("nav");
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");

  if (nav) {
    const setScrolled = () => nav.classList.toggle("scrolled", window.scrollY > 8);
    setScrolled();
    window.addEventListener("scroll", setScrolled, { passive: true });
  }

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  const reveals = document.querySelectorAll(".reveal");
  if (typeof IntersectionObserver === "function" && reveals.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    reveals.forEach((element) => observer.observe(element));
  } else {
    reveals.forEach((element) => element.classList.add("in"));
  }

  const status = document.querySelector(".copy-status");
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const text = button.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "copied";
      } catch {
        button.textContent = "select it";
      }
      if (status) status.textContent = `${text} copied to clipboard`;
      setTimeout(() => { button.textContent = "copy"; }, 1800);
    });
  }

  const form = document.querySelector("[data-waitlist-endpoint]");
  const waitlistStatus = document.querySelector(".waitlist-status");
  if (form instanceof HTMLFormElement) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = form.querySelector("input[type=email]");
      const submit = form.querySelector("button[type=submit]");
      if (!(input instanceof HTMLInputElement) || !waitlistStatus) return;

      const setStatus = (message, ok) => {
        waitlistStatus.textContent = message;
        waitlistStatus.className = `waitlist-status ${ok ? "ok" : "err"}`;
      };

      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      try {
        const response = await fetch(form.getAttribute("data-waitlist-endpoint") || "/api/waitlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: input.value.trim() }),
        });
        if (response.ok) {
          setStatus("you're on the list — we'll be in touch.", true);
          form.reset();
        } else {
          const body = await response.json().catch(() => ({}));
          setStatus(body.error || "that didn't work. try again?", false);
        }
      } catch {
        setStatus("network error. try again?", false);
      } finally {
        if (submit instanceof HTMLButtonElement) submit.disabled = false;
      }
    });
  }
})();
