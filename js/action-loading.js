(function () {
    "use strict";

    var MINIMUM_LOADING_TIME = 350;
    var buttonSelector = "button, input[type='button'], input[type='submit']";
    var actionSelector = ".btn, [data-action], [data-read], [data-notification], " +
        "[data-pay-confirm], [data-player-remove], #menuMarkAllRead, #markAllReadButton";
    var buttonStates = new WeakMap();
    var activeButton = null;

    function startLoading(button) {
        if (!button || button.disabled) return null;

        var state = buttonStates.get(button);
        if (state) return state;

        state = {
            disabled: button.disabled,
            value: button.matches("input") ? button.value : "",
            startedAt: Date.now(),
            pendingRequests: 0,
            finishTimer: null,
            disableTimer: null,
            finished: false
        };
        buttonStates.set(button, state);
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");

        if (button.matches("input")) button.value = "Loading...";

        state.disableTimer = window.setTimeout(function () {
            if (!state.finished) button.disabled = true;
        }, 0);
        scheduleFinish(button, state);
        return state;
    }

    function finishLoading(button, state) {
        if (state.finished || state.pendingRequests) return;
        state.finished = true;
        if (state.finishTimer) window.clearTimeout(state.finishTimer);
        if (state.disableTimer) window.clearTimeout(state.disableTimer);

        button.classList.remove("is-loading");
        button.removeAttribute("aria-busy");
        button.disabled = state.disabled;
        if (button.matches("input")) button.value = state.value;
        buttonStates.delete(button);
        if (activeButton === button) activeButton = null;
    }

    function scheduleFinish(button, state) {
        if (state.finished || state.pendingRequests) return;
        if (state.finishTimer) window.clearTimeout(state.finishTimer);

        var remaining = Math.max(0, MINIMUM_LOADING_TIME - (Date.now() - state.startedAt));
        state.finishTimer = window.setTimeout(function () {
            finishLoading(button, state);
        }, remaining);
    }

    function beginRequest() {
        if (!activeButton) return null;
        var state = buttonStates.get(activeButton);
        if (!state || state.finished) return null;

        state.pendingRequests += 1;
        if (state.finishTimer) {
            window.clearTimeout(state.finishTimer);
            state.finishTimer = null;
        }
        return { button: activeButton, state: state };
    }

    function finishRequest(ticket) {
        if (!ticket || ticket.state.finished) return;
        ticket.state.pendingRequests = Math.max(0, ticket.state.pendingRequests - 1);
        scheduleFinish(ticket.button, ticket.state);
    }

    function trackPlatformOperation(platform, methodName) {
        var operation = platform[methodName];
        if (typeof operation !== "function") return;

        platform[methodName] = function () {
            var ticket = beginRequest();
            var result;
            try {
                result = operation.apply(this, arguments);
            } catch (error) {
                finishRequest(ticket);
                throw error;
            }
            return Promise.resolve(result).finally(function () {
                finishRequest(ticket);
            });
        };
    }

    function captureButton(event, isSubmit) {
        var previouslyActiveButton = activeButton;
        var button = isSubmit
            ? (event.submitter || document.activeElement)
            : event.target.closest && event.target.closest(buttonSelector);

        if (isSubmit && (!button || !button.matches(buttonSelector))) {
            button = event.target.querySelector("button[type='submit'], input[type='submit'], button:not([type])");
        }
        if (!button || (!isSubmit && !button.matches(actionSelector))) {
            activeButton = null;
            return;
        }

        var existingState = buttonStates.get(button);
        if (existingState && !existingState.finished) {
            if (isSubmit && previouslyActiveButton === button) {
                activeButton = button;
                return;
            }
            activeButton = null;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        activeButton = null;
        if (startLoading(button)) activeButton = button;
    }

    document.addEventListener("click", function (event) {
        captureButton(event, false);
    }, true);
    document.addEventListener("submit", function (event) {
        captureButton(event, true);
    }, true);

    if (window.AngutsaPlatformReady) {
        window.AngutsaPlatformReady.then(function (platform) {
            if (!platform || typeof platform.request !== "function") return;

            trackPlatformOperation(platform, "request");
            trackPlatformOperation(platform, "logout");
        });
    }
}());
