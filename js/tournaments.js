/* =========================================
   ANGUTSA CHAMPIONSHIP — TOURNAMENT DIRECTORY
   Behaviour for /tournaments/.
   Reads from js/data.js (demonstration data) through the shared
   helpers in js/common.js. When the backend replaces js/data.js this
   file keeps working unchanged.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        status: "all",
        query: "",
        categoryId: "",
        format: "",
        season: "",
        sort: "start-asc",
        page: 1,
        perPage: 6
    };

    var els = {};

    /* -------------------------
       Filtering and sorting
       ------------------------- */

    function matchesStatus(tournament) {
        if (state.status === "all") return true;
        return tournament.status === state.status;
    }

    function sortList(list) {
        var sorters = {
            "start-asc": function (a, b) { return new Date(a.startDate) - new Date(b.startDate); },
            "start-desc": function (a, b) { return new Date(b.startDate) - new Date(a.startDate); },
            "name-asc": function (a, b) { return a.name.localeCompare(b.name); },
            registration: function (a, b) { return new Date(a.registrationCloses) - new Date(b.registrationCloses); }
        };
        var sorter = sorters[state.sort] || sorters["start-asc"];
        return list.sort(sorter);
    }

    function filteredList() {
        var list = (Data.tournaments || []).slice();

        list = list.filter(function (item) { return item.status !== "draft"; });
        list = list.filter(matchesStatus);

        if (state.categoryId) {
            list = list.filter(function (item) { return item.categoryId === state.categoryId; });
        }

        if (state.format) {
            list = list.filter(function (item) { return item.format === state.format; });
        }

        if (state.season) {
            list = list.filter(function (item) { return item.season === state.season; });
        }

        if (U.normalise(state.query)) {
            list = list.filter(function (item) {
                return U.matchesQuery(item, state.query, [
                    "name", "id", "season", "categoryLabel", "formatLabel",
                    "venue", "location", "overview"
                ]);
            });
        }

        return sortList(list);
    }

    /* -------------------------
       Card rendering
       ------------------------- */

    function registrationAction(tournament) {
        var slug = encodeURIComponent(tournament.slug);

        if (tournament.status === "registration-open") {
            return '<a class="btn btn-primary btn-sm" href="/team-registration/?tournament=' + slug +
                '">Register Team</a>';
        }

        if (tournament.status === "upcoming") {
            return '<button type="button" class="btn btn-dark-outline btn-sm" disabled ' +
                'title="Registration has not opened yet">Registration not open</button>';
        }

        if (tournament.status === "completed") {
            return '<a class="btn btn-dark-outline btn-sm" href="/results/?tournament=' +
                encodeURIComponent(tournament.id) + '">View Results</a>';
        }

        return '<a class="btn btn-dark-outline btn-sm" href="/fixtures/?tournament=' +
            encodeURIComponent(tournament.id) + '">View Fixtures</a>';
    }

    function registrationProgress(tournament) {
        if (!tournament.teamLimit) return "";

        var registered = tournament.teamsRegistered || 0;
        var percent = Math.round((registered / tournament.teamLimit) * 100);
        var tone = percent >= 100 ? "is-green" : (percent >= 60 ? "is-gold" : "");

        return '<div class="registration-progress">' +
            '<div class="progress-meta"><span>Teams registered</span>' +
            "<strong>" + registered + " / " + tournament.teamLimit + "</strong></div>" +
            '<div class="progress-track"><div class="progress-fill ' + tone + '" style="width:' +
            Math.min(percent, 100) + '%"></div></div>' +
            "</div>";
    }

    function cardMarkup(tournament) {
        var slug = encodeURIComponent(tournament.slug);

        return '<article class="card tournament-card">' +
            '<div class="tournament-card-media">' +
                (tournament.banner
                    ? '<img src="' + U.escapeHtml(tournament.banner) + '" alt="" loading="lazy">'
                    : "") +
                '<div class="media-top">' +
                    '<span class="category-pill">' + U.escapeHtml(tournament.categoryLabel) + "</span>" +
                    U.statusBadge(tournament.status, U.tournamentStatusLabel(tournament.status)) +
                "</div>" +
                '<div class="media-bottom">' +
                    "<span>Season " + U.escapeHtml(tournament.season) + "</span>" +
                    "<strong>" + U.escapeHtml(tournament.formatLabel) + "</strong>" +
                "</div>" +
            "</div>" +
            '<div class="card-body">' +
                '<h3 class="tournament-title"><a href="/tournament-details/?slug=' + slug + '">' +
                    U.escapeHtml(tournament.name) + "</a></h3>" +
                '<p class="tournament-summary">' + U.escapeHtml(tournament.overview) + "</p>" +
                '<div class="meta-list is-compact">' +
                    "<div>" + U.icon("calendar") + "<span>" +
                        U.formatDateRange(tournament.startDate, tournament.endDate) + "</span></div>" +
                    "<div>" + U.icon("pin") + "<span>" + U.escapeHtml(tournament.venue) +
                        (tournament.location ? ", " + U.escapeHtml(tournament.location) : "") +
                        "</span></div>" +
                    "<div>" + U.icon("clipboard") + "<span>Registration closes " +
                        U.formatDate(tournament.registrationCloses) + "</span></div>" +
                    "<div>" + U.icon("wallet") + "<span>Entry fee " +
                        U.formatMoney(tournament.entryFee) + "</span></div>" +
                "</div>" +
                registrationProgress(tournament) +
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/tournament-details/?slug=' + slug +
                        '">View Details</a>' +
                    registrationAction(tournament) +
                "</div>" +
            "</div>" +
        "</article>";
    }

    /* -------------------------
       Result summary and empty state
       ------------------------- */

    function activeFilterLabels() {
        var labels = [];
        var category = state.categoryId ? U.categoryById(state.categoryId) : null;
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;

        if (state.status && state.status !== "all") {
            labels.push(U.tournamentStatusLabel(state.status));
        }
        if (tournament) labels.push(tournament.name);
        if (category) labels.push(category.name);
        if (state.format) labels.push(state.format);
        if (state.season) labels.push("Season " + state.season);
        if (state.query) labels.push('"' + state.query + '"');

        return labels;
    }

    function metaMarkup(count) {
        var labels = activeFilterLabels();
        var chips = labels.map(function (label) {
            return '<span class="badge">' + U.escapeHtml(label) + "</span>";
        }).join("");

        return '<div class="result-count"><span>Showing <strong>' + count +
            "</strong> " + (count === 1 ? "competition" : "competitions") + "</span>" +
            (chips ? "<span>Filters:</span>" + chips : "") +
            "</div>";
    }

    function emptyMarkup() {
        return U.emptyState({
            icon: "trophy",
            title: "No tournaments match your filters",
            message: "Adjust the search term, category, format or season to see more competitions.",
            actionLabel: "Reset filters"
        });
    }

    /* -------------------------
       Supporting content
       ------------------------- */

    function renderCategoryTable() {
        var body = document.getElementById("categoryTableBody");
        if (!body) return;

        body.innerHTML = (Data.categories || []).map(function (category) {
            var range = category.ageMin
                ? category.ageMin + " - " + (category.ageMax ? category.ageMax : "open")
                : "Open age";

            return "<tr>" +
                '<td data-label="Category"><strong>' + U.escapeHtml(category.name) + "</strong>" +
                    "<span>" + U.escapeHtml(category.description) + "</span></td>" +
                '<td data-label="Age range">' + U.escapeHtml(range) + " years</td>" +
                '<td data-label="Guardian consent">' +
                    (category.guardianConsent
                        ? '<span class="badge badge-gold">Required</span>'
                        : '<span class="badge">Not required</span>') + "</td>" +
                '<td data-label="Entry fee" class="is-numeric">' +
                    U.formatMoney(category.entryFee) + "</td>" +
            "</tr>";
        }).join("");
    }

    function populateOptions() {
        var categories = Data.categories || [];
        var tournaments = Data.tournaments || [];

        U.fillSelect(document.getElementById("filterCategory"), categories, {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        var seasons = {};
        tournaments.forEach(function (item) { seasons[item.season] = true; });
        var seasonList = Object.keys(seasons).sort().reverse();

        U.fillSelect(document.getElementById("filterSeason"), seasonList, {
            placeholder: "All seasons",
            value: function (season) { return season; },
            label: function (season) { return "Season " + season; }
        });
    }

    /* -------------------------
       Bindings and render loop
       ------------------------- */

    function syncFromControls() {
        var values = U.readFilters(els.scope || document);
        state.query = values.query || "";
        state.categoryId = values.categoryId || "";
        state.format = values.format || "";
        state.season = values.season || "";
        state.sort = values.sort || "start-asc";
    }

    function render() {
        var list = filteredList();
        var page = U.paginate(list, state.page, state.perPage);
        state.page = page.page;

        els.grid.innerHTML = page.items.length
            ? page.items.map(cardMarkup).join("")
            : emptyMarkup();

        var resetButton = els.grid.querySelector("[data-empty-action]");
        if (resetButton) {
            U.on(resetButton, "click", resetFilters);
        }

        if (els.meta) els.meta.innerHTML = metaMarkup(list.length);
        if (els.total) {
            els.total.textContent = list.length + (list.length === 1 ? " competition" : " competitions");
        }

        U.renderPagination(els.pagination, page, function (next) {
            state.page = next;
            render();
        });
    }

    function bindStatusChips() {
        U.$$("[data-status]").forEach(function (chip) {
            U.on(chip, "click", function () {
                setStatus(chip.getAttribute("data-status"));
                render();
            });
        });

        var statusSelect = document.getElementById("tournamentStatusFilter");
        if (statusSelect) {
            U.on(statusSelect, "change", function () {
                setStatus(statusSelect.value);
                render();
            });
        }
    }

    function setStatus(status) {
        state.status = status;
        state.page = 1;

        U.$$("[data-status]").forEach(function (chip) {
            var isActive = chip.getAttribute("data-status") === status;
            chip.classList.toggle("is-active", isActive);
            chip.setAttribute("aria-pressed", String(isActive));
        });

        var statusSelect = document.getElementById("tournamentStatusFilter");
        if (statusSelect) statusSelect.value = status;
    }

    function resetFilters() {
        setStatus("all");
        state.query = "";
        state.categoryId = "";
        state.format = "";
        state.season = "";
        state.sort = "start-asc";

        U.$$("[data-filter]", els.scope || document).forEach(function (control) {
            control.value = control.defaultValue || "";
        });

        var sortControl = document.getElementById("filterSort");
        if (sortControl) sortControl.value = "start-asc";

        render();
    }

    /* Deep links: /tournaments/?status=registration-open&category=CAT-MEN-OPEN */
    function applyDeepLinks() {
        var status = U.getParam("status");
        var category = U.getParam("category");
        var season = U.getParam("season");
        var query = U.getParam("q");

        if (status) {
            var chip = document.querySelector('[data-status="' + status + '"]');
            if (chip) {
                setStatus(status);
            }
        }

        if (category) {
            var categoryControl = document.getElementById("filterCategory");
            if (categoryControl) categoryControl.value = category;
        }

        if (season) {
            var seasonControl = document.getElementById("filterSeason");
            if (seasonControl) seasonControl.value = season;
        }

        if (query) {
            var searchControl = document.getElementById("tournamentSearch");
            if (searchControl) searchControl.value = query;
        }
    }

    function init() {
        els.grid = document.getElementById("tournamentGrid");
        if (!els.grid) return;

        els.meta = document.getElementById("resultMeta");
        els.pagination = document.getElementById("tournamentPagination");
        els.notice = document.getElementById("dataNotice");
        els.total = document.getElementById("statusTotal");
        els.scope = document.getElementById("tournamentFilters");

        if (els.notice) els.notice.innerHTML = U.liveDataNotice();

        populateOptions();
        renderCategoryTable();
        applyDeepLinks();
        bindStatusChips();

        U.bindFilters(els.scope, function () {
            state.page = 1;
            syncFromControls();
            render();
        });

        syncFromControls();
        render();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }



})();
