import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

function stage(type, participantSource, qualification) {
    return {
        name: type,
        type,
        participantSource,
        qualification: qualification || {},
        pairing: {},
        settings: {},
        included: true
    };
}

test("round-robin generation schedules every pair exactly once for requested team counts", () => {
    [3, 5, 6, 8, 10, 12, 14, 18, 24, 32].forEach(function (count) {
        const teams = Array.from({ length: count }, function (_item, index) {
            return "TEAM-" + (index + 1);
        });
        const groupSizes = count === 3 ? [count] : [
            Math.ceil(count / 2), Math.floor(count / 2)
        ];
        let offset = 0;
        const groups = groupSizes.map(function (size, index) {
            const group = {
                id: "GROUP-" + (index + 1),
                teamIds: teams.slice(offset, offset + size)
            };
            offset += size;
            return group;
        });
        const fixtures = workerModule.buildRoundRobinFixtures(groups);
        const expected = groupSizes.reduce(function (total, size) {
            return total + size * (size - 1) / 2;
        }, 0);
        assert.equal(fixtures.length, expected);
        const pairs = fixtures.map(function (fixture) {
            return [fixture.homeTeamId, fixture.awayTeamId].sort().join(":");
        });
        assert.equal(new Set(pairs).size, expected);
        assert.equal(new Set(fixtures.flatMap(function (fixture) {
            return [fixture.homeTeamId, fixture.awayTeamId];
        })).size, count);
    });
});

test("unequal group sizes are supported without dropping participants", () => {
    const fixtures = workerModule.buildRoundRobinFixtures([
        { id: "A", teamIds: ["T1", "T2", "T3"] },
        { id: "B", teamIds: ["T4", "T5"] },
        { id: "C", teamIds: ["T6", "T7", "T8", "T9"] }
    ]);
    assert.equal(fixtures.length, 3 + 1 + 6);
    assert.deepEqual(new Set(fixtures.map(function (fixture) { return fixture.groupId; })),
        new Set(["A", "B", "C"]));
});

test("knockout winner resolution supports regulation, extra time, and penalties", () => {
    const match = {
        home_team_id: "TEAM-HOME",
        away_team_id: "TEAM-AWAY",
        home_score: 2,
        away_score: 1
    };
    assert.equal(workerModule.resolveMatchWinner(match), "TEAM-HOME");
    assert.equal(workerModule.resolveMatchWinner(Object.assign({}, match, {
        home_score: 1,
        away_score: 1,
        tie_break_method: "extra-time",
        home_extra_time_score: 2,
        away_extra_time_score: 1
    })), "TEAM-HOME");
    assert.equal(workerModule.resolveMatchWinner(Object.assign({}, match, {
        home_score: 1,
        away_score: 1,
        tie_break_method: "penalties",
        home_extra_time_score: 1,
        away_extra_time_score: 1,
        home_penalties_score: 5,
        away_penalties_score: 4
    })), "TEAM-HOME");
    assert.equal(workerModule.resolveMatchWinner(Object.assign({}, match, {
        home_score: 1,
        away_score: 1
    })), null);
});

test("published fixtures are only treated as corrections after a result exists", () => {
    assert.equal(workerModule.isPublishedMatchResult({
        published: 1, status: "scheduled", home_score: null, away_score: null
    }), false);
    assert.equal(workerModule.isPublishedMatchResult({
        published: 1, status: "completed", home_score: 2, away_score: 1
    }), true);
    assert.equal(workerModule.isPublishedMatchResult({
        published: 0, status: "completed", home_score: 2, away_score: 1
    }), false);
});

