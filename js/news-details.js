/* =========================================
   ANGUTSA CHAMPIONSHIP — ARTICLE
   Behaviour for /news-details/.
   Reads published article records from the live platform data through
   the `article` query parameter.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var article = null;
    var els = {};

    /* -------------------------
       Data helpers
       ------------------------- */

    function allArticles() {
        return (Data.news || []).slice().sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });
    }

    function relatedArticles(limit) {
        var others = allArticles().filter(function (item) {
            return !article || item.id !== article.id;
        });

        var sameCategory = others.filter(function (item) {
            return article && item.category === article.category;
        });

        var rest = others.filter(function (item) {
            return !article || item.category !== article.category;
        });

        return sameCategory.concat(rest).slice(0, limit || 3);
    }

    function articleUrl(item) {
        return "/news-details/?article=" + encodeURIComponent(item.id);
    }

    function readingTime(text) {
        var words = String(text || "").split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round(words / 200));
    }

    /* The dataset stores bodies as single paragraphs; split on blank
       lines so longer real copy publishes as proper paragraphs. */
    function paragraphs(text) {
        return String(text || "")
            .split(/\n{2,}/)
            .map(function (chunk) { return chunk.trim(); })
            .filter(Boolean);
    }

    /* -------------------------
       Header
       ------------------------- */

    function renderHero() {
        if (!article) {
            els.heroTitle.textContent = "Article not found";
            els.heroCategory.textContent = "News";
            els.heroBreadcrumb.textContent = "Not found";
            els.heroMeta.innerHTML = "";
            return;
        }

        els.heroCategory.textContent = article.category;
        els.heroTitle.textContent = article.title;
        els.heroBreadcrumb.textContent = article.category;

        els.heroMeta.innerHTML =
            "<span>" + U.icon("calendar") + U.formatDate(article.date) + "</span>" +
            "<span>" + U.icon("users") + U.escapeHtml(article.author) + "</span>" +
            "<span>" + U.icon("clock") + readingTime(article.excerpt + " " + article.body) +
                " min read</span>";
    }

    /* -------------------------
       Article body
       ------------------------- */

    function bodyMarkup() {
        var lead = '<p class="is-lead">' + U.escapeHtml(article.excerpt) + "</p>";

        var copy = paragraphs(article.body).map(function (chunk) {
            return "<p>" + U.escapeHtml(chunk) + "</p>";
        }).join("");

        return '<figure class="article-cover">' +
                '<img src="' + U.escapeHtml(article.image) + '" alt="" loading="lazy">' +
            "</figure>" +
            '<div class="article-copy">' + lead + copy + "</div>";
    }

    /* -------------------------
       Side column and related grid
       ------------------------- */

    function renderSide() {
        if (!article) {
            els.articleFacts.innerHTML = "";
            els.relatedList.innerHTML = "";
            return;
        }

        els.articleFacts.innerHTML =
            "<div>" + U.icon("flag") + "<span>" + U.escapeHtml(article.category) + "</span></div>" +
            "<div>" + U.icon("users") + "<span>" + U.escapeHtml(article.author) + "</span></div>" +
            "<div>" + U.icon("calendar") + "<span>Published " +
                U.formatDate(article.date) + "</span></div>" +
            "<div>" + U.icon("clock") + "<span>" +
                readingTime(article.excerpt + " " + article.body) + " min read</span></div>";

        var related = relatedArticles(4);

        els.relatedList.innerHTML = related.length
            ? related.map(function (item) {
                return '<a href="' + articleUrl(item) + '">' +
                    "<span>" + U.escapeHtml(item.title) + "</span>" +
                    "<span>" + U.escapeHtml(item.category) + "</span>" +
                "</a>";
            }).join("")
            : "<p>No further articles have been published yet.</p>";
    }

    function relatedCardMarkup(item) {
        return '<article class="card news-card">' +
            '<div class="news-card-media">' +
                '<img src="' + U.escapeHtml(item.image) + '" alt="" loading="lazy">' +
                '<span class="category-pill">' + U.escapeHtml(item.category) + "</span>" +
            "</div>" +
            '<div class="card-body">' +
                '<div class="news-date">' + U.icon("calendar") + U.formatDate(item.date) + "</div>" +
                '<h3 class="news-title"><a href="' + articleUrl(item) + '">' +
                    U.escapeHtml(item.title) + "</a></h3>" +
                '<p class="news-excerpt">' + U.escapeHtml(item.excerpt) + "</p>" +
                '<div class="card-actions">' +
                    '<a class="btn btn-dark-outline btn-sm" href="' + articleUrl(item) + '">Read Article</a>' +
                "</div>" +
            "</div>" +
        "</article>";
    }

    function renderRelatedGrid() {
        if (!els.relatedGrid) return;

        var related = relatedArticles(3);
        if (!related.length) {
            els.relatedGrid.innerHTML = "";
            return;
        }

        els.relatedGrid.innerHTML = related.map(relatedCardMarkup).join("");
    }

    /* -------------------------
       Article body rendering
       ------------------------- */

    function renderBody() {
        if (!article) {
            els.articleBody.innerHTML = U.emptyState({
                icon: "list",
                title: "Article not found",
                message: "This article is not in the archive. Visit the Media page to browse photos and videos.",
                actionLabel: "Media gallery",
                actionHref: "/media/"
            });
            return;
        }

        els.articleBody.innerHTML =
            bodyMarkup() +
            '<div class="article-tags">' +
                '<span class="badge">' + U.escapeHtml(article.category) + "</span>" +
                '<span class="badge badge-purple">Championship</span>' +
                '<span class="badge badge-purple">' + U.escapeHtml(article.author) + "</span>" +
            "</div>" +
            '<div class="article-share-block">' +
                "<p>Share this article with supporters, or return to the Media gallery for photos and videos.</p>" +
                '<div class="btn-row">' +
                    '<button type="button" class="btn btn-primary btn-sm" data-share ' +
                        'data-share-title="' + U.escapeHtml(article.title) + '">Share article</button>' +
                    '<a class="btn btn-dark-outline btn-sm" href="/media/">Media gallery</a>' +
                "</div>" +
            "</div>";
    }

    /* -------------------------
       Initialisation
       ------------------------- */

    function init() {
        els.heroTitle = document.getElementById("heroTitle");
        if (!els.heroTitle) return;

        els.heroCategory = document.getElementById("heroCategory");
        els.heroBreadcrumb = document.getElementById("heroBreadcrumb");
        els.heroMeta = document.getElementById("heroMeta");
        els.articleBody = document.getElementById("articleBody");
        els.articleFacts = document.getElementById("articleFacts");
        els.relatedList = document.getElementById("relatedList");
        els.relatedGrid = document.getElementById("relatedGrid");
        els.notice = document.getElementById("dataNotice");
        els.articleNotice = document.getElementById("articleNotice");

        var requested = U.getParam("article");
        var candidate = U.findById("news", requested);

        if (requested && !candidate) {
            els.articleNotice.innerHTML = '<div class="alert alert-warning" role="note">' + U.icon("alert") +
                "<span><strong>Article not found.</strong> The link may be outdated, so the latest " +
                "published story is shown instead.</span></div>";
        }

        article = candidate || allArticles()[0] || null;

        if (els.notice) els.notice.innerHTML = U.liveDataNotice();

        renderHero();
        renderBody();
        renderSide();
        renderRelatedGrid();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }

})();
