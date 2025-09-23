(function () {
  function isExtensionError(message, source, error) {
    try {
      var msg = String(message || '');
      if (msg.includes('Invalid frameId for foreground frameId: 0')) return true;
      if (msg.includes('No tab with id')) return true;
      if (msg.includes('No tab with id:')) return true;
      if (msg.includes('chrome-extension')) return true;
      var stack = (error && error.stack) || '';
      if (/background-redux-new\.js/.test(stack)) return true;
    } catch (_) {}
    return false;
  }

  // Intercept general errors
  window.addEventListener(
    'error',
    function (event) {
      if (isExtensionError(event.message, event.filename, event.error)) {
        // Suppress extension-originated console noise
        event.preventDefault();
        return false;
      }
    },
    true
  );

  // Intercept unhandled promise rejections
  window.addEventListener(
    'unhandledrejection',
    function (event) {
      var reason = event.reason;
      var message = (reason && reason.message) || String(reason || '');
      if (isExtensionError(message, '', reason)) {
        event.preventDefault();
        return false;
      }
    }
  );
})();
