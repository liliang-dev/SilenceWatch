// The width of the page without the scrollbar, as --sw-vw on the root element.
//
// The home page's hero and sections run from edge to edge of the window, which CSS
// can only say as 100vw, and 100vw counts the scrollbar where a system draws one
// beside the page (Windows, and macOS set to always show it): the page was then a
// scrollbar's width too wide and scrolled sideways. The stylesheet uses this value
// where it has it, and the root element clips sideways overflow regardless.
(function () {
  var root = document.documentElement;
  function measure() {
    root.style.setProperty('--sw-vw', root.clientWidth + 'px');
  }
  measure();
  window.addEventListener('resize', measure);
  document.addEventListener('DOMContentLoaded', measure);
})();
