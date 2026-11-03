import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const certificateUrl =
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let moduleId = 0;

async function loadWorker() {
    const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
    const uniqueSource = `${source}\n;void ${moduleId++};`;
    return import(`data:text/javascript;base64,${Buffer.from(uniqueSource).toString("base64")}`);
}

function derLength(length) {
    if (length < 128) return Buffer.from([length]);
    const bytes = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining >>>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, contents) {
    return Buffer.concat([Buffer.from([tag]), derLength(contents.length), contents]);
}

function derSequence(...items) {
    return der(0x30, Buffer.concat(items));
}

function certificateFor(publicKey) {
    const signatureAlgorithm = derSequence(
        der(0x06, Buffer.from("2a864886f70d01010b", "hex")),
        der(0x05, Buffer.alloc(0))
    );
    const validity = derSequence(
        der(0x17, Buffer.from("260101000000Z")),
        der(0x17, Buffer.from("270101000000Z"))
    );
    const basicConstraints = derSequence(
        der(0x06, Buffer.from("551d13", "hex")),
        der(0x04, derSequence())
    );
    const extensions = der(0xa3, derSequence(basicConstraints));
    const tbs = derSequence(
        der(0xa0, der(0x02, Buffer.from([2]))),
        der(0x02, Buffer.from([1])),
        signatureAlgorithm,
        derSequence(),
        validity,
        derSequence(),
        publicKey.export({ type: "spki", format: "der" }),
        extensions
    );
    const encoded = derSequence(
        tbs,
        signatureAlgorithm,
        der(0x03, Buffer.from([0, 1]))
    ).toString("base64");
    return `-----BEGIN CERTIFICATE-----\n${encoded}\n-----END CERTIFICATE-----`;
}

function makeKeyPair() {
    return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function makeToken(privateKey, kid, claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        aud: "angutsa-football-championship",
        iss: "https://securetoken.google.com/angutsa-football-championship",
        sub: "firebase-user-123",
        exp: now + 3600,
        iat: now - 10,
        auth_time: now - 20,
        email_verified: false,
        ...claims
    })).toString("base64url");
    const signedContent = `${header}.${payload}`;
    const signature = sign("RSA-SHA256", Buffer.from(signedContent), privateKey).toString("base64url");
    return `${signedContent}.${signature}`;
}

function database(role) {
    return {
        prepare(sql) {
            return {
                bind() {
                    return this;
                },
                async first() {
                    if (sql.includes("FROM afc_users")) {
                        return {
                            firebase_uid: "firebase-user-123",
                            email: "user@example.test",
                            full_name: "Test User",
                            phone: null,
                            role: role || "platform_owner",
                            requested_account_type: null,
                            status: "active",
                            email_verified: 0
                        };
                    }
                    return null;
                },
                async all() {
                    return { results: [] };
                }
            };
        }
    };
}

async function callMe(worker, token) {
    return worker.fetch(new Request("https://worker.example/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` }
    }), { DB: database(), ALLOWED_ORIGINS: "*" }, {});
}

async function callManagerBootstrap(worker, token) {
    return worker.fetch(new Request("https://worker.example/api/v1/manager/bootstrap", {
        headers: { Authorization: `Bearer ${token}` }
    }), { DB: database("team_manager"), ALLOWED_ORIGINS: "*" }, {});
}

function managerPlayerProfileDatabase(registration, player, calls) {
    return {
        prepare(sql) {
            const statement = {
                values: [],
                bind(...values) {
                    statement.values = values;
                    return statement;
                },
                async first() {
                    if (sql.includes("FROM afc_users")) {
                        return {
                            firebase_uid: "firebase-user-123",
                            email: "user@example.test",
                            full_name: "Test Manager",
                            phone: null,
                            role: "team_manager",
                            requested_account_type: null,
                            status: "active",
                            email_verified: 0
                        };
                    }
                    if (sql.includes("FROM afc_players p")) {
                        return { ...player, registration_id: registration.id };
                    }
                    if (sql.includes("FROM afc_team_registrations r")) return registration;
                    return null;
                },
                async run() {
                    calls.push({ sql, values: statement.values });
                    return { meta: { changes: 1 } };
                }
            };
            return statement;
        }
    };
}

