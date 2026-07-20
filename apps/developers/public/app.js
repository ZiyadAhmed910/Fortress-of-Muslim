const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sections = $$('[data-search-title]');
const authBase = location.hostname.startsWith('developers-test.') ? 'https://auth-test.fortressofmuslim.org' : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8788' : 'https://auth.fortressofmuslim.org';

function openSearch() { $('.search-dialog').hidden = false; document.body.style.overflow = 'hidden'; $('#doc-search').focus(); }
function closeSearch() { $('.search-dialog').hidden = true; document.body.style.overflow = ''; }
$('[data-search-open]').addEventListener('click', openSearch); $('[data-search-close]').addEventListener('click', closeSearch);
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } if (event.key === 'Escape') { closeSearch(); closeProfile(); } });
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
  try { const headers = key ? {'X-Fortress-API-Key':key} : {}; const response = await fetch(`${$('#environment').value}${path}`,{headers}); setResponse(`${response.status} ${response.ok?'OK':'Error'}`,await response.json(),!response.ok); }
  catch(error){ setResponse('Network error',{error:{message:error.message}},true); }
  finally { $('#response-time').textContent = `${Math.round(performance.now()-started)} ms`; button.disabled = false; }
});
function setResponse(label,data,error){ $('#response-state').textContent=label; $('#response-state').className=`response-state ${error?'error':'ok'}`; $('#response-body').textContent=JSON.stringify(data,null,2); }

$('[data-profile-toggle]').addEventListener('click', () => { const menu=$('[data-profile-menu]'); menu.hidden=!menu.hidden; $('[data-profile-toggle]').setAttribute('aria-expanded',String(!menu.hidden)); });
document.addEventListener('click',(event)=>{ if(!event.target.closest('.profile-menu')) closeProfile(); });
$('[data-profile-sign-out]').addEventListener('click', async () => { await fetch(`${authBase}/api/auth/sign-out`,{method:'POST',credentials:'include'}); await refreshProfile(); closeProfile(); });
async function refreshProfile(){
  let user=null; try{ const response=await fetch(`${authBase}/api/auth/get-session`,{credentials:'include'}); if(response.ok) user=(await response.json())?.user; }catch{}
  const button=$('[data-profile-toggle]'); const identity=$('[data-profile-identity]'); $('[data-profile-sign-out]').hidden=!user;
  if(user){ button.classList.add('signed-in'); $('[data-profile-initials]').textContent=getInitials(user.name||user.email); identity.innerHTML=`<strong>${esc(user.name||'Developer')}</strong><small>${esc(user.email)}</small>`; }
  else { button.classList.remove('signed-in'); $('[data-profile-initials]').textContent=''; identity.innerHTML='<strong>Developer account</strong><small>Sign in to manage credentials</small>'; }
}
function closeProfile(){ $('[data-profile-menu]').hidden=true; $('[data-profile-toggle]').setAttribute('aria-expanded','false'); }
function loadBrowserKeys(){ let keys=[]; try{ keys=JSON.parse(localStorage.getItem('fortress-browser-keys')||'[]'); }catch{} credentialSelect.innerHTML='<option value="">Paste a key</option>'+keys.map((item)=>`<option value="${esc(item.key)}">${esc(item.name)} (this device)</option>`).join(''); }
function getInitials(value){ return String(value).split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase(); }
function esc(value){ return String(value??'').replace(/[&<>'"]/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[character]); }
refreshProfile();
