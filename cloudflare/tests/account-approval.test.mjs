import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("only active owner-approved team managers have manager feature access", () => {
    assert.equal(workerModule.hasApprovedTeamManagerAccess({
        role: "team_manager",
        status: "active"
    }), true);

    assert.equal(workerModule.hasApprovedTeamManagerAccess({
        role: null,
        requested_account_type: "team-manager",
        status: "pending"
    }), false);
    assert.equal(workerModule.hasApprovedTeamManagerAccess({
        role: "team_manager",
        requested_account_type: "team-manager",
        status: "pending"
    }), false);
    assert.equal(workerModule.hasApprovedTeamManagerAccess({
        role: "team_manager",
        status: "pending"
    }), false);
    assert.equal(workerModule.hasApprovedTeamManagerAccess({
        role: "tournament_admin",
        status: "active"
    }), false);
    assert.equal(workerModule.hasApprovedTeamManagerAccess(null), false);
});

test("pending Team Manager accounts can submit a team without gaining manager feature access", () => {
    const pendingManager = {
        role: "team_manager",
        requested_account_type: "team-manager",
        status: "pending"
    };
    assert.equal(workerModule.canCreateTeamRegistration(pendingManager), true);
    assert.equal(workerModule.hasApprovedTeamManagerAccess(pendingManager), false);
    assert.equal(workerModule.canCreateTeamRegistration({
        role: null,
        requested_account_type: "team-manager",
        status: "pending"
    }), true);
    assert.equal(workerModule.canCreateTeamRegistration({
        role: "team_manager",
        requested_account_type: "team-manager",
        status: "active"
    }), true);
    assert.equal(workerModule.canCreateTeamRegistration({
        role: "team_manager",
        requested_account_type: "team-manager",
        status: "disabled"
    }), false);
    assert.equal(workerModule.canCreateTeamRegistration({
        role: "tournament_admin",
        requested_account_type: "team-manager",
        status: "pending"
    }), false);
    assert.equal(workerModule.canCreateTeamRegistration(null), false);
});
