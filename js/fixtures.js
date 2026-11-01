/* =========================================
   ANGUTSA CHAMPIONSHIP — FIXTURES
   Behaviour for /fixtures/.
   Fixtures and live scores are loaded from the public API.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        view: "list",
        quick: "all",
        query: "",
        tournamentId: "",
        categoryId: "",
        group: "",
        round: "",
        teamId: "",
        status: "",
        date: "",
        month: null,
        liveError: "",
        liveRequestPending: false,
        liveTimer: null
    };

    var els = {};

    /* -------------------------
       Date helpers and filtering
       ------------------------- */

    function startOfDay(date) {
        var copy = new Date(date);
        copy.setHours(0, 0, 0, 0);
        return copy;
    }

    function addDays(date, days) {
        var copy = new Date(date);
        copy.setDate(copy.getDate() + days);
        return copy;
    }

    function searchableFields(match) {
        var home = U.teamById(match.homeTeamId);
        var away = U.teamById(match.awayTeamId);
        var tournament = U.tournamentById(match.tournamentId);

        return [
            match.id, match.round, match.stage, match.group, match.venue, match.note,
            home ? home.name : "to be confirmed",
            away ? away.name : "to be confirmed",
            tournament ? tournament.name : ""
        ].join(" | ");
    }

    function applyQuick(list) {
        var today = startOfDay(new Date());

        if (state.quick === "upcoming") {
            return list.filter(function (match) {
                return match.status === "scheduled" && new Date(match.kickoff) >= today;
            });
        }

        if (state.quick === "today") {
            return list.filter(function (match) {
                return startOfDay(new Date(match.kickoff)).getTime() === today.getTime();
            });
        }

        if (state.quick === "week") {
            var limit = addDays(today, 7).getTime();
            return list.filter(function (match) {
                var kickoff = new Date(match.kickoff).getTime();
                return kickoff >= today.getTime() && kickoff <= limit;
            });
        }

        if (state.quick === "completed") {
            return list.filter(function (match) { return match.status === "completed"; });
        }

        if (state.quick === "live") {
            return list.filter(function (match) { return match.status === "live"; });
        }

        return list;
    }

    function filteredList() {
        var list = U.filterMatches(Data.matches || [], {
            tournamentId: state.tournamentId,
            categoryId: state.categoryId,
            group: state.group,
            round: state.round,
            teamId: state.teamId,
            status: state.status
        });

        if (state.date) {
            list = list.filter(function (match) {
                return String(match.kickoff).slice(0, 10) === state.date;
            });
        }

        if (U.normalise(state.query)) {
            list = list.filter(function (match) {
                return U.normalise(searchableFields(match)).indexOf(U.normalise(state.query)) > -1;
            });
        }

        return U.sortMatchesByKickoff(applyQuick(list), "asc");
    }

    /* -------------------------
       List view rendering
       ------------------------- */

    function dayKey(match) {
        return String(match.kickoff).slice(0, 10);
    }

    function groupByDay(list) {
        var groups = [];
        var index = {};

        list.forEach(function (match) {
            var key = dayKey(match);
            if (!index[key]) {
                index[key] = { key: key, matches: [] };
                groups.push(index[key]);
            }
            index[key].matches.push(match);
        });

        return groups;
    }

    function teamBlock(teamId, side, championLabel) {
        var team = U.teamById(teamId);
        var sideClass = side === "away" ? " is-away" : "";

        if (!team) {
            return '<div class="match-team is-pending' + sideClass + '">' +
                '<span class="crest" aria-hidden="true">?</span>' +
                '<span class="match-team-name">To be confirmed<small>Pending results</small></span>' +
            "</div>";
        }

        return '<div class="match-team' + sideClass +
            (championLabel ? " is-season-champion" : "") + '">' +
            U.crestMarkup(team, "sm") +
            '<span class="match-team-name">' + U.escapeHtml(team.name) +
                "<small>" + U.escapeHtml(team.shortName) + "</small>" +
                (championLabel
                    ? '<span class="season-champion-badge">' + U.icon("trophy") +
                        "<span>" + U.escapeHtml(championLabel) + "</span></span>"
                    : "") +
            "</span>" +
        "</div>";
    }

    function liveClockLabel(match) {
        if (match.livePeriod === "halftime") return "HALF-TIME";
        if (match.livePeriod === "full_time") return "FULL TIME";
        var minute = Number(match.liveMinute || 0);
        return minute > 90
            ? "LIVE · 90+" + (minute - 90) + "'"
            : "LIVE · " + minute + "'";
    }

    function scoreBlock(match) {
        if ((match.status === "completed" || match.status === "live") &&
            match.homeScore !== null && match.homeScore !== undefined &&
            match.awayScore !== null && match.awayScore !== undefined) {
            var tieBreakDetails = "";
            if (match.tieBreakMethod === "extra-time") {
                tieBreakDetails = "After extra time: " + match.homeExtraTimeScore + "–" +
                    match.awayExtraTimeScore;
            } else if (match.tieBreakMethod === "penalties") {
                tieBreakDetails = "After extra time: " + match.homeExtraTimeScore + "–" +
                    match.awayExtraTimeScore + " · penalties: " + match.homePenaltiesScore +
                    "–" + match.awayPenaltiesScore;
            }
            return '<div class="match-score-wrap' + (match.status === "live" ? " is-live" : "") + '">' +
                (match.status === "live"
                    ? '<small class="match-live-minute">' +
                        U.escapeHtml(liveClockLabel(match)) + "</small>"
                    : "") +
                '<div class="match-score" aria-label="Score ' +
                match.homeScore + " to " + match.awayScore + '">' + match.homeScore +
                "<span>&ndash;</span>" + match.awayScore + "</div>" + (tieBreakDetails
                    ? '<small class="match-tie-break">' + U.escapeHtml(tieBreakDetails) + "</small>"
                    : "") + "</div>";
        }

        return '<div class="match-score is-pending">vs</div>';
    }

    function readableStageLabel(stage) {
        var key = String(stage || "").trim().toLowerCase();
        var labels = {
            "round-of-16": "Round of 16",
            "quarter-finals": "Quarter-finals",
            "semi-finals": "Semi-finals",
            "third-place-playoff": "Third-place playoff"
        };
        if (labels[key]) return labels[key];
        return String(stage || "Fixture").trim().replace(/[-_]+/g, " ")
            .replace(/\b[a-z]/g, function (letter) { return letter.toUpperCase(); });
    }

    function matchCardMarkup(match) {
        var tournament = U.tournamentById(match.tournamentId);
        var stage = String(match.stage || "").trim();
        var stageLabel = readableStageLabel(stage);
        var label = match.group ? match.group : stageLabel;
        var round = String(match.round || "Fixture").trim();
        var isFinal = stage.toLowerCase() === "final";
        var finalWinnerId = isFinal && match.status === "completed" &&
            match.homeScore !== null && match.awayScore !== null
            ? U.matchWinnerTeamId(match) : null;
        var isChampionFinal = Boolean(finalWinnerId);
        var championLabel = tournament && tournament.season
            ? tournament.season + " Season Champion" : "Season Champion";
        if (!match.group && stage) {
            var stagePrefixes = [stage, stageLabel];
            for (var index = 0; index < stagePrefixes.length; index += 1) {
                var stagePrefix = stagePrefixes[index] + " - ";
                if (round.toLowerCase().indexOf(stagePrefix.toLowerCase()) === 0) {
                    var distinctRound = round.slice(stagePrefix.length).trim();
                    if (distinctRound) {
                        round = distinctRound;
                        break;
                    }
                }
            }
        }

        return '<article class="match-card' + (isFinal ? " is-final-match" : "") +
            (isChampionFinal ? " is-champion-final" : "") + '">' +
            '<div class="match-card-head">' +
                '<div class="match-card-heading">' +
                    (isFinal
                        ? '<span class="final-match-badge">' + U.icon("trophy") +
                            '<span>Championship final</span></span>'
                        : "") +
                    '<span class="stage-label">' + U.escapeHtml(label) + " &middot; " +
                        U.escapeHtml(round) + "</span>" +
                "</div>" +
                U.statusBadge(match.status, match.status === "live"
                    ? liveClockLabel(match) : U.matchStatusLabel(match.status)) +
            "</div>" +
            '<div class="match-card-body">' +
                teamBlock(match.homeTeamId, "home",
                    finalWinnerId && finalWinnerId === match.homeTeamId ? championLabel : "") +
                scoreBlock(match) +
                teamBlock(match.awayTeamId, "away",
                    finalWinnerId && finalWinnerId === match.awayTeamId ? championLabel : "") +
            "</div>" +
            '<div class="match-card-foot">' +
                '<span class="match-meta">' +
                    "<span>" + U.icon("clock") + U.formatTime(match.kickoff) + "</span>" +
                    "<span>" + U.icon("pin") + U.escapeHtml(match.venue) + "</span>" +
                    (tournament
                        ? "<span>" + U.icon("trophy") + U.escapeHtml(tournament.name) + "</span>"
                        : "") +
                "</span>" +
                '<span class="match-card-actions">' +
                '<a class="btn btn-dark-outline btn-sm" href="/match-center/?match=' +
                    encodeURIComponent(match.id) + '">Match details</a>' +
                '<button type="button" class="btn btn-primary btn-sm" data-match-share="' +
                    U.escapeHtml(match.id) + '">Share image</button>' +
                "</span>" +
            "</div>" +
            (match.note
                ? '<p class="inline-note match-note">' + U.escapeHtml(match.note) + "</p>"
                : "") +
        "</article>";
    }

    function listMarkup(list) {
        return groupByDay(list).map(function (group) {
            return '<section class="fixture-day-group">' +
                '<h3 class="fixture-day">' + U.escapeHtml(U.formatDate(group.key)) +
                    "<span>" + group.matches.length +
                    (group.matches.length === 1 ? " fixture" : " fixtures") + "</span>" +
                "</h3>" +
                group.matches.map(matchCardMarkup).join("") +
            "</section>";
        }).join("");
    }

    /* -------------------------
       Calendar view
       ------------------------- */

    var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"];

    function pad(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function isoKey(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    function monthStart(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function calendarCells(month) {
        var first = monthStart(month);
        var offset = (first.getDay() + 6) % 7; /* Monday first */
        var start = addDays(first, -offset);
        var cells = [];

        for (var index = 0; index < 42; index += 1) {
            cells.push(addDays(start, index));
        }

        return cells;
    }

    function calendarMatches(list, month) {
        return list.filter(function (match) {
            var kickoff = new Date(match.kickoff);
            return kickoff.getMonth() === month.getMonth() && kickoff.getFullYear() === month.getFullYear();
        });
    }

    function renderCalendar(list) {
        var month = state.month || monthStart(new Date());
        state.month = month;

        var cells = calendarCells(month);
        var today = isoKey(new Date());
        var monthMatches = calendarMatches(list, month);

        if (els.calendarTitle) {
            var dayCount = groupByDay(monthMatches).length;
            els.calendarTitle.textContent = MONTH_NAMES[month.getMonth()] + " " + month.getFullYear() +
                " (" + monthMatches.length + (monthMatches.length === 1 ? " fixture" : " fixtures") +
                " on " + dayCount + (dayCount === 1 ? " day)" : " days)");
        }

        els.calendarGrid.innerHTML = cells.map(function (day) {
            var key = isoKey(day);
            var outside = day.getMonth() !== month.getMonth();
            var dayMatches = monthMatches.filter(function (match) { return dayKey(match) === key; });

            var events = dayMatches.map(function (match) {
                var home = U.teamById(match.homeTeamId);
                var away = U.teamById(match.awayTeamId);
                var isFinal = String(match.stage || "").toLowerCase() === "final";
                var tone = (match.status === "completed" ? " is-completed" : "") +
                    (match.status === "live" ? " is-live" : "") +
                    (isFinal ? " is-final-match" : "");
                var score = "";
                if ((match.status === "completed" || match.status === "live") &&
                    match.homeScore !== null && match.awayScore !== null) {
                    score = " " + match.homeScore + "-" + match.awayScore;
                }
                if (match.status === "live") score += " · " + liveClockLabel(match);

                return '<a class="calendar-event' + tone + '" href="/match-center/?match=' +
                    encodeURIComponent(match.id) + '" title="' +
                    U.escapeHtml(match.venue) + '">' +
                    U.formatTime(match.kickoff) + " " +
                    U.escapeHtml(home ? home.shortName : "TBC") + " v " +
                    U.escapeHtml(away ? away.shortName : "TBC") + score +
                "</a>";
            }).join("");

            var note = !outside && !events
                ? '<span class="calendar-note">No fixtures</span>'
                : "";

            var classes = "calendar-day" +
                (outside ? " is-muted" : "") +
                (key === today ? " is-today" : "");

            return '<div class="' + classes + '" role="gridcell" aria-label="' +
                U.escapeHtml(U.formatDate(day)) + '">' +
                '<span class="calendar-day-number">' + day.getDate() + "</span>" +
                events + note +
            "</div>";
        }).join("");

        if (els.calendarEmpty) {
            els.calendarEmpty.innerHTML = monthMatches.length
                ? ""
                : U.emptyState({
                    icon: "calendar",
                    title: "No fixtures in " + MONTH_NAMES[month.getMonth()] + " " + month.getFullYear(),
                    message: "Use the arrows to move to another month, or clear the filters to see the full fixture list.",
                    actionLabel: "Show all fixtures"
                });

            var resetButton = els.calendarEmpty.querySelector("[data-empty-action]");
            if (resetButton) U.on(resetButton, "click", resetFilters);
        }
    }

    /* -------------------------
       View switching and bindings
       ------------------------- */

    function setView(view) {
        state.view = view === "calendar" ? "calendar" : "list";
        U.setPref("fixtureView", state.view);

        U.$$("[data-view]").forEach(function (chip) {
            var isActive = chip.getAttribute("data-view") === state.view;
            chip.classList.toggle("is-active", isActive);
            chip.setAttribute("aria-pressed", String(isActive));
        });

        if (els.listView) els.listView.hidden = state.view !== "list";
        if (els.calendarView) els.calendarView.hidden = state.view !== "calendar";
    }

    function bindViewSwitch() {
        U.$$("[data-view]").forEach(function (chip) {
            U.on(chip, "click", function () {
                setView(chip.getAttribute("data-view"));
                render();
            });
        });
    }

    function bindQuickFilters() {
        U.$$("[data-quick]").forEach(function (chip) {
            U.on(chip, "click", function () {
                state.quick = chip.getAttribute("data-quick");

                U.$$("[data-quick]").forEach(function (other) {
                    var isActive = other === chip;
                    other.classList.toggle("is-active", isActive);
                    other.setAttribute("aria-pressed", String(isActive));
                });

                render();
            });
        });
    }

    function bindCalendarNav() {
        U.on(els.calendarPrev, "click", function () {
            var month = state.month || monthStart(new Date());
            state.month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
            render();
        });

        U.on(els.calendarNext, "click", function () {
            var month = state.month || monthStart(new Date());
            state.month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            render();
        });

        U.on(els.calendarToday, "click", function () {
            state.month = monthStart(new Date());
            render();
        });
    }

    /* -------------------------
       Supporting content
       ------------------------- */

    function liveNotice() {
        if (state.liveError) {
            return '<div class="alert alert-warning" role="status">' +
                U.icon("alert") + "<span>Live scores could not be refreshed. Retrying automatically.</span></div>";
        }
        if (state.quick !== "live") return "";
        return '<div class="alert alert-info" role="status">' +
            U.icon("info") + "<span>Live scores and goal events refresh automatically while this page is open.</span></div>";
    }

    async function refreshLiveMatches() {
        if (state.liveRequestPending || document.visibilityState === "hidden") return;
        if (state.liveTimer) window.clearTimeout(state.liveTimer);
        state.liveRequestPending = true;
        try {
            var platform = await window.AngutsaPlatformReady;
            if (!platform) throw window.AngutsaPlatformError || new Error("The public match service is unavailable.");
            var url = new URLSearchParams();
            (Data.matches || []).filter(function (match) {
                return match.status === "live";
            }).slice(0, 100).forEach(function (match) {
                url.append("matchId", match.id);
            });
            var path = "/public/live-matches" +
                (url.toString() ? "?" + url.toString() : "");
            var updates = await platform.request(path);
            if (!Array.isArray(updates)) {
                throw new Error("The live-match service returned an invalid response.");
            }
            updates.forEach(function (update) {
                var match = U.matchById(update.id);
                if (match) Object.assign(match, update);
                else Data.matches.push(update);
            });
            state.liveError = "";
            render();
        } catch (error) {
            state.liveError = error && error.message ? error.message : "Live scores are unavailable.";
            console.error("Live match updates could not be loaded.", error);
            if (state.quick === "live") render();
        } finally {
            state.liveRequestPending = false;
            scheduleLiveRefresh();
        }
    }

    function scheduleLiveRefresh() {
        if (state.liveTimer) window.clearTimeout(state.liveTimer);
        if (document.visibilityState === "hidden") return;
        var hasLiveMatch = (Data.matches || []).some(function (match) {
            return match.status === "live";
        });
        var delay = state.liveError ? 30000 : hasLiveMatch ? 15000 : 60000;
        state.liveTimer = window.setTimeout(refreshLiveMatches, delay);
    }

    function metaMarkup(count) {
        var parts = [count + (count === 1 ? " fixture" : " fixtures")];
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var category = state.categoryId ? U.categoryById(state.categoryId) : null;

        if (tournament) parts.push(tournament.name);
        if (category) parts.push(category.name);
        if (state.group) parts.push(state.group);
        if (state.round) parts.push(state.round);
        if (state.date) parts.push(U.formatDate(state.date));
        if (state.view === "calendar") parts.push("calendar view");

        return '<div class="result-count"><span>Showing <strong>' + parts[0] + "</strong></span>" +
            parts.slice(1).map(function (label) {
                return '<span class="badge">' + U.escapeHtml(label) + "</span>";
            }).join("") +
        "</div>";
    }

    function populateOptions() {
        var teams = (Data.teams || []).filter(function (team) { return team.status !== "rejected"; });

        U.fillSelect(document.getElementById("filterTournament"), Data.tournaments || [], {
            placeholder: "All tournaments",
            label: function (item) { return item.name + " (" + item.season + ")"; }
        });

        U.fillSelect(document.getElementById("filterCategory"), Data.categories || [], {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        U.fillSelect(document.getElementById("filterTeam"), teams, {
            placeholder: "All teams",
            label: function (item) { return item.name; }
        });

        var stages = {};
        var rounds = {};
        (Data.matches || []).forEach(function (match) {
            stages[match.group || match.stage] = true;
            rounds[match.round] = true;
        });

        U.fillSelect(document.getElementById("filterGroup"), Object.keys(stages).sort(), {
            placeholder: "All groups",
            value: function (value) { return value; },
            label: function (value) { return value; }
        });

        U.fillSelect(document.getElementById("filterRound"), Object.keys(rounds), {
            placeholder: "All rounds",
            value: function (value) { return value; },
            label: function (value) { return value; }
        });
    }

    /* -------------------------
       Render loop and initialisation
       ------------------------- */

    function syncFromControls() {
        var values = U.readFilters(els.scope || document);
        state.query = values.query || "";
        state.tournamentId = values.tournamentId || "";
        state.categoryId = values.categoryId || "";
        state.group = values.group || "";
        state.round = values.round || "";
        state.teamId = values.teamId || "";
        state.status = values.status || "";
        state.date = values.date || "";
    }

    function emptyMarkup() {
        return U.emptyState({
            icon: "calendar",
            title: "No fixtures match these filters",
            message: "Try another tournament, category or date range, or clear the filters to see every published fixture.",
            actionLabel: "Reset filters"
        });
    }

    function render() {
        var list = filteredList();

        if (els.meta) els.meta.innerHTML = metaMarkup(list.length);
        if (els.liveNotice) els.liveNotice.innerHTML = liveNotice();
        if (els.viewMeta) {
            els.viewMeta.textContent = list.length + (list.length === 1 ? " fixture" : " fixtures") +
                " for the current filters";
        }

        if (state.view === "calendar") {
            renderCalendar(list);
            return;
        }

        els.fixtureList.innerHTML = list.length ? listMarkup(list) : "";
        els.listEmpty.innerHTML = list.length ? "" : emptyMarkup();

        var resetButton = els.listEmpty.querySelector("[data-empty-action]");
        if (resetButton) U.on(resetButton, "click", resetFilters);
    }

    function resetFilters() {
        state.query = "";
        state.tournamentId = "";
        state.categoryId = "";
        state.group = "";
        state.round = "";
        state.teamId = "";
        state.status = "";
        state.date = "";
        state.quick = "all";

        U.$$("[data-quick]").forEach(function (chip) {
            var isAll = chip.getAttribute("data-quick") === "all";
            chip.classList.toggle("is-active", isAll);
            chip.setAttribute("aria-pressed", String(isAll));
        });

        U.$$("[data-filter]", els.scope || document).forEach(function (control) {
            control.value = control.defaultValue || "";
        });

        render();
    }

    /* Deep links: /fixtures/?tournament=TRN-2026-MEN&status=scheduled */
    function applyDeepLinks() {
        var tournament = U.getParam("tournament") || U.getParam("tournamentId");
        var category = U.getParam("category");
        var quick = U.getParam("quick");
        var view = U.getParam("view");

        if (tournament) {
            var tournamentControl = document.getElementById("filterTournament");
            if (tournamentControl) tournamentControl.value = tournament;
        }

        if (category) {
            var categoryControl = document.getElementById("filterCategory");
            if (categoryControl) categoryControl.value = category;
        }

        if (quick) {
            var chip = document.querySelector('[data-quick="' + quick + '"]');
            if (chip) {
                state.quick = quick;
                U.$$("[data-quick]").forEach(function (other) {
                    var isActive = other === chip;
                    other.classList.toggle("is-active", isActive);
                    other.setAttribute("aria-pressed", String(isActive));
                });
            }
        }

        if (view === "calendar" || view === "list") {
            setView(view);
        }
    }

    function init() {
        els.listView = document.getElementById("listView");
        els.fixtureList = document.getElementById("fixtureList");
        if (!els.fixtureList) return;

        els.listEmpty = document.getElementById("listEmpty");
        els.calendarView = document.getElementById("calendarView");
        els.calendarGrid = document.getElementById("calendarGrid");
        els.calendarTitle = document.getElementById("calendarTitle");
        els.calendarEmpty = document.getElementById("calendarEmpty");
        els.calendarPrev = document.getElementById("calendarPrev");
        els.calendarNext = document.getElementById("calendarNext");
        els.calendarToday = document.getElementById("calendarToday");
        els.meta = document.getElementById("resultMeta");
        els.viewMeta = document.getElementById("viewMeta");
        els.notice = document.getElementById("dataNotice");
        els.liveNotice = document.getElementById("liveNotice");
        els.scope = document.getElementById("fixtureFilters");

        populateOptions();

        state.view = U.getPref("fixtureView", "list");
        setView(state.view);

        bindViewSwitch();
        bindQuickFilters();
        bindCalendarNav();
        applyDeepLinks();

        U.bindFilters(els.scope, function () {
            syncFromControls();
            render();
        });

        syncFromControls();
        render();
        U.on(document, "visibilitychange", function () {
            if (document.visibilityState === "visible") refreshLiveMatches();
            else if (state.liveTimer) window.clearTimeout(state.liveTimer);
        });
        U.on(window, "pagehide", function () {
            if (state.liveTimer) window.clearTimeout(state.liveTimer);
        });
        window.setTimeout(refreshLiveMatches, 0);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }




})();
