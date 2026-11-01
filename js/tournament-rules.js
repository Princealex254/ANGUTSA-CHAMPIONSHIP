/* =========================================
   ANGUTSA CHAMPIONSHIP — PUBLIC TOURNAMENT RULES
   Displays published category rules for the selected tournament.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;
    function loadRules() {
        return Data.rules || [];
    }

    function tournamentFromParam(tournaments, requested) {
        if (!requested) return null;
        return tournaments.filter(function (tournament) {
            return tournament.id === requested ||
                tournament.slug === requested ||
                tournament.adminId === requested;
        })[0] || null;
    }

    function categoryForTournament(tournament) {
        return (Data.categories || []).filter(function (category) {
            return category.id === tournament.categoryId ||
                category.adminId === tournament.categoryId;
        })[0] || null;
    }

    function renderRuleBody(body) {
        return window.AngutsaRulesFormat.render(body);
    }

    function render(tournament, rules, content, status, registerLink) {
        if (!tournament) {
            status.innerHTML = '<div class="alert alert-warning" role="alert">' +
                "<span>No tournaments are available to display.</span></div>";
            content.innerHTML = "";
            registerLink.hidden = true;
            return;
        }

        registerLink.hidden = false;
        if (tournament.status === "registration-open") {
            registerLink.href = "/team-registration/?tournament=" +
                encodeURIComponent(tournament.id);
            registerLink.textContent = "Register a team";
        } else {
            registerLink.href = "/tournaments/?status=registration-open";
            registerLink.textContent = "Browse open tournaments";
        }

        var category = categoryForTournament(tournament);
        if (!category) {
            status.innerHTML = '<div class="alert alert-warning" role="alert">' +
                "<span>A category has not been linked to this tournament yet. Contact the competitions office.</span></div>";
            content.innerHTML = "";
            return;
        }

        var documents = rules.filter(function (rule) {
            return (rule.categoryId === category.id || rule.categoryId === category.adminId) &&
                String(rule.state).toLowerCase() === "published";
        }).sort(function (a, b) {
            return String(b.updated || "").localeCompare(String(a.updated || ""));
        });

        if (!documents.length) {
            status.innerHTML = "";
            content.innerHTML =
                '<div class="rules-empty">' +
                    "<h2>No rules published yet</h2>" +
                    "<p>The competitions office has not published rules for this tournament category.</p>" +
                    '<a class="link-btn" href="/contact/">Contact the competitions office</a>' +
                "</div>";
            return;
        }

        var documentRecord = documents[0];
        status.innerHTML =
            '<div class="rules-meta">' +
                "<span>" + U.escapeHtml(tournament.name) + " · " +
                    U.escapeHtml(category.name) + "</span>" +
                (documentRecord.updated
                    ? "<span>Updated " + U.escapeHtml(U.formatDate(documentRecord.updated)) + "</span>"
                    : "") +
            "</div>";
        content.innerHTML =
            '<article class="rules-document">' +
                "<h2>" + U.escapeHtml(documentRecord.title) + "</h2>" +
                '<div class="rules-document-body rich-text">' + renderRuleBody(documentRecord.body) + "</div>" +
            "</article>";
    }

    function init() {
        var select = document.getElementById("rulesTournament");
        var content = document.getElementById("rulesContent");
        var status = document.getElementById("rulesStatus");
        var registerLink = document.getElementById("registerTournamentLink");
        if (!select || !content || !status || !registerLink) return;

        var tournaments = Data.tournaments || [];
        select.innerHTML = tournaments.map(function (tournament) {
            return '<option value="' + U.escapeHtml(tournament.id) + '">' +
                U.escapeHtml(tournament.name + " — " + tournament.season) +
                "</option>";
        }).join("");

        var requested = tournamentFromParam(tournaments, U.getParam("tournament"));
        var initial = requested || tournaments.filter(function (tournament) {
            return tournament.status === "registration-open" || tournament.status === "upcoming";
        })[0] || tournaments[0] || null;

        if (initial) select.value = initial.id;

        var rules;
        try {
            rules = loadRules();
        } catch (error) {
            console.error("Unable to load published tournament rules.", error);
            status.innerHTML = '<div class="alert alert-danger" role="alert">' +
                "<span>Published tournament rules could not be loaded. Please try again later.</span></div>";
            content.innerHTML = "";
            registerLink.hidden = true;
            return;
        }

        function renderSelectedTournament() {
            var selected = tournaments.filter(function (tournament) {
                return tournament.id === select.value;
            })[0] || null;
            render(selected, rules, content, status, registerLink);
        }

        U.on(select, "change", renderSelectedTournament);
        renderSelectedTournament();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }
})();
