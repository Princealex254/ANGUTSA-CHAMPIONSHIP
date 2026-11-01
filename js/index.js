
// =========================================
// ANGUTSA CHAMPIONSHIP — HOMEPAGE BEHAVIOUR
// =========================================

document.addEventListener("DOMContentLoaded", async () => {
    const liveData = await window.AngutsaDataReady;
    const menuToggle = document.getElementById("menuToggle");
    const mainNav = document.getElementById("mainNav");
    const backToTop = document.getElementById("backToTop");
    const currentYear = document.getElementById("currentYear");
    const tournamentGrid = document.getElementById("tournamentGrid");
    const heroSlides = Array.from(document.querySelectorAll(".hero-slide"));
    const heroSlideshowToggle = document.querySelector(".hero-slideshow-toggle");

    if (heroSlides.length > 1 && heroSlideshowToggle) {
        const reducedMotion = window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let slideshowPaused = Boolean(reducedMotion);
        let activeSlideIndex = 0;
        let slideshowTimer;

        const updateSlideshow = () => {
            heroSlides.forEach((slide, index) => {
                slide.classList.toggle("is-active", index === activeSlideIndex);
            });
        };

        const advanceSlideshow = () => {
            activeSlideIndex = (activeSlideIndex + 1) % heroSlides.length;
            updateSlideshow();
        };

        const setSlideshowPaused = (paused) => {
            slideshowPaused = paused;
            heroSlideshowToggle.setAttribute("aria-pressed", String(paused));
            heroSlideshowToggle.setAttribute(
                "aria-label",
                paused ? "Play background photos" : "Pause background photos"
            );
            heroSlideshowToggle.textContent = paused ? "Play photos" : "Pause photos";

            if (paused) {
                window.clearInterval(slideshowTimer);
            } else {
                window.clearInterval(slideshowTimer);
                slideshowTimer = window.setInterval(advanceSlideshow, 6000);
            }
        };

        heroSlideshowToggle.addEventListener("click", () => {
            setSlideshowPaused(!slideshowPaused);
        });
        setSlideshowPaused(slideshowPaused);
    }

    // Automatically update the copyright year.
    if (currentYear) {
        currentYear.textContent = new Date().getFullYear();
    }

    if (tournamentGrid && liveData) {
        const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const longMonths = ["January", "February", "March", "April", "May", "June", "July",
            "August", "September", "October", "November", "December"];
        const toDate = (value) => {
            if (!value) return null;
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
            const date = match
                ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
                : new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        };
        const formatDate = (value) => {
            const date = toDate(value);
            return date
                ? `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
                : "Date to be announced";
        };
        const formatDateRange = (from, to) => {
            const start = toDate(from);
            const end = toDate(to);
            if (!start && !end) return "Dates to be announced";
            if (start && !end) return formatDate(start);
            if (!start && end) return formatDate(end);
            if (start.getFullYear() === end.getFullYear()) {
                if (start.getMonth() === end.getMonth()) {
                    return `${start.getDate()} - ${end.getDate()} ${longMonths[start.getMonth()]} ${start.getFullYear()}`;
                }
                return `${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
            }
            return `${formatDate(start)} - ${formatDate(end)}`;
        };
        const upcomingTournaments = (liveData.tournaments || [])
            .filter((tournament) =>
                tournament.status === "upcoming" || tournament.status === "registration-open"
            )
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, 3);

        if (!upcomingTournaments.length) {
            tournamentGrid.innerHTML =
                '<div class="tournament-empty-state" role="status">' +
                    "<p>No upcoming tournaments are available right now.</p>" +
                    '<a class="btn btn-dark-outline btn-sm" href="/tournaments/">Browse all tournaments</a>' +
                "</div>";
        } else {
            tournamentGrid.innerHTML = upcomingTournaments.map((tournament) => {
            const escapeHTML = (value) => String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
            const slug = encodeURIComponent(tournament.slug);
            const registered = tournament.teamsRegistered || 0;
            const progress = tournament.teamLimit
                ? Math.min(Math.round((registered / tournament.teamLimit) * 100), 100)
                : 0;
            const progressTone = progress >= 100 ? "is-green" : progress >= 60 ? "is-gold" : "";
            const feeText = tournament.entryFee === 0
                ? "No fee"
                : `KES ${Number(tournament.entryFee).toLocaleString("en-KE")}`;
            const registrationOpen = tournament.status === "registration-open";

            return `
                <article class="card tournament-card">
                    <div class="tournament-card-media">
                        ${tournament.banner ? `<img src="${escapeHTML(tournament.banner)}" alt="" loading="lazy">` : ""}
                        <div class="media-top">
                            <span class="category-pill">${escapeHTML(tournament.categoryLabel)}</span>
                            <span class="status-badge ${registrationOpen ? "status-open" : "status-upcoming"}">${registrationOpen ? "Registration Open" : "Coming Soon"}</span>
                        </div>
                        <div class="media-bottom">
                            <span>Season ${escapeHTML(tournament.season)}</span>
                            <strong>${escapeHTML(tournament.formatLabel)}</strong>
                        </div>
                    </div>
                    <div class="card-body">
                        <h3 class="tournament-title"><a href="/tournament-details/?slug=${slug}">${escapeHTML(tournament.name)}</a></h3>
                        <p class="tournament-summary">${escapeHTML(tournament.overview)}</p>
                        <div class="meta-list is-compact">
                            <div><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/></svg><span>${formatDateRange(tournament.startDate, tournament.endDate)}</span></div>
                            <div><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg><span>${escapeHTML(tournament.venue)}${tournament.location ? `, ${escapeHTML(tournament.location)}` : ""}</span></div>
                            <div><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4v3h6V4M9 12h6M9 16h4"/></svg><span>Registration closes ${formatDate(tournament.registrationCloses)}</span></div>
                            <div><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16.5 14.5h1.5"/></svg><span>Entry fee ${feeText}</span></div>
                        </div>
                        ${tournament.teamLimit ? `
                            <div class="registration-progress">
                                <div class="progress-meta"><span>Teams registered</span><strong>${registered} / ${tournament.teamLimit}</strong></div>
                                <div class="progress-track"><div class="progress-fill ${progressTone}" style="width:${progress}%"></div></div>
                            </div>` : ""}
                        <div class="card-actions">
                            <a class="btn btn-dark-outline btn-sm" href="/tournament-details/?slug=${slug}">View Details</a>
                            ${registrationOpen
                                ? `<a class="btn btn-primary btn-sm" href="/team-registration/?tournament=${slug}">Register Team</a>`
                                : '<button type="button" class="btn btn-dark-outline btn-sm" disabled title="Registration has not opened yet">Registration not open</button>'}
                        </div>
                    </div>
                </article>`;
            }).join("");
        }
    }

    // Mobile navigation.
    function closeMenu() {
        if (!menuToggle || !mainNav) return;

        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation menu");
        document.body.classList.remove("menu-open");
    }

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

        // Close the menu when a navigation link is selected.
        mainNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });

        // Close the menu when Escape is pressed.
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        });

        // Reset the menu when moving back to desktop width.
        window.addEventListener("resize", () => {
            if (window.innerWidth > 900) {
                closeMenu();
            }
        });
    }

    // Back-to-top button.
    function updateBackToTop() {
        if (!backToTop) return;

        backToTop.classList.toggle("visible", window.scrollY > 400);
    }

    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();

    if (backToTop) {
        backToTop.addEventListener("click", (event) => {
            event.preventDefault();

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }

    // Smooth scrolling for in-page links.
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
            const targetId = link.getAttribute("href");

            if (!targetId || targetId === "#") return;

            const target = document.querySelector(targetId);

            if (target) {
                event.preventDefault();

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        });
    });
});
