/* =========================================
   ANGUTSA CHAMPIONSHIP — TEAM PROFILE
   Behaviour for /team-details/.
   Reads the team from js/data.js through the `team` query parameter,
   for example: /team-details/?team=TEAM-01

   Privacy rules enforced here:
     - only teams in the public directory can be opened
     - manager contact details are never rendered; only a display name
       where the manager has agreed to be listed
     - minors' player details are limited to initials
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var team = null;
    var els = {};

    /* -------------------------
       Data access
       ------------------------- */

    function isDirectoryTeam(record) {
        return !!record && String(record.status || "").toLowerCase() === "approved";
    }

    function teamPlayers() {
        if (!team || team.status !== "approved") return [];

        return (Data.players || []).filter(function (player) {
            return player.teamId === team.id &&
                player.publicProfile !== "hidden" &&
                (!player.minor || player.guardianConsent === "on-file");
        });
    }

    function teamMatches() {
        return U.filterMatches(Data.matches || [], { teamId: team.id });
    }

    function completedMatches() {
        return teamMatches().filter(function (match) { return match.status === "completed"; });
    }

    function teamRecord() {
        var finished = completedMatches().map(function (match) {
            return {
                homeId: match.homeTeamId, awayId: match.awayTeamId,
                homeScore: match.homeScore, awayScore: match.awayScore
            };
        });
        var row = window.AngutsaStandings.build([team], finished, { autoCreate: true })
            .filter(function (entry) { return entry.teamId === team.id; })[0];

        return {
            played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
            goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
            difference: row.goalDifference, points: row.points
        };
    }

    function teamCategory() {
        return U.categoryById(team.categoryId);
    }

    function teamTournament() {
        var ids = team && Array.isArray(team.tournamentIds) ? team.tournamentIds : [];
        return ids.length ? U.tournamentById(ids[0]) : null;
    }

    /* -------------------------
       Header
       ------------------------- */

    function renderHero() {
        if (!team) {
            els.heroTitle.textContent = "Team not found";
            els.heroSubtitle.textContent = "This team is not in the public directory. Browse the team directory to find a registered team.";
            els.heroBreadcrumb.textContent = "Not found";
            els.heroActions.innerHTML = '<a class="btn btn-gold" href="/teams/">Back to teams</a>';
            return;
        }

        var tournament = teamTournament();
        var record = teamRecord();

        els.heroTitle.textContent = team.name;
        els.heroSubtitle.textContent = U.categoryName(team.categoryId) + " team from " + team.location +
            (tournament ? ", competing in the " + tournament.name + "." : ".");
        els.heroBreadcrumb.textContent = team.name;

        els.heroCrest.innerHTML = U.crestMarkup(team, "lg");

        var fixturesHref = tournament
            ? "/fixtures/?tournament=" + encodeURIComponent(tournament.id)
            : "/fixtures/";
        var resultsHref = tournament
            ? "/results/?tournament=" + encodeURIComponent(tournament.id)
            : "/results/";

        els.heroActions.innerHTML =
            '<a class="btn btn-outline-light" href="' + fixturesHref + '">View fixtures</a>' +
            '<a class="btn btn-outline-light" href="' + resultsHref + '">View results</a>';

        els.heroStats.innerHTML =
            "<div><strong>" + U.escapeHtml(team.shortName) + "</strong><span>Short code</span></div>" +
            "<div><strong>" + U.escapeHtml(team.group || "TBC") + "</strong><span>Group</span></div>" +
            "<div><strong>" + record.played + " played</strong><span>" + record.won + "W &middot; " +
                record.drawn + "D &middot; " + record.lost + "L</span></div>" +
            "<div><strong>" + teamPlayers().length + "</strong><span>Players listed</span></div>";
    }

    /* -------------------------
       Summary column
       ------------------------- */

    function renderSide() {
        if (!team) return;

        var category = teamCategory();
        var manager = team.manager;
        var record = teamRecord();

        els.sideStatus.innerHTML = U.statusBadge(team.status,
            team.status === "approved" ? "Confirmed" : "Pending review");

        els.sideParticipation.innerHTML =
            "<div>" + U.icon("trophy") + "<span>" + U.escapeHtml(U.categoryName(team.categoryId)) +
                "</span></div>" +
            "<div>" + U.icon("flag") + "<span>" + U.escapeHtml(team.group || "Group to be confirmed") +
                "</span></div>" +
            "<div>" + U.icon("calendar") + "<span>Registered " +
                U.formatDate(team.registeredOn) + "</span></div>" +
            "<div>" + U.icon("pin") + "<span>" + U.escapeHtml(team.location) + "</span></div>";

        els.sideFacts.innerHTML =
            "<div>" + U.icon("shield") + "<span>Registration " +
                (team.status === "approved" ? "approved" : "awaiting review") + "</span></div>" +
            "<div>" + U.icon("users") + "<span>" + teamPlayers().length +
                " players listed publicly</span></div>" +
            "<div>" + U.icon("chart") + "<span>" + record.points + " points recorded</span></div>" +
            "<div>" + U.icon("info") + "<span>" +
                (category && category.guardianConsent
                    ? "Youth category - guardian consent required"
                    : "Senior category") + "</span></div>";

        var privacy = manager && manager.public !== false
            ? "<p><strong>" + U.escapeHtml(manager.role) + ":</strong> " +
              U.escapeHtml(manager.name) + "</p>" +
              '<p class="form-note">Only the display name is published. Contact details are held by the ' +
              "competitions office and are never shown publicly.</p>"
            : "<p>Team official details are not published for this team.</p>" +
              '<p class="form-note">Managers choose whether their display name appears in the directory.</p>';

        if (category && category.guardianConsent) {
            privacy += '<div class="privacy-note">' + U.icon("shield") +
                "<span>Youth team: player profiles are limited and guardian consent is recorded " +
                "before participation.</span></div>";
        }

        els.sidePrivacy.innerHTML = privacy;
    }

    /* -------------------------
       Panel helpers and squad
       ------------------------- */

    function panelBlock(title, bodyHtml) {
        return '<div class="detail-block"><h3>' + U.escapeHtml(title) + "</h3>" + bodyHtml + "</div>";
    }

    function renderSquad() {
        if (!team) {
            els.panelSquad.innerHTML = "";
            return;
        }

        var players = teamPlayers();

        if (!players.length) {
            els.panelSquad.innerHTML = U.emptyState({
                icon: "player",
                title: "No public roster records yet",
                message: "Player roster records appear here when the approved team publishes its squad.",
                actionLabel: "Register a team",
                actionHref: "/registration/"
            });
            return;
        }

        var rows = players.map(function (player) {
            var restricted = player.publicProfile === "initials-only";
            var stats = restricted
                ? "<span>Statistics withheld for youth players</span>"
                : "<span>Appearances <strong>" + player.appearances + "</strong></span>" +
                  "<span>Goals <strong>" + player.goals + "</strong></span>";

            return '<div class="squad-row">' +
                '<span class="squad-number">' + (player.shirtNumber || "-") + "</span>" +
                '<span class="squad-player"><strong>' +
                    U.escapeHtml(U.publicPlayerName(player)) + "</strong>" +
                    "<span>" + U.escapeHtml(!restricted && player.nickname
                        ? '"' + player.nickname + '"'
                        : player.classification) + "</span></span>" +
                '<span class="squad-role">' + U.escapeHtml(player.position || "Position not recorded") +
                    "</span>" +
                '<span class="squad-stats">' + stats + "</span>" +
            "</div>";
        }).join("");

        els.panelSquad.innerHTML =
            panelBlock("Squad (" + players.length + ")",
                '<div class="squad-list">' + rows + "</div>" +
                '<p class="form-note">Players are listed as part of the approved team roster; they are not ' +
                "approved individually. Youth player profiles are limited to initials and never include " +
                "contact details, and records without required guardian consent stay private.</p>") +
            panelBlock("Squad notes",
                "<p>Shirt numbers, positions and statistics come from the team roster record. " +
                "Squad visibility depends on team registration approval and applicable privacy safeguards.</p>");
    }

    /* -------------------------
       Matches
       ------------------------- */

    function matchRowMarkup(match) {
        var home = U.teamById(match.homeTeamId);
        var away = U.teamById(match.awayTeamId);
        var isHome = match.homeTeamId === team.id;
        var opponent = isHome ? away : home;
        var scored = isHome ? match.homeScore : match.awayScore;
        var conceded = isHome ? match.awayScore : match.homeScore;

        var outcome = "";
        if (match.status === "completed" && scored !== null && conceded !== null) {
            outcome = scored > conceded ? "Won" : (scored < conceded ? "Lost" : "Drew");
        }

        var scoreMarkup = match.status === "completed" && scored !== null
            ? '<span class="match-score' + (scored === conceded ? " is-pending" : "") + '">' +
                scored + "<span>&ndash;</span>" + conceded + "</span>"
            : '<span class="match-score is-pending">vs</span>';

        return '<div class="match-row">' +
            '<span class="match-row-time">' + U.formatTime(match.kickoff) +
                "<span>" + U.formatDateShort(match.kickoff) + "</span></span>" +
            '<span class="match-row-team">' + U.crestMarkup(opponent, "sm") +
                U.escapeHtml(opponent ? opponent.name : "To be confirmed") + "</span>" +
            scoreMarkup +
            '<span class="match-row-team is-away">' + U.escapeHtml(isHome ? "Home" : "Away") + "</span>" +
            '<span class="match-row-venue">' + U.escapeHtml(outcome || U.matchStatusLabel(match.status)) +
                "<span>" + U.escapeHtml(match.venue) + "</span></span>" +
        "</div>";
    }

    function renderMatches() {
        if (!team) {
            els.panelMatches.innerHTML = "";
            return;
        }

        var matches = teamMatches();

        if (!matches.length) {
            els.panelMatches.innerHTML = U.emptyState({
                icon: "flag",
                title: "No matches scheduled yet",
                message: "Fixtures appear here once the competitions office publishes the schedule.",
                actionLabel: "View all fixtures",
                actionHref: "/fixtures/"
            });
            return;
        }

        var upcoming = U.sortMatchesByKickoff(matches.filter(function (match) {
            return match.status === "scheduled";
        }), "asc");
        var recent = U.sortMatchesByKickoff(completedMatches(), "desc");

        els.panelMatches.innerHTML =
            panelBlock("Upcoming fixtures",
                upcoming.length
                    ? '<div class="detail-fixture-list">' + upcoming.map(matchRowMarkup).join("") + "</div>"
                    : "<p>No further fixtures are scheduled for this team.</p>") +
            panelBlock("Recent results",
                recent.length
                    ? '<div class="detail-fixture-list">' + recent.map(matchRowMarkup).join("") + "</div>"
                    : "<p>No completed matches have been published for this team yet.</p>") +
            panelBlock("Schedule",
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/results/">All results</a>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/fixtures/">Fixture centre</a>' +
                "</div>");
    }

    /* -------------------------
       Statistics
       ------------------------- */

    function isRestrictedPlayer(player) {
        return player.publicProfile === "initials-only";
    }

    function renderStatistics() {
        if (!team) {
            els.panelStatistics.innerHTML = "";
            return;
        }

        var record = teamRecord();
        var players = teamPlayers();
        var scorers = players
            .filter(function (player) { return !isRestrictedPlayer(player); })
            .slice()
            .sort(function (a, b) { return (b.goals || 0) - (a.goals || 0); })
            .slice(0, 5);

        var tableRows = scorers.map(function (player) {
            return "<tr>" +
                '<td data-label="Player"><strong>' + U.escapeHtml(U.publicPlayerName(player)) +
                    "</strong></td>" +
                '<td data-label="Position">' + U.escapeHtml(player.position || "Not recorded") + "</td>" +
                '<td data-label="Appearances" class="is-numeric">' + (player.appearances || 0) + "</td>" +
                '<td data-label="Goals" class="is-numeric">' + (player.goals || 0) + "</td>" +
                '<td data-label="Assists" class="is-numeric">' + (player.assists || 0) + "</td>" +
            "</tr>";
        }).join("");

        els.panelStatistics.innerHTML =
            panelBlock("Match record",
                '<div class="record-strip">' +
                    "<div><strong>" + record.played + "</strong><span>Played</span></div>" +
                    "<div><strong>" + record.won + "</strong><span>Won</span></div>" +
                    "<div><strong>" + record.drawn + "</strong><span>Drawn</span></div>" +
                    "<div><strong>" + record.lost + "</strong><span>Lost</span></div>" +
                "</div>" +
                '<p class="form-note">Calculated from ' + record.played + " published results. Goals for " +
                record.goalsFor + ", goals against " + record.goalsAgainst + " (difference " +
                (record.difference > 0 ? "+" + record.difference : record.difference) + ").</p>") +
            panelBlock("Player statistics",
                scorers.length
                    ? '<div class="table-wrap"><table class="data-table is-stackable">' +
                        "<caption>Leading players by goals scored.</caption>" +
                        '<thead><tr><th scope="col">Player</th><th scope="col">Position</th>' +
                        '<th scope="col" class="is-numeric">Apps</th>' +
                        '<th scope="col" class="is-numeric">Goals</th>' +
                        '<th scope="col" class="is-numeric">Assists</th></tr></thead>' +
                        "<tbody>" + tableRows + "</tbody></table></div>"
                    : "<p>No player statistics have been published for this team yet.</p>" +
                      "<p>Youth player statistics are withheld while a squad contains minors.</p>");
    }

    /* -------------------------
       Achievements and competition
       ------------------------- */

    function renderAchievements() {
        if (!team) {
            els.panelAchievements.innerHTML = "";
            return;
        }

        var tournament = teamTournament();
        var record = teamRecord();
        var entries = [];

        if (team.status === "approved") {
            entries.push({
                title: "Registration approved",
                detail: "Approved by the competitions office on " + U.formatDate(team.registeredOn) + "."
            });
        } else {
            entries.push({
                title: "Registration under review",
                detail: "Submitted on " + U.formatDate(team.registeredOn) + " and awaiting approval."
            });
        }

        if (tournament) {
            entries.push({
                title: "Competing in the " + tournament.name,
                detail: U.escapeHtml(tournament.categoryLabel) + " &middot; " +
                    U.escapeHtml(tournament.formatLabel) + " &middot; " +
                    U.escapeHtml(U.formatDateRange(tournament.startDate, tournament.endDate)) + "."
            });
        }

        if (record.played) {
            entries.push({
                title: record.won + " wins from " + record.played + " matches",
                detail: "Points recorded: " + record.points + ". Goal difference " +
                    (record.difference > 0 ? "+" + record.difference : record.difference) + "."
            });
        }

        els.panelAchievements.innerHTML =
            panelBlock("Recorded milestones",
                '<ul class="achievement-list">' + entries.map(function (entry) {
                    return '<li><span class="achievement-icon">' + U.icon("trophy") + "</span>" +
                        "<span><strong>" + entry.title + "</strong><span>" + entry.detail +
                        "</span></span></li>";
                }).join("") + "</ul>") +
            panelBlock("Trophies and honours",
                "<p>No championship honours have been recorded for this team yet. Honours are added by the " +
                "competitions office when a competition is formally concluded.</p>");
    }

    function renderCompetition() {
        if (!team) {
            els.panelCompetition.innerHTML = "";
            return;
        }

        var tournament = teamTournament();

        if (!tournament) {
            els.panelCompetition.innerHTML = U.emptyState({
                icon: "trophy",
                title: "Not attached to a competition",
                message: "This team is registered but is not currently attached to a published competition.",
                actionLabel: "Browse tournaments",
                actionHref: "/tournaments/"
            });
            return;
        }

        var matches = teamMatches().filter(function (match) {
            return match.tournamentId === tournament.id;
        });

        var table = U.computeStandings(matches, Data.teams, {
            tournamentId: tournament.id,
            categoryId: team.categoryId
        });

        var position = null;
        table.forEach(function (row) {
            if (row.teamId === team.id) position = row;
        });

        els.panelCompetition.innerHTML =
            panelBlock("Competition",
                '<div class="meta-grid">' +
                    '<div><span class="meta-label">Tournament</span><span class="meta-value">' +
                        U.escapeHtml(tournament.name) + "</span></div>" +
                    '<div><span class="meta-label">Category</span><span class="meta-value">' +
                        U.escapeHtml(tournament.categoryLabel) + "</span></div>" +
                    '<div><span class="meta-label">Format</span><span class="meta-value">' +
                        U.escapeHtml(tournament.formatLabel) + "</span></div>" +
                    '<div><span class="meta-label">Group</span><span class="meta-value">' +
                        U.escapeHtml(team.group || "Not applicable") + "</span></div>" +
                    '<div><span class="meta-label">Venue</span><span class="meta-value">' +
                        U.escapeHtml(tournament.venue) + "</span></div>" +
                    '<div><span class="meta-label">Table position</span><span class="meta-value">' +
                        (position
                            ? "P" + position.position + " with " + position.points + " points"
                            : "Not calculated yet") +
                        "</span></div>" +
                "</div>") +
            panelBlock("Competition links",
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/tournament-details/?slug=' +
                        encodeURIComponent(tournament.slug) + '">Tournament details</a>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/standings/?tournament=' +
                        encodeURIComponent(tournament.id) + '">League table</a>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/fixtures/?tournament=' +
                        encodeURIComponent(tournament.id) + '">Fixtures</a>' +
                "</div>");
    }

    /* -------------------------
       Initialisation
       ------------------------- */

    function init() {
        els.heroTitle = document.getElementById("heroTitle");
        if (!els.heroTitle) return;

        els.heroSubtitle = document.getElementById("heroSubtitle");
        els.heroBreadcrumb = document.getElementById("heroBreadcrumb");
        els.heroActions = document.getElementById("heroActions");
        els.heroCrest = document.getElementById("heroCrest");
        els.heroStats = document.getElementById("heroStats");
        els.sideStatus = document.getElementById("sideStatus");
        els.sideParticipation = document.getElementById("sideParticipation");
        els.sideFacts = document.getElementById("sideFacts");
        els.sidePrivacy = document.getElementById("sidePrivacy");
        els.panelSquad = document.getElementById("panelSquad");
        els.panelMatches = document.getElementById("panelMatches");
        els.panelStatistics = document.getElementById("panelStatistics");
        els.panelAchievements = document.getElementById("panelAchievements");
        els.panelCompetition = document.getElementById("panelCompetition");
        els.notice = document.getElementById("dataNotice");
        els.teamNotice = document.getElementById("teamNotice");

        var requested = U.getParam("team");
        var candidate = U.findById("teams", requested);

        if (requested && candidate && !isDirectoryTeam(candidate)) {
            els.teamNotice.innerHTML = '<div class="alert alert-warning" role="note">' + U.icon("alert") +
                "<span><strong>This team profile is not public.</strong> " +
                "Only approved teams appear in the public directory.</span></div>";
            candidate = null;
        }

        /*
         * Only fall back to the first public team when NO team was requested.
         * When a team ID was provided but not found / not approved, show the
         * "Team not found" message rather than silently displaying a different team.
         */
        if (requested && !isDirectoryTeam(candidate)) {
            team = null;
        } else {
            team = isDirectoryTeam(candidate)
                ? candidate
                : (Data.publicTeams ? Data.publicTeams()[0] : (Data.teams || [])[0]) || null;
        }

        if (els.notice) {
            if (team) {
                els.notice.innerHTML = '<div class="notice-bar" role="note">' + U.icon("info") +
                    "<span>This profile appears in the public directory.</span></div>";
            } else {
                els.notice.innerHTML = "";
            }
        }

        renderHero();
        renderSide();
        renderSquad();
        renderMatches();
        renderStatistics();
        renderAchievements();
        renderCompetition();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }






})();
