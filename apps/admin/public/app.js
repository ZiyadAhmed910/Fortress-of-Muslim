const authBase = location.hostname.startsWith('admin-test.') ? 'https://auth-test.fortressofmuslim.org' : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8788' : 'https://auth.fortressofmuslim.org';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { session: null, loaded: new Set() };
const resourceNames = { 'api-keys':'API keys','oauth-clients':'Connected apps',devices:'Devices','mcp-servers':'MCP servers','named-queries':'Named queries' };

for (const section of $$('[data-resource]')) {
  const name = resourceNames[section.dataset.resource];
  $('resource-header', section).outerHTML = `<header><div><span class="kicker">PLATFORM RESOURCES</span><h1>${name}</h1><p>Inspect ownership and change access state across the platform.</p></div></header>`;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-message').textContent = 'Signing in...';
  try { await api('/api/auth/sign-in/email', { method:'POST', body:Object.fromEntries(new FormData(event.currentTarget)) }); await bootstrap(); }
  catch (error) { $('#login-message').textContent = error.message; }
});
$$('[data-sign-out]').forEach((button) => button.addEventListener('click', async () => { await api('/api/auth/sign-out',{method:'POST'}).catch(()=>{}); location.reload(); }));
$('[data-profile]').addEventListener('click', () => { const menu=$('[data-profile-menu]'); menu.hidden=!menu.hidden; $('[data-profile]').setAttribute('aria-expanded',String(!menu.hidden)); });
document.addEventListener('click',(event)=>{if(!event.target.closest('[data-profile], [data-profile-menu]')) $('[data-profile-menu]').hidden=true;});
$('[data-menu]').addEventListener('click',()=>$('#console').classList.toggle('nav-open'));
$('[data-scrim]').addEventListener('click',()=>$('#console').classList.remove('nav-open'));
$$('[data-nav]').forEach((link)=>link.addEventListener('click',()=>$('#console').classList.remove('nav-open')));

window.addEventListener('hashchange', route);
document.addEventListener('keydown',(event)=>{if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();$('#global-search input').focus();}});
$('#global-search').addEventListener('submit',(event)=>{event.preventDefault();const q=new FormData(event.currentTarget).get('q');location.hash='search';$('#search-form input').value=q;runSearch(q);});
$('#search-form').addEventListener('submit',(event)=>{event.preventDefault();runSearch(new FormData(event.currentTarget).get('q'));});
$$('[data-filter]').forEach((form)=>form.addEventListener('submit',(event)=>{event.preventDefault();loadView(form.dataset.filter,true,Object.fromEntries(new FormData(form)));}));
$('[data-refresh]').addEventListener('click',()=>loadOverview(true));

async function bootstrap(){
  let session;
  try { session=await api('/api/auth/get-session'); } catch { session=null; }
  if(!session?.user){$('#login').hidden=false;$('#console').hidden=true;return;}
  try { state.session=(await api('/v1/admin/session')).data; }
  catch(error){if(error.status===403){$('#denied').hidden=false;$('#login').hidden=true;return;}throw error;}
  $('#login').hidden=true;$('#denied').hidden=true;$('#console').hidden=false;
  $('[data-user-name]').textContent=state.session.user.name;$('[data-user-email]').textContent=state.session.user.email;$('[data-role]').textContent=state.session.role.replace('_',' ');
  $('[data-initials]').textContent=initials(state.session.user.name||state.session.user.email);route();
}

function route(){
  let id=location.hash.slice(1)||'overview';if(!document.getElementById(id)?.classList.contains('view'))id='overview';
  $$('.view').forEach((view)=>view.hidden=view.id!==id);$$('[data-nav]').forEach((link)=>link.classList.toggle('active',link.hash===`#${id}`));
  loadView(id);
}

async function loadView(id,force=false,params={}){
  if(state.loaded.has(id)&&!force)return;
  try{
    if(id==='overview')await loadOverview(force);
    else if(id==='users')await loadUsers(params);
    else if(id==='content')await loadContent(params);
    else if(id==='services')await loadServices();
    else if(id==='audit')await loadAudit(params);
    else if(resourceNames[id])await loadResources(id);
    state.loaded.add(id);
  }catch(error){notify(error.message,true);}
}

async function loadOverview(){
  const data=(await api('/v1/admin/overview')).data;const labels={users:'Users',apiKeys:'Active API keys',oauthClients:'Connected apps',devices:'Active devices',mcpServers:'MCP servers',pendingRequests:'Pending requests',content:'Content records'};
  $('#metrics').innerHTML=Object.entries(data.counts).map(([key,value])=>`<div class="metric"><span>${labels[key]}</span><strong>${value}</strong></div>`).join('');
  $('#overview-services').innerHTML=data.services.map(service=>`<div class="service-line"><span><strong>${esc(service.displayName)}</strong><small>${esc(service.enforcement)} enforcement</small></span><span class="badge ${service.status}">${esc(service.status)}</span></div>`).join('');
  $('#overview-audit').innerHTML=data.audit.length?data.audit.map(item=>`<div class="audit-line"><span><strong>${esc(human(item.action))}</strong><small>${esc(item.targetType)} · ${esc(item.targetId||'platform')}</small></span><small>${date(item.occurredAt)}</small></div>`).join(''):'<p class="empty">No admin changes yet.</p>';
}

