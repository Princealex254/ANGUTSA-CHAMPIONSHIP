/* FAQs page: grouped accordion with search. Supports deep links such as
   /faqs/#FAQ-003 and /faqs/?group=Fees%20%26%20Payments. */
(function () {
    "use strict";

    window.AngutsaDataReady.then(function () {
    var Data = window.AngutsaData;
    var list = document.getElementById("faqList");
    var chips = document.getElementById("faqChips");
    var search = document.getElementById("faqSearch");
    var empty = document.getElementById("faqEmpty");
    if (!list || !Data) return;

    var faqs = Data.faqs || [];
    var groups = [];
    faqs.forEach(function (faq) { if (groups.indexOf(faq.group) === -1) groups.push(faq.group); });

    var state = { group: "All", query: "" };
    var requestedGroup = new URLSearchParams(window.location.search).get("group");
    if (requestedGroup && groups.indexOf(requestedGroup) !== -1) state.group = requestedGroup;

    function esc(value) {
        return String(value).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function renderChips() {
        chips.innerHTML = ["All"].concat(groups).map(function (group) {
            return '<button type="button" class="faq-chip' + (group === state.group ? " is-active" : "") +
                '" data-group="' + esc(group) + '" aria-pressed="' + (group === state.group) + '">' +
                esc(group) + "</button>";
        }).join("");
    }

    function render() {
        var query = state.query.trim().toLowerCase();
        var visible = faqs.filter(function (faq) {
            return (state.group === "All" || faq.group === state.group) &&
                (!query || (faq.question + " " + faq.answer).toLowerCase().indexOf(query) !== -1);
        });

        empty.hidden = visible.length > 0;
        var hash = decodeURIComponent(window.location.hash.replace("#", ""));

        list.innerHTML = groups.map(function (group) {
            var items = visible.filter(function (faq) { return faq.group === group; });
            if (!items.length) return "";
            return '<section class="faq-group"><h2>' + esc(group) + "</h2>" + items.map(function (faq) {
                return '<details class="faq-item" id="' + esc(faq.id) + '"' + (hash === faq.id ? " open" : "") + ">" +
                    "<summary>" + esc(faq.question) + "</summary>" +
                    '<div class="faq-answer"><p>' + esc(faq.answer) + "</p></div></details>";
            }).join("") + "</section>";
        }).join("");

        if (hash) {
            var target = document.getElementById(hash);
            if (target) target.scrollIntoView({ block: "center" });
        }
    }

    chips.addEventListener("click", function (event) {
        var button = event.target.closest("[data-group]");
        if (!button) return;
        state.group = button.getAttribute("data-group");
        renderChips();
        render();
    });

    search.addEventListener("input", function () {
        state.query = search.value;
        render();
    });

    window.addEventListener("hashchange", render);

    renderChips();
    render();
    });
}());
