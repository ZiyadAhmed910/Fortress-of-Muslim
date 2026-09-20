const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sections = $$('[data-search-title]');
const authBase = location.hostname.startsWith('developers-test.') ? 'https://auth-test.fortressofmuslim.org' : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8788' : 'https://auth.fortressofmuslim.org';
const REQUEST_TIMEOUT_MS = 12_000;
let searchReturnFocus = null;

function openSearch() { searchReturnFocus = document.activeElement; $('.search-dialog').hidden = false; document.body.style.overflow = 'hidden'; $('#doc-search').focus(); }
function closeSearch() { const wasOpen = !$('.search-dialog').hidden; $('.search-dialog').hidden = true; document.body.style.overflow = ''; if (wasOpen && searchReturnFocus?.focus) searchReturnFocus.focus(); searchReturnFocus = null; }
$('[data-search-open]').addEventListener('click', openSearch); $('[data-search-close]').addEventListener('click', closeSearch);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  if (event.key === 'Escape') { closeSearch(); closeProfile(true); }
  const menu = event.target.closest?.('[role="menu"]');
  if (menu && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); const items=$$('[role="menuitem"]',menu).filter((item)=>!item.hidden); const offset=event.key==='ArrowDown'?1:-1; items[(items.indexOf(document.activeElement)+offset+items.length)%items.length]?.focus(); }
});
$('#doc-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLocaleLowerCase();
  const matches = query ? sections.filter((section) => section.textContent.toLocaleLowerCase().includes(query)).slice(0,10) : [];
  $('#search-results').innerHTML = !query ? '<p>Start typing to search this page.</p>' : matches.length ? matches.map((section) => `<a class="search-result" href="#${section.id}"><strong>${esc(section.dataset.searchTitle)}</strong><small>${esc(section.querySelector('p')?.textContent.slice(0,110) || 'API documentation')}</small></a>`).join('') : '<p>No documentation matched that search.</p>';
  $$('#search-results a').forEach((link) => link.addEventListener('click', closeSearch));
});

$$('[data-code-group]').forEach((group) => $$('[data-code-tab]',group).forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-code-tab]',group).forEach((item) => item.classList.toggle('active',item === tab));
  $$('[data-code-panel]',group).forEach((panel) => { const active = panel.dataset.codePanel === tab.dataset.codeTab; panel.hidden = !active; panel.classList.toggle('active-code',active); });
})));

const navLinks = $$('#doc-nav a[href^="#"]');
const observer = new IntersectionObserver((entries) => { const visible = entries.filter((entry) => entry.isIntersecting).sort((a,b) => b.intersectionRatio-a.intersectionRatio)[0]; if (visible) navLinks.forEach((link) => link.classList.toggle('active',link.hash === `#${visible.target.id}`)); }, { rootMargin:'-20% 0px -65%',threshold:[0,.2,.6] });
sections.forEach((section) => observer.observe(section)); navLinks.forEach((link) => link.addEventListener('click', () => document.body.classList.remove('nav-open')));

