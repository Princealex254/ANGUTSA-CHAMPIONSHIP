import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let moduleId = 0;

async function loadWorker() {
    const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
    const uniqueSource = `${source}\n;void ${moduleId++};`;
    return import(`data:text/javascript;base64,${Buffer.from(uniqueSource).toString("base64")}`);
}

function database({ accountExists = true } = {}) {
    const counts = new Map();
    return {
        prepare(sql) {
            let values = [];
            return {
                bind(...bindings) {
                    values = bindings;
                    return this;
                },
                async first() {
                    if (sql.includes("FROM afc_users")) {
                        return accountExists ? { firebase_uid: "user-1" } : null;
                    }
                    if (sql.includes("INSERT INTO afc_rate_limits")) {
                        const key = `${values[0]}:${values[1]}`;
                        const count = (counts.get(key) || 0) + 1;
                        counts.set(key, count);
                        return { request_count: count };
                    }
                    return null;
                }
            };
        }
    };
}

async function requestReset(worker, db, email = "admin@example.test") {
    return worker.fetch(new Request("https://worker.example/api/v1/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: "test-turnstile-token" })
    }), {
        DB: db,
        FIREBASE_API_KEY: "public-firebase-api-key",
        TURNSTILE_SECRET_KEY: "test-turnstile-secret",
        ALLOWED_ORIGINS: "https://angutsachampionship.com"
    }, {});
}

function turnstileResponse() {
    return new Response(JSON.stringify({
        success: true,
        hostname: "angutsachampionship.com",
        action: "password-reset"
    }), { status: 200 });
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

test("rejects reset requests for email addresses absent from D1 without calling Firebase", async () => {
    const worker = await loadWorker();
    let firebaseCalls = 0;
    const response = await withFetch(async (url) => {
        if (String(url).includes("/siteverify")) return turnstileResponse();
        firebaseCalls += 1;
        return new Response("{}");
    }, () => requestReset(worker.default, database({ accountExists: false })));

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "EMAIL_NOT_FOUND");
    assert.equal(firebaseCalls, 0);
});

test("sends at most two password reset emails per email per day", async () => {
    const worker = await loadWorker();
    const db = database();
    let firebaseCalls = 0;
    const responses = await withFetch(async (url, options) => {
        if (String(url).includes("/siteverify")) return turnstileResponse();
        firebaseCalls += 1;
        assert.match(String(url), /accounts:sendOobCode\?key=/);
        assert.deepEqual(JSON.parse(options.body), {
            requestType: "PASSWORD_RESET",
            email: "admin@example.test"
        });
        return new Response(JSON.stringify({ email: "admin@example.test" }), { status: 200 });
    }, async () => [
        await requestReset(worker.default, db),
        await requestReset(worker.default, db),
        await requestReset(worker.default, db)
    ]);

    assert.equal(responses[0].status, 200);
    assert.equal(responses[1].status, 200);
    assert.equal(responses[2].status, 429);
    assert.equal((await responses[2].json()).error.code, "RESET_LIMIT_EXCEEDED");
    assert.equal(firebaseCalls, 2);
});

test("reports a missing Firebase identity when the D1 account has no matching auth user", async () => {
    const worker = await loadWorker();
    const response = await withFetch(async (url) => String(url).includes("/siteverify")
            ? turnstileResponse()
            : new Response(JSON.stringify({ error: { message: "EMAIL_NOT_FOUND" } }), { status: 400 }),
        () => requestReset(worker.default, database()));

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "FIREBASE_ACCOUNT_NOT_FOUND");
});