async function callManagerPlayerProfile(worker, token, db, profile, profileConsent) {
    return worker.fetch(new Request(
        "https://worker.example/api/v1/manager/players/player-1/public-profile",
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                publicProfile: profile,
                publicProfileConsent: profileConsent === true
            })
        }
    ), { DB: db, ALLOWED_ORIGINS: "*" }, {});
}

function adminPlayerProfileDatabase(player, calls, options) {
    const settings = options || {};
    return {
        prepare(sql) {
            const statement = {
                values: [],
                bind(...values) {
                    statement.values = values;
                    return statement;
                },
                async first() {
                    if (sql.includes("FROM afc_users")) {
                        return {
                            firebase_uid: "firebase-user-123",
                            email: "owner@example.test",
                            full_name: "Test Owner",
                            phone: null,
                            role: settings.role || "platform_owner",
                            requested_account_type: null,
                            status: "active",
                            email_verified: 0
                        };
                    }
                    if (sql.includes("FROM afc_players p")) return player;
                    if (sql.includes("FROM afc_user_permissions")) {
                        return settings.permission ? { effect: "allow" } : null;
                    }
                    if (sql.includes("FROM afc_tournament_admin_scopes")) {
                        return settings.scope ? { permitted: 1 } : null;
                    }
                    return null;
                },
                async run() {
                    calls.push({ sql, values: statement.values });
                    return { meta: { changes: 1 } };
                }
            };
            return statement;
        }
    };
}

async function callAdminPlayerProfile(worker, token, db, profile, profileConsent) {
    return worker.fetch(new Request(
        "https://worker.example/api/v1/admin/players/player-1/public-profile",
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                publicProfile: profile,
                publicProfileConsent: profileConsent === true
            })
        }
    ), { DB: db, ALLOWED_ORIGINS: "*" }, {});
}

async function callAdminEmailSettings(worker, token) {
    return worker.fetch(new Request("https://worker.example/api/v1/admin/settings/email-sender", {
        headers: { Authorization: `Bearer ${token}` }
    }), { DB: database(), ALLOWED_ORIGINS: "*" }, {});
}

async function callDebug(worker) {
    return worker.fetch(new Request("https://worker.example/debug/firebase-certificates"), {
        ALLOWED_ORIGINS: "*"
    }, {});
}

function certificateResponse(certificates, { status = 200, cacheControl = "max-age=60" } = {}) {
    return new Response(JSON.stringify(certificates), {
        status,
        headers: { "Cache-Control": cacheControl, "Content-Type": "application/json" }
    });
}

async function withFetch(fetcher, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
        return await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function withErrorLog(callback) {
    const originalError = console.error;
    const records = [];
    console.error = (...args) => records.push(args);
    try {
        return { value: await callback(), records };
    } finally {
        console.error = originalError;
    }
}

function assertDiagnostic(
    records,
    category,
    httpStatus,
    responseParsed,
    fetchFailure = null,
    fetchErrorName = null,
    stage = null
) {
    assert.equal(records.length, 1);
    assert.equal(records[0][0], "Firebase signing certificate retrieval failed.");
    assert.deepEqual(records[0][1], {
        category,
        httpStatus,
        responseParsed,
        fetchFailure,
        fetchErrorName,
        stage
    });
}

test("retrieves, imports, caches, and uses PEM certificates with surrounding whitespace", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const cert = ` \r\n${certificateFor(pair.publicKey)}\t `;
    let fetchCount = 0;
    const response = await withFetch(async (url, options) => {
        fetchCount += 1;
        assert.equal(url, certificateUrl);
        assert.equal(options.redirect, "follow");
        assert.equal(options.headers.Accept, "application/json");
        return certificateResponse({ "firebase-test-key": cert });
    }, () => callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key")));

    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(fetchCount, 1);
});

test("allows unverified active role accounts through protected Worker routes", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const token = makeToken(pair.privateKey, "firebase-test-key", { email_verified: false });
    const responses = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), async () => [
        await callAdminEmailSettings(worker.default, token),
        await callManagerBootstrap(worker.default, token)
    ]);

    for (const response of responses) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).success, true);
    }
});

