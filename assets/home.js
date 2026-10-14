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

  document.addEventListener('DOMContentLoaded', async () => {
    const mapElement = document.getElementById('home-map');
    const status = document.getElementById('home-shops-status');
    const fallback = document.getElementById('home-map-fallback');
    let shops = [];
    let unavailable = false;
    try {
      if (!window.HCCrawl) throw new Error('Crawl information is unavailable.');
      const result = await HCCrawl.loadShops('puy-coffee');
      if (result.error) throw result.error;
      shops = result.shops || [];
    } catch (error) {
      unavailable = true;
      console.warn('Unable to load homepage shops:', error);
    }
    status.textContent = unavailable
      ? 'Shop information is temporarily unavailable. Please try again shortly.'
      : shops.length
        ? `${shops.length} participating ${shops.length === 1 ? 'shop' : 'shops'} on the map.`
        : 'Shops will appear here as they join. The map is centered on downtown Puyallup.';
    const map = window.HCCrawl?.initMap(mapElement, shops, { lat: 47.191, lng: -122.293 });
    if (!map) fallback.classList.remove('hidden');
  });
})();
