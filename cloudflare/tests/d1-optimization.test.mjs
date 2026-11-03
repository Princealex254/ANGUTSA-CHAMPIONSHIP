import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let moduleId = 0;

async function loadWorker() {
    const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
    const uniqueSource = `${source}\n;void ${moduleId++};`;
    return import(`data:text/javascript;base64,${Buffer.from(uniqueSource).toString("base64")}`);
}

const workerModule = await loadWorker();

function makeDatabase({ all, first } = {}) {
    const calls = [];
    const db = {
        prepare(sql) {
            const statement = {
                sql,
                values: [],
                bind(...values) {
                    statement.values = values;
                    return statement;
                },
                async all() {
                    calls.push({ method: "all", sql });
                    return all ? all(sql) : { results: [] };
                },
                async first() {
                    calls.push({ method: "first", sql });
                    return first ? first(sql) : null;
                },
                async run() {
                    calls.push({ method: "run", sql });
                    return { meta: { changes: 0 } };
                }
            };
            return statement;
        },
        async batch(statements) {
            calls.push({
                method: "batch",
                statements: statements.map(function (statement) {
                    return { sql: statement.sql, values: statement.values };
                })
            });
            return statements.map(function () { return { meta: { changes: 0 } }; });
        }
    };
    return { db, calls };
}

async function request(path, db, headers) {
    return workerModule.default.fetch(
        new Request("https://worker.example/api/v1" + path, { headers: headers || {} }),
        { ALLOWED_ORIGINS: "*", DB: db },
        {}
    );
}

test("public read routes throttle excessive requests before D1 access", async () => {
    const { db, calls } = makeDatabase();
    const headers = { "CF-Connecting-IP": "198.51.100.78" };

    for (let index = 0; index < 120; index += 1) {
        const response = await request("/public/bootstrap?only=faqs", db, headers);
        assert.equal(response.status, 200);
    }

    const limited = await request("/public/bootstrap?only=faqs", db, headers);

    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "60");
    assert.equal(calls.length, 120);
});

test("public bootstrap keeps its full response while paginating all collections", async () => {
    const { db, calls } = makeDatabase();

    const response = await request("/public/bootstrap?limit=100&offset=0", db);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 12);
    for (const collection of [
        "categories", "tournaments", "teams", "players", "matches",
        "news", "faqs", "rules", "media", "tournamentStages"
    ]) {
        assert.deepEqual(payload.data[collection], []);
    }
});

test("public bootstrap reads only selected collections on its first page", async () => {
    const { db, calls } = makeDatabase();

    const response = await request(
        "/public/bootstrap?only=teams,matches&limit=100&offset=0",
        db
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 3);
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_teams tm"); }));
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_matches m"); }));
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_match_events e"); }));
    assert.ok(calls.every(function (call) { return !call.sql.includes("afc_app_settings"); }));
    assert.deepEqual(payload.data.teams, []);
    assert.deepEqual(payload.data.matches, []);
});

test("filtered public bootstrap can explicitly include payment settings", async () => {
    const { db, calls } = makeDatabase({
        all(sql) {
            return sql.includes("FROM afc_app_settings")
                ? { results: [{ setting_key: "payment_phone", setting_value: "0700000000" }] }
                : { results: [] };
        }
    });

    const response = await request(
        "/public/bootstrap?only=categories&includePayment=1&limit=100&offset=0",
        db
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 2);
    assert.ok(calls.some(function (call) { return call.sql.includes("afc_app_settings"); }));
    assert.equal(payload.data.meta.payment.number, "0700000000");
});

test("filtered bootstrap continuations do not reread payment settings", async () => {
    const { db, calls } = makeDatabase();

    const response = await request(
        "/public/bootstrap?only=categories&includePayment=1&limit=100&offset=100",
        db
    );

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 1);
    assert.ok(calls.every(function (call) { return !call.sql.includes("afc_app_settings"); }));
});

test("public bootstrap continuation reads only requested collections", async () => {
    const { db, calls } = makeDatabase();

    const response = await request(
        "/public/bootstrap?only=teams,matches&limit=100&offset=100",
        db
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 3);
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_teams tm"); }));
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_matches m"); }));
    assert.ok(calls.some(function (call) { return call.sql.includes("FROM afc_match_events e"); }));
    assert.deepEqual(payload.data.teams, []);
    assert.deepEqual(payload.data.matches, []);
});

test("public bootstrap rejects unrecognized continuation collections", async () => {
    const { db, calls } = makeDatabase();

    const response = await request("/public/bootstrap?only=payments", db);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "INVALID_COLLECTION");
    assert.equal(calls.length, 0);
});