test("team managers can update only public profile after roster lock, with youth full names blocked", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const token = makeToken(pair.privateKey, "firebase-test-key");
    const registration = {
        id: "registration-1",
        team_id: "team-1",
        manager_uid: "firebase-user-123",
        status: "approved",
        tournament_start: "2024-01-01",
        age_min: null,
        age_max: null,
        guardian_consent_required: 0
    };
    const player = {
        id: "player-1",
        name: "Test Player",
        date_of_birth: "1990-01-01",
        position: "Forward",
        shirt_number: 9
    };
    const calls = [];
    const db = managerPlayerProfileDatabase(registration, player, calls);

    const response = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callManagerPlayerProfile(worker.default, token, db, "full", true));

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
        id: "player-1",
        publicProfile: "full"
    });
    assert.ok(calls.some(function (call) {
        return call.sql.includes("UPDATE afc_players SET public_profile") &&
            call.values[0] === "full";
    }));
    assert.ok(calls.every(function (call) {
        return !call.sql.includes("afc_registration_permissions");
    }));

    const youthCalls = [];
    const youthDb = managerPlayerProfileDatabase(
        { ...registration, age_min: 10, age_max: 14, guardian_consent_required: 1 },
        { ...player, date_of_birth: "2012-01-01" },
        youthCalls
    );
    const youthResponse = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callManagerPlayerProfile(worker.default, token, youthDb, "full", true));
    const youthPayload = await youthResponse.json();

    assert.equal(youthResponse.status, 400);
    assert.equal(youthPayload.error.code, "PRIVACY_RESTRICTION");
    assert.ok(youthCalls.every(function (call) {
        return !call.sql.includes("UPDATE afc_players SET public_profile");
    }));

    const missingConsentCalls = [];
    const missingConsentDb = managerPlayerProfileDatabase(
        registration, player, missingConsentCalls
    );
    const missingConsentResponse = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callManagerPlayerProfile(
        worker.default, token, missingConsentDb, "full", false
    ));
    const missingConsentPayload = await missingConsentResponse.json();
    assert.equal(missingConsentResponse.status, 400);
    assert.equal(missingConsentPayload.error.code, "PRIVACY_RESTRICTION");
    assert.ok(missingConsentCalls.every(function (call) {
        return !call.sql.includes("UPDATE afc_players SET public_profile");
    }));
});

test("admins can update a player's public profile with the same consent restrictions", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const token = makeToken(pair.privateKey, "firebase-test-key");
    const calls = [];
    const db = adminPlayerProfileDatabase({
        id: "player-1",
        tournament_id: "tournament-1",
        guardian_consent_required: 0
    }, calls);
    const response = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callAdminPlayerProfile(worker.default, token, db, "full", true));

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
        id: "player-1",
        publicProfile: "full"
    });
    assert.ok(calls.some(function (call) {
        return call.sql.includes("UPDATE afc_players SET public_profile") &&
            call.values[0] === "full";
    }));

    const scopedAdminCalls = [];
    const scopedAdminDb = adminPlayerProfileDatabase({
        id: "player-1",
        tournament_id: "tournament-1",
        guardian_consent_required: 0
    }, scopedAdminCalls, { role: "tournament_admin", permission: true, scope: true });
    const scopedAdminResponse = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callAdminPlayerProfile(worker.default, token, scopedAdminDb, "limited", false));
    assert.equal(scopedAdminResponse.status, 200);

    const unscopedCalls = [];
    const unscopedDb = adminPlayerProfileDatabase({
        id: "player-1",
        tournament_id: "tournament-1",
        guardian_consent_required: 0
    }, unscopedCalls, { role: "tournament_admin", permission: true, scope: false });
    const unscopedResponse = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callAdminPlayerProfile(worker.default, token, unscopedDb, "hidden", false));
    assert.equal(unscopedResponse.status, 403);
    assert.ok(unscopedCalls.every(function (call) {
        return !call.sql.includes("UPDATE afc_players SET public_profile");
    }));

    const youthCalls = [];
    const youthDb = adminPlayerProfileDatabase({
        id: "player-1",
        tournament_id: "tournament-1",
        guardian_consent_required: 1
    }, youthCalls);
    const youthResponse = await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), () => callAdminPlayerProfile(worker.default, token, youthDb, "full", true));
    const youthPayload = await youthResponse.json();

    assert.equal(youthResponse.status, 400);
    assert.equal(youthPayload.error.code, "PRIVACY_RESTRICTION");
    assert.ok(youthCalls.every(function (call) {
        return !call.sql.includes("UPDATE afc_players SET public_profile");
    }));
});

