document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.getElementById("menuToggle");
    const mainNav = document.getElementById("mainNav");
    const currentYear = document.getElementById("currentYear");
    const backToTop = document.getElementById("backToTop");

    if (currentYear) {
        currentYear.textContent = String(new Date().getFullYear());
    }

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
            if (window.innerWidth > 900) closeMenu();
        });
    }

    const updateBackToTop = () => {
        if (backToTop) {
            backToTop.classList.toggle("visible", window.scrollY > 400);
        }
    };

    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();

    if (backToTop) {
        backToTop.addEventListener("click", (event) => {
            event.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth"
            });
        });
    }
});
