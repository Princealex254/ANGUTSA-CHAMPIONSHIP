/* =========================================
   ANGUTSA CHAMPIONSHIP — PUBLIC MEDIA
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var videoGrid = document.getElementById("mediaVideoGrid");
    var galleryGrid = document.getElementById("mediaGalleryGrid");
    var notice = document.getElementById("mediaPageNotice");

    function escape(value) {
        return U.escapeHtml(value);
    }

    function emptyState(kind, title, message) {
        return '<div class="media-empty-state">' +
            '<span class="media-empty-state-mark" aria-hidden="true">' +
                (kind === "video" ? "▶" : "✦") +
            "</span>" +
            "<h3>" + escape(title) + "</h3>" +
            "<p>" + escape(message) + "</p>" +
        "</div>";
    }

    function readMedia() {
        var records = window.AngutsaData && window.AngutsaData.media;
        if (!Array.isArray(records) || records.some(function (record) {
            return !record || typeof record.id !== "string" ||
                typeof record.title !== "string" || typeof record.status !== "string";
        })) {
            console.error("The live media response has an invalid format.");
            notice.innerHTML = '<div class="media-error">We couldn\'t load the gallery right now. ' +
                "Please refresh the page. If the problem continues, contact the competition office.</div>";
            return [];
        }
        return records;
    }

    function safeImageSource(value) {
        if (typeof value !== "string") return "";
        if (/^images\/[A-Za-z0-9%._-]+$/.test(value)) return value;

        var base = window.AngutsaPlatformConfig &&
            String(window.AngutsaPlatformConfig.apiBaseUrl || "").replace(/\/+$/, "");
        if (!base) return "";

        try {
            var source = new URL(value);
            var api = new URL(base);
            return source.protocol === "https:" && source.origin === api.origin &&
                /^\/api\/v1\/media\/media\/[A-Za-z0-9-]+\.(png|jpg|webp)$/.test(source.pathname)
                ? source.href
                : "";
        } catch (_error) {
            return "";
        }
    }

    function videoSource(value) {
        var url;
        try {
            url = new URL(String(value || ""), window.location.href);
        } catch (error) {
            return null;
        }

        if (url.username || url.password) return null;
        var host = url.hostname.toLowerCase().replace(/^www\./, "");
        var localOrigin = url.origin === window.location.origin;
        var localTransport = localOrigin &&
            (url.protocol === "http:" || url.protocol === "file:");

        if (/\.(mp4|webm|ogg)$/i.test(url.pathname) &&
            (url.protocol === "https:" || localTransport)) {
            return { kind: "file", src: url.href };
        }

        if (url.protocol !== "https:") return null;

        if (host === "youtube.com" || host === "m.youtube.com" ||
            host === "youtube-nocookie.com" || host === "youtu.be") {
            var youtubeId = host === "youtu.be"
                ? url.pathname.split("/").filter(Boolean)[0]
                : url.searchParams.get("v") ||
                    (url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/) || [])[1];
            if (!youtubeId || !/^[A-Za-z0-9_-]{6,20}$/.test(youtubeId)) return null;
            return { kind: "embed", src: "https://www.youtube-nocookie.com/embed/" + youtubeId };
        }

        if (host === "vimeo.com" || host === "player.vimeo.com") {
            var vimeoId = (url.pathname.match(/\/(?:video\/)?(\d+)\/?$/) || [])[1];
            if (!vimeoId) return null;
            return { kind: "embed", src: "https://player.vimeo.com/video/" + vimeoId };
        }

        return null;
    }

    function sortedByDate(records) {
        return records.slice().sort(function (a, b) {
            return String(b.addedOn || "").localeCompare(String(a.addedOn || ""));
        });
    }

    function videoCard(record) {
        var source = videoSource(record.videoUrl);
        if (!source) return "";

        var poster = safeImageSource(record.file);
        var player = source.kind === "file"
            ? '<video controls playsinline preload="metadata"' +
                (poster ? ' poster="' + escape(poster) + '"' : "") +
                ' src="' + escape(source.src) + '">' +
                "Your browser does not support HTML video.</video>"
            : '<iframe src="' + escape(source.src) + '" title="' + escape(record.title) +
                '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ' +
                'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; ' +
                'picture-in-picture" allowfullscreen></iframe>';

        return '<article class="media-video-card">' +
            '<div class="media-video-frame">' + player + "</div>" +
            '<div class="media-video-copy">' +
                '<span class="media-type-label">' + escape(record.category || "Video") + "</span>" +
                "<h3>" + escape(record.title) + "</h3>" +
                (record.caption ? "<p>" + escape(record.caption) + "</p>" : "") +
            "</div>" +
        "</article>";
    }

    function galleryCard(record) {
        var src = safeImageSource(record.file);
        if (!src) return "";

        return '<article class="media-gallery-card">' +
            '<div class="media-gallery-image">' +
                '<img src="' + escape(src) + '" alt="' + escape(record.title) + '" loading="lazy">' +
            "</div>" +
            '<div class="media-gallery-copy">' +
                '<span class="media-type-label">' + escape(record.category || "Gallery") + "</span>" +
                "<h3>" + escape(record.title) + "</h3>" +
                (record.caption ? "<p>" + escape(record.caption) + "</p>" : "") +
            "</div>" +
        "</article>";
    }

    Promise.resolve(window.AngutsaDataReady).then(function () {
        var published = sortedByDate(readMedia().filter(function (record) {
            return String(record.status).toLowerCase() === "published";
        }));
        var videos = published.filter(function (record) {
            return String(record.mediaType || "image").toLowerCase() === "video";
        });
        var images = published.filter(function (record) {
            return String(record.mediaType || "image").toLowerCase() !== "video";
        });

        var videoMarkup = videos.map(videoCard).filter(Boolean);
        var galleryMarkup = images.map(galleryCard).filter(Boolean);
        var invalidVideos = videos.length - videoMarkup.length;
        var invalidImages = images.length - galleryMarkup.length;

        if (invalidVideos || invalidImages) {
            console.error("Some published media items have invalid video links or image paths.", {
                invalidVideos: invalidVideos,
                invalidImages: invalidImages
            });
            notice.innerHTML = '<div class="media-error">Some photos or videos could not be displayed. ' +
                "Please contact the competition office if you need help.</div>";
        }

        videoGrid.innerHTML = videoMarkup.length
            ? videoMarkup.join("")
            : emptyState("video", "No videos published yet",
                "Videos published from the Admin Media library will appear here.");
        galleryGrid.innerHTML = galleryMarkup.length
            ? galleryMarkup.join("")
            : emptyState("gallery", "No gallery photos published yet",
                "Photos published from the Admin Media library will appear here.");
    });
})();
