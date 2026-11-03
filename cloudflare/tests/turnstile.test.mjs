import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const environment = {
    TURNSTILE_SECRET_KEY: "test-secret",
    FIREBASE_API_KEY: "test-firebase-key",
    ALLOWED_ORIGINS: "https://angutsachampionship.com"
};

async function withFetch(fetcher, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
        return await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

function validResult(overrides = {}) {
    return {
        success: true,
        hostname: "angutsachampionship.com",
        action: "password-reset",
        ...overrides
    };
}

function resetRequest(body) {
    return new Request("https://worker.example/api/v1/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

function loginCheckRequest(body) {
    return new Request("https://worker.example/api/v1/auth/login-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

test("sends the server secret and submitted token to Siteverify", async () => {
    await withFetch(async (url, options) => {
        assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        assert.equal(options.method, "POST");
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("secret"), "test-secret");
        assert.equal(form.get("response"), "one-use-token");
        return new Response(JSON.stringify(validResult()));
    }, async () => {
        await workerModule.verifyTurnstile(environment, "one-use-token", "password-reset");
    });
});

test("rejects an absent token before querying or writing D1", async () => {
    let databaseCalls = 0;
    const db = {
        prepare() {
            databaseCalls += 1;
            throw new Error("D1 must not be accessed before token verification.");
        }
    };
    const response = await withFetch(async () => {
        throw new Error("Siteverify must not be called without a token.");
    }, () => workerModule.default.fetch(
        resetRequest({ email: "admin@example.test" }),
        { ...environment, DB: db },
        {}
    ));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "TURNSTILE_REQUIRED");
    assert.equal(databaseCalls, 0);
});

test("login precheck requires server-side verification before sign-in can proceed", async () => {
    let siteverifyCalls = 0;
    const response = await withFetch(async (url, options) => {
        assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("response"), "login-token");
        siteverifyCalls += 1;
        return new Response(JSON.stringify(validResult({ action: "login" })));
    }, () => workerModule.default.fetch(
        loginCheckRequest({ turnstileToken: "login-token" }),
        environment,
        {}
    ));

    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.verified, true);
    assert.equal(siteverifyCalls, 1);
});

test("login precheck rejects a missing token without reaching Siteverify", async () => {
    const response = await withFetch(async () => {
        throw new Error("Siteverify must not be called without a token.");
    }, () => workerModule.default.fetch(loginCheckRequest({}), environment, {}));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "TURNSTILE_REQUIRED");
});

test("rejects expired or reused tokens before D1 access", async () => {
    let databaseCalls = 0;
    const response = await withFetch(async () => new Response(JSON.stringify({
        success: false,
        "error-codes": ["timeout-or-duplicate"]
    })), () => workerModule.default.fetch(
        resetRequest({ email: "admin@example.test", turnstileToken: "spent-token" }),
        {
            ...environment,
            DB: {
                prepare() {
                    databaseCalls += 1;
                    throw new Error("D1 must not be accessed for a rejected token.");
                }
            }
        },
        {}
    ));

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "TURNSTILE_FAILED");
    assert.equal(databaseCalls, 0);
});

test("rejects successful Siteverify results for the wrong hostname or action", async () => {
    for (const result of [
        validResult({ hostname: "preview.angutsachampionship.com" }),
        validResult({ action: "team-registration" })
    ]) {
        await withFetch(async () => new Response(JSON.stringify(result)), async () => {
            await assert.rejects(
                workerModule.verifyTurnstile(environment, "valid-token", "password-reset"),
                error => error.code === (result.hostname === "preview.angutsachampionship.com"
                    ? "TURNSTILE_HOSTNAME_MISMATCH"
                    : "TURNSTILE_ACTION_MISMATCH")
            );
        });
    }
});

test("accepts the hostname from the explicitly configured website origin", async () => {
    const wwwEnvironment = {
        ...environment,
        ALLOWED_ORIGINS: "https://www.angutsachampionship.com"
    };
    await withFetch(async () => new Response(JSON.stringify(validResult({
        hostname: "www.angutsachampionship.com"
    }))), async () => {
        await workerModule.verifyTurnstile(wwwEnvironment, "valid-token", "password-reset");
    });
});

test("fails closed when website origins are wildcard or missing", async () => {
    for (const allowedOrigins of ["*", ""]) {
        await withFetch(async () => new Response(JSON.stringify(validResult())), async () => {
            await assert.rejects(
                workerModule.verifyTurnstile({
                    ...environment,
                    ALLOWED_ORIGINS: allowedOrigins
                }, "valid-token", "password-reset"),
                error => error.code === "TURNSTILE_HOSTNAME_NOT_CONFIGURED"
            );
        });
    }
});

test("fails closed when the Worker secret or Siteverify service is unavailable", async () => {
    await assert.rejects(
        workerModule.verifyTurnstile({}, "valid-token", "password-reset"),
        error => error.code === "TURNSTILE_UNAVAILABLE"
    );
    await withFetch(async () => { throw new Error("network unavailable"); }, async () => {
        await assert.rejects(
            workerModule.verifyTurnstile(environment, "valid-token", "password-reset"),
            error => error.code === "TURNSTILE_UNAVAILABLE"
        );
    });
});
