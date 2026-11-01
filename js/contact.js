(function () {
    "use strict";

    var form = document.getElementById("contactForm");
    if (!form) return;

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        var name = document.getElementById("contactName").value.trim();
        var phone = document.getElementById("contactPhone").value.trim();
        var subject = document.getElementById("contactSubject").value;
        var message = document.getElementById("contactMessage").value.trim();
        var error = document.getElementById("contactFormError");

        if (!form.reportValidity()) return;
        if (!name || !message) {
            error.textContent = "Enter your name and message before continuing to WhatsApp.";
            error.hidden = false;
            return;
        }

        error.hidden = true;

        var lines = [
            "Hello Angutsa Football Championship,",
            "",
            "Name: " + name
        ];
        if (phone) lines.push("Phone: " + phone);
        if (subject) lines.push("Topic: " + subject);
        lines.push("", "Message:", message);

        var whatsappUrl = "https://wa.me/254707119367?text=" + encodeURIComponent(lines.join("\n"));
        window.location.assign(whatsappUrl);
    });
})();
