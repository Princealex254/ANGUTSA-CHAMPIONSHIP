window.AngutsaRules = [
    {
        id: "RUL-01",
        categoryId: "CAT-01",
        title: "Men's Open — Competition Rules",
        state: "published",
        updated: "2026-08-10",
        updatedBy: "Administrator (placeholder)",
        body: "1. Eligibility\nPlayers must be listed on an approved team roster and meet the applicable category requirements before taking part in a fixture. Players are not approved individually.\n\n2. Squad size\nA maximum of 22 players may be registered for the competition. Match day squads are limited to 18 players.\n\n3. Match duration\nTwo periods of 45 minutes with a 15 minute interval.\n\n4. Points and ranking\nThree points for a win, one for a draw. Ranking is decided by points, then goal difference, then goals scored.\n\n5. Discipline\nA player dismissed from the field misses the next fixture. Accumulated cautions follow the published schedule.\n\n6. Protests\nWritten protests must reach the competitions office within 48 hours of the final whistle.\n\nThis text is demonstration content and is not a legally reviewed set of regulations."
    },
    {
        id: "RUL-02",
        categoryId: "CAT-02",
        title: "Women's Open — Competition Rules",
        state: "published",
        updated: "2026-08-12",
        updatedBy: "Administrator (placeholder)",
        body: "1. Eligibility\nPlayers must be listed on an approved team roster and meet the applicable category requirements before taking part. Players are not approved individually.\n\n2. Squad size\nA maximum of 20 players may be registered.\n\n3. Match duration\nTwo periods of 40 minutes with a 10 minute interval.\n\n4. Ranking\nPoints, then goal difference, then goals scored.\n\n5. Protests\nWritten protests within 48 hours."
    },
    {
        id: "RUL-03",
        categoryId: "CAT-03",
        title: "Youth Male (13-17) — Youth Rules",
        state: "published",
        updated: "2026-07-02",
        updatedBy: "Administrator (placeholder)",
        body: "1. Age eligibility\nOnly players registered for the correct age group may take part.\n\n2. Guardian consent\nA signed guardian consent form must be held for every player before the first fixture.\n\n3. Squad size\nA maximum of 24 players may be registered; match day squads are limited to 16.\n\n4. Match duration\nTwo periods of 35 minutes with a 10 minute interval.\n\n5. Safeguarding\nEvery team must nominate a responsible adult who is present at all fixtures.\n\nThis text is demonstration content; real youth competitions must follow national safeguarding requirements."
    },
    {
        id: "RUL-04",
        categoryId: "CAT-04",
        title: "Youth Female (13-17) — Youth Rules",
        state: "published",
        updated: "2026-08-19",
        updatedBy: "Administrator (placeholder)",
        body: "1. Age eligibility\nOnly players registered for the correct age group may take part.\n\n2. Guardian consent\nA signed guardian consent form must be held for every player before the first fixture.\n\n3. Squad size\nA maximum of 22 players may be registered; match day squads are limited to 16.\n\n4. Match duration\nTwo periods of 35 minutes with a 10 minute interval.\n\n5. Safeguarding\nEvery team must nominate a responsible adult who is present at all fixtures.\n\nThis text is demonstration content; real youth competitions must follow national safeguarding requirements."
    },
    {
        id: "RUL-05",
        categoryId: "CAT-05",
        title: "Children (Under 13) — Festival Rules",
        state: "draft",
        updated: "2026-10-01",
        updatedBy: "Administrator (placeholder)",
        body: "Draft festival rules awaiting confirmation before the festival opens.\n\n- No entry fee is charged\n- No league table is published\n- Guardian consent is required for every child\n- Public player profiles are not published"
    }
];

window.AngutsaRulesMigrations = {
    migratePlayerApprovalPolicy: function (rules) {
        var replacements = [
            {
                from: "Players must be registered and approved before taking part in any fixture.",
                to: "Players must be listed on an approved team roster and meet the applicable category " +
                    "requirements before taking part in a fixture. Players are not approved individually."
            },
            {
                from: "Players must be registered and approved before taking part.",
                to: "Players must be listed on an approved team roster and meet the applicable category " +
                    "requirements before taking part. Players are not approved individually."
            }
        ];
        var changed = false;
        var migratedRules = rules.map(function (rule) {
            var body = rule.body;
            replacements.forEach(function (replacement) {
                body = body.replace(replacement.from, replacement.to);
            });
            if (body === rule.body) return rule;

            changed = true;
            var migrated = Object.assign({}, rule);
            migrated.body = body;
            return migrated;
        });

        return { rules: migratedRules, changed: changed };
    }
};