async function runSearch(value){
  const q=String(value||'').trim();if(q.length<2)return;const data=(await api(`/v1/admin/search?q=${encodeURIComponent(q)}`)).data;
  $('#search-results').innerHTML=data.length?data.map(item=>`<button class="search-item" data-result-type="${esc(item.type)}" data-result-id="${esc(item.id)}"><span class="badge">${esc(human(item.type))}</span><span><strong>${esc(item.label)}</strong><small>${esc(item.detail||item.id)}</small></span><span>Open</span></button>`).join(''):'<p class="empty">No matching platform records.</p>';
}
$('#search-results').addEventListener('click',(event)=>{const item=event.target.closest('[data-result-type]');if(!item)return;if(item.dataset.resultType==='user')showUser(item.dataset.resultId);else{const map={'api-key':'api-keys','oauth-client':'oauth-clients','device':'devices','mcp-server':'mcp-servers','named-query':'named-queries','content':'content'};location.hash=map[item.dataset.resultType]||'search';}});

async function loadUsers(params={}){
  const search=new URLSearchParams(params);const rows=(await api(`/v1/admin/users?${search}`)).data;
  $('#users-table').innerHTML=tableHead(['User','Plan','Credentials','Status',''])+rows.map(user=>`<div class="row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span><span>${esc(user.planCode)}</span><span>${user.apiKeyCount} keys · ${user.oauthClientCount} apps</span><span class="badge ${user.status}">${esc(user.status)}</span><span class="actions"><button data-user-view="${esc(user.id)}">Inspect</button>${user.status==='active'?`<button class="danger" data-user-status="suspended" data-id="${esc(user.id)}">Suspend</button>`:`<button data-user-status="active" data-id="${esc(user.id)}">Activate</button>`}</span></div>`).join('')||empty();
}
$('#users-table').addEventListener('click',async(event)=>{const view=event.target.closest('[data-user-view]');if(view)return showUser(view.dataset.userView);const button=event.target.closest('[data-user-status]');if(!button)return;const status=button.dataset.userStatus;if(await confirmChange(`${human(status)} user`,`This immediately ${status==='active'?'restores account access':'ends active sessions and blocks credentials'}.`)){await api(`/v1/admin/users/${encodeURIComponent(button.dataset.id)}`,{method:'PATCH',body:{status}});notify(`User ${status}.`);loadUsers();loadOverview();}});

async function showUser(id){
  const data=(await api(`/v1/admin/users/${encodeURIComponent(id)}`)).data;const dialog=document.createElement('dialog');dialog.className='detail-dialog';
  dialog.innerHTML=`<form method="dialog"><h2>${esc(data.user.name)}</h2><p>${esc(data.user.email)} · ${esc(data.user.status)} · ${esc(data.user.planCode)}</p><div class="metrics"><div class="metric"><span>API keys</span><strong>${data.apiKeys.length}</strong></div><div class="metric"><span>Apps</span><strong>${data.oauthClients.length}</strong></div><div class="metric"><span>Devices</span><strong>${data.devices.length}</strong></div><div class="metric"><span>MCP</span><strong>${data.mcpServers.length}</strong></div></div><code>${esc(data.user.id)}</code><div><button>Close</button></div></form>`;document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}

async function loadResources(type){
  const rows=(await api(`/v1/admin/resources?type=${encodeURIComponent(type)}`)).data;const target=$(`#${type} .resource-table`);
  target.innerHTML=tableHead(['Resource','Owner','Created','Status',''])+rows.map(row=>{const current=resourceStatus(type,row.status);return `<div class="row"><span><strong>${esc(row.name||row.start||row.id)}</strong><small>${esc(row.id)}</small></span><span><strong>${esc(row.ownerName||'Unknown')}</strong><small>${esc(row.ownerEmail||'')}</small></span><span>${date(row.createdAt)}</span><span class="badge ${current}">${esc(current)}</span><span class="actions">${resourceActions(type,row.id,current)}</span></div>`;}).join('')||empty();
}
document.addEventListener('click',async(event)=>{const button=event.target.closest('[data-resource-status]');if(!button)return;const {type,id,resourceStatus:status}=button.dataset;if(await confirmChange(`${human(status)} ${human(type)}`,`This changes the resource to ${human(status)} immediately.`)){await api(`/v1/admin/${type}/${encodeURIComponent(id)}/status`,{method:'POST',body:{status}});notify('Resource status updated.');loadResources(type);loadOverview();}});

