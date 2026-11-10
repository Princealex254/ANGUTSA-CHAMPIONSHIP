const FIREBASE_PROJECT_ID = "angutsa-football-championship";
const FIREBASE_ISSUER = "https://securetoken.google.com/" + FIREBASE_PROJECT_ID;
const FIREBASE_CERT_URL =
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const API_PREFIX = "/api/v1";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_JSON_BYTES = 65536;
const MAX_UPLOAD_BYTES = 5242880;
const CLOCK_SKEW_SECONDS = 300;
const MAX_TOKEN_LIFETIME_SECONDS = 3700;
const ADMIN_WHATSAPP_NUMBER = "254707119367";
const ADMIN_WHATSAPP_DISPLAY = "0707 119 367";
const AUTO_APPROVAL_REVIEW_NOTE = "Automatically approved after full registration fee confirmation.";
const DEFAULT_PAYMENT_SETTINGS = Object.freeze({
    method: "M-Pesa",
    number: "0707119367",
    accountName: "KELVIN MAGORO"
});
const PUBLIC_STANDINGS_CACHE_TTL_MS = 15000;
const PUBLIC_STANDINGS_CACHE_MAX_ENTRIES = 64;
const PUBLIC_STANDINGS_CACHE_MAX_BODY_BYTES = 131072;
const PUBLIC_READ_RATE_LIMIT = 120;
const PUBLIC_READ_RATE_WINDOW_MS = 60000;
const PUBLIC_READ_RATE_LIMIT_MAX_ENTRIES = 2048;
const AUTOMATIC_MATCH_RECONCILE_TTL_MS = 20000;

let certificateCache = null;
const publicStandingsCache = new Map();
const publicReadRateLimits = new Map();
let publicReadRateLimitCleanupAt = 0;
let publicStandingsCacheGeneration = 0;
let automaticMatchReconcileAt = 0;
let automaticMatchReconcilePromise = null;

class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }

}

function fail(status, code, message) {
    throw new HttpError(status, code, message);
}

function eatDateKey(date) {
    const eatDate = new Date((date || new Date()).getTime() + 3 * 60 * 60 * 1000);
    return eatDate.getUTCFullYear() + "-" +
        String(eatDate.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(eatDate.getUTCDate()).padStart(2, "0");
}

function matchKickoffTimestamp(kickoff) {
    const value = String(kickoff || "").trim();
    if (!value) return null;
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
    const timestamp = Date.parse(hasTimezone ? value : value + "+03:00");
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isMatchLineupDay(match, now) {
    const kickoff = matchKickoffTimestamp(match.kickoff);
    return kickoff !== null &&
        eatDateKey(new Date(kickoff)) === eatDateKey(now || new Date());
}

export function isMatchLineupOpen(match, now) {
    const currentTime = now || new Date();
    const kickoff = matchKickoffTimestamp(match.kickoff);
    return Number(match.published) === 1 && match.status === "scheduled" &&
        kickoff !== null && isMatchLineupDay(match, currentTime) &&
        currentTime.getTime() < kickoff;
}

export function isRegistrationWindowOpen(registrationOpens, registrationCloses, now) {
    const today = eatDateKey(now);
    return Boolean(registrationOpens) &&
        today >= registrationOpens &&
        (!registrationCloses || today <= registrationCloses);
}

export function isRosterChangePermissionActive(permission, now) {
    if (!permission || Number(permission.roster_changes_after_start) !== 1) return false;
    if (!permission.roster_changes_expires_at) return true;
    const expiresAt = Date.parse(permission.roster_changes_expires_at);
    const nowTime = now === undefined ? Date.now() :
        now instanceof Date ? now.getTime() : Number(now);
    return Number.isFinite(expiresAt) && Number.isFinite(nowTime) && expiresAt > nowTime;
}

export function hasApprovedTeamManagerAccess(user) {
    return Boolean(user && user.role === "team_manager" && user.status === "active");
}

export function canCreateTeamRegistration(user) {
    return hasApprovedTeamManagerAccess(user) ||
        Boolean(user && user.status === "pending" &&
            (user.role === null || user.role === "team_manager") &&
            user.requested_account_type === "team-manager");
}

function jsonResponse(status, body, headers) {
    const responseHeaders = new Headers(headers || {});
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(JSON.stringify(body), { status: status, headers: responseHeaders });
}

function turnstileHostnames(env) {
    const configured = String(env.ALLOWED_ORIGINS || "").trim();
    if (!configured || configured === "*") {
        fail(503, "TURNSTILE_HOSTNAME_NOT_CONFIGURED",
            "Website verification is temporarily unavailable. Please try again later.");
    }

    const hostnames = configured.split(",").map(function (item) {
        const origin = normalizeOrigin(item.trim());
        return origin ? new URL(origin).hostname.toLowerCase() : null;
    }).filter(Boolean);
    if (hostnames.length === 0) {
        fail(503, "TURNSTILE_HOSTNAME_NOT_CONFIGURED",
            "Website verification is temporarily unavailable. Please try again later.");
    }
    return hostnames;
}

export async function verifyTurnstile(env, token, expectedAction) {
    const secret = typeof env.TURNSTILE_SECRET_KEY === "string"
        ? env.TURNSTILE_SECRET_KEY.trim()
        : "";
    if (!secret) {
        fail(503, "TURNSTILE_UNAVAILABLE",
            "Verification is temporarily unavailable. Please try again later.");
    }
    if (typeof token !== "string" || !token.trim() || token.length > 2048) {
        fail(400, "TURNSTILE_REQUIRED",
            "Complete the security check and submit the form again.");
    }

    const form = new URLSearchParams({ secret: secret, response: token.trim() });
    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            cache: "no-store"
        });
        if (!response.ok) {
            fail(503, "TURNSTILE_UNAVAILABLE",
                "Verification is temporarily unavailable. Please try again later.");
        }
        let result;
        try {
            result = await response.json();
        } catch (_error) {
            fail(503, "TURNSTILE_UNAVAILABLE",
                "Verification is temporarily unavailable. Please try again later.");
        }
        if (!result || result.success !== true) {
            fail(403, "TURNSTILE_FAILED",
                "The security check expired or could not be verified. Please complete it again.");
        }
        if (!turnstileHostnames(env).includes(
            typeof result.hostname === "string" ? result.hostname.toLowerCase() : ""
        )) {
            fail(403, "TURNSTILE_HOSTNAME_MISMATCH",
                "The security check could not be verified for this website.");
        }
        if (result.action !== expectedAction) {
            fail(403, "TURNSTILE_ACTION_MISMATCH",
                "The security check could not be verified for this submission.");
        }
    } catch (error) {
        if (error instanceof HttpError) throw error;
        fail(503, "TURNSTILE_UNAVAILABLE",
            "Verification is temporarily unavailable. Please try again later.");
    }
}

function success(data, status) {
    return jsonResponse(status || 200, { success: true, data: data });
}

function errorResponse(error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof HttpError
        ? error.message
        : "We couldn't complete your request just now. Please try again. If the problem continues, contact the competition office.";
    return jsonResponse(status, {
        success: false,
        error: { code: code, message: message }
    });
}

function withSecurityHeaders(response) {
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}

function normalizeOrigin(value) {
    try {
        const parsed = new URL(value);
        if (parsed.origin === "null" || parsed.origin !== value.replace(/\/+$/, "")) return null;
        return parsed.origin;
    } catch (_error) {
        return null;
    }
}

function corsConfiguration(env, origin) {
    const configured = String(env.ALLOWED_ORIGINS || "").trim();
    if (!configured) fail(503, "CORS_NOT_CONFIGURED", "The service is temporarily unavailable. Please try again later.");

    const isWildcard = configured === "*";
    const allowed = isWildcard
        ? null
        : configured.split(",").map(function (item) {
            return normalizeOrigin(item.trim());
        }).filter(Boolean);

    if (!isWildcard && allowed.length === 0) {
        fail(503, "CORS_NOT_CONFIGURED", "The service is temporarily unavailable. Please try again later.");
    }
    if (!origin) return { allowed: true, origin: null, wildcard: isWildcard };

    const normalizedOrigin = normalizeOrigin(origin);
    const matches = isWildcard || (normalizedOrigin && allowed.indexOf(normalizedOrigin) !== -1);
    return {
        allowed: Boolean(matches),
        origin: isWildcard ? "*" : normalizedOrigin,
        wildcard: isWildcard
    };
}

function applyCors(response, cors) {
    if (!cors || !cors.allowed) return response;
    const headers = new Headers(response.headers);
    if (cors.origin) headers.set("Access-Control-Allow-Origin", cors.origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, Turnstile-Token");
    headers.set("Access-Control-Max-Age", "600");
    if (!cors.wildcard) headers.append("Vary", "Origin");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}

function dbFor(env) {
    if (!env.DB || typeof env.DB.prepare !== "function") {
        fail(503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later.");
    }
    return env.DB;
}

function prepareBound(db, sql, values) {
    return db.prepare(sql).bind(...values);
}

async function readLimitedText(request, maximum) {
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > maximum) fail(413, "BODY_TOO_LARGE", "The request body is too large.");
    if (!request.body) return "";

    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maximum) {
            await reader.cancel();
            fail(413, "BODY_TOO_LARGE", "The request body is too large.");
        }
        chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(function (chunk) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readLimitedBytes(request, maximum) {
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > maximum) fail(413, "UPLOAD_TOO_LARGE", "The image must be 5 MB or smaller.");
    if (!request.body) fail(400, "INVALID_UPLOAD", "The upload is empty.");
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maximum) {
            await reader.cancel();
            fail(413, "UPLOAD_TOO_LARGE", "The image must be 5 MB or smaller.");
        }
        chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(function (chunk) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return bytes;
}

async function readJson(request) {
    const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
        fail(415, "UNSUPPORTED_MEDIA_TYPE", "Please refresh the page and submit the form again.");
    }
    let value;
    try {
        value = JSON.parse(await readLimitedText(request, MAX_JSON_BYTES));
    } catch (error) {
        if (error instanceof HttpError) throw error;
        fail(400, "INVALID_JSON", "We couldn't read your submission. Please refresh the page and try again.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(400, "INVALID_BODY", "We couldn't read your submission. Please check the form and try again.");
    }
    return value;
}

function text(value, field, options) {
    const settings = options || {};
    if (typeof value !== "string") {
        if (settings.required) fail(400, "INVALID_INPUT", field + " is required.");
        return "";
    }
    const result = value.trim();
    if (settings.required && !result) fail(400, "INVALID_INPUT", field + " is required.");
    if (result.length > (settings.max || 200)) {
        fail(400, "INVALID_INPUT", field + " is too long.");
    }
    return result;
}

function validEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail(400, "INVALID_EMAIL", "Enter a valid email address.");
    }
    return email;
}

export async function emailBlockHash(email) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(String(email || "").trim().toLowerCase())
    );
    return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
    }).join("");
}

function validId(value, field) {
    const id = String(value || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        fail(400, "INVALID_INPUT", (field || "Identifier") + " is invalid.");
    }
    return id;
}

function integer(value, field, minimum, maximum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        fail(400, "INVALID_INPUT", field + " is invalid.");
    }
    return number;
}

function bool(value) {
    return value === true || value === 1 || value === "1";
}

function slugify(value) {
    return String(value || "").toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

function newId(prefix) {
    return prefix + crypto.randomUUID();
}

function base64UrlDecode(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    let binary;
    try {
        binary = atob(padded);
    } catch (_error) {
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function parseJwtPart(value) {
    try {
        const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            fail(401, "UNAUTHORIZED", "Please sign in to continue.");
        }
        return parsed;
    } catch (_error) {
        if (_error instanceof HttpError) throw _error;
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
}

class CertificateParsingError extends Error {
    constructor(stage) {
        super(stage);
        this.stage = stage;
    }
}

function readDerValue(bytes, offset, limit) {
    const endLimit = limit === undefined ? bytes.length : limit;
    if (!Number.isInteger(offset) || !Number.isInteger(endLimit) ||
        offset < 0 || endLimit > bytes.length || offset + 2 > endLimit) {
        throw new Error("Invalid certificate encoding.");
    }
    const tag = bytes[offset];
    let valueOffset = offset + 1;
    if ((tag & 0x1f) === 0x1f) {
        let tagNumber = 0;
        let tagByte;
        let tagOctets = 0;
        do {
            if (valueOffset >= endLimit || tagOctets >= 7) {
                throw new Error("Invalid certificate tag.");
            }
            tagByte = bytes[valueOffset];
            if (tagOctets === 0 && (tagByte & 0x7f) === 0) {
                throw new Error("Non-canonical certificate tag.");
            }
            tagNumber = tagNumber * 128 + (tagByte & 0x7f);
            if (!Number.isSafeInteger(tagNumber)) throw new Error("Invalid certificate tag.");
            valueOffset += 1;
            tagOctets += 1;
        } while (tagByte & 0x80);
        if (tagNumber < 31) throw new Error("Non-canonical certificate tag.");
    }
    if (valueOffset >= endLimit) throw new Error("Invalid certificate encoding.");
    let length = bytes[valueOffset];
    valueOffset += 1;
    if (length & 0x80) {
        const count = length & 0x7f;
        if (count === 0 || count > 4 || valueOffset + count > endLimit ||
            bytes[valueOffset] === 0) {
            throw new Error("Invalid certificate length.");
        }
        length = 0;
        for (let index = 0; index < count; index += 1) {
            length = length * 256 + bytes[valueOffset + index];
        }
        if (length < 128 || (count > 1 && length < Math.pow(256, count - 1))) {
            throw new Error("Non-canonical certificate length.");
        }
        valueOffset += count;
    }
    const end = valueOffset + length;
    if (!Number.isSafeInteger(end) || end > endLimit) throw new Error("Invalid certificate value.");
    return { tag: tag, start: offset, valueOffset: valueOffset, end: end };
}

function certificateSubjectPublicKeyInfo(pem) {
    let stage = "pem_format";
    try {
        if (typeof pem !== "string") throw new Error("Invalid certificate format.");
        const normalizedPem = pem.trim();
        const match = normalizedPem.match(
            /^-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)\s*-----END CERTIFICATE-----$/
        );
        if (!match) throw new Error("Invalid certificate format.");

        stage = "base64_decode";
        const base64 = match[1].replace(/\s/g, "");
        if (!base64 || base64.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            throw new Error("Invalid certificate encoding.");
        }
        const binary = atob(base64);
        const der = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            der[index] = binary.charCodeAt(index);
        }

        stage = "der_outer_sequence";
        const certificate = readDerValue(der, 0, der.length);
        if (certificate.tag !== 0x30 || certificate.end !== der.length) {
            throw new Error("Invalid certificate sequence.");
        }

        stage = "tbs_certificate";
        const tbs = readDerValue(der, certificate.valueOffset, certificate.end);
        if (tbs.tag !== 0x30 || tbs.end >= certificate.end) {
            throw new Error("Invalid certificate body.");
        }
        const readTbsValue = function (offset, expectedTag) {
            const value = readDerValue(der, offset, tbs.end);
            if (expectedTag !== undefined && value.tag !== expectedTag) {
                throw new Error("Invalid TBSCertificate field.");
            }
            return value;
        };
        const validateAlgorithmIdentifier = function (algorithm, limit) {
            if (algorithm.tag !== 0x30) throw new Error("Invalid certificate algorithm.");
            const oid = readDerValue(der, algorithm.valueOffset, algorithm.end);
            if (oid.tag !== 0x06 || oid.valueOffset === oid.end) {
                throw new Error("Invalid certificate algorithm identifier.");
            }
            if (oid.end < algorithm.end) {
                const parameters = readDerValue(der, oid.end, algorithm.end);
                if (parameters.end !== algorithm.end) {
                    throw new Error("Invalid certificate algorithm parameters.");
                }
                validateConstructed(parameters);
            }
            if (algorithm.end > limit) throw new Error("Invalid certificate algorithm bounds.");
        };
        const validateConstructed = function (value, depth) {
            if ((value.tag & 0x20) === 0) return;
            const nestingDepth = depth || 0;
            if (nestingDepth >= 32) throw new Error("Certificate nesting is too deep.");
            let childOffset = value.valueOffset;
            while (childOffset < value.end) {
                const child = readDerValue(der, childOffset, value.end);
                validateConstructed(child, nestingDepth + 1);
                childOffset = child.end;
            }
            if (childOffset !== value.end) throw new Error("Invalid constructed certificate value.");
        };
        const validateBitString = function (bitString) {
            const contentLength = bitString.end - bitString.valueOffset;
            if (bitString.tag !== 0x03 || contentLength < 2 ||
                der[bitString.valueOffset] > 7) {
                throw new Error("Invalid certificate bit string.");
            }
            const unusedBits = der[bitString.valueOffset];
            if (unusedBits > 0 &&
                (der[bitString.end - 1] & ((1 << unusedBits) - 1)) !== 0) {
                throw new Error("Invalid certificate bit string padding.");
            }
        };

        let cursor = tbs.valueOffset;
        let item = readTbsValue(cursor);
        if (item.tag === 0xa0) {
            const version = readDerValue(der, item.valueOffset, item.end);
            if (version.tag !== 0x02 || version.end !== item.end ||
                version.end - version.valueOffset !== 1 ||
                der[version.valueOffset] > 2) {
                throw new Error("Invalid certificate version.");
            }
            cursor = item.end;
        }

        const serial = readTbsValue(cursor, 0x02);
        if (serial.valueOffset === serial.end ||
            (der[serial.valueOffset] & 0x80) !== 0) {
            throw new Error("Invalid certificate serial number.");
        }
        cursor = serial.end;

        const tbsAlgorithm = readTbsValue(cursor, 0x30);
        validateAlgorithmIdentifier(tbsAlgorithm, tbs.end);
        cursor = tbsAlgorithm.end;

        const issuer = readTbsValue(cursor, 0x30);
        validateConstructed(issuer);
        cursor = issuer.end;

        const validity = readTbsValue(cursor, 0x30);
        const notBefore = readDerValue(der, validity.valueOffset, validity.end);
        const notAfter = readDerValue(der, notBefore.end, validity.end);
        if ((notBefore.tag !== 0x17 && notBefore.tag !== 0x18) ||
            (notAfter.tag !== 0x17 && notAfter.tag !== 0x18) ||
            notAfter.end !== validity.end) {
            throw new Error("Invalid certificate validity.");
        }
        cursor = validity.end;

        const subject = readTbsValue(cursor, 0x30);
        validateConstructed(subject);
        cursor = subject.end;

        stage = "subject_public_key_info";
        const subjectPublicKeyInfo = readTbsValue(cursor, 0x30);
        const publicKeyAlgorithm = readDerValue(
            der, subjectPublicKeyInfo.valueOffset, subjectPublicKeyInfo.end
        );
        validateAlgorithmIdentifier(publicKeyAlgorithm, subjectPublicKeyInfo.end);
        const publicKey = readDerValue(der, publicKeyAlgorithm.end, subjectPublicKeyInfo.end);
        validateBitString(publicKey);
        if (publicKey.end !== subjectPublicKeyInfo.end) {
            throw new Error("Invalid SubjectPublicKeyInfo structure.");
        }
        validateConstructed(subjectPublicKeyInfo);

        stage = "certificate_structure";
        cursor = subjectPublicKeyInfo.end;
        let lastOptionalTag = 0x80;
        while (cursor < tbs.end) {
            const optionalField = readTbsValue(cursor);
            if ((optionalField.tag !== 0x81 && optionalField.tag !== 0x82 &&
                optionalField.tag !== 0xa3) || optionalField.tag <= lastOptionalTag) {
                throw new Error("Invalid optional certificate field.");
            }
            if (optionalField.tag === 0x81 || optionalField.tag === 0x82) {
                const bitString = {
                    tag: 0x03,
                    valueOffset: optionalField.valueOffset,
                    end: optionalField.end
                };
                validateBitString(bitString);
            } else {
                const extensions = readDerValue(
                    der, optionalField.valueOffset, optionalField.end
                );
                if (extensions.tag !== 0x30 || extensions.end !== optionalField.end) {
                    throw new Error("Invalid certificate extensions.");
                }
                validateConstructed(extensions);
                let extensionCursor = extensions.valueOffset;
                while (extensionCursor < extensions.end) {
                    const extension = readDerValue(der, extensionCursor, extensions.end);
                    if (extension.tag !== 0x30) throw new Error("Invalid certificate extension.");
                    const oid = readDerValue(der, extension.valueOffset, extension.end);
                    if (oid.tag !== 0x06 || oid.valueOffset === oid.end) {
                        throw new Error("Invalid certificate extension identifier.");
                    }
                    let valueCursor = oid.end;
                    let extensionValue = readDerValue(der, valueCursor, extension.end);
                    if (extensionValue.tag === 0x01) {
                        if (extensionValue.end - extensionValue.valueOffset !== 1 ||
                            (der[extensionValue.valueOffset] !== 0 &&
                                der[extensionValue.valueOffset] !== 0xff)) {
                            throw new Error("Invalid certificate extension critical flag.");
                        }
                        valueCursor = extensionValue.end;
                        extensionValue = readDerValue(der, valueCursor, extension.end);
                    }
                    if (extensionValue.tag !== 0x04 || extensionValue.end !== extension.end) {
                        throw new Error("Invalid certificate extension value.");
                    }
                    extensionCursor = extension.end;
                }
            }
            lastOptionalTag = optionalField.tag;
            cursor = optionalField.end;
        }

        const signatureAlgorithm = readDerValue(der, tbs.end, certificate.end);
        validateAlgorithmIdentifier(signatureAlgorithm, certificate.end);
        if (signatureAlgorithm.end - signatureAlgorithm.start !==
            tbsAlgorithm.end - tbsAlgorithm.start) {
            throw new Error("Mismatched certificate signature algorithms.");
        }
        for (let index = 0; index < signatureAlgorithm.end - signatureAlgorithm.start; index += 1) {
            if (der[signatureAlgorithm.start + index] !== der[tbsAlgorithm.start + index]) {
                throw new Error("Mismatched certificate signature algorithms.");
            }
        }
        const signature = readDerValue(der, signatureAlgorithm.end, certificate.end);
        validateBitString(signature);
        if (signature.end !== certificate.end) {
            throw new Error("Invalid certificate signature structure.");
        }
        return der.slice(subjectPublicKeyInfo.start, subjectPublicKeyInfo.end);
    } catch (_error) {
        if (_error instanceof CertificateParsingError) throw _error;
        throw new CertificateParsingError(stage);
    }
}

function cacheMaxAge(response) {
    const header = response.headers.get("Cache-Control") || "";
    if (/(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|$)/i.test(header)) return 0;
    const match = header.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?\s*(?=,|$)/i);
    if (!match) return 0;
    const seconds = Number(match[1]);
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : 0;
}

class CertificateRetrievalError extends Error {
    constructor(category, httpStatus, responseParsed, fetchFailure, fetchErrorName, stage, responseMetadata) {
        super(category);
        this.category = category;
        this.httpStatus = httpStatus;
        this.responseParsed = responseParsed;
        this.fetchFailure = fetchFailure || null;
        this.fetchErrorName = fetchErrorName || null;
        this.stage = stage || null;
        this.contentType = responseMetadata ? responseMetadata.contentType : null;
        this.cacheControl = responseMetadata ? responseMetadata.cacheControl : null;
    }
}

function safeFetchErrorDetails(error) {
    const message = error && typeof error.message === "string" ? error.message.toLowerCase() : "";
    const causeCode = error && error.cause && typeof error.cause.code === "string"
        ? error.cause.code
        : "";
    const knownCodes = {
        ECONNRESET: "connection_reset",
        ECONNREFUSED: "connection_refused",
        ETIMEDOUT: "timeout",
        EAI_AGAIN: "dns_temporary_failure",
        ENOTFOUND: "dns_name_not_found",
        CERT_HAS_EXPIRED: "tls_certificate_expired",
        ERR_TLS_CERT_ALTNAME_INVALID: "tls_hostname_mismatch",
        UND_ERR_CONNECT_TIMEOUT: "connection_timeout",
        UND_ERR_HEADERS_TIMEOUT: "response_headers_timeout",
        UND_ERR_SOCKET: "socket_error"
    };
    let fetchFailure = Object.prototype.hasOwnProperty.call(knownCodes, causeCode)
        ? knownCodes[causeCode]
        : "unclassified_fetch_error";
    if (/redirect/.test(message)) fetchFailure = "redirect_rejected";
    else if (/dns|resolve|hostname/.test(message)) fetchFailure = "dns_error";
    else if (/tls|certificate|ssl/.test(message)) fetchFailure = "tls_error";
    else if (/timeout|timed out/.test(message)) fetchFailure = "timeout";

    const allowedNames = ["Error", "TypeError", "AbortError", "TimeoutError"];
    const fetchErrorName = error && allowedNames.indexOf(error.name) !== -1
        ? error.name
        : "Other";
    return { fetchFailure: fetchFailure, fetchErrorName: fetchErrorName };
}

async function fetchCertificates(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && certificateCache && now < certificateCache.expiresAt) {
        return { keys: certificateCache.keys, httpStatus: null, responseParsed: true };
    }

    let response;
    try {
        response = await fetch(FIREBASE_CERT_URL, {
            headers: { Accept: "application/json" },
            redirect: "follow"
        });
    } catch (error) {
        const details = safeFetchErrorDetails(error);
        throw new CertificateRetrievalError(
            "fetch_error", null, false, details.fetchFailure, details.fetchErrorName
        );
    }
    const responseMetadata = {
        contentType: response.headers.get("Content-Type"),
        cacheControl: response.headers.get("Cache-Control")
    };
    if (!response.ok) {
        throw new CertificateRetrievalError(
            "http_status", response.status, false, null, null, null, responseMetadata
        );
    }

    let certificates;
    try {
        certificates = await response.json();
    } catch (_error) {
        throw new CertificateRetrievalError(
            "json_parse", response.status, false, null, null, null, responseMetadata
        );
    }
    if (!certificates || typeof certificates !== "object" || Array.isArray(certificates)) {
        throw new CertificateRetrievalError(
            "json_shape", response.status, true, null, null, null, responseMetadata
        );
    }

    const imported = new Map();
    for (const [keyId, pem] of Object.entries(certificates)) {
        if (typeof pem !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(keyId)) {
            throw new CertificateRetrievalError(
                "certificate_format", response.status, true, null, null,
                "certificate_mapping", responseMetadata
            );
        }
        let spki;
        try {
            spki = certificateSubjectPublicKeyInfo(pem);
        } catch (error) {
            const stage = error instanceof CertificateParsingError ? error.stage : "pem_format";
            throw new CertificateRetrievalError(
                "certificate_format", response.status, true, null, null, stage, responseMetadata
            );
        }
        try {
            const key = await crypto.subtle.importKey(
                "spki",
                spki,
                { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
                false,
                ["verify"]
            );
            imported.set(keyId, key);
        } catch (_error) {
            throw new CertificateRetrievalError(
                "key_import", response.status, true, null, null,
                "webcrypto_key_import", responseMetadata
            );
        }
    }
    if (imported.size === 0) {
        throw new CertificateRetrievalError(
            "no_usable_certificates", response.status, true, null, null, null, responseMetadata
        );
    }
    certificateCache = {
        keys: imported,
        expiresAt: Date.now() + cacheMaxAge(response)
    };
    return {
        keys: imported,
        httpStatus: response.status,
        responseParsed: true,
        contentType: response.headers.get("Content-Type"),
        cacheControl: response.headers.get("Cache-Control")
    };
}

async function verifyFirebaseToken(token) {
    if (typeof token !== "string" || token.length > 8192) {
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    const parts = token.split(".");
    if (parts.length !== 3) fail(401, "UNAUTHORIZED", "Please sign in to continue.");

    const header = parseJwtPart(parts[0]);
    const claims = parseJwtPart(parts[1]);
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) {
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }

    let certificates;
    try {
        certificates = await fetchCertificates(false);
        if (!certificates.keys.has(header.kid)) {
            certificates = await fetchCertificates(true);
        }
    } catch (error) {
        if (error instanceof HttpError) throw error;
        const diagnostic = error instanceof CertificateRetrievalError
            ? error
            : new CertificateRetrievalError("unexpected", null, false);
        console.error("Firebase signing certificate retrieval failed.", {
            category: diagnostic.category,
            httpStatus: diagnostic.httpStatus,
            responseParsed: diagnostic.responseParsed,
            fetchFailure: diagnostic.fetchFailure,
            fetchErrorName: diagnostic.fetchErrorName,
            stage: diagnostic.stage
        });
        fail(503, "AUTHENTICATION_UNAVAILABLE", "Authentication could not be verified. Try again.");
    }

    const key = certificates.keys.get(header.kid);
    if (!key) {
        console.warn("Firebase signing certificate key was not found after refresh.", {
            category: "kid_not_found",
            httpStatus: certificates.httpStatus,
            responseParsed: certificates.responseParsed
        });
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    let signatureValid = false;
    try {
        signatureValid = await crypto.subtle.verify(
            { name: "RSASSA-PKCS1-v1_5" },
            key,
            base64UrlDecode(parts[2]),
            new TextEncoder().encode(parts[0] + "." + parts[1])
        );
    } catch (_error) {
        signatureValid = false;
    }
    if (!signatureValid) fail(401, "UNAUTHORIZED", "Please sign in to continue.");

    const nowSeconds = Math.floor(Date.now() / 1000);
    const numericClaims = ["exp", "iat", "auth_time"];
    if (numericClaims.some(function (claim) {
        return typeof claims[claim] !== "number" || !Number.isFinite(claims[claim]);
    })) {
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    if (claims.aud !== FIREBASE_PROJECT_ID || claims.iss !== FIREBASE_ISSUER ||
        typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
        claims.exp <= nowSeconds || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
        claims.auth_time <= 0 || claims.iat <= 0 || claims.exp <= 0 ||
        claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS ||
        claims.auth_time > claims.iat + CLOCK_SKEW_SECONDS ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS ||
        (claims.nbf !== undefined && (typeof claims.nbf !== "number" ||
            claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS))) {
        fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    }
    return claims;
}

async function authenticate(request, env) {
    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
    if (!match) fail(401, "UNAUTHORIZED", "Please sign in to continue.");
    const claims = await verifyFirebaseToken(match[1]);
    return { claims: claims, db: dbFor(env) };
}

async function loadAccount(auth) {
    const user = await auth.db.prepare(
        "SELECT firebase_uid, email, full_name, phone, role, requested_account_type, status, " +
        "email_verified FROM afc_users WHERE firebase_uid = ?"
    ).bind(auth.claims.sub).first();
    if (!user) return null;
    if (user.status === "disabled" || user.status === "suspended") {
        fail(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the competitions office.");
    }
    if (auth.claims.email_verified === true && user.email_verified !== 1) {
        await auth.db.prepare(
            "UPDATE afc_users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP " +
            "WHERE firebase_uid = ?"
        ).bind(auth.claims.sub).run();
        user.email_verified = 1;
    }
    return user;
}

const ADMIN_PERMISSION_CATALOG = Object.freeze([
    ["dashboard.view", "dashboard", "Dashboard", "view", "View dashboard"],
    ["tournaments.view", "tournaments", "Tournaments", "view", "View tournaments"],
    ["tournaments.create", "tournaments", "Tournaments", "create", "Create tournaments"],
    ["tournaments.edit", "tournaments", "Tournaments", "edit", "Edit tournaments and group allocations"],
    ["tournaments.archive", "tournaments", "Tournaments", "archive", "Archive tournaments"],
    ["categories.view", "categories", "Tournament Categories", "view", "View categories"],
    ["categories.create", "categories", "Tournament Categories", "create", "Create categories"],
    ["categories.edit", "categories", "Tournament Categories", "edit", "Edit categories"],
    ["categories.archive", "categories", "Tournament Categories", "archive", "Archive categories"],
    ["teams.view", "teams", "Teams", "view", "View teams"],
    ["teams.create", "teams", "Teams", "create", "Create teams"],
    ["teams.edit", "teams", "Teams", "edit", "Edit teams"],
    ["teams.archive", "teams", "Teams", "archive", "Archive teams"],
    ["teams.delete", "teams", "Teams", "delete", "Delete teams"],
    ["players.view", "players", "Players", "view", "View player records"],
    ["players.edit", "players", "Players", "edit", "Change player public-profile settings"],
    ["registrations.view", "registrations", "Team Registrations", "view", "View registrations"],
    ["registrations.approve", "registrations", "Team Registrations", "approve", "Approve registrations"],
    ["registrations.reject", "registrations", "Team Registrations", "reject", "Reject registrations"],
    ["registrations.edit", "registrations", "Team Registrations", "edit", "Request corrections and change registration permissions"],
    ["fixtures.view", "fixtures", "Fixtures", "view", "View fixtures"],
    ["fixtures.create", "fixtures", "Fixtures", "create", "Create fixtures"],
    ["fixtures.edit", "fixtures", "Fixtures", "edit", "Edit fixtures and match status"],
    ["fixtures.delete", "fixtures", "Fixtures", "delete", "Archive fixtures"],
    ["fixtures.reschedule", "fixtures", "Fixtures", "reschedule", "Reschedule fixtures"],
    ["matches.view", "matches", "Matches & Match Officials", "view", "View matches and match officials"],
    ["matches.edit", "matches", "Matches & Match Officials", "edit", "Edit match details and officials"],
    ["results.view", "results", "Results", "view", "View match results"],
    ["results.edit", "results", "Results", "edit", "Enter or edit draft results"],
    ["results.publish", "results", "Results", "publish", "Publish match results"],
    ["results.correct", "results", "Results", "correct", "Correct a previously published result"],
    ["standings.view", "standings", "Standings", "view", "View standings"],
    ["rules.view", "rules", "Competition Rules", "view", "View competition rules"],
    ["rules.create", "rules", "Competition Rules", "create", "Create competition rules"],
    ["rules.edit", "rules", "Competition Rules", "edit", "Edit competition rules"],
    ["rules.delete", "rules", "Competition Rules", "delete", "Archive competition rules"],
    ["payments.view", "payments", "Payments", "view", "View payments and financial records"],
    ["payments.create", "payments", "Payments", "create", "Record payments"],
    ["payments.review", "payments", "Payments", "review", "Review or reject payments"],
    ["media.view", "media", "Media Gallery", "view", "View media gallery items"],
    ["media.create", "media", "Media Gallery", "create", "Add media"],
    ["media.edit", "media", "Media Gallery", "edit", "Edit media"],
    ["media.delete", "media", "Media Gallery", "delete", "Delete media"],
    ["reports.view", "reports", "Reports & Analytics", "view", "View reports and analytics"],
    ["reports.export", "reports", "Reports & Analytics", "export", "Export reports"],
    ["notifications.view", "notifications", "Notifications", "view", "View notifications"],
    ["users.view", "users", "Admin Users", "view", "View user directory"],
    ["users.manage", "users", "Admin Users", "manage", "Manage accounts and roles"],
    ["audit.view", "audit-logs", "Audit Logs", "view", "View security audit logs"],
    ["settings.view", "settings", "System Settings", "view", "View system settings"],
    ["settings.edit", "settings", "System Settings", "edit", "Change system settings"]
].map(function (permission) {
    return {
        key: permission[0],
        menuKey: permission[1],
        menuLabel: permission[2],
        action: permission[3],
        label: permission[4]
    };
}));

const PLATFORM_OWNER_ONLY_PERMISSIONS = new Set([
    "teams.create", "teams.archive",
    "categories.create", "categories.edit", "categories.archive",
    "tournaments.create", "tournaments.archive",
    "media.view", "media.create", "media.edit", "media.delete",
    "users.view", "users.manage", "audit.view", "settings.view", "settings.edit"
]);

const TOURNAMENT_STAGE_TYPES = new Set([
    "league", "group", "preliminary", "round-of-16", "quarter-finals",
    "semi-finals", "third-place-playoff", "final"
]);
const TOURNAMENT_PARTICIPANT_SOURCES = new Set([
    "approved_teams", "group_positions", "overall_standings",
    "match_winners", "match_losers", "manual"
]);

export function isRequiredProgressionStage(stageType) {
    return stageType !== "third-place-playoff";
}

export function validateTournamentFormat(stages) {
    if (!Array.isArray(stages) || stages.length < 1 || stages.length > 16) {
        throw new TypeError("A tournament format must contain between 1 and 16 stages.");
    }
    const includedStages = stages.filter(function (stage) {
        return stage && stage.included !== false;
    });
    if (!includedStages.length ||
        !includedStages.some(function (stage) { return stage.type === "final"; })) {
        throw new TypeError("Include a final stage so the competition can determine a champion.");
    }
    return stages.map(function (stage, position) {
        if (!stage || typeof stage !== "object" || Array.isArray(stage) ||
            !TOURNAMENT_STAGE_TYPES.has(stage.type) ||
            !TOURNAMENT_PARTICIPANT_SOURCES.has(stage.participantSource)) {
            throw new TypeError("Each stage must have a supported type and participant source.");
        }
        if (typeof stage.name !== "string" || !stage.name.trim() || stage.name.trim().length > 80) {
            throw new TypeError("Each stage needs a name of 1 to 80 characters.");
        }
        if (stage.included !== undefined && typeof stage.included !== "boolean") {
            throw new TypeError("Stage inclusion must be a boolean.");
        }
        const qualification = stage.qualification === undefined ? {} : stage.qualification;
        const pairing = stage.pairing === undefined ? {} : stage.pairing;
        const settings = stage.settings === undefined ? {} : stage.settings;
        [qualification, pairing, settings].forEach(function (value) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new TypeError("Stage settings must be objects.");
            }
            if (JSON.stringify(value).length > 8192) {
                throw new TypeError("Stage settings are too large.");
            }
        });
        if (qualification.qualifiersPerGroup !== undefined &&
            (!Number.isInteger(qualification.qualifiersPerGroup) ||
                qualification.qualifiersPerGroup < 1 || qualification.qualifiersPerGroup > 64)) {
            throw new TypeError("Qualifiers per group must be between 1 and 64.");
        }
        if (qualification.count !== undefined &&
            (!Number.isInteger(qualification.count) || qualification.count < 1 || qualification.count > 256)) {
            throw new TypeError("The qualifier count must be between 1 and 256.");
        }
        if (stage.participantSource === "group_positions") {
            if (!Number.isInteger(qualification.qualifiersPerGroup) ||
                qualification.qualifiersPerGroup < 1 || qualification.qualifiersPerGroup > 64) {
                throw new TypeError("Group-position qualification needs a valid qualifier count.");
            }
            if (qualification.positions !== undefined &&
                (!Array.isArray(qualification.positions) ||
                    qualification.positions.length !== qualification.qualifiersPerGroup ||
                    new Set(qualification.positions).size !== qualification.positions.length ||
                    qualification.positions.some(function (position) {
                        return !Number.isInteger(position) || position < 1 || position > 64;
                    }))) {
                throw new TypeError("Group finishing positions must be unique positive positions matching the qualifier count.");
            }
        }
        if (stage.participantSource === "overall_standings" &&
            (!Number.isInteger(qualification.count) || qualification.count < 1 || qualification.count > 256)) {
            throw new TypeError("Overall qualification needs a valid qualifier count.");
        }
        if ((stage.participantSource === "match_winners" ||
            stage.participantSource === "match_losers") &&
            (qualification.matchIds !== undefined &&
                (!Array.isArray(qualification.matchIds) || qualification.matchIds.length > 128 ||
                qualification.matchIds.some(function (id) {
                    return typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id);
                }) || new Set(qualification.matchIds).size !== qualification.matchIds.length))) {
            throw new TypeError("Match-outcome source match IDs must be unique and valid.");
        }
        return {
            id: typeof stage.id === "string" ? stage.id : "",
            name: stage.name.trim(),
            type: stage.type,
            position: position,
            included: stage.included !== false,
            participantSource: stage.participantSource,
            qualification: qualification,
            pairing: pairing,
            settings: settings
        };
    });
}

export function adminPermissionForRequest(path, method) {
    if (path === API_PREFIX + "/admin/bootstrap" && method === "GET") return "__any__";
    if (path === API_PREFIX + "/admin/permissions" && method === "GET") return null;
    if (/^\/api\/v1\/admin\/users\/[A-Za-z0-9_-]+\/permissions$/.test(path)) return null;
    if (/^\/api\/v1\/admin\/rules\/[A-Za-z0-9_-]+\/acknowledgments$/.test(path) &&
        method === "GET") return "rules.view";
    if (/^\/api\/v1\/admin\/rules\/[A-Za-z0-9_-]+\/reminders$/.test(path) &&
        method === "POST") return "rules.edit";
    if (path === API_PREFIX + "/admin/teams" && method === "POST") return "teams.create";
    if (/^\/api\/v1\/admin\/teams\/[A-Za-z0-9_-]+\/archive$/.test(path) && method === "PATCH") {
        return "teams.archive";
    }
    if (path === API_PREFIX + "/admin/media/items" && method === "GET") return "media.view";
    if (path === API_PREFIX + "/admin/media/items" && method === "POST") return "media.create";
    if (path === API_PREFIX + "/admin/media/uploads" && method === "POST") return "media.create";
    if (path === API_PREFIX + "/admin/tournaments/banner-uploads" && method === "POST") {
        return "tournaments.create";
    }
    let tournamentBannerUploadMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/banner-uploads(?:\/([A-Za-z0-9-]+\.(?:png|jpg|webp)))?$/
    );
    if (tournamentBannerUploadMatch && method === "POST" && !tournamentBannerUploadMatch[2]) {
        return "tournaments.edit";
    }
    if (tournamentBannerUploadMatch && method === "DELETE" && tournamentBannerUploadMatch[2]) {
        return "tournaments.edit";
    }
    if (path === API_PREFIX + "/admin/media" && method === "POST") return "media.create";
    if (path === API_PREFIX + "/admin/settings/email-sender") {
        return method === "GET" ? "settings.view" : method === "PUT" ? "settings.edit" : null;
    }
    let match = path.match(/^\/api\/v1\/admin\/media\/items\/[A-Za-z0-9_-]+$/);
    if (match) return method === "PUT" ? "media.edit" : method === "DELETE" ? "media.delete" : null;
    match = path.match(/^\/api\/v1\/admin\/media\/uploads\/[A-Za-z0-9-]+\.(?:png|jpg|webp)$/);
    if (match && method === "DELETE") return "media.delete";
    match = path.match(/^\/api\/v1\/admin\/players\/[A-Za-z0-9_-]+\/public-profile$/);
    if (match && method === "PATCH") return "players.edit";
    match = path.match(/^\/api\/v1\/admin\/(categories|tournaments|fixtures|rules)(?:\/[A-Za-z0-9_-]+)?$/);
    if (match) {
        const action = method === "POST" ? "create" :
            method === "PUT" ? "edit" : method === "DELETE" ? "delete" : null;
        const resource = match[1];
        if (!action) return null;
        return resource + "." + (resource === "categories" || resource === "tournaments"
            ? action === "delete" ? "archive" : action
            : resource === "rules" && action === "delete" ? "delete" : action);
    }
    match = path.match(/^\/api\/v1\/admin\/team-registrations\/[A-Za-z0-9_-]+\/review$/);
    if (match && method === "POST") return "__registration_review__";
    match = path.match(/^\/api\/v1\/admin\/matches\/[A-Za-z0-9_-]+\/lineups$/);
    if (match && method === "GET") return "fixtures.view";
    match = path.match(/^\/api\/v1\/admin\/matches\/[A-Za-z0-9_-]+\/result$/);
    if (match && method === "PUT") return "__result_update__";
    match = path.match(/^\/api\/v1\/admin\/matches\/[A-Za-z0-9_-]+\/status$/);
    if (match && method === "PUT") return "fixtures.edit";
    match = path.match(/^\/api\/v1\/admin\/payments\/[A-Za-z0-9_-]+\/review$/);
    if (match && method === "POST") return "payments.review";
    match = path.match(/^\/api\/v1\/admin\/payments\/[A-Za-z0-9_-]+\/receipt$/);
    if (match && method === "GET") return "payments.view";
    if (path === API_PREFIX + "/admin/payments" && method === "POST") return "payments.create";
    match = path.match(/^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/groups$/);
    if (match && method === "PUT") return "tournaments.edit";
    match = path.match(/^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/format$/);
    if (match && method === "PUT") return "tournaments.edit";
    match = path.match(/^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/reset$/);
    if (match && method === "POST") return "tournaments.edit";
    match = path.match(/^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/stages\/[A-Za-z0-9_-]+\/approve$/);
    if (match && method === "POST") return "tournaments.edit";
    match = path.match(/^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/stages\/[A-Za-z0-9_-]+\/complete$/);
    if (match && method === "POST") return "tournaments.edit";
    match = path.match(/^\/api\/v1\/admin\/team-registrations\/[A-Za-z0-9_-]+\/permissions$/);
    if (match && method === "PUT") return "registrations.edit";
    if (method === "POST" &&
        /^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/stages\/[A-Za-z0-9_-]+\/reset$/.test(path)) {
        return "tournaments.edit";
    }
    return null;
}

export function hasEffectiveAdminPermission(role, states, permissionKey) {
    if (role === "platform_owner") return true;
    return role === "tournament_admin" && Boolean(states) &&
        states[permissionKey] === "allow";
}

async function userPermissionStates(db, userUid) {
    const rows = await db.prepare(
        "SELECT permission_key, effect FROM afc_user_permissions WHERE user_uid = ?"
    ).bind(userUid).all();
    const knownKeys = new Set(ADMIN_PERMISSION_CATALOG.map(function (permission) {
        return permission.key;
    }));
    const states = Object.create(null);
    (rows.results || []).forEach(function (row) {
        if (knownKeys.has(row.permission_key)) states[row.permission_key] = row.effect;
    });
    return states;
}

async function requireUserPermission(actor, permissionKey) {
    if (actor.user.role === "platform_owner") return;
    if (actor.user.role !== "tournament_admin" || !permissionKey ||
        !ADMIN_PERMISSION_CATALOG.some(function (permission) {
            return permission.key === permissionKey;
        })) {
        fail(403, "FORBIDDEN", "You are not permitted to perform this action.");
    }
    const assignment = await actor.db.prepare(
        "SELECT effect FROM afc_user_permissions WHERE user_uid = ? AND permission_key = ?"
    ).bind(actor.user.firebase_uid, permissionKey).first();
    if (!hasEffectiveAdminPermission(
        actor.user.role,
        assignment ? { [permissionKey]: assignment.effect } : null,
        permissionKey
    )) {
        fail(403, "FORBIDDEN", "You are not permitted to perform this action.");
    }
}

async function requireRole(request, env, allowedRoles) {
    const auth = await authenticate(request, env);
    const user = await loadAccount(auth);
    if (!user || user.status !== "active" || !user.role) {
        fail(403, "ACCOUNT_NOT_ASSIGNED", "Your account does not yet have platform access.");
    }
    if (allowedRoles.indexOf(user.role) === -1) {
        fail(403, "FORBIDDEN", "You are not permitted to perform this action.");
    }
    const actor = { claims: auth.claims, user: user, db: auth.db, env: env };
    if (user.role === "tournament_admin" && new URL(request.url).pathname.indexOf(API_PREFIX + "/admin/") === 0) {
        const path = new URL(request.url).pathname.replace(/\/+$/, "");
        const permission = adminPermissionForRequest(path, request.method.toUpperCase());
        if (permission === "__any__") {
            const row = await auth.db.prepare(
                "SELECT 1 AS present FROM afc_user_permissions WHERE user_uid = ? AND effect = 'allow' LIMIT 1"
            ).bind(user.firebase_uid).first();
            if (!row) fail(403, "FORBIDDEN", "No administration permissions have been granted to this account.");
        } else if (permission && permission.indexOf("__") !== 0) {
            await requireUserPermission(actor, permission);
        } else if (permission && permission.indexOf("__") === 0) {
            // The handler checks the precise action after validating its request body and resource.
        } else if (path !== API_PREFIX + "/admin/permissions") {
            fail(403, "FORBIDDEN", "This administration operation has no assigned permission.");
        }
    }
    return actor;
}

function serializePermissionCatalog(states) {
    return ADMIN_PERMISSION_CATALOG.map(function (permission) {
        return {
            id: permission.key,
            key: permission.key,
            menuKey: permission.menuKey,
            menuLabel: permission.menuLabel,
            action: permission.action,
            label: permission.label,
            description: permission.label,
            active: true,
            state: states[permission.key] || "unset",
            editable: !PLATFORM_OWNER_ONLY_PERMISSIONS.has(permission.key)
        };
    });
}

async function currentAdminPermissions(actor) {
    const states = actor.user.role === "platform_owner"
        ? Object.fromEntries(ADMIN_PERMISSION_CATALOG.map(function (permission) {
            return [permission.key, "allow"];
        }))
        : await userPermissionStates(actor.db, actor.user.firebase_uid);
    return success({
        role: actor.user.role,
        permissions: serializePermissionCatalog(states)
    });
}

async function manageUserPermissions(request, actor, targetUid) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a Platform Owner can manage administrator permissions.");
    }
    const target = await actor.db.prepare(
        "SELECT firebase_uid, full_name, email, role, status FROM afc_users WHERE firebase_uid = ?"
    ).bind(targetUid).first();
    if (!target || target.role !== "tournament_admin") {
        fail(404, "NOT_FOUND", "The Tournament Admin account was not found.");
    }

    if (request.method.toUpperCase() === "GET") {
        const states = await userPermissionStates(actor.db, targetUid);
        return success({
            user: {
                uid: target.firebase_uid,
                name: target.full_name,
                email: target.email,
                role: target.role,
                status: target.status
            },
            permissions: serializePermissionCatalog(states)
        });
    }

    const body = await readJson(request);
    if (!Array.isArray(body.permissions) || body.permissions.length > ADMIN_PERMISSION_CATALOG.length) {
        fail(400, "INVALID_PERMISSIONS", "Submit a valid list of permission states.");
    }
    const validKeys = new Set(ADMIN_PERMISSION_CATALOG.map(function (permission) {
        return permission.key;
    }));
    const requested = Object.create(null);
    body.permissions.forEach(function (item) {
        if (!item || typeof item !== "object" || typeof item.key !== "string" ||
            ["allow", "deny", "unset"].indexOf(item.state) === -1 ||
            !validKeys.has(item.key) || Object.prototype.hasOwnProperty.call(requested, item.key)) {
            fail(400, "INVALID_PERMISSIONS", "A permission key or state is invalid.");
        }
        if (item.state !== "unset" && PLATFORM_OWNER_ONLY_PERMISSIONS.has(item.key)) {
            fail(400, "OWNER_ONLY_PERMISSION", "Platform Owner privileges cannot be delegated to a Tournament Admin.");
        }
        requested[item.key] = item.state;
    });

    const previous = await userPermissionStates(actor.db, targetUid);
    const statements = [];
    Object.keys(requested).forEach(function (key) {
        const oldState = previous[key] || "unset";
        const newState = requested[key];
        if (oldState === newState) return;
        if (newState === "unset") {
            statements.push(actor.db.prepare(
                "DELETE FROM afc_user_permissions WHERE user_uid = ? AND permission_key = ?"
            ).bind(targetUid, key));
        } else {
            statements.push(actor.db.prepare(
                "INSERT INTO afc_user_permissions(user_uid, permission_key, effect, updated_by) " +
                "VALUES(?, ?, ?, ?) ON CONFLICT(user_uid, permission_key) DO UPDATE SET " +
                "effect = excluded.effect, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP"
            ).bind(targetUid, key, newState, actor.user.firebase_uid));
        }
        statements.push(actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
            "VALUES(?, ?, ?, ?, ?, ?)"
        ).bind(
            newId("AUD-"), actor.user.firebase_uid, "change_admin_permission",
            "user_permission", targetUid + ":" + key,
            JSON.stringify({ permissionKey: key, previousState: oldState, newState: newState })
        ));
    });
    if (statements.length) await actor.db.batch(statements);
    const states = await userPermissionStates(actor.db, targetUid);
    return success({
        user: {
            uid: target.firebase_uid,
            name: target.full_name,
            email: target.email,
            role: target.role,
            status: target.status
        },
        permissions: serializePermissionCatalog(states)
    });
}

function paginate(url, defaultLimit) {
    const requested = Number(url.searchParams.get("limit") || defaultLimit || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isInteger(requested) || requested < 1 || requested > 100 ||
        !Number.isInteger(offset) || offset < 0 || offset > 100000) {
        fail(400, "INVALID_PAGINATION", "Pagination values are invalid.");
    }
    return { limit: requested, offset: offset };
}

function isPublicReadPath(path) {
    return path === "/health" ||
        path === API_PREFIX + "/public/bootstrap" ||
        path === API_PREFIX + "/public/tournaments" ||
        path === API_PREFIX + "/public/standings" ||
        path === API_PREFIX + "/public/live-matches" ||
        /^\/api\/v1\/public\/tournaments\/[A-Za-z0-9_-]+$/.test(path);
}

function isPublicReadRateLimited(request, path) {
    if (request.method.toUpperCase() !== "GET" || !isPublicReadPath(path)) return false;

    const now = Date.now();
    if (now >= publicReadRateLimitCleanupAt) {
        for (const [ip, entry] of publicReadRateLimits) {
            if (now - entry.windowStartedAt >= PUBLIC_READ_RATE_WINDOW_MS) {
                publicReadRateLimits.delete(ip);
            }
        }
        publicReadRateLimitCleanupAt = now + PUBLIC_READ_RATE_WINDOW_MS;
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    let entry = publicReadRateLimits.get(ip);
    if (!entry || now - entry.windowStartedAt >= PUBLIC_READ_RATE_WINDOW_MS) {
        entry = { windowStartedAt: now, requestCount: 0 };
    }
    if (entry.requestCount >= PUBLIC_READ_RATE_LIMIT) return true;

    entry.requestCount += 1;
    publicReadRateLimits.delete(ip);
    publicReadRateLimits.set(ip, entry);
    while (publicReadRateLimits.size > PUBLIC_READ_RATE_LIMIT_MAX_ENTRIES) {
        publicReadRateLimits.delete(publicReadRateLimits.keys().next().value);
    }
    return false;
}

async function consumeRateLimit(db, key, maximum, windowSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const start = Math.floor(now / windowSeconds) * windowSeconds;
    const result = await db.prepare(
        "INSERT INTO afc_rate_limits(rate_key, window_start, request_count) VALUES(?, ?, 1) " +
        "ON CONFLICT(rate_key, window_start) DO UPDATE SET request_count = request_count + 1 " +
        "RETURNING request_count"
    ).bind(key, start).first();
    if (!result || result.request_count > maximum) {
        fail(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
    }
}

async function rateLimitRequest(request, db, userUid, action, maximum, windowSeconds) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    await consumeRateLimit(db, "ip:" + ip + ":" + action, maximum, windowSeconds);
    if (userUid) await consumeRateLimit(db, "uid:" + userUid + ":" + action, maximum, windowSeconds);
}

function mapCategory(row) {
    return {
        id: row.id, publicId: row.public_id, name: row.name, code: row.code,
        ageGroup: row.age_group, ageMin: row.age_min, ageMax: row.age_max,
        gender: row.gender, guardianConsent: row.guardian_consent_required === 1,
        status: row.status, description: row.description
    };
}

function mapTournament(row) {
    const registrationOpen = row.status !== "draft" && row.status !== "archived" &&
        isRegistrationWindowOpen(row.registration_opens, row.registration_closes);
    const banner = typeof row.banner === "string" && row.banner.indexOf("images/") === 0
        ? "/" + row.banner : row.banner;
    return {
        id: row.id, publicId: row.public_id, slug: row.slug, name: row.name,
        season: String(row.season), categoryId: row.category_id, format: row.format,
        status: registrationOpen ? "registration-open" : row.status,
        startDate: row.start_date, endDate: row.end_date,
        registrationOpens: row.registration_opens, registrationCloses: row.registration_closes,
        venue: row.venue, location: row.location, teamCap: row.team_limit,
        registrationFee: row.registration_fee, teamsRegistered: row.teams_registered || 0,
        prizeInformation: row.prize_information || "",
        banner: banner, featured: row.featured === 1,
        standingsAvailable: row.standings_available === 1, overview: row.overview
    };
}

export function mapPaymentSettings(rows) {
    const settings = Object.create(null);
    (rows || []).forEach(function (row) {
        settings[row.setting_key] = row.setting_value;
    });
    return {
        method: settings.payment_method || DEFAULT_PAYMENT_SETTINGS.method,
        number: settings.payment_phone || DEFAULT_PAYMENT_SETTINGS.number,
        accountName: settings.payment_name || DEFAULT_PAYMENT_SETTINGS.accountName
    };
}

async function publicBootstrap(db, url) {
    const page = paginate(url, 100);
    const requestedCollections = url.searchParams.get("only");
    const collectionNames = [
        "categories", "tournaments", "teams", "players", "matches",
        "news", "faqs", "rules", "media", "tournamentStages"
    ];
    const selectedCollections = requestedCollections === null
        ? null
        : requestedCollections.split(",");
    if (selectedCollections && (
        selectedCollections.length === 0 ||
        selectedCollections.some(function (name, index) {
            return collectionNames.indexOf(name) === -1 ||
                selectedCollections.indexOf(name) !== index;
        })
    )) {
        fail(400, "INVALID_COLLECTION", "The requested public collections are invalid.");
    }
    const collectionQuery = function (name, query) {
        return !selectedCollections || selectedCollections.indexOf(name) !== -1
            ? query()
            : Promise.resolve({ results: [] });
    };
    const results = await Promise.all([
        collectionQuery("categories", function () { return db.prepare(
            "SELECT id, public_id, name, code, age_group, age_min, age_max, gender, " +
            "guardian_consent_required, status, description FROM afc_categories " +
            "WHERE status = 'active' ORDER BY name LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("tournaments", function () { return db.prepare(
            "SELECT t.id, t.public_id, t.slug, t.name, t.season, t.category_id, t.format, " +
            "t.status, t.venue, t.location, t.start_date, t.end_date, t.registration_opens, " +
            "t.registration_closes, t.team_limit, t.registration_fee, t.banner, t.featured, " +
            "t.standings_available, t.overview, t.prize_information, " +
            "(SELECT COUNT(*) FROM afc_team_registrations r " +
            "WHERE r.tournament_id = t.id AND r.status = 'approved') AS teams_registered " +
            "FROM afc_tournaments t WHERE t.status IN ('upcoming', 'active', 'completed') " +
            "ORDER BY t.start_date DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("teams", function () { return db.prepare(
            "SELECT tm.id, tm.name, tm.short_code, tm.category_id, tm.location, tm.accent, " +
            "r.tournament_id, r.id AS registration_id, r.manager_public, g.name AS group_name, " +
            "u.full_name AS manager_name, u.role AS manager_role " +
            "FROM afc_teams tm JOIN afc_team_registrations r ON r.team_id = tm.id " +
            "LEFT JOIN afc_group_teams gt ON gt.registration_id = r.id " +
            "LEFT JOIN afc_tournament_groups g ON g.id = gt.group_id " +
            "LEFT JOIN afc_users u ON u.firebase_uid = r.manager_uid " +
            "WHERE r.status = 'approved' ORDER BY tm.name LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("players", function () { return db.prepare(
            "SELECT p.id, p.name, p.nickname, p.team_id, p.position, p.shirt_number, " +
            "p.classification, p.guardian_consent_status, p.public_profile, c.guardian_consent_required " +
            "FROM afc_players p JOIN afc_teams tm ON tm.id = p.team_id " +
            "JOIN afc_categories c ON c.id = tm.category_id " +
            "WHERE p.status = 'registered' AND p.public_profile <> 'hidden' " +
            "AND EXISTS (SELECT 1 FROM afc_team_registrations r " +
            "WHERE r.team_id = tm.id AND r.status = 'approved') " +
            "AND (c.guardian_consent_required = 0 OR p.guardian_consent_status = 'on_file') " +
            "ORDER BY p.name LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("matches", function () { return db.prepare(
            "SELECT m.id, m.tournament_id, m.category_id, m.group_id, m.stage, m.round, " +
            "m.home_team_id, m.away_team_id, m.kickoff, m.venue, m.status, m.published, " +
            "m.home_score, m.away_score, m.live_minute, m.live_clock_mode, " +
            "m.live_clock_started_at, m.live_clock_elapsed_seconds, m.live_extra_minutes, " +
            "m.note, m.tie_break_method, " +
            "m.home_extra_time_score, m.away_extra_time_score, " +
            "m.home_penalties_score, m.away_penalties_score, g.name AS group_name " +
            "FROM afc_matches m " +
            "LEFT JOIN afc_tournament_groups g ON g.id = m.group_id " +
            "WHERE m.published = 1 AND m.status <> 'draft' " +
            "ORDER BY m.kickoff DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("news", function () { return db.prepare(
            "SELECT id, slug, title, category, author, image_key, excerpt, body, featured, published_at " +
            "FROM afc_news_articles WHERE status = 'published' ORDER BY featured DESC, published_at DESC " +
            "LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("faqs", function () { return db.prepare(
            "SELECT id, category, question, answer FROM afc_faqs WHERE published = 1 " +
            "ORDER BY position, id LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        selectedCollections && (page.offset > 0 || url.searchParams.get("includePayment") !== "1")
            ? Promise.resolve({ results: [] })
            : db.prepare(
            "SELECT setting_key, setting_value FROM afc_app_settings " +
            "WHERE setting_key IN ('payment_method', 'payment_phone', 'payment_name')"
        ).all(),
        collectionQuery("rules", function () { return db.prepare(
            "SELECT id, category_id, title, body, updated_at FROM afc_rules " +
            "WHERE status = 'published' ORDER BY category_id, title LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("media", function () { return db.prepare(
            "SELECT id, media_type, title, category, status, file_path, video_url, added_on, caption " +
            "FROM afc_media_items WHERE status = 'published' " +
            "ORDER BY added_on DESC, created_at DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("tournamentStages", function () { return db.prepare(
            "SELECT s.id, s.tournament_id, s.name, s.stage_type, s.position, s.status, " +
            "p.team_id, p.seed, tm.name AS team_name, tm.short_code " +
            "FROM afc_tournament_stages s " +
            "LEFT JOIN afc_stage_participants p ON p.stage_id = s.id " +
            "LEFT JOIN afc_teams tm ON tm.id = p.team_id " +
            "WHERE s.status IN ('published', 'in_progress', 'completed') " +
            "ORDER BY s.tournament_id, s.position, p.seed LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all(); }),
        collectionQuery("matches", function () { return db.prepare(
            "SELECT e.match_id, e.team_id, e.player_id, e.event_type, MIN(e.minute) AS minute, " +
            "COUNT(*) AS goal_count, p.name AS player_name, p.public_profile, " +
            "CASE WHEN p.id IS NOT NULL AND p.status = 'registered' " +
            "AND p.public_profile <> 'hidden' " +
            "AND (c.guardian_consent_required = 0 OR p.guardian_consent_status = 'on_file') " +
            "AND (c.age_max IS NULL OR c.age_max >= 13) " +
            "AND LOWER(c.name) NOT LIKE '%children%' AND LOWER(c.name) NOT LIKE '%under 13%' " +
            "AND p.team_id = e.team_id AND EXISTS (" +
                "SELECT 1 FROM afc_team_registrations pr " +
                "WHERE pr.team_id = p.team_id AND pr.tournament_id = m.tournament_id " +
                "AND pr.status = 'approved') THEN 1 ELSE 0 END AS scorer_public " +
            "FROM afc_match_events e JOIN afc_matches m ON m.id = e.match_id " +
            "JOIN afc_categories c ON c.id = m.category_id " +
            "LEFT JOIN afc_players p ON p.id = e.player_id " +
            "WHERE e.event_type IN ('goal', 'own_goal') AND m.published = 1 " +
            "AND m.status IN ('live', 'completed') AND m.id IN (" +
                "SELECT id FROM afc_matches WHERE published = 1 AND status <> 'draft' " +
                "ORDER BY kickoff DESC LIMIT ? OFFSET ?) " +
            "GROUP BY e.match_id, e.team_id, e.player_id, e.event_type, p.id, p.name, p.public_profile, " +
            "p.status, p.guardian_consent_status, p.team_id, c.guardian_consent_required " +
            "ORDER BY m.kickoff DESC, MIN(e.minute), e.team_id, e.player_id"
        ).bind(page.limit, page.offset).all(); })
    ]);

    const categories = (results[0].results || []).map(mapCategory);
    const tournaments = (results[1].results || []).map(mapTournament);
    const teamMap = new Map();
    (results[2].results || []).forEach(function (row) {
        let team = teamMap.get(row.id);
        if (!team) {
            team = {
                id: row.id, name: row.name, shortName: row.short_code,
                categoryId: row.category_id, tournamentIds: [], group: row.group_name,
                groupByTournament: Object.create(null),
                status: "approved", registeredOn: "", location: row.location,
                accent: row.accent, manager: row.manager_public === 1
                    ? { name: row.manager_name, role: row.manager_role || "Team Manager", public: true }
                    : null
            };
            teamMap.set(row.id, team);
        }
        if (row.group_name) team.groupByTournament[row.tournament_id] = row.group_name;
        if (team.tournamentIds.indexOf(row.tournament_id) === -1) {
            team.tournamentIds.push(row.tournament_id);
        }
    });
    const players = (results[3].results || []).map(function (row) {
        return {
            id: row.id,
            name: row.public_profile === "limited" ? initials(row.name) : row.name,
            nickname: row.public_profile === "full" ? row.nickname : null,
            teamId: row.team_id, position: row.position, shirtNumber: row.shirt_number,
            classification: row.classification, minor: row.guardian_consent_required === 1,
            guardianConsent: row.guardian_consent_status, publicProfile: row.public_profile,
            status: "registered"
        };
    });
    const matches = (results[4].results || []).map(mapMatch);
    const matchesById = new Map(matches.map(function (match) { return [match.id, match]; }));
    (results[11].results || []).forEach(function (row) {
        const match = matchesById.get(row.match_id);
        if (!match) return;
        const scorerPublic = Number(row.scorer_public) === 1;
        match.events.push({
            teamId: row.team_id,
            playerId: scorerPublic ? row.player_id : null,
            playerName: scorerPublic
                ? (row.public_profile === "limited" ? initials(row.player_name) : row.player_name)
                : "",
            type: row.event_type,
            minute: row.minute,
            goals: Number(row.goal_count)
        });
    });
    const payment = mapPaymentSettings(results[7].results);

    return {
        meta: {
            demo: false, label: "Live competition data", currency: "KES",
            season: String(new Date().getFullYear()),
            payment: Object.assign({ whatsapp: ADMIN_WHATSAPP_NUMBER }, payment)
        },
        categories: categories,
        tournaments: tournaments,
        teams: Array.from(teamMap.values()),
        players: players,
        matches: matches,
        news: (results[5].results || []).map(function (row) {
            return {
                id: row.id, slug: row.slug, title: row.title, category: row.category,
                author: row.author, date: row.published_at, image: row.image_key,
                featured: row.featured === 1, excerpt: row.excerpt, body: row.body
            };
        }),
        faqs: (results[6].results || []).map(function (row) {
            return { id: row.id, group: row.category, question: row.question, answer: row.answer };
        }),
        rules: (results[8].results || []).map(function (row) {
            return {
                id: row.id, categoryId: row.category_id, title: row.title, body: row.body,
                state: "published", updated: row.updated_at
            };
        }),
        media: (results[9].results || []).map(mapMediaItem),
        tournamentStages: (results[10].results || []).map(function (row) {
            return {
                id: row.id, tournamentId: row.tournament_id, name: row.name,
                type: row.stage_type, position: row.position, status: row.status,
                participant: row.team_id ? {
                    teamId: row.team_id, teamName: row.team_name,
                    shortCode: row.short_code, seed: row.seed
                } : null
            };
        }),
        activity: [],
        notifications: [],
        payments: [],
        users: []
    };
}

function liveClockSnapshot(match, now) {
    const mode = match.live_clock_mode || (match.status === "live" ? "manual" : "automatic");
    const extraMinutes = Math.max(0, Number(match.live_extra_minutes || 0));
    let elapsedSeconds = Math.max(0, Number(match.live_clock_elapsed_seconds || 0));
    if (mode === "automatic" && match.live_clock_started_at) {
        const startedAt = new Date(match.live_clock_started_at).getTime();
        if (Number.isFinite(startedAt)) {
            elapsedSeconds += Math.max(0, Math.floor((now.getTime() - startedAt) / 1000));
        }
    }
    const fullTimeSeconds = (60 + 45 + extraMinutes) * 60;
    const finished = mode === "finished" ||
        (mode === "automatic" && elapsedSeconds >= fullTimeSeconds);
    if (finished || match.status === "completed") {
        return {
            mode: finished ? "finished" : mode,
            elapsedSeconds: elapsedSeconds,
            period: "full_time",
            minute: 90 + extraMinutes,
            extraMinutes: extraMinutes
        };
    }
    if (mode === "manual") {
        const minute = Number(match.live_minute || 0);
        return {
            mode: mode,
            elapsedSeconds: elapsedSeconds,
            period: minute > 45 ? "second_half" : "first_half",
            minute: minute,
            extraMinutes: extraMinutes
        };
    }
    if (elapsedSeconds < 45 * 60) {
        return {
            mode: mode, elapsedSeconds: elapsedSeconds, period: "first_half",
            minute: Math.floor(elapsedSeconds / 60), extraMinutes: extraMinutes
        };
    }
    if (elapsedSeconds < 60 * 60) {
        return {
            mode: mode, elapsedSeconds: elapsedSeconds, period: "halftime",
            minute: 45, extraMinutes: extraMinutes
        };
    }
    return {
        mode: mode,
        elapsedSeconds: elapsedSeconds,
        period: "second_half",
        minute: Math.min(
            90 + extraMinutes,
            46 + Math.floor((elapsedSeconds - 60 * 60) / 60)
        ),
        extraMinutes: extraMinutes
    };
}

function elapsedSecondsAtMinute(minute) {
    return minute <= 45 ? minute * 60 : 60 * 60 + (minute - 46) * 60;
}

async function advanceAutomaticMatches(db, now) {
    const currentTime = now || new Date();
    const forced = Boolean(now);
    if (!forced && Date.now() - automaticMatchReconcileAt < AUTOMATIC_MATCH_RECONCILE_TTL_MS) {
        return;
    }
    if (!forced && automaticMatchReconcilePromise) return automaticMatchReconcilePromise;
    const reconcile = async function () {
        const nowIso = currentTime.toISOString();
        await db.prepare(
            "UPDATE afc_matches SET status = 'live', home_score = COALESCE(home_score, 0), " +
            "away_score = COALESCE(away_score, 0), live_clock_mode = 'automatic', " +
            "live_clock_started_at = kickoff, live_clock_elapsed_seconds = 0, " +
            "live_minute = 0, live_extra_minutes = 0, " +
            "updated_at = CURRENT_TIMESTAMP WHERE published = 1 AND status = 'scheduled' " +
            "AND datetime(kickoff) <= datetime(?)"
        ).bind(nowIso).run();
        const rows = await db.prepare(
            "SELECT id, status, live_clock_mode, live_clock_started_at, " +
            "live_clock_elapsed_seconds, live_extra_minutes FROM afc_matches " +
            "WHERE status = 'live' AND live_clock_mode = 'automatic'"
        ).all();
        const updates = (rows.results || []).map(function (row) {
            const clock = liveClockSnapshot(row, currentTime);
            if (clock.period !== "full_time") return null;
            return db.prepare(
                "UPDATE afc_matches SET live_clock_mode = 'finished', " +
                "live_clock_started_at = NULL, live_clock_elapsed_seconds = ?, " +
                "live_minute = ?, updated_at = CURRENT_TIMESTAMP " +
                "WHERE id = ? AND status = 'live' AND live_clock_mode = 'automatic'"
            ).bind(clock.elapsedSeconds, clock.minute, row.id);
        }).filter(Boolean);
        if (updates.length) await db.batch(updates);
    };
    if (forced) {
        await reconcile();
        automaticMatchReconcileAt = Date.now();
        return;
    }
    automaticMatchReconcilePromise = reconcile();
    try {
        await automaticMatchReconcilePromise;
        automaticMatchReconcileAt = Date.now();
    } finally {
        automaticMatchReconcilePromise = null;
    }
}

async function publicLiveMatches(db, matchIds) {
    const ids = Array.from(new Set(matchIds || []));
    if (ids.length > 100 || ids.some(function (id) {
        return !/^[A-Za-z0-9_-]{1,80}$/.test(id);
    })) {
        fail(400, "INVALID_MATCH_IDS", "The requested live match references are invalid.");
    }
    await advanceAutomaticMatches(db);
    const requestedIds = ids.length
        ? " OR m.id IN (" + ids.map(function () { return "?"; }).join(",") + ")"
        : "";
    const rows = await prepareBound(
        db,
        "SELECT m.id, m.tournament_id, m.category_id, m.group_id, m.stage, m.round, " +
        "m.home_team_id, m.away_team_id, m.kickoff, m.venue, m.status, m.published, " +
        "m.home_score, m.away_score, m.live_minute, m.live_clock_mode, " +
        "m.live_clock_started_at, m.live_clock_elapsed_seconds, m.live_extra_minutes, " +
        "m.note, m.tie_break_method, " +
        "m.home_extra_time_score, m.away_extra_time_score, m.home_penalties_score, " +
        "m.away_penalties_score, g.name AS group_name, e.team_id AS event_team_id, " +
        "e.player_id, e.event_type, MIN(e.minute) AS minute, COUNT(e.id) AS goal_count, " +
        "p.name AS player_name, p.public_profile, " +
        "CASE WHEN p.id IS NOT NULL AND p.status = 'registered' " +
        "AND p.public_profile <> 'hidden' " +
        "AND (c.guardian_consent_required = 0 OR p.guardian_consent_status = 'on_file') " +
        "AND (c.age_max IS NULL OR c.age_max >= 13) " +
        "AND LOWER(c.name) NOT LIKE '%children%' AND LOWER(c.name) NOT LIKE '%under 13%' " +
        "AND p.team_id = e.team_id AND EXISTS (" +
            "SELECT 1 FROM afc_team_registrations pr WHERE pr.team_id = p.team_id " +
            "AND pr.tournament_id = m.tournament_id AND pr.status = 'approved') " +
        "THEN 1 ELSE 0 END AS scorer_public " +
        "FROM afc_matches m LEFT JOIN afc_tournament_groups g ON g.id = m.group_id " +
        "JOIN afc_categories c ON c.id = m.category_id " +
        "LEFT JOIN afc_match_events e ON e.match_id = m.id AND e.event_type IN ('goal', 'own_goal') " +
        "LEFT JOIN afc_players p ON p.id = e.player_id " +
        "WHERE m.published = 1 AND (m.status = 'live'" + requestedIds + ") " +
        "GROUP BY m.id, m.tournament_id, m.category_id, m.group_id, m.stage, m.round, " +
        "m.home_team_id, m.away_team_id, m.kickoff, m.venue, m.status, m.published, " +
        "m.home_score, m.away_score, m.live_minute, m.live_clock_mode, " +
        "m.live_clock_started_at, m.live_clock_elapsed_seconds, m.live_extra_minutes, " +
        "m.note, m.tie_break_method, " +
        "m.home_extra_time_score, m.away_extra_time_score, m.home_penalties_score, " +
        "m.away_penalties_score, g.name, e.team_id, e.player_id, e.event_type, p.id, " +
        "p.name, p.public_profile, p.status, p.guardian_consent_status, p.team_id, " +
        "c.guardian_consent_required, c.name " +
        "ORDER BY m.kickoff DESC, MIN(e.minute), e.event_type",
        ids
    ).all();
    const matches = new Map();
    (rows.results || []).forEach(function (row) {
        let match = matches.get(row.id);
        if (!match) {
            match = mapMatch(row);
            matches.set(row.id, match);
        }
        if (!row.event_team_id) return;
        const scorerPublic = Number(row.scorer_public) === 1;
        match.events.push({
            teamId: row.event_team_id,
            playerId: scorerPublic ? row.player_id : null,
            playerName: scorerPublic
                ? (row.public_profile === "limited" ? initials(row.player_name) : row.player_name)
                : "",
            type: row.event_type,
            minute: row.minute,
            goals: Number(row.goal_count)
        });
    });
    return Array.from(matches.values());
}

function initials(name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2)
        .map(function (part) { return part.charAt(0).toUpperCase(); }).join(".");
}

function mapMatch(row) {
    const hasLiveClock = row.live_clock_mode !== undefined;
    const clock = hasLiveClock ? liveClockSnapshot(row, new Date()) : null;
    return {
        id: row.id, tournamentId: row.tournament_id, categoryId: row.category_id,
        stage: row.stage, group: row.group_name || null, round: row.round,
        homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
        kickoff: row.kickoff, venue: row.venue, status: row.status,
        published: Number(row.published) === 1,
        homeScore: row.home_score, awayScore: row.away_score,
        liveMinute: clock ? clock.minute : Number(row.live_minute || 0),
        livePeriod: clock ? clock.period : "",
        liveClockMode: clock ? clock.mode : "",
        liveClockStartedAt: row.live_clock_started_at || null,
        liveClockElapsedSeconds: Number(row.live_clock_elapsed_seconds || 0),
        liveExtraMinutes: clock ? clock.extraMinutes : 0,
        tieBreakMethod: row.tie_break_method || "",
        homeExtraTimeScore: row.home_extra_time_score,
        awayExtraTimeScore: row.away_extra_time_score,
        homePenaltiesScore: row.home_penalties_score,
        awayPenaltiesScore: row.away_penalties_score,
        officials: [], events: [], note: row.note || ""
    };
}

function mapMatchLineup(row) {
    return {
        matchId: row.match_id,
        teamId: row.team_id,
        starters: JSON.parse(row.starters_json),
        substitutes: JSON.parse(row.substitutes_json),
        submittedAt: row.submitted_at,
        updatedAt: row.updated_at
    };
}

async function accountMe(request, env) {
    const auth = await authenticate(request, env);
    const user = await loadAccount(auth);
    if (!user) fail(403, "ACCOUNT_NOT_ASSIGNED", "Your account has not been registered with the championship.");
    return success({
        uid: user.firebase_uid,
        email: auth.claims.email || user.email,
        name: user.full_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        requestedAccountType: user.requested_account_type,
        emailVerified: auth.claims.email_verified === true,
        tournamentIds: await getTournamentScopes(auth.db, user)
    });
}

async function requestAccount(request, env) {
    const auth = await authenticate(request, env);
    const body = await readJson(request);
    await verifyTurnstile(env, body.turnstileToken, "account-registration");
    const email = validEmail(auth.claims.email || "");
    const name = text(body.fullName, "Full name", { required: true, max: 120 });
    const phone = text(body.phone, "Phone number", { max: 32 });
    const requestedType = text(body.accountType, "Account type", { required: true, max: 32 });
    const allowedTypes = ["team-manager"];
    if (allowedTypes.indexOf(requestedType) === -1) {
        fail(400, "INVALID_ACCOUNT_TYPE", "The requested account type is not supported.");
    }
    await rateLimitRequest(request, auth.db, auth.claims.sub, "account-register", 5, 3600);
    const blockedEmail = await auth.db.prepare(
        "SELECT 1 AS blocked FROM afc_deleted_manager_email_blocks WHERE email_sha256 = ?"
    ).bind(await emailBlockHash(email)).first();
    if (blockedEmail) {
        fail(403, "ACCOUNT_PERMANENTLY_DELETED",
            "This email address is blocked from creating another championship account. Contact the competition office if you believe this is a mistake.");
    }

    const existing = await auth.db.prepare(
        "SELECT firebase_uid, role, status FROM afc_users WHERE firebase_uid = ?"
    ).bind(auth.claims.sub).first();
    if (existing) {
        if (existing.status === "disabled" || existing.status === "suspended") {
            fail(403, "ACCOUNT_DISABLED", "This account is disabled. Contact the competitions office.");
        }
        return success({ status: existing.status, role: existing.role, alreadyRegistered: true }, 200);
    }
    const existingEmail = await auth.db.prepare(
        "SELECT firebase_uid FROM afc_users WHERE email = ? COLLATE NOCASE"
    ).bind(email).first();
    if (existingEmail) fail(409, "ACCOUNT_CONFLICT", "An account already exists for this email address.");

    try {
        await auth.db.prepare(
            "INSERT INTO afc_users(firebase_uid, email, full_name, phone, role, requested_account_type, " +
            "status, email_verified) VALUES(?, ?, ?, ?, 'team_manager', ?, 'pending', ?)"
        ).bind(
            auth.claims.sub, email, name, phone || null, requestedType,
            auth.claims.email_verified === true ? 1 : 0
        ).run();
    } catch (_error) {
        fail(500, "ACCOUNT_CREATE_FAILED", "The account request could not be saved.");
    }
    const ownerEmailStatus = body.suppressOwnerNotification === true
        ? "not_sent"
        : await notifyPlatformOwnersByEmail(
            env,
            auth.db,
            "owner_manager_account_requested",
            "owner-manager-account:" + auth.claims.sub,
            {
                managerName: name,
                managerEmail: email,
                managerPhone: phone || "",
                accountStatus: "Pending owner approval"
            }
        );
    return success({
        status: "pending",
        role: "team_manager",
        emailVerified: auth.claims.email_verified === true,
        ownerEmailStatus: ownerEmailStatus
    }, 201);
}

async function requestPasswordReset(request, env) {
    const body = await readJson(request);
    await verifyTurnstile(env, body.turnstileToken, "password-reset");
    const email = validEmail(body.email);
    const db = dbFor(env);
    const account = await db.prepare(
        "SELECT firebase_uid FROM afc_users WHERE email = ? COLLATE NOCASE"
    ).bind(email).first();
    if (!account) {
        fail(404, "EMAIL_NOT_FOUND", "No championship account exists for this email address.");
    }
    const apiKey = typeof env.FIREBASE_API_KEY === "string" ? env.FIREBASE_API_KEY.trim() : "";
    if (!apiKey) {
        fail(503, "PASSWORD_RESET_UNAVAILABLE",
            "Password reset is temporarily unavailable. Please contact the competition office.");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const dayStart = Math.floor((nowSeconds + 3 * 60 * 60) / 86400) * 86400 - 3 * 60 * 60;
    const limit = await db.prepare(
        "INSERT INTO afc_rate_limits(rate_key, window_start, request_count) VALUES(?, ?, 1) " +
        "ON CONFLICT(rate_key, window_start) DO UPDATE SET request_count = request_count + 1 " +
        "RETURNING request_count"
    ).bind("password-reset:" + await emailBlockHash(email), dayStart).first();
    if (!limit || limit.request_count > 2) {
        fail(429, "RESET_LIMIT_EXCEEDED",
            "You can request a maximum of two password reset emails per day. Try again tomorrow.");
    }

    let response;
    try {
        response = await fetch(
            "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=" +
                encodeURIComponent(apiKey),
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestType: "PASSWORD_RESET", email: email }),
                cache: "no-store"
            }
        );
    } catch (_error) {
        fail(502, "PASSWORD_RESET_FAILED",
            "The reset email could not be sent. Please try again later.");
    }

    let payload;
    try {
        payload = await response.json();
    } catch (_error) {
        fail(502, "PASSWORD_RESET_FAILED",
            "The reset service returned an unreadable response. Please try again later.");
    }
    if (!response.ok) {
        const firebaseCode = payload && payload.error && payload.error.message;
        if (firebaseCode === "EMAIL_NOT_FOUND") {
            fail(404, "FIREBASE_ACCOUNT_NOT_FOUND",
                "The championship account exists, but its Firebase sign-in account could not be found. Contact the competition office.");
        }
        if (firebaseCode === "TOO_MANY_ATTEMPTS_TRY_LATER" || firebaseCode === "QUOTA_EXCEEDED") {
            fail(429, "RATE_LIMITED",
                "The reset email service has received too many requests. Please try again later.");
        }
        fail(502, "PASSWORD_RESET_FAILED",
            "The reset email could not be sent. Please try again later.");
    }
    return success({ status: "sent" });
}

async function getTournamentScopes(db, user) {
    if (user.role === "platform_owner") return [];
    if (user.role !== "tournament_admin") return [];
    const result = await db.prepare(
        "SELECT tournament_id FROM afc_tournament_admin_scopes WHERE user_uid = ? ORDER BY tournament_id"
    ).bind(user.firebase_uid).all();
    return (result.results || []).map(function (row) { return row.tournament_id; });
}

async function requireTournamentScope(actor, tournamentId) {
    if (actor.user.role === "platform_owner") return;
    const scope = await actor.db.prepare(
        "SELECT 1 AS permitted FROM afc_tournament_admin_scopes " +
        "WHERE user_uid = ? AND tournament_id = ?"
    ).bind(actor.user.firebase_uid, tournamentId).first();
    if (!scope) fail(403, "FORBIDDEN", "You are not permitted to manage this tournament.");
}

async function getEmailSettings(db) {
    const result = await db.prepare(
        "SELECT setting_key, setting_value FROM afc_app_settings " +
        "WHERE setting_key IN ('brevo_sender_email', 'brevo_sender_name')"
    ).all();
    const settings = Object.create(null);
    (result.results || []).forEach(function (row) {
        settings[row.setting_key] = row.setting_value;
    });
    return settings;
}

async function updateEmailSettings(request, actor) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can configure the sender identity.");
    }
    const body = await readJson(request);
    const email = validEmail(body.email);
    const name = text(body.name, "Sender name", { required: true, max: 100 });
    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_app_settings(setting_key, setting_value, updated_by) VALUES('brevo_sender_email', ?, ?) " +
            "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, " +
            "updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP"
        ).bind(email, actor.user.firebase_uid),
        actor.db.prepare(
            "INSERT INTO afc_app_settings(setting_key, setting_value, updated_by) VALUES('brevo_sender_name', ?, ?) " +
            "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, " +
            "updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP"
        ).bind(name, actor.user.firebase_uid)
    ];
    await actor.db.batch(statements);
    await logAudit(actor.db, actor.user.firebase_uid, "update_email_sender", "setting", "brevo_sender");
    return success({ email: email, name: name });
}

async function logAudit(db, actorUid, action, entityType, entityId) {
    await db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) VALUES(?, ?, ?, ?, ?)"
    ).bind(newId("AUD-"), actorUid, action, entityType, entityId || null).run();
}

function htmlEscape(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (character) {
        return {
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[character];
    });
}

function formatEmailDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value || "To be confirmed");
    return new Intl.DateTimeFormat("en-KE", {
        timeZone: "Africa/Nairobi",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(date) + " EAT";
}

function pdfSafeText(value) {
    return String(value === null || value === undefined ? "" : value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "?")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
}

function pdfWrappedLines(value, maximumLength) {
    const text = String(value === null || value === undefined ? "" : value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "?")
        .trim();
    const lines = [];
    let line = "";
    text.split(/\s+/).filter(Boolean).forEach(function (word) {
        while (word.length > maximumLength) {
            if (line) {
                lines.push(line);
                line = "";
            }
            lines.push(word.slice(0, maximumLength));
            word = word.slice(maximumLength);
        }
        if (line && (line.length + word.length + 1) > maximumLength) {
            lines.push(line);
            line = "";
        }
        line = line ? line + " " + word : word;
    });
    if (line || !lines.length) lines.push(line);
    return lines;
}

function pdfBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

export function buildPaymentReceiptPdf(data) {
    const amount = "KES " + Number(data.amount || 0).toLocaleString("en-KE");
    const entries = [
        ["Payment reference", data.paymentReference],
        ["Registration reference", data.registrationReference],
        ["Team", data.teamName],
        ["Tournament", data.tournamentName],
        ["Payer", data.payerName],
        ["Payer email", data.payerEmail],
        ["Payment method", data.method],
        ["Payment status", data.status],
        ["Recorded on", data.recordedAt],
        ["Recorded by", data.recordedBy]
    ].filter(function (entry) {
        return entry[1] !== null && entry[1] !== undefined && String(entry[1]) !== "";
    });
    const commands = [
        "0.06 0.09 0.18 rg 0 640 612 202 re f",
        "1 1 1 rg",
        "BT /F1 11 Tf 48 790 Td (ANGUTSA CHAMPIONSHIP) Tj ET",
        "BT /F1 8 Tf 48 774 Td (OFFICIAL PAYMENT RECEIPT) Tj ET",
        "BT /F1 24 Tf 48 724 Td (Payment receipt) Tj ET",
        "BT /F1 10 Tf 48 700 Td (Receipt reference: " +
            pdfSafeText(data.paymentReference) + ") Tj ET",
        "0.83 0.69 0.39 rg 48 678 516 2 re f",
        "0.12 0.16 0.25 rg",
        "BT /F1 10 Tf 48 646 Td (PAYMENT DETAILS) Tj ET"
    ];
    let y = 614;
    entries.forEach(function (entry, index) {
        const valueLines = pdfWrappedLines(entry[1], 48);
        const rowHeight = Math.max(30, valueLines.length * 13 + 12);
        const textY = y - Math.max(0, (rowHeight - 22) / 2);
        if (index % 2 === 0) {
            commands.push("0.96 0.97 0.98 rg 48 " + (y - rowHeight + 8) +
                " 516 " + rowHeight + " re f");
        }
        commands.push("0.38 0.42 0.49 rg");
        commands.push("BT /F1 9 Tf 60 " + textY + " Td (" + pdfSafeText(entry[0]) + ") Tj ET");
        commands.push("0.12 0.16 0.25 rg");
        valueLines.forEach(function (line, lineIndex) {
            commands.push("BT /F1 10 Tf 300 " + (textY - lineIndex * 12) +
                " Td (" + pdfSafeText(line) + ") Tj ET");
        });
        y -= rowHeight;
    });
    const totalY = y - 10;
    commands.push("0.93 0.95 0.97 rg 48 " + (totalY - 16) + " 516 48 re f");
    commands.push("0.38 0.42 0.49 rg");
    commands.push("BT /F1 9 Tf 62 " + (totalY + 1) + " Td (AMOUNT RECEIVED) Tj ET");
    commands.push("0.12 0.16 0.25 rg");
    commands.push("BT /F1 18 Tf 300 " + (totalY - 2) + " Td (" +
        pdfSafeText(amount) + ") Tj ET");
    commands.push("0.38 0.42 0.49 rg");
    commands.push("BT /F1 8 Tf 48 72 Td (Keep this receipt for your records. Please contact the competitions office if you have questions.) Tj ET");
    commands.push("BT /F1 8 Tf 48 54 Td (Angutsa Championship | angutsachampionship@gmail.com) Tj ET");

    const stream = commands.join("\n");
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach(function (object, index) {
        offsets.push(pdf.length);
        pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    });
    const xrefOffset = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.slice(1).forEach(function (offset) {
        pdf += String(offset).padStart(10, "0") + " 00000 n \n";
    });
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" +
        xrefOffset + "\n%%EOF";
    return pdfBase64(pdf);
}

async function loadPaymentReceiptData(db, paymentId) {
    return db.prepare(
        "SELECT p.id, p.reference, p.amount, p.method, p.status, p.recorded_at, " +
        "p.tournament_id, r.public_reference AS registration_reference, tm.name AS team_name, " +
        "t.name AS tournament_name, manager.full_name AS payer_name, manager.email AS payer_email, " +
        "recorder.full_name AS recorded_by " +
        "FROM afc_payments p JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "JOIN afc_teams tm ON tm.id = p.team_id " +
        "JOIN afc_tournaments t ON t.id = p.tournament_id " +
        "JOIN afc_users manager ON manager.firebase_uid = r.manager_uid " +
        "LEFT JOIN afc_users recorder ON recorder.firebase_uid = p.recorded_by " +
        "WHERE p.id = ?"
    ).bind(paymentId).first();
}

function paymentReceiptPdf(receipt) {
    return buildPaymentReceiptPdf({
        paymentReference: receipt.reference,
        registrationReference: receipt.registration_reference,
        teamName: receipt.team_name,
        tournamentName: receipt.tournament_name,
        payerName: receipt.payer_name,
        payerEmail: receipt.payer_email,
        method: receipt.method,
        status: receipt.status === "confirmed" ? "Confirmed" :
            receipt.status === "partial" ? "Partially confirmed" : "Rejected",
        recordedAt: receipt.recorded_at,
        recordedBy: receipt.recorded_by,
        amount: receipt.amount
    });
}

function paymentReceiptEmailAttachment(receipt) {
    if (!receipt || (receipt.status !== "confirmed" && receipt.status !== "partial")) return [];
    return [{
        name: "Angutsa-payment-receipt-" + receipt.reference + ".pdf",
        content: paymentReceiptPdf(receipt)
    }];
}

async function paymentReceipt(actor, paymentId) {
    await requireUserPermission(actor, "payments.view");
    const receipt = await loadPaymentReceiptData(actor.db, paymentId);
    if (!receipt) fail(404, "NOT_FOUND", "The payment was not found.");
    await requireTournamentScope(actor, receipt.tournament_id);
    return success({
        fileName: "Angutsa-payment-receipt-" + receipt.reference + ".pdf",
        contentType: "application/pdf",
        content: paymentReceiptPdf(receipt)
    });
}

export function buildEmailContent(eventType, data) {
    const recipientName = data.recipientName || "there";
    let subject;
    let title;
    let intro;
    let details;
    let closing;

    if (eventType === "team_registration_received") {
        const feeAmount = Number(data.feeAmount || 0);
        subject = "Team registration received \u2014 " + data.tournamentName;
        title = "Registration received";
        intro = feeAmount > 0
            ? "We have received your team registration. The competitions office will review it and notify you of the outcome by email. Please pay the registration fee using the details below to secure your spot."
            : "We have received your team registration. It is now awaiting review by the competitions office.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Reference", data.reference],
            ["Registration fee", data.amountDue || "KES 0"]
        ];
        if (feeAmount > 0) {
            details.push(
                ["Payment method", data.paymentMethod || "M-Pesa"],
                ["Pay to", data.paymentNumber],
                ["Account name", data.paymentAccountName],
                ["Admin WhatsApp", data.adminWhatsApp || ADMIN_WHATSAPP_DISPLAY]
            );
            closing = "Send your M-Pesa payment to the number above, then forward the payment confirmation to the admin on WhatsApp at " +
                (data.adminWhatsApp || ADMIN_WHATSAPP_DISPLAY) +
                ". Once your registration is approved, sign in to add your team players.";
        } else {
            closing = "No registration fee is due. The competitions office will review your registration and email you with an update.";
        }
    } else if (eventType === "team_registration_decision") {
        const statusLabel = data.status === "approved" ? "Approved" :
            data.status === "rejected" ? "Not approved" : "Correction requested";
        subject = "Team registration " + statusLabel.toLowerCase();
        title = "Registration " + statusLabel.toLowerCase();
        intro = data.status === "approved"
            ? "The competitions office has approved your team registration."
            : data.status === "rejected"
                ? "The competitions office could not approve your team registration."
                : "The competitions office needs a correction to your team registration.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Reference", data.reference],
            ["Decision", statusLabel],
            ["Review note", data.reviewNote]
        ];
        if (data.status === "approved" && data.balanceDue) {
            details.push(["Outstanding balance", data.balanceDue]);
        }
        closing = data.status === "rejected"
            ? "Unfortunately, your team will not be able to participate in this tournament. If you believe this is an error or would like to discuss it further, please contact the competitions office."
            : data.status === "correction_requested"
                ? "Please review the note above, update your registration accordingly, and resubmit it for review. Contact the competitions office if you need help."
                : data.status === "approved" && data.balanceDue
                    ? (data.accountActivated ? "Your team manager account has been activated. " : "") +
                        "You can now sign in and add your team players. An outstanding balance of " + data.balanceDue +
                        " remains \u2014 please pay it and send the payment confirmation to the competitions office."
                    : data.accountActivated
                        ? "Your team manager account has been activated. You can now sign in and add your team players."
                        : "You can now sign in and add your team players. Contact the competitions office if you have any questions.";
    } else if (eventType === "payment_status") {
        const statusLabel = data.status === "confirmed" ? "Confirmed" :
            data.status === "partial" ? "Partially confirmed" : "Rejected";
        subject = "Payment " + statusLabel.toLowerCase();
        title = "Payment " + statusLabel.toLowerCase();
        intro = data.status === "rejected"
            ? "The competitions office could not accept this payment submission."
            : data.status === "partial"
                ? "We have received and recorded your payment. It has been applied as a partial payment toward your registration fee."
                : "The competitions office has received and confirmed this payment.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Registration reference", data.registrationReference],
            ["Payment reference", data.paymentReference],
            ["Amount submitted", data.amount],
            ["Outstanding balance", data.status === "partial" ? data.balanceDue : ""],
            ["Status", statusLabel],
            ["Review note", data.reviewNote]
        ];
        closing = data.status === "partial"
            ? "An outstanding balance of " + (data.balanceDue || "the remaining amount") +
                " remains. Please pay the balance and send the payment confirmation to the competitions office. " +
                "If your registration is approved before the full fee is cleared, you can still sign in and manage your team players."
            : data.status === "confirmed"
                ? (data.accountActivated && data.registrationApproved
                    ? "Your registration fee is now fully cleared. Your team registration has been approved and your team manager account has been activated. Sign in to add your team players."
                    : data.registrationApproved
                        ? "Your registration fee is now fully cleared and your team registration has been approved. Sign in to add your team players."
                        : data.accountActivated
                            ? "Your registration fee is now fully cleared and your team manager account has been activated. " +
                                (data.registrationStatus === "correction_requested"
                                    ? "The competitions office has requested a correction to your team registration \u2014 please check the review note and update your registration."
                                    : data.registrationStatus === "rejected"
                                        ? "However, your team registration was not approved. Please contact the competitions office for guidance."
                                        : "Your registration is still under review \u2014 you will receive an email once a decision is made.")
                            : (data.registrationStatus === "correction_requested"
                                ? "Your registration fee is now fully cleared. The competitions office has requested a correction to your team registration \u2014 please check the review note and update your registration."
                                : data.registrationStatus === "rejected"
                                    ? "Your registration fee is now fully cleared. However, your team registration was not approved. Please contact the competitions office for guidance."
                                    : "Your registration fee is now fully cleared. Your registration is still under review \u2014 you will receive an email once a decision is made."))
                : "This payment has not been applied to your registration. Please contact the competitions office for details and next steps.";
    } else if (eventType === "account_access_updated") {
        const accessStatus = data.status
            ? data.status.charAt(0).toUpperCase() + data.status.slice(1)
            : "";
        subject = "Your Angutsa Championship account has been updated";
        title = "Account access updated";
        intro = "Your Angutsa Championship account has been updated by a platform owner. Below is a summary of your current access.";
        details = [
            ["Role", data.role],
            ["Access status", accessStatus],
            ["Tournament access", data.tournamentAccess]
        ];
        closing = (data.status === "active")
            ? "Your account is active. Sign in to the Angutsa Championship platform to get started."
            : (data.status === "disabled" || data.status === "suspended")
                ? "Your account access has been restricted. Contact the competitions office at angutsachampionship@gmail.com if you believe this is a mistake."
                : "Sign in to the Angutsa Championship platform to review your current access. Contact the competitions office if you have questions.";
    } else if (eventType === "roster_change_permission_granted") {
        subject = "Temporary player roster access granted";
        title = "Temporary roster access";
        intro = "The competitions office has temporarily opened your team's player roster for changes.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Access starts", data.grantedAt],
            ["Access expires", data.expiresAt],
            ["Duration", data.durationHours],
            ["Permitted actions", "Add players, edit player details, and remove players from your team roster"]
        ];
        closing = "Access closes automatically at the expiry time above \u2014 make all roster changes before then. For an extension, contact the competitions office.";
    } else if (eventType === "owner_manager_account_requested") {
        subject = "New Team Manager account needs approval";
        title = "Team Manager account request";
        intro = "A new Team Manager has created an account and is awaiting your approval.";
        details = [
            ["Manager", data.managerName],
            ["Email", data.managerEmail],
            ["Phone", data.managerPhone],
            ["Account status", data.accountStatus]
        ];
        closing = "Review this request in Admin \u2192 Admin Users. The manager's tools remain locked until you approve their account or the full registration fee is confirmed.";
    } else if (eventType === "owner_team_registration_received") {
        subject = "New team registration needs attention";
        title = "Team registration received";
        intro = "A team has submitted a registration and is awaiting review.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Registration reference", data.reference],
            ["Manager", data.managerName],
            ["Manager email", data.managerEmail],
            ["Registration fee", data.amountDue],
            ["Registration status", "Pending review"]
        ];
        closing = "Review this registration in Admin \u2192 Registrations. Confirming the full registration fee automatically approves a pending registration, but you can also approve or reject it manually.";
    } else if (eventType === "owner_registration_payment_received") {
        subject = "Registration payment received";
        title = "Team registration payment received";
        intro = "A payment has been confirmed against a team registration.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Registration reference", data.registrationReference],
            ["Payment reference", data.paymentReference],
            ["Amount confirmed", data.amount],
            ["Payment status", data.status],
            ["Outstanding balance", data.balanceDue],
            ["Registration status", data.registrationStatus]
        ];
        closing = "Review this registration in Admin \u2192 Registrations if any further action is needed. Confirming the full fee automatically approves a pending registration.";
    } else if (eventType === "admin_team_manager_invited") {
        subject = "Your team manager account has been created";
        title = "Team manager account created";
        intro = "A platform owner has created your Angutsa Championship account and registered you as the manager for this team.";
        details = [
            ["Team", data.teamName],
            ["Tournament", data.tournamentName],
            ["Registration reference", data.reference],
            ["Registration status", "Pending review"],
            ["Registration fee due", data.amountDue]
        ];
        closing = "To set your password, go to the sign-in page (link below) and select Forgot password. Use the email address this message was sent to. " +
            "Your registration is pending review \u2014 you will receive an email once a decision is made. " +
            "The registration fee listed above is outstanding and no payment has been recorded yet.";
    } else if (eventType === "admin_tournament_admin_invited") {
        subject = "Your Tournament Admin account is ready";
        title = "Tournament Admin account created";
        intro = "A platform owner has created your Angutsa Championship Tournament Admin account. Your account is active and ready to use once you set a password.";
        details = [
            ["Role", data.role],
            ["Tournament access", data.tournamentAccess]
        ];
        closing = "To set your password, go to the sign-in page (link below) and select Forgot password. Use the email address this message was sent to. Once logged in, the platform owner will configure your specific admin permissions.";
    } else if (eventType === "rules_acknowledgment_reminder") {
        subject = "Reminder: please read and acknowledge the competition rules";
        title = "Competition rules acknowledgment";
        intro = "Our records show that the current competition rules have not yet been acknowledged for your team.";
        details = [
            ["Rules document", data.ruleTitle],
            ["Category", data.categoryName],
            ["Team", data.teamName],
            ["Tournament", data.tournamentName]
        ];
        closing = "Please sign in to your Team Manager Dashboard, open Competition Rules, read the document and record your acknowledgment. If you have already done this, contact the competitions office so we can check the record.";
    } else {
        throw new Error("Unsupported transactional email event: " + eventType);
    }

    const visibleDetails = details.filter(function (item) {
        return item[1] !== null && item[1] !== undefined && item[1] !== "";
    });
    const isInvitation = eventType === "admin_team_manager_invited" ||
        eventType === "admin_tournament_admin_invited";
    const textContent = [
        title,
        "",
        "Hello " + recipientName + ",",
        intro,
        "",
        visibleDetails.map(function (item) { return item[0] + ": " + item[1]; }).join("\n"),
        "",
        closing,
        isInvitation ? "Sign in: " + data.loginUrl : "",
        "",
        "Angutsa Championship",
        "Need help? angutsachampionship@gmail.com"
    ].join("\n");
    const detailRows = visibleDetails.map(function (item) {
        return '<tr><td style="padding:9px 12px;border-bottom:1px solid #eceef2;color:#697386;font-size:13px;">' +
            htmlEscape(item[0]) + '</td><td style="padding:9px 12px;border-bottom:1px solid #eceef2;color:#263244;font-size:14px;font-weight:600;text-align:right;">' +
            htmlEscape(item[1]) + "</td></tr>";
    }).join("");
    const htmlContent = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="margin:0;padding:24px 12px;background:#f4f6f8;color:#263244;font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' +
        htmlEscape(intro) + "</div>" +
        '<table role="presentation" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #e5e8ed;border-radius:6px;overflow:hidden;">' +
        '<tr><td style="height:4px;background:#7569a8;font-size:0;line-height:0;">&nbsp;</td></tr>' +
        '<tr><td style="padding:28px 30px 24px;">' +
        '<table role="presentation" style="border-collapse:collapse;margin:0 0 22px;">' +
        '<tr><td bgcolor="#5d557f" style="width:44px;height:44px;background:#5d557f;border-radius:4px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-align:center;vertical-align:middle;">AFC</td>' +
        '<td style="padding:0 0 0 12px;color:#202b3a;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;letter-spacing:1px;vertical-align:middle;">ANGUTSA<br>' +
        '<span style="color:#687386;font-size:10px;font-weight:700;letter-spacing:1.4px;">FOOTBALL CHAMPIONSHIP</span></td></tr>' +
        '</table>' +
        '<h1 style="margin:0 0 16px;color:#202b3a;font-size:22px;line-height:1.3;font-weight:700;">' +
        htmlEscape(title) + "</h1>" +
        '<p style="margin:0 0 12px;color:#354154;font-size:15px;line-height:1.6;">Hello ' +
        htmlEscape(recipientName) + ",</p>" +
        '<p style="margin:0 0 20px;color:#4e596b;font-size:15px;line-height:1.65;">' +
        htmlEscape(intro) + "</p>" +
        (detailRows ? '<table role="presentation" style="width:100%;margin:0 0 20px;border-collapse:collapse;background:#fafbfc;border:1px solid #eceef2;border-radius:4px;overflow:hidden;">' +
            detailRows + "</table>" : "") +
        '<p style="margin:0 0 20px;color:#4e596b;font-size:14px;line-height:1.65;">' +
        htmlEscape(closing) + "</p>" +
        (isInvitation && data.loginUrl
            ? '<table role="presentation" style="border-collapse:collapse;margin:0 0 24px;">' +
                '<tr><td style="border-radius:4px;background:#5d557f;text-align:center;">' +
                '<a href="' + htmlEscape(data.loginUrl) + '" target="_blank" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:4px;">Sign in to your account &rarr;</a>' +
                '</td></tr></table>'
            : "") +
        '<p style="margin:24px 0 0;color:#354154;font-size:14px;line-height:1.5;">Regards,<br><strong>Angutsa Championship</strong></p>' +
        "</td></tr>" +
        '<tr><td style="padding:16px 30px;background:#fafbfc;border-top:1px solid #eceef2;color:#758093;font-size:12px;line-height:1.6;">' +
        'This is an automated update about your championship account or team. For help, email ' +
        '<a href="mailto:angutsachampionship@gmail.com" style="color:#5d557f;text-decoration:underline;">angutsachampionship@gmail.com</a>.' +
        "</td></tr></table></body></html>";

    const attachments = eventType === "payment_status" && data.paymentReceipt
        ? paymentReceiptEmailAttachment(data.paymentReceipt)
        : [];
    return {
        subject: subject, textContent: textContent, htmlContent: htmlContent,
        attachments: attachments
    };
}

async function sendTransactionalEmail(env, db, eventType, eventKey, recipient, data) {
    if (!recipient || !recipient.uid || !recipient.email) {
        console.warn("Email event " + eventType + " skipped because its recipient could not be resolved.");
        return "recipient_unavailable";
    }
    const settings = await getEmailSettings(db);
    if (!env.BREVO_API_KEY || !settings.brevo_sender_email || !settings.brevo_sender_name) {
        console.warn("Email event " + eventType + " was not sent because Brevo sender settings are incomplete.");
        return "not_configured";
    }
    const content = buildEmailContent(eventType, data);
    const recipientEventKey = eventKey + ":" + recipient.uid;
    const previous = await db.prepare(
        "SELECT status, provider_message_id FROM afc_email_events WHERE event_key = ?"
    ).bind(recipientEventKey).first();
    if (previous) {
        return previous.status === "accepted" ? "accepted_by_provider" : previous.status;
    }

    const id = newId("EML-");
    const inserted = await db.prepare(
        "INSERT OR IGNORE INTO afc_email_events(id, event_key, recipient_uid, event_type, status) " +
        "VALUES(?, ?, ?, ?, 'pending')"
    ).bind(id, recipientEventKey, recipient.uid, eventType).run();
    if (!inserted.meta || inserted.meta.changes !== 1) return "not_sent";

    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 8000);
    let response;
    try {
        response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            signal: controller.signal,
            headers: {
                "api-key": env.BREVO_API_KEY,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                sender: { name: settings.brevo_sender_name, email: settings.brevo_sender_email },
                to: [{ email: recipient.email, name: recipient.name || "" }],
                subject: content.subject,
                textContent: content.textContent,
                htmlContent: content.htmlContent,
                ...(content.attachments.length ? { attachment: content.attachments } : {})
            })
        });
    } catch (_error) {
        await db.prepare(
            "UPDATE afc_email_events SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(id).run();
        console.warn("Brevo request failed for email event " + id + ".");
        clearTimeout(timeout);
        return "failed";
    }
    clearTimeout(timeout);

    let providerMessageId = null;
    if (response.ok) {
        try {
            const providerResponse = await response.json();
            if (providerResponse && typeof providerResponse.messageId === "string") {
                providerMessageId = providerResponse.messageId.slice(0, 255);
            }
        } catch (_error) {
            providerMessageId = null;
        }
        await db.prepare(
            "UPDATE afc_email_events SET status = 'accepted', provider_message_id = ?, " +
            "completed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(providerMessageId, id).run();
        return "accepted_by_provider";
    }

    await db.prepare(
        "UPDATE afc_email_events SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(id).run();
    console.warn("Brevo rejected email event " + id + " with HTTP " + response.status + ".");
    return "failed";
}

async function sendEmailsToRecipients(env, db, eventType, eventKey, recipients, dataForRecipient) {
    const uniqueRecipients = [];
    const seen = new Set();
    (recipients || []).forEach(function (recipient) {
        if (recipient && recipient.uid && !seen.has(recipient.uid)) {
            seen.add(recipient.uid);
            uniqueRecipients.push(recipient);
        }
    });
    if (!uniqueRecipients.length) {
        console.warn("Email event " + eventType + " skipped because no affected recipients were found.");
        return "recipient_unavailable";
    }
    const statuses = await Promise.all(uniqueRecipients.map(function (recipient) {
        return sendTransactionalEmail(
            env, db, eventType, eventKey, recipient, dataForRecipient(recipient)
        );
    }));
    if (statuses.every(function (status) { return status === "accepted_by_provider"; })) {
        return "accepted_by_provider";
    }
    if (statuses.some(function (status) { return status === "failed"; })) return "failed";
    if (statuses.some(function (status) { return status === "not_configured"; })) return "not_configured";
    if (statuses.some(function (status) { return status === "pending"; })) return "pending";
    if (statuses.some(function (status) { return status === "accepted_by_provider"; })) return "partial";
    return statuses[0];
}

async function notifyPlatformOwnersByEmail(env, db, eventType, eventKey, eventData) {
    const result = await db.prepare(
        "SELECT firebase_uid AS uid, email, full_name AS name FROM afc_users " +
        "WHERE role = 'platform_owner' AND status = 'active' " +
        "AND email IS NOT NULL AND TRIM(email) <> ''"
    ).all();
    const recipients = result.results || [];
    return sendEmailsToRecipients(
        env,
        db,
        eventType,
        eventKey,
        recipients,
        function (recipient) {
            const data = Object.assign({}, eventData);
            data.recipientName = recipient.name || "Platform owner";
            return data;
        }
    );
}

function paymentSettingsFromRows(rows) {
    const output = Object.create(null);
    (rows || []).forEach(function (row) {
        output[row.setting_key] = row.setting_value;
    });
    return output;
}

async function managerBootstrap(actor, url) {
    if (actor.user.role !== "team_manager") {
        fail(403, "FORBIDDEN", "A team manager account is required.");
    }
    const page = paginate(url, 100);
    const registrations = await actor.db.prepare(
        "SELECT r.*, tm.name AS team_name, tm.short_code, tm.location, tm.accent, " +
        "t.name AS tournament_name, t.slug AS tournament_slug, t.start_date, t.registration_fee, " +
        "c.name AS category_name, g.name AS group_name, " +
        "p.early_player_registration, p.roster_changes_after_start, p.roster_changes_expires_at " +
        "FROM afc_team_registrations r " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "JOIN afc_categories c ON c.id = r.category_id " +
        "LEFT JOIN afc_group_teams gt ON gt.registration_id = r.id " +
        "LEFT JOIN afc_tournament_groups g ON g.id = gt.group_id " +
        "LEFT JOIN afc_registration_permissions p ON p.registration_id = r.id " +
        "WHERE r.manager_uid = ? ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?"
    ).bind(actor.user.firebase_uid, page.limit, page.offset).all();
    const registrationRows = (registrations.results || []).map(function (row) {
        return Object.assign({}, row, {
            roster_changes_after_start: isRosterChangePermissionActive(row, Date.now()) ? 1 : 0
        });
    });
    const registrationIds = registrationRows.map(function (row) { return row.id; });
    let players = [];
    let payments = [];
    if (registrationIds.length) {
        const placeholders = registrationIds.map(function () { return "?"; }).join(",");
        const [playerRows, paymentRows] = await Promise.all([
            prepareBound(actor.db,
                "SELECT p.* FROM afc_players p WHERE p.registration_id IN (" + placeholders + ") " +
                "ORDER BY p.name",
                registrationIds
            ).all(),
            prepareBound(actor.db,
                "SELECT p.* FROM afc_payments p WHERE p.registration_id IN (" + placeholders + ") " +
                "ORDER BY p.recorded_at DESC",
                registrationIds
            ).all()
        ]);
        players = playerRows.results || [];
        payments = paymentRows.results || [];
    }
    const matchRows = await actor.db.prepare(
        "SELECT DISTINCT m.*, g.name AS group_name FROM afc_matches m " +
        "LEFT JOIN afc_tournament_groups g ON g.id = m.group_id WHERE m.published = 1 AND " +
        "(m.home_team_id IN (SELECT team_id FROM afc_team_registrations WHERE manager_uid = ?) " +
        "OR m.away_team_id IN (SELECT team_id FROM afc_team_registrations WHERE manager_uid = ?)) " +
        "ORDER BY m.kickoff LIMIT ? OFFSET ?"
    ).bind(actor.user.firebase_uid, actor.user.firebase_uid, page.limit, page.offset).all();
    const matchIds = (matchRows.results || []).map(function (match) { return match.id; });
    let matchLineups = [];
    if (matchIds.length) {
        const placeholders = matchIds.map(function () { return "?"; }).join(",");
        const lineupRows = await prepareBound(
            actor.db,
            "SELECT ml.* FROM afc_match_lineups ml JOIN afc_matches m ON m.id = ml.match_id " +
                "WHERE ml.match_id IN (" + placeholders + ") AND EXISTS (" +
                "SELECT 1 FROM afc_team_registrations r WHERE r.manager_uid = ? " +
                "AND r.status = 'approved' AND r.team_id = ml.team_id " +
                "AND r.tournament_id = m.tournament_id AND r.category_id = m.category_id)",
            matchIds.concat([actor.user.firebase_uid])
        ).all();
        matchLineups = (lineupRows.results || []).map(mapMatchLineup);
    }
    const notes = await actor.db.prepare(
        "SELECT id, category, title, body, target_path, read_at, created_at " +
        "FROM afc_notifications WHERE user_uid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(actor.user.firebase_uid, page.limit, page.offset).all();
    const acknowledgments = await actor.db.prepare(
        "SELECT registration_id, rules_id, acknowledged_at FROM afc_rules_acknowledgements " +
        "WHERE acknowledged_by = ? ORDER BY acknowledged_at DESC LIMIT ? OFFSET ?"
    ).bind(actor.user.firebase_uid, page.limit, page.offset).all();
    return success({
        manager: {
            id: actor.user.firebase_uid, name: actor.user.full_name, role: "Team Manager",
            email: actor.claims.email || actor.user.email, phone: actor.user.phone
        },
        registrations: registrationRows,
        players: players,
        payments: payments,
        matches: (matchRows.results || []).map(function (row) {
            return Object.assign(mapMatch(row), {
                lineupDay: isMatchLineupDay(row),
                lineupOpen: isMatchLineupOpen(row)
            });
        }),
        matchLineups: matchLineups,
        notifications: notes.results || [],
        acknowledgments: acknowledgments.results || []
    });
}

async function managerMatchLineupContext(actor, matchId) {
    const match = await actor.db.prepare(
        "SELECT id, tournament_id, category_id, published, kickoff, status, home_team_id, away_team_id " +
        "FROM afc_matches WHERE id = ?"
    ).bind(matchId).first();
    if (!match || Number(match.published) !== 1) {
        fail(404, "NOT_FOUND", "The published match was not found.");
    }
    const registrations = await actor.db.prepare(
        "SELECT team_id FROM afc_team_registrations WHERE manager_uid = ? AND status = 'approved' " +
        "AND tournament_id = ? AND category_id = ? AND team_id IN (?, ?)"
    ).bind(
        actor.user.firebase_uid, match.tournament_id, match.category_id,
        match.home_team_id, match.away_team_id
    ).all();
    const teamIds = (registrations.results || []).map(function (row) { return row.team_id; });
    if (!teamIds.length) {
        fail(403, "FORBIDDEN", "You do not manage a team participating in this match.");
    }
    return { match: match, teamIds: teamIds };
}

async function getManagerMatchLineups(actor, matchId) {
    const context = await managerMatchLineupContext(actor, matchId);
    const placeholders = context.teamIds.map(function () { return "?"; }).join(",");
    const rows = await prepareBound(
        actor.db,
        "SELECT * FROM afc_match_lineups WHERE match_id = ? AND team_id IN (" +
            placeholders + ")",
        [matchId].concat(context.teamIds)
    ).all();
    return success({
        matchId: matchId,
        lineupOpen: isMatchLineupOpen(context.match),
        lineups: (rows.results || []).map(mapMatchLineup)
    });
}

async function saveManagerMatchLineup(request, actor, matchId) {
    const body = await readJson(request);
    const context = await managerMatchLineupContext(actor, matchId);
    if (!isMatchLineupOpen(context.match)) {
        fail(409, "LINEUP_WINDOW_CLOSED",
            "Lineups can only be edited on match day before the scheduled kickoff.");
    }
    const teamId = validId(body.teamId, "Team");
    if (context.teamIds.indexOf(teamId) === -1) {
        fail(403, "FORBIDDEN", "You do not manage a team participating in this match.");
    }
    if (!Array.isArray(body.starters) || body.starters.length !== 11) {
        fail(400, "INVALID_LINEUP", "Select exactly 11 starting players.");
    }
    if (!Array.isArray(body.substitutes) || body.substitutes.length > 7) {
        fail(400, "INVALID_LINEUP", "Select no more than 7 substitutes.");
    }
    const starterIds = body.starters.map(function (id) { return validId(id, "Starter"); });
    const substituteIds = body.substitutes.map(function (id) { return validId(id, "Substitute"); });
    const selectedIds = starterIds.concat(substituteIds);
    if (new Set(selectedIds).size !== selectedIds.length) {
        fail(400, "INVALID_LINEUP", "A player can only appear once in the lineup.");
    }

    const placeholders = selectedIds.map(function () { return "?"; }).join(",");
    const players = await prepareBound(
        actor.db,
        "SELECT p.id, p.name, p.shirt_number, p.position FROM afc_players p " +
            "JOIN afc_team_registrations r ON r.id = p.registration_id " +
            "JOIN afc_categories c ON c.id = r.category_id " +
            "WHERE p.id IN (" + placeholders + ") AND p.team_id = ? " +
            "AND p.status = 'registered' AND r.manager_uid = ? AND r.status = 'approved' " +
            "AND r.tournament_id = ? AND r.category_id = ? " +
            "AND (c.guardian_consent_required = 0 OR p.guardian_consent_status = 'on_file')",
        selectedIds.concat([
            teamId, actor.user.firebase_uid, context.match.tournament_id, context.match.category_id
        ])
    ).all();
    const playersById = new Map((players.results || []).map(function (player) {
        return [player.id, player];
    }));
    if (playersById.size !== selectedIds.length) {
        fail(400, "INVALID_LINEUP_PLAYER",
            "Choose players from your approved, eligible registered squad only.");
    }
    const snapshot = function (id) {
        const player = playersById.get(id);
        return {
            playerId: player.id,
            name: player.name,
            shirtNumber: player.shirt_number,
            position: player.position
        };
    };
    const starters = starterIds.map(snapshot);
    const substitutes = substituteIds.map(snapshot);
    await actor.db.prepare(
        "INSERT INTO afc_match_lineups(match_id, team_id, manager_uid, starters_json, " +
        "substitutes_json, submitted_at, updated_at) VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP, " +
        "CURRENT_TIMESTAMP) ON CONFLICT(match_id, team_id) DO UPDATE SET " +
        "manager_uid = excluded.manager_uid, starters_json = excluded.starters_json, " +
        "substitutes_json = excluded.substitutes_json, submitted_at = CURRENT_TIMESTAMP, " +
        "updated_at = CURRENT_TIMESTAMP"
    ).bind(
        matchId, teamId, actor.user.firebase_uid,
        JSON.stringify(starters), JSON.stringify(substitutes)
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "save_match_lineup", "match_lineup", matchId);
    return success({
        matchId: matchId,
        teamId: teamId,
        starters: starters,
        substitutes: substitutes
    });
}

async function adminMatchLineupSheet(actor, matchId) {
    const match = await actor.db.prepare(
        "SELECT m.id, m.tournament_id, m.category_id, m.stage, m.round, m.group_id, " +
        "g.name AS group_name, m.kickoff, m.venue, m.status, m.home_team_id, m.away_team_id, " +
        "home.name AS home_team_name, away.name AS away_team_name, t.name AS tournament_name, " +
        "c.name AS category_name FROM afc_matches m " +
        "LEFT JOIN afc_tournament_groups g ON g.id = m.group_id " +
        "LEFT JOIN afc_teams home ON home.id = m.home_team_id " +
        "LEFT JOIN afc_teams away ON away.id = m.away_team_id " +
        "JOIN afc_tournaments t ON t.id = m.tournament_id " +
        "JOIN afc_categories c ON c.id = m.category_id WHERE m.id = ?"
    ).bind(matchId).first();
    if (!match) fail(404, "NOT_FOUND", "The match was not found.");
    await requireTournamentScope(actor, match.tournament_id);
    const lineups = await actor.db.prepare(
        "SELECT * FROM afc_match_lineups WHERE match_id = ? ORDER BY team_id"
    ).bind(matchId).all();
    return success({
        match: match,
        lineups: (lineups.results || []).map(function (row) {
            return Object.assign(mapMatchLineup(row), {
                teamName: row.team_id === match.home_team_id
                    ? match.home_team_name || "Home team"
                    : match.away_team_name || "Away team"
            });
        })
    });
}

async function submitTeamRegistration(request, actor, url, body) {
    if (!actor.user) {
        fail(403, "ACCOUNT_NOT_ASSIGNED", "Create a Team Manager account or sign in before registering a team.");
    }
    if (!canCreateTeamRegistration(actor.user)) {
        fail(403, "ACCOUNT_NOT_READY",
            "A pending Team Manager account or an active approved Team Manager account is required to register a team.");
    }
    const teamName = text(body.teamName, "Team name", { required: true, max: 120 });
    const tournamentId = validId(body.tournamentId, "Tournament");
    const categoryId = validId(body.categoryId, "Category");
    const requestKey = String(request.headers.get("Idempotency-Key") || "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
        fail(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
    }
    await rateLimitRequest(request, actor.db, actor.claims.sub, "team-registration", 5, 3600);

    const previous = await actor.db.prepare(
        "SELECT r.id, r.public_reference, r.status, tm.name AS team_name, t.name AS tournament_name " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "WHERE r.manager_uid = ? AND r.request_key = ?"
    ).bind(actor.claims.sub, requestKey).first();
    if (previous) return success({
        id: previous.id, reference: previous.public_reference, status: previous.status,
        teamName: previous.team_name, tournamentName: previous.tournament_name,
        emailStatus: "not_sent", duplicate: true
    }, 200);

    const tournament = await actor.db.prepare(
        "SELECT id, name, category_id, status, registration_opens, registration_closes, " +
        "team_limit, registration_fee FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament || tournament.status === "draft" || tournament.status === "archived" ||
        tournament.category_id !== categoryId) {
        fail(400, "INVALID_TOURNAMENT", "Choose a valid tournament and its configured category.");
    }
    if (!isRegistrationWindowOpen(tournament.registration_opens, tournament.registration_closes)) {
        fail(409, "REGISTRATION_CLOSED", "Registration is not open for this tournament.");
    }
    const count = await actor.db.prepare(
        "SELECT COUNT(*) AS total FROM afc_team_registrations " +
        "WHERE tournament_id = ? AND status IN ('pending_review', 'approved')"
    ).bind(tournamentId).first();
    if (tournament.team_limit && count.total >= tournament.team_limit) {
        fail(409, "TOURNAMENT_FULL", "This tournament has reached its team limit.");
    }
    const duplicateName = await actor.db.prepare(
        "SELECT 1 AS present FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "WHERE r.tournament_id = ? AND lower(tm.name) = lower(?) " +
        "AND r.status IN ('pending_review', 'approved')"
    ).bind(tournamentId, teamName).first();
    if (duplicateName) fail(409, "DUPLICATE_TEAM", "A team with that name is already registered.");

    const category = await actor.db.prepare(
        "SELECT id FROM afc_categories WHERE id = ? AND status = 'active'"
    ).bind(categoryId).first();
    if (!category) fail(400, "INVALID_CATEGORY", "Choose an active category.");
    const paymentRows = await actor.db.prepare(
        "SELECT setting_key, setting_value FROM afc_app_settings " +
        "WHERE setting_key IN ('payment_method', 'payment_phone', 'payment_name')"
    ).all();
    const payment = mapPaymentSettings(paymentRows.results);

    const location = text(body.location, "Team location", { max: 120 });
    const managerPublic = bool(body.managerPublic);
    const logoKey = body.logoKey ? String(body.logoKey) : null;
    if (logoKey) {
        if (!/^[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(logoKey)) {
            fail(400, "INVALID_UPLOAD", "The team logo is not available.");
        }
        const ownedLogo = await actor.db.prepare(
            "SELECT object_key FROM afc_media WHERE object_key = ? AND owner_uid = ? AND visibility = 'private'"
        ).bind("media/" + logoKey, actor.claims.sub).first();
        if (!ownedLogo) fail(400, "INVALID_UPLOAD", "The team logo is not available.");
    }

    const registrationId = newId("REG-");
    const teamId = newId("TEAM-");
    const reference = "TR-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const shortCode = await uniqueShortCode(actor.db, teamName);
    const accent = "#5B4BBD";
    try {
        await actor.db.batch([
            actor.db.prepare(
                "INSERT INTO afc_teams(id, name, short_code, category_id, manager_uid, location, logo_key, accent) " +
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(teamId, teamName, shortCode, categoryId, actor.claims.sub, location, logoKey, accent),
            actor.db.prepare(
                "INSERT INTO afc_team_registrations(id, public_reference, team_id, tournament_id, category_id, " +
                "manager_uid, status, fee_amount, manager_public, request_key) " +
                "VALUES(?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)"
            ).bind(
                registrationId, reference, teamId, tournamentId, categoryId,
                actor.claims.sub, tournament.registration_fee, managerPublic ? 1 : 0, requestKey
            ),
            actor.db.prepare(
                "INSERT INTO afc_registration_permissions(registration_id, updated_by) VALUES(?, ?)"
            ).bind(registrationId, actor.claims.sub)
        ]);
    } catch (_error) {
        fail(409, "REGISTRATION_CONFLICT", "The team registration could not be created. Check for duplicate details and try again.");
    }

    const registration = {
        id: registrationId, public_reference: reference,
        team_name: teamName, tournament_name: tournament.name, status: "pending_review"
    };
    const emailStatus = await sendTransactionalEmail(
        actor.env,
        actor.db,
        "team_registration_received",
        "team-registration:" + registrationId,
        {
            uid: actor.user.firebase_uid,
            email: actor.claims.email || actor.user.email,
            name: actor.user.full_name,
            email_verified: actor.user.email_verified
        },
        {
            recipientName: actor.user.full_name,
            teamName: teamName,
            tournamentName: tournament.name,
            reference: reference,
            feeAmount: Number(tournament.registration_fee || 0),
            amountDue: "KES " + Number(tournament.registration_fee || 0).toLocaleString("en-KE"),
            paymentMethod: payment.method || "M-Pesa",
            paymentNumber: payment.number,
            paymentAccountName: payment.accountName,
            adminWhatsApp: ADMIN_WHATSAPP_DISPLAY
        }
    );
    const ownerEmailStatus = await notifyPlatformOwnersByEmail(
        actor.env,
        actor.db,
        "owner_team_registration_received",
        "owner-team-registration:" + registrationId,
        {
            teamName: teamName,
            tournamentName: tournament.name,
            reference: reference,
            managerName: actor.user.full_name,
            managerEmail: actor.claims.email || actor.user.email,
            amountDue: "KES " + Number(tournament.registration_fee || 0).toLocaleString("en-KE")
        }
    );
    return success({
        id: registrationId, reference: reference, status: "pending_review",
        teamName: teamName, tournamentName: tournament.name, emailStatus: emailStatus,
        ownerEmailStatus: ownerEmailStatus
    }, 201);
}

async function createAdminTeamRegistration(request, actor) {
    const body = await readJson(request);
    const teamName = text(body.teamName, "Team name", { required: true, max: 120 });
    const location = text(body.location, "Team location", { max: 120 });
    const tournamentId = validId(body.tournamentId, "Tournament");
    const managerName = text(body.managerName, "Manager name", { required: true, max: 120 });
    const managerEmail = validEmail(body.managerEmail);
    const managerPhone = text(body.managerPhone, "Manager phone number", { required: true, max: 32 });
    const managerIdToken = text(body.managerIdToken, "Manager sign-in token", {
        required: true, max: 8192
    });
    const requestKey = String(request.headers.get("Idempotency-Key") || "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
        fail(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
    }
    const managerClaims = await verifyFirebaseToken(managerIdToken);
    const firebaseClaims = managerClaims.firebase;
    if (typeof managerClaims.email !== "string" ||
        managerClaims.email.trim().toLowerCase() !== managerEmail ||
        !firebaseClaims || firebaseClaims.sign_in_provider !== "password" ||
        managerClaims.auth_time < Math.floor(Date.now() / 1000) - 600) {
        fail(401, "MANAGER_IDENTITY_INVALID", "The new manager account could not be verified. Please try again.");
    }

    await rateLimitRequest(request, actor.db, actor.claims.sub, "admin-team-create", 10, 3600);
    const previous = await actor.db.prepare(
        "SELECT r.id, r.public_reference, r.status, tm.name AS team_name, t.name AS tournament_name " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "WHERE r.manager_uid = ? AND r.request_key = ?"
    ).bind(managerClaims.sub, requestKey).first();
    if (previous) {
        return success({
            id: previous.id,
            reference: previous.public_reference,
            status: previous.status,
            teamName: previous.team_name,
            tournamentName: previous.tournament_name,
            emailStatus: "not_sent",
            duplicate: true
        });
    }

    const blockedEmail = await actor.db.prepare(
        "SELECT 1 AS blocked FROM afc_deleted_manager_email_blocks WHERE email_sha256 = ?"
    ).bind(await emailBlockHash(managerEmail)).first();
    if (blockedEmail) {
        fail(403, "ACCOUNT_PERMANENTLY_DELETED",
            "This email address is blocked from creating another championship account.");
    }
    const existingManager = await actor.db.prepare(
        "SELECT 1 AS present FROM afc_users WHERE firebase_uid = ? OR email = ? COLLATE NOCASE"
    ).bind(managerClaims.sub, managerEmail).first();
    if (existingManager) {
        fail(409, "MANAGER_ACCOUNT_EXISTS",
            "A championship account already exists for this Firebase identity or email. It was not changed.");
    }

    const origin = normalizeOrigin(request.headers.get("Origin") || "");
    if (!origin) {
        fail(400, "SITE_ORIGIN_REQUIRED", "The manager sign-in link could not be created. Submit from the Admin website.");
    }
    const loginUrl = new URL("/login/", origin).toString();
    const tournament = await actor.db.prepare(
        "SELECT id, name, category_id, status, registration_opens, registration_closes, " +
        "team_limit, registration_fee FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament || tournament.status === "draft" || tournament.status === "archived") {
        fail(400, "INVALID_TOURNAMENT", "Choose a valid tournament that accepts team registrations.");
    }
    if (!isRegistrationWindowOpen(tournament.registration_opens, tournament.registration_closes)) {
        fail(409, "REGISTRATION_CLOSED", "Registration is not open for this tournament.");
    }
    const category = await actor.db.prepare(
        "SELECT id FROM afc_categories WHERE id = ? AND status = 'active'"
    ).bind(tournament.category_id).first();
    if (!category) fail(400, "INVALID_CATEGORY", "The tournament's category is not active.");
    const count = await actor.db.prepare(
        "SELECT COUNT(*) AS total FROM afc_team_registrations " +
        "WHERE tournament_id = ? AND status IN ('pending_review', 'approved')"
    ).bind(tournamentId).first();
    if (tournament.team_limit && count.total >= tournament.team_limit) {
        fail(409, "TOURNAMENT_FULL", "This tournament has reached its team limit.");
    }
    const duplicateName = await actor.db.prepare(
        "SELECT 1 AS present FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "WHERE r.tournament_id = ? AND lower(tm.name) = lower(?) " +
        "AND r.status IN ('pending_review', 'approved')"
    ).bind(tournamentId, teamName).first();
    if (duplicateName) fail(409, "DUPLICATE_TEAM", "A team with that name is already registered.");

    const paymentRows = await actor.db.prepare(
        "SELECT setting_key, setting_value FROM afc_app_settings " +
        "WHERE setting_key IN ('payment_method', 'payment_phone', 'payment_name')"
    ).all();
    const payment = mapPaymentSettings(paymentRows.results);
    const registrationId = newId("REG-");
    const teamId = newId("TEAM-");
    const reference = "TR-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const shortCode = await uniqueShortCode(actor.db, teamName);
    await actor.db.batch([
        actor.db.prepare(
            "INSERT INTO afc_users(firebase_uid, email, full_name, phone, role, requested_account_type, " +
            "status, email_verified) VALUES(?, ?, ?, ?, NULL, 'team-manager', 'pending', ?)"
        ).bind(
            managerClaims.sub, managerEmail, managerName, managerPhone,
            managerClaims.email_verified === true ? 1 : 0
        ),
        actor.db.prepare(
            "INSERT INTO afc_teams(id, name, short_code, category_id, manager_uid, location, accent) " +
            "VALUES(?, ?, ?, ?, ?, ?, ?)"
        ).bind(teamId, teamName, shortCode, tournament.category_id, managerClaims.sub, location, "#5B4BBD"),
        actor.db.prepare(
            "INSERT INTO afc_team_registrations(id, public_reference, team_id, tournament_id, category_id, " +
            "manager_uid, status, fee_amount, manager_public, request_key) " +
            "VALUES(?, ?, ?, ?, ?, ?, 'pending_review', ?, 0, ?)"
        ).bind(
            registrationId, reference, teamId, tournamentId, tournament.category_id,
            managerClaims.sub, tournament.registration_fee, requestKey
        ),
        actor.db.prepare(
            "INSERT INTO afc_registration_permissions(registration_id, updated_by) VALUES(?, ?)"
        ).bind(registrationId, actor.user.firebase_uid),
        actor.db.prepare(
            "INSERT INTO afc_notifications(id, user_uid, category, title, body, target_path) " +
            "VALUES(?, ?, 'Registration', 'Team registration received', ?, '#/registrations')"
        ).bind(
            newId("NTF-"), managerClaims.sub,
            teamName + " has been submitted for " + tournament.name + " and is awaiting review."
        ),
        actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) " +
            "VALUES(?, ?, 'platform_owner_create_team', 'team_registration', ?)"
        ).bind(newId("AUD-"), actor.user.firebase_uid, registrationId)
    ]);

    const emailStatus = await sendTransactionalEmail(
        actor.env,
        actor.db,
        "admin_team_manager_invited",
        "admin-team-manager:" + registrationId,
        {
            uid: managerClaims.sub,
            email: managerEmail,
            name: managerName,
            email_verified: managerClaims.email_verified === true
        },
        {
            recipientName: managerName,
            teamName: teamName,
            tournamentName: tournament.name,
            reference: reference,
            amountDue: "KES " + Number(tournament.registration_fee || 0).toLocaleString("en-KE"),
            managerPhone: managerPhone,
            loginUrl: loginUrl
        }
    );
    const ownerEmailStatus = await notifyPlatformOwnersByEmail(
        actor.env,
        actor.db,
        "owner_team_registration_received",
        "owner-team-registration:" + registrationId,
        {
            teamName: teamName,
            tournamentName: tournament.name,
            reference: reference,
            managerName: managerName,
            managerEmail: managerEmail,
            amountDue: "KES " + Number(tournament.registration_fee || 0).toLocaleString("en-KE")
        }
    );
    return success({
        id: registrationId,
        reference: reference,
        status: "pending_review",
        teamName: teamName,
        tournamentName: tournament.name,
        feeAmount: Number(tournament.registration_fee || 0),
        emailStatus: emailStatus,
        ownerEmailStatus: ownerEmailStatus
    }, 201);
}

async function uniqueShortCode(db, teamName) {
    const base = (String(teamName).toUpperCase().match(/[A-Z]+/g) || [])
        .map(function (part) { return part.charAt(0); }).join("").slice(0, 3) || "T";
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = (base + String(crypto.getRandomValues(new Uint16Array(1))[0] % 1000)
            .padStart(3, "0")).slice(0, 8);
        const existing = await db.prepare(
            "SELECT 1 AS present FROM afc_teams WHERE short_code = ?"
        ).bind(candidate).first();
        if (!existing) return candidate;
    }
    fail(503, "ID_GENERATION_FAILED", "A team code could not be generated. Please try again.");
}

export function adminBootstrapDataAccess(role, permissions) {
    const owner = role === "platform_owner";
    const canView = function (key) {
        return owner || Boolean(permissions && permissions[key] === "allow");
    };
    const canViewAny = function (keys) {
        return owner || keys.some(canView);
    };
    const matchContext = ["fixtures.view", "matches.view", "results.view", "standings.view"];
    return {
        competitionContext: canViewAny([
            "tournaments.view", "categories.view", "teams.view", "registrations.view",
            "fixtures.view", "matches.view", "results.view", "standings.view", "rules.view",
            "payments.view", "payments.create", "players.view", "reports.view"
        ]),
        fullTeams: canViewAny(["teams.view", "registrations.view"].concat(matchContext)),
        relatedTeams: canViewAny([
            "players.view", "payments.view", "payments.create", "reports.view"
        ]),
        players: canViewAny(["players.view", "results.view"]),
        fixtures: canViewAny(matchContext),
        matchEvents: canViewAny(["results.view", "standings.view"]),
        tournamentGroups: canViewAny(["tournaments.view"].concat(matchContext)),
        paymentRegistrations: canView("payments.create"),
        payments: canViewAny(["payments.view", "reports.view"])
    };
}

export function adminBootstrapTeamReferences(teams) {
    return teams.map(function (row) {
        return {
            id: row.id,
            name: row.name,
            short_code: row.short_code,
            category_id: row.category_id,
            tournament_id: row.tournament_id,
            registration_id: row.registration_id,
            registration_status: row.registration_status
        };
    });
}

async function loadAdminBootstrap(actor, url) {
    const page = paginate(url, 50);
    const owner = actor.user.role === "platform_owner";
    const permissions = owner
        ? Object.fromEntries(ADMIN_PERMISSION_CATALOG.map(function (permission) {
            return [permission.key, "allow"];
        }))
        : await userPermissionStates(actor.db, actor.user.firebase_uid);
    const canView = function (key) {
        return owner || permissions[key] === "allow";
    };
    const dataAccess = adminBootstrapDataAccess(actor.user.role, permissions);
    const scopes = await getTournamentScopes(actor.db, actor.user);
    const scopeFilter = owner
        ? null
        : scopes.length
            ? " AND r.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ")"
            : " AND 1=0";
    const scopeBindings = owner ? [] : scopes;
    const tournamentRows = owner
        ? await actor.db.prepare(
            "SELECT t.*, (SELECT COUNT(*) FROM afc_team_registrations r " +
            "WHERE r.tournament_id = t.id AND r.status = 'approved') AS teams_registered " +
            "FROM afc_tournaments t ORDER BY t.season DESC, t.name LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all()
        : scopes.length
            ? await prepareBound(
                actor.db,
                "SELECT t.*, (SELECT COUNT(*) FROM afc_team_registrations r " +
                "WHERE r.tournament_id = t.id AND r.status = 'approved') AS teams_registered " +
                "FROM afc_tournaments t WHERE t.id IN (" +
                scopes.map(function () { return "?"; }).join(",") + ") " +
                "ORDER BY t.season DESC, t.name LIMIT ? OFFSET ?",
                scopes.concat([page.limit, page.offset])
            ).all()
            : { results: [] };
    const teamSql =
        "SELECT tm.*, r.tournament_id, r.id AS registration_id, r.status AS registration_status, " +
        "r.public_reference, p.early_player_registration, p.roster_changes_after_start, " +
        "p.roster_changes_expires_at, " +
        "u.full_name AS manager_name, u.email AS manager_email, u.phone AS manager_phone " +
        "FROM afc_teams tm LEFT JOIN afc_team_registrations r ON r.team_id = tm.id " +
        "LEFT JOIN afc_registration_permissions p ON p.registration_id = r.id " +
        "LEFT JOIN afc_users u ON u.firebase_uid = tm.manager_uid " +
        (scopeFilter ? "WHERE 1=1" + scopeFilter : "") +
        " ORDER BY tm.name LIMIT ? OFFSET ?";
    const registrationSql =
        "SELECT r.*, p.early_player_registration, p.roster_changes_after_start, " +
        "p.roster_changes_expires_at, " +
        "tm.name AS team_name, tm.short_code, tm.location, t.name AS tournament_name, " +
        "c.name AS category_name, u.full_name AS manager_name, u.email AS manager_email, u.phone AS manager_phone " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id JOIN afc_categories c ON c.id = r.category_id " +
        "JOIN afc_users u ON u.firebase_uid = r.manager_uid " +
        "LEFT JOIN afc_registration_permissions p ON p.registration_id = r.id " +
        (scopeFilter ? "WHERE 1=1" + scopeFilter : "") +
        " ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?";
    const paymentRegistrationSql =
        "SELECT r.id, r.team_id, r.tournament_id FROM afc_team_registrations r " +
        (scopeFilter ? "WHERE 1=1" + scopeFilter : "") +
        " ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?";
    const playerSql =
        "SELECT p.*, r.tournament_id FROM afc_players p " +
        "JOIN afc_team_registrations r ON r.id = p.registration_id " +
        (scopeFilter ? "WHERE 1=1" + scopeFilter : "") + " ORDER BY p.name LIMIT ? OFFSET ?";
    const matchSql =
        "SELECT m.*, g.name AS group_name FROM afc_matches m " +
        "LEFT JOIN afc_tournament_groups g ON g.id = m.group_id " +
        (owner ? "" : scopes.length
            ? "WHERE m.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "WHERE 1=0 ") +
        "ORDER BY m.kickoff DESC LIMIT ? OFFSET ?";
    const paymentSql =
        "SELECT p.* FROM afc_payments p " +
        (owner ? "" : scopes.length
            ? "WHERE p.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "WHERE 1=0 ") +
        "ORDER BY p.recorded_at DESC LIMIT ? OFFSET ?";
    const ruleSql =
        "SELECT r.* FROM afc_rules r " +
        (owner ? "" : scopes.length
            ? "WHERE r.category_id IN (SELECT DISTINCT category_id FROM afc_tournaments " +
                "WHERE id IN (" + scopes.map(function () { return "?"; }).join(",") + ")) "
            : "WHERE 1=0 ") +
        "ORDER BY r.category_id, r.title LIMIT ? OFFSET ?";
    const matchEventSql =
        "SELECT e.match_id, e.team_id, e.player_id, e.event_type, e.minute, " +
        "p.name AS player_name, tm.name AS team_name FROM afc_match_events e " +
        "JOIN afc_matches m ON m.id = e.match_id " +
        "JOIN afc_teams tm ON tm.id = e.team_id " +
        "LEFT JOIN afc_players p ON p.id = e.player_id " +
        "WHERE e.event_type IN ('goal', 'own_goal') " +
        (owner ? "" : scopes.length
            ? "AND m.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "AND 1=0 ") +
        "ORDER BY m.kickoff DESC, e.minute, e.created_at";
    const groupSql =
        "SELECT g.id, g.tournament_id, g.name, g.position, gt.team_id " +
        "FROM afc_tournament_groups g LEFT JOIN afc_group_teams gt ON gt.group_id = g.id " +
        (owner ? "" : scopes.length
            ? "WHERE g.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "WHERE 1=0 ") +
        "ORDER BY g.tournament_id, g.position, gt.team_id";
    const stageSql =
        "SELECT * FROM afc_tournament_stages " +
        (owner ? "" : scopes.length
            ? "WHERE tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "WHERE 1=0 ") +
        "ORDER BY tournament_id, position";
    const stageParticipantsSql =
        "SELECT p.stage_id, s.tournament_id, p.team_id, p.source, p.seed " +
        "FROM afc_stage_participants p JOIN afc_tournament_stages s ON s.id = p.stage_id " +
        (owner ? "" : scopes.length
            ? "WHERE s.tournament_id IN (" + scopes.map(function () { return "?"; }).join(",") + ") "
            : "WHERE 1=0 ") +
        "ORDER BY p.stage_id, p.seed";
    const tournamentStagesQuery = canView("tournaments.view") || canView("tournaments.edit")
        ? prepareBound(actor.db, stageSql, owner ? [] : scopes).all()
        : Promise.resolve({ results: [] });
    const mediaQuery = owner
        ? actor.db.prepare(
            "SELECT id, media_type, title, category, status, file_path, video_url, added_on, caption " +
            "FROM afc_media_items ORDER BY added_on DESC, created_at DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all()
        : Promise.resolve({ results: [] });
    const paymentRegistrationQuery = dataAccess.paymentRegistrations
        ? prepareBound(
            actor.db,
            paymentRegistrationSql,
            scopeBindings.concat([page.limit, page.offset])
        ).all()
        : Promise.resolve({ results: [] });

    const [categories, teams, registrations, paymentRegistrations, players, matches, payments, users, audit, rules, notifications, matchEvents, tournamentGroups, tournamentStages, tournamentStageParticipants, media] = await Promise.all([
        actor.db.prepare("SELECT * FROM afc_categories ORDER BY name LIMIT ? OFFSET ?")
            .bind(page.limit, page.offset).all(),
        prepareBound(actor.db, teamSql, scopeBindings.concat([page.limit, page.offset])).all(),
        prepareBound(actor.db, registrationSql, scopeBindings.concat([page.limit, page.offset])).all(),
        paymentRegistrationQuery,
        prepareBound(actor.db, playerSql, scopeBindings.concat([page.limit, page.offset])).all(),
        prepareBound(actor.db, matchSql, (owner ? [] : scopes).concat([page.limit, page.offset])).all(),
        prepareBound(actor.db, paymentSql, (owner ? [] : scopes).concat([page.limit, page.offset])).all(),
        owner
            ? actor.db.prepare(
                "SELECT u.firebase_uid AS id, u.full_name AS name, u.email, u.phone, u.role, u.status, " +
                "u.requested_account_type, u.created_at, " +
                "(SELECT COUNT(*) FROM afc_user_permissions p WHERE p.user_uid = u.firebase_uid " +
                "AND p.effect = 'allow') AS allowed_permissions, " +
                "(SELECT COUNT(*) FROM afc_user_permissions p WHERE p.user_uid = u.firebase_uid " +
                "AND p.effect = 'deny') AS denied_permissions, " +
                "(SELECT GROUP_CONCAT(s.tournament_id, ',') FROM afc_tournament_admin_scopes s " +
                "WHERE s.user_uid = u.firebase_uid) AS tournament_ids " +
                "FROM afc_users u ORDER BY u.created_at DESC LIMIT ? OFFSET ?"
            ).bind(page.limit, page.offset).all()
            : Promise.resolve({ results: [] }),
        owner
            ? actor.db.prepare(
                "SELECT a.id, a.actor_uid, u.email AS actor_email, a.action, " +
                "a.entity_type, a.entity_id, a.created_at " +
                "FROM afc_audit_log a LEFT JOIN afc_users u ON u.firebase_uid = a.actor_uid " +
                "ORDER BY a.created_at DESC LIMIT ? OFFSET ?"
            ).bind(page.limit, page.offset).all()
            : Promise.resolve({ results: [] }),
        prepareBound(actor.db, ruleSql, (owner ? [] : scopes).concat([page.limit, page.offset])).all(),
        actor.db.prepare(
            "SELECT id, category, title, body, target_path, read_at, created_at " +
            "FROM afc_notifications WHERE user_uid = ? ORDER BY created_at DESC LIMIT 50"
        ).bind(actor.user.firebase_uid).all(),
        prepareBound(actor.db, matchEventSql, owner ? [] : scopes).all(),
        prepareBound(actor.db, groupSql, owner ? [] : scopes).all(),
        tournamentStagesQuery,
        canView("tournaments.view") || canView("tournaments.edit")
            ? prepareBound(actor.db, stageParticipantsSql, owner ? [] : scopes).all()
            : Promise.resolve({ results: [] }),
        mediaQuery
    ]);

    let settings = {};
    if (owner) settings = await getEmailSettings(actor.db);
    const visibleTeams = dataAccess.fullTeams
        ? teams.results || []
        : dataAccess.relatedTeams
            ? adminBootstrapTeamReferences(teams.results || [])
            : [];
    const visibleTeamRows = visibleTeams.map(function (row) {
        return Object.assign({}, row, {
            roster_changes_after_start: isRosterChangePermissionActive(row, Date.now()) ? 1 : 0
        });
    });
    return success({
        role: actor.user.role,
        scopes: scopes,
        permissions: serializePermissionCatalog(permissions),
        categories: dataAccess.competitionContext ? categories.results || [] : [],
        tournaments: dataAccess.competitionContext ? tournamentRows.results || [] : [],
        teams: visibleTeamRows,
        teamRegistrations: canView("registrations.view")
            ? (registrations.results || []).map(function (row) {
                return Object.assign({}, row, {
                    roster_changes_after_start: isRosterChangePermissionActive(row, Date.now()) ? 1 : 0
                });
            })
            : [],
        paymentRegistrations: dataAccess.paymentRegistrations ?
            paymentRegistrations.results || [] : [],
        players: dataAccess.players ? players.results || [] : [],
        fixtures: dataAccess.fixtures ? matches.results || [] : [],
        matches: dataAccess.fixtures ? matches.results || [] : [],
        matchEvents: dataAccess.matchEvents ? matchEvents.results || [] : [],
        tournamentGroups: dataAccess.tournamentGroups ?
            tournamentGroups.results || [] : [],
        tournamentStages: tournamentStages.results || [],
        tournamentStageParticipants: tournamentStageParticipants.results || [],
        payments: dataAccess.payments ? payments.results || [] : [],
        rules: canView("rules.view") ? rules.results || [] : [],
        media: owner ? media.results || [] : [],
        notifications: canView("notifications.view") ? notifications.results || [] : [],
        users: users.results || [],
        auditLogs: audit.results || [],
        settings: {
            brevoSenderEmail: settings.brevo_sender_email || "",
            brevoSenderName: settings.brevo_sender_name || ""
        },
        roles: [
            { name: "platform_owner", description: "Platform-wide administration." },
            { name: "tournament_admin", description: "Administration limited to assigned tournaments." },
            { name: "team_manager", description: "Operations limited to the manager's own teams." }
        ]
    });
}

async function reviewRegistration(request, actor, registrationId) {
    const body = await readJson(request);
    const status = text(body.status, "Review status", { required: true, max: 32 });
    const allowed = ["approved", "rejected", "correction_requested"];
    if (allowed.indexOf(status) === -1) {
        fail(400, "INVALID_STATUS", "Choose a valid registration review status.");
    }
    await requireUserPermission(actor, status === "approved"
        ? "registrations.approve"
        : status === "rejected" ? "registrations.reject" : "registrations.edit");
    const row = await actor.db.prepare(
        "SELECT r.id, r.public_reference, r.tournament_id, r.team_id, r.manager_uid, r.fee_amount, " +
        "r.status AS previous_status, r.review_note AS previous_review_note, " +
        "u.email, u.full_name, u.requested_account_type, u.status AS account_status, " +
        "u.email_verified, u.role, tm.name AS team_name, tm.logo_key, t.name AS tournament_name " +
        "FROM afc_team_registrations r JOIN afc_users u ON u.firebase_uid = r.manager_uid " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "WHERE r.id = ?"
    ).bind(registrationId).first();
    if (!row) fail(404, "NOT_FOUND", "The registration was not found.");
    await requireTournamentScope(actor, row.tournament_id);
    const confirmedPayments = await confirmedRegistrationPayments(actor.db, registrationId);
    const balanceDue = Math.max(0, Number(row.fee_amount) - confirmedPayments);
    const reviewNote = text(body.reviewNote, "Review note", { max: 2000 });
    const shouldActivateAccount = status === "approved" &&
        (row.role === null || row.role === "team_manager") &&
        row.requested_account_type === "team-manager" && row.account_status === "pending";
    const statements = [
        actor.db.prepare(
            "UPDATE afc_team_registrations SET status = ?, review_note = ?, reviewed_by = ?, " +
            "reviewed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, reviewNote, actor.user.firebase_uid, registrationId),
        shouldActivateAccount
            ? actor.db.prepare(
                "UPDATE afc_users SET role = 'team_manager', status = 'active', updated_at = CURRENT_TIMESTAMP " +
                "WHERE firebase_uid = ? AND (role IS NULL OR role = 'team_manager') AND status = 'pending'"
            ).bind(row.manager_uid)
            : actor.db.prepare("SELECT 1")
    ];
    if (status === "approved" && row.logo_key) {
        statements.push(actor.db.prepare(
            "UPDATE afc_media SET visibility = 'public' WHERE object_key = ? AND owner_uid = ?"
        ).bind(row.logo_key, row.manager_uid));
    }

    const notificationText = status === "approved"
        ? balanceDue > 0
            ? "Your team registration has been approved with an outstanding balance of KES " +
                Number(balanceDue).toLocaleString("en-KE") +
                ". You can now sign in and register your team players. Please pay the balance as soon as possible."
            : "Your team registration has been approved. You can now sign in and register your team players."
        : status === "rejected"
            ? "Your team registration was not approved. Contact the competitions office for details."
            : "The competitions office requested a correction to your team registration.";
    statements.push(actor.db.prepare(
        "INSERT INTO afc_notifications(id, user_uid, category, title, body, target_path) " +
        "VALUES(?, ?, 'Registration', ?, ?, ?)"
    ).bind(
        newId("NTF-"), row.manager_uid,
        status === "approved" ? "Registration approved" :
            status === "rejected" ? "Registration update" : "Correction requested",
        notificationText, "#/registrations"
    ));
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) VALUES(?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid,
        "review_team_registration", "team_registration", registrationId
    ));
    const reviewResults = await actor.db.batch(statements);
    const activationResult = reviewResults[1];
    if (shouldActivateAccount && (!activationResult || !activationResult.meta)) {
        throw new Error("The manager account activation could not be verified.");
    }
    const accountActivated = shouldActivateAccount && activationResult.meta.changes === 1;
    const emailStatus = status !== row.previous_status || reviewNote !== row.previous_review_note
        ? await sendTransactionalEmail(
            actor.env,
            actor.db,
            "team_registration_decision",
            "registration-decision:" + registrationId + ":" + newId("EVT-"),
            {
                uid: row.manager_uid,
                email: row.email,
                name: row.full_name,
                email_verified: row.email_verified
            },
            {
                recipientName: row.full_name,
                teamName: row.team_name,
                tournamentName: row.tournament_name,
                reference: row.public_reference,
                status: status,
                reviewNote: reviewNote,
                accountActivated: accountActivated,
                balanceDue: balanceDue > 0
                    ? "KES " + Number(balanceDue).toLocaleString("en-KE")
                    : ""
            }
        )
        : "not_sent";
    return success({
        id: registrationId, status: status, emailStatus: emailStatus,
        balanceDue: balanceDue, accountActivated: accountActivated
    });
}

export function isRegistrationFeeCleared(feeAmount, confirmedAmount) {
    const fee = Number(feeAmount);
    const confirmed = Number(confirmedAmount);
    return Number.isFinite(fee) && fee >= 0 &&
        Number.isFinite(confirmed) && confirmed >= fee;
}

async function confirmedRegistrationPayments(db, registrationId) {
    const payment = await db.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM afc_payments " +
        "WHERE registration_id = ? AND status IN ('confirmed', 'partial')"
    ).bind(registrationId).first();
    return Number(payment && payment.total || 0);
}

async function completeFullFeeRegistration(db, registrationId, actorUid) {
    const registration = await db.prepare(
        "SELECT r.id, r.manager_uid, r.fee_amount, tm.name AS team_name " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id WHERE r.id = ?"
    ).bind(registrationId).first();
    if (!registration) throw new Error("The registration could not be loaded after payment.");

    const paidTotal = "COALESCE((SELECT SUM(amount) FROM afc_payments " +
        "WHERE registration_id = afc_team_registrations.id " +
        "AND status IN ('confirmed', 'partial')), 0)";
    const hasConfirmedPayment = "EXISTS (SELECT 1 FROM afc_payments " +
        "WHERE registration_id = afc_team_registrations.id " +
        "AND status IN ('confirmed', 'partial'))";
    const registrationIsAutoApproved =
        "EXISTS (SELECT 1 FROM afc_team_registrations " +
        "WHERE id = ? AND status = 'approved' AND review_note = ?)";
    const results = await db.batch([
        db.prepare(
            "UPDATE afc_team_registrations SET status = 'approved', review_note = ?, reviewed_by = ?, " +
            "reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_review' " +
            "AND " + hasConfirmedPayment + " AND fee_amount <= " + paidTotal
        ).bind(AUTO_APPROVAL_REVIEW_NOTE, actorUid, registrationId),
        db.prepare(
            "INSERT OR IGNORE INTO afc_notifications(id, user_uid, category, title, body, target_path) " +
            "SELECT ?, manager_uid, 'Registration', 'Registration approved', ?, '#/squad' " +
            "FROM afc_team_registrations WHERE id = ? AND status = 'approved' AND review_note = ? " +
            " AND fee_amount <= " + paidTotal + " AND " + hasConfirmedPayment
        ).bind(
            "NTF-AUTO-APPROVED-" + registrationId,
            "Your team, " + registration.team_name +
                ", was automatically approved after the full registration fee was confirmed. " +
                "You can now sign in and register your team players.",
            registrationId, AUTO_APPROVAL_REVIEW_NOTE
        ),
        db.prepare(
            "INSERT OR IGNORE INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) " +
            "SELECT ?, ?, 'auto_approve_paid_team_registration', 'team_registration', ? " +
            "WHERE " + registrationIsAutoApproved
        ).bind(
            "AUD-AUTO-APPROVED-" + registrationId,
            actorUid, registrationId, registrationId, AUTO_APPROVAL_REVIEW_NOTE
        ),
        db.prepare(
            "UPDATE afc_users SET role = 'team_manager', status = 'active', updated_at = CURRENT_TIMESTAMP " +
            "WHERE firebase_uid = ? AND (role IS NULL OR role = 'team_manager') " +
            "AND requested_account_type = 'team-manager' " +
            "AND status = 'pending' AND EXISTS (" +
            "SELECT 1 FROM afc_team_registrations r WHERE r.id = ? AND r.manager_uid = afc_users.firebase_uid " +
            "AND r.status = 'approved' AND EXISTS (SELECT 1 FROM afc_payments p " +
            "WHERE p.registration_id = r.id AND p.status IN ('confirmed', 'partial')) " +
            "AND r.fee_amount <= COALESCE((" +
            "SELECT SUM(amount) FROM afc_payments WHERE registration_id = r.id " +
            "AND status IN ('confirmed', 'partial')), 0))"
        ).bind(registration.manager_uid, registrationId)
    ]);
    if (!results[0] || !results[0].meta || !results[3] || !results[3].meta) {
        throw new Error("The paid registration approval could not be verified.");
    }

    const current = await db.prepare(
        "SELECT status FROM afc_team_registrations WHERE id = ?"
    ).bind(registrationId).first();
    const confirmedAmount = await confirmedRegistrationPayments(db, registrationId);
    return {
        registrationApproved: Boolean(current && current.status === "approved"),
        registrationStatus: current ? current.status : "",
        accountActivated: results[3].meta.changes === 1,
        balanceDue: Math.max(0, Number(registration.fee_amount) - confirmedAmount)
    };
}

async function createAdminUser(request, actor) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a Platform Owner can create administrator accounts.");
    }
    const origin = normalizeOrigin(request.headers.get("Origin") || "");
    if (!origin) {
        fail(400, "SITE_ORIGIN_REQUIRED", "The administrator invitation link could not be created. Submit from the Admin website.");
    }
    const loginUrl = new URL("/login/", origin).toString();
    const body = await readJson(request);
    const identityToken = text(body.identityToken, "Firebase identity token", {
        required: true,
        max: 8192
    });
    const identity = await verifyFirebaseToken(identityToken);
    const email = validEmail(identity.email);
    const name = text(body.name, "Full name", { required: true, max: 120 });
    const phone = text(body.phone || "", "Phone number", { max: 32 });
    if (typeof identity.email !== "string" ||
        email !== validEmail(body.email) ||
        typeof identity.sub !== "string" ||
        identity.sub === actor.user.firebase_uid) {
        fail(400, "INVALID_FIREBASE_IDENTITY",
            "The Firebase account details did not match the submitted administrator.");
    }
    if (!Array.isArray(body.tournamentIds) ||
        body.tournamentIds.length < 1 ||
        body.tournamentIds.length > 50 ||
        body.tournamentIds.some(function (id) { return typeof id !== "string"; })) {
        fail(400, "INVALID_SCOPE", "Select at least one tournament for this administrator.");
    }
    const scopes = Array.from(new Set(body.tournamentIds.map(function (id) {
        return validId(id, "Tournament");
    })));
    for (const tournamentId of scopes) {
        const tournament = await actor.db.prepare(
            "SELECT 1 AS present FROM afc_tournaments WHERE id = ?"
        ).bind(tournamentId).first();
        if (!tournament) fail(400, "INVALID_SCOPE", "A selected tournament does not exist.");
    }
    const scopeRows = await prepareBound(
        actor.db,
        "SELECT name FROM afc_tournaments WHERE id IN (" +
            scopes.map(function () { return "?"; }).join(",") + ") ORDER BY name",
        scopes
    ).all();
    const tournamentAccess = (scopeRows.results || []).map(function (row) {
        return row.name;
    }).join(", ");

    const duplicate = await actor.db.prepare(
        "SELECT firebase_uid FROM afc_users WHERE firebase_uid = ? OR email = ? COLLATE NOCASE LIMIT 1"
    ).bind(identity.sub, email).first();
    if (duplicate) {
        fail(409, "ACCOUNT_ALREADY_EXISTS",
            "A championship account already exists for this Firebase account or email.");
    }
    const blockedEmail = await actor.db.prepare(
        "SELECT 1 AS blocked FROM afc_deleted_manager_email_blocks WHERE email_sha256 = ?"
    ).bind(await emailBlockHash(email)).first();
    if (blockedEmail) {
        fail(403, "ACCOUNT_PERMANENTLY_DELETED",
            "This email address is blocked from creating another championship account.");
    }

    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_users(firebase_uid, email, full_name, phone, role, status, email_verified) " +
            "VALUES(?, ?, ?, ?, 'tournament_admin', 'active', ?)"
        ).bind(identity.sub, email, name, phone || null, identity.email_verified === true ? 1 : 0)
    ];
    scopes.forEach(function (tournamentId) {
        statements.push(actor.db.prepare(
            "INSERT INTO afc_tournament_admin_scopes(user_uid, tournament_id, granted_by) " +
            "VALUES(?, ?, ?)"
        ).bind(identity.sub, tournamentId, actor.user.firebase_uid));
    });
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid, "create_admin_user", "user", identity.sub,
        JSON.stringify({
            email: email,
            name: name,
            role: "tournament_admin",
            tournamentIds: scopes
        })
    ));
    await actor.db.batch(statements);
    const emailStatus = await sendTransactionalEmail(
        actor.env,
        actor.db,
        "admin_tournament_admin_invited",
        "admin-tournament-admin:" + identity.sub,
        {
            uid: identity.sub,
            email: email,
            name: name,
            email_verified: identity.email_verified === true
        },
        {
            recipientName: name,
            role: "Tournament Admin",
            tournamentAccess: tournamentAccess,
            loginUrl: loginUrl
        }
    );
    return success({
        uid: identity.sub,
        email: email,
        name: name,
        role: "tournament_admin",
        status: "active",
        tournamentIds: scopes,
        emailStatus: emailStatus
    }, 201);
}

async function adminAssignRole(request, actor, uid) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can assign application roles.");
    }
    if (uid === actor.user.firebase_uid) {
        fail(409, "SELF_ROLE_CHANGE", "You cannot change your own role through this operation.");
    }
    const body = await readJson(request);
    const role = text(body.role, "Role", { required: true, max: 32 });
    const status = text(body.status || "active", "Account status", { max: 16 });
    if (["platform_owner", "tournament_admin", "team_manager"].indexOf(role) === -1 ||
        ["active", "disabled", "suspended", "pending"].indexOf(status) === -1) {
        fail(400, "INVALID_ROLE", "The role or account status is invalid.");
    }
    let scopes = [];
    if (role === "tournament_admin") {
        if (!Array.isArray(body.tournamentIds)) {
            fail(400, "INVALID_SCOPE", "Select at least one tournament for a tournament administrator.");
        }
        if (body.tournamentIds.length > 50 ||
            body.tournamentIds.some(function (id) { return typeof id !== "string"; })) {
            fail(400, "INVALID_SCOPE", "The tournament scope is invalid.");
        }
        scopes = Array.from(new Set(body.tournamentIds.map(function (id) {
            return validId(id, "Tournament");
        })));
        for (const tournamentId of scopes) {
            const exists = await actor.db.prepare(
                "SELECT 1 AS present FROM afc_tournaments WHERE id = ?"
            ).bind(tournamentId).first();
            if (!exists) fail(400, "INVALID_SCOPE", "A selected tournament does not exist.");
        }
    }
    const existingUser = await actor.db.prepare(
        "SELECT firebase_uid, email, full_name, role, status, email_verified " +
        "FROM afc_users WHERE firebase_uid = ?"
    ).bind(uid).first();
    if (!existingUser) fail(404, "NOT_FOUND", "The account was not found.");
    const existingScopes = await actor.db.prepare(
        "SELECT tournament_id FROM afc_tournament_admin_scopes WHERE user_uid = ?"
    ).bind(uid).all();
    const previousScopeIds = (existingScopes.results || []).map(function (row) {
        return row.tournament_id;
    }).sort();
    const nextScopeIds = scopes.slice().sort();
    const accessChanged = existingUser.role !== role || existingUser.status !== status ||
        JSON.stringify(previousScopeIds) !== JSON.stringify(nextScopeIds);
    const statements = [
        actor.db.prepare(
            "UPDATE afc_users SET role = ?, status = ?, updated_at = CURRENT_TIMESTAMP " +
            "WHERE firebase_uid = ?"
        ).bind(role, status, uid),
        actor.db.prepare("DELETE FROM afc_tournament_admin_scopes WHERE user_uid = ?").bind(uid)
    ];
    for (const tournamentId of scopes) {
        statements.push(actor.db.prepare(
            "INSERT INTO afc_tournament_admin_scopes(user_uid, tournament_id, granted_by) VALUES(?, ?, ?)"
        ).bind(uid, tournamentId, actor.user.firebase_uid));
    }
    await actor.db.batch(statements);
    await logAudit(actor.db, actor.user.firebase_uid, "assign_user_role", "user", uid);
    let tournamentAccess = "All tournaments";
    if (role === "tournament_admin") {
        let names = { results: [] };
        if (scopes.length) {
            names = await prepareBound(
                actor.db,
                "SELECT name FROM afc_tournaments WHERE id IN (" +
                scopes.map(function () { return "?"; }).join(",") + ") ORDER BY name",
                scopes
            ).all();
        }
        tournamentAccess = (names.results || []).map(function (row) { return row.name; }).join(", ") ||
            "No tournaments assigned";
    } else if (role === "team_manager") {
        tournamentAccess = "Team-manager tools for your registered teams";
    }
    const emailStatus = accessChanged
        ? await sendTransactionalEmail(
            actor.env,
            actor.db,
            "account_access_updated",
            "account-access:" + uid + ":" + newId("EVT-"),
            {
                uid: uid,
                email: existingUser.email,
                name: existingUser.full_name,
                email_verified: existingUser.email_verified
            },
            {
                recipientName: existingUser.full_name,
                role: role === "platform_owner" ? "Platform owner" :
                    role === "tournament_admin" ? "Tournament administrator" : "Team manager",
                status: status,
                tournamentAccess: tournamentAccess
            }
        )
        : "not_sent";
    return success({ uid: uid, role: role, status: status, emailStatus: emailStatus });
}

async function createPayment(request, actor) {
    const body = await readJson(request);
    const registrationId = validId(body.registrationId, "Registration");
    const amount = integer(body.amount, "Payment amount", 1, 100000000);
    const method = text(body.method, "Payment method", { required: true, max: 40 });
    if (["M-Pesa", "Bank Transfer", "Cash", "Cheque"].indexOf(method) === -1) {
        fail(400, "INVALID_PAYMENT_METHOD", "Choose a supported payment method.");
    }
    const idempotencyKey = String(request.headers.get("Idempotency-Key") || "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
        fail(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
    }
    const reviewNote = text(body.reviewNote, "Review note", { max: 1000 });
    const priorPayment = await actor.db.prepare(
        "SELECT p.id, p.reference, p.status, p.amount, p.registration_id, r.tournament_id " +
        "FROM afc_payments p JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "WHERE p.recorded_by = ? AND p.idempotency_key = ?"
    ).bind(actor.user.firebase_uid, idempotencyKey).first();
    if (priorPayment) {
        await requireTournamentScope(actor, priorPayment.tournament_id);
        const paidRegistration = await completeFullFeeRegistration(
            actor.db, priorPayment.registration_id, actor.user.firebase_uid
        );
        return success({
            id: priorPayment.id, reference: priorPayment.reference, status: priorPayment.status,
            amount: priorPayment.amount, balanceDue: paidRegistration.balanceDue,
            accountActivated: paidRegistration.accountActivated,
            registrationApproved: paidRegistration.registrationApproved
        }, 200);
    }
    const registration = await actor.db.prepare(
        "SELECT r.id, r.public_reference, r.team_id, r.tournament_id, r.fee_amount, r.manager_uid, " +
        "tm.name AS team_name, t.name AS tournament_name, u.email, u.full_name, u.email_verified " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "JOIN afc_users u ON u.firebase_uid = r.manager_uid WHERE r.id = ?"
    ).bind(registrationId).first();
    if (!registration) fail(404, "NOT_FOUND", "The registration was not found.");
    await requireTournamentScope(actor, registration.tournament_id);
    const reference = "ANG-PAY-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    const id = newId("PAY-");
    const receivedTotal = "COALESCE((SELECT SUM(received.amount) FROM afc_payments received " +
        "WHERE received.registration_id = r.id AND received.status IN ('confirmed', 'partial')), 0)";
    const paymentResults = await actor.db.batch([
        actor.db.prepare(
            "INSERT INTO afc_payments(id, reference, registration_id, team_id, tournament_id, amount, " +
            "method, status, recorded_by, idempotency_key, review_note) " +
            "SELECT ?, ?, r.id, r.team_id, r.tournament_id, ?, ?, " +
            "CASE WHEN " + receivedTotal + " + ? >= r.fee_amount THEN 'confirmed' ELSE 'partial' END, " +
            "?, ?, ? FROM afc_team_registrations r WHERE r.id = ? " +
            "AND ? <= r.fee_amount - " + receivedTotal
        ).bind(
            id, reference, amount, method, amount, actor.user.firebase_uid,
            idempotencyKey, reviewNote, registrationId, amount
        )
    ]);
    const paymentInsertResult = paymentResults[0];
    if (!paymentInsertResult || !paymentInsertResult.meta) {
        throw new Error("Payment recording could not be verified.");
    }
    if (paymentInsertResult.meta.changes !== 1) {
        fail(409, "PAYMENT_EXCEEDS_BALANCE",
            "This payment is larger than the remaining registration-fee balance.");
    }
    const insertedPayment = await actor.db.prepare(
        "SELECT id, reference, status, amount FROM afc_payments WHERE id = ?"
    ).bind(id).first();
    if (!insertedPayment) throw new Error("The recorded payment could not be verified.");
    const receipt = await loadPaymentReceiptData(actor.db, id);
    if (!receipt) throw new Error("The payment receipt could not be verified.");
    await logAudit(actor.db, actor.user.firebase_uid, "record_payment", "payment", id);
    const paidRegistration = await completeFullFeeRegistration(
        actor.db, registrationId, actor.user.firebase_uid
    );
    const balanceDue = paidRegistration.balanceDue;
    const finalStatus = insertedPayment.status;
    const emailStatus = await sendTransactionalEmail(
        actor.env,
        actor.db,
        "payment_status",
        "payment-recorded:" + id,
        {
            uid: registration.manager_uid,
            email: registration.email,
            name: registration.full_name,
            email_verified: registration.email_verified
        },
        {
            recipientName: registration.full_name,
            teamName: registration.team_name,
            tournamentName: registration.tournament_name,
            registrationReference: registration.public_reference,
            paymentReference: reference,
            amount: "KES " + Number(amount).toLocaleString("en-KE"),
            method: method,
            status: finalStatus,
            accountActivated: paidRegistration.accountActivated,
            registrationApproved: paidRegistration.registrationApproved,
            registrationStatus: paidRegistration.registrationStatus,
            balanceDue: balanceDue > 0
                ? "KES " + Number(balanceDue).toLocaleString("en-KE")
                : "",
            reviewNote: reviewNote,
            paymentReceipt: receipt
        }
    );
    const ownerEmailStatus = await notifyPlatformOwnersByEmail(
        actor.env,
        actor.db,
        "owner_registration_payment_received",
        "owner-registration-payment:" + id,
        {
            teamName: registration.team_name,
            tournamentName: registration.tournament_name,
            registrationReference: registration.public_reference,
            paymentReference: reference,
            amount: "KES " + Number(amount).toLocaleString("en-KE"),
            status: finalStatus === "confirmed" ? "Confirmed" : "Partially confirmed",
            balanceDue: balanceDue > 0
                ? "KES " + Number(balanceDue).toLocaleString("en-KE")
                : "KES 0",
            registrationStatus: paidRegistration.registrationStatus
        }
    );
    return success({
        id: id, reference: reference, status: finalStatus, amount: amount,
        balanceDue: balanceDue, emailStatus: emailStatus,
        ownerEmailStatus: ownerEmailStatus,
        accountActivated: paidRegistration.accountActivated,
        registrationApproved: paidRegistration.registrationApproved
    }, 201);
}

async function reviewPayment(request, actor, paymentId) {
    const body = await readJson(request);
    const decision = text(body.status, "Payment decision", { required: true, max: 16 }).toLowerCase();
    if (decision !== "confirmed" && decision !== "rejected") {
        fail(400, "INVALID_STATUS", "Choose confirmed or rejected.");
    }
    const reviewNote = text(body.reviewNote || "", "Review note", { max: 1000 });
    const payment = await actor.db.prepare(
        "SELECT p.id, p.reference, p.registration_id, p.tournament_id, p.amount, p.status, " +
        "r.public_reference, r.manager_uid, r.fee_amount, tm.name AS team_name, t.name AS tournament_name, " +
        "u.email, u.full_name, u.email_verified " +
        "FROM afc_payments p JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = p.tournament_id " +
        "JOIN afc_users u ON u.firebase_uid = r.manager_uid WHERE p.id = ?"
    ).bind(paymentId).first();
    if (!payment) fail(404, "NOT_FOUND", "The payment was not found.");
    await requireTournamentScope(actor, payment.tournament_id);
    if (payment.status !== "pending") {
        if (payment.status === decision || (decision === "confirmed" && payment.status === "partial")) {
            const paidRegistration = await completeFullFeeRegistration(
                actor.db, payment.registration_id, actor.user.firebase_uid
            );
            return success({
                id: payment.id, status: payment.status,
                balanceDue: paidRegistration.balanceDue,
                accountActivated: paidRegistration.accountActivated,
                registrationApproved: paidRegistration.registrationApproved
            });
        }
        fail(409, "PAYMENT_ALREADY_REVIEWED", "This payment has already been reviewed.");
    }

    let finalStatus = "rejected";
    if (decision === "confirmed") {
        const confirmedTotal = "COALESCE((SELECT SUM(confirmed.amount) FROM afc_payments confirmed " +
            "WHERE confirmed.registration_id = afc_payments.registration_id " +
            "AND confirmed.status IN ('confirmed', 'partial')), 0)";
        const feeAmount = "(SELECT registration.fee_amount FROM afc_team_registrations registration " +
            "WHERE registration.id = afc_payments.registration_id)";
        const result = await actor.db.prepare(
            "UPDATE afc_payments SET status = CASE WHEN amount + " + confirmedTotal + " >= " + feeAmount +
            " THEN 'confirmed' ELSE 'partial' END, review_note = ? " +
            "WHERE id = ? AND status = 'pending' AND amount + " + confirmedTotal + " <= " + feeAmount
        ).bind(reviewNote, paymentId).run();
        if (!result.meta || result.meta.changes !== 1) {
            const current = await actor.db.prepare("SELECT status FROM afc_payments WHERE id = ?")
                .bind(paymentId).first();
            if (current && (current.status === "confirmed" || current.status === "partial")) {
                const paidRegistration = await completeFullFeeRegistration(
                    actor.db, payment.registration_id, actor.user.firebase_uid
                );
                return success({
                    id: paymentId, status: current.status,
                    balanceDue: paidRegistration.balanceDue,
                    accountActivated: paidRegistration.accountActivated,
                    registrationApproved: paidRegistration.registrationApproved
                });
            }
            if (current && current.status === "pending") {
                fail(409, "PAYMENT_EXCEEDS_BALANCE", "Confirming this payment would exceed the entry fee.");
            }
            fail(409, "PAYMENT_ALREADY_REVIEWED", "This payment has already been reviewed.");
        }
        const confirmed = await actor.db.prepare("SELECT status FROM afc_payments WHERE id = ?")
            .bind(paymentId).first();
        finalStatus = confirmed.status;
    } else {
        const result = await actor.db.prepare(
            "UPDATE afc_payments SET status = 'rejected', review_note = ? " +
            "WHERE id = ? AND status = 'pending'"
        ).bind(reviewNote, paymentId).run();
        if (!result.meta || result.meta.changes !== 1) {
            const current = await actor.db.prepare("SELECT status FROM afc_payments WHERE id = ?")
                .bind(paymentId).first();
            if (current && current.status === "rejected") {
                return success({ id: paymentId, status: current.status });
            }
            fail(409, "PAYMENT_ALREADY_REVIEWED", "This payment has already been reviewed.");
        }
    }
    await logAudit(actor.db, actor.user.firebase_uid, "review_payment", "payment", paymentId);
    const paidRegistration = await completeFullFeeRegistration(
        actor.db, payment.registration_id, actor.user.firebase_uid
    );
    const balanceDue = paidRegistration.balanceDue;
    const receipt = finalStatus === "rejected"
        ? null
        : await loadPaymentReceiptData(actor.db, payment.id);
    const emailStatus = await sendTransactionalEmail(
        actor.env,
        actor.db,
        "payment_status",
        "payment-status:" + payment.id + ":" + newId("EVT-"),
        {
            uid: payment.manager_uid,
            email: payment.email,
            name: payment.full_name,
            email_verified: payment.email_verified
        },
        {
            recipientName: payment.full_name,
            teamName: payment.team_name,
            tournamentName: payment.tournament_name,
            registrationReference: payment.public_reference,
            paymentReference: payment.reference,
            amount: "KES " + Number(payment.amount).toLocaleString("en-KE"),
            status: finalStatus,
            accountActivated: paidRegistration.accountActivated,
            registrationApproved: paidRegistration.registrationApproved,
            registrationStatus: paidRegistration.registrationStatus,
            balanceDue: balanceDue > 0
                ? "KES " + Number(balanceDue).toLocaleString("en-KE")
                : "",
            reviewNote: reviewNote,
            paymentReceipt: receipt
        }
    );
    const ownerEmailStatus = finalStatus === "rejected"
        ? "not_sent"
        : await notifyPlatformOwnersByEmail(
            actor.env,
            actor.db,
            "owner_registration_payment_received",
            "owner-registration-payment:" + payment.id,
            {
                teamName: payment.team_name,
                tournamentName: payment.tournament_name,
                registrationReference: payment.public_reference,
                paymentReference: payment.reference,
                amount: "KES " + Number(payment.amount).toLocaleString("en-KE"),
                status: finalStatus === "confirmed" ? "Confirmed" : "Partially confirmed",
                balanceDue: balanceDue > 0
                    ? "KES " + Number(balanceDue).toLocaleString("en-KE")
                    : "KES 0",
                registrationStatus: paidRegistration.registrationStatus
            }
        );
    return success({
        id: paymentId, status: finalStatus, balanceDue: balanceDue,
        emailStatus: emailStatus,
        ownerEmailStatus: ownerEmailStatus,
        accountActivated: paidRegistration.accountActivated,
        registrationApproved: paidRegistration.registrationApproved
    });
}

function validDate(value, field, required) {
    if (value === undefined || value === null || value === "") {
        if (required) fail(400, "INVALID_INPUT", field + " is required.");
        return null;
    }
    const date = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(new Date(date + "T00:00:00Z").getTime()) ||
        new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
        fail(400, "INVALID_INPUT", field + " must be a valid date.");
    }
    return date;
}

function categoryAgeBounds(label) {
    const values = String(label || "").match(/\d+/g) || [];
    const minimum = values.length ? Number(values[0]) : null;
    const maximum = /above|over|older/i.test(String(label || ""))
        ? null
        : values.length > 1 ? Number(values[1]) : null;
    if (maximum !== null && minimum !== null && maximum < minimum) {
        fail(400, "INVALID_INPUT", "The age group bounds are invalid.");
    }
    return { minimum: minimum, maximum: maximum };
}

async function uniqueCategoryCode(db, name, exceptId) {
    const words = String(name).toUpperCase().match(/[A-Z0-9]+/g) || [];
    const base = words.map(function (word) { return word.slice(0, 3); }).join("").slice(0, 8) || "CAT";
    for (let suffix = 0; suffix < 100; suffix += 1) {
        const code = suffix ? (base.slice(0, 5) + String(suffix).padStart(3, "0")) : base;
        const row = await db.prepare(
            "SELECT id FROM afc_categories WHERE code = ?"
        ).bind(code).first();
        if (!row || row.id === exceptId) return code;
    }
    fail(409, "CATEGORY_CODE_CONFLICT", "A unique category code could not be generated.");
}

async function saveCategory(request, actor, categoryId) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can manage categories.");
    }
    const body = await readJson(request);
    const name = text(body.name, "Category name", { required: true, max: 100 });
    const ageGroup = text(body.ageGroup, "Age group", { required: true, max: 100 });
    const gender = text(body.gender, "Classification", { required: true, max: 16 });
    if (["Men", "Women", "Boys", "Girls", "Mixed"].indexOf(gender) === -1) {
        fail(400, "INVALID_INPUT", "The classification is invalid.");
    }
    const status = text(body.status || "active", "Category status", { max: 16 }).toLowerCase();
    if (["active", "draft", "archived"].indexOf(status) === -1) {
        fail(400, "INVALID_INPUT", "The category status is invalid.");
    }
    const age = categoryAgeBounds(ageGroup);
    const code = await uniqueCategoryCode(actor.db, name, categoryId || null);
    const publicId = "CAT-" + slugify(name).toUpperCase().slice(0, 40);
    const duplicatePublicId = await actor.db.prepare(
        "SELECT id FROM afc_categories WHERE public_id = ?"
    ).bind(publicId).first();
    if (duplicatePublicId && duplicatePublicId.id !== categoryId) {
        fail(409, "CATEGORY_REFERENCE_CONFLICT", "A category with this public reference already exists.");
    }
    const description = text(body.description || "", "Description", { max: 4000 });
    const guardianConsent = bool(body.guardianConsent) ? 1 : 0;
    if (categoryId) {
        const existing = await actor.db.prepare("SELECT id FROM afc_categories WHERE id = ?")
            .bind(categoryId).first();
        if (!existing) fail(404, "NOT_FOUND", "The category was not found.");
        await actor.db.prepare(
            "UPDATE afc_categories SET public_id = ?, name = ?, code = ?, age_group = ?, age_min = ?, " +
            "age_max = ?, gender = ?, guardian_consent_required = ?, status = ?, description = ?, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(
            publicId, name, code, ageGroup, age.minimum, age.maximum, gender,
            guardianConsent, status, description, categoryId
        ).run();
        await logAudit(actor.db, actor.user.firebase_uid, "update_category", "category", categoryId);
        return success({ id: categoryId, publicId: publicId, code: code });
    }

    const id = newId("CAT-");
    await actor.db.prepare(
        "INSERT INTO afc_categories(id, public_id, name, code, age_group, age_min, age_max, gender, " +
        "guardian_consent_required, status, description) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
        id, publicId, name, code, ageGroup, age.minimum, age.maximum,
        gender, guardianConsent, status, description
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "create_category", "category", id);
    return success({ id: id, publicId: publicId, code: code }, 201);
}

function deriveTournamentStatus(startDate, endDate, requestedStatus) {
    const requested = String(requestedStatus || "").toLowerCase();
    if (requested === "draft" || requested === "archived") return requested;
    if (requested === "completed") return "completed";
    const today = eatDateKey();
    if (today < startDate) return "upcoming";
    if (endDate && today > endDate) return "completed";
    return "active";
}

async function validBanner(db, ownerUid, value, existingBanner) {
    const banner = text(value || "", "Banner", { max: 240 });
    if (!banner) return "";
    const projectPath = banner.indexOf("/images/") === 0 ? banner.slice(1) : banner;
    if (projectPath.indexOf("images/") === 0) {
        let filename;
        try {
            filename = decodeURIComponent(projectPath.slice("images/".length));
        } catch (_error) {
            fail(400, "INVALID_INPUT", "Choose a supported project image or uploaded image.");
        }
        if (/^[A-Za-z0-9 _().-]{1,160}\.(png|jpe?g|webp)$/i.test(filename) &&
            filename.indexOf("..") === -1 && filename.indexOf("/") === -1) {
            return "/images/" + encodeURIComponent(filename);
        }
    }
    if (/^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(banner)) {
        const uploaded = await db.prepare(
            "SELECT object_key FROM afc_media WHERE object_key = ? AND owner_uid = ?"
        ).bind(banner, ownerUid).first();
        if (uploaded || banner === existingBanner) return banner;
    }
    fail(400, "INVALID_INPUT", "Choose a supported project image or uploaded image.");
}

async function saveTournament(request, actor, tournamentId) {
    const body = await readJson(request);
    let existingTournament = null;
    if (tournamentId) {
        await requireTournamentScope(actor, tournamentId);
        existingTournament = await actor.db.prepare(
            "SELECT id, banner, prize_information FROM afc_tournaments WHERE id = ?"
        ).bind(tournamentId).first();
        if (!existingTournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    }
    const name = text(body.name, "Tournament name", { required: true, max: 140 });
    const season = integer(body.season, "Season", 1900, 2200);
    const categoryId = validId(body.categoryId, "Category");
    const category = await actor.db.prepare(
        "SELECT id FROM afc_categories WHERE id = ? AND status = 'active'"
    ).bind(categoryId).first();
    if (!category) fail(400, "INVALID_CATEGORY", "Choose an active category.");
    const startDate = validDate(body.startDate, "Start date", true);
    const endDate = validDate(body.endDate, "End date", false);
    const registrationOpens = validDate(body.registrationOpens, "Registration opens", true);
    const registrationCloses = validDate(body.registrationCloses, "Registration closes", false);
    if (endDate && endDate < startDate) fail(400, "INVALID_INPUT", "The end date must not be before the start date.");
    if (registrationCloses && registrationCloses < registrationOpens) {
        fail(400, "INVALID_INPUT", "The registration closing date must not be before its opening date.");
    }
    const status = deriveTournamentStatus(startDate, endDate, body.status);
    const format = text(body.format, "Format", { required: true, max: 100 });
    const venue = text(body.venue, "Venue", { required: true, max: 120 });
    const location = text(body.location || "", "Location", { max: 160 });
    const teamLimit = body.teamCap === "" || body.teamCap === null || body.teamCap === undefined
        ? null : integer(body.teamCap, "Team capacity", 2, 256);
    const registrationFee = integer(body.registrationFee, "Registration fee", 0, 100000000);
    const banner = await validBanner(
        actor.db, actor.user.firebase_uid, body.banner,
        existingTournament ? existingTournament.banner : ""
    );
    const overview = text(body.overview || "", "Overview", { max: 5000 });
    const prizeInformation = text(
        body.prizeInformation === undefined && existingTournament
            ? existingTournament.prize_information || ""
            : body.prizeInformation || "",
        "Prize information",
        { max: 5000 }
    );
    const slug = slugify(name + "-" + season);
    const publicId = "TRN-" + season + "-" + slugify(name).slice(0, 28).toUpperCase();
    const featured = body.featured === undefined ? 1 : (bool(body.featured) ? 1 : 0);
    const duplicateSlug = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE slug = ?"
    ).bind(slug).first();
    if (duplicateSlug && duplicateSlug.id !== tournamentId) {
        fail(409, "TOURNAMENT_SLUG_CONFLICT", "A tournament with this name and season already exists.");
    }
    const duplicatePublicId = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE public_id = ?"
    ).bind(publicId).first();
    if (duplicatePublicId && duplicatePublicId.id !== tournamentId) {
        fail(409, "TOURNAMENT_REFERENCE_CONFLICT", "A tournament with this public reference already exists.");
    }

    if (tournamentId) {
        await actor.db.prepare(
            "UPDATE afc_tournaments SET public_id = ?, slug = ?, name = ?, season = ?, category_id = ?, " +
            "format = ?, status = ?, venue = ?, location = ?, start_date = ?, end_date = ?, " +
            "registration_opens = ?, registration_closes = ?, team_limit = ?, registration_fee = ?, " +
            "banner = ?, featured = ?, overview = ?, prize_information = ?, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(
            publicId, slug, name, season, categoryId, format, status, venue, location, startDate,
            endDate, registrationOpens, registrationCloses, teamLimit, registrationFee,
            banner, featured, overview, prizeInformation, tournamentId
        ).run();
        if (existingTournament.banner && existingTournament.banner !== banner) {
            await setAdminMediaVisibility(actor.db, existingTournament.banner, false);
        }
        await setAdminMediaVisibility(actor.db, banner, true);
        await logAudit(actor.db, actor.user.firebase_uid, "update_tournament", "tournament", tournamentId);
        return success({ id: tournamentId, publicId: publicId, slug: slug, status: status });
    }

    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can create tournaments.");
    }
    const id = newId("TRN-");
    await actor.db.prepare(
        "INSERT INTO afc_tournaments(id, public_id, slug, name, season, category_id, format, status, venue, " +
        "location, start_date, end_date, registration_opens, registration_closes, team_limit, " +
        "registration_fee, banner, featured, standings_available, overview, prize_information, created_by) " +
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
    ).bind(
        id, publicId, slug, name, season, categoryId, format, status, venue, location, startDate,
        endDate, registrationOpens, registrationCloses, teamLimit, registrationFee, banner,
        featured, overview, prizeInformation, actor.user.firebase_uid
    ).run();
    await setAdminMediaVisibility(actor.db, banner, true);
    await logAudit(actor.db, actor.user.firebase_uid, "create_tournament", "tournament", id);
    return success({ id: id, publicId: publicId, slug: slug, status: status }, 201);
}

async function archiveAdminResource(actor, resource, id) {
    const allowed = {
        categories: { table: "afc_categories", status: "archived", ownerOnly: true },
        tournaments: { table: "afc_tournaments", status: "archived", ownerOnly: true },
        rules: { table: "afc_rules", status: "draft", ownerOnly: false },
        announcements: { table: "afc_news_articles", status: "archived", ownerOnly: true }
    };
    const config = allowed[resource];
    if (!config) fail(405, "METHOD_NOT_ALLOWED", "This record cannot be deleted.");
    if (config.ownerOnly && actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can archive this record.");
    }
    if (resource === "rules" && actor.user.role !== "platform_owner") {
        const rule = await actor.db.prepare(
            "SELECT category_id FROM afc_rules WHERE id = ?"
        ).bind(id).first();
        if (!rule) fail(404, "NOT_FOUND", "The record was not found.");
        const scope = await actor.db.prepare(
            "SELECT 1 AS permitted FROM afc_tournaments t " +
            "JOIN afc_tournament_admin_scopes s ON s.tournament_id = t.id " +
            "WHERE s.user_uid = ? AND t.category_id = ? LIMIT 1"
        ).bind(actor.user.firebase_uid, rule.category_id).first();
        if (!scope) fail(403, "FORBIDDEN", "You are not permitted to archive these rules.");
    }
    const result = await actor.db.prepare(
        "UPDATE " + config.table + " SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(config.status, id).run();
    if (!result.meta || result.meta.changes !== 1) fail(404, "NOT_FOUND", "The record was not found.");
    await logAudit(actor.db, actor.user.firebase_uid, "archive_" + resource, resource, id);
    return success({ id: id, status: config.status });
}

async function archiveAdminTeam(actor, id) {
    const result = await actor.db.prepare(
        "UPDATE afc_teams SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), " +
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(id).run();
    if (!result.meta || result.meta.changes !== 1) fail(404, "NOT_FOUND", "The team was not found.");
    await logAudit(actor.db, actor.user.firebase_uid, "archive_team", "team", id);
    return success({ id: id, archived: true });
}

function validKickoff(value) {
    const kickoff = text(value, "Kickoff date and time", { required: true, max: 40 });
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(kickoff);
    const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(kickoff);
    const normalized = !hasTimezone && localDateTime
        ? (kickoff.length === 16 ? kickoff + ":00+03:00" : kickoff + "+03:00")
        : kickoff;
    if (!Number.isFinite(new Date(normalized).getTime())) {
        fail(400, "INVALID_INPUT", "Kickoff must be a valid date and time.");
    }
    return normalized;
}

export function publishedStageFixtureEditPolicy(existing, body) {
    if (existing.status === "live" || existing.status === "completed" ||
        existing.home_score !== null && existing.home_score !== undefined ||
        existing.away_score !== null && existing.away_score !== undefined) {
        return "fixture_started";
    }
    const fields = [
        ["tournamentId", existing.tournament_id],
        ["categoryId", existing.category_id],
        ["round", existing.round],
        ["group", existing.group_name || ""],
        ["homeId", existing.home_team_id],
        ["awayId", existing.away_team_id]
    ];
    for (const field of fields) {
        const key = field[0];
        if (Object.prototype.hasOwnProperty.call(body, key) &&
            String(body[key] === null || body[key] === undefined ? "" : body[key]).trim() !==
                String(field[1] === null || field[1] === undefined ? "" : field[1]).trim()) {
            return "protected_fields";
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, "status") &&
        String(body.status || "").trim().toLowerCase() !== existing.status) {
        return "protected_fields";
    }
    if (Object.prototype.hasOwnProperty.call(body, "stage") &&
        String(body.stage || "").trim().toLowerCase() !== existing.stage) {
        return "protected_fields";
    }
    if (Object.prototype.hasOwnProperty.call(body, "stageId") &&
        String(body.stageId || "").trim() !== existing.stage_id) {
        return "protected_fields";
    }
    if (Object.prototype.hasOwnProperty.call(body, "groupId") &&
        String(body.groupId || "").trim() !== String(existing.group_id || "")) {
        return "protected_fields";
    }
    return null;
}

async function saveFixture(request, actor, fixtureId) {
    const body = await readJson(request);
    let existing = null;
    if (fixtureId) {
        existing = await actor.db.prepare(
            "SELECT m.tournament_id, m.category_id, m.group_id, g.name AS group_name, " +
            "m.stage_id, m.stage, m.round, m.home_team_id, m.away_team_id, m.kickoff, " +
            "m.venue, m.status, m.note, m.published, m.home_score, m.away_score " +
            "FROM afc_matches m LEFT JOIN afc_tournament_groups g ON g.id = m.group_id " +
            "WHERE m.id = ?"
        ).bind(fixtureId).first();
        if (!existing) fail(404, "NOT_FOUND", "The fixture was not found.");
        await requireTournamentScope(actor, existing.tournament_id);
    }
    const tournamentId = validId(body.tournamentId, "Tournament");
    const categoryId = validId(body.categoryId, "Category");
    if (existing && existing.stage_id && Number(existing.published) === 1) {
        const policy = publishedStageFixtureEditPolicy(existing, body);
        if (policy === "fixture_started") {
            fail(409, "PUBLISHED_STAGE_FIXTURE_STARTED",
                "A live or completed stage fixture cannot be rescheduled.");
        }
        if (policy === "protected_fields") {
            fail(409, "PUBLISHED_STAGE_FIXTURE_LOCKED",
                "Only the kickoff and venue can be edited on a published stage fixture. Its approved stage, pairing, round, group, and status are locked.");
        }
        const kickoff = validKickoff(body.kickoff);
        const venue = text(body.venue, "Venue", { required: true, max: 160 });
        if (existing.kickoff !== kickoff) {
            await requireUserPermission(actor, "fixtures.reschedule");
        }
        const result = await actor.db.prepare(
            "UPDATE afc_matches SET kickoff = ?, venue = ?, updated_by = ?, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stage_id = ? AND published = 1 " +
            "AND kickoff = ? AND venue = ? AND status = ? AND status NOT IN ('live', 'completed') " +
            "AND home_score IS ? AND away_score IS ? AND home_score IS NULL AND away_score IS NULL"
        ).bind(
            kickoff, venue, actor.user.firebase_uid, fixtureId, existing.stage_id,
            existing.kickoff, existing.venue, existing.status, existing.home_score, existing.away_score
        ).run();
        if (!result.meta || result.meta.changes !== 1) {
            fail(409, "FIXTURE_CHANGED_CONCURRENTLY",
                "The fixture changed while it was being saved. Reload it and try again.");
        }
        await logAudit(actor.db, actor.user.firebase_uid, "update_fixture_schedule", "match", fixtureId);
        return success({ id: fixtureId, status: existing.status });
    }
    await requireTournamentScope(actor, tournamentId);
    const tournament = await actor.db.prepare(
        "SELECT id, category_id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    if (categoryId !== tournament.category_id) {
        fail(400, "INVALID_CATEGORY", "The fixture category must match the tournament category.");
    }
    const stageId = body.stageId ? validId(body.stageId, "Tournament stage") : null;
    const round = text(body.round, "Round or matchday", { required: true, max: 80 });
    const groupName = text(body.group || "", "Group", { max: 80 });
    let stage = text(body.stage || (groupName ? "group" : "knockout"), "Fixture stage",
        { required: true, max: 32 }).toLowerCase();
    let stageRecord = null;
    if (stageId) {
        stageRecord = await actor.db.prepare(
            "SELECT id, stage_type, status, pairing_json FROM afc_tournament_stages " +
            "WHERE id = ? AND tournament_id = ?"
        ).bind(stageId, tournamentId).first();
        if (!stageRecord) fail(404, "STAGE_NOT_FOUND", "The tournament stage was not found.");
        if (["approved", "published", "in_progress"].indexOf(stageRecord.status) === -1) {
            fail(409, "STAGE_NOT_READY", "Approve the current stage before creating its fixtures.");
        }
        stage = stageRecord.stage_type;
    }
    if (["group", "league", "preliminary", "round-of-16", "quarter-finals",
        "semi-finals", "third-place-playoff", "final", "knockout"]
        .indexOf(stage) === -1 || (groupName && stage !== "group" && stage !== "league") ||
        (!groupName && stage === "group")) {
        fail(400, "INVALID_STAGE", "Choose a valid fixture stage and group combination.");
    }
    let groupId = body.groupId ? validId(body.groupId, "Group") : null;
    if (groupName) {
        const group = groupId
            ? await actor.db.prepare(
                "SELECT id, name FROM afc_tournament_groups WHERE tournament_id = ? AND id = ?"
            ).bind(tournamentId, groupId).first()
            : await actor.db.prepare(
                "SELECT id, name FROM afc_tournament_groups WHERE tournament_id = ? AND name = ?"
            ).bind(tournamentId, groupName).first();
        if (!group) fail(400, "INVALID_GROUP", "Choose a group that exists in this tournament.");
        if (group.name !== groupName) {
            fail(400, "INVALID_GROUP", "The selected group name and reference do not match.");
        }
        groupId = group.id;
    } else if (groupId) {
        fail(400, "INVALID_GROUP", "A group name is required when a group is selected.");
    }
    const homeTeamId = validId(body.homeId, "Home team");
    const awayTeamId = validId(body.awayId, "Away team");
    if (homeTeamId === awayTeamId) fail(400, "INVALID_TEAMS", "A team cannot play itself.");
    for (const teamId of [homeTeamId, awayTeamId]) {
        const registeredTeam = await actor.db.prepare(
            "SELECT 1 AS present FROM afc_team_registrations WHERE team_id = ? " +
            "AND tournament_id = ? AND category_id = ? AND status = 'approved'"
        ).bind(teamId, tournamentId, categoryId).first();
        if (!registeredTeam) {
            fail(400, "INVALID_TEAMS", "Both teams must be approved entries in this tournament.");
        }
    }
    if (stageRecord) {
        const stageParticipants = await actor.db.prepare(
            "SELECT team_id FROM afc_stage_participants WHERE stage_id = ?"
        ).bind(stageId).all();
        const participantIds = new Set((stageParticipants.results || []).map(function (row) {
            return row.team_id;
        }));
        if (!participantIds.has(homeTeamId) || !participantIds.has(awayTeamId)) {
            fail(400, "INVALID_STAGE_PARTICIPANTS",
                "Both fixture teams must be approved participants in this stage.");
        }
        if (stage === "group") {
            if (!groupId) fail(400, "INVALID_GROUP", "Choose a saved group for this fixture.");
            const groupMembers = await actor.db.prepare(
                "SELECT team_id FROM afc_group_teams WHERE group_id = ? AND team_id IN (?, ?)"
            ).bind(groupId, homeTeamId, awayTeamId).all();
            if ((groupMembers.results || []).length !== 2) {
                fail(400, "INVALID_GROUP_PARTICIPANTS",
                    "Both fixture teams must belong to the selected group.");
            }
        } else if (stage !== "league") {
            const pairingData = JSON.parse(stageRecord.pairing_json || "{}");
            const pairings = Array.isArray(pairingData.pairings) ? pairingData.pairings : [];
            const approvedPair = pairings.some(function (pairing) {
                return Array.isArray(pairing.teamIds) && pairing.teamIds.length === 2 &&
                    pairing.teamIds.indexOf(homeTeamId) !== -1 &&
                    pairing.teamIds.indexOf(awayTeamId) !== -1;
            });
            if (!approvedPair) {
                fail(400, "INVALID_STAGE_PAIRING",
                    "The fixture teams must match an approved pairing for this stage.");
            }
        }
        const duplicatePair = await actor.db.prepare(
            "SELECT id FROM afc_matches WHERE stage_id = ? AND " +
            "((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))"
        ).bind(stageId, homeTeamId, awayTeamId, awayTeamId, homeTeamId).first();
        if (duplicatePair) {
            fail(409, "STAGE_FIXTURE_EXISTS", "This approved pairing already has a fixture in the stage.");
        }
    }
    const kickoff = validKickoff(body.kickoff);
    const venue = text(body.venue, "Venue", { required: true, max: 160 });
    const status = text(body.status || "scheduled", "Fixture status", { max: 16 }).toLowerCase();
    if (["draft", "scheduled", "live", "postponed", "cancelled", "completed"].indexOf(status) === -1) {
        fail(400, "INVALID_STATUS", "The fixture status is invalid.");
    }
    if (status === "completed") {
        fail(400, "RESULT_REQUIRED", "Record a completed score through the result workflow.");
    }
    const note = text(body.note || "", "Fixture note", { max: 2000 });
    const published = status !== "draft" ? 1 : 0;
    if (fixtureId) {
        if (existing.kickoff !== kickoff) {
            await requireUserPermission(actor, "fixtures.reschedule");
        }
        await actor.db.prepare(
            "UPDATE afc_matches SET tournament_id = ?, category_id = ?, group_id = ?, stage = ?, " +
            "round = ?, home_team_id = ?, away_team_id = ?, kickoff = ?, venue = ?, status = ?, " +
            "note = ?, published = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(
            tournamentId, categoryId, groupId, stage, round,
            homeTeamId, awayTeamId, kickoff, venue, status, note, published,
            actor.user.firebase_uid, fixtureId
        ).run();
        await logAudit(actor.db, actor.user.firebase_uid, "update_fixture", "match", fixtureId);
    }

    const id = fixtureId || newId("MCH-");
    if (!fixtureId) {
        const statements = [
            actor.db.prepare(
                "INSERT INTO afc_matches(id, tournament_id, category_id, group_id, stage_id, stage_fixture_key, " +
                "stage, round, home_team_id, away_team_id, kickoff, venue, status, note, published, created_by, updated_by) " +
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
                id, tournamentId, categoryId, groupId, stageId,
                stageRecord ? stageId + ":" + [homeTeamId, awayTeamId].sort().join(":") : null,
                stage, round,
                homeTeamId, awayTeamId, kickoff, venue, status, note, published,
                actor.user.firebase_uid, actor.user.firebase_uid
            ),
            actor.db.prepare(
                "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) " +
                "VALUES(?, ?, 'create_fixture', 'match', ?)"
            ).bind(newId("AUD-"), actor.user.firebase_uid, id)
        ];
        if (stageRecord && stageRecord.status === "approved") {
            statements.push(actor.db.prepare(
                "UPDATE afc_tournament_stages SET status = 'published', revision = revision + 1, " +
                "updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'"
            ).bind(actor.user.firebase_uid, stageId));
        }
        let saved;
        try {
            saved = await actor.db.batch(statements);
        } catch (error) {
            const message = String(error && error.message || "");
            if (message.indexOf("stage fixtures require an active approved stage") !== -1 ||
                message.indexOf("afc_matches.stage_fixture_key") !== -1) {
                fail(409, "STAGE_CHANGED_CONCURRENTLY",
                    "The stage or pairing changed while the fixture was being saved. Reload the stage and try again.");
            }
            throw error;
        }
        if (!saved[0].meta || saved[0].meta.changes !== 1) {
            fail(500, "FIXTURE_NOT_SAVED", "The fixture could not be saved. Please try again.");
        }
    }
    return success({ id: id, status: status }, fixtureId ? 200 : 201);
}

function matchGoalEventInsertStatements(db, matchId, events, liveOnly) {
    const statements = [];
    for (let offset = 0; offset < events.length; offset += 80) {
        const chunk = events.slice(offset, offset + 80);
        const bindings = [];
        let sql = "";
        if (liveOnly) {
            sql = "WITH live_match AS (SELECT id FROM afc_matches " +
                "WHERE id = ? AND status = 'live' AND published = 1) ";
            bindings.push(matchId);
            sql += "INSERT INTO afc_match_events(match_id, team_id, player_id, event_type, minute) ";
            sql += chunk.map(function () {
                return "SELECT ?, ?, ?, ?, ? FROM live_match";
            }).join(" UNION ALL ");
        } else {
            sql = "INSERT INTO afc_match_events(match_id, team_id, player_id, event_type, minute) VALUES ";
            sql += chunk.map(function () { return "(?, ?, ?, ?, ?)"; }).join(",");
        }
        chunk.forEach(function (event) {
            bindings.push(matchId, event.teamId, event.playerId, event.type, event.minute);
        });
        const statement = db.prepare(sql);
        statements.push(statement.bind.apply(statement, bindings));
    }
    return statements;
}

async function updateMatchResult(request, actor, matchId) {
    const body = await readJson(request);
    const state = text(body.state || "Published", "Publication state", { max: 16 }).toLowerCase();
    if (state !== "draft" && state !== "published") {
        fail(400, "INVALID_STATUS", "Choose draft or published.");
    }
    if (state === "published") {
        await requireUserPermission(actor, "results.publish");
    } else {
        await requireUserPermission(actor, "results.edit");
    }
    const match = await actor.db.prepare(
        "SELECT id, tournament_id, stage_id, group_id, stage, home_team_id, away_team_id, status, " +
        "home_score, away_score, tie_break_method, home_extra_time_score, away_extra_time_score, " +
        "home_penalties_score, away_penalties_score, note, published FROM afc_matches WHERE id = ?"
    ).bind(matchId).first();
    if (!match) fail(404, "NOT_FOUND", "The fixture was not found.");
    await requireTournamentScope(actor, match.tournament_id);
    if (state === "published" && Number(match.published) !== 1) {
        await requireUserPermission(actor, "results.edit");
    }
    const homeScore = state === "draft" && (body.homeScore === "" || body.homeScore === null ||
        body.homeScore === undefined) ? null : integer(body.homeScore, "Home score", 0, 99);
    const awayScore = state === "draft" && (body.awayScore === "" || body.awayScore === null ||
        body.awayScore === undefined) ? null : integer(body.awayScore, "Away score", 0, 99);
    const optionalScore = function (value, label) {
        return value === "" || value === null || value === undefined
            ? null
            : integer(value, label, 0, 99);
    };
    const tieBreakMethod = text(body.tieBreakMethod || "", "Tie procedure", { max: 16 });
    if (tieBreakMethod && tieBreakMethod !== "extra-time" && tieBreakMethod !== "penalties") {
        fail(400, "INVALID_TIE_BREAK", "Choose extra time or a penalty shootout.");
    }
    const homeExtraTimeScore = optionalScore(body.homeExtraTimeScore, "Home score after extra time");
    const awayExtraTimeScore = optionalScore(body.awayExtraTimeScore, "Away score after extra time");
    const homePenaltiesScore = optionalScore(body.homePenaltiesScore, "Home penalty-shootout score");
    const awayPenaltiesScore = optionalScore(body.awayPenaltiesScore, "Away penalty-shootout score");
    const hasExtraTime = homeExtraTimeScore !== null || awayExtraTimeScore !== null;
    const hasPenalties = homePenaltiesScore !== null || awayPenaltiesScore !== null;
    const regulationTied = homeScore !== null && awayScore !== null && homeScore === awayScore;
    const matchStage = String(match.stage || "").toLowerCase();
    const knockoutMatch = !match.group_id &&
        ["group", "league", "round-robin", "round robin"].indexOf(matchStage) === -1;
    if ((hasExtraTime && (homeExtraTimeScore === null || awayExtraTimeScore === null)) ||
        (hasPenalties && (homePenaltiesScore === null || awayPenaltiesScore === null))) {
        fail(400, "INVALID_TIE_BREAK", "Enter both teams' scores for each tie-break period.");
    }
    if (regulationTied && knockoutMatch && hasExtraTime &&
        (homeExtraTimeScore < homeScore || awayExtraTimeScore < awayScore)) {
        fail(400, "INVALID_TIE_BREAK",
            "Scores after extra time cannot be lower than the regulation scores.");
    }
    if (!knockoutMatch && (tieBreakMethod || hasExtraTime || hasPenalties)) {
        fail(400, "INVALID_TIE_BREAK", "Tie-break scores are only allowed for knockout fixtures.");
    }
    if (knockoutMatch && !regulationTied && (tieBreakMethod || hasExtraTime || hasPenalties)) {
        fail(400, "INVALID_TIE_BREAK", "Tie-break scores are only allowed when regulation time is tied.");
    }
    if (knockoutMatch && regulationTied && state === "published") {
        const extraTimeDecides = tieBreakMethod === "extra-time" &&
            homeExtraTimeScore !== null && awayExtraTimeScore !== null &&
            homeExtraTimeScore !== awayExtraTimeScore && !hasPenalties &&
            homeExtraTimeScore >= homeScore && awayExtraTimeScore >= awayScore;
        const penaltiesDecide = tieBreakMethod === "penalties" &&
            homeExtraTimeScore !== null && awayExtraTimeScore !== null &&
            homeExtraTimeScore === awayExtraTimeScore &&
            homePenaltiesScore !== null && awayPenaltiesScore !== null &&
            homePenaltiesScore !== awayPenaltiesScore;
        if (!extraTimeDecides && !penaltiesDecide) {
            fail(400, "KNOCKOUT_TIE_UNRESOLVED",
                "Resolve a tied knockout match after extra time or with a penalty shootout after tied extra time.");
        }
    }
    const notes = text(body.notes || "", "Result notes", { max: 2000 });
    const hasScorers = Array.isArray(body.homeScorers) && Array.isArray(body.awayScorers);
    if (body.homeScorers !== undefined || body.awayScorers !== undefined) {
        if (!hasScorers) fail(400, "INVALID_INPUT", "Both team goal-scorer lists are required.");
    }
    const events = [];
    if (hasScorers) {
        const lists = [
            {
                entries: body.homeScorers, teamId: match.home_team_id,
                score: tieBreakMethod && hasExtraTime ? homeExtraTimeScore : homeScore
            },
            {
                entries: body.awayScorers, teamId: match.away_team_id,
                score: tieBreakMethod && hasExtraTime ? awayExtraTimeScore : awayScore
            }
        ];
        for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
            const list = lists[listIndex];
            if (!list.teamId || list.entries.length > 99) {
                fail(400, "INVALID_INPUT", "Goal scorers must be assigned to a valid team.");
            }
            let total = 0;
            const playerIds = new Set();
            for (let entryIndex = 0; entryIndex < list.entries.length; entryIndex += 1) {
                const entry = list.entries[entryIndex];
                if (!entry || typeof entry !== "object") {
                    fail(400, "INVALID_INPUT", "A goal-scorer entry is invalid.");
                }
                const goals = integer(entry.goals, "Goal count", 1, 99);
                const minute = entry.minute === "" || entry.minute === null ||
                    entry.minute === undefined
                    ? null
                    : integer(entry.minute, "Goal minute", 0, 150);
                total += goals;
                const ownGoal = entry.ownGoal === true;
                if (!ownGoal) {
                    const playerId = validId(entry.playerId, "Goal scorer");
                    playerIds.add(playerId);
                    for (let goalIndex = 0; goalIndex < goals; goalIndex += 1) {
                        events.push({
                            teamId: list.teamId, playerId: playerId, type: "goal", minute: minute
                        });
                    }
                } else {
                    if (entry.playerId) {
                        fail(400, "INVALID_GOAL_SCORER", "An own goal cannot be assigned to a player.");
                    }
                    for (let ownGoalIndex = 0; ownGoalIndex < goals; ownGoalIndex += 1) {
                        events.push({
                            teamId: list.teamId, playerId: null, type: "own_goal", minute: minute
                        });
                    }
                }
            }
            if (playerIds.size) {
                const requestedPlayerIds = Array.from(playerIds);
                const players = await prepareBound(
                    actor.db,
                    "SELECT id FROM afc_players WHERE team_id = ? AND status = 'registered' " +
                        "AND id IN (" + requestedPlayerIds.map(function () { return "?"; }).join(",") + ")",
                    [list.teamId].concat(requestedPlayerIds)
                ).all();
                const registeredPlayerIds = new Set((players.results || []).map(function (player) {
                    return player.id;
                }));
                if (requestedPlayerIds.some(function (playerId) {
                    return !registeredPlayerIds.has(playerId);
                })) {
                    fail(400, "INVALID_GOAL_SCORER", "Choose a registered player from the scoring team.");
                }
            }
            if (total > Number(list.score || 0)) {
                fail(400, "GOAL_SCORERS_MISMATCH", "Recorded goal-scorer totals cannot exceed each team's score.");
            }
        }
    }
    const correctingPublished = isPublishedMatchResult(match) &&
        (state !== "published" || Number(match.home_score) !== homeScore ||
            Number(match.away_score) !== awayScore || match.note !== notes || hasScorers ||
            match.tie_break_method !== tieBreakMethod ||
            match.home_extra_time_score !== homeExtraTimeScore ||
            match.away_extra_time_score !== awayExtraTimeScore ||
            match.home_penalties_score !== homePenaltiesScore ||
            match.away_penalties_score !== awayPenaltiesScore);
    let correctionReason = "";
    let previousScorers = [];
    if (correctingPublished) {
        await requireUserPermission(actor, "results.correct");
        const dependentStages = await actor.db.prepare(
            "SELECT id, status, participant_source, qualification_json FROM afc_tournament_stages " +
            "WHERE tournament_id = ? AND status NOT IN ('draft', 'skipped')"
        ).bind(match.tournament_id).all();
        const dependent = (dependentStages.results || []).find(function (stage) {
            const qualification = JSON.parse(stage.qualification_json || "{}");
            return (Array.isArray(qualification.matchIds) &&
                    qualification.matchIds.indexOf(matchId) !== -1) ||
                (Boolean(match.group_id) && stage.participant_source === "group_positions") ||
                (stage.participant_source === "overall_standings" &&
                    String(match.stage || "").toLowerCase().indexOf("league") !== -1);
        });
        if (dependent) {
            fail(409, "DOWNSTREAM_STAGE_DEPENDENCY",
                "This result has approved downstream progression. Reopen and correct the dependent stage through an authorised correction workflow first.");
        }
        correctionReason = text(body.correctionReason, "Correction reason", {
            required: true, max: 1000
        });
        const priorEvents = await actor.db.prepare(
            "SELECT e.team_id, e.player_id, e.event_type, e.minute, p.name AS player_name " +
            "FROM afc_match_events e LEFT JOIN afc_players p ON p.id = e.player_id " +
            "WHERE e.match_id = ? AND e.event_type IN ('goal', 'own_goal') ORDER BY e.created_at, e.id"
        ).bind(matchId).all();
        previousScorers = priorEvents.results || [];
    }
    const nextStatus = state === "published" ? "completed" :
        (match.status === "completed" ? "scheduled" : match.status);
    const statements = [
        actor.db.prepare(
            "UPDATE afc_matches SET home_score = ?, away_score = ?, tie_break_method = ?, " +
            "home_extra_time_score = ?, away_extra_time_score = ?, home_penalties_score = ?, " +
            "away_penalties_score = ?, status = ?, note = ?, published = ?, " +
            "live_clock_mode = CASE WHEN ? = 'published' THEN 'finished' ELSE live_clock_mode END, " +
            "live_clock_started_at = CASE WHEN ? = 'published' THEN NULL ELSE live_clock_started_at END, " +
            "updated_by = ?, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(
            homeScore, awayScore, tieBreakMethod, homeExtraTimeScore, awayExtraTimeScore,
            homePenaltiesScore, awayPenaltiesScore, nextStatus, notes,
            state === "published" ? 1 : 0, state, state,
            actor.user.firebase_uid, matchId
        )
    ];
    if (state === "published" && match.stage_id) {
        statements.push(actor.db.prepare(
            "UPDATE afc_tournament_stages SET status = 'in_progress', revision = revision + 1, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'published'"
        ).bind(match.stage_id));
    }
    const standingsStage = String(match.stage || "").toLowerCase();
    if (state === "published" && (match.group_id ||
        ["group", "league", "round-robin", "round robin"].indexOf(standingsStage) !== -1)) {
        statements.push(actor.db.prepare(
            "UPDATE afc_tournaments SET standings_available = 1, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = ?"
        ).bind(match.tournament_id));
    }
    if (hasScorers) {
        statements.push(actor.db.prepare(
            "DELETE FROM afc_match_events WHERE match_id = ? AND event_type IN ('goal', 'own_goal')"
        ).bind(matchId));
        statements.push.apply(
            statements, matchGoalEventInsertStatements(actor.db, matchId, events, false)
        );
    }
    const auditDetails = {
        previous: {
            homeScore: match.home_score,
            awayScore: match.away_score,
            tieBreakMethod: match.tie_break_method,
            homeExtraTimeScore: match.home_extra_time_score,
            awayExtraTimeScore: match.away_extra_time_score,
            homePenaltiesScore: match.home_penalties_score,
            awayPenaltiesScore: match.away_penalties_score,
            published: Number(match.published) === 1,
            note: match.note,
            scorers: previousScorers
        },
        next: {
            homeScore: homeScore,
            awayScore: awayScore,
            tieBreakMethod: tieBreakMethod,
            homeExtraTimeScore: homeExtraTimeScore,
            awayExtraTimeScore: awayExtraTimeScore,
            homePenaltiesScore: homePenaltiesScore,
            awayPenaltiesScore: awayPenaltiesScore,
            published: state === "published",
            note: notes,
            scorers: hasScorers ? body.homeScorers.concat(body.awayScorers) : previousScorers
        }
    };
    if (correctingPublished) auditDetails.reason = correctionReason;
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid,
        correctingPublished ? "correct_published_result" : "record_match_result",
        "match", matchId, JSON.stringify(auditDetails)
    ));
    await actor.db.batch(statements);
    return success({
        id: matchId, homeScore: homeScore, awayScore: awayScore,
        status: nextStatus, published: state === "published"
    });
}

async function updateMatchStatus(request, actor, matchId) {
    const body = await readJson(request);
    const status = text(body.status, "Match status", { required: true, max: 16 }).toLowerCase();
    if (["scheduled", "live", "postponed", "cancelled"].indexOf(status) === -1) {
        fail(400, "INVALID_STATUS", "Choose a supported fixture status.");
    }
    await requireUserPermission(actor, "fixtures.edit");
    const match = await actor.db.prepare(
        "SELECT id, tournament_id, status, published FROM afc_matches WHERE id = ?"
    ).bind(matchId).first();
    if (!match) fail(404, "NOT_FOUND", "The fixture was not found.");
    await requireTournamentScope(actor, match.tournament_id);
    if (match.status === "completed") {
        fail(409, "MATCH_ALREADY_COMPLETED", "A completed match can only be changed by updating its result.");
    }
    if (status === "live" && Number(match.published) !== 1) {
        fail(409, "MATCH_NOT_PUBLISHED", "Publish the fixture before starting live coverage.");
    }
    if (status === "live" && match.status !== "scheduled" && match.status !== "live") {
        fail(409, "MATCH_NOT_READY", "Only a scheduled match can be started.");
    }
    if (status === "live" && match.status !== "live") {
        await actor.db.prepare(
            "UPDATE afc_matches SET status = 'live', " +
            "home_score = COALESCE(home_score, 0), away_score = COALESCE(away_score, 0), " +
            "live_clock_mode = 'automatic', live_clock_started_at = ?, " +
            "live_clock_elapsed_seconds = 0, live_minute = 0, live_extra_minutes = 0, " +
            "updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(new Date().toISOString(), actor.user.firebase_uid, matchId).run();
    } else if (status !== "live") {
        await actor.db.prepare(
            "UPDATE afc_matches SET status = ?, live_clock_mode = 'automatic', " +
            "live_clock_started_at = NULL, live_clock_elapsed_seconds = 0, live_minute = 0, " +
            "live_extra_minutes = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, actor.user.firebase_uid, matchId).run();
    }
    await logAudit(actor.db, actor.user.firebase_uid, "update_match_status", "match", matchId);
    return success({ id: matchId, status: status });
}

async function updateLiveMatch(request, actor, matchId) {
    await requireUserPermission(actor, "results.edit");
    const body = await readJson(request);
    await advanceAutomaticMatches(actor.db, new Date());
    const match = await actor.db.prepare(
        "SELECT id, tournament_id, home_team_id, away_team_id, status, published, " +
        "live_clock_mode, live_clock_started_at, live_clock_elapsed_seconds, " +
        "live_extra_minutes, live_minute " +
        "FROM afc_matches WHERE id = ?"
    ).bind(matchId).first();
    if (!match) fail(404, "NOT_FOUND", "The fixture was not found.");
    await requireTournamentScope(actor, match.tournament_id);
    if (match.status !== "live" || Number(match.published) !== 1) {
        fail(409, "MATCH_NOT_LIVE", "Live scores can only be updated while a published match is live.");
    }
    const homeScore = integer(body.homeScore, "Home score", 0, 99);
    const awayScore = integer(body.awayScore, "Away score", 0, 99);
    const liveMinute = integer(body.liveMinute, "Match minute", 0, 150);
    const clock = liveClockSnapshot(match, new Date());
    const extraMinutes = body.liveExtraMinutes === undefined
        ? Number(match.live_extra_minutes || 0)
        : integer(body.liveExtraMinutes, "Second-half added minutes", 0, 30);
    let nextClockMode = match.live_clock_mode;
    let nextClockStartedAt = match.live_clock_started_at;
    if (match.live_clock_mode === "finished" &&
        extraMinutes > Number(match.live_extra_minutes || 0) &&
        clock.elapsedSeconds < (60 + 45 + extraMinutes) * 60) {
        nextClockMode = "automatic";
        nextClockStartedAt = new Date().toISOString();
    }
    if (!Array.isArray(body.homeScorers) || !Array.isArray(body.awayScorers)) {
        fail(400, "INVALID_INPUT", "Both team goal-scorer lists are required.");
    }

    const events = [];
    const lists = [
        { entries: body.homeScorers, teamId: match.home_team_id, score: homeScore },
        { entries: body.awayScorers, teamId: match.away_team_id, score: awayScore }
    ];
    for (const list of lists) {
        if (!list.teamId || list.entries.length > 99) {
            fail(400, "INVALID_INPUT", "Goal scorers must be assigned to a valid team.");
        }
        let total = 0;
        const requestedPlayerIds = new Set();
        for (const entry of list.entries) {
            if (!entry || typeof entry !== "object") {
                fail(400, "INVALID_INPUT", "A goal-scorer entry is invalid.");
            }
            const goals = integer(entry.goals, "Goal count", 1, 99);
            const minute = entry.minute === "" || entry.minute === null ||
                entry.minute === undefined
                ? ((clock.mode === "manual" || clock.mode === "paused")
                    ? liveMinute : clock.minute)
                : integer(entry.minute, "Goal minute", 0, 150);
            total += goals;
            const ownGoal = entry.ownGoal === true;
            if (ownGoal) {
                if (entry.playerId) {
                    fail(400, "INVALID_GOAL_SCORER", "An own goal cannot be assigned to a player.");
                }
                for (let index = 0; index < goals; index += 1) {
                    events.push({
                        teamId: list.teamId, playerId: null,
                        type: "own_goal", minute: minute
                    });
                }
            } else {
                const playerId = validId(entry.playerId, "Goal scorer");
                requestedPlayerIds.add(playerId);
                for (let index = 0; index < goals; index += 1) {
                    events.push({
                        teamId: list.teamId, playerId: playerId,
                        type: "goal", minute: minute
                    });
                }
            }
        }
        if (total > list.score) {
            fail(400, "GOAL_SCORERS_MISMATCH",
                "Recorded goal-scorer totals cannot exceed each team's live score.");
        }
        if (requestedPlayerIds.size) {
            const ids = Array.from(requestedPlayerIds);
            const players = await prepareBound(
                actor.db,
                "SELECT id FROM afc_players WHERE team_id = ? AND status = 'registered' " +
                    "AND id IN (" + ids.map(function () { return "?"; }).join(",") + ")",
                [list.teamId].concat(ids)
            ).all();
            const registeredIds = new Set((players.results || []).map(function (player) {
                return player.id;
            }));
            if (ids.some(function (id) { return !registeredIds.has(id); })) {
                fail(400, "INVALID_GOAL_SCORER", "Choose a registered player from the scoring team.");
            }
        }
    }

    const statements = [
        actor.db.prepare(
            "UPDATE afc_matches SET home_score = ?, away_score = ?, " +
            "live_minute = CASE WHEN live_clock_mode IN ('manual', 'paused') THEN ? ELSE live_minute END, " +
            "live_extra_minutes = ?, live_clock_mode = ?, live_clock_started_at = ?, " +
            "updated_by = ?, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = ? AND status = 'live' AND published = 1"
        ).bind(
            homeScore, awayScore, liveMinute, extraMinutes, nextClockMode,
            nextClockStartedAt, actor.user.firebase_uid, matchId
        ),
        actor.db.prepare(
            "DELETE FROM afc_match_events WHERE match_id = ? AND event_type IN ('goal', 'own_goal') " +
            "AND EXISTS (SELECT 1 FROM afc_matches WHERE id = ? AND status = 'live' AND published = 1)"
        ).bind(matchId, matchId)
    ];
    statements.push.apply(
        statements, matchGoalEventInsertStatements(actor.db, matchId, events, true)
    );
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "SELECT ?, ?, 'update_live_match', 'match', ?, ? WHERE EXISTS " +
        "(SELECT 1 FROM afc_matches WHERE id = ? AND status = 'live' AND published = 1)"
    ).bind(newId("AUD-"), actor.user.firebase_uid, matchId, JSON.stringify({
        homeScore: homeScore, awayScore: awayScore, liveMinute: liveMinute,
        scorers: body.homeScorers.concat(body.awayScorers)
    }), matchId));
    const results = await actor.db.batch(statements);
    if (!results[0].meta || results[0].meta.changes !== 1) {
        fail(409, "MATCH_NOT_LIVE", "This match is no longer live. Reload the match before updating it.");
    }
    return success({
        id: matchId, status: "live", homeScore: homeScore, awayScore: awayScore,
        liveMinute: liveMinute
    });
}

async function updateLiveMatchClock(request, actor, matchId) {
    await requireUserPermission(actor, "results.edit");
    const body = await readJson(request);
    const action = text(body.action, "Clock action", { required: true, max: 16 });
    if (["pause", "resume", "set-minute"].indexOf(action) === -1) {
        fail(400, "INVALID_CLOCK_ACTION", "Choose a supported live-clock action.");
    }
    await advanceAutomaticMatches(actor.db, new Date());
    const match = await actor.db.prepare(
        "SELECT id, tournament_id, status, published, live_minute, live_clock_mode, " +
        "live_clock_started_at, live_clock_elapsed_seconds, live_extra_minutes " +
        "FROM afc_matches WHERE id = ?"
    ).bind(matchId).first();
    if (!match) fail(404, "NOT_FOUND", "The fixture was not found.");
    await requireTournamentScope(actor, match.tournament_id);
    if (match.status !== "live" || Number(match.published) !== 1) {
        fail(409, "MATCH_NOT_LIVE", "The clock can only be managed while a published match is live.");
    }

    const now = new Date();
    const clock = liveClockSnapshot(match, now);
    let mode = match.live_clock_mode;
    let startedAt = match.live_clock_started_at;
    let elapsedSeconds = clock.elapsedSeconds;
    let minute = clock.minute;
    let extraMinutes = Number(match.live_extra_minutes || 0);
    if (action === "pause") {
        if (mode !== "automatic") {
            fail(409, "CLOCK_NOT_AUTOMATIC", "Only an automatic clock can be paused.");
        }
        if (clock.period === "full_time") {
            mode = "finished";
            startedAt = null;
        } else {
            mode = "paused";
            startedAt = null;
        }
    } else if (action === "resume") {
        if (mode !== "paused" && mode !== "manual") {
            fail(409, "CLOCK_NOT_OVERRIDDEN", "Pause or set the clock manually before resuming it.");
        }
        if (elapsedSeconds >= (60 + 45 + extraMinutes) * 60) {
            mode = "finished";
            startedAt = null;
        } else {
            mode = "automatic";
            startedAt = now.toISOString();
        }
    } else {
        minute = integer(body.minute, "Match minute", 0, 120);
        elapsedSeconds = elapsedSecondsAtMinute(minute);
        extraMinutes = Math.max(extraMinutes, Math.max(0, minute - 90));
        mode = "manual";
        startedAt = null;
    }

    await actor.db.prepare(
        "UPDATE afc_matches SET live_clock_mode = ?, live_clock_started_at = ?, " +
        "live_clock_elapsed_seconds = ?, live_minute = ?, live_extra_minutes = ?, " +
        "updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'live'"
    ).bind(
        mode, startedAt, elapsedSeconds, minute, extraMinutes,
        actor.user.firebase_uid, matchId
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "control_live_match_clock", "match", matchId);
    return success({
        id: matchId, liveClockMode: mode, liveMinute: minute,
        livePeriod: mode === "finished" ? "full_time" : clock.period,
        liveExtraMinutes: extraMinutes
    });
}

async function saveRule(request, actor, rulesId) {
    const body = await readJson(request);
    const categoryId = validId(body.categoryId, "Category");
    if (actor.user.role !== "platform_owner") {
        const scope = await actor.db.prepare(
            "SELECT 1 AS permitted FROM afc_tournaments t " +
            "JOIN afc_tournament_admin_scopes s ON s.tournament_id = t.id " +
            "WHERE s.user_uid = ? AND t.category_id = ? LIMIT 1"
        ).bind(actor.user.firebase_uid, categoryId).first();
        if (!scope) fail(403, "FORBIDDEN", "You are not permitted to manage rules for this category.");
    }
    const title = text(body.title, "Rule title", { required: true, max: 140 });
    const ruleBody = text(body.body, "Rule text", { required: true, max: 30000 });
    const status = text(body.status || "draft", "Rule status", { max: 16 }).toLowerCase();
    if (status !== "draft" && status !== "published") {
        fail(400, "INVALID_STATUS", "Choose draft or published.");
    }
    if (rulesId) {
        const existing = await actor.db.prepare(
            "SELECT category_id, title, body FROM afc_rules WHERE id = ?"
        ).bind(rulesId).first();
        if (!existing) fail(404, "NOT_FOUND", "The rules document was not found.");
        if (existing.category_id !== categoryId && actor.user.role !== "platform_owner") {
            fail(403, "FORBIDDEN", "You cannot move rules into a category outside your scope.");
        }
        const statements = [actor.db.prepare(
            "UPDATE afc_rules SET category_id = ?, title = ?, body = ?, status = ?, updated_by = ?, " +
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(categoryId, title, ruleBody, status, actor.user.firebase_uid, rulesId)];
        if (existing.category_id !== categoryId ||
            existing.title !== title || existing.body !== ruleBody) {
            statements.push(actor.db.prepare(
                "DELETE FROM afc_rules_acknowledgements WHERE rules_id = ?"
            ).bind(rulesId));
            statements.push(actor.db.prepare(
                "DELETE FROM afc_rules_acknowledgment_reminders WHERE rules_id = ?"
            ).bind(rulesId));
        }
        await actor.db.batch(statements);
        await logAudit(actor.db, actor.user.firebase_uid, "update_rules", "rules", rulesId);
        return success({ id: rulesId, status: status });
    }
    const id = newId("RUL-");
    await actor.db.prepare(
        "INSERT INTO afc_rules(id, category_id, title, body, status, updated_by) VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(id, categoryId, title, ruleBody, status, actor.user.firebase_uid).run();
    await logAudit(actor.db, actor.user.firebase_uid, "create_rules", "rules", id);
    return success({ id: id, status: status }, 201);
}

async function updateUserStatus(request, actor, uid) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can change account access.");
    }
    if (uid === actor.user.firebase_uid) {
        fail(409, "SELF_STATUS_CHANGE", "You cannot disable your own account.");
    }
    const body = await readJson(request);
    const status = text(body.status, "Account status", { required: true, max: 16 });
    if (["active", "disabled", "suspended", "pending"].indexOf(status) === -1) {
        fail(400, "INVALID_STATUS", "Choose a valid account status.");
    }
    const target = await actor.db.prepare(
        "SELECT firebase_uid, email, full_name, role, status, email_verified " +
        "FROM afc_users WHERE firebase_uid = ?"
    ).bind(uid).first();
    if (!target) fail(404, "NOT_FOUND", "The account was not found.");
    const result = await actor.db.prepare(
        "UPDATE afc_users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = ?"
    ).bind(status, uid).run();
    if (!result.meta || result.meta.changes !== 1) fail(404, "NOT_FOUND", "The account was not found.");
    await logAudit(actor.db, actor.user.firebase_uid, "change_user_status", "user", uid);
    const emailStatus = target.status !== status
        ? await sendTransactionalEmail(
            actor.env,
            actor.db,
            "account_access_updated",
            "account-status:" + uid + ":" + newId("EVT-"),
            {
                uid: target.firebase_uid,
                email: target.email,
                name: target.full_name,
                email_verified: target.email_verified
            },
            {
                recipientName: target.full_name,
                role: target.role === "platform_owner" ? "Platform owner" :
                    target.role === "tournament_admin" ? "Tournament administrator" :
                        target.role === "team_manager" ? "Team manager" : "Not assigned",
                status: status,
                tournamentAccess: ""
            }
        )
        : "not_sent";
    return success({ uid: uid, status: status, emailStatus: emailStatus });
}

async function permanentlyDeleteManager(actor, uid) {
    if (actor.user.role !== "platform_owner") {
        fail(403, "FORBIDDEN", "Only a platform owner can permanently delete a team manager.");
    }
    if (uid === actor.user.firebase_uid) {
        fail(409, "SELF_DELETE", "You cannot permanently delete your own account.");
    }

    const target = await actor.db.prepare(
        "SELECT firebase_uid, email, full_name, role, requested_account_type " +
        "FROM afc_users WHERE firebase_uid = ?"
    ).bind(uid).first();
    if (!target) fail(404, "NOT_FOUND", "The manager account was not found.");
    if (target.role !== "team_manager" &&
        !(target.role === null && target.requested_account_type === "team-manager")) {
        fail(409, "NOT_A_TEAM_MANAGER", "Only a team-manager account can be permanently deleted here.");
    }
    const disabled = await actor.db.prepare(
        "UPDATE afc_users SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = ?"
    ).bind(uid).run();
    if (!disabled.meta || disabled.meta.changes !== 1) {
        fail(500, "MANAGER_DELETE_FAILED", "The manager's access could not be disabled before deletion.");
    }

    const media = await actor.db.prepare(
        "SELECT media.object_key FROM afc_media media WHERE media.owner_uid = ?1 " +
        "AND NOT EXISTS (SELECT 1 FROM afc_teams other WHERE other.manager_uid <> ?1 " +
        "AND (CASE WHEN other.logo_key LIKE 'media/%' THEN other.logo_key ELSE 'media/' || other.logo_key END) = media.object_key) " +
        "UNION SELECT CASE WHEN team.logo_key LIKE 'media/%' THEN team.logo_key ELSE 'media/' || team.logo_key END AS object_key " +
        "FROM afc_teams team WHERE team.manager_uid = ?1 AND team.logo_key IS NOT NULL AND team.logo_key <> '' " +
        "AND NOT EXISTS (SELECT 1 FROM afc_teams other WHERE other.manager_uid <> ?1 " +
        "AND (CASE WHEN other.logo_key LIKE 'media/%' THEN other.logo_key ELSE 'media/' || other.logo_key END) = " +
        "(CASE WHEN team.logo_key LIKE 'media/%' THEN team.logo_key ELSE 'media/' || team.logo_key END))"
    ).bind(uid).all();
    const objectKeys = (media.results || []).map(function (row) { return row.object_key; });
    if (objectKeys.length && (!actor.env.MEDIA || typeof actor.env.MEDIA.delete !== "function")) {
        fail(503, "MEDIA_STORAGE_UNAVAILABLE",
            "The manager has stored media, but R2 deletion is unavailable. Access is disabled; no records were deleted. Retry after checking the R2 binding.");
    }
    for (const objectKey of objectKeys) {
        try {
            await actor.env.MEDIA.delete(objectKey);
        } catch (error) {
            console.error("Manager media deletion failed.", {
                objectKey: objectKey,
                errorName: error && error.name ? error.name : "Error"
            });
            fail(502, "MEDIA_DELETE_FAILED",
                "R2 could not delete all manager media. The account remains in D1 with access disabled; retry this action.");
        }
    }

    const teams = "(SELECT id FROM afc_teams WHERE manager_uid = ?1 " +
        "UNION SELECT team_id FROM afc_team_registrations WHERE manager_uid = ?1)";
    const registrations = "(SELECT id FROM afc_team_registrations WHERE manager_uid = ?1 OR team_id IN " +
        teams + ")";
    const players = "(SELECT id FROM afc_players WHERE team_id IN " + teams +
        " OR registration_id IN " + registrations + ")";
    const matches = "(SELECT id FROM afc_matches WHERE created_by = ?1 OR updated_by = ?1 " +
        "OR home_team_id IN " + teams + " OR away_team_id IN " + teams + ")";
    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_deleted_manager_email_blocks(email_sha256) VALUES(?) " +
            "ON CONFLICT(email_sha256) DO NOTHING"
        ).bind(await emailBlockHash(target.email)),
        actor.db.prepare(
            "DELETE FROM afc_audit_log WHERE actor_uid = ?1 OR " +
            "(entity_type = 'user' AND entity_id = ?1) OR entity_id IN (" +
            "SELECT id FROM afc_teams WHERE manager_uid = ?1 UNION " +
            "SELECT id FROM afc_team_registrations WHERE manager_uid = ?1 OR team_id IN " + teams + " UNION " +
            "SELECT id FROM afc_players WHERE team_id IN " + teams + " OR registration_id IN " + registrations + " UNION " +
            "SELECT id FROM afc_payments WHERE team_id IN " + teams + " OR registration_id IN " + registrations + " UNION " +
            "SELECT id FROM afc_matches WHERE created_by = ?1 OR updated_by = ?1 OR home_team_id IN " + teams +
            " OR away_team_id IN " + teams + ")"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_match_events WHERE team_id IN " + teams +
            " OR player_id IN " + players + " OR match_id IN " + matches
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_match_lineups WHERE manager_uid = ?1 OR team_id IN " + teams +
            " OR match_id IN " + matches
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_matches WHERE created_by = ?1 OR updated_by = ?1 " +
            "OR home_team_id IN " + teams + " OR away_team_id IN " + teams
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_payments WHERE team_id IN " + teams +
            " OR registration_id IN " + registrations
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_registration_permissions SET updated_by = ?2 WHERE updated_by = ?1 " +
            "AND registration_id NOT IN " + registrations
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "DELETE FROM afc_registration_permissions WHERE registration_id IN " + registrations
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_tournament_admin_scopes SET granted_by = ?2 WHERE granted_by = ?1 AND user_uid <> ?1"
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare("DELETE FROM afc_tournament_admin_scopes WHERE user_uid = ?").bind(uid),
        actor.db.prepare(
            "UPDATE afc_user_permissions SET updated_by = ?2 WHERE updated_by = ?1"
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "UPDATE afc_tournament_stages SET created_by = NULL, updated_by = NULL, approved_by = NULL " +
            "WHERE created_by = ? OR updated_by = ? OR approved_by = ?"
        ).bind(uid, uid, uid),
        actor.db.prepare(
            "UPDATE afc_stage_participants SET selected_by = ?2 WHERE selected_by = ?1 " +
            "AND team_id NOT IN " + teams
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "DELETE FROM afc_stage_participants WHERE team_id IN " + teams
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_stage_approvals SET actor_uid = ?2 WHERE actor_uid = ?1"
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "UPDATE afc_media_items SET created_by = ?2 WHERE created_by = ?1"
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "DELETE FROM afc_email_events WHERE recipient_uid = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_news_articles WHERE created_by = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_rules_acknowledgements WHERE acknowledged_by = ?1 OR registration_id IN " +
            registrations
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_rules_acknowledgment_reminders WHERE manager_uid = ? OR sent_by = ?"
        ).bind(uid, uid),
        actor.db.prepare(
            "DELETE FROM afc_rules WHERE updated_by = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_notifications WHERE user_uid = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_api_idempotency WHERE user_uid = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_rate_limits WHERE rate_key LIKE ?"
        ).bind("uid:" + uid + ":%"),
        actor.db.prepare(
            "UPDATE afc_media SET owner_uid = ?2 WHERE owner_uid = ?1 AND object_key IN (" +
            "SELECT media.object_key FROM afc_media media WHERE media.owner_uid = ?1 " +
            "AND EXISTS (SELECT 1 FROM afc_teams other WHERE other.manager_uid <> ?1 " +
            "AND (CASE WHEN other.logo_key LIKE 'media/%' THEN other.logo_key ELSE 'media/' || other.logo_key END) = media.object_key))"
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "DELETE FROM afc_media WHERE owner_uid = ?1 OR object_key IN (" +
            "SELECT CASE WHEN team.logo_key LIKE 'media/%' THEN team.logo_key ELSE 'media/' || team.logo_key END " +
            "FROM afc_teams team WHERE team.manager_uid = ?1 AND team.logo_key IS NOT NULL AND team.logo_key <> '' " +
            "AND NOT EXISTS (SELECT 1 FROM afc_teams other WHERE other.manager_uid <> ?1 " +
            "AND (CASE WHEN other.logo_key LIKE 'media/%' THEN other.logo_key ELSE 'media/' || other.logo_key END) = " +
            "(CASE WHEN team.logo_key LIKE 'media/%' THEN team.logo_key ELSE 'media/' || team.logo_key END)))"
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_tournaments SET created_by = NULL WHERE created_by = ?"
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_team_registrations SET reviewed_by = NULL WHERE reviewed_by = ? AND manager_uid <> ?"
        ).bind(uid, uid),
        actor.db.prepare(
            "UPDATE afc_app_settings SET updated_by = NULL WHERE updated_by = ?"
        ).bind(uid),
        actor.db.prepare(
            "UPDATE afc_payments SET recorded_by = ?2 WHERE recorded_by = ?1 " +
            "AND registration_id NOT IN " + registrations + " AND team_id NOT IN " + teams
        ).bind(uid, actor.user.firebase_uid),
        actor.db.prepare(
            "DELETE FROM afc_team_registrations WHERE manager_uid = ? OR team_id IN " +
            "(SELECT id FROM afc_teams WHERE manager_uid = ?)"
        ).bind(uid, uid),
        actor.db.prepare(
            "DELETE FROM afc_teams WHERE manager_uid = ?"
        ).bind(uid),
        actor.db.prepare(
            "DELETE FROM afc_users WHERE firebase_uid = ?"
        ).bind(uid),
        actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
            "VALUES(?, ?, 'permanently_delete_manager', 'manager_account', NULL, '{}')"
        ).bind(
            newId("AUD-"), actor.user.firebase_uid
        )
    ];

    try {
        await actor.db.batch(statements);
    } catch (error) {
        console.error("Manager D1 deletion batch failed.", {
            uid: uid,
            errorName: error && error.name ? error.name : "Error"
        });
        fail(500, "MANAGER_DELETE_FAILED",
            "D1 could not complete the manager deletion. The database changes were rolled back; retry after checking the Worker logs. R2 media may already have been removed.");
    }
    return success({
        uid: uid,
        deleted: true,
        r2ObjectsDeleted: objectKeys.length,
        emailBlocked: true,
        firebaseAccountRequiresManualDeletion: true
    });
}

async function managerRegistration(actor, registrationId) {
    if (actor.user.role !== "team_manager") {
        fail(403, "FORBIDDEN", "A team manager account is required.");
    }
    const registration = await actor.db.prepare(
        "SELECT r.*, tm.name AS team_name, tm.category_id AS team_category_id, " +
        "t.start_date AS tournament_start, t.registration_fee, c.age_min, c.age_max, " +
        "c.guardian_consent_required FROM afc_team_registrations r " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "JOIN afc_categories c ON c.id = r.category_id " +
        "WHERE r.id = ? AND r.manager_uid = ?"
    ).bind(registrationId, actor.user.firebase_uid).first();
    if (!registration) fail(404, "NOT_FOUND", "The team registration was not found.");
    return registration;
}

async function pendingManagerRegistrationBalance(actor) {
    const user = actor.user;
    if (!user || user.status !== "pending" ||
        (user.role !== null && user.role !== "team_manager") ||
        user.requested_account_type !== "team-manager") {
        fail(403, "PENDING_MANAGER_REQUIRED",
            "A pending team-manager account is required to view this balance.");
    }
    const summary = await actor.db.prepare(
        "SELECT COUNT(*) AS registration_count, " +
        "COALESCE(SUM(CASE WHEN r.fee_amount > COALESCE(p.paid_total, 0) " +
        "THEN r.fee_amount - COALESCE(p.paid_total, 0) ELSE 0 END), 0) AS balance_due " +
        "FROM afc_team_registrations r LEFT JOIN (" +
        "SELECT registration_id, SUM(amount) AS paid_total FROM afc_payments " +
        "WHERE status IN ('confirmed', 'partial') GROUP BY registration_id" +
        ") p ON p.registration_id = r.id " +
        "WHERE r.manager_uid = ? AND r.status IN ('pending_review', 'correction_requested', 'approved')"
    ).bind(user.firebase_uid).first();
    if (!summary) {
        throw new Error("The pending manager registration balance could not be calculated.");
    }
    return success({
        registrationCount: Number(summary.registration_count || 0),
        balanceDue: Number(summary.balance_due || 0),
        currency: "KES"
    });
}

async function assertRosterEditable(actor, registration) {
    if (registration.status !== "approved") {
        fail(409, "REGISTRATION_NOT_APPROVED", "The team must be approved before players can be added.");
    }
    const permission = await actor.db.prepare(
        "SELECT roster_changes_after_start, roster_changes_expires_at " +
        "FROM afc_registration_permissions WHERE registration_id = ?"
    ).bind(registration.id).first();
    const today = eatDateKey();
    if (registration.tournament_start <= today &&
        !isRosterChangePermissionActive(permission, Date.now())) {
        fail(403, "ROSTER_LOCKED", "Roster changes are locked after the tournament starts.");
    }
}

function validatePublicProfile(value, registration, playerConsent) {
    const profile = text(value || "hidden", "Public profile", { max: 16 });
    if (["full", "limited", "hidden"].indexOf(profile) === -1) {
        fail(400, "INVALID_INPUT", "The public profile setting is invalid.");
    }
    if (registration.guardian_consent_required === 1 && profile === "full") {
        fail(400, "PRIVACY_RESTRICTION", "Youth and children's players cannot have a full public profile.");
    }
    if (profile === "full" && playerConsent !== true) {
        fail(400, "PRIVACY_RESTRICTION", "The player must agree before their full name can be shown publicly.");
    }
    return profile;
}

function validatePlayerBody(body, registration) {
    const name = text(body.name, "Player name", { required: true, max: 120 });
    const yearOfBirth = integer(body.yearOfBirth, "Year of birth", 1900, 2200);
    const tournamentYear = Number(String(registration.tournament_start).slice(0, 4));
    const maximumPossibleAge = tournamentYear - yearOfBirth;
    const minimumPossibleAge = maximumPossibleAge - 1;
    if ((registration.age_min !== null && maximumPossibleAge < registration.age_min) ||
        (registration.age_max !== null && minimumPossibleAge > registration.age_max)) {
        fail(400, "PLAYER_AGE_INELIGIBLE", "The player's birth year is outside this category's age limits.");
    }
    const shirtNumber = integer(body.shirtNumber, "Shirt number", 1, 99);
    const profile = validatePublicProfile(
        body.publicProfile, registration, body.publicProfileConsent === true
    );
    return {
        name: name,
        nickname: text(body.nickname, "Nickname", { max: 60 }) || null,
        yearOfBirth: yearOfBirth,
        position: text(body.position, "Position", { required: true, max: 40 }),
        shirtNumber: shirtNumber,
        classification: registration.guardian_consent_required === 1 ? "Youth" : "Senior",
        consent: registration.guardian_consent_required === 1 ? "pending" : "not_required",
        publicProfile: profile
    };
}

async function addManagerPlayer(request, actor, registrationId) {
    const registration = await managerRegistration(actor, registrationId);
    await assertRosterEditable(actor, registration);
    const body = await readJson(request);
    const player = validatePlayerBody(body, registration);
    const id = newId("PLY-");
    await actor.db.prepare(
        "INSERT INTO afc_players(id, team_id, registration_id, name, nickname, date_of_birth, position, " +
        "shirt_number, classification, guardian_consent_status, public_profile) " +
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
        id, registration.team_id, registration.id, player.name, player.nickname,
        String(player.yearOfBirth) + "-01-01",
        player.position, player.shirtNumber, player.classification, player.consent, player.publicProfile
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "add_team_player", "player", id);
    return success({ id: id, name: player.name, teamId: registration.team_id }, 201);
}

async function updateManagerPlayer(request, actor, playerId, deleteRecord) {
    const player = await actor.db.prepare(
        "SELECT p.*, r.id AS registration_id, r.manager_uid FROM afc_players p " +
        "JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "WHERE p.id = ? AND r.manager_uid = ?"
    ).bind(playerId, actor.user.firebase_uid).first();
    if (!player) fail(404, "NOT_FOUND", "The player was not found.");
    const registration = await managerRegistration(actor, player.registration_id);
    await assertRosterEditable(actor, registration);
    if (deleteRecord) {
        await actor.db.prepare("DELETE FROM afc_players WHERE id = ?").bind(playerId).run();
        await logAudit(actor.db, actor.user.firebase_uid, "remove_team_player", "player", playerId);
        return success({ id: playerId, deleted: true });
    }
    const body = await readJson(request);
    const updated = validatePlayerBody({
        name: body.name === undefined ? player.name : body.name,
        nickname: body.nickname === undefined ? player.nickname : body.nickname,
        yearOfBirth: body.yearOfBirth === undefined
            ? Number(String(player.date_of_birth || "").slice(0, 4))
            : body.yearOfBirth,
        position: body.position === undefined ? player.position : body.position,
        shirtNumber: body.shirtNumber === undefined ? player.shirt_number : body.shirtNumber,
        publicProfile: body.publicProfile === undefined ? player.public_profile : body.publicProfile,
        publicProfileConsent: body.publicProfileConsent === true
    }, registration);
    await actor.db.prepare(
        "UPDATE afc_players SET name = ?, nickname = ?, date_of_birth = ?, position = ?, shirt_number = ?, " +
        "classification = ?, public_profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(
        updated.name, updated.nickname, String(updated.yearOfBirth) + "-01-01",
        updated.position, updated.shirtNumber,
        updated.classification, updated.publicProfile, playerId
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "update_team_player", "player", playerId);
    return success({ id: playerId, name: updated.name, teamId: registration.team_id });
}

async function updateManagerPlayerPublicProfile(request, actor, playerId) {
    const player = await actor.db.prepare(
        "SELECT p.*, r.id AS registration_id FROM afc_players p " +
        "JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "WHERE p.id = ? AND r.manager_uid = ?"
    ).bind(playerId, actor.user.firebase_uid).first();
    if (!player) fail(404, "NOT_FOUND", "The player was not found.");

    const registration = await managerRegistration(actor, player.registration_id);
    if (registration.status !== "approved") {
        fail(409, "REGISTRATION_NOT_APPROVED", "The team must be approved before player profiles can be changed.");
    }

    const body = await readJson(request);
    const bodyKeys = Object.keys(body);
    if (body.publicProfile === undefined ||
        bodyKeys.some(function (key) {
            return key !== "publicProfile" && key !== "publicProfileConsent";
        })) {
        fail(400, "INVALID_INPUT", "Only the public profile setting can be changed here.");
    }

    const publicProfile = validatePublicProfile(
        body.publicProfile, registration, body.publicProfileConsent === true
    );
    await actor.db.prepare(
        "UPDATE afc_players SET public_profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(publicProfile, playerId).run();
    await logAudit(actor.db, actor.user.firebase_uid, "update_player_public_profile", "player", playerId);
    return success({ id: playerId, publicProfile: publicProfile });
}

async function updateAdminPlayerPublicProfile(request, actor, playerId) {
    const player = await actor.db.prepare(
        "SELECT p.id, r.tournament_id, c.guardian_consent_required " +
        "FROM afc_players p JOIN afc_team_registrations r ON r.id = p.registration_id " +
        "JOIN afc_categories c ON c.id = r.category_id WHERE p.id = ?"
    ).bind(playerId).first();
    if (!player) fail(404, "NOT_FOUND", "The player was not found.");
    await requireTournamentScope(actor, player.tournament_id);

    const body = await readJson(request);
    const bodyKeys = Object.keys(body);
    if (body.publicProfile === undefined ||
        bodyKeys.some(function (key) {
            return key !== "publicProfile" && key !== "publicProfileConsent";
        })) {
        fail(400, "INVALID_INPUT", "Only the public profile setting can be changed here.");
    }

    const publicProfile = validatePublicProfile(
        body.publicProfile, player, body.publicProfileConsent === true
    );
    await actor.db.prepare(
        "UPDATE afc_players SET public_profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(publicProfile, playerId).run();
    await logAudit(actor.db, actor.user.firebase_uid, "admin_update_player_public_profile", "player", playerId);
    return success({ id: playerId, publicProfile: publicProfile });
}

async function saveTournamentFormat(request, actor, tournamentId) {
    const tournament = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    await requireTournamentScope(actor, tournamentId);

    const body = await readJson(request);
    let stages;
    try {
        stages = validateTournamentFormat(body.stages);
    } catch (error) {
        if (error instanceof TypeError) fail(400, "INVALID_FORMAT", error.message);
        throw error;
    }
    const existingResult = await actor.db.prepare(
        "SELECT * FROM afc_tournament_stages WHERE tournament_id = ? ORDER BY position"
    ).bind(tournamentId).all();
    const existing = existingResult.results || [];
    const existingById = new Map(existing.map(function (stage) { return [stage.id, stage]; }));
    const retainedIds = new Set();
    stages.forEach(function (stage) {
        if (!stage.id) return;
        if (!existingById.has(stage.id)) {
            fail(400, "INVALID_STAGE", "A stage does not belong to this tournament.");
        }
        retainedIds.add(stage.id);
    });
    const linkedMatches = await actor.db.prepare(
        "SELECT id, stage_id, status, published FROM afc_matches " +
        "WHERE tournament_id = ? AND stage_id IS NOT NULL"
    ).bind(tournamentId).all();
    const linked = linkedMatches.results || [];
    const changedStructure = stages.length !== existing.length ||
        stages.some(function (stage, index) {
            const prior = stage.id ? existingById.get(stage.id) : null;
            return !prior || Number(prior.position) !== index || prior.name !== stage.name ||
                prior.stage_type !== stage.type ||
                prior.participant_source !== stage.participantSource ||
                prior.qualification_json !== JSON.stringify(stage.qualification) ||
                prior.pairing_json !== JSON.stringify(stage.pairing) ||
                prior.settings_json !== JSON.stringify(stage.settings) ||
                (stage.included ? prior.status === "skipped" : prior.status !== "skipped");
        }) || existing.some(function (stage) { return !retainedIds.has(stage.id); });
    const protectedMatches = await actor.db.prepare(
        "SELECT id FROM afc_matches WHERE tournament_id = ? " +
        "AND (published = 1 OR status IN ('live', 'completed'))"
    ).bind(tournamentId).all();
    if (changedStructure && (protectedMatches.results || []).length) {
        fail(409, "FORMAT_LOCKED",
            "The format cannot be changed while public, live, or completed fixtures exist. Use a controlled correction instead.");
    }
    stages.forEach(function (stage) {
        if (!stage.included && stage.id && linked.some(function (match) {
            return match.stage_id === stage.id;
        })) {
            fail(409, "STAGE_HAS_FIXTURES",
                "A stage with existing fixtures cannot be skipped or removed.");
        }
    });
    existing.filter(function (stage) {
        return !retainedIds.has(stage.id);
    }).forEach(function (stage) {
        if (linked.some(function (match) { return match.stage_id === stage.id; })) {
            fail(409, "STAGE_HAS_FIXTURES",
                "A stage with existing fixtures cannot be skipped or removed.");
        }
    });

    const maxPosition = existing.reduce(function (maximum, stage) {
        return Math.max(maximum, Number(stage.position));
    }, 0);
    const offset = maxPosition + stages.length + 2;
    const statements = [];
    if (existing.length) {
        statements.push(actor.db.prepare(
            "UPDATE afc_tournament_stages SET position = position + ? WHERE tournament_id = ?"
        ).bind(offset, tournamentId));
    }
    stages.forEach(function (stage) {
        const prior = stage.id ? existingById.get(stage.id) : null;
        const configurationChanged = Boolean(prior && (
            Number(prior.position) !== stage.position ||
            prior.name !== stage.name ||
            prior.stage_type !== stage.type ||
            prior.participant_source !== stage.participantSource ||
            prior.qualification_json !== JSON.stringify(stage.qualification) ||
            prior.pairing_json !== JSON.stringify(stage.pairing) ||
            prior.settings_json !== JSON.stringify(stage.settings) ||
            (stage.included ? prior.status === "skipped" : prior.status !== "skipped")
        ));
        const status = !stage.included ? "skipped" :
            prior && !configurationChanged && prior.status !== "skipped"
                ? prior.status : "draft";
        const resetApproval = configurationChanged || !stage.included ? 1 : 0;
        const values = [
            stage.name, stage.type, stage.position, status, resetApproval, stage.participantSource,
            JSON.stringify(stage.qualification), JSON.stringify(stage.pairing),
            JSON.stringify(stage.settings), actor.user.firebase_uid
        ];
        if (stage.id) {
            if ((configurationChanged || !stage.included) && prior.status === "approved") {
                statements.push(actor.db.prepare(
                    "DELETE FROM afc_stage_participants WHERE stage_id = ?"
                ).bind(stage.id));
            }
            const updateStage = actor.db.prepare(
                "UPDATE afc_tournament_stages SET name = ?, stage_type = ?, position = ?, status = ?, " +
                "approved_by = CASE WHEN ? = 1 THEN NULL ELSE approved_by END, " +
                "approved_at = CASE WHEN ? = 1 THEN NULL ELSE approved_at END, " +
                "participant_source = ?, qualification_json = ?, pairing_json = ?, settings_json = ?, " +
                "revision = revision + ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            );
            statements.push(updateStage.bind(
                values[0], values[1], values[2], values[3], resetApproval, resetApproval,
                ...values.slice(5, 9), configurationChanged ? 1 : 0, values[9], stage.id
            ));
        } else {
            statements.push(actor.db.prepare(
                "INSERT INTO afc_tournament_stages(id, tournament_id, name, stage_type, position, status, " +
                "participant_source, qualification_json, pairing_json, settings_json, created_by, updated_by) " +
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
                newId("STG-"), tournamentId, stage.name, stage.type, stage.position, status,
                stage.participantSource, JSON.stringify(stage.qualification),
                JSON.stringify(stage.pairing), JSON.stringify(stage.settings),
                actor.user.firebase_uid, actor.user.firebase_uid
            ));
        }
    });
    existing.filter(function (stage) { return !retainedIds.has(stage.id); }).forEach(function (stage) {
        statements.push(actor.db.prepare(
            "UPDATE afc_tournament_stages SET status = 'skipped', position = ?, revision = revision + 1, " +
            "updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(offset + Number(stage.position), actor.user.firebase_uid, stage.id));
    });
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid, "save_tournament_format",
        "tournament", tournamentId, JSON.stringify({
            stages: stages.map(function (stage) {
                return {
                    id: stage.id || null, name: stage.name, type: stage.type,
                    position: stage.position, status: stage.included ? "draft" : "skipped",
                    participantSource: stage.participantSource,
                    qualification: stage.qualification,
                    pairing: stage.pairing,
                    settings: stage.settings
                };
            })
        })
    ));
    await actor.db.batch(statements);
    return success({ tournamentId: tournamentId, stages: stages.length });
}

async function resetTournamentProgress(request, actor, tournamentId) {
    const tournament = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    await requireTournamentScope(actor, tournamentId);

    const body = await readJson(request);
    if (body.confirmReset !== true) {
        fail(400, "RESET_CONFIRMATION_REQUIRED",
            "Explicit confirmation is required before resetting tournament progress.");
    }

    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
            "VALUES(?, ?, 'reset_tournament_progress', 'tournament', ?, json_object(" +
            "'fixtures', (SELECT COUNT(*) FROM afc_matches WHERE tournament_id = ?), " +
            "'publishedFixtures', (SELECT COUNT(*) FROM afc_matches WHERE tournament_id = ? AND published = 1), " +
            "'completedFixtures', (SELECT COUNT(*) FROM afc_matches WHERE tournament_id = ? AND status = 'completed'), " +
            "'results', (SELECT COUNT(*) FROM afc_matches WHERE tournament_id = ? " +
                "AND (home_score IS NOT NULL OR away_score IS NOT NULL)), " +
            "'matchEvents', (SELECT COUNT(*) FROM afc_match_events e " +
                "JOIN afc_matches m ON m.id = e.match_id WHERE m.tournament_id = ?), " +
            "'matchOfficials', (SELECT COUNT(*) FROM afc_match_officials o " +
                "JOIN afc_matches m ON m.id = o.match_id WHERE m.tournament_id = ?), " +
            "'groups', (SELECT COUNT(*) FROM afc_tournament_groups WHERE tournament_id = ?), " +
            "'groupAllocations', (SELECT COUNT(*) FROM afc_group_teams gt " +
                "JOIN afc_tournament_groups g ON g.id = gt.group_id WHERE g.tournament_id = ?), " +
            "'stages', (SELECT COUNT(*) FROM afc_tournament_stages WHERE tournament_id = ?), " +
            "'participants', (SELECT COUNT(*) FROM afc_stage_participants p " +
                "JOIN afc_tournament_stages s ON s.id = p.stage_id WHERE s.tournament_id = ?), " +
            "'approvals', (SELECT COUNT(*) FROM afc_stage_approvals a " +
                "JOIN afc_tournament_stages s ON s.id = a.stage_id WHERE s.tournament_id = ?)))"
        ).bind(
            newId("AUD-"), actor.user.firebase_uid, tournamentId,
            tournamentId, tournamentId, tournamentId, tournamentId, tournamentId, tournamentId,
            tournamentId, tournamentId, tournamentId, tournamentId, tournamentId
        ),
        actor.db.prepare(
            "DELETE FROM afc_match_events WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_match_officials WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_matches WHERE tournament_id = ?"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_stage_participants WHERE stage_id IN " +
            "(SELECT id FROM afc_tournament_stages WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_stage_approvals WHERE stage_id IN " +
            "(SELECT id FROM afc_tournament_stages WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_tournament_stages WHERE tournament_id = ?"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_group_teams WHERE group_id IN " +
            "(SELECT id FROM afc_tournament_groups WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "DELETE FROM afc_tournament_groups WHERE tournament_id = ?"
        ).bind(tournamentId),
        actor.db.prepare(
            "UPDATE afc_tournaments SET standings_available = 0, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = ?"
        ).bind(tournamentId)
    ];
    try {
        await actor.db.batch(statements);
    } catch (error) {
        console.error("Tournament progress reset batch failed.", {
            requestId: request.headers.get("cf-ray"),
            errorName: error && error.name ? error.name : "Error",
            errorMessage: String(error && error.message ? error.message : error).slice(0, 500)
        });
        throw error;
    }
    return success({ tournamentId: tournamentId, reset: true });
}

async function resetTournamentStage(request, actor, tournamentId, stageId) {
    const tournament = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    await requireTournamentScope(actor, tournamentId);
    const stage = await actor.db.prepare(
        "SELECT id, name, stage_type, position, status FROM afc_tournament_stages " +
        "WHERE id = ? AND tournament_id = ?"
    ).bind(stageId, tournamentId).first();
    if (!stage) fail(404, "NOT_FOUND", "The tournament stage was not found.");
    if (stage.status === "skipped") {
        fail(409, "STAGE_NOT_RESTARTABLE", "Reinclude and save this stage before restarting it.");
    }

    const body = await readJson(request);
    if (body.confirmReset !== true) {
        fail(400, "RESET_CONFIRMATION_REQUIRED",
            "Explicit confirmation is required before restarting a stage.");
    }

    const affectedStages = await actor.db.prepare(
        "SELECT id, name, stage_type, position, status FROM afc_tournament_stages " +
        "WHERE tournament_id = ? AND position >= ? ORDER BY position"
    ).bind(tournamentId, stage.position).all();
    const stageRows = affectedStages.results || [];
    if (!stageRows.length || stageRows[0].id !== stageId) {
        fail(409, "STAGE_CHANGED", "The stage order changed. Reload and try again.");
    }
    const stageIds = stageRows.map(function (row) { return row.id; });
    const stageIdPlaceholders = stageIds.map(function () { return "?"; }).join(", ");
    const stageIdFilter = "IN (" + stageIdPlaceholders + ")";
    const summary = await actor.db.prepare(
        "WITH reset_stages AS (" +
            "SELECT id FROM afc_tournament_stages WHERE id " + stageIdFilter + ") " +
        "SELECT (SELECT COUNT(*) FROM reset_stages) AS stage_count, " +
        "(SELECT COUNT(*) FROM afc_matches WHERE stage_id IN (SELECT id FROM reset_stages)) AS fixture_count, " +
        "(SELECT COUNT(*) FROM afc_match_events WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE stage_id IN (SELECT id FROM reset_stages))) AS event_count, " +
        "(SELECT COUNT(*) FROM afc_match_officials WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE stage_id IN (SELECT id FROM reset_stages))) AS official_count, " +
        "(SELECT COUNT(*) FROM afc_stage_participants WHERE stage_id IN " +
            "(SELECT id FROM reset_stages)) AS participant_count, " +
        "(SELECT COUNT(*) FROM afc_stage_approvals WHERE stage_id IN " +
            "(SELECT id FROM reset_stages)) AS approval_count"
    ).bind(...stageIds).first();
    const resetDetails = {
        tournamentId: tournamentId,
        startingStage: { id: stage.id, name: stage.name, position: stage.position },
        resetStages: stageRows.map(function (row) {
            return {
                id: row.id, name: row.name, type: row.stage_type,
                position: row.position, priorStatus: row.status
            };
        }),
        stageCount: Number(summary.stage_count || 0),
        deleted: {
            fixtures: Number(summary.fixture_count || 0),
            matchEvents: Number(summary.event_count || 0),
            matchOfficials: Number(summary.official_count || 0),
            participants: Number(summary.participant_count || 0),
            approvals: Number(summary.approval_count || 0)
        }
    };
    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
            "VALUES(?, ?, 'restart_tournament_stage', 'tournament_stage', ?, ?)"
        ).bind(
            newId("AUD-"), actor.user.firebase_uid, stageId, JSON.stringify(resetDetails)
        ),
        actor.db.prepare(
            "DELETE FROM afc_match_events WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE stage_id " + stageIdFilter + ")"
        ).bind(...stageIds),
        actor.db.prepare(
            "DELETE FROM afc_match_officials WHERE match_id IN " +
            "(SELECT id FROM afc_matches WHERE stage_id " + stageIdFilter + ")"
        ).bind(...stageIds),
        actor.db.prepare(
            "DELETE FROM afc_matches WHERE stage_id " + stageIdFilter
        ).bind(...stageIds),
        actor.db.prepare(
            "DELETE FROM afc_stage_participants WHERE stage_id " + stageIdFilter
        ).bind(...stageIds),
        actor.db.prepare(
            "DELETE FROM afc_stage_approvals WHERE stage_id " + stageIdFilter
        ).bind(...stageIds),
        actor.db.prepare(
            "UPDATE afc_tournament_stages SET status = CASE WHEN status = 'skipped' THEN 'skipped' " +
            "ELSE 'draft' END, pairing_json = '{}', approved_by = NULL, approved_at = NULL, " +
            "revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id " + stageIdFilter
        ).bind(actor.user.firebase_uid, ...stageIds)
    ];
    if (stageRows.some(function (row) {
        return row.stage_type === "group" || row.stage_type === "league";
    })) {
        statements.push(actor.db.prepare(
            "UPDATE afc_tournaments SET standings_available = 0, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = ?"
        ).bind(tournamentId));
    }
    try {
        await actor.db.batch(statements);
    } catch (error) {
        console.error("Tournament stage restart batch failed.", {
            requestId: request.headers.get("cf-ray"),
            tournamentId: tournamentId,
            stageId: stageId,
            errorName: error && error.name ? error.name : "Error",
            errorMessage: String(error && error.message ? error.message : error).slice(0, 500)
        });
        throw error;
    }
    return success({
        stageId: stageId,
        status: "draft",
        resetStageIds: stageIds,
        deletedFixtures: Number(summary.fixture_count || 0)
    });
}

function pairRoundRobin(teamIds) {
    const participants = teamIds.slice();
    if (participants.length % 2) participants.push(null);
    const rounds = [];
    for (let round = 0; round < participants.length - 1; round += 1) {
        const pairings = [];
        for (let index = 0; index < participants.length / 2; index += 1) {
            const home = participants[index];
            const away = participants[participants.length - 1 - index];
            if (home !== null && away !== null) pairings.push([home, away]);
        }
        rounds.push(pairings);
        participants.splice(1, 0, participants.pop());
    }
    return rounds;
}

export function resolveMatchWinner(match) {
    if (!match || match.home_score === null || match.home_score === undefined ||
        match.away_score === null || match.away_score === undefined) return null;
    if (match.home_score > match.away_score) return match.home_team_id;
    if (match.away_score > match.home_score) return match.away_team_id;
    if (match.tie_break_method === "extra-time" &&
        match.home_extra_time_score !== null && match.home_extra_time_score !== undefined &&
        match.away_extra_time_score !== null && match.away_extra_time_score !== undefined &&
        match.home_extra_time_score !== match.away_extra_time_score) {
        return match.home_extra_time_score > match.away_extra_time_score
            ? match.home_team_id : match.away_team_id;
    }

    if (match.tie_break_method === "penalties" &&
        match.home_penalties_score !== null && match.home_penalties_score !== undefined &&
        match.away_penalties_score !== null && match.away_penalties_score !== undefined &&
        match.home_penalties_score !== match.away_penalties_score) {
        return match.home_penalties_score > match.away_penalties_score
            ? match.home_team_id : match.away_team_id;
    }
    return null;
}

export function isPublishedMatchResult(match) {
    return Boolean(match && Number(match.published) === 1 && match.status === "completed" &&
        match.home_score !== null && match.home_score !== undefined &&
        match.away_score !== null && match.away_score !== undefined);
}

async function calculateOverallStandings(db, tournamentId) {
    const approved = await db.prepare(
        "SELECT r.team_id, tm.name FROM afc_team_registrations r " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "WHERE r.tournament_id = ? AND r.status = 'approved'"
    ).bind(tournamentId).all();
    const stats = new Map();
    (approved.results || []).forEach(function (row) {
        stats.set(row.team_id, {
            teamId: row.team_id, name: row.name, played: 0,
            points: 0, goalDifference: 0, goalsFor: 0
        });
    });
    const matches = await db.prepare(
        "SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score, " +
        "m.status, m.published FROM afc_matches m " +
        "LEFT JOIN afc_tournament_stages s ON s.id = m.stage_id " +
        "WHERE m.tournament_id = ? AND (s.stage_type = 'league' OR " +
        "(m.stage_id IS NULL AND lower(m.stage) IN ('league', 'round-robin')))"
    ).bind(tournamentId).all();
    const rows = matches.results || [];
    const teamCount = stats.size;
    const expectedMatches = teamCount * (teamCount - 1) / 2;
    if (teamCount < 2 || rows.length !== expectedMatches ||
        rows.some(function (match) {
            return Number(match.published) !== 1 || match.status !== "completed" ||
                match.home_score === null || match.away_score === null;
        })) {
        fail(409, "LEAGUE_STAGE_INCOMPLETE",
            "Every league match must have an approved result before overall qualification.");
    }
    const scheduledPairs = new Set();
    rows.forEach(function (match) {
        if (!stats.has(match.home_team_id) || !stats.has(match.away_team_id) ||
            match.home_team_id === match.away_team_id) {
            fail(409, "LEAGUE_FIXTURE_INVALID",
                "A league fixture contains a team outside the approved tournament entries.");
        }
        const pair = [match.home_team_id, match.away_team_id].sort().join(":");
        if (scheduledPairs.has(pair)) {
            fail(409, "LEAGUE_FIXTURE_DUPLICATE",
                "Duplicate league fixtures must be corrected before overall qualification.");
        }
        scheduledPairs.add(pair);
    });
    rows.forEach(function (match) {
        const home = stats.get(match.home_team_id);
        const away = stats.get(match.away_team_id);
        if (!home || !away || home.teamId === away.teamId) {
            fail(409, "LEAGUE_FIXTURE_INVALID", "A league fixture contains an invalid participant.");
        }
        home.played += 1;
        away.played += 1;
        home.goalsFor += match.home_score;
        away.goalsFor += match.away_score;
        home.goalDifference += match.home_score - match.away_score;
        away.goalDifference += match.away_score - match.home_score;
        if (match.home_score > match.away_score) home.points += 3;
        else if (match.home_score < match.away_score) away.points += 3;
        else {
            home.points += 1;
            away.points += 1;
        }
    });
    return Array.from(stats.values()).sort(function (left, right) {
        return right.points - left.points ||
            right.goalDifference - left.goalDifference ||
            right.goalsFor - left.goalsFor ||
            left.name.localeCompare(right.name);
    });
}

export function buildRoundRobinFixtures(groups) {
    if (!Array.isArray(groups)) throw new TypeError("Groups must be an array.");
    return groups.flatMap(function (group) {
        if (!group || typeof group.id !== "string" || !Array.isArray(group.teamIds) ||
            group.teamIds.length < 2 || group.teamIds.length > 64 ||
            new Set(group.teamIds).size !== group.teamIds.length) {
            throw new TypeError("Each group needs a unique list of at least two teams.");
        }
        return pairRoundRobin(group.teamIds).flatMap(function (round, roundIndex) {
            return round.map(function (pair, matchIndex) {
                return {
                    groupId: group.id, round: "Round " + (roundIndex + 1),
                    matchIndex: matchIndex, homeTeamId: pair[0], awayTeamId: pair[1]
                };
            });
        });
    });
}

async function calculateStageParticipants(db, tournamentId, stage) {
    const qualification = JSON.parse(stage.qualification_json || "{}");
    if (stage.participant_source === "approved_teams" ||
        stage.participant_source === "manual") {
        const rows = await db.prepare(
            "SELECT team_id FROM afc_team_registrations " +
            "WHERE tournament_id = ? AND status = 'approved' ORDER BY team_id"
        ).bind(tournamentId).all();
        return (rows.results || []).map(function (row) { return row.team_id; });
    }
    if (stage.participant_source === "group_positions") {
        const count = Number(qualification.qualifiersPerGroup);
        if (!Number.isInteger(count) || count < 1 || count > 64) {
            fail(400, "INVALID_QUALIFICATION", "Configure a valid qualifier count per group.");
        }
        const tables = (await standings(db, tournamentId)).filter(function (table) {
            return table.type === "group";
        });
        const pending = await db.prepare(
            "SELECT g.id, (SELECT COUNT(*) FROM afc_group_teams gt WHERE gt.group_id = g.id) AS team_count, " +
            "(SELECT COUNT(*) FROM afc_matches m WHERE m.group_id = g.id) AS match_count, " +
            "(SELECT COUNT(*) FROM afc_matches m WHERE m.group_id = g.id AND m.published = 1 " +
            "AND m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL) " +
            "AS complete_count FROM afc_tournament_groups g WHERE g.tournament_id = ?"
        ).bind(tournamentId).all();
        const groupRows = pending.results || [];
        if (!groupRows.length || groupRows.some(function (row) {
            const teamCount = Number(row.team_count || 0);
            const expectedMatches = teamCount * (teamCount - 1) / 2;
            return teamCount < 2 || Number(row.complete_count || 0) !== expectedMatches ||
                Number(row.match_count || 0) !== expectedMatches;
        })) {
            fail(409, "GROUP_STAGE_INCOMPLETE",
                "Every group must have all round-robin matches published and completed before calculated qualification.");
        }
        const members = await db.prepare(
            "SELECT g.id AS group_id, gt.team_id FROM afc_tournament_groups g " +
            "JOIN afc_group_teams gt ON gt.group_id = g.id WHERE g.tournament_id = ?"
        ).bind(tournamentId).all();
        const matches = await db.prepare(
            "SELECT m.group_id, m.home_team_id, m.away_team_id FROM afc_matches m " +
            "JOIN afc_tournament_groups g ON g.id = m.group_id " +
            "WHERE g.tournament_id = ?"
        ).bind(tournamentId).all();
        const groupTeams = new Map();
        (members.results || []).forEach(function (row) {
            if (!groupTeams.has(row.group_id)) groupTeams.set(row.group_id, new Set());
            groupTeams.get(row.group_id).add(row.team_id);
        });
        const groupPairs = new Map();
        (matches.results || []).forEach(function (match) {
            const teams = groupTeams.get(match.group_id);
            if (!teams || !teams.has(match.home_team_id) || !teams.has(match.away_team_id) ||
                match.home_team_id === match.away_team_id) {
                fail(409, "GROUP_FIXTURE_INVALID",
                    "A group fixture does not match the approved group allocation.");
            }
            if (!groupPairs.has(match.group_id)) groupPairs.set(match.group_id, new Set());
            const pair = [match.home_team_id, match.away_team_id].sort().join(":");
            if (groupPairs.get(match.group_id).has(pair)) {
                fail(409, "GROUP_FIXTURE_DUPLICATE",
                    "Duplicate group fixtures must be corrected before qualification.");
            }
            groupPairs.get(match.group_id).add(pair);
        });
        groupRows.forEach(function (group) {
            const teams = Array.from(groupTeams.get(group.id) || []);
            const pairs = groupPairs.get(group.id) || new Set();
            if (pairs.size !== teams.length * (teams.length - 1) / 2) {
                fail(409, "GROUP_FIXTURE_INCOMPLETE",
                    "Every pair of teams must have played exactly once before qualification.");
            }
        });
        const positions = Array.isArray(qualification.positions)
            ? qualification.positions
            : Array.from({ length: count }, function (_item, index) { return index + 1; });
        if (positions.some(function (position) {
            return !Number.isInteger(position) || position < 1 || position > 64;
        })) {
            fail(400, "INVALID_QUALIFICATION", "Group finishing positions must be positive integers.");
        }
        const selected = [];
        tables.forEach(function (group) {
            positions.forEach(function (position) {
                if (!group.teams[position - 1]) {
                    fail(400, "INVALID_QUALIFICATION",
                        "A configured group position does not exist in every group.");
                }
                const current = group.teams[position - 1];
                const next = group.teams[position];
                if (current && next && current.points === next.points &&
                    current.goalDifference === next.goalDifference &&
                    current.goalsFor === next.goalsFor) {
                    fail(409, "QUALIFICATION_TIE_REQUIRES_DECISION",
                        "A tie at a qualification position requires an authorised tie-break decision before approval.");
                }
            });
            positions.forEach(function (position) {
                if (group.teams[position - 1]) selected.push(group.teams[position - 1].teamId);
            });
        });
        return selected;
    }
    if (stage.participant_source === "overall_standings") {
        const count = Number(qualification.count);
        if (!Number.isInteger(count) || count < 1 || count > 256) {
            fail(400, "INVALID_QUALIFICATION", "Configure a valid overall qualifier count.");
        }
        const ranked = await calculateOverallStandings(db, tournamentId);
        if (ranked.length < count) {
            fail(400, "INVALID_QUALIFICATION",
                "The configured overall qualifier count exceeds the number of approved teams.");
        }
        const boundary = ranked[count - 1];
        const next = ranked[count];
        if (boundary && next && boundary.points === next.points &&
            boundary.goalDifference === next.goalDifference && boundary.goalsFor === next.goalsFor) {
            fail(409, "QUALIFICATION_TIE_REQUIRES_DECISION",
                "A tie at the qualification cutoff requires an authorised tie-break decision before approval.");
        }
        return ranked.slice(0, count).map(function (team) { return team.teamId; });
    }
    if (stage.participant_source === "match_winners" ||
        stage.participant_source === "match_losers") {
        const previousStages = await db.prepare(
            "SELECT id, status, pairing_json, stage_type FROM afc_tournament_stages " +
            "WHERE tournament_id = ? AND position < ? AND status <> 'skipped' ORDER BY position DESC"
        ).bind(tournamentId, stage.position).all();
        const previousStage = (previousStages.results || []).find(function (candidate) {
            return isRequiredProgressionStage(candidate.stage_type);
        });
        if (!previousStage || previousStage.status !== "completed") {
            fail(409, "PREVIOUS_STAGE_INCOMPLETE",
                "Complete the previous competitive stage before selecting teams from its results.");
        }
        const sourceMatches = await db.prepare(
            "SELECT id, home_team_id, away_team_id, home_score, away_score, status, published, " +
            "tie_break_method, home_extra_time_score, away_extra_time_score, " +
            "home_penalties_score, away_penalties_score FROM afc_matches " +
            "WHERE stage_id = ? ORDER BY kickoff, id"
        ).bind(previousStage.id).all();
        let matches = sourceMatches.results || [];
        if (Array.isArray(qualification.matchIds) && qualification.matchIds.length) {
            const matchById = new Map(matches.map(function (match) { return [match.id, match]; }));
            if (qualification.matchIds.some(function (matchId) { return !matchById.has(matchId); })) {
                fail(400, "INVALID_QUALIFICATION",
                    "Every selected source match must belong to the completed previous stage.");
            }
            matches = qualification.matchIds.map(function (matchId) { return matchById.get(matchId); });
        }
        if (!matches.length) {
            fail(409, "SOURCE_MATCHES_MISSING",
                "The previous stage has no saved fixtures to use for qualification.");
        }
        const result = [];
        for (const match of matches) {
            if (Number(match.published) !== 1 || match.status !== "completed" ||
                match.home_score === null || match.away_score === null) {
                fail(409, "SOURCE_MATCH_UNRESOLVED",
                    "Progression requires published, completed source matches with approved winners.");
            }
            const winner = resolveMatchWinner(match);
            if (!winner) {
                fail(409, "SOURCE_MATCH_UNRESOLVED",
                    "Progression requires published, completed source matches with approved winners.");
            }
            result.push(stage.participant_source === "match_winners"
                ? winner
                : winner === match.home_team_id ? match.away_team_id : match.home_team_id);
        }
        if (stage.participant_source === "match_winners") {
            const previousPairings = JSON.parse(previousStage.pairing_json || "{}").pairings || [];
            previousPairings.forEach(function (pairing) {
                if (Array.isArray(pairing.teamIds) && pairing.teamIds.length === 1) {
                    result.push(pairing.teamIds[0]);
                }
            });
        }
        return result;
    }
    fail(400, "INVALID_PARTICIPANT_SOURCE", "The participant source cannot be calculated.");
}

async function approveTournamentStage(request, actor, tournamentId, stageId) {
    const tournament = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    await requireTournamentScope(actor, tournamentId);
    const stage = await actor.db.prepare(
        "SELECT * FROM afc_tournament_stages WHERE id = ? AND tournament_id = ?"
    ).bind(stageId, tournamentId).first();
    if (!stage) fail(404, "NOT_FOUND", "The tournament stage was not found.");
    const previousStages = await actor.db.prepare(
        "SELECT name, stage_type, status FROM afc_tournament_stages " +
        "WHERE tournament_id = ? AND position < ? AND status <> 'skipped' ORDER BY position"
    ).bind(tournamentId, stage.position).all();
    if ((previousStages.results || []).some(function (previous) {
        return isRequiredProgressionStage(previous.stage_type) && previous.status !== "completed";
    })) {
        fail(409, "PREVIOUS_STAGE_INCOMPLETE",
            "Complete every previous competitive stage before approving progression.");
    }
    if (stage.status !== "draft" && stage.status !== "awaiting_approval") {
        fail(409, "STAGE_NOT_EDITABLE", "Only a draft stage can be approved.");
    }
    const body = await readJson(request);
    if (!Array.isArray(body.teamIds) || body.teamIds.length < 2 ||
        body.teamIds.length > 256 || new Set(body.teamIds).size !== body.teamIds.length) {
        fail(400, "INVALID_PARTICIPANTS", "Select each stage participant exactly once.");
    }
    const teamIds = body.teamIds.map(function (id) { return validId(id, "Team"); });
    const eligibleResult = await actor.db.prepare(
        "SELECT team_id FROM afc_team_registrations " +
        "WHERE tournament_id = ? AND status = 'approved'"
    ).bind(tournamentId).all();
    const eligible = new Set((eligibleResult.results || []).map(function (row) { return row.team_id; }));
    if (teamIds.some(function (id) { return !eligible.has(id); })) {
        fail(400, "INVALID_PARTICIPANTS",
            "Every selected participant must be an approved team in this tournament.");
    }
    if (stage.stage_type === "group") {
        const allocation = await actor.db.prepare(
            "SELECT g.id AS group_id, gt.team_id FROM afc_tournament_groups g " +
            "LEFT JOIN afc_group_teams gt ON gt.group_id = g.id WHERE g.tournament_id = ?"
        ).bind(tournamentId).all();
        const rows = allocation.results || [];
        const assigned = new Set();
        const groupCounts = new Map();
        rows.forEach(function (row) {
            if (!groupCounts.has(row.group_id)) groupCounts.set(row.group_id, 0);
            if (!row.team_id) return;
            groupCounts.set(row.group_id, groupCounts.get(row.group_id) + 1);
            if (assigned.has(row.team_id)) {
                fail(409, "GROUP_ALLOCATION_INVALID",
                    "Each approved team must belong to exactly one group before the group stage can be approved.");
            }
            assigned.add(row.team_id);
        });
        if (!groupCounts.size || Array.from(groupCounts.values()).some(function (count) {
            return count < 2;
        }) || assigned.size !== teamIds.length ||
            teamIds.some(function (teamId) { return !assigned.has(teamId); })) {
            fail(409, "GROUP_ALLOCATION_INCOMPLETE",
                "Save groups with at least two approved teams in each group before approving the group stage.");
        }
    }
    const reason = text(body.reason || "", "Manual selection reason", { max: 1000 });
    let calculated;
    let tieRequiresDecision = false;
    try {
        calculated = await calculateStageParticipants(actor.db, tournamentId, stage);
    } catch (error) {
        if (error instanceof HttpError &&
            error.code === "QUALIFICATION_TIE_REQUIRES_DECISION" &&
            body.confirmOverride === true && reason.length >= 8) {
            calculated = [];
            tieRequiresDecision = true;
        } else {
            throw error;
        }
    }
    const calculatedSet = new Set(calculated);
    const matchesCalculation = calculated.length === teamIds.length &&
        calculatedSet.size === teamIds.length &&
        teamIds.every(function (id) { return calculatedSet.has(id); });
    if ((!matchesCalculation || tieRequiresDecision) &&
        (body.confirmOverride !== true || reason.length < 8)) {
        fail(400, "OVERRIDE_REASON_REQUIRED",
            "Confirm the manual qualification override and provide a reason of at least 8 characters.");
    }
    const generatedSchedule = stage.stage_type === "group" || stage.stage_type === "league";
    if (!Array.isArray(body.pairings) || body.pairings.length > 128 ||
        (!generatedSchedule && body.pairings.length < 1)) {
        fail(400, "INVALID_PAIRINGS", "Provide the approved pairings for this stage.");
    }
    const seen = new Set();
    const pairings = body.pairings.map(function (pairing) {
        if (!pairing || !Array.isArray(pairing.teamIds) ||
            pairing.teamIds.length < 1 || pairing.teamIds.length > 2) {
            fail(400, "INVALID_PAIRINGS", "A pairing must contain two teams or one explicit bye.");
        }
        const ids = pairing.teamIds.map(function (id) { return validId(id, "Team"); });
        if (ids.length === 2 && ids[0] === ids[1]) {
            fail(400, "INVALID_PAIRINGS", "A team cannot play itself.");
        }
        ids.forEach(function (id) {
            if (teamIds.indexOf(id) === -1 || seen.has(id)) {
                fail(400, "INVALID_PAIRINGS",
                    "Pairings must use every selected participant exactly once.");
            }
            seen.add(id);
        });
        return { teamIds: ids };
    });
    if (!generatedSchedule && teamIds.some(function (id) { return !seen.has(id); })) {
        fail(400, "INVALID_PAIRINGS",
            "Assign every selected participant to a match or an explicit bye.");
    }
    if (stage.stage_type === "final" &&
        (teamIds.length !== 2 || pairings.length !== 1 || pairings[0].teamIds.length !== 2)) {
        fail(400, "INVALID_FINAL", "A final requires exactly two participants and one pairing.");
    }
    if (!generatedSchedule && !pairings.some(function (pairing) {
        return pairing.teamIds.length === 2;
    })) {
        fail(400, "NO_MATCH_PAIRINGS", "A stage needs at least one actual fixture pairing.");
    }
    const updateStage = actor.db.prepare(
        "UPDATE afc_tournament_stages SET status = 'approved', pairing_json = ?, approved_by = ?, " +
        "approved_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_by = ?, " +
        "updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ? " +
        "AND status IN ('draft', 'awaiting_approval')"
    ).bind(
        JSON.stringify({ pairings: pairings }), actor.user.firebase_uid,
        actor.user.firebase_uid, stageId, stage.revision
    );
    const statements = [
        actor.db.prepare(
            "INSERT INTO afc_stage_approvals(stage_id, revision, actor_uid, details_json) " +
            "VALUES(?, ?, ?, ?)"
        ).bind(stageId, stage.revision, actor.user.firebase_uid, JSON.stringify({
            teamIds: teamIds, pairings: pairings, overrideReason: reason || null
        })),
        updateStage,
        actor.db.prepare("DELETE FROM afc_stage_participants WHERE stage_id = ?").bind(stageId)
    ];
    teamIds.forEach(function (teamId, index) {
        statements.push(actor.db.prepare(
            "INSERT INTO afc_stage_participants(stage_id, team_id, source, seed, selected_by) " +
            "VALUES(?, ?, ?, ?, ?)"
        ).bind(
            stageId, teamId, matchesCalculation && !tieRequiresDecision
                ? stage.participant_source : "manual_override",
            index + 1, actor.user.firebase_uid
        ));
    });
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid, "approve_tournament_stage",
        "tournament_stage", stageId, JSON.stringify({
            tournamentId: tournamentId, teamIds: teamIds, pairings: pairings,
            overrideReason: reason || null
        })
    ));
    try {
        await actor.db.batch(statements);
    } catch (error) {
        if (String(error && error.message || "").indexOf("stage approval is stale") !== -1) {
            fail(409, "STAGE_CHANGED_CONCURRENTLY",
                "The stage changed while approval was being submitted. Reload and review it again.");
        }
        throw error;
    }
    return success({
        stageId: stageId, status: "approved", teamIds: teamIds,
        pairings: pairings, overrideReason: reason || null
    });
}

async function completeTournamentStage(actor, tournamentId, stageId) {
    await requireTournamentScope(actor, tournamentId);
    const stage = await actor.db.prepare(
        "SELECT id, status, stage_type, pairing_json FROM afc_tournament_stages " +
        "WHERE id = ? AND tournament_id = ?"
    ).bind(stageId, tournamentId).first();
    if (!stage) fail(404, "NOT_FOUND", "The tournament stage was not found.");
    if (stage.status !== "published" && stage.status !== "in_progress") {
        fail(409, "STAGE_NOT_IN_PROGRESS", "Only a published or in-progress stage can be completed.");
    }
    const matches = await actor.db.prepare(
        "SELECT id, group_id, home_team_id, away_team_id, status, published, home_score, away_score " +
        "FROM afc_matches " +
        "WHERE stage_id = ?"
    ).bind(stageId).all();
    const rows = matches.results || [];
    const pairKey = function (homeTeamId, awayTeamId) {
        return [homeTeamId, awayTeamId].sort().join(":");
    };
    let expectedPairs = [];
    if (stage.stage_type === "group") {
        const allocation = await actor.db.prepare(
            "SELECT g.id AS group_id, gt.team_id FROM afc_tournament_groups g " +
            "LEFT JOIN afc_group_teams gt ON gt.group_id = g.id " +
            "WHERE g.tournament_id = ? ORDER BY g.position, gt.team_id"
        ).bind(tournamentId).all();
        const groups = new Map();
        (allocation.results || []).forEach(function (row) {
            if (!groups.has(row.group_id)) groups.set(row.group_id, []);
            if (row.team_id) groups.get(row.group_id).push(row.team_id);
        });
        if (!groups.size || Array.from(groups.values()).some(function (teamIds) {
            return teamIds.length < 2;
        })) {
            fail(409, "STAGE_FIXTURES_INCOMPLETE",
                "Complete the saved group allocation before completing the group stage.");
        }
        groups.forEach(function (teamIds, groupId) {
            for (let first = 0; first < teamIds.length; first += 1) {
                for (let second = first + 1; second < teamIds.length; second += 1) {
                    expectedPairs.push(groupId + ":" + pairKey(teamIds[first], teamIds[second]));
                }
            }
        });
    } else if (stage.stage_type === "league") {
        const participants = await actor.db.prepare(
            "SELECT team_id FROM afc_stage_participants WHERE stage_id = ? ORDER BY seed"
        ).bind(stageId).all();
        const teamIds = (participants.results || []).map(function (row) { return row.team_id; });
        if (teamIds.length < 2) {
            fail(409, "STAGE_FIXTURES_INCOMPLETE",
                "At least two approved participants are required to complete the league stage.");
        }
        expectedPairs = buildRoundRobinFixtures([{ id: "league", teamIds: teamIds }])
            .map(function (pairing) { return pairKey(pairing.homeTeamId, pairing.awayTeamId); });
    } else {
        const pairingData = JSON.parse(stage.pairing_json || "{}");
        expectedPairs = (Array.isArray(pairingData.pairings) ? pairingData.pairings : [])
            .filter(function (pairing) {
                return Array.isArray(pairing.teamIds) && pairing.teamIds.length === 2;
            })
            .map(function (pairing) { return pairKey(pairing.teamIds[0], pairing.teamIds[1]); });
    }
    const actualPairs = rows.map(function (match) {
        const pair = pairKey(match.home_team_id, match.away_team_id);
        return stage.stage_type === "group" ? match.group_id + ":" + pair : pair;
    });
    const expectedSet = new Set(expectedPairs);
    const actualSet = new Set(actualPairs);
    if (!expectedPairs.length || rows.length !== expectedPairs.length ||
        actualSet.size !== actualPairs.length || actualPairs.some(function (pair) {
            return !expectedSet.has(pair);
        })) {
        fail(409, "STAGE_FIXTURES_INCOMPLETE",
            "Create every approved match pairing from the Fixtures menu before completing this stage.");
    }
    if (!rows.length || rows.some(function (match) {
        return Number(match.published) !== 1 || match.status !== "completed" ||
            match.home_score === null || match.away_score === null;
    })) {
        fail(409, "STAGE_MATCHES_OUTSTANDING",
            "Every fixture in the stage must have a published, completed result before the stage can be completed.");
    }
    if (stage.stage_type !== "group" && stage.stage_type !== "league" && rows.some(function (match) {
        return match.home_score === match.away_score;
    })) {
        fail(409, "KNOCKOUT_WINNER_REQUIRED",
            "A knockout match without an approved winner prevents stage completion.");
    }
    try {
        await actor.db.batch([
            actor.db.prepare(
                "UPDATE afc_tournament_stages SET status = 'completed', revision = revision + 1, " +
                "updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('published', 'in_progress')"
            ).bind(actor.user.firebase_uid, stageId),
            actor.db.prepare(
                "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
                "VALUES(?, ?, ?, ?, ?, ?)"
            ).bind(
                newId("AUD-"), actor.user.firebase_uid, "complete_tournament_stage",
                "tournament_stage", stageId, JSON.stringify({ tournamentId: tournamentId })
            )
        ]);
    } catch (error) {
        if (String(error && error.message || "").indexOf(
            "stage completion requires resolved published results"
        ) !== -1) {
            fail(409, "STAGE_MATCHES_OUTSTANDING",
                "A stage result changed during completion. Reload the fixtures and try again.");
        }
        throw error;
    }
    return success({ stageId: stageId, status: "completed" });
}

async function allocateTournamentGroups(request, actor, tournamentId) {
    const tournament = await actor.db.prepare(
        "SELECT id FROM afc_tournaments WHERE id = ?"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    await requireTournamentScope(actor, tournamentId);

    const body = await readJson(request);
    const saveNamesOnly = body.saveNamesOnly === true;
    if (!Array.isArray(body.groups) || body.groups.length > 32 ||
        (!saveNamesOnly && body.groups.length < 1)) {
        fail(400, "INVALID_GROUPS", saveNamesOnly
            ? "Provide no more than 32 group names."
            : "Provide between 1 and 32 groups.");
    }
    const groups = [];
    const groupNames = new Set();
    const teamAssignment = new Map();
    body.groups.forEach(function (group, index) {
        if (!group || !Array.isArray(group.teamIds) ||
            (saveNamesOnly ? group.teamIds.length !== 0 :
                (group.teamIds.length < 1 || group.teamIds.length > 64))) {
            fail(400, "INVALID_GROUPS", saveNamesOnly
                ? "Group-name updates must not include team allocations."
                : "Allocate at least one team to each group.");
        }
        const name = text(group.name, "Group name", { required: true, max: 64 });
        const normalized = name.toLowerCase();
        if (groupNames.has(normalized)) fail(400, "INVALID_GROUPS", "Group names must be unique.");
        groupNames.add(normalized);
        const teamIds = group.teamIds.map(function (id) { return validId(id, "Team"); });
        teamIds.forEach(function (teamId) {
            if (teamAssignment.has(teamId)) fail(400, "INVALID_GROUPS", "A team cannot be allocated more than once.");
            teamAssignment.set(teamId, name);
        });
        groups.push({ name: name, teamIds: teamIds, position: index });
    });

    if (saveNamesOnly) {
        const priorGroups = await actor.db.prepare(
            "SELECT id, name, position FROM afc_tournament_groups WHERE tournament_id = ? ORDER BY position"
        ).bind(tournamentId).all();
        const existingGroups = priorGroups.results || [];
        const existingNameSet = new Set(existingGroups.map(function (group) {
            return group.name.toLowerCase();
        }));
        const sameGroupNames = existingGroups.length === groups.length &&
            groups.every(function (group) {
                return existingNameSet.has(group.name.toLowerCase());
            });
        const preserveByName = existingGroups.length !== groups.length || sameGroupNames;
        const renamedOrReordered = existingGroups.length === groups.length &&
            groups.some(function (group, index) {
                return existingGroups[index].name !== group.name ||
                    Number(existingGroups[index].position) !== index;
            });
        if (renamedOrReordered) {
            const activeFixtures = await actor.db.prepare(
                "SELECT id FROM afc_matches WHERE tournament_id = ? AND " +
                "(group_id IS NOT NULL OR lower(stage) LIKE '%group%' OR lower(stage) LIKE '%league%' " +
                "OR lower(stage) LIKE '%round-robin%' OR lower(stage) LIKE '%round robin%') " +
                "AND (published = 1 OR status <> 'draft')"
            ).bind(tournamentId).all();
            if ((activeFixtures.results || []).length) {
                fail(409, "GROUPS_LOCKED",
                    "Group names and order are locked while group fixtures are public or active.");
            }
        }
        if (preserveByName && existingGroups.length) {
            const scheduledGroupMatches = await actor.db.prepare(
                "SELECT id FROM afc_matches WHERE tournament_id = ? AND " +
                "(group_id IS NOT NULL OR lower(stage) LIKE '%group%' OR lower(stage) LIKE '%league%' " +
                "OR lower(stage) LIKE '%round-robin%' OR lower(stage) LIKE '%round robin%')"
            ).bind(tournamentId).all();
            if ((scheduledGroupMatches.results || []).length) {
                fail(409, "GROUP_COUNT_LOCKED",
                    "The group count cannot change while group fixtures exist.");
            }
        }

        const existingByName = new Map(existingGroups.map(function (group) {
            return [group.name.toLowerCase(), group];
        }));
        const groupsToSave = groups.map(function (group, index) {
            return {
                group: group,
                existing: preserveByName
                    ? existingByName.get(group.name.toLowerCase())
                    : existingGroups[index]
            };
        });
        const retainedIds = new Set(groupsToSave.filter(function (item) {
            return Boolean(item.existing);
        }).map(function (item) { return item.existing.id; }));
        const statements = [];
        if (existingGroups.length) {
            const renameToken = crypto.randomUUID();
            statements.push(actor.db.prepare(
                "UPDATE afc_tournament_groups SET name = '__afc_tmp__' || ? || id, position = -position - 1 " +
                "WHERE tournament_id = ?"
            ).bind(renameToken, tournamentId));
        }
        existingGroups.filter(function (group) {
            return !retainedIds.has(group.id);
        }).forEach(function (group) {
            statements.push(actor.db.prepare(
                "DELETE FROM afc_tournament_groups WHERE id = ?"
            ).bind(group.id));
        });
        groupsToSave.forEach(function (item, index) {
            if (item.existing) {
                statements.push(actor.db.prepare(
                    "UPDATE afc_tournament_groups SET name = ?, position = ? WHERE id = ?"
                ).bind(item.group.name, index, item.existing.id));
            } else {
                statements.push(actor.db.prepare(
                    "INSERT INTO afc_tournament_groups(id, tournament_id, name, position) VALUES(?, ?, ?, ?)"
                ).bind(newId("GRP-"), tournamentId, item.group.name, index));
            }
        });
        statements.push(actor.db.prepare(
            "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
            "VALUES(?, ?, ?, ?, ?, ?)"
        ).bind(
            newId("AUD-"), actor.user.firebase_uid, "save_tournament_group_names",
            "tournament", tournamentId, JSON.stringify({ groupNames: groups.map(function (group) {
                return group.name;
            }) })
        ));
        await actor.db.batch(statements);
        return success({ tournamentId: tournamentId, groupNames: groups.map(function (group) { return group.name; }) });
    }

    const configuredGroupsResult = await actor.db.prepare(
        "SELECT name FROM afc_tournament_groups WHERE tournament_id = ? ORDER BY position"
    ).bind(tournamentId).all();
    const configuredGroups = configuredGroupsResult.results || [];
    if (configuredGroups.length && (
        configuredGroups.length !== groups.length ||
        configuredGroups.some(function (group, index) {
            return group.name.toLowerCase() !== groups[index].name.toLowerCase();
        })
    )) {
        fail(409, "GROUP_CONFIGURATION_MISMATCH",
            "Save the group names and order before submitting team allocation.");
    }

    const approved = await actor.db.prepare(
        "SELECT r.id AS registration_id, r.team_id FROM afc_team_registrations r " +
        "WHERE r.tournament_id = ? AND r.status = 'approved'"
    ).bind(tournamentId).all();
    const registrationByTeam = new Map();
    (approved.results || []).forEach(function (row) {
        registrationByTeam.set(row.team_id, row.registration_id);
    });
    if (teamAssignment.size !== registrationByTeam.size ||
        Array.from(registrationByTeam.keys()).some(function (teamId) {
            return !teamAssignment.has(teamId);
        }) ||
        Array.from(teamAssignment.keys()).some(function (teamId) {
            return !registrationByTeam.has(teamId);
        })) {
        fail(400, "INCOMPLETE_ALLOCATION", "Allocate every approved team exactly once.");
    }

    const priorAssignments = await actor.db.prepare(
        "SELECT gt.team_id, g.name FROM afc_group_teams gt " +
        "JOIN afc_tournament_groups g ON g.id = gt.group_id WHERE g.tournament_id = ?"
    ).bind(tournamentId).all();
    const oldGroupsNameForTeam = new Map((priorAssignments.results || []).map(function (row) {
        return [row.team_id, row.name];
    }));
    const allocationChanged = teamAssignment.size !== oldGroupsNameForTeam.size ||
        Array.from(teamAssignment.keys()).some(function (teamId) {
            return teamAssignment.get(teamId) !== oldGroupsNameForTeam.get(teamId);
        });
    const fixtures = await actor.db.prepare(
        "SELECT id, group_id, home_team_id, away_team_id, stage, status, published FROM afc_matches " +
        "WHERE tournament_id = ? AND group_id IS NOT NULL"
    ).bind(tournamentId).all();
    (fixtures.results || []).forEach(function (fixture) {
        const stage = String(fixture.stage || "").toLowerCase();
        if (stage.indexOf("group") === -1 && stage.indexOf("league") === -1) return;
        const homeGroup = fixture.home_team_id ? teamAssignment.get(fixture.home_team_id) : null;
        const awayGroup = fixture.away_team_id ? teamAssignment.get(fixture.away_team_id) : null;
        if (homeGroup && awayGroup && homeGroup !== awayGroup) {
            fail(409, "GROUP_FIXTURE_CONFLICT", "A saved group fixture would cross groups after this allocation.");
        }
        if ((Number(fixture.published) === 1 || fixture.status !== "draft") &&
            (oldGroupsNameForTeam.get(fixture.home_team_id) !== homeGroup ||
                oldGroupsNameForTeam.get(fixture.away_team_id) !== awayGroup)) {
                fail(409, "GROUP_FIXTURE_LOCKED",
                    "A team in a published or active group fixture cannot be moved.");
        }
    });
    const knockout = await actor.db.prepare(
        "SELECT COUNT(*) AS total FROM afc_matches WHERE tournament_id = ? " +
        "AND lower(stage) NOT LIKE '%group%' AND lower(stage) NOT LIKE '%league%'"
    ).bind(tournamentId).first();
    if (Number(knockout.total || 0) > 0 && allocationChanged) {
        fail(409, "KNOCKOUT_FIXTURES_PRESERVED",
            "Group allocation cannot change while downstream fixtures exist. Existing fixtures and results are preserved.");
    }

    const oldGroups = await actor.db.prepare(
        "SELECT id, name FROM afc_tournament_groups WHERE tournament_id = ?"
    ).bind(tournamentId).all();
    const oldByName = new Map((oldGroups.results || []).map(function (row) {
        return [row.name.toLowerCase(), row.id];
    }));
    const plannedGroups = groups.map(function (group) {
        return {
            id: oldByName.get(group.name.toLowerCase()) || newId("GRP-"),
            name: group.name,
            position: group.position,
            teamIds: group.teamIds
        };
    });
    const groupIdByName = new Map(plannedGroups.map(function (group) {
        return [group.name, group.id];
    }));
    const statements = [
        actor.db.prepare(
            "DELETE FROM afc_group_teams WHERE group_id IN " +
            "(SELECT id FROM afc_tournament_groups WHERE tournament_id = ?)"
        ).bind(tournamentId),
        actor.db.prepare(
            "UPDATE afc_tournament_groups SET position = -position - 1 WHERE tournament_id = ?"
        ).bind(tournamentId)
    ];
    for (const group of plannedGroups) {
        if (oldByName.has(group.name.toLowerCase())) {
            statements.push(actor.db.prepare(
                "UPDATE afc_tournament_groups SET position = ? WHERE id = ?"
            ).bind(group.position, group.id));
        } else {
            statements.push(actor.db.prepare(
                "INSERT INTO afc_tournament_groups(id, tournament_id, name, position) VALUES(?, ?, ?, ?)"
            ).bind(group.id, tournamentId, group.name, group.position));
        }
        for (const teamId of group.teamIds) {
            statements.push(actor.db.prepare(
                "INSERT INTO afc_group_teams(group_id, team_id, registration_id) VALUES(?, ?, ?)"
            ).bind(group.id, teamId, registrationByTeam.get(teamId)));
        }
    }
    for (const fixture of fixtures.results || []) {
        const stage = String(fixture.stage || "").toLowerCase();
        if (stage.indexOf("group") === -1 && stage.indexOf("league") === -1) continue;
        const teamId = fixture.home_team_id || fixture.away_team_id;
        const name = teamId ? teamAssignment.get(teamId) : null;
        const groupId = name ? groupIdByName.get(name) : fixture.group_id;
        if (groupId) {
            statements.push(actor.db.prepare("UPDATE afc_matches SET group_id = ? WHERE id = ?")
                .bind(groupId, fixture.id));
        }
    }
    statements.push(actor.db.prepare(
        "UPDATE afc_tournaments SET standings_available = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(tournamentId));
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id, details_json) " +
        "VALUES(?, ?, ?, ?, ?, ?)"
    ).bind(
        newId("AUD-"), actor.user.firebase_uid, "allocate_tournament_groups",
        "tournament", tournamentId, JSON.stringify({
            groups: plannedGroups.map(function (group) {
                return { name: group.name, teamIds: group.teamIds };
            })
        })
    ));
    await actor.db.batch(statements);
    return success({
        tournamentId: tournamentId,
        groups: plannedGroups.map(function (group) { return { id: group.id, name: group.name, teamIds: group.teamIds }; }),
        knockoutFixturesReset: false
    });
}

async function updateRegistrationPermissions(request, actor, registrationId, env) {
    const body = await readJson(request);
    if (typeof body.earlyPlayerRegistration !== "boolean" ||
        typeof body.rosterChangesAfterStart !== "boolean") {
        fail(400, "INVALID_INPUT", "Both permission values must be true or false.");
    }
    const durationHours = body.rosterChangesAfterStart
        ? integer(body.rosterChangesHours, "Roster-change duration in hours", 1, 720)
        : null;
    const registration = await actor.db.prepare(
        "SELECT r.id, r.tournament_id, r.status, r.manager_uid, " +
        "tm.name AS team_name, t.name AS tournament_name, " +
        "u.full_name AS manager_name, u.email AS manager_email " +
        "FROM afc_team_registrations r JOIN afc_teams tm ON tm.id = r.team_id " +
        "JOIN afc_tournaments t ON t.id = r.tournament_id " +
        "LEFT JOIN afc_users u ON u.firebase_uid = r.manager_uid WHERE r.id = ?"
    ).bind(registrationId).first();
    if (!registration) fail(404, "NOT_FOUND", "The team registration was not found.");
    await requireTournamentScope(actor, registration.tournament_id);
    if (registration.status !== "approved") {
        fail(409, "REGISTRATION_NOT_APPROVED", "Approve the team before changing roster permissions.");
    }
    const grantedAt = body.rosterChangesAfterStart ? new Date() : null;
    const expiresAt = grantedAt
        ? new Date(grantedAt.getTime() + durationHours * 60 * 60 * 1000).toISOString()
        : null;
    await actor.db.prepare(
        "INSERT INTO afc_registration_permissions(registration_id, early_player_registration, " +
        "roster_changes_after_start, roster_changes_expires_at, updated_by) VALUES(?, ?, ?, ?, ?) " +
        "ON CONFLICT(registration_id) DO UPDATE SET early_player_registration = excluded.early_player_registration, " +
        "roster_changes_after_start = excluded.roster_changes_after_start, " +
        "roster_changes_expires_at = excluded.roster_changes_expires_at, " +
        "updated_by = excluded.updated_by, " +
        "updated_at = CURRENT_TIMESTAMP"
    ).bind(
        registrationId, body.earlyPlayerRegistration ? 1 : 0,
        body.rosterChangesAfterStart ? 1 : 0, expiresAt, actor.user.firebase_uid
    ).run();
    await logAudit(actor.db, actor.user.firebase_uid, "update_roster_permissions", "team_registration", registrationId);
    const emailStatus = body.rosterChangesAfterStart
        ? await sendTransactionalEmail(
            env,
            actor.db,
            "roster_change_permission_granted",
            registrationId + ":" + expiresAt,
            {
                uid: registration.manager_uid,
                email: registration.manager_email,
                name: registration.manager_name
            },
            {
                recipientName: registration.manager_name || "Team manager",
                teamName: registration.team_name,
                tournamentName: registration.tournament_name,
                durationHours: String(durationHours) + " hours",
                grantedAt: formatEmailDateTime(grantedAt),
                expiresAt: formatEmailDateTime(expiresAt)
            }
        )
        : null;
    return success({
        registrationId: registrationId,
        rosterChangesAfterStart: body.rosterChangesAfterStart,
        rosterChangesExpiresAt: expiresAt,
        emailStatus: emailStatus
    });
}

async function markNotificationRead(actor, notificationId) {
    if (actor.user.role === "tournament_admin") {
        await requireUserPermission(actor, "notifications.view");
    }
    const result = await actor.db.prepare(
        "UPDATE afc_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_uid = ?"
    ).bind(notificationId, actor.user.firebase_uid).run();
    if (!result.meta || result.meta.changes !== 1) fail(404, "NOT_FOUND", "The notification was not found.");
    return success({ id: notificationId, read: true });
}

async function acknowledgeRules(request, actor, rulesId) {
    if (actor.user.role !== "team_manager") {
        fail(403, "FORBIDDEN", "A team manager account is required.");
    }
    const body = await readJson(request);
    const registrationId = validId(body.registrationId, "Team registration");
    const registration = await actor.db.prepare(
        "SELECT id, category_id FROM afc_team_registrations " +
        "WHERE id = ? AND manager_uid = ? AND status = 'approved'"
    ).bind(registrationId, actor.user.firebase_uid).first();
    if (!registration) fail(404, "NOT_FOUND", "The approved team registration was not found.");
    const rule = await actor.db.prepare(
        "SELECT id FROM afc_rules WHERE id = ? AND category_id = ? AND status = 'published'"
    ).bind(rulesId, registration.category_id).first();
    if (!rule) fail(404, "NOT_FOUND", "The published rules were not found.");
    await actor.db.prepare(
        "INSERT INTO afc_rules_acknowledgements(registration_id, rules_id, acknowledged_by) " +
        "VALUES(?, ?, ?) ON CONFLICT(registration_id, rules_id) DO UPDATE SET " +
        "acknowledged_by = excluded.acknowledged_by, acknowledged_at = CURRENT_TIMESTAMP"
    ).bind(registrationId, rulesId, actor.user.firebase_uid).run();
    return success({ registrationId: registrationId, rulesId: rulesId, acknowledged: true });
}

async function loadRuleAcknowledgments(actor, rulesId) {
    const scopes = await getTournamentScopes(actor.db, actor.user);
    const ruleScopeFilter = actor.user.role === "platform_owner"
        ? ""
        : scopes.length
            ? " AND EXISTS (SELECT 1 FROM afc_tournaments scoped_t " +
                "WHERE scoped_t.category_id = r.category_id AND scoped_t.id IN (" +
                scopes.map(function () { return "?"; }).join(",") + "))"
            : " AND 1=0";
    const rule = await actor.db.prepare(
        "SELECT r.id, r.title, r.category_id, r.updated_at, c.name AS category_name " +
        "FROM afc_rules r JOIN afc_categories c ON c.id = r.category_id " +
        "WHERE r.id = ? AND r.status = 'published'" + ruleScopeFilter
    ).bind(rulesId, ...(actor.user.role === "platform_owner" ? [] : scopes)).first();
    if (!rule) fail(404, "NOT_FOUND", "The published rules were not found.");

    const scopeFilter = actor.user.role === "platform_owner"
        ? ""
        : scopes.length
            ? " AND reg.tournament_id IN (" +
                scopes.map(function () { return "?"; }).join(",") + ")"
            : " AND 1=0";
    const rows = await prepareBound(
        actor.db,
        "SELECT reg.id AS registration_id, reg.tournament_id, tm.name AS team_name, " +
        "t.name AS tournament_name, u.firebase_uid AS manager_uid, u.full_name AS manager_name, " +
        "u.email AS manager_email, u.status AS manager_status, u.role AS manager_role, " +
        "a.acknowledged_at, reminders.last_reminded_at " +
        "FROM afc_team_registrations reg " +
        "JOIN afc_teams tm ON tm.id = reg.team_id " +
        "JOIN afc_tournaments t ON t.id = reg.tournament_id " +
        "JOIN afc_users u ON u.firebase_uid = reg.manager_uid " +
        "LEFT JOIN afc_rules_acknowledgements a " +
        "ON a.registration_id = reg.id AND a.rules_id = ? " +
        "LEFT JOIN (SELECT manager_uid, MAX(sent_at) AS last_reminded_at " +
        "FROM afc_rules_acknowledgment_reminders WHERE rules_id = ? GROUP BY manager_uid) reminders " +
        "ON reminders.manager_uid = reg.manager_uid " +
        "WHERE reg.category_id = ? AND reg.status = 'approved'" + scopeFilter +
        " ORDER BY u.full_name, tm.name, t.name",
        [rulesId, rulesId, rule.category_id].concat(
            actor.user.role === "platform_owner" ? [] : scopes
        )
    ).all();
    return {
        rule: rule,
        acknowledgments: rows.results || []
    };
}

async function sendRuleAcknowledgmentReminders(actor, rulesId) {
    const report = await loadRuleAcknowledgments(actor, rulesId);
    const recipients = new Map();
    report.acknowledgments.forEach(function (row) {
        if (row.acknowledged_at || row.manager_status !== "active" ||
            row.manager_role !== "team_manager") return;
        let recipient = recipients.get(row.manager_uid);
        if (!recipient) {
            recipient = {
                uid: row.manager_uid,
                name: row.manager_name,
                email: row.manager_email,
                teams: new Set(),
                tournaments: new Set()
            };
            recipients.set(row.manager_uid, recipient);
        }
        recipient.teams.add(row.team_name);
        recipient.tournaments.add(row.tournament_name);
    });

    if (!recipients.size) {
        return success({ notificationsSent: 0, emailStatusCounts: {} });
    }

    const reminderId = newId("RMD-");
    const reminderRows = Array.from(recipients.values());
    const statements = reminderRows.map(function (recipient) {
        const teamNames = Array.from(recipient.teams).join(", ");
        return actor.db.prepare(
            "INSERT INTO afc_notifications(id, user_uid, category, title, body, target_path) " +
            "VALUES(?, ?, 'Competition Rules', ?, ?, ?)"
        ).bind(
            newId("NTF-"),
            recipient.uid,
            "Please acknowledge the competition rules",
            "Please read and acknowledge \"" + report.rule.title + "\" for " + teamNames +
                " in the Team Manager Dashboard.",
            "/team-manager-dashboard/#/rules"
        );
    });
    reminderRows.forEach(function (recipient) {
        statements.push(actor.db.prepare(
            "INSERT INTO afc_rules_acknowledgment_reminders(id, rules_id, manager_uid, sent_by) " +
            "VALUES(?, ?, ?, ?)"
        ).bind(
            newId("RMD-"),
            rulesId,
            recipient.uid,
            actor.user.firebase_uid
        ));
    });
    statements.push(actor.db.prepare(
        "INSERT INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id) " +
        "VALUES(?, ?, 'send_rules_acknowledgment_reminders', 'rules', ?)"
    ).bind(newId("AUD-"), actor.user.firebase_uid, rulesId));
    await actor.db.batch(statements);

    const statuses = await Promise.all(reminderRows.map(function (recipient) {
        return sendTransactionalEmail(
            actor.env,
            actor.db,
            "rules_acknowledgment_reminder",
            reminderId,
            recipient,
            {
                recipientName: recipient.name,
                ruleTitle: report.rule.title,
                categoryName: report.rule.category_name,
                teamName: Array.from(recipient.teams).join(", "),
                tournamentName: Array.from(recipient.tournaments).join(", ")
            }
        );
    }));
    const emailStatusCounts = Object.create(null);
    statuses.forEach(function (status) {
        emailStatusCounts[status] = (emailStatusCounts[status] || 0) + 1;
    });
    return success({
        notificationsSent: reminderRows.length,
        emailStatusCounts: emailStatusCounts
    });
}

async function createUpload(request, actor, visibility) {
    const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
    const allowed = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp"
    };
    if (!allowed[contentType]) fail(415, "UNSUPPORTED_MEDIA_TYPE", "Upload a PNG, JPEG, or WebP image.");
    if (!actor.env.MEDIA || typeof actor.env.MEDIA.put !== "function") {
        fail(503, "SERVICE_UNAVAILABLE", "Media storage is not configured.");
    }
    const bytes = await readLimitedBytes(request, MAX_UPLOAD_BYTES);
    if (!bytes.byteLength) {
        fail(413, "UPLOAD_TOO_LARGE", "The image must be between 1 byte and 5 MB.");
    }
    const actualType = detectImageType(bytes);
    if (actualType !== contentType) fail(415, "INVALID_IMAGE", "The image content does not match its media type.");

    const key = "media/" + crypto.randomUUID() + "." + allowed[contentType];
    const mediaVisibility = visibility === "public" ? "public" : "private";
    await actor.env.MEDIA.put(key, bytes, {
        httpMetadata: {
            contentType: actualType,
            cacheControl: mediaVisibility === "public" ? "public, max-age=600" : "private, no-store"
        },
        customMetadata: { ownerUid: actor.user.firebase_uid }
    });
    try {
        await actor.db.prepare(
            "INSERT INTO afc_media(object_key, owner_uid, content_type, byte_size, visibility) " +
            "VALUES(?, ?, ?, ?, ?)"
        ).bind(key, actor.user.firebase_uid, actualType, bytes.byteLength, mediaVisibility).run();
    } catch (_error) {
        await actor.env.MEDIA.delete(key);
        fail(500, "UPLOAD_FAILED", "The image could not be saved.");
    }
    return success({ key: key.slice("media/".length), contentType: actualType, size: bytes.byteLength }, 201);
}

function mapMediaItem(row) {
    return {
        id: row.id,
        mediaType: row.media_type,
        title: row.title,
        category: row.category,
        status: row.status,
        file: row.file_path,
        videoUrl: row.video_url || "",
        addedOn: row.added_on,
        caption: row.caption || ""
    };
}

async function validateAdminMediaFile(db, ownerUid, value, required) {
    const filePath = text(value, "Image", { max: 255 });
    if (!filePath) {
        if (required) fail(400, "INVALID_INPUT", "Choose an image for this media item.");
        return "";
    }
    if (/^images\/[A-Za-z0-9%._-]+$/.test(filePath)) return filePath;
    if (!/^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(filePath)) {
        fail(400, "INVALID_INPUT", "Choose a supported project image or uploaded image.");
    }
    const uploaded = await db.prepare(
        "SELECT object_key FROM afc_media WHERE object_key = ? AND owner_uid = ?"
    ).bind(filePath, ownerUid).first();
    if (!uploaded) fail(400, "INVALID_INPUT", "The uploaded image is not available to this account.");
    return filePath;
}

function validateMediaVideoUrl(value) {
    const videoUrl = text(value, "Video URL", { required: true, max: 2048 });
    let parsed;
    try {
        parsed = new URL(videoUrl);
    } catch (_error) {
        fail(400, "INVALID_INPUT", "Enter a supported video URL.");
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const directVideo = /\.(mp4|webm|ogg)$/i.test(parsed.pathname);
    const youtube = host === "youtube.com" || host === "m.youtube.com" ||
        host === "youtube-nocookie.com" || host === "youtu.be";
    const vimeo = host === "vimeo.com" || host === "player.vimeo.com";
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        !(directVideo || youtube || vimeo)) {
        fail(400, "INVALID_INPUT", "Use a secure direct video, YouTube or Vimeo URL.");
    }
    if (youtube) {
        const id = host === "youtu.be"
            ? parsed.pathname.split("/").filter(Boolean)[0]
            : parsed.searchParams.get("v") ||
                (parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/) || [])[1];
        if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
            fail(400, "INVALID_INPUT", "Enter a valid YouTube URL.");
        }
    }
    if (vimeo && !/\/(?:video\/)?\d+\/?$/.test(parsed.pathname)) {
        fail(400, "INVALID_INPUT", "Enter a valid Vimeo URL.");
    }
    return videoUrl;
}

async function adminMediaValues(request, actor) {
    const body = await readJson(request);
    const mediaType = text(body.mediaType, "Media type", { required: true, max: 16 }).toLowerCase();
    if (mediaType !== "image" && mediaType !== "video") {
        fail(400, "INVALID_INPUT", "Choose an image or video.");
    }
    const title = text(body.title, "Media title", { required: true, max: 160 });
    const category = text(body.category, "Category", { required: true, max: 40 });
    if (["Match action", "Supporters", "Training", "Branding", "Venue", "Officials", "Community"]
        .indexOf(category) === -1) {
        fail(400, "INVALID_INPUT", "Choose a valid media category.");
    }
    const status = text(body.status, "Publication status", { required: true, max: 20 }).toLowerCase();
    if (["draft", "published", "unpublished"].indexOf(status) === -1) {
        fail(400, "INVALID_STATUS", "Choose a valid publication status.");
    }
    const file = await validateAdminMediaFile(
        actor.db, actor.user.firebase_uid, body.file, mediaType === "image"
    );
    const videoUrl = mediaType === "video" ? validateMediaVideoUrl(body.videoUrl) : "";
    return {
        mediaType: mediaType,
        title: title,
        category: category,
        status: status,
        file: file,
        videoUrl: videoUrl,
        addedOn: validDate(body.addedOn || new Date().toISOString().slice(0, 10), "Date added", true),
        caption: text(body.caption, "Caption", { max: 2000 })
    };
}

async function saveAdminMedia(request, actor, itemId) {
    const values = await adminMediaValues(request, actor);
    const existing = itemId
        ? await actor.db.prepare(
            "SELECT id, file_path FROM afc_media_items WHERE id = ?"
        ).bind(itemId).first()
        : null;
    if (itemId && !existing) fail(404, "NOT_FOUND", "The media item was not found.");
    const id = existing ? existing.id : newId("MED-");
    if (existing && existing.file_path && existing.file_path !== values.file) {
        await ensureAdminMediaReleaseAvailable(actor.db, actor.env, existing.file_path, id);
    }
    if (existing) {
        await actor.db.prepare(
            "UPDATE afc_media_items SET media_type = ?, title = ?, category = ?, status = ?, " +
            "file_path = ?, video_url = ?, added_on = ?, caption = ?, updated_at = CURRENT_TIMESTAMP " +
            "WHERE id = ?"
        ).bind(
            values.mediaType, values.title, values.category, values.status, values.file || null,
            values.videoUrl || null, values.addedOn, values.caption, id
        ).run();
    } else {
        await actor.db.prepare(
            "INSERT INTO afc_media_items(id, media_type, title, category, status, file_path, " +
            "video_url, added_on, caption, created_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            id, values.mediaType, values.title, values.category, values.status, values.file || null,
            values.videoUrl || null, values.addedOn, values.caption, actor.user.firebase_uid
        ).run();
    }
    await setAdminMediaVisibility(actor.db, values.file, values.status === "published");
    if (existing && existing.file_path && existing.file_path !== values.file) {
        await releaseAdminMediaFile(actor.db, actor.env, existing.file_path);
    }
    await logAudit(actor.db, actor.user.firebase_uid,
        existing ? "update_media_item" : "create_media_item", "media", id);
    const row = await actor.db.prepare(
        "SELECT id, media_type, title, category, status, file_path, video_url, added_on, caption " +
        "FROM afc_media_items WHERE id = ?"
    ).bind(id).first();
    return success(mapMediaItem(row), existing ? 200 : 201);
}

async function setAdminMediaVisibility(db, filePath, isPublic) {
    if (!filePath || filePath.indexOf("media/") !== 0) return;
    if (!isPublic) {
        const publicUse = await db.prepare(
            "SELECT 1 AS present FROM afc_media_items " +
            "WHERE file_path = ? AND status = 'published' " +
            "UNION ALL SELECT 1 AS present FROM afc_teams " +
            "WHERE logo_key = ? OR logo_key = substr(?, 7) " +
            "UNION ALL SELECT 1 AS present FROM afc_tournaments WHERE banner = ? LIMIT 1"
        ).bind(filePath, filePath, filePath, filePath).first();
        if (publicUse) return;
    }
    await db.prepare(
        "UPDATE afc_media SET visibility = ? WHERE object_key = ?"
    ).bind(isPublic ? "public" : "private", filePath).run();
}

async function adminMediaFileUsage(db, filePath, excludingItemId) {
    const gallery = await db.prepare(
        "SELECT status FROM afc_media_items WHERE file_path = ? " +
        "AND (? IS NULL OR id <> ?) ORDER BY status = 'published' DESC LIMIT 1"
    ).bind(filePath, excludingItemId || null, excludingItemId || null).first();
    const publicReference = await db.prepare(
        "SELECT 1 AS present FROM afc_teams WHERE logo_key = ? OR logo_key = substr(?, 7) " +
        "UNION ALL SELECT 1 AS present FROM afc_tournaments WHERE banner = ? LIMIT 1"
    ).bind(filePath, filePath, filePath).first();
    return { gallery: gallery, publicReference: publicReference };
}

async function ensureAdminMediaReleaseAvailable(db, env, filePath, excludingItemId) {
    if (!filePath || !/^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(filePath)) return;
    const usage = await adminMediaFileUsage(db, filePath, excludingItemId);
    if (usage.gallery || usage.publicReference) return;
    const stored = await db.prepare(
        "SELECT object_key FROM afc_media WHERE object_key = ?"
    ).bind(filePath).first();
    if (stored && (!env.MEDIA || typeof env.MEDIA.delete !== "function")) {
        fail(503, "MEDIA_STORAGE_UNAVAILABLE", "The image could not be deleted because media storage is unavailable.");
    }
}

async function releaseAdminMediaFile(db, env, filePath, excludingItemId) {
    if (!filePath || !/^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(filePath)) return;
    const usage = await adminMediaFileUsage(db, filePath, excludingItemId || null);
    if (usage.gallery || usage.publicReference) {
        if (usage.gallery && usage.gallery.status === "published") {
            await setAdminMediaVisibility(db, filePath, true);
        } else if (!usage.publicReference) {
            await setAdminMediaVisibility(db, filePath, false);
        }
        return;
    }
    const stored = await db.prepare(
        "SELECT object_key FROM afc_media WHERE object_key = ?"
    ).bind(filePath).first();
    if (!stored) return;
    if (!env.MEDIA || typeof env.MEDIA.delete !== "function") {
        fail(503, "MEDIA_STORAGE_UNAVAILABLE", "The image could not be deleted because media storage is unavailable.");
    }
    try {
        await env.MEDIA.delete(filePath);
    } catch (error) {
        console.error("Admin media object deletion failed.", {
            objectKey: filePath,
            message: error && error.message ? error.message : String(error)
        });
        fail(502, "MEDIA_DELETE_FAILED", "The image could not be deleted from storage. The gallery item was not removed.");
    }
    await db.prepare("DELETE FROM afc_media WHERE object_key = ?").bind(filePath).run();
}

async function deleteAdminMedia(actor, itemId) {
    const item = await actor.db.prepare(
        "SELECT id, file_path FROM afc_media_items WHERE id = ?"
    ).bind(itemId).first();
    if (!item) fail(404, "NOT_FOUND", "The media item was not found.");
    await ensureAdminMediaReleaseAvailable(actor.db, actor.env, item.file_path, itemId);
    await releaseAdminMediaFile(actor.db, actor.env, item.file_path, itemId);
    await actor.db.prepare("DELETE FROM afc_media_items WHERE id = ?").bind(itemId).run();
    await logAudit(actor.db, actor.user.firebase_uid, "delete_media_item", "media", itemId);
    return success({ id: itemId, deleted: true });
}

async function deleteAdminMediaUpload(actor, fileName) {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(fileName)) {
        fail(400, "INVALID_INPUT", "The uploaded image identifier is invalid.");
    }
    const filePath = "media/" + fileName;
    const stored = await actor.db.prepare(
        "SELECT object_key FROM afc_media WHERE object_key = ? AND owner_uid = ?"
    ).bind(filePath, actor.user.firebase_uid).first();
    if (!stored) fail(404, "NOT_FOUND", "The uploaded image was not found.");
    const references = await actor.db.prepare(
        "SELECT 1 AS present FROM afc_media_items WHERE file_path = ? " +
        "UNION ALL SELECT 1 AS present FROM afc_teams WHERE logo_key = ? OR logo_key = ? " +
        "UNION ALL SELECT 1 AS present FROM afc_tournaments WHERE banner = ? LIMIT 1"
    ).bind(filePath, filePath, fileName, filePath).first();
    if (references) fail(409, "MEDIA_IN_USE", "This image is already in use and cannot be removed.");
    await ensureAdminMediaReleaseAvailable(actor.db, actor.env, filePath, null);
    await releaseAdminMediaFile(actor.db, actor.env, filePath);
    return success({ key: fileName, deleted: true });
}

function detectImageType(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a &&
        bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 12 &&
        String.fromCharCode.apply(null, bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode.apply(null, bytes.slice(8, 12)) === "WEBP") return "image/webp";
    return "";
}

async function mediaResponse(request, env, objectKey) {
    if (!/^media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(objectKey)) {
        fail(404, "NOT_FOUND", "The media item was not found.");
    }
    const db = dbFor(env);
    const media = await db.prepare(
        "SELECT object_key, owner_uid, content_type, visibility FROM afc_media WHERE object_key = ?"
    ).bind(objectKey).first();
    if (!media) fail(404, "NOT_FOUND", "The media item was not found.");
    if (media.visibility !== "public") {
        const actor = await requireRole(request, env, ["platform_owner", "tournament_admin", "team_manager"]);
        if (actor.user.role === "tournament_admin") {
            await requireUserPermission(actor, "media.view");
        }
        if (actor.user.role !== "platform_owner" && actor.user.firebase_uid !== media.owner_uid) {
            fail(403, "FORBIDDEN", "You are not permitted to access this image.");
        }
    }
    if (!env.MEDIA || typeof env.MEDIA.get !== "function") {
        fail(503, "SERVICE_UNAVAILABLE", "Media storage is not configured.");
    }
    const object = await env.MEDIA.get(objectKey);
    if (!object) fail(404, "NOT_FOUND", "The media item was not found.");
    const headers = new Headers({
        "Content-Type": media.content_type,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": media.visibility === "public" ? "public, max-age=600" : "private, no-store"
    });
    return new Response(object.body, { status: 200, headers: headers });
}

async function route(request, env, context, url) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (path === "/health" && method === "GET") {
        const db = dbFor(env);
        await db.prepare("SELECT 1 AS ok").first();
        return success({ status: "ok", timestamp: new Date().toISOString() });
    }

    if (path === API_PREFIX + "/public/bootstrap" && method === "GET") {
        const db = dbFor(env);
        return success(await publicBootstrap(db, url));
    }
    if (path === API_PREFIX + "/public/tournaments" && method === "GET") {
        const db = dbFor(env);
        const page = paginate(url, 50);
        const rows = await db.prepare(
            "SELECT t.*, (SELECT COUNT(*) FROM afc_team_registrations r " +
            "WHERE r.tournament_id = t.id AND r.status = 'approved') AS teams_registered " +
            "FROM afc_tournaments t WHERE t.status IN ('upcoming', 'active', 'completed') " +
            "ORDER BY t.start_date DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all();
        return success((rows.results || []).map(mapTournament));
    }
    if (path === API_PREFIX + "/public/standings" && method === "GET") {
        return success(await standings(dbFor(env), url.searchParams.get("tournamentId")));
    }
    if (path === API_PREFIX + "/public/live-matches" && method === "GET") {
        return success(await publicLiveMatches(dbFor(env), url.searchParams.getAll("matchId")));
    }
    const publicTournamentMatch = path.match(/^\/api\/v1\/public\/tournaments\/([A-Za-z0-9_-]+)$/);
    if (publicTournamentMatch && method === "GET") {
        const db = dbFor(env);
        const slug = publicTournamentMatch[1];
        const tournament = await db.prepare(
            "SELECT t.*, (SELECT COUNT(*) FROM afc_team_registrations r " +
            "WHERE r.tournament_id = t.id AND r.status = 'approved') AS teams_registered " +
            "FROM afc_tournaments t WHERE t.slug = ? AND t.status <> 'draft'"
        ).bind(slug).first();
        if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
        return success(mapTournament(tournament));
    }
    const mediaMatch = path.match(/^\/api\/v1\/media\/(.+)$/);
    if (mediaMatch && method === "GET") {
        return mediaResponse(request, env, decodeURIComponent(mediaMatch[1]));
    }

    if (path === API_PREFIX + "/auth/me" && method === "GET") return accountMe(request, env);
    if (path === API_PREFIX + "/auth/login-check" && method === "POST") {
        const body = await readJson(request);
        await verifyTurnstile(env, body.turnstileToken, "login");
        return success({ verified: true });
    }
    if (path === API_PREFIX + "/auth/register-request" && method === "POST") {
        return requestAccount(request, env);
    }
    if (path === API_PREFIX + "/auth/password-reset" && method === "POST") {
        return requestPasswordReset(request, env);
    }

    const auth = await authenticate(request, env);
    const isTeamRegistration = path === API_PREFIX + "/team-registrations" && method === "POST";
    const isTeamLogoUpload = path === API_PREFIX + "/uploads/team-logo" && method === "POST";
    const teamRegistrationBody = isTeamRegistration ? await readJson(request) : null;
    if (teamRegistrationBody) {
        await verifyTurnstile(env, teamRegistrationBody.turnstileToken, "team-registration");
    }
    if (isTeamLogoUpload) {
        await verifyTurnstile(env, request.headers.get("Turnstile-Token"), "team-logo-upload");
    }
    const user = await loadAccount(auth);
    const actor = { claims: auth.claims, user: user, db: auth.db, env: env };

    if (path === API_PREFIX + "/manager/pending-registration-balance" && method === "GET") {
        return pendingManagerRegistrationBalance(actor);
    }
    if (isTeamRegistration) {
        return submitTeamRegistration(request, actor, url, teamRegistrationBody);
    }
    if (path === API_PREFIX + "/manager/bootstrap" && method === "GET") {
        const manager = await requireRole(request, env, ["team_manager"]);
        return managerBootstrap(manager, url);
    }
    const managerLineupsMatch = path.match(
        /^\/api\/v1\/manager\/matches\/([A-Za-z0-9_-]+)\/lineups$/
    );
    if (managerLineupsMatch && (method === "GET" || method === "PUT")) {
        const manager = await requireRole(request, env, ["team_manager"]);
        return method === "GET"
            ? getManagerMatchLineups(manager, managerLineupsMatch[1])
            : saveManagerMatchLineup(request, manager, managerLineupsMatch[1]);
    }
    if (path === API_PREFIX + "/uploads/team-logo" && method === "POST") {
        if (!canCreateTeamRegistration(user)) {
            fail(403, "ACCOUNT_NOT_READY",
                "A Team Manager account is required to upload a team logo for registration.");
        }
        return createUpload(request, actor);
    }

    if (!user || user.status !== "active" || !user.role) {
        fail(403, "ACCOUNT_NOT_ASSIGNED", "Your account does not yet have platform access.");
    }
    if (path === API_PREFIX + "/admin/permissions" && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return currentAdminPermissions(admin);
    }
    const adminPermissionsMatch = path.match(
        /^\/api\/v1\/admin\/users\/([A-Za-z0-9_-]+)\/permissions$/
    );
    if (adminPermissionsMatch && (method === "GET" || method === "PUT")) {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return manageUserPermissions(request, admin, adminPermissionsMatch[1]);
    }
    const adminMediaFileMatch = path.match(
        /^\/api\/v1\/admin\/media\/files\/([A-Za-z0-9-]+\.(?:png|jpg|webp))$/
    );
    if (adminMediaFileMatch && method === "GET") {
        await requireRole(request, env, ["platform_owner"]);
        return mediaResponse(request, env, "media/" + adminMediaFileMatch[1]);
    }
    if (path === API_PREFIX + "/admin/bootstrap" && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return loadAdminBootstrap(admin, url);
    }
    if (path === API_PREFIX + "/admin/users" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return createAdminUser(request, admin);
    }
    if (path === API_PREFIX + "/admin/teams" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return createAdminTeamRegistration(request, admin);
    }
    const adminTeamArchiveMatch = path.match(
        /^\/api\/v1\/admin\/teams\/([A-Za-z0-9_-]+)\/archive$/
    );
    if (adminTeamArchiveMatch && method === "PATCH") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return archiveAdminTeam(admin, adminTeamArchiveMatch[1]);
    }
    if (path === API_PREFIX + "/admin/media/items" && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        const page = paginate(url, 50);
        const rows = await admin.db.prepare(
            "SELECT id, media_type, title, category, status, file_path, video_url, added_on, caption " +
            "FROM afc_media_items ORDER BY added_on DESC, created_at DESC LIMIT ? OFFSET ?"
        ).bind(page.limit, page.offset).all();
        return success((rows.results || []).map(mapMediaItem));
    }
    if (path === API_PREFIX + "/admin/media/items" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return saveAdminMedia(request, admin, null);
    }
    if (path === API_PREFIX + "/admin/tournaments/banner-uploads" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return createUpload(request, admin);
    }
    const tournamentBannerUploadMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/banner-uploads(?:\/([A-Za-z0-9-]+\.(?:png|jpg|webp)))?$/
    );
    if (tournamentBannerUploadMatch && method === "POST" && !tournamentBannerUploadMatch[2]) {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        await requireTournamentScope(admin, tournamentBannerUploadMatch[1]);
        return createUpload(request, admin);
    }
    if (tournamentBannerUploadMatch && method === "DELETE" && tournamentBannerUploadMatch[2]) {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        await requireTournamentScope(admin, tournamentBannerUploadMatch[1]);
        return deleteAdminMediaUpload(admin, tournamentBannerUploadMatch[2]);
    }
    const adminMediaItemMatch = path.match(/^\/api\/v1\/admin\/media\/items\/([A-Za-z0-9_-]+)$/);
    if (adminMediaItemMatch && (method === "PUT" || method === "DELETE")) {
        const admin = await requireRole(request, env, ["platform_owner"]);
        if (method === "PUT") return saveAdminMedia(request, admin, adminMediaItemMatch[1]);
        return deleteAdminMedia(admin, adminMediaItemMatch[1]);
    }
    if (path === API_PREFIX + "/admin/media/uploads" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return createUpload(request, admin);
    }
    const ruleAcknowledgmentsMatch = path.match(
        /^\/api\/v1\/admin\/rules\/([A-Za-z0-9_-]+)\/acknowledgments$/
    );
    if (ruleAcknowledgmentsMatch && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return success(await loadRuleAcknowledgments(admin, ruleAcknowledgmentsMatch[1]));
    }
    const ruleRemindersMatch = path.match(
        /^\/api\/v1\/admin\/rules\/([A-Za-z0-9_-]+)\/reminders$/
    );
    if (ruleRemindersMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return sendRuleAcknowledgmentReminders(admin, ruleRemindersMatch[1]);
    }
    const adminMediaUploadMatch = path.match(
        /^\/api\/v1\/admin\/media\/uploads\/([A-Za-z0-9-]+\.(?:png|jpg|webp))$/
    );
    if (adminMediaUploadMatch && method === "DELETE") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return deleteAdminMediaUpload(admin, adminMediaUploadMatch[1]);
    }
    const adminResourceMatch = path.match(
        /^\/api\/v1\/admin\/(categories|tournaments|fixtures|rules)(?:\/([A-Za-z0-9_-]+))?$/
    );
    if (adminResourceMatch) {
        const resource = adminResourceMatch[1];
        const resourceId = adminResourceMatch[2] || null;
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        if (method === "POST" && !resourceId) {
            if (resource === "categories") return saveCategory(request, admin, null);
            if (resource === "tournaments") return saveTournament(request, admin, null);
            if (resource === "fixtures") return saveFixture(request, admin, null);
            return saveRule(request, admin, null);
        }
        if (method === "PUT" && resourceId) {
            if (resource === "categories") return saveCategory(request, admin, resourceId);
            if (resource === "tournaments") return saveTournament(request, admin, resourceId);
            if (resource === "fixtures") return saveFixture(request, admin, resourceId);
            return saveRule(request, admin, resourceId);
        }
        if (method === "DELETE" && resourceId) {
            if (["categories", "tournaments", "rules"].indexOf(resource) !== -1) {
                return archiveAdminResource(admin, resource, resourceId);
            }
        }
    }
    if (path === API_PREFIX + "/admin/settings/email-sender" && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        const settings = await getEmailSettings(admin.db);
        return success({
            email: settings.brevo_sender_email || "",
            name: settings.brevo_sender_name || ""
        });
    }
    if (path === API_PREFIX + "/admin/settings/email-sender" && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return updateEmailSettings(request, admin);
    }
    const reviewMatch = path.match(/^\/api\/v1\/admin\/team-registrations\/([A-Za-z0-9_-]+)\/review$/);
    if (reviewMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return reviewRegistration(request, admin, reviewMatch[1]);
    }
    const userRoleMatch = path.match(/^\/api\/v1\/admin\/users\/([A-Za-z0-9_-]+)\/role$/);
    if (userRoleMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return adminAssignRole(request, admin, userRoleMatch[1]);
    }
    const userStatusMatch = path.match(/^\/api\/v1\/admin\/users\/([A-Za-z0-9_-]+)\/status$/);
    if (userStatusMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return updateUserStatus(request, admin, userStatusMatch[1]);
    }
    const permanentUserDeleteMatch = path.match(
        /^\/api\/v1\/admin\/users\/([A-Za-z0-9_-]+)\/permanent$/
    );
    if (permanentUserDeleteMatch && method === "DELETE") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return permanentlyDeleteManager(admin, permanentUserDeleteMatch[1]);
    }
    const matchResultMatch = path.match(/^\/api\/v1\/admin\/matches\/([A-Za-z0-9_-]+)\/result$/);
    if (matchResultMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateMatchResult(request, admin, matchResultMatch[1]);
    }
    const matchLineupsMatch = path.match(
        /^\/api\/v1\/admin\/matches\/([A-Za-z0-9_-]+)\/lineups$/
    );
    if (matchLineupsMatch && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return adminMatchLineupSheet(admin, matchLineupsMatch[1]);
    }
    const matchLiveMatch = path.match(/^\/api\/v1\/admin\/matches\/([A-Za-z0-9_-]+)\/live$/);
    if (matchLiveMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateLiveMatch(request, admin, matchLiveMatch[1]);
    }
    const matchLiveClockMatch = path.match(
        /^\/api\/v1\/admin\/matches\/([A-Za-z0-9_-]+)\/live-clock$/
    );
    if (matchLiveClockMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateLiveMatchClock(request, admin, matchLiveClockMatch[1]);
    }
    const matchStatusMatch = path.match(/^\/api\/v1\/admin\/matches\/([A-Za-z0-9_-]+)\/status$/);
    if (matchStatusMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateMatchStatus(request, admin, matchStatusMatch[1]);
    }
    const paymentReviewMatch = path.match(/^\/api\/v1\/admin\/payments\/([A-Za-z0-9_-]+)\/review$/);
    if (paymentReviewMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return reviewPayment(request, admin, paymentReviewMatch[1]);
    }
    const paymentReceiptMatch = path.match(
        /^\/api\/v1\/admin\/payments\/([A-Za-z0-9_-]+)\/receipt$/
    );
    if (paymentReceiptMatch && method === "GET") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return paymentReceipt(admin, paymentReceiptMatch[1]);
    }
    if (path === API_PREFIX + "/admin/payments" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return createPayment(request, admin);
    }
    const groupAllocationMatch = path.match(/^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/groups$/);
    if (groupAllocationMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return allocateTournamentGroups(request, admin, groupAllocationMatch[1]);
    }
    const tournamentFormatMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/format$/
    );
    if (tournamentFormatMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return saveTournamentFormat(request, admin, tournamentFormatMatch[1]);
    }
    const tournamentResetMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/reset$/
    );
    if (tournamentResetMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return resetTournamentProgress(request, admin, tournamentResetMatch[1]);
    }
    const stageResetMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/stages\/([A-Za-z0-9_-]+)\/reset$/
    );
    if (stageResetMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return resetTournamentStage(
            request, admin, stageResetMatch[1], stageResetMatch[2]
        );
    }
    const stageApprovalMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/stages\/([A-Za-z0-9_-]+)\/approve$/
    );
    if (stageApprovalMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return approveTournamentStage(
            request, admin, stageApprovalMatch[1], stageApprovalMatch[2]
        );
    }
    const stageCompletionMatch = path.match(
        /^\/api\/v1\/admin\/tournaments\/([A-Za-z0-9_-]+)\/stages\/([A-Za-z0-9_-]+)\/complete$/
    );
    if (stageCompletionMatch && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return completeTournamentStage(
            admin, stageCompletionMatch[1], stageCompletionMatch[2]
        );
    }
    const registrationPermissionsMatch = path.match(
        /^\/api\/v1\/admin\/team-registrations\/([A-Za-z0-9_-]+)\/permissions$/
    );
    if (registrationPermissionsMatch && method === "PUT") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateRegistrationPermissions(request, admin, registrationPermissionsMatch[1], env);
    }
    const adminPlayerProfileMatch = path.match(
        /^\/api\/v1\/admin\/players\/([A-Za-z0-9_-]+)\/public-profile$/
    );
    if (adminPlayerProfileMatch && method === "PATCH") {
        const admin = await requireRole(request, env, ["platform_owner", "tournament_admin"]);
        return updateAdminPlayerPublicProfile(request, admin, adminPlayerProfileMatch[1]);
    }
    const managerPlayerCreateMatch = path.match(
        /^\/api\/v1\/manager\/registrations\/([A-Za-z0-9_-]+)\/players$/
    );
    if (managerPlayerCreateMatch && method === "POST") {
        const manager = await requireRole(request, env, ["team_manager"]);
        return addManagerPlayer(request, manager, managerPlayerCreateMatch[1]);
    }
    const managerPlayerMatch = path.match(/^\/api\/v1\/manager\/players\/([A-Za-z0-9_-]+)$/);
    if (managerPlayerMatch && (method === "PATCH" || method === "DELETE")) {
        const manager = await requireRole(request, env, ["team_manager"]);
        return updateManagerPlayer(request, manager, managerPlayerMatch[1], method === "DELETE");
    }
    const managerPlayerProfileMatch = path.match(
        /^\/api\/v1\/manager\/players\/([A-Za-z0-9_-]+)\/public-profile$/
    );
    if (managerPlayerProfileMatch && method === "PATCH") {
        const manager = await requireRole(request, env, ["team_manager"]);
        return updateManagerPlayerPublicProfile(request, manager, managerPlayerProfileMatch[1]);
    }
    const notificationReadMatch = path.match(/^\/api\/v1\/notifications\/([A-Za-z0-9_-]+)\/read$/);
    if (notificationReadMatch && method === "POST") {
        const actor = await requireRole(request, env, ["platform_owner", "tournament_admin", "team_manager"]);
        return markNotificationRead(actor, notificationReadMatch[1]);
    }
    const rulesAcknowledgeMatch = path.match(
        /^\/api\/v1\/manager\/rules\/([A-Za-z0-9_-]+)\/acknowledge$/
    );
    if (rulesAcknowledgeMatch && method === "POST") {
        const manager = await requireRole(request, env, ["team_manager"]);
        return acknowledgeRules(request, manager, rulesAcknowledgeMatch[1]);
    }
    if (path === API_PREFIX + "/admin/media" && method === "POST") {
        const admin = await requireRole(request, env, ["platform_owner"]);
        return createUpload(request, admin, "public");
    }

    fail(404, "NOT_FOUND", "The requested API route was not found.");
}

async function standings(db, tournamentIdValue) {
    const tournamentId = validId(tournamentIdValue, "Tournament");
    const tournament = await db.prepare(
        "SELECT standings_available FROM afc_tournaments WHERE id = ? AND status <> 'draft'"
    ).bind(tournamentId).first();
    if (!tournament) fail(404, "NOT_FOUND", "The tournament was not found.");
    if (tournament.standings_available !== 1) {
        fail(409, "STANDINGS_NOT_AVAILABLE", "Standings are not available for this tournament yet.");
    }
    const rows = await db.prepare(
        "SELECT g.id AS group_id, g.name AS group_name, r.id AS registration_id, " +
        "tm.id AS team_id, tm.name AS team_name, tm.short_code, m.home_team_id, m.away_team_id, " +
        "m.home_score, m.away_score, m.status " +
        "FROM afc_tournament_groups g JOIN afc_group_teams gt ON gt.group_id = g.id " +
        "JOIN afc_team_registrations r ON r.id = gt.registration_id " +
        "JOIN afc_teams tm ON tm.id = r.team_id " +
        "LEFT JOIN afc_matches m ON m.group_id = g.id AND m.published = 1 " +
        "WHERE g.tournament_id = ? AND r.status = 'approved' " +
        "ORDER BY g.position, tm.name"
    ).bind(tournamentId).all();
    const groups = new Map();
    (rows.results || []).forEach(function (row) {
        if (!groups.has(row.group_id)) groups.set(row.group_id, { id: row.group_id, name: row.group_name, teams: new Map() });
        const group = groups.get(row.group_id);
        if (!group.teams.has(row.team_id)) {
            group.teams.set(row.team_id, {
                teamId: row.team_id, name: row.team_name, shortName: row.short_code,
                played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0
            });
        }
        if (row.status !== "completed" || row.home_score === null || row.away_score === null) return;
        const home = group.teams.get(row.home_team_id);
        const away = group.teams.get(row.away_team_id);
        if (!home || !away) return;
        home.played += 1; away.played += 1;
        home.goalsFor += row.home_score; home.goalsAgainst += row.away_score;
        away.goalsFor += row.away_score; away.goalsAgainst += row.home_score;
        if (row.home_score > row.away_score) {
            home.won += 1; home.points += 3; away.lost += 1;
        } else if (row.home_score < row.away_score) {
            away.won += 1; away.points += 3; home.lost += 1;
        } else {
            home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1;
        }
    });
    const groupTables = Array.from(groups.values()).map(function (group) {
        const teams = Array.from(group.teams.values()).map(function (team) {
            team.goalDifference = team.goalsFor - team.goalsAgainst;
            return team;
        }).sort(function (left, right) {
            return right.points - left.points ||
                right.goalDifference - left.goalDifference ||
                right.goalsFor - left.goalsFor ||
                left.name.localeCompare(right.name);
        });
        teams.forEach(function (team, index) { team.position = index + 1; });
        return { id: group.id, name: group.name, type: "group", teams: teams };
    });
    // Keep stages outermost so the match lookup can use its stage-leading index.
    const leagueRows = await db.prepare(
        "SELECT 0 AS row_type, s.id AS stage_id, s.name AS stage_name, " +
        "s.position AS stage_position, p.team_id, p.seed, tm.name AS team_name, " +
        "tm.short_code, NULL AS match_home_team_id, NULL AS match_away_team_id, " +
        "NULL AS match_home_score, NULL AS match_away_score, NULL AS match_kickoff " +
        "FROM afc_tournament_stages s " +
        "JOIN afc_stage_participants p ON p.stage_id = s.id " +
        "JOIN afc_teams tm ON tm.id = p.team_id " +
        "JOIN afc_team_registrations r ON r.team_id = p.team_id " +
        "AND r.tournament_id = s.tournament_id AND r.status = 'approved' " +
        "WHERE s.tournament_id = ? AND s.stage_type = 'league' " +
        "AND s.status IN ('published', 'in_progress', 'completed') " +
        "UNION ALL " +
        "SELECT 1 AS row_type, s.id AS stage_id, s.name AS stage_name, " +
        "s.position AS stage_position, NULL AS team_id, NULL AS seed, NULL AS team_name, " +
        "NULL AS short_code, m.home_team_id AS match_home_team_id, " +
        "m.away_team_id AS match_away_team_id, m.home_score AS match_home_score, " +
        "m.away_score AS match_away_score, m.kickoff AS match_kickoff " +
        "FROM afc_tournament_stages s CROSS JOIN afc_matches m " +
        "WHERE s.tournament_id = ? AND s.stage_type = 'league' " +
        "AND s.status IN ('published', 'in_progress', 'completed') AND m.stage_id = s.id " +
        "AND m.published = 1 AND m.status = 'completed' " +
        "AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL " +
        "ORDER BY stage_position, row_type, seed, match_kickoff"
    ).bind(tournamentId, tournamentId).all();
    const leagueTables = new Map();
    (leagueRows.results || []).forEach(function (row) {
        if (row.row_type === 0) {
            let table = leagueTables.get(row.stage_id);
            if (!table) {
                table = { id: row.stage_id, name: row.stage_name, type: "league", teams: new Map() };
                leagueTables.set(row.stage_id, table);
            }
            table.teams.set(row.team_id, {
                teamId: row.team_id, name: row.team_name, shortName: row.short_code,
                played: 0, won: 0, drawn: 0, lost: 0,
                goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0
            });
            return;
        }
        let table = leagueTables.get(row.stage_id);
        if (!table) return;
        if (row.match_home_team_id === null || row.match_away_team_id === null ||
            row.match_home_team_id === row.match_away_team_id) return;
        const home = table.teams.get(row.match_home_team_id);
        const away = table.teams.get(row.match_away_team_id);
        if (!home || !away || home.teamId === away.teamId) return;
        home.played += 1;
        away.played += 1;
        home.goalsFor += row.match_home_score;
        home.goalsAgainst += row.match_away_score;
        away.goalsFor += row.match_away_score;
        away.goalsAgainst += row.match_home_score;
        if (row.match_home_score > row.match_away_score) {
            home.won += 1;
            home.points += 3;
            away.lost += 1;
        } else if (row.match_home_score < row.match_away_score) {
            away.won += 1;
            away.points += 3;
            home.lost += 1;
        } else {
            home.drawn += 1;
            away.drawn += 1;
            home.points += 1;
            away.points += 1;
        }
    });
    const rankedLeagueTables = Array.from(leagueTables.values()).map(function (table) {
        const teams = Array.from(table.teams.values()).map(function (team) {
            team.goalDifference = team.goalsFor - team.goalsAgainst;
            return team;
        }).sort(function (left, right) {
            return right.points - left.points ||
                right.goalDifference - left.goalDifference ||
                right.goalsFor - left.goalsFor ||
                left.name.localeCompare(right.name);
        });
        teams.forEach(function (team, index) { team.position = index + 1; });
        return { id: table.id, name: table.name, type: table.type, teams: teams };
    });
    return groupTables.concat(rankedLeagueTables);
}

export function invalidatePublicStandingsCache() {
    publicStandingsCacheGeneration += 1;
    publicStandingsCache.clear();
}

function publicStandingsCacheKey(request, url) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const tournamentId = url.searchParams.get("tournamentId");
    if (request.method.toUpperCase() !== "GET" ||
        path !== API_PREFIX + "/public/standings" ||
        request.headers.has("Authorization") ||
        request.headers.has("Cookie") ||
        typeof tournamentId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
        return null;
    }
    return url.origin + path + "?tournamentId=" + encodeURIComponent(tournamentId);
}

function trimPublicStandingsCache() {
    const now = Date.now();
    for (const [key, entry] of publicStandingsCache) {
        if (!entry.pending && entry.expiresAt <= now) publicStandingsCache.delete(key);
    }
    while (publicStandingsCache.size > PUBLIC_STANDINGS_CACHE_MAX_ENTRIES) {
        const oldestKey = publicStandingsCache.keys().next().value;
        if (!oldestKey) return;
        publicStandingsCache.delete(oldestKey);
    }
}

function publicStandingsResponse(entry, now) {
    const headers = new Headers(entry.response.headers);
    const remainingSeconds = Math.max(0, Math.floor((entry.expiresAt - now) / 1000));
    headers.set("Cache-Control", "public, max-age=" + remainingSeconds);
    const response = entry.response.clone();
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
    });
}

async function withPublicStandingsCache(request, url, load) {
    const key = publicStandingsCacheKey(request, url);
    if (!key) return load();

    const now = Date.now();
    const existing = publicStandingsCache.get(key);
    if (existing && existing.generation === publicStandingsCacheGeneration) {
        if (existing.pending) return (await existing.pending).clone();
        if (existing.expiresAt > now) return publicStandingsResponse(existing, now);
        publicStandingsCache.delete(key);
    }

    const generation = publicStandingsCacheGeneration;
    const entry = { generation: generation, expiresAt: 0, response: null, pending: null };
    const pending = Promise.resolve().then(load).then(async function (response) {
        if (response.status !== 200 ||
            !/^application\/json\b/i.test(response.headers.get("Content-Type") || "")) {
            if (publicStandingsCache.get(key) === entry) publicStandingsCache.delete(key);
            return response;
        }
        const body = await response.clone().text();
        if (new TextEncoder().encode(body).byteLength > PUBLIC_STANDINGS_CACHE_MAX_BODY_BYTES ||
            generation !== publicStandingsCacheGeneration ||
            publicStandingsCache.get(key) !== entry) {
            if (publicStandingsCache.get(key) === entry) publicStandingsCache.delete(key);
            return response;
        }

        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "public, max-age=15");
        const vary = headers.get("Vary") || "";
        if (!vary.split(",").some(function (value) {
            return value.trim().toLowerCase() === "origin";
        })) {
            headers.set("Vary", vary ? vary + ", Origin" : "Origin");
        }
        entry.response = new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
        });
        entry.expiresAt = Date.now() + PUBLIC_STANDINGS_CACHE_TTL_MS;
        entry.pending = null;
        publicStandingsCache.delete(key);
        publicStandingsCache.set(key, entry);
        trimPublicStandingsCache();
        return entry.response.clone();
    }).catch(function (error) {
        if (publicStandingsCache.get(key) === entry) publicStandingsCache.delete(key);
        throw error;
    });
    entry.pending = pending;
    publicStandingsCache.set(key, entry);
    trimPublicStandingsCache();
    return pending;
}

function mutationAffectsPublicStandings(path) {
    return /^\/api\/v1\/admin\/matches\/[A-Za-z0-9_-]+\/result$/.test(path) ||
        /^\/api\/v1\/admin\/team-registrations\/[A-Za-z0-9_-]+\/review$/.test(path) ||
        path === API_PREFIX + "/admin/payments" ||
        /^\/api\/v1\/admin\/payments\/[A-Za-z0-9_-]+\/review$/.test(path) ||
        path === API_PREFIX + "/admin/tournaments" ||
        /^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+(?:\/(?:groups|format|reset))?$/.test(path) ||
        /^\/api\/v1\/admin\/tournaments\/[A-Za-z0-9_-]+\/stages\/[A-Za-z0-9_-]+\/(?:reset|approve|publish|complete)$/.test(path);
}

export function invalidatePublicStandingsAfterMutation(request, response, path) {
    if (request.method.toUpperCase() !== "GET" && response.ok &&
        mutationAffectsPublicStandings(path)) {
        invalidatePublicStandingsCache();
    }
}

export default {
    async scheduled(controller, env) {
        const scheduledTime = Number(controller && controller.scheduledTime);
        const actualTime = Date.now();
        const now = new Date(Number.isFinite(scheduledTime)
            ? Math.max(actualTime, scheduledTime) : actualTime);
        await advanceAutomaticMatches(dbFor(env), now);
    },
    async fetch(request, env, context) {
        let cors;
        try {
            const origin = request.headers.get("Origin");
            cors = corsConfiguration(env, origin);
            if (!cors.allowed) {
                return withSecurityHeaders(errorResponse(
                    new HttpError(403, "ORIGIN_NOT_ALLOWED", "This origin is not permitted.")
                ));
            }
            if (request.method === "OPTIONS") {
                return withSecurityHeaders(applyCors(new Response(null, { status: 204 }), cors));
            }
            const url = new URL(request.url);
            const path = url.pathname.replace(/\/+$/, "") || "/";
            if (isPublicReadRateLimited(request, path)) {
                const limited = errorResponse(new HttpError(
                    429, "RATE_LIMITED", "Too many requests. Please wait and try again."
                ));
                limited.headers.set("Retry-After", "60");
                return withSecurityHeaders(applyCors(limited, cors));
            }
            const response = await withPublicStandingsCache(request, url, function () {
                return route(request, env, context, url);
            });
            invalidatePublicStandingsAfterMutation(request, response, path);
            return withSecurityHeaders(applyCors(response, cors));
        } catch (error) {
            if (!(error instanceof HttpError)) {
                console.error("Worker request failed with an unhandled internal error.");
            }
            return withSecurityHeaders(applyCors(errorResponse(error), cors));
        }
    }
};
