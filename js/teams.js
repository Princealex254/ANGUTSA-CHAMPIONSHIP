/* =========================================
   ANGUTSA CHAMPIONSHIP — TEAM DIRECTORY
   Behaviour for /teams/.
   Reads manager-submitted records approved in the live admin system.
   Unapproved submissions and manager contact details are never rendered.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        quick: "all",
        query: "",
        tournamentId: "",
        page: 1,
        perPage: 8
    };

    var els = {};

    /* -------------------------
       Filtering and sorting
       ------------------------- */

    /* The data layer only returns manager submissions approved by an admin. */
    function publicTeams() {
        return Data.publicTeams ? Data.publicTeams() : [];
    }

    function matchesQuick(team) {
        if (state.quick === "all") return true;

        var category = U.categoryById(team.categoryId);
        if (!category) return false;

        if (state.quick === "men") return category.gender === "male";
        if (state.quick === "women") return category.gender === "female";
        if (state.quick === "youth") {
            return team.categoryId === "CAT-YOUTH-M" ||
                team.categoryId === "CAT-YOUTH-F" ||
                team.categoryId === "CAT-CHILD-U13";
        }

        return true;
    }

    function filteredList() {
        var list = publicTeams().filter(matchesQuick);

        if (state.tournamentId) {
            list = list.filter(function (team) {
                return Array.isArray(team.tournamentIds) &&
                    team.tournamentIds.indexOf(state.tournamentId) > -1;
            });
        }

        if (U.normalise(state.query)) {
            list = list.filter(function (team) {
                return U.matchesQuery(team, state.query, [
                    "name", "shortName", "location", "group", "id"
                ]);
            });
        }

        return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    /* -------------------------
       Card rendering
       ------------------------- */

    function tournamentText(team) {
        var ids = Array.isArray(team.tournamentIds) ? team.tournamentIds : [];
        if (!ids.length) return "Not registered in a competition yet";

        var names = ids.map(function (id) {
            var tournament = U.tournamentById(id);
            return tournament ? tournament.name : "Competition to be confirmed";
        });

        return names.join(", ");
    }

    function officialMarkup(team) {
        var manager = team.manager;

        if (!manager || manager.public === false) {
            return '<div class="team-official is-private">' + U.icon("lock") +
                "<span>Team official details are not published for this team.</span></div>";
        }

        return '<div class="team-official">' + U.icon("users") +
            "<span>" + U.escapeHtml(manager.role) + ": <strong>" +
            U.escapeHtml(manager.name) + "</strong></span></div>";
    }

    function cardMarkup(team) {
        var tournament = Array.isArray(team.tournamentIds) && team.tournamentIds.length
            ? U.tournamentById(team.tournamentIds[0])
            : null;

        return '<article class="card team-card">' +
            '<div class="team-card-head">' +
                '<div class="team-identity">' + U.crestMarkup(team, "lg") +
                    '<span class="team-identity-text"><strong>' + U.escapeHtml(team.name) +
                        "</strong><span>" + U.escapeHtml(team.shortName) + "</span></span>" +
                "</div>" +
                U.statusBadge(team.status, team.status === "approved" ? "Confirmed" : "Pending review") +
            "</div>" +
            '<div class="team-participation">' +
                "<div>" + U.icon("trophy") + "<span>" + U.escapeHtml(U.categoryName(team.categoryId)) +
                    "</span></div>" +
                "<div>" + U.icon("flag") + "<span>" + U.escapeHtml(team.group || "Group to be confirmed") +
                    "</span></div>" +
                "<div>" + U.icon("calendar") + "<span>" + U.escapeHtml(tournamentText(team)) + "</span></div>" +
                "<div>" + U.icon("pin") + "<span>" + U.escapeHtml(team.location) + "</span></div>" +
            "</div>" +
            officialMarkup(team) +
            '<div class="card-actions">' +
                '<a class="btn btn-dark-outline btn-sm" href="/team-details/?team=' +
                    encodeURIComponent(team.id) + '">View Team Profile</a>' +
            "</div>" +
            (tournament
                ? ""
                : '<p class="form-note">This team is not attached to a published competition yet.</p>') +
        "</article>";
    }

    /* -------------------------
       Summary and empty state
       ------------------------- */

    function metaMarkup(count) {
        var parts = [];
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;

        if (tournament) parts.push(tournament.name);
        if (state.query) parts.push('"' + state.query + '"');

        return '<div class="result-count"><span>Showing <strong>' + count + "</strong> " +
            (count === 1 ? "team" : "teams") + "</span>" +
            parts.map(function (label) {
                return '<span class="badge">' + U.escapeHtml(label) + "</span>";
            }).join("") +
        "</div>";
    }

    function emptyMarkup() {
        return '<div class="team-grid-empty">' + U.emptyState({
            icon: "users",
            title: "No approved teams to display",
            message: "Teams appear here after a manager submits their registration and an administrator approves it.",
            actionLabel: "Reset filters"
        }) + "</div>";
    }

    function populateOptions() {
        var teams = publicTeams();
        var usedTournaments = {};

        teams.forEach(function (team) {
            (team.tournamentIds || []).forEach(function (id) { usedTournaments[id] = true; });
        });

        var tournaments = (Data.tournaments || []).filter(function (tournament) {
            return usedTournaments[tournament.id];
        });

        U.fillSelect(document.getElementById("filterTournament"), tournaments, {
            placeholder: "All tournaments",
            label: function (item) { return item.name + " (" + item.season + ")"; }
        });
    }

    /* -------------------------
       Bindings and render loop
       ------------------------- */

    function syncFromControls() {
        var values = U.readFilters(els.scope || document);
        state.query = values.query || "";
        state.tournamentId = values.tournamentId || "";
    }

    function render() {
        var list = filteredList();
        var page = U.paginate(list, state.page, state.perPage);
        state.page = page.page;

        els.grid.innerHTML = page.items.length
            ? page.items.map(cardMarkup).join("")
            : emptyMarkup();

        var resetButton = els.grid.querySelector("[data-empty-action]");
        if (resetButton) U.on(resetButton, "click", resetFilters);

        if (els.meta) els.meta.innerHTML = metaMarkup(list.length);
        if (els.total) {
            els.total.textContent = list.length + (list.length === 1 ? " team" : " teams");
        }

        if (list.length) {
            U.renderPagination(els.pagination, page, function (next) {
                state.page = next;
                render();
            });
        } else if (els.pagination) {
            els.pagination.innerHTML = "";
        }
    }

    function bindQuickFilters() {
        U.$$("[data-team-quick]").forEach(function (chip) {
            U.on(chip, "click", function () {
                state.quick = chip.getAttribute("data-team-quick");
                state.page = 1;

                U.$$("[data-team-quick]").forEach(function (other) {
                    var isActive = other === chip;
                    other.classList.toggle("is-active", isActive);
                    other.setAttribute("aria-pressed", String(isActive));
                });

                render();
            });
        });
    }

    function resetFilters() {
        state.quick = "all";
        state.query = "";
        state.tournamentId = "";
        state.page = 1;

        U.$$("[data-team-quick]").forEach(function (chip) {
            var isAll = chip.getAttribute("data-team-quick") === "all";
            chip.classList.toggle("is-active", isAll);
            chip.setAttribute("aria-pressed", String(isAll));
        });

        U.$$("[data-filter]", els.scope || document).forEach(function (control) {
            control.value = control.defaultValue || "";
        });

        render();
    }

    /* Deep links: /teams/?tournament=TRN-2026-MEN or ?category=CAT-WOMEN-OPEN */
    function applyDeepLinks() {
        var tournament = U.getParam("tournament") || U.getParam("tournamentId");
        var category = U.getParam("category");

        if (tournament) {
            var tournamentControl = document.getElementById("filterTournament");
            if (tournamentControl) tournamentControl.value = tournament;
        }

        if (category) {
            var categoryRecord = U.categoryById(category);
            if (categoryRecord) {
                state.quick = categoryRecord.guardianConsent
                    ? "youth"
                    : categoryRecord.gender === "female" ? "women" : "men";
                U.$$("[data-team-quick]").forEach(function (chip) {
                    var isActive = chip.getAttribute("data-team-quick") === state.quick;
                    chip.classList.toggle("is-active", isActive);
                    chip.setAttribute("aria-pressed", String(isActive));
                });
            }
        }
    }

    function init() {
        els.grid = document.getElementById("teamGrid");
        if (!els.grid) return;

        els.meta = document.getElementById("resultMeta");
        els.pagination = document.getElementById("teamPagination");
        els.notice = document.getElementById("dataNotice");
        els.total = document.getElementById("teamTotal");
        els.scope = document.getElementById("teamFilters");

        if (els.notice) {
            els.notice.innerHTML = '<div class="notice-bar" role="note">' + U.icon("info") +
                "<span>Directory entries are live manager submissions approved by an administrator.</span></div>";
        }

        populateOptions();
        bindQuickFilters();
        applyDeepLinks();

        U.bindFilters(els.scope, function () {
            state.page = 1;
            syncFromControls();
            render();
        });

        var resetButton = els.scope.querySelector("[data-filter-reset]");
        U.on(resetButton, "click", function () {
            state.quick = "all";
            U.$$("[data-team-quick]").forEach(function (chip) {
                var isAll = chip.getAttribute("data-team-quick") === "all";
                chip.classList.toggle("is-active", isAll);
                chip.setAttribute("aria-pressed", String(isAll));
            });
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
