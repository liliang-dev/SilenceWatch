// The site is in English. A visitor whose browser asks for French is taken to the
// French page that matches the one they asked for, once, and only if they have
// not chosen a language themselves.
//
// What it does not do: look the visitor up by IP address. That needs a geolocation
// database or a third party, and it guesses worse than the browser's own language
// setting, which is what a person in France has set to French when they want it.
// Search engines and link previews send no French preference, so they see the
// English pages, and every page is still reachable at its own address.
(function () {
  var KEY = 'sw-lang';

  function read() {
    try {
      return localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }
  function write(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (error) {
      /* private mode or blocked storage: the choice just is not remembered */
    }
  }

  // The language picker's options are addresses: /fr/… is French, anything else English.
  // Remembering the choice is what stops this script sending someone back to French
  // after they picked English on a page that has a French twin.
  document.addEventListener(
    'change',
    function (event) {
      var select = event.target;
      if (!select || !select.closest || !select.closest('starlight-lang-select')) return;
      write(select.value.indexOf('/fr/') === 0 || select.value === '/fr' ? 'fr' : 'en');
    },
    true,
  );

  if (document.documentElement.lang !== 'en' || read() !== null) return;

  var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  if (String(languages[0] || '').toLowerCase().indexOf('fr') !== 0) return;

  // The page's own hreflang says where its French twin is, and is absent on a
  // page with none (the 404), so nothing is guessed.
  function go() {
    var twin = document.querySelector('link[rel="alternate"][hreflang="fr"]');
    if (!twin) return false;
    // Only the path: the link carries the address the site was built for, which
    // is not the host of a preview or of a local run.
    var path = new URL(twin.href).pathname;
    if (path !== location.pathname) location.replace(path + location.search + location.hash);
    return true;
  }
  if (!go()) document.addEventListener('DOMContentLoaded', go);
})();
