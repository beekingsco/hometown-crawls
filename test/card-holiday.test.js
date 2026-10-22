const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function node(tag = 'div') {
  const classes = new Set();
  return { tag, children: [], dataset: {}, style: { setProperty() {} }, textContent: '', innerHTML: '',
    classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains: n => classes.has(n) },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; this.innerHTML = ''; },
    querySelectorAll() { return []; }, setAttribute() {}, addEventListener() {} };
}
function context(search = '') {
  const elements = Object.fromEntries(['card-sheets','card-status','card-print','card-print-instructions'].map(id => [id,node()]));
  const events = [];
  const document = { body: node('body'), documentElement: node('html'),
    getElementById: id => elements[id], createElement: node, createTextNode: text => ({textContent:text}),
    addEventListener: (event,fn) => events.push(fn) };
  const sandbox = { document, location: { search }, URLSearchParams, Intl, Date, requestAnimationFrame:fn=>fn() };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['assets/qrcode-generator.js','assets/card-holiday.js','assets/card-print.js']) vm.runInContext(read(file),sandbox);
  return {sandbox, elements, events, document};
}
const model = count => ({ crawlId:'puy-coffee',crawlName:'Puyallup Holiday Coffee Crawl',
  shops:Array.from({length:count},(_,i)=>`Shop ${i+1}`),playerName:'Sample Player',playerEmail:'sample@example.invalid',signupShop:'Sample Cafe',turnIn:['Sample Counter'] });