test("published stage fixtures allow schedule edits but lock fixture identity and played matches", () => {
    const fixture = {
        tournament_id: "TRN-1",
        category_id: "CAT-1",
        group_id: "GRP-1",
        group_name: "Group A",
        stage_id: "STG-1",
        stage: "group",
        round: "Matchday 1",
        home_team_id: "TEAM-1",
        away_team_id: "TEAM-2",
        status: "scheduled",
        published: 1,
        home_score: null,
        away_score: null
    };
    const scheduleEdit = {
        tournamentId: "TRN-1",
        categoryId: "CAT-1",
        group: "Group A",
        round: "Matchday 1",
        homeId: "TEAM-1",
        awayId: "TEAM-2",
        status: "scheduled",
        kickoff: "2026-10-27T14:00",
        venue: "Main Ground"
    };
    assert.equal(workerModule.publishedStageFixtureEditPolicy(fixture, scheduleEdit), null);
    assert.equal(workerModule.publishedStageFixtureEditPolicy(fixture,
        Object.assign({}, scheduleEdit, { homeId: "TEAM-3" })), "protected_fields");
    assert.equal(workerModule.publishedStageFixtureEditPolicy(fixture,
        Object.assign({}, scheduleEdit, { status: "cancelled" })), "protected_fields");
    assert.equal(workerModule.publishedStageFixtureEditPolicy(
        Object.assign({}, fixture, { status: "live" }), scheduleEdit), "fixture_started");
    assert.equal(workerModule.publishedStageFixtureEditPolicy(
        Object.assign({}, fixture, { home_score: 1 }), scheduleEdit), "fixture_started");
});

test("owner-defined stage sequences can omit conventional rounds", () => {
    const formats = [
        [stage("Groups", "group", "approved_teams"),
            stage("Semi-finals", "semi-finals", "group_positions", { qualifiersPerGroup: 2 }),
            stage("Final", "final", "match_winners")],
        [stage("Groups", "group", "approved_teams"),
            stage("Final", "final", "manual")],
        [stage("League", "league", "approved_teams"),
            stage("Final", "final", "overall_standings", { count: 2 })],
        [stage("Semi-finals", "semi-finals", "manual"),
            stage("Final", "final", "match_winners")],
        [stage("Groups", "group", "approved_teams"),
            Object.assign(stage("Quarter-finals", "quarter-finals", "group_positions", {
                qualifiersPerGroup: 2
            }), { included: false }),
            stage("Semi-finals", "semi-finals", "group_positions", { qualifiersPerGroup: 1 }),
            stage("Third place", "third-place-playoff", "match_losers"),
            stage("Final", "final", "match_winners")]
    ];
    formats.forEach(function (format) {
        assert.equal(workerModule.validateTournamentFormat(format).length, format.length);
    });
});

test("third-place playoff does not block progression to later stages", () => {
    assert.equal(workerModule.isRequiredProgressionStage("third-place-playoff"), false);
    assert.equal(workerModule.isRequiredProgressionStage("semi-finals"), true);
    assert.equal(workerModule.isRequiredProgressionStage("final"), true);
});

test("format validation requires a final and well-formed qualification rules", () => {
    assert.throws(function () {
        workerModule.validateTournamentFormat([
            stage("Groups", "group", "approved_teams")
        ]);
    }, /final stage/);
    assert.throws(function () {
        workerModule.validateTournamentFormat([
            stage("Groups", "group", "group_positions"),
            stage("Final", "final", "manual")
        ]);
    }, /qualifier count/);
    assert.equal(workerModule.validateTournamentFormat([
        stage("Semi-finals", "semi-finals", "manual"),
        stage("Final", "final", "match_winners")
    ]).length, 2);
    assert.throws(function () {
        workerModule.validateTournamentFormat([
            stage("Semi-finals", "semi-finals", "manual"),
            stage("Final", "final", "match_winners", { matchIds: ["bad id"] })
        ]);
    }, /source match IDs must be unique and valid/);
});

test("tournament format operations require their server-side permissions", () => {
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/format", "PUT"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/reset", "POST"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/reset", "GET"
    ), null);
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/stages/STG-1/reset", "POST"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/stages/STG-1/reset", "GET"
    ), null);
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/stages/STG-1/approve", "POST"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/stages/STG-1/publish", "POST"
    ), null);
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/stages/STG-1/complete", "POST"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/banner-uploads", "POST"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/TRN-1/banner-uploads/123.jpg", "DELETE"
    ), "tournaments.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/tournaments/banner-uploads", "POST"
    ), "tournaments.create");
});
