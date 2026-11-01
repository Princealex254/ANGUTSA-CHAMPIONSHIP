/* =========================================================
   ANGUTSA CHAMPIONSHIP — SHARED FRONTEND RUNTIME (common.js)
   ---------------------------------------------------------
   Loaded by every page after js/data.js. Provides DOM and
   formatting helpers, the shared inline SVG icon set, header
   behaviour, toasts, dialogs, tabs, sortable tables, filters,
   pagination and shared lookups.

   No authentication, payment, email or database logic lives
   here. Data always comes from `window.AngutsaData`, which the
   backend will eventually populate from real API responses.
   ========================================================= */

window.Angutsa = (function () {
    "use strict";

    /* -------------------------
       DOM helpers
       ------------------------- */

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function on(target, event, handler, options) {
        if (target) target.addEventListener(event, handler, options);
    }

    function create(tag, className, html) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function debounce(fn, wait) {
        var timer;
        return function () {
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(null, args);
            }, wait || 220);
        };
    }

    function slugify(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function normalise(value) {
        return String(value || "").trim().toLowerCase();
    }

    /* -------------------------
       Formatting helpers
       ------------------------- */

    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"];

    function toDate(value) {
        if (window.AngutsaEAT) return window.AngutsaEAT.toDate(value);
        if (!value) return null;
        if (value instanceof Date) return value;

        var text = String(value);

        /* Date-only values (YYYY-MM-DD) are treated as LOCAL dates.
           Parsing them with `new Date()` would treat them as UTC
           midnight, which displays as the previous day for visitors
           west of UTC. */
        var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (dateOnly) {
            return new Date(
                parseInt(dateOnly[1], 10),
                parseInt(dateOnly[2], 10) - 1,
                parseInt(dateOnly[3], 10)
            );
        }

        var parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function dateParts(date) {
        if (window.AngutsaEAT) return window.AngutsaEAT.parts(date);
        return {
            year: date.getFullYear(),
            month: date.getMonth(),
            day: date.getDate(),
            weekday: date.getDay(),
            hour: date.getHours(),
            minute: date.getMinutes()
        };
    }

    function formatDate(value) {
        var date = toDate(value);
        if (!date) return "Date to be announced";
        var parts = dateParts(date);
        return DAYS[parts.weekday] + " " + parts.day + " " +
            MONTHS[parts.month] + " " + parts.year;
    }

    function formatDateShort(value) {
        var date = toDate(value);
        if (!date) return "TBA";
        var parts = dateParts(date);
        return parts.day + " " + MONTHS[parts.month];
    }

    function formatDateRange(from, to) {
        var start = toDate(from);
        var end = toDate(to);
        if (!start && !end) return "Dates to be announced";
        if (start && !end) return formatDate(start);
        if (!start && end) return formatDate(end);
        var startParts = dateParts(start);
        var endParts = dateParts(end);
        if (startParts.year === endParts.year) {
            if (startParts.month === endParts.month) {
                return startParts.day + " - " + endParts.day + " " +
                    MONTHS_LONG[startParts.month] + " " + startParts.year;
            }
            return startParts.day + " " + MONTHS[startParts.month] + " - " +
                endParts.day + " " + MONTHS[endParts.month] + " " + endParts.year;
        }
        return formatDate(start) + " - " + formatDate(end);
    }

    function formatTime(value) {
        var date = toDate(value);
        if (!date) return "TBA";
        var parts = dateParts(date);
        var hours = parts.hour;
        var minutes = parts.minute;
        var suffix = hours >= 12 ? "PM" : "AM";
        var display = hours % 12 === 0 ? 12 : hours % 12;
        return display + ":" + (minutes < 10 ? "0" + minutes : minutes) + " " + suffix;
    }

    function formatDateTime(value) {
        var date = toDate(value);
        if (!date) return "Not available";
        return formatDate(date) + ", " + formatTime(date);
    }

    function relativeTime(value) {
        var date = toDate(value);
        if (!date) return "";
        var minutes = Math.round((Date.now() - date.getTime()) / 60000);
        if (Math.abs(minutes) < 1) return "Just now";
        if (Math.abs(minutes) < 60) return minutes + (minutes > 0 ? " min ago" : " min ahead");
        var hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24) return hours + (hours > 0 ? " hours ago" : " hours ahead");
        var days = Math.round(hours / 24);
        if (Math.abs(days) < 30) return days + (days > 0 ? " days ago" : " days ahead");
        return formatDate(date);
    }

    function formatMoney(amount, currency) {
        if (amount === null || amount === undefined || amount === "") return "Not configured";
        var meta = (window.AngutsaData && window.AngutsaData.meta) || {};
        var code = currency || meta.currency || "KES";
        var value = Number(amount);
        if (isNaN(value)) return "Not configured";
        if (value === 0) return "No fee";
        return code + " " + value.toLocaleString("en-KE");
    }

    function initials(name) {
        var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function pluralise(count, singular, plural) {
        return count + " " + (count === 1 ? singular : (plural || singular + "s"));
    }

    /* -------------------------
       Data access (live platform data)
       ------------------------- */

    function records(key) {
        var data = window.AngutsaData || {};
        return Array.isArray(data[key]) ? data[key] : [];
    }

    function findById(key, id) {
        if (!id) return null;
        var list = records(key);
        for (var i = 0; i < list.length; i += 1) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function findBySlug(key, slug) {
        var list = records(key);
        for (var i = 0; i < list.length; i += 1) {
            if (list[i].slug === slug) return list[i];
        }
        return null;
    }

    function tournamentById(id) { return findById("tournaments", id); }
    function categoryById(id) { return findById("categories", id); }
    function teamById(id) { return findById("teams", id); }
    function playerById(id) { return findById("players", id); }
    function matchById(id) { return findById("matches", id); }

    function teamName(id) {
        var team = teamById(id);
        return team ? team.name : "To be confirmed";
    }

    function categoryName(id) {
        var category = categoryById(id);
        return category ? category.name : "Category to be confirmed";
    }

    /* Public player name: minors only ever show their initials. */
    function publicPlayerName(player) {
        if (!player) return "Player";
        if (player.publicProfile === "hidden") return "Player details restricted";
        if (player.publicProfile === "initials-only") return initials(player.name);
        return player.name;
    }

    /* Filters a match list by tournament, category, group and status. */
    function filterMatches(list, filters) {
        var options = filters || {};
        return (list || []).filter(function (match) {
            if (options.tournamentId && match.tournamentId !== options.tournamentId) return false;
            if (options.categoryId && match.categoryId !== options.categoryId) return false;
            if (options.group && match.group !== options.group) return false;
            if (options.round && match.round !== options.round) return false;
            if (options.stage && match.stage !== options.stage) return false;
            if (options.status && match.status !== options.status) return false;
            if (options.teamId && match.homeTeamId !== options.teamId && match.awayTeamId !== options.teamId) return false;
            if (options.from && toDate(match.kickoff) && toDate(match.kickoff) < toDate(options.from)) return false;
            if (options.to && toDate(match.kickoff) && toDate(match.kickoff) > toDate(options.to)) return false;
            return true;
        });
    }

    function isStandingsMatch(match) {
        var stage = String(match && match.stage || "").toLowerCase()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return !stage || /^(group|league|round-robin)(-|$)/.test(stage);
    }

    function sortMatchesByKickoff(list, direction) {
        var factor = direction === "desc" ? -1 : 1;
        return (list || []).slice().sort(function (a, b) {
            var left = toDate(a.kickoff) ? toDate(a.kickoff).getTime() : 0;
            var right = toDate(b.kickoff) ? toDate(b.kickoff).getTime() : 0;
            return (left - right) * factor;
        });
    }

    /* -------------------------
       Inline SVG icon set
       Stroke-based, 24x24 grid, currentColor so every icon
       inherits the surrounding text colour.
       ------------------------- */

    var ICONS = {
        search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
        pin: '<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
        trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M6 5H4v2a3 3 0 0 0 3 3M18 5h2v2a3 3 0 0 1-3 3M10 17h4l1 4H9z"/>',
        users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2-4.2"/>',
        player: '<path d="M8 4 5 6.5 3.5 10l3 1.5.5-1.5V20h10V10l.5 1.5 3-1.5L19 6.5 16 4l-4 2.5z"/>',
        whistle: '<path d="M14 8h5a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4h-3"/><circle cx="7.5" cy="12" r="4.5"/><path d="M12 8V5"/>',
        flag: '<path d="M5 3v18M5 4h12l-2 4 2 4H5z"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>',
        arrow: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
        close: '<path d="M6 6 18 18M18 6 6 18"/>',
        check: '<path d="m5 13 4 4L19 7"/>',
        checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
        alert: '<path d="M12 4l8.5 15H3.5z"/><path d="M12 10v4M12 16.5h.01"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.5 2 5.5 2 5.5H4.5s2-1 2-5.5"/><path d="M10 19a2 2 0 0 0 4 0"/>',
        clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4v3h6V4M9 12h6M9 16h4"/>',
        filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
        sort: '<path d="M7 4v16M4 8l3-4 3 4M17 20V4M14 16l3 4 3-4"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 5l4 4"/>',
        trash: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/>',
        eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
        download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
        upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
        share: '<path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v6h14v-6"/>',
        print: '<path d="M7 8V3.5h10V8M6 8h12v8H6zM9 16h6v4.5H9z"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
        grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
        list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
        shield: '<path d="M12 3.5 5.5 6v6c0 4 2.8 7.4 6.5 8.5 3.7-1.1 6.5-4.5 6.5-8.5V6z"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
        lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
        phone: '<path d="M6 3.5h4l1.5 4-2 1.5a10 10 0 0 0 5 5L16 12l4 1.5v4a2 2 0 0 1-2 2A15 15 0 0 1 4 5.5a2 2 0 0 1 2-2z"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        home: '<path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M5.1 7.5l1.9 1.1M17 15.4l1.9 1.1M5.1 16.5l1.9-1.1M17 8.6l1.9-1.1"/>',
        logout: '<path d="M15 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9M13 12h8m0 0-3-3m3 3-3 3"/>',
        wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16.5 14.5h1.5"/>',
        star: '<path d="m12 4 2.4 5 5.6.7-4 3.9 1 5.4-5-2.8-5 2.8 1-5.4-4-3.9 5.6-.7z"/>',
        document: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4M9 12h6M9 16h6"/>',
        book: '<path d="M4 5.5A2 2 0 0 1 6 4h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 19.5V5.5M9 8h6"/>'
    };

    function icon(name, className) {
        var path = ICONS[name] || ICONS.info;
        return '<svg class="' + (className || "icon") + '" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + "</svg>";
    }

    /* -------------------------
       Shared markup helpers
       ------------------------- */

    /* Teams and players have no real badge images in this phase, so
       the interface renders a consistent monogram crest instead of a
       broken image. When real logos arrive the same helper accepts a
       `logo` URL and returns an <img>. */
    function crestMarkup(entity, size) {
        var name = entity && entity.name ? entity.name : "Team";
        var accent = (entity && entity.accent) || "#5B4BBD";
        var className = "crest" + (size ? " crest-" + size : "");
        if (entity && entity.logo) {
            return '<span class="' + className + '"><img src="' + escapeHtml(entity.logo) +
                '" alt="' + escapeHtml(name) + ' badge" loading="lazy"></span>';
        }
        return '<span class="' + className + '" style="--crest-accent:' + escapeHtml(accent) + '" ' +
            'aria-hidden="true">' + escapeHtml(entity && entity.shortName ? entity.shortName : initials(name)) + "</span>";
    }

    function playerToneMarkup(player, size) {
        var label = publicPlayerName(player);
        var className = "crest crest-player" + (size ? " crest-" + size : "");
        return '<span class="' + className + '" aria-hidden="true">' + escapeHtml(initials(player && player.name ? player.name : label)) + "</span>";
    }

    /* Maps a record status onto a shared badge class. */
    var STATUS_CLASS = {
        "registration-open": "status-open",
        open: "status-open",
        upcoming: "status-upcoming",
        upcoming_soon: "status-upcoming",
        ongoing: "status-ongoing",
        live: "status-live",
        completed: "status-completed",
        closed: "status-closed",
        cancelled: "status-cancelled",
        postponed: "status-postponed",
        abandoned: "status-abandoned",
        draft: "status-draft",
        published: "status-published",
        pending: "status-pending",
        approved: "status-approved",
        rejected: "status-rejected",
        successful: "status-successful",
        failed: "status-failed",
        active: "status-approved",
        suspended: "status-rejected",
        archived: "status-archived",
        scheduled: "status-upcoming"
    };

    function statusClass(status) {
        return STATUS_CLASS[status] || "status-neutral";
    }

    function statusBadge(status, label) {
        return '<span class="status-badge ' + statusClass(status) + '">' +
            escapeHtml(label || status) + "</span>";
    }

    function tournamentStatusLabel(status) {
        var labels = {
            "registration-open": "Registration Open",
            upcoming: "Coming Soon",
            active: "In Progress",
            ongoing: "In Progress",
            completed: "Completed",
            draft: "Draft",
            closed: "Registration Closed"
        };
        return labels[status] || "Status not set";
    }

    function matchStatusLabel(status) {
        var labels = {
            scheduled: "Scheduled",
            completed: "Full Time",
            postponed: "Postponed",
            cancelled: "Cancelled",
            abandoned: "Abandoned",
            live: "Live"
        };
        return labels[status] || "Status not set";
    }

    function matchWinnerTeamId(match) {
        if (!match) return null;
        if (match.homeScore > match.awayScore) return match.homeTeamId || null;
        if (match.awayScore > match.homeScore) return match.awayTeamId || null;
        if (match.tieBreakMethod === "extra-time" &&
            match.homeExtraTimeScore !== null && match.homeExtraTimeScore !== undefined &&
            match.awayExtraTimeScore !== null && match.awayExtraTimeScore !== undefined &&
            match.homeExtraTimeScore !== match.awayExtraTimeScore) {
            return match.homeExtraTimeScore > match.awayExtraTimeScore
                ? match.homeTeamId || null : match.awayTeamId || null;
        }
        if (match.tieBreakMethod === "penalties" &&
            match.homePenaltiesScore !== null && match.homePenaltiesScore !== undefined &&
            match.awayPenaltiesScore !== null && match.awayPenaltiesScore !== undefined &&
            match.homePenaltiesScore !== match.awayPenaltiesScore) {
            return match.homePenaltiesScore > match.awayPenaltiesScore
                ? match.homeTeamId || null : match.awayTeamId || null;
        }
        return null;
    }

    function emptyState(options) {
        var settings = options || {};
        var actions = "";
        if (settings.actionLabel) {
            actions = '<div class="btn-row">' +
                (settings.actionHref
                    ? '<a class="btn btn-primary btn-sm" href="' + escapeHtml(settings.actionHref) + '">' + escapeHtml(settings.actionLabel) + "</a>"
                    : '<button type="button" class="btn btn-primary btn-sm" data-empty-action>' + escapeHtml(settings.actionLabel) + "</button>") +
                (settings.secondaryLabel && settings.secondaryHref
                    ? '<a class="btn btn-dark-outline btn-sm" href="' + escapeHtml(settings.secondaryHref) + '">' + escapeHtml(settings.secondaryLabel) + "</a>"
                    : "") +
                "</div>";
        }
        return '<div class="empty-state">' +
            '<span class="empty-state-icon">' + icon(settings.icon || "search") + "</span>" +
            "<h3>" + escapeHtml(settings.title || "Nothing to show yet") + "</h3>" +
            "<p>" + escapeHtml(settings.message || "No records match the current filters.") + "</p>" +
            actions +
            "</div>";
    }

    function skeletonCards(count) {
        var output = "";
        for (var i = 0; i < (count || 3); i += 1) {
            output += '<div class="skeleton skeleton-card" aria-hidden="true"></div>';
        }
        return output;
    }

    function loadingState(message) {
        return '<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>' +
            escapeHtml(message || "Loading records") + "</div>";
    }

    function liveDataNotice() {
        return '<div class="notice-bar" role="note">' + icon("info") +
            "<span>Published competition information on this page is loaded from the live database.</span>" +
            "</div>";
    }

    /* -------------------------
       Toasts
       ------------------------- */

    function toastRegion() {
        var region = $(".toast-region");
        if (!region) {
            region = create("div", "toast-region");
            region.setAttribute("aria-live", "polite");
            region.setAttribute("aria-atomic", "false");
            document.body.appendChild(region);
        }
        return region;
    }

    function toast(message, type) {
        var tone = type || "info";
        var icons = { success: "checkCircle", info: "info", warning: "alert", error: "alert" };
        var node = create("div", "toast toast-" + tone);
        node.setAttribute("role", tone === "error" ? "alert" : "status");
        node.innerHTML = icon(icons[tone] || "info") +
            "<span>" + escapeHtml(message) + "</span>" +
            '<button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>';

        var region = toastRegion();
        region.appendChild(node);

        function dismiss() {
            node.classList.add("is-leaving");
            setTimeout(function () {
                if (node.parentNode) node.parentNode.removeChild(node);
            }, 220);
        }

        on($(".toast-close", node), "click", dismiss);
        setTimeout(dismiss, tone === "error" ? 10000 : 6000);
        return node;
    }

    /* -------------------------
       Modals and confirmation dialogs
       ------------------------- */

    var openModals = [];

    function lastFocused() {
        return document.activeElement;
    }

    function openModal(target, options) {
        var node = typeof target === "string" ? $(target) : target;
        if (!node) return null;
        var settings = options || {};

        node.hidden = false;
        node.classList.add("is-open");
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-modal", "true");
        document.body.classList.add("modal-open");
        openModals.push({ node: node, restore: lastFocused() });

        var focusTarget = $("[data-autofocus]", node) || $("button, [href], input, select, textarea", node);
        if (focusTarget) focusTarget.focus();

        function onKeydown(event) {
            if (event.key === "Escape" && settings.dismissible !== false) {
                event.preventDefault();
                closeModal(node);
            }
        }

        on(node, "keydown", onKeydown);
        on(node, "click", function (event) {
            if (event.target === node && settings.dismissible !== false) closeModal(node);
        });

        $$("[data-modal-close]", node).forEach(function (button) {
            on(button, "click", function () {
                closeModal(node);
            });
        });

        return node;
    }

    function closeModal(target) {
        var node = typeof target === "string" ? $(target) : target;
        if (!node) return;

        var index = -1;
        openModals.forEach(function (entry, position) {
            if (entry.node === node) index = position;
        });
        var entry = index > -1 ? openModals.splice(index, 1)[0] : null;

        node.classList.remove("is-open");
        node.hidden = true;

        if (node.hasAttribute("data-remove-on-close") && node.parentNode) {
            node.parentNode.removeChild(node);
        }

        if (!openModals.length) {
            document.body.classList.remove("modal-open");
        }

        if (entry && entry.restore && typeof entry.restore.focus === "function") {
            entry.restore.focus();
        }
    }

    /* Promise-based confirmation dialog used before destructive or
       irreversible actions. Interface only: the backend must still
       authorise every action. */
    function confirmDialog(options) {
        var settings = options || {};
        return new Promise(function (resolve) {
            var node = create("div", "modal");
            node.setAttribute("data-remove-on-close", "");
            node.hidden = true;
            node.innerHTML =
                '<div class="modal-dialog">' +
                    '<div class="modal-header">' +
                        "<div><h3>" + escapeHtml(settings.title || "Confirm action") + "</h3>" +
                        "<p>" + escapeHtml(settings.message || "Please confirm that you want to continue.") + "</p></div>" +
                        '<button type="button" class="modal-close" data-modal-close aria-label="Close dialog">&times;</button>' +
                    "</div>" +
                    (settings.details
                        ? '<div class="modal-body"><p>' + escapeHtml(settings.details) + "</p></div>"
                        : "") +
                    '<div class="modal-footer">' +
                        '<button type="button" class="btn btn-dark-outline btn-sm" data-modal-close>' +
                            escapeHtml(settings.cancelLabel || "Cancel") + "</button>" +
                        '<button type="button" class="btn ' +
                            (settings.danger ? "btn-danger" : "btn-primary") +
                            ' btn-sm" data-confirm data-autofocus>' +
                            escapeHtml(settings.confirmLabel || "Confirm") + "</button>" +
                    "</div>" +
                "</div>";

            document.body.appendChild(node);
            openModal(node);

            function finish(result) {
                closeModal(node);
                setTimeout(function () {
                    if (node.parentNode) node.parentNode.removeChild(node);
                }, 0);
                resolve(result);
            }

            $$("[data-modal-close]", node).forEach(function (button) {
                on(button, "click", function () { finish(false); });
            });

            on($("[data-confirm]", node), "click", function () { finish(true); });

            on(node, "keydown", function (event) {
                if (event.key === "Escape") finish(false);
            });
        });
    }

    /* -------------------------
       Tabs
       ------------------------- */

    /* Expects a container with data-tab-group containing controls
       with data-tab="key" and panels with data-tab-panel="key". */
    function initTabs(root) {
        $$("[data-tab-group]", root || document).forEach(function (group) {
            var tabs = $$("[data-tab]", group);
            var panels = $$("[data-tab-panel]", group);

            function activate(key) {
                tabs.forEach(function (tab) {
                    var isActive = tab.getAttribute("data-tab") === key;
                    tab.classList.toggle("is-active", isActive);
                    tab.setAttribute("aria-selected", String(isActive));
                    tab.setAttribute("tabindex", isActive ? "0" : "-1");
                });
                panels.forEach(function (panel) {
                    panel.hidden = panel.getAttribute("data-tab-panel") !== key;
                });
                group.dispatchEvent(new CustomEvent("tabchange", { detail: { tab: key } }));
            }

            tabs.forEach(function (tab) {
                on(tab, "click", function () {
                    activate(tab.getAttribute("data-tab"));
                });
                on(tab, "keydown", function (event) {
                    var current = tabs.indexOf(tab);
                    var next = -1;
                    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
                    if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
                    if (event.key === "Home") next = 0;
                    if (event.key === "End") next = tabs.length - 1;
                    if (next > -1) {
                        event.preventDefault();
                        activate(tabs[next].getAttribute("data-tab"));
                        tabs[next].focus();
                    }
                });
            });

            var initial = tabs.filter(function (tab) {
                return tab.classList.contains("is-active");
            })[0] || tabs[0];
            if (initial) activate(initial.getAttribute("data-tab"));
        });
    }

    /* -------------------------
       Sortable tables
       ------------------------- */

    function sortValue(cell) {
        var raw = cell.getAttribute("data-sort-value");
        if (raw !== null) {
            var numeric = parseFloat(raw);
            return isNaN(numeric) ? raw.toLowerCase() : numeric;
        }
        var text = cell.textContent.trim();
        var maybeNumber = parseFloat(text.replace(/,/g, ""));
        if (!isNaN(maybeNumber) && /^[-\d.,\s%]+$/.test(text)) return maybeNumber;
        var maybeDate = toDate(text);
        if (maybeDate && /\d{4}/.test(text)) return maybeDate.getTime();
        return text.toLowerCase();
    }

    function initSortableTables(root) {
        $$("[data-sortable]", root || document).forEach(function (table) {
            $$("th[data-sort-key]", table).forEach(function (header) {
                var label = header.getAttribute("data-sort-label") || header.textContent.trim();
                var button = create("button", "table-sort", label);
                button.type = "button";
                header.textContent = "";
                header.appendChild(button);

                on(button, "click", function () {
                    var body = $("tbody", table);
                    if (!body) return;
                    var index = $$("th[data-sort-key]", table).indexOf(header);
                    var descending = header.getAttribute("aria-sort") === "ascending";

                    $$("th[data-sort-key]", table).forEach(function (other) {
                        other.removeAttribute("aria-sort");
                    });
                    header.setAttribute("aria-sort", descending ? "descending" : "ascending");

                    var rows = $$("tr", body).filter(function (row) {
                        return $("td", row);
                    });
                    rows.sort(function (a, b) {
                        var left = sortValue($$("td", a)[index]);
                        var right = sortValue($$("td", b)[index]);
                        if (left < right) return descending ? 1 : -1;
                        if (left > right) return descending ? -1 : 1;
                        return 0;
                    });
                    rows.forEach(function (row) {
                        body.appendChild(row);
                    });
                });
            });
        });
    }

    /* -------------------------
       Filters, search and pagination
       ------------------------- */

    /* Reads every [data-filter] control inside a scope into an object. */
    function readFilters(scope) {
        var values = {};
        $$("[data-filter]", scope || document).forEach(function (control) {
            var key = control.getAttribute("data-filter");
            if (control.type === "checkbox") {
                values[key] = control.checked;
            } else if (control.type === "radio") {
                if (control.checked) values[key] = control.value;
            } else {
                values[key] = control.value;
            }
        });
        return values;
    }

    /* Binds change/input handlers, debouncing free-text inputs. */
    function bindFilters(scope, handler) {
        var root = scope || document;
        var inputs = $$("[data-filter]", root);

        inputs.forEach(function (control) {
            var isText = control.tagName === "INPUT" &&
                (control.type === "search" || control.type === "text");
            on(control, isText ? "input" : "change", isText ? debounce(handler, 200) : handler);
        });

        $$("[data-filter-reset]", root).forEach(function (button) {
            on(button, "click", function () {
                inputs.forEach(function (control) {
                    if (control.type === "checkbox" || control.type === "radio") {
                        control.checked = control.defaultChecked;
                    } else {
                        control.value = control.defaultValue || "";
                    }
                });
                handler();
            });
        });
    }

    function matchesQuery(record, query, fields) {
        var term = normalise(query);
        if (!term) return true;
        var haystack = (fields || []).map(function (field) {
            var value = record[field];
            return value === null || value === undefined ? "" : String(value);
        }).join(" ").toLowerCase();
        return haystack.indexOf(term) > -1;
    }

    function paginate(items, page, perPage) {
        var size = perPage || 9;
        var total = items.length;
        var pages = Math.max(1, Math.ceil(total / size));
        var current = Math.min(Math.max(1, page || 1), pages);
        var start = (current - 1) * size;
        return {
            items: items.slice(start, start + size),
            page: current,
            pages: pages,
            total: total,
            from: total ? start + 1 : 0,
            to: Math.min(start + size, total)
        };
    }

    /* Renders numbered pagination into a container. */
    function renderPagination(container, state, onChange) {
        if (!container) return;

        if (state.pages <= 1) {
            container.innerHTML = '<p class="pagination-info">Showing all ' +
                pluralise(state.total, "record") + "</p>";
            return;
        }

        var output = '<button type="button" class="pagination-btn" data-page="' +
            (state.page - 1) + '"' + (state.page === 1 ? " disabled" : "") +
            ' aria-label="Previous page">&larr;</button>';

        for (var page = 1; page <= state.pages; page += 1) {
            if (page === 1 || page === state.pages || Math.abs(page - state.page) <= 1) {
                output += '<button type="button" class="pagination-btn" data-page="' + page + '"' +
                    (page === state.page ? ' aria-current="page"' : "") + ">" + page + "</button>";
            } else if (Math.abs(page - state.page) === 2) {
                output += '<span class="pagination-info">&hellip;</span>';
            }
        }

        output += '<button type="button" class="pagination-btn" data-page="' + (state.page + 1) + '"' +
            (state.page === state.pages ? " disabled" : "") + ' aria-label="Next page">&rarr;</button>';

        container.innerHTML = '<div class="pagination-wrap"><p class="pagination-info">Showing <strong>' +
            state.from + "&ndash;" + state.to + "</strong> of <strong>" + state.total + "</strong></p>" +
            '<div class="pagination">' + output + "</div></div>";

        $$("[data-page]", container).forEach(function (button) {
            on(button, "click", function () {
                var next = parseInt(button.getAttribute("data-page"), 10);
                if (!isNaN(next) && next >= 1 && next <= state.pages) {
                    onChange(next);
                }
            });
        });
    }

    /* Select helpers: fills a <select> from the shared data. */
    function fillSelect(select, items, options) {
        if (!select) return;
        var settings = options || {};
        var current = select.value || settings.selected || "";
        var html = settings.placeholder
            ? '<option value="">' + escapeHtml(settings.placeholder) + "</option>"
            : "";

        (items || []).forEach(function (item) {
            var value = settings.value ? settings.value(item) : item.id;
            var label = settings.label ? settings.label(item) : item.name;
            html += '<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + "</option>";
        });

        select.innerHTML = html;
        if (current) select.value = current;
    }

    /* -------------------------
       Local preferences (presentation only)
       ------------------------- */

    /* Safe for harmless interface preferences: view mode, filters,
       collapsed sidebar. Never store passwords, tokens or personal data. */
    function setPref(key, value) {
        try {
            window.localStorage.setItem("angutsa." + key, JSON.stringify(value));
        } catch (error) {
            /* storage unavailable: preferences simply do not persist */
        }
    }

    function getPref(key, fallback) {
        try {
            var raw = window.localStorage.getItem("angutsa." + key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    }

    function getParam(name) {
        return new URLSearchParams(window.location.search).get(name) || "";
    }

    /* -------------------------
       Standings calculation (review only)
       ------------------------- */

    /* Builds the table from completed matches. The calculation itself lives
       in js/standings-engine.js so every page ranks teams identically. */
    function computeStandings(list, teams, options) {
        var settings = options || {};
        var squad = (teams || records("teams")).filter(function (team) {
            if (settings.categoryId && team.categoryId !== settings.categoryId) return false;
            var teamGroup = settings.tournamentId && team.groupByTournament
                ? team.groupByTournament[settings.tournamentId] || ""
                : team.group;
            if (settings.group && teamGroup !== settings.group) return false;
            if (settings.tournamentId &&
                (!Array.isArray(team.tournamentIds) || team.tournamentIds.indexOf(settings.tournamentId) === -1)) {
                return false;
            }
            return true;
        });

        var finished = (list || []).filter(function (match) {
            return match.status === "completed" && isStandingsMatch(match);
        }).map(function (match) {
            return {
                homeId: match.homeTeamId, awayId: match.awayTeamId,
                homeScore: match.homeScore, awayScore: match.awayScore
            };
        });

        return window.AngutsaStandings.build(squad, finished);
    }

    /* Renders the last five results as accessible form indicators. */
    function formMarkup(form) {
        var recent = (form || []).slice(-5);
        if (!recent.length) return '<span class="form-empty">No results yet</span>';
        return '<span class="form-row">' + recent.map(function (result) {
            var tone = result === "W" ? "is-win" : (result === "D" ? "is-draw" : "is-loss");
            var label = result === "W" ? "Won" : (result === "D" ? "Drawn" : "Lost");
            return '<span class="form-dot ' + tone + '" title="' + label + '">' + result + "</span>";
        }).join("") + "</span>";
    }

    /* -------------------------
       Header, navigation and shell behaviour
       ------------------------- */

    function routeName(path) {
        var parts = String(path || "").split(/[?#]/)[0].split("/").filter(Boolean);
        return parts[parts.length - 1] || "/";
    }

    function currentPage() {
        return routeName(window.location.pathname);
    }

    /* Highlights the navigation entry matching the current file so
       every page gets a correct active state automatically. */
    function markActiveNav() {
        var page = currentPage();

        $$(".main-nav a[href]").forEach(function (link) {
            var href = link.getAttribute("href");
            if (!href || href.indexOf("#") === 0) return;
            var isActive = routeName(href) === page;

            link.classList.toggle("active", isActive);
            if (isActive) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }

            var group = link.closest(".nav-group");
            if (group && isActive) {
                var toggle = $(".nav-dropdown-toggle", group);
                if (toggle) toggle.classList.add("active");
            }
        });

        $$(".side-link[href]").forEach(function (link) {
            var isActive = routeName(link.getAttribute("href")) === page;
            link.classList.toggle("active", isActive);
            if (isActive) link.setAttribute("aria-current", "page");
        });
    }

    function initHeader() {
        var menuToggle = $("#menuToggle");
        var mainNav = $("#mainNav");

        function closeMenu() {
            if (!menuToggle || !mainNav) return;
            mainNav.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", "Open navigation menu");
            document.body.classList.remove("menu-open");
        }

        if (menuToggle && mainNav) {
            on(menuToggle, "click", function () {
                var isOpen = menuToggle.getAttribute("aria-expanded") === "true";
                menuToggle.setAttribute("aria-expanded", String(!isOpen));
                menuToggle.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
                mainNav.classList.toggle("open", !isOpen);
                document.body.classList.toggle("menu-open", !isOpen);
            });

            $$(".main-nav a", document).forEach(function (link) {
                on(link, "click", closeMenu);
            });

            on(document, "keydown", function (event) {
                if (event.key === "Escape") closeMenu();
            });

            on(window, "resize", debounce(function () {
                if (window.innerWidth > 1024) closeMenu();
            }, 150));
        }

        /* Dropdown groups: click support for touch and keyboard users.
           Hover and focus-within states are handled in CSS. */
        $$(".nav-group").forEach(function (group) {
            var toggle = $(".nav-dropdown-toggle", group);
            if (!toggle) return;

            on(toggle, "click", function (event) {
                event.preventDefault();
                var isOpen = group.classList.toggle("is-open");
                toggle.setAttribute("aria-expanded", String(isOpen));
            });

            on(group, "focusout", function (event) {
                if (!group.contains(event.relatedTarget)) {
                    group.classList.remove("is-open");
                    toggle.setAttribute("aria-expanded", "false");
                }
            });
        });

        on(document, "click", function (event) {
            if (!event.target.closest(".nav-group")) {
                $$(".nav-group").forEach(function (group) {
                    group.classList.remove("is-open");
                    var toggle = $(".nav-dropdown-toggle", group);
                    if (toggle) toggle.setAttribute("aria-expanded", "false");
                });
            }
            if (!event.target.closest(".menu-anchor")) {
                $$(".menu.is-open").forEach(function (menu) {
                    menu.classList.remove("is-open");
                });
            }
        });

        /* Generic dropdown menus: [data-menu-toggle="menuId"] */
        $$("[data-menu-toggle]").forEach(function (button) {
            on(button, "click", function (event) {
                event.preventDefault();
                var menu = $("#" + button.getAttribute("data-menu-toggle"));
                if (!menu) return;
                var isOpen = menu.classList.toggle("is-open");
                button.setAttribute("aria-expanded", String(isOpen));
            });
        });

        /* Dashboard shell: collapses on desktop, becomes a drawer on
           small screens. */
        var shell = $(".app-shell");
        if (shell) {
            var collapse = $("[data-sidebar-collapse]");
            var scrim = $(".app-scrim");

            on(collapse, "click", function () {
                var collapsed = shell.classList.toggle("is-collapsed");
                setPref("sidebarCollapsed", collapsed);
                collapse.setAttribute("aria-expanded", String(!collapsed));
            });

            if (getPref("sidebarCollapsed", false) && window.innerWidth > 1024) {
                shell.classList.add("is-collapsed");
            }

            $$("[data-sidebar-toggle]").forEach(function (button) {
                on(button, "click", function () {
                    shell.classList.toggle("is-drawer-open");
                });
            });

            on(scrim, "click", function () {
                shell.classList.remove("is-drawer-open");
            });

            $$(".app-sidebar a").forEach(function (link) {
                on(link, "click", function () {
                    shell.classList.remove("is-drawer-open");
                });
            });
        }

        markActiveNav();
    }

    function initBackToTop() {
        var button = $("#backToTop");
        if (!button) return;

        function update() {
            button.classList.toggle("visible", window.scrollY > 400);
        }

        on(window, "scroll", update, { passive: true });
        update();

        on(button, "click", function (event) {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    /* Share controls: native share sheet when available, otherwise copy
       the page address and confirm with a toast. */
    function initShare() {
        $$("[data-share]").forEach(function (button) {
            on(button, "click", function (event) {
                event.preventDefault();
                var payload = {
                    title: button.getAttribute("data-share-title") || document.title,
                    text: button.getAttribute("data-share-text") || "",
                    url: button.getAttribute("data-share-url") || window.location.href
                };

                if (navigator.share) {
                    navigator.share(payload).catch(function () {
                        /* the visitor dismissed the share sheet */
                    });
                    return;
                }

                if (navigator.clipboard) {
                    navigator.clipboard.writeText(payload.url).then(function () {
                        toast("Link copied to the clipboard.", "success");
                    }).catch(function () {
                        toast("Copy the page address from the browser to share it.", "info");
                    });
                } else {
                    toast("Copy the page address from the browser to share it.", "info");
                }
            });
        });
    }

    function init() {
        var year = $("#currentYear");
        if (year) year.textContent = window.AngutsaEAT
            ? window.AngutsaEAT.currentYear()
            : new Date().getFullYear();

        initHeader();
        initBackToTop();
        initShare();
        initTabs();
        initSortableTables();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    /* -------------------------
       Form validation and auth helpers
       Used by the authentication, registration and management forms.

       These checks run in the browser for user feedback only. The
       backend must repeat every rule: client-side validation can be
       bypassed and must never be trusted.
       ------------------------- */

    function fieldWrapper(control) {
        if (!control) return null;
        if (control.closest) return control.closest(".form-field") || control.parentNode;
        return control.parentNode;
    }

    function fieldMessage(control, variant) {
        var wrapper = fieldWrapper(control);
        if (!wrapper) return null;
        var selector = variant === "success" ? ".form-hint" : ".form-error";
        return $(selector, wrapper);
    }

    function clearFieldError(control) {
        var wrapper = fieldWrapper(control);
        if (!wrapper) return;
        wrapper.classList.remove("has-error");
        var message = $(".form-error", wrapper);
        if (message) message.textContent = "";
    }

    function showFieldError(control, message) {
        var wrapper = fieldWrapper(control);
        if (!wrapper) return;
        wrapper.classList.add("has-error");
        var target = $(".form-error", wrapper);
        if (target) {
            target.textContent = message;
        }
    }

    function clearFormErrors(form) {
        $$(".form-field.has-error", form).forEach(function (wrapper) {
            wrapper.classList.remove("has-error");
        });
        $$(".form-error", form).forEach(function (message) {
            message.textContent = "";
        });
    }

    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    /* Kenyan mobile numbers, local or international form. */
    var PHONE_PATTERN = /^(\+?254|0)[17]\d{8}$/;

    function isEmail(value) {
        return EMAIL_PATTERN.test(String(value || "").trim());
    }

    function isPhone(value) {
        return PHONE_PATTERN.test(String(value || "").replace(/[\s-]/g, ""));
    }

    /* Returns a 0-5 score with a label and percentage for the meter. */
    function passwordStrength(value) {
        var text = String(value || "");
        var score = 0;

        if (text.length >= 8) score += 1;
        if (text.length >= 12) score += 1;
        if (/[a-z]/.test(text) && /[A-Z]/.test(text)) score += 1;
        if (/\d/.test(text)) score += 1;
        if (/[^A-Za-z0-9]/.test(text)) score += 1;

        var labels = ["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"];
        return {
            score: score,
            label: labels[score] || labels[0],
            percent: Math.round((score / 5) * 100)
        };
    }

    /* Validates a single control against declarative rules:
       required, email, phone, minLength, maxLength, match, pattern,
       plus custom *Message overrides. */
    function validateField(control, rules) {
        var settings = rules || {};
        if (!control) return true;

        var isCheckbox = control.type === "checkbox";
        var value = isCheckbox
            ? (control.checked ? "on" : "")
            : String(control.value === undefined ? "" : control.value).trim();

        clearFieldError(control);

        if (settings.required && !value) {
            showFieldError(control, settings.requiredMessage || "This field is required.");
            return false;
        }

        if (!value) return true;

        if (settings.email && !isEmail(value)) {
            showFieldError(control, settings.emailMessage || "Enter a valid email address.");
            return false;
        }

        if (settings.phone && !isPhone(value)) {
            showFieldError(control, settings.phoneMessage ||
                "Enter a valid mobile number, for example 0712 345 678.");
            return false;
        }

        if (settings.minLength && value.length < settings.minLength) {
            showFieldError(control, settings.minLengthMessage ||
                "Use at least " + settings.minLength + " characters.");
            return false;
        }

        if (settings.maxLength && value.length > settings.maxLength) {
            showFieldError(control, settings.maxLengthMessage ||
                "Use no more than " + settings.maxLength + " characters.");
            return false;
        }

        if (settings.match && String(settings.match.value === undefined ? "" : settings.match.value).trim() !== value) {
            showFieldError(control, settings.matchMessage || "The values do not match.");
            return false;
        }

        if (settings.pattern && !settings.pattern.test(value)) {
            showFieldError(control, settings.patternMessage || "Please check this value.");
            return false;
        }

        return true;
    }

    /* Validates several controls at once.
       rulesMap: { "controlId": { required: true, email: true, ... } } */
    function validateForm(form, rulesMap) {
        var settings = rulesMap || {};
        var valid = true;
        var firstInvalid = null;

        Object.keys(settings).forEach(function (id) {
            var control = document.getElementById(id);
            if (!control || control.disabled) return;

            if (!validateField(control, settings[id])) {
                valid = false;
                if (!firstInvalid) firstInvalid = control;
            }
        });

        if (firstInvalid && typeof firstInvalid.focus === "function") {
            firstInvalid.focus();
        }

        return { valid: valid, firstInvalid: firstInvalid };
    }

    /* Show/hide password controls: [data-toggle-password="inputId"] */
    function initPasswordToggles(root) {
        $$("[data-toggle-password]", root || document).forEach(function (button) {
            on(button, "click", function () {
                var target = document.getElementById(button.getAttribute("data-toggle-password"));
                if (!target) return;

                var showing = target.getAttribute("type") === "text";
                target.setAttribute("type", showing ? "password" : "text");
                button.textContent = showing ? "Show" : "Hide";
                button.setAttribute("aria-pressed", String(!showing));
                button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
            });
        });
    }

    /* Password strength meters: [data-strength-for="inputId"] containing
       .strength-bar > span and .strength-label. */
    function initStrengthMeters(root) {
        $$("[data-strength-for]", root || document).forEach(function (meter) {
            var control = document.getElementById(meter.getAttribute("data-strength-for"));
            if (!control) return;

            var bar = $(".strength-bar span", meter);
            var label = $(".strength-label", meter);

            function update() {
                var result = passwordStrength(control.value);
                if (bar) bar.style.width = result.percent + "%";
                if (label) {
                    label.textContent = control.value
                        ? result.label
                        : "Use at least 8 characters, with a number and a capital letter";
                }
                meter.setAttribute("data-score", String(result.score));
            }

            on(control, "input", update);
            update();
        });
    }

    /* -------------------------
       Shareable match image
       ------------------------- */

    function wrapCanvasText(ctx, text, maxWidth, maxLines) {
        var words = String(text).split(/\s+/);
        var lines = [];
        var line = "";
        words.forEach(function (word) {
            var test = line ? line + " " + word : word;
            if (line && ctx.measureText(test).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
        return lines.slice(0, maxLines || 3);
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function buildMatchImage(match) {
        var W = 1080;
        var H = 1350;
        var canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext("2d");
        var font = '"Plus Jakarta Sans", "Segoe UI", Arial, sans-serif';
        var tournament = tournamentById(match.tournamentId);
        var category = categoryById(match.categoryId);
        var isResult = match.status === "completed" && match.homeScore !== null && match.awayScore !== null;
        var isFinal = String(match.stage || "").trim().toLowerCase() === "final";
        var championTeamId = isFinal && isResult ? matchWinnerTeamId(match) : null;
        var roundLabel = String(match.round || "").trim();
        if (isFinal) {
            roundLabel = roundLabel.replace(/^final(?:\s*[-\u2013\u2014\u00b7:]\s*|\s+)/i, "").trim();
            if (/^final$/i.test(roundLabel)) roundLabel = "";
        }
        var stageLine = isFinal ? roundLabel : match.group || match.stage || "Fixture";
        if (!isFinal && roundLabel) stageLine += " \u00b7 " + roundLabel;

        var bg = ctx.createLinearGradient(0, 0, W, H);
        if (isFinal) {
            bg.addColorStop(0, "#071A2B");
            bg.addColorStop(0.52, "#173B55");
            bg.addColorStop(1, "#4A3614");
        } else {
            bg.addColorStop(0, "#14122b");
            bg.addColorStop(1, "#3b2f8f");
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = isFinal ? "rgba(232,209,156,0.12)" : "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.arc(W - 80, 120, 320, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(80, H - 140, 260, 0, Math.PI * 2);
        ctx.fill();

        ctx.textAlign = "center";
        ctx.fillStyle = isFinal ? "#F1D688" : "#c9c2ff";
        ctx.font = "800 30px " + font;
        ctx.fillText("THE ANGUTSA FOOTBALL CHAMPIONSHIP", W / 2, 110);

        ctx.fillStyle = isFinal ? "#FFE7A3" : "#ffffff";
        ctx.font = "800 " + (isFinal ? "58px " : "64px ") + font;
        ctx.fillText(isFinal
            ? "THE FINAL"
            : isResult ? "FULL TIME" : "MATCH DAY", W / 2, 205);

        ctx.fillStyle = isFinal ? "#F2E6C5" : "#c9c2ff";
        ctx.font = "600 32px " + font;
        ctx.fillText(((tournament ? tournament.name : "") +
            (category ? " \u00b7 " + category.name : "")).replace(/^ \u00b7 /, ""), W / 2, 260, W - 120);
        ctx.font = (isFinal ? "800 30px " : "600 32px ") + font;
        ctx.fillStyle = isFinal ? "#F1D688" : "#c9c2ff";
        if (stageLine) ctx.fillText(stageLine, W / 2, 306, W - 120);

        roundRectPath(ctx, 60, 360, W - 120, 520, 36);
        if (isFinal) {
            var panel = ctx.createLinearGradient(60, 360, W - 60, 880);
            panel.addColorStop(0, "#FFF9E8");
            panel.addColorStop(0.5, "#FFFFFF");
            panel.addColorStop(1, "#FFF1C9");
            ctx.fillStyle = panel;
        } else {
            ctx.fillStyle = "#ffffff";
        }
        ctx.fill();
        if (isFinal) {
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#D7B56D";
            ctx.stroke();
        }

        function drawTeam(id, cx) {
            var name = teamName(id) || "TBC";
            var letters = name.split(/\s+/).map(function (w) { return w.charAt(0); })
                .join("").slice(0, 3).toUpperCase();
            if (championTeamId && championTeamId === id) {
                roundRectPath(ctx, cx - 140, 382, 280, 36, 18);
                ctx.fillStyle = "#18334A";
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = "#D7B56D";
                ctx.stroke();
                ctx.fillStyle = "#FFE7A3";
                ctx.font = "800 16px " + font;
                ctx.fillText(
                    (tournament && tournament.season ? tournament.season + " " : "") +
                        "SEASON CHAMPION",
                    cx,
                    406,
                    260
                );
            }
            ctx.beginPath();
            ctx.arc(cx, 530, 90, 0, Math.PI * 2);
            ctx.fillStyle = isFinal ? "#FFF0C2" : "#efecff";
            ctx.fill();
            ctx.lineWidth = isFinal ? 6 : 4;
            ctx.strokeStyle = isFinal ? "#C99D3A" : "#5b45c4";
            ctx.stroke();
            ctx.fillStyle = isFinal ? "#18334A" : "#3b2f8f";
            ctx.font = (isFinal ? "900 54px " : "800 54px ") + font;
            ctx.fillText(letters, cx, 549);
            ctx.fillStyle = "#14122b";
            ctx.font = "800 36px " + font;
            wrapCanvasText(ctx, name.toUpperCase(), 330, 3).forEach(function (line, index) {
                ctx.fillText(line, cx, 680 + index * 46);
            });
        }

        drawTeam(match.homeTeamId, 250);
        drawTeam(match.awayTeamId, W - 250);

        if (isResult) {
            if (isFinal) {
                roundRectPath(ctx, W / 2 - 116, 476, 232, 112, 28);
                var scorePanel = ctx.createLinearGradient(W / 2 - 116, 476, W / 2 + 116, 588);
                scorePanel.addColorStop(0, "#E1BD62");
                scorePanel.addColorStop(0.5, "#FFF0B7");
                scorePanel.addColorStop(1, "#D3A33B");
                ctx.fillStyle = scorePanel;
                ctx.fill();
            }
            ctx.fillStyle = isFinal ? "#142B40" : "#14122b";
            ctx.font = (isFinal ? "900 96px " : "800 110px ") + font;
            ctx.fillText(match.homeScore + " - " + match.awayScore, W / 2, 560);
        } else {
            roundRectPath(ctx, W / 2 - 60, 505, 120, 70, 35);
            var vsFill = "#5b45c4";
            if (isFinal) {
                vsFill = ctx.createLinearGradient(W / 2 - 60, 505, W / 2 + 60, 575);
                vsFill.addColorStop(0, "#D7B56D");
                vsFill.addColorStop(1, "#FFF0B7");
            }
            ctx.fillStyle = vsFill;
            ctx.fill();
            ctx.fillStyle = isFinal ? "#18334A" : "#ffffff";
            ctx.font = "800 36px " + font;
            ctx.fillText("VS", W / 2, 552);
        }

        ctx.strokeStyle = isFinal ? "rgba(182,137,42,0.45)" : "#e3e0f5";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(120, 810);
        ctx.lineTo(W - 120, 810);
        ctx.stroke();
        ctx.fillStyle = isFinal ? "#765819" : "#5c5a78";
        ctx.font = "700 28px " + font;
        ctx.fillText(matchStatusLabel(match.status).toUpperCase(), W / 2, 855, W - 200);

        ctx.fillStyle = isFinal ? "#FFE7A3" : "#ffffff";
        ctx.font = "800 50px " + font;
        ctx.fillText(formatDate(match.kickoff), W / 2, 970);
        ctx.font = "700 44px " + font;
        ctx.fillStyle = isFinal ? "#F1D688" : "#ffd36b";
        if (!isResult) ctx.fillText(formatTime(match.kickoff), W / 2, 1040);
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 38px " + font;
        ctx.fillText(match.venue || "Venue to be confirmed", W / 2, isResult ? 1040 : 1110, W - 140);

        ctx.fillStyle = isFinal ? "#F1D688" : "#c9c2ff";
        ctx.font = "700 28px " + font;
        ctx.fillText(isFinal
            ? "OFFICIAL MATCH IMAGE"
            : "Official fixture \u00b7 Angutsa Championship", W / 2, H - 70);

        return canvas;
    }

    function shareMatchImage(matchId) {
        var match = matchById(matchId);
        if (!match) return;

        var canvas;
        try {
            canvas = buildMatchImage(match);
        } catch (error) {
            toast("Could not create the image on this device.", "error");
            return;
        }

        var fileName = "angutsa-match-" + String(match.id).toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png";

        function download(blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            toast("Image saved. You can now share it.", "success");
        }

        canvas.toBlob(function (blob) {
            if (!blob) {
                toast("Could not create the image.", "error");
                return;
            }

            var file;
            try {
                file = new File([blob], fileName, { type: "image/png" });
            } catch (error) {
                download(blob);
                return;
            }

            var shareData = {
                files: [file],
                title: teamName(match.homeTeamId) + " vs " + teamName(match.awayTeamId)
            };

            if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
                navigator.share(shareData).catch(function (error) {
                    if (error && error.name !== "AbortError") download(blob);
                });
            } else {
                download(blob);
            }
        }, "image/png");
    }

    /* Any element with data-match-share works on every page. */
    document.addEventListener("click", function (event) {
        var trigger = event.target.closest ? event.target.closest("[data-match-share]") : null;
        if (!trigger) return;
        event.preventDefault();
        shareMatchImage(trigger.getAttribute("data-match-share"));
    });

    /* Registration fee payment details, with a copy button for the number. */
    function paymentDetailsMarkup(options) {
        var settings = options || {};
        var meta = (window.AngutsaData && window.AngutsaData.meta) || {};
        var pay = meta.payment || {};
        if (!pay.number) return "";

        return '<div class="pay-card' + (settings.compact ? " is-compact" : "") + '">' +
            '<span class="pay-card-label">' + escapeHtml(settings.title || "Pay registration fee via M-Pesa") + "</span>" +
            '<dl class="pay-card-list">' +
                "<div><dt>Method</dt><dd>" + escapeHtml(pay.method || "M-Pesa") + "</dd></div>" +
                "<div><dt>Phone number</dt><dd>" + escapeHtml(pay.number) + "</dd></div>" +
                "<div><dt>M-Pesa name</dt><dd>" + escapeHtml(pay.accountName) + "</dd></div>" +
            "</dl>" +
            '<button type="button" class="btn btn-dark-outline btn-sm" data-copy="' +
                escapeHtml(pay.number) + '">Copy number</button>' +
            (settings.note === false ? "" :
                '<p class="pay-card-note">Use your team name as the reference, then keep the M-Pesa message ' +
                "as proof of payment.</p>") +
            '<a class="pay-card-faq" href="/faqs/#FAQ-009">Payment FAQs &rarr;</a>' +
        "</div>";
    }

    document.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-copy]") : null;
        if (!button) return;
        var value = button.getAttribute("data-copy");
        var done = function () { toast("Number copied: " + value, "success"); };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(done, function () { toast(value, "info"); });
        } else {
            toast(value, "info");
        }
    });

    /* Fills any <div data-payment-details> placeholder in static pages. */
    function renderPaymentPlaceholders() {
        $$("[data-payment-details]").forEach(function (node) {
            node.innerHTML = paymentDetailsMarkup();
        });
    }

    function whenDataReady(callback) {
        if (!window.AngutsaDataReady) {
            callback();
            return;
        }
        Promise.resolve(window.AngutsaDataReady).then(callback);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            whenDataReady(renderPaymentPlaceholders);
        });
    } else {
        whenDataReady(renderPaymentPlaceholders);
    }

    return {
        paymentDetailsMarkup: paymentDetailsMarkup,
        shareMatchImage: shareMatchImage,
        whenDataReady: whenDataReady,
        /* DOM */
        $: $, $$: $$, on: on, create: create, escapeHtml: escapeHtml,


        debounce: debounce, slugify: slugify, normalise: normalise,
        /* Formatting */
        formatDate: formatDate, formatDateShort: formatDateShort,
        formatDateRange: formatDateRange, formatTime: formatTime,
        formatDateTime: formatDateTime, relativeTime: relativeTime,
        formatMoney: formatMoney, initials: initials, pluralise: pluralise,
        /* Data */
        records: records, findById: findById, findBySlug: findBySlug,
        tournamentById: tournamentById, categoryById: categoryById,
        teamById: teamById, playerById: playerById, matchById: matchById,
        teamName: teamName, categoryName: categoryName,
        publicPlayerName: publicPlayerName, filterMatches: filterMatches,
        isStandingsMatch: isStandingsMatch,
        sortMatchesByKickoff: sortMatchesByKickoff,
        /* Markup */
        icon: icon, crestMarkup: crestMarkup, playerToneMarkup: playerToneMarkup,
        statusClass: statusClass, statusBadge: statusBadge,
        tournamentStatusLabel: tournamentStatusLabel, matchStatusLabel: matchStatusLabel,
        matchWinnerTeamId: matchWinnerTeamId,
        emptyState: emptyState, skeletonCards: skeletonCards,
        loadingState: loadingState,         liveDataNotice: liveDataNotice,
        /* Interactions */
        toast: toast, openModal: openModal, closeModal: closeModal,
        confirmDialog: confirmDialog, initTabs: initTabs,
        initSortableTables: initSortableTables, readFilters: readFilters,
        bindFilters: bindFilters, matchesQuery: matchesQuery,
        paginate: paginate, renderPagination: renderPagination,
        fillSelect: fillSelect,
        /* Validation and auth helpers */
        validateField: validateField, validateForm: validateForm,
        clearFieldError: clearFieldError, showFieldError: showFieldError,
        clearFormErrors: clearFormErrors, isEmail: isEmail, isPhone: isPhone,
        passwordStrength: passwordStrength,
        initPasswordToggles: initPasswordToggles, initStrengthMeters: initStrengthMeters,
        /* State */
        setPref: setPref, getPref: getPref, getParam: getParam,
        computeStandings: computeStandings, formMarkup: formMarkup,
        init: init
    };










})();
