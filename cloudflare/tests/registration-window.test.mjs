import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("registration window uses inclusive EAT calendar dates", () => {
    assert.equal(
        workerModule.isRegistrationWindowOpen(
            "2026-06-02", "2026-06-03", new Date("2026-06-01T20:59:59Z")
        ),
        false
    );
    assert.equal(
        workerModule.isRegistrationWindowOpen(
            "2026-06-02", "2026-06-02", new Date("2026-06-01T21:00:00Z")
        ),
        true
    );
    assert.equal(
        workerModule.isRegistrationWindowOpen(
            "2026-06-02", "2026-06-03", new Date("2026-06-03T21:00:00Z")
        ),
        false
    );
    assert.equal(
        workerModule.isRegistrationWindowOpen(
            "2026-06-02", "", new Date("2026-06-10T10:00:00Z")
        ),
        true
    );
});

test("timed roster-change permission expires at its exact UTC timestamp", () => {
    const permission = {
        roster_changes_after_start: 1,
        roster_changes_expires_at: "2026-10-18T12:00:00.000Z"
    };
    assert.equal(
        workerModule.isRosterChangePermissionActive(permission, new Date("2026-10-18T11:59:59.999Z")),
        true
    );
    assert.equal(
        workerModule.isRosterChangePermissionActive(permission, new Date("2026-10-18T12:00:00.000Z")),
        false
    );
    assert.equal(
        workerModule.isRosterChangePermissionActive(
            { roster_changes_after_start: 1, roster_changes_expires_at: null },
            new Date("2026-10-18T12:00:00.000Z")
        ),
        true
    );
    assert.equal(
        workerModule.isRosterChangePermissionActive(
            { roster_changes_after_start: 0, roster_changes_expires_at: "2026-10-19T12:00:00.000Z" },
            new Date("2026-10-18T12:00:00.000Z")
        ),
        false
    );
});

test("match line-up window opens on match day and closes at kickoff in EAT", () => {
    const match = {
        published: 1,
        status: "scheduled",
        kickoff: "2026-10-26T16:00"
    };
    assert.equal(
        workerModule.isMatchLineupOpen(match, new Date("2026-10-26T12:59:59Z")),
        true
    );
    assert.equal(
        workerModule.isMatchLineupOpen(match, new Date("2026-10-26T13:00:00Z")),
        false
    );
    assert.equal(
        workerModule.isMatchLineupOpen(match, new Date("2026-10-25T12:00:00Z")),
        false
    );
    assert.equal(
        workerModule.isMatchLineupOpen(
            Object.assign({}, match, { status: "live" }),
            new Date("2026-10-26T12:00:00Z")
        ),
        false
    );
});
