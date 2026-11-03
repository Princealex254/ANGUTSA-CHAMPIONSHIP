import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModule = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("renders every transactional email milestone as readable HTML and text", () => {
    const samples = {
        team_registration_received: {
            recipientName: "Manager",
            teamName: "Town FC",
            tournamentName: "Championship",
            reference: "TR-123",
            feeAmount: 1500,
            amountDue: "KES 1,500",
            paymentMethod: "M-Pesa",
            paymentNumber: "0707119367",
            paymentAccountName: "Angutsa Championship",
            adminWhatsApp: "0707 119 367"
        },
        team_registration_decision: {
            recipientName: "Manager",
            teamName: "Town FC",
            tournamentName: "Championship",
            reference: "TR-123",
            status: "approved",
            reviewNote: "Registration complete",
            accountActivated: true
        },
        payment_status: {
            recipientName: "Manager",
            teamName: "Town FC",
            tournamentName: "Championship",
            paymentReference: "PAY-123",
            amount: "KES 1,000",
            status: "confirmed",
            balanceDue: "",
            reviewNote: "",
            registrationApproved: true,
            registrationStatus: "approved"
        },
        account_access_updated: {
            recipientName: "Manager",
            role: "Team manager",
            status: "active",
            tournamentAccess: "Your registered team"
        },
        roster_change_permission_granted: {
            recipientName: "Manager",
            teamName: "Town FC",
            tournamentName: "Championship",
            durationHours: "24 hours",
            grantedAt: "Sun, 18 Oct 2026, 3:00 pm EAT",
            expiresAt: "Mon, 19 Oct 2026, 3:00 pm EAT"
        },
        admin_team_manager_invited: {
            recipientName: "Manager",
            teamName: "Town FC",
            tournamentName: "Championship",
            reference: "TR-123",
            amountDue: "KES 1,500",
            managerPhone: "0707119367",
            loginUrl: "https://angutsachampionship.com/login.html"
        },
        admin_tournament_admin_invited: {
            recipientName: "Administrator",
            role: "Tournament Admin",
            tournamentAccess: "Championship",
            loginUrl: "https://angutsachampionship.com/login.html"
        },
        rules_acknowledgment_reminder: {
            recipientName: "Manager",
            ruleTitle: "Competition Rules 2026",
            categoryName: "Senior",
            teamName: "Town FC",
            tournamentName: "Championship"
        }
    };

    Object.keys(samples).forEach((eventType) => {
        const content = workerModule.buildEmailContent(eventType, samples[eventType]);
        assert.ok(content.subject, `${eventType} subject is present`);
        assert.ok(content.textContent.includes("Angutsa Championship"));
        assert.ok(content.htmlContent.includes("role=\"presentation\""));
        assert.ok(content.htmlContent.includes("angutsachampionship@gmail.com"));
        assert.match(content.htmlContent, />AFC<\/td>/);
        assert.match(content.htmlContent, /FOOTBALL CHAMPIONSHIP/);
        assert.doesNotMatch(content.htmlContent, /<img\b/i);
    });
});

test("rules reminder email tells managers exactly what they need to acknowledge", () => {
    const content = workerModule.buildEmailContent("rules_acknowledgment_reminder", {
        recipientName: "Manager",
        ruleTitle: "Competition Rules 2026",
        categoryName: "Senior",
        teamName: "Town FC",
        tournamentName: "Championship"
    });

    assert.equal(content.subject, "Reminder: please read and acknowledge the competition rules");
    assert.match(content.textContent, /Competition Rules 2026/);
    assert.match(content.textContent, /Town FC/);
    assert.match(content.textContent, /read the document and record your acknowledgment/i);
});

test("roster permission email explains its time window and permitted actions", () => {
    const content = workerModule.buildEmailContent("roster_change_permission_granted", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        durationHours: "24 hours",
        grantedAt: "Sun, 18 Oct 2026, 3:00 pm EAT",
        expiresAt: "Mon, 19 Oct 2026, 3:00 pm EAT"
    });
    assert.equal(content.subject, "Temporary player roster access granted");
    assert.match(content.textContent, /Access starts: Sun, 18 Oct 2026, 3:00 pm EAT/);
    assert.match(content.textContent, /Access expires: Mon, 19 Oct 2026, 3:00 pm EAT/);
    assert.match(content.textContent, /add players, edit player details, and remove players/i);
    assert.match(content.textContent, /Access closes automatically/i);
});

