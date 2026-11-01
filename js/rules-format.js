/* Shared formatter for competition rules text. The admin preview and the
   public rules page both use it, so a document always looks the same.

   Supported plain-text formatting:
   - "## Title"            section heading
   - "1. Title" + lines    numbered section heading followed by its text
   - "- item" / "* item"   bullet list
   - "1. item" lines       numbered list (every line numbered)
   - "**bold**"            bold text
   - blank line            new paragraph */
(function () {
    "use strict";

    function escape(value) {
        return String(value).replace(/[&<>"']/g, function (char) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
        });
    }

    function inline(text) {
        return escape(text)
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
    }

    function render(body) {
        var blocks = String(body || "").replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
        return blocks.map(function (block) {
            var lines = block.split("\n").map(function (line) { return line.trim(); })
                .filter(Boolean);
            if (!lines.length) return "";

            if (/^#{1,3}\s+/.test(lines[0])) {
                var rest = lines.slice(1);
                return "<h3>" + inline(lines[0].replace(/^#{1,3}\s+/, "")) + "</h3>" +
                    (rest.length ? "<p>" + rest.map(inline).join("<br>") + "</p>" : "");
            }

            if (lines.every(function (line) { return /^[-*•]\s+/.test(line); })) {
                return "<ul>" + lines.map(function (line) {
                    return "<li>" + inline(line.replace(/^[-*•]\s+/, "")) + "</li>";
                }).join("") + "</ul>";
            }

            if (lines.length > 1 && lines.every(function (line) { return /^\d+[.)]\s+/.test(line); })) {
                return "<ol>" + lines.map(function (line) {
                    return "<li>" + inline(line.replace(/^\d+[.)]\s+/, "")) + "</li>";
                }).join("") + "</ol>";
            }

            if (/^\d+[.)]\s+/.test(lines[0])) {
                var number = lines[0].match(/^(\d+)[.)]\s+(.*)$/);
                var content = lines.slice(1);
                return '<h3 class="rich-numbered"><span>' + number[1] + "</span>" + inline(number[2]) + "</h3>" +
                    (content.length ? "<p>" + content.map(inline).join("<br>") + "</p>" : "");
            }

            return "<p>" + lines.map(inline).join("<br>") + "</p>";
        }).join("");
    }

    window.AngutsaRulesFormat = { render: render };
}());
