/* Puyallup-only seasonal skin. Uses the existing live card model, never a static roster. */
(function () {
  const escape = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lights=`<svg class="holiday-lights" viewBox="0 0 660 42" aria-hidden="true"><path d="M0 3 Q165 46 330 3 Q495 46 660 3" fill="none" stroke="#75685B" stroke-width="1.8"/>${[20,72,125,178,230,282,348,400,452,505,558,620].map((x,i)=>{let y=x<330?3+21*(1-Math.pow((x-165)/165,2)):3+21*(1-Math.pow((x-495)/165,2));return `<g transform="translate(${x} ${y}) rotate(${i%2?12:-12})"><path d="M-3 0h6v4h-6z" fill="#75685B"/><ellipse cy="10" rx="4.6" ry="7" fill="${['#AD4424','#C49A50','#87917B'][i%3]}"/><path d="M-1.5 6v4" stroke="#FFFAF1" stroke-width="1" stroke-linecap="round"/></g>`}).join('')}</svg>`;


  function page(m, shops, offset) {
    const crowded = shops.length > 15;
    const compact = shops.length > 22;
    const size = compact ? 46 : crowded ? 62 : 82;
    const columns = crowded ? 6 : 5;
    const keyRows = Math.max(1, Math.ceil(shops.length / 2));
    const title = offset ? 'Puyallup Holiday Coffee Crawl · continued' : 'Puyallup Holiday Coffee Crawl';
    return `<section class="holiday-sheet"><article class="holiday-card ${crowded ? 'holiday-crowded' : ''} ${compact ? 'holiday-compact' : ''}" style="--stamp-size:${size}px;--stamp-columns:${columns};--key-rows:${keyRows}">
      ${lights}
      <header class="holiday-header"><div><span class="holiday-brand"><img src="/assets/home/wordmark-phone.png" alt="Hometown Crawls"></span><h1>${title}</h1><p class="holiday-intro">One ink stamp at each participating shop.</p></div><img class="holiday-mascot" src="/assets/home/winter-hat-passport.png" alt="Phone mascot wearing an orange winter hat and holding a passport"></header>
      <div class="holiday-section-label"><h2>Your stamps</h2><p>Match the numbers to the shop key below</p></div>
      <div class="holiday-stamp-grid">${shops.map((s,i)=>`<div class="holiday-stamp" aria-label="${escape(s)}, stamp ${offset+i+1}">${offset+i+1}</div>`).join('')}</div>
      <div class="holiday-section-label"><h2>Participating shops</h2></div>
      <div class="holiday-key">${shops.map((s,i)=>`<div class="holiday-key-row"><span class="holiday-key-no">${String(offset+i+1).padStart(2,'0')}</span><span class="holiday-key-name">${escape(s)}</span></div>`).join('')}</div>
      <section class="holiday-participant"><div class="holiday-field"><span>Name</span><b>${escape(m.playerName || '')}</b></div><div class="holiday-field"><span>Email</span><b>${escape(m.playerEmail || '')}</b></div><div class="holiday-field holiday-signup"><span>Signed up at</span><b>${escape(m.signupShop || '')}</b></div></section>
      <section class="holiday-rules"><div><h2>How to play</h2><ul><li>Sign up with your name, email, and phone.</li><li>Visit the participating shops.</li><li>Get an ink stamp at each shop.</li><li>Bring your finished card to a co-organizer shop (e.g. Holiday Cafe, Anthem).</li><li>Show some love if you can and buy something at the shop.</li></ul></div><div><p class="holiday-prize"><strong>NO PURCHASE NECESSARY.</strong> Each stamped stop is one prize entry. A finished card adds 3 bonus entries.</p><p class="holiday-turnin"><b>Turn in your card</b>Bring your finished card to a co-organizer shop.${m.turnIn && m.turnIn.length ? '<br>'+escape(m.turnIn.join(', ')) : ''}</p></div></section>
      <footer class="holiday-footer">Puyallup Holiday Coffee Crawl<span>Hometown Crawls</span></footer>
    </article></section>`;
  }
  function markup(model) {
    if (model.crawlId !== 'puy-coffee') return '';
    const shops = model.shops || [];
    const pages = [];
    for (let i = 0; i < Math.max(1, shops.length); i += 30) pages.push(page(model, shops.slice(i, i + 30), i));
    return pages.join('');
  }
  function render(root, model) { root.innerHTML = markup(model); }
  window.HCHolidayCard = { markup, render };
})();
