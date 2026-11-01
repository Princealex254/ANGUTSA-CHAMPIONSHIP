/* =========================================
   ANGUTSA CHAMPIONSHIP — TOURNAMENT DETAILS
   Behaviour for /tournament-details/. The competition is read from
   js/data.js through the `slug` query parameter, for example:
       /tournament-details/?slug=angutsa-mens-championship-2026
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var tournament = null;
    var els = {};

    /* -------------------------
       Registration action
       ------------------------- */

    function registerButtonMarkup(compact) {
        var slug = tournament ? encodeURIComponent(tournament.slug) : "";
        var size = compact ? " btn-block" : "";

        if (!tournament) {
            return '<a class="btn btn-dark-outline' + size +
                '" href="/tournaments/">Browse tournaments</a>';
        }

        if (tournament.status === "registration-open") {
            return '<a class="btn btn-primary' + size +
                '" href="/team-registration/?tournament=' + slug + '">' +
                'Register a Team <span class="btn-arrow" aria-hidden="true">&#8599;</span></a>';
        }

        if (tournament.status === "upcoming") {
            return '<button type="button" class="btn btn-dark-outline' + size +
                '" disabled title="Registration has not opened yet">Registration not open</button>';
        }

        return '<a class="btn btn-dark-outline' + size +
            '" href="/results/?tournament=' + encodeURIComponent(tournament.id) + '">' +
            'View Results <span class="btn-arrow" aria-hidden="true">&#8594;</span></a>';
    }

    /* -------------------------
       Header and summary
       ------------------------- */

    function renderHero() {
        if (!tournament) {
            els.heroTitle.textContent = "Tournament not found";
            els.heroSubtitle.textContent = "This competition is not in the directory yet. Browse the tournament directory to find an open competition.";
            els.heroBreadcrumb.textContent = "Not found";
            els.heroActions.innerHTML =
                '<a class="btn btn-gold" href="/tournaments/">Back to tournaments</a>';
            return;
        }

        els.heroTitle.textContent = tournament.name;
        els.heroSubtitle.textContent = tournament.overview;
        els.heroBreadcrumb.textContent = tournament.name;

        els.heroActions.innerHTML =
            registerButtonMarkup(false) +
            (tournament.standingsAvailable
                ? '<a class="btn btn-outline-light" href="/standings/?tournament=' +
                    encodeURIComponent(tournament.id) + '">View standings</a>'
                : '<a class="btn btn-outline-light" href="/fixtures/?tournament=' +
                    encodeURIComponent(tournament.id) + '">View fixtures</a>');

        var hero = document.getElementById("tournamentHero");
        if (hero && tournament.banner) {
            var cover = document.createElement("img");
            cover.className = "detail-hero-cover";
            cover.src = tournament.banner;
            cover.alt = "";
            cover.loading = "lazy";
            hero.insertBefore(cover, hero.firstChild);
        }

        els.heroStats.innerHTML =
            "<div><strong>" + U.escapeHtml(tournament.categoryLabel) + "</strong><span>Category</span></div>" +
            "<div><strong>" + U.escapeHtml(tournament.formatLabel) + "</strong><span>Format</span></div>" +
            "<div><strong>" + tournament.teamsRegistered + " / " + tournament.teamLimit +
                "</strong><span>Teams</span></div>" +
            "<div><strong>" + U.escapeHtml(U.formatDateRange(tournament.startDate, tournament.endDate)) +
                "</strong><span>Match dates</span></div>";
    }

    function renderSide() {
        if (!tournament) return;

        els.sideStatus.innerHTML = U.statusBadge(tournament.status,
            U.tournamentStatusLabel(tournament.status));

        els.sideRegistration.innerHTML =
            "<div>" + U.icon("calendar") + "<span>Registration opens " +
                U.formatDate(tournament.registrationOpens) + "</span></div>" +
            "<div>" + U.icon("clock") + "<span>Registration closes " +
                U.formatDate(tournament.registrationCloses) + "</span></div>" +
            "<div>" + U.icon("wallet") + "<span>Entry fee " +
                U.formatMoney(tournament.entryFee) + "</span></div>" +
            "<div>" + U.icon("users") + "<span>" + tournament.teamsRegistered + " of " +
                tournament.teamLimit + " places filled</span></div>";

        els.sideRegister.outerHTML = registerButtonMarkup(true);
        els.sideRegister = document.getElementById("sideRegister");

        els.sideRegisterNote.textContent = tournament.status === "registration-open"
            ? "Registration is open. The competitions office reviews each submission before approval."
            : (tournament.status === "upcoming"
                ? "Registration for this competition has not opened yet."
                : "Registration for this competition is closed. Contact the competitions office for late entries.");

        var exactTeams = (Data.teams || []).filter(function (team) {
            return Array.isArray(team.tournamentIds) && team.tournamentIds.indexOf(tournament.id) > -1;
        });

        els.sideFacts.innerHTML =
            "<div>" + U.icon("pin") + "<span>" + U.escapeHtml(tournament.venue) + ", " +
                U.escapeHtml(tournament.location) + "</span></div>" +
            "<div>" + U.icon("trophy") + "<span>Season " + U.escapeHtml(tournament.season) + "</span></div>" +
            "<div>" + U.icon("users") + "<span>" + exactTeams.length +
                " teams recorded in the directory</span></div>" +
            "<div>" + U.icon("chart") + "<span>" +
            (String(tournament.prizeInformation || "").trim()
                ? "Prize details available"
                : "Prize information not announced") + "</span></div>";
    }

    /* -------------------------
       Panels
       ------------------------- */

    function panelBlock(title, bodyHtml) {
        return '<div class="detail-block"><h3>' + U.escapeHtml(title) + "</h3>" + bodyHtml + "</div>";
    }

    function tournamentTeams() {
        return (Data.teams || []).filter(function (team) {
            return Array.isArray(team.tournamentIds) && team.tournamentIds.indexOf(tournament.id) > -1;
        });
    }

    function tournamentMatches() {
        return U.filterMatches(Data.matches || [], { tournamentId: tournament.id });
    }

    function seasonOutcomeMarkup() {
        var finalMatch = U.sortMatchesByKickoff(tournamentMatches().filter(function (match) {
            return String(match.stage || "").trim().toLowerCase() === "final" &&
                match.status === "completed" &&
                match.homeTeamId && match.awayTeamId &&
                match.homeScore !== null && match.awayScore !== null;
        }), "desc")[0];
        if (!finalMatch) return "";

        var home = U.teamById(finalMatch.homeTeamId);
        var away = U.teamById(finalMatch.awayTeamId);
        var winnerId = U.matchWinnerTeamId(finalMatch);
        var seasonLabel = tournament.season
            ? tournament.season + " Season Champion"
            : "Season Champion";
        var tieBreakDetails = finalMatch.tieBreakMethod === "extra-time"
            ? "After extra time: " + finalMatch.homeExtraTimeScore + "–" +
                finalMatch.awayExtraTimeScore
            : finalMatch.tieBreakMethod === "penalties"
                ? "After extra time: " + finalMatch.homeExtraTimeScore + "–" +
                    finalMatch.awayExtraTimeScore + " · penalties: " +
                    finalMatch.homePenaltiesScore + "–" + finalMatch.awayPenaltiesScore
                : "";

        function finalistMarkup(team, teamId, isChampion) {
            var name = team ? team.name : U.teamName(teamId);
            var role = isChampion ? seasonLabel : "Finalist";
            return '<div class="season-outcome-team' + (isChampion ? " is-champion" : "") + '">' +
                U.crestMarkup(team, "sm") +
                '<div><span class="season-outcome-role">' + U.escapeHtml(role) + "</span>" +
                    "<strong>" + U.escapeHtml(name) + "</strong></div>" +
            "</div>";
        }

        var hasChampion = Boolean(winnerId);
        var homeIsChampion = hasChampion && winnerId === finalMatch.homeTeamId;
        var awayIsChampion = hasChampion && winnerId === finalMatch.awayTeamId;

        return '<section class="season-outcome' + (hasChampion ? " has-champion" : "") +
            '" aria-label="Tournament finalists">' +
            '<div class="season-outcome-heading">' +
                '<span class="season-outcome-icon">' + U.icon("trophy") + "</span>" +
                "<div><span>" + U.escapeHtml(tournament.season || "Tournament") +
                    " season result</span><h3>" +
                    (hasChampion ? "Season Champion &amp; Finalist" : "Tournament Finalists") +
                "</h3></div>" +
            "</div>" +
            '<div class="season-outcome-match">' +
                finalistMarkup(home, finalMatch.homeTeamId, homeIsChampion) +
                '<div class="season-outcome-score"><span>Final score</span><strong>' +
                    finalMatch.homeScore + " – " + finalMatch.awayScore + "</strong>" +
                    (tieBreakDetails
                        ? "<small>" + U.escapeHtml(tieBreakDetails) + "</small>"
                        : "") +
                "</div>" +
                finalistMarkup(away, finalMatch.awayTeamId, awayIsChampion) +
            "</div>" +
        "</section>";
    }

    function renderOverview() {
        if (!tournament) {
            els.panelOverview.innerHTML = U.emptyState({
                icon: "trophy",
                title: "No competition selected",
                message: "Open the tournament directory and choose a competition to see its overview.",
                actionLabel: "Browse tournaments",
                actionHref: "/tournaments/"
            });
            return;
        }

        var registered = tournament.teamsRegistered || 0;
        var limit = tournament.teamLimit || 0;
        var percent = limit ? Math.round((registered / limit) * 100) : 0;

        var progress = limit
            ? '<div class="registration-progress">' +
                '<div class="progress-meta"><span>Registration progress</span><strong>' +
                    registered + " of " + limit + " places</strong></div>" +
                '<div class="progress-track"><div class="progress-fill' +
                    (percent >= 100 ? " is-green" : (percent >= 60 ? " is-gold" : "")) +
                    '" style="width:' + Math.min(percent, 100) + '%"></div></div>' +
              "</div>"
            : "";

        var prizeInformation = String(tournament.prizeInformation || "").trim();
        var prize = prizeInformation
            ? '<div class="prize-row"><div><strong>' + U.escapeHtml(prizeInformation) +
                "</strong><span>Prize information</span></div></div>"
            : "";

        els.panelOverview.innerHTML =
            seasonOutcomeMarkup() +
            panelBlock("Competition overview",
                "<p>" + U.escapeHtml(tournament.overview) + "</p>" + progress) +
            panelBlock("Competition details",
                '<div class="meta-grid">' +
                    '<div><span class="meta-label">Category</span><span class="meta-value">' +
                        U.escapeHtml(tournament.categoryLabel) + "</span></div>" +
                    '<div><span class="meta-label">Format</span><span class="meta-value">' +
                        U.escapeHtml(tournament.formatLabel) + "</span></div>" +
                    '<div><span class="meta-label">Match dates</span><span class="meta-value">' +
                        U.escapeHtml(U.formatDateRange(tournament.startDate, tournament.endDate)) +
                        "</span></div>" +
                    '<div><span class="meta-label">Registration</span><span class="meta-value">' +
                        U.escapeHtml(U.formatDateRange(tournament.registrationOpens, tournament.registrationCloses)) +
                        "</span></div>" +
                    '<div><span class="meta-label">Venue</span><span class="meta-value">' +
                        U.escapeHtml(tournament.venue) + "</span></div>" +
                    '<div><span class="meta-label">Location</span><span class="meta-value">' +
                        U.escapeHtml(tournament.location) + "</span></div>" +
                    '<div><span class="meta-label">Entry fee</span><span class="meta-value">' +
                        U.formatMoney(tournament.entryFee) + "</span></div>" +
                    '<div><span class="meta-label">Teams</span><span class="meta-value">' +
                        registered + " registered" + (limit ? " of " + limit : "") + "</span></div>" +
                "</div>") +
            (prize ? panelBlock("Prize information", prize) : "");
    }

    function renderRules() {
        if (!tournament) {
            els.panelRules.innerHTML = U.emptyState({
                icon: "list",
                title: "No competition selected",
                message: "Published rules are available after selecting a competition.",
                actionLabel: "Browse tournaments",
                actionHref: "/tournaments/"
            });
            return;
        }

        var rules = (Data.rules || []).filter(function (rule) {
            return rule.categoryId === tournament.categoryId &&
                String(rule.state || "").toLowerCase() === "published";
        }).sort(function (a, b) {
            return String(b.updated || "").localeCompare(String(a.updated || ""));
        });
        var rule = rules[0];
        if (!rule) {
            els.panelRules.innerHTML = panelBlock("Competition rules",
                "<p>No rules have been published for this tournament category yet.</p>" +
                '<div class="card-actions"><a class="btn btn-dark-outline btn-sm" href="/tournament-rules/?tournament=' +
                    encodeURIComponent(tournament.id) + '">View published rules</a></div>');
            return;
        }

        var body = U.escapeHtml(rule.body || "")
            .replace(/\r\n?/g, "\n")
            .replace(/\n/g, "<br>");
        els.panelRules.innerHTML = panelBlock(rule.title || "Competition rules",
            '<div class="rich-text">' + body + "</div>" +
            '<div class="card-actions"><a class="btn btn-dark-outline btn-sm" href="/tournament-rules/?tournament=' +
                encodeURIComponent(tournament.id) + '">View published rules</a></div>');
    }

    function renderTeams() {
        if (!tournament) {
            els.panelTeams.innerHTML = "";
            return;
        }

        var teams = tournamentTeams();

        if (!teams.length) {
            els.panelTeams.innerHTML = U.emptyState({
                icon: "users",
                title: "No teams confirmed yet",
                message: "Approved teams appear here once the competitions office completes registration review.",
                actionLabel: "Register a team",
                actionHref: "/registration/"
            });
            return;
        }

        var approved = teams.filter(function (team) { return team.status === "approved"; });
        var pending = teams.filter(function (team) { return team.status !== "approved"; });

        els.panelTeams.innerHTML =
            panelBlock("Participating teams (" + teams.length + ")",
                '<div class="participant-grid">' + teams.map(function (team) {
                    return '<div class="participant">' + U.crestMarkup(team, "sm") +
                        '<span class="participant-text"><strong>' + U.escapeHtml(team.name) +
                        "</strong><span>" + U.escapeHtml(team.group || "Group to be confirmed") +
                        "</span></span>" +
                        U.statusBadge(team.status === "approved" ? "approved" : "pending",
                            team.status === "approved" ? "Confirmed" : "Pending") +
                    "</div>";
                }).join("") + "</div>" +
                '<p class="form-note">' + approved.length + " confirmed and " + pending.length +
                " awaiting review. Team profiles appear in the team directory once approved.</p>") +
            panelBlock("Follow the teams",
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/teams/">Team directory</a>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/standings/?tournament=' +
                        encodeURIComponent(tournament.id) + '">League table</a>' +
                "</div>");
    }

    function matchRowMarkup(match) {
        var home = U.teamById(match.homeTeamId);
        var away = U.teamById(match.awayTeamId);
        var tieBreakDetails = match.tieBreakMethod === "extra-time"
            ? "After extra time: " + match.homeExtraTimeScore + "–" + match.awayExtraTimeScore
            : match.tieBreakMethod === "penalties"
                ? "After extra time: " + match.homeExtraTimeScore + "–" + match.awayExtraTimeScore +
                    " · penalties: " + match.homePenaltiesScore + "–" + match.awayPenaltiesScore
                : "";
        var score = match.status === "completed" && match.homeScore !== null
            ? '<span class="match-score">' + match.homeScore + "<span>&ndash;</span>" +
                match.awayScore + "</span>"
            : '<span class="match-score is-pending">vs</span>';

        return '<div class="match-row">' +
            '<span class="match-row-time">' + U.formatTime(match.kickoff) +
                "<span>" + U.formatDateShort(match.kickoff) + "</span></span>" +
            '<span class="match-row-team">' + U.crestMarkup(home, "sm") +
                U.escapeHtml(home ? home.name : "To be confirmed") + "</span>" +
            score +
            '<span class="match-row-team is-away">' + U.crestMarkup(away, "sm") +
                U.escapeHtml(away ? away.name : "To be confirmed") + "</span>" +
            '<span class="match-row-venue">' + U.escapeHtml(match.group || match.stage) +
                "<span>" + U.escapeHtml(match.venue) + "</span>" +
                (tieBreakDetails
                    ? '<small class="match-tie-break">' + U.escapeHtml(tieBreakDetails) + "</small>"
                    : "") + "</span>" +
        "</div>";
    }

    function renderFixtures() {
        if (!tournament) {
            els.panelFixtures.innerHTML = "";
            return;
        }

        var matches = tournamentMatches();
        var stagesById = Object.create(null);
        (Data.tournamentStages || []).filter(function (stage) {
            return stage.tournamentId === tournament.id;
        }).forEach(function (stage) {
            var item = stagesById[stage.id];
            if (!item) {
                item = {
                    name: stage.name,
                    type: stage.type,
                    status: stage.status,
                    participants: []
                };
                stagesById[stage.id] = item;
            }
            if (stage.participant && !item.participants.some(function (participant) {
                return participant.teamId === stage.participant.teamId;
            })) {
                item.participants.push({
                    teamId: stage.participant.teamId,
                    teamName: stage.participant.teamName
                });
            }
        });
        var progression = Object.keys(stagesById).map(function (id) {
            var stage = stagesById[id];
            return '<li><strong>' + U.escapeHtml(stage.name) + '</strong><span>' +
                U.escapeHtml(stage.status.replace(/_/g, " ")) + '</span>' +
                (stage.participants.length
                    ? '<p>' + stage.participants.map(function (participant) {
                        return U.escapeHtml(participant.teamName);
                    }).join(", ") + '</p>'
                    : "") + '</li>';
        }).join("");
        var progressionPanel = progression
            ? panelBlock("Published tournament progression",
                '<ol class="detail-progression-list">' + progression + '</ol>')
            : "";
        var upcoming = U.sortMatchesByKickoff(matches.filter(function (match) {
            return match.status === "scheduled";
        }), "asc").slice(0, 6);
        var completed = U.sortMatchesByKickoff(matches.filter(function (match) {
            return match.status === "completed";
        }), "desc").slice(0, 6);

        if (!matches.length) {
            els.panelFixtures.innerHTML = progressionPanel + U.emptyState({
                icon: "flag",
                title: "Fixtures are not published yet",
                message: "The competitions office publishes the fixture list once registration closes.",
                actionLabel: "View all fixtures",
                actionHref: "/fixtures/"
            });
            return;
        }

        els.panelFixtures.innerHTML =
            progressionPanel + panelBlock("Upcoming fixtures",
                upcoming.length
                    ? '<div class="detail-fixture-list">' + upcoming.map(matchRowMarkup).join("") + "</div>"
                    : "<p>No further fixtures are scheduled for this competition.</p>") +
            panelBlock("Latest results",
                completed.length
                    ? '<div class="detail-fixture-list">' + completed.map(matchRowMarkup).join("") + "</div>"
                    : "<p>No completed matches have been published yet.</p>") +
            panelBlock("Full schedule",
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/fixtures/?tournament=' +
                        encodeURIComponent(tournament.id) + '">All fixtures</a>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/results/?tournament=' +
                        encodeURIComponent(tournament.id) + '">All results</a>' +
                "</div>");
    }

    function renderStandings() {
        if (!tournament) {
            els.panelStandings.innerHTML = "";
            return;
        }

        var matches = tournamentMatches().filter(U.isStandingsMatch);
        var groups = {};
        matches.forEach(function (match) {
            if (match.group) groups[match.group] = true;
        });
        tournamentTeams().forEach(function (team) {
            var teamGroup = team.groupByTournament
                ? team.groupByTournament[tournament.id]
                : team.group;
            if (teamGroup) groups[teamGroup] = true;
        });
        var groupNames = Object.keys(groups).sort();
        var scopes = groupNames.map(function (group) { return group; });
        if (!groupNames.length || matches.some(function (match) { return !match.group; })) {
            scopes.unshift("");
        }
        var tables = scopes.map(function (group) {
            var scopedMatches = group
                ? matches.filter(function (match) { return match.group === group; })
                : matches.filter(function (match) { return !match.group; });
            return {
                group: group,
                rows: U.computeStandings(scopedMatches, Data.teams, {
                    tournamentId: tournament.id,
                    categoryId: tournament.categoryId,
                    group: group
                })
            };
        }).filter(function (item) { return item.rows.length; });

        if (!tables.length || !tournament.standingsAvailable) {
            els.panelStandings.innerHTML = U.emptyState({
                icon: "chart",
                title: "Standings are not available yet",
                message: "A league table appears once enough results have been published for this competition.",
                actionLabel: "View results",
                actionHref: "/results/?tournament=" + encodeURIComponent(tournament.id)
            });
            return;
        }

        var tablesMarkup = tables.map(function (item) {
            var rows = item.rows.slice(0, 8).map(function (row) {
                return "<tr>" +
                    '<td data-label="Position">' + row.position + "</td>" +
                    '<td data-label="Team">' + U.escapeHtml(row.name) + "</td>" +
                    '<td data-label="Played" class="is-numeric">' + row.played + "</td>" +
                    '<td data-label="Goal difference" class="is-numeric">' +
                        (row.difference > 0 ? "+" + row.difference : row.difference) + "</td>" +
                    '<td data-label="Points" class="is-numeric">' + row.points + "</td>" +
                "</tr>";
            }).join("");
            return (item.group ? "<h4>" + U.escapeHtml(item.group) + "</h4>" : "") +
                '<div class="table-wrap"><table class="data-table is-stackable">' +
                    "<caption>" + (item.group ? U.escapeHtml(item.group) + " standings" : "League table") +
                        " for " + U.escapeHtml(tournament.name) + "</caption>" +
                    '<thead><tr><th scope="col">Pos</th><th scope="col">Team</th>' +
                    '<th scope="col" class="is-numeric">P</th>' +
                    '<th scope="col" class="is-numeric">GD</th>' +
                    '<th scope="col" class="is-numeric">Pts</th></tr></thead>' +
                    "<tbody>" + rows + "</tbody></table></div>";
        }).join("");

        els.panelStandings.innerHTML =
            panelBlock("Provisional league table",
                "<p>Calculated in the browser from published demonstration results. The official table is " +
                "validated and published by the backend.</p>" + tablesMarkup +
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/standings/?tournament=' +
                        encodeURIComponent(tournament.id) + '">Full table and form</a>' +
                "</div>");
    }

    function renderTopScorers() {
        if (!tournament) {
            els.panelTopScorers.innerHTML = "";
            return;
        }
        if (/children|under 13/i.test(tournament.categoryLabel || "")) {
            els.panelTopScorers.innerHTML = panelBlock("Top scorers",
                '<p>Individual player statistics are not displayed for the children&#39;s festival.</p>');
            return;
        }

        var scorersById = Object.create(null);
        U.sortMatchesByKickoff(tournamentMatches().filter(function (match) {
            return match.status === "completed";
        }), "desc").forEach(function (match) {
            (match.events || []).forEach(function (event) {
                if (event.type !== "goal" || !event.playerId || !event.playerName) return;
                var scorer = scorersById[event.playerId];
                if (!scorer) {
                    scorer = scorersById[event.playerId] = {
                        playerId: event.playerId,
                        name: event.playerName,
                        teamId: event.teamId,
                        goals: 0,
                        latestMatchId: match.id
                    };
                }
                scorer.goals += Number(event.goals) || 1;
            });
        });

        var scorers = Object.keys(scorersById).map(function (id) {
            return scorersById[id];
        }).sort(function (left, right) {
            return right.goals - left.goals || left.name.localeCompare(right.name);
        });

        if (!scorers.length) {
            els.panelTopScorers.innerHTML = panelBlock("Top scorers",
                "<p>Goalscorers will appear here once their goal details have been recorded and published.</p>");
            return;
        }

        var previousGoals = null;
        var rank = 0;
        var rows = scorers.map(function (scorer, index) {
            if (scorer.goals !== previousGoals) rank = index + 1;
            previousGoals = scorer.goals;
            var team = U.teamById(scorer.teamId);
            return '<li class="top-scorer-row">' +
                '<span class="top-scorer-rank">' + rank + "</span>" +
                '<span class="top-scorer-player"><strong>' + U.escapeHtml(scorer.name) +
                    "</strong><small>" + U.escapeHtml(team ? team.name : "Team not available") +
                    "</small></span>" +
                '<strong class="top-scorer-goals">' + scorer.goals +
                    (scorer.goals === 1 ? " goal" : " goals") + "</strong>" +
                '<a class="link-btn" href="/match-center/?match=' +
                    encodeURIComponent(scorer.latestMatchId) + '" aria-label="View latest goal by ' +
                    U.escapeHtml(scorer.name) + '">Match details</a>' +
            "</li>";
        }).join("");

        els.panelTopScorers.innerHTML = panelBlock("Top scorers",
            '<ol class="top-scorer-list">' + rows + "</ol>" +
            '<p class="top-scorer-note">Only published goals with publicly displayable scorer details are counted.</p>');
    }

    function renderNews() {
        var news = (Data.news || []).slice(0, 3);

        els.panelNews.innerHTML =
            panelBlock("Related news and media",
                news.length
                    ? '<div class="related-news">' + news.map(function (item) {
                        return '<a href="/news-details/?article=' + encodeURIComponent(item.id) + '">' +
                            "<span>" + U.escapeHtml(item.title) + "</span>" +
                            "<span>" + U.escapeHtml(U.formatDate(item.date)) + "</span>" +
                        "</a>";
                    }).join("") + "</div>"
                    : "<p>No related articles have been published yet.</p>") +
            panelBlock("Media",
                '<div class="video-frame">Video and gallery content for this competition will appear ' +
                "here once the media library is connected.</div>" +
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/media/">Media gallery</a>' +
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
        els.heroStats = document.getElementById("heroStats");
        els.sideStatus = document.getElementById("sideStatus");
        els.sideRegistration = document.getElementById("sideRegistration");
        els.sideRegister = document.getElementById("sideRegister");
        els.sideRegisterNote = document.getElementById("sideRegisterNote");
        els.sideFacts = document.getElementById("sideFacts");
        els.panelOverview = document.getElementById("panelOverview");
        els.panelRules = document.getElementById("panelRules");
        els.panelTeams = document.getElementById("panelTeams");
        els.panelFixtures = document.getElementById("panelFixtures");
        els.panelStandings = document.getElementById("panelStandings");
        els.panelTopScorers = document.getElementById("panelTopScorers");
        els.panelNews = document.getElementById("panelNews");
        els.notice = document.getElementById("dataNotice");
        els.detailNotice = document.getElementById("detailNotice");

        var slug = U.getParam("slug") || U.getParam("tournament");
        tournament = (slug ? (U.findBySlug("tournaments", slug) || U.tournamentById(slug)) : null)
            || (Data.tournaments || [])[0] || null;

        if (els.notice) els.notice.innerHTML = U.liveDataNotice();

        if (els.detailNotice) {
            els.detailNotice.innerHTML = slug && !U.findBySlug("tournaments", slug) &&
                !U.tournamentById(slug)
                ? '<div class="alert alert-warning" role="note">' + U.icon("alert") +
                  "<span><strong>Competition not found.</strong> The link may be outdated. " +
                  (tournament
                      ? "The first competition in the directory is shown instead."
                      : "No competitions are currently available.") + "</span></div>"
                : "";
        }

        renderHero();
        renderSide();
        renderOverview();
        renderRules();
        renderTeams();
        renderFixtures();
        renderStandings();
        renderTopScorers();
        renderNews();

        U.on(document.getElementById("copyLink"), "click", function () {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href).then(function () {
                    U.toast("Tournament link copied.", "success");
                }).catch(function () {
                    U.toast("Copy the address from the browser to share it.", "info");
                });
            } else {
                U.toast("Copy the address from the browser to share it.", "info");
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }






})();
