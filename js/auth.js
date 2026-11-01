/* =========================================
   ANGUTSA CHAMPIONSHIP — AUTHENTICATION BEHAVIOUR
   Shared by /login/, /forgot-password/ and /reset-password/.

   Authentication is handled by Firebase; application permissions and
   protected data are verified by the Cloudflare Worker.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;

    /* -------------------------
       Shared helpers
       ------------------------- */

    var ALERT_ICONS = { success: "checkCircle", warning: "alert", danger: "alert", info: "info" };

    function alertMarkup(type, title, message) {
        return '<div class="alert alert-' + type + '" role="' +
            (type === "danger" ? "alert" : "note") + '">' +
            U.icon(ALERT_ICONS[type] || "info") +
            "<span><strong>" + U.escapeHtml(title) + "</strong> " +
            U.escapeHtml(message) + "</span></div>";
    }

    function setAlert(container, markup) {
        if (container) container.innerHTML = markup || "";
    }

    function setLoading(button, isLoading, baseLabel) {
        if (!button) return;
        button.disabled = isLoading;
        button.classList.toggle("is-loading", isLoading);
        button.textContent = isLoading ? "Please wait\u2026" : baseLabel;
    }

    /* Updates a password requirement checklist. */
    function updateRules(container, value) {
        if (!container) return;

        var tests = {
            length: String(value || "").length >= 8,
            upper: /[A-Z]/.test(String(value || "")),
            lower: /[a-z]/.test(String(value || "")),
            number: /\d/.test(String(value || ""))
        };

        Object.keys(tests).forEach(function (key) {
            var item = container.querySelector('[data-rule="' + key + '"]');
            if (item) item.classList.toggle("is-met", tests[key]);
        });

        return tests;
    }

    /* -------------------------
       Login
       ------------------------- */

    function initLogin() {
        var form = document.getElementById("loginForm");
        if (!form) return;

        var alertBox = document.getElementById("authAlert");
        var submit = document.getElementById("loginSubmit");
        var baseLabel = submit ? submit.textContent.trim() : "Sign In";
        var identifier = document.getElementById("loginEmail");
        var password = document.getElementById("loginPassword");
        var remember = document.getElementById("rememberMe");
        var turnstileReady = window.AngutsaTurnstile.create("#loginTurnstile", "login");
        turnstileReady.catch(function (error) {
            setAlert(alertBox, alertMarkup("danger", "Security check unavailable.",
                error && error.message ? error.message : "Please try again later."));
        });

        U.on(form, "submit", async function (event) {
            event.preventDefault();
            U.clearFormErrors(form);
            setAlert(alertBox, "");

            var valid = true;

            if (!identifier || !identifier.value.trim()) {
                U.showFieldError(identifier, "Enter your email address.");
                valid = false;
            } else if (!U.isEmail(identifier.value.trim())) {
                U.showFieldError(identifier, "Enter a valid email address.");
                valid = false;
            }

            if (!password || !password.value) {
                U.showFieldError(password, "Enter your password.");
                valid = false;
            }

            if (!valid) {
                setAlert(alertBox, alertMarkup("danger", "Check your details.",
                    "Some fields need attention before you can continue."));
                return;
            }

            setLoading(submit, true, baseLabel);
            try {
                var platform = await window.AngutsaPlatformReady;
                if (!platform) throw window.AngutsaPlatformError || new Error("Authentication is unavailable.");
                var turnstile = await turnstileReady;
                await platform.verifyLoginChallenge(await turnstile.getToken());
                await platform.login(identifier.value.trim(), password.value, !!(remember && remember.checked));
                var account = await platform.account();
                if (account.status !== "active" || !account.role) {
                    if (account.status === "pending" && account.requestedAccountType === "team-manager") {
                        window.location.assign("/team-manager-dashboard/#/approval-pending");
                        return;
                    }
                    throw new Error("Your account is waiting for approval. If you think this is a mistake, contact the competition office.");
                }
                window.location.assign(account.role === "team_manager"
                    ? "/team-manager-dashboard/#/overview"
                    : "/admin/#/dashboard");
            } catch (error) {
                setLoading(submit, false, baseLabel);
                setAlert(alertBox, alertMarkup("danger", "Sign-in failed.",
                    error && error.message ? error.message : "Check your credentials and try again."));
            }
        });
    }

    /* -------------------------
       Forgot password
       ------------------------- */

    function initForgot() {
        var form = document.getElementById("forgotForm");
        if (!form) return;

        var alertBox = document.getElementById("authAlert");
        var email = document.getElementById("forgotEmail");
        var submit = document.getElementById("forgotSubmit");
        var baseLabel = submit ? submit.textContent.trim() : "Send reset link";
        var card = form.parentNode;
        var turnstileReady = window.AngutsaTurnstile.create(
            "#passwordResetTurnstile",
            "password-reset"
        );
        turnstileReady.catch(function (error) {
            setAlert(alertBox, alertMarkup("danger", "Security check unavailable.",
                error && error.message ? error.message : "Please try again later."));
        });

        U.on(form, "submit", async function (event) {
            event.preventDefault();
            U.clearFormErrors(form);
            setAlert(alertBox, "");

            var result = U.validateForm(form, {
                forgotEmail: {
                    required: true,
                    email: true,
                    requiredMessage: "Enter the email address on your account."
                }
            });

            if (!result.valid) {
                setAlert(alertBox, alertMarkup("danger", "Check your email address.",
                    "Enter a valid email address so the account can be looked up."));
                return;
            }

            setLoading(submit, true, baseLabel);
            try {
                var platform = await window.AngutsaPlatformReady;
                if (!platform) throw window.AngutsaPlatformError || new Error("Password reset is unavailable.");
                var turnstile = await turnstileReady;
                await platform.sendPasswordReset(email.value.trim(), await turnstile.getToken());
                setLoading(submit, false, baseLabel);
                card.innerHTML =
                    '<div class="auth-confirmation">' +
                        '<span class="auth-confirmation-icon">' + U.icon("mail") + "</span>" +
                        "<h2>Check your inbox</h2>" +
                        "<p>A password reset link was sent to <strong>" +
                            U.escapeHtml(email ? email.value.trim() : "") +
                        "</strong>, you will receive a password reset link shortly.</p>" +
                        '<div class="btn-row">' +
                            '<a class="btn btn-primary btn-sm" href="/login/">Back to sign in</a>' +
                            '<a class="btn btn-dark-outline btn-sm" href="/contact/">Contact support</a>' +
                        "</div>" +
                    "</div>";
            } catch (error) {
                setLoading(submit, false, baseLabel);
                setAlert(alertBox, alertMarkup("danger", "Reset email could not be sent.",
                    error && error.message ? error.message : "Please try again."));
            }
        });
    }

    /* -------------------------
       Reset password
       ------------------------- */

    function initReset() {
        var form = document.getElementById("resetForm");
        if (!form) return;

        var alertBox = document.getElementById("authAlert");
        var rules = document.getElementById("passwordRules");
        var password = document.getElementById("resetPassword");
        var confirm = document.getElementById("resetConfirm");
        var submit = document.getElementById("resetSubmit");
        var baseLabel = submit ? submit.textContent.trim() : "Update password";
        var card = form.parentNode;

        /* A reset token must be present. This is a frontend check only:
           the backend must validate the token and its expiry. */
        var resetCode = U.getParam("oobCode");
        if (!resetCode) {
            setAlert(alertBox, alertMarkup("warning", "Reset link not detected.",
                "Open this page using the password-reset link from your email."));
        }

        function refreshRules() {
            var tests = updateRules(rules, password ? password.value : "");
            if (confirm && confirm.value) U.clearFieldError(confirm);
            return tests;
        }

        U.on(password, "input", refreshRules);
        refreshRules();

        U.on(form, "submit", async function (event) {
            event.preventDefault();
            U.clearFormErrors(form);

            var tests = refreshRules();
            var valid = true;

            if (!password || !password.value) {
                U.showFieldError(password, "Enter your new password.");
                valid = false;
            } else if (!tests.length || !tests.number) {
                U.showFieldError(password,
                    "Use at least 8 characters including a number. Mix upper and lower case for strength.");
                valid = false;
            }

            if (!confirm || !confirm.value) {
                U.showFieldError(confirm, "Confirm your new password.");
                valid = false;
            } else if (password && confirm.value !== password.value) {
                U.showFieldError(confirm, "The passwords do not match.");
                valid = false;
            }

            if (!valid) {
                setAlert(alertBox, alertMarkup("danger", "Check your new password.",
                    "The password must meet every requirement before it can be saved."));
                return;
            }

            setLoading(submit, true, baseLabel);
            try {
                var platform = await window.AngutsaPlatformReady;
                if (!platform) throw window.AngutsaPlatformError || new Error("Password reset is unavailable.");
                if (!resetCode) throw new Error("Open the password-reset link from your email first.");
                await platform.resetPassword(resetCode, password.value);
                setLoading(submit, false, baseLabel);
                card.innerHTML =
                    '<div class="auth-confirmation">' +
                        '<span class="auth-confirmation-icon">' + U.icon("lock") + "</span>" +
                        "<h2>Password updated</h2>" +
                        "<p>Your password has been changed successfully.</p>" +
                        '<div class="btn-row">' +
                            '<a class="btn btn-primary btn-sm" href="/login/">Continue to sign in</a>' +
                        "</div>" +
                    "</div>";
            } catch (error) {
                setLoading(submit, false, baseLabel);
                setAlert(alertBox, alertMarkup("danger", "Password could not be updated.",
                    error && error.message ? error.message : "Request a fresh reset link and try again."));
            }
        });
    }

    /* -------------------------
       Start-up
       ------------------------- */

    function start() {
        U.initPasswordToggles(document);
        U.initStrengthMeters(document);

        initLogin();
        initForgot();
        initReset();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }


})();
