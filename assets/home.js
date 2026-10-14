/* Homepage presentation only. Passport, payment and auth flows remain in crawl.js. */
(function () {
  const toggle = document.querySelector('.home-menu-toggle');
  const navigation = document.getElementById('home-navigation');
  function closeMenu(returnFocus) {
    navigation?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Open menu');
    if (returnFocus) toggle?.focus();
  }
  toggle?.addEventListener('click', () => {
    const open = navigation.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigation?.classList.contains('is-open')) closeMenu(true);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.home-nav')) closeMenu(false);
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', () => closeMenu(false));
})();