test("public standings cache successful anonymous responses for 15 seconds", async () => {
    const { db, calls } = makeDatabase({
        first() {
            return { standings_available: 1 };
        }
    });
    const path = "/public/standings?tournamentId=TRN-CACHE-HIT";

    const firstResponse = await request(path, db);
    const secondResponse = await request(path, db);

    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("Cache-Control"), "public, max-age=15");
    assert.equal(firstResponse.headers.get("Vary"), "Origin");
    assert.equal(secondResponse.status, 200);
    assert.equal(calls.length, 3);

    const authenticatedResponse = await workerModule.default.fetch(
        new Request("https://worker.example/api/v1" + path, {
            headers: { Authorization: "Bearer user-token" }
        }),
        { ALLOWED_ORIGINS: "*", DB: db },
        {}
    );
    assert.equal(authenticatedResponse.headers.get("Cache-Control"), "no-store");
    assert.equal(calls.length, 6);
});

test("public standings cache expires and can be invalidated", async () => {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = function () { return now; };
    try {
        const { db, calls } = makeDatabase({
            first() {
                return { standings_available: 1 };
            }
        });
        const path = "/public/standings?tournamentId=TRN-CACHE-EXPIRY";

        await request(path, db);
        await request(path, db);
        assert.equal(calls.length, 3);

        now += 8000;
        const almostExpired = await request(path, db);
        assert.equal(almostExpired.headers.get("Cache-Control"), "public, max-age=7");
        assert.equal(calls.length, 3);

        now += 7001;
        await request(path, db);
        assert.equal(calls.length, 6);

        workerModule.invalidatePublicStandingsCache();
        await request(path, db);
        assert.equal(calls.length, 9);
    } finally {
        Date.now = originalNow;
    }
});

test("only successful standings-related mutations invalidate the cache", async () => {
    workerModule.invalidatePublicStandingsCache();
    const { db, calls } = makeDatabase({
        first() {
            return { standings_available: 1 };
        }
    });
    const path = "/public/standings?tournamentId=TRN-CACHE-INVALIDATION";
    const mutation = new Request("https://worker.example/api/v1/admin/matches/MCH-1/result", {
        method: "POST"
    });

    await request(path, db);
    workerModule.invalidatePublicStandingsAfterMutation(
        new Request("https://worker.example/api/v1/admin/settings/email-sender", {
            method: "POST"
        }),
        new Response(null, { status: 200 }),
        "/api/v1/admin/settings/email-sender"
    );
    workerModule.invalidatePublicStandingsAfterMutation(
        mutation,
        new Response(null, { status: 500 }),
        "/api/v1/admin/matches/MCH-1/result"
    );
    await request(path, db);
    assert.equal(calls.length, 3);

    workerModule.invalidatePublicStandingsAfterMutation(
        mutation,
        new Response(null, { status: 200 }),
        "/api/v1/admin/matches/MCH-1/result"
    );
    await request(path, db);
    assert.equal(calls.length, 6);
});

test("failed standings reads are not cached", async () => {
    let shouldFail = true;
    const { db, calls } = makeDatabase({
        first() {
            if (shouldFail) {
                shouldFail = false;
                throw new Error("Database unavailable");
            }
            return { standings_available: 1 };
        }
    });
    const path = "/public/standings?tournamentId=TRN-CACHE-FAIL";

    const failedResponse = await request(path, db);
    const successfulResponse = await request(path, db);

    assert.equal(failedResponse.status, 500);
    assert.equal(successfulResponse.status, 200);
    assert.equal(calls.length, 4);
});

test("public media responses use the bounded public cache lifetime", async () => {
    const { db } = makeDatabase({
        first() {
            return {
                object_key: "media/public-image.png",
                owner_uid: null,
                content_type: "image/png",
                visibility: "public"
            };
        }
    });
    const response = await workerModule.default.fetch(
        new Request("https://worker.example/api/v1/media/media/public-image.png"),
        {
            ALLOWED_ORIGINS: "*",
            DB: db,
            MEDIA: { async get() { return { body: new Response("image").body }; } }
        },
        {}
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=600");
});

test("public live-match feed returns live scores and keeps private scorers undisclosed", async () => {
    const { db, calls } = makeDatabase({
        all(sql) {
            if (sql.includes("SELECT id, status, live_clock_mode")) return { results: [] };
            assert.ok(sql.includes("m.status = 'live'"));
            assert.ok(sql.includes("m.published = 1"));
            return { results: [{
                id: "MCH-LIVE-1",
                tournament_id: "TRN-1",
                category_id: "CAT-1",
                stage: "group",
                round: "Group A",
                home_team_id: "TEAM-HOME",
                away_team_id: "TEAM-AWAY",
                kickoff: "2026-10-25T15:00:00Z",
                venue: "Main ground",
                status: "live",
                published: 1,
                home_score: 1,
                away_score: 0,
                live_minute: 37,
                note: "",
                event_team_id: "TEAM-HOME",
                player_id: "PLAYER-PRIVATE",
                event_type: "goal",
                minute: 23,
                goal_count: 1,
                player_name: "Private Player",
                public_profile: "hidden",
                scorer_public: 0,
                group_name: "A"
            }] };
        }
    });

    const response = await request("/public/live-matches", db);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.filter(function (call) { return call.method === "all"; }).length, 2);
    assert.equal(calls.filter(function (call) { return call.method === "run"; }).length, 1);
    assert.equal(payload.data[0].status, "live");
    assert.equal(payload.data[0].liveMinute, 37);
    assert.equal(payload.data[0].homeScore, 1);
    assert.equal(payload.data[0].events[0].playerName, "");
});

