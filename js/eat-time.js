(function (window) {
    "use strict";

    var EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    function validParts(year, month, day, hour, minute, second) {
        var calendarDate = new Date(Date.UTC(year, month - 1, day));
        return calendarDate.getUTCFullYear() === year &&
            calendarDate.getUTCMonth() === month - 1 &&
            calendarDate.getUTCDate() === day &&
            hour >= 0 && hour < 24 && minute >= 0 && minute < 60 &&
            second >= 0 && second < 60;
    }

    function milliseconds(fraction) {
        return fraction ? parseInt((fraction + "00").slice(0, 3), 10) : 0;
    }

    function parseTimestamp(match, offset) {
        var year = parseInt(match[1], 10);
        var month = parseInt(match[2], 10);
        var day = parseInt(match[3], 10);
        var hour = parseInt(match[4] || "0", 10);
        var minute = parseInt(match[5] || "0", 10);
        var second = parseInt(match[6] || "0", 10);
        var millisecond = milliseconds(match[7]);

        if (!validParts(year, month, day, hour, minute, second)) return null;
        return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset);
    }

    function toDate(value) {
        if (value === null || value === undefined || value === "") return null;
        if (value instanceof Date) {
            return isNaN(value.getTime()) ? null : new Date(value.getTime());
        }

        var text = String(value).trim();
        var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (dateOnly) {
            return parseTimestamp(dateOnly, EAT_OFFSET_MS);
        }

        var sqlTimestamp = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(text);
        if (sqlTimestamp) {
            return parseTimestamp(sqlTimestamp, 0);
        }

        var localTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(text);
        if (localTimestamp) {
            return parseTimestamp(localTimestamp, EAT_OFFSET_MS);
        }

        var parsed = new Date(text);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function parts(value) {
        var date = toDate(value);
        if (!date) return null;

        var eatDate = new Date(date.getTime() + EAT_OFFSET_MS);
        return {
            year: eatDate.getUTCFullYear(),
            month: eatDate.getUTCMonth(),
            day: eatDate.getUTCDate(),
            weekday: eatDate.getUTCDay(),
            hour: eatDate.getUTCHours(),
            minute: eatDate.getUTCMinutes(),
            second: eatDate.getUTCSeconds()
        };
    }

    function today() {
        var date = parts(new Date());
        return date.year + "-" + ("0" + (date.month + 1)).slice(-2) + "-" +
            ("0" + date.day).slice(-2);
    }

    function formatDateLong(value) {
        var date = parts(value);
        if (!date) return "Date to be announced";
        return MONTHS_LONG[date.month] + " " + date.day + ", " + date.year;
    }

    window.AngutsaEAT = {
        toDate: toDate,
        parts: parts,
        today: today,
        currentYear: function () { return parts(new Date()).year; },
        formatDateLong: formatDateLong,
        days: DAYS,
        months: MONTHS,
        monthsLong: MONTHS_LONG
    };
}(window));