test("platform owner alerts explain manager approval and team payment actions", () => {
    const managerRequest = workerModule.buildEmailContent("owner_manager_account_requested", {
        recipientName: "Platform Owner",
        managerName: "New Manager",
        managerEmail: "manager@example.com",
        managerPhone: "0700000000",
        accountStatus: "Pending owner approval"
    });
    assert.equal(managerRequest.subject, "New Team Manager account needs approval");
    assert.match(managerRequest.textContent, /Manager: New Manager/);
    assert.match(managerRequest.textContent, /Review this request in Admin → Admin Users/i);

    const teamRegistration = workerModule.buildEmailContent("owner_team_registration_received", {
        recipientName: "Platform Owner",
        teamName: "Town FC",
        tournamentName: "Championship",
        reference: "TR-123",
        managerName: "New Manager",
        managerEmail: "manager@example.com",
        amountDue: "KES 1,500"
    });
    assert.equal(teamRegistration.subject, "New team registration needs attention");
    assert.match(teamRegistration.textContent, /Registration fee: KES 1,500/);
    assert.match(teamRegistration.textContent, /Review this registration in Admin → Registrations/i);

    const payment = workerModule.buildEmailContent("owner_registration_payment_received", {
        recipientName: "Platform Owner",
        teamName: "Town FC",
        tournamentName: "Championship",
        registrationReference: "TR-123",
        paymentReference: "PAY-123",
        amount: "KES 1,500",
        status: "Confirmed",
        balanceDue: "KES 0",
        registrationStatus: "approved"
    });
    assert.equal(payment.subject, "Registration payment received");
    assert.match(payment.textContent, /Payment status: Confirmed/);
    assert.match(payment.textContent, /Review this registration in Admin → Registrations/i);
});

test("admin team invitation explains the pending registration and links the manager to sign in", () => {
    const content = workerModule.buildEmailContent("admin_team_manager_invited", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        reference: "TR-123",
        amountDue: "KES 1,500",
        managerPhone: "0707119367",
        loginUrl: "https://angutsachampionship.com/login.html"
    });

    assert.equal(content.subject, "Your team manager account has been created");
    assert.match(content.textContent, /Registration status: Pending review/);
    assert.match(content.textContent, /Registration fee due: KES 1,500/);
    assert.match(content.textContent, /select Forgot password/i);
    assert.doesNotMatch(content.textContent, /password-reset email has been requested/i);
    assert.match(content.textContent, /fee listed above is outstanding and no payment has been recorded/i);
    assert.match(content.textContent, /Sign in: https:\/\/angutsachampionship\.com\/login\.html/);
    assert.match(content.htmlContent, /href="https:\/\/angutsachampionship\.com\/login\.html"/);
});

test("Tournament Admin invitation directs the recipient to reset from the sign-in page", () => {
    const content = workerModule.buildEmailContent("admin_tournament_admin_invited", {
        recipientName: "Administrator",
        role: "Tournament Admin",
        tournamentAccess: "Championship",
        loginUrl: "https://angutsachampionship.com/login.html"
    });

    assert.equal(content.subject, "Your Tournament Admin account is ready");
    assert.match(content.textContent, /select Forgot password/i);
    assert.match(content.textContent, /Tournament access: Championship/);
    assert.match(content.textContent, /Sign in: https:\/\/angutsachampionship\.com\/login\.html/);
    assert.match(content.htmlContent, /href="https:\/\/angutsachampionship\.com\/login\.html"/);
});

test("partial payment email shows the balance and explains that approval opens player registration", () => {
    const content = workerModule.buildEmailContent("payment_status", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        registrationReference: "TR-123",
        paymentReference: "PAY-123",
        amount: "KES 1,000",
        status: "partial",
        balanceDue: "KES 2,000",
        reviewNote: ""
    });

    assert.match(content.textContent, /received and recorded your payment/i);
    assert.match(content.textContent, /Outstanding balance: KES 2,000/);
    assert.match(content.textContent, /Please pay the balance/);
    assert.match(content.textContent, /if your registration is approved before the full fee is cleared, you can still sign in and manage your team players/i);
});

test("approved registration with a balance due opens player registration and requests payment", () => {
    const content = workerModule.buildEmailContent("team_registration_decision", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        reference: "TR-123",
        status: "approved",
        reviewNote: "",
        accountActivated: true,
        balanceDue: "KES 2,000"
    });

    assert.match(content.textContent, /team manager account has been activated/);
    assert.match(content.textContent, /Outstanding balance: KES 2,000/);
    assert.match(content.textContent, /please pay it and send the payment confirmation/);
    assert.match(content.textContent, /sign in and add your team players/i);
});