test("scheduled match clock automatically starts fixtures and stops at Full Time", async () => {
    const scheduledTime = Date.now();
    const { db, calls } = makeDatabase({
        all(sql) {
            if (!sql.includes("SELECT id, status, live_clock_mode")) return { results: [] };
            return { results: [{
                id: "MCH-AUTO-1",
                status: "live",
                live_clock_mode: "automatic",
                live_clock_started_at: new Date(scheduledTime - 105 * 60 * 1000).toISOString(),
                live_clock_elapsed_seconds: 0,
                live_extra_minutes: 0
            }] };
        }
    });

    await workerModule.default.scheduled(
        { scheduledTime: scheduledTime },
        { DB: db }
    );

    const kickoffUpdate = calls.filter(function (call) {
        return call.method === "run";
    })[0];
    assert.ok(kickoffUpdate.sql.includes("status = 'scheduled'"));
    assert.ok(kickoffUpdate.sql.includes("datetime(kickoff) <= datetime(?)"));
    const fullTimeBatch = calls.filter(function (call) {
        return call.method === "batch";
    })[0];
    assert.equal(fullTimeBatch.statements.length, 1);
    assert.ok(fullTimeBatch.statements[0].sql.includes("live_clock_mode = 'finished'"));
    assert.ok(fullTimeBatch.statements[0].values[0] >= 6300);
    assert.deepEqual(fullTimeBatch.statements[0].values.slice(1), [90, "MCH-AUTO-1"]);
});

test("scheduled match clock includes admin-added second-half minutes", async () => {
    const scheduledTime = Date.now();
    const { db, calls } = makeDatabase({
        all(sql) {
            if (!sql.includes("SELECT id, status, live_clock_mode")) return { results: [] };
            return { results: [{
                id: "MCH-ADDED-TIME",
                status: "live",
                live_clock_mode: "automatic",
                live_clock_started_at: new Date(scheduledTime - 110 * 60 * 1000).toISOString(),
                live_clock_elapsed_seconds: 0,
                live_extra_minutes: 5
            }] };
        }
    });

    await workerModule.default.scheduled(
        { scheduledTime: scheduledTime },
        { DB: db }
    );

    const fullTimeBatch = calls.filter(function (call) {
        return call.method === "batch";
    })[0];
    assert.ok(fullTimeBatch);
    assert.ok(fullTimeBatch.statements[0].values[0] >= 6600);
    assert.deepEqual(fullTimeBatch.statements[0].values.slice(1), [95, "MCH-ADDED-TIME"]);
    assert.equal(payload.data[0].events[0].playerId, null);
});

test("league standings use one match-and-participant query and preserve scoring", async () => {
    const { db, calls } = makeDatabase({
        first(sql) {
            assert.ok(sql.includes("standings_available"));
            return { standings_available: 1 };
        },
        all(sql) {
            if (sql.includes("FROM afc_tournament_groups g")) return { results: [] };
            if (sql.includes("FROM afc_tournament_stages s")) {
                return {
                    results: [
                        {
                            row_type: 0, stage_id: "STG-1", stage_name: "League", team_id: "TEAM-A",
                            seed: 1, team_name: "Alpha", short_code: "ALP",
                            match_home_team_id: null, match_away_team_id: null,
                            match_home_score: null, match_away_score: null
                        },
                        {
                            row_type: 0, stage_id: "STG-1", stage_name: "League", team_id: "TEAM-B",
                            seed: 2, team_name: "Bravo", short_code: "BRV",
                            match_home_team_id: null, match_away_team_id: null,
                            match_home_score: null, match_away_score: null
                        },
                        {
                            row_type: 0, stage_id: "STG-1", stage_name: "League", team_id: "TEAM-C",
                            seed: 3, team_name: "Charlie", short_code: "CHA",
                            match_home_team_id: null, match_away_team_id: null,
                            match_home_score: null, match_away_score: null
                        },
                        {
                            row_type: 1, stage_id: "STG-1", stage_name: "League",
                            match_home_team_id: "TEAM-A", match_away_team_id: "TEAM-B",
                            match_home_score: 2, match_away_score: 1
                        }
                    ]
                };
            }
            throw new Error("Unexpected standings query.");
        }
    });

    const response = await request("/public/standings?tournamentId=TRN-1", db);
    const payload = await response.json();
    const league = payload.data.find(function (table) { return table.type === "league"; });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.deepEqual(league.teams.map(function (team) {
        return [team.name, team.played, team.won, team.lost, team.points, team.position];
    }), [
        ["Alpha", 1, 1, 0, 3, 1],
        ["Charlie", 0, 0, 0, 0, 2],
        ["Bravo", 1, 0, 1, 0, 3]
    ]);
});
