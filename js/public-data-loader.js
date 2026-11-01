(function () {
    "use strict";

    var collectionsByPath = {
        "/": ["categories", "tournaments"],
        "/faqs/": ["faqs"],
        "/fixtures/": ["categories", "tournaments", "teams", "matches"],
        "/match-center/": ["categories", "tournaments", "teams", "matches"],
        "/media/": ["media"],
        "/news-details/": ["news"],
        "/results/": ["categories", "tournaments", "teams", "matches"],
        "/standings/": ["categories", "tournaments", "teams", "matches"],
        "/team-details/": ["categories", "tournaments", "teams", "players", "matches"],
        "/teams/": ["tournaments", "teams"],
        "/tournament-details/": [
            "categories", "tournaments", "teams", "matches", "news", "rules",
            "tournamentStages"
        ],
        "/tournament-rules/": ["categories", "tournaments", "rules"],
        "/tournaments/": ["categories", "tournaments"]
    };
    var defaultCollections = [
        "categories", "tournaments", "teams", "players", "matches", "news",
        "faqs", "rules", "media", "tournamentStages"
    ];

    function clearDemoData() {
        var data = window.AngutsaData || {};
        ["categories", "tournaments", "teams", "players", "matches", "news", "faqs",
            "rules", "tieBreakRules", "media", "tournamentStages", "activity", "notifications", "payments",
            "users"].forEach(function (key) {
            data[key] = [];
        });
        data.meta = { demo: false, label: "Live data unavailable", currency: "KES" };
        window.AngutsaData = data;
    }

    function showFailure(message) {
        var main = document.querySelector("main");
        if (!main || main.querySelector("[data-live-data-error]")) return;
        var notice = document.createElement("div");
        notice.className = "alert alert-danger";
        notice.setAttribute("role", "alert");
        notice.setAttribute("data-live-data-error", "");
        notice.textContent = message;
        main.insertBefore(notice, main.firstChild);
    }

    window.AngutsaDataReady = (async function () {
        var base = window.AngutsaPlatformConfig &&
            String(window.AngutsaPlatformConfig.apiBaseUrl || "").trim().replace(/\/+$/, "");
        if (!base) throw new Error("Competition information is temporarily unavailable.");
        var platform = await window.AngutsaPlatformReady;
        if (!platform) {
            throw window.AngutsaPlatformError ||
                new Error("Competition information is temporarily unavailable.");
        }
        var data = await platform.requestAll("/public/bootstrap", [
            ...(collectionsByPath[window.location.pathname] || defaultCollections)
        ]);
        Object.keys(data).forEach(function (key) {
            window.AngutsaData[key] = data[key];
        });
        data = window.AngutsaData;
        var categories = Object.create(null);
        (data.categories || []).forEach(function (category) {
            categories[category.id] = category;
        });
        (data.tournaments || []).forEach(function (tournament) {
            tournament.entryFee = tournament.registrationFee;
            tournament.teamLimit = tournament.teamCap;
            if (String(tournament.banner || "").indexOf("media/") === 0) {
                tournament.banner = base + "/api/v1/media/" + tournament.banner;
            }
            tournament.categoryLabel = categories[tournament.categoryId]
                ? categories[tournament.categoryId].name
                : "";
            tournament.formatLabel = tournament.format;
        });
        (data.media || []).forEach(function (record) {
            if (typeof record.file === "string" &&
                /^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(record.file)) {
                record.file = base + "/api/v1/media/" + record.file;
            }
        });
        data.meta.demo = false;
        data.meta.label = "Live competition data";
        window.AngutsaData = data;
        return data;
    }()).catch(function (error) {
        clearDemoData();
        console.error("Live competition data could not be loaded.", error);
        showFailure(error && error.message
            ? error.message
            : "We couldn't load competition information. Please refresh the page and try again.");
        return null;
    });
})();