test("reports non-2xx certificate responses without attempting JSON parsing", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    let parseAttempted = false;
    const { value: response, records } = await withErrorLog(() =>
        withFetch(async () => ({
            ok: false,
            status: 503,
            headers: new Headers(),
            async json() {
                parseAttempted = true;
                throw new Error("should not parse");
            }
        }), () => callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key")))
    );

    assert.equal(response.status, 503);
    assert.equal(parseAttempted, false);
    assertDiagnostic(records, "http_status", 503, false);
});

test("reports invalid certificate JSON", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const { value: response, records } = await withErrorLog(() =>
        withFetch(async () => new Response("{", {
            status: 200,
            headers: { "Cache-Control": "max-age=60" }
        }), () => callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key")))
    );

    assert.equal(response.status, 503);
    assertDiagnostic(records, "json_parse", 200, false);
});

test("reports malformed X.509 certificate data", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const { value: response, records } = await withErrorLog(() =>
        withFetch(async () => certificateResponse({ "firebase-test-key": "not a certificate" }),
            () => callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key")))
    );

    assert.equal(response.status, 503);
    assertDiagnostic(records, "certificate_format", 200, true, null, null, "pem_format");
});

test("refreshes certificates once when the token kid is missing", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const originalWarn = console.warn;
    const warnings = [];
    let fetchCount = 0;
    console.warn = (...args) => warnings.push(args);
    try {
        const response = await withFetch(async () => {
            fetchCount += 1;
            return certificateResponse({ "another-key": certificateFor(pair.publicKey) });
        }, () => callMe(worker.default, makeToken(pair.privateKey, "missing-key")));
        assert.equal(response.status, 401);
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(fetchCount, 2);
    assert.deepEqual(warnings[0][1], {
        category: "kid_not_found",
        httpStatus: 200,
        responseParsed: true
    });
});

test("fetches fresh certificates after the cached max-age expires", async () => {
    const worker = await loadWorker();
    const firstPair = makeKeyPair();
    const secondPair = makeKeyPair();
    const firstCert = certificateFor(firstPair.publicKey);
    const secondCert = certificateFor(secondPair.publicKey);
    const realNow = Date.now;
    let now = realNow();
    let fetchCount = 0;
    Date.now = () => now;
    try {
        await withFetch(async () => {
            fetchCount += 1;
            return certificateResponse(
                fetchCount === 1 ? { "first-key": firstCert } : { "second-key": secondCert },
                { cacheControl: "public, max-age=1" }
            );
        }, async () => {
            const firstResponse = await callMe(worker.default, makeToken(firstPair.privateKey, "first-key"));
            assert.equal(firstResponse.status, 200);
            now += 1001;
            const secondResponse = await callMe(worker.default, makeToken(secondPair.privateKey, "second-key"));
            assert.equal(secondResponse.status, 200);
        });
    } finally {
        Date.now = realNow;
    }

    assert.equal(fetchCount, 2);
});

test("rejects a token with an invalid RS256 signature", async () => {
    const worker = await loadWorker();
    const trustedPair = makeKeyPair();
    const attackerPair = makeKeyPair();
    await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(trustedPair.publicKey)
    }), async () => {
        const response = await callMe(
            worker.default,
            makeToken(attackerPair.privateKey, "firebase-test-key")
        );
        assert.equal(response.status, 401);
    });
});

test("rejects expired Firebase ID tokens", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), async () => {
        const response = await callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key", {
            exp: Math.floor(Date.now() / 1000) - 1
        }));
        assert.equal(response.status, 401);
    });
});

test("rejects tokens issued for a different Firebase project", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), async () => {
        const response = await callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key", {
            aud: "another-firebase-project"
        }));
        assert.equal(response.status, 401);
    });
});

test("rejects tokens with an issuer from a different Firebase project", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    await withFetch(async () => certificateResponse({
        "firebase-test-key": certificateFor(pair.publicKey)
    }), async () => {
        const response = await callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key", {
            iss: "https://securetoken.google.com/another-firebase-project"
        }));
        assert.equal(response.status, 401);
    });
});