async function loadContent(params={}){const search=new URLSearchParams(params);const rows=(await api(`/v1/admin/content?${search}`)).data;$('#content-table').innerHTML=tableHead(['Record','Type','Sequence','Status',''])+rows.map(row=>`<div class="row"><span><strong>${esc(row.title)}</strong><small>${esc(row.id)}</small></span><span>${esc(row.contentType)}</span><span>${row.sequence}</span><span class="badge ${row.status}">${esc(row.status)}</span><span class="actions"><select data-content-status="${esc(row.id)}"><option>${esc(row.status)}</option>${['pending','verified','rejected','deprecated'].filter(x=>x!==row.status).map(x=>`<option>${x}</option>`).join('')}</select></span></div>`).join('')||empty();}
$('#content-table').addEventListener('change',async(event)=>{const select=event.target.closest('[data-content-status]');if(!select)return;await api(`/v1/admin/content/${encodeURIComponent(select.dataset.contentStatus)}`,{method:'PATCH',body:{status:select.value}});notify('Verification state updated.');loadContent();});

async function loadServices(){const rows=(await api('/v1/admin/services')).data;$('#services-grid').innerHTML=rows.map(service=>`<article class="service-card"><header><strong>${esc(service.displayName)}</strong><span class="badge ${service.status}">${esc(service.status)}</span></header><p>${esc(service.serviceType)} · ${esc(service.enforcement)} enforcement</p><small>${esc(service.maintenanceMessage)}</small><footer><code>${esc(service.serviceKey)}</code><div>${service.enforcement==='worker'&&service.serviceKey!=='admin'?['active','maintenance','disabled'].filter(x=>x!==service.status).map(status=>`<button class="${status==='disabled'?'danger':''}" data-service="${esc(service.serviceKey)}" data-service-status="${status}">${human(status)}</button>`).join(''):'<span class="badge">monitor only</span>'}</div></footer></article>`).join('');}
$('#services-grid').addEventListener('click',async(event)=>{const button=event.target.closest('[data-service]');if(!button)return;const status=button.dataset.serviceStatus;if(await confirmChange(`${human(status)} ${button.dataset.service}`,status==='active'?'Requests will resume after the edge state propagates.':'Protected API routes will return HTTP 503. Health checks remain available for recovery.')){await api(`/v1/admin/services/${button.dataset.service}`,{method:'PATCH',body:{status,message:'Fortress Platform is temporarily unavailable while maintenance is in progress.'}});notify('Service state updated.');loadServices();loadOverview();}});

async function loadAudit(params={}){const search=new URLSearchParams(params);const rows=(await api(`/v1/admin/audit?${search}`)).data;$('#audit-table').innerHTML=tableHead(['Action','Actor','Target','Time','Request'])+rows.map(row=>`<div class="row"><span><strong>${esc(human(row.action))}</strong><small>${esc(row.action)}</small></span><span>${esc(row.actorName)}</span><span><strong>${esc(row.targetType)}</strong><small>${esc(row.targetId||'')}</small></span><span>${date(row.occurredAt)}</span><code>${esc(row.requestId||'')}</code></div>`).join('')||empty();}

function resourceStatus(type,value){if(type==='api-keys')return Number(value)===1?'active':'revoked';if(type==='oauth-clients')return Number(value)===1?'disabled':'active';return String(value);}
function resourceActions(type,id,status){if(type==='api-keys')return status==='active'?actionButton(type,id,'revoked','Revoke'):'';if(type==='oauth-clients')return actionButton(type,id,status==='active'?'disabled':'active',status==='active'?'Disable':'Activate');if(type==='devices')return status==='active'?actionButton(type,id,'revoked','Revoke'):actionButton(type,id,'active','Activate');if(type==='named-queries')return actionButton(type,id,status==='active'?'disabled':'active',status==='active'?'Disable':'Activate');if(type==='mcp-servers')return `${status!=='published'?actionButton(type,id,'published','Publish'):''}${status!=='disabled'?actionButton(type,id,'disabled','Disable'):actionButton(type,id,'draft','Restore draft')}`;return '';}
function actionButton(type,id,status,label){return `<button class="${/revoked|disabled|rejected/.test(status)?'danger':''}" data-resource-status="${status}" data-type="${type}" data-id="${esc(id)}">${label}</button>`;}
function tableHead(columns){return `<div class="row head">${columns.map(x=>`<span>${x}</span>`).join('')}</div>`;}function empty(){return '<p class="empty">No records found.</p>';}
async function confirmChange(title,copy){const dialog=$('#confirm');$('[data-confirm-title]').textContent=title;$('[data-confirm-copy]').textContent=copy;dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
function notify(message,error=false){const toast=$('#toast');toast.textContent=message;toast.style.borderLeftColor=error?'#d56b6b':'#66c1bd';toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,4500);}
async function api(path,options={}){const headers=new Headers(options.headers||{});let body=options.body;if(body&&typeof body!=='string'){headers.set('Content-Type','application/json');body=JSON.stringify(body);}const response=await fetch(`${authBase}${path}`,{...options,headers,body,credentials:'include'});const data=response.status===204?null:await response.json().catch(()=>null);if(!response.ok){const error=new Error(data?.error?.message||data?.message||`Request failed (${response.status}).`);error.status=response.status;throw error;}return data;}
function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}function human(value){return String(value||'').replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());}function initials(value){return String(value).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();}function date(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString();}

bootstrap().catch(error=>{$('#login').hidden=false;$('#login-message').textContent=error.message;});