test('15 live shops produce one printable page and preserve fields', () => {
  const {sandbox} = context(); const html=sandbox.HCHolidayCard.markup(model(15));
  assert.equal((html.match(/class="holiday-sheet"/g)||[]).length,1);
  assert.equal((html.match(/class="holiday-stamp"/g)||[]).length,15);
  assert.equal((html.match(/class="holiday-key-row"/g)||[]).length,15);
  for (const value of ['Sample Player','sample@example.invalid','Sample Cafe','Sample Counter','NO PURCHASE NECESSARY.','A finished card adds 3 bonus entries.']) assert.ok(html.includes(value));
  assert.match(html,/winter-hat-passport\.png/); assert.match(html,/wordmark-phone\.png/);
});
test('22 shops stay on one page and 70 paginate without losing or renumbering stamp/key pairs', () => {
  const {sandbox} = context();
  for (const count of [22,70]) {
    const html=sandbox.HCHolidayCard.markup(model(count));
    assert.equal((html.match(/class="holiday-sheet"/g)||[]).length,Math.ceil(count/30));
    const stamps=[...html.matchAll(/class="holiday-stamp"[^>]*>(\d+)</g)].map(m=>Number(m[1]));
    const key=[...html.matchAll(/class="holiday-key-no">(\d+)</g)].map(m=>Number(m[1]));
    assert.deepEqual(stamps,Array.from({length:count},(_,i)=>i+1)); assert.deepEqual(key,stamps);
  }
});
test('empty roster has no invented shops', () => {
  const {sandbox}=context(); const html=sandbox.HCHolidayCard.markup(model(0));
  assert.equal((html.match(/class="holiday-stamp"/g)||[]).length,0);
});
test('live names and personalized fields are escaped, not treated as markup', () => {
  const {sandbox}=context(); const m=model(1);
  m.shops=['<img src=x onerror=alert(1)>']; m.playerName='<script>alert(1)</script>'; m.turnIn=['A & B'];
  const html=sandbox.HCHolidayCard.markup(m);
  assert.doesNotMatch(html,/<script>|<img src=x/); assert.match(html,/&lt;script&gt;/); assert.match(html,/A &amp; B/);
});
test('holiday skin is only selected for puy-coffee and switching clears print state', () => {
  const {sandbox,elements,document}=context();
  sandbox.HCCard.render(elements['card-sheets'],model(15));
  assert.ok(document.documentElement.classList.contains('holiday-print'));
  assert.match(elements['card-print-instructions'].textContent,/one portrait US Letter page/);
  const other={...model(2),crawlId:'other',crawlName:'Autumn Market',startsAt:'2026-11-01',endsAt:'2026-12-31'};
  assert.equal(sandbox.HCHolidayCard.markup(other),'');
  sandbox.HCCard.render(elements['card-sheets'],other);
  assert.equal(document.documentElement.classList.contains('holiday-print'),false);
  assert.equal(elements['card-sheets'].children.length,1);
  const strings=[]; const walk=n=>{strings.push(n.textContent||'',n.className||'',n.src||'');(n.children||[]).forEach(walk);};
  walk(elements['card-sheets']); const output=strings.join(' ');
  assert.match(output,/PARTICIPATING SHOPS/); assert.match(output,/NO PURCHASE NECESSARY/);
  assert.doesNotMatch(output,/HOLIDAY EDITION|card-lights|card-tree|winter-hat/);
});
test('date-only boundaries keep the calendar day; timestamps retain Pacific conversion', () => {
  const {sandbox}=context();
  assert.equal(sandbox.HCCard.formatDates('2026-11-01','2026-12-31'),'NOVEMBER 1 – DECEMBER 31, 2026');
  assert.equal(sandbox.HCCard.formatDates('2026-10-01T18:00:00Z','2026-12-01T06:59:00Z'),'OCTOBER 1 – NOVEMBER 30, 2026');
});
test('loader preserves live roster, named-player RPC, and turn-in data', async () => {
  const {sandbox,elements,events}=context('?crawl=puy-coffee&user=synthetic-player'); const calls=[];
  sandbox.HCCrawl={client:()=>({
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{name:'Puyallup Holiday Coffee Crawl'}})})})}),
    rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_public_crawl_shops'?[{display_name:'Live Shop'}]:name==='card_turn_in_shops'?[{display_name:'Live Turn-in'}]:[{player_name:'Live Player',player_email:'live@example.invalid',signup_shop:'Live Signup'}]};}
  })};
  events.forEach(fn=>fn()); await new Promise(resolve=>setImmediate(resolve));
  const html=elements['card-sheets'].innerHTML;
  for(const expected of ['Live Shop','Live Player','live@example.invalid','Live Signup','Live Turn-in'])assert.ok(html.includes(expected));
  assert.ok(calls.some(([name,args])=>name==='organizer_player_card'&&args.p_user==='synthetic-player'));
});
test('blank card never fetches participant personal details', async () => {
  const {sandbox,elements,events}=context('?crawl=puy-coffee&blank=1&user=synthetic-player');const calls=[];
  sandbox.HCCrawl={client:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{name:'Puyallup Holiday Coffee Crawl'}})})})}),rpc:async name=>{calls.push(name);return {data:[]};}})};
  events.forEach(fn=>fn()); await new Promise(resolve=>setImmediate(resolve));
  assert.ok(elements['card-sheets'].innerHTML);assert.ok(!calls.includes('organizer_player_card'));assert.ok(!calls.includes('my_paper_card'));
});

 test('holiday header displays only lettering and the single winter mascot', () => {
 const {sandbox}=context();const html=sandbox.HCHolidayCard.markup(model(15));
 assert.match(html,/<span class="holiday-brand"><img/);
 assert.equal((html.match(/class="holiday-mascot"/g)||[]).length,1);
 assert.match(read('assets/card-holiday.css'),/holiday-brand\{[^}]*overflow:hidden/);
});

