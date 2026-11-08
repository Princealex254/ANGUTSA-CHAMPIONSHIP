import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("unassigned and explicitly denied permissions fail closed", () => {
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "tournament_admin", {}, "teams.view"
    ), false);
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "tournament_admin", { "teams.view": "deny" }, "teams.view"
    ), false);
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "team_manager", { "teams.view": "allow" }, "teams.view"
    ), false);
});

test("independent actions do not imply one another", () => {
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "tournament_admin", { "results.edit": "allow" }, "results.publish"
    ), false);
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "tournament_admin", { "teams.view": "allow" }, "teams.edit"
    ), false);
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "tournament_admin", { "results.publish": "allow" }, "results.edit"
    ), false);
});

test("Platform Owner authority is role-based, not an assigned permission", () => {
    assert.equal(workerModule.hasEffectiveAdminPermission(
        "platform_owner", {}, "settings.edit"
    ), true);
});

test("Finance permissions load payment and team reference data without full team details", () => {
    const viewAccess = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "payments.view": "allow" }
    );
    assert.equal(viewAccess.competitionContext, true);
    assert.equal(viewAccess.relatedTeams, true);
    assert.equal(viewAccess.fullTeams, false);
    assert.equal(viewAccess.payments, true);
    assert.equal(viewAccess.paymentRegistrations, false);
    assert.equal(viewAccess.fixtures, false);

    const createAccess = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "payments.create": "allow" }
    );
    assert.equal(createAccess.relatedTeams, true);
    assert.equal(createAccess.paymentRegistrations, true);
    assert.equal(createAccess.payments, false);
});

test("Players and Reports permissions load required lookup references", () => {
    const playersAccess = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "players.view": "allow" }
    );
    assert.equal(playersAccess.competitionContext, true);
    assert.equal(playersAccess.relatedTeams, true);
    assert.equal(playersAccess.players, true);
    assert.equal(playersAccess.fullTeams, false);

    const reportsAccess = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "reports.view": "allow" }
    );
    assert.equal(reportsAccess.competitionContext, true);
    assert.equal(reportsAccess.relatedTeams, true);
    assert.equal(reportsAccess.payments, true);
    assert.equal(reportsAccess.fullTeams, false);
});

test("limited team references exclude manager contact and other private fields", () => {
    const references = workerModule.adminBootstrapTeamReferences([{
        id: "TEAM-1",
        name: "Example FC",
        short_code: "EFC",
        category_id: "CAT-1",
        tournament_id: "TRN-1",
        registration_id: "REG-1",
        registration_status: "approved",
        manager_name: "Private Name",
        manager_email: "private@example.test",
        manager_phone: "+254700000000",
        public_reference: "PUBLIC-1"
    }]);
    assert.deepEqual(references, [{
        id: "TEAM-1",
        name: "Example FC",
        short_code: "EFC",
        category_id: "CAT-1",
        tournament_id: "TRN-1",
        registration_id: "REG-1",
        registration_status: "approved"
    }]);
});

test("match permissions load full team references and only their related datasets", () => {
    const access = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "fixtures.view": "allow" }
    );
    assert.equal(access.fullTeams, true);
    assert.equal(access.fixtures, true);
    assert.equal(access.tournamentGroups, true);
    assert.equal(access.matchEvents, false);
    assert.equal(access.payments, false);
});

test("bootstrap permissions remain default-deny and Platform Owner can load all references", () => {
    const denied = workerModule.adminBootstrapDataAccess(
        "tournament_admin",
        { "payments.view": "deny" }
    );
    assert.equal(denied.competitionContext, false);
    assert.equal(denied.relatedTeams, false);
    assert.equal(denied.payments, false);

    const owner = workerModule.adminBootstrapDataAccess("platform_owner", {});
    Object.values(owner).forEach((allowed) => assert.equal(allowed, true));
});

test("admin API routes resolve to their action permission or fail closed", () => {
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/matches/MCH-1/lineups", "GET"
    ), "fixtures.view");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/matches/MCH-1/result", "PUT"
    ), "__result_update__");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/team-registrations/REG-1/review", "POST"
    ), "__registration_review__");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/matches/MCH-1/status", "PUT"
    ), "fixtures.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/rules/RUL-1/acknowledgments", "GET"
    ), "rules.view");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/rules/RUL-1/reminders", "POST"
    ), "rules.edit");
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/unknown", "POST"
    ), null);
    assert.equal(workerModule.adminPermissionForRequest(
        "/api/v1/admin/teams/TEAM-1/archive", "PATCH"
    ), "teams.archive");
});
