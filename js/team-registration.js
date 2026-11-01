/* =========================================
   ANGUTSA CHAMPIONSHIP — TEAM REGISTRATION
   Behaviour for team-/registration/.

   A six step wizard that validates each step in the browser, keeps a
   live summary and calculates the configured entry fee.

   Pending Team Managers can submit a team; manager tools require owner approval
   or a confirmed full registration fee.
   Team registrations and optional logos are submitted to the authenticated API.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var TOTAL_STEPS = 6;

    var STEP_TITLES = [
        "Tournament", "Team details", "Manager", "Logo", "Fees", "Review"
    ];

    var state = {
        step: 1,
        tournamentId: "",
        categoryId: "",
        managerAccount: null,
        createManagerAccount: false,
        linkExistingIdentity: false,
        submission: null,
        requestKey: "",
        signOutFailed: false,
        turnstile: null
    };

    var els = {};

    /* -------------------------
       Helpers
       ------------------------- */

    var ALERT_ICONS = { success: "checkCircle", warning: "alert", danger: "alert", info: "info" };

    function alertMarkup(type, title, message) {
        return '<div class="alert alert-' + type + '" role="' +
            (type === "danger" ? "alert" : "note") + '">' +
            U.icon(ALERT_ICONS[type] || "info") +
            "<span><strong>" + U.escapeHtml(title) + "</strong> " +
            U.escapeHtml(message) + "</span></div>";
    }

    function currentTournament() {
        return state.tournamentId ? U.tournamentById(state.tournamentId) : null;
    }

    function currentCategory() {
        return state.categoryId ? U.categoryById(state.categoryId) : null;
    }

    function entryFee() {
        var tournament = currentTournament();
        return tournament && Number.isFinite(Number(tournament.registrationFee))
            ? Number(tournament.registrationFee)
            : null;
    }

    /* A submission must be tied to a competition that is accepting entries. */
    function selectableTournaments() {
        return (Data.tournaments || []).filter(function (tournament) {
            return tournament.status === "registration-open";
        });
    }

    function panelFor(step) {
        return document.querySelector('.wizard-panel[data-step="' + step + '"]');
    }

    /* -------------------------
       Step navigation
       ------------------------- */

    function updateStepIndicator(step) {
        state.step = Math.min(Math.max(1, step), TOTAL_STEPS);
        U.$$(".wizard-step").forEach(function (item) {
            var value = parseInt(item.getAttribute("data-step-target"), 10);
            item.classList.toggle("is-active", value === state.step);
            item.classList.toggle("is-complete", value < state.step);
            item.disabled = value > state.step;
            if (value === state.step) item.setAttribute("aria-current", "step");
            else item.removeAttribute("aria-current");
        });

        U.$$("[data-side-step]").forEach(function (item) {
            var value = parseInt(item.getAttribute("data-side-step"), 10);
            item.classList.toggle("is-done", value < state.step);
            item.classList.toggle("is-current", value === state.step);
        });

        var label = "Step " + state.step + " of " + TOTAL_STEPS;

        if (els.meta) els.meta.textContent = label + " \u00b7 " + STEP_TITLES[state.step - 1];
        if (els.sideProgressLabel) els.sideProgressLabel.textContent = label;
        if (els.sideProgressBar) {
            els.sideProgressBar.style.width = Math.round((state.step / TOTAL_STEPS) * 100) + "%";
        }
        if (els.previous) els.previous.disabled = state.step === 1;
        if (els.next) els.next.hidden = state.step === TOTAL_STEPS;
        if (els.submit) els.submit.hidden = state.step !== TOTAL_STEPS;
    }

    function setStep(step) {
        updateStepIndicator(step);
        U.$$(".wizard-panel").forEach(function (panel) {
            panel.hidden = parseInt(panel.getAttribute("data-step"), 10) !== state.step;
        });
        renderStepContent();
    }

    /* -------------------------
       Summary panels
       ------------------------- */

    function teamNameValue() {
        return els.teamName ? els.teamName.value.trim() : "";
    }

    function managerNameValue() {
        return els.managerName ? els.managerName.value.trim() : "";
    }

    function usedTeamShortCodes() {
        var codes = {};
        (Data.teams || []).forEach(function (team) {
            if (team.shortName) codes[String(team.shortName).toUpperCase()] = true;
        });

        return codes;
    }

    function generatedShortCode(name, usedCodes) {
        var words = String(name || "").toUpperCase().match(/[A-Z]+/g) || [];
        if (!words.length) return "";

        var preferred;
        if (words.length === 1) {
            preferred = words[0].slice(0, 3);
        } else if (words.length === 2) {
            preferred = words[0].slice(0, 2) + words[1].charAt(0);
        } else {
            preferred = words.map(function (word) {
                return word.charAt(0);
            }).join("").slice(0, 3);
        }

        if (!usedCodes[preferred]) return preferred;

        var compactName = words.join("");
        var readableFallback = compactName.slice(0, 4);
        if (readableFallback.length === 4 && !usedCodes[readableFallback]) {
            return readableFallback;
        }

        var seed = String(name).split("").reduce(function (total, character) {
            return (total * 31 + character.charCodeAt(0)) % 456976;
        }, 7);
        for (var offset = 0; offset < 456976; offset += 1) {
            var value = (seed + offset) % 456976;
            var candidate = String.fromCharCode(
                65 + Math.floor(value / 17576),
                65 + Math.floor((value % 17576) / 676),
                65 + Math.floor((value % 676) / 26),
                65 + (value % 26)
            );
            if (!usedCodes[candidate]) return candidate;
        }

        return "";
    }

    function updateGeneratedShortCode() {
        if (!els.teamShortCode) return;

        try {
            var usedCodes = usedTeamShortCodes();
            els.teamShortCode.value = generatedShortCode(teamNameValue(), usedCodes);
            if (els.teamShortCode.value) {
                U.clearFieldError(els.teamShortCode);
            }
            var hint = document.getElementById("teamShortCodeHint");
            if (hint) {
                hint.textContent = els.teamShortCode.value
                    ? "Generated automatically from the team name. This code is used on fixtures and tables."
                    : "Enter a team name using letters so a short code can be generated.";
            }
        } catch (error) {
            console.error("Unable to generate a unique team short code.", error);
            els.teamShortCode.value = "";
            var errorHint = document.getElementById("teamShortCodeHint");
            if (errorHint) {
                errorHint.textContent = "We could not check code availability. Please reload the page and try again.";
            }
        }
    }

    function isMissing(value) {
        return !value || value === "-";
    }

    function updateSideSummary() {
        if (!els.sideSummary) return;

        var tournament = currentTournament();
        var category = currentCategory();
        var rows = [
            ["Tournament", tournament ? tournament.name : "-"],
            ["Category", category ? category.name : "-"],
            ["Team", teamNameValue() || "-"],
            ["Manager", managerNameValue() || "-"]
        ];

        els.sideSummary.innerHTML = rows.map(function (row) {
            return "<li" + (isMissing(row[1]) ? ' class="is-missing"' : "") + "><span>" +
                U.escapeHtml(row[0]) + "</span><span>" + U.escapeHtml(row[1]) + "</span></li>";
        }).join("");

        if (els.sideFee) {
            var fee = entryFee();
            els.sideFee.textContent = fee === null ? "-" : U.formatMoney(fee);
        }
    }

    /* -------------------------
       Step content: tournament and category
       ------------------------- */

    function renderTournamentInfo() {
        if (!els.tournamentInfo) return;

        var tournament = currentTournament();

        if (!tournament) {
            els.tournamentInfo.innerHTML = "";
            return;
        }

        els.tournamentInfo.innerHTML =
            '<div class="summary-block"><h4>' + U.escapeHtml(tournament.name) + "</h4>" +
                '<ul class="summary-list">' +
                    "<li><span>Season</span><span>" + U.escapeHtml(tournament.season) + "</span></li>" +
                    "<li><span>Category</span><span>" + U.escapeHtml(tournament.categoryLabel) + "</span></li>" +
                    "<li><span>Format</span><span>" + U.escapeHtml(tournament.formatLabel) + "</span></li>" +
                    "<li><span>Venue</span><span>" + U.escapeHtml(tournament.venue) + "</span></li>" +
                    "<li><span>Match dates</span><span>" +
                        U.escapeHtml(U.formatDateRange(tournament.startDate, tournament.endDate)) + "</span></li>" +
                    "<li><span>Registration closes</span><span>" +
                        U.formatDate(tournament.registrationCloses) + "</span></li>" +
                    "<li><span>Places</span><span>" + tournament.teamsRegistered + " of " +
                        tournament.teamLimit + " filled</span></li>" +
                "</ul>" +
            "</div>";
    }

    function renderStepContent() {
        renderTournamentInfo();
        renderFeeSummary();
        updateReviewSummary();
        updateSideSummary();
        updateTournamentRuleLinks();
    }

    function renderFeeSummary() {
        if (!els.feeSummary) return;

        var category = currentCategory();
        var payment = (Data.meta && Data.meta.payment) || {};

        if (!category) {
            els.feeSummary.innerHTML = U.emptyState({
                icon: "wallet",
                title: "No category selected",
                message: "The selected tournament has no eligible category."
            });
            return;
        }

        els.feeSummary.innerHTML =
            '<div class="summary-block"><h4>Entry fee and payment</h4>' +
                '<ul class="summary-list">' +
                    "<li><span>Entry fee</span><span>" + U.formatMoney(entryFee()) + "</span></li>" +
                    "<li><span>Method to pay</span><span>" +
                        U.escapeHtml(payment.method || "M-Pesa") + "</span></li>" +
                    "<li><span>Phone number</span><span>" +
                        U.escapeHtml(payment.number || "0707119367") + "</span></li>" +
                    "<li><span>M-Pesa name</span><span>" +
                        U.escapeHtml(payment.accountName || "KELVIN MAGORO") + "</span></li>" +
                "</ul>" +
                '<p class="form-note">Keep the M-Pesa message as proof of payment.</p>' +
            "</div>";
    }

    function updateTournamentRuleLinks() {
        var href = "/tournament-rules/";
        if (state.tournamentId) {
            href += "?tournament=" + encodeURIComponent(state.tournamentId);
        }

        U.$$('a[href^="/tournament-rules/"]').forEach(function (link) {
            link.href = href;
        });
    }

    /* -------------------------
       Review summary
       ------------------------- */

    function reviewBlock(title, items) {
        return '<div class="summary-block"><h4>' + U.escapeHtml(title) + "</h4>" +
            '<ul class="summary-list">' + items.map(function (item) {
                return "<li" + (isMissing(item[1]) ? ' class="is-missing"' : "") + "><span>" +
                    U.escapeHtml(item[0]) + "</span><span>" + U.escapeHtml(item[1]) + "</span></li>";
            }).join("") + "</ul></div>";
    }

    function updateReviewSummary() {
        if (!els.reviewSummary) return;

        var tournament = currentTournament();
        var category = currentCategory();
        var managerPublic = els.managerPublic ? els.managerPublic.checked : true;

        els.reviewSummary.innerHTML =
            reviewBlock("Competition", [
                ["Tournament", tournament ? tournament.name : "-"],
                ["Category", category ? category.name : "-"],
                ["Registration closes", tournament ? U.formatDate(tournament.registrationCloses) : "-"]
            ]) +
            reviewBlock("Team", [
                ["Team name", teamNameValue() || "-"],
                ["Short code", els.teamShortCode ? els.teamShortCode.value.trim() : "-"],
                ["Home area", els.teamLocation ? els.teamLocation.value.trim() : "-"]
            ]) +
            reviewBlock("Team Manager", [
                ["Manager", managerNameValue() || "-"],
                ["Role", els.managerRole ? els.managerRole.value : "-"],
                ["Email", els.managerEmail ? els.managerEmail.value.trim() : "-"],
                ["Mobile", els.managerPhone ? els.managerPhone.value.trim() : "-"],
                ["Public listing", managerPublic ? "Display name published" : "Not published"]
            ]) +
            reviewBlock("Fees", [
                ["Entry fee", entryFee() === null ? "-" : U.formatMoney(entryFee())],
                ["Method to pay", "M-Pesa"]
            ]);
    }

    /* -------------------------
       Per-step validation
       ------------------------- */

    function alertTo(container, type, title, message) {
        if (!container) return;
        /* An empty type clears the region, which happens after a good step. */
        container.innerHTML = type ? alertMarkup(type, title, message) : "";
    }

    function showManagerGate(title, message, showCreateAccount) {
        var layout = document.querySelector(".wizard-layout");
        if (layout) layout.hidden = true;
        els.alert.innerHTML = alertMarkup("warning", title, message) +
            '<div class="btn-row">' +
                (showCreateAccount
                    ? '<a class="btn btn-primary" href="/registration/">Create a Team Manager account</a>'
                    : "") +
                '<a class="btn btn-dark-outline" href="/login/">Sign in</a>' +
            "</div>";
    }

    function isPendingManagerAccount(account) {
        return Boolean(account && account.status === "pending" &&
            account.requestedAccountType === "team-manager" &&
            (!account.role || account.role === "team_manager"));
    }

    function canRegisterWithManagerAccount(account) {
        return Boolean(account &&
            ((account.role === "team_manager" && account.status === "active") ||
                isPendingManagerAccount(account)));
    }

    function setManagerAccountFields(account) {
        state.managerAccount = account;
        state.createManagerAccount = false;
        state.linkExistingIdentity = false;
        els.managerName.value = account.name || "";
        els.managerName.readOnly = true;
        els.managerEmail.value = account.email || "";
        els.managerEmail.readOnly = true;
        els.managerPhone.value = account.phone || "";
        els.managerPhone.readOnly = true;
        els.managerPasswordField.hidden = true;
        els.managerPasswordConfirmField.hidden = true;
        els.managerPassword.value = "";
        els.managerPasswordConfirm.value = "";
        els.managerAccountHint.textContent = account.status === "pending"
            ? "Your account is pending. This team will be submitted now; manager access stays locked until the full fee is confirmed or the owner approves your account."
            : "Your approved account is linked to this team registration. Update your profile before continuing if these details need correction.";
    }

    function enableManagerAccountCreation(existingIdentity) {
        var linkExistingIdentity = Boolean(existingIdentity && existingIdentity.email);
        state.managerAccount = null;
        state.createManagerAccount = true;
        state.linkExistingIdentity = linkExistingIdentity;
        els.managerName.value = linkExistingIdentity ? existingIdentity.displayName || "" : "";
        els.managerName.readOnly = false;
        els.managerEmail.value = linkExistingIdentity ? existingIdentity.email : "";
        els.managerEmail.readOnly = linkExistingIdentity;
        els.managerPhone.value = "";
        els.managerPhone.readOnly = false;
        els.managerPasswordField.hidden = linkExistingIdentity;
        els.managerPasswordConfirmField.hidden = linkExistingIdentity;
        els.managerPassword.value = "";
        els.managerPasswordConfirm.value = "";
        els.managerAccountHint.textContent = linkExistingIdentity
            ? "This Firebase sign-in is not linked to a championship account yet. Submit a Team Manager request using this sign-in; the account will remain pending until the owner approves it or the full registration fee is confirmed."
            : "Create a Team Manager account as part of this submission. Manager access stays locked until the full fee is confirmed or the owner approves your account.";
    }

    function focusStep(step) {
        var panel = panelFor(step);
        var heading = panel ? panel.querySelector("h2") : null;
        if (heading && heading.focus) {
            heading.setAttribute("tabindex", "-1");
            heading.focus();
            if (heading.scrollIntoView) {
                heading.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    }

    function clearNavError() {
        if (!els.navError) return;
        els.navError.textContent = "";
        els.navError.hidden = true;
    }

    function showNavError(message) {
        if (!els.navError) return;
        els.navError.textContent = message;
        els.navError.hidden = false;
    }

    function focusInvalidField(step) {
        var panel = panelFor(step);
        var invalidWrapper = panel ? panel.querySelector(".has-error") : null;
        var control = invalidWrapper
            ? invalidWrapper.querySelector("input, select, textarea, button")
            : null;

        if (control && control.focus) {
            control.focus();
            return;
        }
        focusStep(step);
    }

    function showStepValidationError(step, isSubmit) {
        var action = isSubmit
            ? "before the registration can be submitted."
            : "before continuing.";
        showNavError("Step " + step + " needs attention. Complete the highlighted items in " +
            STEP_TITLES[step - 1].toLowerCase() + " " + action);
        focusInvalidField(step);
    }

    /* Warns about a possible duplicate team name. The authoritative check
       happens on the server when the registration is reviewed. */
    function duplicateTeamNote() {
        if (!els.teamDuplicateNote) return;

        var name = U.normalise(teamNameValue());
        if (!name || name.length < 3) {
            els.teamDuplicateNote.innerHTML = "";
            return;
        }

        var clash = (Data.teams || []).filter(function (team) {
            var existing = U.normalise(team.name);
            return existing.indexOf(name) > -1 || name.indexOf(existing) > -1;
        })[0];

        els.teamDuplicateNote.innerHTML = clash
            ? '<div class="alert alert-warning" role="note">' + U.icon("alert") +
              "<span><strong>Possible duplicate.</strong> A team with a similar name (" +
              U.escapeHtml(clash.name) + ") is already in the directory. The competitions office will " +
              "confirm this before approval.</span></div>"
            : "";
    }

    /* Steps 1 to 4: tournament, team details, manager profile and documents. */
    function validateBasicStep(step) {
        var form = document.getElementById("teamRegistrationForm");

        if (step === 1) {
            var tournament = currentTournament();
            if (!tournament || tournament.status !== "registration-open") {
                U.showFieldError(els.tournament, "Select a tournament that is open for registration.");
                return false;
            }
            if (!currentCategory()) {
                U.showFieldError(els.tournament,
                    "This tournament has no eligible category configured. Contact the competitions office.");
                return false;
            }
            return true;
        }

        if (step === 2) {
            updateGeneratedShortCode();
            return U.validateForm(form, {
                teamName: {
                    required: true, minLength: 3,
                    requiredMessage: "Enter the team name."
                },
                teamShortName: {
                    required: true, pattern: /^[A-Za-z]{3,4}$/,
                    requiredMessage: "Enter a team name to generate its short code.",
                    patternMessage: "The generated code must contain three or four letters."
                },
                teamLocation: {
                    required: true,
                    requiredMessage: "Enter the home area."
                }
            }).valid;
        }

        if (step === 3) {
            if (state.managerAccount) return canRegisterWithManagerAccount(state.managerAccount);
            var rules = {
                managerName: {
                    required: true, minLength: 3,
                    requiredMessage: "Enter your full name."
                },
                managerEmail: {
                    required: true, email: true,
                    requiredMessage: "Enter your email address."
                },
                managerPhone: {
                    required: true, phone: true,
                    requiredMessage: "Enter your mobile number."
                }
            };
            if (!state.linkExistingIdentity) {
                rules.managerPassword = {
                    required: true, minLength: 6,
                    requiredMessage: "Choose a password."
                };
                rules.managerPasswordConfirm = {
                    required: true,
                    match: els.managerPassword,
                    requiredMessage: "Confirm your password.",
                    matchMessage: "The passwords do not match."
                };
            }
            return U.validateForm(form, rules).valid;
        }

        /* Documents have no mandatory uploads in this phase. */
        return true;
    }

    function validateFinalStep() {
        var form = document.getElementById("teamRegistrationForm");

        return U.validateForm(form, {
            confirmDeclaration: {
                required: true,
                requiredMessage: "Confirm the declaration before submitting."
            },
            acceptLegal: {
                required: true,
                requiredMessage: "Accept the Terms & Conditions and acknowledge the Privacy Policy."
            }
        }).valid;
    }

    function validateFeeStep() {
        var form = document.getElementById("teamRegistrationForm");
        return U.validateForm(form, {
            acknowledgeFees: { required: true, requiredMessage: "Acknowledge the payment details." }
        }).valid;
    }

    function validateStep(step) {
        if (step === TOTAL_STEPS) return validateFinalStep();
        if (step === TOTAL_STEPS - 1) return validateFeeStep();
        return validateBasicStep(step);
    }

    function moveNext() {
        U.clearFormErrors(els.form);
        clearNavError();

        if (!validateStep(state.step)) {
            showStepValidationError(state.step, false);
            return;
        }

        setStep(state.step + 1);
        focusStep(state.step);
    }

    /* -------------------------
       Submission and confirmation
       ------------------------- */

    function confirmationMarkup() {
        var tournament = currentTournament();
        var category = currentCategory();
        var submission = state.submission;
        var email = els.managerEmail ? els.managerEmail.value.trim().toLowerCase() : "";
        var emailMessage = submission && submission.emailStatus === "accepted_by_provider"
                ? "A registration confirmation email has been sent to " + email + "."
                : "Your registration was submitted, but we couldn't confirm that an email was sent. You can still sign in to your account.";
        var accountAccessMessage = state.managerAccount && state.managerAccount.status === "pending"
            ? "Your Team Manager tools remain locked until the full registration fee is confirmed or the owner approves your account."
            : "";
        var fee = entryFee();
        var feeRequired = Number(fee) > 0;
        var payment = ((window.AngutsaData && window.AngutsaData.meta) || {}).payment || {};
        var adminWhatsApp = String(payment.whatsapp || "254707119367").replace(/\D/g, "");
        var adminWhatsAppLabel = adminWhatsApp.replace(/^254/, "0")
            .replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
        var paymentMarkup = U.paymentDetailsMarkup({ note: false });
        var paymentNextSteps = feeRequired
            ? '<li><span class="feature-check" aria-hidden="true">1</span>' +
                "<span>Pay the full registration fee using the M-Pesa details below.</span></li>" +
                '<li><span class="feature-check" aria-hidden="true">2</span>' +
                "<span>Send the M-Pesa confirmation message to the admin on WhatsApp at " +
                    U.escapeHtml(adminWhatsAppLabel) + " so the payment can be updated.</span></li>" +
                '<li><span class="feature-check" aria-hidden="true">3</span>' +
                    "<span>Once your registration is approved, you can sign in and add or update the players who will participate in the tournament. Please clear any remaining balance as soon as possible.</span></li>"
            : '<li><span class="feature-check" aria-hidden="true">1</span>' +
                "<span>No registration fee is due. The competitions office will review your team details.</span></li>" +
                '<li><span class="feature-check" aria-hidden="true">2</span>' +
                "<span>You can add players in your manager dashboard after approval.</span></li>";
        var paymentNotice = feeRequired
            ? paymentMarkup ||
                '<div class="notice-bar" role="note"><span>Payment details are not currently listed. Contact the admin on WhatsApp at ' +
                    U.escapeHtml(adminWhatsAppLabel) + " for the current M-Pesa destination.</span></div>"
            : "";
        var signOutMessage = state.signOutFailed
            ? "We couldn't sign you out automatically. Sign out before leaving this device."
            : "You don't need to sign in now. Use Sign In whenever you're ready.";

        return '<section class="wizard-confirmation">' +
            '<span class="confirmation-icon">' + U.icon("checkCircle") + "</span>" +
            "<h2>Registration submitted successfully</h2>" +
            "<p>Your team registration has been submitted to the competitions office.</p>" +
            "<p>" + U.escapeHtml(emailMessage) + "</p>" +
            (accountAccessMessage ? "<p>" + U.escapeHtml(accountAccessMessage) + "</p>" : "") +
            "<p>" + U.escapeHtml(signOutMessage) + "</p>" +

            '<div class="confirmation-panel">' +
                '<ul class="summary-list">' +
                    "<li><span>Tournament</span><span>" +
                        U.escapeHtml(tournament ? tournament.name : "-") + "</span></li>" +
                    "<li><span>Category</span><span>" +
                        U.escapeHtml(category ? category.name : "-") + "</span></li>" +
                    "<li><span>Team</span><span>" + U.escapeHtml(teamNameValue() || "-") + "</span></li>" +
                    "<li><span>Manager</span><span>" + U.escapeHtml(managerNameValue() || "-") + "</span></li>" +
                    "<li><span>Entry fee</span><span>" +
                        U.escapeHtml(entryFee() === null ? "-" : U.formatMoney(entryFee())) + "</span></li>" +
                    "<li><span>Payment status</span><span>" +
                        (feeRequired ? "Awaiting payment" : "No fee due") + "</span></li>" +
                    "<li><span>Registration reference</span><span>" +
                        U.escapeHtml(submission ? submission.reference : "-") + "</span></li>" +
                "</ul>" +
            "</div>" +

            "<h3>What happens next</h3>" +
            '<ul class="requirement-list">' + paymentNextSteps + "</ul>" +
            paymentNotice +

            '<div class="notice-bar" role="note">' + U.icon("info") +
                "<span><strong>Keep a copy.</strong> Print this page for your records. The team appears in " +
                "the public directory only after an administrator approves it.</span></div>" +

            '<div class="btn-row">' +
                '<button type="button" class="btn btn-primary" id="printRegistration">Print this page</button>' +
                '<a class="btn btn-dark-outline" href="/login/">Sign In</a>' +
                '<a class="btn btn-dark-outline" href="/tournaments/">Back to tournaments</a>' +
            "</div>" +
        "</section>";
    }

    function setSubmitLoading(isLoading) {
        if (!els.submit) return;
        els.submit.disabled = isLoading;
        els.submit.classList.toggle("is-loading", isLoading);
        if (isLoading) {
            els.submit.setAttribute("aria-busy", "true");
        } else {
            els.submit.removeAttribute("aria-busy");
        }
        if (els.submitLabel) {
            els.submitLabel.textContent = isLoading ? "Submitting..." : "Submit registration";
        }
    }

    function createIdempotencyKey() {
        var bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes).map(function (value) {
            return value.toString(16).padStart(2, "0");
        }).join("");
    }

    async function ensureManagerAccount(platform) {
        var account = state.managerAccount;
        if (!account && state.createManagerAccount) {
            var accountToken = await state.turnstile.getToken("account-registration");
            if (state.linkExistingIdentity) {
                await platform.requestAccount(
                    els.managerName.value.trim(),
                    els.managerPhone.value.trim(),
                    "team-manager",
                    accountToken,
                    true
                );
            } else {
                await platform.createAccount(
                    els.managerEmail.value.trim(),
                    els.managerPassword.value,
                    els.managerName.value.trim(),
                    els.managerPhone.value.trim(),
                    "team-manager",
                    accountToken,
                    true
                );
            }
            account = {
                name: els.managerName.value.trim(),
                email: els.managerEmail.value.trim(),
                phone: els.managerPhone.value.trim(),
                role: "team_manager",
                status: "pending",
                requestedAccountType: "team-manager"
            };
            setManagerAccountFields(account);
        }
        if (!canRegisterWithManagerAccount(account)) {
            throw new Error("A pending or owner-approved Team Manager account is required to register a team.");
        }
        if (account !== state.managerAccount) setManagerAccountFields(account);
        return account;
    }

    async function saveTeamSubmission() {
        var platform = await window.AngutsaPlatformReady;
        if (!platform) throw window.AngutsaPlatformError || new Error("Registration services are unavailable.");
        await ensureManagerAccount(platform);

        var logoKey = "";
        var logo = els.teamLogoFile && els.teamLogoFile.files ? els.teamLogoFile.files[0] : null;
        if (logo) {
            if (["image/png", "image/jpeg", "image/webp"].indexOf(logo.type) === -1 ||
                logo.size < 1 || logo.size > 5 * 1024 * 1024) {
                throw new Error("Choose a PNG, JPEG or WebP logo no larger than 5 MB.");
            }
            var uploaded = await platform.uploadTeamLogo(
                logo,
                await state.turnstile.getToken("team-logo-upload")
            );
            logoKey = uploaded.key;
        }

        var response = await platform.request("/team-registrations", {
            method: "POST",
            headers: { "Idempotency-Key": state.requestKey || (state.requestKey = createIdempotencyKey()) },
            body: {
                tournamentId: state.tournamentId,
                categoryId: state.categoryId,
                teamName: teamNameValue(),
                location: els.teamLocation ? els.teamLocation.value.trim() : "",
                managerPublic: !!(els.managerPublic && els.managerPublic.checked),
                logoKey: logoKey,
                turnstileToken: await state.turnstile.getToken("team-registration")
            }
        });
        state.submission = response;
        state.requestKey = "";
        return response;
    }

    async function submitRegistration() {
        U.clearFormErrors(els.form);
        clearNavError();

        for (var step = 1; step <= TOTAL_STEPS; step += 1) {
            var savedStep = state.step;
            state.step = step;

            var ok = validateStep(step);

            state.step = savedStep;

            if (!ok) {
                setStep(step);
                showStepValidationError(step, true);
                return;
            }
        }

        setSubmitLoading(true);
        try {
            try {
                await saveTeamSubmission();
            } catch (error) {
                console.error("Unable to submit team registration.", error);
                showNavError("Registration could not be submitted. " +
                    (error && error.message ? error.message : "Please check your connection and try again."));
                els.navError.focus();
                return;
            }

            try {
                var platform = await window.AngutsaPlatformReady;
                await platform.logout();
                state.signOutFailed = false;
            } catch (error) {
                console.error("Team registration was submitted, but the manager session could not be signed out.", error);
                state.signOutFailed = true;
            }
        } finally {
            setSubmitLoading(false);
        }

        U.$$(".wizard-panel").forEach(function (panel) { panel.hidden = true; });
        U.$$(".wizard-steps").forEach(function (list) { list.hidden = true; });
        U.$$(".wizard-nav").forEach(function (nav) { nav.hidden = true; });

        if (els.confirmation) {
            els.confirmation.hidden = false;
            els.confirmation.innerHTML = confirmationMarkup();

            U.on(document.getElementById("printRegistration"), "click", function () {
                window.print();
            });

            if (els.confirmation.scrollIntoView) {
                els.confirmation.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }

        alertTo(els.alert, "", "", "");
        clearNavError();
        U.toast("Team registration submitted for review.", "success");
    }

    /* -------------------------
       Wiring
       ------------------------- */

    function collectElements() {
        els.tournament = document.getElementById("regTournament");
        els.tournamentInfo = document.getElementById("tournamentInfo");
        els.teamName = document.getElementById("teamName");
        els.teamShortCode = document.getElementById("teamShortName");
        els.teamLocation = document.getElementById("teamLocation");
        els.teamDuplicateNote = document.getElementById("teamDuplicateNote");

        els.managerName = document.getElementById("managerName");
        els.managerRole = document.getElementById("managerRole");
        els.managerEmail = document.getElementById("managerEmail");
        els.managerPhone = document.getElementById("managerPhone");
        els.managerPassword = document.getElementById("managerPassword");
        els.managerPasswordConfirm = document.getElementById("managerPasswordConfirm");
        els.managerPasswordField = document.getElementById("managerPasswordField");
        els.managerPasswordConfirmField = document.getElementById("managerPasswordConfirmField");
        els.managerAccountHint = document.getElementById("managerAccountHint");
        els.managerPublic = document.getElementById("managerPublic");
        els.teamLogoFile = document.getElementById("teamLogoFile");

        els.feeSummary = document.getElementById("feeSummary");
        els.reviewSummary = document.getElementById("reviewSummary");

        els.alert = document.getElementById("wizardAlert");
        els.navError = document.getElementById("wizardNavError");
        els.confirmation = document.getElementById("wizardConfirmation");

        els.form = document.getElementById("teamRegistrationForm");
        els.previous = document.getElementById("wizardPrevious");
        els.next = document.getElementById("wizardNext");
        els.submit = document.getElementById("teamRegistrationSubmit");
        els.submitLabel = document.getElementById("teamRegistrationSubmitLabel");
        els.meta = document.getElementById("wizardMeta");

        els.sideSummary = document.getElementById("sideSummary");
        els.sideProgressLabel = document.getElementById("sideProgressLabel");
        els.sideProgressBar = document.getElementById("sideProgressBar");
        els.sideFee = document.getElementById("sideFee");
    }

    function populateTournamentSelect() {
        if (!els.tournament) return;

        var list = selectableTournaments();

        if (!list.length) {
            els.tournament.innerHTML = '<option value="">No competitions open for registration</option>';
            return;
        }

        els.tournament.innerHTML = '<option value="">Select a tournament</option>' +
            list.map(function (tournament) {
                var label = tournament.name + " \u2014 " + tournament.season + " (" +
                    U.tournamentStatusLabel(tournament.status) + ")";
                return '<option value="' + U.escapeHtml(tournament.id) + '">' +
                    U.escapeHtml(label) + "</option>";
            }).join("");
    }

    /* The registration wizard is entered through an open tournament link. */
    function applyDeepLink() {
        var requested = U.getParam("tournament");
        if (!requested || !els.tournament) return false;

        var match = (Data.tournaments || []).filter(function (tournament) {
            return tournament.id === requested || tournament.slug === requested;
        })[0];

        if (!match || match.status !== "registration-open") return false;

        els.tournament.value = match.id;
        state.tournamentId = match.id;
        state.categoryId = match.categoryId || "";
        return true;
    }

    function bindNavigation() {
        U.on(els.tournament, "change", function () {
            state.tournamentId = els.tournament.value;
            var tournament = currentTournament();
            state.categoryId = tournament ? tournament.categoryId || "" : "";
            renderStepContent();
        });

        U.on(els.form, "submit", function (event) {
            event.preventDefault();
            if (state.step < TOTAL_STEPS) moveNext();
            else submitRegistration();
        });

        U.on(els.form, "input", clearNavError);
        U.on(els.form, "change", clearNavError);

        U.on(els.previous, "click", function () {
            if (state.step > 1) {
                clearNavError();
                setStep(state.step - 1);
                focusStep(state.step);
            }
        });

        U.on(els.next, "click", moveNext);

        U.on(els.teamLogoFile, "change", function () {
            var file = els.teamLogoFile.files && els.teamLogoFile.files[0];
            var hint = document.getElementById("teamLogoHint");
            if (hint) hint.textContent = file
                ? file.name + " selected. It will upload securely when you submit."
                : "PNG, JPEG or WebP, up to 5 MB. If you do not have a logo, continue.";
        });

        /* Step links only revisit the current or an earlier step. */
        U.$$(".wizard-step").forEach(function (item) {
            U.on(item, "click", function () {
                var target = parseInt(item.getAttribute("data-step-target"), 10);
                if (target >= state.step) return;
                clearNavError();
                setStep(target);
                focusStep(target);
            });
        });

        if (els.teamName) {
            U.on(els.teamName, "input", function () {
                updateGeneratedShortCode();
                duplicateTeamNote();
                updateSideSummary();
                updateReviewSummary();
            });
            U.on(els.teamName, "blur", function () {
                updateGeneratedShortCode();
                duplicateTeamNote();
            });
        }

        /* Live summary updates for the fields shown in the sidebar. */
        [els.teamShortCode, els.teamLocation,
            els.managerName, els.managerRole, els.managerEmail, els.managerPhone,
            els.managerPublic].forEach(function (control) {
            if (!control) return;

            U.on(control, "input", function () {
                U.clearFieldError(control);
                updateSideSummary();
                updateReviewSummary();
            });
            U.on(control, "change", function () {
                U.clearFieldError(control);
                updateSideSummary();
                updateReviewSummary();
            });
        });

        /* Clear checkbox errors as soon as a box is ticked. */
        U.$$("input[type='checkbox']").forEach(function (control) {
            U.on(control, "change", function () {
                U.clearFieldError(control);
            });
        });
    }

    async function init() {
        if (!document.getElementById("teamRegistrationForm")) return;

        collectElements();
        U.initPasswordToggles(document);

        try {
            var platform = await window.AngutsaPlatformReady;
            if (!platform) throw window.AngutsaPlatformError || new Error("Registration services are unavailable.");

            var account = null;
            try {
                account = await platform.account();
            } catch (error) {
                if (error && (error.status === 401 || error.code === "UNAUTHORIZED")) {
                    enableManagerAccountCreation();
                }
                else if (error && error.code === "ACCOUNT_NOT_ASSIGNED") {
                    var currentUser = platform.currentUser();
                    if (currentUser && currentUser.email) {
                        enableManagerAccountCreation(currentUser);
                    } else {
                        showManagerGate(
                            "Team Manager account required",
                            "This sign-in is not linked to a championship account. Sign in with an email account or contact the competition office for help.",
                            false
                        );
                        return;
                    }
                } else if (!error || (error.status !== 401 && error.code !== "UNAUTHORIZED")) {
                    throw error;
                }
            }

            if (account) {
                if (!canRegisterWithManagerAccount(account)) {
                    showManagerGate(
                        "Team Manager account required",
                        "Use a pending Team Manager account or an active account approved by the competition owner to register a team.",
                        false
                    );
                    return;
                }
                setManagerAccountFields(account);
            }

            var publicData = await platform.requestAll("/public/bootstrap?includePayment=1", [
                "categories", "tournaments", "teams"
            ]);
            Data = publicData;
            window.AngutsaData = publicData;
            var categoriesById = Object.create(null);
            (Data.categories || []).forEach(function (category) {
                categoriesById[category.id] = category;
            });
            (Data.tournaments || []).forEach(function (tournament) {
                tournament.categoryLabel = categoriesById[tournament.categoryId]
                    ? categoriesById[tournament.categoryId].name
                    : "Configured category";
                tournament.formatLabel = tournament.format;
                tournament.teamLimit = tournament.teamCap;
            });
        } catch (error) {
            alertTo(els.alert, "danger", "Registration is unavailable.",
                error && error.message ? error.message : "Please try again later.");
            return;
        }

        try {
            state.turnstile = await window.AngutsaTurnstile.create(
                "#teamRegistrationTurnstile",
                "team-registration"
            );
        } catch (error) {
            alertTo(els.alert, "danger", "Registration is unavailable.",
                error && error.message ? error.message : "Please try again later.");
            return;
        }

        populateTournamentSelect();
        if (U.getParam("tournament") && !applyDeepLink()) {
            alertTo(els.alert, "warning", "Tournament unavailable.",
                "Open registration from a tournament card that is accepting entries.");
            return;
        }

        bindNavigation();

        setStep(1);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }









})();
