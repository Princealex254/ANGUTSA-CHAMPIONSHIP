/* =========================================
   ANGUTSA CHAMPIONSHIP — RESULTS
   Behaviour for /results/.
   Results come from js/data.js (demonstration data) and are only
   ever displayed. Scores are never calculated in the browser.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        quick: "all",
        query: "",
        tournamentId: "",
        categoryId: "",
        round: "",
        from: "",
        to: "",
        page: 1,
        perPage: 6
    };

    var els = {};

    /* -------------------------
       Filtering
       ------------------------- */

    function completedMatches() {
        return (Data.matches || []).filter(function (match) {
            return match.status === "completed" &&
                match.homeScore !== null && match.awayScore !== null &&
                match.homeTeamId && match.awayTeamId;
        });
    }

    function finalScore(match, isHome) {
        var extraTimeScore = isHome ? match.homeExtraTimeScore : match.awayExtraTimeScore;
        return match.tieBreakMethod && extraTimeScore !== null && extraTimeScore !== undefined
            ? extraTimeScore
            : isHome ? match.homeScore : match.awayScore;
    }

    function applyQuick(list) {
        if (state.quick === "recent") {
            var limit = new Date();
            limit.setDate(limit.getDate() - 30);
            return list.filter(function (match) {
                return new Date(match.kickoff) >= limit;
            });
        }

        if (state.quick === "highscoring") {
            return list.filter(function (match) {
                return finalScore(match, true) + finalScore(match, false) >= 5;
            });
        }

        if (state.quick === "draws") {
            return list.filter(function (match) {
                return winnerOf(match) === null;
            });
        }

        return list;
    }

    function searchableFields(match) {
        var home = U.teamById(match.homeTeamId);
        var away = U.teamById(match.awayTeamId);
        var tournament = U.tournamentById(match.tournamentId);

        return [
            match.id, match.round, match.stage, match.group, match.venue,
            home ? home.name : "", away ? away.name : "",
            tournament ? tournament.name : ""
        ].join(" | ");
    }

    function filteredList() {
        var list = completedMatches();

        list = U.filterMatches(list, {
            tournamentId: state.tournamentId,
            categoryId: state.categoryId,
            round: state.round
        });

        if (state.from) {
            list = list.filter(function (match) {
                return String(match.kickoff).slice(0, 10) >= state.from;
            });
        }

        if (state.to) {
            list = list.filter(function (match) {
                return String(match.kickoff).slice(0, 10) <= state.to;
            });
        }

        if (U.normalise(state.query)) {
            list = list.filter(function (match) {
                return U.normalise(searchableFields(match)).indexOf(U.normalise(state.query)) > -1;
            });
        }

        /* Most recent results first. */
        return U.sortMatchesByKickoff(applyQuick(list), "desc");
    }

    /* -------------------------
       Result markup
       ------------------------- */

    function winnerOf(match) {
        return U.matchWinnerTeamId(match);
    }

    function tieBreakLabel(match) {
        if (match.tieBreakMethod === "extra-time") {
            return "After extra time: " + match.homeExtraTimeScore + "–" + match.awayExtraTimeScore;
        }
        if (match.tieBreakMethod === "penalties") {
            return "After extra time: " + match.homeExtraTimeScore + "–" +
                match.awayExtraTimeScore + " · penalties: " + match.homePenaltiesScore +
                "–" + match.awayPenaltiesScore;
        }
        return "";
    }

    function scoreCell(match, extraClass) {
        var isDraw = winnerOf(match) === null;
        var tieBreak = tieBreakLabel(match);
        return '<span class="score-cell-wrap"><span class="score-cell' +
            (isDraw ? " is-draw" : "") + (extraClass ? " " + extraClass : "") + '">' +
            match.homeScore + " &ndash; " + match.awayScore + "</span>" +
            (tieBreak ? '<small class="match-tie-break">' + U.escapeHtml(tieBreak) + "</small>" : "") +
            "</span>";
    }

    function teamCell(teamId, alignRight) {
        var team = U.teamById(teamId);
        var marker = '<span class="crest crest-sm" style="--crest-accent:' +
            U.escapeHtml(team ? team.accent : "#5B4BBD") + '" aria-hidden="true">' +
            U.escapeHtml(team ? team.shortName : "?") + "</span>";

        if (!team) {
            return '<span class="team-cell"><strong>To be confirmed</strong></span>';
        }

        return '<span class="team-cell"' + (alignRight ? ' style="justify-content:flex-end"' : "") + ">" +
            (alignRight ? "" : marker) +
            "<strong>" + U.escapeHtml(team.name) + "</strong>" +
            (alignRight ? marker : "") +
        "</span>";
    }

    function resultCardMarkup(match) {
        var tournament = U.tournamentById(match.tournamentId);
        var home = U.teamById(match.homeTeamId);
        var away = U.teamById(match.awayTeamId);
        var winner = winnerOf(match);
        var isFinal = String(match.stage || "").trim().toLowerCase() === "final";
        var isChampionFinal = isFinal && Boolean(winner);
        var championLabel = tournament && tournament.season
            ? tournament.season + " Season Champion" : "Season Champion";
        var margin = Math.abs(match.homeScore - match.awayScore);
        var drawNote = match.tieBreakMethod === "penalties"
            ? "Scores level after extra time; the winner was decided by penalties."
            : match.tieBreakMethod === "extra-time"
                ? "Scores level at regulation time; the winner was decided after extra time."
                : "Scores level at full time.";

        return '<article class="match-card' + (isFinal ? " is-final-match" : "") +
            (isChampionFinal ? " is-champion-final" : "") + '">' +
            '<div class="match-card-head">' +
                '<span class="stage-label">' + U.escapeHtml(match.round) +
                    (match.group ? " &middot; " + U.escapeHtml(match.group) : "") + "</span>" +
                U.statusBadge("completed", U.matchStatusLabel("completed")) +
            "</div>" +
            '<div class="match-card-body">' +
                '<div class="match-team' +
                    (isChampionFinal && winner === match.homeTeamId ? " is-season-champion" : "") + '">' +
                    U.crestMarkup(home, "sm") +
                    '<span class="match-team-name">' + U.escapeHtml(home ? home.name : "To be confirmed") +
                        (isChampionFinal && winner === match.homeTeamId
                            ? '<span class="season-champion-badge">' + U.icon("trophy") +
                                "<span>" + U.escapeHtml(championLabel) + "</span></span>"
                            : "<small>" + (winner === match.homeTeamId ? "Winner" : "Full time") + "</small>") +
                    "</span>" +
                "</div>" +
                scoreCell(match) +
                '<div class="match-team is-away' +
                    (isChampionFinal && winner === match.awayTeamId ? " is-season-champion" : "") + '">' +
                    U.crestMarkup(away, "sm") +
                    '<span class="match-team-name">' + U.escapeHtml(away ? away.name : "To be confirmed") +
                        (isChampionFinal && winner === match.awayTeamId
                            ? '<span class="season-champion-badge">' + U.icon("trophy") +
                                "<span>" + U.escapeHtml(championLabel) + "</span></span>"
                            : "<small>" + (winner === match.awayTeamId ? "Winner" : "Full time") + "</small>") +
                    "</span>" +
                "</div>" +
            "</div>" +
            '<div class="match-card-foot">' +
                '<span class="match-meta">' +
                    "<span>" + U.icon("calendar") + U.formatDate(match.kickoff) + "</span>" +
                    "<span>" + U.icon("pin") + U.escapeHtml(match.venue) + "</span>" +
                    (tournament
                        ? "<span>" + U.icon("trophy") + U.escapeHtml(tournament.name) + "</span>"
                        : "") +
                "</span>" +
                '<span class="match-card-actions">' +
                '<a class="btn btn-dark-outline btn-sm" href="/match-center/?match=' +
                    encodeURIComponent(match.id) + '">View Match Details</a>' +
                '<button type="button" class="btn btn-primary btn-sm" data-match-share="' +
                    U.escapeHtml(match.id) + '">Share image</button>' +
                "</span>" +
            "</div>" +
            (margin === 0
                ? '<p class="inline-note match-note">' + U.escapeHtml(drawNote) + "</p>"
                : "") +
        "</article>";
    }

    function tableRowMarkup(match) {
        var winner = winnerOf(match);
        var roundLabel = match.round + (match.group ? " &middot; " + match.group : "");
        var rowClass = winner ? " class=\"is-winner\"" : "";

        return "<tr" + rowClass + ">" +
            '<td data-label="Date" data-sort-value="' + U.escapeHtml(String(match.kickoff).slice(0, 10)) + '">' +
                U.formatDate(match.kickoff) + "</td>" +
            '<td data-label="Round">' + roundLabel + "</td>" +
            '<td data-label="Home">' + teamCell(match.homeTeamId, false) + "</td>" +
            '<td data-label="Score" class="is-numeric">' + scoreCell(match) + "</td>" +
            '<td data-label="Away">' + teamCell(match.awayTeamId, true) + "</td>" +
            '<td data-label="Status">' + U.statusBadge("completed", U.matchStatusLabel("completed")) + "</td>" +
            '<td data-label="Details"><a class="link-btn" href="/match-center/?match=' +
                encodeURIComponent(match.id) + '">Match details</a></td>' +
        "</tr>";
    }

    /* -------------------------
       Rendering
       ------------------------- */

    function metaMarkup(count) {
        var parts = [count + (count === 1 ? " result" : " results")];
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var category = state.categoryId ? U.categoryById(state.categoryId) : null;

        if (tournament) parts.push(tournament.name);
        if (category) parts.push(category.name);
        if (state.round) parts.push(state.round);
        if (state.from) parts.push("from " + U.formatDate(state.from));
        if (state.to) parts.push("to " + U.formatDate(state.to));

        return '<div class="result-count"><span>Showing <strong>' + parts[0] + "</strong></span>" +
            parts.slice(1).map(function (label) {
                return '<span class="badge">' + U.escapeHtml(label) + "</span>";
            }).join("") +
        "</div>";
    }

    function emptyMarkup() {
        return U.emptyState({
            icon: "flag",
            title: "No published results match these filters",
            message: "Results appear here after the competitions office publishes them. Try another tournament or clear the filters.",
            actionLabel: "Reset filters"
        });
    }

    function populateOptions() {
        U.fillSelect(document.getElementById("filterTournament"), Data.tournaments || [], {
            placeholder: "All tournaments",
            label: function (item) { return item.name + " (" + item.season + ")"; }
        });

        U.fillSelect(document.getElementById("filterCategory"), Data.categories || [], {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        var rounds = {};
        completedMatches().forEach(function (match) { rounds[match.round] = true; });

        U.fillSelect(document.getElementById("filterRound"), Object.keys(rounds), {
            placeholder: "All rounds",
            value: function (value) { return value; },
            label: function (value) { return value; }
        });
    }

    function syncFromControls() {
        var values = U.readFilters(els.scope || document);
        state.query = values.query || "";
        state.tournamentId = values.tournamentId || "";
        state.categoryId = values.categoryId || "";
        state.round = values.round || "";
        state.from = values.from || "";
        state.to = values.to || "";
    }

    function render() {
        var list = filteredList();
        var page = U.paginate(list, state.page, state.perPage);
        state.page = page.page;

        if (els.meta) els.meta.innerHTML = metaMarkup(list.length);
        if (els.total) {
            els.total.textContent = list.length + (list.length === 1 ? " result" : " results");
        }

        els.grid.innerHTML = page.items.length
            ? page.items.map(resultCardMarkup).join("")
            : emptyMarkup();

        if (els.tableBody) els.tableBody.innerHTML = page.items.map(tableRowMarkup).join("");

        var resetButton = els.grid.querySelector("[data-empty-action]");
        if (resetButton) U.on(resetButton, "click", resetFilters);

        U.renderPagination(els.pagination, page, function (next) {
            state.page = next;
            render();
        });
    }

    /* -------------------------
       Bindings and initialisation
       ------------------------- */

    function bindQuickFilters() {
        U.$$("[data-result-filter]").forEach(function (chip) {
            U.on(chip, "click", function () {
                state.quick = chip.getAttribute("data-result-filter");
                state.page = 1;

                U.$$("[data-result-filter]").forEach(function (other) {
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
        state.categoryId = "";
        state.round = "";
        state.from = "";
        state.to = "";
        state.page = 1;

        U.$$("[data-result-filter]").forEach(function (chip) {
            var isAll = chip.getAttribute("data-result-filter") === "all";
            chip.classList.toggle("is-active", isAll);
            chip.setAttribute("aria-pressed", String(isAll));
        });

        U.$$("[data-filter]", els.scope || document).forEach(function (control) {
            control.value = control.defaultValue || "";
        });

        render();
    }

    /* Deep links: /results/?tournament=TRN-2026-MEN&round=Matchday 1 */
    function applyDeepLinks() {
        var tournament = U.getParam("tournament") || U.getParam("tournamentId");
        var category = U.getParam("category");
        var round = U.getParam("round");
        var quick = U.getParam("quick");

        if (tournament) {
            var tournamentControl = document.getElementById("filterTournament");
            if (tournamentControl) tournamentControl.value = tournament;
        }

        if (category) {
            var categoryControl = document.getElementById("filterCategory");
            if (categoryControl) categoryControl.value = category;
        }

        if (round) {
            var roundControl = document.getElementById("filterRound");
            if (roundControl) roundControl.value = round;
        }

        if (quick) {
            var chip = document.querySelector('[data-result-filter="' + quick + '"]');
            if (chip) {
                state.quick = quick;
                U.$$("[data-result-filter]").forEach(function (other) {
                    var isActive = other === chip;
                    other.classList.toggle("is-active", isActive);
                    other.setAttribute("aria-pressed", String(isActive));
                });
            }
        }
    }

    function init() {
        els.grid = document.getElementById("resultGrid");
        if (!els.grid) return;

        els.tableBody = document.getElementById("resultTableBody");
        els.meta = document.getElementById("resultMeta");
        els.pagination = document.getElementById("resultPagination");
        els.total = document.getElementById("resultTotal");
        els.notice = document.getElementById("dataNotice");
        els.scope = document.getElementById("resultFilters");

        populateOptions();
        bindQuickFilters();
        applyDeepLinks();

        U.on(document.getElementById("printResults"), "click", function () {
            window.print();
        });

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
