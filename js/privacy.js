document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.getElementById("menuToggle");
    const mainNav = document.getElementById("mainNav");
    const currentYear = document.getElementById("currentYear");
    const backToTop = document.getElementById("backToTop");
    const searchInput = document.getElementById("privacySearch");
    const searchStatus = document.getElementById("privacySearchStatus");
    const searchResults = document.getElementById("privacySearchResults");
    const clearSearch = document.getElementById("clearPrivacySearch");
    const printButton = document.getElementById("printPolicy");
    const contents = document.getElementById("privacyContents");
    const sections = Array.from(document.querySelectorAll("[data-privacy-section]"));
    const contentsLinks = Array.from(document.querySelectorAll(".privacy-toc-list a"));
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (currentYear) currentYear.textContent = String(new Date().getFullYear());
    if (contents) contents.open = window.innerWidth > 900;

    const closeMenu = () => {
        if (!menuToggle || !mainNav) return;
        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation menu");
        document.body.classList.remove("menu-open");
    };

    if (menuToggle && mainNav) {
        menuToggle.addEventListener("click", () => {
            const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
            menuToggle.setAttribute("aria-expanded", String(!isOpen));
            menuToggle.setAttribute(
                "aria-label",
                isOpen ? "Open navigation menu" : "Close navigation menu"
            );
            mainNav.classList.toggle("open", !isOpen);
            document.body.classList.toggle("menu-open", !isOpen);
        });

        mainNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeMenu();
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 1024) closeMenu();
            if (contents) contents.open = window.innerWidth > 900;
        });
    }

    const scrollToSection = (section) => {
        if (!section) return;
        section.scrollIntoView({
            behavior: prefersReducedMotion.matches ? "auto" : "smooth",
            block: "start"
        });
    };

    contentsLinks.forEach((link) => {
        link.addEventListener("click", () => {
            if (window.innerWidth <= 900 && contents) contents.open = false;
        });
    });

    if (sections.length && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                contentsLinks.forEach((link) => {
                    const active = link.getAttribute("href") === "#" + entry.target.id;
                    link.classList.toggle("is-active", active);
                    if (active) link.setAttribute("aria-current", "location");
                    else link.removeAttribute("aria-current");
                });
            });
        }, { rootMargin: "-12% 0px -72% 0px", threshold: 0 });
        sections.forEach((section) => observer.observe(section));
    }

    const clearMatches = () => {
        sections.forEach((section) => {
            section.classList.remove("is-search-match", "is-search-current");
        });
        searchResults.replaceChildren();
    };

    const searchPolicy = () => {
        const query = searchInput.value.trim().toLocaleLowerCase();
        clearMatches();
        clearSearch.hidden = !query;

        if (!query) {
            searchStatus.textContent = "";
            return;
        }

        const matches = sections.filter((section) =>
            section.textContent.toLocaleLowerCase().includes(query)
        );
        if (!matches.length) {
            searchStatus.textContent = "No matching sections found.";
            return;
        }

        searchStatus.textContent = matches.length + (matches.length === 1
            ? " matching section found."
            : " matching sections found.");

        matches.forEach((section, index) => {
            section.classList.add("is-search-match");
            const heading = section.querySelector("h2");
            const link = document.createElement("a");
            link.href = "#" + section.id;
            link.textContent = heading
                ? heading.textContent.replace(/^\s*\d+\s*/, "").trim()
                : "Matching section";
            link.addEventListener("click", (event) => {
                event.preventDefault();
                sections.forEach((item) => item.classList.remove("is-search-current"));
                section.classList.add("is-search-current");
                scrollToSection(section);
                if (window.innerWidth <= 900 && contents) contents.open = false;
            });
            const item = document.createElement("li");
            item.append(link);
            searchResults.append(item);
            if (index === 0) section.classList.add("is-search-current");
        });
    };

    if (searchInput) searchInput.addEventListener("input", searchPolicy);

    if (clearSearch) {
        clearSearch.addEventListener("click", () => {
            searchInput.value = "";
            searchPolicy();
            searchInput.focus();
        });
    }

    if (printButton) printButton.addEventListener("click", () => window.print());

    const updateBackToTop = () => {
        if (backToTop) backToTop.classList.toggle("visible", window.scrollY > 400);
    };

    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();

    if (backToTop) {
        backToTop.addEventListener("click", (event) => {
            event.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: prefersReducedMotion.matches ? "auto" : "smooth"
            });
        });
    }
});
