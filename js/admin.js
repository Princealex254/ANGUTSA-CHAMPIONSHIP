/* =========================================================
   ANGUTSA CHAMPIONSHIP \u2014 ADMIN DASHBOARD (admin.js)
   ---------------------------------------------------------
   Admin interface for /admin/. Authenticated account and role guards,
   plus connected records and writes, use the Firebase/Worker platform.
   Some legacy content actions remain preview-only; tournament group, format,
   approval, and fixture-publication workflows use the Worker API.

   Structure
   1.  DOM and formatting utilities
   2.  Icons and shared markup helpers
   3.  Navigation configuration
   4.  Demonstration data store
   5.  Application state and preferences
   6.  Dialogs, toasts and confirmation
   7.  Forms and validation
   8.  Shared list, table, filter and pagination renderers
   9.  CSV export
   10. Charts
   11. Module views
   12. Shell behaviour (search, drawers, menus) and init
   ========================================================= */

window.AngutsaAdmin = (function () {
    "use strict";

    /* -------------------------------------------------------
       1. DOM and formatting utilities
       ------------------------------------------------------- */

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function on(target, event, handler, options) {
        if (target) target.addEventListener(event, handler, options);
    }

    /* Every dynamic value passes through esc() before it is written
       into a template string, which stops user-entered text from
       being interpreted as markup. */
    function esc(value) {
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
            window.clearTimeout(timer);
            timer = window.setTimeout(function () {
                fn.apply(null, args);
            }, wait || 200);
        };
    }

    function normalise(value) {
        return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    }

    function slugify(value) {
        return normalise(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function initials(name) {
        var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function toNumber(value) {
        var num = Number(value);
        return isNaN(num) ? 0 : num;
    }

    function sum(list, key) {
        return list.reduce(function (total, item) {
            return total + toNumber(typeof key === "function" ? key(item) : item[key]);
        }, 0);
    }

    function byId(list, id) {
        if (!id) return null;
        for (var i = 0; i < list.length; i += 1) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function groupCount(list, key) {
        var out = {};
        list.forEach(function (item) {
            var value = String(item[key] === undefined || item[key] === null ? "Unknown" : item[key]);
            out[value] = (out[value] || 0) + 1;
        });
        return out;
    }

    var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"];

    function toDate(value) {
        if (window.AngutsaEAT) return window.AngutsaEAT.toDate(value);
        if (!value) return null;
        if (value instanceof Date) return value;

        var text = String(value);
        var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (dateOnly) {
            return new Date(
                parseInt(dateOnly[1], 10),
                parseInt(dateOnly[2], 10) - 1,
                parseInt(dateOnly[3], 10)
            );
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
            return new Date(
                parseInt(text.slice(0, 4), 10),
                parseInt(text.slice(5, 7), 10) - 1,
                parseInt(text.slice(8, 10), 10),
                parseInt(text.slice(11, 13), 10),
                parseInt(text.slice(14, 16), 10)
            );
        }
        var parsed = new Date(text);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function dateParts(date) {
        return window.AngutsaEAT ? window.AngutsaEAT.parts(date) : {
            year: date.getFullYear(),
            month: date.getMonth(),
            day: date.getDate(),
            hour: date.getHours(),
            minute: date.getMinutes()
        };
    }

    function eatToday() {
        return window.AngutsaEAT ? window.AngutsaEAT.today() : new Date().toISOString().slice(0, 10);
    }

    function eatCurrentYear() {
        return window.AngutsaEAT ? window.AngutsaEAT.currentYear() : new Date().getFullYear();
    }

    function formatDate(value) {
        var date = toDate(value);
        if (!date) return "Not set";
        var parts = dateParts(date);
        return parts.day + " " + MONTHS_SHORT[parts.month] + " " + parts.year;
    }

    function formatTime(value) {
        var date = toDate(value);
        if (!date) return "TBC";
        var parts = dateParts(date);
        var hours = parts.hour;
        var minutes = parts.minute;
        var suffix = hours >= 12 ? "PM" : "AM";
        var display = hours % 12 === 0 ? 12 : hours % 12;
        return display + ":" + (minutes < 10 ? "0" + minutes : minutes) + " " + suffix;
    }

    function dateTimeLocalValue(value) {
        var date = toDate(value);
        if (!date) return "";
        var parts = dateParts(date);
        var month = String(parts.month + 1).padStart(2, "0");
        var day = String(parts.day).padStart(2, "0");
        var hour = String(parts.hour).padStart(2, "0");
        var minute = String(parts.minute).padStart(2, "0");
        return parts.year + "-" + month + "-" + day + "T" + hour + ":" + minute;
    }

    function formatDateTime(value) {
        var date = toDate(value);
        if (!date) return "Not set";
        return formatDate(date) + ", " + formatTime(date);
    }

    function formatDateRange(from, to) {
        var start = toDate(from);
        var end = toDate(to);
        if (!start && !end) return "Dates to be confirmed";
        if (start && !end) return formatDate(start);
        if (!start && end) return formatDate(end);
        var startParts = dateParts(start);
        var endParts = dateParts(end);
        if (startParts.year === endParts.year && startParts.month === endParts.month) {
            return startParts.day + " - " + endParts.day + " " +
                MONTHS_LONG[startParts.month] + " " + startParts.year;
        }
        return formatDate(start) + " - " + formatDate(end);
    }

    function relativeTime(value) {
        var date = toDate(value);
        if (!date) return "";
        var minutes = Math.round((Date.now() - date.getTime()) / 60000);
        if (Math.abs(minutes) < 1) return "Just now";
        if (Math.abs(minutes) < 60) return minutes + (minutes > 0 ? " min ago" : " min ahead");
        var hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24) return hours + (hours > 0 ? " hr ago" : " hr ahead");
        var days = Math.round(hours / 24);
        if (Math.abs(days) < 30) return days + (days > 0 ? " day ago" : " day ahead");
        return formatDate(date);
    }

    function currencyCode() {
        return state.prefs.currency || DEMO.meta.currency;
    }

    function formatMoney(amount) {
        if (amount === null || amount === undefined || amount === "") return "Not set";
        var value = Number(amount);
        if (isNaN(value)) return "Not set";
        return currencyCode() + " " + value.toLocaleString("en-KE");
    }

    function pluralise(count, singular, plural) {
        return count + " " + (count === 1 ? singular : (plural || singular + "s"));
    }

    /* -------------------------------------------------------
       Preference storage (non-sensitive demonstration settings)
       ------------------------------------------------------- */

    var STORE_KEY = "angutsa.admin.prefs";

    var PREF_DEFAULTS = {
        adminName: "Administrator",
        adminRole: "Administrator",
        adminEmail: "",
        championshipName: "The Angutsa Football Championship",
        season: "2026",
        siteTagline: "More than a tournament. A community united by football.",
        contactEmail: "angutsachampionship@gmail.com",
        contactPhone: "+254 700 000 000",
        timezone: "Africa/Nairobi",
        dateFormat: "DD MMM YYYY",
        timeFormat: "12-hour",
        currency: "KES",
        registrationOpen: true,
        autoApproveTeams: false,
        requireGuardianConsent: true,
        notifyEmail: true,
        notifyRegistrations: true,
        notifyPayments: true,
        notifyMatches: false,
        density: "comfortable",
        sidebarRail: false,
        showDemoBanners: true,
        perPage: 10
    };

    function readPrefs() {
        var stored = {};
        try {
            stored = JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}") || {};
        } catch (error) {
            stored = {};
        }
        var merged = {};
        Object.keys(PREF_DEFAULTS).forEach(function (key) {
            merged[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : PREF_DEFAULTS[key];
        });
        if (String(merged.contactEmail || "").toLowerCase() === "info@example.com") {
            merged.contactEmail = PREF_DEFAULTS.contactEmail;
        }
        return merged;
    }

    function writePrefs() {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(state.prefs));
        } catch (error) {
            /* Storage can be blocked; the dashboard keeps working in memory. */
        }
    }

    function resetPrefs() {
        try {
            window.localStorage.removeItem(STORE_KEY);
        } catch (error) {
            /* ignore */
        }
        state.prefs = readPrefs();
    }

    /* -------------------------------------------------------
       2. Icons and shared markup helpers
       ------------------------------------------------------- */

    /* Stroke-based 24x24 icon set; currentColor so each icon
       inherits the colour that surrounds it. */
    var ICONS = {
        grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
        trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M6 5H4v2a3 3 0 0 0 3 3M18 5h2v2a3 3 0 0 1-3 3M10 17h4l1 4H9z"/>',
        layers: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
        shield: '<path d="M12 3.5 5.5 6v6c0 4 2.8 7.4 6.5 8.5 3.7-1.1 6.5-4.5 6.5-8.5V6z"/><path d="m9.5 12 1.8 1.8 3.4-3.6"/>',
        users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2-4.2"/>',
        player: '<circle cx="12" cy="6" r="2.6"/><path d="M12 9.5v6M8 12l4-2 4 2M9.5 20l2.5-4.5L14.5 20"/>',
        clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4v3h6V4M9 12h6M9 16h4"/>',
        clipboardCheck: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4v3h6V4M9 13.5l2 2 4-4.5"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
        whistle: '<path d="M14 8h5a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4h-3"/><circle cx="7.5" cy="12" r="4.5"/><path d="M12 8V5"/>',
        flag: '<path d="M5 3v18M5 4h12l-2 4 2 4H5z"/>',
        chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
        chartPie: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
        book: '<path d="M5 4.5h6.5A2.5 2.5 0 0 1 14 7v13a2 2 0 0 0-2-2H5z"/><path d="M19 4.5h-5a2.5 2.5 0 0 0-2.5 2.5v13a2 2 0 0 1 2-2H19z"/>',
        wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16.5 14.5h1.5"/>',
        receipt: '<path d="M7 3.5h10V21l-2.5-1.6L12 21l-2.5-1.6L7 21z"/><path d="M10 8h4M10 12h4"/>',
        coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
        image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
        megaphone: '<path d="M4 10.5v3.5l12 4.5V6z"/><path d="M16 9h3a2 2 0 0 1 0 6h-3M7 14.5V19a1.5 1.5 0 0 0 3 0v-3"/>',
        bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.5 2 5.5 2 5.5H4.5s2-1 2-5.5"/><path d="M10 19a2 2 0 0 0 4 0"/>',
        user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
        lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
        list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M5.1 7.5l1.9 1.1M17 15.4l1.9 1.1M5.1 16.5l1.9-1.1M17 8.6l1.9-1.1"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 5l4 4"/>',
        trash: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/>',
        eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
        download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
        printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/>',
        upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
        close: '<path d="M6 6 18 18M18 6 6 18"/>',
        check: '<path d="m5 13 4 4L19 7"/>',
        checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
        alert: '<path d="M12 4l8.5 15H3.5z"/><path d="M12 10v4M12 16.5h.01"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        pin: '<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>',
        chevronLeft: '<path d="m14 6-6 6 6 6"/>',
        arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
        logout: '<path d="M15 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9M13 12h8m0 0-3-3m3 3-3 3"/>',
        refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
        filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
        sort: '<path d="M7 4v16M4 8l3-4 3 4M17 20V4M14 16l3 4 3-4"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
        badge: '<circle cx="12" cy="9.5" r="5.5"/><path d="m9 14.5-1 6 4-2 4 2-1-6"/>',
        play: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9l4.5 3-4.5 3z"/>',
        pause: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9.5v5M13.5 9.5v5"/>',
        stop: '<circle cx="12" cy="12" r="9"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>',
        calendarX: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18M10 14l4 4M14 14l-4 4"/>',
        archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v10.5h14V9M10 13h4"/>',
        star: '<path d="m12 4 2.4 5 5.6.7-4 3.9 1 5.4-5-2.8-5 2.8 1-5.4-4-3.9 5.6-.7z"/>',
        key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 2 2-1.5 1.5L21 9l-2 2-1.5-1.5L16 11"/>'
    };

    function icon(name, className) {
        var path = ICONS[name] || ICONS.info;
        return '<svg class="' + esc(className || "icon") + '" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
            'aria-hidden="true" focusable="false">' + path + "</svg>";
    }

    /* Fills every [data-icon] placeholder inside a root element. */
    function paintIcons(root) {
        $$("[data-icon]", root || document).forEach(function (node) {
            if (node.getAttribute("data-icon-done") === "1") return;
            node.innerHTML = icon(node.getAttribute("data-icon"));
            node.setAttribute("data-icon-done", "1");
        });
    }

    function statusClass(value) {
        return "status-" + slugify(value || "neutral");
    }

    function statusBadge(value, label) {
        if (!value) return "";
        return '<span class="status-badge ' + esc(statusClass(value)) + '">' +
            esc(label || value) + "</span>";
    }

    function eligibilityBadge(value) {
        var normalized = normalise(value);
        var badgeStatus = normalized === "approved"
            ? "approved"
            : normalized === "eligible" ? "eligible" : "review";
        return statusBadge(badgeStatus, normalized === "approved" ? "Approved" : value);
    }

    function badge(value, tone) {
        return '<span class="badge' + (tone ? " badge-" + tone : "") + '">' + esc(value) + "</span>";
    }

    function crest(name, shape) {
        return '<span class="crest"' + (shape ? ' data-shape="round"' : "") + '>' +
            esc(initials(name)) + "</span>";
    }

    function emptyState(title, message, actionHtml) {
        return '<div class="empty-state">' +
            '<span class="kpi-icon">' + icon("search") + "</span>" +
            "<h3>" + esc(title) + "</h3>" +
            "<p>" + esc(message) + "</p>" +
            (actionHtml || "") +
            "</div>";
    }

    function demoBanner(text) {
        return "";
    }

    function kpiCard(cfg) {
        return '<article class="kpi">' +
            '<div class="kpi-top">' +
            '<div><p class="kpi-value">' + esc(cfg.value) + "</p>" +
            '<p class="kpi-label">' + esc(cfg.label) + "</p></div>" +
            '<span class="kpi-icon" data-tone="' + esc(cfg.tone || "purple") + '">' +
            icon(cfg.icon || "info") + "</span>" +
            "</div>" +
            (cfg.meta ? '<p class="kpi-meta">' + esc(cfg.meta) + "</p>" : "") +
            "</article>";
    }

    function card(title, bodyHtml, options) {
        var opts = options || {};
        return '<section class="card' + (opts.plain ? " card-pad-0" : "") + '">' +
            '<div class="card-head' + (opts.flush ? " card-head-flush" : "") + '">' +
            "<div><h3>" + esc(title) + "</h3>" +
            (opts.subtitle ? "<p>" + esc(opts.subtitle) + "</p>" : "") +
            "</div>" +
            (opts.action || "") +
            "</div>" +
            bodyHtml +
            "</section>";
    }

    function rowItem(main, sub, side) {
        return '<div class="row-item"><div class="row-item-main"><strong>' + esc(main) + "</strong>" +
            "<span>" + esc(sub) + '</span></div><div class="row-item-side">' + (side || "") +
            "</div></div>";
    }

    function statBar(label, value, total, tone) {
        var pct = total ? Math.round((value / total) * 100) : 0;
        return '<div class="stat-bar"><div class="stat-bar-head"><span>' + esc(label) + "</span>" +
            "<strong>" + esc(value) + (total ? " \u00b7 " + pct + "%" : "") + "</strong></div>" +
            '<div class="stat-bar-track"><span class="stat-bar-fill" data-tone="' +
            esc(tone || "purple") + '" style="width:' + pct + '%"></span></div></div>';
    }

    function matchRow(cfg) {
        return '<article class="match-row">' +
            '<div class="match-row-top">' + (cfg.badge || "") + "</div>" +
            '<div class="match-teams">' +
            '<div class="match-team">' + crest(cfg.home) +
            '<span class="match-team-name">' + esc(cfg.home) + "</span>" +
            (cfg.homeScore === undefined || cfg.homeScore === null ? ""
                : '<span class="match-score">' + esc(cfg.homeScore) + "</span>") +
            "</div>" +
            '<div class="match-team">' + crest(cfg.away) +
            '<span class="match-team-name">' + esc(cfg.away) + "</span>" +
            (cfg.awayScore === undefined || cfg.awayScore === null ? ""
                : '<span class="match-score">' + esc(cfg.awayScore) + "</span>") +
            "</div>" +
            "</div>" +
            '<div class="match-meta">' +
            "<span>" + icon("calendar") + " " + esc(cfg.date) + "</span>" +
            "<span>" + icon("clock") + " " + esc(cfg.time) + "</span>" +
            "<span>" + icon("pin") + " " + esc(cfg.venue) + "</span>" +
            "</div>" +
            "</article>";
    }

    function meter(label, value, total) {
        var pct = total ? Math.round((value / total) * 100) : 0;
        return '<div class="meter"><span class="meter-value">' + esc(label) + "</span>" +
            '<span class="meter-track"><span class="meter-fill" style="width:' + pct +
            '%"></span></span><span class="meter-value">' + pct + "%</span></div>";
    }

    /* Values are supplied as pre-escaped HTML fragments (badges,
       links) or plain text, which is escaped here. */
    function detailItem(label, value) {
        var isEmpty = value === null || value === undefined || value === "";
        return '<div class="detail-item"><span class="detail-label">' + esc(label) + "</span>" +
            '<span class="detail-value">' + (isEmpty
                ? '<span class="muted">Not set</span>' : String(value)) + "</span></div>";
    }

    function detailItemText(label, value) {
        return detailItem(label, esc(value));
    }

    function actionButton(action, id, module, label, iconName, tone) {
        return '<button type="button" class="btn-icon' + (tone === "danger" ? " is-danger" : "") +
            '" data-action="' + esc(action) + '" data-id="' + esc(id) + '" data-module="' +
            esc(module) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
            icon(iconName) + "</button>";
    }

    /* -------------------------------------------------------
       3. Navigation configuration
       ------------------------------------------------------- */

    /* Administrative sections, grouped exactly as they are
       presented in the sidebar. Count badges use loaded records. */
    var NAV_GROUPS = [
        {
            id: "overview",
            label: "Overview",
            views: [{ view: "dashboard", label: "Dashboard", icon: "grid" }]
        },
        {
            id: "competition",
            label: "Competition Management",
            views: [
                { view: "tournaments", label: "Tournaments", icon: "trophy" },
                { view: "tournament-management", label: "Tournament Management", icon: "trophy" },
                { view: "categories", label: "Tournament Categories", icon: "layers" },
                { view: "teams", label: "Teams", icon: "shield" },
                { view: "players", label: "Players", icon: "player" },
                { view: "team-registrations", label: "Team Registrations", icon: "clipboard",
                    count: function () { return countPending(DEMO.teamRegistrations); } },
                { view: "player-registrations", label: "Player Records", icon: "clipboardCheck" }
            ]
        },
        {
            id: "matches",
            label: "Match Operations",
            views: [
                { view: "fixtures", label: "Fixtures", icon: "calendar" },
                { view: "matches", label: "Matches &amp; Match Officials", icon: "whistle" },
                { view: "live-match", label: "Live Match", icon: "play" },
                { view: "results", label: "Results", icon: "flag",
                    count: function () { return countWhere(DEMO.results, "state", "draft"); } },
                { view: "standings", label: "Standings", icon: "chart" },
                { view: "rules", label: "Competition Rules", icon: "book" }
            ]
        },
        {
            id: "finance",
            label: "Finance",
            views: [
                { view: "payments", label: "Payments", icon: "wallet",
                    count: function () { return countWhere(DEMO.payments, "status", "pending"); } },
                { view: "payment-records", label: "Payment Records", icon: "receipt" },
                { view: "financial-reports", label: "Financial Reports", icon: "coins" }
            ]
        },
        {
            id: "content",
            label: "Content &amp; Media",
            views: [
                { view: "media", label: "Media Gallery", icon: "image" },
                { view: "announcements", label: "Announcements", icon: "megaphone" }
            ]
        },
        {
            id: "administration",
            label: "Administration",
            views: [
                { view: "team-managers", label: "Team Managers", icon: "users" },
                { view: "users", label: "Admin Users", icon: "user" },
                { view: "roles", label: "Roles &amp; Permissions", icon: "lock" },
                { view: "audit-logs", label: "Audit Logs", icon: "list" },
                { view: "reports", label: "Reports &amp; Analytics", icon: "chartPie" },
                { view: "settings", label: "System Settings", icon: "settings" }
            ]
        }
    ];

    function countWhere(list, key, value) {
        return list.filter(function (item) {
            return normalise(item[key]) === normalise(value);
        }).length;
    }

    function countPending(list) {
        return list.filter(function (item) {
            return normalise(item.status).indexOf("pending") === 0 ||
                normalise(item.status) === "under review" ||
                normalise(item.status) === "correction requested";
        }).length;
    }

    function unreadCount() {
        return DEMO.notifications.filter(function (note) { return !note.read; }).length;
    }

    /* Page metadata: [sidebar group, page title, breadcrumb trail].
       Keys double as the hash routes used by the app. */
    var VIEW_META = {
        dashboard: ["overview", "Dashboard", "Dashboard"],
        tournaments: ["competition", "Tournaments", "Competition Management"],
        "tournament-management": ["competition", "Tournament Management", "Competition Management"],
        categories: ["competition", "Tournament Categories", "Competition Management"],
        teams: ["competition", "Teams", "Competition Management"],
        players: ["competition", "Players", "Competition Management"],
        "team-registrations": ["competition", "Team Registrations", "Competition Management"],
        "player-registrations": ["competition", "Player Records", "Competition Management"],
        fixtures: ["matches", "Fixtures", "Match Operations"],
        matches: ["matches", "Matches & Match Officials", "Match Operations"],
        "live-match": ["matches", "Live Match", "Match Operations"],
        results: ["matches", "Results", "Match Operations"],
        standings: ["matches", "Standings", "Match Operations"],
        rules: ["matches", "Competition Rules", "Match Operations"],
        payments: ["finance", "Payments", "Finance"],
        "payment-records": ["finance", "Payment Records", "Finance"],
        "financial-reports": ["finance", "Financial Reports", "Finance"],
        media: ["content", "Media Gallery", "Content & Media"],
        announcements: ["content", "Announcements", "Content & Media"],
        "team-managers": ["administration", "Team Managers", "Administration"],
        users: ["administration", "Admin Users", "Administration"],
        roles: ["administration", "Roles & Permissions", "Administration"],
        "audit-logs": ["administration", "Audit Logs", "Administration"],
        reports: ["administration", "Reports & Analytics", "Administration"],
        settings: ["administration", "System Settings", "Administration"]
    };

    function viewTitle(view) {
        return VIEW_META[view] ? VIEW_META[view][1] : "Dashboard";
    }

    function viewCrumb(view) {
        return VIEW_META[view] ? VIEW_META[view][2] : "Administration";
    }

    function viewIcon(view) {
        var found = "grid";
        allNavItems().forEach(function (item) {
            if (item.view === view) found = item.icon;
        });
        return found;
    }

    function allNavItems() {
        var items = [];
        NAV_GROUPS.forEach(function (group) {
            group.views.forEach(function (item) {
                items.push(item);
            });
        });
        return items;
    }

    function isValidView(view) {
        return Object.prototype.hasOwnProperty.call(VIEW_META, view);
    }

    /* Initial seed values are cleared before the live backend bootstrap. */

    var DEMO = {
        meta: {
            demo: true,
            label: "Live data pending",
            currency: "KES",
            timezone: "Africa/Nairobi"
        },

        categories: [
            { id: "CAT-01", publicId: "CAT-MEN-OPEN", name: "Men's Open", shortName: "Men",
                code: "MEN", gender: "Men", ageMin: 18, ageMax: null,
                ageGroup: "Senior (18 years and above)", entryFee: 5000, guardianConsent: false,
                status: "active", description: "Open age category for adult male teams." },
            { id: "CAT-02", publicId: "CAT-WOMEN-OPEN", name: "Women's Open", shortName: "Women",
                code: "WMN", gender: "Women", ageMin: 18, ageMax: null,
                ageGroup: "Senior (18 years and above)", entryFee: 5000, guardianConsent: false,
                status: "active", description: "Open age category for adult female teams." },
            { id: "CAT-03", publicId: "CAT-YOUTH-M", name: "Youth Male (13-17)", shortName: "Youth Boys",
                code: "U17M", gender: "Boys", ageMin: 13, ageMax: 17,
                ageGroup: "Youth (13 to 17)", entryFee: 3000, guardianConsent: true,
                status: "active",
                description: "Youth category for male players aged 13 to 17. Guardian consent required." },
            { id: "CAT-04", publicId: "CAT-YOUTH-F", name: "Youth Female (13-17)", shortName: "Youth Girls",
                code: "U17F", gender: "Girls", ageMin: 13, ageMax: 17,
                ageGroup: "Youth (13 to 17)", entryFee: 3000, guardianConsent: true,
                status: "active",
                description: "Youth category for female players aged 13 to 17. Guardian consent required." },
            { id: "CAT-05", publicId: "CAT-CHILD-U13", name: "Children (Under 13)", shortName: "Children",
                code: "U13X", gender: "Mixed", ageMin: 8, ageMax: 12,
                ageGroup: "Children (8 to 12)", entryFee: 0, guardianConsent: true,
                status: "active",
                description: "Development festival category. No entry fee, guardian consent required, " +
                    "public profiles restricted." }
        ],

        tournaments: [
            { id: "TRN-01", publicId: "TRN-2026-MEN", slug: "angutsa-mens-championship-2026",
                name: "Angutsa Men's Championship", season: "2026", categoryId: "CAT-01",
                startDate: "2026-10-03", endDate: "2026-12-12",
                registrationOpens: "2026-08-01", registrationCloses: "2026-09-20",
                venue: "Angutsa Grounds", location: "Kiserian, Kajiado County",
                status: "active", registrationStatus: "open",
                format: "Group stage + knockout", teamCap: 8, registrationFee: 5000,
                banner: "/images/hero2.jpg", featured: true, standingsAvailable: true,
                overview: "The flagship senior competition of the Angutsa Football Championship. " +
                    "Eight teams contest a two-group league stage before the top four progress to " +
                    "the knockout rounds.",
                notes: "Flagship competition of the championship calendar." },
            { id: "TRN-02", publicId: "TRN-2026-WOMEN", slug: "angutsa-womens-championship-2026",
                name: "Angutsa Women's Championship", season: "2026", categoryId: "CAT-02",
                startDate: "2026-11-07", endDate: "2027-01-24",
                registrationOpens: "2026-09-15", registrationCloses: "2026-10-31",
                venue: "Angutsa Grounds", location: "Kiserian, Kajiado County",
                status: "upcoming", registrationStatus: "open",
                format: "Group stage + knockout", teamCap: 8, registrationFee: 5000,
                banner: "/images/hero1.jpg", featured: true, standingsAvailable: false,
                overview: "A dedicated competition for women's teams, giving the region's leading " +
                    "sides a full season of competitive football.",
                notes: "Registrations remain open until the draw is published." },
            { id: "TRN-03", publicId: "TRN-2026-YOUTH-B", slug: "angutsa-youth-boys-championship-2026",
                name: "Angutsa Youth Boys Championship", season: "2026", categoryId: "CAT-03",
                startDate: "2026-11-14", endDate: "2027-02-07",
                registrationOpens: "2026-09-20", registrationCloses: "2026-11-05",
                venue: "Kiserian Primary Grounds", location: "Kiserian, Kajiado County",
                status: "upcoming", registrationStatus: "open",
                format: "Single round-robin league", teamCap: 10, registrationFee: 3000,
                banner: "/images/poster.png", featured: false, standingsAvailable: false,
                overview: "A development league for boys aged 13 to 17. Guardian consent is required " +
                    "for every registered player and public profiles are limited.",
                notes: "Guardian consent must be verified for every youth player." },
            { id: "TRN-04", publicId: "TRN-2026-YOUTH-G", slug: "angutsa-youth-girls-championship-2026",
                name: "Angutsa Youth Girls Championship", season: "2026", categoryId: "CAT-04",
                startDate: "2027-01-16", endDate: "2027-04-10",
                registrationOpens: "2026-11-01", registrationCloses: "2026-12-20",
                venue: "Kiserian Primary Grounds", location: "Kiserian, Kajiado County",
                status: "upcoming", registrationStatus: "not opened",
                format: "Single round-robin league", teamCap: 10, registrationFee: 3000,
                banner: "/images/hero.png", featured: false, standingsAvailable: false,
                overview: "The girls' youth competition, built around safe participation, guardian " +
                    "consent and coach education.",
                notes: "Draft planning record until the registration window opens." },
            { id: "TRN-05", publicId: "TRN-2026-CHILDREN", slug: "angutsa-childrens-festival-2026",
                name: "Angutsa Children's Festival", season: "2026", categoryId: "CAT-05",
                startDate: "2026-12-05", endDate: "2026-12-06",
                registrationOpens: "2026-10-20", registrationCloses: "2026-11-28",
                venue: "Angutsa Grounds", location: "Kiserian, Kajiado County",
                status: "upcoming", registrationStatus: "not opened",
                format: "Festival format (non-competitive)", teamCap: 16, registrationFee: 0,
                banner: "/images/hero1.jpg", featured: false, standingsAvailable: false,
                overview: "A weekend football festival for children under 13. No entry fee, no league " +
                    "table and no public player profiles.",
                notes: "Guardian consent is required for every child taking part." },
            { id: "TRN-06", publicId: "TRN-2025-INV", slug: "angutsa-invitational-cup-2025",
                name: "Angutsa Invitational Cup", season: "2025", categoryId: "CAT-01",
                startDate: "2025-08-02", endDate: "2025-10-18",
                registrationOpens: "2025-06-01", registrationCloses: "2025-07-20",
                venue: "Angutsa Grounds", location: "Kiserian, Kajiado County",
                status: "archived", registrationStatus: "closed",
                format: "Straight knockout", teamCap: 4, registrationFee: 5000,
                banner: "/images/hero2.jpg", featured: false, standingsAvailable: false,
                archivedTeams: 4,
                overview: "A four-team invitational cup that closed the 2025 season, retained here " +
                    "as a completed competition for reporting and archive views.",
                notes: "Previous season retained for reference only." }
        ],

        teams: [
            { id: "TEAM-01", name: "Kiserian Rangers", shortName: "KIS", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group A", manager: "Team Manager A (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kiserian",
                registrationStatus: "approved", squadSize: 22, registeredOn: "2026-08-06" },
            { id: "TEAM-02", name: "Ngong United", shortName: "NGU", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group A", manager: "Team Manager B (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ngong",
                registrationStatus: "approved", squadSize: 20, registeredOn: "2026-08-08" },
            { id: "TEAM-03", name: "Angutsa Warriors", shortName: "ANW", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group A", manager: "Team Manager C (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kiserian",
                registrationStatus: "approved", squadSize: 18, registeredOn: "2026-08-11" },
            { id: "TEAM-04", name: "Rift Valley Stars", shortName: "RVS", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group A", manager: "Team Manager D (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ngong",
                registrationStatus: "approved", squadSize: 21, registeredOn: "2026-08-14" },
            { id: "TEAM-05", name: "Nairobi Elite", shortName: "NBE", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group B", manager: "Team Manager E (placeholder)",
                contact: "Contact withheld in this prototype", location: "Nairobi",
                registrationStatus: "approved", squadSize: 19, registeredOn: "2026-08-15" },
            { id: "TEAM-06", name: "Ole Kasasi FC", shortName: "OKF", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group B", manager: "Team Manager F (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ole Kasasi",
                registrationStatus: "approved", squadSize: 17, registeredOn: "2026-08-18" },
            { id: "TEAM-07", name: "Githurai Allstars", shortName: "GTA", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group B", manager: "Team Manager G (placeholder)",
                contact: "Contact withheld in this prototype", location: "Githurai",
                registrationStatus: "approved", squadSize: 24, registeredOn: "2026-08-21" },
            { id: "TEAM-08", name: "Bulbul United", shortName: "BBU", categoryId: "CAT-01",
                tournamentId: "TRN-01", group: "Group B", manager: "Team Manager H (placeholder)",
                contact: "Contact withheld in this prototype", location: "Bulbul",
                registrationStatus: "approved", squadSize: 16, registeredOn: "2026-08-24" },
            { id: "TEAM-09", name: "Angutsa Queens", shortName: "ANQ", categoryId: "CAT-02",
                tournamentId: "TRN-02", group: "Group A", manager: "Team Manager I (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kiserian",
                registrationStatus: "approved", squadSize: 18, registeredOn: "2026-09-18" },
            { id: "TEAM-10", name: "Kiserian Ladies", shortName: "KSL", categoryId: "CAT-02",
                tournamentId: "TRN-02", group: "Group A", manager: "Team Manager J (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kiserian",
                registrationStatus: "approved", squadSize: 16, registeredOn: "2026-09-21" },
            { id: "TEAM-11", name: "Ngong Women FC", shortName: "NGW", categoryId: "CAT-02",
                tournamentId: "TRN-02", group: "Group A", manager: "Team Manager K (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ngong",
                registrationStatus: "pending", squadSize: 15, registeredOn: "2026-10-02" },
            { id: "TEAM-12", name: "Rift Lionesses", shortName: "RLN", categoryId: "CAT-02",
                tournamentId: "TRN-02", group: "Group A", manager: "Team Manager L (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ngong",
                registrationStatus: "pending", squadSize: 14, registeredOn: "2026-10-06" },
            { id: "TEAM-13", name: "Angutsa Youth Academy", shortName: "AYA", categoryId: "CAT-03",
                tournamentId: "TRN-03", group: "", manager: "Team Manager M (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kiserian",
                registrationStatus: "approved", squadSize: 20, registeredOn: "2026-09-25" },
            { id: "TEAM-14", name: "Ole Kasasi Juniors", shortName: "OKJ", categoryId: "CAT-03",
                tournamentId: "TRN-03", group: "", manager: "Team Manager N (placeholder)",
                contact: "Contact withheld in this prototype", location: "Ole Kasasi",
                registrationStatus: "approved", squadSize: 18, registeredOn: "2026-09-28" },
            { id: "TEAM-15", name: "Matasia FC", shortName: "MTC", categoryId: "CAT-01",
                tournamentId: "", group: "", manager: "Team Manager O (placeholder)",
                contact: "Contact withheld in this prototype", location: "Matasia",
                registrationStatus: "rejected", squadSize: 15, registeredOn: "2026-08-30" },
            { id: "TEAM-16", name: "Kajiado Central", shortName: "KJC", categoryId: "CAT-01",
                tournamentId: "", group: "", manager: "Team Manager P (placeholder)",
                contact: "Contact withheld in this prototype", location: "Kajiado",
                registrationStatus: "approved", squadSize: 19, registeredOn: "2025-06-14" }
        ],

        players: [
            { id: "PLR-01", name: "Player One (fictional)", teamId: "TEAM-01", jersey: 9, position: "Forward",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 2001, guardianConsent: false, submittedOn: "2026-08-06" },
            { id: "PLR-02", name: "Player Two (fictional)", teamId: "TEAM-01", jersey: 4, position: "Defender",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 1999, guardianConsent: false, submittedOn: "2026-08-06" },
            { id: "PLR-03", name: "Player Three (fictional)", teamId: "TEAM-02", jersey: 10, position: "Midfielder",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "under review",
                yearOfBirth: 2000, guardianConsent: false, submittedOn: "2026-08-09" },
            { id: "PLR-04", name: "Player Four (fictional)", teamId: "TEAM-02", jersey: 1, position: "Goalkeeper",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 1998, guardianConsent: false, submittedOn: "2026-08-09" },
            { id: "PLR-05", name: "Player Five (fictional)", teamId: "TEAM-03", jersey: 7, position: "Winger",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "under review",
                yearOfBirth: 2002, guardianConsent: false, submittedOn: "2026-08-15" },
            { id: "PLR-06", name: "Player Six (fictional)", teamId: "TEAM-09", jersey: 11, position: "Forward",
                categoryId: "CAT-02", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 2001, guardianConsent: false, submittedOn: "2026-09-18" },
            { id: "PLR-07", name: "Player Seven (fictional)", teamId: "TEAM-09", jersey: 6, position: "Midfielder",
                categoryId: "CAT-02", registrationStatus: "registered", eligibility: "under review",
                yearOfBirth: 2003, guardianConsent: false, submittedOn: "2026-09-19" },
            { id: "PLR-08", name: "Player Eight (fictional)", teamId: "TEAM-13", jersey: 8, position: "Midfielder",
                categoryId: "CAT-03", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 2010, guardianConsent: true, submittedOn: "2026-09-25" },
            { id: "PLR-09", name: "Player Nine (fictional)", teamId: "TEAM-13", jersey: 14, position: "Defender",
                categoryId: "CAT-03", registrationStatus: "registered", eligibility: "age query",
                yearOfBirth: 2011, guardianConsent: false, submittedOn: "2026-09-26" },
            { id: "PLR-10", name: "Player Ten (fictional)", teamId: "TEAM-04", jersey: 5, position: "Defender",
                categoryId: "CAT-01", registrationStatus: "registered", eligibility: "eligible",
                yearOfBirth: 1997, guardianConsent: false, submittedOn: "2026-08-11" }
        ],

        teamRegistrations: [
            { id: "TR-2026-001", teamId: "TEAM-01", tournamentId: "TRN-01", submitted: "2026-08-06",
                status: "approved", outstanding: "None \u2014 kit colours and manager documents received",
                reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-002", teamId: "TEAM-02", tournamentId: "TRN-01", submitted: "2026-08-08",
                status: "approved", outstanding: "None", reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-003", teamId: "TEAM-03", tournamentId: "TRN-01", submitted: "2026-08-11",
                status: "approved", outstanding: "None", reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-004", teamId: "TEAM-04", tournamentId: "TRN-01", submitted: "2026-08-14",
                status: "approved", outstanding: "None", reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-005", teamId: "TEAM-11", tournamentId: "TRN-02", submitted: "2026-10-02",
                status: "pending review", outstanding: "Manager identification",
                reviewedBy: "" },
            { id: "TR-2026-006", teamId: "TEAM-15", tournamentId: "TRN-01", submitted: "2026-08-30",
                status: "rejected", outstanding: "Not eligible \u2014 club affiliation not confirmed",
                reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-007", teamId: "TEAM-09", tournamentId: "TRN-02", submitted: "2026-09-18",
                status: "approved", outstanding: "None", reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-008", teamId: "TEAM-10", tournamentId: "TRN-02", submitted: "2026-09-21",
                status: "approved", outstanding: "None", reviewedBy: "Administrator (placeholder)" },
            { id: "TR-2026-009", teamId: "TEAM-13", tournamentId: "TRN-03", submitted: "2026-09-25",
                status: "approved",
                outstanding: "None \u2014 guardian consent filed for every player",
                reviewedBy: "Registration officer (placeholder)" },
            { id: "TR-2026-010", teamId: "TEAM-14", tournamentId: "TRN-03", submitted: "2026-09-28",
                status: "correction requested", outstanding: "Squad list signature missing",
                reviewedBy: "Registration officer (placeholder)" }
        ],
        paymentRegistrations: [],

        playerRegistrations: [
            { id: "PR-2026-001", playerId: "PLR-03", teamId: "TEAM-02", tournamentId: "TRN-01",
                submitted: "2026-08-09", status: "registered", eligibility: "under review",
                notes: "Registered on the team roster; eligibility information is recorded separately." },
            { id: "PR-2026-002", playerId: "PLR-05", teamId: "TEAM-03", tournamentId: "TRN-01",
                submitted: "2026-08-15", status: "registered", eligibility: "under review",
                notes: "Registered on the team roster; eligibility information is recorded separately." },
            { id: "PR-2026-003", playerId: "PLR-07", teamId: "TEAM-09", tournamentId: "TRN-02",
                submitted: "2026-09-19", status: "registered", eligibility: "under review",
                notes: "Registered on the team roster; check transfer information if required by tournament rules." },
            { id: "PR-2026-004", playerId: "PLR-09", teamId: "TEAM-13", tournamentId: "TRN-03",
                submitted: "2026-09-26", status: "registered", eligibility: "age query",
                notes: "Age information needs checking; guardian consent is recorded separately." },
            { id: "PR-2026-005", playerId: "PLR-10", teamId: "TEAM-04", tournamentId: "TRN-01",
                submitted: "2026-08-11", status: "registered", eligibility: "eligible",
                notes: "Registered on the team roster." }
        ],

        fixtures: [
            { id: "FIX-001", tournamentId: "TRN-01", categoryId: "CAT-01", round: "Matchday 1",
                group: "Group A", homeId: "TEAM-01", awayId: "TEAM-02", kickoff: "2026-09-05T15:00",
                venue: "Angutsa Grounds, Kiserian", status: "scheduled" },
            { id: "FIX-002", tournamentId: "TRN-01", categoryId: "CAT-01", round: "Matchday 1",
                group: "Group B", homeId: "TEAM-04", awayId: "TEAM-03", kickoff: "2026-09-05T17:00",
                venue: "Angutsa Grounds, Kiserian", status: "scheduled" },
            { id: "FIX-003", tournamentId: "TRN-01", categoryId: "CAT-01", round: "Matchday 2",
                group: "Group A", homeId: "TEAM-02", awayId: "TEAM-01", kickoff: "2026-09-12T15:00",
                venue: "Ngong Sports Complex", status: "scheduled" },
            { id: "FIX-004", tournamentId: "TRN-01", categoryId: "CAT-01", round: "Matchday 2",
                group: "Group B", homeId: "TEAM-03", awayId: "TEAM-04", kickoff: "2026-09-12T17:00",
                venue: "Ngong Sports Complex", status: "postponed" },
            { id: "FIX-005", tournamentId: "TRN-02", categoryId: "CAT-02", round: "Matchday 1",
                group: "Group A", homeId: "TEAM-05", awayId: "TEAM-06", kickoff: "2026-10-03T14:00",
                venue: "Ngong Sports Complex", status: "scheduled" },
            { id: "FIX-006", tournamentId: "TRN-03", categoryId: "CAT-03", round: "Matchday 1",
                group: "Group A", homeId: "TEAM-07", awayId: "TEAM-07", kickoff: "2026-07-11T11:00",
                venue: "Angutsa Grounds, Kiserian", status: "cancelled" },
            { id: "FIX-007", tournamentId: "TRN-03", categoryId: "CAT-03", round: "Matchday 2",
                group: "Group A", homeId: "TEAM-07", awayId: "TEAM-08", kickoff: "2026-07-18T11:00",
                venue: "Angutsa Grounds, Kiserian", status: "completed" },
            { id: "FIX-008", tournamentId: "TRN-01", categoryId: "CAT-01", round: "Matchday 3",
                group: "Group A", homeId: "TEAM-01", awayId: "TEAM-04", kickoff: "2026-09-19T15:00",
                venue: "Angutsa Grounds, Kiserian", status: "draft" }
        ],

        matches: [
            { id: "MCH-001", fixtureId: "FIX-001", status: "scheduled",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "Officials are placeholders; real appointments must come from the backend." },
            { id: "MCH-002", fixtureId: "FIX-002", status: "scheduled",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "" },
            { id: "MCH-003", fixtureId: "FIX-004", status: "postponed",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "Postponed in this demonstration workflow." },
            { id: "MCH-004", fixtureId: "FIX-007", status: "completed",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "" },
            { id: "MCH-005", fixtureId: "FIX-005", status: "scheduled",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "" },
            { id: "MCH-006", fixtureId: "FIX-006", status: "cancelled",
                referee: "Not assigned (demonstration)", assistantOne: "Not assigned (demonstration)",
                assistantTwo: "Not assigned (demonstration)", fourthOfficial: "Not assigned (demonstration)",
                notes: "Cancelled after the fixture clash was detected." }
        ],

        results: [
            { id: "RES-001", fixtureId: "FIX-007", homeId: "TEAM-07", awayId: "TEAM-08",
                homeScore: 3, awayScore: 1, state: "published", enteredBy: "Administrator (placeholder)",
                enteredOn: "2026-07-18", notes: "Youth league fixture used for the sample standings." },
            { id: "RES-002", fixtureId: "FIX-001", homeId: "TEAM-01", awayId: "TEAM-02",
                homeScore: 2, awayScore: 2, state: "draft", enteredBy: "Administrator (placeholder)",
                enteredOn: "2026-09-05", notes: "Draft result \u2014 not published to the public site." },
            { id: "RES-003", fixtureId: "FIX-002", homeId: "TEAM-04", awayId: "TEAM-03",
                homeScore: 1, awayScore: 0, state: "published", enteredBy: "Administrator (placeholder)",
                enteredOn: "2026-09-05", notes: "" },
            { id: "RES-004", fixtureId: "FIX-003", homeId: "TEAM-02", awayId: "TEAM-01",
                homeScore: 0, awayScore: 3, state: "published", enteredBy: "Administrator (placeholder)",
                enteredOn: "2026-09-12", notes: "" },
            { id: "RES-005", fixtureId: "FIX-008", homeId: "TEAM-01", awayId: "TEAM-04",
                homeScore: null, awayScore: null, state: "draft", enteredBy: "",
                enteredOn: "", notes: "Waiting for the match to be played." }
        ],

        payments: [
            { id: "PAY-0001", reference: "ANG-PAY-0001", teamId: "TEAM-01", tournamentId: "TRN-01",
                amount: 5000, currency: "KES", method: "M-Pesa (simulated)", paidOn: "2026-08-06",
                status: "confirmed", recordedBy: "Finance officer (placeholder)",
                notes: "Simulated payment record; no gateway is connected." },
            { id: "PAY-0002", reference: "ANG-PAY-0002", teamId: "TEAM-02", tournamentId: "TRN-01",
                amount: 5000, currency: "KES", method: "Bank transfer (simulated)", paidOn: "2026-08-08",
                status: "confirmed", recordedBy: "Finance officer (placeholder)", notes: "" },
            { id: "PAY-0003", reference: "ANG-PAY-0003", teamId: "TEAM-03", tournamentId: "TRN-01",
                amount: 5000, currency: "KES", method: "M-Pesa (simulated)", paidOn: "2026-08-14",
                status: "pending", recordedBy: "", notes: "Awaiting review against the team registration." },
            { id: "PAY-0004", reference: "ANG-PAY-0004", teamId: "TEAM-04", tournamentId: "TRN-01",
                amount: 2500, currency: "KES", method: "M-Pesa (simulated)", paidOn: "2026-08-10",
                status: "partial", recordedBy: "Finance officer (placeholder)",
                notes: "Half of the entry fee recorded so far." },
            { id: "PAY-0005", reference: "ANG-PAY-0005", teamId: "TEAM-09", tournamentId: "TRN-02",
                amount: 5000, currency: "KES", method: "Bank transfer (simulated)", paidOn: "2026-09-18",
                status: "confirmed", recordedBy: "Finance officer (placeholder)", notes: "" },
            { id: "PAY-0006", reference: "ANG-PAY-0006", teamId: "TEAM-11", tournamentId: "TRN-02",
                amount: 5000, currency: "KES", method: "M-Pesa (simulated)", paidOn: "2026-10-02",
                status: "pending", recordedBy: "", notes: "Payment reference needs verification." },
            { id: "PAY-0007", reference: "ANG-PAY-0007", teamId: "TEAM-13", tournamentId: "TRN-03",
                amount: 3000, currency: "KES", method: "Cash (simulated)", paidOn: "2026-09-25",
                status: "confirmed", recordedBy: "Finance officer (placeholder)", notes: "" },
            { id: "PAY-0008", reference: "ANG-PAY-0008", teamId: "TEAM-15", tournamentId: "TRN-01",
                amount: 5000, currency: "KES", method: "M-Pesa (simulated)", paidOn: "2026-08-30",
                status: "rejected", recordedBy: "Finance officer (placeholder)",
                notes: "Rejected because the team registration was not accepted." }
        ],

        paymentRecords: [
            { id: "REC-0001", reference: "ANG-PAY-0001", registrationId: "TR-2026-001", amount: 5000,
                status: "confirmed", date: "2026-08-06", receipt: "ANG-RCPT-0001" },
            { id: "REC-0002", reference: "ANG-PAY-0002", registrationId: "TR-2026-002", amount: 5000,
                status: "confirmed", date: "2026-08-08", receipt: "ANG-RCPT-0002" },
            { id: "REC-0003", reference: "ANG-PAY-0004", registrationId: "TR-2026-004", amount: 2500,
                status: "partial", date: "2026-08-10", receipt: "ANG-RCPT-0003" },
            { id: "REC-0004", reference: "ANG-PAY-0005", registrationId: "TR-2026-007", amount: 5000,
                status: "confirmed", date: "2026-09-18", receipt: "ANG-RCPT-0004" },
            { id: "REC-0005", reference: "ANG-PAY-0007", registrationId: "TR-2026-009", amount: 3000,
                status: "confirmed", date: "2026-09-25", receipt: "ANG-RCPT-0005" },
            { id: "REC-0006", reference: "ANG-PAY-0003", registrationId: "TR-2026-003", amount: 5000,
                status: "pending review", date: "2026-08-11", receipt: "" },
            { id: "REC-0007", reference: "ANG-PAY-0006", registrationId: "TR-2026-005", amount: 5000,
                status: "pending review", date: "2026-10-02", receipt: "" }
        ],

        media: window.AngutsaMediaData.map(function (item) {
            return Object.assign({}, item);
        }),

        announcements: [
            { id: "ANN-01", title: "Team registration deadline",
                message: "Team registrations for the Men's Championship close at the end of the month. Paperwork and payment references must be complete before the draw.",
                audience: "All teams", date: "2026-09-01", status: "published" },
            { id: "ANN-02", title: "Guardian consent required",
                message: "Every youth player must have a signed guardian consent form on file before taking part. This is a demonstration reminder.",
                audience: "Youth categories", date: "2026-08-25", status: "published" },
            { id: "ANN-03", title: "Match official appointments",
                message: "Appointments are placeholders in this prototype. Real appointments will be issued through the backend.",
                audience: "Match officials", date: "2026-09-04", status: "draft" },
            { id: "ANN-04", title: "Payment review schedule",
                message: "Payment confirmations are reviewed twice a week in this demonstration workflow.",
                audience: "Team managers", date: "2026-08-20", status: "published" },
            { id: "ANN-05", title: "Season closing ceremony",
                message: "Details of the closing ceremony will be shared once confirmed.",
                audience: "All teams", date: "2026-11-29", status: "archived" }
        ],

        notifications: [
            { id: "NOT-01", title: "Team registration awaiting review",
                message: "A team registration is waiting for outstanding requirements to be confirmed.",
                category: "Registration", date: "2026-08-20T09:15", read: false, view: "team-registrations" },
            { id: "NOT-02", title: "Payment pending review",
                message: "ANG-PAY-0003 requires an administrator decision.",
                category: "Finance", date: "2026-08-20T08:40", read: false, view: "payments" },
            { id: "NOT-03", title: "Player eligibility query",
                message: "A youth player registration is flagged for an age query.",
                category: "Eligibility", date: "2026-08-19T16:20", read: false, view: "player-registrations" },
            { id: "NOT-04", title: "Fixture clash detected",
                message: "Two fixtures were scheduled at the same venue and kickoff time.",
                category: "Fixtures", date: "2026-08-19T11:05", read: false, view: "fixtures" },
            { id: "NOT-05", title: "Draft result awaiting publication",
                message: "A draft result cannot be published until the score is confirmed.",
                category: "Results", date: "2026-08-18T17:30", read: true, view: "results" },
            { id: "NOT-06", title: "Announcement published",
                message: "The payment review schedule announcement was published.",
                category: "Content", date: "2026-08-18T10:00", read: true, view: "announcements" },
            { id: "NOT-07", title: "New admin user invited",
                message: "An invitation was recorded for a registration officer.",
                category: "Administration", date: "2026-08-15T14:10", read: true, view: "users" },
            { id: "NOT-08", title: "Demonstration reminder",
                message: "This dashboard uses sample data only. No email or SMS messages were sent.",
                category: "System", date: "2026-08-14T09:00", read: true, view: "dashboard" }
        ],

        users: [
            { id: "USR-01", name: "Alex Mwangi", email: "administrator@example.com", role: "Administrator",
                status: "active", lastActive: "2026-08-20T08:40", created: "2026-05-02" },
            { id: "USR-02", name: "Placeholder Super Admin", email: "superadmin@example.com", role: "Super Admin",
                status: "active", lastActive: "2026-08-19T19:05", created: "2026-04-28" },
            { id: "USR-03", name: "Placeholder Tournament Manager", email: "competitions@example.com",
                role: "Tournament Manager", status: "active", lastActive: "2026-08-20T07:15", created: "2026-05-10" },
            { id: "USR-04", name: "Placeholder Registration Officer", email: "registrations@example.com",
                role: "Registration Officer", status: "active", lastActive: "2026-08-18T16:45", created: "2026-05-14" },
            { id: "USR-05", name: "Placeholder Finance Officer", email: "finance@example.com",
                role: "Finance Officer", status: "suspended", lastActive: "2026-07-30T11:20", created: "2026-05-20" },
            { id: "USR-06", name: "Placeholder Content Editor", email: "content@example.com",
                role: "Content Editor", status: "inactive", lastActive: "2026-06-11T09:30", created: "2026-06-01" }
        ],

        /* The permission matrix is a frontend demonstration only. It is
           NOT a security control: real authorisation must be enforced
           by the backend on every request. */
        roles: [
            { id: "ROLE-01", name: "Super Admin", description: "Full access to every module and setting.",
                permissions: { view: true, create: true, edit: true, approve: true, publish: true, exportData: true, remove: true } },
            { id: "ROLE-02", name: "Administrator", description: "Runs day-to-day championship administration.",
                permissions: { view: true, create: true, edit: true, approve: true, publish: true, exportData: true, remove: false } },
            { id: "ROLE-03", name: "Tournament Manager", description: "Manages competitions, fixtures and results.",
                permissions: { view: true, create: true, edit: true, approve: false, publish: true, exportData: true, remove: false } },
            { id: "ROLE-04", name: "Registration Officer", description: "Reviews team registrations and records player roster details.",
                permissions: { view: true, create: true, edit: true, approve: true, publish: false, exportData: true, remove: false } },
            { id: "ROLE-05", name: "Finance Officer", description: "Reviews payments and prepares financial reports.",
                permissions: { view: true, create: true, edit: true, approve: true, publish: false, exportData: true, remove: false } },
            { id: "ROLE-06", name: "Match Official", description: "Views fixtures and records match events.",
                permissions: { view: true, create: false, edit: false, approve: false, publish: false, exportData: false, remove: false } },
            { id: "ROLE-07", name: "Content Editor", description: "Creates announcements and media content.",
                permissions: { view: true, create: true, edit: true, approve: false, publish: true, exportData: false, remove: false } }
        ]
    };

    /* Permission keys rendered in the Roles & Permissions matrix. */
    /* Legacy seed values below are discarded before application startup. */
    DEMO.auditLogs = [
        { id: "LOG-0001", action: "Approved a team registration", subject: "TR-2026-001",
            actor: "Administrator (placeholder)", module: "Team Registrations",
            timestamp: "2026-08-20T09:22", type: "Approval" },
        { id: "LOG-0002", action: "Published a tournament record", subject: "TRN-01",
            actor: "Tournament manager (placeholder)", module: "Tournaments",
            timestamp: "2026-08-20T08:05", type: "Publish" },
        { id: "LOG-0003", action: "Requested a correction on a registration", subject: "TR-2026-005",
            actor: "Registration officer (placeholder)", module: "Team Registrations",
            timestamp: "2026-08-19T16:48", type: "Update" },
        { id: "LOG-0004", action: "Reviewed a payment", subject: "ANG-PAY-0003",
            actor: "Finance officer (placeholder)", module: "Payments",
            timestamp: "2026-08-19T15:12", type: "Review" },
        { id: "LOG-0005", action: "Created a fixture", subject: "FIX-008",
            actor: "Tournament manager (placeholder)", module: "Fixtures",
            timestamp: "2026-08-19T11:02", type: "Create" },
        { id: "LOG-0006", action: "Flagged a fixture schedule clash", subject: "FIX-004",
            actor: "System check (demonstration)", module: "Fixtures",
            timestamp: "2026-08-19T11:00", type: "Warning" },
        { id: "LOG-0007", action: "Entered a match result", subject: "RES-002",
            actor: "Administrator (placeholder)", module: "Results",
            timestamp: "2026-08-18T17:26", type: "Create" },
        { id: "LOG-0008", action: "Published an announcement", subject: "ANN-04",
            actor: "Content editor (placeholder)", module: "Announcements",
            timestamp: "2026-08-18T10:00", type: "Publish" },
        { id: "LOG-0009", action: "Updated the permission matrix", subject: "ROLE-04",
            actor: "Super admin (placeholder)", module: "Roles & Permissions",
            timestamp: "2026-08-17T14:35", type: "Update" },
        { id: "LOG-0010", action: "Exported a financial report", subject: "financial-reports",
            actor: "Finance officer (placeholder)", module: "Financial Reports",
            timestamp: "2026-08-16T09:10", type: "Export" },
        { id: "LOG-0011", action: "Deactivated an admin user account", subject: "USR-06",
            actor: "Super admin (placeholder)", module: "Admin Users",
            timestamp: "2026-08-15T13:40", type: "Update" },
        { id: "LOG-0012", action: "Changed championship settings", subject: "timezone",
            actor: "Administrator (placeholder)", module: "System Settings",
            timestamp: "2026-08-14T08:55", type: "Update" }
    ];

    /* Competition rules per category, shared with the public rules page. */
    DEMO.rules = window.AngutsaRules.map(function (rule) {
        return JSON.parse(JSON.stringify(rule));
    });

    /* Legacy seed values below are discarded before application startup. */
    DEMO.tasks = [
        { id: "TSK-01", label: "Review team registration TR-2026-005",
            detail: "Manager identification outstanding", view: "team-registrations", done: false },
        { id: "TSK-02", label: "Confirm payment ANG-PAY-0003",
            detail: "Awaiting finance review", view: "payments", done: false },
        { id: "TSK-03", label: "Resolve a player eligibility query",
            detail: "PR-2026-004 \u2014 youth age query", view: "player-registrations", done: false },
        { id: "TSK-04", label: "Re-schedule a postponed fixture",
            detail: "FIX-004 requires a new date", view: "fixtures", done: false },
        { id: "TSK-05", label: "Publish the youth league draft result",
            detail: "Requires a confirmed score", view: "results", done: true }
    ];

    /* Legacy seed values below are discarded before application startup. */
    DEMO.activity = [
        { id: "ACT-01", text: "Team registration approved",
            detail: "Kiserian Rangers \u2014 TR-2026-001", time: "2026-08-20T09:22",
            tone: "green", icon: "clipboardCheck" },
        { id: "ACT-02", text: "Tournament published",
            detail: "Angutsa Men's Championship", time: "2026-08-20T08:05",
            tone: "purple", icon: "trophy" },
        { id: "ACT-03", text: "Payment reviewed",
            detail: "ANG-PAY-0003 recorded as pending", time: "2026-08-19T15:12",
            tone: "amber", icon: "wallet" },
        { id: "ACT-04", text: "Fixture clash flagged",
            detail: "Two fixtures share a venue and kickoff time", time: "2026-08-19T11:00",
            tone: "red", icon: "calendarX" },
        { id: "ACT-05", text: "Announcement published",
            detail: "Payment review schedule", time: "2026-08-18T10:00",
            tone: "blue", icon: "megaphone" },
        { id: "ACT-06", text: "Settings updated",
            detail: "Default timezone confirmed as Africa/Nairobi", time: "2026-08-14T08:55",
            tone: "purple", icon: "settings" }
    ];

    /* Legacy seed values below are discarded before application startup. */
    DEMO.series = {
        registrations: [
            { label: "Mar", teams: 3, players: 34 },
            { label: "Apr", teams: 5, players: 52 },
            { label: "May", teams: 8, players: 96 },
            { label: "Jun", teams: 11, players: 124 },
            { label: "Jul", teams: 6, players: 70 },
            { label: "Aug", teams: 9, players: 101 }
        ],
        matchActivity: [
            { label: "Matchday 1", played: 4, scheduled: 4 },
            { label: "Matchday 2", played: 3, scheduled: 5 },
            { label: "Matchday 3", played: 1, scheduled: 7 },
            { label: "Matchday 4", played: 0, scheduled: 8 }
        ]
    };

    Object.keys(DEMO).forEach(function (key) {
        if (Array.isArray(DEMO[key])) DEMO[key] = [];
    });
    DEMO.meta = { demo: false, label: "Live data pending", currency: "KES" };
    DEMO.series = { registrations: [], matchActivity: [] };

    var managerSubmissionRecords = [];

    function teamManagerIdentityKey(email, fallback) {
        var normalizedEmail = String(email || "").trim().toLowerCase();
        return normalizedEmail
            ? "email:" + normalizedEmail
            : "registration:" + String(fallback || "").trim().toLowerCase();
    }

    /* -------------------------------------------------------
       5. Application state
       ------------------------------------------------------- */

    var state = {
        view: "dashboard",
        role: "",
        admin: null,
        permissions: Object.create(null),
        permissionCatalog: [],
        permissionsLoaded: false,
        emailSender: {},
        prefs: readPrefs(),
        lists: {},
        sidebarOpen: false,
        settingsSection: "branding",
        standingsTournament: "TRN-01",
        standingsCategory: "CAT-01",
        reportTournament: "all",
        reportFrom: "2026-01-01",
        reportTo: "2026-12-31",
        financeTournament: "all",
        rulesCategory: "CAT-01",
        rulesAcknowledgments: { ruleId: "", loading: false, data: null, error: "" },
        ruleReminderSending: false,
        searchQuery: "",
        managementTournament: "TRN-01",
        managementStage: "groups",
        fixtureStartDate: "",
        fixtureKickoffTime: "15:00",
        fixtureVenue: "",
        fixtureStageId: "",
        fixtureGroup: "",
        fixtureRound: ""
    };

    var permissionEditor = {
        user: null,
        permissions: [],
        original: Object.create(null),
        search: "",
        saving: false
    };

    function hasAdminPermission(key) {
        return state.role === "platform_owner" ||
            (state.permissionsLoaded && state.permissions[key] === "allow");
    }

    function viewPermissionKey(view) {
        var permissions = {
            dashboard: "dashboard.view",
            tournaments: "tournaments.view",
            "tournament-management": "tournaments.view",
            categories: "categories.view",
            teams: "teams.view",
            players: "players.view",
            "team-registrations": "registrations.view",
            "player-registrations": "players.view",
            fixtures: "fixtures.view",
            matches: "matches.view",
            "live-match": "results.view",
            results: "results.view",
            standings: "standings.view",
            rules: "rules.view",
            payments: "payments.view",
            "payment-records": "payments.view",
            "financial-reports": "reports.view",
            media: "media.view",
            reports: "reports.view",
            notifications: "notifications.view"
        };
        return permissions[view] || "";
    }

    function canAccessView(view) {
        if (state.role === "platform_owner") return true;
        if (["team-managers", "users", "roles", "audit-logs", "settings", "announcements"]
            .indexOf(view) !== -1) return false;
        var permission = viewPermissionKey(view);
        return Boolean(permission && hasAdminPermission(permission));
    }

    function firstAccessibleView() {
        var items = allNavItems();
        for (var i = 0; i < items.length; i += 1) {
            if (canAccessView(items[i].view)) return items[i].view;
        }
        return "dashboard";
    }

    function permissionEditorIsDirty() {
        return permissionEditor.permissions.some(function (permission) {
            return permission.state !== (permissionEditor.original[permission.key] || "unset");
        });
    }

    var TOURNAMENT_MANAGEMENT_GROUPS = [];
    var tournamentManagement = [];

    function publicTournamentIdFor(adminTournamentId) {
        var tournament = byId(DEMO.tournaments, adminTournamentId);
        return tournament ? tournament.publicId || tournament.id : adminTournamentId;
    }

    function publicGoalScorerName(player) {
        var name = String(player.name || "").trim();
        var category = byId(DEMO.categories, player.categoryId);
        if (!category) {
            var team = byId(DEMO.teams, player.teamId);
            category = team ? byId(DEMO.categories, team.categoryId) : null;
        }
        return category && category.ageMax !== null && Number(category.ageMax) < 18
            ? initials(name) : name;
    }

    function managementGroupsConfigured(record) {
        if (!record || !record.groupsCreated || !Array.isArray(record.groupNames) ||
            !record.groupNames.length) return false;

        var teams = approvedManagementTeams(record.tournamentId);
        var counts = Object.create(null);
        record.groupNames.forEach(function (name) { counts[name] = 0; });
        if (teams.length < record.groupNames.length) return false;

        var everyTeamAssigned = teams.every(function (team) {
            var group = record.teamGroups && record.teamGroups[team.id];
            if (!group || !Object.prototype.hasOwnProperty.call(counts, group)) return false;
            counts[group] += 1;
            return true;
        });

        return everyTeamAssigned && record.groupNames.every(function (name) {
            return counts[name] >= 1;
        });
    }

    function managementRecord(tournamentId, create) {
        var record = tournamentManagement.filter(function (item) {
            return item.tournamentId === tournamentId;
        })[0];
        if (!record && create) {
            var tournament = byId(DEMO.tournaments, tournamentId);
            record = {
                tournamentId: tournamentId,
                publicTournamentId: publicTournamentIdFor(tournamentId),
                groupNames: [],
                groupIdsByName: {},
                teamGroups: {},
                matches: [],
                tieBreakOrders: {},
                qualifiersConfirmed: false,
                semifinalsConfirmed: false,
                thirdPlacePlayoffSkipped: false,
                finalConfirmed: false,
                championConfirmed: false,
                championTeamId: "",
                runnerUpTeamId: "",
                originalTournamentStatus: tournament ? tournament.status : "active"
            };
            tournamentManagement.push(record);
        }
        return record || null;
    }

    function approvedManagementTeams(tournamentId) {
        return DEMO.teams.filter(function (team) {
            return team.tournamentId === tournamentId &&
                normalise(team.registrationStatus) === "approved";
        }).sort(function (a, b) { return teamName(a.id).localeCompare(teamName(b.id)); });
    }

    function managementMatchId(tournamentId, matchId) {
        return "TM-" + tournamentId + "-" + matchId;
    }

    function managementStandings(record, groupName) {
        var teams = approvedManagementTeams(record.tournamentId).filter(function (team) {
            return record.teamGroups[team.id] === groupName;
        }).map(function (team) { return { id: team.id }; });

        var results = record.matches.filter(function (match) {
            return match.stage === "group" && match.group === groupName && match.confirmed &&
                match.homeScore !== null && match.homeScore !== undefined &&
                match.awayScore !== null && match.awayScore !== undefined;
        }).map(function (match) {
            return {
                homeId: match.homeId, awayId: match.awayId,
                homeScore: match.homeScore, awayScore: match.awayScore
            };
        });

        return window.AngutsaStandings.build(teams, results, {
            manualOrder: record.tieBreakOrders[groupName] || {},
            nameOf: teamName
        });
    }

    function suggestedStageParticipants(record, stage) {
        if (stage.participantSource === "approved_teams") {
            return approvedManagementTeams(record.tournamentId).map(function (team) { return team.id; });
        }
        if (stage.participantSource === "group_positions") {
            var count = Number(stage.qualification && stage.qualification.qualifiersPerGroup);
            var positions = stage.qualification && Array.isArray(stage.qualification.positions)
                ? stage.qualification.positions
                : Array.from({ length: count }, function (_item, index) { return index + 1; });
            return record.groupNames.reduce(function (teamIds, groupName) {
                var rows = managementStandings(record, groupName);
                positions.forEach(function (position) {
                    if (rows[position - 1]) teamIds.push(rows[position - 1].teamId);
                });
                return teamIds;
            }, []);
        }
        if (stage.participantSource === "overall_standings") {
            var tournament = byId(DEMO.tournaments, record.tournamentId);
            return computeStandings(record.tournamentId, tournament ? tournament.categoryId : "")
                .slice(0, Number(stage.qualification && stage.qualification.count))
                .map(function (row) { return row.teamId || row.id; });
        }
        if (stage.participantSource === "match_winners" ||
            stage.participantSource === "match_losers") {
            var previousStage = record.stageDraft && record.stageDraft.slice(0, stage.position)
                .filter(function (item) {
                    return item.included && item.type !== "third-place-playoff";
                }).pop();
            var fixtureIds = stage.qualification && Array.isArray(stage.qualification.matchIds) &&
                stage.qualification.matchIds.length
                ? stage.qualification.matchIds
                : previousStage ? DEMO.fixtures.filter(function (fixture) {
                    return fixture.stageId === previousStage.id;
                }).map(function (fixture) { return fixture.id; }) : [];
            return fixtureIds.reduce(function (teamIds, fixtureId) {
                var fixture = byId(DEMO.fixtures, fixtureId);
                if (!fixture || !fixture.published ||
                    fixture.homeScore === null || fixture.awayScore === null) return teamIds;
                var match = {
                    homeId: fixture.homeId,
                    awayId: fixture.awayId,
                    homeScore: fixture.homeScore,
                    awayScore: fixture.awayScore,
                    stage: fixture.stage,
                    tieBreakMethod: fixture.tieBreakMethod,
                    homeExtraTime: fixture.homeExtraTimeScore,
                    awayExtraTime: fixture.awayExtraTimeScore,
                    homePenalties: fixture.homePenaltiesScore,
                    awayPenalties: fixture.awayPenaltiesScore
                };
                var winner = managementWinner(match);
                if (!winner) return teamIds;
                teamIds.push(stage.participantSource === "match_winners"
                    ? winner : winner === fixture.homeId ? fixture.awayId : fixture.homeId);
                return teamIds;
            }, stage.participantSource === "match_winners" && previousStage &&
                previousStage.pairing && Array.isArray(previousStage.pairing.pairings)
                ? previousStage.pairing.pairings.reduce(function (teamIds, pairing) {
                    if (Array.isArray(pairing.teamIds) && pairing.teamIds.length === 1) {
                        teamIds.push(pairing.teamIds[0]);
                    }
                    return teamIds;
                }, []) : []);
        }
        return [];
    }

    function sameManagementStats(a, b) {
        return window.AngutsaStandings.sameRecord(a, b);
    }

    function managementGroupTie(record, groupName) {
        var rows = managementStandings(record, groupName);
        if (rows.length < 2) return null;
        var start = 0;
        while (start < rows.length) {
            var end = start + 1;
            while (end < rows.length && sameManagementStats(rows[start], rows[end])) end += 1;
            if (start <= 1 && end > 1 && end - start > 1) {
                return {
                    rows: rows.slice(start, end),
                    positions: rows.slice(start, end).map(function (row, index) {
                        return start + index + 1;
                    })
                };
            }
            start = end;
        }
        return null;
    }

    function managementTieResolved(record, groupName) {
        var tie = managementGroupTie(record, groupName);
        if (!tie) return true;
        var order = record.tieBreakOrders[groupName] || {};
        var positions = {};
        return tie.rows.every(function (row) {
            var position = Number(order[row.teamId]);
            if (tie.positions.indexOf(position) === -1 || positions[position]) return false;
            positions[position] = true;
            return true;
        }) && Object.keys(positions).length === tie.positions.length;
    }

    function managementGroupComplete(record, groupName) {
        var groupTeams = approvedManagementTeams(record.tournamentId).filter(function (team) {
            return record.teamGroups[team.id] === groupName;
        });
        var teamCount = groupTeams.length;
        if (teamCount < 2) return false;
        var required = teamCount * (teamCount - 1) / 2;
        var matches = record.matches.filter(function (match) {
            return match.stage === "group" && match.group === groupName;
        });
        if (matches.length !== required || !matches.every(function (match) { return match.confirmed; })) {
            return false;
        }
        var pairings = {};
        var teamIds = groupTeams.map(function (team) { return team.id; });
        return matches.every(function (match) {
            if (teamIds.indexOf(match.homeId) === -1 || teamIds.indexOf(match.awayId) === -1 ||
                match.homeId === match.awayId) return false;
            var pair = [match.homeId, match.awayId].sort().join(":");
            if (pairings[pair]) return false;
            pairings[pair] = true;
            return true;
        }) && Object.keys(pairings).length === required;
    }

    function managementAllGroupsComplete(record) {
        return record.groupNames.length > 0 && record.groupNames.every(function (name) {
            return managementGroupComplete(record, name);
        });
    }

    function managementFixturePlan(record) {
        var teams = approvedManagementTeams(record.tournamentId);
        if (!record.groupsCreated || !record.groupNames.length ||
            teams.length < record.groupNames.length ||
            teams.some(function (team) { return !record.teamGroups[team.id]; })) {
            return {
                ready: false,
                teams: [],
                reason: "Finish the tournament group setup and save every approved team's group first."
            };
        }
        var counts = Object.create(null);
        record.groupNames.forEach(function (groupName) { counts[groupName] = 0; });
        var invalidGroup = false;
        teams.forEach(function (team) {
            if (Object.prototype.hasOwnProperty.call(counts, record.teamGroups[team.id])) {
                counts[record.teamGroups[team.id]] += 1;
            } else {
                invalidGroup = true;
            }
        });
        if (invalidGroup || record.groupNames.some(function (groupName) {
            return counts[groupName] < 1;
        })) {
            return {
                ready: false,
                teams: [],
                reason: "Every configured group needs at least one approved team."
            };
        }
        return {
            ready: true,
            teams: teams.map(function (team) { return team.id; }),
            reason: ""
        };
    }

    function managementQualifiers(record) {
        if (!managementAllGroupsComplete(record)) return { ready: false, teams: [], reason: "Confirm every group-stage match first." };
        var teams = [];
        for (var i = 0; i < record.groupNames.length; i += 1) {
            var groupName = record.groupNames[i];
            if (!managementTieResolved(record, groupName)) {
                return { ready: false, teams: [], reason: "Resolve the tied standings in " + groupName + " before qualifying teams." };
            }
            var rows = managementStandings(record, groupName);
            if (rows.length < 2) return { ready: false, teams: [], reason: groupName + " needs at least two allocated teams." };
            teams.push({ teamId: rows[0].teamId, group: groupName, position: 1 });
            teams.push({ teamId: rows[1].teamId, group: groupName, position: 2 });
        }
        return { ready: true, teams: teams, reason: "" };
    }

    /* Per-view list state (search text, filters, sort and page).
       Created lazily so each module remembers its own controls. */
    function listState(view) {
        if (!state.lists[view]) {
            state.lists[view] = { q: "", filters: {}, sort: { key: "", dir: "asc" }, page: 1 };
        }
        return state.lists[view];
    }

    function resetListState(view) {
        state.lists[view] = { q: "", filters: {}, sort: { key: "", dir: "asc" }, page: 1 };
    }

    /* -------------------------
       Lookups
       ------------------------- */

    function categoryName(id) {
        var found = byId(DEMO.categories, id);
        return found ? found.name : "Unassigned category";
    }

    function tournamentName(id) {
        var found = byId(DEMO.tournaments, id);
        return found ? found.name + " " + found.season : "Unassigned tournament";
    }

    function teamName(id) {
        var found = byId(DEMO.teams, id);
        return found ? found.name : "Unassigned team";
    }

    function playerName(id) {
        var found = byId(DEMO.players, id);
        return found ? found.name : "Unassigned player";
    }

    function fixtureLabel(id) {
        var fixture = byId(DEMO.fixtures, id);
        if (!fixture) return "Fixture removed";
        return teamName(fixture.homeId) + " v " + teamName(fixture.awayId);
    }

    /* -------------------------
       Derived demonstration figures
       ------------------------- */

    function metrics() {
        return {
            tournaments: DEMO.tournaments.length,
            activeTournaments: countWhere(DEMO.tournaments, "status", "active"),
            teams: DEMO.teams.length,
            players: DEMO.players.length,
            pendingTeamRegistrations: countPending(DEMO.teamRegistrations),
            playerRegistrations: DEMO.playerRegistrations.length,
            upcomingFixtures: DEMO.fixtures.filter(function (fixture) {
                return fixture.status === "scheduled" || fixture.status === "draft";
            }).length,
            completedFixtures: countWhere(DEMO.fixtures, "status", "completed"),
            fixtures: DEMO.fixtures.length,
            pendingPayments: countWhere(DEMO.payments, "status", "pending"),
            confirmedPayments: countWhere(DEMO.payments, "status", "confirmed"),
            unread: unreadCount(),
            openTasks: DEMO.tasks.filter(function (task) { return !task.done; }).length,
            draftResults: countWhere(DEMO.results, "state", "draft")
        };
    }

    /* -------------------------------------------------------
       Registration fees
       -------------------------------------------------------
       The registration fee is set on the tournament when it is
       created or edited (see FORM_CONFIG.tournaments). Every team
       registered for that tournament owes exactly that amount, so
       the balance stays open until recorded payments clear it in
       full. Only money the finance office has recorded counts;
       payments still awaiting review never clear a balance.
       ------------------------------------------------------- */

    var FEE_RECEIVED_STATUSES = ["confirmed", "partial"];
    var FEE_PENDING_STATUSES = ["pending"];

    function tournamentFee(tournamentId) {
        var tournament = byId(DEMO.tournaments, tournamentId);
        return tournament ? toNumber(tournament.registrationFee) : 0;
    }

    /* A team whose registration was rejected owes no fee. */
    function teamOwesRegistrationFee(team) {
        return Boolean(team) && normalise(team.registrationStatus) !== "rejected";
    }

    function feePaymentsFor(teamId, tournamentId) {
        return DEMO.payments.filter(function (payment) {
            return payment.teamId === teamId && payment.tournamentId === tournamentId;
        });
    }

    function feeAmountFor(records, statuses, excludeId) {
        return sum(records.filter(function (payment) {
            return payment.id !== excludeId && statuses.indexOf(normalise(payment.status)) > -1;
        }), "amount");
    }

    /* Everything the interface needs to say whether one team has cleared
       the fee for one tournament. `excludeId` lets a payment be edited
       without its previous value being counted twice. */
    function feeAccountFor(teamId, tournamentId, excludeId) {
        var fee = tournamentFee(tournamentId);
        var records = feePaymentsFor(teamId, tournamentId);
        var paid = feeAmountFor(records, FEE_RECEIVED_STATUSES, excludeId);
        var pending = feeAmountFor(records, FEE_PENDING_STATUSES);
        var balance = Math.max(0, fee - paid);
        var status = "unpaid";

        if (!teamOwesRegistrationFee(byId(DEMO.teams, teamId))) status = "not-required";
        else if (fee === 0) status = "no-fee";
        else if (balance === 0) status = "cleared";
        else if (paid > 0) status = "part-paid";
        else if (pending > 0) status = "awaiting-review";

        return {
            fee: fee,
            paid: paid,
            pending: pending,
            balance: balance,
            status: status,
            cleared: status === "cleared" || status === "no-fee"
        };
    }

    var FEE_STATUS_LABEL = {
        cleared: "Cleared",
        "part-paid": "Partly paid",
        "awaiting-review": "Awaiting review",
        unpaid: "Unpaid",
        "no-fee": "No fee",
        "not-required": "Not applicable"
    };

    var FEE_STATUS_TONE = {
        cleared: "approved",
        "part-paid": "partial",
        "awaiting-review": "pending",
        unpaid: "overdue",
        "no-fee": "neutral",
        "not-required": "neutral"
    };

    function feeStatusBadge(account) {
        return statusBadge(FEE_STATUS_TONE[account.status] || "neutral",
            FEE_STATUS_LABEL[account.status] || account.status);
    }

    /* Ledger totals for any set of registered teams. Received money is
       derived from the balances so an overpayment on one team can never
       hide a shortfall on another. */
    function feeLedgerFor(teams) {
        var totals = {
            teams: 0, expected: 0, outstanding: 0, received: 0,
            cleared: 0, awaitingReview: 0, notApplicable: 0
        };

        teams.forEach(function (team) {
            var account = feeAccountFor(team.id, team.tournamentId);

            if (account.status === "not-required") {
                totals.notApplicable += 1;
                return;
            }

            totals.teams += 1;
            totals.expected += account.fee;
            totals.outstanding += account.balance;
            if (account.cleared) totals.cleared += 1;
            if (account.pending > 0 && !account.cleared) totals.awaitingReview += 1;
        });

        totals.received = Math.max(0, totals.expected - totals.outstanding);
        return totals;
    }

    function registeredTeams() {
        return DEMO.teams.filter(function (team) { return Boolean(team.tournamentId); });
    }

    function teamsForTournament(tournamentId) {
        return DEMO.teams.filter(function (team) { return team.tournamentId === tournamentId; });
    }

    function expectedTotal() {
        return feeLedgerFor(registeredTeams()).expected;
    }

    function paidTotal() {
        return feeLedgerFor(registeredTeams()).received;
    }

    function outstandingTotal() {
        return feeLedgerFor(registeredTeams()).outstanding;
    }

    /* Standings come from the shared engine (js/standings-engine.js), the
       same one every public page uses. Official standings must come from
       the backend once it is connected. */
    function computeStandings(tournamentId, categoryId) {
        var management = managementRecord(tournamentId, false);
        if (management && management.groupsCreated) {
            var managedRows = [];
            management.groupNames.forEach(function (groupName) {
                managementStandings(management, groupName).forEach(function (row, index) {
                    row.group = groupName;
                    row.position = index + 1;
                    managedRows.push(row);
                });
            });
            return managedRows;
        }

        var teams = DEMO.teams.filter(function (team) {
            return team.tournamentId === tournamentId && team.categoryId === categoryId;
        }).map(function (team) { return { id: team.id }; });

        var results = DEMO.results.filter(function (result) {
            if (String(result.state).toLowerCase() !== "published") return false;
            var fixture = byId(DEMO.fixtures, result.fixtureId);
            return !!fixture && fixture.tournamentId === tournamentId && fixture.categoryId === categoryId;
        });

        return window.AngutsaStandings.build(teams, results, { autoCreate: true, nameOf: teamName });
    }

    /* Warns when a fixture would double-book a team or a venue and
       kickoff slot. Returns an array of readable messages. */
    function detectFixtureConflicts(candidate) {
        var warnings = [];

        if (candidate.homeId && candidate.homeId === candidate.awayId) {
            warnings.push("The selected home and away teams are the same team.");
        }

        DEMO.fixtures.forEach(function (fixture) {
            if (candidate.id && fixture.id === candidate.id) return;
            if (fixture.status === "cancelled") return;

            var sameSlot = candidate.kickoff && fixture.kickoff === candidate.kickoff;
            if (!sameSlot) return;

            var sameVenue = candidate.venue &&
                normalise(fixture.venue) === normalise(candidate.venue);
            var clashTeam = "";
            if (candidate.homeId === fixture.homeId || candidate.homeId === fixture.awayId) {
                clashTeam = candidate.homeId;
            } else if (candidate.awayId === fixture.homeId || candidate.awayId === fixture.awayId) {
                clashTeam = candidate.awayId;
            }

            if (sameVenue) {
                warnings.push("Venue clash: " + candidate.venue + " already has " + fixture.id +
                    " at " + formatDateTime(candidate.kickoff) + ".");
            }
            if (clashTeam) {
                warnings.push("Team clash: " + teamName(clashTeam) + " is already scheduled at " +
                    formatDateTime(candidate.kickoff) + " (" + fixture.id + ").");
            }
        });

        return warnings;
    }

    /* Demonstrates an approval/rejection workflow on a record. */
    function logAction() {
        /* Only audit events returned by the backend are displayed. */
    }

    /* -------------------------------------------------------
       6. Dialogs, toasts and confirmation
       ------------------------------------------------------- */

    var TOAST_ICONS = { success: "checkCircle", info: "info", warning: "alert", error: "alert" };

    function toast(message, tone) {
        var region = $("#toastRegion");
        if (!region) return;

        var kind = tone || "info";
        var node = document.createElement("div");
        node.className = "toast toast-" + kind;
        node.setAttribute("role", kind === "error" ? "alert" : "status");
        node.innerHTML = icon(TOAST_ICONS[kind] || "info") +
            "<p>" + esc(message) + "</p>" +
            '<button type="button" class="toast-close" aria-label="Dismiss message">' +
            icon("close") + "</button>";

        region.appendChild(node);

        var remove = function () {
            node.classList.add("is-leaving");
            window.setTimeout(function () {
                if (node.parentNode) node.parentNode.removeChild(node);
            }, 200);
        };

        on($(".toast-close", node), "click", remove);
        window.setTimeout(remove, kind === "error" ? 10000 : 6000);
    }

    var lastFocused = null;

    function closeModal() {
        var host = $("#modalHost");
        if (host) host.innerHTML = "";
        document.body.classList.remove("modal-open");
        if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
        lastFocused = null;
    }

    /* Opens a dialog. config: { title, subtitle, body, footer,
       size ("", "is-wide", "is-narrow"), onMount(t, close) } */
    function openModal(config) {
        var host = $("#modalHost");
        if (!host) return null;

        lastFocused = document.activeElement;

        var root = document.createElement("div");
        root.className = "modal";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        root.setAttribute("aria-label", config.title || "Dialog");
        root.innerHTML =
            '<div class="modal-dialog ' + esc(config.size || "") + '" tabindex="-1">' +
            '<div class="modal-header"><div><h2>' + esc(config.title || "") + "</h2>" +
            (config.subtitle ? "<p>" + esc(config.subtitle) + "</p>" : "") +
            "</div>" +
            '<button type="button" class="modal-close" data-action="close-modal" ' +
            'aria-label="Close dialog">' + icon("close") + "</button></div>" +
            '<div class="modal-body">' + (config.body || "") + "</div>" +
            (config.footer ? '<div class="modal-footer">' + config.footer + "</div>" : "") +
            "</div>";

        host.innerHTML = "";
        host.appendChild(root);
        document.body.classList.add("modal-open");

        /* Clicking the backdrop (but not the dialog) closes the modal. */
        on(root, "mousedown", function (event) {
            if (event.target === root) closeModal();
        });

        var dialog = $(".modal-dialog", root);
        var focusTarget = $("[data-autofocus]", dialog) ||
            $("input:not([type=hidden]), select, textarea", dialog) ||
            $("button", dialog);
        if (focusTarget) focusTarget.focus();

        if (typeof config.onMount === "function") config.onMount(root, closeModal);

        paintIcons(root);
        return root;
    }

    /* Promise-based confirmation used before every destructive action. */
    function confirmDialog(options) {
        var opts = options || {};
        return new Promise(function (resolve) {
            openModal({
                title: opts.title || "Please confirm",
                subtitle: opts.subtitle || "",
                size: "is-narrow",
                body: '<div class="form-alert" data-tone="' + esc(opts.tone || "warning") + '">' +
                    icon(opts.tone === "error" ? "alert" : "info") +
                    "<p>" + esc(opts.message || "This action needs confirmation.") + "</p></div>",
                footer: '<button type="button" class="btn btn-outline" data-confirm="no">' +
                    esc(opts.cancelLabel || "Cancel") + "</button>" +
                    '<button type="button" class="btn ' +
                    (opts.tone === "error" ? "btn-danger" : "btn-primary") +
                    '" data-confirm="yes" data-autofocus>' +
                    esc(opts.confirmLabel || "Confirm") + "</button>",
                onMount: function (root) {
                    on($('[data-confirm="yes"]', root), "click", function () {
                        closeModal();
                        resolve(true);
                    });
                    on($('[data-confirm="no"]', root), "click", function () {
                        closeModal();
                        resolve(false);
                    });
                }
            });
        });
    }

    /* -------------------------------------------------------
       7. Forms and validation
       -------------------------------------------------------
       One declarative field list per module drives both the create
       and edit dialogs, so validation and layout stay consistent.
       ------------------------------------------------------- */

    var STATUS_OPTIONS = {
        tournaments: ["Draft", "Upcoming", "Active", "Completed", "Archived"],
        categories: ["Active", "Draft", "Archived"],
        teams: ["Approved", "Pending", "Under review", "Rejected"],
        players: ["Registered"],
        fixtures: ["Draft", "Scheduled", "Postponed", "Cancelled", "Completed", "Live"],
        matches: ["Draft", "Scheduled", "Live", "Postponed", "Completed", "Cancelled"],
        payments: ["Pending", "Confirmed", "Partial", "Rejected", "Refunded"],
        media: ["Draft", "Published", "Unpublished"],
        announcements: ["Draft", "Published", "Archived"],
        users: ["Pending", "Active", "Disabled", "Suspended"],
        rules: ["Draft", "Published"]
    };

    function optionList(values) {
        return values.map(function (value) {
            return { value: value, label: value };
        });
    }

    function seasonOptions() {
        var currentYear = eatCurrentYear();
        var years = [];
        for (var year = currentYear - 10; year <= currentYear + 5; year += 1) {
            years.push(String(year));
        }
        return optionList(years);
    }

    function categoryOptions() {
        return DEMO.categories.map(function (category) {
            return { value: category.id, label: category.name };
        });
    }

    function tournamentOptions() {
        return DEMO.tournaments.map(function (tournament) {
            return { value: tournament.id, label: tournament.name + " " + tournament.season };
        });
    }

    function teamOptions() {
        return DEMO.teams.map(function (team) {
            return { value: team.id, label: team.name };
        });
    }

    /* Banner images are chosen from assets already in the project, so the
       admin only offers images the public pages can actually load. */
    function bannerOptions() {
        return [{ value: "", label: "No banner image" }].concat(
            ["hero.png", "hero1.jpg", "hero2.jpg", "poster.png", "logo.png"].map(function (file) {
                return { value: "/images/" + file, label: file };
            }));
    }

    function mediaImageOptions() {
        var files = [
            "Image 1.jpeg", "image 2.jpeg", "image 3.jpeg", "image 4.jpeg",
            "image 5.jpeg", "image 6.jpeg", "image 7.jpeg", "image 8.jpeg",
            "image 9.jpeg", "Image 10.jpeg", "image 11.jpeg",
            "hero.png", "hero1.jpg", "hero2.jpg", "poster.png", "logo.png"
        ];
        return [{ value: "", label: "No image" }].concat(files.map(function (file) {
            return { value: "/images/" + encodeURIComponent(file), label: file };
        }));
    }

    function mediaImageUrl(file) {
        if (!file) return "";
        if (String(file).indexOf("media/") !== 0) return file;
        var base = window.AngutsaPlatformConfig &&
            String(window.AngutsaPlatformConfig.apiBaseUrl || "").replace(/\/+$/, "");
        return base ? base + "/api/v1/media/" + file : "";
    }

    function privateMediaImageMarkup(file, title, status) {
        if (String(file || "").indexOf("media/") === 0 &&
            normalise(status) !== "published") {
            return '<span data-media-placeholder aria-hidden="true">' + icon("image") + "</span>" +
                '<img hidden data-admin-media-key="' + esc(file.slice("media/".length)) +
                    '" alt="' + esc(title) + '" loading="lazy">';
        }
        return '<img src="' + esc(mediaImageUrl(file)) + '" alt="' + esc(title) + '" loading="lazy">';
    }

    function loadPrivateMediaImages(container) {
        if (!container || !window.AngutsaPlatform ||
            typeof window.AngutsaPlatform.requestBlob !== "function") return;
        $$("img[data-admin-media-key]", container).forEach(function (image) {
            if (image.dataset.loading === "true") return;
            image.dataset.loading = "true";
            var mediaKey = image.getAttribute("data-admin-media-key");
            window.AngutsaPlatform.requestBlob("/admin/media/files/" +
                encodeURIComponent(mediaKey))
                .then(function (blob) {
                    if (image.getAttribute("data-admin-media-key") !== mediaKey) return;
                    image.src = URL.createObjectURL(blob);
                    image.hidden = false;
                    var placeholder = image.parentNode &&
                        image.parentNode.querySelector("[data-media-placeholder]");
                    if (placeholder) placeholder.remove();
                })
                .catch(function (error) {
                    console.error("A private gallery image could not be loaded.", error);
                    var placeholder = image.parentNode &&
                        image.parentNode.querySelector("[data-media-placeholder]");
                    if (placeholder) {
                        placeholder.textContent = "Preview unavailable";
                    } else {
                        image.alt = "Image preview unavailable";
                        image.hidden = false;
                    }
                });
        });
    }

    var FORM_CONFIG = {
        tournaments: {
            singular: "Tournament",
            icon: "trophy",
            fields: [
                { name: "name", label: "Tournament name", type: "text", required: true, full: true },
                { name: "season", label: "Season", type: "select", required: true,
                    options: seasonOptions },
                { name: "categoryId", label: "Category", type: "select", required: true, options: categoryOptions },
                { name: "format", label: "Format", type: "text", required: true,
                    placeholder: "Group stage + knockout",
                    hint: "Public description of the format shown on the tournament card." },
                { name: "startDate", label: "Start date", type: "date", required: true },
                { name: "endDate", label: "End date", type: "date" },
                { name: "registrationOpens", label: "Registration opens", type: "date", required: true },
                { name: "registrationCloses", label: "Registration closes", type: "date",
                    hint: "Shown on the public tournament card as the closing date." },
                { name: "venue", label: "Primary venue", type: "text", required: true },
                { name: "location", label: "Location", type: "text",
                    placeholder: "Kiserian, Kajiado County",
                    hint: "Town and county, shown beside the venue on the public site." },
                { name: "teamCap", label: "Team capacity", type: "number", min: 2, max: 64 },
                { name: "registrationFee", label: "Registration fee (KES)", type: "number",
                    required: true, min: 0, max: 1000000, step: 100,
                    hint: "The amount every team must pay to register. Each registered team owes " +
                        "this in full, and the balance stays open until recorded payments clear it. " +
                        "Enter 0 for a free competition." },
                { name: "status", label: "Status", type: "generated", required: true,
                    hint: "Automatically set from the tournament dates. Use the archive action in the tournament register to archive a competition." },
                { name: "banner", label: "Banner image", type: "image",
                    hint: "Choose a project image or upload a JPG, PNG or WebP image up to 5 MB." },
                { name: "publicId", label: "Public reference", type: "generated",
                    hint: "Generated from the public page slug." },
                { name: "slug", label: "Public page slug", type: "generated", full: true,
                    hint: "Generated from the tournament name and season." },
                { name: "overview", label: "Public overview", type: "textarea", full: true,
                    hint: "Summary shown on the public tournament card and detail page." },
                { name: "prizeInformation", label: "Prize information (optional)",
                    type: "textarea", full: true,
                    hint: "Shown on the public tournament page when provided. Leave blank if prize details are not announced." }
            ]
        },
        categories: {
            singular: "Category",
            icon: "layers",
            fields: [
                { name: "name", label: "Category name", type: "text", required: true, full: true },
                { name: "code", label: "Short code", type: "generated" },
                { name: "ageGroup", label: "Age group label", type: "text", required: true,
                    placeholder: "Youth (13 to 17)",
                    hint: "Shown in the public categories table and on the eligibility panel." },
                { name: "gender", label: "Classification", type: "select", required: true,
                    options: optionList(["Men", "Women", "Boys", "Girls", "Mixed"]) },
                { name: "guardianConsent", label: "Guardian consent required for every player",
                    type: "checkbox", full: true },
                { name: "status", label: "Status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.categories) },
                { name: "publicId", label: "Public reference", type: "generated",
                    hint: "Generated from the category name." },
                { name: "description", label: "Description", type: "textarea", full: true }
            ]
        },
        teams: {
            singular: "Team",
            icon: "shield",
            fields: [
                { name: "name", label: "Team name", type: "text", required: true, full: true },
                { name: "shortName", label: "Short name", type: "text", required: true, placeholder: "KIS" },
                { name: "categoryId", label: "Category", type: "select", required: true, options: categoryOptions },
                { name: "tournamentId", label: "Tournament", type: "select", required: true, options: tournamentOptions },
                { name: "group", label: "Group or pool", type: "text" },
                { name: "location", label: "Home location", type: "text" },
                { name: "squadSize", label: "Squad size", type: "number", min: 0, max: 60 },
                { name: "registrationStatus", label: "Registration status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.teams) },
                { name: "manager", label: "Team manager", type: "text", full: true,
                    hint: "Enter the current manager details." },
                { name: "contact", label: "Contact details", type: "text", full: true,
                    hint: "Real contact data must be handled by the backend with appropriate consent." }
            ]
        },
        players: {
            singular: "Player",
            icon: "player",
            fields: [
                { name: "name", label: "Player name", type: "text", required: true, full: true,
                    hint: "Player information, especially for minors, is sensitive." },
                { name: "teamId", label: "Team", type: "select", required: true, options: teamOptions },
                { name: "jersey", label: "Jersey number", type: "number", required: true, min: 0, max: 99 },
                { name: "position", label: "Position", type: "select", required: true,
                    options: optionList(["Goalkeeper", "Defender", "Midfielder", "Forward", "Winger"]) },
                { name: "categoryId", label: "Category", type: "select", required: true, options: categoryOptions },
                { name: "yearOfBirth", label: "Year of birth", type: "number", min: 1980, max: 2020,
                    hint: "Stored instead of a full date of birth to limit personal data." },
                { name: "eligibility", label: "Eligibility note", type: "select", required: true,
                    options: optionList(["Eligible", "Under review", "Age query", "Ineligible"]) },
                { name: "guardianConsent", label: "Guardian consent recorded", type: "checkbox", full: true,
                    hint: "Required for every player in a youth category before they take part." },
                { name: "submittedOn", label: "Submitted on", type: "date" }
            ]
        },
        fixtures: {
            singular: "Fixture",
            icon: "calendar",
            fields: [
                { name: "tournamentId", label: "Tournament", type: "select", required: true, options: tournamentOptions },
                { name: "categoryId", label: "Category", type: "select", required: true, options: categoryOptions },
                { name: "round", label: "Round or matchday", type: "text", required: true },
                { name: "group", label: "Group or pool", type: "text" },
                { name: "homeId", label: "Home team", type: "select", required: true, options: teamOptions },
                { name: "awayId", label: "Away team", type: "select", required: true, options: teamOptions },
                { name: "kickoff", label: "Kickoff date and time", type: "datetime-local", required: true },
                { name: "venue", label: "Venue", type: "text", required: true, full: true },
                { name: "status", label: "Status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.fixtures) }
            ]
        },
        results: {
            singular: "Result",
            icon: "flag",
            fields: [
                { name: "fixtureId", label: "Fixture", type: "select", required: true, full: true,
                    options: function () {
                        return DEMO.fixtures.map(function (fixture) {
                            return { value: fixture.id, label: fixture.id + " \u2014 " + fixtureLabel(fixture.id) };
                        });
                    } },
                { name: "homeScore", label: "Home score", type: "number", required: true,
                    min: 0, step: 1, hint: "Whole numbers only." },
                { name: "awayScore", label: "Away score", type: "number", required: true,
                    min: 0, step: 1, hint: "Whole numbers only." },
                { name: "state", label: "Publication state", type: "select", required: true,
                    options: optionList(["Draft", "Published"]) },
                { name: "enteredOn", label: "Date entered", type: "date" },
                { name: "notes", label: "Notes", type: "textarea", full: true }
            ]
        },
        payments: {
            singular: "Payment",
            icon: "wallet",
            fields: [
                { name: "reference", label: "Payment reference", type: "generated", required: true, full: true,
                    hint: "Generated automatically for this payment record." },
                { name: "teamId", label: "Team or payer", type: "select", required: true, options: teamOptions },
                { name: "tournamentId", label: "Tournament", type: "select", required: true, options: tournamentOptions },
                { name: "amount", label: "Amount", type: "number", required: true, min: 0, step: 100,
                    hint: "Record only money already received. It is counted immediately; partial payments leave a balance due." },
                { name: "currency", label: "Currency", type: "select", required: true,
                    options: optionList(["KES", "TZS", "UGX", "USD"]) },
                { name: "method", label: "Payment method", type: "select", required: true,
                    options: optionList(["M-Pesa", "Bank transfer", "Cash", "Cheque"]) },
                { name: "paidOn", label: "Payment date", type: "date", required: true }
            ]
        },
        matches: {
            singular: "Match",
            icon: "whistle",
            fields: [
                { name: "fixtureId", label: "Fixture", type: "select", required: true, full: true,
                    options: function () {
                        return DEMO.fixtures.map(function (fixture) {
                            return { value: fixture.id, label: fixture.id + " \u2014 " + fixtureLabel(fixture.id) };
                        });
                    } },
                { name: "status", label: "Match status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.matches) },
                { name: "referee", label: "Referee", type: "text",
                    hint: "Enter the assigned officials." },
                { name: "assistantOne", label: "Assistant referee one", type: "text" },
                { name: "assistantTwo", label: "Assistant referee two", type: "text" },
                { name: "fourthOfficial", label: "Fourth official", type: "text" },
                { name: "notes", label: "Match administration notes", type: "textarea", full: true }
            ]
        },
        media: {
            singular: "Media item",
            icon: "image",
            fields: [
                { name: "mediaType", label: "Media type", type: "select", required: true,
                    options: optionList(["Image", "Video"]) },
                { name: "title", label: "Media title", type: "text", required: true, full: true },
                { name: "category", label: "Category", type: "select", required: true,
                    options: optionList(["Match action", "Supporters", "Training", "Branding",
                        "Venue", "Officials", "Community"]) },
                { name: "status", label: "Publication status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.media) },
                { name: "file", label: "Image or video thumbnail", type: "media-image",
                    options: mediaImageOptions,
                    hint: "Choose a project image or upload a JPG, PNG or WebP image up to 5 MB." },
                { name: "videoUrl", label: "Video URL", type: "url", full: true,
                    hint: "For videos, use a direct MP4, WebM or OGG link, or a YouTube or Vimeo URL." },
                { name: "addedOn", label: "Date added", type: "date" },
                { name: "caption", label: "Caption", type: "textarea", full: true }
            ]
        },
        announcements: {
            singular: "Announcement",
            icon: "megaphone",
            fields: [
                { name: "title", label: "Title", type: "text", required: true, full: true },
                { name: "audience", label: "Target audience", type: "select", required: true,
                    options: optionList(["All teams", "Youth categories", "Match officials",
                        "Team managers", "Finance officers"]) },
                { name: "date", label: "Publish or schedule date", type: "date", required: true },
                { name: "status", label: "Status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.announcements) },
                { name: "message", label: "Message", type: "textarea", required: true, full: true,
                    hint: "Message delivery is not connected to the backend yet." }
            ]
        },
        users: {
            singular: "User access",
            icon: "user",
            fields: [
                { name: "name", label: "Display name", type: "text", required: true, full: true },
                { name: "email", label: "Email address", type: "email", required: true },
                { name: "role", label: "Assigned role", type: "select", required: true,
                    options: function () {
                        return [
                            { value: "platform_owner", label: "Platform owner" },
                            { value: "tournament_admin", label: "Tournament administrator" },
                            { value: "team_manager", label: "Team manager" }
                        ];
                    } },
                { name: "tournamentIds", label: "Tournament scope", type: "multiselect",
                    options: tournamentOptions, full: true,
                    hint: "Required for tournament administrators. Hold Ctrl or Command to select multiple." },
                { name: "status", label: "Account status", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.users) },
            ]
        },
        rules: {
            singular: "Rules document",
            icon: "book",
            fields: [
                { name: "categoryId", label: "Competition category", type: "select", required: true, full: true,
                    options: categoryOptions },
                { name: "title", label: "Document title", type: "text", required: true, full: true },
                { name: "state", label: "State", type: "select", required: true,
                    options: optionList(STATUS_OPTIONS.rules) },
                { name: "updated", label: "Last updated", type: "date" },
                { name: "body", label: "Rules and regulations", type: "textarea", required: true, full: true }
            ]
        }
    };

    /* Maps a module key to the data array it edits and the id prefix
       used when creating new records. */
    var DATA_KEY = {
        tournaments: "tournaments",
        categories: "categories",
        teams: "teams",
        players: "players",
        fixtures: "fixtures",
        matches: "matches",
        results: "results",
        payments: "payments",
        media: "media",
        announcements: "announcements",
        users: "users",
        rules: "rules"
    };

    var ID_PREFIX = {
        tournaments: "TRN-", categories: "CAT-", teams: "TEAM-", players: "PLR-",
        fixtures: "FIX-", matches: "MCH-", results: "RES-", payments: "PAY-",
        media: "MED-", announcements: "ANN-", users: "USR-", rules: "RUL-"
    };

    function fieldMarkup(field, value) {
        var id = "field-" + field.name;
        var required = field.required ? " required" : "";
        var describedBy = field.hint ? ' aria-describedby="' + id + '-hint"' : "";
        var current = value === null || value === undefined ? "" : value;

        if (field.type === "checkbox") {
            return '<div class="form-field is-full">' +
                '<label class="check-field" for="' + id + '">' +
                '<input type="checkbox" id="' + id + '" name="' + esc(field.name) + '"' +
                (current ? " checked" : "") + ">" +
                '<span class="check-field-text"><strong>' + esc(field.label) + "</strong>" +
                (field.hint ? "<span>" + esc(field.hint) + "</span>" : "") +
                "</span></label></div>";
        }

        var control;
        if (field.type === "generated") {
            control = '<input class="form-input" type="text" id="' + id + '" name="' +
                esc(field.name) + '" value="' + esc(current) + '" readonly aria-readonly="true"' +
                describedBy + ">";
        } else if (field.type === "image") {
            var options = typeof field.options === "function" ? field.options() : bannerOptions();
            var imageOptions = options.map(function (option) {
                var selected = String(option.value) === String(current) ? " selected" : "";
                return '<option value="' + esc(option.value) + '"' + selected + ">" +
                    esc(option.label) + "</option>";
            }).join("");
            control = '<div class="image-upload-field">' +
                '<select class="form-select" id="' + id + '" data-banner-asset' +
                    describedBy + ' aria-label="Choose an existing banner image">' +
                    imageOptions +
                "</select>" +
                '<input type="hidden" name="' + esc(field.name) + '" value="' + esc(current) + '" data-banner-value>' +
                '<label class="image-upload-control" for="' + id + '-upload">Upload an image' +
                    '<input class="form-input" type="file" id="' + id + '-upload" data-banner-upload' +
                    ' accept="image/jpeg,image/png,image/webp" aria-describedby="' + id + '-hint">' +
                "</label>" +
                '<img class="image-upload-preview" data-banner-preview src="' + esc(mediaImageUrl(current)) + '"' +
                    (current ? "" : " hidden") + ' alt="Tournament banner preview">' +
                "</div>";
        } else if (field.type === "media-image") {
            var imageOptions = typeof field.options === "function" ? field.options() : [];
            if (current && !imageOptions.some(function (option) {
                return String(option.value) === String(current);
            })) {
                imageOptions.push({ value: current, label: "Current uploaded image" });
            }
            var privatePreviewKey = /^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(current)
                ? current.slice("media/".length) : "";
            control = '<div class="image-upload-field">' +
                '<select class="form-select" id="' + id + '" name="' + esc(field.name) + '"' +
                    describedBy + ' aria-label="Choose an existing image">' +
                    imageOptions.map(function (option) {
                        return '<option value="' + esc(option.value) + '"' +
                            (String(option.value) === String(current) ? " selected" : "") + ">" +
                            esc(option.label) + "</option>";
                    }).join("") +
                "</select>" +
                '<label class="image-upload-control" for="' + id + '-upload">Upload an image' +
                    '<input class="form-input" type="file" id="' + id + '-upload" data-media-upload' +
                    ' accept="image/jpeg,image/png,image/webp" aria-label="Upload a JPG, PNG or WebP image">' +
                "</label>" +
                '<img class="image-upload-preview" data-media-preview' +
                    (privatePreviewKey ? ' data-admin-media-key="' + esc(privatePreviewKey) + '"' : "") +
                    (privatePreviewKey ? "" : ' src="' + esc(mediaImageUrl(current)) + '"') +
                    (current && !privatePreviewKey ? "" : " hidden") + ' alt="Media image preview">' +
                "</div>";
        } else if (field.type === "select" || field.type === "multiselect") {
            var options = typeof field.options === "function" ? field.options() : (field.options || []);
            var selectedValues = Array.isArray(current) ? current : [String(current)];
            control = '<select class="form-select" id="' + id + '" name="' + esc(field.name) + '"' +
                (field.type === "multiselect" ? " multiple size=\"6\"" : "") +
                required + describedBy + ">" +
                (field.type === "select" ? '<option value="">Select an option</option>' : "") +
                options.map(function (option) {
                    var selected = selectedValues.some(function (value) {
                        return normalise(option.value) === normalise(value);
                    }) ? " selected" : "";
                    return '<option value="' + esc(option.value) + '"' + selected + ">" +
                        esc(option.label) + "</option>";
                }).join("") +
                "</select>";
        } else if (field.type === "textarea") {
            control = '<textarea class="form-textarea" id="' + id + '" name="' + esc(field.name) + '"' +
                required + describedBy + ">" + esc(current) + "</textarea>";
        } else {
            var type = field.type === "datetime-local" ? "datetime-local" : field.type;
            var bounds = "";
            if (field.min !== undefined) bounds += ' min="' + esc(field.min) + '"';
            if (field.max !== undefined) bounds += ' max="' + esc(field.max) + '"';
            if (field.step !== undefined) bounds += ' step="' + esc(field.step) + '"';
            control = '<input class="form-input" type="' + esc(type) + '" id="' + id + '" name="' +
                esc(field.name) + '" value="' + esc(current) + '"' +
                (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : "") +
                bounds + required + describedBy + ">";
        }

        return '<div class="form-field' + (field.full ? " is-full" : "") + '">' +
            '<label for="' + id + '">' + esc(field.label) +
            (field.required ? ' <span aria-hidden="true">*</span>' : "") + "</label>" +
            control +
            (field.hint ? '<p class="form-hint" id="' + id + '-hint">' + esc(field.hint) + "</p>" : "") +
            '<p class="field-error" id="' + id + '-error"></p>' +
            "</div>";
    }

    function formMarkup(moduleKey, record) {
        var config = FORM_CONFIG[moduleKey];
        var fields = config.fields.map(function (field) {
            var value = record ? record[field.name] : "";
            if (record && field.type === "datetime-local") value = dateTimeLocalValue(value);
            if (!record) {
                if (field.name === "currency") value = state.prefs.currency;
                if (field.name === "season") value = String(eatCurrentYear());
                if (moduleKey === "payments" && field.name === "reference") {
                    value = nextPaymentReference();
                }
                if (field.type === "date" || field.type === "datetime-local") value = "";
            }
            return fieldMarkup(field, value);
        }).join("");

        return '<form class="form" id="recordForm" data-module="' + esc(moduleKey) + '" novalidate>' +
            '<div class="form-alert" data-tone="info">' + icon("info") +
            '<p>Changes are submitted to the live backend and are only shown as saved after it confirms them.</p></div>' +
            (moduleKey === "payments"
                ? '<div class="form-alert" data-tone="warning" id="feeContextNote"></div>'
                : "") +
            '<div class="form-grid">' + fields + "</div>" +
            "</form>";
    }

    function controlValue(control) {
        if (control.type === "checkbox") return control.checked;
        if (control.multiple) {
            return Array.prototype.slice.call(control.selectedOptions).map(function (option) {
                return option.value;
            });
        }
        if (control.type === "number") {
            return control.value === "" ? "" : Number(control.value);
        }
        return String(control.value || "").trim();
    }

    function collectForm(formEl) {
        var payload = {};
        $$("input, select, textarea", formEl).forEach(function (control) {
            if (!control.name || control.type === "file") return;
            payload[control.name] = controlValue(control);
        });
        return payload;
    }

    function isSupportedVideoUrl(value) {
        var parsed;
        try {
            parsed = new URL(String(value), window.location.href);
        } catch (error) {
            return false;
        }

        if (parsed.username || parsed.password) return false;

        var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        var sameOrigin = parsed.origin === window.location.origin;
        var allowedTransport = parsed.protocol === "https:" ||
            (sameOrigin && (parsed.protocol === "http:" || parsed.protocol === "file:"));
        if (!allowedTransport) return false;

        if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return true;

        if (host === "youtube.com" || host === "m.youtube.com" ||
            host === "youtube-nocookie.com" || host === "youtu.be") {
            var youtubeId = host === "youtu.be"
                ? parsed.pathname.split("/").filter(Boolean)[0]
                : parsed.searchParams.get("v") ||
                    (parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/) || [])[1];
            return Boolean(youtubeId && /^[A-Za-z0-9_-]{6,20}$/.test(youtubeId));
        }

        if (host === "vimeo.com" || host === "player.vimeo.com") {
            var vimeoId = (parsed.pathname.match(/\/(?:video\/)?(\d+)\/?$/) || [])[1];
            return Boolean(vimeoId);
        }

        return false;
    }

    function validatePayload(moduleKey, payload, id) {
        var config = FORM_CONFIG[moduleKey];
        var errors = {};

        config.fields.forEach(function (field) {
            var value = payload[field.name];

            if (field.required && (value === "" || value === null || value === undefined)) {
                errors[field.name] = field.label + " is required.";
                return;
            }
            if (value === "" || value === null || value === undefined) return;

            if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value))) {
                errors[field.name] = "Enter a valid email address.";
            }

            if (field.type === "number") {
                var num = Number(value);
                if (isNaN(num)) {
                    errors[field.name] = "Enter a number.";
                } else if (field.step === 1 && Math.floor(num) !== num) {
                    errors[field.name] = "Whole numbers only.";
                } else if (num < 0) {
                    errors[field.name] = "Value cannot be negative.";
                } else if (field.min !== undefined && num < field.min) {
                    errors[field.name] = "Value must be at least " + field.min + ".";
                } else if (field.max !== undefined && num > field.max) {
                    errors[field.name] = "Value must be at most " + field.max + ".";
                }
            }

            if ((field.type === "date" || field.type === "datetime-local") && !toDate(value)) {
                errors[field.name] = "Enter a valid date.";
            }
        });

        /* Rules that a single field cannot express. */
        if (moduleKey === "tournaments" && payload.startDate && payload.endDate) {
            var start = toDate(payload.startDate);
            var end = toDate(payload.endDate);
            if (start && end && end < start) {
                errors.endDate = "The end date cannot be before the start date.";
            }
        }

        if (moduleKey === "fixtures" && payload.homeId && payload.homeId === payload.awayId) {
            errors.awayId = "The away team must differ from the home team.";
        }

        if (moduleKey === "users" && payload.role === "tournament_admin" &&
            (!Array.isArray(payload.tournamentIds) || !payload.tournamentIds.length)) {
            errors.tournamentIds = "Select at least one tournament for a tournament administrator.";
        }

        if (moduleKey === "media") {
            var mediaForm = $("#recordForm");
            var mediaUpload = mediaForm && $("[data-media-upload]", mediaForm);
            if (normalise(payload.mediaType) === "video") {
                if (!payload.videoUrl) {
                    errors.videoUrl = "A video URL is required for video media.";
                } else if (!isSupportedVideoUrl(payload.videoUrl)) {
                    errors.videoUrl = "Use a direct MP4, WebM or OGG URL, or a valid YouTube or Vimeo link.";
                }
            } else if (!payload.file && !(mediaUpload && mediaUpload.files && mediaUpload.files.length)) {
                errors.file = "Choose an image asset for a gallery item.";
            }
        }

        if (moduleKey === "results") {
            if (payload.homeScore === "" || payload.awayScore === "") {
                errors.homeScore = "Both scores are required before a result can be recorded.";
            } else if (Number(payload.homeScore) < 0 || Number(payload.awayScore) < 0) {
                errors.homeScore = "Scores cannot be negative.";
            } else if (Math.floor(Number(payload.homeScore)) !== Number(payload.homeScore) ||
                Math.floor(Number(payload.awayScore)) !== Number(payload.awayScore)) {
                errors.awayScore = "Scores must be whole numbers.";
            }
        }

        /* A registration fee can only be cleared by money the finance office
           has recorded, so a payment may never take a balance below zero. */
        if (moduleKey === "payments" && payload.teamId && payload.tournamentId) {
            var feeAccount = feeAccountFor(payload.teamId, payload.tournamentId, id);

            if (feeAccount.fee > 0 && payload.amount !== "" &&
                payload.amount !== undefined && payload.amount !== null) {
                if (feeAccount.balance <= 0) {
                    errors.amount = teamName(payload.teamId) + " has already cleared the " +
                        formatMoney(feeAccount.fee) + " registration fee for " +
                        tournamentName(payload.tournamentId) + ". No further payment is due.";
                } else if (Number(payload.amount) > feeAccount.balance) {
                    errors.amount = "The outstanding balance is " + formatMoney(feeAccount.balance) +
                        ". Record the balance or less so the fee clears in full without overpayment.";
                }
            }
        }

        return errors;
    }

    function showFormErrors(formEl, errors) {
        $$(".form-field", formEl).forEach(function (wrapper) {
            wrapper.classList.remove("has-error");
        });

        Object.keys(errors).forEach(function (name) {
            var control = $('[name="' + name + '"]', formEl);
            if (!control) return;
            var wrapper = control.closest(".form-field");
            if (wrapper) wrapper.classList.add("has-error");
            var message = $("#" + control.id + "-error", formEl);
            if (message) message.textContent = errors[name];
        });

        var first = Object.keys(errors)[0];
        if (first) {
            var target = $('[name="' + first + '"]', formEl);
            if (target) {
                target.focus();
                if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
            }
        }
    }

    function nextId(moduleKey) {
        var key = DATA_KEY[moduleKey];
        var prefix = ID_PREFIX[moduleKey] || moduleKey.toUpperCase() + "-";
        var highest = 0;

        DEMO[key].forEach(function (record) {
            var match = /(\d+)$/.exec(String(record.id));
            if (match) {
                var parsed = parseInt(match[1], 10);
                if (!isNaN(parsed) && parsed > highest) highest = parsed;
            }
        });

        var next = String(highest + 1);
        var pad = prefix === "TEAM-" ? 2 : 3;
        while (next.length < pad) next = "0" + next;
        return prefix + next;
    }

    function nextPaymentReference() {
        var highest = 0;
        DEMO.payments.forEach(function (payment) {
            var match = /(\d+)$/.exec(String(payment.reference || ""));
            if (match) highest = Math.max(highest, parseInt(match[1], 10));
        });
        var next = String(highest + 1);
        while (next.length < 4) next = "0" + next;
        return "ANG-PAY-" + next;
    }

    function modulePermissionKey(moduleKey, action) {
        var resource = {
            "team-registrations": "registrations",
            "payment-records": "payments",
            "financial-reports": "reports",
            "player-registrations": "players"
        }[moduleKey] || moduleKey;
        var operation = action === "delete" &&
            (resource === "categories" || resource === "tournaments")
            ? "archive" : action;
        var permission = resource + "." + operation;
        return state.permissionCatalog.some(function (item) { return item.key === permission; })
            ? permission
            : "";
    }

    function moduleIsEditable(moduleKey, action) {
        var operation = action || "edit";
        if (state.role === "platform_owner") {
            return ["categories", "tournaments", "teams", "players", "team-registrations",
                "fixtures", "matches", "results", "payments", "rules", "media", "users"]
                .indexOf(moduleKey) !== -1;
        }
        if (["categories", "teams", "users", "media"].indexOf(moduleKey) !== -1) return false;
        if (moduleKey === "tournaments" && operation === "create") return false;
        if (moduleKey === "players" || moduleKey === "player-registrations") return false;
        var permission = modulePermissionKey(moduleKey, operation);
        return Boolean(permission && hasAdminPermission(permission));
    }

    /* Extra derived values the administrator should not have to type. */
    function decorateRecord(moduleKey, payload, record) {
        var today = eatToday();

        if (moduleKey === "teams" && !record.registeredOn) payload.registeredOn = today;
        if (moduleKey === "players" && !record.submittedOn) payload.submittedOn = today;
        if (moduleKey === "players") payload.registrationStatus = "registered";
        if (moduleKey === "media") {
            if (!record.addedOn) payload.addedOn = today;
            payload.mediaType = normalise(payload.mediaType) === "video" ? "video" : "image";
            payload.videoUrl = payload.mediaType === "video" ? payload.videoUrl : "";
            payload.file = payload.file || "";
        }

        if (moduleKey === "categories") {
            var generatedCategory = categoryGeneratedValues(payload, record);
            var unchangedAgeGroup = record.id && payload.ageGroup === record.ageGroup;
            payload.code = generatedCategory.code;
            payload.publicId = generatedCategory.publicId;
            if (!unchangedAgeGroup) {
                var ageBounds = ageBoundsFromLabel(payload.ageGroup);
                payload.ageMin = ageBounds.min;
                payload.ageMax = ageBounds.max;
            }
            payload.entryFee = record.id ? toNumber(record.entryFee) : 0;
        }

        if (moduleKey === "tournaments") {
            /* The registration fee is required, but a blank value falls back
               to the category entry fee so a competition is never free by
               accident. The stored value drives the balance every registered
               team has to clear. */
            if (payload.registrationFee === "" || payload.registrationFee === undefined ||
                payload.registrationFee === null) {
                var category = byId(DEMO.categories, payload.categoryId);
                payload.registrationFee = category ? toNumber(category.entryFee) : 0;
            } else {
                payload.registrationFee = toNumber(payload.registrationFee);
            }
            var generated = tournamentGeneratedValues(payload, record);
            payload.slug = generated.slug;
            payload.publicId = generated.publicId;
            payload.status = generated.status;
            payload.registrationStatus = generated.registrationStatus;
            payload.featured = record.id ? Boolean(record.featured) : true;
            payload.standingsAvailable = record.id ? Boolean(record.standingsAvailable) : false;
        }

        if (moduleKey === "payments") {
            if (!payload.reference) payload.reference = nextPaymentReference();
            if (!record.id) payload.status = "pending";
        }

        if (moduleKey === "results") {
            var fixture = byId(DEMO.fixtures, payload.fixtureId);
            if (fixture) {
                payload.homeId = fixture.homeId;
                payload.awayId = fixture.awayId;
            }
            if (!record.enteredBy) payload.enteredBy = state.prefs.adminName;
            if (!record.enteredOn) payload.enteredOn = today;
        }

        return payload;
    }

    function categoryGeneratedValues(payload, record) {
        var baseSlug = slugify(payload.name || "") || "category";
        var slug = baseSlug;
        var suffix = 2;
        while (DEMO.categories.some(function (category) {
            return category.id !== record.id && category.publicId === "CAT-" + slug.toUpperCase();
        })) {
            slug = baseSlug + "-" + suffix;
            suffix += 1;
        }

        var words = baseSlug.split("-").filter(Boolean);
        var alpha = words.filter(function (word) { return !/^\d+$/.test(word); });
        var numbers = words.filter(function (word) { return /^\d+$/.test(word); });
        var baseCode = alpha.map(function (word) { return word.charAt(0); }).join("") +
            numbers.join("");
        baseCode = (baseCode || baseSlug.replace(/-/g, "").slice(0, 4)).toUpperCase();
        var code = baseCode;
        suffix = 2;
        while (DEMO.categories.some(function (category) {
            return category.id !== record.id && normalise(category.code) === normalise(code);
        })) {
            code = baseCode + suffix;
            suffix += 1;
        }

        return {
            code: code,
            publicId: "CAT-" + slug.toUpperCase()
        };
    }

    function ageBoundsFromLabel(value) {
        var label = String(value || "").toLowerCase();
        var ages = label.match(/\d+/g) || [];
        var numbers = ages.map(function (age) { return Number(age); });
        if (label.indexOf("under") !== -1 && numbers.length === 1) {
            return { min: 0, max: Math.max(0, numbers[0] - 1) };
        }
        return {
            min: numbers.length ? numbers[0] : null,
            max: numbers.length > 1 ? numbers[1] : null
        };
    }

    function tournamentGeneratedValues(payload, record) {
        var baseSlug = slugify((payload.name || "") + "-" + (payload.season || "")) || "tournament";
        var slug = baseSlug;
        var suffix = 2;

        while (DEMO.tournaments.some(function (tournament) {
            return tournament.id !== record.id && tournament.slug === slug;
        })) {
            slug = baseSlug + "-" + suffix;
            suffix += 1;
        }

        var today = toDate(eatToday());
        var startDate = toDate(payload.startDate);
        var endDate = toDate(payload.endDate);
        var status;

        if (record.status && normalise(record.status) === "archived") {
            status = "Archived";
        } else if (!startDate || startDate > today) {
            status = "Upcoming";
        } else if (endDate && endDate < today) {
            status = "Completed";
        } else {
            status = "Active";
        }

        var registrationOpens = toDate(payload.registrationOpens);
        var registrationCloses = toDate(payload.registrationCloses);
        var registrationStatus = "Not opened";
        if (registrationOpens && registrationOpens <= today) {
            registrationStatus = (registrationCloses && registrationCloses < today) ||
                (startDate && startDate <= today) ? "Closed" : "Open";
        }

        return {
            slug: slug,
            publicId: "TRN-" + slug.toUpperCase(),
            status: status,
            registrationStatus: registrationStatus
        };
    }

    function submitAdminUserCreate(form, submitButton) {
        if (!form.reportValidity()) return;
        var payload = collectForm(form);
        var email = String(payload.email || "").trim().toLowerCase();
        var emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        if (!emailValid) {
            $('[name="email"]', form).focus();
            toast("Enter a valid email address.", "error");
            return;
        }
        if (!Array.isArray(payload.tournamentIds) || !payload.tournamentIds.length) {
            $('[name="tournamentIds"]', form).focus();
            toast("Select at least one tournament for this administrator.", "error");
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Creating account…";
        (async function () {
            var platform = window.AngutsaPlatform;
            var identity;
            try {
                identity = await platform.createManagerIdentity(email);
            } catch (error) {
                throw new Error(error && error.message
                    ? error.message
                    : "The Firebase sign-in account could not be created.");
            }

            var createdUser;
            try {
                createdUser = await platform.request("/admin/users", {
                    method: "POST",
                    body: {
                        identityToken: identity.idToken,
                        email: email,
                        name: payload.name,
                        phone: payload.phone || "",
                        tournamentIds: payload.tournamentIds
                    }
                });
            } catch (error) {
                if (error && error.status >= 400 && error.status < 500) {
                    try {
                        await platform.deleteManagerIdentity(identity.idToken);
                    } catch (cleanupError) {
                        console.error("The unused Firebase administrator account could not be removed.",
                            cleanupError);
                        throw new Error((error.message || "The administrator account could not be saved.") +
                            " The unused Firebase account also needs cleanup; contact the platform owner.");
                    }
                    throw error;
                }
                throw new Error((error && error.message
                    ? error.message
                    : "The account could not be confirmed in the championship database.") +
                    " The Firebase account may have been created; check the administrator list before retrying.");
            }

            var refreshError = null;
            try {
                var latest = await requestAdminBootstrap(platform);
                applyAdminBootstrap(latest, state.admin);
            } catch (error) {
                refreshError = error;
            }
            closeModal();
            renderView();
            if (!createdUser || createdUser.emailStatus !== "accepted_by_provider") {
                toast("The admin account was created, but invitation email delivery was not confirmed (" +
                    (createdUser && createdUser.emailStatus || "unknown") +
                    "). The administrator can use Forgot password on the sign-in page.", "warning");
            } else if (refreshError) {
                toast("The admin account and invitation email were sent, but the list could not refresh. Reload the page.",
                    "warning");
            } else {
                toast("Admin account created. An invitation was sent to " + email +
                    " with instructions to set a password from the sign-in page.",
                    "success");
            }
        }()).catch(function (error) {
            submitButton.disabled = false;
            submitButton.textContent = "Create account and send invitation";
            toast(error && error.message
                ? error.message
                : "The admin account could not be created. Please try again.", "error");
        });
    }

    function openAdminUserCreateForm() {
        var tournaments = tournamentOptions();
        var canCreate = tournaments.length > 0;
        var scopeField = fieldMarkup({
            name: "tournamentIds",
            label: "Tournament access",
            type: "multiselect",
            required: true,
            full: true,
            options: tournamentOptions,
            hint: "Select at least one tournament. Hold Ctrl or Command to select multiple."
        }, "");
        openModal({
            title: "Add admin user",
            subtitle: "Create a Tournament Admin account and email an invitation to sign in.",
            size: "is-wide",
            body: '<div class="form-alert" data-tone="info"><p>The account will be active after creation. ' +
                "The invitation directs the administrator to choose Forgot password on the sign-in page. " +
                "Permissions are denied by default and can be assigned in Roles &amp; Permissions.</p></div>" +
                (!canCreate
                    ? '<div class="form-alert" data-tone="error"><p>Create a tournament before adding a scoped administrator.</p></div>'
                    : "") +
                '<form class="form" id="adminUserCreateForm" novalidate><div class="form-grid">' +
                fieldMarkup({
                    name: "name",
                    label: "Full name",
                    type: "text",
                    required: true,
                    full: true
                }, "") +
                fieldMarkup({
                    name: "email",
                    label: "Email address",
                    type: "email",
                    required: true
                }, "") +
                fieldMarkup({
                    name: "phone",
                    label: "Phone number",
                    type: "tel"
                }, "") +
                scopeField + "</div></form>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="submit" class="btn btn-primary" form="adminUserCreateForm" data-autofocus' +
                (canCreate ? "" : " disabled") + '>Create account and send invitation</button>',
            onMount: function (root) {
                var form = $("#adminUserCreateForm", root);
                var submitButton = $('[form="adminUserCreateForm"]', root);
                on(form, "submit", function (event) {
                    event.preventDefault();
                    submitAdminUserCreate(form, submitButton);
                });
            }
        });
    }

    function openRecordForm(moduleKey, id) {
        if (!moduleIsEditable(moduleKey, id ? "edit" : "create")) {
            toast("This module is read-only.", "info");
            return;
        }
        if (moduleKey === "users" && !id) {
            if (state.role !== "platform_owner") {
                toast("Only a Platform Owner can create administrator accounts.", "error");
                return;
            }
            openAdminUserCreateForm();
            return;
        }

        var config = FORM_CONFIG[moduleKey];
        var key = DATA_KEY[moduleKey];
        var record = id ? byId(DEMO[key], id) : null;
        var publishedStageFixture = moduleKey === "fixtures" && record &&
            record.stageId && record.published;

        openModal({
            title: (record ? "Edit " : "Create ") + config.singular.toLowerCase(),
            subtitle: publishedStageFixture
                ? "Only the kickoff and venue can be changed for a published stage fixture."
                : moduleKey === "media"
                ? "Images and media details are saved to the live gallery."
                : "Changes submitted here are saved to the backend.",
            size: "is-wide",
            body: (publishedStageFixture
                ? '<p class="tm-notice is-warning">Its approved stage, pairing, round, group, and status are locked. Changing kickoff requires reschedule permission.</p>'
                : "") + formMarkup(moduleKey, record),
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-save>' +
                icon(record ? "check" : "plus") +
                esc(record ? "Save changes" : "Create record") + "</button>",
            onMount: function (root) {
                var form = $("#recordForm", root);

                if (publishedStageFixture) {
                    ["tournamentId", "categoryId", "round", "group", "homeId", "awayId", "status"]
                        .forEach(function (name) {
                            var control = $('[name="' + name + '"]', form);
                            if (control) control.disabled = true;
                        });
                }

                if (moduleKey === "media") {
                    var mediaTypeControl = $('[name="mediaType"]', form);
                    var mediaImageField = $('[name="file"]', form).closest(".form-field");
                    var mediaUpload = $("[data-media-upload]", form);
                    var mediaPreview = $("[data-media-preview]", form);
                    var videoUrlField = $('[name="videoUrl"]', form).closest(".form-field");

                    function updateMediaFields() {
                        var isVideo = normalise(mediaTypeControl.value) === "video";
                        videoUrlField.hidden = !isVideo;
                        videoUrlField.style.display = isVideo ? "" : "none";
                        mediaImageField.hidden = isVideo;
                        mediaImageField.style.display = isVideo ? "none" : "";
                        if (isVideo && mediaUpload) mediaUpload.value = "";
                    }

                    on(mediaTypeControl, "change", updateMediaFields);
                    on(mediaUpload, "change", function () {
                        var file = mediaUpload.files && mediaUpload.files[0];
                        if (!file) return;
                        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
                            mediaUpload.value = "";
                            toast("Choose a JPG, PNG or WebP image.", "error");
                            return;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                            mediaUpload.value = "";
                            toast("Choose an image no larger than 5 MB.", "error");
                            return;
                        }
                        var reader = new FileReader();
                        reader.onerror = function () {
                            toast("The selected image could not be read. Please try another file.", "error");
                        };
                        reader.onload = function () {
                            mediaPreview.removeAttribute("data-admin-media-key");
                            mediaPreview.src = String(reader.result);
                            mediaPreview.hidden = false;
                        };
                        reader.readAsDataURL(file);
                    });
                    loadPrivateMediaImages(root);
                    updateMediaFields();
                }

                if (moduleKey === "tournaments") {
                    var assetSelect = $("[data-banner-asset]", form);
                    var bannerValue = $("[data-banner-value]", form);
                    var uploadInput = $("[data-banner-upload]", form);
                    var preview = $("[data-banner-preview]", form);
                    var nameControl = $('[name="name"]', form);
                    var seasonControl = $('[name="season"]', form);
                    var startDateControl = $('[name="startDate"]', form);
                    var endDateControl = $('[name="endDate"]', form);
                    var registrationOpensControl = $('[name="registrationOpens"]', form);
                    var registrationClosesControl = $('[name="registrationCloses"]', form);
                    var slugControl = $('[name="slug"]', form);
                    var publicIdControl = $('[name="publicId"]', form);
                    var statusControl = $('[name="status"]', form);

                    function updateGeneratedTournamentFields() {
                        var values = tournamentGeneratedValues({
                            name: nameControl.value,
                            season: seasonControl.value,
                            startDate: startDateControl.value,
                            endDate: endDateControl.value,
                            registrationOpens: registrationOpensControl.value,
                            registrationCloses: registrationClosesControl.value
                        }, record || {});
                        slugControl.value = values.slug;
                        publicIdControl.value = values.publicId;
                        statusControl.value = values.status;
                    }

                    function setBannerPreview(value) {
                        if (!preview) return;
                        preview.hidden = !value;
                        preview.removeAttribute("src");
                        if (value) preview.src = mediaImageUrl(value);
                    }

                    on(assetSelect, "change", function () {
                        bannerValue.value = assetSelect.value;
                        if (uploadInput) uploadInput.value = "";
                        setBannerPreview(bannerValue.value);
                    });

                    [nameControl, seasonControl, startDateControl, endDateControl,
                        registrationOpensControl, registrationClosesControl].forEach(function (control) {
                        on(control, "input", updateGeneratedTournamentFields);
                        on(control, "change", updateGeneratedTournamentFields);
                    });
                    updateGeneratedTournamentFields();

                    on(uploadInput, "change", function () {
                        var file = uploadInput.files && uploadInput.files[0];
                        if (!file) return;
                        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
                            uploadInput.value = "";
                            setBannerPreview(bannerValue.value);
                            toast("Choose a JPG, PNG or WebP image.", "error");
                            return;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                            uploadInput.value = "";
                            setBannerPreview(bannerValue.value);
                            toast("Choose an image no larger than 5 MB.", "error");
                            return;
                        }

                        if (assetSelect) assetSelect.value = "";
                        var reader = new FileReader();
                        reader.onerror = function () {
                            uploadInput.value = "";
                            setBannerPreview(bannerValue.value);
                            toast("The selected image could not be read. Please try another file.", "error");
                        };
                        reader.onload = function () {
                            setBannerPreview(String(reader.result));
                        };
                        reader.readAsDataURL(file);
                    });
                }

                if (moduleKey === "categories") {
                    var categoryNameControl = $('[name="name"]', form);
                    var codeControl = $('[name="code"]', form);
                    var categoryPublicIdControl = $('[name="publicId"]', form);

                    function updateGeneratedCategoryFields() {
                        var values = categoryGeneratedValues({
                            name: categoryNameControl.value
                        }, record || {});
                        codeControl.value = values.code;
                        categoryPublicIdControl.value = values.publicId;
                    }

                    on(categoryNameControl, "input", updateGeneratedCategoryFields);
                    on(categoryNameControl, "change", updateGeneratedCategoryFields);
                    updateGeneratedCategoryFields();
                }

                on(form, "submit", function (event) {
                    event.preventDefault();
                    submitRecord(moduleKey, id, form);
                });

                /* Live, per-field feedback once a control is left. */
                $$("input, select, textarea", form).forEach(function (control) {
                    on(control, "blur", function () {
                        var errors = validatePayload(moduleKey, collectForm(form), id);
                        var wrapper = control.closest(".form-field");
                        var message = $("#" + control.id + "-error", form);
                        var error = errors[control.name];
                        if (wrapper) wrapper.classList.toggle("has-error", Boolean(error));
                        if (message) message.textContent = error || "";
                    });
                });

                on($("[data-save]", root), "click", function () {
                    submitRecord(moduleKey, id, form);
                });

                /* The payment form keeps the registration-fee balance in view,
                   so a team's fee can be cleared exactly without overpaying. */
                if (moduleKey === "payments") {
                    var note = $("#feeContextNote", form);
                    var teamControl = $('[name="teamId"]', form);
                    var tournamentControl = $('[name="tournamentId"]', form);
                    var updateFeeNote = function () {
                        if (!note) return;

                        var amountControl = $('[name="amount"]', form);

                        var teamId = teamControl ? teamControl.value : "";
                        var tournamentId = tournamentControl ? tournamentControl.value : "";
                        var amount = Number(amountControl ? amountControl.value : 0);

                        if (!teamId || !tournamentId) {
                            note.innerHTML = icon("wallet") + "<p>Choose the team and the tournament to " +
                                "see the registration fee and the balance still to clear.</p>";
                            return;
                        }

                        var account = feeAccountFor(teamId, tournamentId, id);
                        var parts = [];

                        if (account.status === "not-required") {
                            parts.push("This team's registration was rejected, so no registration " +
                                "fee is due.");
                        } else if (account.fee === 0) {
                            parts.push("No registration fee is charged for " +
                                tournamentName(tournamentId) + ", so nothing has to be cleared.");
                        } else {
                            parts.push("Registration fee " + formatMoney(account.fee) +
                                " \u00b7 cleared " + formatMoney(account.paid) +
                                " \u00b7 balance " + formatMoney(account.balance) + " to clear.");

                            if (account.pending > 0) {
                                parts.push(formatMoney(account.pending) + " is awaiting review and " +
                                    "does not reduce the balance yet.");
                            }

                            if (amount > 0) {
                                parts.push("Balance after this " + formatMoney(amount) + " entry: " +
                                    formatMoney(Math.max(0, account.balance - amount)) + ".");
                            }
                        }

                        note.innerHTML = icon("wallet") + "<p>" + esc(parts.join(" ")) + "</p>";
                    };

                    on(teamControl, "change", function () {
                        var team = byId(DEMO.teams, teamControl.value);
                        tournamentControl.value = team && team.tournamentId
                            ? team.tournamentId
                            : "";
                        updateFeeNote();
                    });
                    on(form, "change", updateFeeNote);
                    on(form, "input", updateFeeNote);
                    updateFeeNote();
                }
            }
        });
    }

    function submitRecord(moduleKey, id, form) {
        var key = DATA_KEY[moduleKey];
        var payload = collectForm(form);
        var errors = validatePayload(moduleKey, payload, id);

        if (Object.keys(errors).length) {
            showFormErrors(form, errors);
            toast("Please correct the highlighted fields before saving.", "error");
            return;
        }

        if (["categories", "tournaments", "payments", "rules", "users", "fixtures", "media"]
            .indexOf(moduleKey) === -1) {
            toast("This record type is not connected to the backend. Nothing was saved.", "error");
            return;
        }

        var existing = id ? byId(DEMO[key], id) : null;

        if (moduleKey === "fixtures") {
            var warnings = detectFixtureConflicts({
                id: id,
                homeId: payload.homeId,
                awayId: payload.awayId,
                kickoff: payload.kickoff,
                venue: payload.venue
            });
            if (warnings.length) {
                confirmDialog({
                    title: "Scheduling conflict detected",
                    subtitle: "The fixture can still be saved.",
                    tone: "warning",
                    confirmLabel: "Save anyway",
                    message: warnings.join(" ")
                }).then(function (proceeded) {
                    if (proceeded) saveLiveRecord(moduleKey, id, payload, existing);
                });
                return;
            }
            saveLiveRecord(moduleKey, id, payload, existing);
            return;
        }

        if (["categories", "tournaments", "payments", "rules", "users", "media"]
            .indexOf(moduleKey) !== -1) {
            saveLiveRecord(moduleKey, id, payload, existing);
            return;
        }

        toast("This record type is not connected to the backend. Nothing was saved.", "error");
    }

    async function saveLiveRecord(moduleKey, id, payload) {
        var platform = window.AngutsaPlatform;
        if (!platform) {
            toast("The secure API is unavailable. Reload after completing platform configuration.", "error");
            return;
        }
        var uploadedMediaKey = "";
        var uploadedMediaDeletePath = "/admin/media/uploads/";
        try {
            var path;
            var method = id ? "PUT" : "POST";
            var body = payload;
            var headers;
            if (moduleKey === "payments") {
                var registration = DEMO.paymentRegistrations.filter(function (item) {
                    return item.teamId === payload.teamId && item.tournamentId === payload.tournamentId;
                })[0];
                if (!registration) throw new Error("No registration was found for this team and tournament.");
                path = "/admin/payments";
                method = "POST";
                headers = { "Idempotency-Key": "payment-" + crypto.randomUUID() };
                body = {
                    registrationId: registration.id,
                    amount: payload.amount,
                    method: payload.method,
                    reviewNote: payload.reviewNote || ""
                };
            } else if (moduleKey === "users") {
                if (!id) throw new Error("Create the account first, then assign its access role.");
                path = "/admin/users/" + encodeURIComponent(id) + "/role";
                method = "PUT";
                body = {
                    role: payload.role,
                    status: String(payload.status || "").toLowerCase(),
                    tournamentIds: payload.role === "tournament_admin" ? payload.tournamentIds : []
                };
            } else if (moduleKey === "tournaments") {
                var bannerUpload = $("[data-banner-upload]", $("#recordForm"));
                var bannerFile = bannerUpload && bannerUpload.files && bannerUpload.files[0];
                if (bannerFile) {
                    if (bannerFile.size > 5 * 1024 * 1024) {
                        throw new Error("Choose an image no larger than 5 MB.");
                    }
                    if (!/^image\/(jpeg|png|webp)$/.test(bannerFile.type)) {
                        throw new Error("Choose a JPG, PNG or WebP image.");
                    }
                    if (id) {
                        uploadedMediaDeletePath = "/admin/tournaments/" +
                            encodeURIComponent(id) + "/banner-uploads/";
                    }
                    var bannerUploadPath = id
                        ? "/admin/tournaments/" + encodeURIComponent(id) + "/banner-uploads"
                        : "/admin/tournaments/banner-uploads";
                    var uploadedBanner = await platform.request(bannerUploadPath, {
                        method: "POST",
                        body: await bannerFile.arrayBuffer(),
                        contentType: bannerFile.type
                    });
                    uploadedMediaKey = uploadedBanner.key;
                    body = Object.assign({}, payload, { banner: "media/" + uploadedBanner.key });
                }
                path = "/admin/tournaments" + (id ? "/" + encodeURIComponent(id) : "");
            } else if (moduleKey === "media") {
                var mediaUpload = $("[data-media-upload]", $("#recordForm"));
                var uploadFile = mediaUpload && mediaUpload.files && mediaUpload.files[0];
                if (uploadFile) {
                    var uploaded = await platform.request("/admin/media/uploads", {
                        method: "POST",
                        body: await uploadFile.arrayBuffer(),
                        contentType: uploadFile.type
                    });
                    uploadedMediaKey = uploaded.key;
                    payload.file = "media/" + uploaded.key;
                }
                path = "/admin/media/items" + (id ? "/" + encodeURIComponent(id) : "");
            } else {
                path = "/admin/" + moduleKey + (id ? "/" + encodeURIComponent(id) : "");
                if (moduleKey === "rules") {
                    body = {
                        categoryId: payload.categoryId,
                        title: payload.title,
                        body: payload.body,
                        status: payload.state
                    };
                }
            }
            var savedRecord = await platform.request(path, {
                method: method, body: body, headers: headers
            });
            uploadedMediaKey = "";
            var latest = await requestAdminBootstrap(platform);
            applyAdminBootstrap(latest, state.admin);
            closeModal();
            renderView();
            renderNavCounts();
            if (moduleKey === "payments") {
                var paymentStatus = savedRecord && savedRecord.status;
                var paymentMessage;
                var paymentTone;
                if (paymentStatus === "partial") {
                    var replayBalance = Number(savedRecord.balanceDue);
                    if (Number.isFinite(replayBalance)) {
                        paymentMessage = replayBalance > 0
                            ? "Payment received and recorded. Outstanding balance: " +
                                formatMoney(replayBalance) + "."
                            : "Payment received and recorded. The registration fee is now fully cleared.";
                        paymentTone = "success";
                    } else {
                        paymentMessage = "Payment was recorded as partial, but its current balance could not be confirmed.";
                        paymentTone = "warning";
                    }
                } else if (paymentStatus === "confirmed") {
                    paymentMessage = "Payment received and confirmed. The registration fee is fully cleared.";
                    paymentTone = "success";
                } else if (paymentStatus === "rejected") {
                    paymentMessage = "This payment was previously rejected and was not counted toward the registration fee.";
                    paymentTone = "warning";
                } else if (paymentStatus === "pending") {
                    paymentMessage = "This payment record is still pending review and has not been counted as received.";
                    paymentTone = "warning";
                } else {
                    paymentMessage = "The payment was saved, but its status could not be confirmed.";
                    paymentTone = "warning";
                }
                if (savedRecord && savedRecord.registrationApproved) {
                    paymentMessage += " The team registration is approved and player registration is open.";
                } else if (savedRecord && savedRecord.accountActivated) {
                    paymentMessage += " The team-manager account has been activated.";
                }
                if (savedRecord && savedRecord.emailStatus === "accepted_by_provider") {
                    paymentMessage += " The manager was emailed.";
                } else if (savedRecord && savedRecord.emailStatus) {
                    paymentMessage += " The payment was saved, but manager email delivery wasn't confirmed (" +
                        savedRecord.emailStatus + ").";
                    paymentTone = "warning";
                }
                toast(paymentMessage, paymentTone);
            } else {
                toast((id ? "Record updated." : "Record created.") +
                    " Changes are saved to the database.", "success");
            }
        } catch (error) {
            if (uploadedMediaKey) {
                try {
                    await platform.request(uploadedMediaDeletePath +
                        encodeURIComponent(uploadedMediaKey.replace(/^media\//, "")), {
                            method: "DELETE"
                        });
                } catch (cleanupError) {
                    console.error("The uploaded image could not be cleaned up after its record save failed.",
                        cleanupError);
                    toast((error && error.message ? error.message :
                        moduleKey === "tournaments" ? "We couldn't save this tournament." :
                            "We couldn't save this media item.") +
                        " The uploaded image also needs cleanup; please contact an administrator.", "error");
                    return;
                }
            }
            toast(error && error.message ? error.message : "We couldn't save this record. Please try again.", "error");
        }
    }

    function deleteRecord(moduleKey, id, label) {
        var config = FORM_CONFIG[moduleKey];
        if (moduleKey === "users") {
            toast("User accounts cannot be deleted from the administration dashboard.", "info");
            return;
        }
        if (!config || ["categories", "tournaments", "rules", "media"].indexOf(moduleKey) === -1) {
            toast("This archive action is not connected to the live backend yet.", "info");
            return;
        }

        confirmDialog({
            title: "Delete " + config.singular.toLowerCase() + "?",
            tone: "error",
            confirmLabel: "Delete",
            message: moduleKey === "media"
                ? (label || id) + " and its unused uploaded image will be permanently deleted."
                : (label || id) + " will be archived so its audit and registration history remain available."
        }).then(function (confirmed) {
            if (!confirmed) return;

            var deletePath = moduleKey === "media"
                ? "/admin/media/items/" + encodeURIComponent(id)
                : "/admin/" + moduleKey + "/" + encodeURIComponent(id);
            window.AngutsaPlatform.request(deletePath,
                { method: "DELETE" })
                .then(function () { return requestAdminBootstrap(window.AngutsaPlatform); })
                .then(function (latest) {
                    applyAdminBootstrap(latest, state.admin);
                    renderView();
                    renderNavCounts();
                    toast(config.singular + (moduleKey === "media" ? " deleted." : " archived."), "success");
                })
                .catch(function (error) {
                    toast(error && error.message ? error.message : "We couldn't archive this record. Please try again.", "error");
                });
        });
    }

    async function refreshLiveAdminData() {
        var latest = await requestAdminBootstrap(window.AngutsaPlatform);
        applyAdminBootstrap(latest, state.admin);
        renderView();
        renderNavCounts();
        renderNotificationMenu();
    }

    async function archiveTeam(id) {
        var team = byId(DEMO.teams, id);
        if (!team) {
            toast("That team could not be found.", "error");
            return;
        }
        var confirmed = await confirmDialog({
            title: "Archive team?",
            message: team.name + " will be hidden from the Teams tab. Its team record and registration history will remain in the database.",
            confirmLabel: "Archive team",
            tone: "warning"
        });
        if (!confirmed) return;
        try {
            await window.AngutsaPlatform.request("/admin/teams/" +
                encodeURIComponent(id) + "/archive", { method: "PATCH" });
            await refreshLiveAdminData();
            toast(team.name + " was archived.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't archive this team. Please try again.", "error");
        }
    }

    async function updateTournament(tournament, changes, message) {
        try {
            var body = {
                name: tournament.name,
                season: tournament.season,
                categoryId: tournament.categoryId,
                format: tournament.format,
                status: tournament.status,
                venue: tournament.venue,
                location: tournament.location || "",
                startDate: tournament.startDate,
                endDate: tournament.endDate || "",
                registrationOpens: tournament.registrationOpens,
                registrationCloses: tournament.registrationCloses || "",
                teamCap: tournament.teamCap,
                registrationFee: tournament.registrationFee,
                banner: tournament.banner || "",
                featured: tournament.featured,
                overview: tournament.overview || "",
                prizeInformation: tournament.prizeInformation || ""
            };
            Object.keys(changes).forEach(function (key) { body[key] = changes[key]; });
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(tournament.id), { method: "PUT", body: body });
            await refreshLiveAdminData();
            toast(message, "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't update the tournament. Please try again.", "error");
        }
    }

    async function updateRuleStatus(rule, status, message) {
        try {
            await window.AngutsaPlatform.request("/admin/rules/" +
                encodeURIComponent(rule.id), {
                    method: "PUT",
                    body: {
                        categoryId: rule.categoryId,
                        title: rule.title,
                        body: rule.body,
                        status: status
                    }
                });
            await refreshLiveAdminData();
            toast(message, "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't update the rules. Please try again.", "error");
        }
    }

    async function updateLiveMatchStatus(id, status, message) {
        try {
            await window.AngutsaPlatform.request("/admin/matches/" +
                encodeURIComponent(id) + "/status", { method: "PUT", body: { status: status } });
            await refreshLiveAdminData();
            toast(message, "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't update the fixture. Please try again.", "error");
        }
    }

    async function updateLiveUserStatus(id, status, message) {
        try {
            await window.AngutsaPlatform.request("/admin/users/" +
                encodeURIComponent(id) + "/status", { method: "PUT", body: { status: status } });
            await refreshLiveAdminData();
            toast(message, "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't update account access. Please try again.", "error");
        }
    }

    /* -------------------------------------------------------
       8. Shared list, table, filter and pagination renderers
       ------------------------------------------------------- */

    function toolbarMarkup(view, filters) {
        var st = listState(view);
        var fields = (filters || []).map(function (filter) {
            var options = typeof filter.options === "function" ? filter.options() : (filter.options || []);
            var selected = st.filters[filter.name] || "";
            return '<label class="toolbar-field">' +
                '<span class="visually-hidden">Filter by ' + esc(filter.label) + "</span>" +
                '<select class="form-select" data-filter="' + esc(filter.name) + '">' +
                '<option value="">' + esc(filter.allLabel || (filter.label + ": all")) + "</option>" +
                options.map(function (option) {
                    return '<option value="' + esc(option.value) + '"' +
                        (String(option.value) === String(selected) ? " selected" : "") + ">" +
                        esc(option.label) + "</option>";
                }).join("") +
                "</select></label>";
        }).join("");

        var filterMarkup = fields
            ? (view === "tournaments"
                ? '<div class="tournament-filters">' + fields + "</div>"
                : '<div class="toolbar-field">' + fields + "</div>")
            : "";

        return '<div class="toolbar">' +
            '<div class="toolbar-row">' +
            '<label class="toolbar-field toolbar-field-search">' +
            '<span class="visually-hidden">Search records</span>' +
            '<input class="form-input" type="search" data-filter-search ' +
            'placeholder="Search ' + esc(viewTitle(view).toLowerCase()) + '" value="' + esc(st.q) + '">' +
            "</label>" +
            filterMarkup +
            "</div>" +
            '<div class="toolbar-meta">' +
            '<span class="toolbar-count" data-result-count>0 records</span>' +
            '<button type="button" class="link-btn" data-action="clear-filters">Reset search and filters</button>' +
            '<span class="grow"></span>' +
            (hasAdminPermission("reports.export")
                ? '<button type="button" class="btn btn-outline btn-sm" data-action="export-view">' +
                    icon("download") + "Export CSV</button>"
                : "") +
            (view === "players" && hasAdminPermission("reports.export")
                ? '<button type="button" class="btn btn-outline btn-sm" data-action="export-players-pdf" ' +
                    'title="Print or save the filtered player roster as a PDF">' +
                    icon("download") + "Print / Save PDF</button>"
                : "") +
            "</div>" +
            "</div>";
    }

    /* Some filters match a derived value rather than a stored field
       (for example a team's category name), so each filter may supply
       its own accessor. */
    function filterValueFor(view, name, record) {
        var config = LIST_MODULES[view];
        var definitions = (config && config.filters) || [];

        for (var i = 0; i < definitions.length; i += 1) {
            if (definitions[i].name === name) {
                return typeof definitions[i].value === "function"
                    ? definitions[i].value(record)
                    : record[name];
            }
        }

        return record[name];
    }

    /* Applies the view's search text, filters and sort to a record list. */
    function applyListControls(view, records, searchFields, sorters) {
        var st = listState(view);
        var query = normalise(st.q);
        var moduleFilters = LIST_MODULES[view] && LIST_MODULES[view].filters;
        var filterNames = moduleFilters
            ? moduleFilters.map(function (filter) { return filter.name; })
            : Object.keys(st.filters);

        var filtered = records.filter(function (record) {
            var matchesQuery = !query || (searchFields || []).some(function (field) {
                var value = typeof field === "function" ? field(record) : record[field];
                return normalise(value).indexOf(query) !== -1;
            });
            if (!matchesQuery) return false;

            return filterNames.every(function (name) {
                var expected = st.filters[name];
                if (!expected) return true;
                return normalise(filterValueFor(view, name, record)) === normalise(expected);
            });
        });

        if (st.sort.key && sorters && sorters[st.sort.key]) {
            var getter = sorters[st.sort.key];
            filtered = filtered.slice().sort(function (a, b) {
                var left = getter(a);
                var right = getter(b);
                if (typeof left === "number" && typeof right === "number") {
                    return st.sort.dir === "asc" ? left - right : right - left;
                }
                var comparison = String(left).localeCompare(String(right), "en", { numeric: true });
                return st.sort.dir === "asc" ? comparison : -comparison;
            });
        }

        return filtered;
    }

    function sortButton(view, key, label, numeric) {
        var st = listState(view);
        var active = st.sort.key === key;
        return '<button type="button" class="th-sort" data-sort="' + esc(key) + '" aria-sort="' +
            (active ? (st.sort.dir === "asc" ? "ascending" : "descending") : "none") + '">' +
            esc(label) + icon("sort") + "</button>";
    }

    /* Wraps a table so it scrolls horizontally on narrow screens
       instead of forcing the page wider. */
    function tableWrap(caption, headHtml, bodyHtml, extraClass) {
        return '<div class="table-wrap ' + esc(extraClass || "") + '">' +
            '<table class="data-table">' +
            (caption ? "<caption>" + esc(caption) + "</caption>" : "") +
            '<thead><tr>' + headHtml + "</tr></thead>" +
            "<tbody>" + bodyHtml + "</tbody>" +
            "</table></div>";
    }

    function tableMarkup(view, columns, rows, rowRenderer, caption, emptyMessage) {
        if (!rows.length) {
            return emptyState("No matching records",
                emptyMessage || "Adjust the search text or filters to see more records.",
                '<button type="button" class="btn btn-outline btn-sm" data-action="clear-filters">' +
                "Reset search and filters</button>");
        }
        var head = columns.map(function (column) {
            return "<th" + (column.numeric ? ' class="is-numeric"' : "") + ">" +
                (column.sortable === false
                    ? esc(column.label)
                    : sortButton(view, column.key, column.label, column.numeric)) + "</th>";
        }).join("") + '<th class="is-actions">Actions</th>';

        var body = rows.map(function (record) {
            return "<tr>" + rowRenderer(record) + "</tr>";
        }).join("");

        return tableWrap(caption, head, body);
    }

    function paginationMarkup(view, total, shown) {
        var perPage = toNumber(state.prefs.perPage) || 10;
        var pages = Math.max(1, Math.ceil(total / perPage));
        var st = listState(view);
        var current = Math.min(Math.max(1, st.page), pages);
        var buttons = "";

        for (var i = 1; i <= pages; i += 1) {
            if (pages > 7 && i !== 1 && i !== pages && Math.abs(i - current) > 1) {
                if (i === current - 2 || i === current + 2) {
                    buttons += '<span class="page-btn" aria-hidden="true">\u2026</span>';
                }
                continue;
            }
            buttons += '<button type="button" class="page-btn" data-page="' + i + '"' +
                (i === current ? ' aria-current="page"' : "") + ">" + i + "</button>";
        }

        return '<div class="pagination">' +
            '<p class="pagination-info">Showing ' + esc(String(shown)) + " of " + esc(String(total)) +
            " records \u00b7 " + perPage + " per page</p>" +
            '<div class="pagination-pages">' +
            '<button type="button" class="page-btn" data-page="' + (current - 1) + '"' +
            (current === 1 ? " disabled" : "") + ">Previous</button>" +
            buttons +
            '<button type="button" class="page-btn" data-page="' + (current + 1) + '"' +
            (current === pages ? " disabled" : "") + ">Next</button>" +
            "</div></div>";
    }

    function pageSlice(view, records) {
        var perPage = toNumber(state.prefs.perPage) || 10;
        var st = listState(view);
        var pages = Math.max(1, Math.ceil(records.length / perPage));
        st.page = Math.min(Math.max(1, st.page), pages);
        var start = (st.page - 1) * perPage;
        return records.slice(start, start + perPage);
    }

    /* -------------------------------------------------------
       9. CSV export
       ------------------------------------------------------- */

    function csvCell(value) {
        var text = value === null || value === undefined ? "" : String(value);
        if (/[",\n\r]/.test(text)) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    }

    /* Exports the selected records with a header row and source note. */
    function exportCsv(filename, columns, rows) {
        var lines = [];
        lines.push(columns.map(function (column) { return csvCell(column.label); }).join(","));
        rows.forEach(function (row) {
            lines.push(columns.map(function (column) {
                var value = typeof column.value === "function" ? column.value(row) : row[column.key];
                return csvCell(value);
            }).join(","));
        });
        lines.push("");
        lines.push(csvCell("Exported from live Angutsa Championship backend records."));

        downloadText(filename, lines.join("\r\n"));
    }

    function downloadText(filename, text) {
        try {
            /* The BOM keeps Excel happy with UTF-8 characters. */
            var blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8;" });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
            toast("CSV export prepared for download.", "success");
        } catch (error) {
            toast("The browser blocked the download. Copy the table instead.", "error");
        }
    }

    /* -------------------------------------------------------
       10. Charts (hand-built SVG and CSS, no chart library)
       ------------------------------------------------------- */

    /* Line and area chart used for the registration trend. */
    function trendChart(series, valueKey, label) {
        if (!series.length) {
            return emptyState("No registration history yet",
                "Live registration records will appear here when they are added.");
        }
        var width = 640;
        var height = 220;
        var padLeft = 34;
        var padRight = 12;
        var padTop = 16;
        var padBottom = 28;

        var max = series.reduce(function (top, point) {
            return Math.max(top, toNumber(point[valueKey]));
        }, 0);
        var ceiling = max <= 0 ? 1 : Math.ceil(max / 10) * 10;

        var innerWidth = width - padLeft - padRight;
        var innerHeight = height - padTop - padBottom;

        var points = series.map(function (point, index) {
            var x = series.length === 1
                ? padLeft + innerWidth / 2
                : padLeft + (innerWidth * index) / (series.length - 1);
            var y = padTop + innerHeight - (toNumber(point[valueKey]) / ceiling) * innerHeight;
            return { x: x, y: y, point: point };
        });

        var linePath = points.map(function (item, index) {
            return (index === 0 ? "M" : "L") + item.x.toFixed(1) + " " + item.y.toFixed(1);
        }).join(" ");

        var areaPath = linePath +
            " L" + points[points.length - 1].x.toFixed(1) + " " + (padTop + innerHeight) +
            " L" + points[0].x.toFixed(1) + " " + (padTop + innerHeight) + " Z";

        var gridLines = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) {
            var y = padTop + innerHeight * ratio;
            return '<line class="grid-line" x1="' + padLeft + '" y1="' + y.toFixed(1) +
                '" x2="' + (width - padRight) + '" y2="' + y.toFixed(1) + '"/>' +
                '<text class="axis-text" x="4" y="' + (y + 3).toFixed(1) + '">' +
                Math.round(ceiling * (1 - ratio)) + "</text>";
        }).join("");

        var labels = points.map(function (item) {
            return '<text class="axis-text" x="' + item.x.toFixed(1) + '" y="' + (height - 8) +
                '" text-anchor="middle">' + esc(item.point.label) + "</text>";
        }).join("");

        var markers = points.map(function (item) {
            return '<circle class="trend-point" cx="' + item.x.toFixed(1) + '" cy="' +
                item.y.toFixed(1) + '" r="3.4"><title>' + esc(item.point.label + ": " +
                    item.point[valueKey] + " " + label) + "</title></circle>";
        }).join("");

        return '<div class="chart">' +
            '<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" role="img" ' +
            'aria-label="' + esc("Line chart of " + label + " over the last " + series.length +
                " months") + '">' +
            '<defs><linearGradient id="adminTrendFill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#5B4BBD" stop-opacity="0.28"/>' +
            '<stop offset="100%" stop-color="#5B4BBD" stop-opacity="0"/></linearGradient></defs>' +
            gridLines +
            '<line class="axis-line" x1="' + padLeft + '" y1="' + (padTop + innerHeight) +
            '" x2="' + (width - padRight) + '" y2="' + (padTop + innerHeight) + '"/>' +
            '<path class="area-fill" d="' + areaPath + '"/>' +
            '<path class="trend-line" d="' + linePath + '"/>' +
            markers +
            labels +
            "</svg>" +
            "</div>";
    }

    /* Vertical bar chart built from flex columns. */
    function barChart(items, options) {
        var opts = options || {};
        if (!items.length) {
            return emptyState("No records to chart",
                "Live records will appear here when they are available.");
        }
        var max = items.reduce(function (top, item) {
            return Math.max(top, toNumber(item.value));
        }, 0);

        var bars = items.map(function (item) {
            var pct = max ? Math.round((toNumber(item.value) / max) * 100) : 0;
            return '<div class="chart-bar">' +
                '<span class="chart-bar-value">' + esc(String(item.value)) + "</span>" +
                '<span class="chart-bar-track"><span class="chart-bar-fill" data-tone="' +
                esc(item.tone || opts.tone || "purple") + '" style="height:' + pct + '%"></span></span>' +
                '<span class="chart-bar-label" title="' + esc(item.label) + '">' +
                esc(item.label) + "</span>" +
                "</div>";
        }).join("");

        return '<div class="chart"><div class="chart-bars" role="img" aria-label="' +
            esc(opts.label || "Bar chart of live records") + '">' + bars + "</div>" +
            (opts.note ? '<p class="small muted">' + esc(opts.note) + "</p>" : "") +
            "</div>";
    }

    /* Donut chart used for payment and registration breakdowns. */
    function donutChart(segments, centreValue, centreLabel) {
        var total = segments.reduce(function (top, segment) {
            return top + toNumber(segment.value);
        }, 0);
        var radius = 62;
        var circumference = 2 * Math.PI * radius;
        var offset = 0;

        var rings = segments.map(function (segment) {
            var portion = total ? toNumber(segment.value) / total : 0;
            var ring = '<circle cx="80" cy="80" r="' + radius + '" fill="none" ' +
                'stroke="' + esc(segment.colour) + '" stroke-width="18" ' +
                'stroke-dasharray="' + (portion * circumference).toFixed(2) + " " +
                circumference.toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) +
                '"><title>' + esc(segment.label + ": " + segment.value) + "</title></circle>";
            offset += portion * circumference;
            return ring;
        }).join("");

        var legend = segments.map(function (segment) {
            return '<span class="legend-item"><span class="legend-dot" style="background:' +
                esc(segment.colour) + '"></span>' + esc(segment.label) + " \u00b7 " +
                esc(String(segment.value)) + "</span>";
        }).join("");

        return '<div class="donut-wrap">' +
            '<div class="donut"><svg viewBox="0 0 160 160" role="img" aria-label="' +
            esc("Donut chart of " + (centreLabel || "backend figures")) + '">' +
            '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="#EEF0F6" stroke-width="18"/>' +
            rings + "</svg>" +
            '<div class="donut-value"><strong>' + esc(String(centreValue)) + "</strong>" +
            "<span>" + esc(centreLabel || "total") + "</span></div>" +
            "</div>" +
            '<div class="chart-legend">' + legend + "</div>" +
            "</div>";
    }

    /* -------------------------------------------------------
       11. Module views
       -------------------------------------------------------
       LIST_MODULES holds the declarative configuration for every
       tabular module. Each definition supplies its filters, columns,
       row cells, actions and CSV columns, so search, sorting,
       pagination and export behave identically in every module.
       ------------------------------------------------------- */

    var LIST_MODULES = {};

    function defineListModule(config) {
        LIST_MODULES[config.view] = config;
    }

    /* Which record field is edited by each list module. */
    function listFormKey(config) {
        return config.formKey || config.view;
    }

    function listPageHead(config) {
        var formKey = listFormKey(config);
        return '<div class="page-head">' +
            "<div><p>" + esc(config.description) + "</p></div>" +
            '<div class="page-head-actions">' +
            (typeof config.headerActions === "function"
                ? config.headerActions() : config.headerActions || "") +
            (!config.hideCreate && moduleIsEditable(formKey, "create")
                ? '<button type="button" class="btn btn-primary" data-action="create" ' +
                    'data-module="' + esc(formKey) + '">' + icon("plus") +
                    esc(config.addLabel || "Create record") + "</button>"
                : "") +
            "</div></div>";
    }

    function renderListResults(view) {
        var config = LIST_MODULES[view];
        if (!config) return "";

        var records = applyListControls(view, config.records(), config.search, config.sorters);
        var page = pageSlice(view, records);

        var body = page.map(function (record) {
            var cells = config.cells(record).map(function (cell, index) {
                var column = config.columns[index] || {};
                return "<td" + (column.numeric ? ' class="is-numeric"' : "") + ">" + cell + "</td>";
            }).join("");

            return "<tr>" + cells +
                '<td class="is-actions"><div class="table-actions">' +
                (config.actions ? config.actions(record) : "") + "</div></td></tr>";
        }).join("");

        var table = page.length
            ? tableWrap(config.caption,
                config.columns.map(function (column) {
                    return "<th" + (column.numeric ? ' class="is-numeric"' : "") + ">" +
                        (column.sortable === false
                            ? esc(column.label)
                            : sortButton(view, column.key, column.label, column.numeric)) + "</th>";
                }).join("") + '<th class="is-actions">Actions</th>', body)
            : emptyState("No matching records",
                config.emptyMessage ||
                        "Adjust the search text or filters to see more records.",
                '<button type="button" class="btn btn-outline btn-sm" data-action="clear-filters">' +
                "Reset search and filters</button>");

        return (config.summary ? config.summary(records) : "") + table +
            (page.length ? paginationMarkup(view, records.length, page.length) : "");
    }

    function refreshResults(view) {
        var refresher = RESULTS_REFRESHERS[view];

        if (refresher) {
            refresher();
        } else {
            var container = $("#viewResults");
            if (!container) return;
            container.innerHTML = renderListResults(view);
        }

        syncResultCount(view);
    }

    function renderListModule(view) {
        var config = LIST_MODULES[view];
        if (!config) {
            return emptyState("Module unavailable", "This view has not been configured yet.", "");
        }

        return listPageHead(config) +
            demoBanner(config.demoNote || "") +
            (config.before ? config.before() : "") +
            toolbarMarkup(view, config.filters) +
            '<div id="viewResults" data-module="' + esc(view) + '">' +
            renderListResults(view) + "</div>";
    }

    function exportCurrentView(view) {
        if (view === "media") {
            exportCsv("angutsa-media-gallery.csv", [
                { key: "id", label: "Reference" },
                { key: "title", label: "Media title" },
                { key: "category", label: "Category" },
                { key: "caption", label: "Caption" },
                { key: "status", label: "Publication status" },
                { key: "file", label: "Linked asset" },
                { key: "addedOn", label: "Date added" }
            ], mediaFiltered());
            return;
        }

        var config = LIST_MODULES[view];
        if (!config || !config.csv) {
            toast("There is nothing to export from this view yet.", "info");
            return;
        }

        var records = applyListControls(view, config.records(), config.search, config.sorters);
        exportCsv(config.csvName || ("angutsa-" + view + ".csv"), config.csv(), records);
    }

    function playerPdfReportMarkup(records, selectedTeamId) {
        var selectedTeam = selectedTeamId ? byId(DEMO.teams, selectedTeamId) : null;
        var teamLabel = selectedTeam ? selectedTeam.name : "All teams";
        var dateLabel = window.AngutsaEAT
            ? window.AngutsaEAT.formatDateLong(new Date())
            : new Date().toLocaleDateString("en-KE", {
                year: "numeric", month: "long", day: "numeric"
            });
        var rows = records.map(function (record, index) {
            var category = byId(DEMO.categories, record.categoryId);
            var team = byId(DEMO.teams, record.teamId);
            var requiresConsent = !!(category && category.guardianConsent);
            var consent = requiresConsent
                ? (record.guardianConsent ? "Recorded" : "Outstanding")
                : "Not required";

            return "<tr>" +
                '<td class="player-pdf-number">' + (index + 1) + "</td>" +
                '<td class="player-pdf-player"><strong>' + esc(record.name || "Unnamed player") +
                    "</strong><span>" + esc(record.id) + " · Born " +
                    esc(record.yearOfBirth || "Not provided") + " · Registered " +
                    esc(formatDate(record.submittedOn)) + "</span></td>" +
                "<td>" + esc(team ? team.name : "Unassigned") + "</td>" +
                '<td class="player-pdf-center">' +
                    esc(record.jersey === null || record.jersey === undefined || record.jersey === ""
                        ? "—" : record.jersey) + "</td>" +
                "<td>" + esc(record.position || "Not provided") + "</td>" +
                "<td>" + esc(category ? category.name : categoryName(record.categoryId)) + "</td>" +
                "<td>" + esc(record.eligibility || "Not recorded") + "</td>" +
                "<td>" + esc(consent) + "</td>" +
                '<td><span class="player-pdf-status">Registered</span></td>' +
            "</tr>";
        }).join("");

        return '<section id="playerPdfReport" class="player-pdf-report" hidden>' +
            '<header class="player-pdf-header">' +
                '<div class="player-pdf-brand">ANGUTSA CHAMPIONSHIP <span>ADMINISTRATION</span></div>' +
                '<div class="player-pdf-heading"><div><p class="player-pdf-kicker">TEAM ROSTER</p>' +
                    "<h1>Player register</h1><p>" + esc(teamLabel) +
                    " · " + esc(records.length) + (records.length === 1 ? " player" : " players") +
                    "</p></div><div class=\"player-pdf-date\"><span>Prepared</span><strong>" +
                    esc(dateLabel) + "</strong></div></div>" +
            "</header>" +
            '<div class="player-pdf-notice">Exported from backend records. Verify authorization before sharing.</div>' +
            '<table class="player-pdf-table"><thead><tr>' +
                "<th>#</th><th>Player details</th><th>Team</th><th>Shirt</th><th>Position</th>" +
                "<th>Category</th><th>Eligibility</th><th>Guardian consent</th><th>Roster</th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>" +
            '<footer class="player-pdf-footer"><span>The Angutsa Football Championship</span>' +
                "<span>Player information · " + esc(teamLabel) + "</span></footer>" +
        "</section>";
    }

    function exportPlayersPdf() {
        var config = LIST_MODULES.players;
        if (!config) {
            toast("The player register is unavailable for PDF export.", "error");
            return;
        }

        var records = applyListControls("players", config.records(), config.search, config.sorters);
        if (!records.length) {
            toast("There are no matching players to include in the PDF.", "info");
            return;
        }

        var report = document.getElementById("playerPdfReport");
        if (!report) {
            report = document.createElement("div");
            report.id = "playerPdfReport";
            document.body.appendChild(report);
        }

        var selectedTeamId = listState("players").filters.teamId || "";
        report.outerHTML = playerPdfReportMarkup(records, selectedTeamId);
        report = document.getElementById("playerPdfReport");
        report.hidden = false;

        var originalTitle = document.title;
        var team = selectedTeamId ? byId(DEMO.teams, selectedTeamId) : null;
        document.title = (team ? team.name : "All Teams") + " Player Register";
        document.body.classList.add("is-printing-player-roster");

        try {
            window.print();
        } catch (error) {
            console.error("Unable to open the player roster print dialog.", error);
            toast("The player roster could not be opened for PDF export.", "error");
        } finally {
            document.body.classList.remove("is-printing-player-roster");
            report.hidden = true;
            report.innerHTML = "";
            document.title = originalTitle;
        }
    }

    /* Shared action button sets used across the list modules. */
    function viewAction(moduleKey, id, label) {
        return actionButton("details", id, moduleKey, "View " + (label || "details"), "eye");
    }

    function managementResultContext(result) {
        var fixture = result && byId(DEMO.fixtures, result.fixtureId);
        return managementFixtureContext(fixture);
    }

    function managementFixtureContext(fixture) {
        if (!fixture || fixture.id.indexOf("TM-") !== 0) return null;
        var record = managementRecord(fixture.tournamentId, false);
        if (!record) return null;
        var match = record.matches.filter(function (item) {
            return managementMatchId(record.tournamentId, item.id) === fixture.id;
        })[0];
        return match ? { fixture: fixture, record: record, match: match } : null;
    }

    function goalScorerEntries(values) {
        return Array.isArray(values) ? values.filter(function (entry) {
            return entry && typeof entry === "object";
        }) : [];
    }

    function legacyGoalScorerNames(values) {
        return Array.isArray(values) ? values.filter(function (entry) {
            return typeof entry === "string" && entry.trim();
        }) : [];
    }

    function hasUneditableScorerEntries(values, teamId) {
        if (legacyGoalScorerNames(values).length) return true;
        return goalScorerEntries(values).some(function (entry) {
            if (entry.ownGoal) return Boolean(entry.playerId);
            return !DEMO.players.some(function (player) {
                return player.id === entry.playerId && player.teamId === teamId;
            });
        });
    }

    function preserveLegacyScorersForDraft(entries, previousEntries, confirmed) {
        return !confirmed && !entries.length && legacyGoalScorerNames(previousEntries).length
            ? previousEntries : entries;
    }

    function goalScorerGroupId(tournamentId, matchId, side) {
        return "tm-goals-" + tournamentId + "-" + matchId + "-" + side;
    }

    function goalScorerRowMarkup(groupId, teamId, entry) {
        var selectedId = entry && entry.ownGoal ? "own-goal" : entry && entry.playerId || "";
        var goalCount = entry && entry.goals !== undefined && entry.goals !== null
            ? entry.goals : 1;
        var goalMinute = entry && entry.minute !== undefined && entry.minute !== null
            ? entry.minute : "";
        var players = DEMO.players.filter(function (player) {
            return player.teamId === teamId;
        }).sort(function (a, b) {
            return Number(a.jersey || 0) - Number(b.jersey || 0) ||
                String(a.name).localeCompare(String(b.name));
        });
        var options = '<option value="">Select player or own goal</option>' +
            players.map(function (player) {
                return '<option value="' + esc(player.id) + '"' +
                    (selectedId === player.id ? " selected" : "") + ">" +
                    esc(player.name) + "</option>";
            }).join("") +
            '<option value="own-goal"' + (selectedId === "own-goal" ? " selected" : "") +
            '>Own goal</option>';
        return '<div class="goal-scorer-row"><label><span>Player or goal type</span>' +
            '<select class="form-input" data-goal-scorer-player aria-label="Player or own goal">' +
            options + '</select></label><label><span>Goals</span><input class="form-input" ' +
            'type="number" min="1" step="1" value="' + esc(goalCount) +
            '" data-goal-scorer-count aria-label="Number of goals"></label>' +
            '<label><span>Minute</span><input class="form-input" type="number" min="0" max="150" ' +
            'step="1" value="' + esc(goalMinute) +
            '" data-goal-scorer-minute aria-label="Goal minute"></label>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-goal-scorer-action="remove" ' +
            'data-goal-scorer-group="' + esc(groupId) + '" aria-label="Remove goalscorer row">Remove</button></div>';
    }

    function goalScorerGroupMarkup(groupId, teamId, values) {
        var entries = goalScorerEntries(values);
        var rows = entries.length ? entries : [null];
        var legacyNames = legacyGoalScorerNames(values);
        return '<div class="tm-field tm-goal-scorer-field"><span class="tm-field-label">' +
            esc(teamName(teamId)) + ' goalscorers (optional)</span><div class="goal-scorer-list" id="' +
            esc(groupId) + '" data-goal-scorer-list data-team-id="' + esc(teamId) + '">' +
            rows.map(function (entry) {
                return goalScorerRowMarkup(groupId, teamId, entry);
            }).join("") + '</div><button type="button" class="btn btn-outline btn-sm" ' +
            'data-goal-scorer-action="add" data-goal-scorer-group="' + esc(groupId) +
            '">Add player or own goal</button>' +
            (legacyNames.length ? '<span class="form-note">Previously entered names need to be assigned ' +
                'to registered players before this result can be confirmed: ' +
                esc(legacyNames.join(", ")) + '</span>' : "") + '</div>';
    }

    function collectGoalScorerEntries(groupId) {
        var group = document.getElementById(groupId);
        if (!group) return [];
        return $$(".goal-scorer-row", group).map(function (row) {
            var playerSelect = $("[data-goal-scorer-player]", row);
            var goalInput = $("[data-goal-scorer-count]", row);
            var minuteInput = $("[data-goal-scorer-minute]", row);
            var selection = playerSelect ? playerSelect.value : "";
            if (!selection) return null;
            var goals = goalInput && goalInput.value !== "" ? Number(goalInput.value) : "";
            var minute = minuteInput && minuteInput.value !== "" ? Number(minuteInput.value) : null;
            if (selection === "own-goal") {
                return { playerId: "", ownGoal: true, goals: goals, minute: minute,
                    teamId: group.getAttribute("data-team-id"),
                    teamName: teamName(group.getAttribute("data-team-id")) };
            }
            var player = byId(DEMO.players, selection);
            return {
                playerId: selection,
                playerName: player ? player.name : "",
                publicName: player ? publicGoalScorerName(player) : "",
                ownGoal: false,
                goals: goals,
                minute: minute,
                teamId: group.getAttribute("data-team-id"),
                teamName: teamName(group.getAttribute("data-team-id"))
            };
        }).filter(Boolean);
    }

    function goalScorersFitScore(score, entries, teamId) {
        if (!/^\d+$/.test(String(score))) return false;
        var total = 0;
        for (var i = 0; i < entries.length; i += 1) {
            var entry = entries[i];
            if (!Number.isInteger(entry.goals) || entry.goals < 1) return false;
            if (entry.ownGoal) {
                if (entry.playerId) return false;
            } else {
                var player = byId(DEMO.players, entry.playerId);
                if (!player || player.teamId !== teamId) return false;
            }
            total += entry.goals;
        }
        return total <= Number(score);
    }

    function formatGoalScorers(values) {
        if (!Array.isArray(values) || !values.length) return "Not recorded";
        return values.map(function (entry) {
            if (typeof entry === "string") return entry;
            if (!entry || typeof entry !== "object") return "";
            var player = byId(DEMO.players, entry.playerId);
            var name = entry.ownGoal ? "Own goal" :
                player ? player.name : entry.playerName || entry.publicName || "Player not found";
            return name + (Number(entry.goals) > 1 ? " x " + Number(entry.goals) : "");
        }).filter(Boolean).join(", ") || "Not recorded";
    }

    function tournamentTopScorerRows() {
        var scorers = {};
        DEMO.results.forEach(function (result) {
            if (normalise(result.state) !== "published") return;
            var fixture = byId(DEMO.fixtures, result.fixtureId);
            var tournamentId = result.publicTournamentId ||
                (fixture ? publicTournamentIdFor(fixture.tournamentId) : "");
            [result.homeScorers, result.awayScorers].forEach(function (entries) {
                goalScorerEntries(entries).forEach(function (entry) {
                    if (entry.ownGoal || !entry.playerId || !Number.isInteger(Number(entry.goals)) ||
                        Number(entry.goals) < 1) return;
                    var key = tournamentId + "|" + entry.playerId;
                    var player = byId(DEMO.players, entry.playerId);
                    if (!scorers[key]) {
                        scorers[key] = {
                            tournamentId: tournamentId,
                            playerId: entry.playerId,
                            name: player ? player.name : entry.playerName || "Player not found",
                            teamName: entry.teamName || teamName(entry.teamId),
                            goals: 0
                        };
                    }
                    scorers[key].goals += Number(entry.goals);
                });
            });
        });
        return Object.keys(scorers).map(function (key) { return scorers[key]; });
    }

    function renderTournamentTopScorersPanel() {
        var scorers = tournamentTopScorerRows();
        if (!scorers.length) {
            return '<section class="results-schedule-panel results-top-scorers">' +
                '<div class="tm-panel-heading"><div><span class="tm-kicker">Goal tracking</span>' +
                '<h3>Tournament top scorers</h3><p>Confirmed results only. Own goals count toward the team score, ' +
                'but are not credited to an individual.</p></div></div>' +
                '<p class="tm-muted">No confirmed player goals have been recorded yet.</p></section>';
        }
        var tournaments = {};
        scorers.forEach(function (scorer) {
            if (!tournaments[scorer.tournamentId]) tournaments[scorer.tournamentId] = [];
            tournaments[scorer.tournamentId].push(scorer);
        });
        var tournamentPanels = Object.keys(tournaments).map(function (id) {
            var sorted = tournaments[id].sort(function (a, b) {
                return b.goals - a.goals || a.name.localeCompare(b.name);
            });
            var previousGoals = null;
            var rank = 0;
            var rows = sorted.map(function (scorer, index) {
                if (scorer.goals !== previousGoals) rank = index + 1;
                previousGoals = scorer.goals;
                return "<tr><td>" + rank + "</td><td>" + esc(scorer.name) +
                    "</td><td>" + esc(scorer.teamName) + "</td><td><strong>" +
                    scorer.goals + "</strong></td></tr>";
            }).join("");
            return '<div class="results-top-scorer-tournament"><h4>' +
                esc(tournamentName(byId(DEMO.tournaments, id) ? id :
                    (DEMO.tournaments.filter(function (item) {
                        return item.publicId === id;
                    })[0] || {}).id)) +
                '</h4><div class="table-wrap"><table class="data-table"><thead><tr>' +
                '<th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Team</th>' +
                '<th scope="col">Goals</th></tr></thead><tbody>' + rows +
                '</tbody></table></div></div>';
        }).join("");
        return '<section class="results-schedule-panel results-top-scorers">' +
            '<div class="tm-panel-heading"><div><span class="tm-kicker">Goal tracking</span>' +
            '<h3>Tournament top scorers</h3><p>Confirmed results only. Own goals count toward the team score, ' +
            'but are not credited to an individual.</p></div></div>' +
            '<div class="results-top-scorer-grid">' + tournamentPanels + '</div></section>';
    }

    function renderScheduledResultsPanel() {
        var fixtures = DEMO.fixtures.filter(function (fixture) {
            return fixture.status === "scheduled" || fixture.status === "draft";
        }).sort(function (a, b) {
            return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
        });
        var cards = fixtures.map(function (fixture) {
            var managed = managementFixtureContext(fixture);
            if (managed) return managementMatchFields(managed.match,
                managed.match.stage !== "group", managed.record.tournamentId);

            var result = DEMO.results.filter(function (item) {
                return item.fixtureId === fixture.id;
            })[0];
            var hasDraftScore = result &&
                (result.homeScore !== null && result.homeScore !== undefined ||
                    result.awayScore !== null && result.awayScore !== undefined);
            var date = fixture.kickoff ? formatDateTime(fixture.kickoff) : "Date and time not set";
            var entryId = "results-entry-" + esc(fixture.id);
            var homeGoalGroup = "results-home-goals-" + fixture.id;
            var awayGoalGroup = "results-away-goals-" + fixture.id;
            var stage = String(fixture.stage || "").toLowerCase();
            var knockout = !fixture.group &&
                ["group", "league", "round-robin", "round robin"].indexOf(stage) === -1;
            var tieBreakMarkup = knockout
                ? '<label class="tm-field"><span>Tie procedure</span><select class="form-input" ' +
                    'data-result-fixture-id="' + esc(fixture.id) + '" name="tieBreakMethod">' +
                    '<option value="">Not required</option><option value="extra-time"' +
                    (result && result.tieBreakMethod === "extra-time" ? " selected" : "") +
                    '>Extra time</option><option value="penalties"' +
                    (result && result.tieBreakMethod === "penalties" ? " selected" : "") +
                    '>Extra time then penalties</option></select></label>' +
                    '<p class="tm-muted">Enter the final score after extra time. Penalty scores decide the winner and are not added to goals.</p>' +
                    '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
                    ' score after extra time</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
                    'data-result-fixture-id="' + esc(fixture.id) + '" name="homeExtraTimeScore" value="' +
                    esc(result && result.homeExtraTimeScore !== null &&
                        result.homeExtraTimeScore !== undefined ? result.homeExtraTimeScore : "") + '"></label>' +
                    '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
                    ' score after extra time</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
                    'data-result-fixture-id="' + esc(fixture.id) + '" name="awayExtraTimeScore" value="' +
                    esc(result && result.awayExtraTimeScore !== null &&
                        result.awayExtraTimeScore !== undefined ? result.awayExtraTimeScore : "") + '"></label>' +
                    '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
                    ' penalty-shootout score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
                    'data-result-fixture-id="' + esc(fixture.id) + '" name="homePenaltiesScore" value="' +
                    esc(result && result.homePenaltiesScore !== null &&
                        result.homePenaltiesScore !== undefined ? result.homePenaltiesScore : "") + '"></label>' +
                    '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
                    ' penalty-shootout score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
                    'data-result-fixture-id="' + esc(fixture.id) + '" name="awayPenaltiesScore" value="' +
                    esc(result && result.awayPenaltiesScore !== null &&
                        result.awayPenaltiesScore !== undefined ? result.awayPenaltiesScore : "") + '"></label>'
                : "";
            return '<article class="tm-match-card results-match-card"><div class="tm-match-heading"><div>' +
                '<span class="tm-kicker">' + esc(fixture.round || fixture.group || "Scheduled match") +
                '</span><h4>' + esc(teamName(fixture.homeId)) + ' <span>vs</span> ' +
                esc(teamName(fixture.awayId)) + '</h4><span class="tm-muted">' +
                esc(tournamentName(fixture.tournamentId)) + ' \u00b7 ' + esc(date) +
                (fixture.venue ? ' \u00b7 ' + esc(fixture.venue) : "") + '</span></div>' +
                '<div class="results-match-status"><span class="tm-status is-pending">' +
                (hasDraftScore ? "Draft saved" : "Scheduled") + '</span>' +
                '<button type="button" class="results-entry-toggle" data-result-entry-toggle ' +
                'aria-expanded="false" aria-controls="' + entryId + '">Enter result</button></div></div>' +
                '<div class="results-entry-content" id="' + entryId + '"><div class="tm-match-fields">' +
                '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
                ' score</span><input class="form-input" type="number" min="0" max="99" step="1" data-result-fixture-id="' +
                esc(fixture.id) + '" name="homeScore" value="' +
                esc(result && result.homeScore !== null ? result.homeScore : "") + '"></label>' +
                '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
                ' score</span><input class="form-input" type="number" min="0" max="99" step="1" data-result-fixture-id="' +
                esc(fixture.id) + '" name="awayScore" value="' +
                esc(result && result.awayScore !== null ? result.awayScore : "") + '"></label>' +
                tieBreakMarkup +
                goalScorerGroupMarkup(homeGoalGroup, fixture.homeId, result && result.homeScorers) +
                goalScorerGroupMarkup(awayGoalGroup, fixture.awayId, result && result.awayScorers) +
                '</div><div class="tm-match-actions">' +
                (hasAdminPermission("results.edit")
                    ? '<button type="button" class="btn btn-secondary" data-action="save-scheduled-result" data-id="' +
                        esc(fixture.id) + '">Save score draft</button>'
                    : "") +
                (hasAdminPermission("results.publish")
                    ? '<button type="button" class="btn btn-primary" data-action="confirm-scheduled-result" data-id="' +
                        esc(fixture.id) + '">Confirm result</button>'
                    : "") +
                "</div></div></article>";
        }).join("");
        return '<section class="results-schedule-panel"><div class="tm-panel-heading"><div>' +
            '<span class="tm-kicker">Matchday results</span><h3>Scheduled matches</h3>' +
            '<p>Player names and own-goal details are optional. Add the scorers you know; the match score can be confirmed without them.</p>' +
            '</div><span class="tm-muted">' + fixtures.length + ' match' +
            (fixtures.length === 1 ? "" : "es") + '</span></div>' +
            (cards ? '<div class="results-schedule-list">' + cards + '</div>' :
                '<p class="tm-muted">There are no scheduled matches waiting for a result.</p>') +
            '</section>' + renderTournamentTopScorersPanel();
    }

    function liveMatchTieBreakMarkup(fixture) {
        var stage = String(fixture.stage || "").toLowerCase();
        var knockout = !fixture.group &&
            ["group", "league", "round-robin", "round robin"].indexOf(stage) === -1;
        if (!knockout) return "";
        return '<label class="tm-field"><span>Tie procedure (if level at full time)</span>' +
            '<select class="form-input" data-live-fixture-id="' + esc(fixture.id) +
            '" name="tieBreakMethod"><option value="">Not required</option>' +
            '<option value="extra-time"' + (fixture.tieBreakMethod === "extra-time" ? " selected" : "") +
            '>Extra time</option><option value="penalties"' +
            (fixture.tieBreakMethod === "penalties" ? " selected" : "") +
            '>Extra time then penalties</option></select></label>' +
            '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
            ' extra-time score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
            'data-live-fixture-id="' + esc(fixture.id) + '" name="homeExtraTimeScore" value="' +
            esc(fixture.homeExtraTimeScore === null ? "" : fixture.homeExtraTimeScore) + '"></label>' +
            '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
            ' extra-time score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
            'data-live-fixture-id="' + esc(fixture.id) + '" name="awayExtraTimeScore" value="' +
            esc(fixture.awayExtraTimeScore === null ? "" : fixture.awayExtraTimeScore) + '"></label>' +
            '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
            ' penalty-shootout score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
            'data-live-fixture-id="' + esc(fixture.id) + '" name="homePenaltiesScore" value="' +
            esc(fixture.homePenaltiesScore === null ? "" : fixture.homePenaltiesScore) + '"></label>' +
            '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
            ' penalty-shootout score</span><input class="form-input" type="number" min="0" max="99" step="1" ' +
            'data-live-fixture-id="' + esc(fixture.id) + '" name="awayPenaltiesScore" value="' +
            esc(fixture.awayPenaltiesScore === null ? "" : fixture.awayPenaltiesScore) + '"></label>';
    }

    var liveClockDisplayTimer = null;

    function liveClockLabel(fixture, now) {
        var mode = fixture.liveClockMode || "automatic";
        var extraMinutes = Number(fixture.liveExtraMinutes || 0);
        var elapsedSeconds = Number(fixture.liveClockElapsedSeconds || 0);
        if (mode === "automatic" && fixture.liveClockStartedAt) {
            var startedAt = new Date(fixture.liveClockStartedAt).getTime();
            if (isFinite(startedAt)) {
                elapsedSeconds += Math.max(0, Math.floor((now - startedAt) / 1000));
            }
        }
        var period = fixture.livePeriod || "";
        var minute = Number(fixture.liveMinute || 0);
        if ((mode === "automatic" || mode === "paused") &&
            elapsedSeconds >= (60 + 45 + extraMinutes) * 60) {
            period = "full_time";
            minute = 90 + extraMinutes;
        } else if ((mode === "automatic" || mode === "paused") && elapsedSeconds < 45 * 60) {
            period = "first_half";
            minute = Math.floor(elapsedSeconds / 60);
        } else if ((mode === "automatic" || mode === "paused") && elapsedSeconds < 60 * 60) {
            period = "halftime";
            minute = 45;
        } else if (mode === "automatic" || mode === "paused") {
            period = "second_half";
            minute = Math.min(90 + extraMinutes, 46 + Math.floor((elapsedSeconds - 60 * 60) / 60));
        }
        if (period === "full_time" || mode === "finished") return "FULL TIME · Awaiting confirmation";
        if (period === "halftime") return "HALF-TIME · 15-minute break";
        if (minute > 90) return "LIVE · 90+" + (minute - 90) + "'";
        return "LIVE · " + minute + "'";
    }

    function updateLiveClockLabels() {
        $$("[data-live-clock-id]").forEach(function (node) {
            var fixture = byId(DEMO.fixtures, node.getAttribute("data-live-clock-id"));
            if (fixture) node.textContent = liveClockLabel(fixture, Date.now());
        });
    }

    function liveMatchCardMarkup(fixture) {
        var result = DEMO.results.filter(function (item) {
            return item.fixtureId === fixture.id;
        })[0] || {};
        var live = fixture.status === "live";
        var clockMode = fixture.liveClockMode || "automatic";
        var clockControls = hasAdminPermission("results.edit")
            ? '<label class="tm-field"><span>Second-half added minutes</span><input class="form-input" ' +
                'type="number" min="0" max="30" step="1" data-live-fixture-id="' +
                esc(fixture.id) + '" name="liveExtraMinutes" value="' +
                esc(fixture.liveExtraMinutes || 0) + '"></label>' +
                '<div class="live-clock-controls">' +
                '<label class="tm-field"><span>Manual match minute</span><input class="form-input" ' +
                'type="number" min="0" max="120" step="1" data-live-fixture-id="' +
                esc(fixture.id) + '" name="manualLiveMinute" value="' +
                esc(fixture.liveMinute || 0) + '"></label>' +
                (clockMode === "automatic"
                    ? '<button type="button" class="btn btn-secondary" data-action="live-clock-control" ' +
                        'data-clock-action="pause" data-module="results" data-id="' +
                        esc(fixture.id) + '">Pause clock</button>'
                    : clockMode !== "finished"
                        ? '<button type="button" class="btn btn-secondary" data-action="live-clock-control" ' +
                            'data-clock-action="resume" data-module="results" data-id="' +
                            esc(fixture.id) + '">Resume automatic clock</button>'
                        : "") +
                '<button type="button" class="btn btn-secondary" data-action="live-clock-control" ' +
                'data-clock-action="set-minute" data-module="results" data-id="' +
                esc(fixture.id) + '">Set manual minute</button>' +
                '</div><p class="tm-muted">The automatic clock uses 45 minutes, a 15-minute half-time ' +
                'break, then 45 minutes plus added time. Manual clock control stays active until resumed.</p>'
            : "";
        var groups = live
            ? '<div class="live-match-score-fields">' +
                '<label class="tm-field"><span>' + esc(teamName(fixture.homeId)) +
                ' score</span><input class="form-input" type="number" min="0" max="99" step="1" required ' +
                'data-live-fixture-id="' + esc(fixture.id) + '" name="homeScore" value="' +
                esc(fixture.homeScore === null ? 0 : fixture.homeScore) + '"></label>' +
                '<label class="tm-field"><span>' + esc(teamName(fixture.awayId)) +
                ' score</span><input class="form-input" type="number" min="0" max="99" step="1" required ' +
                'data-live-fixture-id="' + esc(fixture.id) + '" name="awayScore" value="' +
                esc(fixture.awayScore === null ? 0 : fixture.awayScore) + '"></label>' +
                '<label class="tm-field"><span>Match minute</span><input class="form-input" type="number" ' +
                'min="0" max="150" step="1" required data-live-fixture-id="' + esc(fixture.id) +
                '" name="liveMinute" value="' + esc(fixture.liveMinute || 0) +
                '" readonly></label></div>' +
                clockControls +
                goalScorerGroupMarkup("live-home-goals-" + fixture.id, fixture.homeId, result.homeScorers) +
                goalScorerGroupMarkup("live-away-goals-" + fixture.id, fixture.awayId, result.awayScorers) +
                liveMatchTieBreakMarkup(fixture) +
                '<div class="live-match-actions">' +
                (hasAdminPermission("results.edit")
                    ? '<button type="button" class="btn btn-secondary" data-action="save-live-match" ' +
                        'data-module="results" data-id="' + esc(fixture.id) + '">Save live update</button>'
                    : "") +
                (hasAdminPermission("results.publish")
                    ? '<button type="button" class="btn btn-primary" data-action="finish-live-match" ' +
                        'data-module="results" data-id="' + esc(fixture.id) + '">Confirm Full Time</button>'
                    : "") +
                "</div>"
            : "";
        return '<article class="live-admin-match' + (live ? " is-live" : "") + '">' +
            '<header class="live-admin-match-head"><div><span class="live-admin-kicker">' +
            esc(fixture.round || fixture.group || fixture.stage || "Scheduled match") +
            '</span><h3>' + esc(teamName(fixture.homeId)) + ' <span>vs</span> ' +
            esc(teamName(fixture.awayId)) + '</h3><p>' + esc(tournamentName(fixture.tournamentId)) +
            ' · ' + esc(formatDateTime(fixture.kickoff)) +
            (fixture.venue ? ' · ' + esc(fixture.venue) : "") + '</p></div>' +
            '<span class="status-badge ' + (live ? "status-live" : "status-scheduled") + '">' +
            (live
                ? '<span data-live-clock-id="' + esc(fixture.id) + '">' +
                    esc(liveClockLabel(fixture, Date.now())) + "</span>"
                : "Scheduled") +
            '</span></header>' +
            (live ? '<div class="live-admin-score"><strong>' +
                esc(fixture.homeScore === null ? 0 : fixture.homeScore) + '</strong><span>–</span><strong>' +
                esc(fixture.awayScore === null ? 0 : fixture.awayScore) + '</strong></div>' + groups
                : '<div class="live-admin-start">' +
                    (hasAdminPermission("fixtures.edit")
                        ? '<button type="button" class="btn btn-primary" data-action="start-match" ' +
                            'data-module="matches" data-id="' + esc(fixture.id) + '">' +
                            icon("play") + 'Start live coverage</button>'
                        : '<p class="tm-muted">You need fixture-edit permission to start live coverage.</p>') +
                    '</div>') +
            '</article>';
    }

    function renderLiveMatchesView() {
        if (liveClockDisplayTimer) window.clearInterval(liveClockDisplayTimer);
        var fixtures = DEMO.fixtures.filter(function (fixture) {
            return fixture.published && (fixture.status === "live" || fixture.status === "scheduled");
        }).sort(function (a, b) {
            if (a.status !== b.status) return a.status === "live" ? -1 : 1;
            return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
        });
        var liveCount = fixtures.filter(function (fixture) {
            return fixture.status === "live" && fixture.liveClockMode !== "finished";
        }).length;
        var pendingFullTimeCount = fixtures.filter(function (fixture) {
            return fixture.status === "live" && fixture.liveClockMode === "finished";
        }).length;
        liveClockDisplayTimer = window.setInterval(updateLiveClockLabels, 15000);
        return '<section class="live-match-workspace">' +
            '<div class="live-match-intro"><div><span class="tm-kicker">Matchday control room</span>' +
            '<h2>Live Match</h2><p>Published fixtures start automatically at kickoff. The clock runs ' +
            '45 minutes, a 15-minute half-time break, then 45 minutes plus admin-added time. Manage the ' +
            'clock when needed, and confirm Full Time to publish the official result.</p></div>' +
            '<span class="live-match-count">' + liveCount + ' live' +
            (pendingFullTimeCount ? ' · ' + pendingFullTimeCount + ' awaiting Full Time confirmation' : "") +
            '</span></div>' +
            (fixtures.length
                ? '<div class="live-admin-match-list">' + fixtures.map(liveMatchCardMarkup).join("") + '</div>'
                : emptyState("No published fixtures", "Publish a fixture before starting live coverage.", "")) +
            '<p class="live-match-footnote">Live scores appear publicly on Fixtures and the Match Centre. ' +
            'Scorer names follow the existing player privacy and guardian-consent rules.</p></section>';
    }

    function liveMatchControls(fixtureId) {
        var controls = {};
        $$("[data-live-fixture-id]").forEach(function (node) {
            if (node.getAttribute("data-live-fixture-id") === fixtureId) {
                controls[node.name] = node.value;
            }
        });
        return controls;
    }

    function liveMatchPayload(fixtureId) {
        var fixture = byId(DEMO.fixtures, fixtureId);
        if (!fixture) {
            toast("The live fixture could not be found. Reload the match list and try again.", "error");
            return null;
        }
        var controls = liveMatchControls(fixtureId);
        var scoreNames = ["homeScore", "awayScore"];
        for (var index = 0; index < scoreNames.length; index += 1) {
            var score = controls[scoreNames[index]];
            if (!/^\d+$/.test(String(score)) || Number(score) > 99) {
                toast("Enter both live scores as whole numbers between 0 and 99.", "error");
                return null;
            }
        }
        if (!/^\d+$/.test(String(controls.liveMinute)) || Number(controls.liveMinute) > 150) {
            toast("Enter the match minute as a whole number between 0 and 150.", "error");
            return null;
        }
        var liveExtraMinutes = controls.liveExtraMinutes === undefined
            ? Number(fixture.liveExtraMinutes || 0) : Number(controls.liveExtraMinutes);
        if (!/^\d+$/.test(String(liveExtraMinutes)) || liveExtraMinutes > 30) {
            toast("Enter second-half added minutes as a whole number between 0 and 30.", "error");
            return null;
        }
        var homeScorers = collectGoalScorerEntries("live-home-goals-" + fixtureId);
        var awayScorers = collectGoalScorerEntries("live-away-goals-" + fixtureId);
        if (!goalScorersFitScore(controls.homeScore, homeScorers, fixture.homeId) ||
            !goalScorersFitScore(controls.awayScore, awayScorers, fixture.awayId)) {
            toast("Recorded scorer goals must use registered players or own goals and cannot exceed each team's score.", "error");
            return null;
        }
        var optionalScore = function (name) {
            return controls[name] === undefined || controls[name] === "" ? null : Number(controls[name]);
        };
        return {
            homeScore: Number(controls.homeScore),
            awayScore: Number(controls.awayScore),
            liveMinute: Number(controls.liveMinute),
            liveExtraMinutes: liveExtraMinutes,
            homeScorers: homeScorers,
            awayScorers: awayScorers,
            tieBreakMethod: controls.tieBreakMethod || "",
            homeExtraTimeScore: optionalScore("homeExtraTimeScore"),
            awayExtraTimeScore: optionalScore("awayExtraTimeScore"),
            homePenaltiesScore: optionalScore("homePenaltiesScore"),
            awayPenaltiesScore: optionalScore("awayPenaltiesScore")
        };
    }

    async function actionSaveLiveMatch(id) {
        var payload = liveMatchPayload(id);
        if (!payload) return;
        try {
            await window.AngutsaPlatform.request("/admin/matches/" +
                encodeURIComponent(id) + "/live", { method: "PUT", body: payload });
            await refreshLiveAdminData();
            toast("Live score and scorer updates are published.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "The live update could not be saved.", "error");
        }
    }

    async function actionLiveClockControl(id, action) {
        var body = { action: action };
        if (action === "set-minute") {
            var controls = liveMatchControls(id);
            if (!/^\d+$/.test(String(controls.manualLiveMinute)) ||
                Number(controls.manualLiveMinute) > 120) {
                toast("Enter a manual match minute as a whole number between 0 and 120.", "error");
                return;
            }
            body.minute = Number(controls.manualLiveMinute);
        }
        try {
            await window.AngutsaPlatform.request("/admin/matches/" +
                encodeURIComponent(id) + "/live-clock", { method: "PUT", body: body });
            await refreshLiveAdminData();
            toast(action === "pause" ? "The match clock is paused." :
                action === "resume" ? "Automatic match timing has resumed." :
                    "The match clock is under manual control.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "The match clock could not be updated.", "error");
        }
    }

    function actionFinishLiveMatch(id) {
        var payload = liveMatchPayload(id);
        if (!payload) return;
        confirmDialog({
            title: "Confirm Full Time?",
            message: "This will end live coverage, publish the final result and update standings where applicable.",
            confirmLabel: "Confirm Full Time",
            tone: "warning"
        }).then(async function (confirmed) {
            if (!confirmed) return;
            try {
                await window.AngutsaPlatform.request("/admin/matches/" +
                    encodeURIComponent(id) + "/result", {
                    method: "PUT",
                    body: Object.assign({}, payload, {
                        state: "published",
                        notes: (byId(DEMO.fixtures, id) || {}).note || ""
                    })
                });
                await refreshLiveAdminData();
                toast("Full Time confirmed. The final result is public.", "success");
            } catch (error) {
                toast(error && error.message ? error.message : "Full Time could not be confirmed.", "error");
            }
        });
    }

    function scheduledResultControls(fixtureId) {
        var controls = {};
        $$("[data-result-fixture-id]").forEach(function (node) {
            if (node.getAttribute("data-result-fixture-id") === fixtureId) controls[node.name] = node.value;
        });
        return controls;
    }

    function scheduledTieBreakError(fixture, controls, confirmResult) {
        var stage = String(fixture.stage || "").toLowerCase();
        var knockout = !fixture.group &&
            ["group", "league", "round-robin", "round robin"].indexOf(stage) === -1;
        var method = controls.tieBreakMethod || "";
        var names = ["homeExtraTimeScore", "awayExtraTimeScore", "homePenaltiesScore", "awayPenaltiesScore"];
        var values = {};
        for (var index = 0; index < names.length; index += 1) {
            var value = controls[names[index]];
            if (value === undefined || value === "") {
                values[names[index]] = null;
            } else if (!/^\d+$/.test(String(value)) || Number(value) > 99) {
                return "Tie-break scores must be whole numbers between 0 and 99.";
            } else {
                values[names[index]] = Number(value);
            }
        }
        var hasExtraTime = values.homeExtraTimeScore !== null || values.awayExtraTimeScore !== null;
        var hasPenalties = values.homePenaltiesScore !== null || values.awayPenaltiesScore !== null;
        if ((hasExtraTime && (values.homeExtraTimeScore === null || values.awayExtraTimeScore === null)) ||
            (hasPenalties && (values.homePenaltiesScore === null || values.awayPenaltiesScore === null))) {
            return "Enter both teams' scores for each tie-break period.";
        }
        if (!knockout && (method || hasExtraTime || hasPenalties)) {
            return "Tie-break scores are only allowed for knockout fixtures.";
        }
        var scoresValid = /^\d+$/.test(String(controls.homeScore || "")) &&
            /^\d+$/.test(String(controls.awayScore || ""));
        var regulationTied = scoresValid && Number(controls.homeScore) === Number(controls.awayScore);
        if (knockout && !regulationTied && (method || hasExtraTime || hasPenalties)) {
            return "Tie-break scores are only allowed when regulation time is tied.";
        }
        if (knockout && regulationTied && hasExtraTime &&
            (values.homeExtraTimeScore < Number(controls.homeScore) ||
                values.awayExtraTimeScore < Number(controls.awayScore))) {
            return "Scores after extra time cannot be lower than the regulation scores.";
        }
        if (!confirmResult || !knockout || !regulationTied) return "";
        var extraTimeDecides = method === "extra-time" && hasExtraTime &&
            values.homeExtraTimeScore !== values.awayExtraTimeScore && !hasPenalties;
        var penaltiesDecide = method === "penalties" && hasExtraTime &&
            values.homeExtraTimeScore === values.awayExtraTimeScore && hasPenalties &&
            values.homePenaltiesScore !== values.awayPenaltiesScore;
        return extraTimeDecides || penaltiesDecide ? "" :
            "Resolve the tie after extra time or record a penalty shootout after tied extra time.";
    }

    function resultEditAllowed(result) {
        if (!result) return false;
        return result.state === "published"
            ? hasAdminPermission("results.publish") && hasAdminPermission("results.correct")
            : hasAdminPermission("results.edit");
    }

    function actionEditResult(resultId) {
        var result = byId(DEMO.results, resultId);
        var fixture = result && byId(DEMO.fixtures, result.fixtureId);
        if (!result || !fixture) {
            toast("The fixture for this result could not be found.", "error");
            return;
        }
        if (!resultEditAllowed(result)) {
            toast(result.state === "published"
                ? "You need permission to publish and correct results to edit this published result."
                : "You do not have permission to edit draft results.", "error");
            return;
        }

        var isPublished = result.state === "published";
        var stage = String(fixture.stage || "").toLowerCase();
        var knockout = !fixture.group &&
            ["group", "league", "round-robin", "round robin"].indexOf(stage) === -1;
        var field = function (name, label, value, type) {
            return '<label class="tm-field"><span>' + esc(label) + '</span><input class="form-input" type="' +
                (type || "number") + '" min="0" max="99" step="1" data-result-edit-fixture-id="' +
                esc(fixture.id) + '" name="' + name + '" value="' +
                esc(value === null || value === undefined ? "" : value) + '"></label>';
        };
        var tieBreakMarkup = knockout
            ? '<label class="tm-field"><span>Tie procedure</span><select class="form-input" ' +
                'data-result-edit-fixture-id="' + esc(fixture.id) + '" name="tieBreakMethod">' +
                '<option value="">Not required</option><option value="extra-time"' +
                (result.tieBreakMethod === "extra-time" ? " selected" : "") +
                '>Extra time</option><option value="penalties"' +
                (result.tieBreakMethod === "penalties" ? " selected" : "") +
                '>Extra time then penalties</option></select></label>' +
                '<p class="tm-muted">For a tied knockout match, enter both teams\' scores after extra time. If still tied, add penalty-shootout scores.</p>' +
                field("homeExtraTimeScore", teamName(fixture.homeId) + " score after extra time",
                    result.homeExtraTimeScore) +
                field("awayExtraTimeScore", teamName(fixture.awayId) + " score after extra time",
                    result.awayExtraTimeScore) +
                field("homePenaltiesScore", teamName(fixture.homeId) + " penalty-shootout score",
                    result.homePenaltiesScore) +
                field("awayPenaltiesScore", teamName(fixture.awayId) + " penalty-shootout score",
                    result.awayPenaltiesScore)
            : "";
        var homeGoalGroup = "results-edit-home-goals-" + fixture.id;
        var awayGoalGroup = "results-edit-away-goals-" + fixture.id;
        var preserveScorers = hasUneditableScorerEntries(result.homeScorers, fixture.homeId) ||
            hasUneditableScorerEntries(result.awayScorers, fixture.awayId);
        var scorersMarkup = preserveScorers
            ? '<div class="tm-field"><span class="tm-field-label">Existing goalscorers</span><p>Home: ' +
                esc(formatGoalScorers(result.homeScorers)) + '</p><p>Away: ' +
                esc(formatGoalScorers(result.awayScorers)) +
                '</p><p class="tm-muted">These existing scorer records are preserved and cannot be changed here.</p></div>'
            : goalScorerGroupMarkup(homeGoalGroup, fixture.homeId, result.homeScorers) +
                goalScorerGroupMarkup(awayGoalGroup, fixture.awayId, result.awayScorers);
        var correctionMarkup = isPublished
            ? '<p class="tm-muted">This result is published. Saving will keep it published and update standings and scorer totals. If a later stage depends on it, the server will block the correction until that stage is resolved.</p>' +
                '<label class="tm-field"><span>Reason for correction (required)</span>' +
                '<textarea class="form-input" rows="3" maxlength="1000" data-result-correction-reason></textarea></label>'
            : "";
        var matchLabel = teamName(fixture.homeId) + " v " + teamName(fixture.awayId);
        openModal({
            title: "Edit result",
            subtitle: matchLabel + " \u00b7 " + tournamentName(fixture.tournamentId),
            size: "is-wide",
            body: '<div class="tm-match-fields">' +
                field("homeScore", teamName(fixture.homeId) + " score", result.homeScore) +
                field("awayScore", teamName(fixture.awayId) + " score", result.awayScore) +
                tieBreakMarkup +
                scorersMarkup +
                '<label class="tm-field"><span>Result notes</span><textarea class="form-input" rows="3" ' +
                'maxlength="2000" data-result-edit-fixture-id="' + esc(fixture.id) + '" name="notes">' +
                esc(result.notes || "") + '</textarea></label>' + correctionMarkup + '</div>',
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="save-result-edit" data-id="' +
                esc(result.id) + '">' + (isPublished ? "Save correction" : "Save changes") + '</button>'
        });
    }

    function actionSaveResultEdit(resultId) {
        var result = byId(DEMO.results, resultId);
        var fixture = result && byId(DEMO.fixtures, result.fixtureId);
        if (!result || !fixture) {
            toast("The fixture for this result could not be found.", "error");
            return;
        }
        if (!resultEditAllowed(result)) {
            toast(result.state === "published"
                ? "You need permission to publish and correct results to edit this published result."
                : "You do not have permission to edit draft results.", "error");
            return;
        }
        var modal = $("#modalHost .modal");
        if (!modal) return;
        var controls = {};
        $$("[data-result-edit-fixture-id]", modal).forEach(function (node) {
            if (node.getAttribute("data-result-edit-fixture-id") === fixture.id) {
                controls[node.name] = node.value;
            }
        });
        var isPublished = result.state === "published";
        var scores = [controls.homeScore, controls.awayScore];
        if (scores.some(function (score) {
            return score !== "" && (!/^\d+$/.test(String(score)) || Number(score) > 99);
        }) || isPublished && scores.some(function (score) {
            return score === "" || !/^\d+$/.test(String(score));
        })) {
            toast(isPublished
                ? "Enter both scores as whole numbers between 0 and 99."
                : "Scores must be whole numbers between 0 and 99.", "error");
            return;
        }
        var tieBreakError = scheduledTieBreakError(fixture, controls, isPublished);
        if (tieBreakError) {
            toast(tieBreakError, "error");
            return;
        }
        var homeScorers = collectGoalScorerEntries("results-edit-home-goals-" + fixture.id);
        var awayScorers = collectGoalScorerEntries("results-edit-away-goals-" + fixture.id);
        var preserveScorers = hasUneditableScorerEntries(result.homeScorers, fixture.homeId) ||
            hasUneditableScorerEntries(result.awayScorers, fixture.awayId);
        var tieBreakMethod = controls.tieBreakMethod || "";
        var homeExtraTimeScore = controls.homeExtraTimeScore === "" ||
            controls.homeExtraTimeScore === undefined ? null : Number(controls.homeExtraTimeScore);
        var awayExtraTimeScore = controls.awayExtraTimeScore === "" ||
            controls.awayExtraTimeScore === undefined ? null : Number(controls.awayExtraTimeScore);
        var scorerHomeScore = tieBreakMethod && homeExtraTimeScore !== null
            ? homeExtraTimeScore : Number(controls.homeScore || 0);
        var scorerAwayScore = tieBreakMethod && awayExtraTimeScore !== null
            ? awayExtraTimeScore : Number(controls.awayScore || 0);
        if ((homeScorers.length && !goalScorersFitScore(scorerHomeScore, homeScorers, fixture.homeId)) ||
            (awayScorers.length && !goalScorersFitScore(scorerAwayScore, awayScorers, fixture.awayId))) {
            toast("Recorded scorer goals must use registered players or own goals and cannot exceed the team score.", "error");
            return;
        }
        var correctionReason = $("[data-result-correction-reason]", modal);
        correctionReason = correctionReason ? correctionReason.value.trim() : "";
        if (isPublished && !correctionReason) {
            toast("A correction reason is required.", "error");
            return;
        }
        var saveButton = $('[data-action="save-result-edit"]', modal);
        if (saveButton) saveButton.disabled = true;
        var requestBody = {
            homeScore: controls.homeScore === "" ? null : Number(controls.homeScore),
            awayScore: controls.awayScore === "" ? null : Number(controls.awayScore),
            tieBreakMethod: tieBreakMethod,
            homeExtraTimeScore: homeExtraTimeScore,
            awayExtraTimeScore: awayExtraTimeScore,
            homePenaltiesScore: controls.homePenaltiesScore === "" ||
                controls.homePenaltiesScore === undefined ? null : Number(controls.homePenaltiesScore),
            awayPenaltiesScore: controls.awayPenaltiesScore === "" ||
                controls.awayPenaltiesScore === undefined ? null : Number(controls.awayPenaltiesScore),
            state: isPublished ? "published" : "draft",
            notes: controls.notes || "",
            correctionReason: correctionReason
        };
        if (!preserveScorers) {
            requestBody.homeScorers = homeScorers;
            requestBody.awayScorers = awayScorers;
        }
        window.AngutsaPlatform.request("/admin/matches/" + encodeURIComponent(fixture.id) + "/result", {
            method: "PUT",
            body: requestBody
        }).then(async function () {
            if ($("#modalHost .modal") === modal) closeModal();
            try {
                await refreshLiveAdminData();
                toast(isPublished ? "Published result corrected." : "Draft result updated.", "success");
            } catch (error) {
                toast("The result was saved, but the Results view could not be refreshed. " +
                    (error && error.message ? error.message : ""), "error");
            }
        }).catch(function (error) {
            if (saveButton) saveButton.disabled = false;
            toast(error && error.message ? error.message : "We couldn't save the result. Please try again.", "error");
        });
    }

    function actionSaveScheduledResult(fixtureId, confirmResult) {
        var fixture = byId(DEMO.fixtures, fixtureId);
        if (!fixture || (fixture.status !== "scheduled" && fixture.status !== "draft")) {
            toast("This fixture is no longer awaiting a result.", "error");
            return;
        }
        var controls = scheduledResultControls(fixtureId);
        var scores = [controls.homeScore, controls.awayScore];
        if (confirmResult && scores.some(function (score) {
            return score === "" || !/^\d+$/.test(String(score)) || Number(score) < 0 || Number(score) > 99;
        })) {
            toast("Enter both scores as whole numbers between 0 and 99 before confirming.", "error");
            return;
        }
        if (!confirmResult && scores.some(function (score) {
            return score !== "" &&
                (!/^\d+$/.test(String(score)) || Number(score) < 0 || Number(score) > 99);
        })) {
            toast("Scores must be whole numbers between 0 and 99.", "error");
            return;
        }
        var tieBreakError = scheduledTieBreakError(fixture, controls, confirmResult);
        if (tieBreakError) {
            toast(tieBreakError, "error");
            return;
        }
        var tieBreakMethod = controls.tieBreakMethod || "";
        var homeExtraTimeScore = controls.homeExtraTimeScore === "" ||
            controls.homeExtraTimeScore === undefined ? null : Number(controls.homeExtraTimeScore);
        var awayExtraTimeScore = controls.awayExtraTimeScore === "" ||
            controls.awayExtraTimeScore === undefined ? null : Number(controls.awayExtraTimeScore);
        var homePenaltiesScore = controls.homePenaltiesScore === "" ||
            controls.homePenaltiesScore === undefined ? null : Number(controls.homePenaltiesScore);
        var awayPenaltiesScore = controls.awayPenaltiesScore === "" ||
            controls.awayPenaltiesScore === undefined ? null : Number(controls.awayPenaltiesScore);
        var scorerHomeScore = tieBreakMethod && homeExtraTimeScore !== null
            ? homeExtraTimeScore : Number(controls.homeScore || 0);
        var scorerAwayScore = tieBreakMethod && awayExtraTimeScore !== null
            ? awayExtraTimeScore : Number(controls.awayScore || 0);
        var homeScorers = collectGoalScorerEntries("results-home-goals-" + fixtureId);
        var awayScorers = collectGoalScorerEntries("results-away-goals-" + fixtureId);
        if (confirmResult &&
            (!goalScorersFitScore(scorerHomeScore, homeScorers, fixture.homeId) ||
                !goalScorersFitScore(scorerAwayScore, awayScorers, fixture.awayId))) {
            toast("Recorded scorer goals must use registered players or own goals and cannot exceed the team score.", "error");
            return;
        }
        var existing = DEMO.results.filter(function (item) {
            return item.fixtureId === fixtureId;
        })[0];
        homeScorers = preserveLegacyScorersForDraft(
            homeScorers, existing && existing.homeScorers, confirmResult);
        awayScorers = preserveLegacyScorersForDraft(
            awayScorers, existing && existing.awayScorers, confirmResult);
        var result = existing ? Object.assign({}, existing) : {
            id: "RES-" + String(Date.now()),
            fixtureId: fixtureId,
            publicTournamentId: publicTournamentIdFor(fixture.tournamentId),
            homeId: fixture.homeId,
            awayId: fixture.awayId
        };
        while (!existing && DEMO.results.some(function (item) { return item.id === result.id; })) {
            result.id = "RES-" + String(Number(result.id.slice(4)) + 1);
        }
        result.homeScore = controls.homeScore === "" ? null : Number(controls.homeScore);
        result.awayScore = controls.awayScore === "" ? null : Number(controls.awayScore);
        result.tieBreakMethod = tieBreakMethod;
        result.homeExtraTimeScore = homeExtraTimeScore;
        result.awayExtraTimeScore = awayExtraTimeScore;
        result.homePenaltiesScore = homePenaltiesScore;
        result.awayPenaltiesScore = awayPenaltiesScore;
        result.publicTournamentId = publicTournamentIdFor(fixture.tournamentId);
        result.homeScorers = homeScorers;
        result.awayScorers = awayScorers;
        result.enteredBy = state.prefs.adminName;
        result.enteredOn = eatToday();
        result.notes = "Result entered from the Results workspace.";

        var save = async function () {
            try {
                await window.AngutsaPlatform.request("/admin/matches/" +
                    encodeURIComponent(fixtureId) + "/result", {
                        method: "PUT",
                        body: {
                            homeScore: result.homeScore,
                            awayScore: result.awayScore,
                            tieBreakMethod: result.tieBreakMethod,
                            homeExtraTimeScore: result.homeExtraTimeScore,
                            awayExtraTimeScore: result.awayExtraTimeScore,
                            homePenaltiesScore: result.homePenaltiesScore,
                            awayPenaltiesScore: result.awayPenaltiesScore,
                            state: confirmResult ? "published" : "draft",
                            notes: result.notes,
                            homeScorers: result.homeScorers,
                            awayScorers: result.awayScorers
                        }
                    });
                await refreshLiveAdminData();
                toast(confirmResult ? "Result confirmed and standings updated." :
                    "Score draft saved. It does not count toward standings until confirmed.", "success");
            } catch (error) {
                toast(error && error.message ? error.message : "We couldn't save the match result. Please try again.", "error");
            }
        };
        if (!confirmResult) {
            save();
            return;
        }
        confirmDialog({
            title: "Confirm match result?",
            message: "This score will be published and count toward standings. Scorer names are optional.",
            confirmLabel: "Confirm result",
            tone: "info"
        }).then(function (confirmed) {
            if (confirmed) save();
        });
    }

    function resultStageKey(result) {
        var context = managementResultContext(result);
        if (context) return context.match.stage;
        var fixture = byId(DEMO.fixtures, result.fixtureId);
        var round = fixture ? String(fixture.round || "").toLowerCase() : "";
        if (fixture && fixture.group || round.indexOf("group") !== -1 || round.indexOf("matchday") !== -1) {
            return "group";
        }
        if (round.indexOf("quarter") !== -1) return "quarter-finals";
        if (round.indexOf("semi") !== -1) return "semi-finals";
        if (round.indexOf("third") !== -1) return "third-place-playoff";
        if (round.indexOf("final") !== -1) return "final";
        return "other";
    }

    function resultStageLabel(result) {
        var key = resultStageKey(result);
        var labels = {
            group: "Group Stage",
            "quarter-finals": "Quarter-finals",
            "semi-finals": "Semi-finals",
            "third-place-playoff": "Third-Place Playoff",
            final: "Final",
            other: "Other"
        };
        var fixture = byId(DEMO.fixtures, result.fixtureId);
        var context = managementResultContext(result);
        var groupName = context ? context.match.group : fixture && fixture.group;
        return labels[key] + (key === "group" && groupName ? " \u00b7 " + groupName : "");
    }

    function actionOpenManagedResult(id) {
        var result = byId(DEMO.results, id);
        var context = managementResultContext(result);
        if (!context) {
            toast("This result is not linked to a Tournament Management fixture.", "error");
            return;
        }
        state.managementTournament = context.record.tournamentId;
        state.managementStage = context.match.stage === "group" ? "groups" : context.match.stage;
        setView("tournament-management");
    }

    function editAction(moduleKey, id) {
        return moduleIsEditable(moduleKey, "edit")
            ? actionButton("edit", id, moduleKey, "Edit record", "edit")
            : "";
    }

    function deleteAction(moduleKey, id) {
        return moduleIsEditable(moduleKey, "delete")
            ? actionButton("delete", id, moduleKey, "Delete record", "trash", "danger")
            : "";
    }

    function approveAction(moduleKey, id) {
        var key = moduleKey === "payments" ? "payments.review" : "registrations.approve";
        return hasAdminPermission(key)
            ? actionButton("approve", id, moduleKey, "Approve", "checkCircle")
            : "";
    }

    function rejectAction(moduleKey, id) {
        var key = moduleKey === "payments" ? "payments.review" : "registrations.reject";
        return hasAdminPermission(key)
            ? actionButton("reject", id, moduleKey, "Reject", "close")
            : "";
    }

    function correctionAction(moduleKey, id) {
        return hasAdminPermission("registrations.edit")
            ? actionButton("request-correction", id, moduleKey, "Request correction", "refresh")
            : "";
    }

    function statusOptionsFrom(key) {
        return optionList(STATUS_OPTIONS[key] || []);
    }

    function categoryFilterOptions() {
        return DEMO.categories.map(function (category) {
            return { value: category.name, label: category.name };
        });
    }

    function teamCountFor(tournamentId) {
        return DEMO.teams.filter(function (team) {
            return team.tournamentId === tournamentId;
        }).length;
    }

    /* Archived competitions keep the number of teams that took part, because
       the current team list only holds this season's registrations. */
    function tournamentTeamCount(record) {
        var live = teamCountFor(record.id);
        if (live) return live;
        return toNumber(record.archivedTeams);
    }

    /* Banner thumbnail used in the tournament register and detail view. The
       image matches the one the public tournament card displays. */
    function tournamentBanner(record) {
        if (!record || !record.banner) {
            return '<span class="banner-thumb" data-empty="true" aria-hidden="true">' +
                icon("image") + "</span>";
        }

        return '<span class="banner-thumb"><img src="' + esc(record.banner) +
            '" alt="" loading="lazy"></span>';
    }

    function teamsInCategory(categoryId) {
        return DEMO.teams.filter(function (team) {
            return team.categoryId === categoryId;
        }).length;
    }

    function playersInTeam(teamId) {
        return DEMO.players.filter(function (player) {
            return player.teamId === teamId;
        }).length;
    }

    function tournamentsForCategory(categoryId) {
        return DEMO.tournaments.filter(function (tournament) {
            return tournament.categoryId === categoryId;
        }).length;
    }

    function registrationStatusBadge(value) {
        var map = {
            open: "open",
            closed: "cancelled",
            "not opened": "draft",
            waitlist: "pending"
        };
        return statusBadge(map[normalise(value)] || "neutral", value);
    }

    /* -------------------------
       Tournaments
       ------------------------- */

    defineListModule({
        view: "tournaments",
        description: "Create competitions, control registration windows and move them through draft, " +
            "active, completed and archived states.",
        addLabel: "Create tournament",
        caption: "Tournament register",
        records: function () { return DEMO.tournaments; },
        search: ["name", "season", "venue", function (record) { return categoryName(record.categoryId); }],
        filters: [
            { name: "status", label: "Status", options: statusOptionsFrom("tournaments") },
            { name: "categoryName", label: "Category", options: categoryFilterOptions(),
                value: function (record) { return categoryName(record.categoryId); } },
            { name: "registrationStatus", label: "Registration",
                options: optionList(["Open", "Not opened", "Closed", "Waitlist"]) },
            { name: "feeBand", label: "Registration fee",
                options: optionList(["Fee charged", "No fee"]),
                value: function (record) {
                    return tournamentFee(record.id) > 0 ? "Fee charged" : "No fee";
                } }
        ],
        sorters: {
            name: function (record) { return record.name; },
            season: function (record) { return record.season; },
            startDate: function (record) { return toDate(record.startDate) || 0; },
            status: function (record) { return record.status; },
            teams: function (record) { return teamCountFor(record.id); },
            fee: function (record) { return tournamentFee(record.id); }
        },
        columns: [
            { key: "name", label: "Tournament" },
            { key: "season", label: "Season" },
            { key: "startDate", label: "Dates" },
            { key: "venue", label: "Venue" },
            { key: "teams", label: "Teams", numeric: true },
            { key: "fee", label: "Registration fee", numeric: true },
            { key: "status", label: "Status" },
            { key: "registrationStatus", label: "Registration" }
        ],
        summary: function (records) {
            var teams = records.reduce(function (all, tournament) {
                return all.concat(teamsForTournament(tournament.id));
            }, []);
            var ledger = feeLedgerFor(teams);

            return '<div class="kpi-grid" style="margin-bottom:16px">' +
                kpiCard({ label: "Tournaments shown", value: records.length, icon: "trophy" }) +
                kpiCard({ label: "Registered teams", value: ledger.teams, icon: "shield",
                    tone: "blue" }) +
                kpiCard({ label: "Fees cleared", value: ledger.cleared + " of " + ledger.teams,
                    icon: "checkCircle", tone: "green" }) +
                kpiCard({ label: "Outstanding fees", value: formatMoney(ledger.outstanding),
                    icon: "alert", tone: "red" }) +
                "</div>";
        },
        cells: function (record) {
            var ledger = feeLedgerFor(teamsForTournament(record.id));
            var fee = tournamentFee(record.id);
            var count = tournamentTeamCount(record);
            var cap = toNumber(record.teamCap);

            return [
                '<div class="cell-entity">' + tournamentBanner(record) +
                    '<div class="cell-stack"><strong>' + esc(record.name) + "</strong><span>" +
                    esc(categoryName(record.categoryId)) + "</span><span>" +
                    esc(record.publicId || record.id) + "</span></div></div>",
                '<div class="cell-stack"><span>' + esc(record.season) + "</span><span>" +
                    (record.featured ? badge("Featured", "purple") : "") +
                    (record.standingsAvailable ? badge("Standings", "green") : "") + "</span></div>",
                '<div class="cell-stack"><span>' + esc(formatDateRange(record.startDate, record.endDate)) +
                    "</span><span>" + esc(record.format || "Format not set") + "</span><span>" +
                    esc("Registration " + formatDate(record.registrationOpens) + " to " +
                        formatDate(record.registrationCloses)) + "</span></div>",
                '<div class="cell-stack"><span>' + esc(record.venue) + "</span><span>" +
                    esc(record.location || "Location not set") + "</span></div>",
                '<div class="cell-stack"><span>' + count + (cap ? " of " + cap : "") +
                    "</span><span>" + esc(count && !teamCountFor(record.id)
                        ? "Archive entry" : "Registered teams") + "</span></div>",
                '<div class="cell-stack"><span class="money">' + esc(formatMoney(fee)) +
                    "</span><span>" + esc(ledger.teams
                        ? ledger.cleared + " of " + ledger.teams + " teams cleared"
                        : (fee === 0 ? "No fee is charged" : "No teams registered yet")) +
                    "</span></div>",
                statusBadge(record.status),
                registrationStatusBadge(record.registrationStatus)
            ];
        },
        actions: function (record) {
            return viewAction("tournaments", record.id, "tournament") +
                editAction("tournaments", record.id) +
                actionButton("toggle-featured", record.id, "tournaments",
                    record.featured ? "Hide from homepage" : "Feature on homepage", "eye") +
                actionButton("publish", record.id, "tournaments",
                    ["active", "upcoming", "completed"].indexOf(normalise(record.status)) !== -1
                        ? "Archive tournament" : "Activate tournament",
                    ["active", "upcoming", "completed"].indexOf(normalise(record.status)) !== -1
                        ? "archive" : "play") +
                deleteAction("tournaments", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "publicId", label: "Public reference" },
                { key: "slug", label: "Public slug" },
                { key: "name", label: "Tournament" },
                { key: "season", label: "Season" },
                { value: function (r) { return categoryName(r.categoryId); }, label: "Category" },
                { key: "startDate", label: "Start date" },
                { key: "endDate", label: "End date" },
                { key: "registrationOpens", label: "Registration opens" },
                { key: "registrationCloses", label: "Registration closes" },
                { key: "venue", label: "Venue" },
                { key: "location", label: "Location" },
                { key: "format", label: "Format" },
                { key: "teamCap", label: "Team capacity" },
                { key: "registrationFee", label: "Registration fee" },
                { key: "banner", label: "Banner image" },
                { value: function (r) { return r.featured ? "Yes" : "No"; }, label: "Featured" },
                { value: function (r) { return r.standingsAvailable ? "Yes" : "No"; },
                    label: "Standings published" },
                { value: function (r) { return tournamentTeamCount(r); }, label: "Teams" },
                { value: function (r) { return feeLedgerFor(teamsForTournament(r.id)).cleared; },
                    label: "Teams cleared" },
                { value: function (r) { return feeLedgerFor(teamsForTournament(r.id)).outstanding; },
                    label: "Outstanding fees" },
                { key: "status", label: "Status" },
                { key: "registrationStatus", label: "Registration status" },
                { key: "overview", label: "Public overview" }
            ];
        }
    });

    /* -------------------------
       Tournament categories
       ------------------------- */

    defineListModule({
        view: "categories",
        description: "Define the age groups and classifications that tournaments, teams and players " +
            "are registered into.",
        addLabel: "Create category",
        caption: "Tournament categories",
        records: function () { return DEMO.categories; },
        search: ["name", "shortName", "code", "ageGroup", "gender",
            function (record) { return record.publicId; }],
        filters: [
            { name: "status", label: "Status", options: statusOptionsFrom("categories") },
            { name: "guardianConsent", label: "Guardian consent",
                options: optionList(["Required", "Not required"]),
                value: function (record) {
                    return record.guardianConsent ? "Required" : "Not required";
                } }
        ],
        sorters: {
            name: function (record) { return record.name; },
            ageGroup: function (record) { return record.ageGroup; },
            teams: function (record) { return teamsInCategory(record.id); },
            status: function (record) { return record.status; }
        },
        columns: [
            { key: "name", label: "Category" },
            { key: "ageGroup", label: "Age group" },
            { key: "gender", label: "Classification" },
            { key: "guardianConsent", label: "Guardian consent" },
            { key: "teams", label: "Teams", numeric: true },
            { key: "status", label: "Status" }
        ],
        cells: function (record) {
            return [
                '<div class="cell-stack"><strong>' + esc(record.name) + "</strong><span>" +
                    esc(record.gender + " \u00b7 " + record.code) + "</span><span>" +
                    esc(record.publicId || record.id) + "</span></div>",
                '<div class="cell-stack"><span>' + esc(record.ageGroup) + "</span>" +
                    (record.ageMin === null || record.ageMin === undefined
                        ? "" : "<span>" + esc(record.ageMax
                            ? "Ages " + record.ageMin + " to " + record.ageMax
                            : "Ages " + record.ageMin + " and above") + "</span>") + "</div>",
                esc(record.gender),
                record.guardianConsent
                    ? badge("Required", "gold")
                    : badge("Not required"),
                String(teamsInCategory(record.id)),
                statusBadge(record.status)
            ];
        },
        actions: function (record) {
            return viewAction("categories", record.id, "category") +
                editAction("categories", record.id) + deleteAction("categories", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "publicId", label: "Public reference" },
                { key: "name", label: "Category" },
                { key: "code", label: "Code" },
                { key: "ageGroup", label: "Age group" },
                { key: "ageMin", label: "Minimum age" },
                { key: "ageMax", label: "Maximum age" },
                { key: "gender", label: "Classification" },
                { value: function (r) { return r.guardianConsent ? "Required" : "Not required"; },
                    label: "Guardian consent" },
                { key: "status", label: "Status" },
                { key: "description", label: "Description" }
            ];
        }
    });

    /* -------------------------
       Teams
       ------------------------- */

    defineListModule({
        view: "teams",
        description: "Review teams loaded from the live registration database.",
        hideCreate: true,
        headerActions: function () {
            return state.admin && state.admin.role === "platform_owner"
                ? '<button type="button" class="btn btn-primary" data-action="create-admin-team">' +
                    icon("plus") + "Create team</button>"
                : "";
        },
        caption: "Registered teams",
        records: function () {
            return DEMO.teams.filter(function (team) { return !team.archived; });
        },
        search: ["name", "shortName", "manager", "location"],
        filters: [
            { name: "registrationStatus", label: "Status", options: statusOptionsFrom("teams") },
            { name: "categoryName", label: "Category", options: categoryFilterOptions(),
                value: function (record) { return categoryName(record.categoryId); } },
            { name: "tournamentId", label: "Tournament", options: tournamentOptions },
            { name: "feeStatus", label: "Fee balance",
                options: optionList(["Cleared", "Partly paid", "Unpaid", "Awaiting review",
                    "No fee", "Not applicable"]),
                value: function (record) {
                    return FEE_STATUS_LABEL[feeAccountFor(record.id, record.tournamentId).status];
                } }
        ],
        sorters: {
            name: function (record) { return record.name; },
            categoryName: function (record) { return categoryName(record.categoryId); },
            squadSize: function (record) { return toNumber(record.squadSize); },
            registrationStatus: function (record) { return record.registrationStatus; },
            registeredOn: function (record) { return toDate(record.registeredOn) || 0; },
            feeBalance: function (record) {
                return feeAccountFor(record.id, record.tournamentId).balance;
            }
        },
        columns: [
            { key: "name", label: "Team" },
            { key: "categoryName", label: "Category" },
            { key: "manager", label: "Manager" },
            { key: "squadSize", label: "Squad", numeric: true },
            { key: "feeBalance", label: "Fee balance", numeric: true },
            { key: "registrationStatus", label: "Registration" },
            { key: "registeredOn", label: "Registered" }
        ],
        cells: function (record) {
            var account = feeAccountFor(record.id, record.tournamentId);

            return [
                '<div class="cell-entity">' + crest(record.name) + '<div class="cell-stack"><strong>' +
                    esc(record.name) + "</strong><span>" + esc(record.shortName + " \u00b7 " +
                        (record.location || "Location not set")) + "</span></div></div>",
                '<div class="cell-stack"><span>' + esc(categoryName(record.categoryId)) + "</span><span>" +
                    esc(tournamentName(record.tournamentId)) + "</span></div>",
                esc(record.manager),
                String(record.squadSize || 0),
                '<div class="cell-stack"><span class="money">' +
                    esc(account.status === "not-required" ? "Not applicable" :
                        formatMoney(account.balance)) + "</span><span>" +
                    esc(account.status === "not-required" ? "Registration rejected" :
                        formatMoney(account.fee) + " fee \u00b7 " + formatMoney(account.paid) +
                            " cleared") + "</span></div>",
                statusBadge(record.registrationStatus),
                esc(formatDate(record.registeredOn))
            ];
        },
        actions: function (record) {
            return viewAction("teams", record.id, "team") +
                (normalise(record.registrationStatus) === "approved"
                    ? "" : approveAction("teams", record.id)) +
                editAction("teams", record.id) +
                rejectAction("teams", record.id) +
                (hasAdminPermission("teams.archive")
                    ? actionButton("archive", record.id, "teams", "Archive team", "archive")
                    : "");
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "name", label: "Team" },
                { value: function (r) { return categoryName(r.categoryId); }, label: "Category" },
                { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
                { key: "manager", label: "Manager" },
                { key: "squadSize", label: "Squad size" },
                { value: function (r) { return feeAccountFor(r.id, r.tournamentId).fee; },
                    label: "Registration fee" },
                { value: function (r) { return feeAccountFor(r.id, r.tournamentId).paid; },
                    label: "Fee cleared" },
                { value: function (r) { return feeAccountFor(r.id, r.tournamentId).balance; },
                    label: "Fee balance" },
                { value: function (r) {
                    return FEE_STATUS_LABEL[feeAccountFor(r.id, r.tournamentId).status];
                }, label: "Fee status" },
                { key: "registrationStatus", label: "Registration status" },
                { key: "registeredOn", label: "Registered on" }
            ];
        }
    });

    /* -------------------------
       Players
       ------------------------- */

    defineListModule({
        view: "players",
        description: "Filter the roster by team, review player details, and print or save the visible players as a PDF.",
        hideCreate: true,
        caption: "Player roster",
        records: function () { return DEMO.players; },
        search: ["name", "position", function (record) { return teamName(record.teamId); }],
        filters: [
            { name: "teamId", label: "My team", allLabel: "All teams", options: teamOptions }
        ],
        sorters: {
            name: function (record) { return record.name; },
            team: function (record) { return teamName(record.teamId); },
            jersey: function (record) { return toNumber(record.jersey); },
            registrationStatus: function (record) { return record.registrationStatus; },
            eligibility: function (record) { return record.eligibility; }
        },
        columns: [
            { key: "name", label: "Player" },
            { key: "team", label: "Team" },
            { key: "jersey", label: "Jersey", numeric: true },
            { key: "position", label: "Position" },
            { key: "registrationStatus", label: "Roster status" },
            { key: "eligibility", label: "Eligibility" }
        ],
        cells: function (record) {
            return [
                '<div class="cell-entity">' + crest(record.name, true) +
                    '<div class="cell-stack"><strong>' + esc(record.name) + "</strong><span>" +
                    esc(categoryName(record.categoryId)) + "</span></div></div>",
                esc(teamName(record.teamId)),
                String(record.jersey),
                esc(record.position),
                statusBadge("registered", "Registered"),
                eligibilityBadge(record.eligibility) +
                    (record.guardianConsent ? ' <span class="badge badge-green">Consent</span>' : "")
            ];
        },
        actions: function (record) {
            return viewAction("players", record.id, "player");
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "name", label: "Player" },
                { value: function (r) { return teamName(r.teamId); }, label: "Team" },
                { key: "jersey", label: "Jersey" },
                { key: "position", label: "Position" },
                { value: function () { return "Registered"; }, label: "Roster status" },
                { key: "eligibility", label: "Eligibility" },
                { value: function (r) { return r.guardianConsent ? "Yes" : "No"; }, label: "Guardian consent" }
            ];
        }
    });

    /* -------------------------
       Team registrations
       ------------------------- */

    defineListModule({
        view: "team-registrations",
        description: "Review submitted team registrations, approve or reject them, or ask the team " +
            "for corrections before the draw is made.",
        caption: "Team registrations",
        formKey: "teams",
        hideCreate: true,
        records: function () { return DEMO.teamRegistrations; },
        search: ["id", function (record) { return teamName(record.teamId); },
            function (record) { return tournamentName(record.tournamentId); }],
        filters: [
            { name: "status", label: "Status",
                options: optionList(["Pending review", "Approved", "Rejected", "Correction requested"]) },
            { name: "tournamentId", label: "Tournament", options: tournamentOptions },
            { name: "feeStatus", label: "Fee balance",
                options: optionList(["Cleared", "Partly paid", "Unpaid", "Awaiting review",
                    "No fee", "Not applicable"]),
                value: function (record) {
                    return FEE_STATUS_LABEL[feeAccountFor(record.teamId, record.tournamentId).status];
                } }
        ],
        sorters: {
            id: function (record) { return record.id; },
            team: function (record) { return teamName(record.teamId); },
            submitted: function (record) { return toDate(record.submitted) || 0; },
            status: function (record) { return record.status; },
            feeBalance: function (record) {
                return feeAccountFor(record.teamId, record.tournamentId).balance;
            }
        },
        columns: [
            { key: "id", label: "Reference" },
            { key: "team", label: "Team" },
            { key: "tournamentId", label: "Tournament" },
            { key: "submitted", label: "Submitted" },
            { key: "fee", label: "Registration fee", numeric: true },
            { key: "feeBalance", label: "Balance to clear", numeric: true },
            { key: "status", label: "Status" },
            { key: "outstanding", label: "Outstanding requirements" }
        ],
        summary: function (records) {
            var lines = records.map(function (record) {
                return { account: feeAccountFor(record.teamId, record.tournamentId) };
            }).filter(function (line) {
                return line.account.status !== "not-required";
            });

            var expected = sum(lines, function (line) { return line.account.fee; });
            var outstanding = sum(lines, function (line) { return line.account.balance; });
            var cleared = lines.filter(function (line) { return line.account.cleared; }).length;
            var awaiting = lines.filter(function (line) {
                return line.account.pending > 0 && !line.account.cleared;
            }).length;

            return '<div class="kpi-grid" style="margin-bottom:16px">' +
                kpiCard({ label: "Fees due on these registrations", value: formatMoney(expected),
                    icon: "wallet", tone: "gold" }) +
                kpiCard({ label: "Cleared in full", value: cleared + " of " + lines.length,
                    icon: "checkCircle", tone: "green" }) +
                kpiCard({ label: "Still to clear", value: formatMoney(outstanding),
                    icon: "alert", tone: "red" }) +
                kpiCard({ label: "Payments awaiting review", value: awaiting,
                    icon: "clock", tone: "amber" }) +
                "</div>";
        },
        cells: function (record) {
            var account = feeAccountFor(record.teamId, record.tournamentId);
            var notApplicable = account.status === "not-required";

            return [
                '<span class="mono">' + esc(record.id) + "</span>",
                '<div class="cell-entity">' + crest(teamName(record.teamId)) +
                    "<strong>" + esc(teamName(record.teamId)) + "</strong></div>",
                esc(tournamentName(record.tournamentId)),
                esc(formatDate(record.submitted)),
                notApplicable
                    ? '<span class="muted">Not applicable</span>'
                    : '<span class="money">' + esc(formatMoney(account.fee)) + "</span>",
                notApplicable
                    ? feeStatusBadge(account)
                    : '<div class="cell-stack"><span class="money">' +
                        esc(formatMoney(account.balance)) + "</span>" + feeStatusBadge(account) +
                        "</div>",
                statusBadge(record.status),
                esc(record.outstanding)
            ];
        },
        actions: function (record) {
            return viewAction("team-registrations", record.id, "registration") +
                approveAction("team-registrations", record.id) +
                rejectAction("team-registrations", record.id) +
                correctionAction("team-registrations", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { value: function (r) { return teamName(r.teamId); }, label: "Team" },
                { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
                { key: "submitted", label: "Submitted" },
                { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).fee; },
                    label: "Registration fee" },
                { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).paid; },
                    label: "Fee cleared" },
                { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).balance; },
                    label: "Fee balance" },
                { value: function (r) {
                    return FEE_STATUS_LABEL[feeAccountFor(r.teamId, r.tournamentId).status];
                }, label: "Fee status" },
                { key: "status", label: "Status" },
                { key: "outstanding", label: "Outstanding requirements" },
                { key: "reviewedBy", label: "Reviewed by" }
            ];
        }
    });

    /* -------------------------
       Player records
       ------------------------- */

    defineListModule({
        view: "player-registrations",
        description: "View player roster records and eligibility notes. Individual player approval is not required.",
        caption: "Player roster records",
        hideCreate: true,
        records: function () { return DEMO.playerRegistrations; },
        search: ["id", function (record) { return playerName(record.playerId); },
            function (record) { return teamName(record.teamId); }],
        filters: [
            { name: "eligibility", label: "Eligibility",
                options: optionList(["Eligible", "Under review", "Age query"]) },
            { name: "tournamentId", label: "Tournament", options: tournamentOptions }
        ],
        sorters: {
            id: function (record) { return record.id; },
            player: function (record) { return playerName(record.playerId); },
            team: function (record) { return teamName(record.teamId); },
            submitted: function (record) { return toDate(record.submitted) || 0; },
            status: function () { return "Registered"; }
        },
        columns: [
            { key: "id", label: "Reference" },
            { key: "player", label: "Player" },
            { key: "team", label: "Team" },
            { key: "tournamentId", label: "Tournament" },
            { key: "submitted", label: "Submitted" },
            { key: "status", label: "Roster status" },
            { key: "eligibility", label: "Eligibility" }
        ],
        cells: function (record) {
            return [
                '<span class="mono">' + esc(record.id) + "</span>",
                esc(playerName(record.playerId)),
                '<div class="cell-entity">' + crest(teamName(record.teamId)) +
                    "<strong>" + esc(teamName(record.teamId)) + "</strong></div>",
                '<div class="cell-stack"><span>' + esc(tournamentName(record.tournamentId)) +
                    "</span><span>" + esc(record.notes) + "</span></div>",
                esc(formatDate(record.submitted)),
                statusBadge("registered", "Registered"),
                eligibilityBadge(record.eligibility)
            ];
        },
        actions: function (record) {
            return viewAction("player-registrations", record.id, "registration");
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { value: function (r) { return playerName(r.playerId); }, label: "Player" },
                { value: function (r) { return teamName(r.teamId); }, label: "Team" },
                { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
                { key: "submitted", label: "Submitted" },
                { value: function () { return "Registered"; }, label: "Roster status" },
                { key: "eligibility", label: "Eligibility" },
                { key: "notes", label: "Notes" }
            ];
        }
    });

    /* Detects double-booked venues or teams across the whole fixture list. */
    function fixtureConflictSummary() {
        var clashes = [];

        DEMO.fixtures.forEach(function (fixture) {
            var others = detectFixtureConflicts({
                id: fixture.id,
                homeId: fixture.homeId,
                awayId: fixture.awayId,
                kickoff: fixture.kickoff,
                venue: fixture.venue
            });
            if (others.length) {
                clashes.push('<div class="task-item"><span class="kpi-icon" data-tone="amber">' +
                    icon("alert") + '</span><div class="task-item-text"><strong>' +
                    esc(fixture.id + " \u00b7 " + fixtureLabel(fixture.id)) + "</strong><span>" +
                    esc(others[0]) + "</span></div>" +
                    '<button type="button" class="btn btn-outline btn-sm" data-action="edit" ' +
                    'data-module="fixtures" data-id="' + esc(fixture.id) + '">Review</button></div>');
            }
        });

        if (!clashes.length) {
            return card("Schedule check", '<div class="task-item is-done">' + icon("checkCircle") +
                '<div class="task-item-text"><strong>No clashes detected</strong>' +
                "<span>Kickoff slots and venues do not overlap in the current schedule.</span>" +
                "</div></div>");
        }

        return card("Schedule warnings", '<div class="task-list">' + clashes.join("") + "</div>", {
            subtitle: "Detected from backend fixture records."
        });
    }

    /* -------------------------
       Fixtures
       ------------------------- */

    defineListModule({
        view: "fixtures",
        description: "Create matches for the approved tournament stage above. The table shows saved fixtures.",
        hideCreate: true,
        caption: "Fixture list",
        records: function () { return DEMO.fixtures; },
        search: ["id", "round", "group", "venue", function (record) { return teamName(record.homeId); },
            function (record) { return teamName(record.awayId); }],
        before: fixtureConflictSummary,
        filters: [
            { name: "status", label: "Status", options: statusOptionsFrom("fixtures") },
            { name: "tournamentId", label: "Tournament", options: tournamentOptions },
            { name: "group", label: "Group", options: function () {
                var groups = [];
                tournamentManagement.forEach(function (record) {
                    record.groupNames.forEach(function (name) {
                        if (groups.indexOf(name) === -1) groups.push(name);
                    });
                });
                return optionList(groups);
            } }
        ],
        sorters: {
            id: function (record) { return record.id; },
            kickoff: function (record) { return toDate(record.kickoff) || 0; },
            round: function (record) { return record.round; },
            home: function (record) { return teamName(record.homeId); },
            status: function (record) { return record.status; }
        },
        columns: [
            { key: "id", label: "Fixture" },
            { key: "kickoff", label: "Kickoff" },
            { key: "round", label: "Round" },
            { key: "home", label: "Match" },
            { key: "venue", label: "Venue" },
            { key: "status", label: "Status" }
        ],
        cells: function (record) {
            return [
                '<span class="mono">' + esc(record.id) + "</span>",
                '<div class="cell-stack"><strong>' + esc(formatDate(record.kickoff)) + "</strong><span>" +
                    esc(formatTime(record.kickoff)) + "</span></div>",
                '<div class="cell-stack"><span>' + esc(record.round) + "</span><span>" +
                    esc(record.group || "No group") + "</span></div>",
                '<div class="cell-stack"><strong>' + esc(teamName(record.homeId)) + " v " +
                    esc(teamName(record.awayId)) + "</strong><span>" +
                    esc(tournamentName(record.tournamentId)) + "</span></div>",
                esc(record.venue),
                statusBadge(record.status)
            ];
        },
        actions: function (record) {
            if (record.id.indexOf("TM-") === 0) {
                return viewAction("fixtures", record.id, "fixture");
            }
            return viewAction("fixtures", record.id, "fixture") +
                actionButton("print-match-lineups", record.id, "fixtures",
                    "Print match line-up sheet", "printer") +
                editAction("fixtures", record.id) +
                deleteAction("fixtures", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Fixture" },
                { key: "kickoff", label: "Kickoff" },
                { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
                { value: function (r) { return categoryName(r.categoryId); }, label: "Category" },
                { key: "round", label: "Round" },
                { key: "group", label: "Group" },
                { value: function (r) { return teamName(r.homeId); }, label: "Home team" },
                { value: function (r) { return teamName(r.awayId); }, label: "Away team" },
                { key: "venue", label: "Venue" },
                { key: "status", label: "Status" }
            ];
        }
    });

    /* -------------------------
       Matches and match officials
       ------------------------- */

    defineListModule({
        view: "matches",
        description: "Review matches and fixtures loaded from the live database.",
        hideCreate: true,
        caption: "Match schedule and officials",
        demoNote: "Officials are not managed through a dedicated backend register.",
        records: function () { return DEMO.matches; },
        search: ["id", function (record) { return fixtureLabel(record.fixtureId); }, "referee"],
        filters: [
            { name: "status", label: "Status", options: statusOptionsFrom("matches") }
        ],
        sorters: {
            id: function (record) { return record.id; },
            kickoff: function (record) {
                var fixture = byId(DEMO.fixtures, record.fixtureId);
                return fixture ? (toDate(fixture.kickoff) || 0) : 0;
            },
            fixture: function (record) { return fixtureLabel(record.fixtureId); },
            status: function (record) { return record.status; }
        },
        columns: [
            { key: "id", label: "Match" },
            { key: "fixture", label: "Fixture" },
            { key: "kickoff", label: "Kickoff" },
            { key: "venue", label: "Venue" },
            { key: "referee", label: "Referee" },
            { key: "status", label: "Status" }
        ],
        cells: function (record) {
            var fixture = byId(DEMO.fixtures, record.fixtureId) || {};
            return [
                '<span class="mono">' + esc(record.id) + "</span>",
                '<div class="cell-stack"><strong>' + esc(fixtureLabel(record.fixtureId)) +
                    "</strong><span>" + esc(tournamentName(fixture.tournamentId)) + "</span></div>",
                '<div class="cell-stack"><span>' + esc(formatDate(fixture.kickoff)) + "</span><span>" +
                    esc(formatTime(fixture.kickoff)) + "</span></div>",
                esc(fixture.venue || "Venue not set"),
                '<div class="cell-stack"><span>' + esc(record.referee) + "</span><span>" +
                    esc("AR1: " + (record.assistantOne || "Not assigned")) + "</span></div>",
                statusBadge(record.status)
            ];
        },
        actions: function (record) {
            return viewAction("matches", record.id, "match") +
                editAction("matches", record.id) +
                actionButton("start-match", record.id, "matches", "Start match", "play") +
                actionButton("pause-match", record.id, "matches", "Pause match", "pause") +
                actionButton("complete-match", record.id, "matches", "Complete match", "stop") +
                actionButton("postpone-match", record.id, "matches", "Postpone match", "calendarX") +
                deleteAction("matches", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Match" },
                { value: function (r) { return fixtureLabel(r.fixtureId); }, label: "Fixture" },
                { key: "referee", label: "Referee" },
                { key: "assistantOne", label: "Assistant one" },
                { key: "assistantTwo", label: "Assistant two" },
                { key: "fourthOfficial", label: "Fourth official" },
                { key: "status", label: "Status" }
            ];
        }
    });

    /* -------------------------
       Results
       ------------------------- */

    defineListModule({
        view: "results",
        description: "Review scores and match outcomes across every tournament stage.",
        hideCreate: true,
        headerActions: '<a class="btn btn-primary" href="#/tournament-management">' +
            icon("flag") + 'Open Tournament Management</a>',
        caption: "Tournament results",
        before: function () {
            return renderScheduledResultsPanel();
        },
        records: function () {
            return DEMO.results.filter(function (record) {
                var fixture = byId(DEMO.fixtures, record.fixtureId);
                return !fixture || (fixture.status !== "scheduled" && fixture.status !== "draft");
            });
        },
        search: ["id", function (record) { return fixtureLabel(record.fixtureId); },
            function (record) { return tournamentName((byId(DEMO.fixtures, record.fixtureId) || {}).tournamentId); },
            function (record) { return resultStageLabel(record); }],
        filters: [
            { name: "tournamentId", label: "Tournament", options: tournamentOptions,
                value: function (record) {
                    var fixture = byId(DEMO.fixtures, record.fixtureId);
                    return fixture ? fixture.tournamentId : "";
                } },
            { name: "stage", label: "Stage", options: [
                { value: "group", label: "Group Stage" },
                { value: "quarter-finals", label: "Quarter-finals" },
                { value: "semi-finals", label: "Semi-finals" },
                { value: "third-place-playoff", label: "Third-Place Playoff" },
                { value: "final", label: "Final" },
                { value: "other", label: "Other" }
            ], value: resultStageKey },
            { name: "state", label: "Status", options: optionList(["Draft", "Confirmed", "Published"]),
                value: function (record) {
                    return managementResultContext(record)
                        ? record.state === "published" ? "Confirmed" : "Draft"
                        : record.state === "published" ? "Published" : "Draft";
                } }
        ],
        sorters: {
            stage: function (record) { return resultStageLabel(record); },
            match: function (record) { return fixtureLabel(record.fixtureId); },
            score: function (record) { return record.homeScore; },
            status: function (record) { return record.state; },
            enteredOn: function (record) { return toDate(record.enteredOn) || 0; },
            tournament: function (record) {
                return tournamentName((byId(DEMO.fixtures, record.fixtureId) || {}).tournamentId);
            }
        },
        columns: [
            { key: "stage", label: "Stage" },
            { key: "match", label: "Match" },
            { key: "score", label: "Score", numeric: true },
            { key: "scorers", label: "Goalscorers", sortable: false },
            { key: "status", label: "Status" },
            { key: "tournament", label: "Tournament" },
            { key: "enteredOn", label: "Date" }
        ],
        cells: function (record) {
            var fixture = byId(DEMO.fixtures, record.fixtureId);
            var context = managementResultContext(record);
            var recorded = record.homeScore !== null && record.awayScore !== null;
            var resultState = context
                ? record.state === "published" ? "Confirmed" : "Draft"
                : record.state === "published" ? "Published" : "Draft";
            return [
                esc(resultStageLabel(record)),
                '<div class="cell-stack"><strong>' + esc(teamName(record.homeId)) + " v " +
                    esc(teamName(record.awayId)) + "</strong><span>" +
                    esc(fixture ? fixture.round || fixtureLabel(record.fixtureId) : fixtureLabel(record.fixtureId)) +
                    '</span></div>',
                recorded
                    ? "<strong>" + esc(record.homeScore + " - " + record.awayScore) + "</strong>"
                    : '<span class="muted">Not recorded</span>',
                '<div class="cell-stack"><span>' + esc(formatGoalScorers(record.homeScorers)) +
                    '</span><span>' + esc(formatGoalScorers(record.awayScorers)) + '</span></div>',
                statusBadge(resultState === "Confirmed" || resultState === "Published" ? "published" : "draft", resultState),
                esc(fixture ? tournamentName(fixture.tournamentId) : "Tournament not linked"),
                esc(formatDate(record.enteredOn))
            ];
        },
        actions: function (record) {
            var actions = resultEditAllowed(record)
                ? actionButton("edit-result", record.id, "results", "Edit result", "edit")
                : "";
            return actions + (managementResultContext(record)
                ? actionButton("manage-result", record.id, "results", "Open in Tournament Management", "flag")
                : viewAction("results", record.id, "result"));
        },
        summary: function (records) {
            var confirmed = records.filter(function (record) {
                return managementResultContext(record) && record.state === "published";
            }).length;
            var drafts = records.filter(function (record) {
                return managementResultContext(record) && record.state !== "published";
            }).length;
            return '<div class="results-summary"><span><strong>' + records.length +
                '</strong> results</span><span><strong>' + confirmed +
                '</strong> confirmed tournament results</span><span><strong>' + drafts +
                '</strong> unconfirmed tournament results</span></div>';
        },
        csv: function () {
            return [
                { value: resultStageLabel, label: "Stage" },
                { value: function (r) { return fixtureLabel(r.fixtureId); }, label: "Fixture" },
                { key: "homeScore", label: "Home score" },
                { key: "awayScore", label: "Away score" },
                { value: function (r) {
                    return formatGoalScorers(r.homeScorers) + "; " +
                        formatGoalScorers(r.awayScorers);
                }, label: "Goalscorers" },
                { value: function (r) {
                    return tournamentName((byId(DEMO.fixtures, r.fixtureId) || {}).tournamentId);
                }, label: "Tournament" },
                { key: "state", label: "Status" },
                { key: "enteredOn", label: "Entered on" }
            ];
        }
    });

    /* -------------------------
       Payments
       ------------------------- */

    defineListModule({
        view: "payments",
        description: "Review each payment's team, reference, amount, tournament, method, date, " +
            "status, and remaining registration-fee balance.",
        addLabel: "Record payment",
        caption: "Payment register",
        demoNote: "Record a payment only after verifying the money was received. The entry is immediately " +
            "counted as confirmed or partial, so no second confirmation is needed. Pending and rejected " +
            "payments do not reduce the registration-fee balance.",
        records: function () { return DEMO.payments; },
        search: ["id", "reference", "amount", "method", "status",
            function (record) { return teamName(record.teamId); },
            function (record) { return tournamentName(record.tournamentId); }],
        filters: [
            { name: "teamId", label: "Team", allLabel: "All teams", options: teamOptions }
        ],
        sorters: {
            reference: function (record) { return record.reference; },
            team: function (record) { return teamName(record.teamId); },
            amount: function (record) { return toNumber(record.amount); },
            paidOn: function (record) { return toDate(record.paidOn) || 0; },
            status: function (record) { return record.status; },
            feeBalance: function (record) {
                return feeAccountFor(record.teamId, record.tournamentId).balance;
            }
        },
        columns: [
            { key: "reference", label: "Reference" },
            { key: "team", label: "Team or payer" },
            { key: "tournamentId", label: "Tournament" },
            { key: "amount", label: "Amount", numeric: true },
            { key: "feeBalance", label: "Fee balance", numeric: true },
            { key: "method", label: "Method" },
            { key: "paidOn", label: "Date" },
            { key: "status", label: "Status" }
        ],
        cells: function (record) {
            var account = feeAccountFor(record.teamId, record.tournamentId);
            var feeApplies = account.status !== "not-required";
            var feeContext = account.status === "not-required"
                ? "Registration rejected"
                : formatMoney(account.fee) + " fee for this tournament";

            return [
                '<span class="mono">' + esc(record.reference) + "</span>",
                '<div class="cell-entity">' + crest(teamName(record.teamId)) +
                    "<strong>" + esc(teamName(record.teamId)) + "</strong></div>",
                esc(tournamentName(record.tournamentId)),
                '<span class="money">' + esc(formatMoney(record.amount)) + "</span>",
                '<div class="cell-stack">' + (feeApplies
                    ? '<span class="money">' + esc(formatMoney(account.balance)) + "</span>"
                    : '<span class="muted">Not applicable</span>') +
                    feeStatusBadge(account) + "<span>" + esc(feeContext) + "</span></div>",
                esc(record.method),
                esc(formatDate(record.paidOn)),
                statusBadge(record.status)
            ];
        },
        actions: function (record) {
            return viewAction("payments", record.id, "payment") +
                (normalise(record.status) === "pending"
                    ? actionButton("confirm-payment", record.id, "payments",
                        "Confirm payment", "checkCircle") +
                        rejectAction("payments", record.id)
                    : "");
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "reference", label: "Payment reference" },
                { value: function (r) { return teamName(r.teamId); }, label: "Team or payer" },
                { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
                { key: "amount", label: "Amount" },
                { key: "currency", label: "Currency" },
                { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).fee; },
                    label: "Registration fee" },
                { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).balance; },
                    label: "Fee balance after review" },
                { value: function (r) {
                    return FEE_STATUS_LABEL[feeAccountFor(r.teamId, r.tournamentId).status];
                }, label: "Fee status" },
                { key: "method", label: "Method" },
                { key: "paidOn", label: "Payment date" },
                { key: "status", label: "Status" }
            ];
        }
    });

    /* -------------------------
       Payment records
       ------------------------- */

    defineListModule({
        view: "payment-records",
        description: "Historic record of every payment entry with its related registration, receipt " +
            "reference and review outcome.",
        caption: "Payment history from the backend",
        records: function () { return DEMO.paymentRecords; },
        search: ["id", "reference", "registrationId", "receipt"],
        filters: [
            { name: "status", label: "Status",
                options: optionList(["Confirmed", "Partial", "Pending review"]) }
        ],
        sorters: {
            reference: function (record) { return record.reference; },
            registrationId: function (record) { return record.registrationId; },
            amount: function (record) { return toNumber(record.amount); },
            date: function (record) { return toDate(record.date) || 0; },
            status: function (record) { return record.status; }
        },
        columns: [
            { key: "reference", label: "Reference" },
            { key: "registrationId", label: "Related registration" },
            { key: "amount", label: "Amount", numeric: true },
            { key: "status", label: "Status" },
            { key: "date", label: "Date" },
            { key: "receipt", label: "Receipt" }
        ],
        cells: function (record) {
            return [
                '<span class="mono">' + esc(record.reference) + "</span>",
                '<span class="mono">' + esc(record.registrationId) + "</span>",
                '<span class="money">' + esc(formatMoney(record.amount)) + "</span>",
                statusBadge(record.status),
                esc(formatDate(record.date)),
                record.receipt
                    ? '<span class="mono">' + esc(record.receipt) + "</span>"
                    : '<span class="muted">Not issued</span>'
            ];
        },
        actions: function (record) {
            return actionButton("receipt", record.id, "payment-records", "Receipt preview", "receipt") +
                (record.status === "confirmed" || record.status === "partial"
                    ? '<button type="button" class="btn btn-outline btn-sm" data-action="download-receipt" ' +
                        'data-id="' + esc(record.id) + '" title="Download PDF receipt">' +
                        icon("download") + "Download receipt</button>"
                    : "");
        },
        csv: function () {
            return [
                { key: "id", label: "Record" },
                { key: "reference", label: "Payment reference" },
                { key: "registrationId", label: "Related registration" },
                { key: "amount", label: "Amount" },
                { key: "status", label: "Status" },
                { key: "date", label: "Date" },
                { key: "receipt", label: "Receipt reference" }
            ];
        }
    });

    /* -------------------------
       Announcements
       ------------------------- */

    defineListModule({
        view: "announcements",
        description: "Announcement management is not connected to the live backend yet.",
        hideCreate: true,
        caption: "Live announcements",
        records: function () { return DEMO.announcements; },
        search: ["title", "message", "audience"],
        filters: [
            { name: "status", label: "Status", options: statusOptionsFrom("announcements") },
            { name: "audience", label: "Audience", options: optionList(["All teams",
                "Youth categories", "Match officials", "Team managers", "Finance officers"]) }
        ],
        sorters: {
            title: function (record) { return record.title; },
            audience: function (record) { return record.audience; },
            date: function (record) { return toDate(record.date) || 0; },
            status: function (record) { return record.status; }
        },
        columns: [
            { key: "title", label: "Announcement" },
            { key: "audience", label: "Audience" },
            { key: "date", label: "Publish or schedule date" },
            { key: "status", label: "Status" }
        ],
        cells: function (record) {
            return [
                '<div class="cell-stack"><strong>' + esc(record.title) + "</strong><span>" +
                    esc(record.message) + "</span></div>",
                esc(record.audience),
                esc(formatDate(record.date)),
                statusBadge(record.status)
            ];
        },
        actions: function (record) {
            return actionButton("preview", record.id, "announcements", "Preview announcement", "eye") +
                editAction("announcements", record.id) +
                (normalise(record.status) === "published"
                    ? actionButton("archive", record.id, "announcements", "Archive announcement", "archive")
                    : actionButton("publish", record.id, "announcements", "Publish announcement",
                        "checkCircle")) +
                deleteAction("announcements", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "title", label: "Title" },
                { key: "message", label: "Message" },
                { key: "audience", label: "Audience" },
                { key: "date", label: "Date" },
                { key: "status", label: "Status" }
            ];
        }
    });

    /* -------------------------
       Admin users
       ------------------------- */

    defineListModule({
        view: "users",
        description: "View administrator accounts and their assigned roles.",
        addLabel: "Add admin user",
        caption: "Administrator accounts",
        demoNote: "Create Tournament Admin accounts here. New administrators receive an invitation to set their password from the sign-in page.",
        records: function () { return DEMO.users; },
        search: ["name", "email", "role"],
        filters: [
            { name: "role", label: "Role", options: function () {
                return DEMO.roles.map(function (role) {
                    return { value: role.name, label: role.name };
                });
            } },
            { name: "status", label: "Status", options: statusOptionsFrom("users") }
        ],
        sorters: {
            name: function (record) { return record.name; },
            role: function (record) { return record.role; },
            status: function (record) { return record.status; },
            lastActive: function (record) { return toDate(record.lastActive) || 0; }
        },
        columns: [
            { key: "name", label: "Administrator" },
            { key: "role", label: "Role" },
            { key: "status", label: "Account status" },
            { key: "lastActive", label: "Last active" },
            { key: "created", label: "Created" }
        ],
        cells: function (record) {
            return [
                '<div class="cell-entity">' + crest(record.name, true) +
                    '<div class="cell-stack"><strong>' + esc(record.name) + "</strong><span>" +
                    esc(record.email) + "</span></div></div>",
                badge(record.role, "purple"),
                statusBadge(record.status),
                esc(formatDateTime(record.lastActive)),
                esc(formatDate(record.created))
            ];
        },
        actions: function (record) {
            return (record.role === "tournament_admin"
                    ? '<button type="button" class="btn btn-outline btn-sm" ' +
                        'data-action="manage-admin-permissions" data-id="' + esc(record.id) +
                        '">Manage Permissions</button>'
                    : "") +
                editAction("users", record.id) +
                (normalise(record.status) === "active"
                    ? actionButton("deactivate-user", record.id, "users", "Deactivate account", "lock")
                    : actionButton("activate-user", record.id, "users", "Activate account", "check")) +
                deleteAction("users", record.id);
        },
        csv: function () {
            return [
                { key: "id", label: "Reference" },
                { key: "name", label: "Administrator" },
                { key: "email", label: "Email" },
                { key: "role", label: "Role" },
                { key: "status", label: "Account status" },
                { key: "lastActive", label: "Last active" },
                { key: "created", label: "Created" }
            ];
        }
    });

    /* -------------------------
       Audit logs
       ------------------------- */

    defineListModule({
        view: "audit-logs",
        description: "Review administrative actions recorded by the backend.",
        caption: "Audit trail (backend records)",
        records: function () { return DEMO.auditLogs; },
        search: ["action", "subject", "actorEmail", "module"],
        filters: [
            { name: "module", label: "Module", options: function () {
                return optionList(["Team Registrations", "Tournaments", "Payments", "Fixtures",
                    "Results", "Announcements", "Roles & Permissions", "Financial Reports",
                    "Admin Users", "System Settings"]);
            } },
            { name: "type", label: "Action type", options: optionList(["Approval", "Publish",
                "Create", "Update", "Review", "Warning", "Delete", "Export"]) }
        ],
        sorters: {
            timestamp: function (record) { return toDate(record.timestamp) || 0; },
            action: function (record) { return record.action; },
            actorEmail: function (record) { return record.actorEmail; },
            module: function (record) { return record.module; },
            type: function (record) { return record.type; }
        },
        columns: [
            { key: "action", label: "Action" },
            { key: "actorEmail", label: "User email" },
            { key: "module", label: "Module" },
            { key: "timestamp", label: "Date and time" },
            { key: "type", label: "Action type" }
        ],
        cells: function (record) {
            return [
                '<div class="cell-stack"><strong>' + esc(record.action) + "</strong><span>" +
                    esc(record.subject) + "</span></div>",
                esc(record.actorEmail || "Email unavailable"),
                esc(record.module),
                esc(formatDateTime(record.timestamp)),
                badge(record.type, "purple")
            ];
        },
        actions: function (record) {
            return actionButton("details", record.id, "audit-logs", "View log entry", "eye");
        },
        csv: function () {
            return [
                { key: "id", label: "Entry" },
                { key: "action", label: "Action" },
                { key: "subject", label: "Subject" },
                { key: "actorEmail", label: "User email", value: function (record) {
                    return record.actorEmail || "Email unavailable";
                } },
                { key: "module", label: "Module" },
                { key: "timestamp", label: "Date and time", value: function (record) {
                    return formatDateTime(record.timestamp);
                } },
                { key: "type", label: "Action type" }
            ];
        }
    });

    /* -------------------------------------------------------
       Custom (non-tabular) views
       ------------------------------------------------------- */

    function quickActionsMarkup() {
        var actions = [
            { action: "create", module: "tournaments", label: "Create Tournament",
                detail: "Open the tournament form", icon: "trophy", tone: "gold" },
            { action: "create", module: "teams", label: "Register Team",
                detail: "Add a team to a competition", icon: "shield", tone: "purple" },
            { action: "create", module: "players", label: "Add Player",
                detail: "Register a player to a squad", icon: "player", tone: "purple" },
            { action: "create", module: "fixtures", label: "Create Fixture",
                detail: "Schedule a match", icon: "calendar", tone: "blue" },
            { action: "create", module: "results", label: "Enter Match Result",
                detail: "Record and publish a score", icon: "flag", tone: "green" },
            { action: "goto", module: "payments", label: "Review Payments",
                detail: "Confirm or reject payment entries", icon: "wallet", tone: "amber" },
            { action: "create", module: "announcements", label: "Publish Announcement",
                detail: "Notify teams and officials", icon: "megaphone", tone: "purple" }
        ];

        return '<div class="quick-actions">' + actions.map(function (item) {
            return '<button type="button" class="quick-action" data-action="' + esc(item.action) +
                '" data-module="' + esc(item.module) + '">' +
                '<span class="kpi-icon" data-tone="' + esc(item.tone) + '">' + icon(item.icon) + "</span>" +
                '<span class="quick-action-text"><strong>' + esc(item.label) + "</strong><span>" +
                esc(item.detail) + "</span></span>" +
                '<span class="icon-arrow">' + icon("arrowRight") + "</span></button>";
        }).join("") + "</div>";
    }

    function dashboardKpis() {
        var m = metrics();
        var ledger = feeLedgerFor(registeredTeams());

        return '<div class="kpi-grid">' +
            kpiCard({ label: "Active tournaments", value: m.activeTournaments,
                icon: "trophy", tone: "purple" }) +
            kpiCard({ label: "Registered teams", value: m.teams, icon: "shield", tone: "blue",
                meta: "Across all categories" }) +
            kpiCard({ label: "Pending team registrations", value: m.pendingTeamRegistrations,
                icon: "clipboard", tone: "amber", meta: "Awaiting an administrator decision" }) +
            kpiCard({ label: "Pending payment reviews", value: m.pendingPayments, icon: "wallet",
                tone: "red", meta: "Payment entries returned by the backend" }) +
            kpiCard({ label: "Registration fees outstanding", value: formatMoney(ledger.outstanding),
                icon: "coins", tone: "red",
                meta: ledger.cleared + " of " + ledger.teams + " teams cleared in full" }) +
            "</div>";
    }

    function tournamentOverview() {
        var items = DEMO.tournaments.slice(0, 4).map(function (tournament) {
            var teams = teamCountFor(tournament.id);
            return '<article class="tournament-mini">' +
                badge(tournament.status, tournament.status === "active" ? "green" : "purple") +
                "<h4>" + esc(tournament.name) + " " + esc(tournament.season) + "</h4>" +
                '<div class="tournament-mini-meta">' +
                "<span>" + icon("layers") + " " + esc(categoryName(tournament.categoryId)) + "</span>" +
                "<span>" + icon("calendar") + " " +
                    esc(formatDateRange(tournament.startDate, tournament.endDate)) + "</span>" +
                "<span>" + icon("pin") + " " + esc(tournament.venue) + "</span>" +
                "</div>" +
                meter(pluralise(teams, "team") + " registered", teams,
                    toNumber(tournament.teamCap) || teams) +
                "</article>";
        }).join("");

        return card("Tournament overview", '<div class="split-2">' + items + "</div>", {
            subtitle: "The four most recent competition records",
            action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                'data-module="tournaments">Open tournaments</button>'
        });
    }

    function paymentSummaryCard() {
        var confirmed = countWhere(DEMO.payments, "status", "confirmed");
        var pending = countWhere(DEMO.payments, "status", "pending");
        var partial = countWhere(DEMO.payments, "status", "partial");
        var rejected = countWhere(DEMO.payments, "status", "rejected");

        var donut = donutChart([
            { label: "Confirmed", value: confirmed, colour: "#16865B" },
            { label: "Pending review", value: pending, colour: "#D7B56D" },
            { label: "Part payment", value: partial, colour: "#315BCB" },
            { label: "Rejected", value: rejected, colour: "#C43D43" }
        ], DEMO.payments.length, "payments");

        var ledger = feeLedgerFor(registeredTeams());

        var rows = [
            rowItem("Registration fees due", "Set per tournament and owed by every registered team",
                '<span class="money">' + esc(formatMoney(ledger.expected)) + "</span>"),
            rowItem("Cleared by recorded payments", "Confirmed and part payments combined",
                '<span class="money is-positive">' + esc(formatMoney(ledger.received)) + "</span>"),
            rowItem("Teams cleared in full", "A balance closes only when the fee is fully covered",
                esc(ledger.cleared + " of " + ledger.teams + " teams")),
            rowItem("Outstanding balances", "Calculated from backend payment records",
                '<span class="money is-negative">' + esc(formatMoney(ledger.outstanding)) + "</span>")
        ];

        return card("Payment review summary", donut + '<div class="rows" style="margin-top:14px">' +
            rows.join("") + "</div>", {
                subtitle: "Recorded payment entries from the backend",
                action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                    'data-module="payments">Review payments</button>'
            });
    }

    function recentTeamRegistrations() {
        return card("Recent team registrations", '<div class="rows">' +
            DEMO.teamRegistrations.slice(0, 4).map(function (reg) {
                return rowItem(teamName(reg.teamId), reg.id + " \u00b7 " + formatDate(reg.submitted),
                    statusBadge(reg.status));
            }).join("") + "</div>", {
                subtitle: "Latest submissions from the backend",
                action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                    'data-module="team-registrations">Open register</button>'
            });
    }

    function recentPlayerRegistrations() {
        return card("Recent player registrations", '<div class="rows">' +
            DEMO.playerRegistrations.slice(0, 4).map(function (reg) {
                return rowItem(playerName(reg.playerId), teamName(reg.teamId) + " \u00b7 " +
                    formatDate(reg.submitted), eligibilityBadge(reg.eligibility));
            }).join("") + "</div>", {
                subtitle: "Roster records and eligibility notes; players are not approved individually",
                action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                    'data-module="player-registrations">Open register</button>'
            });
    }

    function upcomingFixturesCard() {
        var upcoming = DEMO.fixtures.filter(function (fixture) {
            return fixture.status === "scheduled" || fixture.status === "draft";
        }).slice(0, 4);

        var body = upcoming.length ? upcoming.map(function (fixture) {
            return matchRow({
                home: teamName(fixture.homeId),
                away: teamName(fixture.awayId),
                date: formatDate(fixture.kickoff),
                time: formatTime(fixture.kickoff),
                venue: fixture.venue,
                badge: statusBadge(fixture.status) + " " + badge(fixture.round, "purple")
            });
        }).join("") : '<p class="muted small">No upcoming fixtures have been added.</p>';

        return card("Upcoming fixtures", body, {
            subtitle: "Scheduled and draft fixtures",
            action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                'data-module="fixtures">Open fixtures</button>'
        });
    }

    function recentResultsCard() {
        var body = DEMO.results.slice(0, 4).map(function (result) {
            return matchRow({
                home: teamName(result.homeId),
                away: teamName(result.awayId),
                homeScore: result.homeScore === null ? "-" : result.homeScore,
                awayScore: result.awayScore === null ? "-" : result.awayScore,
                date: formatDate(result.enteredOn),
                time: result.state,
                venue: fixtureLabel(result.fixtureId),
                badge: statusBadge(result.state === "published" ? "published" : "draft", result.state)
            });
        }).join("");

        return card("Recent match results", body, {
            subtitle: "Draft results stay hidden from the public site",
            action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                'data-module="results">Open results</button>'
        });
    }

    function pendingTasksCard() {
        var tasks = DEMO.tasks.filter(function (task) { return !task.done; });
        var body = tasks.length ? '<div class="task-list">' + tasks.map(function (task) {
            return '<div class="task-item' + (task.done ? " is-done" : "") + '">' +
                icon(task.done ? "checkCircle" : "alert") +
                '<div class="task-item-text"><strong>' + esc(task.label) + "</strong><span>" +
                esc(task.detail) + "</span></div>" +
                (VIEW_META[task.view]
                    ? '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                        'data-module="' + esc(task.view) + '">Open</button>'
                    : "") + "</div>";
        }).join("") + "</div>" : emptyState("No urgent actions",
            "There are no outstanding administrative tasks reported by the backend.");

        return card("Actions to review", body, {
            subtitle: pluralise(tasks.length, "important action") + " outstanding"
        });
    }

    function activityFeedCard() {
        var body = DEMO.activity.length ? '<div class="feed">' + DEMO.activity.map(function (item) {
            return '<div class="feed-item"><span class="feed-dot" data-tone="' + esc(item.tone) + '">' +
                icon(item.icon) + '</span><div class="feed-text"><strong>' + esc(item.text) +
                "</strong><span>" + esc(item.detail) + "</span></div>" +
                '<span class="feed-time">' + esc(relativeTime(item.time)) + "</span></div>";
        }).join("") + "</div>" : emptyState("No recent activity",
            "Backend audit events will appear here when available.");

        return card("Recent system activity", body, {
            subtitle: "Recent backend audit events"
        });
    }

    function registrationTrendsCard() {
        var tabs = '<div class="tab-row" role="tablist" aria-label="Registration trend series">' +
            '<button type="button" class="tab" role="tab" aria-selected="true" data-trend="teams">' +
            "Team registrations</button>" +
            '<button type="button" class="tab" role="tab" aria-selected="false" data-trend="players">' +
            "Player registrations</button></div>";

        return card("Registration trends", tabs +
            '<div data-trend-panel="teams">' +
            trendChart(DEMO.series.registrations, "teams", "team registrations") + "</div>" +
            '<div data-trend-panel="players" hidden>' +
            trendChart(DEMO.series.registrations, "players", "player registrations") + "</div>", {
                subtitle: "Monthly totals from live registration records",
                action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                    'data-module="reports">Open reports</button>'
            });
    }

    function matchActivityCard() {
        var items = DEMO.series.matchActivity.map(function (point) {
            return { label: point.label, value: point.played, tone: "green" };
        });

        return card("Match activity", barChart(items, {
            label: "Completed matches per matchday"
        }), {
            subtitle: "Matches completed per matchday",
            action: '<button type="button" class="btn btn-outline btn-sm" data-action="goto" ' +
                'data-module="matches">Open matches</button>'
        });
    }

    function renderDashboard() {
        return '<div class="page-head">' +
            "<div><h2>Welcome back, " + esc(String(state.prefs.adminName).split(" ")[0]) + "</h2>" +
            "<p>Live competition records and administration activity.</p></div>" +
            '<div class="page-head-actions">' +
            '<button type="button" class="btn btn-primary" data-action="create" ' +
            'data-module="tournaments">' + icon("plus") + "Create tournament</button>" +
            "</div></div>" +
            dashboardKpis() +
            '<div style="margin-top:16px">' + pendingTasksCard() + "</div>";
    }

    function standingsRows() {
        var rows = computeStandings(state.standingsTournament, state.standingsCategory);
        if (!rows.length) {
            return emptyState("No published results yet",
                "Standings are calculated from published results only. Publish a result in this " +
                "when published results are available.");
        }

        var body = rows.map(function (row) {
            return '<tr' + (row.position <= 2 ? ' class="is-qualified"' : "") + ">" +
                '<td><div class="pos-cell"><span class="pos-pill">' + row.position + "</span>" +
                crest(teamName(row.teamId)) + "<strong>" + esc(teamName(row.teamId)) +
                (row.group ? '<small class="tm-standings-group">' + esc(row.group) + "</small>" : "") +
                "</strong></div></td>" +
                '<td class="is-numeric">' + row.played + "</td>" +
                '<td class="is-numeric">' + row.won + "</td>" +
                '<td class="is-numeric">' + row.drawn + "</td>" +
                '<td class="is-numeric">' + row.lost + "</td>" +
                '<td class="is-numeric">' + row.goalsFor + "</td>" +
                '<td class="is-numeric">' + row.goalsAgainst + "</td>" +
                '<td class="is-numeric">' + (row.goalDifference > 0 ? "+" : "") + row.goalDifference + "</td>" +
                '<td class="is-numeric"><strong>' + row.points + "</strong></td>" +
                "</tr>";
        }).join("");

        return tableWrap("Standings calculated from published results",
            '<th scope="col">Team</th><th class="is-numeric" scope="col">P</th>' +
            '<th class="is-numeric" scope="col">W</th><th class="is-numeric" scope="col">D</th>' +
            '<th class="is-numeric" scope="col">L</th><th class="is-numeric" scope="col">GF</th>' +
            '<th class="is-numeric" scope="col">GA</th><th class="is-numeric" scope="col">GD</th>' +
            '<th class="is-numeric" scope="col">Pts</th>', body, "standings-table");
    }

    function standingSelect(values, selected, attribute, label) {
        return '<label class="toolbar-field"><span class="visually-hidden">' + esc(label) + "</span>" +
            '<select class="form-select" data-standing-select="' + esc(attribute) + '">' +
            values.map(function (option) {
                return '<option value="' + esc(option.value) + '"' +
                    (String(option.value) === String(selected) ? " selected" : "") + ">" +
                    esc(option.label) + "</option>";
            }).join("") + "</select></label>";
    }

    function renderStandings() {
        return '<div class="page-head"><div>' +
            "<p>League tables are calculated from published backend results.</p></div>" +
            '<div class="page-head-actions">' +
            (hasAdminPermission("reports.export")
                ? '<button type="button" class="btn btn-outline" data-action="export-standings">' +
                    icon("download") + "Export table</button>"
                : "") + "</div></div>" +
            demoBanner("This table is calculated from published backend results.") +
            '<div class="toolbar"><div class="toolbar-row">' +
            standingSelect(tournamentOptions(), state.standingsTournament, "tournament", "Tournament") +
            standingSelect(categoryOptions(), state.standingsCategory, "category", "Category") +
            '<button type="button" class="btn btn-outline" data-action="refresh-standings">' +
            icon("refresh") + "Recalculate</button></div></div>" +
            card("League table", standingsRows(), {
                subtitle: categoryName(state.standingsCategory) + " \u00b7 " +
                    tournamentName(state.standingsTournament)
            }) +
            '<div class="split-2" style="margin-top:16px">' +
            card("How this table is built", '<div class="rows">' +
                rowItem("Points", "Three for a win, one for a draw, none for a defeat") +
                rowItem("Tie-breakers", "Points, then goal difference, then goals scored") +
                rowItem("Source", "Published results only \u2014 draft results are excluded") +
                "</div>") +
            card("Qualification markers", '<div class="rows">' +
                rowItem("Green marker", "Rows currently inside the qualification places (top two)") +
                rowItem("Qualification places", "Configured for the selected competition") +
                "</div>") + "</div>";
    }

    /* -------------------------
       Competition rules
       ------------------------- */

    function rulesFor(categoryId) {
        return DEMO.rules.filter(function (rule) {
            return rule.categoryId === categoryId;
        }).sort(function (a, b) {
            return (toDate(b.updated) || 0) - (toDate(a.updated) || 0);
        });
    }

    function publishedRulesFor(categoryId) {
        return rulesFor(categoryId).filter(function (rule) {
            return rule.state === "published";
        });
    }

    function renderRules() {
        var rules = rulesFor(state.rulesCategory);
        var current = rules.length ? rules[0] : null;
        var publishedRule = publishedRulesFor(state.rulesCategory)[0] || null;

        var editor = current
            ? '<form class="form" id="rulesForm" novalidate>' +
                '<div class="form-field is-full"><label for="rulesTitle">Document title</label>' +
                '<input class="form-input" id="rulesTitle" name="title" value="' +
                esc(current.title) + '"></div>' +
                '<div class="form-field is-full"><label for="rulesBody">Rules and regulations</label>' +
                '<div class="format-toolbar" role="toolbar" aria-label="Text formatting">' +
                '<button type="button" class="format-btn" data-action="rules-format" data-id="bold" title="Bold" aria-label="Bold"><b>B</b></button>' +
                '<button type="button" class="format-btn" data-action="rules-format" data-id="italic" title="Italic" aria-label="Italic"><i>I</i></button>' +
                '<button type="button" class="format-btn" data-action="rules-format" data-id="heading" title="Heading" aria-label="Heading">H</button>' +
                '<button type="button" class="format-btn" data-action="rules-format" data-id="bullet" title="Bullet list" aria-label="Bullet list">&bull; List</button>' +
                '<button type="button" class="format-btn" data-action="rules-format" data-id="number" title="Numbered list" aria-label="Numbered list">1. List</button>' +
                "</div>" +
                '<textarea class="form-textarea" id="rulesBody" name="body" style="min-height:250px">' +
                esc(current.body) + "</textarea>" +
                '<p class="form-hint">Select text and use the buttons above. Leave a blank line between ' +
                "sections. Use Preview to see exactly what the public page shows.</p></div>" +
                '<div class="form-actions">' +
                '<button type="button" class="btn btn-outline" data-action="preview-rules">' +
                icon("eye") + "Preview</button>" +
                '<button type="button" class="btn btn-outline" data-action="save-rules">' +
                icon("check") + "Save draft</button>" +
                '<button type="button" class="btn btn-primary" data-action="publish-rules">' +
                icon("checkCircle") + "Save and publish</button>" +
                "</div></form>"
            : emptyState("No rules document yet",
                "Create a rules document for this category to get started.");

        var categorySelector = '<label class="toolbar-field">' +
            '<span class="visually-hidden">Competition category</span>' +
            '<select class="form-select" data-rules-category>' +
            categoryOptions().map(function (option) {
                return '<option value="' + esc(option.value) + '"' +
                    (option.value === state.rulesCategory ? " selected" : "") + ">" +
                    esc(option.label) + "</option>";
            }).join("") + "</select></label>";

        var statusLine = current
            ? '<div class="cluster" style="margin-bottom:12px">' +
                statusBadge(current.state === "published" ? "published" : "draft", current.state) +
                badge("Last updated " + formatDate(current.updated), "purple") +
                badge("Category: " + categoryName(current.categoryId)) + "</div>"
            : "";
        var acknowledgmentPanel = "";
        if (publishedRule) {
            if (state.rulesAcknowledgments.ruleId !== publishedRule.id) {
                loadRuleAcknowledgments(publishedRule.id);
            }
            acknowledgmentPanel = renderRuleAcknowledgments(publishedRule);
        }

        return '<div class="page-head"><div>' +
            "<p>Draft and publish competition rules, then track manager acknowledgments and send reminders.</p></div>" +
            '<div class="page-head-actions">' +
            '<button type="button" class="btn btn-primary" data-action="create" data-module="rules">' +
            icon("plus") + "New rules document</button></div></div>" +
                        '<div class="toolbar"><div class="toolbar-row">' + categorySelector + "</div></div>" +
            statusLine +
            card("Rules editor", editor, {
                subtitle: current ? current.title : "No document selected for this category"
            }) + acknowledgmentPanel;
    }

    function renderRuleAcknowledgments(rule) {
        var report = state.rulesAcknowledgments;
        var canSendReminders = hasAdminPermission("rules.edit");
        var refreshButton = '<button type="button" class="btn btn-outline btn-sm" data-action="refresh-rule-acknowledgments"' +
            (report.loading ? " disabled" : "") + ">Refresh</button>";
        var headerActions = '<div class="page-head-actions">' + refreshButton + "</div>";

        if (report.loading || report.ruleId !== rule.id) {
            return '<section class="section-block"><div class="page-head"><div><h2>Manager acknowledgments</h2>' +
                "<p>Loading manager acknowledgment records...</p></div>" + headerActions + "</div></section>";
        }
        if (report.error) {
            return '<section class="section-block"><div class="page-head"><div><h2>Manager acknowledgments</h2>' +
                '<p class="form-error">' + esc(report.error) + "</p></div>" +
                '<div class="page-head-actions"><button type="button" class="btn btn-outline btn-sm" ' +
                'data-action="refresh-rule-acknowledgments">Try again</button></div></div></section>';
        }

        var rows = report.data && Array.isArray(report.data.acknowledgments)
            ? report.data.acknowledgments : [];
        var acknowledgedCount = rows.filter(function (row) { return Boolean(row.acknowledged_at); }).length;
        var pendingRows = rows.filter(function (row) { return !row.acknowledged_at; });
        var reminderRecipients = Object.create(null);
        pendingRows.forEach(function (row) {
            if (row.manager_status === "active" && row.manager_role === "team_manager") {
                reminderRecipients[row.manager_uid] = true;
            }
        });
        var reminderEligibleCount = Object.keys(reminderRecipients).length;
        var body = rows.length ? rows.map(function (row) {
            return "<tr><td>" + esc(row.manager_name || "Manager") +
                '<div class="small muted">' + esc(row.manager_email || "Email unavailable") + "</div></td>" +
                "<td>" + esc(row.team_name) + "</td><td>" + esc(row.tournament_name) + "</td><td>" +
                (row.acknowledged_at
                    ? '<span class="badge badge-green">Acknowledged</span><div class="small muted">' +
                        esc(formatDateTime(row.acknowledged_at)) + "</div>"
                    : '<span class="badge badge-gold">Awaiting acknowledgment</span>') +
                "</td><td>" + (row.last_reminded_at
                    ? esc(formatDateTime(row.last_reminded_at)) : "Not reminded") +
                "</td></tr>";
        }).join("") : '<tr><td colspan="5" class="muted">No approved team registrations were found for this category.</td></tr>';

        return '<section class="section-block"><div class="page-head"><div><h2>Manager acknowledgments</h2>' +
            '<p>Published document: <strong>' + esc(rule.title) + "</strong>. " + acknowledgedCount + " of " + rows.length +
            " approved team registrations have acknowledged these rules.</p></div>" +
            '<div class="page-head-actions">' +
            (canSendReminders
                ? '<button type="button" class="btn btn-primary" data-action="send-rule-reminders"' +
                    (reminderEligibleCount === 0 || state.ruleReminderSending ? " disabled" : "") + ">" +
                    (state.ruleReminderSending ? "Sending reminders..." :
                        "Remind outstanding managers (" + reminderEligibleCount + ")") + "</button>"
                : "") + refreshButton + "</div></div>" +
            tableWrap("Manager rules acknowledgment status",
                "<th>Manager</th><th>Team</th><th>Tournament</th><th>Status</th><th>Last reminder</th>", body) +
            "</section>";
    }

    async function loadRuleAcknowledgments(ruleId) {
        var report = { ruleId: ruleId, loading: true, data: null, error: "" };
        state.rulesAcknowledgments = report;
        try {
            report.data = await window.AngutsaPlatform.request(
                "/admin/rules/" + encodeURIComponent(ruleId) + "/acknowledgments");
            report.loading = false;
        } catch (error) {
            report.loading = false;
            report.error = error && error.message
                ? error.message : "Manager acknowledgments could not be loaded.";
        }
        if (state.rulesAcknowledgments === report && state.view === "rules") renderView();
    }

    async function sendRuleAcknowledgmentReminders(ruleId) {
        if (!hasAdminPermission("rules.edit") || state.ruleReminderSending) return;
        state.ruleReminderSending = true;
        renderView();
        try {
            var result = await window.AngutsaPlatform.request(
                "/admin/rules/" + encodeURIComponent(ruleId) + "/reminders",
                { method: "POST" });
            var sent = Number(result.notificationsSent || 0);
            var failedEmails = Number(result.emailStatusCounts && result.emailStatusCounts.failed || 0);
            toast(sent
                ? "Reminder notifications sent to " + sent + (sent === 1 ? " manager." : " managers.") +
                    (failedEmails ? " Email delivery failed for " + failedEmails +
                        (failedEmails === 1 ? " manager." : " managers.") : "")
                : "There are no active managers awaiting acknowledgment.",
            sent ? (failedEmails ? "warning" : "success") : "info");
        } catch (error) {
            toast(error && error.message
                ? error.message : "The reminders could not be sent. Please try again.", "error");
        } finally {
            state.ruleReminderSending = false;
            if (state.view === "rules") renderView();
        }
    }

    /* -------------------------
       Media gallery
       ------------------------- */

    function mediaFiltered() {
        return applyListControls("media", DEMO.media, ["title", "category", "caption", "videoUrl"], {
            title: function (item) { return item.title; },
            category: function (item) { return item.category; },
            mediaType: function (item) { return item.mediaType; },
            addedOn: function (item) { return toDate(item.addedOn) || 0; }
        });
    }

    function mediaCard(item) {
        var thumb = item.file
            ? privateMediaImageMarkup(item.file, item.title, item.status)
            : icon("image");
        var typeLabel = normalise(item.mediaType) === "video" ? "Video" : "Image";

        return '<article class="media-card">' +
            '<div class="media-thumb">' + thumb + "</div>" +
            '<div class="media-body">' +
            "<h4>" + esc(item.title) + "</h4>" +
            (item.caption ? "<p>" + esc(item.caption) + "</p>" : "") +
            '<div class="cluster">' + badge(typeLabel, "purple") + badge(item.category) +
                statusBadge(item.status) + "</div>" +
            '<div class="cluster between">' +
            '<span class="muted small">' + esc(formatDate(item.addedOn)) + "</span>" +
            '<span class="table-actions">' +
            actionButton("preview", item.id, "media", "Preview media item", "eye") +
            editAction("media", item.id) +
            deleteAction("media", item.id) +
            "</span></div></div></article>";
    }

    function mediaGrid() {
        var items = mediaFiltered();
        return items.length
            ? '<div class="gallery-grid">' + items.map(mediaCard).join("") + "</div>"
            : emptyState("No media items match your search",
                "Adjust the search text or filters to see more images and videos.",
                '<button type="button" class="btn btn-outline btn-sm" data-action="clear-filters">' +
                "Reset filters</button>");
    }

    function renderMedia() {
        if (!moduleIsEditable("media")) {
            return '<div class="page-head"><div><p>Media Gallery management is available to platform owners only.</p>' +
                "<p>Your account does not have access to the platform-wide media library.</p></div></div>";
        }
        return '<div class="page-head"><div>' +
            "<p>Manage published photos and videos shown in the public media gallery.</p></div>" +
            '<div class="page-head-actions"><button type="button" class="btn btn-primary" ' +
                'data-action="create" data-module="media">' +
                icon("plus") + "Add media</button></div></div>" +
            toolbarMarkup("media", [
                { name: "mediaType", label: "Type", options: function () {
                    return optionList(["Image", "Video"]);
                } },
                { name: "status", label: "Status", options: optionList(STATUS_OPTIONS.media) },
                { name: "category", label: "Category", options: function () {
                    return optionList(["Match action", "Supporters", "Training", "Branding",
                        "Venue", "Officials", "Community"]);
                } }
            ]) +
            '<div id="viewResults" data-module="media">' + mediaGrid() + "</div>";
    }

    function teamManagerDirectoryRecords() {
        var managers = {};

        (DEMO.users || []).forEach(function (user) {
            if (user.role !== "team_manager" &&
                !(user.requestedAccountType === "team-manager" && !user.role)) {
                return;
            }
            var key = user.id;
            if (!key) return;
            managers[key] = {
                key: key,
                uid: key,
                name: user.name || "Name not provided",
                role: "Team Manager",
                email: String(user.email || "").trim(),
                phone: String(user.phone || "").trim(),
                status: user.status || "pending",
                accountRole: user.role || null,
                teams: []
            };
        });

        managerSubmissionRecords.forEach(function (submission) {
            var details = submission.manager && typeof submission.manager === "object"
                ? submission.manager : {};
            var key = submission.managerUid || details.id ||
                teamManagerIdentityKey(details.email, submission.registrationId || submission.id);
            var user = byId(DEMO.users, key);
            var manager = managers[key];
            if (!manager) {
                manager = managers[key] = {
                    key: key,
                    uid: submission.managerUid || details.id || "",
                    name: details.name || "Name not provided",
                    role: details.role || "Team Manager",
                    email: String(details.email || "").trim(),
                    phone: String(details.phone || "").trim(),
                    status: user ? user.status : "pending",
                    accountRole: user ? user.role : null,
                    teams: []
                };
            }
            if (details.name && manager.name === "Name not provided") manager.name = details.name;
            if (details.role && manager.role === "Team Manager") manager.role = details.role;
            if (details.email && !manager.email) manager.email = String(details.email).trim();
            if (details.phone && !manager.phone) manager.phone = String(details.phone).trim();
            if (submission.name && manager.teams.indexOf(submission.name) === -1) {
                manager.teams.push(submission.name);
            }
        });

        return Object.keys(managers).map(function (key) { return managers[key]; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function teamManagerTableRows(records) {
        return records.map(function (manager) {
            var blocked = manager.status === "disabled" || manager.status === "suspended";
            var accessLabel = blocked ? "Blocked" :
                manager.status === "active" ? "Active" : "Pending";
            var phone = String(manager.phone || "").replace(/[^\d+]/g, "");
            var accessAction = manager.status === "pending"
                ? '<span class="muted">Awaiting approval</span>'
                : state.role === "platform_owner"
                ? '<button type="button" class="btn btn-outline btn-sm" data-action="team-manager-access" ' +
                    'data-manager-key="' + esc(manager.key) + '">' +
                    (blocked ? "Unblock access" : "Block access") + "</button>"
                : '<span class="muted">Platform owner only</span>';
            var permanentDeleteAction = state.role === "platform_owner" && manager.uid
                ? '<button type="button" class="btn btn-danger btn-sm" data-action="delete-team-manager" ' +
                    'data-manager-key="' + esc(manager.key) + '"' +
                    (manager.uid === state.admin.uid ? " disabled" : "") +
                    '>Permanently delete</button>'
                : "";
            return "<tr><td><strong>" + esc(manager.name) + "</strong><span class=\"table-subtext\">" +
                esc(manager.role) + "</span></td><td>" +
                (manager.email
                    ? '<a href="mailto:' + esc(manager.email) + '">' + esc(manager.email) + "</a>"
                    : "Not provided") + "</td><td>" +
                (manager.phone
                    ? '<a href="tel:' + esc(phone) + '">' + esc(manager.phone) + "</a>"
                    : "Not provided") + "</td><td>" + esc(manager.teams.length
                    ? manager.teams.join(", ")
                    : "No team submitted yet") +
                "</td><td>" + statusBadge(accessLabel) + "</td><td>" + accessAction +
                permanentDeleteAction + "</td></tr>";
        }).join("");
    }

    function renderTeamManagers() {
        var records = teamManagerDirectoryRecords();
        var reportButton = '<button type="button" class="btn btn-outline" data-action="export-team-managers-pdf"' +
            (records.length ? "" : " disabled") + '>' + icon("download") + "Print / Save PDF</button>";
        var head = '<div class="page-head"><div><p>Manager contact details are shown from account requests and submitted team registrations. ' +
            "Passwords are never stored or included in exports.</p></div><div class=\"page-head-actions\">" +
            reportButton + "</div></div>" +
            "";

        if (!records.length) {
            return head + emptyState("No Team Manager accounts yet",
                "Team Manager accounts appear here when an account request is created. Registered teams are listed alongside each manager.", "");
        }

        return head + '<div class="table-wrap"><table class="data-table team-managers-table">' +
            "<thead><tr><th>Manager</th><th>Email</th><th>Phone</th><th>Registered team(s)</th>" +
            "<th>Access</th><th>Actions</th></tr></thead><tbody>" +
            teamManagerTableRows(records) + "</tbody></table></div>";
    }

    function teamManagersPdfMarkup(records) {
        var dateLabel = formatDate(eatToday());
        var rows = records.map(function (manager, index) {
            return "<tr><td>" + (index + 1) + "</td><td><strong>" + esc(manager.name) +
                "</strong><span>" + esc(manager.role) + "</span></td><td>" +
                esc(manager.email || "Not provided") + "</td><td>" +
                esc(manager.phone || "Not provided") + "</td><td>" +
                esc(manager.teams.length
                    ? manager.teams.join(", ")
                    : "No team submitted yet") + "</td><td>" +
                (manager.status === "disabled" || manager.status === "suspended"
                    ? "Blocked" : manager.status === "active" ? "Active" : "Pending") + "</td></tr>";
        }).join("");

        return '<section id="teamManagersPdfReport" class="team-managers-pdf-report" hidden>' +
            '<header class="team-managers-pdf-header"><div class="team-managers-pdf-brand">' +
            "ANGUTSA CHAMPIONSHIP <span>ADMINISTRATION</span></div><div class=\"team-managers-pdf-heading\">" +
            "<div><p>TEAM MANAGER DIRECTORY</p><h1>Team managers</h1><span>" +
            records.length + (records.length === 1 ? " manager" : " managers") +
            "</span></div><div><span>Prepared</span><strong>" + esc(dateLabel) +
            "</strong></div></div></header><p class=\"team-managers-pdf-notice\">" +
            "Confidential manager contact information. Passwords are never stored or included in this export.</p>" +
            '<table class="team-managers-pdf-table"><thead><tr><th>#</th><th>Manager</th><th>Email</th>' +
            "<th>Phone</th><th>Registered team(s)</th><th>Access</th></tr></thead><tbody>" +
            rows + "</tbody></table><footer class=\"team-managers-pdf-footer\">" +
            "The Angutsa Football Championship · Private manager contact details</footer></section>";
    }

    function exportTeamManagersPdf() {
        var records = teamManagerDirectoryRecords();
        if (!records.length) {
            toast("There are no Team Manager accounts to include in the PDF.", "info");
            return;
        }

        var report = document.getElementById("teamManagersPdfReport");
        if (report) report.remove();
        var wrapper = document.createElement("div");
        wrapper.innerHTML = teamManagersPdfMarkup(records);
        report = wrapper.firstElementChild;
        if (!report) {
            toast("The team-manager directory could not be prepared for PDF export.", "error");
            return;
        }
        document.body.appendChild(report);
        var originalTitle = document.title;
        document.title = "Team Managers Directory";
        document.body.classList.add("is-printing-team-managers");

        try {
            window.print();
        } catch (error) {
            console.error("Unable to open the team-manager directory print dialog.", error);
            toast("The team-manager directory could not be opened for PDF export.", "error");
        } finally {
            document.body.classList.remove("is-printing-team-managers");
            if (report) report.remove();
            document.title = originalTitle;
        }
    }

    function matchLineupPdfSide(match, lineups, teamId, teamName) {
        var lineup = lineups.filter(function (entry) {
            return entry.teamId === teamId;
        })[0];
        var starters = lineup ? lineup.starters.slice(0, 11) : [];
        var substitutes = lineup ? lineup.substitutes.slice(0, 7) : [];
        var starterRows = "";
        var substituteRows = "";
        for (var i = 0; i < 11; i += 1) {
            var starter = starters[i];
            starterRows += "<tr><td>" + (i + 1) + "</td><td>" +
                (starter && starter.name ? esc(starter.name) : "&nbsp;") + "</td></tr>";
        }
        for (var substituteIndex = 0; substituteIndex < 7; substituteIndex += 1) {
            var substitute = substitutes[substituteIndex];
            substituteRows += "<tr><td>" + (substituteIndex + 1) + "</td><td>" +
                (substitute && substitute.name ? esc(substitute.name) : "&nbsp;") + "</td></tr>";
        }
        return '<section class="match-lineup-pdf-team">' +
            '<header><span>' + esc(teamId === match.home_team_id ? "HOME TEAM" : "AWAY TEAM") +
                "</span><h2>" + esc(teamName || "Team to be confirmed") + "</h2>" +
                '<small>' + (lineup ? "Line-up submitted" : "Line-up not submitted") + "</small></header>" +
            '<h3>Starting 11</h3><table><thead><tr><th>No.</th><th>Player name</th>' +
                "</tr></thead><tbody>" + starterRows + "</tbody></table>" +
            '<h3 class="match-lineup-pdf-sub-title">Substitutes</h3>' +
                '<table class="match-lineup-pdf-subs"><thead><tr><th>No.</th><th>Player name</th>' +
                "</tr></thead><tbody>" + substituteRows + "</tbody></table>" +
            '<div class="match-lineup-pdf-signatures">' +
                '<div><span>Team manager signature</span></div>' +
                '<div><span>Captain signature</span></div>' +
            "</div></section>";
    }

    function matchLineupPdfMarkup(data) {
        var match = data.match;
        var lineups = data.lineups || [];
        var prepared = new Date().toLocaleDateString("en-KE", {
            year: "numeric", month: "long", day: "numeric"
        });
        var title = (match.home_team_name || "Home team") + " vs " +
            (match.away_team_name || "Away team");
        return '<section id="matchLineupPdfReport" class="match-lineup-pdf-report" hidden>' +
            '<header class="match-lineup-pdf-header">' +
                '<div class="match-lineup-pdf-brand">ANGUTSA CHAMPIONSHIP <span>OFFICIAL MATCH SHEET</span></div>' +
                '<div class="match-lineup-pdf-heading"><div><p>TEAM LINE-UPS</p><h1>' +
                    esc(title) + "</h1><span>" + esc(match.tournament_name) + " · " +
                    esc(match.category_name) + "</span></div><div><span>Prepared</span><strong>" +
                    esc(prepared) + "</strong></div></div>" +
            "</header>" +
            '<div class="match-lineup-pdf-meta"><span><b>Kick-off</b> ' +
                esc(formatDateTime(match.kickoff)) + "</span><span><b>Venue</b> " +
                esc(match.venue) + "</span><span><b>Stage</b> " +
                esc([match.stage, match.group_name, match.round].filter(Boolean).join(" · ")) +
                "</span></div>" +
            '<div class="match-lineup-pdf-score"><span>FULL-TIME SCORE</span>' +
                '<strong><small>HOME</small><i></i><b>–</b><small>AWAY</small><i></i></strong></div>' +
            '<div class="match-lineup-pdf-teams">' +
                matchLineupPdfSide(match, lineups, match.home_team_id, match.home_team_name) +
                matchLineupPdfSide(match, lineups, match.away_team_id, match.away_team_name) +
            "</div>" +
            '<footer class="match-lineup-pdf-organiser"><span>Organiser signature</span><i></i>' +
                "<small>Official match record · " + esc(match.id) + "</small></footer>" +
        "</section>";
    }

    async function printMatchLineupSheet(matchId) {
        var originalTitle = document.title;
        try {
            var data = await window.AngutsaPlatform.request(
                "/admin/matches/" + encodeURIComponent(matchId) + "/lineups"
            );
            var wrapper = document.createElement("div");
            wrapper.innerHTML = matchLineupPdfMarkup(data);
            var report = wrapper.firstElementChild;
            if (!report) throw new Error("The match line-up sheet could not be prepared.");
            var previousReport = document.getElementById("matchLineupPdfReport");
            if (previousReport) previousReport.remove();
            document.body.appendChild(report);
            report.hidden = false;
            document.title = (data.match.home_team_name || "Home team") + " vs " +
                (data.match.away_team_name || "Away team") + " Match Line-ups";
            document.body.classList.add("is-printing-match-lineup");
            try {
                window.print();
            } finally {
                document.body.classList.remove("is-printing-match-lineup");
                report.remove();
                document.title = originalTitle;
            }
        } catch (error) {
            console.error("Unable to prepare the match line-up print sheet.", error);
            toast(error && error.message
                ? error.message
                : "The match line-up sheet could not be opened for printing.", "error");
        }
    }

    function actionToggleTeamManagerAccess(key) {
        var manager = teamManagerDirectoryRecords().filter(function (record) {
            return record.key === key;
        })[0];
        if (!manager) {
            toast("That team manager is no longer in the submitted records.", "error");
            return;
        }

        var wasBlocked = manager.status === "disabled" || manager.status === "suspended";
        confirmDialog({
            title: wasBlocked ? "Unblock team-manager access?" : "Block team-manager access?",
            tone: wasBlocked ? "primary" : "warning",
            confirmLabel: wasBlocked ? "Unblock access" : "Block access",
            cancelLabel: "Cancel",
            message: (wasBlocked ? "Restore access for " : "Block ") +
                manager.name + (wasBlocked ? "?" : " from signing in?")
        }).then(function (confirmed) {
            if (!confirmed) return;
            if (!manager.uid) {
                toast("The manager's account could not be identified.", "error");
                return;
            }
            var nextStatus = wasBlocked
                ? (manager.accountRole ? "active" : "pending")
                : "disabled";
            window.AngutsaPlatform.request("/admin/users/" +
                encodeURIComponent(manager.uid) + "/status", {
                    method: "PUT",
                    body: { status: nextStatus }
                }).then(function () {
                    return requestAdminBootstrap(window.AngutsaPlatform);
                }).then(function (latest) {
                    applyAdminBootstrap(latest, state.admin);
                    renderView();
                    toast(wasBlocked ? "Team manager access restored." : "Team manager access blocked.",
                        "success");
                }).catch(function (error) {
                    toast(error && error.message ? error.message : "We couldn't change account access. Please try again.", "error");
                });
        });
    }

    function actionPermanentlyDeleteTeamManager(key) {
        var manager = teamManagerDirectoryRecords().filter(function (record) {
            return record.key === key;
        })[0];
        if (!manager || !manager.uid || !manager.email) {
            toast("The manager's account and email could not be identified.", "error");
            return;
        }
        if (state.admin && manager.uid === state.admin.uid) {
            toast("You cannot permanently delete your own account.", "error");
            return;
        }

        var teamList = manager.teams.length
            ? manager.teams.map(function (team) { return "<li>" + esc(team) + "</li>"; }).join("")
            : "<li>No registered teams are currently linked.</li>";
        openModal({
            title: "Permanently delete team manager?",
            subtitle: "This is irreversible. Firebase Authentication must be deleted separately.",
            size: "is-wide",
            body: '<div class="form-alert" data-tone="error"><p>This permanently deletes the manager account from D1, ' +
                "all linked teams, registrations, players, payments, fixtures/results involving those teams, " +
                "related audit and notification records, and the manager's R2 media. The email is retained only as a " +
                "one-way hash so it cannot be used to register again. Related fixtures/results may also affect other teams.</p></div>" +
                '<div class="workflow-note"><strong>Teams and registrations to be removed</strong><ul>' +
                    teamList + "</ul></div>" +
                '<p class="form-note">Delete the matching user from Firebase Authentication separately. This operation does not delete the Firebase account.</p>' +
                '<div class="form-field" data-delete-manager-field>' +
                    '<label class="form-label" for="deleteManagerConfirmEmail">Type the manager email to confirm: ' +
                        esc(manager.email) + "</label>" +
                    '<input class="form-control" id="deleteManagerConfirmEmail" type="email" autocomplete="off" ' +
                        'aria-describedby="deleteManagerError" required>' +
                    '<p class="form-error" id="deleteManagerError" role="alert" hidden></p>' +
                "</div>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="button" class="btn btn-danger" data-delete-manager-submit disabled>Permanently delete</button>',
            onMount: function (root, close) {
                var field = $("[data-delete-manager-field]", root);
                var input = $("#deleteManagerConfirmEmail", root);
                var error = $("#deleteManagerError", root);
                var submit = $("[data-delete-manager-submit]", root);
                var expectedEmail = manager.email.trim().toLowerCase();
                var requestInProgress = false;
                if (!input || !submit) return;

                on(input, "input", function () {
                    submit.disabled = input.value.trim().toLowerCase() !== expectedEmail || requestInProgress;
                    field.classList.remove("has-error");
                    error.hidden = true;
                    error.textContent = "";
                });
                on(submit, "click", function () {
                    if (input.value.trim().toLowerCase() !== expectedEmail || requestInProgress) {
                        field.classList.add("has-error");
                        error.textContent = "Enter the manager's exact email address to confirm deletion.";
                        error.hidden = false;
                        input.focus();
                        return;
                    }

                    requestInProgress = true;
                    input.disabled = true;
                    submit.disabled = true;
                    submit.classList.add("is-loading");
                    submit.setAttribute("aria-busy", "true");
                    submit.textContent = "Deleting...";
                    var deleted = false;
                    window.AngutsaPlatform.request("/admin/users/" +
                        encodeURIComponent(manager.uid) + "/permanent", {
                            method: "DELETE"
                        }).then(function () {
                            deleted = true;
                            return requestAdminBootstrap(window.AngutsaPlatform);
                        }).then(function (latest) {
                            applyAdminBootstrap(latest, state.admin);
                            close();
                            renderView();
                            renderNavCounts();
                            toast("Manager and related D1/R2 data deleted. Delete the Firebase Authentication account separately; this email is blocked from registering again.",
                                "success");
                        }).catch(function (requestError) {
                            if (deleted) {
                                close();
                                toast("The manager was deleted, but the admin list could not refresh. Reload the page. Delete the Firebase Authentication account separately.",
                                    "warning");
                                return;
                            }
                            requestInProgress = false;
                            input.disabled = false;
                            submit.disabled = input.value.trim().toLowerCase() !== expectedEmail;
                            submit.classList.remove("is-loading");
                            submit.removeAttribute("aria-busy");
                            submit.textContent = "Permanently delete";
                            field.classList.add("has-error");
                            error.textContent = requestError && requestError.message
                                ? requestError.message
                                : "We couldn't permanently delete this manager. Please try again.";
                            error.hidden = false;
                        });
                });
            }
        });
    }

    /* -------------------------
       Financial reports
       ------------------------- */

    function paymentsForTournament(tournamentId) {
        return DEMO.payments.filter(function (payment) {
            return tournamentId === "all" || payment.tournamentId === tournamentId;
        });
    }

    function withinDateRange(value) {
        var date = toDate(value);
        if (!date) return true;
        var from = toDate(state.reportFrom);
        var to = toDate(state.reportTo);
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
    }

    function reportFilterBar(mode) {
        var action = mode === "finance" ? "export-finance" : "export-reports";

        return '<div class="toolbar"><div class="toolbar-row">' +
            '<label class="toolbar-field"><span class="visually-hidden">Tournament</span>' +
            '<select class="form-select" data-report-filter="' + esc(mode) + '">' +
            '<option value="all">All tournaments</option>' +
            DEMO.tournaments.map(function (tournament) {
                var selected = mode === "finance"
                    ? state.financeTournament === tournament.id
                    : state.reportTournament === tournament.id;
                return '<option value="' + esc(tournament.id) + '"' +
                    (selected ? " selected" : "") + ">" +
                    esc(tournament.name + " " + tournament.season) + "</option>";
            }).join("") + "</select></label>" +
            '<label class="toolbar-field"><span class="visually-hidden">From date</span>' +
            '<input class="form-input" type="date" data-report-date="from" value="' +
            esc(state.reportFrom) + '"></label>' +
            '<label class="toolbar-field"><span class="visually-hidden">To date</span>' +
            '<input class="form-input" type="date" data-report-date="to" value="' +
            esc(state.reportTo) + '"></label>' +
            (hasAdminPermission("reports.export")
                ? '<button type="button" class="btn btn-outline" data-action="' + esc(action) + '">' +
                    icon("download") + "Export CSV</button>"
                : "") + "</div>" +
            '<p class="toolbar-meta">Date filters apply to backend payment records.</p>' +
            "</div>";
    }

    function revenueRows() {
        return DEMO.tournaments.map(function (tournament) {
            var teams = teamsForTournament(tournament.id);
            var ledger = feeLedgerFor(teams);

            return {
                tournament: tournament.name + " " + tournament.season,
                fee: tournamentFee(tournament.id),
                registrations: teams.length,
                expected: ledger.expected,
                received: ledger.received,
                outstanding: ledger.outstanding,
                teams: ledger.teams,
                cleared: ledger.cleared
            };
        });
    }

    function renderFinancialReports() {
        var payments = paymentsForTournament(state.financeTournament).filter(function (payment) {
            return withinDateRange(payment.paidOn);
        });

        var recorded = sum(payments, "amount");
        var received = sum(payments.filter(function (payment) {
            return payment.status === "confirmed" || payment.status === "partial";
        }), "amount");

        var byStatus = [
            { label: "Confirmed", value: countWhere(payments, "status", "confirmed"), colour: "#16865B" },
            { label: "Pending review", value: countWhere(payments, "status", "pending"), colour: "#D7B56D" },
            { label: "Part payment", value: countWhere(payments, "status", "partial"), colour: "#315BCB" },
            { label: "Rejected", value: countWhere(payments, "status", "rejected"), colour: "#C43D43" }
        ];

        var body = revenueRows().map(function (row) {
            return "<tr><td><strong>" + esc(row.tournament) + "</strong></td>" +
                '<td class="is-numeric"><span class="money">' + esc(formatMoney(row.fee)) +
                "</span></td>" +
                '<td class="is-numeric">' + row.registrations + "</td>" +
                '<td class="is-numeric">' + row.cleared + " of " + row.teams + "</td>" +
                '<td class="is-numeric"><span class="money">' + esc(formatMoney(row.expected)) +
                "</span></td>" +
                '<td class="is-numeric"><span class="money is-positive">' +
                esc(formatMoney(row.received)) + "</span></td>" +
                '<td class="is-numeric"><span class="money is-negative">' +
                esc(formatMoney(row.outstanding)) + "</span></td></tr>";
        }).join("");

        var ledger = feeLedgerFor(registeredTeams());

        return '<div class="page-head"><div>' +
            "<p>Registration fee balances per tournament, payment status and outstanding amounts. " +
            "Verify funds were received before recording a payment; recording it immediately applies the amount.</p></div></div>" +
            demoBanner("Figures on this page are calculated from backend financial records.") +
            reportFilterBar("finance") +
            '<div class="kpi-grid">' +
            kpiCard({ label: "Payments in view", value: payments.length, icon: "wallet" }) +
            kpiCard({ label: "Value recorded", value: formatMoney(recorded), icon: "coins", tone: "gold" }) +
            kpiCard({ label: "Confirmed or part paid", value: formatMoney(received),
                icon: "checkCircle", tone: "green" }) +
            kpiCard({ label: "Outstanding (all tournaments)", value: formatMoney(outstandingTotal()),
                icon: "alert", tone: "red" }) +
            kpiCard({ label: "Teams cleared in full", value: ledger.cleared + " of " + ledger.teams,
                icon: "shield", tone: "green" }) +
            "</div>" +
            '<div class="split-2" style="margin-top:16px">' +
            card("Payments by status", donutChart(byStatus, payments.length, "payments"), {
                subtitle: "Within the selected filters"
            }) +
            card("Payments by tournament", barChart(DEMO.tournaments.map(function (tournament) {
                return { label: tournament.season, value: sum(paymentsForTournament(tournament.id), "amount"),
                    tone: "gold" };
            }), { label: "Payment value per tournament",
                note: "Bars show the total recorded value per tournament season." }), {
                subtitle: "Recorded value, not verified income"
            }) + "</div>" +
            '<div style="margin-top:16px">' +
            card("Registration fee summary",
                tableWrap("Registration fee balances per tournament",
                    '<th scope="col">Tournament</th>' +
                    '<th class="is-numeric" scope="col">Fee per team</th>' +
                    '<th class="is-numeric" scope="col">Teams</th>' +
                    '<th class="is-numeric" scope="col">Cleared in full</th>' +
                    '<th class="is-numeric" scope="col">Fees due</th>' +
                    '<th class="is-numeric" scope="col">Received</th>' +
                    '<th class="is-numeric" scope="col">Outstanding</th>', body), {
                    subtitle: "Fees due and balances are derived from the registration fee set on " +
                        "each tournament and the payments recorded against every registered team"
                }) + "</div>";
    }

    /* -------------------------
       Reports and analytics
       ------------------------- */

    function renderReports() {
        var tournamentFilter = state.reportTournament;

        var teams = DEMO.teams.filter(function (team) {
            return tournamentFilter === "all" || team.tournamentId === tournamentFilter;
        });
        var players = DEMO.players.filter(function (player) {
            var team = byId(DEMO.teams, player.teamId);
            return tournamentFilter === "all" || (team && team.tournamentId === tournamentFilter);
        });
        var fixtures = DEMO.fixtures.filter(function (fixture) {
            return tournamentFilter === "all" || fixture.tournamentId === tournamentFilter;
        });
        var payments = paymentsForTournament(tournamentFilter);

        var teamsByCategory = groupCount(teams, "categoryId");
        var playersByTeam = groupCount(players, "teamId");

        return '<div class="page-head"><div>' +
            "<p>Registration, fixture and payment summaries are calculated from backend records.</p></div></div>" +
            demoBanner("Report figures are computed from backend records.") +
            reportFilterBar("view") +
            '<div class="kpi-grid">' +
            kpiCard({ label: "Teams", value: teams.length, icon: "shield", tone: "blue" }) +
            kpiCard({ label: "Players", value: players.length, icon: "player", tone: "blue" }) +
            kpiCard({ label: "Fixtures", value: fixtures.length, icon: "calendar" }) +
            kpiCard({ label: "Completed fixtures", value: countWhere(fixtures, "status", "completed"),
                icon: "flag", tone: "green" }) +
            "</div>" +
            '<div class="split-2" style="margin-top:16px">' +
            card("Teams by category", barChart(Object.keys(teamsByCategory).map(function (key) {
                return { label: categoryName(key), value: teamsByCategory[key], tone: "purple" };
            }), { label: "Teams per category" }), {
                subtitle: "Counts from backend team records"
            }) +
            card("Players by team", barChart(Object.keys(playersByTeam).map(function (key) {
                return { label: teamName(key), value: playersByTeam[key], tone: "green" };
            }), { label: "Players per team" }), {
                subtitle: "Counts from backend player records"
            }) + "</div>" +
            '<div class="split-2" style="margin-top:16px">' +
            card("Fixture completion", '<div class="rows">' +
                rowItem("Scheduled", countWhere(fixtures, "status", "scheduled") +
                    " fixtures ready to play") +
                rowItem("Completed", countWhere(fixtures, "status", "completed") + " fixtures finished") +
                rowItem("Postponed", countWhere(fixtures, "status", "postponed") +
                    " fixtures waiting for a new date") +
                rowItem("Cancelled", countWhere(fixtures, "status", "cancelled") + " fixtures removed") +
                "</div>", { subtitle: "Schedule status breakdown" }) +
            card("Match results overview", '<div class="rows">' +
                rowItem("Published results", countWhere(DEMO.results, "state", "published") +
                    " results authorised for the public site") +
                rowItem("Draft results", countWhere(DEMO.results, "state", "draft") +
                    " results waiting for confirmation") +
                rowItem("Goals recorded", sum(DEMO.results.filter(function (result) {
                    return result.state === "published";
                }), function (result) {
                    var homeGoals = result.tieBreakMethod && result.homeExtraTimeScore !== null &&
                        result.homeExtraTimeScore !== undefined
                        ? result.homeExtraTimeScore : result.homeScore;
                    var awayGoals = result.tieBreakMethod && result.awayExtraTimeScore !== null &&
                        result.awayExtraTimeScore !== undefined
                        ? result.awayExtraTimeScore : result.awayScore;
                    return toNumber(homeGoals) + toNumber(awayGoals);
                }) + " goals across published results") +
                "</div>", { subtitle: "Results returned by the backend" }) + "</div>" +
            '<div class="split-2" style="margin-top:16px">' +
            card("Payment status summary", donutChart([
                { label: "Confirmed", value: countWhere(payments, "status", "confirmed"),
                    colour: "#16865B" },
                { label: "Pending", value: countWhere(payments, "status", "pending"), colour: "#D7B56D" },
                { label: "Part paid", value: countWhere(payments, "status", "partial"), colour: "#315BCB" },
                { label: "Rejected", value: countWhere(payments, "status", "rejected"),
                    colour: "#C43D43" }
            ], payments.length, "payments"), { subtitle: "Backend payment entries" }) +
            card("Registration summary", '<div class="rows">' +
                rowItem("Team registrations", DEMO.teamRegistrations.length + " submissions recorded") +
                rowItem("Awaiting review", metrics().pendingTeamRegistrations + " awaiting a decision") +
                rowItem("Player registrations", DEMO.playerRegistrations.length +
                    " submissions recorded") +
                rowItem("Eligibility queries", DEMO.playerRegistrations.filter(function (reg) {
                    return normalise(reg.eligibility) === "age query";
                }).length + " flagged for an age query") +
                "</div>", { subtitle: "Registration pipeline at a glance" }) + "</div>";
    }

    /* -------------------------
       Roles and permissions
       ------------------------- */

    function permissionEditorCounts() {
        return permissionEditor.permissions.reduce(function (counts, permission) {
            if (permission.state === "allow") counts.allowed += 1;
            else if (permission.state === "deny") counts.denied += 1;
            else counts.unset += 1;
            return counts;
        }, { allowed: 0, denied: 0, unset: 0 });
    }

    function renderPermissionEditor() {
        var user = permissionEditor.user;
        var counts = permissionEditorCounts();
        var groups = [];
        permissionEditor.permissions.forEach(function (permission) {
            var group = groups.filter(function (item) {
                return item.key === permission.menuKey;
            })[0];
            if (!group) {
                group = { key: permission.menuKey, label: permission.menuLabel, permissions: [] };
                groups.push(group);
            }
            group.permissions.push(permission);
        });
        var groupMarkup = groups.map(function (group) {
            var allowed = group.permissions.filter(function (permission) {
                return permission.state === "allow";
            }).length;
            var actions = group.permissions.map(function (permission) {
                return '<div class="permission-action-row" data-permission-action-row ' +
                    'data-search-text="' + esc(normalise(
                        group.label + " " + permission.label + " " + permission.key)) + '">' +
                    '<div class="permission-action-copy"><strong>' + esc(permission.label) +
                    '</strong><span class="table-subtext">' + esc(permission.key) +
                    (!permission.editable ? " · Platform Owner only" : "") + "</span></div>" +
                    '<fieldset class="permission-state-options"><legend class="visually-hidden">' +
                    esc(permission.label + " permission state") + "</legend>" +
                    ["allow", "deny", "unset"].map(function (value) {
                        var label = value === "allow" ? "Allow" : value === "deny" ? "Deny" : "Unset";
                        return '<label><input type="radio" name="permission-' + esc(permission.key) +
                            '" data-permission-key="' + esc(permission.key) + '" value="' + value +
                            '" data-permission-state="' + value + '"' +
                            (!permission.editable || permissionEditor.saving ? " disabled" : "") +
                            (permission.state === value ? " checked" : "") +
                            '><span>' + label + "</span></label>";
                    }).join("") + "</fieldset></div>";
            }).join("");
            var editablePermissions = group.permissions.filter(function (permission) {
                return permission.editable;
            });
            return '<details class="permission-menu-section" data-permission-menu-section open>' +
                '<summary><span><strong>' + esc(group.label) + '</strong><span class="table-subtext">' +
                allowed + " of " + group.permissions.length + " actions allowed</span></span></summary>" +
                (editablePermissions.length ? '<div class="permission-menu-tools"><button type="button" class="btn btn-outline btn-sm" ' +
                'data-action="bulk-permission" data-permission-menu="' + esc(group.key) +
                '" data-permission-state="allow"' + (permissionEditor.saving ? " disabled" : "") +
                '>Allow All</button><button type="button" ' +
                'class="btn btn-outline btn-sm" data-action="bulk-permission" data-permission-menu="' +
                esc(group.key) + '" data-permission-state="deny"' +
                (permissionEditor.saving ? " disabled" : "") +
                '>Deny All</button></div>' : "") +
                '<div class="permission-action-list">' + actions + "</div></details>";
        }).join("");

        return '<div class="permission-editor">' +
            '<div class="page-head"><div><p>Set each action independently. Denials override grants; Unset means denied.</p>' +
            '<p><strong>' + esc(user.name) + "</strong> · " + esc(user.email) +
            ' · ' + esc(adminRoleLabel(user.role)) + ' · ' + esc(user.status) + '</p></div>' +
            '<div class="page-head-actions"><button type="button" class="btn btn-outline" ' +
            'data-action="cancel-permission-edit"' + (permissionEditor.saving ? " disabled" : "") +
            '>Back to administrators</button></div></div>' +
            '<div class="permission-editor-summary"><span>' + counts.allowed + ' allowed</span><span>' +
            counts.denied + ' denied</span><span>' + counts.unset + ' unset (denied)</span></div>' +
            '<label class="permission-search"><span>Search permissions</span><input type="search" ' +
            'class="form-input" data-permission-search value="' + esc(permissionEditor.search) +
            '" placeholder="Search menus or actions"></label>' +
            '<p class="permission-unsaved" role="status" data-permission-unsaved>' +
            (permissionEditorIsDirty() ? "Unsaved permission changes" : "All changes are saved") +
            "</p>" + groupMarkup +
            '<div class="permission-editor-actions"><button type="button" class="btn btn-outline" ' +
            'data-action="cancel-permission-edit"' + (permissionEditor.saving ? " disabled" : "") +
            '>Cancel</button><button type="button" class="btn btn-primary" data-action="save-permissions"' +
            (permissionEditor.saving || !permissionEditorIsDirty() ? " disabled" : "") +
            '>' + (permissionEditor.saving ? "Saving…" : "Save Changes") + "</button></div></div>";
    }

    function updatePermissionState(permissionKey, stateValue) {
        permissionEditor.permissions.forEach(function (permission) {
            if (permission.key === permissionKey) permission.state = stateValue;
        });
    }

    function closePermissionEditor() {
        permissionEditor.user = null;
        permissionEditor.permissions = [];
        permissionEditor.original = Object.create(null);
        permissionEditor.search = "";
        permissionEditor.saving = false;
        renderView();
    }

    function cancelPermissionEditing() {
        if (permissionEditor.saving) return;
        if (!permissionEditorIsDirty()) {
            closePermissionEditor();
            return;
        }
        confirmDialog({
            title: "Discard permission changes?",
            message: "Your unsaved permission changes will be lost.",
            confirmLabel: "Discard changes",
            cancelLabel: "Keep editing"
        }).then(function (confirmed) {
            if (confirmed) closePermissionEditor();
        });
    }

    function applyPermissionSearch(value) {
        permissionEditor.search = value;
        var query = normalise(value);
        $$("[data-permission-action-row]").forEach(function (row) {
            row.hidden = query && row.getAttribute("data-search-text").indexOf(query) === -1;
        });
        $$("[data-permission-menu-section]").forEach(function (section) {
            var visibleActions = $$("[data-permission-action-row]", section).filter(function (row) {
                return !row.hidden;
            });
            section.hidden = visibleActions.length === 0;
            if (query && visibleActions.length) section.open = true;
        });
    }

    function applyBulkPermission(menuKey, stateValue) {
        var count = permissionEditor.permissions.filter(function (permission) {
            return permission.menuKey === menuKey && permission.editable;
        }).length;
        var menu = permissionEditor.permissions.filter(function (permission) {
            return permission.menuKey === menuKey && permission.editable;
        })[0];
        if (!menu || ["allow", "deny"].indexOf(stateValue) === -1) return;
        var actionLabel = stateValue === "allow" ? "allow" : "deny";
        confirmDialog({
            title: (stateValue === "allow" ? "Allow" : "Deny") + " all " + menu.menuLabel + " actions?",
            message: "This will " + actionLabel + " all " + count +
                " actions in " + menu.menuLabel + ". You can adjust individual actions before saving.",
            confirmLabel: stateValue === "allow" ? "Allow all" : "Deny all"
        }).then(function (confirmed) {
            if (!confirmed) return;
            permissionEditor.permissions.forEach(function (permission) {
                if (permission.menuKey === menuKey && permission.editable) permission.state = stateValue;
            });
            renderView();
        });
    }

    function openAdminPermissionEditor(userId) {
        var selected = byId(DEMO.users, userId);
        if (!selected || selected.role !== "tournament_admin") {
            toast("Select a Tournament Admin account to manage permissions.", "error");
            return;
        }
        permissionEditor.user = selected;
        permissionEditor.permissions = [];
        permissionEditor.original = Object.create(null);
        permissionEditor.search = "";
        renderView();
        window.AngutsaPlatform.request("/admin/users/" +
            encodeURIComponent(userId) + "/permissions").then(function (data) {
            permissionEditor.user = data.user;
            permissionEditor.permissions = data.permissions || [];
            permissionEditor.original = Object.create(null);
            permissionEditor.permissions.forEach(function (permission) {
                permissionEditor.original[permission.key] = permission.state;
            });
            renderView();
        }).catch(function (error) {
            permissionEditor.user = null;
            renderView();
            toast(error && error.message
                ? error.message
                : "We couldn't load this administrator's permissions.", "error");
        });
    }

    function saveAdminPermissions() {
        if (!permissionEditor.user || permissionEditor.saving || !permissionEditorIsDirty()) return;
        permissionEditor.saving = true;
        renderView();
        window.AngutsaPlatform.request("/admin/users/" +
            encodeURIComponent(permissionEditor.user.uid) + "/permissions", {
                method: "PUT",
                body: {
                    permissions: permissionEditor.permissions.map(function (permission) {
                        return { key: permission.key, state: permission.state };
                    })
                }
            }).then(function (data) {
            permissionEditor.user = data.user;
            permissionEditor.permissions = data.permissions || [];
            permissionEditor.original = Object.create(null);
            permissionEditor.permissions.forEach(function (permission) {
                permissionEditor.original[permission.key] = permission.state;
            });
            var selected = byId(DEMO.users, data.user.uid);
            if (selected) {
                selected.allowedPermissions = permissionEditor.permissions.filter(function (permission) {
                    return permission.state === "allow";
                }).length;
                selected.deniedPermissions = permissionEditor.permissions.filter(function (permission) {
                    return permission.state === "deny";
                }).length;
            }
            permissionEditor.saving = false;
            renderView();
            toast("Permissions saved. Changes take effect on the next protected request.", "success");
        }).catch(function (error) {
            permissionEditor.saving = false;
            renderView();
            toast(error && error.message
                ? error.message
                : "Permissions could not be saved. Your changes are still here.", "error");
        });
    }

    function renderRoles() {
        if (state.role !== "platform_owner") {
            return emptyState("Platform Owner access required",
                "Only a Platform Owner can manage Tournament Admin permissions.", "");
        }
        if (permissionEditor.user) {
            return permissionEditor.permissions.length
                ? renderPermissionEditor()
                : '<div class="permission-editor-loading" role="status">Loading permissions…</div>';
        }

        var administrators = DEMO.users.filter(function (user) {
            return user.role === "tournament_admin";
        });
        var rows = administrators.map(function (user) {
            var allowed = toNumber(user.allowedPermissions);
            var denied = toNumber(user.deniedPermissions);
            return "<tr><td><strong>" + esc(user.name || "Name unavailable") +
                "</strong><span class=\"table-subtext\">" + esc(user.email) +
                "</span></td><td>" + esc(adminRoleLabel(user.role)) + "</td><td>" +
                statusBadge(user.status) + "</td><td><span class=\"permission-summary-count\">" +
                allowed + " allowed</span><span class=\"table-subtext\">" + denied +
                " denied</span></td><td><button type=\"button\" class=\"btn btn-outline btn-sm\" " +
                'data-action="manage-admin-permissions" data-id="' + esc(user.id) + '">' +
                "Manage Permissions</button></td></tr>";
        }).join("");
        return '<div class="page-head"><div><p>Choose a Tournament Admin to review or update their individual menu actions. ' +
            "Unassigned permissions are denied by default.</p></div></div>" +
            tableWrap("Tournament Admin accounts",
                '<th scope="col">Administrator</th><th scope="col">Assigned role</th>' +
                '<th scope="col">Account status</th><th scope="col">Current permissions</th>' +
                '<th scope="col">Actions</th>',
                rows || '<tr><td colspan="5"><p class="muted">No Tournament Admin accounts are available.</p></td></tr>');
    }

    /* -------------------------
       System settings
       ------------------------- */

    var SETTINGS_SECTIONS = [
        { id: "branding", label: "Branding" },
        { id: "general", label: "General site" },
        { id: "regional", label: "Time zone & formats" },
        { id: "registration", label: "Registration" },
        { id: "notifications", label: "Notifications" },
        { id: "display", label: "Display" },
        { id: "profile", label: "Administrator profile" },
        { id: "data", label: "Data and preferences" }
    ];

    function prefTextField(cfg) {
        var key = cfg.key;
        var value = state.prefs[key];
        var id = "pref-" + key;

        if (cfg.type === "checkbox") {
            return '<label class="check-field is-full" for="' + id + '">' +
                '<input type="checkbox" id="' + id + '" data-pref="' + esc(key) + '"' +
                (value ? " checked" : "") + ">" +
                '<span class="check-field-text"><strong>' + esc(cfg.label) + "</strong>" +
                (cfg.hint ? "<span>" + esc(cfg.hint) + "</span>" : "") + "</span></label>";
        }

        var control;
        if (cfg.type === "select") {
            control = '<select class="form-select" id="' + id + '" data-pref="' + esc(key) + '">' +
                cfg.options.map(function (option) {
                    return '<option value="' + esc(option.value) + '"' +
                        (String(option.value) === String(value) ? " selected" : "") + ">" +
                        esc(option.label) + "</option>";
                }).join("") + "</select>";
        } else {
            control = '<input class="form-input" id="' + id + '" type="' +
                esc(cfg.type || "text") + '" data-pref="' + esc(key) + '" value="' +
                esc(value) + '"' + (cfg.min !== undefined ? ' min="' + esc(cfg.min) + '"' : "") +
                (cfg.max !== undefined ? ' max="' + esc(cfg.max) + '"' : "") + ">";
        }

        return '<div class="form-field' + (cfg.full ? " is-full" : "") + '">' +
            '<label for="' + id + '">' + esc(cfg.label) + "</label>" + control +
            (cfg.hint ? '<p class="form-hint">' + esc(cfg.hint) + "</p>" : "") + "</div>";
    }

    function settingsPanel(id) {
        var groups = {
            branding: [
                { key: "championshipName", label: "Championship name", type: "text", full: true },
                { key: "season", label: "Current season", type: "text" },
                { key: "siteTagline", label: "Public tagline", type: "text", full: true,
                    hint: "Shown in the website footer area." }
            ],
            general: [
                { key: "contactEmail", label: "Public contact email", type: "email" },
                { key: "contactPhone", label: "Public contact phone", type: "text",
                    hint: "Enter the current public contact number." },
                { key: "registrationOpen", label: "Team registration window open",
                    type: "checkbox", full: true,
                    hint: "Controls the public registration call to action." }
            ],
            regional: [
                { key: "timezone", label: "Default time zone", type: "select", options: [
                    { value: "Africa/Nairobi", label: "East Africa Time \u2014 Africa/Nairobi (UTC+3)" },
                    { value: "Africa/Dar_es_Salaam", label: "Africa/Dar_es_Salaam (UTC+3)" },
                    { value: "Africa/Kampala", label: "Africa/Kampala (UTC+3)" },
                    { value: "Africa/Lagos", label: "Africa/Lagos (UTC+1)" },
                    { value: "UTC", label: "UTC" }
                ], hint: "Select the time zone used by the competition." },
                { key: "dateFormat", label: "Date display", type: "select", options: [
                    { value: "DD MMM YYYY", label: "31 Dec 2026" },
                    { value: "DD/MM/YYYY", label: "31/12/2026" },
                    { value: "YYYY-MM-DD", label: "2026-12-31" }
                ] },
                { key: "timeFormat", label: "Time display", type: "select", options: [
                    { value: "12-hour", label: "12-hour (3:00 PM)" },
                    { value: "24-hour", label: "24-hour (15:00)" }
                ] },
                { key: "currency", label: "Default currency", type: "select", options: [
                    { value: "KES", label: "KES \u2014 Kenyan shilling" },
                    { value: "TZS", label: "TZS \u2014 Tanzanian shilling" },
                    { value: "UGX", label: "UGX \u2014 Ugandan shilling" },
                    { value: "USD", label: "USD \u2014 United States dollar" }
                ], hint: "Administrators can change this at any time." }
            ]
        };

        var fields = (groups[id] || []).map(prefTextField).join("");

        return '<div class="settings-panel" data-settings-panel="' + esc(id) + '">' +
            '<div class="form-grid">' + fields + "</div>" +
            '<div class="btn-row" style="margin-top:16px">' +
            '<button type="button" class="btn btn-primary" data-action="save-settings" ' +
            'data-section="' + esc(id) + '">' + icon("check") + "Save settings</button>" +
            '<button type="button" class="btn btn-outline" data-action="reset-prefs">' +
            icon("refresh") + "Reset to defaults</button></div></div>";
    }

    function settingsDataPanel() {
        return '<div class="settings-panel" data-settings-panel="data">' +
            '<div class="rows">' +
            rowItem("Competition records", "Loaded from the live backend when this dashboard opens") +
            rowItem("Clear records", "Use the relevant backend workflow; this dashboard does not reset live data") +
            rowItem("Display preferences", "Stored locally in this browser and do not change competition records") +
            "</div>" +
            '<div class="btn-row" style="margin-top:14px">' +
            '<button type="button" class="btn btn-outline" data-action="reset-prefs">' +
            icon("refresh") + "Reset preferences</button></div></div>";
    }

    function extraSettingsPanel(id) {
        var groups = {
            registration: [
                { key: "autoApproveTeams", label: "Auto-approve team registrations",
                    type: "checkbox", full: true,
                    hint: "Off by default \u2014 review is recommended before the draw." },
                { key: "requireGuardianConsent", label: "Require guardian consent for youth players",
                    type: "checkbox", full: true,
                    hint: "Strongly recommended for every youth competition." }
            ],
            notifications: [
                { key: "notifyEmail", label: "Email notifications (delivery handled by the backend)",
                    type: "checkbox", full: true },
                { key: "notifyRegistrations", label: "Notify me about new registrations",
                    type: "checkbox", full: true },
                { key: "notifyPayments", label: "Notify me about payment reviews",
                    type: "checkbox", full: true },
                { key: "notifyMatches", label: "Notify me about match day changes",
                    type: "checkbox", full: true }
            ],
            display: [
                { key: "perPage", label: "Records per page", type: "number", min: 5, max: 50 },
                { key: "sidebarRail", label: "Start with the sidebar collapsed on desktop",
                    type: "checkbox", full: true }
            ],
            profile: [
                { key: "adminName", label: "Display name", type: "text", full: true },
                { key: "adminRole", label: "Role label", type: "text",
                    hint: "Cosmetic only \u2014 real roles come from the backend." },
                { key: "adminEmail", label: "Notification email", type: "email",
                    hint: "Enter a contact email address." }
            ]
        };

        var fields = (groups[id] || []).map(prefTextField).join("");

        return '<div class="settings-panel" data-settings-panel="' + esc(id) + '">' +
            '<div class="form-grid">' + fields + "</div>" +
            '<div class="btn-row" style="margin-top:16px">' +
            '<button type="button" class="btn btn-primary" data-action="save-settings" ' +
            'data-section="' + esc(id) + '">' + icon("check") + "Save settings</button>" +
            '<button type="button" class="btn btn-outline" data-action="reset-prefs">' +
            icon("refresh") + "Reset to defaults</button></div></div>";
    }

    function settingsPanelFor(id) {
        if (id === "data") return settingsDataPanel();
        if (id === "registration" || id === "notifications" || id === "display" || id === "profile") {
            return extraSettingsPanel(id);
        }
        return settingsPanel(id);
    }

    function renderSettings() {
        var nav = SETTINGS_SECTIONS.map(function (section) {
            return '<button type="button" class="settings-nav-btn" data-settings-section="' +
                esc(section.id) + '" role="tab" aria-current="' +
                (state.settingsSection === section.id ? "true" : "false") + '">' +
                esc(section.label) + "</button>";
        }).join("");

        var panels = SETTINGS_SECTIONS.map(function (section) {
            var visible = section.id === state.settingsSection;
            return "<div" + (visible ? "" : " hidden") + ">" + settingsPanelFor(section.id) + "</div>";
        }).join("");

        return '<div class="page-head"><div>' +
            "<p>Championship identity, regional formats, registration rules and display " +
            "preferences.</p></div></div>" +
            demoBanner("Display preferences are stored locally. Do not enter server credentials here.") +
            '<div class="settings-layout">' +
            '<div class="settings-nav" role="tablist" aria-label="Settings sections">' + nav + "</div>" +
            '<div class="card">' + panels + "</div></div>" +
            (state.role === "platform_owner" ? emailSenderPanel() : "");
    }

    function emailSenderPanel() {
        var sender = state.emailSender || {};
        return '<section class="card" style="margin-top:18px;padding:20px">' +
            "<h2>Email sender identity</h2>" +
            "<p>Configure the verified Brevo sender for registration, payment, published fixture/result, and account-access updates. " +
            "Messages go to affected users with verified email addresses. The API key remains a Cloudflare Secret.</p>" +
            '<div class="form-grid">' +
                '<div class="form-field"><label for="brevoSenderName">Sender name</label>' +
                    '<input class="form-input" id="brevoSenderName" maxlength="100" value="' +
                    esc(sender.brevoSenderName || "") + '"></div>' +
                '<div class="form-field"><label for="brevoSenderEmail">Sender email</label>' +
                    '<input class="form-input" id="brevoSenderEmail" type="email" maxlength="254" value="' +
                    esc(sender.brevoSenderEmail || "") + '"></div>' +
            "</div>" +
            '<div class="btn-row" style="margin-top:14px">' +
                '<button type="button" class="btn btn-primary" data-action="save-email-sender">' +
                    icon("check") + "Save sender identity</button>" +
            "</div></section>";
    }

    /* -------------------------------------------------------
       Detail and preview dialogs
       ------------------------------------------------------- */

    function detailGrid(items) {
        return '<dl class="detail-grid">' + items.join("") + "</dl>";
    }

    function tournamentHasStarted(tournament) {
        if (!tournament) return false;

        var status = normalise(tournament.status);
        if (status === "active" || status === "ongoing" || status === "completed" ||
            status === "archived") {
            return true;
        }

        var startDate = String(tournament.startDate || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return false;

        var todayKey = eatToday();
        return startDate <= todayKey;
    }

    function playerRegistrationPermissionMarkup(record) {
        return '<div class="workflow-note" style="margin-top:14px">' +
            "<strong>Player registration</strong>" +
            "<p>Team approval opens player registration, including when part of the entry fee remains due. The outstanding balance must still be paid.</p>" +
            "</div>";
    }

    function playerRosterChangePermissionMarkup(record) {
        var approved = normalise(record.registrationStatus) === "approved";
        var expiresAt = record.rosterChangesExpiresAt
            ? new Date(record.rosterChangesExpiresAt)
            : null;
        var permitted = record.rosterChangesAfterStart === true &&
            (!expiresAt || expiresAt.getTime() > Date.now());
        var expired = !permitted && expiresAt && Number.isFinite(expiresAt.getTime()) &&
            expiresAt.getTime() <= Date.now();
        var tournament = byId(DEMO.tournaments, record.tournamentId);
        var started = tournamentHasStarted(tournament);
        var statusMessage = started
            ? "The roster lock is active for " + tournamentName(record.tournamentId) + "."
            : "The lock will begin when the tournament is marked ongoing or reaches its start date.";
        var permissionStatus = permitted
            ? expiresAt
                ? "Active until " + expiresAt.toLocaleString("en-KE", {
                    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit"
                }) + " EAT."
                : "Active until revoked."
            : expired
                ? "Expired on " + expiresAt.toLocaleString("en-KE", {
                    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit"
                }) + " EAT."
                : "No active roster-change permission.";
        var grantButton = '<button type="button" class="btn ' +
            (permitted ? "btn-outline" : "btn-primary") +
            '" data-action="set-player-roster-change-permission" data-module="teams" data-id="' +
            esc(record.id) + '" data-enabled="true"' +
            (approved ? "" : " disabled") + ">" +
            (permitted ? "Renew permission" : "Permit roster changes") + "</button>";
        var revokeButton = permitted
            ? ' <button type="button" class="btn btn-outline" data-action="set-player-roster-change-permission" ' +
                'data-module="teams" data-id="' + esc(record.id) + '" data-enabled="false">Revoke permission</button>'
            : "";

        return '<div class="workflow-note" style="margin-top:14px">' +
            "<strong>Roster changes after tournament start</strong>" +
            "<p>By default, managers cannot add, edit or remove players after a tournament starts. " +
            "An administrator can allow those changes for this team for 1 to 720 hours. " +
            esc(permissionStatus + " " + statusMessage) + "</p>" +
            grantButton + revokeButton +
            (approved ? "" : '<p class="small muted">Approve the team before granting this permission.</p>') +
            "</div>";
    }

    function detailSource(moduleKey) {
        var sources = {
            tournaments: { list: DEMO.tournaments, label: function (r) { return r.name; } },
            categories: { list: DEMO.categories, label: function (r) { return r.name; } },
            teams: { list: DEMO.teams, label: function (r) { return r.name; } },
            players: { list: DEMO.players, label: function (r) { return r.name; } },
            fixtures: { list: DEMO.fixtures, label: function (r) { return fixtureLabel(r.id); } },
            matches: { list: DEMO.matches, label: function (r) { return r.id; } },
            results: { list: DEMO.results, label: function (r) { return r.id; } },
            payments: { list: DEMO.payments, label: function (r) { return r.reference; } },
            "payment-records": { list: DEMO.paymentRecords, label: function (r) { return r.reference; } },
            "team-registrations": { list: DEMO.teamRegistrations, label: function (r) { return r.id; } },
            "player-registrations": { list: DEMO.playerRegistrations, label: function (r) { return r.id; } },
            "audit-logs": { list: DEMO.auditLogs, label: function (r) { return r.id; } },
            media: { list: DEMO.media, label: function (r) { return r.title; } },
            announcements: { list: DEMO.announcements, label: function (r) { return r.title; } }
        };
        return sources[moduleKey] || null;
    }

    function detailBody(moduleKey, record) {
        switch (moduleKey) {
        case "tournaments": {
            var tournamentLedger = feeLedgerFor(teamsForTournament(record.id));

            return '<div class="detail-banner">' +
                (record.banner
                    ? '<img src="' + esc(record.banner) + '" alt="">'
                    : icon("image")) +
                "</div>" +
                detailGrid([
                    detailItemText("Reference", record.id),
                    detailItemText("Public reference", record.publicId || "Not published"),
                    detailItemText("Public slug", record.slug || "No public page"),
                    detailItemText("Season", record.season),
                    detailItemText("Category", categoryName(record.categoryId)),
                    detailItemText("Format", record.format),
                    detailItemText("Dates", formatDateRange(record.startDate, record.endDate)),
                    detailItemText("Registration window",
                        formatDate(record.registrationOpens) + " to " +
                        formatDate(record.registrationCloses)),
                    detailItemText("Venue", record.venue),
                    detailItemText("Location", record.location),
                    detailItem("Status", statusBadge(record.status)),
                    detailItem("Registration", registrationStatusBadge(record.registrationStatus)),
                    detailItemText("Team capacity", record.teamCap),
                    detailItemText("Teams registered", tournamentTeamCount(record)),
                    detailItemText("Website placement", (record.featured ? "Featured" : "Standard") +
                        (record.standingsAvailable ? " \u00b7 standings published" : "")),
                    detailItem("Registration fee", '<span class="money">' +
                        esc(formatMoney(tournamentFee(record.id))) + "</span>"),
                    detailItemText("Fees due from registered teams",
                        formatMoney(tournamentLedger.expected)),
                    detailItemText("Cleared by recorded payments", formatMoney(tournamentLedger.received)),
                    detailItemText("Outstanding balances", formatMoney(tournamentLedger.outstanding)),
                    detailItemText("Teams cleared in full", tournamentLedger.cleared + " of " +
                        tournamentLedger.teams),
                    detailItemText("Payments awaiting review", tournamentLedger.awaitingReview),
                    detailItemText("Public overview", record.overview)
                ]) + workflowNote("This record is the source for the public tournament directory: the " +
                    "banner image, dates, registration window, venue, fee and overview all appear on " +
                    "/tournaments/. Balances close only when recorded payments clear the fee.");
        }
        case "categories":
            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Public reference", record.publicId || "Not published"),
                detailItemText("Short code", record.code),
                detailItemText("Age group", record.ageGroup),
                detailItemText("Age range", record.ageMin === null || record.ageMin === undefined
                    ? record.ageGroup
                    : record.ageMax
                        ? record.ageMin + " to " + record.ageMax + " years"
                        : record.ageMin + " years and above"),
                detailItemText("Classification", record.gender),
                detailItem("Guardian consent", record.guardianConsent
                    ? badge("Required", "gold") : badge("Not required")),
                detailItem("Status", statusBadge(record.status)),
                detailItemText("Teams registered", teamsInCategory(record.id)),
                detailItemText("Tournaments using it", tournamentsForCategory(record.id)),
                detailItemText("Description", record.description)
            ]) + workflowNote("This category appears in the public categories and eligibility table " +
                "on /tournaments/. Registration fees are set on each tournament.");
        case "teams": {
            var teamFee = feeAccountFor(record.id, record.tournamentId);

            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Short name", record.shortName),
                detailItemText("Category", categoryName(record.categoryId)),
                detailItemText("Tournament", tournamentName(record.tournamentId)),
                detailItemText("Group", record.group),
                detailItemText("Home location", record.location),
                detailItemText("Manager", record.manager),
                detailItemText("Contact", record.contact),
                detailItemText("Squad size", record.squadSize),
                detailItem("Roster status", statusBadge("registered", "Registered")),
                detailItemText("Registered on", formatDate(record.registeredOn)),
                detailItemText("Players recorded", playersInTeam(record.id)),
                detailItem("Registration fee", '<span class="money">' +
                    esc(formatMoney(teamFee.fee)) + "</span>"),
                detailItemText("Cleared by recorded payments", formatMoney(teamFee.paid)),
                detailItemText("Awaiting review", formatMoney(teamFee.pending)),
                detailItem("Balance to clear",
                    '<span class="money' + (teamFee.balance > 0 ? " is-negative" : " is-positive") +
                    '">' + esc(formatMoney(teamFee.balance)) + "</span> " + feeStatusBadge(teamFee))
            ]) + workflowNote("The balance shown is the registration fee for " +
                tournamentName(record.tournamentId) + " less the payments the finance office has " +
                "recorded. It stays open until it is cleared in full.") +
                playerRegistrationPermissionMarkup(record) +
                playerRosterChangePermissionMarkup(record);
        }
        case "players":
            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Team", teamName(record.teamId)),
                detailItemText("Category", categoryName(record.categoryId)),
                detailItemText("Jersey number", record.jersey),
                detailItemText("Position", record.position),
                detailItemText("Year of birth", record.yearOfBirth),
                detailItem("Registration", statusBadge(record.registrationStatus)),
                detailItem("Eligibility", eligibilityBadge(record.eligibility)),
                detailItemText("Public profile", record.publicProfile === "full" ? "Full name"
                    : record.publicProfile === "limited" ? "Initials only" : "Hidden"),
                detailItemText("Guardian consent", record.guardianConsent ? "Recorded" : "Not recorded"),
                detailItemText("Submitted on", formatDate(record.submittedOn))
            ]) + '<div class="form-alert" data-tone="warning" style="margin-top:14px">' +
                icon("alert") + "<p>Player records are loaded from the backend. Access to information " +
                "about minors is restricted by backend authorization and guardian-consent requirements.</p></div>";
        case "fixtures": {
            var fixtureWarnings = detectFixtureConflicts({
                id: record.id, homeId: record.homeId, awayId: record.awayId,
                kickoff: record.kickoff, venue: record.venue
            });
            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Tournament", tournamentName(record.tournamentId)),
                detailItemText("Category", categoryName(record.categoryId)),
                detailItemText("Round", record.round),
                detailItemText("Group", record.group),
                detailItemText("Home team", teamName(record.homeId)),
                detailItemText("Away team", teamName(record.awayId)),
                detailItemText("Kickoff", formatDateTime(record.kickoff)),
                detailItemText("Venue", record.venue),
                detailItem("Status", statusBadge(record.status))
            ]) + (fixtureWarnings.length
                ? '<div class="form-alert" data-tone="warning" style="margin-top:14px">' +
                    icon("alert") + "<p>" + esc(fixtureWarnings.join(" ")) + "</p></div>"
                : '<div class="form-alert" data-tone="success" style="margin-top:14px">' +
                    icon("checkCircle") + "<p>No scheduling conflicts detected for this fixture.</p></div>");
        }
        case "matches": {
            var fixture = byId(DEMO.fixtures, record.fixtureId) || {};
            return detailGrid([
                detailItemText("Match reference", record.id),
                detailItemText("Fixture", fixtureLabel(record.fixtureId)),
                detailItemText("Kickoff", formatDateTime(fixture.kickoff)),
                detailItemText("Venue", fixture.venue),
                detailItem("Status", statusBadge(record.status)),
                detailItemText("Referee", record.referee),
                detailItemText("Assistant one", record.assistantOne),
                detailItemText("Assistant two", record.assistantTwo),
                detailItemText("Fourth official", record.fourthOfficial),
                detailItemText("Notes", record.notes)
            ]);
        }
        case "results":
            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Fixture", fixtureLabel(record.fixtureId)),
                detailItemText("Home team", teamName(record.homeId)),
                detailItemText("Away team", teamName(record.awayId)),
                detailItemText("Score", record.homeScore === null
                    ? "Not recorded" : record.homeScore + " - " + record.awayScore),
                detailItem("Publication", statusBadge(
                    record.state === "published" ? "published" : "draft", record.state)),
                detailItemText("Entered by", record.enteredBy),
                detailItemText("Entered on", formatDate(record.enteredOn)),
                detailItemText("Notes", record.notes)
            ]);
        case "payments": {
            var paymentFee = feeAccountFor(record.teamId, record.tournamentId);
            var paymentCounts = FEE_RECEIVED_STATUSES.indexOf(normalise(record.status)) > -1;

            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Payment reference", record.reference),
                detailItemText("Team or payer", teamName(record.teamId)),
                detailItemText("Tournament", tournamentName(record.tournamentId)),
                detailItem("Amount", esc(formatMoney(record.amount)) + " " + esc(record.currency)),
                detailItemText("Method", record.method),
                detailItemText("Paid on", formatDate(record.paidOn)),
                detailItem("Status", statusBadge(record.status)),
                detailItem("Registration fee", '<span class="money">' +
                    esc(formatMoney(paymentFee.fee)) + "</span>"),
                detailItemText("Cleared by recorded payments", formatMoney(paymentFee.paid)),
                detailItem("Balance to clear",
                    '<span class="money' + (paymentFee.balance > 0 ? " is-negative" : " is-positive") +
                    '">' + esc(formatMoney(paymentFee.balance)) + "</span> " +
                    feeStatusBadge(paymentFee)),
                detailItemText("Recorded by", record.recordedBy)
            ]) + workflowNote(paymentCounts
                ? "This payment counts towards the registration fee while it stays confirmed or " +
                    "part paid. The team's balance clears in full once the fee is covered."
                : "Only confirmed and part payments clear a registration fee. A payment awaiting " +
                    "review or rejected does not reduce the balance shown here.") +
                receiptPreview(record);
        }
        case "payment-records": {
            var related = byId(DEMO.payments, record.reference) || {};
            return detailGrid([
                detailItemText("Record", record.id),
                detailItemText("Payment reference", record.reference),
                detailItemText("Related registration", record.registrationId),
                detailItem("Amount", esc(formatMoney(record.amount))),
                detailItem("Status", statusBadge(record.status)),
                detailItemText("Date", formatDate(record.date)),
                detailItemText("Receipt", record.receipt || "Not issued")
            ]) + receiptPreview({
                id: record.id,
                reference: record.reference,
                amount: record.amount,
                currency: "KES",
                status: record.status,
                paidOn: record.date,
                method: record.method || related.method || "Not recorded",
                teamId: record.teamId || related.teamId,
                receipt: record.receipt
            });
        }
        case "team-registrations": {
            var registrationFee = feeAccountFor(record.teamId, record.tournamentId);

            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Team", teamName(record.teamId)),
                detailItemText("Tournament", tournamentName(record.tournamentId)),
                detailItemText("Submitted", formatDate(record.submitted)),
                detailItem("Status", statusBadge(record.status)),
                detailItem("Registration fee", '<span class="money">' +
                    esc(formatMoney(registrationFee.fee)) + "</span>"),
                detailItemText("Cleared by recorded payments", formatMoney(registrationFee.paid)),
                detailItemText("Awaiting review", formatMoney(registrationFee.pending)),
                detailItem("Balance to clear",
                    '<span class="money' + (registrationFee.balance > 0 ? " is-negative" : " is-positive") +
                    '">' + esc(formatMoney(registrationFee.balance)) + "</span> " +
                    feeStatusBadge(registrationFee)),
                detailItemText("Outstanding requirements", record.outstanding),
                detailItemText("Reviewed by", record.reviewedBy)
            ]) + workflowNote("The registration fee is the amount set on " +
                tournamentName(record.tournamentId) + ". The team keeps a balance until recorded " +
                "payments clear it in full; approving the registration does not clear money owed.") +
                workflowNote("Registration review decisions are submitted to the backend.");
        }
        case "player-registrations":
            return detailGrid([
                detailItemText("Reference", record.id),
                detailItemText("Player", playerName(record.playerId)),
                detailItemText("Team", teamName(record.teamId)),
                detailItemText("Tournament", tournamentName(record.tournamentId)),
                detailItemText("Submitted", formatDate(record.submitted)),
                detailItem("Roster status", statusBadge("registered", "Registered")),
                detailItem("Eligibility", eligibilityBadge(record.eligibility)),
                detailItemText("Notes", record.notes)
            ]) + workflowNote("This record is part of the team roster. Age/category eligibility and any " +
                "required consent are recorded separately; there is no individual player approval step.");
        case "audit-logs":
            return detailGrid([
                detailItemText("Entry reference", record.id),
                detailItemText("Action", record.action),
                detailItemText("Subject", record.subject),
                detailItemText("User email", record.actorEmail || "Email unavailable"),
                detailItemText("Module", record.module),
                detailItemText("Date and time", formatDateTime(record.timestamp)),
                detailItem("Action type", badge(record.type, "purple"))
            ]) + workflowNote("This audit entry was returned by the backend.");
        default:
            return mediaOrContentDetail(moduleKey, record);
        }
    }

    function mediaOrContentDetail(moduleKey, record) {
        if (moduleKey === "media") {
            return '<div class="media-thumb" style="border-radius:14px;overflow:hidden">' +
                (record.file ? '<img src="' + esc(record.file) + '" alt="' + esc(record.title) + '">'
                    : icon("image")) + "</div>" +
                '<div style="margin-top:14px">' + detailGrid([
                    detailItemText("Reference", record.id),
                    detailItemText("Media type", normalise(record.mediaType) === "video" ? "Video" : "Image"),
                    detailItemText("Category", record.category),
                    detailItem("Status", statusBadge(record.status)),
                    detailItemText("Asset", record.file || "No image selected"),
                    detailItemText("Video URL", record.videoUrl || "Not applicable"),
                    detailItemText("Added on", formatDate(record.addedOn)),
                    detailItemText("Caption", record.caption)
                ]) + "</div>";
        }

        if (moduleKey === "announcements") {
            return detailGrid([
                detailItemText("Title", record.title),
                detailItemText("Audience", record.audience),
                detailItemText("Date", formatDate(record.date)),
                detailItem("Status", statusBadge(record.status))
            ]) + '<div class="preview-panel" style="margin-top:14px"><h3>Message preview</h3>' +
                '<p class="preview-body">' + esc(record.message) + "</p></div>" +
                workflowNote("Notifications are shown here only when returned by the backend.");
        }

        return detailGrid([detailItemText("Reference", record.id)]);
    }

    function workflowNote(text) {
        return '<div class="form-alert" data-tone="info" style="margin-top:14px">' +
            icon("info") + "<p>" + esc(text) + "</p></div>";
    }

    function receiptPreview(payment) {
        return '<div class="receipt" style="margin-top:14px">' +
            '<div class="receipt-head"><strong>' + esc(state.prefs.championshipName) + "</strong>" +
            statusBadge(payment.status) + "</div>" +
            detailGrid([
                detailItemText("Receipt reference", payment.receipt || "Not issued"),
                detailItemText("Payment reference", payment.reference),
                detailItemText("Team", teamName(payment.teamId)),
                detailItemText("Method", payment.method),
                detailItemText("Date", formatDate(payment.paidOn))
            ]) +
            '<div class="receipt-total"><span>Total</span><strong>' +
            esc(formatMoney(payment.amount)) + "</strong></div>" +
            '<p class="small muted">Receipt preview from the backend payment record.</p>' +
            (payment.id && (payment.status === "confirmed" || payment.status === "partial")
                ? '<button type="button" class="btn btn-outline btn-sm" data-action="download-receipt" ' +
                    'data-id="' + esc(payment.id) + '">' + icon("download") +
                    "Download PDF receipt</button>"
                : "") + "</div>";
    }

    async function downloadPaymentReceipt(paymentId) {
        var platform = window.AngutsaPlatform;
        if (!platform) {
            toast("The secure receipt service is unavailable. Reload and try again.", "error");
            return;
        }
        try {
            var result = await platform.request(
                "/admin/payments/" + encodeURIComponent(paymentId) + "/receipt"
            );
            var binary = window.atob(result.content);
            var bytes = new Uint8Array(binary.length);
            for (var index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            var url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }));
            var link = document.createElement("a");
            link.href = url;
            link.download = result.fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (error) {
            toast(error && error.message
                ? error.message
                : "The PDF receipt could not be downloaded.", "error");
        }
    }

    function openDetails(moduleKey, id) {
        var source = detailSource(moduleKey);
        if (!source) {
            toast("No detail view is available for this module yet.", "info");
            return;
        }

        var record = byId(source.list, id);
        if (!record) {
            toast("That backend record is no longer available. Refresh and try again.", "error");
            return;
        }

        var singular = FORM_CONFIG[moduleKey] ? FORM_CONFIG[moduleKey].singular : "Record";
        var profilePlayerId = moduleKey === "players" ? record.id
            : moduleKey === "player-registrations" ? record.playerId : "";
        var profileAction = profilePlayerId && hasAdminPermission("players.edit")
            ? '<button type="button" class="btn btn-secondary" data-action="edit-player-public-profile" ' +
                'data-module="players" data-id="' + esc(profilePlayerId) +
                '">Update public profile</button>'
            : "";

        openModal({
            title: source.label(record),
            subtitle: singular + " details \u00b7 " + id,
            size: "is-wide",
            body: detailBody(moduleKey, record),
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Close</button>' +
                profileAction +
                (moduleIsEditable(moduleKey)
                    ? '<button type="button" class="btn btn-primary" data-action="edit" ' +
                        'data-module="' + esc(moduleKey) + '" data-id="' + esc(id) + '">' +
                        icon("edit") + "Edit record</button>"
                    : "")
        });
    }

    function openAdminPlayerProfileModal(playerId) {
        var player = byId(DEMO.players, playerId);
        if (!player) {
            toast("That player record is no longer available. Refresh and try again.", "error");
            return;
        }
        if (!hasAdminPermission("players.edit")) {
            toast("You do not have permission to change player public profiles.", "error");
            return;
        }

        var youth = player.guardianConsentRequired === true;
        var profile = player.publicProfile || "hidden";
        closeModal();
        openModal({
            title: "Public player profile",
            subtitle: player.name + " \u00b7 " + teamName(player.teamId),
            size: "is-narrow",
            body: '<div class="form-field">' +
                '<label class="form-label" for="adminPlayerPublicProfile">Public profile</label>' +
                '<select class="form-select" id="adminPlayerPublicProfile">' +
                    '<option value="hidden"' + (profile === "hidden" ? " selected" : "") +
                        '>Hidden</option>' +
                    '<option value="limited"' + (profile === "limited" ? " selected" : "") +
                        '>Initials only</option>' +
                    (youth ? "" : '<option value="full"' + (profile === "full" ? " selected" : "") +
                        '>Full name</option>') +
                "</select>" +
                '<p class="form-hint">' +
                    (youth
                        ? "Youth profiles can show initials only after required guardian consent is recorded. Children's categories remain private."
                        : "Full name is shown only with the player's agreement. Hidden is the default.") +
                "</p>" +
                (youth ? "" : '<label class="check"><input type="checkbox" id="adminPlayerProfileConsent">' +
                    "<span>The player has agreed to display their full name publicly.</span></label>") +
                "</div>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="save-player-public-profile" ' +
                    'data-module="players" data-id="' + esc(playerId) + '">Save profile</button>'
        });
    }

    async function saveAdminPlayerPublicProfile(playerId) {
        var player = byId(DEMO.players, playerId);
        var field = $("#adminPlayerPublicProfile");
        var consent = $("#adminPlayerProfileConsent");
        if (!player || !field) return;
        if (field.value === "full" && (!consent || !consent.checked)) {
            toast("Confirm the player has agreed before selecting Full name.", "warning");
            return;
        }

        try {
            await window.AngutsaPlatform.request("/admin/players/" +
                encodeURIComponent(playerId) + "/public-profile", {
                method: "PATCH",
                body: {
                    publicProfile: field.value,
                    publicProfileConsent: Boolean(consent && consent.checked)
                }
            });
        } catch (error) {
            toast(error && error.message
                ? error.message
                : "We couldn't update the player's public profile. Please try again.", "error");
            return;
        }

        player.publicProfile = field.value;
        closeModal();
        renderView();
        toast("Public player profile updated.", "success");
    }

    /* -------------------------------------------------------
       12. Shell behaviour
       ------------------------------------------------------- */

    function applyPrefs() {
        document.body.classList.toggle("is-rail", Boolean(state.prefs.sidebarRail));

        var railToggle = $("#railToggle");
        if (railToggle) {
            railToggle.setAttribute("aria-pressed", state.prefs.sidebarRail ? "true" : "false");
            railToggle.setAttribute("aria-label",
                state.prefs.sidebarRail ? "Expand sidebar" : "Collapse sidebar");
        }

        var account = state.admin || {};
        var name = state.prefs.adminName || account.name || account.email || PREF_DEFAULTS.adminName;
        var role = adminRoleLabel(account.role) || state.prefs.adminRole || PREF_DEFAULTS.adminRole;
        var email = account.email || "";

        $$("[data-admin-name]").forEach(function (node) { node.textContent = name; });
        $$("[data-admin-role]").forEach(function (node) { node.textContent = role; });
        $$("[data-admin-email]").forEach(function (node) { node.textContent = email; });
        $$("[data-admin-initials]").forEach(function (node) { node.textContent = initials(name); });
        $$('[data-view-link="settings"]').forEach(function (node) {
            node.hidden = !canAccessView("settings");
        });

        var year = $("#appYear");
        if (year) year.textContent = String(eatCurrentYear());
    }

    function adminRoleLabel(role) {
        if (role === "platform_owner") return "Platform Owner";
        if (role === "tournament_admin") return "Tournament Administrator";
        return "";
    }

    function renderSidebar() {
        var nav = $("#appNav");
        if (!nav) return;

        nav.innerHTML = NAV_GROUPS.map(function (group) {
            var permittedViews = group.views.filter(function (item) {
                return canAccessView(item.view);
            });
            if (!permittedViews.length) return "";
            var items = permittedViews.map(function (item) {
                return '<a class="app-nav-item" href="#/' + esc(item.view) + '" ' +
                    'data-view-link="' + esc(item.view) + '">' +
                    '<span class="app-nav-icon">' + icon(item.icon) + "</span>" +
                    '<span class="app-nav-label">' + item.label + "</span>" +
                    '<span class="app-nav-count" data-nav-count="' + esc(item.view) +
                    '" hidden></span></a>';
            }).join("");

            return '<div class="app-nav-group">' +
                '<button type="button" class="app-nav-group-toggle" data-group-toggle="' +
                esc(group.id) + '" aria-expanded="true" aria-controls="group-' + esc(group.id) + '">' +
                icon("chevron") + "<span>" + group.label + "</span></button>" +
                '<div class="app-nav-group-body" id="group-' + esc(group.id) + '">' +
                items + "</div></div>";
        }).join("");

        renderNavCounts();
    }

    function renderNavCounts() {
        allNavItems().forEach(function (item) {
            var node = $('[data-nav-count="' + item.view + '"]');
            if (!node) return;
            var count = typeof item.count === "function" ? item.count() : 0;
            node.textContent = count > 0 ? String(count) : "";
            node.hidden = !(count > 0);
        });

        var bell = $("#bellCount");
        if (bell) {
            var unread = unreadCount();
            bell.textContent = String(unread);
            bell.hidden = unread === 0;
        }
    }

    function renderNotificationMenu() {
        var list = $("#menuNotificationList");
        if (!list) return;
        var menu = closestElement(list, '[data-menu="notifications"]');
        if (menu) menu.hidden = !canAccessView("notifications");
        if (!canAccessView("notifications")) return;

        var notes = DEMO.notifications.slice(0, 5);
        list.innerHTML = notes.length
            ? notes.map(function (note) {
                return '<button type="button" class="menu-notice ' +
                    (note.read ? "is-read" : "is-unread") + '" data-action="open-admin-notification" ' +
                    'data-id="' + esc(note.id) + '" data-module="' + esc(note.view) + '">' +
                    '<span class="menu-notice-dot" aria-hidden="true"></span>' +
                    '<span class="menu-notice-text"><strong>' + esc(note.title) + "</strong>" +
                    "<span>" + esc(note.message) + " \u00b7 " + esc(relativeTime(note.date)) +
                    "</span></span></button>";
            }).join("")
            : '<p class="menu-notice-text muted" style="padding:12px">No notifications.</p>';

        renderNavCounts();
    }

    /* -------------------------
       Global search
       ------------------------- */

    function searchIndex() {
        var entries = allNavItems().filter(function (item) {
            return canAccessView(item.view);
        }).map(function (item) {
            return {
                label: item.label.replace(/&amp;/g, "&"),
                detail: "Module \u00b7 " + viewCrumb(item.view),
                view: item.view,
                icon: item.icon,
                group: "Modules"
            };
        });

        if (canAccessView("tournaments")) DEMO.tournaments.forEach(function (record) {
            entries.push({ label: record.name + " " + record.season,
                detail: "Tournament \u00b7 " + record.venue, view: "tournaments",
                icon: "trophy", group: "Tournaments", query: record.name });
        });

        if (canAccessView("teams")) DEMO.teams.forEach(function (record) {
            entries.push({ label: record.name, detail: "Team \u00b7 " + categoryName(record.categoryId),
                view: "teams", icon: "shield", group: "Teams", query: record.name });
        });

        if (canAccessView("players")) DEMO.players.forEach(function (record) {
            entries.push({ label: record.name, detail: "Player \u00b7 " + teamName(record.teamId),
                view: "players", icon: "player", group: "Players", query: record.name });
        });

        if (canAccessView("fixtures")) DEMO.fixtures.forEach(function (record) {
            entries.push({ label: teamName(record.homeId) + " v " + teamName(record.awayId),
                detail: "Fixture \u00b7 " + formatDate(record.kickoff), view: "fixtures",
                icon: "calendar", group: "Fixtures", query: teamName(record.homeId) });
        });

        if (canAccessView("payments")) DEMO.payments.forEach(function (record) {
            entries.push({ label: record.reference, detail: "Payment \u00b7 " + teamName(record.teamId),
                view: "payments", icon: "wallet", group: "Payments", query: record.teamId });
        });

        return entries;
    }

    function runSearch(query) {
        var panel = $("#globalSearchPanel");
        var status = $("#globalSearchStatus");
        var clear = $("#globalSearchClear");
        var text = normalise(query);

        state.searchQuery = text;
        if (clear) clear.hidden = !text;
        if (!panel) return;

        if (text.length < 2) {
            panel.hidden = true;
            panel.innerHTML = "";
            if (status) status.textContent = "";
            return;
        }

        var matches = searchIndex().filter(function (entry) {
            return normalise(entry.label).indexOf(text) !== -1 ||
                normalise(entry.detail).indexOf(text) !== -1;
        }).slice(0, 12);

        if (!matches.length) {
            panel.innerHTML = '<p class="app-search-empty">No module or record ' +
                "matches \u201c" + esc(query) + "\u201d.</p>";
            panel.hidden = false;
            if (status) status.textContent = "No results found.";
            return;
        }

        var groups = {};
        matches.forEach(function (entry) {
            groups[entry.group] = groups[entry.group] || [];
            groups[entry.group].push(entry);
        });

        panel.innerHTML = Object.keys(groups).map(function (groupName) {
            return "<h3>" + esc(groupName) + "</h3>" + groups[groupName].map(function (entry) {
                return '<button type="button" class="app-search-result" data-search-view="' +
                    esc(entry.view) + '" data-search-query="' + esc(entry.query || "") + '">' +
                    '<span class="app-nav-icon">' + icon(entry.icon) + "</span>" +
                    '<span class="app-search-result-text"><strong>' + esc(entry.label) +
                    "</strong><span>" + esc(entry.detail) + "</span></span></button>";
            }).join("");
        }).join("");

        panel.hidden = false;
        if (status) status.textContent = pluralise(matches.length, "result") + " found.";
    }

    function closeSearch() {
        var panel = $("#globalSearchPanel");
        if (panel) {
            panel.hidden = true;
            panel.innerHTML = "";
        }
    }

    /* -------------------------
       Drawer, rail and menus
       ------------------------- */

    function openDrawer() {
        document.body.classList.add("drawer-open");

        var scrim = $("#appScrim");
        if (scrim) scrim.hidden = false;

        var toggle = $("#menuButton");
        if (toggle) toggle.setAttribute("aria-expanded", "true");

        state.sidebarOpen = true;

        var firstLink = $(".app-nav-item", $("#appSidebar"));
        if (firstLink) firstLink.focus();
    }

    function closeDrawer() {
        document.body.classList.remove("drawer-open");

        var scrim = $("#appScrim");
        if (scrim) scrim.hidden = true;

        var toggle = $("#menuButton");
        if (toggle) toggle.setAttribute("aria-expanded", "false");

        state.sidebarOpen = false;
    }

    function closeMenus() {
        $$(".app-menu-panel").forEach(function (panel) {
            panel.hidden = true;
        });

        $$(".app-menu > button").forEach(function (button) {
            button.setAttribute("aria-expanded", "false");
        });
    }

    function toggleMenu(buttonId, panelId) {
        var button = $("#" + buttonId);
        var panel = $("#" + panelId);
        if (!button || !panel) return;

        var willOpen = panel.hidden;

        closeMenus();
        closeSearch();

        panel.hidden = !willOpen;
        button.setAttribute("aria-expanded", willOpen ? "true" : "false");

        if (willOpen) {
            var first = $("button, a", panel);
            if (first) first.focus();
        }
    }

    function managementMatchFields(match, knockout, resultsEntry) {
        var home = esc(teamName(match.homeId));
        var away = esc(teamName(match.awayId));
        var tournamentId = resultsEntry || state.managementTournament;
        var hasDraftScore = match.homeScore !== "" && match.homeScore !== null &&
            match.homeScore !== undefined || match.awayScore !== "" &&
            match.awayScore !== null && match.awayScore !== undefined;
        var resultStatus = match.confirmed ? "Confirmed" :
            resultsEntry ? hasDraftScore ? "Draft saved" : "Scheduled" : "Incomplete";
        var entryId = "results-entry-" + esc(resultsEntry ? resultsEntry + "-" + match.id : match.id);
        var input = function (name, label, value, type) {
            return '<label class="tm-field"><span>' + label + '</span><input class="form-input" type="' +
                (type || "text") + '" data-tm-match-id="' + esc(match.id) + '" name="' + name +
                '" value="' + esc(value === undefined || value === null ? "" : value) + '"></label>';
        };
        var tieSelect = knockout
            ? '<label class="tm-field"><span>Tie procedure</span><select class="form-input" data-tm-match-id="' +
                esc(match.id) + '" name="tieBreakMethod"><option value="">Not required</option>' +
                '<option value="extra-time"' + (match.tieBreakMethod === "extra-time" ? " selected" : "") +
                '>Extra time</option><option value="penalties"' +
                (match.tieBreakMethod === "penalties" ? " selected" : "") +
                '>Penalty shootout</option></select></label>'
            : "";
        return '<div class="tm-match-card' + (resultsEntry ? ' results-match-card' : "") +
            '"><div class="tm-match-heading"><div><span class="tm-kicker">' +
            esc(match.round || match.group || "Match") + '</span><h4>' + home + ' <span>vs</span> ' + away +
            '</h4></div><div class="results-match-status"><span class="tm-status ' +
            (match.confirmed ? "is-confirmed" : "is-pending") + '">' + resultStatus + '</span>' +
            (resultsEntry ? '<button type="button" class="results-entry-toggle" data-result-entry-toggle ' +
                'aria-expanded="false" aria-controls="' + entryId + '">Enter result</button>' : "") +
            '</div></div><div class="results-entry-content" id="' + entryId + '"><div class="tm-match-fields">' +
            input("date", "Date", match.date || "", "date") + input("time", "Kick-off", match.time || "", "time") +
            input("venue", "Venue", match.venue || "") + input("homeScore", home + " score", match.homeScore, "number") +
            input("awayScore", away + " score", match.awayScore, "number") +
            goalScorerGroupMarkup(goalScorerGroupId(tournamentId, match.id, "home"),
                match.homeId, match.homeScorers) +
            goalScorerGroupMarkup(goalScorerGroupId(tournamentId, match.id, "away"),
                match.awayId, match.awayScorers) +
            (knockout ? tieSelect + input("homeExtraTime", home + " extra-time score", match.homeExtraTime, "number") +
                input("awayExtraTime", away + " extra-time score", match.awayExtraTime, "number") +
                input("homePenalties", home + " shootout score", match.homePenalties, "number") +
                input("awayPenalties", away + " shootout score", match.awayPenalties, "number") : "") +
            '</div><div class="tm-match-actions"><button type="button" class="btn btn-secondary" data-action="tm-save-match" data-id="' +
            esc(match.id) + (resultsEntry ? '" data-tournament-id="' + esc(resultsEntry) : "") +
            '">' + (resultsEntry ? "Save score draft" : "Save match details") +
            '</button><button type="button" class="btn btn-primary" data-action="tm-confirm-result" data-id="' +
            esc(match.id) + (resultsEntry ? '" data-tournament-id="' + esc(resultsEntry) : "") + '">' +
            (match.confirmed ? "Correct and confirm result" : "Confirm result") +
            '</button></div></div></div>';
    }

    function managementTieBreakMarkup(record, groupName) {
        var tie = managementGroupTie(record, groupName);
        if (!tie) return "";
        var tieMarkup = "";
        if (tie) {
            var order = record.tieBreakOrders[groupName] || {};
            var resolved = managementTieResolved(record, groupName);
            tieMarkup = '<div class="tm-tie-box"><strong>' +
                (resolved ? "Standings tie resolved." : "Standings tie needs an administrator decision.") +
                '</strong><p>' + (resolved
                    ? "The saved order is used to determine qualification."
                    : "Assign a unique position to every team tied on points, goal difference and goals scored.") + '</p>' +
                tie.rows.map(function (row) {
                    var options = '<option value="">Choose position</option>';
                    tie.positions.forEach(function (position) {
                        options += '<option value="' + position + '"' +
                            (Number(order[row.teamId]) === position ? " selected" : "") + '>' +
                            position + ' place</option>';
                    });
                    return '<label class="tm-field"><span>' + esc(teamName(row.teamId)) +
                        '</span><select class="form-input" data-tm-tie-rank="' + esc(groupName) +
                        '" data-team-id="' + esc(row.teamId) + '">' + options + '</select></label>';
                }).join("") +
                '<button type="button" class="btn btn-secondary" data-action="tm-save-tiebreak" data-id="' +
                esc(groupName) + '">Save tie order</button></div>';
        }
        return tieMarkup;
    }

    function managementStandingsMarkup(record, groupName) {
        var rows = managementStandings(record, groupName);
        var tieMarkup = managementTieBreakMarkup(record, groupName);
        var body = rows.map(function (row, index) {
            return '<tr><td>' + (index + 1) + '</td><td>' + esc(teamName(row.teamId)) +
                '</td><td>' + row.played + '</td><td>' + row.won + '</td><td>' + row.drawn +
                '</td><td>' + row.lost + '</td><td>' + row.goalsFor + '</td><td>' + row.goalsAgainst +
                '</td><td>' + row.goalDifference + '</td><td><strong>' + row.points + '</strong></td></tr>';
        }).join("");
        return '<section class="tm-panel"><div class="tm-panel-heading"><div><span class="tm-kicker">Standings</span>' +
            '<h3>' + esc(groupName) + '</h3></div><span class="tm-muted">' +
            rows.length + ' allocated team' + (rows.length === 1 ? "" : "s") + '</span></div>' +
            '<div class="table-wrap"><table class="data-table tm-standings"><thead><tr><th>Pos</th><th>Team</th>' +
            '<th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>' +
            '<tbody>' + (body || '<tr><td colspan="10">No approved teams allocated.</td></tr>') +
            '</tbody></table></div>' + tieMarkup + '</section>';
    }

    function managementStageMatches(record, stage) {
        return record.matches.filter(function (match) { return match.stage === stage; });
    }

    function managementStageEligibility(record, stage) {
        if (stage === "quarter-finals") {
            var qualifiers = managementQualifiers(record);
            return {
                ready: qualifiers.ready,
                reason: qualifiers.reason,
                teams: qualifiers.teams.map(function (item) { return item.teamId; }),
                slots: ["Quarter-final 1", "Quarter-final 2", "Quarter-final 3", "Quarter-final 4"]
            };
        }
        var previousStage = stage === "semi-finals" ? "quarter-finals" : "semi-finals";
        var previous = managementStageMatches(record, previousStage);
        var previousSlots = stage === "semi-finals"
            ? ["Quarter-final 1", "Quarter-final 2", "Quarter-final 3", "Quarter-final 4"]
            : ["Semi-final 1", "Semi-final 2"];
        var currentSlots = stage === "semi-finals" ? ["Semi-final 1", "Semi-final 2"]
            : stage === "third-place-playoff" ? ["Third-Place Playoff"] : ["Final"];
        if (previous.length !== previousSlots.length || previousSlots.some(function (slot) {
            return !previous.some(function (match) {
                return match.round === slot && match.confirmed && match.winnerId;
            });
        })) {
            return {
                ready: false,
                reason: "Create and confirm every " + previousStage + " fixture before adding " + stage + " fixtures.",
                teams: [],
                slots: currentSlots
            };
        }
        function winner(slot) {
            return previous.filter(function (match) { return match.round === slot; })[0].winnerId;
        }
        function loser(slot) {
            var match = previous.filter(function (item) { return item.round === slot; })[0];
            return match.homeId === match.winnerId ? match.awayId : match.homeId;
        }
        return stage === "semi-finals" ? {
            ready: true,
            reason: "",
            teams: [winner("Quarter-final 1"), winner("Quarter-final 2"),
                winner("Quarter-final 3"), winner("Quarter-final 4")],
            slots: ["Semi-final 1", "Semi-final 2"]
        } : stage === "third-place-playoff" ? {
            ready: true,
            reason: "",
            teams: [loser("Semi-final 1"), loser("Semi-final 2")],
            slots: ["Third-Place Playoff"]
        } : {
            ready: true,
            reason: "",
            teams: [winner("Semi-final 1"), winner("Semi-final 2")],
            slots: ["Final"]
        };
    }

    function fixtureStageLabel(stage) {
        var labels = {
            league: "League / round robin",
            group: "Group stage",
            preliminary: "Preliminary / qualifying",
            "round-of-16": "Round of 16",
            "quarter-finals": "Quarter-finals",
            "semi-finals": "Semi-finals",
            "third-place-playoff": "Third-place playoff",
            final: "Final"
        };
        if (!stage) return "";
        var name = String(stage.name || "").trim();
        var typeLabel = labels[stage.type] || "";
        var nameIsAnotherType = Object.keys(labels).some(function (type) {
            return type !== stage.type && name.toLowerCase() === labels[type].toLowerCase();
        });
        return nameIsAnotherType || !name ? typeLabel || name : name;
    }

    function renderFixturesView() {
        var tournament = byId(DEMO.tournaments, state.managementTournament) || DEMO.tournaments[0];
        if (!tournament) return renderListModule("fixtures");
        state.managementTournament = tournament.id;
        var record = managementRecord(tournament.id, true);
        var stages = DEMO.tournamentStages.filter(function (stage) {
            return stage.tournamentId === tournament.id && stage.included &&
                ["approved", "published", "in_progress"].indexOf(stage.status) !== -1;
        }).sort(function (a, b) { return a.position - b.position; });
        var stage = stages.filter(function (item) {
            return item.id === state.fixtureStageId;
        })[0] || stages[0] || null;
        state.fixtureStageId = stage ? stage.id : "";
        var tournamentOptionsMarkup = DEMO.tournaments.map(function (item) {
            return '<option value="' + esc(item.id) + '"' +
                (item.id === tournament.id ? " selected" : "") + '>' +
                esc(item.name) + ' \u00b7 ' + esc(item.season) + '</option>';
        }).join("");
        var dateValue = state.fixtureStartDate || tournament.startDate ||
            eatToday();
        var venueValue = state.fixtureVenue || tournament.venue || "";
        var stageOptions = stages.map(function (item) {
            return '<option value="' + esc(item.id) + '"' +
                (stage && item.id === stage.id ? " selected" : "") + '>' +
                esc(fixtureStageLabel(item)) + '</option>';
        }).join("");
        var stageFixtureRows = stage ? DEMO.fixtures.filter(function (fixture) {
            return fixture.stageId === stage.id;
        }) : [];
        var participantRows = stage ? DEMO.tournamentStageParticipants.filter(function (participant) {
            return participant.stage_id === stage.id;
        }) : [];
        var participantIds = participantRows.map(function (participant) { return participant.team_id; });
        var isGroupStage = stage && stage.type === "group";
        var isLeagueStage = stage && stage.type === "league";
        var groups = record.groupNames.map(function (name) {
            return { id: record.groupIdsByName[name] || "", name: name };
        }).filter(function (group) { return Boolean(group.id); });
        var selectedGroup = groups.filter(function (group) {
            return group.id === state.fixtureGroup;
        })[0] || null;
        if (isGroupStage && !selectedGroup && groups.length === 1) {
            selectedGroup = groups[0];
            state.fixtureGroup = selectedGroup.id;
        }
        var teamIdsForFixture = participantIds.filter(function (teamId) {
            return !isGroupStage || Boolean(selectedGroup &&
                record.teamGroups[teamId] === selectedGroup.name);
        });
        var teamsForFixture = approvedManagementTeams(tournament.id).filter(function (team) {
            return teamIdsForFixture.indexOf(team.id) !== -1;
        });
        var teamOptionsMarkup = '<option value="">Choose a team</option>' + teamsForFixture.map(function (team) {
            return '<option value="' + esc(team.id) + '">' + esc(teamName(team.id)) + '</option>';
        }).join("");
        var groupOptionsMarkup = '<option value="">Choose group</option>' + groups.map(function (group) {
            return '<option value="' + esc(group.id) + '"' +
                (selectedGroup && group.id === selectedGroup.id ? " selected" : "") + '>' +
                esc(group.name) + '</option>';
        }).join("");
        var pairingOptions = [];
        if (stage && !isGroupStage && !isLeagueStage) {
            var configuredPairings = stage.pairing && Array.isArray(stage.pairing.pairings)
                ? stage.pairing.pairings : [];
            pairingOptions = configuredPairings.map(function (pairing, index) {
                if (!Array.isArray(pairing.teamIds) || pairing.teamIds.length !== 2) return null;
                var homeId = pairing.teamIds[0];
                var awayId = pairing.teamIds[1];
                var alreadyCreated = stageFixtureRows.some(function (fixture) {
                    return (fixture.homeId === homeId && fixture.awayId === awayId) ||
                        (fixture.homeId === awayId && fixture.awayId === homeId);
                });
                return alreadyCreated ? null : {
                    index: index,
                    homeId: homeId,
                    awayId: awayId,
                    label: "Match " + (index + 1) + " - " +
                        teamName(homeId) + " vs " + teamName(awayId)
                };
            }).filter(Boolean);
        }
        var slotControl = isGroupStage || isLeagueStage
            ? '<label class="tm-field"><span>Matchday / round</span><input class="form-input" type="text" maxlength="40" data-fixture-round value="' +
                esc(state.fixtureRound || "Matchday 1") + '"></label>'
            : '<label class="tm-field"><span>Approved fixture pairing</span><select class="form-input" data-fixture-round>' +
                '<option value="">Choose pairing</option>' + pairingOptions.map(function (pairing) {
                    return '<option value="' + pairing.index + '"' +
                        (String(pairing.index) === state.fixtureRound ? " selected" : "") + '>' +
                        esc(pairing.label) + '</option>';
                }).join("") + '</select></label>';
        var groupControl = isGroupStage
            ? '<label class="tm-field"><span>Group</span><select class="form-input" data-fixture-group>' +
                groupOptionsMarkup + '</select></label>'
            : "";
        var selectedPairing = pairingOptions.filter(function (pairing) {
            return String(pairing.index) === state.fixtureRound;
        })[0] || null;
        var teamsControl = isGroupStage || isLeagueStage
            ? '<label class="tm-field"><span>Home team</span><select class="form-input" data-fixture-home>' +
                teamOptionsMarkup + '</select></label><label class="tm-field"><span>Away team</span><select class="form-input" data-fixture-away>' +
                teamOptionsMarkup + '</select></label>'
            : '<p class="tm-generator-summary">' + (selectedPairing
                ? esc(teamName(selectedPairing.homeId)) + ' vs ' + esc(teamName(selectedPairing.awayId))
                : "Choose one of the approved pairings.") + '</p>';
        var pairingsComplete = stage && !isGroupStage && !isLeagueStage &&
            pairingOptions.length === 0;
        var configurationNotice = !DEMO.tournamentStages.some(function (item) {
            return item.tournamentId === tournament.id && item.included;
        }) ? '<p class="tm-notice is-warning">Configure and save the tournament format in <a href="#/tournament-management">Tournament Management</a> first.</p>'
            : !stage ? '<p class="tm-notice is-warning">No stage is ready for fixtures. Approve the current stage in <a href="#/tournament-management">Tournament Management</a> after its participants are confirmed.</p>'
                : !participantIds.length ? '<p class="tm-notice is-warning">This stage has no saved participants. Review and approve its progression in Tournament Management.</p>'
                    : "";
        var fixtureForm = stage && pairingsComplete
            ? '<p class="tm-notice">Every approved pairing has a fixture. Finish entering and publishing the results before completing this stage.</p>'
            : stage && participantIds.length
            ? '<label class="tm-field"><span>Competition stage</span><select class="form-input" data-fixture-stage>' +
                stageOptions + '</select></label>' + groupControl + slotControl + teamsControl +
                '<div class="tm-fixture-generator-fields"><label class="tm-field"><span>Date</span><input class="form-input" type="date" data-fixture-start-date value="' +
                esc(dateValue) + '"></label><label class="tm-field"><span>Kick-off time</span><input class="form-input" type="time" data-fixture-kickoff value="' +
                esc(state.fixtureKickoffTime || "15:00") + '"></label><label class="tm-field"><span>Venue</span><input class="form-input" type="text" data-fixture-venue value="' +
                esc(venueValue) + '"></label></div><div class="tm-fixture-generator-actions"><button type="button" class="btn btn-primary" data-action="fixtures-create-manual"' +
                (hasAdminPermission("fixtures.create") ? "" : " disabled") + '>' +
                icon("plus") + 'Create fixture</button></div>'
            : configurationNotice;
        return '<section class="tm-fixture-generator"><div class="tm-fixture-generator-heading"><div>' +
            '<span class="tm-kicker">Stage fixture entry</span><h2>Create fixtures for the active stage</h2>' +
            '<p>The stage and eligible participants come from Tournament Management. Create and schedule every match here.</p>' +
            '</div><span class="tm-status ' + (stage ? "is-confirmed" : "is-pending") + '">' +
            (stage ? esc(fixtureStageLabel(stage)) : 'Configuration needed') +
            '</span></div><label class="tm-field tm-fixture-tournament"><span>Tournament</span><select class="form-input" data-fixture-generation-tournament>' +
            tournamentOptionsMarkup + '</select></label>' + fixtureForm + '</section>' +
            '<div class="tm-fixture-list">' + renderListModule("fixtures") + '</div>';
    }

    function managementKnockoutMarkup(record, stage) {
        var eligibility = managementStageEligibility(record, stage);
        var existing = managementStageMatches(record, stage);
        var required = stage === "quarter-finals" ? 4 : stage === "semi-finals" ? 2 : 1;
        var slots = eligibility.slots;
        var isThirdPlace = stage === "third-place-playoff";
        var output = '<section class="tm-panel"><div class="tm-panel-heading"><div><span class="tm-kicker">Next step</span>' +
            '<h3>' + esc(stage === "quarter-finals" ? "Quarter-finals" :
                stage === "semi-finals" ? "Semi-finals" : isThirdPlace ? "Third-Place Playoff" : "Final") +
            '</h3></div>' + (isThirdPlace ? '<span class="tm-status is-pending">Optional</span>' : "") +
            '</div>';
        if (!eligibility.ready) {
            output += '<p class="tm-notice is-warning">' + esc(eligibility.reason) + '</p>';
        } else {
            output += '<p class="tm-notice">' + (isThirdPlace
                ? 'Optional match between the losing semi-finalists to determine third place. Its result does not affect the final or champion.'
                : 'The admin creates every fixture manually. Select the fixture slot and choose from teams that have earned eligibility through confirmed results.') + '</p>' +
                '<div class="tm-slot-list">' + slots.map(function (slot) {
                    var fixture = existing.filter(function (match) { return match.round === slot; })[0];
                    return '<div class="tm-slot"><strong>' + esc(slot) + '</strong><span>' +
                        (fixture ? esc(teamName(fixture.homeId)) + ' vs ' + esc(teamName(fixture.awayId)) +
                            (fixture.confirmed ? ' \u00b7 Confirmed' : ' \u00b7 Incomplete') : 'Not created') +
                        '</span></div>';
                }).join("") + '</div>';
            if (isThirdPlace && record.thirdPlacePlayoffSkipped) {
                output += '<p class="tm-muted">Third-place playoff skipped; no third place will be recorded.</p>';
            } else if (existing.length < required) {
                output += '<button type="button" class="btn btn-primary" data-action="tm-open-fixture-creation" data-stage="' +
                    esc(stage) + '">Create a ' + esc(stage) + ' fixture manually</button>';
            }
            if (isThirdPlace && !record.thirdPlacePlayoffSkipped &&
                !existing.some(function (match) { return match.confirmed; })) {
                output += '<button type="button" class="btn btn-secondary" data-action="tm-skip-third-place-playoff">Skip optional playoff</button>';
            }
            output += '<div class="tm-match-list">' + existing.map(function (match) {
                return managementMatchFields(match, true);
            }).join("") + '</div>';
        }
        return output + '</section>';
    }

    function renderTournamentManagement() {
        var selectedTournament = byId(DEMO.tournaments, state.managementTournament) || DEMO.tournaments[0];
        if (!selectedTournament) return emptyState("No tournaments", "Create a tournament before managing its progress.", "");
        state.managementTournament = selectedTournament.id;
        var record = managementRecord(selectedTournament.id, true);
        var canEditFormat = hasAdminPermission("tournaments.edit");
        if (!Array.isArray(record.stageDraft)) {
            record.stageDraft = DEMO.tournamentStages.filter(function (stage) {
                return stage.tournamentId === selectedTournament.id;
            }).map(function (stage) {
                return Object.assign({}, stage, {
                    qualification: Object.assign({}, stage.qualification),
                    pairing: Object.assign({}, stage.pairing),
                    settings: Object.assign({}, stage.settings)
                });
            });
        }
        var teams = approvedManagementTeams(selectedTournament.id);
        var options = DEMO.tournaments.map(function (tournament) {
            return '<option value="' + esc(tournament.id) + '"' +
                (tournament.id === selectedTournament.id ? " selected" : "") + '>' +
                esc(tournament.name) + ' (' + esc(tournament.season) + ')</option>';
        }).join("");
        var stageTypeOptions = [
            ["league", "League / round robin"], ["group", "Group stage"],
            ["preliminary", "Preliminary / qualifying"], ["round-of-16", "Round of 16"],
            ["quarter-finals", "Quarter-finals"], ["semi-finals", "Semi-finals"],
            ["third-place-playoff", "Third-place playoff"], ["final", "Final"]
        ];
        var sourceOptions = [
            ["approved_teams", "All approved teams"], ["group_positions", "Group positions"],
            ["overall_standings", "Overall standings"], ["match_winners", "Selected match winners"],
            ["match_losers", "Selected match losers"], ["manual", "Manual selection"]
        ];
        var stageLabels = {
            draft: "Draft", awaiting_approval: "Awaiting approval", approved: "Approved",
            published: "Published", in_progress: "In progress", completed: "Completed",
            skipped: "Skipped", locked: "Locked"
        };
        var groupRows = record.groupNames.map(function (group, index) {
            return '<div class="tm-field"><span>Group ' + (index + 1) + ' name</span>' +
                '<input class="form-input" type="text" maxlength="64" data-tm-group-name aria-label="Group ' +
                (index + 1) + ' name" value="' + esc(group) +
                '"><button type="button" class="btn btn-secondary" data-action="tm-remove-group" ' +
                'data-index="' + index + '">Remove</button></div>';
        }).join("");
        var allocationMarkup = teams.map(function (team) {
            var groupOptions = '<option value="">Unassigned</option>' + record.groupNames.map(function (group) {
                return '<option value="' + esc(group) + '"' +
                    (record.teamGroups[team.id] === group ? " selected" : "") +
                    '>' + esc(group) + '</option>';
            }).join("");
            return '<label class="tm-allocation"><span>' + esc(teamName(team.id)) +
                '</span><select class="form-input" data-tm-assignment="' + esc(team.id) + '">' +
                groupOptions + '</select></label>';
        }).join("");
        var groupCounts = Object.create(null);
        record.groupNames.forEach(function (name) { groupCounts[name] = 0; });
        teams.forEach(function (team) {
            if (Object.prototype.hasOwnProperty.call(groupCounts, record.teamGroups[team.id])) {
                groupCounts[record.teamGroups[team.id]] += 1;
            }
        });
        var stageMarkup = record.stageDraft.map(function (stage, index) {
            var selectedParticipants = DEMO.tournamentStageParticipants.filter(function (participant) {
                return participant.stage_id === stage.id;
            }).map(function (participant) { return participant.team_id; });
            var proposedParticipants = suggestedStageParticipants(record, stage);
            var participantsToCheck = selectedParticipants.length
                ? selectedParticipants : proposedParticipants;
            var previousStagesComplete = record.stageDraft.slice(0, index).every(function (previous) {
                return !previous.included || previous.type === "third-place-playoff" ||
                    ["completed", "skipped"].indexOf(previous.status) !== -1;
            });
            var typeOptions = stageTypeOptions.map(function (option) {
                return '<option value="' + option[0] + '"' +
                    (stage.type === option[0] ? " selected" : "") + '>' + option[1] + '</option>';
            }).join("");
            var participantSourceOptions = sourceOptions.map(function (option) {
                return '<option value="' + option[0] + '"' +
                    (stage.participantSource === option[0] ? " selected" : "") + '>' +
                    option[1] + '</option>';
            }).join("");
            var pairings = stage.pairing && Array.isArray(stage.pairing.pairings)
                ? stage.pairing.pairings : [];
            var pairByTeam = Object.create(null);
            pairings.forEach(function (pairing, pairingIndex) {
                (pairing.teamIds || []).forEach(function (teamId) {
                    pairByTeam[teamId] = pairingIndex + 1;
                });
            });
            var participantOptions = teams.map(function (team) {
                var pairNumber = pairByTeam[team.id] || "";
                return '<label class="tm-allocation"><span><input type="checkbox" data-stage-participant="' +
                    esc(team.id) + '"' + (participantsToCheck.indexOf(team.id) !== -1 ? " checked" : "") +
                    '> ' + esc(teamName(team.id)) + '</span>' +
                    (["group", "league"].indexOf(stage.type) !== -1 ? "" :
                        '<input class="form-input" type="number" min="1" max="128" value="' +
                        esc(pairNumber) + '" placeholder="Match #" step="1" data-stage-pair="' + esc(team.id) +
                        '" aria-label="Match number for ' +
                        esc(teamName(team.id)) + '">') + '</label>';
            }).join("");
            var qualificationValue = stage.qualification &&
                (stage.qualification.qualifiersPerGroup || stage.qualification.count) || "";
            var qualificationPositions = stage.qualification &&
                Array.isArray(stage.qualification.positions)
                ? stage.qualification.positions.join(", ") : "";
            var approvalControls = "";
            var stageFixtureCount = DEMO.fixtures.filter(function (fixture) {
                return fixture.stageId === stage.id;
            }).length;
            if (stage.id && stage.included && stage.status === "draft" &&
                !previousStagesComplete) {
                approvalControls = '<p class="tm-notice is-warning">Complete the previous included stage before approving participants for this stage.</p>';
            } else if (stage.id && stage.included && stage.status === "draft") {
                approvalControls = '<div class="tm-panel"><h4>Choose who advances and who plays</h4>' +
                    '<p class="tm-muted">First save any stage name, type, or participant-source changes with the "Save format" button below. Then tick the teams that advance. Suggested teams come from saved results; you can change the selection.</p>' +
                    (stage.type === "final" && record.stageDraft.slice(0, index).some(function (previous) {
                        return previous.included && previous.type === "third-place-playoff";
                    })
                        ? '<p class="tm-muted">The third-place playoff is optional and does not block the final. Final participants come from the previous competitive stage.</p>'
                        : "") +
                    (["match_winners", "match_losers"].indexOf(stage.participantSource) !== -1
                        ? '<p class="tm-muted">Match winners/losers are taken from the most recently completed included stage.</p>'
                        : "") +
                    (proposedParticipants.length &&
                        ["approved_teams", "manual"].indexOf(stage.participantSource) === -1
                        ? '<p><strong>Suggested from results:</strong> ' +
                            proposedParticipants.map(function (teamId) {
                                return esc(teamName(teamId));
                            }).join(", ") + '</p>'
                        : "") +
                    (["group", "league"].indexOf(stage.type) === -1
                        ? '<p class="tm-muted">For each ticked team, enter a Match #. Give two opponents the same number. Example: Team A and Team B = 1; Team C and Team D = 2. A ticked team without an opponent gets a bye.</p>'
                        : "") +
                    '<div class="tm-allocation-grid">' + participantOptions + '</div>' +
                    '<label class="tm-field"><span>Override reason (required if the selection differs from the calculation)</span>' +
                    '<textarea class="form-input" data-stage-reason maxlength="1000"></textarea></label>' +
                    '<label><input type="checkbox" data-stage-override> I explicitly confirm a manual qualification override</label>' +
                    '<button type="button" class="btn btn-primary" data-action="tm-approve-stage" data-stage-id="' +
                    esc(stage.id) + '" data-stage-type="' + esc(stage.type) + '">Approve participants and pairings</button></div>';
            } else if (stage.id && stage.included && stage.status === "approved") {
                approvalControls = '<div class="tm-panel"><h4>Approved pairing preview</h4>' +
                    (["group", "league"].indexOf(stage.type) !== -1
                        ? '<p>' + (stage.type === "group"
                            ? "Group-stage fixtures use the saved group allocation."
                            : "League fixtures use the approved stage participants.") + '</p>'
                        : '<ol>' + pairings.map(function (pairing) {
                            return '<li>' + (pairing.teamIds || []).map(teamName).map(esc).join(" vs ") +
                                ((pairing.teamIds || []).length === 1 ? ' (bye)' : '') + '</li>';
                        }).join("") + '</ol>') +
                    (pairings.some(function (pairing) {
                        return (pairing.teamIds || []).length === 1;
                    }) ? '<p>Explicit byes are recorded as automatic advancement and do not create fixtures.</p>' : '') +
                    '<p class="tm-muted">' + stageFixtureCount +
                    ' fixture(s) created. Schedule all matches from the Fixtures menu.</p>' +
                    '<a class="btn btn-primary" href="#/fixtures">Open Fixtures</a></div>';
            } else if (stage.id && ["published", "in_progress"].indexOf(stage.status) !== -1) {
                approvalControls = '<div class="tm-panel"><p class="tm-muted">Stage status: ' +
                    esc(stageLabels[stage.status] || stage.status) +
                    '. ' + stageFixtureCount +
                    ' fixture(s) are saved. Enter all fixtures and publish their results from the Fixtures and Results menus.</p>' +
                    '<a class="btn btn-secondary" href="#/fixtures">Open Fixtures</a> ' +
                    '<button type="button" class="btn btn-secondary" data-action="tm-complete-stage" data-stage-id="' +
                    esc(stage.id) + '">Mark stage complete</button></div>';
            } else if (stage.id && stage.status === "completed") {
                approvalControls = '<p class="tm-notice">Stage completed. You can now review and approve the next included stage.</p>';
            }
            return '<article class="tm-panel" data-stage-card><div class="tm-panel-heading"><h3>Stage ' +
                (index + 1) + '</h3><span class="tm-status">' +
                esc(stageLabels[stage.status] || (stage.included ? "Draft" : "Skipped")) +
                '</span>' +
                (stage.id && canEditFormat && stage.status !== "skipped"
                    ? '<button type="button" class="btn btn-danger btn-sm" data-action="tm-reset-stage" ' +
                        'data-stage-id="' + esc(stage.id) + '" title="Restart this and all later stages">Restart</button>'
                    : "") +
                '</div><div class="tm-group-name-grid">' +
                '<label class="tm-field"><span>Stage name</span><input class="form-input" maxlength="80" data-stage-name value="' +
                esc(stage.name) + '"></label>' +
                '<label class="tm-field"><span>Stage type</span><select class="form-input" data-stage-type>' +
                typeOptions + '</select></label>' +
                '<label class="tm-field"><span>Participant source</span><select class="form-input" data-stage-source>' +
                participantSourceOptions + '</select></label>' +
                '<label class="tm-field"><span>Qualifiers (per group or overall)</span><input class="form-input" type="number" min="1" max="256" data-stage-qualifiers value="' +
                esc(qualificationValue) + '"></label>' +
                '<label class="tm-field"><span>Group finishing positions (optional)</span><input class="form-input" type="text" data-stage-positions value="' +
                esc(qualificationPositions) + '" placeholder="1, 2"></label>' +
                (["match_winners", "match_losers"].indexOf(stage.participantSource) !== -1
                    ? '<p class="tm-muted">Qualification will use the approved results from the previous completed stage.</p>'
                    : "") + '</div>' +
                '<label><input type="checkbox" data-stage-included' + (stage.included ? " checked" : "") +
                '> Include this stage in the approved progression</label>' +
                '<div class="tm-card-actions"><button type="button" class="btn btn-secondary" data-action="tm-move-stage" data-index="' +
                index + '" data-direction="-1"' + (index === 0 ? " disabled" : "") + '>Move up</button>' +
                '<button type="button" class="btn btn-secondary" data-action="tm-move-stage" data-index="' +
                index + '" data-direction="1"' + (index === record.stageDraft.length - 1 ? " disabled" : "") +
                '>Move down</button></div>' + approvalControls + '</article>';
        }).join("");
        var content = '<section class="tm-panel"><h3>Groups and approved team allocation</h3>' +
            '<p class="tm-muted">Choose any group count from 1 to 32. Unequal sizes are supported; every approved team must be assigned once. Group changes cannot erase downstream fixtures or published history.</p>' +
            '<div class="tm-group-name-grid">' + groupRows + '</div>' +
            '<div class="tm-card-actions"><button type="button" class="btn btn-outline" data-action="tm-add-group">Add group</button>' +
            '<button type="button" class="btn btn-primary" data-action="tm-create-groups">Save group names</button></div>' +
            (record.groupNames.length ? '<div class="tm-allocation-grid">' + allocationMarkup + '</div>' +
                '<button type="button" class="btn btn-primary" data-action="tm-allocate-teams">Save team allocation</button>' :
                '<p class="tm-muted">Create groups before allocating teams.</p>') + '</section>' +
            '<section class="tm-panel"><div class="tm-panel-heading"><div><h3>Tournament format</h3>' +
            '<p class="tm-muted">The owner controls the included stages, order, participant source, qualification and approval. No conventional round is added automatically.</p></div>' +
            '<button type="button" class="btn btn-secondary" data-action="tm-add-stage">Add stage</button></div>' +
            stageMarkup +
            '<button type="button" class="btn btn-primary" data-action="tm-save-format">Save format</button></section>';
        content += '<section class="tm-panel"><div class="tm-panel-heading"><div><h3>Reset tournament progress</h3>' +
            '<p class="tm-muted">Start this tournament configuration over. This permanently removes every fixture and result, including published, completed, and legacy fixtures, plus stage approvals and group allocations. The tournament, registered teams, registrations, and payment records are kept.</p></div>' +
            '<button type="button" class="btn btn-danger" data-action="tm-reset-tournament">Reset tournament</button></div></section>';
        if (!canEditFormat) {
            content = '<p class="tm-notice is-warning">This account can view tournament progress but lacks the tournaments.edit permission required to make changes.</p>' +
                '<fieldset disabled>' + content + '</fieldset>';
        }
        return '<div class="tm-workspace"><div class="tm-workspace-heading"><div><span class="tm-kicker">Competition control</span>' +
            '<p>Configure groups and owner-controlled stage progression.</p></div>' +
            '<label class="tm-tournament-select"><span>Tournament</span><select class="form-input" data-tm-tournament>' +
            options + '</select></label></div>' + content + '</div>';
    }

    /* -------------------------
       View routing
       ------------------------- */

    var VIEW_RENDERERS = {
        dashboard: function () { return renderDashboard(); },
        fixtures: function () { return renderFixturesView(); },
        "live-match": function () { return renderLiveMatchesView(); },
        standings: function () { return renderStandings(); },
        "tournament-management": function () { return renderTournamentManagement(); },
        "team-managers": function () { return renderTeamManagers(); },
        rules: function () { return renderRules(); },
        media: function () { return renderMedia(); },
        "financial-reports": function () { return renderFinancialReports(); },
        reports: function () { return renderReports(); },
        roles: function () { return renderRoles(); },
        settings: function () { return renderSettings(); }
    };

    var RESULTS_REFRESHERS = {
        media: function () {
            var container = $("#viewResults");
            if (container) {
                container.innerHTML = mediaGrid();
                loadPrivateMediaImages(container);
            }
        }
    };

    function markupForView(view) {
        if (VIEW_RENDERERS[view]) return VIEW_RENDERERS[view]();
        if (LIST_MODULES[view]) return renderListModule(view);
        return emptyState("Module unavailable",
            "This section has no view yet. Please report it so it can be added.", "");
    }

    function currentHashView() {
        var raw = String(window.location.hash || "");

        if (!raw || raw === "#") return "dashboard";

        /* Anything that is not a "#/route" hash (for example the skip
           link pointing at #appMain) is not a view change. */
        if (raw.indexOf("#/") !== 0) return null;

        var hash = raw.replace(/^#\/?/, "");
        return isValidView(hash) ? hash : "dashboard";
    }

    function syncActiveNav() {
        $$(".app-nav-item").forEach(function (item) {
            var isActive = item.getAttribute("data-view-link") === state.view;
            item.classList.toggle("is-active", isActive);
            if (isActive) item.setAttribute("aria-current", "page");
            else item.removeAttribute("aria-current");
        });

        var group = VIEW_META[state.view] ? VIEW_META[state.view][0] : "";
        $$(".app-nav-group-toggle").forEach(function (toggle) {
            var matches = toggle.getAttribute("data-group-toggle") === group;
            if (matches && toggle.getAttribute("aria-expanded") === "false") {
                toggle.setAttribute("aria-expanded", "true");
                var body = document.getElementById(toggle.getAttribute("aria-controls"));
                if (body) body.hidden = false;
            }
        });
    }

    function syncResultCount(view) {
        var counter = $("[data-result-count]");
        if (!counter) return;

        var total = null;
        var config = LIST_MODULES[view];

        if (config) {
            total = applyListControls(view, config.records(), config.search, config.sorters).length;
        } else if (view === "media") {
            total = mediaFiltered().length;
        }

        if (total === null) return;
        counter.textContent = pluralise(total, view === "media" ? "media item" : "record");
    }

    function renderView() {
        var container = $("#appView");
        if (!container) return;

        if (!canAccessView(state.view)) {
            container.innerHTML = '<div class="alert alert-danger" role="alert"><strong>Access denied.</strong> ' +
                "This section is not available to your account.</div>";
            return;
        }
        container.innerHTML = markupForView(state.view);
        if (state.view === "media") loadPrivateMediaImages(container);

        var title = viewTitle(state.view);
        var heading = $("#appTitle");
        var crumb = $("#appCrumb");
        if (heading) heading.textContent = title;
        if (crumb) crumb.textContent = title;
        document.title = title + " | Angutsa Championship Administration";

        syncActiveNav();
        syncResultCount(state.view);
        paintIcons(container);
    }

    function setView(view, options) {
        var opts = options || {};
        var target = isValidView(view) ? view : "dashboard";
        if (permissionEditor.saving && target !== state.view) {
            toast("Wait for the permission changes to finish saving before leaving this screen.", "info");
            return;
        }
        if (!canAccessView(target)) {
            target = firstAccessibleView();
            if (view !== target) {
                toast("Your account does not have access to that section.", "error");
            }
        }
        if (permissionEditor.user && permissionEditorIsDirty() && target !== state.view) {
            confirmDialog({
                title: "Discard permission changes?",
                message: "Leave this screen without saving your permission changes?",
                confirmLabel: "Discard changes",
                cancelLabel: "Stay on this screen"
            }).then(function (confirmed) {
                if (confirmed) {
                    permissionEditor.user = null;
                    permissionEditor.permissions = [];
                    permissionEditor.original = Object.create(null);
                    permissionEditor.search = "";
                    setView(target, opts);
                } else if (window.location.hash !== "#/" + state.view) {
                    window.location.hash = "#/" + state.view;
                }
            });
            return;
        }

        state.view = target;

        if (opts.hash !== false) {
            var desired = "#/" + target;
            if (window.location.hash !== desired) window.location.hash = desired;
        }

        if (opts.query) {
            listState(target).q = opts.query;
            listState(target).page = 1;
        }

        renderView();

        if (opts.focus !== false) {
            var main = $("#appMain");
            if (main) {
                window.scrollTo({ top: 0, behavior: "auto" });
                main.focus({ preventScroll: true });
            }
        }
    }

    /* -------------------------
       Actions
       ------------------------- */

    function openAdminTeamForm() {
        if (!state.admin || state.admin.role !== "platform_owner") {
            toast("Only a Platform Owner can create a team from Admin.", "error");
            return;
        }
        var tournaments = DEMO.tournaments.filter(function (tournament) {
            return tournament.status === "upcoming" || tournament.status === "active";
        });
        if (!tournaments.length) {
            toast("There are no upcoming or active tournaments to register a team for.", "info");
            return;
        }
        var tournamentOptionsMarkup = '<option value="">Choose a tournament</option>' +
            tournaments.map(function (tournament) {
                return '<option value="' + esc(tournament.id) + '">' +
                    esc(tournament.name + " " + tournament.season + " \u00b7 " +
                        formatMoney(tournament.registrationFee)) + "</option>";
            }).join("");
        openModal({
            title: "Create team and registration",
            subtitle: "Create the manager account and submit a registration for review.",
            size: "is-wide",
            body: '<form id="adminTeamCreateForm" class="form-grid">' +
                '<div class="form-field"><label class="form-label" for="adminTeamName">Team name</label>' +
                '<input class="form-input" id="adminTeamName" name="teamName" maxlength="120" required></div>' +
                '<div class="form-field"><label class="form-label" for="adminTeamLocation">Team location</label>' +
                '<input class="form-input" id="adminTeamLocation" name="location" maxlength="120"></div>' +
                '<div class="form-field is-full"><label class="form-label" for="adminTeamTournament">Tournament</label>' +
                '<select class="form-select" id="adminTeamTournament" name="tournamentId" required>' +
                    tournamentOptionsMarkup + '</select></div>' +
                '<div class="form-field is-full"><h3>Team manager</h3></div>' +
                '<div class="form-field"><label class="form-label" for="adminTeamManagerName">Full name</label>' +
                '<input class="form-input" id="adminTeamManagerName" name="managerName" maxlength="120" required></div>' +
                '<div class="form-field"><label class="form-label" for="adminTeamManagerEmail">Email</label>' +
                '<input class="form-input" id="adminTeamManagerEmail" name="managerEmail" type="email" maxlength="254" required></div>' +
                '<div class="form-field"><label class="form-label" for="adminTeamManagerPhone">Phone number</label>' +
                '<input class="form-input" id="adminTeamManagerPhone" name="managerPhone" type="tel" maxlength="32" required></div>' +
                '<div class="form-field is-full"><div class="form-alert" data-tone="info">' +
                icon("info") + '<p>The registration will be created as pending review. Its tournament fee will be due; ' +
                'no payment is recorded until the finance team confirms one. The manager will receive an invitation directing them to choose Forgot password on the sign-in page.</p>' +
                "</div></div></form>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="submit" class="btn btn-primary" form="adminTeamCreateForm" data-admin-team-submit>' +
                    "Create team</button>",
            onMount: function (root, close) {
                var form = $("#adminTeamCreateForm", root);
                var submit = $("[data-admin-team-submit]", root);
                if (!form || !submit) return;
                var managerIdentity = null;
                var requestKey = crypto.randomUUID().replace(/-/g, "");
                var submitting = false;

                on(form, "submit", async function (event) {
                    event.preventDefault();
                    if (submitting || !form.reportValidity()) return;
                    submitting = true;
                    submit.disabled = true;
                    submit.textContent = managerIdentity ? "Retry registration" : "Creating...";
                    var platform = window.AngutsaPlatform;
                    var managerEmail = form.elements.managerEmail.value.trim();
                    var result;
                    try {
                        if (!managerIdentity) {
                            managerIdentity = await platform.createManagerIdentity(managerEmail);
                        }
                        $$("input, select", form).forEach(function (control) {
                            control.disabled = true;
                        });
                        result = await platform.request("/admin/teams", {
                            method: "POST",
                            headers: { "Idempotency-Key": requestKey },
                            body: {
                                teamName: form.elements.teamName.value.trim(),
                                location: form.elements.location.value.trim(),
                                tournamentId: form.elements.tournamentId.value,
                                managerName: form.elements.managerName.value.trim(),
                                managerEmail: managerEmail,
                                managerPhone: form.elements.managerPhone.value.trim(),
                                managerIdToken: managerIdentity.idToken
                            }
                        });
                    } catch (error) {
                        var cleanupMessage = "";
                        if (managerIdentity && error && error.status >= 400 && error.status < 500) {
                            try {
                                await platform.deleteManagerIdentity(managerIdentity.idToken);
                                managerIdentity = null;
                                requestKey = crypto.randomUUID().replace(/-/g, "");
                                $$("input, select", form).forEach(function (control) {
                                    control.disabled = false;
                                });
                            } catch (cleanupError) {
                                console.error("The unused Firebase manager account could not be removed.",
                                    cleanupError);
                                cleanupMessage = " The Firebase account could not be removed; contact the platform owner before retrying.";
                            }
                        }
                        submitting = false;
                        submit.disabled = false;
                        submit.textContent = managerIdentity
                            ? "Retry registration" : "Create team";
                        var message = error && error.message
                            ? error.message : "We couldn't create the team. Please try again.";
                        if (managerIdentity) {
                            message += cleanupMessage ||
                                " The manager account was created, but the registration is not confirmed. Keep this form open and retry.";
                        }
                        toast(message, "error");
                        return;
                    }

                    close();
                    try {
                        await refreshLiveAdminData();
                    } catch (error) {
                        console.error("The new team was created, but the Admin data refresh failed.", error);
                        toast("Team and registration created. Refresh Admin to load the new team.", "warning");
                        return;
                    }
                    var message = result.teamName + " was created. Registration is pending review; " +
                        formatMoney(result.feeAmount) + " is due.";
                    if (result.emailStatus === "accepted_by_provider") {
                        message += " The manager invitation was sent; they can choose a password from Forgot password on the sign-in page.";
                    } else {
                        message += " Invitation email delivery was not confirmed (" +
                            (result.emailStatus || "unknown") +
                            "); the manager can use Forgot password on the sign-in page.";
                    }
                    toast(message, result.emailStatus === "accepted_by_provider" ? "success" : "warning");
                });
            }
        });
    }

    function workflowAction(moduleKey, id, status, message, auditType) {
        var path;
        var serverStatus = normalise(status).replace(/\s+/g, "_");
        if (moduleKey === "team-registrations") {
            path = "/admin/team-registrations/" + encodeURIComponent(id) + "/review";
        } else if (moduleKey === "teams") {
            var team = byId(DEMO.teams, id);
            if (!team || !team.registrationId) {
                toast("This team has no live registration to review.", "error");
                return;
            }
            path = "/admin/team-registrations/" +
                encodeURIComponent(team.registrationId) + "/review";
        } else if (moduleKey === "payments") {
            path = "/admin/payments/" + encodeURIComponent(id) + "/review";
        } else {
            toast("This workflow is not connected to the backend. Nothing was changed.", "error");
            return;
        }

        var actionResult;
        return window.AngutsaPlatform.request(path, {
            method: "POST",
            body: { status: serverStatus, reviewNote: message || "" }
        }).then(function (result) {
            actionResult = result;
            return requestAdminBootstrap(window.AngutsaPlatform);
        }).then(function (latest) {
            applyAdminBootstrap(latest, state.admin);
            renderView();
            renderNavCounts();
            renderNotificationMenu();
            if (serverStatus === "correction_requested") {
                if (actionResult && actionResult.emailStatus === "accepted_by_provider") {
                    toast("Correction request saved and email accepted for delivery.", "success");
                } else {
                    var emailStatus = actionResult && actionResult.emailStatus
                        ? actionResult.emailStatus : "unconfirmed";
                    toast("Correction saved, but the manager email was not confirmed (" +
                        emailStatus + ").", "warning");
                }
            } else if (serverStatus === "approved" && actionResult &&
                (Number(actionResult.balanceDue) > 0 || actionResult.accountActivated)) {
                var balanceOutstanding = Number(actionResult.balanceDue) > 0;
                var approvalMessage = balanceOutstanding
                    ? "Registration approved with an outstanding balance of " +
                        formatMoney(actionResult.balanceDue) + "."
                    : "Registration approved.";
                if (actionResult.accountActivated) {
                    approvalMessage += " Manager account activated.";
                }
                if (actionResult.emailStatus === "accepted_by_provider") {
                    approvalMessage += balanceOutstanding
                        ? " The manager was emailed to clear the balance."
                        : actionResult.accountActivated ? " The manager was emailed." : "";
                } else if (actionResult.emailStatus && actionResult.emailStatus !== "accepted_by_provider") {
                    approvalMessage += " Manager email delivery wasn't confirmed (" +
                        actionResult.emailStatus + ").";
                }
                toast(approvalMessage, balanceOutstanding ? "warning" : "success");
            } else {
                toast(moduleKey === "payments" ? "Payment review saved." : "Registration review saved.", "success");
            }
            return true;
        }).catch(function (error) {
            toast(error && error.message ? error.message : "We couldn't save this review. Please try again.", "error");
            return false;
        });
    }

    function actionRequestCorrection(moduleKey, id) {
        var registrationId = id;
        if (moduleKey === "teams") {
            var team = byId(DEMO.teams, id);
            if (!team || !team.registrationId) {
                toast("The registration for this team could not be identified.", "error");
                return;
            }
            registrationId = team.registrationId;
        } else if (moduleKey !== "team-registrations") {
            toast("Only team registrations support correction requests.", "info");
            return;
        }

        openModal({
            title: "Request a registration correction",
            subtitle: "Explain what the team manager needs to update. This note will be included in their email.",
            body: '<div class="form-field" data-correction-field>' +
                '<label class="form-label" for="correctionRequestNote">Correction needed</label>' +
                '<textarea class="form-control" id="correctionRequestNote" rows="5" maxlength="2000" ' +
                    'placeholder="Describe the information or document that needs to be corrected." ' +
                    'aria-describedby="correctionRequestHelp correctionRequestError" required></textarea>' +
                '<p class="form-note" id="correctionRequestHelp">Be specific so the manager knows exactly what to fix.</p>' +
                '<p class="form-error" id="correctionRequestError" role="alert" hidden></p>' +
                "</div>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-correction-submit>Send correction</button>',
            onMount: function (root, close) {
                var field = $("[data-correction-field]", root);
                var input = $("#correctionRequestNote", root);
                var error = $("#correctionRequestError", root);
                var submit = $("[data-correction-submit]", root);
                if (!input || !submit) return;

                on(input, "input", function () {
                    if (!input.value.trim()) return;
                    field.classList.remove("has-error");
                    error.hidden = true;
                    error.textContent = "";
                });
                on(submit, "click", function () {
                    var reviewNote = input.value.trim();
                    if (!reviewNote) {
                        field.classList.add("has-error");
                        error.textContent = "Describe the correction needed before sending.";
                        error.hidden = false;
                        input.focus();
                        return;
                    }

                    submit.disabled = true;
                    submit.classList.add("is-loading");
                    submit.setAttribute("aria-busy", "true");
                    submit.textContent = "Sending...";
                    workflowAction("team-registrations", registrationId,
                        "Correction requested", reviewNote, "Review").then(function (saved) {
                        if (saved) {
                            close();
                            return;
                        }
                        submit.disabled = false;
                        submit.classList.remove("is-loading");
                        submit.removeAttribute("aria-busy");
                        submit.textContent = "Send correction";
                    });
                });
            }
        });
    }

    function managementControls(matchId) {
        var controls = {};
        $$("[data-tm-match-id]").forEach(function (node) {
            if (node.getAttribute("data-tm-match-id")) {
                var fieldId = node.getAttribute("data-tm-match-id");
                if (fieldId === matchId) controls[node.name] = node.value;
            }
        });
        return controls;
    }

    function validManagementScore(value, required) {
        if (value === "" || value === undefined || value === null) return !required;
        return /^\d+$/.test(String(value)) && Number(value) >= 0;
    }

    function invalidateManagementAfter(record, stage) {
        var removeStages = stage === "group"
            ? ["quarter-finals", "semi-finals", "third-place-playoff", "final"]
            : stage === "quarter-finals" ? ["semi-finals", "third-place-playoff", "final"]
            : stage === "semi-finals" ? ["third-place-playoff", "final"] : [];
        record.matches.forEach(function (match) {
            if (removeStages.indexOf(match.stage) === -1) return;
            match.confirmed = false;
            match.winnerId = "";
            match.homeScore = "";
            match.awayScore = "";
            match.homeExtraTime = "";
            match.awayExtraTime = "";
            match.homePenalties = "";
            match.awayPenalties = "";
            match.tieBreakMethod = "";
        });
        if (stage === "group") {
            record.qualifiersConfirmed = false;
            record.semifinalsConfirmed = false;
            record.finalConfirmed = false;
        } else if (stage === "quarter-finals") {
            record.semifinalsConfirmed = false;
            record.finalConfirmed = false;
        } else if (stage === "semi-finals") {
            record.finalConfirmed = false;
        }
        if (stage === "group" || stage === "quarter-finals" || stage === "semi-finals") {
            record.thirdPlacePlayoffSkipped = false;
        }
        if (stage !== "third-place-playoff") {
            record.championConfirmed = false;
            record.championTeamId = "";
            record.runnerUpTeamId = "";
            record.finalScore = "";
        }
    }

    function managementTournamentForCurrentView() {
        return managementRecord(state.managementTournament, true);
    }

    async function saveManagementAndRefresh() {
        try {
            await refreshLiveAdminData();
            toast("Tie-break resolution, knockout progression, and champion confirmation are not connected to the live backend yet.",
                "info");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't refresh tournament data. Please try again.", "error");
        }
    }

    function managementMatchFromControls(record, id) {
        var match = record.matches.filter(function (item) { return item.id === id; })[0];
        if (!match) {
            toast("That tournament match is no longer available.", "error");
            return null;
        }
        var controls = managementControls(id);
        var candidate = {};
        Object.keys(match).forEach(function (key) { candidate[key] = match[key]; });
        candidate.publicTournamentId = record.publicTournamentId ||
            publicTournamentIdFor(record.tournamentId);
        candidate.date = controls.date || "";
        candidate.time = controls.time || "";
        candidate.venue = (controls.venue || "").trim();
        candidate.homeScore = controls.homeScore === "" || controls.homeScore === undefined
            ? "" : Number(controls.homeScore);
        candidate.awayScore = controls.awayScore === "" || controls.awayScore === undefined
            ? "" : Number(controls.awayScore);
        candidate.tieBreakMethod = controls.tieBreakMethod || "";
        candidate.homeExtraTime = controls.homeExtraTime === "" || controls.homeExtraTime === undefined
            ? "" : Number(controls.homeExtraTime);
        candidate.awayExtraTime = controls.awayExtraTime === "" || controls.awayExtraTime === undefined
            ? "" : Number(controls.awayExtraTime);
        candidate.homePenalties = controls.homePenalties === "" || controls.homePenalties === undefined
            ? "" : Number(controls.homePenalties);
        candidate.awayPenalties = controls.awayPenalties === "" || controls.awayPenalties === undefined
            ? "" : Number(controls.awayPenalties);
        candidate.homeScorers = collectGoalScorerEntries(
            goalScorerGroupId(record.tournamentId, id, "home"));
        candidate.awayScorers = collectGoalScorerEntries(
            goalScorerGroupId(record.tournamentId, id, "away"));
        return { match: match, candidate: candidate };
    }

    function copyManagementMatch(target, source) {
        Object.keys(source).forEach(function (key) { target[key] = source[key]; });
    }

    function managementWinner(match) {
        var home = Number(match.homeScore);
        var away = Number(match.awayScore);
        if (home > away) return match.homeId;
        if (away > home) return match.awayId;
        if (match.stage === "group") return "";
        if (match.tieBreakMethod === "extra-time") {
            if (Number(match.homeExtraTime) > Number(match.awayExtraTime)) return match.homeId;
            if (Number(match.awayExtraTime) > Number(match.homeExtraTime)) return match.awayId;
            return "";
        }
        if (match.tieBreakMethod === "penalties") {
            if (Number(match.homePenalties) > Number(match.awayPenalties)) return match.homeId;
            if (Number(match.awayPenalties) > Number(match.homePenalties)) return match.awayId;
        }
        return "";
    }

    function managementFixtureParticipantsValid(record, match) {
        if (match.stage === "group") {
            return record.groupsCreated && record.teamGroups[match.homeId] === match.group &&
                record.teamGroups[match.awayId] === match.group && match.homeId !== match.awayId;
        }
        var eligibility = managementStageEligibility(record, match.stage);
        if (!eligibility.ready || eligibility.teams.indexOf(match.homeId) === -1 ||
            eligibility.teams.indexOf(match.awayId) === -1 || match.homeId === match.awayId ||
            eligibility.slots.indexOf(match.round) === -1) return false;
        return !managementStageMatches(record, match.stage).some(function (other) {
            return other.id !== match.id &&
                (other.homeId === match.homeId || other.awayId === match.homeId ||
                    other.homeId === match.awayId || other.awayId === match.awayId);
        });
    }

    async function actionSaveManagementMatch(id, tournamentId) {
        var record = tournamentId ? managementRecord(tournamentId, false) : managementTournamentForCurrentView();
        if (!record) {
            toast("The tournament for this scheduled result could not be found.", "error");
            return;
        }
        var matchData = managementMatchFromControls(record, id);
        if (!matchData) return;
        var match = matchData.match;
        var candidate = matchData.candidate;
        if (!managementFixtureParticipantsValid(record, candidate)) {
            toast("This fixture no longer matches the tournament's confirmed progression. Review its teams and stage.", "error");
            return;
        }
        if (candidate.stage !== "group") {
            toast("Saving knockout results and tie-break scores is not connected to the live backend yet.", "info");
            return;
        }
        if (!validManagementScore(candidate.homeScore, false) || !validManagementScore(candidate.awayScore, false) ||
            !validManagementScore(candidate.homeExtraTime, false) || !validManagementScore(candidate.awayExtraTime, false) ||
            !validManagementScore(candidate.homePenalties, false) || !validManagementScore(candidate.awayPenalties, false)) {
            toast("Scores must be whole numbers zero or greater.", "error");
            return;
        }
        var tournament = byId(DEMO.tournaments, record.tournamentId);
        if (!tournament) {
            toast("The tournament for this match could not be identified.", "error");
            return;
        }
        try {
            await window.AngutsaPlatform.request("/admin/fixtures/" +
                encodeURIComponent(match.id), {
                    method: "PUT",
                    body: {
                        tournamentId: record.tournamentId,
                        categoryId: tournament.categoryId,
                        stage: candidate.stage,
                        group: candidate.group || "",
                        round: candidate.round,
                        homeId: candidate.homeId,
                        awayId: candidate.awayId,
                        kickoff: candidate.date + "T" + candidate.time,
                        venue: candidate.venue,
                        status: "scheduled"
                    }
                });
            await window.AngutsaPlatform.request("/admin/matches/" +
                encodeURIComponent(match.id) + "/result", {
                    method: "PUT",
                    body: {
                        homeScore: candidate.homeScore,
                        awayScore: candidate.awayScore,
                        state: "draft",
                        notes: "",
                        homeScorers: candidate.homeScorers || [],
                        awayScorers: candidate.awayScorers || []
                    }
                });
            await refreshLiveAdminData();
            toast("Group fixture details and score draft saved to the database.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't save the fixture changes. Please try again.", "error");
        }
    }

    function actionConfirmManagementResult(id, tournamentId) {
        var record = tournamentId ? managementRecord(tournamentId, false) : managementTournamentForCurrentView();
        if (!record) {
            toast("The tournament for this scheduled result could not be found.", "error");
            return;
        }
        var matchData = managementMatchFromControls(record, id);
        if (!matchData) return;
        var match = matchData.match;
        var candidate = matchData.candidate;
        if (candidate.stage !== "group") {
            toast("Knockout progression and tie-break results are not connected to the live backend yet.", "info");
            return;
        }
        if (!managementFixtureParticipantsValid(record, candidate)) {
            toast("This fixture no longer matches the tournament's confirmed progression. Review its teams and stage.", "error");
            return;
        }
        if (!candidate.date || !candidate.time || !candidate.venue) {
            toast("Enter the match date, kick-off time and venue before confirming.", "error");
            return;
        }
        if (!validManagementScore(candidate.homeScore, true) || !validManagementScore(candidate.awayScore, true) ||
            !validManagementScore(candidate.homeExtraTime, false) || !validManagementScore(candidate.awayExtraTime, false) ||
            !validManagementScore(candidate.homePenalties, false) || !validManagementScore(candidate.awayPenalties, false)) {
            toast("Enter valid whole-number scores, zero or greater.", "error");
            return;
        }
        if (!goalScorersFitScore(candidate.homeScore, candidate.homeScorers, candidate.homeId) ||
            !goalScorersFitScore(candidate.awayScore, candidate.awayScorers, candidate.awayId)) {
            toast("Recorded scorer goals must use registered players or own goals and cannot exceed the team score.", "error");
            return;
        }
        if (candidate.stage !== "group" && Number(candidate.homeScore) === Number(candidate.awayScore)) {
            if (candidate.tieBreakMethod === "extra-time") {
                if (!validManagementScore(candidate.homeExtraTime, true) ||
                    !validManagementScore(candidate.awayExtraTime, true) ||
                    Number(candidate.homeExtraTime) === Number(candidate.awayExtraTime)) {
                    toast("The extra-time score must establish a winner. Choose a penalty shootout if extra time is also tied.", "error");
                    return;
                }
            } else if (candidate.tieBreakMethod === "penalties") {
                if (!validManagementScore(candidate.homePenalties, true) ||
                    !validManagementScore(candidate.awayPenalties, true) ||
                    Number(candidate.homePenalties) === Number(candidate.awayPenalties)) {
                    toast("Enter separate penalty-shootout scores that establish a winner.", "error");
                    return;
                }
            } else {
                toast("A knockout match cannot be confirmed as a tie. Select extra time or a penalty shootout.", "error");
                return;
            }
        }
        var winner = managementWinner(candidate);
        if (candidate.stage !== "group" && !winner) {
            toast("The configured tie procedure has not established a winner.", "error");
            return;
        }
        var wasConfirmed = match.confirmed;
        confirmDialog({
            title: wasConfirmed ? "Correct and reconfirm result?" : "Confirm match result?",
            message: "The confirmed score will be published and included in group standings. Scorer names are optional.",
            confirmLabel: wasConfirmed ? "Correct result" : "Confirm result",
            tone: wasConfirmed ? "warning" : "info"
        }).then(async function (confirmed) {
            if (!confirmed) return;
            var correctionReason = "";
            if (wasConfirmed) {
                correctionReason = window.prompt(
                    "Explain why this published result is being corrected."
                );
                if (!correctionReason || !correctionReason.trim()) {
                    toast("A correction reason is required.", "error");
                    return;
                }
            }
            var tournament = byId(DEMO.tournaments, record.tournamentId);
            if (!tournament) {
                toast("The tournament for this match could not be identified.", "error");
                return;
            }
            try {
                await window.AngutsaPlatform.request("/admin/fixtures/" +
                    encodeURIComponent(match.id), {
                        method: "PUT",
                        body: {
                            tournamentId: record.tournamentId,
                            categoryId: tournament.categoryId,
                            stage: "group",
                            group: candidate.group || "",
                            round: candidate.round,
                            homeId: candidate.homeId,
                            awayId: candidate.awayId,
                            kickoff: candidate.date + "T" + candidate.time,
                            venue: candidate.venue,
                            status: "scheduled"
                        }
                    });
                await window.AngutsaPlatform.request("/admin/matches/" +
                    encodeURIComponent(match.id) + "/result", {
                        method: "PUT",
                        body: {
                            homeScore: candidate.homeScore,
                            awayScore: candidate.awayScore,
                            state: "published",
                            notes: "",
                            correctionReason: correctionReason,
                            homeScorers: candidate.homeScorers,
                            awayScorers: candidate.awayScorers
                        }
                    });
                await refreshLiveAdminData();
                toast("Match result confirmed and group standings updated.", "success");
            } catch (error) {
                toast(error && error.message ? error.message : "We couldn't confirm the match result. Please try again.", "error");
            }
        });
    }

    async function actionManagementCreateGroups() {
        var record = managementTournamentForCurrentView();
        if (!record) {
            toast("Choose a tournament before configuring its groups.", "error");
            return;
        }
        var inputs = $$(".tm-workspace [data-tm-group-name]");
        var names = inputs.map(function (input) { return input.value.trim(); });
        var uniqueNames = names.map(function (name) { return normalise(name); });
        if (names.length > 32 || names.some(function (name) { return !name; }) ||
            uniqueNames.some(function (name, index) { return uniqueNames.indexOf(name) !== index; })) {
            toast("Enter no more than 32 non-empty, unique group names.", "error");
            return;
        }
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/groups", {
                    method: "PUT",
                    body: {
                        saveNamesOnly: true,
                        groups: names.map(function (name) { return { name: name, teamIds: [] }; })
                    }
                });
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't save the group names. Please try again.", "error");
            return;
        }
        try {
            await refreshLiveAdminData();
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't load the updated groups. Please try again.", "error");
            return;
        }
        toast("Group names saved to the database.", "success");
    }

    function actionManagementAddGroup() {
        var record = managementTournamentForCurrentView();
        if (!record) return;
        var inputs = $$(".tm-workspace [data-tm-group-name]");
        if (inputs.length === record.groupNames.length) {
            record.groupNames = inputs.map(function (input) { return input.value.trim(); });
        }
        if (record.groupNames.length >= 32) {
            toast("A tournament can have at most 32 groups.", "error");
            return;
        }
        var suffix = 1;
        var nextName;
        do {
            nextName = "Group " + suffix;
            suffix += 1;
        } while (record.groupNames.some(function (name) {
            return normalise(name) === normalise(nextName);
        }));
        record.groupNames.push(nextName);
        renderView();
    }

    function actionManagementRemoveGroup(index) {
        var record = managementTournamentForCurrentView();
        if (!record || !Number.isInteger(index) || index < 0 ||
            index >= record.groupNames.length) return;
        var previousName = record.groupNames[index];
        var inputs = $$(".tm-workspace [data-tm-group-name]");
        if (inputs.length === record.groupNames.length) {
            record.groupNames = inputs.map(function (input) { return input.value.trim(); });
        }
        var removedName = record.groupNames[index];
        var assignedCount = Object.keys(record.teamGroups || {}).filter(function (teamId) {
            return record.teamGroups[teamId] === previousName ||
                record.teamGroups[teamId] === removedName;
        }).length;
        record.groupNames.splice(index, 1);
        renderView();
        toast("Group removed from the draft. Save group names to apply the change." +
            (assignedCount ? " " + assignedCount + " team assignment(s) in this group will need to be restored." : ""),
        assignedCount ? "warning" : "info");
    }

    function actionManagementAddStage() {
        var record = managementTournamentForCurrentView();
        if (!record) return;
        if (record.stageDraft.length >= 16) {
            toast("A format can contain at most 16 stages.", "error");
            return;
        }
        var previousStage = record.stageDraft[record.stageDraft.length - 1];
        var firstStage = !previousStage;
        var stageType = firstStage ? "group" :
            ["group", "league"].indexOf(previousStage.type) !== -1 ? "semi-finals" : "final";
        var participantSource = firstStage ? "approved_teams" :
            ["group", "league"].indexOf(previousStage.type) !== -1
                ? "group_positions" : "match_winners";
        record.stageDraft.push({
            id: "", tournamentId: record.tournamentId,
            name: firstStage ? "Group Stage" :
                stageType === "semi-finals" ? "Semi-finals" : "Final",
            type: stageType, included: true, status: "draft",
            participantSource: participantSource,
            qualification: participantSource === "group_positions"
                ? { qualifiersPerGroup: 2 } : {},
            pairing: {}, settings: {}
        });
        renderView();
    }

    function actionManagementMoveStage(index, direction) {
        var record = managementTournamentForCurrentView();
        var destination = index + direction;
        if (!record || !Number.isInteger(index) || destination < 0 ||
            destination >= record.stageDraft.length) return;
        var moving = record.stageDraft.splice(index, 1)[0];
        record.stageDraft.splice(destination, 0, moving);
        renderView();
    }

    async function actionManagementSaveFormat() {
        var record = managementTournamentForCurrentView();
        if (!record) return;
        var cards = $$("[data-stage-card]");
        var stages = cards.map(function (card) {
            var position = cards.indexOf(card);
            var current = record.stageDraft[position];
            var source = card.querySelector("[data-stage-source]").value;
            var qualification = Object.assign({}, current.qualification || {});
            var qualifierValue = card.querySelector("[data-stage-qualifiers]").value;
            delete qualification.qualifiersPerGroup;
            delete qualification.count;
            delete qualification.positions;
            delete qualification.matchIds;
            if (qualifierValue && source === "group_positions") {
                qualification.qualifiersPerGroup = Number(qualifierValue);
                var positionsValue = card.querySelector("[data-stage-positions]").value.trim();
                if (positionsValue) {
                    qualification.positions = positionsValue.split(",").map(function (value) {
                        return Number(value.trim());
                    });
                }
            } else if (qualifierValue && source === "overall_standings") {
                qualification.count = Number(qualifierValue);
            }
            return {
                id: current.id || "",
                name: card.querySelector("[data-stage-name]").value.trim(),
                type: card.querySelector("[data-stage-type]").value,
                participantSource: source,
                qualification: qualification,
                pairing: current.pairing || {},
                settings: current.settings || {},
                included: card.querySelector("[data-stage-included]").checked
            };
        });
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/format", {
                    method: "PUT", body: { stages: stages }
                });
            await refreshLiveAdminData();
            toast("Tournament format saved. Stage progression remains owner-controlled.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't save the tournament format.", "error");
        }
    }

    async function actionManagementApproveStage(_id, stageId, stageType) {
        var record = managementTournamentForCurrentView();
        var card = $$("[data-stage-card]").filter(function (item) {
            var button = item.querySelector('[data-action="tm-approve-stage"]');
            return button && button.getAttribute("data-stage-id") === stageId;
        })[0];
        if (!record || !card) return;
        var savedStage = record.stageDraft.filter(function (stage) { return stage.id === stageId; })[0];
        var source = card.querySelector("[data-stage-source]").value;
        var qualifierCount = Number(card.querySelector("[data-stage-qualifiers]").value);
        var positions = card.querySelector("[data-stage-positions]").value.trim();
        var savedQualification = savedStage && savedStage.qualification || {};
        var savedPositions = Array.isArray(savedQualification.positions)
            ? savedQualification.positions.join(", ") : "";
        var unsavedConfiguration = [];
        if (!savedStage) {
            unsavedConfiguration.push("saved stage");
        } else {
            if (card.querySelector("[data-stage-name]").value.trim() !== savedStage.name) {
                unsavedConfiguration.push("stage name");
            }
            if (card.querySelector("[data-stage-type]").value !== savedStage.type) {
                unsavedConfiguration.push("stage type");
            }
            if (source !== savedStage.participantSource) {
                unsavedConfiguration.push("participant source");
            }
            if (["group_positions", "overall_standings"].indexOf(source) !== -1 &&
                qualifierCount !== Number(
                    savedQualification.qualifiersPerGroup || savedQualification.count
                )) {
                unsavedConfiguration.push("qualifier count");
            }
            if (source === "group_positions" && positions !== savedPositions) {
                unsavedConfiguration.push("group finishing positions");
            }
        }
        if (!card.querySelector("[data-stage-included]").checked) {
            unsavedConfiguration.push("stage inclusion");
        }
        if (unsavedConfiguration.length) {
            toast("Save the unsaved " + unsavedConfiguration.join(", ") +
                ' with the "Save format" button at the bottom before approving participants.', "error");
            return;
        }
        var teamIds = $$("[data-stage-participant]", card).filter(function (input) {
            return input.checked;
        }).map(function (input) { return input.getAttribute("data-stage-participant"); });
        var pairings = [];
        if (["group", "league"].indexOf(stageType) === -1) {
            if (teamIds.length < 2) {
                toast("Select at least two qualified teams before assigning knockout pairings.", "error");
                return;
            }
            var pairMap = Object.create(null);
            var invalidPairing = false;
            $$("[data-stage-pair]", card).forEach(function (input) {
                var teamId = input.getAttribute("data-stage-pair");
                if (teamIds.indexOf(teamId) === -1) return;
                var value = input.value.trim();
                if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 128) {
                    invalidPairing = true;
                    return;
                }
                var pairNumber = String(Number(value));
                if (!pairMap[pairNumber]) pairMap[pairNumber] = [];
                pairMap[pairNumber].push(teamId);
            });
            if (invalidPairing) {
                toast("Assign a match number to every selected team. Use the same number for the two teams that should play each other.", "error");
                return;
            }
            pairings = Object.keys(pairMap).sort(function (a, b) {
                return Number(a) - Number(b);
            }).map(function (pairNumber) { return { teamIds: pairMap[pairNumber] }; });
            if (pairings.some(function (pairing) { return pairing.teamIds.length > 2; })) {
                toast("A match number can be assigned to no more than two selected teams.", "error");
                return;
            }
            if (!pairings.some(function (pairing) { return pairing.teamIds.length === 2; })) {
                toast("Pair at least two selected teams in the same match number.", "error");
                return;
            }
        }
        var reasonField = card.querySelector("[data-stage-reason]");
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/stages/" +
                encodeURIComponent(stageId) + "/approve", {
                    method: "POST",
                    body: {
                        teamIds: teamIds,
                        pairings: pairings,
                        reason: reasonField ? reasonField.value.trim() : "",
                        confirmOverride: Boolean(card.querySelector("[data-stage-override]") &&
                            card.querySelector("[data-stage-override]").checked)
                    }
                });
            await refreshLiveAdminData();
            state.fixtureStageId = stageId;
            state.fixtureGroup = "";
            state.fixtureRound = "";
            toast("Participants and pairings saved. The Fixtures menu will select this stage for fixture creation.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't approve the stage.", "error");
        }
    }

    async function actionManagementCompleteStage(_id, stageId) {
        var record = managementTournamentForCurrentView();
        if (!record) return;
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/stages/" +
                encodeURIComponent(stageId) + "/complete", { method: "POST", body: {} });
            await refreshLiveAdminData();
            toast("Stage marked complete. Choose the next stage explicitly.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't complete the stage.", "error");
        }
    }

    async function actionManagementResetStage(stageId) {
        var record = managementTournamentForCurrentView();
        if (!record) return;
        var stage = DEMO.tournamentStages.filter(function (item) {
            return item.id === stageId && item.tournamentId === record.tournamentId;
        })[0];
        if (!stage) {
            toast("The saved tournament stage could not be identified. Refresh and try again.", "error");
            return;
        }
        var tournament = byId(DEMO.tournaments, record.tournamentId);
        var confirmed = await confirmDialog({
            title: "Restart this stage and later stages?",
            subtitle: "This action cannot be undone.",
            tone: "error",
            confirmLabel: "Restart stages",
            message: (tournament ? tournament.name + ": " : "") +
                "Fixtures, results, match events, officials, participants, and approvals from " +
                stage.name + " onward will be permanently cleared. Active stages will return to Draft; skipped stages will remain skipped. " +
                "Any group or league standings from those stages will also be cleared. " +
                "Earlier stage results, stage definitions, group names, group allocations, teams, and registrations will be preserved."
        });
        if (!confirmed) return;
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/stages/" +
                encodeURIComponent(stageId) + "/reset", {
                    method: "POST", body: { confirmReset: true }
                });
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't restart this stage.", "error");
            return;
        }
        try {
            await refreshLiveAdminData();
        } catch (error) {
            toast(error && error.message
                ? "The stages were restarted, but the dashboard couldn't reload: " + error.message
                : "The stages were restarted, but the dashboard couldn't reload.", "error");
            return;
        }
        toast("This stage and all later stages were restarted. Earlier stage data was preserved.", "success");
    }

    async function actionManagementReset() {
        var record = managementTournamentForCurrentView();
        if (!record) {
            toast("Choose a tournament before resetting its progress.", "error");
            return;
        }
        var tournament = byId(DEMO.tournaments, record.tournamentId);
        var confirmed = await confirmDialog({
            title: "Reset tournament progress?",
            subtitle: "This action cannot be undone.",
            tone: "error",
            confirmLabel: "Delete fixtures and reset",
            message: (tournament ? tournament.name + ": " : "") +
                "Every fixture, score, and match event in this tournament will be permanently deleted, " +
                "including match officials and published, completed, and legacy fixtures. Stage definitions, approvals, " +
                "participants, groups, and group allocations will also be cleared. The tournament, " +
                "registered teams, registrations, and payment records will be preserved."
        });
        if (!confirmed) return;
        try {
            await window.AngutsaPlatform.request("/admin/tournaments/" +
                encodeURIComponent(record.tournamentId) + "/reset", {
                    method: "POST", body: { confirmReset: true }
                });
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't reset tournament progress.", "error");
            return;
        }
        try {
            await refreshLiveAdminData();
        } catch (error) {
            toast(error && error.message
                ? "Tournament progress was reset, but the dashboard couldn't reload: " + error.message
                : "Tournament progress was reset, but the dashboard couldn't reload.", "error");
            return;
        }
        toast("Tournament progress reset. Registrations and payment records were preserved.", "success");
    }

    function actionManagementAllocateTeams() {
        var record = managementTournamentForCurrentView();
        if (!record) {
            toast("Choose a tournament before allocating teams.", "error");
            return;
        }
        if (!record.groupsCreated) {
            toast("Save group names before allocating teams.", "error");
            return;
        }
        record.teamGroups = record.teamGroups || {};
        record.matches = Array.isArray(record.matches) ? record.matches : [];
        var teams = approvedManagementTeams(record.tournamentId);
        var allocation = {};
        $$(".tm-workspace [data-tm-assignment]").forEach(function (select) {
            if (select.value) allocation[select.getAttribute("data-tm-assignment")] = select.value;
        });
        var counts = Object.create(null);
        record.groupNames.forEach(function (name) { counts[name] = 0; });
        var teamIds = teams.map(function (team) { return team.id; });
        var assignmentsMatchTeams = Object.keys(allocation).every(function (teamId) {
            return teamIds.indexOf(teamId) !== -1;
        }) && teams.every(function (team) {
            return Object.prototype.hasOwnProperty.call(allocation, team.id);
        });
        teams.forEach(function (team) {
            var groupName = allocation[team.id];
            if (!groupName || !Object.prototype.hasOwnProperty.call(counts, groupName)) return;
            counts[groupName] += 1;
        });
        if (teams.length < record.groupNames.length || !assignmentsMatchTeams ||
            record.groupNames.some(function (name) { return counts[name] < 1; })) {
            toast("Allocate every approved team exactly once and assign at least one team to each group.", "error");
            return;
        }
        var changed = teams.some(function (team) {
            return record.teamGroups[team.id] !== allocation[team.id];
        });
        if (!changed) {
            toast("The approved teams are already allocated to these groups.", "info");
            return;
        }
        var invalidGroupMatch = record.matches.filter(function (match) {
            return match.stage === "group";
        }).filter(function (match) {
            return !allocation[match.homeId] || allocation[match.homeId] !== allocation[match.awayId];
        })[0];
        if (invalidGroupMatch) {
            toast("This reallocation would put teams from an existing group fixture in different groups. Keep that pairing together or revise its fixture before saving.", "error");
            return;
        }

        var downstreamMatches = record.matches.filter(function (match) {
            return match.stage !== "group";
        });

        async function saveAllocation() {
            try {
                await window.AngutsaPlatform.request("/admin/tournaments/" +
                    encodeURIComponent(record.tournamentId) + "/groups", {
                        method: "PUT",
                        body: {
                            groups: record.groupNames.map(function (name) {
                                return {
                                    name: name,
                                    teamIds: teams.filter(function (team) {
                                        return allocation[team.id] === name;
                                    }).map(function (team) { return team.id; })
                                };
                            })
                        }
                    });
            } catch (error) {
                toast(error && error.message ? error.message : "We couldn't save the team allocation. Please try again.", "error");
                return;
            }
            try {
                await refreshLiveAdminData();
            } catch (error) {
                toast(error && error.message ? error.message : "We couldn't load the updated allocation. Please try again.", "error");
                return;
            }
            toast("Approved teams reallocated. Existing fixtures and results were preserved.",
                "success");
        }

        if (downstreamMatches.length) {
            toast("Group allocation cannot be changed while downstream fixtures exist. Existing competition history is preserved.", "error");
            return;
        }

        saveAllocation();
    }

    function actionSaveManagementTieBreak(groupName) {
        var record = managementTournamentForCurrentView();
        var tie = managementGroupTie(record, groupName);
        if (!tie) {
            toast("There is no qualifying-place tie in " + groupName + " to resolve.", "info");
            return;
        }
        var order = {};
        var valid = true;
        $$(".tm-workspace [data-tm-tie-rank]").forEach(function (select) {
            if (select.getAttribute("data-tm-tie-rank") !== groupName) return;
            var teamId = select.getAttribute("data-team-id");
            var position = Number(select.value);
            if (!select.value || tie.positions.indexOf(position) === -1 ||
                Object.keys(order).some(function (key) { return order[key] === position; })) {
                valid = false;
            }
            order[teamId] = position;
        });
        if (!valid || Object.keys(order).length !== tie.rows.length) {
            toast("Assign every tied team a unique place before saving the tie resolution.", "error");
            return;
        }
        record.tieBreakOrders[groupName] = order;
        invalidateManagementAfter(record, "group");
        saveManagementAndRefresh(record, "Tie order saved. Qualification can now use the administrator's resolution.");
    }

    async function actionCreateManualFixture() {
        var record = managementRecord(state.managementTournament, true);
        var stageId = $("[data-fixture-stage]") ? $("[data-fixture-stage]").value : "";
        var stage = DEMO.tournamentStages.filter(function (item) {
            return item.id === stageId && item.tournamentId === record.tournamentId;
        })[0];
        if (!stage || ["approved", "published", "in_progress"].indexOf(stage.status) === -1) {
            toast("Approve the current stage in Tournament Management before creating fixtures.", "error");
            return;
        }
        var groupId = stage.type === "group" && $("[data-fixture-group]")
            ? $("[data-fixture-group]").value : "";
        var selectedGroup = record.groupNames.map(function (name) {
            return { id: record.groupIdsByName[name] || "", name: name };
        }).filter(function (group) { return group.id === groupId; })[0] || null;
        var round = $("[data-fixture-round]") ? $("[data-fixture-round]").value.trim() : "";
        var homeId = $("[data-fixture-home]") ? $("[data-fixture-home]").value : "";
        var awayId = $("[data-fixture-away]") ? $("[data-fixture-away]").value : "";
        if (stage.type !== "group" && stage.type !== "league") {
            var pairingIndex = Number(round);
            var pairing = stage.pairing && Array.isArray(stage.pairing.pairings)
                ? stage.pairing.pairings[pairingIndex] : null;
            if (!pairing || !Array.isArray(pairing.teamIds) || pairing.teamIds.length !== 2) {
                toast("Choose an approved fixture pairing for this stage.", "error");
                return;
            }
            homeId = pairing.teamIds[0];
            awayId = pairing.teamIds[1];
            round = fixtureStageLabel(stage) + " - Match " + (pairingIndex + 1);
        }
        var date = $("[data-fixture-start-date]") ? $("[data-fixture-start-date]").value : "";
        var time = $("[data-fixture-kickoff]") ? $("[data-fixture-kickoff]").value : "";
        var venue = $("[data-fixture-venue]") ? $("[data-fixture-venue]").value.trim() : "";
        if (!round || !homeId || !awayId || !date || !time || !venue || homeId === awayId) {
            toast("Choose the fixture pairing, date, kick-off time and venue.", "error");
            return;
        }
        if (stage.type === "group" && (!selectedGroup ||
            record.teamGroups[homeId] !== selectedGroup.name ||
            record.teamGroups[awayId] !== selectedGroup.name)) {
            toast("Both selected teams must belong to the selected group.", "error");
            return;
        }
        var stageParticipantIds = DEMO.tournamentStageParticipants.filter(function (participant) {
            return participant.stage_id === stage.id;
        }).map(function (participant) { return participant.team_id; });
        if (stageParticipantIds.indexOf(homeId) === -1 || stageParticipantIds.indexOf(awayId) === -1) {
            toast("Select approved teams that are eligible for this tournament stage.", "error");
            return;
        }
        var stageFixtures = DEMO.fixtures.filter(function (fixture) {
            return fixture.stageId === stage.id;
        });
        if (stageFixtures.some(function (fixture) {
            return (fixture.homeId === homeId && fixture.awayId === awayId) ||
                (fixture.homeId === awayId && fixture.awayId === homeId);
        })) {
            toast("That stage pairing already has a fixture.", "error");
            return;
        }
        var confirmed = await confirmDialog({
            title: "Create this fixture?",
            message: round + ": " + teamName(homeId) + " vs " + teamName(awayId) +
                ". This fixture will be added to the selected tournament stage.",
            confirmLabel: "Create fixture",
            tone: "info"
        });
        if (!confirmed) return;
        var tournament = byId(DEMO.tournaments, record.tournamentId);
        if (!tournament) {
            toast("The tournament for this fixture could not be identified.", "error");
            return;
        }
        var createButton = $('[data-action="fixtures-create-manual"]');
        if (createButton) createButton.disabled = true;
        toast("Saving fixture to the tournament database...", "info");
        try {
            var created = await window.AngutsaPlatform.request("/admin/fixtures", {
                method: "POST",
                body: {
                    tournamentId: record.tournamentId,
                    categoryId: tournament.categoryId,
                    stageId: stage.id,
                    stage: stage.type,
                    groupId: groupId,
                    group: selectedGroup ? selectedGroup.name : "",
                    round: round,
                    homeId: homeId,
                    awayId: awayId,
                    kickoff: date + "T" + time,
                    venue: venue,
                    status: "scheduled"
                }
            });
            if (!created || typeof created.id !== "string" || !created.id) {
                throw new Error("The service did not confirm that the fixture was saved.");
            }
            toast("Fixture saved to the tournament database.", "success");
            try {
                await refreshLiveAdminData();
            } catch (error) {
                toast("The fixture was saved, but the page could not reload: " +
                    (error && error.message ? error.message : "please refresh to see it."), "error");
            }
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't create the fixture. Please try again.", "error");
        } finally {
            if (createButton) createButton.disabled = false;
        }
    }

    function actionSkipThirdPlacePlayoff() {
        var record = managementTournamentForCurrentView();
        var eligibility = managementStageEligibility(record, "third-place-playoff");
        if (!eligibility.ready) {
            toast(eligibility.reason, "error");
            return;
        }
        var playoffMatches = managementStageMatches(record, "third-place-playoff");
        if (playoffMatches.some(function (match) { return match.confirmed; })) {
            toast("A confirmed third-place playoff result cannot be skipped.", "error");
            return;
        }
        confirmDialog({
            title: "Skip the third-place playoff?",
            message: "The playoff is optional. Any unplayed fixture will be removed, and no third-place team will be recorded.",
            confirmLabel: "Skip playoff",
            tone: "warning"
        }).then(function (confirmed) {
            if (!confirmed) return;
            record.matches = record.matches.filter(function (match) {
                return match.stage !== "third-place-playoff";
            });
            record.thirdPlacePlayoffSkipped = true;
            saveManagementAndRefresh(record, "Optional third-place playoff skipped.");
        });
    }

    function actionOpenTournamentConfiguration() {
        state.managementStage = "groups";
        setView("tournament-management");
    }

    function actionManagementConfirmChampion() {
        var record = managementTournamentForCurrentView();
        var finalMatch = managementStageMatches(record, "final")[0];
        if (!finalMatch || !finalMatch.confirmed || !finalMatch.winnerId) {
            toast("A confirmed final result with an unambiguous winner is required.", "error");
            return;
        }
        confirmDialog({
            title: "Confirm tournament champion?",
            message: teamName(finalMatch.winnerId) + " will be recorded as champion and the tournament marked completed.",
            confirmLabel: "Confirm Champion",
            tone: "warning"
        }).then(function (confirmed) {
            if (!confirmed) return;
            record.championTeamId = finalMatch.winnerId;
            record.runnerUpTeamId = finalMatch.winnerId === finalMatch.homeId
                ? finalMatch.awayId : finalMatch.homeId;
            record.championConfirmed = true;
            record.championConfirmedOn = eatToday();
            saveManagementAndRefresh(record, "Champion confirmed. Tournament summary and status have been updated.");
        });
    }

    function uiActionPermissionKey(action, moduleKey) {
        if (action === "edit-player-public-profile" || action === "save-player-public-profile") {
            return "players.edit";
        }
        if (["create", "edit", "delete"].indexOf(action) !== -1) {
            return modulePermissionKey(moduleKey, action);
        }
        if (action === "approve") return moduleKey === "payments" ? "payments.review" : "registrations.approve";
        if (action === "reject") return moduleKey === "payments" ? "payments.review" : "registrations.reject";
        if (action === "request-correction") return "registrations.edit";
        if (action === "publish-result" || action === "confirm-scheduled-result") return "results.publish";
        if (action === "unpublish-result") return "results.correct";
        if (action === "save-scheduled-result" || action === "save-live-match") return "results.edit";
        if (action === "live-clock-control") return "results.edit";
        if (action === "finish-live-match") return "results.publish";
        if (action === "confirm-payment") return "payments.review";
        if (action === "refresh-rule-acknowledgments") return "rules.view";
        if (action === "send-rule-reminders") return "rules.edit";
        if (action === "set-player-roster-change-permission") return "registrations.edit";
        if (action === "toggle-featured") return "tournaments.edit";
        if (action === "start-match" || action === "postpone-match") return "fixtures.edit";
        if (action === "print-match-lineups") return "fixtures.view";
        if (action === "publish" || action === "unpublish") {
            return moduleKey === "rules" ? "rules.edit" : moduleKey + ".edit";
        }
        if (action === "archive") {
            if (moduleKey === "teams") return "teams.archive";
            return moduleKey === "categories" || moduleKey === "tournaments"
                ? moduleKey + ".archive"
                : moduleKey === "rules" ? "rules.delete" : "";
        }
        if (["activate-user", "deactivate-user", "team-manager-access",
            "delete-team-manager"].indexOf(action) !== -1) return "users.manage";
        if (action === "create-admin-team") return "teams.create";
        if (["export-view", "export-finance", "export-reports", "export-standings",
            "export-players-pdf"]
            .indexOf(action) !== -1) return "reports.export";
        if (action === "export-team-managers-pdf" || action === "export-roles") {
            return "users.manage";
        }
        return "";
    }

    function handleAction(action, dataset) {
        var moduleKey = dataset.module || "";
        var id = dataset.id || "";
        var permissionKey = uiActionPermissionKey(action, moduleKey);
        if (permissionKey && !hasAdminPermission(permissionKey)) {
            toast("You do not have permission to perform that action.", "error");
            return;
        }

        switch (action) {
        /* Navigation and record basics */
        case "goto":
            closeMenus();
            setView(moduleKey);
            break;
        case "open-admin-notification":
            closeMenus();
            (async function () {
                var notification = DEMO.notifications.filter(function (item) {
                    return item.id === id;
                })[0];
                if (notification && !notification.read) {
                    try {
                        await window.AngutsaPlatform.request("/notifications/" +
                            encodeURIComponent(id) + "/read", { method: "POST" });
                        notification.read = true;
                    } catch (error) {
                        toast(error && error.message
                            ? error.message
                            : "Notification could not be marked as read.", "error");
                        return;
                    }
                    renderNavCounts();
                    renderNotificationMenu();
                }
                setView(moduleKey);
            }());
            break;
        case "create":
            openRecordForm(moduleKey);
            break;
        case "create-admin-team":
            openAdminTeamForm();
            break;
        case "manage-admin-permissions":
            openAdminPermissionEditor(id);
            break;
        case "cancel-permission-edit":
            cancelPermissionEditing();
            break;
        case "save-permissions":
            saveAdminPermissions();
            break;
        case "bulk-permission":
            applyBulkPermission(dataset.permissionMenu, dataset.permissionState);
            break;
        case "edit":
            openRecordForm(moduleKey, id);
            break;
        case "details":
        case "preview":
        case "receipt":
            openDetails(moduleKey, id);
            break;
        case "download-receipt":
            downloadPaymentReceipt(id);
            break;
        case "edit-player-public-profile":
            openAdminPlayerProfileModal(id);
            break;
        case "save-player-public-profile":
            saveAdminPlayerPublicProfile(id);
            break;
        case "delete":
            deleteRecord(moduleKey, id, recordLabel(moduleKey, id));
            break;

        /* Approval workflows */
        case "approve":
            actionApprove(moduleKey, id);
            break;
        case "reject":
            if (moduleKey === "players" || moduleKey === "player-registrations") {
                toast("Players are not approved or rejected individually; review the team registration instead.", "info");
                break;
            }
            if (moduleKey === "payments") {
                actionReviewPayment(id, "rejected");
                break;
            }
            if (moduleKey === "teams") {
                var teamToReject = byId(DEMO.teams, id);
                if (!teamToReject || !teamToReject.registrationId) {
                    toast("The registration for this team could not be identified.", "error");
                    break;
                }
                workflowAction("team-registrations", teamToReject.registrationId, "Rejected",
                    "Registration rejected by an administrator.", "Review");
                break;
            }
            workflowAction(moduleKey, id, "Rejected",
                "Marked as rejected. Nothing was sent to the applicant.", "Review");
            break;
        case "request-correction":
            if (moduleKey === "players" || moduleKey === "player-registrations") {
                toast("Player records do not have a separate approval or correction workflow.", "info");
                break;
            }
            actionRequestCorrection(moduleKey, id);
            break;

        /* Publishing */
        case "publish":
            actionPublish(moduleKey, id);
            break;
        case "toggle-featured":
            actionToggleFeatured(id);
            break;
        case "unpublish":
            if (moduleKey === "tournaments") {
                var tournament = byId(DEMO.tournaments, id);
                if (tournament) updateTournament(tournament, { status: "draft" }, "Tournament returned to draft.");
                else toast("That tournament could not be found.", "error");
                break;
            }
            if (moduleKey === "rules") {
                var rule = byId(DEMO.rules, id);
                if (rule) updateRuleStatus(rule, "draft", "Rules returned to draft.");
                else toast("Those rules could not be found.", "error");
                break;
            }
            toast("Unpublishing this record is not connected to the live backend yet.", "info");
            break;
        case "archive":
            if (moduleKey === "teams") {
                archiveTeam(id);
                break;
            }
            if (["categories", "tournaments", "rules"].indexOf(moduleKey) !== -1) {
                deleteRecord(moduleKey, id, recordLabel(moduleKey, id));
                break;
            }
            toast("Archiving this record is not connected to the live backend yet.", "info");
            break;
        case "publish-result":
            actionPublishResult(id);
            break;
        case "unpublish-result":
            actionSetResultPublication(id, "draft");
            break;
        case "manage-result":
            actionOpenManagedResult(id);
            break;
        case "edit-result":
            actionEditResult(id);
            break;
        case "save-result-edit":
            actionSaveResultEdit(id);
            break;
        case "save-scheduled-result":
            actionSaveScheduledResult(id, false);
            break;
        case "confirm-scheduled-result":
            actionSaveScheduledResult(id, true);
            break;
        case "save-live-match":
            actionSaveLiveMatch(id);
            break;
        case "live-clock-control":
            actionLiveClockControl(id, dataset.clockAction);
            break;
        case "finish-live-match":
            actionFinishLiveMatch(id);
            break;

        /* Payments */
        case "confirm-payment":
            actionConfirmPayment(id);
            break;
        case "set-player-roster-change-permission":
            actionSetPlayerRosterChangePermission(id, dataset.enabled === "true");
            break;

        /* Match lifecycle */
        case "start-match":
            updateLiveMatchStatus(id, "live", "Match marked as live.");
            break;
        case "pause-match":
            toast("Pause is not an official fixture status. Postpone the fixture if play cannot continue.", "info");
            break;
        case "complete-match":
            toast("Record and confirm the final score to complete this match.", "info");
            break;
        case "postpone-match":
            updateLiveMatchStatus(id, "postponed", "Match postponed.");
            break;

        /* Admin users */
        case "activate-user":
            updateLiveUserStatus(id, "active", "Account access enabled.");
            break;
        case "deactivate-user":
            updateLiveUserStatus(id, "disabled", "Account access blocked.");
            break;

        default:
            handleActionSecondary(action, dataset);
        }
    }

    function handleActionSecondary(action, dataset) {
        var id = dataset.id || "";

        switch (action) {
        case "mark-all-read":
            actionMarkAllRead();
            break;
        case "team-manager-access":
            actionToggleTeamManagerAccess(dataset.managerKey || "");
            break;
        case "delete-team-manager":
            actionPermanentlyDeleteTeamManager(dataset.managerKey || "");
            break;
        case "export-team-managers-pdf":
            exportTeamManagersPdf();
            break;
        case "print-match-lineups":
            printMatchLineupSheet(id);
            break;
        case "clear-filters":
            actionClearFilters();
            break;
        case "export-view":
            exportCurrentView(state.view);
            break;
        case "export-players-pdf":
            exportPlayersPdf();
            break;
        case "export-standings":
            actionExportStandings();
            break;
        case "export-finance":
            actionExportFinance();
            break;
        case "export-reports":
            actionExportReports();
            break;
        case "export-roles":
            actionExportRoles();
            break;
        case "refresh-standings":
            renderView();
            toast("Standings recalculated from published backend results.", "info");
            break;
        case "rules-format":
            actionFormatRules(dataset.id);
            break;
        case "preview-rules":
            actionPreviewRules();
            break;
        case "save-rules":
            actionSaveRules(false);
            break;
        case "publish-rules":
            actionSaveRules(true);
            break;
        case "refresh-rule-acknowledgments":
            var selectedPublishedRules = publishedRulesFor(state.rulesCategory);
            if (selectedPublishedRules.length) {
                loadRuleAcknowledgments(selectedPublishedRules[0].id);
            }
            break;
        case "send-rule-reminders":
            var publishedRuleForReminder = publishedRulesFor(state.rulesCategory)[0] || null;
            if (!publishedRuleForReminder) {
                toast("Publish the rules before sending acknowledgment reminders.", "info");
                break;
            }
            confirmDialog({
                title: "Remind managers to acknowledge?",
                message: "A reminder will be sent to every active team manager who has not acknowledged these published rules.",
                confirmLabel: "Send reminders"
            }).then(function (confirmed) {
                if (confirmed) sendRuleAcknowledgmentReminders(publishedRuleForReminder.id);
            });
            break;
        case "save-settings":
            actionSaveSettings();
            break;
        case "save-email-sender":
            actionSaveEmailSender();
            break;
        case "reset-prefs":
            actionResetPrefs();
            break;
        case "tm-add-group":
            actionManagementAddGroup();
            break;
        case "tm-remove-group":
            actionManagementRemoveGroup(Number(dataset.index));
            break;
        case "tm-add-stage":
            actionManagementAddStage();
            break;
        case "tm-move-stage":
            actionManagementMoveStage(Number(dataset.index), Number(dataset.direction));
            break;
        case "tm-save-format":
            actionManagementSaveFormat();
            break;
        case "tm-approve-stage":
            actionManagementApproveStage(id, dataset.stageId, dataset.stageType || "");
            break;
        case "tm-complete-stage":
            actionManagementCompleteStage(id, dataset.stageId || "");
            break;
        case "tm-reset-stage":
            actionManagementResetStage(dataset.stageId || "");
            break;
        case "tm-reset-tournament":
            actionManagementReset();
            break;
        case "tm-stage":
            if (["groups", "quarter-finals", "semi-finals", "third-place-playoff", "final", "champion"].indexOf(dataset.stage) !== -1) {
                state.managementStage = dataset.stage;
                renderView();
            }
            break;
        case "tm-create-groups":
            actionManagementCreateGroups();
            break;
        case "tm-allocate-teams":
            actionManagementAllocateTeams();
            break;
        case "fixtures-create-manual":
            actionCreateManualFixture().catch(function (error) {
                toast(error && error.message ? error.message : "We couldn't create the fixture. Please try again.", "error");
            });
            break;
        case "tm-open-configuration":
            actionOpenTournamentConfiguration();
            break;
        case "tm-open-fixture-creation":
            state.fixtureStageId = "";
            state.fixtureRound = "";
            state.fixtureGroup = "";
            setView("fixtures");
            break;
        case "tm-skip-third-place-playoff":
            actionSkipThirdPlacePlayoff();
            break;
        case "tm-save-match":
            actionSaveManagementMatch(id, dataset.tournamentId || "");
            break;
        case "tm-confirm-result":
            actionConfirmManagementResult(id, dataset.tournamentId || "");
            break;
        case "tm-save-tiebreak":
            actionSaveManagementTieBreak(id);
            break;
        case "tm-confirm-champion":
            actionManagementConfirmChampion();
            break;
        case "sign-out":
            actionSignOut();
            break;
        case "close-modal":
            closeModal();
            break;
        default:
            toast("This action is not connected to the backend. Nothing was changed.", "error");
        }
    }

    /* -------------------------
       Action implementations
       ------------------------- */

    function actionApprove(moduleKey, id) {
        if (moduleKey === "payments") {
            actionConfirmPayment(id);
            return;
        }
        if (moduleKey === "players" || moduleKey === "player-registrations") {
            toast("Players are recorded on the team roster; only team registrations are approved.", "info");
            return;
        }

        var approvalRecord = null;
        if (moduleKey === "teams") {
            approvalRecord = byId(DEMO.teams, id);
            if (approvalRecord && normalise(approvalRecord.registrationStatus) === "approved") {
                approvalRecord = null;
            }
        } else if (moduleKey === "team-registrations") {
            approvalRecord = byId(DEMO.teamRegistrations, id);
            if (approvalRecord && normalise(approvalRecord.status) === "approved") {
                approvalRecord = null;
            }
        }

        if (approvalRecord) {
            var account = feeAccountFor(approvalRecord.teamId || approvalRecord.id,
                approvalRecord.tournamentId);
            if (account.paid < account.fee) {
                confirmDialog({
                    title: "Approve with a balance due?",
                    message: "The registration has an outstanding balance of " +
                        formatMoney(account.balance) + ". Approving will activate a pending manager account and open player registration.",
                    details: "Approval will allow the manager to sign in and register players. The outstanding balance remains due and should be cleared as soon as possible.",
                    confirmLabel: "Approve with balance due",
                    cancelLabel: "Keep pending"
                }).then(function (confirmed) {
                    if (confirmed) completeApproval();
                });
                return;
            }
        }

        completeApproval();

        function completeApproval() {
            if (moduleKey === "teams") {
                var team = byId(DEMO.teams, id);
                if (!team || !team.registrationId) {
                    toast("The registration for this team could not be identified.", "error");
                    return;
                }
                workflowAction("team-registrations", team.registrationId, "Approved",
                    "Registration approved by an administrator.", "Approval");
                return;
            }
            workflowAction(moduleKey, id, "Approved", "Registration approved by an administrator.", "Approval");
        }
    }

    function actionPublish(moduleKey, id) {
        if (moduleKey === "tournaments") {
            var tournament = byId(DEMO.tournaments, id);
            if (!tournament) {
                toast("That tournament could not be found.", "error");
                return;
            }
            if (moduleKey === "rules") {
                var rule = byId(DEMO.rules, id);
                if (!rule) {
                    toast("Those rules could not be found.", "error");
                    return;
                }
                updateRuleStatus(rule, "published", "Rules published.");
                return;
            }
            var currentStatus = normalise(tournament.status);
            var nextStatus = currentStatus === "archived" || currentStatus === "draft"
                ? "upcoming" : "archived";
            updateTournament(tournament, { status: nextStatus },
                nextStatus === "archived" ? "Tournament archived." : "Tournament published.");
            return;
        }

        if (moduleKey === "announcements") {
            toast("Announcement publishing is not connected to the live backend yet.", "info");
            return;
        }

        if (moduleKey === "media") {
            toast("Media publishing is not connected to the live backend yet.", "info");
            return;
        }

        toast("Publishing this content is not connected to the live backend yet.", "info");
    }

    function actionToggleFeatured(id) {
        var tournament = byId(DEMO.tournaments, id);
        if (!tournament) {
            toast("That tournament is no longer available. Refresh and try again.", "error");
            return;
        }

        var featured = !Boolean(tournament.featured);
        updateTournament(tournament, { featured: featured },
            featured ? "Tournament featured on the homepage." : "Tournament hidden from the homepage.");
    }

    function actionPublishResult(id) {
        var result = byId(DEMO.results, id);
        if (!result) {
            toast("That result could not be found.", "error");
            return;
        }

        if (result.homeScore === null || result.awayScore === null) {
            toast("Enter both scores before publishing this result.", "error");
            return;
        }

        confirmDialog({
            title: "Publish this result?",
            subtitle: "Official results would appear on the public website",
            confirmLabel: "Publish result",
            tone: "warning",
            message: result.homeScore + " - " + result.awayScore + " between " +
                teamName(result.homeId) + " and " + teamName(result.awayId) +
                ". The confirmed score will appear publicly and update standings."
        }).then(function (confirmed) {
            if (!confirmed) return;
            actionSetResultPublication(id, "published");
        });
    }

    async function actionSetResultPublication(id, publicationState) {
        var result = byId(DEMO.results, id);
        if (!result || !result.fixtureId) {
            toast("The fixture for this result could not be identified.", "error");
            return;
        }
        var correctionReason = "";
        if (result.state === "published") {
            correctionReason = window.prompt(
                "Explain why this published result is being changed."
            );
            if (!correctionReason || !correctionReason.trim()) {
                toast("A correction reason is required.", "error");
                return;
            }
            correctionReason = correctionReason.trim();
        }
        try {
            await window.AngutsaPlatform.request("/admin/matches/" +
                encodeURIComponent(result.fixtureId) + "/result", {
                    method: "PUT",
                    body: {
                        homeScore: result.homeScore,
                        awayScore: result.awayScore,
                        tieBreakMethod: result.tieBreakMethod || "",
                        homeExtraTimeScore: result.homeExtraTimeScore,
                        awayExtraTimeScore: result.awayExtraTimeScore,
                        homePenaltiesScore: result.homePenaltiesScore,
                        awayPenaltiesScore: result.awayPenaltiesScore,
                        state: publicationState,
                        notes: result.notes || "",
                        correctionReason: correctionReason,
                        homeScorers: result.homeScorers || [],
                        awayScorers: result.awayScorers || []
                    }
                });
            await refreshLiveAdminData();
            toast(publicationState === "published"
                ? "Result published and standings updated."
                : "Result returned to draft.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't update the published result. Please try again.", "error");
        }
    }

    function actionConfirmPayment(id) {
        actionReviewPayment(id, "confirmed");
    }

    function actionReviewPayment(id, status) {
        var confirming = status === "confirmed";
        var reviewResult = null;
        confirmDialog({
            title: confirming ? "Confirm this payment?" : "Reject this payment?",
            subtitle: "Review the payment evidence before deciding",
            confirmLabel: confirming ? "Confirm payment" : "Reject payment",
            message: confirming
                ? "Confirm only after you have verified that the payment was received."
                : "Reject this payment if the submitted payment evidence is invalid or the money was not received."
        }).then(function (confirmed) {
            if (!confirmed) return;
            window.AngutsaPlatform.request("/admin/payments/" +
                encodeURIComponent(id) + "/review", {
                    method: "POST",
                    body: { status: status }
                }).then(function (result) {
                    reviewResult = result;
                    return refreshLiveAdminData();
                }).then(function () {
                    var message = confirming ? "Payment confirmation recorded." : "Payment rejected.";
                    if (confirming && reviewResult && reviewResult.registrationApproved) {
                        message += " The team registration is approved and player registration is open.";
                    }
                    toast(message, "success");
                }).catch(function (error) {
                    toast(error && error.message ? error.message : "We couldn't save the payment review. Please try again.", "error");
                });
        });
    }

    function requestRosterChangeDuration(teamName) {
        return new Promise(function (resolve) {
            var settled = false;
            function finish(value) {
                if (settled) return;
                settled = true;
                closeModal();
                resolve(value);
            }

            var root = openModal({
                title: "Permit roster changes",
                subtitle: "Choose how long access should last for " + teamName + ".",
                size: "is-narrow",
                body: '<form id="rosterChangeDurationForm" novalidate>' +
                    '<div class="form-field" id="rosterChangeHoursField">' +
                    '<label class="form-label" for="rosterChangeHours">How many hours should roster changes be allowed?</label>' +
                    '<input class="form-input" id="rosterChangeHours" name="hours" type="number" ' +
                    'inputmode="numeric" min="1" max="720" step="1" value="24" required data-autofocus>' +
                    '<span class="form-label-note">Enter a whole number from 1 to 720. Access closes automatically at expiry.</span>' +
                    '<span class="field-error" aria-live="polite"></span></div></form>',
                footer: '<button type="button" class="btn btn-outline" data-duration-cancel>Cancel</button>' +
                    '<button type="submit" class="btn btn-primary" form="rosterChangeDurationForm">Continue</button>',
                onMount: function (dialogRoot) {
                    var form = $("#rosterChangeDurationForm", dialogRoot);
                    var input = $("#rosterChangeHours", dialogRoot);
                    var field = $("#rosterChangeHoursField", dialogRoot);
                    var error = $(".field-error", field);

                    on(form, "submit", function (event) {
                        event.preventDefault();
                        var value = input.value.trim();
                        var hours = Number(value);
                        if (!/^\d+$/.test(value) || !Number.isSafeInteger(hours) ||
                            hours < 1 || hours > 720) {
                            field.classList.add("has-error");
                            error.textContent = "Enter a whole number from 1 to 720.";
                            input.focus();
                            return;
                        }
                        finish(hours);
                    });
                    on(input, "input", function () {
                        field.classList.remove("has-error");
                        error.textContent = "";
                    });
                    on($("[data-duration-cancel]", dialogRoot), "click", function () {
                        finish(null);
                    });
                    on($(".modal-close", dialogRoot), "click", function (event) {
                        event.stopPropagation();
                        finish(null);
                    });
                    on(dialogRoot, "mousedown", function (event) {
                        if (event.target === dialogRoot) finish(null);
                    });
                    on(dialogRoot, "keydown", function (event) {
                        if (event.key === "Escape") {
                            event.stopPropagation();
                            finish(null);
                        }
                    });
                }
            });
            if (!root) {
                settled = true;
                resolve(null);
            }
        });
    }

    function confirmSetPlayerRosterChangePermission(id, team, enabled, durationHours) {
        var expiresAtLabel = "";
        if (enabled) {
            expiresAtLabel = new Date(Date.now() + durationHours * 60 * 60 * 1000)
                .toLocaleString("en-KE", {
                    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit"
                }) + " EAT";
        }
        confirmDialog({
            title: enabled ? "Permit roster changes after tournament start?"
                : "Revoke roster-change permission?",
            confirmLabel: enabled ? "Grant for " + durationHours + " hours" : "Revoke permission",
            tone: "warning",
            message: enabled
                ? "The manager for " + team.name +
                    " will be able to add, edit and remove players on this team's roster for " +
                    durationHours + " hours. It will expire automatically at " + expiresAtLabel + "."
                : "The manager for " + team.name +
                    " will be blocked from adding, editing or removing players once the tournament " +
                    "has started. Changes already made are not reverted."
        }).then(function (confirmed) {
            if (!confirmed) return;
            if (!team.registrationId) {
                toast("The team registration could not be identified.", "error");
                return;
            }
            window.AngutsaPlatform.request("/admin/team-registrations/" +
                encodeURIComponent(team.registrationId) + "/permissions", {
                    method: "PUT",
                    body: {
                        earlyPlayerRegistration: team.earlyPlayerRegistration,
                        rosterChangesAfterStart: enabled,
                        rosterChangesHours: durationHours
                    }
                }).then(function (result) {
                    return requestAdminBootstrap(window.AngutsaPlatform).then(function (latest) {
                        return { result: result, latest: latest };
                    });
                }).then(function (response) {
                    var latest = response.latest;
                    applyAdminBootstrap(latest, state.admin);
                    openDetails("teams", id);
                    if (!enabled) {
                        toast("Roster-change permission revoked.", "success");
                        return;
                    }
                    if (response.result.emailStatus === "accepted_by_provider") {
                        toast("Roster-change permission granted. The manager notification was accepted by the email provider.", "success");
                    } else {
                        toast("Roster-change permission granted, but the manager email was not accepted (" +
                            (response.result.emailStatus || "unknown status") + "). Please notify the manager directly.", "warning");
                    }
                }).catch(function (error) {
                    toast(error && error.message ? error.message : "We couldn't save that permission. Please try again.", "error");
                });
        });
    }

    function actionSetPlayerRosterChangePermission(id, enabled) {
        var team = byId(DEMO.teams, id);
        if (!team) {
            toast("That team is no longer available.", "error");
            return;
        }
        if (enabled && normalise(team.registrationStatus) !== "approved") {
            toast("Approve the team before granting roster-change permission.", "error");
            return;
        }
        if (!enabled) {
            confirmSetPlayerRosterChangePermission(id, team, false, null);
            return;
        }
        requestRosterChangeDuration(team.name).then(function (durationHours) {
            if (durationHours === null) return;
            confirmSetPlayerRosterChangePermission(id, team, true, durationHours);
        });
    }

    function actionMarkAllRead() {
        var unread = DEMO.notifications.filter(function (note) { return !note.read; });
        if (!unread.length) {
            toast("Nothing to mark as read.", "info");
            return;
        }
        (async function () {
            for (var i = 0; i < unread.length; i += 1) {
                try {
                    await window.AngutsaPlatform.request("/notifications/" +
                        encodeURIComponent(unread[i].id) + "/read", { method: "POST" });
                    unread[i].read = true;
                } catch (error) {
                    renderNavCounts();
                    renderNotificationMenu();
                    toast(error && error.message
                        ? "Some notifications could not be updated: " + error.message
                        : "Some notifications could not be updated.", "error");
                    return;
                }
            }
            renderNavCounts();
            renderNotificationMenu();
            toast("All notifications marked as read.", "success");
        }());
    }

    /* -------------------------
       Filters and exports
       ------------------------- */

    function actionClearFilters() {
        resetListState(state.view);
        var search = $("[data-filter-search]");
        if (search) search.value = "";
        $$("[data-filter]").forEach(function (select) { select.value = ""; });
        renderView();
        toast("Search text and filters were reset.", "info");
    }

    function actionExportStandings() {
        var rows = computeStandings(state.standingsTournament, state.standingsCategory);
        if (!rows.length) {
            toast("There are no standings rows to export yet.", "info");
            return;
        }

        exportCsv("angutsa-standings.csv", [
            { value: function (r) { return r.position; }, label: "Position" },
            { value: function (r) { return teamName(r.teamId); }, label: "Team" },
            { key: "played", label: "Played" },
            { key: "won", label: "Won" },
            { key: "drawn", label: "Drawn" },
            { key: "lost", label: "Lost" },
            { key: "goalsFor", label: "Goals for" },
            { key: "goalsAgainst", label: "Goals against" },
            { key: "goalDifference", label: "Goal difference" },
            { key: "points", label: "Points" }
        ], rows);
    }

    function actionExportFinance() {
        var rows = paymentsForTournament(state.financeTournament).filter(function (payment) {
            return withinDateRange(payment.paidOn);
        });

        exportCsv("angutsa-financial-report.csv", [
            { key: "reference", label: "Payment reference" },
            { value: function (r) { return teamName(r.teamId); }, label: "Team" },
            { value: function (r) { return tournamentName(r.tournamentId); }, label: "Tournament" },
            { key: "amount", label: "Amount" },
            { key: "currency", label: "Currency" },
            { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).fee; },
                label: "Registration fee" },
            { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).paid; },
                label: "Fee cleared" },
            { value: function (r) { return feeAccountFor(r.teamId, r.tournamentId).balance; },
                label: "Fee balance" },
            { value: function (r) {
                return FEE_STATUS_LABEL[feeAccountFor(r.teamId, r.tournamentId).status];
            }, label: "Fee status" },
            { key: "method", label: "Method" },
            { key: "paidOn", label: "Date" },
            { key: "status", label: "Status" }
        ], rows);
    }

    function actionExportReports() {
        var rows = [
            { metric: "Teams", value: DEMO.teams.length },
            { metric: "Players", value: DEMO.players.length },
            { metric: "Fixtures", value: DEMO.fixtures.length },
            { metric: "Completed fixtures", value: countWhere(DEMO.fixtures, "status", "completed") },
            { metric: "Team registrations", value: DEMO.teamRegistrations.length },
            { metric: "Player registrations", value: DEMO.playerRegistrations.length },
            { metric: "Payments recorded", value: DEMO.payments.length },
            { metric: "Payment value", value: sum(DEMO.payments, "amount") + " " + currencyCode() }
        ];

        exportCsv("angutsa-analytics-summary.csv", [
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value" }
        ], rows);
    }

    function actionExportRoles() {
        var rows = DEMO.roles.map(function (role) {
            return { role: role.name, description: role.description };
        });

        exportCsv("angutsa-roles.csv", [
            { key: "role", label: "Role" },
            { key: "description", label: "Description" }
        ], rows);
    }

    /* -------------------------
       Competition rules
       ------------------------- */

    function currentRulesDoc() {
        return rulesFor(state.rulesCategory)[0] || null;
    }

    /* Applies a formatting button to the selected text in the rules editor. */
    function actionFormatRules(format) {
        var field = $("#rulesBody");
        if (!field) return;
        var start = field.selectionStart;
        var end = field.selectionEnd;
        var value = field.value;

        if (format === "bold" || format === "italic") {
            var mark = format === "bold" ? "**" : "*";
            var selected = value.slice(start, end) || (format === "bold" ? "bold text" : "italic text");
            field.value = value.slice(0, start) + mark + selected + mark + value.slice(end);
            field.setSelectionRange(start + mark.length, start + mark.length + selected.length);
        } else {
            var lineStart = value.lastIndexOf("\n", start - 1) + 1;
            var lineEndIndex = value.indexOf("\n", end);
            if (lineEndIndex === -1) lineEndIndex = value.length;
            var lines = value.slice(lineStart, lineEndIndex).split("\n");
            var number = 0;
            var formatted = lines.map(function (line) {
                var clean = line.replace(/^(#{1,3}\s+|[-*\u2022]\s+|\d+[.)]\s+)/, "");
                if (format === "heading") return "## " + clean;
                if (format === "bullet") return "- " + clean;
                number += 1;
                return number + ". " + clean;
            }).join("\n");
            field.value = value.slice(0, lineStart) + formatted + value.slice(lineEndIndex);
            field.setSelectionRange(lineStart, lineStart + formatted.length);
        }
        field.focus();
    }

    function actionPreviewRules() {
        var form = $("#rulesForm");
        var doc = currentRulesDoc();
        var title = form ? form.title.value.trim() : (doc ? doc.title : "");
        var body = form ? form.body.value.trim() : (doc ? doc.body : "");

        if (!title && !body) {
            toast("Write or select a rules document before previewing it.", "info");
            return;
        }

        openModal({
            title: "Rules preview",
            subtitle: "Rendered as the public page would show it",
            size: "is-wide",
            body: '<div class="preview-panel"><h3>' + esc(title || "Untitled document") + "</h3>" +
                '<p class="small muted">' + esc(categoryName(state.rulesCategory)) + " \u00b7 " +
                esc(doc && doc.state === "published" ? "Published" : "Draft") + "</p>" +
                '<div class="preview-body rich-text">' + window.AngutsaRulesFormat.render(body) + "</div></div>",
            footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Close</button>'
        });
    }

    async function actionSaveRules(publish) {
        var form = $("#rulesForm");
        var doc = currentRulesDoc();

        if (!form && !doc) {
            toast("Create a rules document first.", "info");
            return;
        }

        var title = form ? form.title.value.trim() : doc.title;
        var body = form ? form.body.value.trim() : doc.body;

        if (!title || !body) {
            toast(title ? "The rules text cannot be empty." : "A document title is required.", "error");
            return;
        }

        try {
            await window.AngutsaPlatform.request("/admin/rules" +
                (doc ? "/" + encodeURIComponent(doc.id) : ""), {
                    method: doc ? "PUT" : "POST",
                    body: {
                        categoryId: doc ? doc.categoryId : state.rulesCategory,
                        title: title,
                        body: body,
                        status: publish ? "published" : "draft"
                    }
                });
            await refreshLiveAdminData();
            toast(publish ? "Rules published." : "Rules draft saved.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't save the rules. Please try again.", "error");
        }
    }

    /* -------------------------
       Settings and roles
       ------------------------- */

    function actionSaveSettings() {
        var errors = [];
        var payload = {};

        $$("[data-pref]").forEach(function (control) {
            var key = control.getAttribute("data-pref");

            if (control.type === "checkbox") {
                payload[key] = control.checked;
                return;
            }

            var value = String(control.value || "").trim();

            if (control.type === "number") {
                var num = Number(value);
                if (isNaN(num) || num < 5 || num > 50) {
                    errors.push("Records per page must be between 5 and 50.");
                    return;
                }
                payload[key] = num;
                return;
            }

            if (control.type === "email" && value &&
                !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
                errors.push("One of the email addresses is not valid.");
                return;
            }

            if (key === "adminName" && !value) {
                errors.push("The administrator display name cannot be empty.");
                return;
            }

            if ((key === "championshipName" || key === "season") && !value) {
                errors.push("The championship name and season are required.");
                return;
            }

            payload[key] = value;
        });

        if (errors.length) {
            toast(errors[0], "error");
            return;
        }

        Object.keys(payload).forEach(function (key) {
            state.prefs[key] = payload[key];
        });

        writePrefs();
        applyPrefs();
        renderView();
        toast("Settings saved in this browser. No server was contacted.", "success");
    }

    async function actionSaveEmailSender() {
        var email = $("#brevoSenderEmail");
        var name = $("#brevoSenderName");
        if (!email || !name || !email.value.trim() || !name.value.trim()) {
            toast("Enter both a verified sender email and sender name.", "error");
            return;
        }
        try {
            var result = await window.AngutsaPlatform.request("/admin/settings/email-sender", {
                method: "PUT",
                body: { email: email.value.trim(), name: name.value.trim() }
            });
            state.emailSender = {
                brevoSenderEmail: result.email,
                brevoSenderName: result.name
            };
            renderView();
            toast("Brevo sender identity saved to the database.", "success");
        } catch (error) {
            toast(error && error.message ? error.message : "We couldn't save the sender details. Please try again.", "error");
        }
    }

    function actionResetPrefs() {
        confirmDialog({
            title: "Reset preferences?",
            tone: "warning",
            confirmLabel: "Reset",
            message: "Display, branding and notification preferences stored in this browser will " +
                "return to their defaults."
        }).then(function (confirmed) {
            if (!confirmed) return;
            resetPrefs();
            applyPrefs();
            renderView();
            toast("Preferences reset to their defaults.", "info");
        });
    }

    function actionSignOut() {
        confirmDialog({
            title: "Sign out of the dashboard?",
            tone: "warning",
            confirmLabel: "Sign out",
            message: "You will be signed out of your administration account."
        }).then(function (confirmed) {
            if (!confirmed) return;
            closeModal();
            window.AngutsaPlatform.logout().then(function () {
                window.location.replace("/login/");
            }).catch(function (error) {
                toast(error && error.message ? error.message : "We couldn't sign you out. Please try again.", "error");
            });
        });
    }

    /* -------------------------
       Rail collapse
       ------------------------- */

    function toggleRail() {
        var next = !document.body.classList.contains("is-rail");
        document.body.classList.toggle("is-rail", next);
        state.prefs.sidebarRail = next;
        writePrefs();

        var toggle = $("#railToggle");
        if (toggle) {
            toggle.setAttribute("aria-pressed", next ? "true" : "false");
            toggle.setAttribute("aria-label", next ? "Expand sidebar" : "Collapse sidebar");
        }
    }

    /* -------------------------
       Event binding (delegated)
       ------------------------- */

    function closestElement(node, selector) {
        var current = node;
        while (current && current !== document) {
            if (current.nodeType === 1 && current.matches(selector)) return current;
            current = current.parentNode;
        }
        return null;
    }

    function datasetOf(node) {
        return {
            action: node.getAttribute("data-action") || "",
            module: node.getAttribute("data-module") || "",
            id: node.getAttribute("data-id") || "",
            stage: node.getAttribute("data-stage") || "",
            stageId: node.getAttribute("data-stage-id") || "",
            stageType: node.getAttribute("data-stage-type") || "",
            index: node.getAttribute("data-index") || "",
            direction: node.getAttribute("data-direction") || "",
            enabled: node.getAttribute("data-enabled") || "",
            tournamentId: node.getAttribute("data-tournament-id") || "",
            managerKey: node.getAttribute("data-manager-key") || "",
            permissionMenu: node.getAttribute("data-permission-menu") || "",
            permissionState: node.getAttribute("data-permission-state") || ""
        };
    }

    function handleDocumentClick(event) {
        var node = event.target;

        var goalScorerAction = closestElement(node, "[data-goal-scorer-action]");
        if (goalScorerAction) {
            var goalGroup = document.getElementById(
                goalScorerAction.getAttribute("data-goal-scorer-group"));
            if (!goalGroup) return;
            if (goalScorerAction.getAttribute("data-goal-scorer-action") === "add") {
                goalGroup.insertAdjacentHTML("beforeend", goalScorerRowMarkup(
                    goalGroup.id, goalGroup.getAttribute("data-team-id"), null));
            } else {
                var row = closestElement(goalScorerAction, ".goal-scorer-row");
                if (row) row.parentNode.removeChild(row);
                if (!$(".goal-scorer-row", goalGroup)) {
                    goalGroup.innerHTML = goalScorerRowMarkup(
                        goalGroup.id, goalGroup.getAttribute("data-team-id"), null);
                }
            }
            return;
        }

        var resultEntryToggle = closestElement(node, "[data-result-entry-toggle]");
        if (resultEntryToggle) {
            var resultCard = closestElement(resultEntryToggle, ".results-match-card");
            if (resultCard) {
                var expanded = resultEntryToggle.getAttribute("aria-expanded") !== "true";
                resultCard.classList.toggle("is-expanded", expanded);
                resultEntryToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
                resultEntryToggle.textContent = expanded ? "Hide entry" : "Enter result";
            }
            return;
        }

        /* Sidebar group toggles */
        var groupToggle = closestElement(node, "[data-group-toggle]");
        if (groupToggle) {
            var body = document.getElementById(groupToggle.getAttribute("aria-controls"));
            var expanded = groupToggle.getAttribute("aria-expanded") === "true";
            groupToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
            if (body) body.hidden = expanded;
            return;
        }

        /* Navigation links */
        var navLink = closestElement(node, "[data-view-link]");
        if (navLink) {
            event.preventDefault();
            closeDrawer();
            closeMenus();
            setView(navLink.getAttribute("data-view-link"));
            return;
        }

        /* Search results */
        var searchResult = closestElement(node, "[data-search-view]");
        if (searchResult) {
            event.preventDefault();
            var query = searchResult.getAttribute("data-search-query");
            closeSearch();
            var searchInput = $("#globalSearch");
            if (searchInput) searchInput.value = "";
            setView(searchResult.getAttribute("data-search-view"), { query: query || "" });
            return;
        }

        /* Table sorting */
        var sortButtonNode = closestElement(node, "[data-sort]");
        if (sortButtonNode) {
            var view = state.view;
            var st = listState(view);
            var key = sortButtonNode.getAttribute("data-sort");
            if (st.sort.key === key) {
                st.sort.dir = st.sort.dir === "asc" ? "desc" : "asc";
            } else {
                st.sort.key = key;
                st.sort.dir = "asc";
            }
            refreshResults(view);
            return;
        }

        /* Pagination */
        var pageButton = closestElement(node, "[data-page]");
        if (pageButton) {
            if (pageButton.disabled) return;
            var target = toNumber(pageButton.getAttribute("data-page"));
            if (target < 1) return;
            listState(state.view).page = target;
            refreshResults(state.view);
            return;
        }

        /* Settings sections */
        var settingsButton = closestElement(node, "[data-settings-section]");
        if (settingsButton) {
            state.settingsSection = settingsButton.getAttribute("data-settings-section");
            renderView();
            return;
        }

        /* Registration trend tabs */
        var trendTab = closestElement(node, "[data-trend]");
        if (trendTab) {
            var series = trendTab.getAttribute("data-trend");
            $$("[data-trend]").forEach(function (tab) {
                tab.setAttribute("aria-selected",
                    tab.getAttribute("data-trend") === series ? "true" : "false");
            });
            $$("[data-trend-panel]").forEach(function (panel) {
                panel.hidden = panel.getAttribute("data-trend-panel") !== series;
            });
            return;
        }

        /* Generic actions */
        var actionable = closestElement(node, "[data-action]");
        if (actionable) {
            event.preventDefault();
            handleAction(actionable.getAttribute("data-action"), datasetOf(actionable));
            return;
        }

        /* Clicking away from an open menu closes it */
        if (!closestElement(node, ".app-menu") && !closestElement(node, "#appSearch")) {
            closeMenus();
            closeSearch();
        }
    }

    function handleDocumentChange(event) {
        var node = event.target;
        if (!node || node.nodeType !== 1) return;

        if (node.hasAttribute("data-permission-key") && node.checked) {
            updatePermissionState(
                node.getAttribute("data-permission-key"),
                node.getAttribute("data-permission-state")
            );
            renderView();
            var selectedPermission = $('[data-permission-key="' +
                node.getAttribute("data-permission-key") + '"][value="' + node.value + '"]');
            if (selectedPermission) selectedPermission.focus();
            return;
        }

        if (node.hasAttribute("data-fixture-generation-tournament")) {
            state.managementTournament = node.value;
            state.fixtureStartDate = "";
            state.fixtureVenue = "";
            state.fixtureStageId = "";
            state.fixtureGroup = "";
            state.fixtureRound = "";
            renderView();
            return;
        }

        if (node.hasAttribute("data-fixture-stage")) {
            state.fixtureStageId = node.value;
            state.fixtureGroup = "";
            state.fixtureRound = "";
            renderView();
            return;
        }

        if (node.hasAttribute("data-fixture-group")) {
            state.fixtureGroup = node.value;
            renderView();
            return;
        }

        if (node.hasAttribute("data-fixture-round")) {
            state.fixtureRound = node.value;
            return;
        }

        if (node.hasAttribute("data-fixture-start-date")) {
            state.fixtureStartDate = node.value;
            return;
        }

        if (node.hasAttribute("data-fixture-kickoff")) {
            state.fixtureKickoffTime = node.value;
            return;
        }

        if (node.hasAttribute("data-fixture-venue")) {
            state.fixtureVenue = node.value;
            return;
        }

        if (node.hasAttribute("data-tm-tournament")) {
            state.managementTournament = node.value;
            state.managementStage = "groups";
            state.fixtureStageId = "";
            state.fixtureGroup = "";
            state.fixtureRound = "";
            renderView();
            return;
        }

        var filterName = node.getAttribute("data-filter");
        if (filterName) {
            var st = listState(state.view);
            st.filters[filterName] = node.value;
            st.page = 1;
            refreshResults(state.view);
            return;
        }

        var standing = node.getAttribute("data-standing-select");
        if (standing) {
            if (standing === "tournament") state.standingsTournament = node.value;
            if (standing === "category") state.standingsCategory = node.value;
            renderView();
            return;
        }

        if (node.hasAttribute("data-rules-category")) {
            state.rulesCategory = node.value;
            renderView();
            return;
        }

        var reportFilter = node.getAttribute("data-report-filter");
        if (reportFilter) {
            if (reportFilter === "finance") state.financeTournament = node.value;
            else state.reportTournament = node.value;
            renderView();
            return;
        }

        var reportDate = node.getAttribute("data-report-date");
        if (reportDate) {
            if (reportDate === "from") state.reportFrom = node.value || state.reportFrom;
            else state.reportTo = node.value || state.reportTo;
            renderView();
            return;
        }

    }

    var debouncedTableSearch = debounce(function (value) {
        var st = listState(state.view);
        st.q = value;
        st.page = 1;
        refreshResults(state.view);
    }, 220);

    var debouncedGlobalSearch = debounce(function (value) {
        runSearch(value);
    }, 180);

    function handleDocumentInput(event) {
        var node = event.target;
        if (!node || node.nodeType !== 1) return;

        if (node.hasAttribute("data-filter-search")) {
            debouncedTableSearch(node.value);
            return;
        }

        if (node.hasAttribute("data-permission-search")) {
            applyPermissionSearch(node.value);
            return;
        }

        if (node.id === "globalSearch") {
            debouncedGlobalSearch(node.value);
        }
    }

    function handleDocumentKeydown(event) {
        if (event.key === "Escape") {
            if ($(".modal")) {
                closeModal();
                return;
            }
            closeSearch();
            closeMenus();
            if (document.body.classList.contains("drawer-open")) closeDrawer();
            return;
        }

        /* Keep keyboard focus inside an open dialog. */
        if (event.key === "Tab" && $(".modal")) {
            var dialog = $(".modal-dialog");
            var focusable = $$('button, [href], input:not([type="hidden"]), select, textarea', dialog)
                .filter(function (node) {
                    return !node.hasAttribute("disabled");
                });

            if (!focusable.length) return;

            var first = focusable[0];
            var last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    function bindEvents() {
        on($("#menuButton"), "click", function () {
            if (document.body.classList.contains("drawer-open")) closeDrawer();
            else openDrawer();
        });

        on($("#sidebarClose"), "click", closeDrawer);
        on($("#appScrim"), "click", closeDrawer);
        on($("#railToggle"), "click", toggleRail);

        on($("#bellButton"), "click", function () {
            toggleMenu("bellButton", "notificationMenu");
        });

        on($("#profileButton"), "click", function () {
            toggleMenu("profileButton", "profileMenu");
        });

        on($("#globalSearchClear"), "click", function () {
            var input = $("#globalSearch");
            if (input) {
                input.value = "";
                input.focus();
            }
            runSearch("");
        });

        on($("#globalSearch"), "keydown", function (event) {
            if (event.key !== "Enter") return;
            var first = $(".app-search-result", $("#globalSearchPanel"));
            if (first) {
                event.preventDefault();
                first.click();
            }
        });

        on(document, "click", handleDocumentClick);
        on(document, "change", handleDocumentChange);
        on(document, "input", handleDocumentInput);
        on(document, "keydown", handleDocumentKeydown);

        /* The record form is submitted through its own save button, so the
           default submit behaviour is stopped to avoid a page reload. */
        on(document, "submit", function (event) {
            if (event.target && event.target.id === "recordForm") {
                event.preventDefault();
            }
        });

        on(window, "hashchange", function () {
            var target = currentHashView();
            if (!target || target === state.view) return;
            setView(target, { hash: false, focus: false });
        });

        on(window, "resize", debounce(function () {
            if (window.innerWidth > 1025 && document.body.classList.contains("drawer-open")) {
                closeDrawer();
            }
        }, 200));
        on(window, "focus", refreshAdminPermissions);
        on(document, "visibilitychange", function () {
            if (document.visibilityState === "visible") refreshAdminPermissions();
        });
        on(window, "beforeunload", function (event) {
            if (!permissionEditorIsDirty()) return;
            event.preventDefault();
            event.returnValue = "";
        });
    }

    /* -------------------------------------------------------
       Initialisation
       ------------------------------------------------------- */

    function requestAdminBootstrap(platform) {
        return platform.requestAll("/admin/bootstrap", [
            "categories", "tournaments", "teams", "teamRegistrations", "paymentRegistrations", "players",
            "fixtures", "matches", "payments", "users", "auditLogs", "rules", "media"
        ]);
    }

    var permissionRefreshUnavailableNotified = false;

    async function refreshAdminPermissions() {
        if (state.role !== "tournament_admin" || !state.admin) return;
        try {
            var platform = window.AngutsaPlatform;
            var data = await platform.request("/admin/permissions");
            if (data.role !== "tournament_admin") {
                window.location.replace(data.role === "team_manager"
                    ? "/team-manager-dashboard/#/overview"
                    : "/login/");
                return;
            }
            if (!Array.isArray(data.permissions)) {
                throw new Error("The service returned an invalid permission response.");
            }
            state.permissions = Object.create(null);
            state.permissionCatalog = data.permissions;
            state.permissionCatalog.forEach(function (permission) {
                state.permissions[permission.key] = permission.state;
            });
            state.permissionsLoaded = true;
            permissionRefreshUnavailableNotified = false;
            renderSidebar();
            renderNotificationMenu();
            if (!canAccessView(state.view)) {
                setView(firstAccessibleView());
            } else {
                renderView();
            }
        } catch (error) {
            state.permissions = Object.create(null);
            state.permissionCatalog = [];
            state.permissionsLoaded = false;
            renderSidebar();
            renderNotificationMenu();
            renderView();
            if (!permissionRefreshUnavailableNotified) {
                toast(error && error.message
                    ? "Administration permissions could not be refreshed: " + error.message
                    : "Administration permissions could not be refreshed. Protected sections are unavailable.",
                "error");
                permissionRefreshUnavailableNotified = true;
            }
        }
    }

    function applyAdminBootstrap(data, account) {
        if (!Array.isArray(data.permissions)) {
            throw new Error("Administrator permissions could not be loaded securely. Refresh and try again.");
        }
        DEMO.meta = { demo: false, label: "Live competition data", currency: "KES" };
        DEMO.categories = (data.categories || []).map(function (row) {
            return {
                id: row.id, publicId: row.public_id, name: row.name, code: row.code,
                ageGroup: row.age_group, ageMin: row.age_min, ageMax: row.age_max,
                gender: row.gender, guardianConsent: row.guardian_consent_required === 1,
                status: row.status, description: row.description
            };
        });
        DEMO.tournaments = (data.tournaments || []).map(function (row) {
            return {
                id: row.id, publicId: row.public_id, slug: row.slug, name: row.name,
                season: String(row.season), categoryId: row.category_id, format: row.format,
                startDate: row.start_date, endDate: row.end_date,
                registrationOpens: row.registration_opens, registrationCloses: row.registration_closes,
                venue: row.venue, location: row.location, status: row.status,
                registrationStatus: row.status, teamCap: row.team_limit,
                registrationFee: row.registration_fee, entryFee: row.registration_fee,
                banner: row.banner, featured: row.featured === 1,
                standingsAvailable: row.standings_available === 1, overview: row.overview,
                prizeInformation: row.prize_information || ""
            };
        });
        DEMO.tournamentStages = (data.tournamentStages || []).map(function (row) {
            return {
                id: row.id, tournamentId: row.tournament_id, name: row.name,
                type: row.stage_type, position: row.position, status: row.status,
                included: row.status !== "skipped",
                participantSource: row.participant_source,
                qualification: JSON.parse(row.qualification_json || "{}"),
                pairing: JSON.parse(row.pairing_json || "{}"),
                settings: JSON.parse(row.settings_json || "{}"),
                revision: row.revision
            };
        });
        DEMO.tournamentStageParticipants = data.tournamentStageParticipants || [];
        var teamsById = Object.create(null);
        (data.teams || []).forEach(function (row) {
            var team = teamsById[row.id];
            if (!team) {
                team = {
                id: row.id, name: row.name, shortName: row.short_code,
                categoryId: row.category_id, tournamentId: row.tournament_id || "",
                tournamentIds: [],
                registrationId: row.registration_id || "",
                earlyPlayerRegistration: row.early_player_registration === 1,
                rosterChangesAfterStart: row.roster_changes_after_start === 1,
                rosterChangesExpiresAt: row.roster_changes_expires_at || null,
                location: row.location, logo: row.logo_key, manager: row.manager_name,
                contact: row.manager_email, phone: row.manager_phone,
                registrationStatus: row.registration_status, group: row.group_name || "",
                archived: Boolean(row.archived_at)
                };
                teamsById[row.id] = team;
            }
            if (row.tournament_id && team.tournamentIds.indexOf(row.tournament_id) === -1) {
                team.tournamentIds.push(row.tournament_id);
            }
        });
        DEMO.teams = Object.keys(teamsById).map(function (id) { return teamsById[id]; });
        DEMO.teamRegistrations = (data.teamRegistrations || []).map(function (row) {
            return {
                id: row.id, teamId: row.team_id, tournamentId: row.tournament_id,
                submitted: row.submitted_at, reference: row.public_reference,
                status: row.status === "pending_review" ? "pending review" :
                    row.status === "correction_requested" ? "correction requested" : row.status,
                outstanding: row.review_note || "", reviewedBy: row.reviewed_by || "",
                earlyPlayerRegistration: row.early_player_registration === 1,
                rosterChangesAfterStart: row.roster_changes_after_start === 1,
                rosterChangesExpiresAt: row.roster_changes_expires_at || null,
                manager: row.manager_name, managerEmail: row.manager_email, managerPhone: row.manager_phone,
                teamName: row.team_name, tournamentName: row.tournament_name, categoryName: row.category_name
            };
        });
        DEMO.paymentRegistrations = (data.paymentRegistrations || []).map(function (row) {
            return {
                id: row.id,
                teamId: row.team_id,
                tournamentId: row.tournament_id
            };
        });
        managerSubmissionRecords = (data.teamRegistrations || []).map(function (row) {
            return {
                id: row.id, registrationId: row.id, managerUid: row.manager_uid,
                name: row.team_name, status: row.status,
                manager: {
                    id: row.manager_uid, name: row.manager_name, role: "Team Manager",
                    email: row.manager_email, phone: row.manager_phone
                }
            };
        });
        DEMO.players = (data.players || []).map(function (row) {
            var team = byId(DEMO.teams, row.team_id);
            var category = team ? byId(DEMO.categories, team.categoryId) : null;
            return {
                id: row.id, name: row.name, teamId: row.team_id, categoryId: category ? category.id : "",
                jersey: row.shirt_number, position: row.position,
                yearOfBirth: row.date_of_birth ? Number(String(row.date_of_birth).slice(0, 4)) : null,
                guardianConsent: row.guardian_consent_status === "on_file",
                guardianConsentRequired: Boolean(category && category.guardianConsent),
                publicProfile: row.public_profile || "hidden",
                eligibility: "approved", registrationStatus: row.status
            };
        });
        DEMO.fixtures = (data.fixtures || []).map(function (row) {
            return {
                id: row.id, tournamentId: row.tournament_id, categoryId: row.category_id,
                stageId: row.stage_id || "",
                stage: row.stage, round: row.round, group: row.group_name || "", homeId: row.home_team_id,
                awayId: row.away_team_id, kickoff: row.kickoff, venue: row.venue,
                status: row.status, homeScore: row.home_score, awayScore: row.away_score,
                liveMinute: Number(row.live_minute || 0),
                liveClockMode: row.live_clock_mode || "automatic",
                liveClockStartedAt: row.live_clock_started_at || null,
                liveClockElapsedSeconds: Number(row.live_clock_elapsed_seconds || 0),
                liveExtraMinutes: Number(row.live_extra_minutes || 0),
                tieBreakMethod: row.tie_break_method || "",
                homeExtraTimeScore: row.home_extra_time_score,
                awayExtraTimeScore: row.away_extra_time_score,
                homePenaltiesScore: row.home_penalties_score,
                awayPenaltiesScore: row.away_penalties_score,
                published: row.published === 1, note: row.note || ""
            };
        });
        DEMO.matches = DEMO.fixtures;
        tournamentManagement = [];
        var groupsByTournament = Object.create(null);
        (data.tournamentGroups || []).forEach(function (row) {
            var record = groupsByTournament[row.tournament_id];
            if (!record) {
                record = {
                    names: [], groupIdsByName: Object.create(null),
                    teamGroups: Object.create(null)
                };
                groupsByTournament[row.tournament_id] = record;
            }
            if (record.names.indexOf(row.name) === -1) record.names.push(row.name);
            record.groupIdsByName[row.name] = row.id;
            if (row.team_id) record.teamGroups[row.team_id] = row.name;
        });
        Object.keys(groupsByTournament).forEach(function (tournamentId) {
            var source = groupsByTournament[tournamentId];
            var record = managementRecord(tournamentId, true);
            record.groupNames = source.names;
            record.groupIdsByName = source.groupIdsByName;
            record.teamGroups = source.teamGroups;
            record.groupsCreated = true;
            record.matches = DEMO.fixtures.filter(function (fixture) {
                return fixture.tournamentId === tournamentId;
            }).map(function (fixture) {
                return {
                    id: fixture.id, stage: fixture.stage, round: fixture.round,
                    group: fixture.group, homeId: fixture.homeId, awayId: fixture.awayId,
                    date: String(fixture.kickoff || "").slice(0, 10),
                    time: String(fixture.kickoff || "").slice(11, 16),
                    venue: fixture.venue, homeScore: fixture.homeScore, awayScore: fixture.awayScore,
                    confirmed: fixture.published, winnerId: ""
                };
            });
        });
        var scorersByMatch = Object.create(null);
        (data.matchEvents || []).forEach(function (event) {
            if (!scorersByMatch[event.match_id]) {
                scorersByMatch[event.match_id] = Object.create(null);
            }
            var teamScorers = scorersByMatch[event.match_id][event.team_id] ||
                (scorersByMatch[event.match_id][event.team_id] = []);
            var scorer = teamScorers.filter(function (item) {
                return item.playerId === (event.player_id || "") &&
                    item.ownGoal === (event.event_type === "own_goal");
            })[0];
            if (scorer) {
                scorer.goals += 1;
                if (event.minute !== null && event.minute !== undefined &&
                    (scorer.minute === null || scorer.minute === undefined ||
                        Number(event.minute) < Number(scorer.minute))) {
                    scorer.minute = event.minute;
                }
            } else {
                teamScorers.push({
                    playerId: event.player_id || "",
                    playerName: event.player_name || "",
                    publicName: event.player_name || "",
                    ownGoal: event.event_type === "own_goal",
                    minute: event.minute,
                    goals: 1,
                    teamId: event.team_id,
                    teamName: event.team_name || ""
                });
            }
        });
        DEMO.results = DEMO.fixtures.filter(function (fixture) {
            return fixture.homeScore !== null || fixture.awayScore !== null;
        }).map(function (fixture) {
            var matchScorers = scorersByMatch[fixture.id] || {};
            return {
                id: fixture.id, fixtureId: fixture.id,
                publicTournamentId: publicTournamentIdFor(fixture.tournamentId),
                homeId: fixture.homeId, awayId: fixture.awayId,
                homeScore: fixture.homeScore, awayScore: fixture.awayScore,
                tieBreakMethod: fixture.tieBreakMethod || "",
                homeExtraTimeScore: fixture.homeExtraTimeScore,
                awayExtraTimeScore: fixture.awayExtraTimeScore,
                homePenaltiesScore: fixture.homePenaltiesScore,
                awayPenaltiesScore: fixture.awayPenaltiesScore,
                state: fixture.published ? "published" : "draft",
                notes: fixture.note,
                homeScorers: matchScorers[fixture.homeId] || [],
                awayScorers: matchScorers[fixture.awayId] || []
            };
        });
        DEMO.payments = (data.payments || []).map(function (row) {
            var registration = (data.teamRegistrations || []).filter(function (item) {
                return item.id === row.registration_id;
            })[0];
            return {
                id: row.id, reference: row.reference, registrationId: row.registration_id,
                teamId: row.team_id, tournamentId: row.tournament_id, amount: row.amount,
                method: row.method, status: row.status, recordedAt: row.recorded_at,
                reviewNote: row.review_note,
                teamName: registration ? registration.team_name : teamName(row.team_id)
            };
        });
        DEMO.paymentRecords = DEMO.payments.map(function (payment) {
            return {
                id: payment.id, reference: payment.reference,
                registrationId: payment.registrationId, amount: payment.amount,
                status: payment.status, date: payment.recordedAt,
                teamId: payment.teamId, tournamentId: payment.tournamentId,
                method: payment.method,
                receipt: payment.reference || ""
            };
        });
        DEMO.users = (data.users || []).map(function (row) {
            return {
                id: row.id, name: row.name, email: row.email, phone: row.phone,
                role: row.role || "", status: row.status,
                allowedPermissions: row.allowed_permissions || 0,
                deniedPermissions: row.denied_permissions || 0,
                requestedAccountType: row.requested_account_type,
                tournamentIds: row.tournament_ids ? row.tournament_ids.split(",") : [],
                created: row.created_at
            };
        });
        DEMO.roles = data.roles || [];
        state.permissions = Object.create(null);
        state.permissionCatalog = data.permissions || [];
        state.permissionsLoaded = true;
        state.permissionCatalog.forEach(function (permission) {
            state.permissions[permission.key] = permission.state;
        });
        DEMO.playerRegistrations = (data.players || []).map(function (row) {
            var team = byId(DEMO.teams, row.team_id);
            var category = team ? byId(DEMO.categories, team.categoryId) : null;
            return {
                id: row.id, playerId: row.id, teamId: row.team_id,
                tournamentId: row.tournament_id || "",
                submitted: row.created_at || "",
                eligibility: row.guardian_consent_status === "pending"
                    ? "Consent pending"
                    : "Registered",
                status: row.status, categoryId: category ? category.id : ""
            };
        });
        DEMO.auditLogs = (data.auditLogs || []).map(function (row) {
            var actor = byId(DEMO.users, row.actor_uid);
            var actorEmail = row.actor_email || (actor && actor.email) ||
                (account && account.uid === row.actor_uid && account.email) ||
                (row.actor_uid ? "Email unavailable" : "System");
            return {
                id: row.id, action: row.action, subject: row.entity_id || "",
                actorEmail: actorEmail,
                module: row.entity_type || "",
                timestamp: row.created_at, type: row.action
            };
        });
        DEMO.tasks = [];
        DEMO.activity = DEMO.auditLogs.slice(0, 8).map(function (row) {
            return {
                id: row.id, text: row.action, detail: row.module + " " + row.subject,
                time: row.timestamp, tone: "purple", icon: "settings"
            };
        });
        DEMO.series = { registrations: [], matchActivity: [] };
        DEMO.notifications = (data.notifications || []).map(function (row) {
            var view = String(row.target_path || "dashboard").replace(/^#\/?/, "");
            return {
                id: row.id, title: row.title, message: row.body, date: row.created_at,
                read: Boolean(row.read_at), view: view
            };
        });
        DEMO.rules = (data.rules || []).map(function (row) {
            return {
                id: row.id, categoryId: row.category_id, title: row.title,
                body: row.body, state: row.status, updated: row.updated_at
            };
        });
        DEMO.media = (data.media || []).map(function (row) {
            return {
                id: row.id, mediaType: row.media_type, title: row.title,
                category: row.category, status: row.status, file: row.file_path,
                videoUrl: row.video_url || "", addedOn: row.added_on, caption: row.caption || ""
            };
        });
        DEMO.announcements = [];
        state.role = account.role;
        state.admin = account;
        state.prefs.adminName = account.name || account.email || "Administrator";
        state.emailSender = data.settings || {};
        state.prefs.showDemoBanners = false;
    }

    async function init() {
        if (!$("#appView")) {
            hideAdminBootScreen();
            return;
        }

        try {
            var platform = await window.AngutsaPlatformReady;
            if (!platform) throw window.AngutsaPlatformError || new Error("Administration services are unavailable.");
            var account = await platform.account();
            if (account.status !== "active" ||
                ["platform_owner", "tournament_admin"].indexOf(account.role) === -1) {
                window.location.replace(account.role === "team_manager"
                    ? "/team-manager-dashboard/#/overview"
                    : "/login/");
                return;
            }
            var bootstrap = await requestAdminBootstrap(platform);
            applyAdminBootstrap(bootstrap, account);
        } catch (error) {
            document.body.hidden = false;
            var message = error && error.message ? error.message : "Please sign in and try again.";
            var view = $("#appView");
            if (view) view.innerHTML =
                '<div class="alert alert-danger" role="alert"><strong>Administration could not load.</strong> ' +
                esc(message) + "</div>";
            hideAdminBootScreen();
            toast("Administration could not load. " + message, "error");
            return;
        }

        document.body.hidden = false;
        paintIcons(document);
        applyPrefs();

        renderSidebar();
        renderNotificationMenu();

        var requestedView = currentHashView() || "dashboard";
        state.view = canAccessView(requestedView) ? requestedView : firstAccessibleView();
        if (window.location.hash !== "#/" + state.view) {
            window.location.hash = "#/" + state.view;
        }
        renderView();

        bindEvents();

        toast("Your administration dashboard is ready.", "success");
        hideAdminBootScreen();
    }

    function hideAdminBootScreen() {
        var screen = $("#adminBootScreen");
        if (screen) screen.hidden = true;
    }

    /* -------------------------------------------------------
       Public API (handy for debugging in the console)
       ------------------------------------------------------- */

    return {
        init: init,
        setView: setView,
        renderView: renderView,
        data: DEMO,
        state: state,
        exportCsv: exportCsv,
        toast: toast,
        openModal: openModal,
        closeModal: closeModal
    };
}());

/* The script is deferred, so the DOM is parsed before this runs. */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
        window.AngutsaAdmin.init();
    });
} else {
    window.AngutsaAdmin.init();
}
