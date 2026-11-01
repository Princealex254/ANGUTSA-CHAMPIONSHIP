(function () {
    "use strict";

    var loaderScript = document.currentScript;
    var platformUrl = loaderScript && loaderScript.src
        ? new URL("platform.js", loaderScript.src).href
        : new URL("/js/platform.js", window.location.href).href;

    window.AngutsaPlatformReady = import(platformUrl)
        .then(function (platformModule) {
            window.AngutsaFriendlyErrorMessage = platformModule.friendlyErrorMessage;
            return platformModule.initializePlatform();
        })
        .catch(function (error) {
            console.error("Platform services could not be initialized.", error);
            var friendly = window.AngutsaFriendlyErrorMessage;
            window.AngutsaPlatformError = new Error(friendly
                ? friendly(error, "Account services are temporarily unavailable. Please try again later.")
                : "Account services are temporarily unavailable. Please try again later.");
            return null;
        });
})();