test("full payment email confirms manager account activation when applicable", () => {
    const content = workerModule.buildEmailContent("payment_status", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        paymentReference: "PAY-123",
        amount: "KES 3,000",
        status: "confirmed",
        balanceDue: "",
        accountActivated: true,
        reviewNote: ""
    });

    assert.match(content.textContent, /registration fee is now fully cleared/);
    assert.match(content.textContent, /team manager account has been activated/);
});

test("full payment email confirms automatic team approval and open player registration", () => {
    const content = workerModule.buildEmailContent("payment_status", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        paymentReference: "PAY-123",
        amount: "KES 3,000",
        status: "confirmed",
        balanceDue: "",
        accountActivated: true,
        registrationApproved: true,
        registrationStatus: "approved",
        reviewNote: ""
    });

    assert.match(content.textContent, /registration fee is now fully cleared/i);
    assert.match(content.textContent, /team registration has been approved/i);
    assert.match(content.textContent, /sign in to add your team players/i);
    assert.doesNotMatch(content.textContent, /player registration opens after team approval/i);
});

test("registration receipt includes payment details and explains approval and player-registration steps", () => {
    const content = workerModule.buildEmailContent("team_registration_received", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        reference: "TR-123",
        feeAmount: 1500,
        amountDue: "KES 1,500",
        paymentMethod: "M-Pesa",
        paymentNumber: "0707119367",
        paymentAccountName: "Angutsa Championship",
        adminWhatsApp: "0707 119 367"
    });

    assert.match(content.subject, /Team registration received — Championship/);
    assert.match(content.textContent, /Registration fee: KES 1,500/);
    assert.match(content.textContent, /Pay to: 0707119367/);
    assert.match(content.textContent, /Account name: Angutsa Championship/);
    assert.match(content.textContent, /Admin WhatsApp: 0707 119 367/);
    assert.match(content.textContent, /once your registration is approved, sign in to add your team players/i);
    assert.match(content.textContent, /Send your M-Pesa payment to the number above/i);
});

test("fee clearance requires the full confirmed amount", () => {
    assert.equal(workerModule.isRegistrationFeeCleared(1500, 1499), false);
    assert.equal(workerModule.isRegistrationFeeCleared(1500, 1500), true);
    assert.equal(workerModule.isRegistrationFeeCleared(0, 0), true);
});

test("correction request email includes the administrator's instructions", () => {
    const content = workerModule.buildEmailContent("team_registration_decision", {
        recipientName: "Manager",
        teamName: "Town FC",
        tournamentName: "Championship",
        reference: "TR-123",
        status: "correction_requested",
        reviewNote: "Upload the signed team roster.",
        accountActivated: false
    });

    assert.match(content.textContent, /needs a correction to your team registration/);
    assert.match(content.textContent, /Review note: Upload the signed team roster\./);
    assert.match(content.textContent, /update your registration accordingly, and resubmit it/);
});

test("registration email payment defaults match the registration form", () => {
    assert.deepEqual(workerModule.mapPaymentSettings([]), {
        method: "M-Pesa",
        number: "0707119367",
        accountName: "KELVIN MAGORO"
    });
    assert.deepEqual(workerModule.mapPaymentSettings([
        { setting_key: "payment_method", setting_value: "M-Pesa Till" },
        { setting_key: "payment_phone", setting_value: "1234567890" },
        { setting_key: "payment_name", setting_value: "Championship Office" }
    ]), {
        method: "M-Pesa Till",
        number: "1234567890",
        accountName: "Championship Office"
    });
});

test("deleted manager email blocks are stable across email case and whitespace", async () => {
    const original = await workerModule.emailBlockHash("Manager@example.com");
    const normalized = await workerModule.emailBlockHash(" manager@EXAMPLE.com ");

    assert.match(original, /^[a-f0-9]{64}$/);
    assert.equal(original, normalized);
});

test("rejects unknown transactional email types", () => {
    assert.throws(
        () => workerModule.buildEmailContent("unknown_event", {}),
        /Unsupported transactional email event/
    );
    for (const eventType of ["fixture_published", "match_result_published"]) {
        assert.throws(
            () => workerModule.buildEmailContent(eventType, {}),
            /Unsupported transactional email event/
        );
    }
});
