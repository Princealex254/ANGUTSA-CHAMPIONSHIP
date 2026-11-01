/* Live data is populated by public-data-loader.js or a scoped dashboard
   bootstrap. Keep empty values here so a failed request never exposes samples. */
window.AngutsaData = (function () {
    "use strict";

    var data = {
        meta: {
            demo: false,
            label: "Live competition data",
            currency: "KES",
            payment: { method: "", number: "", accountName: "" }
        },
        categories: [],
        tournaments: [],
        teams: [],
        players: [],
        matches: [],
        news: [],
        tieBreakRules: [],
        faqs: [],
        rules: [],
        media: [],
        activity: [],
        notifications: [],
        payments: [],
        users: []
    };

    data.publicTeams = function () {
        return data.teams.filter(function (team) {
            return String(team.status || "").toLowerCase() === "approved";
        });
    };

    data.publicPlayers = function () {
        return data.players.filter(function (player) {
            var team = data.teams.filter(function (item) {
                return item.id === player.teamId;
            })[0];
            var consent = String(player.guardianConsent || "").toLowerCase();
            return team && String(team.status || "").toLowerCase() === "approved" &&
                player.publicProfile !== "hidden" &&
                (!player.minor || consent === "on_file" || consent === "on-file");
        });
    };

    return data;
})();
