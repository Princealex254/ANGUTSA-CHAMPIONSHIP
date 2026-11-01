(function () {
    "use strict";

    async function createTurnstile(containerId, action) {
        var config = window.AngutsaPlatformConfig;
        if (!config || !config.turnstileSiteKey) {
            throw new Error("The security check is not configured. Please contact the competition office.");
        }

        var attempts = 0;
        while (!window.turnstile && attempts < 200) {
            await new Promise(function (resolve) { window.setTimeout(resolve, 100); });
            attempts += 1;
        }
        if (!window.turnstile) {
            throw new Error("The security check could not load. Check your connection and try again.");
        }

        var token = "";
        var error = null;
        var waiter = null;
        var widgetId = null;
        var currentAction = "";

        function render(requestedAction) {
            currentAction = requestedAction;
            token = "";
            error = null;
            widgetId = window.turnstile.render(containerId, {
                sitekey: config.turnstileSiteKey,
                action: currentAction,
                callback: function (value) {
                    token = value;
                    error = null;
                    if (waiter) {
                        var resolve = waiter.resolve;
                        waiter = null;
                        resolve(value);
                    }
                },
                "expired-callback": function () {
                    token = "";
                },
                "error-callback": function () {
                    token = "";
                    error = new Error("The security check could not be completed. Please try again.");
                    if (waiter) {
                        var reject = waiter.reject;
                        waiter = null;
                        reject(error);
                    }
                }
            });
        }

        render(action);

        return {
            async getToken(requestedAction) {
                var nextAction = requestedAction || currentAction;
                if (nextAction !== currentAction) {
                    window.turnstile.remove(widgetId);
                    render(nextAction);
                }
                var value;
                if (token) {
                    value = token;
                } else if (error) {
                    throw error;
                } else {
                    value = await new Promise(function (resolve, reject) {
                        waiter = { resolve: resolve, reject: reject };
                    });
                }
                token = "";
                window.turnstile.reset(widgetId);
                return value;
            }
        };
    }

    window.AngutsaTurnstile = Object.freeze({ create: createTurnstile });
})();
