/* =========================================
   ANGUTSA CHAMPIONSHIP - TEAM MANAGER DASHBOARD
   Behaviour for /team-manager-dashboard/.

   Authentication and persistent manager data come from Firebase and the
   Cloudflare Worker. Payment review, registration decisions, and profile
   changes remain finance/admin workflows and are not submitted here.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    /* =========================================================
       Manager-scoped UI state populated from Worker bootstrap data
       ---------------------------------------------------------
       Live API mapping:
         PREVIEW.manager        <- GET  /api/v1/manager/bootstrap
         PREVIEW.registrations  <- GET  /api/v1/manager/bootstrap
         PREVIEW.matchLineups   <- GET  /api/v1/manager/bootstrap
         PREVIEW.notifications  <- GET  /api/v1/manager/bootstrap
         PREVIEW.rules          <- GET  /api/v1/public/bootstrap
         match line-up save     -> PUT  /api/v1/manager/matches/:id/lineups
         acknowledgment         -> POST /api/v1/manager/rules/:id/acknowledge
       PREVIEW is a legacy state-object name; these values come from the API.
       ========================================================= */

    var PREVIEW = {
        teamIds: [],
        manager: null,
        registrations: {},
        matchLineups: [],
        notifications: [],
        acknowledgments: []
    };

    /* Views are routed inside this single page, so every navigation item
       performs a real action instead of pointing at a page that has not been
       built yet. Titles stay short to match the menu labels. */
    var VIEWS = {
        overview: { title: "Dashboard" },
        teams: { title: "Teams" },
        squad: { title: "Squad" },
        registrations: { title: "Registrations" },
        payments: { title: "Payments" },
        fixtures: { title: "Fixtures" },
        notifications: { title: "Notifications" },
        rules: { title: "Rules" },
        help: { title: "Help" },
        profile: { title: "Profile" }
    };

    var STORAGE = {
        sidebar: "dashboardSidebar",
        notifications: "dashboardNotifications",
        acknowledgment: "dashboardRulesAcknowledged",
        publishedRules: "angutsa.public.rules",
        playerRegistrationPermissions: "angutsa.admin.playerRegistrationPermissions",
        playerRosterChangePermissions: "angutsa.admin.playerRosterChangePermissions"
    };

    var state = {
        view: "overview",
        teamId: "",
        notifications: [],
        notificationFilter: "all",
        matchFilter: "upcoming",
        squadIssuesOnly: false,
        acknowledged: false,
        createdTeamIds: [],
        teamsFilter: { query: "" },
        turnstile: null,
        rosterPermissionExpiryTimer: null,
        rosterPermissionExpiryAt: 0
    };

    var els = {};

    /* =========================================================
       Helpers
       ========================================================= */

    var ALERT_ICONS = { success: "checkCircle", warning: "alert", danger: "alert", info: "info" };

    function alertMarkup(type, title, message) {
        return '<div class="alert alert-' + type + '" role="' +
            (type === "danger" ? "alert" : "note") + '">' +
            U.icon(ALERT_ICONS[type] || "info") +
            "<span><strong>" + U.escapeHtml(title) + "</strong> " +
            U.escapeHtml(message) + "</span></div>";
    }

    function setAlert(container, type, title, message) {
        if (!container) return;
        container.innerHTML = type ? alertMarkup(type, title, message) : "";
    }

    function createTeamEmptyState(container, options) {
        if (!container) return;

        var settings = options || {};
        settings.actionLabel = "Create a team";
        delete settings.actionHref;
        container.innerHTML = U.emptyState(settings);

        var action = container.querySelector("[data-empty-action]");
        if (action) U.on(action, "click", openManagedTeamModal);
    }

    function setHtml(id, markup) {
        var node = document.getElementById(id);
        if (node) node.innerHTML = markup;
    }

    function noticeMarkup(title, message, extra) {
        return '<div class="notice-bar" role="note">' + U.icon("info") +
            "<span><strong>" + U.escapeHtml(title) + "</strong> " + U.escapeHtml(message) + "</span></div>" +
            (extra || "");
    }

    function panel(title, bodyMarkup, options) {
        var settings = options || {};
        return '<div class="panel">' +
            '<div class="panel-head"><h3>' + U.escapeHtml(title) + "</h3>" +
                (settings.badge ? '<span class="badge' +
                    (settings.badgeTone ? " " + settings.badgeTone : "") + '">' +
                    U.escapeHtml(settings.badge) + "</span>" : "") +
            "</div>" +
            '<div class="panel-body">' + bodyMarkup + "</div>" +
        "</div>";
    }

    /* Status vocabularies stay explicit so a competition status is never
       confused with a registration approval or a payment state. */
    var REGISTRATION_LABELS = {
        approved: "Approved",
        pending: "Pending review",
        draft: "Draft",
        submitted: "Submitted",
        incomplete: "Incomplete",
        rejected: "Rejected",
        withdrawn: "Withdrawn",
        active: "Active",
        eliminated: "Eliminated"
    };

    var PAYMENT_LABELS = {
        paid: "Paid",
        pending: "Pending verification",
        partial: "Partially paid",
        unpaid: "Unpaid",
        failed: "Failed",
        refunded: "Refunded",
        "not-required": "Not required"
    };

    var PAYMENT_STATUS_CLASS = {
        paid: "status-successful",
        pending: "status-pending",
        partial: "status-pending",
        unpaid: "status-neutral",
        failed: "status-failed",
        refunded: "status-cancelled",
        "not-required": "status-neutral"
    };

    function applyManagerBootstrap(publicData, managerData) {
        var data = window.AngutsaData || {};
        Object.keys(publicData).forEach(function (key) { data[key] = publicData[key]; });
        var registrations = managerData.registrations || [];
        var registrationById = Object.create(null);
        var teamsById = Object.create(null);
        var registrationsByTeam = Object.create(null);
        (data.teams || []).forEach(function (team) {
            teamsById[team.id] = Object.assign({}, team);
        });

        (data.tournaments || []).forEach(function (tournament) {
            tournament.entryFee = tournament.registrationFee;
            tournament.teamLimit = tournament.teamCap;
            if (String(tournament.banner || "").indexOf("media/") === 0) {
                tournament.banner = window.AngutsaPlatform.apiBaseUrl +
                    "/api/v1/media/" + tournament.banner;
            }
            tournament.formatLabel = tournament.format;
            tournament.categoryLabel = (data.categories || []).filter(function (category) {
                return category.id === tournament.categoryId;
            }).map(function (category) { return category.name; })[0] || "";
        });
        registrations.forEach(function (registration) {
            registrationById[registration.id] = registration;
            var teamId = registration.team_id;
            var status = registration.status === "pending_review"
                ? "pending"
                : registration.status === "correction_requested"
                    ? "correction requested"
                    : registration.status;
            var team = teamsById[teamId] || (teamsById[teamId] = {
                id: teamId,
                tournamentIds: []
            });
            Object.assign(team, {
                name: registration.team_name,
                shortName: registration.short_code,
                categoryId: registration.category_id,
                group: registration.group_name || null,
                location: registration.location,
                accent: registration.accent,
                status: status,
                registrationId: registration.id,
                registrationReference: registration.public_reference,
                registrationFeeAmount: registration.fee_amount,
                registrationStatus: status,
                rosterChangesAfterStart: registration.roster_changes_after_start === 1,
                rosterChangesExpiresAt: registration.roster_changes_expires_at || null
            });
            if (!Array.isArray(team.tournamentIds)) team.tournamentIds = [];
            if (team.tournamentIds.indexOf(registration.tournament_id) === -1) {
                team.tournamentIds.push(registration.tournament_id);
            }
            registrationsByTeam[teamId] = {
                submittedOn: registration.submitted_at,
                reference: registration.public_reference,
                missing: [],
                checklist: [
                    { label: "Team details submitted", done: true },
                    { label: "Registration review", done: status === "approved",
                        note: status === "approved" ? "" : "The competitions office is reviewing your registration." }
                ]
            };
        });

        data.teams = Object.keys(teamsById).map(function (id) { return teamsById[id]; });
        data.players = (managerData.players || []).map(function (player) {
            var registration = registrationById[player.registration_id];
            return {
                id: player.id, teamId: player.team_id, name: player.name, jersey: player.shirt_number,
                shirtNumber: player.shirt_number, position: player.position,
                registrationId: player.registration_id,
                tournamentId: registration ? registration.tournament_id : "",
                publicProfile: player.public_profile,
                guardianConsent: player.guardian_consent_status,
                registrationStatus: player.status,
                yearOfBirth: player.date_of_birth
                    ? Number(String(player.date_of_birth).slice(0, 4))
                    : null
            };
        });
        data.payments = (managerData.payments || []).map(function (payment) {
            return {
                id: payment.id, teamId: payment.team_id, tournamentId: payment.tournament_id,
                amount: payment.amount, method: payment.method,
                status: payment.status === "confirmed" ? "successful" : payment.status,
                reference: payment.reference, recordedAt: payment.recorded_at
            };
        });
        data.matches = managerData.matches || [];
        data.meta = publicData.meta || { demo: false, currency: "KES" };
        window.AngutsaData = data;

        PREVIEW.teamIds = Object.keys(registrationsByTeam);
        PREVIEW.manager = managerData.manager;
        PREVIEW.registrations = registrationsByTeam;
        PREVIEW.matchLineups = managerData.matchLineups || [];
        PREVIEW.acknowledgments = managerData.acknowledgments || [];
        PREVIEW.notifications = (managerData.notifications || []).map(function (notification) {
            return {
                id: notification.id, category: notification.category, icon: "info",
                title: notification.title, body: notification.body, at: notification.created_at,
                read: Boolean(notification.read_at), view: notification.target_path || "overview"
            };
        });
        state.notifications = PREVIEW.notifications.slice();
    }

    function requestManagerBootstrap(platform) {
        return platform.requestAll("/manager/bootstrap",
            ["registrations", "matches", "notifications", "acknowledgments"],
            100,
            ["registrations", "players", "payments", "matches", "matchLineups",
                "notifications", "acknowledgments"]);
    }

    async function refreshManagerData() {
        var responses = await Promise.all([
            window.AngutsaPlatform.requestAll("/public/bootstrap", [
                "categories", "tournaments", "teams", "rules"
            ]),
            requestManagerBootstrap(window.AngutsaPlatform)
        ]);
        applyManagerBootstrap(responses[0], responses[1]);
    }

    function registrationStatusLabel(team) {
        return REGISTRATION_LABELS[team.status] || "Status not set";
    }

    function paymentBadge(status) {
        return '<span class="status-badge ' + (PAYMENT_STATUS_CLASS[status] || "status-neutral") + '">' +
            U.escapeHtml(PAYMENT_LABELS[status] || status) + "</span>";
    }

    /* =========================================================
       Derived data (read-only)
       ========================================================= */

    function teamsInScope() {
        var ids = PREVIEW.teamIds.concat(state.createdTeamIds);
        return (Data.teams || []).filter(function (team) {
            return ids.indexOf(team.id) > -1;
        });
    }

    function activeTeam() {
        var scope = teamsInScope();
        return scope.filter(function (team) { return team.id === state.teamId; })[0] || scope[0] || null;
    }

    function tournamentFor(team) {
        if (!team || !Array.isArray(team.tournamentIds) || !team.tournamentIds.length) return null;
        return U.tournamentById(team.tournamentIds[0]);
    }

    function categoryFor(team) {
        return team ? U.categoryById(team.categoryId) : null;
    }

    function isYouthCategory(category) {
        return !!(category && (category.guardianConsent ||
            (category.ageMax !== null && category.ageMax !== undefined && category.ageMax < 18)));
    }

    function ageRangeLabel(category) {
        if (!category) return "-";
        if (!category.ageMin) return "Open age";
        return category.ageMin + " - " + (category.ageMax ? category.ageMax : "open");
    }

    function squadFor(teamId) {
        return (Data.players || []).filter(function (player) {
            return player.teamId === teamId;
        });
    }

    function matchesFor(teamId) {
        return (Data.matches || []).filter(function (match) {
            return match.homeTeamId === teamId || match.awayTeamId === teamId;
        });
    }

    function upcomingMatches(teamId) {
        return U.sortMatchesByKickoff(matchesFor(teamId).filter(function (match) {
            return match.status === "scheduled" || match.status === "postponed";
        }));
    }

    function completedMatches(teamId) {
        var list = matchesFor(teamId).filter(function (match) {
            return match.status === "completed" && match.homeScore !== null && match.awayScore !== null;
        });

        return U.sortMatchesByKickoff(list).reverse();
    }

    function matchLineupFor(matchId, teamId) {
        return PREVIEW.matchLineups.filter(function (lineup) {
            return lineup.matchId === matchId && lineup.teamId === teamId;
        })[0] || null;
    }

    function lineupActionMarkup(match, teamId) {
        var team = U.teamById(teamId);
        if (match.status !== "scheduled" || !team || team.status !== "approved" ||
            (teamId !== match.homeTeamId && teamId !== match.awayTeamId)) {
            return "";
        }
        var saved = matchLineupFor(match.id, teamId);
        if (match.lineupOpen) {
            return '<button type="button" class="btn btn-primary btn-sm" data-lineup="' +
                U.escapeHtml(match.id) + '">' + (saved ? "Edit line-up" : "Submit line-up") + "</button>";
        }
        return '<span class="match-lineup-state">' +
            (saved ? "Line-up saved · locked at kick-off" : match.lineupDay
                ? "Line-up window closed" : "Line-up opens on match day") +
            "</span>";
    }

    function playerChoiceMarkup(player, role, selectedIds) {
        var checked = selectedIds.indexOf(player.id) !== -1;
        var shirt = player.shirtNumber || player.jersey || "—";
        return '<label class="lineup-player-choice">' +
            '<input type="checkbox" data-lineup-choice="' + role + '" value="' +
            U.escapeHtml(player.id) + '"' + (checked ? " checked" : "") + ">" +
            '<span class="lineup-player-shirt">' + U.escapeHtml(shirt) + "</span>" +
            '<span class="lineup-player-name"><strong>' + U.escapeHtml(player.name) +
            "</strong><small>" + U.escapeHtml(player.position || "Position not set") +
            "</small></span></label>";
    }

    function openLineupModal(matchId) {
        var match = U.matchById(matchId);
        var team = activeTeam();
        if (!match || !team || team.status !== "approved" || !match.lineupOpen ||
            (team.id !== match.homeTeamId && team.id !== match.awayTeamId)) {
            U.toast("The match-day lineup window is not open for this team.", "warning");
            return;
        }
        var existing = matchLineupFor(match.id, team.id);
        var starters = (existing && existing.starters || []).map(function (player) {
            return player.playerId;
        });
        var substitutes = (existing && existing.substitutes || []).map(function (player) {
            return player.playerId;
        });
        var category = categoryFor(team);
        var squad = squadFor(team.id).filter(function (player) {
            return player.tournamentId === match.tournamentId &&
                player.registrationStatus === "registered" &&
                (!isYouthCategory(category) || player.guardianConsent === "on_file");
        }).slice().sort(function (a, b) {
            var left = Number(a.shirtNumber || a.jersey) || 100;
            var right = Number(b.shirtNumber || b.jersey) || 100;
            return left - right || String(a.name).localeCompare(String(b.name));
        });
        var choices = function (role, selectedIds) {
            return squad.length
                ? squad.map(function (player) {
                    return playerChoiceMarkup(player, role, selectedIds);
                }).join("")
                : '<p class="form-note">No eligible registered players are available for this lineup.</p>';
        };

        openAppModal({
            title: (existing ? "Edit" : "Submit") + " match line-up",
            subtitle: team.name + " · " + U.teamName(match.homeTeamId) + " vs " +
                U.teamName(match.awayTeamId),
            wide: true,
            body:
                '<div class="lineup-editor">' +
                    '<div class="notice-bar" role="note">' + U.icon("clock") +
                        "<span>Line-ups can be changed on match day until kick-off. Select 11 starters and up to 7 substitutes.</span></div>" +
                    '<div class="lineup-editor-columns">' +
                        '<section class="lineup-editor-section"><div class="lineup-editor-heading">' +
                            "<h3>Starting 11</h3><span data-lineup-count=\"starters\">" +
                            starters.length + " / 11</span></div>" +
                            '<div class="lineup-player-list">' + choices("starter", starters) + "</div></section>" +
                        '<section class="lineup-editor-section"><div class="lineup-editor-heading">' +
                            "<h3>Substitutes</h3><span data-lineup-count=\"substitutes\">" +
                            substitutes.length + " / 7</span></div>" +
                            '<div class="lineup-player-list">' + choices("substitute", substitutes) +
                            "</div></section>" +
                    "</div>" +
                    '<p class="lineup-editor-error" role="alert" data-lineup-error hidden></p>' +
                "</div>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="save-match-lineup" ' +
                'data-id="' + U.escapeHtml(match.id) + '" data-team-id="' +
                U.escapeHtml(team.id) + '">Save line-up</button>'
        });
        U.$$("[data-lineup-choice]", document.getElementById("appModalBody")).forEach(function (input) {
            U.on(input, "change", function () {
                if (input.checked) {
                    var otherRole = input.getAttribute("data-lineup-choice") === "starter"
                        ? "substitute" : "starter";
                    var duplicate = U.$$('[data-lineup-choice="' + otherRole + '"]',
                        document.getElementById("appModalBody")).filter(function (other) {
                        return other.value === input.value;
                    })[0];
                    if (duplicate) duplicate.checked = false;
                }
                updateLineupCounts();
            });
        });
        updateLineupCounts();
    }

    function updateLineupCounts() {
        U.$$("[data-lineup-choice]", document.getElementById("appModalBody")).forEach(function (input) {
            input.parentNode.classList.toggle("is-selected", input.checked);
        });
        ["starter", "substitute"].forEach(function (role) {
            var count = U.$$('[data-lineup-choice="' + role + '"]:checked',
                document.getElementById("appModalBody")).length;
            var node = document.querySelector('[data-lineup-count="' +
                (role === "starter" ? "starters" : "substitutes") + '"]');
            if (node) node.textContent = count + (role === "starter" ? " / 11" : " / 7");
        });
    }

    async function saveMatchLineup(matchId, teamId, button) {
        var starterInputs = U.$$('[data-lineup-choice="starter"]:checked',
            document.getElementById("appModalBody"));
        var substituteInputs = U.$$('[data-lineup-choice="substitute"]:checked',
            document.getElementById("appModalBody"));
        var starters = starterInputs.map(function (input) { return input.value; });
        var substitutes = substituteInputs.map(function (input) { return input.value; });
        var error = document.querySelector("[data-lineup-error]");
        var selected = starters.concat(substitutes);
        var message = starters.length !== 11
            ? "Select exactly 11 starting players."
            : substitutes.length > 7
                ? "Select no more than 7 substitutes."
                : new Set(selected).size !== selected.length
                    ? "A player can only appear once in the line-up."
                    : "";
        if (message) {
            if (error) {
                error.textContent = message;
                error.hidden = false;
            }
            return;
        }
        if (error) {
            error.textContent = "";
            error.hidden = true;
        }
        button.disabled = true;
        button.textContent = "Saving…";
        try {
            await window.AngutsaPlatform.request(
                "/manager/matches/" + encodeURIComponent(matchId) + "/lineups",
                { method: "PUT", body: { teamId: teamId, starters: starters, substitutes: substitutes } }
            );
        } catch (requestError) {
            button.disabled = false;
            button.textContent = "Save line-up";
            U.toast(requestError && requestError.message
                ? requestError.message
                : "We couldn't save the match line-up. Please try again.", "error");
            return;
        }
        closeAppModal();
        try {
            await refreshManagerData();
            renderView(state.view);
            renderNavCounts();
            U.toast("Match line-up saved.", "success");
        } catch (refreshError) {
            U.toast("The match line-up was saved, but the latest data could not be loaded. " +
                (refreshError && refreshError.message ? refreshError.message : "Please refresh the page."),
            "warning");
        }
    }

    function paymentsFor(teamId) {
        return (Data.payments || []).filter(function (payment) {
            return payment.teamId === teamId;
        });
    }

    /* Payment state is derived from recorded payments only. Nothing in this
       interface can change a payment status. The registration fee snapshot
       governs; current tournament/category fees are fallbacks for older records. */
    function paymentState(team) {
        var tournament = tournamentFor(team);
        var category = categoryFor(team);
        var fee = null;

        if (team && team.registrationFeeAmount !== undefined &&
            team.registrationFeeAmount !== null && Number.isFinite(Number(team.registrationFeeAmount))) {
            fee = Number(team.registrationFeeAmount);
        } else if (tournament && tournament.entryFee !== undefined && tournament.entryFee !== null) {
            fee = tournament.entryFee;
        } else if (category) {
            fee = category.entryFee;
        }
        var records = paymentsFor(team.id);

        var paid = records.reduce(function (total, payment) {
            return payment.status === "successful" || payment.status === "partial"
                ? total + Number(payment.amount || 0)
                : total;
        }, 0);

        var hasPending = records.some(function (payment) { return payment.status === "pending"; });
        var hasFailed = records.some(function (payment) { return payment.status === "failed"; });
        var status = "unpaid";

        if (fee === 0) {
            status = "not-required";
        } else if (paid > 0 && fee !== null && paid >= fee) {
            status = "paid";
        } else if (paid > 0) {
            status = "partial";
        } else if (hasPending) {
            status = "pending";
        } else if (hasFailed) {
            status = "failed";
        }

        var latest = records.slice().sort(function (a, b) {
            return String(b.recordedAt).localeCompare(String(a.recordedAt));
        })[0] || null;

        return {
            fee: fee,
            paid: paid,
            outstanding: fee === null ? null : Math.max(fee - paid, 0),
            status: status,
            records: records,
            latest: latest,
            needsPayment: status === "unpaid" || status === "partial" || status === "failed"
        };
    }

    function tournamentHasStarted(tournament) {
        if (!tournament) return false;

        var status = String(tournament.status || "").trim().toLowerCase();
        if (status === "active" || status === "ongoing" || status === "completed" ||
            status === "archived") {
            return true;
        }

        var startDate = String(tournament.startDate || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return false;

        var todayKey = window.AngutsaEAT
            ? window.AngutsaEAT.today()
            : new Date().toISOString().slice(0, 10);
        return startDate <= todayKey;
    }

    function rosterChangeLockMessage(access) {
        if (access.error) {
            return "Roster-change permission could not be verified. Contact an administrator.";
        }
        return "This tournament has started. Ask an administrator to permit roster changes for this team.";
    }

    function scheduleRosterPermissionExpiry(expiry) {
        if (!Number.isFinite(expiry) || expiry <= Date.now()) {
            if (state.rosterPermissionExpiryTimer !== null) {
                window.clearTimeout(state.rosterPermissionExpiryTimer);
                state.rosterPermissionExpiryTimer = null;
                state.rosterPermissionExpiryAt = 0;
            }
            return;
        }
        if (state.rosterPermissionExpiryAt === expiry) return;
        if (state.rosterPermissionExpiryTimer !== null) {
            window.clearTimeout(state.rosterPermissionExpiryTimer);
        }
        state.rosterPermissionExpiryAt = expiry;
        state.rosterPermissionExpiryTimer = window.setTimeout(function () {
            state.rosterPermissionExpiryTimer = null;
            state.rosterPermissionExpiryAt = 0;
            renderView(state.view);
        }, expiry - Date.now() + 25);
    }

    function playerRegistrationPermission(team) {
        var access = {
            allowed: false,
            approved: team.status === "approved",
            feeCleared: false,
            tournamentStarted: false,
            rosterChangePermit: false,
            rosterChangesAllowed: false,
            error: false
        };

        var permissionExpiresAt = team.rosterChangesExpiresAt
            ? Date.parse(team.rosterChangesExpiresAt)
            : null;
        scheduleRosterPermissionExpiry(permissionExpiresAt);
        access.rosterChangePermit = team.rosterChangesAfterStart === true &&
            (permissionExpiresAt === null || !Number.isFinite(permissionExpiresAt) ||
                permissionExpiresAt > Date.now());

        var payment = paymentState(team);
        access.feeCleared = payment.status === "paid" || payment.status === "not-required";
        access.tournamentStarted = tournamentHasStarted(tournamentFor(team));
        access.allowed = access.approved;
        access.rosterChangesAllowed = access.allowed &&
            (!access.tournamentStarted || access.rosterChangePermit);
        return access;
    }

    function playerRegistrationGateMarkup(team, access) {
        if (access.error) {
            return noticeMarkup("Player registration is unavailable.",
                "We could not verify this team's player-registration permission. Contact an administrator.");
        }
        if (!access.approved) {
            return noticeMarkup("Team approval is required before player registration.",
                "Once the competitions office approves your team, you can sign in here to add or update the players who will participate. Any registration-fee balance remains due.",
                '<div style="margin-top:12px">' + U.paymentDetailsMarkup({ compact: true, note: false }) + "</div>");
        }
        if (!access.feeCleared) {
            return noticeMarkup("Player registration is open.",
                "Your team has been approved. You may add or update players for " + team.name +
                " now; any outstanding registration-fee balance remains due.",
                '<div style="margin-top:12px">' + U.paymentDetailsMarkup({ compact: true, note: false }) + "</div>");
        }
        return "";
    }

    function registrationFor(team) {
        return PREVIEW.registrations[team.id] || null;
    }

    function squadIssueList(team) {
        var category = categoryFor(team);
        return squadFor(team.id).filter(function (player) {
            var needsConsent = isYouthCategory(category) && player.guardianConsent !== "on-file";
            var incomplete = !player.position || !player.shirtNumber || !player.name;
            return needsConsent || incomplete;
        });
    }

    /* =========================================================
       Notifications
       ========================================================= */

    function unreadNotifications() {
        return state.notifications.filter(function (item) { return !item.read; });
    }

    async function markRead(id) {
        try {
            await window.AngutsaPlatform.request("/notifications/" +
                encodeURIComponent(id) + "/read", { method: "POST" });
        } catch (error) {
            U.toast(error && error.message ? error.message : "We couldn't update this notification. Please try again.", "error");
            return;
        }
        state.notifications.forEach(function (item) {
            if (item.id === id) item.read = true;
        });
        renderNotificationChrome();
        renderNotificationsView();
    }

    async function markAllRead() {
        if (!unreadNotifications().length) {
            U.toast("Nothing to mark as read.", "info");
            return;
        }

        try {
            await Promise.all(unreadNotifications().map(function (item) {
                return window.AngutsaPlatform.request("/notifications/" +
                    encodeURIComponent(item.id) + "/read", { method: "POST" });
            }));
        } catch (error) {
            U.toast(error && error.message ? error.message : "We couldn't update the notifications. Please try again.", "error");
            return;
        }
        state.notifications.forEach(function (item) { item.read = true; });
        renderNotificationChrome();
        renderNotificationsView();
        U.toast("All notifications marked as read.", "success");
    }

    /* =========================================================
       Routing and page chrome
       ========================================================= */

    function currentHashView() {
        var hash = String(window.location.hash || "").replace(/^#\/?/, "");
        return VIEWS[hash] ? hash : "overview";
    }

    function setView(view, options) {
        var settings = options || {};
        var target = VIEWS[view] ? view : "overview";

        state.view = target;

        U.$$(".app-view").forEach(function (section) {
            section.hidden = section.getAttribute("data-view") !== target;
        });

        U.$$("[data-view-link]").forEach(function (link) {
            var isActive = link.getAttribute("data-view-link") === target;

            if (link.classList.contains("app-nav-item")) {
                link.classList.toggle("is-active", isActive);
                if (isActive) {
                    link.setAttribute("aria-current", "page");
                } else {
                    link.removeAttribute("aria-current");
                }
            }
        });

        if (els.appTitle) els.appTitle.textContent = VIEWS[target].title;
        if (els.appCrumb) els.appCrumb.textContent = VIEWS[target].title;
        document.title = VIEWS[target].title + " | Angutsa Team Manager Dashboard";

        closeAllMenus();
        if (settings.keepDrawer !== true) closeDrawer();

        expandActiveGroup();
        renderView(target);

        if (settings.focus !== false && els.main) {
            els.main.scrollIntoView({ behavior: "auto", block: "start" });
        }
    }

    /* One dispatcher so a view can always be re-rendered after data changes. */
    function renderView(view) {
        var name = view || state.view;

        if (name === "overview") renderOverview();
        if (name === "teams") renderTeams();
        if (name === "squad") renderSquad();
        if (name === "registrations") renderRegistrations();
        if (name === "payments") renderPayments();
        if (name === "fixtures") renderFixtures();
        if (name === "notifications") renderNotificationsView();
        if (name === "rules") renderRules();
        if (name === "profile") renderProfile();
    }

    /* -------------------------
       Identity, banner and switcher
       ------------------------- */

    function renderIdentity() {
        var manager = PREVIEW.manager;
        var initials = U.initials(manager.name);

        setHtml("welcomeName", U.escapeHtml(manager.name));

        ["sidebarAvatar", "profileAvatar"].forEach(function (id) {
            var node = document.getElementById(id);
            if (node) {
                node.textContent = initials;
                node.setAttribute("title", manager.name);
            }
        });

        setHtml("sidebarUserName", U.escapeHtml(manager.name));
        setHtml("sidebarUserRole", U.escapeHtml(manager.role));
        setHtml("profileButtonName", U.escapeHtml(manager.name));
        setHtml("profileButtonRole", U.escapeHtml(manager.role));
        setHtml("profileMenuName", U.escapeHtml(manager.name));
        setHtml("profileMenuEmail", U.escapeHtml(manager.email));
    }

    /* Fills the icon placeholders in the sidebar and top bar with the
       shared inline icon set, so the console matches the administration
       dashboard and the rest of the website. */
    function paintNavIcons() {
        U.$$("[data-nav-icon],[data-rail-icon]").forEach(function (node) {
            if (node.getAttribute("data-icon-painted") === "1") return;

            var name = node.getAttribute("data-nav-icon") || node.getAttribute("data-rail-icon");
            node.innerHTML = U.icon(name);
            node.setAttribute("data-icon-painted", "1");
        });
    }

    /* Keeps the active navigation item visible inside its collapsible group
       when a view is opened directly from the address bar. */
    function expandActiveGroup() {
        var active = U.$(".app-nav-item.is-active");
        if (!active) return;

        var group = active.parentNode;
        while (group && group !== document.body &&
            !(group.classList && group.classList.contains("app-nav-group"))) {
            group = group.parentNode;
        }

        if (!group) return;

        var toggle = group.querySelector("[data-nav-group]");
        var body = group.querySelector(".app-nav-group-body");

        if (toggle) toggle.setAttribute("aria-expanded", "true");
        if (body) body.hidden = false;
    }

    function renderNavCounts() {
        var teamCount = teamsInScope().length;
        setHtml("navTeamCount", teamCount ? String(teamCount) : "");
        var unread = unreadNotifications().length;
        var bellDot = document.getElementById("bellDot");

        if (bellDot) bellDot.hidden = !unread;

        var bell = document.getElementById("bellButton");
        if (bell) {
            bell.setAttribute("aria-label", unread
                ? "Notifications, " + unread + " unread"
                : "Notifications, none unread");
        }
    }

    function renderTeamSwitcher() {
        var scope = teamsInScope();
        var wrap = document.getElementById("teamSwitcherWrap");
        var select = document.getElementById("teamSwitcher");

        if (!wrap || !select) return;

        /* The switcher only appears when the manager really has a choice. */
        if (scope.length < 2) {
            wrap.hidden = true;
            return;
        }

        wrap.hidden = false;
        select.innerHTML = scope.map(function (team) {
            return '<option value="' + U.escapeHtml(team.id) + '">' +
                U.escapeHtml(team.name + " \u00b7 " + (categoryFor(team) ? categoryFor(team).name : "Category")) +
                "</option>";
        }).join("");

        select.value = activeTeam() ? activeTeam().id : "";
    }

    /* -------------------------
       Notification chrome (bell menu)
       ------------------------- */

    function notificationRowMarkup(item, compact) {
        return '<button type="button" class="menu-notification' +
                (item.read ? "" : " is-unread") + '" data-notification="' + U.escapeHtml(item.id) + '">' +
            '<span class="menu-notification-icon">' + U.icon(item.icon || "bell") + "</span>" +
            '<span class="menu-notification-body">' +
                "<strong>" + U.escapeHtml(item.title) + "</strong>" +
                "<span>" + U.escapeHtml(item.body) + "</span>" +
                "<time datetime=\"" + U.escapeHtml(item.at) + "\">" +
                    U.escapeHtml(item.category + " \u00b7 " + U.relativeTime(item.at)) + "</time>" +
            "</span>" +
        "</button>";
    }

    function renderNotificationChrome() {
        renderNavCounts();

        var list = document.getElementById("menuNotificationList");
        if (!list) return;

        var items = state.notifications.slice(0, 4);

        if (!items.length) {
            list.innerHTML = '<p class="form-note" style="padding:16px">No notifications yet.</p>';
            return;
        }

        list.innerHTML = items.map(function (item) {
            return notificationRowMarkup(item, true);
        }).join("");

        U.$$("[data-notification]", list).forEach(function (button) {
            U.on(button, "click", function () {
                var id = button.getAttribute("data-notification");
                markRead(id);
                var item = state.notifications.filter(function (entry) { return entry.id === id; })[0];
                setView(item && item.view ? item.view : "notifications");
            });
        });
    }

    /* -------------------------
       Full notification list
       ------------------------- */

    function renderNotificationsView() {
        var container = document.getElementById("notificationList");
        var emptyBox = document.getElementById("notificationEmpty");
        if (!container) return;

        var filter = state.notificationFilter;
        var items = state.notifications.filter(function (item) {
            if (filter === "unread") return !item.read;
            if (filter === "read") return item.read;
            return true;
        });

        U.$$("[data-notif-filter]").forEach(function (chip) {
            var active = chip.getAttribute("data-notif-filter") === filter;
            chip.classList.toggle("is-active", active);
            chip.setAttribute("aria-pressed", String(active));
        });

        if (!items.length) {
            container.innerHTML = "";
            if (emptyBox) {
                emptyBox.innerHTML = U.emptyState({
                    icon: "bell",
                    title: filter === "unread" ? "No unread notifications" : "No notifications to show",
                    message: filter === "unread"
                        ? "Everything in this preview inbox has been read. New updates from the competitions office will appear here."
                        : "Notifications about registrations, payments, squads and fixtures will appear here."
                });
            }
            return;
        }

        if (emptyBox) emptyBox.innerHTML = "";

        container.innerHTML = '<div class="activity-list">' + items.map(function (item) {
            return '<div class="activity-item' + (item.read ? "" : " is-unread") + '">' +
                '<span class="activity-icon">' + U.icon(item.icon || "bell") + "</span>" +
                '<div class="activity-body">' +
                    '<div class="activity-head"><strong>' + U.escapeHtml(item.title) + "</strong>" +
                        '<time datetime="' + U.escapeHtml(item.at) + '">' +
                            U.escapeHtml(U.relativeTime(item.at)) + "</time></div>" +
                    "<p>" + U.escapeHtml(item.body) + "</p>" +
                    '<div class="activity-meta">' +
                        '<span class="badge">' + U.escapeHtml(item.category) + "</span>" +
                        (item.read ? '<span class="badge">Read</span>' : '<span class="badge badge-purple">Unread</span>') +
                    "</div>" +
                    '<div class="dashboard-card-actions">' +
                        (item.read ? "" : '<button type="button" class="btn btn-dark-outline btn-sm" ' +
                            'data-read="' + U.escapeHtml(item.id) + '">Mark as read</button>') +
                        '<button type="button" class="btn btn-ghost btn-sm" data-open="' +
                            U.escapeHtml(item.view || "overview") + '">Open related section</button>' +
                    "</div>" +
                "</div>" +
            "</div>";
        }).join("") + "</div>";

        U.$$("[data-read]", container).forEach(function (button) {
            U.on(button, "click", function () {
                markRead(button.getAttribute("data-read"));
            });
        });

        U.$$("[data-open]", container).forEach(function (button) {
            U.on(button, "click", function () {
                setView(button.getAttribute("data-open"));
            });
        });
    }

    /* =========================================================
       Overview
       ========================================================= */

    /* Outstanding work for one team. Each item states who owns the decision,
       so nothing looks approved that has not been approved. */
    function pendingActionsFor(team) {
        var items = [];
        var registration = registrationFor(team);
        var payment = paymentState(team);
        var playerAccess = playerRegistrationPermission(team);
        var issues = playerAccess.allowed ? squadIssueList(team) : [];

        if (registration && registration.missing.length) {
            registration.missing.forEach(function (note) {
                items.push({ label: note, view: "registrations" });
            });
        }

        if (issues.length) {
            items.push({
                label: issues.length + " player record" + (issues.length === 1 ? "" : "s") +
                    " incomplete or missing required consent",
                view: "squad"
            });
        }

        if (payment.status === "pending") {
            items.push({ label: "Payment pending verification by the finance office", view: "payments" });
        } else if (payment.needsPayment) {
            items.push({ label: "Entry fee not confirmed by the finance office", view: "payments" });
        }

        if (!state.acknowledged) {
            items.push({ label: "Competition rules acknowledgment outstanding", view: "rules" });
        }

        return items;
    }

    function kpiCard(options) {
        return '<article class="kpi-card">' +
            '<div class="kpi-card-top">' +
                '<span class="kpi-icon' + (options.tone ? " " + options.tone : "") + '">' +
                    U.icon(options.icon) + "</span>" +
                '<span class="kpi-label">' + U.escapeHtml(options.label) + "</span>" +
            "</div>" +
            '<strong class="kpi-value">' + U.escapeHtml(String(options.value)) + "</strong>" +
            '<p class="kpi-trend">' + U.escapeHtml(options.note) + "</p>" +
            (options.action
                ? '<div class="dashboard-card-actions"><button type="button" ' +
                    'class="btn btn-dark-outline btn-sm" data-open-view="' +
                    U.escapeHtml(options.action.view) + '">' + U.escapeHtml(options.action.label) +
                    "</button></div>"
                : "") +
        "</article>";
    }

    function renderPayBanner() {
        var unpaid = teamsInScope().filter(function (entry) {
            return paymentState(entry).needsPayment;
        });

        setHtml("payBanner", unpaid.map(function (entry) {
            var payment = paymentState(entry);
            var due = payment.outstanding;
            var paymentLabel = payment.status === "partial"
                ? "registration fee partially paid"
                : payment.status === "failed"
                    ? "registration payment needs attention"
                    : "registration fee not paid";
            return '<div class="pay-banner">' +
                '<div class="pay-banner-text"><strong>' + U.escapeHtml(entry.name) +
                    ": " + paymentLabel + "</strong>" +
                    "<span>" + (due ? U.formatMoney(due) + " due. " : "") +
                        "Pay by M-Pesa to clear the outstanding registration balance.</span></div>" +
                '<button type="button" class="btn btn-gold btn-sm" data-pay-open="' +
                    U.escapeHtml(entry.id) + '">Pay registration fee</button>' +
            "</div>";
        }).join(""));
    }

    function renderKpis() {
        renderPayBanner();
        var team = activeTeam();
        var scope = teamsInScope();
        var teamName = team ? team.name : "your team";

        var playerCount = scope.reduce(function (total, entry) {
            return total + squadFor(entry.id).length;
        }, 0);

        var upcoming = team ? upcomingMatches(team.id).length : 0;
        var pending = team ? pendingActionsFor(team).length : 0;

        setHtml("kpiGrid",
            kpiCard({
                icon: "shield",
                label: "Teams",
                value: scope.length,
                note: scope.length ? "Teams you are authorised to manage"
                    : "No teams are linked to this account yet",
                tone: "is-gold",
                action: { label: "Open Teams", view: "teams" }
            }) +
            kpiCard({
                icon: "users",
                label: "Registered players",
                value: playerCount,
                note: scope.length > 1
                    ? "Across all " + scope.length + " of your teams"
                    : "In the " + teamName + " squad",
                action: { label: "Open squad", view: "squad" }
            }) +
            kpiCard({
                icon: "calendar",
                label: "Upcoming matches",
                value: upcoming,
                note: upcoming ? "Confirmed fixtures for " + teamName
                    : "No confirmed fixtures published yet",
                tone: "is-green",
                action: { label: "View fixtures", view: "fixtures" }
            }) +
            kpiCard({
                icon: "clipboard",
                label: "Pending actions",
                value: pending,
                note: pending ? "Awaiting your team or the competitions office"
                    : "Nothing outstanding for " + teamName,
                tone: pending ? "is-red" : "is-green",
                action: { label: "Review actions", view: pending ? "registrations" : "rules" }
            }));
    }

    /* One prominent next action, chosen from the manager's actual state. */
    function renderPrimaryAction() {
        var box = document.getElementById("primaryAction");
        if (!box) return;

        var team = activeTeam();

        if (!team) {
            box.innerHTML =
                '<button type="button" class="btn btn-gold btn-large" data-action="create-team">Create your team</button>' +
                '<span class="welcome-action-note">Choose an open competition. Your existing manager account will be used.</span>';
            return;
        }

        var registration = registrationFor(team);
        var payment = paymentState(team);
        var playerAccess = playerRegistrationPermission(team);
        var issues = squadIssueList(team);
        var tournament = tournamentFor(team);
        var next = upcomingMatches(team.id)[0] || null;
        var action;

        if (registration && registration.missing.length) {
            action = {
                label: "Complete registration",
                href: "/team-registration/?tournament=" + encodeURIComponent(tournament ? tournament.id : ""),
                note: "Finish the outstanding items for " + team.name + "."
            };
        } else if (!playerAccess.allowed) {
            action = playerAccess.approved
                ? {
                    label: "Review entry fee",
                    view: "payments",
                    note: playerAccess.error
                        ? "Player registration is locked until its permission can be verified."
                        : "Pay the full registration fee to start registering players, or contact an administrator to permit early access."
                }
                : {
                    label: "Review registration",
                    view: "registrations",
                    note: "Pay the registration fee right after registering. Once it is paid and your team is approved, you can add players."
                };
        } else if (issues.length) {
            action = {
                label: "Manage your squad",
                view: "squad",
                note: issues.length + " player record" + (issues.length === 1 ? "" : "s") +
                    " need attention before the squad is complete."
            };
        } else if (payment.needsPayment && !isYouthCategory(categoryFor(team))) {
            action = {
                label: "Review entry fee",
                view: "payments",
                note: "The finance office confirms payment; nothing is charged here."
            };
        } else if (!state.acknowledged) {
            action = {
                label: "Acknowledge the rules",
                view: "rules",
                note: "Confirm you have read the competition regulations."
            };
        } else if (next) {
            action = {
                label: "View next match",
                view: "fixtures",
                note: team.name + " play on " + U.formatDate(next.kickoff) + "."
            };
        } else {
            action = {
                label: "View upcoming fixtures",
                view: "fixtures",
                note: "No confirmed fixture has been published for " + team.name + " yet."
            };
        }

        box.innerHTML = (action.href
                ? '<a class="btn btn-gold btn-large" href="' + U.escapeHtml(action.href) + '">' +
                    U.escapeHtml(action.label) + "</a>"
                : '<button type="button" class="btn btn-gold btn-large" data-open-view="' +
                    U.escapeHtml(action.view) + '">' + U.escapeHtml(action.label) + "</button>") +
            '<span class="welcome-action-note">' + U.escapeHtml(action.note) + "</span>";
    }

    /* -------------------------
       Overview cards
       ------------------------- */

    function checklistMarkup(items) {
        return '<ul class="checklist">' + items.map(function (item) {
            return '<li class="' + (item.done ? "is-done" : "is-pending") + '">' +
                '<span class="feature-check" aria-hidden="true">' + (item.done ? "&#10003;" : "!") + "</span>" +
                "<span><strong>" + U.escapeHtml(item.label) + "</strong>" +
                    (item.note ? '<span class="checklist-note">' + U.escapeHtml(item.note) + "</span>" : "") +
                "</span></li>";
        }).join("") + "</ul>";
    }

    function renderRegistrationCard() {
        var box = document.getElementById("registrationCard");
        if (!box) return;

        var team = activeTeam();

        if (!team) {
            createTeamEmptyState(box, {
                icon: "clipboard",
                title: "No team yet",
                message: "Register your first team to start a registration and see its review status here.",
                actionLabel: "Create your team"
            });
            return;
        }

        var tournament = tournamentFor(team);
        var category = categoryFor(team);
        var registration = registrationFor(team);
        var payment = paymentState(team);
        var deadline = tournament ? tournament.registrationCloses : null;

        var rows = [
            ["Tournament", tournament ? tournament.name : "Not registered yet"],
            ["Category", category ? category.name : "-"],
            ["Submitted", registration && registration.submittedOn
                ? U.formatDateTime(registration.submittedOn)
                : "Not submitted from this account"],
            ["Reference", registration && registration.reference ? registration.reference : "-"],
            ["Registration status", registrationStatusLabel(team)],
            ["Payment status", PAYMENT_LABELS[payment.status]],
            ["Registration deadline", deadline ? U.formatDate(deadline) : "No deadline configured"]
        ];

        var statusNote = team.status === "approved"
            ? "The competitions office approved this registration."
            : team.status === "rejected"
                ? "The competitions office rejected this registration. Contact them for the reason and any appeal process."
                : "The competitions office is still reviewing this registration. Completing a form does not approve it.";

        box.innerHTML = panel("Registration status",
            '<div class="status-line">' + U.statusBadge(team.status, registrationStatusLabel(team)) +
                paymentBadge(payment.status) +
                (deadline ? "" : '<span class="badge">No deadline configured</span>') + "</div>" +
            '<ul class="meta-list is-compact">' + rows.map(function (row) {
                return "<li><span>" + U.escapeHtml(row[0]) + "</span><span>" +
                    U.escapeHtml(row[1]) + "</span></li>";
            }).join("") + "</ul>" +
            '<p class="form-note" style="margin-top:12px">' + U.escapeHtml(statusNote) + "</p>" +
            (registration ? checklistMarkup(registration.checklist) : "") +
            '<div class="dashboard-card-actions">' +
                '<a class="btn btn-primary btn-sm" href="/team-registration/?tournament=' +
                    U.escapeHtml(tournament ? tournament.id : "") + '">Complete registration</a>' +
                '<button type="button" class="btn btn-dark-outline btn-sm" data-registration-view="' +
                    U.escapeHtml(team.id) + '">Review submission</button>' +
                '<button type="button" class="btn btn-ghost btn-sm" data-open-view="payments">' +
                    "View payment</button>" +
            "</div>",
            { badge: tournament ? tournament.season : "Preview", badgeTone: "badge-purple" });
    }

    function renderSquadCard() {
        var box = document.getElementById("squadCard");
        if (!box) return;

        var team = activeTeam();

        if (!team) {
            box.innerHTML = panel("Squad readiness",
                '<p class="form-note">A squad becomes available once a team has been created.</p>');
            return;
        }

        var squad = squadFor(team.id);
        var playerAccess = playerRegistrationPermission(team);
        var completeRecords = squad.length - squadIssueList(team).length;
        var category = categoryFor(team);
        var youth = isYouthCategory(category);
        var consentOutstanding = youth
            ? squad.filter(function (player) { return player.guardianConsent !== "on-file"; }).length
            : 0;
        var issues = squadIssueList(team).length;
        var percent = squad.length ? Math.round((completeRecords / squad.length) * 100) : 0;

        if (!playerAccess.allowed) {
            box.innerHTML = panel("Player registration",
                playerRegistrationGateMarkup(team, playerAccess));
            return;
        }

        box.innerHTML = panel("Squad readiness",
            '<div class="progress-track"><div class="progress-fill' +
                (percent === 100 ? " is-green" : "") + '" style="width:' + percent + '%"></div></div>' +
            '<p class="progress-meta">' + completeRecords + " of " + squad.length +
                " roster records complete (" + percent + "%)</p>" +
            '<ul class="meta-list is-compact" style="margin-top:14px">' +
                "<li><span>Total registered players</span><span>" + squad.length + "</span></li>" +
                "<li><span>Complete records</span><span>" + completeRecords + "</span></li>" +
                "<li><span>Records needing attention</span><span>" + issues + "</span></li>" +
                (youth
                    ? "<li><span>Guardian consent outstanding</span><span>" + consentOutstanding + "</span></li>"
                    : "<li><span>Guardian consent</span><span>Not required for this category</span></li>") +
            "</ul>" +
            (youth
                ? '<div class="privacy-note" style="margin-top:14px">' + U.icon("shield") +
                    "<span>Youth category: player details are limited in public and guardian consent must be " +
                    "recorded before participation.</span></div>"
                : "") +
            '<div class="dashboard-card-actions">' +
                '<button type="button" class="btn btn-primary btn-sm" data-open-view="squad">Manage squad</button>' +
                '<button type="button" class="btn btn-dark-outline btn-sm" data-add-player="1">' +
                    "Add a player</button>" +
            "</div>",
            {
                badge: youth ? "Youth category"
                    : (category ? ageRangeLabel(category) + " years" : ""),
                badgeTone: youth ? "badge-gold" : ""
            });
    }

    /* -------------------------
       Match cards (fixtures and results)
       ------------------------- */

    function matchTeamBlock(teamId, side, managerTeamId) {
        var team = U.teamById(teamId);
        var isOwn = teamId === managerTeamId;
        var sideClass = side === "away" ? " is-away" : "";

        if (!team) {
            return '<div class="match-team is-pending' + sideClass + '">' +
                '<span class="crest" aria-hidden="true">?</span>' +
                '<span class="match-team-name">To be confirmed<small>Pending schedule</small></span>' +
            "</div>";
        }

        return '<div class="match-team' + sideClass + '">' +
            U.crestMarkup(team, "sm") +
            '<span class="match-team-name">' + U.escapeHtml(team.name) +
                "<small>" + U.escapeHtml(team.shortName) + (isOwn ? " \u00b7 your team" : "") +
                "</small></span>" +
        "</div>";
    }

    function matchScoreBlock(match) {
        if (match.status === "completed" && match.homeScore !== null && match.awayScore !== null) {
            return '<div class="match-score" aria-label="Final score ' + match.homeScore + " to " +
                match.awayScore + '">' + match.homeScore + "<span>&ndash;</span>" + match.awayScore + "</div>";
        }

        return '<div class="match-score is-pending">vs</div>';
    }

    function matchCardMarkup(match, options) {
        var settings = options || {};
        var team = settings.team || activeTeam();
        var teamId = team ? team.id : "";
        var tournament = U.tournamentById(match.tournamentId);
        var category = U.categoryById(match.categoryId);
        var label = match.group ? match.group : (match.stage || "Fixture");

        var meta = settings.result
            ? "<span>" + U.icon("calendar") + U.formatDate(match.kickoff) + "</span>"
            : "<span>" + U.icon("clock") + U.formatDate(match.kickoff) + " \u00b7 " +
                U.formatTime(match.kickoff) + "</span>";

        return '<article class="match-card">' +
            '<div class="match-card-head">' +
                '<span class="stage-label">' + U.escapeHtml(label + " \u00b7 " + match.round) + "</span>" +
                U.statusBadge(match.status, U.matchStatusLabel(match.status)) +
            "</div>" +
            '<div class="match-card-body">' +
                matchTeamBlock(match.homeTeamId, "home", teamId) +
                matchScoreBlock(match) +
                matchTeamBlock(match.awayTeamId, "away", teamId) +
            "</div>" +
            '<div class="match-card-foot">' +
                '<span class="match-meta">' + meta +
                    "<span>" + U.icon("pin") + U.escapeHtml(match.venue) + "</span>" +
                    (tournament ? "<span>" + U.icon("trophy") + U.escapeHtml(tournament.name) + "</span>" : "") +
                    (category ? "<span>" + U.icon("users") + U.escapeHtml(category.name) + "</span>" : "") +
                "</span>" +
                '<span class="match-card-actions">' +
                '<button type="button" class="btn btn-dark-outline btn-sm" data-match="' +
                    U.escapeHtml(match.id) + '">' +
                    (settings.result ? "View result" : "View match details") + "</button>" +
                (settings.result ? "" : lineupActionMarkup(match, teamId)) +
                '<button type="button" class="btn btn-primary btn-sm" data-match-share="' +
                    U.escapeHtml(match.id) + '">Share image</button>' +
                "</span>" +
            "</div>" +
        "</article>";
    }

    function renderUpcomingCard() {
        var box = document.getElementById("upcomingCard");
        if (!box) return;

        var team = activeTeam();

        if (!team) {
            box.innerHTML = panel("Upcoming matches",
                '<p class="form-note">Fixtures appear once a team is registered and the schedule is published.</p>');
            return;
        }

        var list = upcomingMatches(team.id).slice(0, 3);

        if (!list.length) {
            box.innerHTML = panel("Upcoming matches",
                '<p class="form-note">No upcoming fixtures have been published for your team yet.</p>' +
                '<div class="dashboard-card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/fixtures/">View all fixtures</a>' +
                "</div>");
            return;
        }

        box.innerHTML = panel("Upcoming matches",
            '<div class="match-list">' + list.map(function (match) {
                return matchCardMarkup(match, { team: team });
            }).join("") + "</div>" +
            '<div class="dashboard-card-actions">' +
                '<button type="button" class="btn btn-dark-outline btn-sm" data-open-view="fixtures">' +
                    "View all fixtures</button>" +
            "</div>",
            { badge: list.length + " confirmed", badgeTone: "badge-purple" });
    }

    /* -------------------------
       Overview dispatcher
       ------------------------- */

    /* The overview shows only the four summary cards. Each card links to its
       own section, which keeps this page simple on a phone. */
    function renderOverview() {
        renderKpis();
    }

    /* =========================================================
       My Teams
       ========================================================= */

    function teamCardMarkup(team) {
        var category = categoryFor(team);
        var tournament = tournamentFor(team);
        var payment = paymentState(team);
        var playerAccess = playerRegistrationPermission(team);
        var squad = squadFor(team.id);
        var registration = registrationFor(team);
        var current = activeTeam();
        var isActive = !!(current && current.id === team.id);
        var participation = "";

        function line(icon, text) {
            participation += "<div>" + U.icon(icon) + "<span>" + U.escapeHtml(text) + "</span></div>";
        }

        line("trophy", category ? category.name : "Category not configured");
        line("flag", tournament ? tournament.name + " \u00b7 " + tournament.season
            : "Not registered for a competition");
        line("users", playerAccess.allowed
            ? squad.length + " player" + (squad.length === 1 ? "" : "s") + " on file"
            : "Player registration locked");
        line("pin", team.location || "Location not provided");

        return '<article class="card team-card' + (isActive ? " is-active" : "") + '">' +
            '<div class="team-card-head">' +
                '<div class="team-identity">' + U.crestMarkup(team, "lg") +
                    '<span class="team-identity-text">' +
                        "<strong>" + U.escapeHtml(team.name) + "</strong>" +
                        "<span>" + U.escapeHtml(team.shortName) + "</span>" +
                    "</span>" +
                "</div>" +
                U.statusBadge(team.status, registrationStatusLabel(team)) +
            "</div>" +
            '<div class="team-participation">' + participation + "</div>" +
            '<div class="status-line">' +
                paymentBadge(payment.status) +
                (tournament
                    ? '<span class="badge">' + U.escapeHtml(U.tournamentStatusLabel(tournament.status)) + "</span>"
                    : '<span class="badge">Not entered</span>') +
                (isActive ? '<span class="badge badge-purple">Active team</span>' : "") +
            "</div>" +
            (registration && registration.missing.length
                ? '<p class="form-note">' + registration.missing.length + " outstanding item" +
                    (registration.missing.length === 1 ? "" : "s") + " on this registration.</p>"
                : "") +
            '<div class="card-actions">' +
                (payment.needsPayment
                    ? '<button type="button" class="btn btn-gold btn-sm" data-pay-open="' +
                        U.escapeHtml(team.id) + '">Pay registration fee</button>'
                    : "") +
                '<a class="btn btn-dark-outline btn-sm" href="/team-details/?team=' +
                    encodeURIComponent(team.id) + '">View team</a>' +
                '<button type="button" class="btn btn-primary btn-sm" data-manage-squad="' +
                    U.escapeHtml(team.id) + '">Manage squad</button>' +
                (isActive
                    ? ""
                    : '<button type="button" class="btn btn-ghost btn-sm" data-activate-team="' +
                        U.escapeHtml(team.id) + '">Set as active</button>') +
                (tournament
                    ? ""
                    : '<button type="button" class="btn btn-ghost btn-sm" data-action="create-team">' +
                        "Create another team</button>") +
            "</div>" +
        "</article>";
    }

    function filteredTeams() {
        var filter = state.teamsFilter;

        return teamsInScope().filter(function (team) {
            var category = categoryFor(team);
            return U.matchesQuery({
                text: team.name + " " + team.shortName + " " + (team.location || "") +
                    " " + (category ? category.name : "")
            }, filter.query, ["text"]);
        });
    }

    function renderTeams() {
        var grid = document.getElementById("teamCards");
        var emptyBox = document.getElementById("teamsEmpty");
        var noMatch = document.getElementById("teamsNoMatch");
        var filterBar = document.getElementById("teamsFilterBar");
        var scope = teamsInScope();

        if (!grid) return;

        var search = document.getElementById("teamSearch");
        if (search && document.activeElement !== search) search.value = state.teamsFilter.query;

        /* No teams at all: show the create action instead of an empty grid. */
        if (!scope.length) {
            if (filterBar) filterBar.hidden = true;
            grid.innerHTML = "";
            if (noMatch) noMatch.innerHTML = "";
            setHtml("teamsResultCount", "");
            if (emptyBox) {
                createTeamEmptyState(emptyBox, {
                    icon: "shield",
                    title: "No teams yet",
                    message: "Create a team with your existing manager account, then register it for an open competition.",
                    actionLabel: "Create your team"
                });
            }
            return;
        }

        if (emptyBox) emptyBox.innerHTML = "";
        if (filterBar) filterBar.hidden = false;

        var list = filteredTeams();

        setHtml("teamsResultCount", list.length + " of " + scope.length + " team" +
            (scope.length === 1 ? "" : "s") + " shown.");

        if (!list.length) {
            grid.innerHTML = "";
            if (noMatch) {
                noMatch.innerHTML = U.emptyState({
                    icon: "search",
                    title: "No teams match your search",
                    message: "Try a different team name or code."
                });
            }
            return;
        }

        if (noMatch) noMatch.innerHTML = "";
        grid.innerHTML = list.map(teamCardMarkup).join("");
    }

    /* =========================================================
       Squad management
       ========================================================= */

    function squadSummaryMarkup(team) {
        var squad = squadFor(team.id);
        var category = categoryFor(team);
        var youth = isYouthCategory(category);
        var completeRecords = squad.length - squadIssueList(team).length;
        var incomplete = squad.filter(function (player) {
            return !player.position || !player.shirtNumber || !player.name;
        }).length;
        var issues = squadIssueList(team).length;
        var consentOutstanding = youth
            ? squad.filter(function (player) { return player.guardianConsent !== "on-file"; }).length
            : 0;

        function tile(label, value, tone) {
            return '<div class="squad-summary-tile' + (tone ? " " + tone : "") + '">' +
                "<span>" + U.escapeHtml(label) + "</span><strong>" +
                U.escapeHtml(String(value)) + "</strong></div>";
        }

        return '<div class="squad-summary-grid">' +
            tile("Registered players", squad.length) +
            tile("Complete records", completeRecords, completeRecords === squad.length ? "is-good" : "") +
            tile("Incomplete records", incomplete, incomplete ? "is-warning" : "") +
            (youth
                ? tile("Consent outstanding", consentOutstanding, consentOutstanding ? "is-danger" : "is-good")
                : tile("Records needing attention", issues, issues ? "is-warning" : "is-good")) +
        "</div>" +
        (youth
            ? '<div class="privacy-note" style="margin-bottom:14px">' + U.icon("shield") +
                "<span>Youth category: age eligibility is checked against the category range (" +
                U.escapeHtml(ageRangeLabel(category)) +
                " years) and guardian consent must be recorded before participation. Identity " +
                "documents are held by the competitions office and are not shown here.</span></div>"
            : "");
    }

    function playerStatusBadge() {
        return U.statusBadge("registered", "Registered");
    }

    function consentCell(player, youth) {
        if (!youth) return '<span class="badge">Not required</span>';
        if (player.guardianConsent === "on-file") return '<span class="badge badge-green">Recorded</span>';
        return '<span class="badge badge-gold">Outstanding</span>';
    }

    function squadRowMarkup(player, team, youth, canChangeRoster) {
        var flags = [];

        if (!player.position || !player.shirtNumber) flags.push("Incomplete record");
        if (youth && player.guardianConsent !== "on-file") flags.push("Consent outstanding");
        if (player.previewOnly) flags.push("Added in this preview");

        return "<tr>" +
            '<td data-label="Player">' +
                '<div class="player-cell">' +
                    U.crestMarkup({ name: player.name, accent: team.accent }, "sm") +
                    '<span class="player-cell-text">' +
                        "<strong>" + U.escapeHtml(U.publicPlayerName(player)) + "</strong>" +
                        "<span>" + U.escapeHtml(player.minor ? "Youth player" : "Senior player") + "</span>" +
                    "</span>" +
                "</div>" +
                (flags.length
                    ? '<span class="row-flag">' + U.escapeHtml(flags.join(" \u00b7 ")) + "</span>"
                    : "") +
            "</td>" +
            '<td data-label="Position">' + U.escapeHtml(player.position || "Not provided") + "</td>" +
            '<td data-label="Shirt">' + (player.shirtNumber ? "#" + player.shirtNumber : "-") + "</td>" +
            '<td data-label="Class">' + U.escapeHtml(player.classification || "-") + "</td>" +
            '<td data-label="Roster status">' + playerStatusBadge() + "</td>" +
            '<td data-label="Consent">' + consentCell(player, youth) + "</td>" +
            '<td data-label="Actions" class="table-actions">' +
                '<div class="table-actions-inner">' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-player-view="' +
                        U.escapeHtml(player.id) + '">View</button>' +
                    (canChangeRoster
                        ? '<button type="button" class="btn btn-dark-outline btn-sm" data-player-edit="' +
                            U.escapeHtml(player.id) + '">Edit</button>' +
                          '<button type="button" class="btn btn-dark-outline btn-sm is-danger" ' +
                            'data-player-remove="' + U.escapeHtml(player.id) + '" aria-label="Remove ' +
                            U.escapeHtml(U.publicPlayerName(player)) + ' from the squad">Remove</button>'
                        : "") +
                "</div>" +
            "</td>" +
        "</tr>";
    }

    function renderSquad() {
        var team = activeTeam();
        var summary = document.getElementById("squadSummary");
        var body = document.getElementById("squadTableBody");
        var wrap = document.getElementById("squadTableWrap");
        var emptyBox = document.getElementById("squadRoster");
        var nameLabel = document.getElementById("squadTeamName");

        if (!body) return;

        if (nameLabel) nameLabel.textContent = team ? team.name : "-";
        if (els.addPlayerButton) els.addPlayerButton.hidden = !team;
        if (els.squadIssuesButton) els.squadIssuesButton.hidden = !team;

        if (!team) {
            if (summary) summary.innerHTML = "";
            body.innerHTML = "";
            if (wrap) wrap.hidden = true;
            if (emptyBox) {
                createTeamEmptyState(emptyBox, {
                    icon: "users",
                    title: "No team selected",
                    message: "Create a team first, then players can be added to its squad.",
                    actionLabel: "Create your team"
                });
            }
            return;
        }

        var access = playerRegistrationPermission(team);
        if (els.addPlayerButton) els.addPlayerButton.hidden = !access.rosterChangesAllowed;
        if (els.squadIssuesButton) els.squadIssuesButton.hidden = !access.allowed;
        if (!access.allowed) {
            if (summary) summary.innerHTML = "";
            body.innerHTML = "";
            if (wrap) wrap.hidden = true;
            if (emptyBox) {
                emptyBox.innerHTML = panel("Player registration",
                    playerRegistrationGateMarkup(team, access));
            }
            return;
        }

        var category = categoryFor(team);
        var youth = isYouthCategory(category);
        var squad = squadFor(team.id);
        var list = state.squadIssuesOnly ? squadIssueList(team) : squad;
        var lockNotice = access.rosterChangesAllowed ? "" : noticeMarkup(
            "Squad changes are locked",
            rosterChangeLockMessage(access));

        if (summary) summary.innerHTML = lockNotice + squadSummaryMarkup(team);

        if (!squad.length) {
            if (wrap) wrap.hidden = true;
            if (emptyBox) {
                emptyBox.innerHTML = U.emptyState({
                    icon: "users",
                    title: "No players on file",
                    message: access.rosterChangesAllowed
                        ? "Add your first player to start building the squad for " + team.name + "."
                        : rosterChangeLockMessage(access),
                    actionLabel: access.rosterChangesAllowed ? "Add a player" : undefined
                });

                var addAction = emptyBox.querySelector("[data-empty-action]");
                if (addAction) U.on(addAction, "click", function () { openPlayerModal(null); });
            }
            return;
        }

        if (emptyBox) emptyBox.innerHTML = "";

        if (!list.length) {
            if (wrap) wrap.hidden = true;
            if (emptyBox) {
                emptyBox.innerHTML = U.emptyState({
                    icon: "checkCircle",
                    title: "Every record is complete",
                    message: "No roster records are incomplete or missing required consent.",
                    actionLabel: "Show all players"
                });

                var showAll = emptyBox.querySelector("[data-empty-action]");
                if (showAll) {
                    U.on(showAll, "click", function () {
                        state.squadIssuesOnly = false;
                        renderSquad();
                    });
                }
            }
            return;
        }

        if (wrap) wrap.hidden = false;

        body.innerHTML = list.map(function (player) {
            return squadRowMarkup(player, team, youth, access.rosterChangesAllowed);
        }).join("");
    }

    /* =========================================================
       Tournament registrations
       ========================================================= */

    function registrationCardMarkup(team) {
        var category = categoryFor(team);
        var tournament = tournamentFor(team);
        var registration = registrationFor(team);
        var payment = paymentState(team);
        var squad = squadFor(team.id);
        var playerAccess = playerRegistrationPermission(team);
        var deadline = tournament ? tournament.registrationCloses : null;
        var checklist = registration && Array.isArray(registration.checklist)
            ? registration.checklist
            : [];
        var completedItems = checklist.filter(function (item) { return item.done; }).length;
        var progress = checklist.length
            ? Math.round((completedItems / checklist.length) * 100)
            : 0;

        var rows = [
            ["Tournament", tournament ? tournament.name : "Not registered"],
            ["Category", category ? category.name : "-"],
            ["Submitted", registration && registration.submittedOn
                ? U.formatDateTime(registration.submittedOn) : "Not submitted"],
            ["Reference", registration && registration.reference ? registration.reference : "-"],
            ["Deadline", deadline ? U.formatDate(deadline) : "No deadline configured"],
            ["Player registration", playerAccess.allowed
                ? squad.length + " player" + (squad.length === 1 ? "" : "s") + " on file"
                : (playerAccess.approved ? "Player registration is open"
                    : "Opens after team approval")]
        ];

        var missingMarkup = registration && registration.missing.length
            ? '<div class="registration-alert" role="note">' + U.icon("alert") +
                "<span><strong>Needs attention</strong> " +
                U.escapeHtml(registration.missing.join("; ")) + "</span></div>"
            : "";

        return '<section class="registration-card">' +
            '<div class="registration-card-head">' +
                '<div class="registration-team">' + U.crestMarkup(team, "md") +
                    '<div class="registration-team-copy">' +
                    "<h3>" + U.escapeHtml(team.name) + "</h3>" +
                    "<p>" + U.escapeHtml(tournament ? tournament.name + " \u00b7 " + tournament.season
                        : "No competition attached") + "</p>" +
                    "</div>" +
                "</div>" +
                '<div class="registration-badges">' +
                    U.statusBadge(team.status, registrationStatusLabel(team)) +
                    paymentBadge(payment.status) +
                "</div>" +
            "</div>" +
            '<div class="registration-body">' +
                '<div class="registration-content">' +
                    '<div class="registration-info">' +
                        '<div class="registration-details">' + rows.map(function (row) {
                            return '<div class="registration-detail"><span>' + U.escapeHtml(row[0]) +
                                "</span><strong>" + U.escapeHtml(row[1]) + "</strong></div>";
                        }).join("") + "</div>" +
                        missingMarkup +
                    "</div>" +
                    (checklist.length
                        ? '<div class="registration-checklist">' +
                        '<div class="registration-checklist-head"><h4>Review checklist</h4>' +
                            "<span>" + completedItems + " of " + checklist.length + " complete</span></div>" +
                        '<div class="registration-progress" role="progressbar" ' +
                            'aria-label="Registration checklist progress" aria-valuemin="0" ' +
                            'aria-valuemax="' + checklist.length + '" aria-valuenow="' +
                            completedItems + '"><span style="width:' + progress + '%"></span></div>' +
                        checklistMarkup(checklist) +
                    "</div>"
                        : '<p class="form-note">Registration checklist is not available yet.</p>') +
                "</div>" +
                '<div class="registration-card-actions">' +
                    (registration && registration.missing.length && tournament
                        ? '<a class="btn btn-primary btn-sm" href="/team-registration/?tournament=' +
                            U.escapeHtml(tournament.id) + '">Correct registration</a>'
                        : "") +
                    '<button type="button" class="btn btn-dark-outline btn-sm" data-registration-view="' +
                        U.escapeHtml(team.id) + '">Review submission</button>' +
                    (payment.needsPayment
                        ? '<button type="button" class="btn btn-gold btn-sm" data-pay-open="' +
                            U.escapeHtml(team.id) + '">Payment instructions</button>'
                        : '<button type="button" class="btn btn-ghost btn-sm" data-open-view="payments">' +
                            "View payment</button>") +
                "</div>" +
            "</div>" +
        "</section>";
    }

    function renderRegistrations() {
        var container = document.getElementById("registrationList");
        if (!container) return;

        var scope = teamsInScope();

        if (!scope.length) {
            createTeamEmptyState(container, {
                icon: "clipboard",
                title: "No registrations yet",
                message: "Create a team with your existing manager account to start a registration.",
                actionLabel: "Register a team"
            });
            return;
        }

        container.innerHTML = scope.map(registrationCardMarkup).join("") +
            noticeMarkup("How approval works.",
                "A registration becomes active only after the competitions office approves it and the " +
                "finance office confirms the entry fee. Nothing on this dashboard changes either status.");
    }

    /* =========================================================
       Payments and receipts
       ========================================================= */

    function paymentSummaryMarkup(team) {
        var payment = paymentState(team);
        var category = categoryFor(team);
        var tournament = tournamentFor(team);
        var youth = isYouthCategory(category);
        var note = payment.status === "not-required"
            ? "No entry fee is configured for this category, so no payment is expected."
            : payment.latest
                ? "Payment status is confirmed by the finance office. This dashboard does not take payments."
                : "No payment has been recorded yet. View the M-Pesa instructions to send and confirm payment.";
        if (youth && payment.status !== "not-required") {
            note += " Youth fees are set by the organiser and may be waived.";
        }

        function amount(value) {
            return value === null ? "Not configured"
                : (value === 0 ? "No fee" : U.formatMoney(value));
        }
        var balanceLabel = payment.outstanding === null
            ? "-"
            : payment.status === "not-required"
                ? "No fee"
                : payment.outstanding === 0 ? "Paid in full" : U.formatMoney(payment.outstanding);

        return '<article class="payment-summary-card">' +
            '<div class="payment-summary-head"><div><h3>Payment summary</h3>' +
                "<p>" + U.escapeHtml(team.name) + " · " +
                    U.escapeHtml(tournament ? tournament.name : "No competition linked") + "</p></div>" +
                '<div class="payment-summary-status">' + paymentBadge(payment.status) +
                    (payment.latest && payment.latest.reconciled === false
                        ? '<span class="badge badge-gold">Awaiting reconciliation</span>' : "") +
                "</div></div>" +
            '<div class="payment-summary-metrics">' +
                '<div class="payment-summary-metric is-due"><span>Balance due</span><strong>' +
                    U.escapeHtml(balanceLabel) + "</strong></div>" +
                '<div class="payment-summary-metric"><span>Entry fee</span><strong>' +
                    U.escapeHtml(amount(payment.fee)) + "</strong></div>" +
                '<div class="payment-summary-metric"><span>Amount paid</span><strong>' +
                    U.formatMoney(payment.paid) + "</strong></div>" +
            "</div>" +
            (payment.latest
                ? '<ul class="payment-summary-details">' +
                    "<li><span>Method</span><strong>" + U.escapeHtml(payment.latest.method) + "</strong></li>" +
                    "<li><span>Latest reference</span><strong>" +
                        U.escapeHtml(payment.latest.reference || "-") + "</strong></li>" +
                    "<li><span>Recorded</span><strong>" +
                        U.escapeHtml(U.formatDate(payment.latest.recordedAt)) + "</strong></li>" +
                "</ul>"
                : "") +
            '<p class="form-note payment-summary-note">' + U.escapeHtml(note) + "</p>" +
            '<div class="dashboard-card-actions">' +
                (payment.needsPayment
                    ? '<button type="button" class="btn btn-primary btn-sm" data-pay-open="' +
                        U.escapeHtml(team.id) + '">View payment instructions</button>'
                    : "") +
                (payment.latest
                    ? '<button type="button" class="btn btn-dark-outline btn-sm" data-receipt="' +
                        U.escapeHtml(payment.latest.id) + '">View receipt</button>'
                    : "") +
                '<a class="btn btn-ghost btn-sm" href="/faqs/#FAQ-003">How payment works</a>' +
            "</div>" +
        "</article>";
    }

    function renderPayments() {
        var summary = document.getElementById("paymentSummary");
        var body = document.getElementById("paymentTableBody");
        var emptyBox = document.getElementById("paymentEmpty");
        var countBadge = document.getElementById("paymentHistoryCount");
        var scope = teamsInScope();
        var team = activeTeam();

        if (summary) {
            summary.innerHTML = scope.length
                ? '<div class="payment-summary-list">' +
                    scope.map(paymentSummaryMarkup).join("") + "</div>"
                : U.emptyState({
                    icon: "wallet",
                    title: "No payment records",
                    message: "Entry fee records appear once a team is registered for a competition.",
                    actionLabel: "Create a team"
                });
            if (!scope.length) {
                var createAction = summary.querySelector("[data-empty-action]");
                if (createAction) U.on(createAction, "click", openManagedTeamModal);
            }
        }

        if (!body) return;

        var records = team ? paymentsFor(team.id) : [];

        records = records.slice().sort(function (a, b) {
            return String(b.recordedAt).localeCompare(String(a.recordedAt));
        });

        if (countBadge) {
            countBadge.textContent = records.length + " record" + (records.length === 1 ? "" : "s");
        }

        var table = document.getElementById("paymentTable");
        if (table) {
            var caption = table.querySelector("caption");
            if (caption) {
                caption.textContent = team
                    ? "Payment records for " + team.name + ". Receipts are issued by the finance office."
                    : "Payment records are read-only in this dashboard.";
            }
        }

        if (!records.length) {
            body.innerHTML = "";
            if (emptyBox) {
                emptyBox.innerHTML = U.emptyState({
                    icon: "wallet",
                    title: "No payments recorded for this team",
                    message: team
                        ? "Nothing has been recorded for " + team.name + " yet. The finance office records " +
                          "payments after a registration is approved."
                        : "Select a team to see its payment history."
                });
            }
            return;
        }

        if (emptyBox) emptyBox.innerHTML = "";

        body.innerHTML = records.map(function (payment) {
            var statusLabel = payment.status === "successful" ? "Successful"
                : payment.status === "pending" ? "Pending verification"
                    : payment.status === "failed" ? "Failed"
                        : payment.status;

            return "<tr>" +
                '<td data-label="Reference"><strong>' + U.escapeHtml(payment.reference) + "</strong></td>" +
                '<td data-label="Recorded">' + U.escapeHtml(U.formatDateTime(payment.recordedAt)) + "</td>" +
                '<td data-label="Method">' + U.escapeHtml(payment.method) + "</td>" +
                '<td data-label="Amount" class="table-num">' +
                    U.escapeHtml(U.formatMoney(payment.amount, payment.currency)) + "</td>" +
                '<td data-label="Status">' + U.statusBadge(payment.status, statusLabel) +
                    (payment.reconciled === false
                        ? ' <span class="badge badge-gold">Not reconciled</span>' : "") +
                "</td>" +
                '<td data-label="Receipt" class="table-actions">' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-receipt="' +
                        U.escapeHtml(payment.id) + '">' +
                        (payment.receipt ? "View receipt" : "Receipt status") + "</button>" +
                "</td>" +
            "</tr>";
        }).join("");
    }

    /* =========================================================
       Fixtures and results
       ========================================================= */

    function renderFixtures() {
        var team = activeTeam();
        var upcomingList = document.getElementById("upcomingList");
        var resultsList = document.getElementById("resultsList");
        var upcomingEmpty = document.getElementById("upcomingEmpty");
        var resultsEmpty = document.getElementById("resultsEmpty");
        var upcomingSection = document.getElementById("upcomingSection");
        var resultsSection = document.getElementById("resultsSection");
        var filter = state.matchFilter;

        if (!upcomingList) return;

        U.$$("[data-match-filter]").forEach(function (chip) {
            var active = chip.getAttribute("data-match-filter") === filter;
            chip.classList.toggle("is-active", active);
            chip.setAttribute("aria-pressed", String(active));
        });

        if (upcomingSection) {
            upcomingSection.hidden = !(filter === "upcoming" || filter === "all");
        }
        if (resultsSection) {
            resultsSection.hidden = !(filter === "results" || filter === "all");
        }

        if (!team) {
            upcomingList.innerHTML = "";
            if (resultsList) resultsList.innerHTML = "";
            [upcomingEmpty, resultsEmpty].forEach(function (node) {
                if (node) {
                    createTeamEmptyState(node, {
                        icon: "calendar",
                        title: "No team selected",
                        message: "Fixtures appear once a team is registered and the schedule is published.",
                        actionLabel: "Create your team"
                    });
                }
            });
            return;
        }

        var upcoming = upcomingMatches(team.id);
        var results = completedMatches(team.id);

        if (!upcoming.length) {
            upcomingList.innerHTML = "";
            if (upcomingEmpty) {
                upcomingEmpty.innerHTML = U.emptyState({
                    icon: "calendar",
                    title: "No upcoming fixtures",
                    message: "No upcoming fixtures have been published for your team yet.",
                    actionLabel: "Open the fixture centre",
                    actionHref: "/fixtures/"
                });
            }
        } else {
            if (upcomingEmpty) upcomingEmpty.innerHTML = "";
            upcomingList.innerHTML = upcoming.map(function (match) {
                return matchCardMarkup(match, { team: team });
            }).join("");
        }

        if (!results.length) {
            if (resultsList) resultsList.innerHTML = "";
            if (resultsEmpty) {
                resultsEmpty.innerHTML = U.emptyState({
                    icon: "whistle",
                    title: "No published results",
                    message: "Results appear after the competitions office verifies them.",
                    actionLabel: "Open the results centre",
                    actionHref: "/results/"
                });
            }
        } else {
            if (resultsEmpty) resultsEmpty.innerHTML = "";
            if (resultsList) {
                resultsList.innerHTML = results.map(function (match) {
                    return matchCardMarkup(match, { team: team, result: true });
                }).join("");
            }
        }
    }

    /* =========================================================
       Profile
       ========================================================= */

    function renderProfile() {
        var manager = PREVIEW.manager;
        var side = document.getElementById("profileSide");

        function field(id, value) {
            var node = document.getElementById(id);
            if (node && document.activeElement !== node) node.value = value;
        }

        field("profileName", manager.name);
        field("profileEmail", manager.email);
        field("profilePhone", manager.phone);
        field("profileRole", manager.role);

        var publicBox = document.getElementById("profilePublic");
        if (publicBox) publicBox.checked = manager.publicListing;

        if (!side) return;

        var scope = teamsInScope();

        side.innerHTML = panel("Teams linked to this account",
            '<ul class="meta-list is-compact">' + (scope.length
                ? scope.map(function (team) {
                    return "<li><span>" + U.escapeHtml(team.name) + "</span><span>" +
                        U.escapeHtml(categoryFor(team) ? categoryFor(team).name : "-") + "</span></li>";
                }).join("")
                : "<li><span>No teams linked yet</span><span>-</span></li>") +
            "</ul>" +
            '<p class="form-note" style="margin-top:12px">Team links are managed by the competitions office. ' +
                "Contact them if a team is missing or should be removed.</p>") +

        panel("Account security",
            '<p class="form-note">Sign-in is not connected in this phase, so no session is active and this ' +
                "page never handles your password.</p>" +
            '<div class="dashboard-card-actions">' +
                '<a class="btn btn-dark-outline btn-sm" href="/forgot-password/">Change password</a>' +
                '<a class="btn btn-ghost btn-sm" href="/login/">Sign-in page</a>' +
            "</div>") +

        panel("Privacy and data",
            '<div class="privacy-note"><span>Only information needed to run the competition is kept. Player ' +
                "contact details and identity documents are never displayed on this dashboard.</span></div>" +
            '<div class="dashboard-card-actions">' +
                '<a class="btn btn-dark-outline btn-sm" href="/privacy/">Privacy policy</a>' +
                '<a class="btn btn-ghost btn-sm" href="/terms/">Terms &amp; Conditions</a>' +
                '<a class="btn btn-ghost btn-sm" href="/contact/">Request my data</a>' +
            "</div>") +

        panel("Session",
            '<p class="form-note">Signing out ends your Firebase session on this device.</p>' +
            '<div class="dashboard-card-actions">' +
                '<button type="button" class="btn btn-danger-outline btn-sm" data-action="signout">' +
                    "Sign out</button>" +
            "</div>");
    }

    /* Saving a profile is a backend responsibility, so this only validates
       and states clearly that nothing was persisted. */
    function handleProfileSubmit(event) {
        event.preventDefault();

        var form = document.getElementById("profileForm");
        var alertBox = document.getElementById("profileAlert");

        if (!form) return;

        U.clearFormErrors(form);
        setAlert(alertBox, "");

        var result = U.validateForm(form, {
            profileName: {
                required: true, minLength: 3,
                requiredMessage: "Enter your full name."
            },
            profilePhone: {
                required: true, phone: true,
                requiredMessage: "Enter your mobile number."
            }
        });

        if (!result.valid) {
            setAlert(alertBox, "danger", "Check the highlighted fields.",
                "Your details need correcting before they can be saved.");
            return;
        }

        setAlert(alertBox, "warning", "Profile updates are not available yet.",
            "Your details were validated but were not changed or sent to the server.");
        U.toast("Profile editing is not connected yet. No changes were saved.", "info");
    }

    /* =========================================================
       Competition rules
       ========================================================= */

    function loadPublishedRules() {
        return Data.rules || [];
    }

    function renderRules() {
        var content = document.getElementById("rulesContent");
        var ackPanel = document.getElementById("ackPanel");
        var notice = document.getElementById("rulesNotice");
        var team = activeTeam();
        var tournament = team ? tournamentFor(team) : null;
        var category = team ? categoryFor(team) : null;

        if (!content) return;
        if (notice) notice.innerHTML = "";

        var rules;
        try {
            rules = loadPublishedRules();
        } catch (error) {
            console.error("Unable to load competition rules for the manager dashboard.", error);
            content.innerHTML = "";
            if (ackPanel) ackPanel.innerHTML = "";
            if (notice) {
                notice.innerHTML = alertMarkup("danger", "Rules could not be loaded.",
                    "Please try again later.");
            }
            return;
        }

        var published = category
            ? rules.filter(function (rule) {
                return (rule.categoryId === category.id || rule.categoryId === category.adminId) &&
                    String(rule.state).toLowerCase() === "published";
            }).sort(function (a, b) {
                return String(b.updated || "").localeCompare(String(a.updated || ""));
            })
            : [];
        var rule = published[0] || null;
        var registration = team ? registrationFor(team) : null;
        state.acknowledged = Boolean(rule && registration &&
            (PREVIEW.acknowledgments || []).some(function (item) {
                return item.registration_id === team.registrationId && item.rules_id === rule.id;
            }));
        var body;

        if (!team || !tournament || !category) {
            body = '<p class="form-note">Select a team linked to a competition to see its rules.</p>';
        } else if (!rule) {
            body = '<p class="form-note">The competitions office has not published rules for ' +
                U.escapeHtml(category.name) + " yet.</p>";
        } else {
            body =
                '<div class="rules-context"><strong>' + U.escapeHtml(tournament.name) + " · " +
                    U.escapeHtml(category.name) + "</strong>" +
                    (rule.updated
                        ? "<span>Updated " + U.escapeHtml(U.formatDate(rule.updated)) + "</span>"
                        : "") +
                "</div>" +
                '<h2 class="rules-title">' + U.escapeHtml(rule.title) + "</h2>" +
                '<article class="rich-text rules-body">' +
                    window.AngutsaRulesFormat.render(rule.body) +
                "</article>" +
                '<div class="dashboard-card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="/tournament-rules/?tournament=' +
                        encodeURIComponent(tournament.id) + '">Open full rules page</a>' +
                "</div>";
        }

        content.innerHTML = panel("Competition rules", body,
            { badge: rule ? (state.acknowledged ? "Acknowledged" : "Published") : "Not published",
                badgeTone: rule && state.acknowledged ? "badge-green" : "badge-purple" });

        if (!ackPanel) return;
        if (!rule) {
            ackPanel.innerHTML = "";
            return;
        }

        ackPanel.innerHTML = panel("Rules acknowledgment",
            "<p>Confirm that you have read the competition rules for " +
                U.escapeHtml(category.name) + ".</p>" +
            '<label class="check" style="margin-top:14px">' +
                '<input type="checkbox" id="ackCheckbox"' + (state.acknowledged ? " checked" : "") + ">" +
                "<span>I confirm that I have read the competition rules and understand that approval, " +
                "eligibility and payment are decided by the competitions office.</span>" +
            "</label>" +
            '<div class="dashboard-card-actions">' +
                '<button type="button" class="btn btn-primary btn-sm" data-action="acknowledge">' +
                    (state.acknowledged ? "Acknowledged" : "Record acknowledgment") + "</button>" +
            "</div>" +
            '<p class="form-note" style="margin-top:12px">Status: ' +
                (state.acknowledged
                    ? "recorded by the competitions office."
                    : "not acknowledged yet.") + "</p>");
    }

    async function acknowledgeRules() {
        var checkbox = document.getElementById("ackCheckbox");
        var team = activeTeam();
        var category = team ? categoryFor(team) : null;
        var rule = category ? loadPublishedRules().filter(function (item) {
            return item.categoryId === category.id && String(item.state).toLowerCase() === "published";
        })[0] : null;

        if (!checkbox || !checkbox.checked) {
            U.toast("Tick the confirmation box before recording the acknowledgment.", "warning");
            return;
        }
        if (!team || !rule || !team.registrationId) {
            U.toast("A published rule and approved team registration are required.", "error");
            return;
        }
        try {
            await window.AngutsaPlatform.request("/manager/rules/" +
                encodeURIComponent(rule.id) + "/acknowledge", {
                    method: "POST",
                    body: { registrationId: team.registrationId }
                });
        } catch (error) {
            U.toast(error && error.message ? error.message : "We couldn't record your acknowledgment. Please try again.", "error");
            return;
        }
        PREVIEW.acknowledgments = (PREVIEW.acknowledgments || []).filter(function (item) {
            return item.registration_id !== team.registrationId || item.rules_id !== rule.id;
        });
        PREVIEW.acknowledgments.push({ registration_id: team.registrationId, rules_id: rule.id });
        renderRules();
        renderKpis();
        U.toast("Rules acknowledgment recorded.", "success");
    }

    function clearAcknowledgment() {
        U.toast("A recorded acknowledgment cannot be cleared here.", "info");
    }

    /* =========================================================
       Modals

       A single modal host in the page is reused for every dialog. Most content
       is informational; the match line-up dialog saves through the secure API.
       ========================================================= */

    function openAppModal(options) {
        var settings = options || {};
        var modal = document.getElementById("appModal");
        if (!modal) return null;

        setHtml("appModalTitle", U.escapeHtml(settings.title || "Details"));
        setHtml("appModalSubtitle", U.escapeHtml(settings.subtitle || ""));
        setHtml("appModalBody", settings.body || "");
        setHtml("appModalFooter", settings.footer || "");

        var dialog = document.getElementById("appModalDialog");
        if (dialog) dialog.classList.toggle("is-wide", !!settings.wide);

        U.openModal(modal);
        return modal;
    }

    function closeAppModal() {
        U.closeModal("#appModal");
    }

    function openManagedTeamModal() {
        var tournaments = (Data.tournaments || []).filter(function (tournament) {
            return tournament.status === "registration-open";
        });

        if (!tournaments.length) {
            openAppModal({
                title: "Create another team",
                subtitle: "Use your existing manager account",
                body: alertMarkup("warning", "No competitions are open for registration.",
                    "You can create a team when a competition opens."),
                footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                    '<a class="btn btn-primary" href="/tournaments/">Browse tournaments</a>'
            });
            return;
        }

        var tournamentOptions = '<option value="">Choose an open competition</option>' +
            tournaments.map(function (tournament) {
                return '<option value="' + U.escapeHtml(tournament.id) + '">' +
                    U.escapeHtml(tournament.name + " · " + tournament.season) + "</option>";
            }).join("");
        var modal = openAppModal({
            title: "Create another team",
            subtitle: "Your existing manager account will be reused.",
            wide: true,
            body:
                '<div class="notice-bar" role="note">' + U.icon("info") +
                    "<span>This team will be linked to <strong>" + U.escapeHtml(PREVIEW.manager.name) +
                    "</strong>. No additional manager account or password is needed.</span></div>" +
                '<form id="managedTeamForm" novalidate>' +
                    '<div id="managedTeamAlert" aria-live="polite"></div>' +
                    '<div class="form-field form-field-full">' +
                        '<div id="managedTeamTurnstile" aria-label="Security check"></div>' +
                    "</div>" +
                    '<div class="form-grid">' +
                        '<div class="form-field form-field-full">' +
                            '<label class="form-label" for="managedTeamName">Team name <span class="required">*</span></label>' +
                            '<input class="form-control" type="text" id="managedTeamName" name="managedTeamName" ' +
                                'autocomplete="organization" maxlength="70">' +
                            '<p class="form-error" role="alert"></p>' +
                        "</div>" +
                        '<div class="form-field form-field-full">' +
                            '<label class="form-label" for="managedTeamTournament">Open competition <span class="required">*</span></label>' +
                            '<select class="form-select" id="managedTeamTournament" name="managedTeamTournament">' +
                                tournamentOptions +
                            "</select>" +
                            '<p class="form-error" role="alert"></p>' +
                        "</div>" +
                        '<div class="form-field form-field-full">' +
                            '<div id="managedTeamCompetitionInfo" class="form-note" aria-live="polite">' +
                                "Choose a competition to see its category and entry fee." +
                            "</div>" +
                        "</div>" +
                        '<div class="form-field form-field-full">' +
                            '<label class="form-label" for="managedTeamLocation">Home area <span class="optional">(optional)</span></label>' +
                            '<input class="form-control" type="text" id="managedTeamLocation" name="managedTeamLocation" maxlength="100">' +
                            '<p class="form-error" role="alert"></p>' +
                        "</div>" +
                    "</div>" +
                "</form>",
            footer:
                '<button type="button" class="btn btn-dark-outline" data-modal-close>Cancel</button>' +
                '<button type="submit" class="btn btn-primary" form="managedTeamForm">Create team</button>'
        });

        if (!modal) return;

        var form = document.getElementById("managedTeamForm");
        var tournamentSelect = document.getElementById("managedTeamTournament");
        state.turnstile = window.AngutsaTurnstile.create(
            "#managedTeamTurnstile",
            "team-registration"
        );
        state.turnstile.catch(function (error) {
            setAlert(document.getElementById("managedTeamAlert"), "danger",
                "Security check unavailable.",
                error && error.message ? error.message : "Please try again later.");
        });
        if (form) U.on(form, "submit", submitManagedTeam);
        if (tournamentSelect) {
            U.on(tournamentSelect, "change", renderManagedTeamCompetitionInfo);
        }
        U.$$("#managedTeamForm .form-control, #managedTeamForm .form-select").forEach(function (control) {
            U.on(control, "input", function () { U.clearFieldError(control); });
            U.on(control, "change", function () { U.clearFieldError(control); });
        });
    }

    function renderManagedTeamCompetitionInfo() {
        var select = document.getElementById("managedTeamTournament");
        var info = document.getElementById("managedTeamCompetitionInfo");
        if (!select || !info) return;

        var tournament = U.tournamentById(select.value);
        var category = tournament ? U.categoryById(tournament.categoryId) : null;
        if (!tournament) {
            info.textContent = "Choose a competition to see its category and entry fee.";
            return;
        }

        var fee = category && category.entryFee !== undefined
            ? category.entryFee
            : tournament.entryFee;
        info.textContent = "Category: " + (category ? category.name : "Not configured") +
            " · Entry fee: " + (fee === undefined || fee === null
                ? "Not configured"
                : fee === 0 ? "No fee" : U.formatMoney(fee));
    }

    function managedTeamShortName(name) {
        var words = String(name).toUpperCase().match(/[A-Z0-9]+/g) || [];
        var base = words.length > 1
            ? words.map(function (word) { return word.charAt(0); }).join("").slice(0, 4)
            : (words[0] || "TEAM").slice(0, 4);
        var used = {};

        (Data.teams || []).forEach(function (team) {
            used[String(team.shortName || "").toUpperCase()] = true;
        });

        if (!used[base]) return base;

        var suffixGroups = [
            { max: 9, length: 1, baseLength: 3 },
            { max: 99, length: 2, baseLength: 2 },
            { max: 999, length: 3, baseLength: 1 }
        ];
        for (var groupIndex = 0; groupIndex < suffixGroups.length; groupIndex += 1) {
            var group = suffixGroups[groupIndex];
            for (var suffix = 1; suffix <= group.max; suffix += 1) {
                var code = base.slice(0, group.baseLength) + String(suffix);
                if (!used[code]) return code;
            }
        }

        throw new Error("A unique team short code could not be generated.");
    }

    async function submitManagedTeam(event) {
        event.preventDefault();

        var form = document.getElementById("managedTeamForm");
        var alertBox = document.getElementById("managedTeamAlert");
        var nameField = document.getElementById("managedTeamName");
        var tournamentField = document.getElementById("managedTeamTournament");
        var locationField = document.getElementById("managedTeamLocation");
        if (!form || !nameField || !tournamentField) return;

        U.clearFormErrors(form);
        setAlert(alertBox, "");

        var validation = U.validateForm(form, {
            managedTeamName: {
                required: true,
                minLength: 3,
                requiredMessage: "Enter the team name."
            },
            managedTeamTournament: {
                required: true,
                requiredMessage: "Choose an open competition."
            }
        });
        if (!validation.valid) {
            setAlert(alertBox, "danger", "Check the required fields.",
                "Enter a team name and choose an open competition.");
            return;
        }

        var name = nameField.value.trim().replace(/\s+/g, " ");
        var tournament = (Data.tournaments || []).filter(function (entry) {
            return entry.id === tournamentField.value && entry.status === "registration-open";
        })[0];
        var category = tournament ? U.categoryById(tournament.categoryId) : null;
        if (!tournament || !category) {
            U.showFieldError(tournamentField, "Choose an open competition with a category.");
            setAlert(alertBox, "danger", "Competition unavailable.",
                "Choose a competition that is still open for registration.");
            return;
        }

        var registrationSubmitted = false;
        try {
            var bytes = new Uint8Array(24);
            window.crypto.getRandomValues(bytes);
            var idempotencyKey = Array.from(bytes).map(function (value) {
                return value.toString(16).padStart(2, "0");
            }).join("");
            var turnstile = await state.turnstile;
            var created = await window.AngutsaPlatform.request("/team-registrations", {
                method: "POST",
                headers: { "Idempotency-Key": idempotencyKey },
                body: {
                    teamName: name,
                    tournamentId: tournament.id,
                    categoryId: category.id,
                    location: locationField ? locationField.value.trim() : "",
                    managerPublic: false,
                    logoKey: "",
                    turnstileToken: await turnstile.getToken()
                }
            });
            registrationSubmitted = true;
            await refreshManagerData();
            var newTeam = (Data.teams || []).filter(function (entry) {
                return entry.registrationId === created.id;
            })[0];
            if (!newTeam) throw new Error("The registration was created but could not be refreshed.");
            state.teamId = newTeam.id;
        } catch (error) {
            setAlert(alertBox, "danger",
                registrationSubmitted ? "Team registration received." : "Team could not be registered.",
                registrationSubmitted
                    ? "Your team was submitted, but we couldn't refresh the dashboard. Reload this page to check its status before submitting again."
                    : (error && error.message
                        ? error.message
                        : "We couldn't register your team. Check your connection and try again."));
            return;
        }
        state.teamsFilter.query = "";
        closeAppModal();
        renderTeamSwitcher();
        renderNavCounts();
        if (window.location.hash !== "#/teams") window.location.hash = "/teams";
        setView("teams");
        U.toast("Team registration submitted for review.", "success");
    }

    /* Pay registration fee: M-Pesa details, then a WhatsApp confirmation. */
    function openPaymentModal(teamId) {
        var team = teamsInScope().filter(function (entry) { return entry.id === teamId; })[0];
        if (!team) return;

        var payment = paymentState(team);

        openAppModal({
            title: "Pay registration fee",
            subtitle: team.name,
            body:
                (payment.outstanding
                    ? '<div class="fee-total" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px"><span>Amount due</span><strong>' +
                        U.formatMoney(payment.outstanding) + "</strong></div>"
                    : "") +
                U.paymentDetailsMarkup({ compact: true, title: "Step 1 \u00b7 Send via M-Pesa", note: false }) +
                '<div class="form-field" style="margin-top:16px">' +
                    '<label class="form-label" for="payConfirmTeam">Step 2 \u00b7 Team name</label>' +
                    '<input type="text" class="form-control" id="payConfirmTeam" value="' + U.escapeHtml(team.name) + '">' +
                "</div>" +
                '<div class="form-field" style="margin-top:12px">' +
                    '<label class="form-label" for="payConfirmMessage">Paste the M-Pesa confirmation message</label>' +
                    '<textarea class="form-textarea" id="payConfirmMessage" rows="4" ' +
                        'placeholder="e.g. UJ12ABC345 Confirmed. Ksh5,000 sent to KELVIN MAGORO 0707119367..."></textarea>' +
                "</div>" +
                '<p class="form-error" id="payConfirmError" role="alert" hidden></p>',
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                '<button type="button" class="btn btn-primary" data-pay-confirm="' +
                    U.escapeHtml(team.id) + '">Share confirmation on WhatsApp</button>'
        });
    }

    function sendPaymentConfirmation(teamId) {
        var pay = ((window.AngutsaData && window.AngutsaData.meta) || {}).payment || {};
        var teamField = document.getElementById("payConfirmTeam");
        var messageField = document.getElementById("payConfirmMessage");
        var error = document.getElementById("payConfirmError");
        var teamLabel = teamField ? teamField.value.trim() : "";
        var message = messageField ? messageField.value.trim() : "";

        if (!teamLabel || !message) {
            if (error) {
                error.textContent = "Enter your team name and paste the M-Pesa message first.";
                error.hidden = false;
                error.style.display = "block";
            }
            return;
        }

        var team = teamsInScope().filter(function (entry) { return entry.id === teamId; })[0];
        var lines = [
            "Hello Angutsa Football Championship,",
            "",
            "Registration fee payment confirmation.",
            "Team: " + teamLabel
        ];
        if (team) lines.push("Reference: " + team.id);
        lines.push("", "M-Pesa message:", message);

        window.open("https://wa.me/" + (pay.whatsapp || "254707119367") +
            "?text=" + encodeURIComponent(lines.join("\n")), "_blank", "noopener");
    }

    function findPlayer(playerId) {
        var team = activeTeam();
        if (!team) return null;

        return squadFor(team.id).filter(function (player) {
            return player.id === playerId;
        })[0] || null;
    }

    /* -------------------------
       Player records
       ------------------------- */

    function playerFormMarkup(player, team) {
        var category = categoryFor(team);
        var youth = isYouthCategory(category);
        var value = player || {};
        var publicProfile = value.publicProfile || "hidden";

        return '<form id="playerForm" novalidate>' +
            '<div id="playerFormAlert"></div>' +
            '<div class="form-grid">' +
                '<div class="form-field form-field-full">' +
                    '<label class="form-label" for="playerName">Player full name ' +
                        '<span class="required">*</span></label>' +
                    '<input class="form-control" type="text" id="playerName" value="' +
                        U.escapeHtml(value.name || "") + '">' +
                    '<p class="form-error" role="alert"></p>' +
                "</div>" +
                '<div class="form-field">' +
                    '<label class="form-label" for="playerPosition">Position ' +
                        '<span class="required">*</span></label>' +
                    '<select class="form-select" id="playerPosition">' +
                        ["Goalkeeper", "Defender", "Midfielder", "Forward"].map(function (position) {
                            return '<option value="' + position + '"' +
                                (value.position === position ? " selected" : "") + ">" + position +
                                "</option>";
                        }).join("") +
                    "</select>" +
                "</div>" +
                '<div class="form-field">' +
                    '<label class="form-label" for="playerShirt">Shirt number ' +
                        '<span class="required">*</span></label>' +
                    '<input class="form-control" type="number" id="playerShirt" min="1" max="99" value="' +
                        U.escapeHtml(value.shirtNumber ? String(value.shirtNumber) : "") + '">' +
                    '<p class="form-error" role="alert"></p>' +
                "</div>" +
                '<div class="form-field">' +
                    '<label class="form-label" for="playerYear">Year of birth ' +
                        '<span class="required">*</span></label>' +
                    '<input class="form-control" type="number" id="playerYear" min="1990" max="2030" value="' +
                        U.escapeHtml(value.yearOfBirth ? String(value.yearOfBirth) : "") + '">' +
                    '<p class="form-error" role="alert"></p>' +
                    '<p class="form-hint">Used for age eligibility (' +
                        U.escapeHtml(ageRangeLabel(category)) + " years).</p>" +
                "</div>" +
                '<div class="form-field form-field-full">' +
                    '<label class="form-label" for="playerPublicProfile">Public profile</label>' +
                    '<select class="form-select" id="playerPublicProfile">' +
                        (youth
                            ? '<option value="hidden"' + (publicProfile === "hidden" ? " selected" : "") +
                                '>Hidden</option><option value="limited"' +
                                (publicProfile === "limited" ? " selected" : "") +
                                '>Initials only</option>'
                            : '<option value="hidden"' + (publicProfile === "hidden" ? " selected" : "") +
                                '>Hidden</option><option value="limited"' +
                                (publicProfile === "limited" ? " selected" : "") +
                                '>Initials only</option><option value="full"' +
                                (publicProfile === "full" ? " selected" : "") +
                                '>Full name</option>') +
                    "</select>" +
                    '<p class="form-hint">' +
                        (youth
                            ? "Youth profiles can show initials only after required guardian consent is recorded. Children's categories remain private."
                            : "Choose Full name only when the player has agreed to public display. Hidden is the default.") +
                    "</p>" +
                "</div>" +
                (youth
                    ? '<div class="form-field form-field-full">' +
                        '<label class="check"><input type="checkbox" id="playerConsent"' +
                            (value.guardianConsent === "on-file" ? " checked" : "") + ">" +
                        "<span>Guardian consent has been recorded for this player " +
                        "<strong>Required before a youth player can participate.</strong></span></label>" +
                        "</div>"
                    : '<div class="form-field form-field-full">' +
                        '<label class="check"><input type="checkbox" id="playerPublicProfileConsent">' +
                        "<span>The player has agreed to display their full name publicly.</span></label></div>") +
            "</div>" +
            '<p class="form-note">Changes are saved to the live roster through the backend.</p>' +
        "</form>";
    }

    function openPlayerModal(playerId) {
        var team = activeTeam();

        if (!team) {
            U.toast("Create a team before adding players.", "warning");
            return;
        }

        var access = playerRegistrationPermission(team);
        if (!access.allowed) {
            U.toast(access.error
                ? "Player registration is locked because the permission could not be verified."
                : "Player registration opens after the team is approved.",
            "warning");
            return;
        }
        if (!access.rosterChangesAllowed) {
            U.toast(rosterChangeLockMessage(access), "warning");
            return;
        }

        var player = playerId ? findPlayer(playerId) : null;
        var category = categoryFor(team);

        openAppModal({
            title: player ? "Edit player" : "Add a player",
            subtitle: team.name + " \u00b7 " + (category ? category.name : "Category"),
            body: playerFormMarkup(player, team),
            wide: true,
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="save-player" data-player-id="' +
                    U.escapeHtml(playerId || "") + '">' +
                    (player ? "Save changes" : "Add player") + "</button>"
        });
    }

    async function handleSavePlayer(playerId) {
        var team = activeTeam();
        var form = document.getElementById("playerForm");
        if (!team || !form) return;

        var access = playerRegistrationPermission(team);
        if (!access.allowed) {
            U.toast(access.error
                ? "Player registration is locked because the permission could not be verified."
                : "Player registration opens after the team is approved.",
            "warning");
            closeAppModal();
            renderSquad();
            return;
        }
        if (!access.rosterChangesAllowed) {
            U.toast(rosterChangeLockMessage(access), "warning");
            closeAppModal();
            renderSquad();
            return;
        }

        var category = categoryFor(team);
        var youth = isYouthCategory(category);
        var alertBox = document.getElementById("playerFormAlert");
        var shirtField = document.getElementById("playerShirt");
        var yearField = document.getElementById("playerYear");

        U.clearFormErrors(form);
        setAlert(alertBox, "");

        var result = U.validateForm(form, {
            playerName: {
                required: true, minLength: 3,
                requiredMessage: "Enter the player's full name."
            },
            playerShirt: { required: true, requiredMessage: "Enter a shirt number." },
            playerYear: { required: true, requiredMessage: "Enter the year of birth." }
        });

        if (!result.valid) {
            setAlert(alertBox, "danger", "Check the highlighted fields.",
                "A player record needs a name, position, shirt number and year of birth.");
            return;
        }

        var shirt = parseInt(shirtField.value, 10);

        if (shirt < 1 || shirt > 99) {
            U.showFieldError(shirtField, "Use a shirt number between 1 and 99.");
            return;
        }

        var duplicate = squadFor(team.id).filter(function (player) {
            return player.shirtNumber === shirt && player.id !== playerId;
        })[0];

        if (duplicate) {
            U.showFieldError(shirtField, "Shirt number " + shirt + " is already used in this squad.");
            return;
        }

        var year = parseInt(yearField.value, 10);
        var ageNote = "";

        if (category && category.ageMax) {
            var currentYear = window.AngutsaEAT
                ? window.AngutsaEAT.currentYear()
                : new Date().getFullYear();
            var age = currentYear - year;
            if (age > category.ageMax) {
                ageNote = " This player appears older than the category limit (" + ageRangeLabel(category) +
                    "); the competitions office decides eligibility.";
            }
        }

        var consentBox = document.getElementById("playerConsent");
        var publicProfileField = document.getElementById("playerPublicProfile");
        var publicProfileConsent = document.getElementById("playerPublicProfileConsent");
        if (publicProfileField.value === "full" &&
            (!publicProfileConsent || !publicProfileConsent.checked)) {
            setAlert(alertBox, "danger", "Player agreement required.",
                "Confirm the player has agreed before selecting Full name.");
            return;
        }
        var record = {
            name: document.getElementById("playerName").value.trim(),
            position: document.getElementById("playerPosition").value,
            shirtNumber: shirt,
            yearOfBirth: year,
            guardianConsent: youth ? (consentBox && consentBox.checked ? "on-file" : "pending") : null
        };

        var playerSaved = false;
        try {
            var body = {
                name: record.name,
                yearOfBirth: record.yearOfBirth,
                position: record.position,
                shirtNumber: record.shirtNumber,
                publicProfile: publicProfileField.value,
                publicProfileConsent: Boolean(publicProfileConsent && publicProfileConsent.checked)
            };
            if (playerId) {
                await window.AngutsaPlatform.request("/manager/players/" +
                    encodeURIComponent(playerId), { method: "PATCH", body: body });
            } else {
                await window.AngutsaPlatform.request("/manager/registrations/" +
                    encodeURIComponent(team.registrationId) + "/players", {
                        method: "POST",
                        body: body
                    });
            }
            playerSaved = true;
            await refreshManagerData();
        } catch (error) {
            setAlert(alertBox, "danger",
                playerSaved ? "Player details were saved." : "Player could not be saved.",
                playerSaved
                    ? "We couldn't refresh the dashboard. Reload the page to check that the player details are up to date."
                    : (error && error.message
                        ? error.message
                        : "We couldn't save the player details. Please try again."));
            return;
        }

        closeAppModal();
        renderSquad();
        renderOverview();

        U.toast((playerId ? "Player updated."
            : "Player added to the roster.") + ageNote, "success");
    }

    function openPlayerView(playerId) {
        var team = activeTeam();
        var player = findPlayer(playerId);
        if (!team || !player) return;
        if (!playerRegistrationPermission(team).allowed) {
            U.toast("Your team must be approved before you can view player details.",
                "warning");
            return;
        }

        var youth = isYouthCategory(categoryFor(team));

        function row(label, value) {
            return "<li><span>" + U.escapeHtml(label) + "</span><span>" +
                U.escapeHtml(value) + "</span></li>";
        }

        openAppModal({
            title: U.publicPlayerName(player),
            subtitle: team.name,
            body: '<ul class="meta-list is-compact">' +
                row("Position", player.position || "Not provided") +
                row("Shirt number", player.shirtNumber ? "#" + player.shirtNumber : "-") +
                row("Classification", player.classification || "-") +
                row("Roster status", "Registered") +
                row("Guardian consent", youth
                    ? (player.guardianConsent === "on-file" ? "Recorded" : "Outstanding")
                    : "Not required for this category") +
                row("Public profile", player.publicProfile === "full" ? "Full name shown"
                    : player.publicProfile === "limited" ? "Initials shown"
                        : "Hidden from public pages") +
            "</ul>" +
            '<p class="form-note" style="margin-top:14px">Contact details and identity documents are not ' +
                "shown on this dashboard at all; they are held by the competitions office.</p>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                '<button type="button" class="btn btn-secondary" data-player-profile="' +
                    U.escapeHtml(player.id) + '">Update public profile</button>' +
                (playerRegistrationPermission(team).rosterChangesAllowed
                    ? '<button type="button" class="btn btn-primary" data-player-edit="' +
                        U.escapeHtml(player.id) + '">Edit record</button>'
                    : "")
        });
    }

    function openPlayerProfileModal(playerId) {
        var team = activeTeam();
        var player = findPlayer(playerId);
        if (!team || !player || !playerRegistrationPermission(team).allowed) return;

        var youth = isYouthCategory(categoryFor(team));
        var profile = player.publicProfile || "hidden";
        closeAppModal();
        openAppModal({
            title: "Public player profile",
            subtitle: U.publicPlayerName(player) + " \u00b7 " + team.name,
            body: '<div class="form-field">' +
                '<label class="form-label" for="playerPublicProfileOnly">Public profile</label>' +
                '<select class="form-select" id="playerPublicProfileOnly">' +
                    '<option value="hidden"' + (profile === "hidden" ? " selected" : "") +
                        '>Hidden</option>' +
                    '<option value="limited"' + (profile === "limited" ? " selected" : "") +
                        '>Initials only</option>' +
                    (youth ? "" : '<option value="full"' + (profile === "full" ? " selected" : "") +
                        '>Full name</option>') +
                "</select>" +
                '<p class="form-hint">' +
                    (youth
                        ? "Youth profiles can show initials only after required guardian consent is recorded. Children's categories remain private."
                        : "Full name is shown only with the player's agreement. Hidden is the default.") +
                "</p>" +
                (youth ? "" : '<label class="check"><input type="checkbox" id="playerPublicProfileConsent">' +
                    "<span>The player has agreed to display their full name publicly.</span></label>") +
                "</div>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="save-player-profile" ' +
                    'data-player-id="' + U.escapeHtml(player.id) + '">Save profile</button>'
        });
    }

    async function savePlayerPublicProfile(playerId) {
        var team = activeTeam();
        var field = document.getElementById("playerPublicProfileOnly");
        var consent = document.getElementById("playerPublicProfileConsent");
        if (!team || !field || !findPlayer(playerId)) return;
        if (field.value === "full" && (!consent || !consent.checked)) {
            U.toast("Confirm the player has agreed before selecting Full name.", "warning");
            return;
        }

        try {
            await window.AngutsaPlatform.request("/manager/players/" +
                encodeURIComponent(playerId) + "/public-profile", {
                method: "PATCH",
                body: {
                    publicProfile: field.value,
                    publicProfileConsent: Boolean(consent && consent.checked)
                }
            });
            await refreshManagerData();
        } catch (error) {
            U.toast(error && error.message
                ? error.message
                : "We couldn't update the public profile. Please try again.", "error");
            return;
        }

        closeAppModal();
        renderSquad();
        renderOverview();
        U.toast("Public player profile updated.", "success");
    }

    function removePlayer(playerId) {
        var team = activeTeam();
        var player = findPlayer(playerId);
        if (!team || !player) return;
        var access = playerRegistrationPermission(team);
        if (!access.allowed) {
            U.toast(access.error
                ? "Player registration is locked because the permission could not be verified."
                : "Player registration opens after the team is approved.",
            "warning");
            return;
        }
        if (!access.rosterChangesAllowed) {
            U.toast(rosterChangeLockMessage(access), "warning");
            return;
        }

        U.confirmDialog({
            title: "Remove this player from the squad?",
            message: "Removing " + U.publicPlayerName(player) + " from " + team.name +
                " is a destructive action and needs confirmation.",
            details: "This removes the player record from the registered squad.",
            confirmLabel: "Remove player",
            danger: true
        }).then(function (confirmed) {
            if (!confirmed) return;

            var latestAccess = playerRegistrationPermission(team);
            if (!latestAccess.allowed || !latestAccess.rosterChangesAllowed) {
                U.toast("Player registration permission changed. The player record was not removed.", "warning");
                renderSquad();
                renderOverview();
                return;
            }

            window.AngutsaPlatform.request("/manager/players/" +
                encodeURIComponent(playerId), { method: "DELETE" })
                .then(refreshManagerData)
                .then(function () {
                    renderSquad();
                    renderOverview();
                    U.toast("Player removed from the squad.", "success");
                })
                .catch(function (error) {
                    U.toast(error && error.message ? error.message : "We couldn't remove the player. Please try again.", "error");
                });
        });
    }

    /* -------------------------
       Registration, match, receipt and team dialogs
       ------------------------- */

    function openRegistrationModal(teamId) {
        var team = U.teamById(teamId);
        if (!team) return;

        var tournament = tournamentFor(team);
        var category = categoryFor(team);
        var registration = registrationFor(team);
        var payment = paymentState(team);
        var squad = squadFor(team.id);

        function row(label, value) {
            return "<li><span>" + U.escapeHtml(label) + "</span><span>" +
                U.escapeHtml(value) + "</span></li>";
        }

        openAppModal({
            title: "Registration submission",
            subtitle: team.name + " \u00b7 " + (tournament ? tournament.name : "No competition"),
            wide: true,
            body:
                '<div class="status-line">' + U.statusBadge(team.status, registrationStatusLabel(team)) +
                    paymentBadge(payment.status) + "</div>" +
                '<ul class="meta-list is-compact" style="margin-top:12px">' +
                    row("Reference", registration && registration.reference ? registration.reference : "-") +
                    row("Submitted", registration && registration.submittedOn
                        ? U.formatDateTime(registration.submittedOn) : "Not submitted") +
                    row("Category", category ? category.name : "-") +
                    row("Registration deadline", tournament && tournament.registrationCloses
                        ? U.formatDate(tournament.registrationCloses) : "No deadline configured") +
                    row("Players on file", String(squad.length)) +
                    row("Entry fee", payment.fee === null ? "Not configured" : U.formatMoney(payment.fee)) +
                    row("Payment status", PAYMENT_LABELS[payment.status]) +
                "</ul>" +
                (registration ? checklistMarkup(registration.checklist) : "") +
                '<div class="notice-bar" role="note" style="margin-top:14px">' + U.icon("info") +
                    "<span><strong>Review only.</strong> This is the team submission on file. Corrections are " +
                    "submitted through the registration form, and the competitions office decides team " +
                    "registration approval. Player roster records are not approved individually.</span></div>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                '<a class="btn btn-primary" href="/team-registration/?tournament=' +
                    U.escapeHtml(tournament ? tournament.id : "") + '">Correct registration</a>'
        });
    }

    function openMatchModal(matchId) {
        var match = U.matchById(matchId);
        if (!match) return;

        var team = activeTeam();
        var teamId = team ? team.id : "";
        var tournament = U.tournamentById(match.tournamentId);
        var category = U.categoryById(match.categoryId);
        var isResult = match.status === "completed";

        function row(label, value) {
            return "<li><span>" + U.escapeHtml(label) + "</span><span>" +
                U.escapeHtml(value) + "</span></li>";
        }

        function side(teamRecord, fallback, id) {
            var mine = id === teamId;
            return '<div class="scoreboard-team' + (mine ? " is-mine" : "") + '">' +
                U.crestMarkup(teamRecord || { name: fallback }, "lg") +
                '<span class="match-team-name">' + U.escapeHtml(U.teamName(id)) + "</span>" +
                (mine ? '<small>Your team</small>' : "") +
            "</div>";
        }

        openAppModal({
            title: isResult ? "Match result" : "Match details",
            subtitle: (tournament ? tournament.name : "Competition") + " \u00b7 " +
                (match.round || match.stage || "Fixture"),
            body:
                '<div class="scoreboard">' +
                    side(U.teamById(match.homeTeamId), "Home", match.homeTeamId) +
                    matchScoreBlock(match) +
                    side(U.teamById(match.awayTeamId), "Away", match.awayTeamId) +
                "</div>" +
                '<ul class="meta-list is-compact">' +
                    row("Status", U.matchStatusLabel(match.status)) +
                    row("Kickoff", U.formatDateTime(match.kickoff)) +
                    row("Venue", match.venue || "Venue to be confirmed") +
                    row("Category", category ? category.name : "-") +
                    row("Stage", (match.stage || "-") + (match.group ? " \u00b7 " + match.group : "")) +
                "</ul>" +
                '<p class="form-note" style="margin-top:14px">' +
                    (isResult
                        ? "Final scores are confirmed by the competitions office."
                        : "Kickoff times can change. The competitions office will announce any update.") +
                "</p>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                '<button type="button" class="btn btn-primary" data-match-share="' +
                    U.escapeHtml(match.id) + '">Share image</button>'
        });
    }

    function openReceiptModal(paymentId) {
        var payment = (Data.payments || []).filter(function (entry) {
            return entry.id === paymentId;
        })[0];

        if (!payment) return;

        var team = U.teamById(payment.teamId);
        var tournament = U.tournamentById(payment.tournamentId);

        function row(label, value) {
            return "<li><span>" + U.escapeHtml(label) + "</span><span>" +
                U.escapeHtml(value) + "</span></li>";
        }

        var hasReceipt = !!payment.receipt;

        openAppModal({
            title: hasReceipt ? "Receipt" : "Receipt status",
            subtitle: payment.reference,
            body:
                '<div class="status-line">' + U.statusBadge(payment.status,
                    payment.status === "successful" ? "Successful" : payment.status) +
                    (payment.reconciled === false
                        ? '<span class="badge badge-gold">Awaiting reconciliation</span>' : "") +
                "</div>" +
                '<ul class="meta-list is-compact" style="margin-top:12px">' +
                    row("Team", team ? team.name : payment.teamId) +
                    row("Competition", tournament ? tournament.name : payment.tournamentId) +
                    row("Amount", U.formatMoney(payment.amount, payment.currency)) +
                    row("Method", payment.method) +
                    row("Recorded on", U.formatDateTime(payment.recordedAt)) +
                    row("Recorded by", payment.recordedBy || "Finance office") +
                    row("Reference", payment.reference) +
                "</ul>" +
                '<div class="notice-bar" role="note" style="margin-top:14px">' + U.icon("info") +
                    "<span><strong>" + (hasReceipt ? "Receipt on file." : "No receipt has been issued by this system.") +
                    "</strong> " + (hasReceipt
                        ? "The receipt was issued by the finance office and can be downloaded from the backend once file storage is connected."
                        : "Receipts are issued by the finance office. This interface records payment state only and cannot generate or download a receipt.") +
                    "</span></div>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                (hasReceipt
                    ? '<button type="button" class="btn btn-primary" disabled ' +
                        'title="Receipt downloads need the backend file storage">Download</button>'
                    : '<a class="btn btn-primary" href="/contact/">Contact the finance office</a>')
        });
    }

    function openTeamModal(teamId) {
        var team = U.teamById(teamId);
        if (!team) return;

        var category = categoryFor(team);
        var tournament = tournamentFor(team);
        var squad = (Data.players || []).filter(function (player) {
            return player.teamId === teamId;
        });
        var inScope = teamsInScope().some(function (entry) { return entry.id === teamId; });

        function row(label, value) {
            return "<li><span>" + U.escapeHtml(label) + "</span><span>" +
                U.escapeHtml(value) + "</span></li>";
        }

        openAppModal({
            title: team.name,
            subtitle: category ? category.name : "Category not configured",
            body:
                '<div class="status-line">' + U.statusBadge(team.status, registrationStatusLabel(team)) +
                    (inScope ? '<span class="badge badge-purple">In your scope</span>'
                        : '<span class="badge">Other team</span>') + "</div>" +
                '<ul class="meta-list is-compact" style="margin-top:12px">' +
                    row("Short code", team.shortName) +
                    row("Home area", team.location || "-") +
                    row("Competition", tournament ? tournament.name : "Not entered") +
                    row("Group", team.group || "Not assigned") +
                    row("Players on file", String(squad.length)) +
                    row("Registered on", team.registeredOn ? U.formatDate(team.registeredOn) : "-") +
                "</ul>" +
                '<p class="form-note" style="margin-top:14px">' +
                    (inScope
                        ? "This team is in the preview scope, so its squad and payments can be managed here."
                        : "This team belongs to another manager. Dashboard actions are limited to your own teams.") +
                "</p>",
            footer: '<button type="button" class="btn btn-dark-outline" data-modal-close>Close</button>' +
                '<a class="btn btn-primary" href="/team-details/?team=' +
                    encodeURIComponent(team.id) + '">Open team profile</a>'
        });
    }

    /* =========================================================
       Wiring and start-up
       ========================================================= */

    function collectElements() {
        els.shell = document.getElementById("appShell");
        els.sidebar = document.getElementById("appSidebar");
        els.scrim = document.getElementById("appScrim");
        els.menuButton = document.getElementById("menuButton");
        els.sidebarToggle = document.getElementById("sidebarToggle");
        els.sidebarClose = document.getElementById("sidebarClose");
        els.main = document.getElementById("main");
        els.appTitle = document.getElementById("appTitle");
        els.appCrumb = document.getElementById("appCrumb");
        els.teamSwitcher = document.getElementById("teamSwitcher");
        els.bellButton = document.getElementById("bellButton");
        els.profileButton = document.getElementById("profileButton");
        els.markAllRead = document.getElementById("menuMarkAllRead");
        els.markAllReadView = document.getElementById("markAllReadButton");
        els.matchFilter = document.getElementById("matchFilter");
        els.notificationFilter = document.getElementById("notificationFilter");
        els.teamSearch = document.getElementById("teamSearch");
        els.addPlayerButton = document.getElementById("addPlayerButton");
        els.squadIssuesButton = document.getElementById("squadIssuesButton");
        els.paymentHistoryButton = document.getElementById("paymentHistoryButton");
        els.profileForm = document.getElementById("profileForm");
    }

    function bindShell() {
        if (els.menuButton) U.on(els.menuButton, "click", openDrawer);
        if (els.sidebarClose) U.on(els.sidebarClose, "click", closeDrawer);
        if (els.scrim) U.on(els.scrim, "click", closeDrawer);
        if (els.sidebarToggle) U.on(els.sidebarToggle, "click", toggleRail);

        /* Collapsible sidebar groups, matching the administration console. */
        U.$$("[data-nav-group]").forEach(function (toggle) {
            U.on(toggle, "click", function () {
                var body = document.getElementById(toggle.getAttribute("aria-controls"));
                var expanded = toggle.getAttribute("aria-expanded") === "true";

                toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
                if (body) body.hidden = expanded;
            });
        });

        function toggleFromButton(button) {
            return function (event) {
                event.stopPropagation();
                toggleMenu(button);
            };
        }

        if (els.bellButton) U.on(els.bellButton, "click", toggleFromButton(els.bellButton));
        if (els.profileButton) U.on(els.profileButton, "click", toggleFromButton(els.profileButton));

        if (els.markAllRead) {
            U.on(els.markAllRead, "click", function (event) {
                event.stopPropagation();
                markAllRead();
            });
        }

        if (els.markAllReadView) U.on(els.markAllReadView, "click", markAllRead);

        /* Any click outside an open menu closes the menus. */
        U.on(document, "click", function (event) {
            if (!closestMatch(event.target, ".app-menu")) closeAllMenus();
        });

        U.on(document, "keydown", function (event) {
            if (event.key !== "Escape") return;

            var wasDrawerOpen = document.body.classList.contains("drawer-open");
            closeAllMenus();
            closeDrawer();

            if (wasDrawerOpen && els.menuButton) els.menuButton.focus();
        });

        if (els.teamSwitcher) {
            U.on(els.teamSwitcher, "change", function () {
                state.teamId = els.teamSwitcher.value;
                renderView(state.view);
                U.toast("Active team switched to " + U.teamName(state.teamId) + ".", "info");
            });
        }

        U.on(document, "click", handleDelegatedClick);

        /* Keyboard activation for the step-style nav links and cards. */
        U.on(document, "keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") return;

            var node = closestMatch(event.target, "[data-open-view],[data-add-player]");
            if (node && node.tagName === "BUTTON") {
                handleDelegatedClick({ target: node });
            }
        });
    }

    /* =========================================================
       Shell interactions
       ========================================================= */

    function closeAllMenus() {
        U.$$(".app-menu").forEach(function (menu) {
            var button = menu.querySelector("[aria-expanded]");
            var panel = menu.querySelector(".app-menu-panel");

            if (button) button.setAttribute("aria-expanded", "false");
            if (panel) panel.hidden = true;
        });
    }

    function toggleMenu(button) {
        var menu = button.parentNode;

        while (menu && menu !== document.body &&
            !(menu.classList && menu.classList.contains("app-menu"))) {
            menu = menu.parentNode;
        }

        var panel = menu ? menu.querySelector(".app-menu-panel") : null;
        if (!panel) return;

        var wasOpen = !panel.hidden;
        closeAllMenus();

        if (!wasOpen) {
            panel.hidden = false;
            button.setAttribute("aria-expanded", "true");
        }
    }

    function openDrawer() {
        document.body.classList.add("drawer-open");
        if (els.scrim) els.scrim.hidden = false;
        if (els.menuButton) els.menuButton.setAttribute("aria-expanded", "true");
        if (els.sidebarClose) els.sidebarClose.focus();
    }

    function closeDrawer() {
        if (!document.body.classList.contains("drawer-open")) return;

        document.body.classList.remove("drawer-open");
        if (els.scrim) els.scrim.hidden = true;
        if (els.menuButton) els.menuButton.setAttribute("aria-expanded", "false");
    }

    /* The collapsed rail is a desktop presentation preference only. */
    function applyRailPreference(collapsed) {
        document.body.classList.toggle("is-rail", !!collapsed);

        if (els.sidebarToggle) {
            els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
            els.sidebarToggle.setAttribute("aria-label",
                collapsed ? "Expand navigation" : "Collapse navigation");
        }
    }

    function toggleRail() {
        var collapsed = !document.body.classList.contains("is-rail");
        applyRailPreference(collapsed);
        U.setPref(STORAGE.sidebar, collapsed ? "rail" : "full");
    }

    /* -------------------------
       Delegated dashboard actions
       ------------------------- */

    var ACTION_SELECTOR = "[data-view-link],[data-open-view],[data-open-team],[data-player-view],[data-player-profile]," +
        "[data-player-edit],[data-player-remove],[data-add-player],[data-registration-view],[data-receipt]," +
        "[data-match],[data-lineup],[data-manage-squad],[data-pay-open],[data-pay-confirm],[data-activate-team],[data-action],[data-notification],[data-read]," +
        "[data-open]";

    function closestMatch(node, selector) {
        while (node && node !== document) {
            if (node.matches && node.matches(selector)) return node;
            node = node.parentNode;
        }
        return null;
    }

    function attributeValue(node, name) {
        return node.getAttribute ? node.getAttribute(name) : null;
    }

    function handleDelegatedClick(event) {
        var node = closestMatch(event.target, ACTION_SELECTOR);
        if (!node) return;

        var linkView = attributeValue(node, "data-view-link");

        if (linkView === "signout") {
            closeAllMenus();
            confirmSignOut();
            return;
        }

        if (linkView) {
            closeAllMenus();
            setView(linkView);
            return;
        }

        var openView = attributeValue(node, "data-open-view");

        if (openView) {
            closeAllMenus();
            setView(openView);
            return;
        }

        if (node.hasAttribute("data-pay-open")) {
            openPaymentModal(attributeValue(node, "data-pay-open"));
            return;
        }

        if (node.hasAttribute("data-pay-confirm")) {
            sendPaymentConfirmation(attributeValue(node, "data-pay-confirm"));
            return;
        }

        if (node.hasAttribute("data-activate-team")) {
            state.teamId = attributeValue(node, "data-activate-team");
            renderTeamSwitcher();
            renderView(state.view);
            U.toast("Active team switched to " + U.teamName(state.teamId) + ".", "info");
            return;
        }

        if (node.hasAttribute("data-manage-squad")) {
            state.teamId = attributeValue(node, "data-manage-squad");
            renderTeamSwitcher();
            closeAllMenus();
            setView("squad");
            U.toast("Managing the squad for " + U.teamName(state.teamId) + ".", "info");
            return;
        }

        if (node.hasAttribute("data-add-player")) {
            openPlayerModal(null);
            return;
        }

        if (node.hasAttribute("data-player-view")) {
            openPlayerView(attributeValue(node, "data-player-view"));
            return;
        }

        if (node.hasAttribute("data-player-profile")) {
            openPlayerProfileModal(attributeValue(node, "data-player-profile"));
            return;
        }

        if (node.hasAttribute("data-player-edit")) {
            closeAppModal();
            openPlayerModal(attributeValue(node, "data-player-edit"));
            return;
        }

        if (node.hasAttribute("data-player-remove")) {
            removePlayer(attributeValue(node, "data-player-remove"));
            return;
        }

        if (node.hasAttribute("data-registration-view")) {
            openRegistrationModal(attributeValue(node, "data-registration-view"));
            return;
        }

        if (node.hasAttribute("data-receipt")) {
            openReceiptModal(attributeValue(node, "data-receipt"));
            return;
        }

        if (node.hasAttribute("data-match")) {
            openMatchModal(attributeValue(node, "data-match"));
            return;
        }

        if (node.hasAttribute("data-lineup")) {
            openLineupModal(attributeValue(node, "data-lineup"));
            return;
        }

        if (attributeValue(node, "data-action") === "save-match-lineup") {
            saveMatchLineup(
                attributeValue(node, "data-id"),
                attributeValue(node, "data-team-id"),
                node
            );
            return;
        }

        if (node.hasAttribute("data-open-team")) {
            openTeamModal(attributeValue(node, "data-open-team"));
            return;
        }

        var action = attributeValue(node, "data-action");

        if (action === "create-team") {
            closeAllMenus();
            openManagedTeamModal();
            return;
        }

        if (action === "signout") {
            closeAllMenus();
            confirmSignOut();
            return;
        }

        if (action === "acknowledge") {
            acknowledgeRules();
            return;
        }

        if (action === "clear-acknowledgment") {
            clearAcknowledgment();
            return;
        }

        if (action === "mark-all-read") {
            markAllRead();
            return;
        }

        if (action === "save-player") {
            handleSavePlayer(attributeValue(node, "data-player-id"));
            return;
        }

        if (action === "save-player-profile") {
            savePlayerPublicProfile(attributeValue(node, "data-player-id"));
        }
    }

    function confirmSignOut() {
        U.confirmDialog({
            title: "Sign out?",
            message: "You will be signed out of your Team Manager account.",
            confirmLabel: "Sign out"
        }).then(function (confirmed) {
            if (!confirmed) return;
            window.AngutsaPlatform.logout().then(function () {
                window.location.replace("/login/");
            }).catch(function (error) {
                U.toast(error && error.message ? error.message : "We couldn't sign you out. Please try again.", "error");
            });
        });
    }

    function bindFilters() {
        U.on(window, "storage", function (event) {
            if (event.key === STORAGE.playerRegistrationPermissions ||
                event.key === STORAGE.playerRosterChangePermissions) {
                renderView(state.view);
            }
        });

        if (els.teamSearch) {
            U.on(els.teamSearch, "input", U.debounce(function () {
                state.teamsFilter.query = els.teamSearch.value;
                renderTeams();
            }, 180));
        }

        if (els.addPlayerButton) {
            U.on(els.addPlayerButton, "click", function () { openPlayerModal(null); });
        }

        if (els.squadIssuesButton) {
            U.on(els.squadIssuesButton, "click", function () {
                state.squadIssuesOnly = !state.squadIssuesOnly;
                els.squadIssuesButton.textContent = state.squadIssuesOnly
                    ? "Show all players"
                    : "Show incomplete records";
                renderSquad();
            });
        }

        if (els.paymentHistoryButton) {
            U.on(els.paymentHistoryButton, "click", function () {
                var panel = document.getElementById("paymentHistoryPanel");
                if (panel && panel.scrollIntoView) {
                    panel.scrollIntoView({ behavior: "smooth", block: "start" });
                }
                var team = activeTeam();
                var count = team ? paymentsFor(team.id).length : 0;
                U.toast(count
                    ? count + " recorded payment" + (count === 1 ? "" : "s") + " for " +
                        U.teamName(team.id) + "."
                    : "No recorded payments for this team yet.", "info");
            });
        }

        if (els.matchFilter) {
            U.$$("[data-match-filter]", els.matchFilter).forEach(function (chip) {
                U.on(chip, "click", function () {
                    state.matchFilter = chip.getAttribute("data-match-filter");
                    renderFixtures();
                });
            });
        }

        if (els.notificationFilter) {
            U.$$("[data-notif-filter]", els.notificationFilter).forEach(function (chip) {
                U.on(chip, "click", function () {
                    state.notificationFilter = chip.getAttribute("data-notif-filter");
                    renderNotificationsView();
                });
            });
        }

        if (els.profileForm) U.on(els.profileForm, "submit", handleProfileSubmit);

        /* Clear a field error as soon as the manager starts correcting it. */
        U.$$("#profileForm .form-control").forEach(function (control) {
            U.on(control, "input", function () { U.clearFieldError(control); });
        });
    }

    /* =========================================================
       Start-up
       ========================================================= */

    async function showPendingApproval(platform, account) {
        var appShell = document.getElementById("appShell");
        var pendingView = document.getElementById("pendingApprovalView");
        if (!appShell || !pendingView) {
            throw new Error("The approval status view is unavailable.");
        }

        var dashboardSkipLink = document.getElementById("dashboardSkipLink");
        if (dashboardSkipLink) dashboardSkipLink.hidden = true;

        var paymentLoadFailed = false;
        try {
            var publicData = await platform.requestAll("/public/bootstrap?includePayment=1", [
                "categories"
            ]);
            Object.keys(publicData).forEach(function (key) {
                Data[key] = publicData[key];
            });
        } catch (error) {
            paymentLoadFailed = true;
            console.error("Payment instructions could not be loaded for the pending manager.", error);
        }

        var payment = (Data.meta && Data.meta.payment) || {};
        var officeNumber = String(payment.whatsapp || "254707119367").replace(/\D/g, "") ||
            "254707119367";
        var officeDisplay = officeNumber.replace(/^254/, "0")
            .replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
        var officeLink = document.getElementById("pendingOfficeContact");
        var registrationBalance = document.getElementById("pendingRegistrationBalance");
        var managerName = document.getElementById("pendingManagerName");
        var paymentButton = document.getElementById("pendingPaymentButton");
        var paymentInstructions = document.getElementById("pendingPaymentInstructions");
        var signOutButton = document.getElementById("pendingSignOut");
        var actionError = document.getElementById("pendingActionError");

        if (officeLink) {
            officeLink.href = "https://wa.me/" + officeNumber;
            officeLink.textContent = officeDisplay;
        }
        if (registrationBalance) {
            try {
                var balanceSummary = await platform.request("/manager/pending-registration-balance");
                var registrationCount = Number(balanceSummary.registrationCount);
                var balanceDue = Number(balanceSummary.balanceDue);
                if (!Number.isInteger(registrationCount) || registrationCount < 0 ||
                    !Number.isFinite(balanceDue) || balanceDue < 0) {
                    throw new Error("The balance response was invalid.");
                }
                if (registrationCount === 0) {
                    registrationBalance.textContent =
                        "No pending team registration was found, so we couldn't calculate a balance. Contact the competitions office.";
                } else if (balanceDue === 0) {
                    registrationBalance.textContent = "No outstanding registration balance.";
                } else {
                    registrationBalance.textContent =
                        (registrationCount > 1 ? "Total balance to pay: " : "Balance to pay: ") +
                        U.formatMoney(balanceDue, balanceSummary.currency || "KES");
                }
            } catch (error) {
                console.error("Pending manager registration balance could not be loaded.", error);
                registrationBalance.textContent =
                    "Balance could not be loaded. Refresh or contact the competitions office.";
            }
        }
        if (managerName && account.name) {
            managerName.textContent = "Signed in as " + account.name + ".";
        }

        if (paymentButton && paymentInstructions) {
            U.on(paymentButton, "click", function () {
                if (!paymentInstructions.hidden) {
                    paymentInstructions.hidden = true;
                    paymentButton.setAttribute("aria-expanded", "false");
                    return;
                }

                var markup = U.paymentDetailsMarkup({ note: false });
                var paymentMessage = paymentLoadFailed
                    ? alertMarkup("warning", "Payment details unavailable.",
                        "We couldn't load the current payment destination. Contact the competitions office on " +
                            officeDisplay + " for payment instructions.")
                    : markup || alertMarkup("warning", "Payment details unavailable.",
                        "Contact the competitions office on " + officeDisplay +
                            " for the current payment destination.");
                paymentInstructions.innerHTML =
                    '<p>Pay the full registration fee shown in your registration confirmation, then send your payment confirmation to the competitions office.</p>' +
                    paymentMessage;
                paymentInstructions.hidden = false;
                paymentButton.setAttribute("aria-expanded", "true");
            });
        }

        if (signOutButton) {
            U.on(signOutButton, "click", async function () {
                signOutButton.disabled = true;
                if (actionError) actionError.innerHTML = "";
                try {
                    await platform.logout();
                    window.location.replace("/login/");
                } catch (error) {
                    signOutButton.disabled = false;
                    setAlert(actionError, "danger", "Sign-out failed.",
                        error && error.message ? error.message : "Please try again.");
                }
            });
        }

        appShell.hidden = true;
        pendingView.hidden = false;
        hideManagerBootScreen();
    }

    function hideManagerBootScreen() {
        var screen = document.getElementById("managerBootScreen");
        if (screen) screen.hidden = true;
    }

    async function init() {
        /* The script is only meaningful on the dashboard page. */
        if (!document.getElementById("appModal")) return;

        collectElements();

        if (!els.shell) {
            hideManagerBootScreen();
            return;
        }

        try {
            var platform = await window.AngutsaPlatformReady;
            if (!platform) throw window.AngutsaPlatformError || new Error("Dashboard services are unavailable.");
            var account = await platform.account();
            if (account.status === "pending" && account.requestedAccountType === "team-manager" &&
                (!account.role || account.role === "team_manager")) {
                await showPendingApproval(platform, account);
                return;
            }
            if (account.role !== "team_manager" || account.status !== "active") {
                await platform.logout();
                window.location.replace("/login/");
                return;
            }
            var responses = await Promise.all([
                platform.requestAll("/public/bootstrap", [
                    "categories", "tournaments", "teams", "rules"
                ]),
                requestManagerBootstrap(platform)
            ]);
            applyManagerBootstrap(responses[0], responses[1]);
        } catch (error) {
            els.shell.hidden = false;
            var message = error && error.message ? error.message : "Please sign in and try again.";
            var view = document.getElementById("appView");
            if (view) {
                view.innerHTML = alertMarkup("danger", "Dashboard could not be loaded.",
                    message);
            }
            hideManagerBootScreen();
            U.toast("Dashboard could not be loaded. " + message, "error");
            return;
        }

        els.shell.hidden = false;
        paintNavIcons();
        state.createdTeamIds = [];

        /* Presentation preference only, and never applied on small screens
           where the sidebar is a drawer. */
        var railPref = U.getPref(STORAGE.sidebar, "full");
        var wideEnough = !window.matchMedia || window.matchMedia("(min-width: 1025px)").matches;
        applyRailPreference(railPref === "rail" && wideEnough);

        var requestedTeam = U.getParam("team");
        var scope = teamsInScope();
        state.teamId = requestedTeam && scope.some(function (team) { return team.id === requestedTeam; })
            ? requestedTeam
            : (scope[0] ? scope[0].id : "");

        renderIdentity();
        if (document.body.classList.contains("is-preview")) {
            document.body.classList.remove("is-preview");
        }
        renderTeamSwitcher();
        renderNotificationChrome();

        bindShell();
        bindFilters();

        var hash = (window.location && window.location.hash) || "";
        var startView = currentHashView();

        setView(hash ? startView : "overview", { focus: false });

        /* Back and forward navigation between dashboard sections. */
        window.addEventListener("hashchange", function () {
            setView(currentHashView(), { focus: false });
        });

        /* Leaving a wide layout must never keep the rail state applied. */
        window.addEventListener("resize", U.debounce(function () {
            if (window.innerWidth <= 1024) {
                document.body.classList.remove("is-rail");
                closeDrawer();
            } else {
                applyRailPreference(U.getPref(STORAGE.sidebar, "full") === "rail");
            }
        }, 200));

        hideManagerBootScreen();
        U.toast("Your dashboard is ready.", "success");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }



































})();