test('holiday card shows the crawl name, website, and a QR code for the public page', () => {
  const {sandbox} = context();
  const html = sandbox.HCHolidayCard.markup({
    crawlId: 'puy-coffee',
    crawlName: 'Downtown Puyallup Holiday Coffee Crawl',
    publicUrl: 'https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl',
    shops: ['Live Shop'],
    playerName: '',
    playerEmail: '',
    signupShop: '',
    turnIn: []
  });
  assert.match(html, />Downtown Puyallup Holiday Coffee Crawl</);
  assert.match(html, /hometowncrawls\.com\/puyallup\/holiday-coffee-crawl/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /Happy Donuts|Anthem Coffee/);
  assert.equal(sandbox.HCHolidayCard.publicUrl({ publicUrl: 'https://evil.example/old-slug' }), 'https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl');
  const qr = sandbox.qrcode(0, 'M');
  qr.addData('https://www.hometowncrawls.com/puyallup/holiday-coffee-crawl');
  qr.make();
  assert.match(html, new RegExp(qr.createSvgTag({ cellSize: 2, margin: 4, scalable: true }).split('<path')[1].slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const vercel = read('vercel.json');
  for (const source of ['/play', '/puyallupwa/coffee', '/puyallupwa/pub']) {
    assert.match(vercel, new RegExp('"source": "' + source + '"[\\s\\S]*?"destination": "/puyallup/holiday-coffee-crawl"'));
  }
});

test('no static PDF or hardcoded shop list is shipped',()=>{
 assert.doesNotMatch(read('card.html'),/card-pdf-download|15-shop|assets\/downloads/);
 assert.match(read('card.html'),/Print \/ Save as PDF/);
 assert.equal(fs.existsSync(path.join(root,'assets/downloads/puyallup-holiday-coffee-crawl.pdf')),false);
 for(const file of ['assets/card-print.js','assets/card-holiday.js']){
  const example = "Bring your finished card to a co-organizer shop (e.g. Holiday Cafe, Anthem).";
  assert.match(read(file), /How to play/);
  assert.match(read(file), /e\.g\. Holiday Cafe, Anthem/);
  assert.doesNotMatch(read(file).split(example).join(''), /Holiday Cafe|Anthem|ANTHEM/);
 }
});
function liveClient(sandbox, provider) {
 sandbox.HCCrawl={client:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{name:'Live crawl'}})})})}),
 rpc:async name=>name==='get_public_crawl_shops'?provider():{data:[]}})};
}
test('each print refreshes roster, waits for fonts/images, and prevents duplicate clicks',async()=>{
 const {sandbox,elements,document}=context('?crawl=puy-coffee&blank=1');let names=['First Shop'],calls=0,printed=0;
 liveClient(sandbox,async()=>{calls++;return {data:names.map(display_name=>({display_name}))};});
 sandbox.print=()=>{printed++;assert.ok(elements['card-sheets'].innerHTML.includes('New Paid Shop'));};
 assert.equal(await sandbox.HCCard.load(),true);assert.ok(elements['card-sheets'].innerHTML.includes('First Shop'));
 names=['New Paid Shop','Second Paid Shop'];
 let releaseFont,releaseImage,decoded=false;
 document.fonts={ready:new Promise(r=>releaseFont=r)};
 elements['card-sheets'].querySelectorAll=()=>[{naturalWidth:1024,decode:()=>new Promise(r=>{decoded=true;releaseImage=r;})}];
 const printing=sandbox.HCCard.printCard();await new Promise(r=>setImmediate(r));
 assert.equal(printed,0);assert.equal(decoded,false);assert.equal(elements['card-print'].disabled,true);
 assert.equal(await sandbox.HCCard.printCard(),false);releaseFont();await new Promise(r=>setImmediate(r));
 assert.equal(decoded,true);assert.equal(printed,0);releaseImage();assert.equal(await printing,true);
 assert.equal(printed,1);assert.equal(calls,2);assert.equal(elements['card-print'].disabled,false);
 assert.ok(!elements['card-sheets'].innerHTML.includes('First Shop'));
});
test('failed or empty live roster never prints stale content and retry recovers',async()=>{
 const {sandbox,elements}=context('?crawl=puy-coffee&blank=1');let fail=false,empty=false,printed=0;
 liveClient(sandbox,async()=>{if(fail)throw Error('network');return {data:empty?[]:[{display_name:'Current Shop'}]};});sandbox.print=()=>printed++;
 await sandbox.HCCard.load();fail=true;assert.equal(await sandbox.HCCard.printCard(),false);
 assert.equal(printed,0);assert.equal(elements['card-sheets'].innerHTML,'');assert.match(elements['card-status'].textContent,/Could not refresh/);
 fail=false;empty=true;assert.equal(await sandbox.HCCard.printCard(),false);assert.equal(printed,0);
 empty=false;assert.equal(await sandbox.HCCard.printCard(),true);assert.equal(printed,1);
});
test('RPC error and failed image decode block printing',async()=>{
 const {sandbox,elements}=context('?crawl=puy-coffee&blank=1');let printed=0;
 sandbox.print=()=>printed++;liveClient(sandbox,async()=>({error:{message:'denied'},data:null}));
 assert.equal(await sandbox.HCCard.printCard(),false);assert.equal(printed,0);
 liveClient(sandbox,async()=>({data:[{display_name:'Current Shop'}]}));
 elements['card-sheets'].querySelectorAll=()=>[{naturalWidth:0,decode:async()=>{throw Error('image');}}];
 assert.equal(await sandbox.HCCard.printCard(),false);assert.equal(printed,0);assert.equal(elements['card-print'].disabled,false);
});
