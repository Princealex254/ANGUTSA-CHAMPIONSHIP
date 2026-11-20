import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("team registrations match only tournaments in the selected category's season", () => {
    const registrations = [
        { id: "REG-1", season: 2026 },
        { id: "REG-2", season: 2027 }
    ];
    const tournaments = [
        { id: "TRN-1", season: 2026, registration_fee: 5000 },
        { id: "TRN-2", season: 2027, registration_fee: 3000 }
    ];

    const matches = workerModule.matchTeamRegistrationsToCategoryTournaments(
        registrations, tournaments
    );

    assert.deepEqual(matches.map(function (match) {
        return [match.registration.id, match.targets.map(function (target) { return target.id; })];
    }), [
        ["REG-1", ["TRN-1"]],
        ["REG-2", ["TRN-2"]]
    ]);
});

test("category tournament matching preserves missing and ambiguous outcomes for validation", () => {
    const matches = workerModule.matchTeamRegistrationsToCategoryTournaments(
        [{ id: "REG-1", season: 2026 }, { id: "REG-2", season: 2027 }],
        [
            { id: "TRN-1", season: 2026 },
            { id: "TRN-2", season: 2026 }
        ]
    );

    assert.equal(matches[0].targets.length, 2);
    assert.equal(matches[1].targets.length, 0);
});
