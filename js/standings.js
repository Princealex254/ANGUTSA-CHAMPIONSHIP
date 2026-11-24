/* =========================================
   ANGUTSA CHAMPIONSHIP — STANDINGS
   Behaviour for /standings/.

   The table on this page is calculated in the browser from the
   demonstration results in js/data.js so the interface can be
   reviewed. It is NOT an official table: the backend will calculate
   and publish authoritative standings from verified results.
   ========================================= */

(function () {
    "use strict";

    var U = window.Angutsa;
    var Data = window.AngutsaData;

    var state = {
        tournamentId: "",
        categoryId: "",
        group: "",
        shareTables: [],
        tournament: null
    };

    var els = {};

    /* -------------------------
       Calculation helpers
       ------------------------- */

    function matchesForSelection() {
        return U.filterMatches((Data.matches || []).filter(U.isStandingsMatch), {
            tournamentId: state.tournamentId,
            categoryId: state.categoryId,
            group: state.group
        });
    }

    function groupsForTournament(tournamentId) {
        var groups = {};
        (Data.matches || []).forEach(function (match) {
            if (match.tournamentId !== tournamentId) return;
            if (match.group) groups[match.group] = true;
        });
        (Data.teams || []).forEach(function (team) {
            var teamGroup = team.groupByTournament
                ? team.groupByTournament[tournamentId]
                : team.group;
            if (teamGroup && Array.isArray(team.tournamentIds) &&
                team.tournamentIds.indexOf(tournamentId) !== -1) {
                groups[teamGroup] = true;
            }
        });
        return Object.keys(groups).sort();
    }

    function tableScopes(matches, selectedGroup) {
        if (selectedGroup) return [{ name: selectedGroup, group: selectedGroup }];
        var groups = groupsForTournament(state.tournamentId);
        var scopes = groups.map(function (group) {
            return { name: group, group: group };
        });
        if (!groups.length || matches.some(function (match) { return !match.group; })) {
            scopes.unshift({ name: "", group: "" });
        }
        return scopes;
    }

    function tablesForMatches(matches, tournament, selectedGroup) {
        return tournament ? tableScopes(matches, selectedGroup).map(function (scope) {
            var scopedMatches = scope.group
                ? matches.filter(function (match) { return match.group === scope.group; })
                : matches.filter(function (match) { return !match.group; });
            return {
                name: scope.name,
                rows: U.computeStandings(scopedMatches, Data.teams, {
                    tournamentId: state.tournamentId,
                    categoryId: state.categoryId,
                    group: scope.group
                })
            };
        }).filter(function (item) { return item.rows.length; }) : [];
    }

    /* Qualification places are configured per competition. The
       demonstration values are shown in the legend on the page. */
    function qualificationCounts(tournament) {
        var format = tournament ? tournament.format : "league";
        if (format === "group-knockout") return { qualify: 2, playoff: 1 };
        if (format === "knockout") return { qualify: 0, playoff: 0 };
        return { qualify: 1, playoff: 0 };
    }

    /* -------------------------
       Rendering
       ------------------------- */

    function rowMarkup(row, counts) {
        var markerClass = "is-out";
        var rowClass = "";

        if (row.position <= counts.qualify) {
            markerClass = "is-qualify";
            rowClass = "is-qualify";
        } else if (counts.playoff && row.position <= counts.qualify + counts.playoff) {
            markerClass = "is-playoff";
            rowClass = "is-playoff";
        }

        return '<tr class="' + rowClass + '">' +
            '<td data-label="Position"><span class="position-cell">' +
                '<span class="position-marker ' + markerClass + '" aria-hidden="true"></span>' +
                "<span>" + row.position + "</span>" +
            "</span></td>" +
            '<td data-label="Team"><span class="team-cell">' +
                '<span class="crest crest-sm" style="--crest-accent:' + U.escapeHtml(row.accent) +
                    '" aria-hidden="true">' + U.escapeHtml(row.shortName) + "</span>" +
                "<span><strong>" + U.escapeHtml(row.name) + "</strong><span>" +
                    U.escapeHtml(row.shortName) + "</span></span>" +
            "</span></td>" +
            '<td data-label="Played" class="is-numeric">' + row.played + "</td>" +
            '<td data-label="Won" class="is-numeric">' + row.won + "</td>" +
            '<td data-label="Drawn" class="is-numeric">' + row.drawn + "</td>" +
            '<td data-label="Lost" class="is-numeric">' + row.lost + "</td>" +
            '<td data-label="Goals for" class="is-numeric">' + row.goalsFor + "</td>" +
            '<td data-label="Goals against" class="is-numeric">' + row.goalsAgainst + "</td>" +
            '<td data-label="Goal difference" class="is-numeric">' +
                (row.difference > 0 ? "+" + row.difference : row.difference) + "</td>" +
            '<td data-label="Points" class="is-numeric">' + row.points + "</td>" +
            '<td data-label="Form">' + U.formMarkup(row.form) + "</td>" +
        "</tr>";
    }

    function summaryMarkup(table, matches, tournament) {
        var completed = matches.filter(function (match) {
            return match.status === "completed" && U.isStandingsMatch(match);
        });
        var goals = completed.reduce(function (total, match) {
            return total + (match.homeScore || 0) + (match.awayScore || 0);
        }, 0);
        var remaining = matches.filter(function (match) { return match.status === "scheduled"; });

        return '<div><strong>' + table.length + "</strong><span>Teams in table</span></div>" +
            "<div><strong>" + completed.length + "</strong><span>Matches played</span></div>" +
            "<div><strong>" + remaining.length + "</strong><span>Matches remaining</span></div>" +
            "<div><strong>" + goals + "</strong><span>Goals scored</span></div>" +
            (tournament ? "" : "");
    }

    function emptyMarkup(tournament) {
        if (!tournament) {
            return U.emptyState({
                icon: "chart",
                title: "Select a tournament to view its table",
                message: "Choose a competition above. Only competitions with published results have a table.",
                actionLabel: "View all tournaments",
                actionHref: "/tournaments/"
            });
        }

        return U.emptyState({
            icon: "chart",
            title: "No standings have been published yet",
            message: "This competition has no completed matches for the current selection, so no table can be calculated.",
            actionLabel: "View latest results",
            actionHref: "/results/"
        });
    }

    /* -------------------------
       Selectors and rendering
       ------------------------- */

    function populateSelectors() {
        U.fillSelect(els.tournament, Data.tournaments || [], {
            placeholder: "Select a tournament",
            label: function (item) { return item.name + " (" + item.season + ")"; }
        });

        U.fillSelect(els.category, Data.categories || [], {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        U.fillSelect(els.group, [], { placeholder: "All groups" });
    }

    /* The category list is limited to the category used by the selected
       competition so the two selectors always agree. */
    function refreshCategoryOptions() {
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var categories = Data.categories || [];

        if (tournament) {
            categories = categories.filter(function (category) {
                return category.id === tournament.categoryId;
            });
        }

        U.fillSelect(els.category, categories, {
            placeholder: "All categories",
            label: function (item) { return item.name; }
        });

        if (tournament && categories.length === 1) {
            els.category.value = tournament.categoryId;
            state.categoryId = tournament.categoryId;
        }
    }

    function refreshGroupOptions() {
        var groups = state.tournamentId ? groupsForTournament(state.tournamentId) : [];

        U.fillSelect(els.group, groups, {
            placeholder: groups.length ? "All groups" : "No groups configured",
            value: function (value) { return value; },
            label: function (value) { return value; }
        });

        if (groups.indexOf(state.group) === -1) {
            state.group = "";
            els.group.value = "";
        }
    }

    function syncFromControls() {
        state.tournamentId = els.tournament ? els.tournament.value : "";
        state.categoryId = els.category ? els.category.value : "";
        state.group = els.group ? els.group.value : "";
    }

    function render() {
        var tournament = state.tournamentId ? U.tournamentById(state.tournamentId) : null;
        var matches = matchesForSelection();
        var allMatches = state.group ? U.filterMatches((Data.matches || []).filter(U.isStandingsMatch), {
            tournamentId: state.tournamentId,
            categoryId: state.categoryId
        }) : matches;
        var shareTables = tablesForMatches(allMatches, tournament, "");
        var tables = state.group
            ? shareTables.filter(function (table) { return table.name === state.group; })
            : shareTables;
        state.shareTables = shareTables;
        state.tournament = tournament;
        if (els.share) els.share.disabled = !tables.length;

        if (els.summary) {
            var allRows = tables.reduce(function (rows, item) {
                return rows.concat(item.rows);
            }, []);
            els.summary.innerHTML = tournament ? summaryMarkup(
                allRows, matches, tournament
            ) : "";
        }

        if (els.meta) {
            var parts = [];
            var category = state.categoryId ? U.categoryById(state.categoryId) : null;

            if (tournament) parts.push(tournament.name);
            if (category) parts.push(category.name);
            if (state.group) parts.push(state.group);

            els.meta.innerHTML = parts.length
                ? '<div class="result-count"><span>Showing <strong>' +
                    (tables.length ? tables.reduce(function (total, item) {
                        return total + item.rows.length;
                    }, 0) + " teams" : "no teams") +
                    "</strong></span>" +
                    parts.map(function (label) {
                        return '<span class="badge">' + U.escapeHtml(label) + "</span>";
                    }).join("") +
                "</div>"
                : "";
        }

        var hasTable = tables.length > 0;
        els.tableWrap.hidden = !hasTable;
        els.empty.innerHTML = hasTable ? "" : emptyMarkup(tournament);

        if (!hasTable) return;

        var counts = qualificationCounts(tournament);
        els.tableWrap.innerHTML = '<div class="standings-table-groups">' +
            tables.map(function (item) {
            return '<div class="panel">' +
                '<div class="panel-body is-flush"><div class="table-wrap">' +
                    '<table class="data-table standings-table">' +
                        '<caption class="visually-hidden">' +
                            U.escapeHtml(item.name ? item.name + " table" : "League table") +
                            ' for ' + U.escapeHtml(tournament.name) + '</caption>' +
                        '<thead><tr><th scope="col">Pos</th><th scope="col">Team</th>' +
                            '<th scope="col" class="is-numeric">P</th><th scope="col" class="is-numeric">W</th>' +
                            '<th scope="col" class="is-numeric">D</th><th scope="col" class="is-numeric">L</th>' +
                            '<th scope="col" class="is-numeric">GF</th><th scope="col" class="is-numeric">GA</th>' +
                            '<th scope="col" class="is-numeric">GD</th><th scope="col" class="is-numeric">Pts</th>' +
                            '<th scope="col">Form</th></tr></thead><tbody>' +
                            item.rows.map(function (row) { return rowMarkup(row, counts); }).join("") +
                        '</tbody></table></div></div></div>';
        }).join("") + '</div><div class="standings-legend legend">' +
            '<span><i class="is-qualify"></i> Qualification places</span>' +
            '<span><i class="is-playoff"></i> Play-off place</span>' +
            '<span><i class="is-out"></i> Outside qualification</span></div>';
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }

    function drawStandingsImage() {
        var width = 1200;
        var topHeight = 230;
        var footerHeight = 110;
        var groupGap = 24;
        var headingHeight = 58;
        var columnHeadingHeight = 48;
        var rowHeight = 52;
        var totalTeams = state.shareTables.reduce(function (count, table) {
            return count + table.rows.length;
        }, 0);
        var groupsHeight = state.shareTables.reduce(function (height, table) {
            return height + headingHeight + columnHeadingHeight +
                table.rows.length * rowHeight + groupGap;
        }, 0);
        var height = topHeight + groupsHeight + footerHeight;
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable.");

        var background = ctx.createLinearGradient(0, 0, width, height);
        background.addColorStop(0, "#10152E");
        background.addColorStop(1, "#302569");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.arc(width - 80, 90, 250, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#F2C94C";
        ctx.fillRect(0, topHeight - 5, width, 5);

        var logo = document.querySelector(".brand-logo");
        if (logo && logo.complete && logo.naturalWidth) {
            roundedRect(ctx, 54, 42, 226, 80, 14);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            var logoScale = Math.min(196 / logo.naturalWidth, 56 / logo.naturalHeight);
            var logoWidth = logo.naturalWidth * logoScale;
            var logoHeight = logo.naturalHeight * logoScale;
            ctx.drawImage(logo, 69 + (196 - logoWidth) / 2, 54 + (56 - logoHeight) / 2,
                logoWidth, logoHeight);
        }

        ctx.textAlign = "left";
        ctx.fillStyle = "#F2C94C";
        ctx.font = "700 20px Arial, sans-serif";
        ctx.fillText("THE ANGUTSA FOOTBALL CHAMPIONSHIP", 310, 68);
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 42px Arial, sans-serif";
        ctx.fillText("TOURNAMENT STANDINGS", 310, 120);
        ctx.fillStyle = "#D5D1EF";
        ctx.font = "600 21px Arial, sans-serif";
        var category = state.categoryId ? U.categoryById(state.categoryId) : null;
        var subtitle = state.tournament.name +
            (state.tournament.season ? "  ·  " + state.tournament.season : "") +
            (category ? "  ·  " + category.name : "");
        ctx.fillText(subtitle, 310, 163, width - 370);
        ctx.font = "500 18px Arial, sans-serif";
        var allGroups = state.shareTables.every(function (table) { return !!table.name; });
        var scopeLabel = allGroups ? "group" : "table";
        ctx.fillText(totalTeams + " teams  ·  " + state.shareTables.length + " " + scopeLabel +
            (state.shareTables.length === 1 ? "" : "s"), 310, 199);

        var columns = [
            { label: "POS", x: 82, align: "center" },
            { label: "TEAM", x: 142, align: "left" },
            { label: "P", x: 655, align: "center" },
            { label: "W", x: 722, align: "center" },
            { label: "D", x: 789, align: "center" },
            { label: "L", x: 856, align: "center" },
            { label: "GD", x: 938, align: "center" },
            { label: "PTS", x: 1014, align: "center" },
            { label: "FORM", x: 1090, align: "center" }
        ];
        var y = topHeight + 20;

        state.shareTables.forEach(function (table) {
            var sectionHeight = headingHeight + columnHeadingHeight +
                table.rows.length * rowHeight;
            roundedRect(ctx, 52, y, width - 104, sectionHeight, 16);
            ctx.fillStyle = "#ffffff";
            ctx.fill();

            roundedRect(ctx, 52, y, width - 104, headingHeight, 16);
            ctx.fillStyle = "#211B50";
            ctx.fill();
            ctx.fillRect(52, y + headingHeight - 16, width - 104, 16);
            ctx.textAlign = "left";
            ctx.fillStyle = "#F2C94C";
            ctx.font = "800 22px Arial, sans-serif";
            ctx.fillText(table.name || "LEAGUE TABLE", 78, y + 37);
            ctx.textAlign = "right";
            ctx.fillStyle = "#D5D1EF";
            ctx.font = "600 16px Arial, sans-serif";
            ctx.fillText(table.rows.length + (table.rows.length === 1 ? " TEAM" : " TEAMS"),
                width - 78, y + 36);

            var columnY = y + headingHeight;
            ctx.fillStyle = "#F0EFF7";
            ctx.fillRect(52, columnY, width - 104, columnHeadingHeight);
            ctx.font = "800 15px Arial, sans-serif";
            ctx.fillStyle = "#68647E";
            columns.forEach(function (column) {
                ctx.textAlign = column.align;
                ctx.fillText(column.label, column.x, columnY + 30);
            });

            table.rows.forEach(function (row, index) {
                var rowY = columnY + columnHeadingHeight + index * rowHeight;
                if (index % 2 === 1) {
                    ctx.fillStyle = "#FAF9FC";
                    ctx.fillRect(52, rowY, width - 104, rowHeight);
                }
                ctx.fillStyle = "#211B50";
                ctx.font = "700 19px Arial, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(String(row.position), 82, rowY + 33);
                ctx.textAlign = "left";
                ctx.font = "700 18px Arial, sans-serif";
                ctx.fillText(row.name || row.shortName || "", 142, rowY + 33, 490);
                ctx.font = "600 17px Arial, sans-serif";
                ctx.fillStyle = "#45425A";
                [row.played, row.won, row.drawn, row.lost].forEach(function (value, columnIndex) {
                    ctx.textAlign = "center";
                    ctx.fillText(String(value), columns[columnIndex + 2].x, rowY + 33);
                });
                ctx.fillText(String(row.difference > 0 ? "+" + row.difference : row.difference),
                    columns[6].x, rowY + 33);
                ctx.fillStyle = "#211B50";
                ctx.font = "800 18px Arial, sans-serif";
                ctx.fillText(String(row.points), columns[7].x, rowY + 33);
                var form = (row.form || []).slice(-5);
                var formStart = columns[8].x - (form.length * 22) / 2;
                form.forEach(function (result, formIndex) {
                    var color = result === "W" ? "#25805B" : result === "D" ? "#A87912" : "#B24B55";
                    roundedRect(ctx, formStart + formIndex * 22, rowY + 14, 18, 24, 6);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.fillStyle = "#ffffff";
                    ctx.font = "800 12px Arial, sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(result, formStart + formIndex * 22 + 9, rowY + 31);
                });
            });
            y += sectionHeight + groupGap;
        });

        ctx.textAlign = "left";
        ctx.fillStyle = "#F2C94C";
        ctx.font = "800 17px Arial, sans-serif";
        ctx.fillText("THE ANGUTSA FOOTBALL CHAMPIONSHIP", 58, height - 60);
        ctx.fillStyle = "#D5D1EF";
        ctx.font = "500 15px Arial, sans-serif";
        ctx.fillText("More than a tournament. A community united by football.", 58, height - 34);
        ctx.textAlign = "right";
        ctx.fillText("OFFICIAL TOURNAMENT TABLE", width - 58, height - 46);
        return canvas;
    }

    function shareStandingsImage() {
        if (!state.tournament || !state.shareTables.length) return;

        var canvas;
        try {
            canvas = drawStandingsImage();
        } catch (error) {
            U.toast("Could not create the standings image on this device.", "error");
            return;
        }

        var slug = String(state.tournament.name || "tournament")
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        var fileName = "angutsa-" + (slug || "tournament") + "-standings.png";

        function download(blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            U.toast("Standings image saved. You can now share it.", "success");
        }

        canvas.toBlob(function (blob) {
            if (!blob) {
                U.toast("Could not create the standings image.", "error");
                return;
            }

            var shareData;
            try {
                shareData = {
                    files: [new File([blob], fileName, { type: "image/png" })],
                    title: state.tournament.name + " standings"
                };
            } catch (error) {
                download(blob);
                return;
            }

            var canShare = false;
            try {
                canShare = !!(navigator.share && navigator.canShare && navigator.canShare(shareData));
            } catch (error) {
                canShare = false;
            }
            if (!canShare) {
                download(blob);
                return;
            }
            try {
                navigator.share(shareData).catch(function (error) {
                    if (error && error.name !== "AbortError") download(blob);
                });
            } catch (error) {
                download(blob);
            }
        }, "image/png");
    }

    /* -------------------------
       Bindings and initialisation
       ------------------------- */
    function bindSelectors() {
        U.on(els.tournament, "change", function () {
            syncFromControls();
            refreshCategoryOptions();
            refreshGroupOptions();
            render();
        });

        U.on(els.category, "change", function () {
            syncFromControls();
            render();
        });

        U.on(els.group, "change", function () {
            syncFromControls();
            render();
        });

        U.on(document.getElementById("refreshStandings"), "click", function () {
            syncFromControls();
            render();
            U.toast("Table recalculated from the latest published results.", "info");
        });

        U.on(document.getElementById("printStandings"), "click", function () {
            window.print();
        });
        U.on(els.share, "click", shareStandingsImage);
    }

    /* Deep links: /standings/?tournament=TRN-2026-MEN&group=Group A */
    function applyDeepLinks() {
        var tournament = U.getParam("tournament") || U.getParam("tournamentId");
        var category = U.getParam("category");
        var group = U.getParam("group");

        if (tournament && U.tournamentById(tournament)) {
            els.tournament.value = tournament;
            state.tournamentId = tournament;
        }

        refreshCategoryOptions();
        refreshGroupOptions();

        if (category) {
            els.category.value = category;
            state.categoryId = category;
        }

        if (group && groupsForTournament(state.tournamentId).indexOf(group) > -1) {
            els.group.value = group;
            state.group = group;
        }
    }

    function init() {
        els.tableWrap = document.getElementById("standingsTableWrap");
        if (!els.tableWrap) return;
        els.empty = document.getElementById("standingsEmpty");
        els.summary = document.getElementById("standingsSummary");
        els.meta = document.getElementById("tableMeta");
        els.tournament = document.getElementById("filterTournament");
        els.category = document.getElementById("filterCategory");
        els.group = document.getElementById("filterGroup");
        els.share = document.getElementById("shareStandingsImage");
        els.tableTitle = document.getElementById("tableTitle");
        els.tableSubtitle = document.getElementById("tableSubtitle");
        var staleNotice = document.getElementById("dataNotice");
        if (staleNotice) staleNotice.remove();
        var staleRules = document.getElementById("standingsNotice");
        if (staleRules) staleRules.remove();
        populateSelectors();
        bindSelectors();
        applyDeepLinks();
        syncFromControls();
        render();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { U.whenDataReady(init); });
    } else {
        U.whenDataReady(init);
    }


})();
