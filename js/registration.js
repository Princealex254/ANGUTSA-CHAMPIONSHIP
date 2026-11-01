/* =========================================
   ANGUTSA CHAMPIONSHIP — ACCOUNT REGISTRATION
   Behaviour for /registration/.

   Firebase creates the credential; the Worker records only the pending
   account request and never receives the password.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;

    var ALERT_ICONS = { success: "checkCircle", warning: "alert", danger: "alert", info: "info" };

    function alertMarkup(type, title, message) {
        return '<div class="alert alert-' + type + '" role="' +
            (type === "danger" ? "alert" : "note") + '">' +
            U.icon(ALERT_ICONS[type] || "info") +
            "<span><strong>" + U.escapeHtml(title) + "</strong> " +
            U.escapeHtml(message) + "</span></div>";
    }

    function init() {
        var form = document.getElementById("registrationForm");
        if (!form) return;

        var alertBox = document.getElementById("authAlert");
        var password = document.getElementById("regPassword");
        var confirm = document.getElementById("regConfirm");
        var submit = document.getElementById("regSubmit");
        var baseLabel = submit ? submit.textContent.trim() : "Create account";
        var card = form.parentNode;
        var turnstileReady = window.AngutsaTurnstile.create(
            "#accountRegistrationTurnstile",
            "account-registration"
        );
        turnstileReady.catch(function (error) {
            alertBox.innerHTML = alertMarkup("danger", "Security check unavailable.",
                error && error.message ? error.message : "Please try again later.");
        });

        U.initPasswordToggles(document);

        /* Clear a field error as soon as the visitor starts correcting it. */
        U.$$(".form-control, .form-select, input[type='checkbox']", form).forEach(function (control) {
            U.on(control, "input", function () { U.clearFieldError(control); });
            U.on(control, "change", function () { U.clearFieldError(control); });
        });

        U.on(form, "submit", async function (event) {
            event.preventDefault();
            U.clearFormErrors(form);

            var result = U.validateForm(form, {
                regName: {
                    required: true, minLength: 3,
                    requiredMessage: "Enter your full name."
                },
                regEmail: {
                    required: true, email: true,
                    requiredMessage: "Enter your email address."
                },
                regPhone: {
                    required: true, phone: true,
                    requiredMessage: "Enter your mobile number."
                },
                regPassword: {
                    required: true, minLength: 6,
                    requiredMessage: "Choose a password."
                },
                regConfirm: {
                    required: true,
                    match: confirm || password,
                    requiredMessage: "Confirm your password.",
                    matchMessage: "The passwords do not match."
                },
                acceptTerms: {
                    required: true,
                    requiredMessage: "Accept the terms and privacy policy to continue."
                }
            });

            var valid = result.valid;

            if (!valid) {
                alertBox.innerHTML = alertMarkup("danger", "Check the highlighted fields.",
                    "Some details are missing or need correcting before an account can be created.");
                return;
            }

            submit.disabled = true;
            submit.textContent = "Please wait\u2026";
            try {
                var platform = await window.AngutsaPlatformReady;
                if (!platform) throw window.AngutsaPlatformError || new Error("Account registration is unavailable.");
                await platform.createAccount(
                    document.getElementById("regEmail").value.trim(),
                    password.value,
                    document.getElementById("regName").value.trim(),
                    document.getElementById("regPhone").value.trim(),
                    document.getElementById("accountType").value,
                    await (await turnstileReady).getToken()
                );
                submit.disabled = false;
                submit.textContent = baseLabel;

                card.innerHTML =
                    '<div class="auth-confirmation">' +
                        '<span class="auth-confirmation-icon">' + U.icon("checkCircle") + "</span>" +
                        "<h2>Request submitted</h2>" +
                        "<p>Your Team Manager account request has been created and is awaiting approval from the competition owner. " +
                        "You can submit a team registration now, but manager tools remain locked until the full registration fee is confirmed or the owner approves your account.</p>" +
                        '<div class="notice-bar" role="note">' + U.icon("info") +
                            "<span><strong>Next steps.</strong> Open a tournament with registration available and submit your team. " +
                            "We will email you about your account request, team registration, and payment instructions.</span></div>" +
                        '<div class="btn-row">' +
                            '<a class="btn btn-primary btn-sm" href="/tournaments/?status=registration-open">Register a team</a>' +
                            '<a class="btn btn-dark-outline btn-sm" href="/login/">Go to sign in</a>' +
                        "</div>" +
                    "</div>";
            } catch (error) {
                submit.disabled = false;
                submit.textContent = baseLabel;
                alertBox.innerHTML = alertMarkup("danger", "Account could not be created.",
                    error && error.message ? error.message : "Please check your details and try again.");
            }
        });

    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
