/* ==========================================================================
   The Angutsa Football Championship - standings engine

   The single place where league tables are calculated. Every page (public
   standings, tournament and team pages, the manager dashboard and the admin
   console) uses this file, so a table can never differ between pages.

   Approved competition rules applied here:
     1. Three points for a win, one for a draw, none for a defeat.
     2. Teams are ranked by points, then goal difference, then goals scored.
     3. Teams still level after that keep the order an administrator has
        confirmed (manual tie-break), otherwise they are listed by name.

   A table is calculated once and reused. It is only calculated again when
   the teams or the confirmed scores that feed it change.
   ========================================================================== */

window.AngutsaStandings = (function () {
    "use strict";

    var RULES = Object.freeze({ win: 3, draw: 1, loss: 0 });
    var cache = {};
    var cacheSize = 0;
    var stats = { calculations: 0, reused: 0 };

    function createRow(teamId, extra) {
        var row = {
            teamId: teamId,
            played: 0, won: 0, drawn: 0, lost: 0,
            goalsFor: 0, goalsAgainst: 0,
            goalDifference: 0, difference: 0,
            points: 0,
            form: [],
            position: 0
        };
        if (extra) Object.keys(extra).forEach(function (key) { row[key] = extra[key]; });
        return row;
    }

    /* Applies one finished match to both rows using the approved points. */
    function applyResult(home, away, homeScore, awayScore) {
        home.played += 1;
        away.played += 1;
        home.goalsFor += homeScore;
        home.goalsAgainst += awayScore;
        away.goalsFor += awayScore;
        away.goalsAgainst += homeScore;

        if (homeScore > awayScore) {
            home.won += 1; home.points += RULES.win; home.form.push("W");
            away.lost += 1; away.points += RULES.loss; away.form.push("L");
        } else if (homeScore < awayScore) {
            away.won += 1; away.points += RULES.win; away.form.push("W");
            home.lost += 1; home.points += RULES.loss; home.form.push("L");
        } else {
            home.drawn += 1; home.points += RULES.draw; home.form.push("D");
            away.drawn += 1; away.points += RULES.draw; away.form.push("D");
        }
    }

    function isScore(value) {
        return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
    }

    /* Ranks rows in place and numbers the positions. */
    function rank(rows, options) {
        var settings = options || {};
        var manual = settings.manualOrder || {};

        rows.forEach(function (row) {
            row.goalDifference = row.goalsFor - row.goalsAgainst;
            row.difference = row.goalDifference;
        });

        rows.sort(function (a, b) {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            if (manual[a.teamId] && manual[b.teamId] && manual[a.teamId] !== manual[b.teamId]) {
                return manual[a.teamId] - manual[b.teamId];
            }
            var nameA = settings.nameOf ? settings.nameOf(a.teamId) : (a.name || a.teamId);
            var nameB = settings.nameOf ? settings.nameOf(b.teamId) : (b.name || b.teamId);
            return String(nameA).localeCompare(String(nameB));
        });

        rows.forEach(function (row, index) { row.position = index + 1; });
        return rows;
    }

    function sameRecord(a, b) {
        return a.points === b.points && a.goalDifference === b.goalDifference &&
            a.goalsFor === b.goalsFor;
    }

    function copyRows(rows) {
        return rows.map(function (row) {
            var copy = {};
            Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
            copy.form = row.form.slice();
            return copy;
        });
    }

    /* teams:   [{ id, name, shortName, accent, ... }]
       results: [{ homeId, awayId, homeScore, awayScore }] - finished matches only
       options: { manualOrder, nameOf, autoCreate } */
    function build(teams, results, options) {
        var settings = options || {};

        var signature = JSON.stringify([
            (teams || []).map(function (team) { return [team.id, team.name || "", team.shortName || "", team.accent || ""]; }),
            (results || []).map(function (match) {
                return [match.homeId, match.awayId, match.homeScore, match.awayScore];
            }),
            settings.manualOrder || null,
            !!settings.autoCreate
        ]);

        if (cache[signature]) {
            stats.reused += 1;
            return copyRows(cache[signature]);
        }

        var rows = {};
        (teams || []).forEach(function (team) {
            rows[team.id] = createRow(team.id, {
                name: team.name,
                shortName: team.shortName,
                accent: team.accent
            });
        });

        function rowFor(teamId) {
            if (!rows[teamId] && settings.autoCreate) rows[teamId] = createRow(teamId);
            return rows[teamId];
        }

        (results || []).forEach(function (match) {
            if (!isScore(match.homeScore) || !isScore(match.awayScore)) return;
            var home = rowFor(match.homeId);
            var away = rowFor(match.awayId);
            if (!home || !away) return;
            applyResult(home, away, Number(match.homeScore), Number(match.awayScore));
        });

        var table = rank(Object.keys(rows).map(function (key) { return rows[key]; }), settings);

        if (cacheSize > 200) { cache = {}; cacheSize = 0; }
        cache[signature] = table;
        cacheSize += 1;
        stats.calculations += 1;

        return copyRows(table);
    }

    return {
        RULES: RULES,
        build: build,
        rank: rank,
        createRow: createRow,
        applyResult: applyResult,
        sameRecord: sameRecord,
        stats: stats
    };
})();
