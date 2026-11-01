import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
    createUserWithEmailAndPassword,
    getAuth,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signInWithEmailAndPassword,
    signOut,
    confirmPasswordReset,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

let platform;
const PUBLIC_BOOTSTRAP_CACHE_TTL_MS = 10000;
let publicBootstrapCache = null;
let publicBootstrapGeneration = 0;

function cloneJsonData(value) {
    return JSON.parse(JSON.stringify(value));
}

const FRIENDLY_ERROR_MESSAGES = Object.freeze({
    "auth/invalid-credential": "The email or password is incorrect. Check your details and try again.",
    "auth/user-not-found": "The email or password is incorrect. Check your details and try again.",
    "auth/wrong-password": "The email or password is incorrect. Check your details and try again.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in or use a different email.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/network-request-failed": "We couldn't connect to the sign-in service. Check your connection and try again.",
    "auth/too-many-requests": "There have been too many attempts. Please wait a few minutes and try again.",
    "auth/expired-action-code": "This link has expired. Request a new password reset email and try again.",
    "auth/invalid-action-code": "This link is no longer valid. Request a new password reset email and try again.",
    "auth/user-disabled": "This account is disabled. Contact the competition office for help.",
    EMAIL_NOT_FOUND: "No championship account exists for this email address.",
    FIREBASE_ACCOUNT_NOT_FOUND: "The championship account exists, but its Firebase sign-in account could not be found. Contact the competition office.",
    RESET_LIMIT_EXCEEDED: "You can request a maximum of two password reset emails per day. Try again tomorrow.",
    PASSWORD_RESET_UNAVAILABLE: "Password reset is temporarily unavailable. Please contact the competition office.",
    ACCOUNT_NOT_ASSIGNED: "Your account hasn't been approved for platform access yet. Contact the competition office if you need help.",
    FORBIDDEN: "You don't have permission to do this. Contact the competition office if you think this is a mistake.",
    NOT_FOUND: "We couldn't find that information. Refresh the page and try again.",
    RATE_LIMITED: "There have been too many attempts. Please wait a few minutes and try again.",
    CORS_NOT_CONFIGURED: "The service is temporarily unavailable. Please try again later.",
    SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again later.",
    INTERNAL_ERROR: "We couldn't complete your request just now. Please try again. If the problem continues, contact the competition office."
});

export function friendlyErrorMessage(error, fallback) {
    const code = error && typeof error.code === "string" ? error.code : "";
    if (code && FRIENDLY_ERROR_MESSAGES[code]) return FRIENDLY_ERROR_MESSAGES[code];

    const message = error && typeof error.message === "string" ? error.message.trim() : "";
    const firebaseCode = message.match(/auth\/[a-z-]+/i);
    if (firebaseCode && FRIENDLY_ERROR_MESSAGES[firebaseCode[0]]) {
        return FRIENDLY_ERROR_MESSAGES[firebaseCode[0]];
    }
    if (firebaseCode || /^Firebase:/i.test(message)) {
        return fallback || "We couldn't complete that request. Check your details and try again.";
    }
    if (error && error.status === 401) {
        return "Your sign-in may have expired. Sign in again and retry.";
    }
    if (error && error.status >= 500) {
        return FRIENDLY_ERROR_MESSAGES.INTERNAL_ERROR;
    }
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
        return fallback || "We couldn't connect to the service. Check your connection and try again.";
    }
    if (/HTTP \d+|unreadable response/i.test(message)) {
        return fallback || "We couldn't complete your request just now. Please try again.";
    }
    return message || fallback || "We couldn't complete your request. Please try again.";
}

function friendlyError(error, fallback) {
    const wrapped = new Error(friendlyErrorMessage(error, fallback));
    if (error && error.code) wrapped.code = error.code;
    if (error && error.status) wrapped.status = error.status;
    return wrapped;
}

function runAuthAction(action, fallback) {
    return Promise.resolve().then(action).catch(function (error) {
        throw friendlyError(error, fallback);
    });
}

function configValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function checkedConfig() {
    const config = window.AngutsaPlatformConfig;
    if (!config || !config.firebase) {
        throw new Error("Account services aren't available right now. Please contact the competition office.");
    }
    const firebase = config.firebase;
    const required = ["apiKey", "authDomain", "projectId", "appId"];
    const missing = required.filter(function (key) { return !configValue(firebase[key]); });
    if (missing.length) {
        throw new Error("Account services aren't available right now. Please contact the competition office.");
    }
    const apiBaseUrl = configValue(config.apiBaseUrl).replace(/\/+$/, "");
    if (!apiBaseUrl) {
        throw new Error("The service is temporarily unavailable. Please try again later.");
    }
    let parsed;
    try {
        parsed = new URL(apiBaseUrl);
    } catch (_error) {
        throw new Error("The service is temporarily unavailable. Please try again later.");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
        throw new Error("We couldn't establish a secure connection. Please contact the competition office.");
    }
    return { firebase: firebase, apiBaseUrl: apiBaseUrl };
}

export function initializePlatform() {
    const config = checkedConfig();
    const app = initializeApp(config.firebase);
    const auth = getAuth(app);
    const authStateReady = auth.authStateReady();

    let appCheck = null;
    if (config.appCheck && config.appCheck.siteKey) {
        try {
            appCheck = initializeAppCheck(app, {
                provider: new ReCaptchaV3Provider(config.appCheck.siteKey),
                isTokenAutoRefreshEnabled: true
            });
        } catch (_error) {
            // App Check is optional; Firebase Auth still protects sign-in.
        }
    }

    platform = {
        auth: auth,
        appCheck: appCheck,
        apiBaseUrl: config.apiBaseUrl,
        friendlyErrorMessage: friendlyErrorMessage,
        async request(path, options) {
            const currentOptions = options || {};
            const headers = new Headers(currentOptions.headers || {});
            await authStateReady;
            const user = auth.currentUser;
            if (user) {
                try {
                    headers.set("Authorization", "Bearer " + await user.getIdToken());
                } catch (error) {
                    throw friendlyError(error, "Your sign-in may have expired. Sign in again and retry.");
                }
            }
            const isBinary = currentOptions.body instanceof ArrayBuffer ||
                ArrayBuffer.isView(currentOptions.body) ||
                (typeof Blob !== "undefined" && currentOptions.body instanceof Blob);
            const isFormData = typeof FormData !== "undefined" &&
                currentOptions.body instanceof FormData;
            if (currentOptions.body !== undefined && !isBinary && !isFormData &&
                !headers.has("Content-Type")) {
                headers.set("Content-Type", "application/json");
            }
            if (isBinary && currentOptions.contentType) {
                headers.set("Content-Type", currentOptions.contentType);
            }
            const method = String(currentOptions.method || "GET").toUpperCase();
            if (method !== "GET") {
                publicBootstrapGeneration += 1;
                publicBootstrapCache = null;
            }
            let response;
            try {
                response = await fetch(config.apiBaseUrl + "/api/v1" + path, {
                    method: method,
                    headers: headers,
                    body: currentOptions.body === undefined
                        ? undefined
                        : isBinary || isFormData || typeof currentOptions.body === "string"
                            ? currentOptions.body
                            : JSON.stringify(currentOptions.body),
                    cache: "no-store"
                });
            } catch (error) {
                throw friendlyError(error, "We couldn't reach the service. Check your connection, then refresh to check whether your change was saved before trying again.");
            }
            let payload;
            try {
                payload = await response.json();
            } catch (_error) {
                throw new Error("We couldn't read the service's response. Please try again.");
            }
            if (!response.ok || !payload || payload.success !== true) {
                const message = payload && payload.error && payload.error.message
                    ? payload.error.message
                    : "";
                const error = new Error(message);
                error.status = response.status;
                error.code = payload && payload.error ? payload.error.code : "REQUEST_FAILED";
                throw friendlyError(error, "We couldn't complete your request just now. Please try again.");
            }
            return payload.data;
        },
        async requestBlob(path) {
            const headers = new Headers();
            await authStateReady;
            const user = auth.currentUser;
            if (user) {
                try {
                    headers.set("Authorization", "Bearer " + await user.getIdToken());
                } catch (error) {
                    throw friendlyError(error, "Your sign-in may have expired. Sign in again and retry.");
                }
            }
            let response;
            try {
                response = await fetch(config.apiBaseUrl + "/api/v1" + path, {
                    headers: headers,
                    cache: "no-store"
                });
            } catch (error) {
                throw friendlyError(error, "We couldn't reach the service. Check your connection, then retry.");
            }
            if (!response.ok) {
                let payload;
                try {
                    payload = await response.json();
                } catch (_error) {
                    payload = null;
                }
                const error = new Error(payload && payload.error && payload.error.message
                    ? payload.error.message
                    : "");
                error.status = response.status;
                error.code = payload && payload.error ? payload.error.code : "REQUEST_FAILED";
                throw friendlyError(error, "We couldn't load this image. Please try again.");
            }
            return response.blob();
        },
        async requestAll(path, pagedCollections, pageSize, mergeCollections) {
            const collections = Array.isArray(pagedCollections) ? pagedCollections : [];
            const mergedCollections = Array.isArray(mergeCollections)
                ? mergeCollections
                : collections;
            const limit = pageSize || 100;
            let combined;

            if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
                throw new Error("The requested page size is invalid.");
            }

            const isPublicBootstrap = /^\/public\/bootstrap(?:\?|$)/.test(path);
            const cacheKey = isPublicBootstrap
                ? JSON.stringify([path, limit, collections, mergedCollections])
                : null;
            const now = Date.now();
            if (cacheKey && publicBootstrapCache &&
                publicBootstrapCache.key === cacheKey &&
                publicBootstrapCache.generation === publicBootstrapGeneration) {
                if (publicBootstrapCache.pending) {
                    return publicBootstrapCache.pending.then(cloneJsonData);
                }
                if (publicBootstrapCache.expiresAt > now) {
                    return cloneJsonData(publicBootstrapCache.value);
                }
                publicBootstrapCache = null;
            }

            const generation = publicBootstrapGeneration;
            const loadAllPages = async () => {
                if (isPublicBootstrap) {
                    const separator = path.indexOf("?") === -1 ? "?" : "&";
                    const initialParams = [];
                    if (collections.length) {
                        initialParams.push("only=" + encodeURIComponent(collections.join(",")));
                    }
                    initialParams.push("limit=" + limit, "offset=0");
                    let page = await this.request(
                        path + separator + initialParams.join("&")
                    );
                    if (!page || typeof page !== "object") {
                        throw new Error("The service returned an invalid page of records.");
                    }
                    combined = Object.assign({}, page);
                    mergedCollections.forEach(function (key) {
                        if (Array.isArray(page[key])) combined[key] = page[key].slice();
                    });
                    let offset = limit;
                    let nextCollections = collections.filter(function (key) {
                        return Array.isArray(page[key]) && page[key].length === limit;
                    });
                    while (nextCollections.length) {
                        page = await this.request(
                            path + separator + "only=" +
                                encodeURIComponent(nextCollections.join(",")) +
                                "&limit=" + limit + "&offset=" + offset
                        );
                        if (!page || typeof page !== "object") {
                            throw new Error("The service returned an invalid page of records.");
                        }
                        nextCollections = nextCollections.filter(function (key) {
                            if (!Array.isArray(page[key])) {
                                throw new Error("The service returned an invalid page of records.");
                            }
                            if (mergedCollections.indexOf(key) !== -1) {
                                combined[key] = (combined[key] || []).concat(page[key]);
                            }
                            return page[key].length === limit;
                        });
                        if (nextCollections.length && offset + limit > 100000) {
                            throw new Error("The service returned more records than can be loaded at once.");
                        }
                        offset += limit;
                    }
                    return combined;
                }

                for (let offset = 0; ; offset += limit) {
                    const separator = path.indexOf("?") === -1 ? "?" : "&";
                    const page = await this.request(
                        path + separator + "limit=" + limit + "&offset=" + offset
                    );
                    if (!page || typeof page !== "object") {
                        throw new Error("The service returned an invalid page of records.");
                    }

                    if (!combined) {
                        combined = Object.assign({}, page);
                        mergedCollections.forEach(function (key) {
                            if (Array.isArray(page[key])) combined[key] = page[key].slice();
                        });
                    } else {
                        mergedCollections.forEach(function (key) {
                            if (Array.isArray(page[key])) {
                                combined[key] = (combined[key] || []).concat(page[key]);
                            }
                        });
                    }

                    const hasMore = collections.some(function (key) {
                        return Array.isArray(page[key]) && page[key].length === limit;
                    });
                    if (!hasMore) return combined;
                    if (offset + limit > 100000) {
                        throw new Error("The service returned more records than can be loaded at once.");
                    }
                }
            };

            const pending = loadAllPages();
            if (cacheKey) {
                publicBootstrapCache = {
                    key: cacheKey,
                    expiresAt: 0,
                    value: null,
                    pending: pending,
                    generation: generation
                };
            }
            try {
                const result = await pending;
                if (cacheKey && generation === publicBootstrapGeneration) {
                    publicBootstrapCache = {
                        key: cacheKey,
                        expiresAt: Date.now() + PUBLIC_BOOTSTRAP_CACHE_TTL_MS,
                        value: cloneJsonData(result),
                        pending: null,
                        generation: generation
                    };
                }
                return result;
            } catch (error) {
                if (cacheKey && publicBootstrapCache &&
                    publicBootstrapCache.key === cacheKey &&
                    publicBootstrapCache.generation === generation) {
                    publicBootstrapCache = null;
                }
                throw error;
            }
        },
        async login(email, password, remember) {
            return runAuthAction(async function () {
                await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
                return signInWithEmailAndPassword(auth, email, password);
            }, "We couldn't sign you in. Check your email and password, then try again.");
        },
        async verifyLoginChallenge(turnstileToken) {
            return this.request("/auth/login-check", {
                method: "POST",
                body: { turnstileToken: turnstileToken }
            });
        },
        async createAccount(email, password, name, phone, requestedAccountType, turnstileToken, suppressOwnerNotification) {
            return runAuthAction(async () => {
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(credential.user, { displayName: name });
                await this.requestAccount(
                    name, phone, requestedAccountType, turnstileToken, suppressOwnerNotification
                );
                return credential.user;
            }, "We couldn't create your account. Check your details and try again.");
        },
        async createManagerIdentity(email) {
            const passwordBytes = crypto.getRandomValues(new Uint8Array(32));
            const temporaryPassword = Array.from(passwordBytes).map(function (byte) {
                return byte.toString(16).padStart(2, "0");
            }).join("");
            let response;
            try {
                response = await fetch(
                    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" +
                        encodeURIComponent(config.firebase.apiKey),
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: email,
                            password: temporaryPassword,
                            returnSecureToken: true
                        }),
                        cache: "no-store"
                    }
                );
            } catch (error) {
                throw friendlyError(error, "We couldn't create the manager's sign-in account. Check your connection and try again.");
            }
            let payload;
            try {
                payload = await response.json();
            } catch (_error) {
                throw new Error("Firebase returned an unreadable account-creation response.");
            }
            if (!response.ok || !payload || !payload.idToken || !payload.localId) {
                const firebaseCode = payload && payload.error && payload.error.message;
                const error = new Error(firebaseCode === "EMAIL_EXISTS"
                    ? "A Firebase account already exists for this email. Ask the manager to use the existing account; it was not changed."
                    : firebaseCode === "OPERATION_NOT_ALLOWED"
                        ? "Email-and-password sign-in is not enabled for this Firebase project."
                        : "Firebase could not create the manager's sign-in account.");
                error.code = firebaseCode || "FIREBASE_ACCOUNT_CREATE_FAILED";
                error.status = response.status;
                throw error;
            }
            return { uid: payload.localId, idToken: payload.idToken };
        },
        async deleteManagerIdentity(idToken) {
            let response;
            try {
                response = await fetch(
                    "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" +
                        encodeURIComponent(config.firebase.apiKey),
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ idToken: idToken }),
                        cache: "no-store"
                    }
                );
            } catch (error) {
                throw friendlyError(error, "The unused Firebase account could not be removed.");
            }
            if (!response.ok) {
                throw new Error("The unused Firebase account could not be removed.");
            }
        },
        async requestAccount(name, phone, requestedAccountType, turnstileToken, suppressOwnerNotification) {
            return this.request("/auth/register-request", {
                method: "POST",
                body: {
                    fullName: name,
                    phone: phone,
                    accountType: requestedAccountType,
                    turnstileToken: turnstileToken,
                    suppressOwnerNotification: suppressOwnerNotification === true
                }
            });
        },
        async uploadTeamLogo(file, turnstileToken) {
            return this.request("/uploads/team-logo", {
                method: "POST",
                headers: { "Turnstile-Token": turnstileToken },
                body: await file.arrayBuffer(),
                contentType: file.type
            });
        },
        async sendPasswordReset(email, turnstileToken) {
            return this.request("/auth/password-reset", {
                method: "POST",
                body: { email: email, turnstileToken: turnstileToken }
            });
        },
        async resetPassword(code, password) {
            return runAuthAction(function () {
                return confirmPasswordReset(auth, code, password);
            }, "We couldn't update your password. Request a new reset link and try again.");
        },
        async logout() {
            return runAuthAction(function () {
                return signOut(auth);
            }, "We couldn't sign you out. Please try again.");
        },
        currentUser() {
            return auth.currentUser;
        },
        async account() {
            return this.request("/auth/me");
        }
    };

    window.AngutsaPlatform = platform;
    return platform;
}
