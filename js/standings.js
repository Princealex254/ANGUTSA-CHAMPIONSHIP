/* =========================================
   ANGUTSA CHAMPIONSHIP — STANDINGS
   Behaviour for /standings/.

   The table on this page is calculated in the browser from the
   demonstration results in js/data.js so the interface can be
   reviewed. It is NOT an official table: the backend will calculate
   and publish authoritative standings from verified results.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        tournamentId: "",
        categoryId: "",
        group: ""
    };

    var els = {};

    /* -------------------------
       Calculation helpers
       ------------------------- */

    function matchesForSelection() {
        return U.filterMatches((Data.matches || []).filter(U.isStandingsMatch), {
            tournamentId: state.tournamentId,
            categoryId: state.categoryId,
            group: state.group
        });
    }

    function groupsForTournament(tournamentId) {
        var groups = {};
        (Data.matches || []).forEach(function (match) {
            if (match.tournamentId !== tournamentId) return;
            if (match.group) groups[match.group] = true;
        });
        (Data.teams || []).forEach(function (team) {
            var teamGroup = team.groupByTournament
                ? team.groupByTournament[tournamentId]
                : team.group;
            if (teamGroup && Array.isArray(team.tournamentIds) &&
                team.tournamentIds.indexOf(tournamentId) !== -1) {
                groups[teamGroup] = true;
            }
        });
        return Object.keys(groups).sort();
    }

    function tableScopes(matches) {
        if (state.group) return [{ name: state.group, group: state.group }];
        var groups = groupsForTournament(state.tournamentId);
        var scopes = groups.map(function (group) {
            return { name: group, group: group };
        });
        if (!groups.length || matches.some(function (match) { return !match.group; })) {
            scopes.unshift({ name: "", group: "" });
        }
        return scopes;
    }

    /* Qualification places are configured per competition. The
       demonstration values are shown in the legend on the page. */
    function qualificationCounts(tournament) {
        var format = tournament ? tournament.format : "league";
        if (format === "group-knockout") return { qualify: 2, playoff: 1 };
        if (format === "knockout") return { qualify: 0, playoff: 0 };
        return { qualify: 1, playoff: 0 };
    }

    /* -------------------------
       Rendering
       ------------------------- */

    function rowMarkup(row, counts) {
        var markerClass = "is-out";
        var rowClass = "";

        if (row.position <= counts.qualify) {
            markerClass = "is-qualify";
            rowClass = "is-qualify";
        } else if (counts.playoff && row.position <= counts.qualify + counts.playoff) {
            markerClass = "is-playoff";
            rowClass = "is-playoff";
        }

        return '<tr class="' + rowClass + '">' +
            '<td data-label="Position"><span class="position-cell">' +
                '<span class="position-marker ' + markerClass + '" aria-hidden="true"></span>' +
                "<span>" + row.position + "</span>" +
            "</span></td>" +
            '<td data-label="Team"><span class="team-cell">' +
                '<span class="crest crest-sm" style="--crest-accent:' + U.escapeHtml(row.accent) +
                    '" aria-hidden="true">' + U.escapeHtml(row.shortName) + "</span>" +
                "<span><strong>" + U.escapeHtml(row.name) + "</strong><span>" +
                    U.escapeHtml(row.shortName) + "</span></span>" +
            "</span></td>" +
            '<td data-label="Played" class="is-numeric">' + row.played + "</td>" +
            '<td data-label="Won" class="is-numeric">' + row.won + "</td>" +
            '<td data-label="Drawn" class="is-numeric">' + row.drawn + "</td>" +
            '<td data-label="Lost" class="is-numeric">' + row.lost + "</td>" +
            '<td data-label="Goals for" class="is-numeric">' + row.goalsFor + "</td>" +
            '<td data-label="Goals against" class="is-numeric">' + row.goalsAgainst + "</td>" +
            '<td data-label="Goal difference" class="is-numeric">' +
                (row.difference > 0 ? "+" + row.difference : row.difference) + "</td>" +
            '<td data-label="Points" class="is-numeric">' + row.points + "</td>" +
            '<td data-label="Form">' + U.formMarkup(row.form) + "</td>" +
        "</tr>";
    }

    function summaryMarkup(table, matches, tournament) {
        var completed = matches.filter(function (match) {
            return match.status === "completed" && U.isStandingsMatch(match);
        });
        var goals = completed.reduce(function (total, match) {
            return total + (match.homeScore || 0) + (match.awayScore || 0);
        }, 0);
        var remaining = matches.filter(function (match) { return match.status === "scheduled"; });

        return '<div><strong>' + table.length + "</strong><span>Teams in table</span></div>" +
            "<div><strong>" + completed.length + "</strong><span>Matches played</span></div>" +
            "<div><strong>" + remaining.length + "</strong><span>Matches remaining</span></div>" +
            "<div><strong>" + goals + "</strong><span>Goals scored</span></div>" +
            (tournament ? "" : "");
    }

    function emptyMarkup(tournament) {
        if (!tournament) {
            return U.emptyState({
                icon: "chart",
                title: "Select a tournament to view its table",
                message: "Choose a competition above. Only competitions with published results have a table.",
                actionLabel: "View all tournaments",
                actionHref: "/tournaments/"
            });
        }

        return U.emptyState({
            icon: "chart",
            title: "No standings have been published yet",
            message: "This competition has no completed matches for the current selection, so no table can be calculated.",
            actionLabel: "View latest results",
            actionHref: "/results/"
        });
    }

    /* -------------------------
       Selectors and rendering
       ------------------------- */

    function populateSelectors() {
        U.fillSelect(els.tournament, Data.tournaments || [], {
            placeholder: "Select a tournament",
            label: function (item) { return item.name + " (" + item.season + ")"; }
        });

        U.fillSelect(els.category, Data.categories || [], {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        U.fillSelect(els.group, [], { placeholder: "All groups" });
    }

    /* The category list is limited to the category used by the selected
       competition so the two selectors always agree. */
    function refreshCategoryOptions() {
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var categories = Data.categories || [];

        if (tournament) {
            categories = categories.filter(function (category) {
                return category.id === tournament.categoryId;
            });
        }

        U.fillSelect(els.category, categories, {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        if (tournament && categories.length === 1) {
            els.category.value = tournament.categoryId;
            state.categoryId = tournament.categoryId;
        }
    }

    function refreshGroupOptions() {
        var groups = state.tournamentId ? groupsForTournament(state.tournamentId) : [];

        U.fillSelect(els.group, groups, {
            placeholder: groups.length ? "All groups" : "No groups configured",
            value: function (value) { return value; },
            label: function (value) { return value; }
        });

        if (groups.indexOf(state.group) === -1) {
            state.group = "";
            els.group.value = "";
        }
    }

    function syncFromControls() {
        state.tournamentId = els.tournament ? els.tournament.value : "";
        state.categoryId = els.category ? els.category.value : "";
        state.group = els.group ? els.group.value : "";
    }

    function render() {
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var matches = matchesForSelection();
        var tables = tournament ? tableScopes(matches).map(function (scope) {
            var scopedMatches = scope.group
                ? matches.filter(function (match) { return match.group === scope.group; })
                : matches.filter(function (match) { return !match.group; });
            return {
                name: scope.name,
                rows: U.computeStandings(scopedMatches, Data.teams, {
                    tournamentId: state.tournamentId,
                    categoryId: state.categoryId,
                    group: scope.group
                })
            };
        }).filter(function (item) { return item.rows.length; }) : [];

        if (els.summary) {
            var allRows = tables.reduce(function (rows, item) {
                return rows.concat(item.rows);
            }, []);
            els.summary.innerHTML = tournament ? summaryMarkup(
                allRows, matches, tournament
            ) : "";
        }

        if (els.meta) {
            var parts = [];
            var category = state.categoryId ? U.categoryById(state.categoryId) : null;

            if (tournament) parts.push(tournament.name);
            if (category) parts.push(category.name);
            if (state.group) parts.push(state.group);

            els.meta.innerHTML = parts.length
                ? '<div class="result-count"><span>Showing <strong>' +
                    (tables.length ? tables.reduce(function (total, item) {
                        return total + item.rows.length;
                    }, 0) + " teams" : "no teams") +
                    "</strong></span>" +
                    parts.map(function (label) {
                        return '<span class="badge">' + U.escapeHtml(label) + "</span>";
                    }).join("") +
                "</div>"
                : "";
        }

        var hasTable = tables.length > 0;
        els.tableWrap.hidden = !hasTable;
        els.empty.innerHTML = hasTable ? "" : emptyMarkup(tournament);

        if (!hasTable) return;

        var counts = qualificationCounts(tournament);
        els.tableWrap.innerHTML = '<div class="standings-table-groups">' +
            tables.map(function (item) {
            return '<div class="panel">' +
                '<div class="panel-head"><div><h3>' +
                    U.escapeHtml(item.name ? item.name + " table" : "League table") +
                    ' - ' + U.escapeHtml(tournament.name) + '</h3><p>Calculated from published results. ' +
                    'Goal difference is considered before goals scored.</p></div></div>' +
                '<div class="panel-body is-flush"><div class="table-wrap">' +
                    '<table class="data-table standings-table is-stackable">' +
                        '<caption>' + U.escapeHtml(item.name ? item.name + " table" : "League table") +
                            ' for ' + U.escapeHtml(tournament.name) + '</caption>' +
                        '<thead><tr><th scope="col">Pos</th><th scope="col">Team</th>' +
                            '<th scope="col" class="is-numeric">P</th><th scope="col" class="is-numeric">W</th>' +
                            '<th scope="col" class="is-numeric">D</th><th scope="col" class="is-numeric">L</th>' +
                            '<th scope="col" class="is-numeric">GF</th><th scope="col" class="is-numeric">GA</th>' +
                            '<th scope="col" class="is-numeric">GD</th><th scope="col" class="is-numeric">Pts</th>' +
                            '<th scope="col">Form</th></tr></thead><tbody>' +
                            item.rows.map(function (row) { return rowMarkup(row, counts); }).join("") +
                        '</tbody></table></div></div></div>';
        }).join("") + '</div><div class="standings-legend legend">' +
            '<span><i class="is-qualify"></i> Qualification places</span>' +
            '<span><i class="is-playoff"></i> Play-off place</span>' +
            '<span><i class="is-out"></i> Outside qualification</span></div>';
    }

    /* -------------------------
       Bindings and initialisation
       ------------------------- */
    function bindSelectors() {
        U.on(els.tournament, "change", function () {
            syncFromControls();
            refreshCategoryOptions();
            refreshGroupOptions();
            render();
        });

        U.on(els.category, "change", function () {
            syncFromControls();
            render();
        });

        U.on(els.group, "change", function () {
            syncFromControls();
            render();
        });

        U.on(document.getElementById("refreshStandings"), "click", function () {
            syncFromControls();
            render();
            U.toast("Table recalculated from the latest published results.", "info");
        });

        U.on(document.getElementById("printStandings"), "click", function () {
            window.print();
        });
    }

    /* Deep links: /standings/?tournament=TRN-2026-MEN&group=Group A */
    function applyDeepLinks() {
        var tournament = U.getParam("tournament") || U.getParam("tournamentId");
        var category = U.getParam("category");
        var group = U.getParam("group");

        if (tournament && U.tournamentById(tournament)) {
            els.tournament.value = tournament;
            state.tournamentId = tournament;
        }

        refreshCategoryOptions();
        refreshGroupOptions();

        if (category) {
            els.category.value = category;
            state.categoryId = category;
        }

        if (group && groupsForTournament(state.tournamentId).indexOf(group) > -1) {
            els.group.value = group;
            state.group = group;
        }
    }

    function init() {
        els.tableWrap = document.getElementById("standingsTableWrap");
        if (!els.tableWrap) return;
        els.empty = document.getElementById("standingsEmpty");
        els.summary = document.getElementById("standingsSummary");
        els.meta = document.getElementById("tableMeta");
        els.tournament = document.getElementById("filterTournament");
        els.category = document.getElementById("filterCategory");
        els.group = document.getElementById("filterGroup");
        els.tableTitle = document.getElementById("tableTitle");
        els.tableSubtitle = document.getElementById("tableSubtitle");
        var staleNotice = document.getElementById("dataNotice");
        if (staleNotice) staleNotice.remove();
        var staleRules = document.getElementById("standingsNotice");
        if (staleRules) staleRules.remove();
        populateSelectors();
        bindSelectors();
        applyDeepLinks();
        syncFromControls();
        render();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }


})();
