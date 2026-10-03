/*
 * Runs before the stylesheet paints, so a chosen theme and language are already
 * in place on the first frame.
 *
 * Without it the page would draw in the device's colours and then flip once the
 * application starts and reads the preference — a flash of white for someone who
 * chose dark. It is a separate file because the served Content-Security-Policy
 * is script-src 'self': an inline script would be refused.
 *
 * The keys are the ones ThemeService and I18n write; they have to stay in step.
 * Nothing here may throw: storage can be blocked, and the page must still load.
 */
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('silencewatch.theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);

    var language = localStorage.getItem('silencewatch.language');
    if (language !== 'en' && language !== 'fr') {
      language = /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
    }
    root.lang = language;
  } catch (error) {
    /* Defaults apply: the device's colours, and the markup's own language. */
  }
})();