test("reports certificate endpoint fetch exceptions safely", async () => {
    const worker = await loadWorker();
    const pair = makeKeyPair();
    const { value: response, records } = await withErrorLog(() =>
        withFetch(async () => {
            const error = new TypeError("network details must not be logged");
            error.cause = { code: "ENOTFOUND" };
            throw error;
        }, () => callMe(worker.default, makeToken(pair.privateKey, "firebase-test-key")))
    );

    assert.equal(response.status, 503);
    assertDiagnostic(records, "fetch_error", null, false, "dns_name_not_found", "TypeError");
    assert.equal(JSON.stringify(records).includes("network details"), false);
});

test("diagnostic route reports response metadata without certificate values", async () => {
    const worker = await loadWorker();
    const firstPair = makeKeyPair();
    const secondPair = makeKeyPair();
    const response = await withFetch(async (url, options) => {
        assert.equal(url, certificateUrl);
        assert.equal(options.redirect, "follow");
        assert.equal(options.headers.Accept, "application/json");
        return certificateResponse({
            "key-one": certificateFor(firstPair.publicKey),
            "key-two": certificateFor(secondPair.publicKey)
        }, { cacheControl: "public, max-age=600" });
    }, () => callDebug(worker.default));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
        fetchSucceeded: true,
        httpStatus: 200,
        contentType: "application/json",
        cacheControl: "public, max-age=600",
        jsonParsed: true,
        certificatesImported: true,
        keyCount: 2
    });
    assert.equal(JSON.stringify(body).includes("BEGIN CERTIFICATE"), false);
});

test("diagnostic route reports the certificate parsing stage without certificate data", async () => {
    const worker = await loadWorker();
    const response = await withFetch(async () => certificateResponse({
        "firebase-test-key": "malformed certificate value"
    }), () => callDebug(worker.default));
    const body = await response.json();

    assert.deepEqual(body, {
        fetchSucceeded: true,
        httpStatus: 200,
        contentType: "application/json",
        cacheControl: "max-age=60",
        jsonParsed: true,
        certificatesImported: false,
        category: "certificate_format",
        stage: "pem_format",
        errorName: null,
        errorCategory: null
    });
    assert.equal(JSON.stringify(body).includes("malformed certificate value"), false);
});

test("diagnostic route skips JSON parsing for non-2xx responses", async () => {
    const worker = await loadWorker();
    let parseAttempted = false;
    const response = await withFetch(async () => ({
        ok: false,
        status: 502,
        headers: new Headers({
            "Content-Type": "text/plain",
            "Cache-Control": "no-store"
        }),
        async json() {
            parseAttempted = true;
            throw new Error("should not parse");
        }
    }), () => callDebug(worker.default));
    const body = await response.json();

    assert.equal(parseAttempted, false);
    assert.deepEqual(body, {
        fetchSucceeded: false,
        httpStatus: 502,
        contentType: "text/plain",
        cacheControl: "no-store",
        jsonParsed: false,
        certificatesImported: false,
        category: "http_status",
        stage: null,
        errorName: null,
        errorCategory: null
    });
});

test("diagnostic route returns only sanitized details when fetch throws", async () => {
    const worker = await loadWorker();
    const response = await withFetch(async () => {
        throw new TypeError("private network details with redirect target");
    }, () => callDebug(worker.default));
    const body = await response.json();

    assert.deepEqual(body, {
        fetchSucceeded: false,
        httpStatus: null,
        contentType: null,
        cacheControl: null,
        jsonParsed: false,
        certificatesImported: false,
        category: "fetch_error",
        stage: null,
        errorName: "TypeError",
        errorCategory: "redirect_rejected"
    });
    assert.equal(JSON.stringify(body).includes("private network details"), false);
});

test("diagnostic route reports invalid JSON without leaking parser details", async () => {
    const worker = await loadWorker();
    const response = await withFetch(async () => new Response("{", {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=60"
        }
    }), () => callDebug(worker.default));
    const body = await response.json();

    assert.deepEqual(body, {
        fetchSucceeded: true,
        httpStatus: 200,
        contentType: "application/json",
        cacheControl: "max-age=60",
        jsonParsed: false,
        certificatesImported: false,
        category: "json_parse",
        stage: null,
        errorName: null,
        errorCategory: null
    });
});
