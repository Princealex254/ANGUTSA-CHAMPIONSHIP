(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    function teamMarkup(teamId, side) {
        var team = U.teamById(teamId);
        var name = team ? team.name : "To be confirmed";
        var crest = U.crestMarkup(team, "lg");
        var body = '<div class="match-center-team' + (side === "away" ? " is-away" : "") + '">' +
            (side === "away" ? "" : crest) +
            '<div class="match-center-team-name">' +
                (team
                    ? '<a href="/team-details/?team=' + encodeURIComponent(team.id) + '">' +
                        U.escapeHtml(name) + "</a>"
                    : "<span>" + U.escapeHtml(name) + "</span>") +
                "<small>" + (side === "away" ? "Away team" : "Home team") + "</small>" +
            "</div>" +
            (side === "away" ? crest : "") +
        "</div>";

        return body;
    }

    function scoreMarkup(match) {
        if ((match.status !== "completed" && match.status !== "live") || match.homeScore === null ||
            match.awayScore === null || match.homeScore === undefined ||
            match.awayScore === undefined) {
            return '<div class="match-center-score is-pending" aria-label="No score yet">VS</div>';
        }

        return '<div class="match-center-score' + (match.status === "live" ? " is-live" : "") +
            '" aria-label="' + (match.status === "live" ? "Live score " : "Final score ") +
            U.escapeHtml(match.homeScore) + " to " + U.escapeHtml(match.awayScore) + '">' +
            "<span>" + U.escapeHtml(match.homeScore) + "</span>" +
            '<span class="match-center-score-separator" aria-hidden="true">&ndash;</span>' +
            "<span>" + U.escapeHtml(match.awayScore) + "</span>" +
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

    function formatMatchMinute(minute) {
        var value = Number(minute);
        return value > 90 ? "90+" + (value - 90) : String(value);
    }

    function tieBreakMarkup(match) {
        if (match.tieBreakMethod === "extra-time") {
            return "After extra time: " + match.homeExtraTimeScore + " - " +
                match.awayExtraTimeScore;
        }
        if (match.tieBreakMethod === "penalties") {
            return "After extra time: " + match.homeExtraTimeScore + " - " +
                match.awayExtraTimeScore + "; penalties: " +
                match.homePenaltiesScore + " - " + match.awayPenaltiesScore;
        }
        return "";
    }

    function fact(label, value, href) {
        var content = href
            ? '<a href="' + U.escapeHtml(href) + '">' + U.escapeHtml(value) + "</a>"
            : U.escapeHtml(value);
        return "<div><dt>" + U.escapeHtml(label) + "</dt><dd>" + content + "</dd></div>";
    }

    function eventMarkup(event) {
        var isOwnGoal = (event.type || event.eventType) === "own_goal";
        var team = U.teamById(event.teamId);
        var description = event.playerName ||
            (isOwnGoal ? "Own goal" : "Goalscorer not disclosed");
        if (event.playerName && isOwnGoal) description += " (own goal)";
        if (Number(event.goals) > 1) description += " (" + Number(event.goals) + " goals)";
        if (team) description += " - " + team.name;
        return '<li class="match-event">' +
            '<span class="match-event-minute">' +
                (event.minute !== null && event.minute !== undefined
                    ? U.escapeHtml(formatMatchMinute(event.minute)) + "'"
                    : isOwnGoal ? "Own goal" : "Goal") +
            "</span>" +
            "<span>" + U.escapeHtml(description) + "</span>" +
        "</li>";
    }

    function renderMatch(match) {
        var tournament = U.tournamentById(match.tournamentId);
        var category = U.categoryById(match.categoryId);
        var home = teamMarkup(match.homeTeamId, "home");
        var away = teamMarkup(match.awayTeamId, "away");
        var tieBreak = tieBreakMarkup(match);
        var tournamentHref = tournament
            ? "/tournament-details/?slug=" + encodeURIComponent(tournament.slug || tournament.id)
            : "";
        var facts = [
            fact("Kick-off", U.formatDateTime(match.kickoff)),
            fact("Venue", match.venue || "To be confirmed"),
            fact("Round", match.round || "Not set"),
            fact("Stage", match.stage || "Not set")
        ];

        if (match.group) facts.push(fact("Group", match.group));
        if (tournament) facts.push(fact("Tournament", tournament.name, tournamentHref));
        if (category) facts.push(fact("Category", category.name));

        document.title = U.teamName(match.homeTeamId) + " vs " +
            U.teamName(match.awayTeamId) + " | Match Centre";

        return '<article class="match-center">' +
            '<header class="match-center-heading">' +
                '<div>' +
                    '<div class="eyebrow"><span class="eyebrow-line"></span> MATCH CENTRE</div>' +
                    "<h1>" + U.escapeHtml(match.round || "Match details") + "</h1>" +
                    (tournament
                        ? "<p>" + U.escapeHtml(tournament.name) + "</p>"
                        : "") +
                "</div>" +
                U.statusBadge(match.status, match.status === "live"
                    ? liveClockLabel(match) : U.matchStatusLabel(match.status)) +
            "</header>" +
            '<section class="match-center-scoreboard" aria-label="Match score">' +
                home +
                scoreMarkup(match) +
                away +
            "</section>" +
            (match.status === "live"
                ? '<p class="match-center-live-clock" role="status">' +
                    U.escapeHtml(liveClockLabel(match)) + ' · Updates refresh automatically</p>'
                : "") +
            (tieBreak
                ? '<p class="match-center-tiebreak">' + U.escapeHtml(tieBreak) + "</p>"
                : "") +
            (match.note
                ? '<p class="match-center-note">' + U.escapeHtml(match.note) + "</p>"
                : "") +
            '<div class="match-center-grid">' +
                '<section class="panel">' +
                    '<div class="panel-head"><h2>Match information</h2></div>' +
                    '<dl class="match-center-facts">' + facts.join("") + "</dl>" +
                "</section>" +
                '<section class="panel">' +
                    '<div class="panel-head"><h2>Goal scorers</h2></div>' +
                    (match.events && match.events.length
                        ? '<ol class="match-event-list">' +
                            match.events.map(eventMarkup).join("") + "</ol>"
                        : '<p class="match-center-empty">Goal details have not been recorded for this match.</p>') +
                "</section>" +
            "</div>" +
            '<div class="match-center-actions">' +
                '<a class="btn btn-dark-outline" href="/fixtures/">All fixtures</a>' +
                '<a class="btn btn-primary" href="/results/">All results</a>' +
            "</div>" +
        "</article>";
    }

    function init() {
        var target = document.getElementById("matchDetails");
        var notice = document.getElementById("matchNotice");
        var dataNotice = document.getElementById("dataNotice");
        if (!target) return;

        if (dataNotice) dataNotice.innerHTML = U.liveDataNotice();

        var matchId = U.getParam("match");
        var match = matchId ? U.matchById(matchId) : null;
        if (!match) {
            notice.innerHTML = '<div class="alert alert-warning" role="status">' +
                (matchId
                    ? "This match could not be found. It may have been removed or is not published."
                    : "Choose a match from the fixtures or results list to view its details.") +
                ' <a href="/fixtures/">Browse fixtures</a>.</div>';
            return;
        }

        target.innerHTML = renderMatch(match);
        if (match.status === "live" || match.status === "scheduled") {
            startLiveRefresh(matchId, target, notice);
        }
    }

    function startLiveRefresh(matchId, target, notice) {
        var refreshing = false;
        var timer = null;
        var activeMatch = U.matchById(matchId);

        function scheduleRefresh() {
            if (timer) window.clearTimeout(timer);
            if (!activeMatch || document.visibilityState === "hidden" ||
                (activeMatch.status !== "live" && activeMatch.status !== "scheduled")) return;
            timer = window.setTimeout(refresh, activeMatch.status === "live" ? 15000 : 60000);
        }

        function refresh() {
            if (refreshing || document.visibilityState === "hidden") return;
            refreshing = true;
            Promise.resolve(window.AngutsaPlatformReady).then(function (platform) {
                if (!platform) throw window.AngutsaPlatformError ||
                    new Error("Live match updates are unavailable.");
                return platform.request("/public/live-matches?matchId=" +
                    encodeURIComponent(matchId));
            }).then(function (matches) {
                if (!Array.isArray(matches)) {
                    throw new Error("The live-match service returned an invalid response.");
                }
                var latest = matches.filter(function (item) { return item.id === matchId; })[0];
                if (!latest) {
                    if (notice) notice.textContent =
                        "Live updates are unavailable for this match. The page will keep checking.";
                    return;
                }
                var current = U.matchById(matchId);
                if (current) Object.assign(current, latest);
                activeMatch = current || latest;
                target.innerHTML = renderMatch(current || latest);
                if (notice) notice.textContent = "";
            }).catch(function (error) {
                if (notice) notice.textContent =
                    "Live scores could not be refreshed. Retrying automatically.";
                console.error("Live match updates could not be loaded.", error);
            }).finally(function () {
                refreshing = false;
                scheduleRefresh();
            });
        }
        U.on(document, "visibilitychange", function () {
            if (document.visibilityState === "visible") refresh();
            else if (timer) window.clearTimeout(timer);
        });
        U.on(window, "pagehide", function () {
            if (timer) window.clearTimeout(timer);
        });
        refresh();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }
})();