const explorerKey = $('#explorer-key'); const credentialSelect = $('#explorer-credential');
explorerKey.value = localStorage.getItem('fortress-explorer-key') || '';
explorerKey.addEventListener('input', () => { localStorage.setItem('fortress-explorer-key',explorerKey.value.trim()); credentialSelect.value = ''; });
credentialSelect.addEventListener('change', () => { if (credentialSelect.value) { explorerKey.value = credentialSelect.value; localStorage.setItem('fortress-explorer-key',credentialSelect.value); } });
loadBrowserKeys(); const savedPath = sessionStorage.getItem('fortress-explorer-path'); if (savedPath) { $('#api-path').value = savedPath; sessionStorage.removeItem('fortress-explorer-path'); }
$$('[data-explorer-path]').forEach((link) => link.addEventListener('click', () => { $('#api-path').value = link.dataset.explorerPath; }));
$('#send-request').addEventListener('click', async () => {
  const path = $('#api-path').value.trim(); if (!path.startsWith('/')) return setResponse('Invalid path',{error:{message:'Path must begin with /.'}},true);
  const key = explorerKey.value.trim();
  const button = $('#send-request'); button.disabled = true; $('#response-state').textContent = 'Loading'; $('#response-body').textContent = 'Sending request...'; const started = performance.now();
  try { const headers = {'X-Request-ID':crypto.randomUUID(),...(key ? {'X-Fortress-API-Key':key} : {})}; const response = await fetch(`${$('#environment').value}${path}`,{headers,signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)}); const text=await response.text(); let data; try{data=text?JSON.parse(text):null;}catch{data={error:{message:'The API returned an unreadable response.',requestId:response.headers.get('X-Request-ID')}};} setResponse(`${response.status} ${response.ok?'OK':'Error'}`,data,!response.ok); }
  catch(error){ setResponse('Network error',{error:{message:error?.name==='TimeoutError'?'The API request timed out. Please try again.':'The API could not be reached. Check your connection and try again.'}},true); }
  finally { $('#response-time').textContent = `${Math.round(performance.now()-started)} ms`; button.disabled = false; }
});
function setResponse(label,data,error){ $('#response-state').textContent=label; $('#response-state').className=`response-state ${error?'error':'ok'}`; $('#response-body').textContent=JSON.stringify(data,null,2); }

$('[data-profile-toggle]').addEventListener('click', () => { const menu=$('[data-profile-menu]'); menu.hidden=!menu.hidden; $('[data-profile-toggle]').setAttribute('aria-expanded',String(!menu.hidden)); if(!menu.hidden)$('[role="menuitem"]',menu)?.focus(); });
document.addEventListener('click',(event)=>{ if(!event.target.closest('.profile-menu')) closeProfile(); });
$('[data-profile-sign-out]').addEventListener('click', async (event) => { event.currentTarget.disabled=true; try{const response=await fetch(`${authBase}/api/auth/sign-out`,{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json','X-Request-ID':crypto.randomUUID()},body:'{}',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});if(!response.ok)throw new Error('Sign out failed.');await refreshProfile();closeProfile();}finally{event.currentTarget.disabled=false;} });
async function refreshProfile(){
  let user=null; try{ const response=await fetch(`${authBase}/api/auth/get-session`,{credentials:'include',cache:'no-store'}); if(response.ok) user=(await response.json())?.user; }catch{}
  const button=$('[data-profile-toggle]'); const identity=$('[data-profile-identity]'); $('[data-profile-sign-out]').hidden=!user;
  if(user){ button.classList.add('signed-in'); $('[data-profile-initials]').textContent=getInitials(user.name||user.email); identity.innerHTML=`<strong>${esc(user.name||'Developer')}</strong><small>${esc(user.email)}</small>`; }
  else { button.classList.remove('signed-in'); $('[data-profile-initials]').textContent=''; identity.innerHTML='<strong>Developer account</strong><small>Sign in to manage credentials</small>'; }
}
function closeProfile(returnFocus=false){ const wasOpen=!$('[data-profile-menu]').hidden; $('[data-profile-menu]').hidden=true; $('[data-profile-toggle]').setAttribute('aria-expanded','false'); if(wasOpen&&returnFocus)$('[data-profile-toggle]').focus(); }
function loadBrowserKeys(){ let keys=[]; try{ keys=JSON.parse(localStorage.getItem('fortress-browser-keys')||'[]'); }catch{} credentialSelect.innerHTML='<option value="">Paste a key</option>'+keys.map((item)=>`<option value="${esc(item.key)}">${esc(item.name)} (this device)</option>`).join(''); }
function getInitials(value){ return String(value).split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase(); }
function esc(value){ return String(value??'').replace(/[&<>'"]/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]); }
refreshProfile();
