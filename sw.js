/* Mi Día: service worker.
   Todo el contenido de la app está cifrado (AES-GCM) en v/<id>.bin. La llave solo existe en este
   dispositivo (IndexedDB, no exportable) después de escribir el código de verificación una vez.
   Los archivos cifrados se guardan en caché para funcionar sin internet; se descifran al pedirlos. */
const SHELL_V='shell-20261107-201144';
const VC='midia-vault',FC='midia-fonts';
const BASE=new URL('./',self.location).href;
const APP=BASE+'app/';
const SHELL=['./','index.html','sync.js','manifest.webmanifest','icon-192.png','icon-512.png','icon-mask-512.png','apple-touch-icon.png','v/key.json'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL_V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('shell-')&&k!==SHELL_V)await caches.delete(k);await self.clients.claim()})())});

function db(){return new Promise((ok,no)=>{const r=indexedDB.open('midia-vault',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function getKey(){try{const d=await db();return await new Promise((ok,no)=>{const r=d.transaction('kv').objectStore('kv').get('k');r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error)})}catch(e){return null}}

async function current(){const c=await caches.open(VC);const r=await c.match(BASE+'v/current-list');return r?r.json():null}
async function blob(id){const c=await caches.open(VC);const u=BASE+'v/'+id+'.bin';let r=await c.match(u);
  if(!r){r=await fetch(u,{cache:'no-cache'});if(!r.ok)throw new Error('blob '+r.status);await c.put(u,r.clone())}
  return r.arrayBuffer()}
const dec=(key,buf)=>crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(buf,0,12)},key,new Uint8Array(buf,12));
let MAN=null,MANID=null;
async function manifest(key){let L=await current();if(!L){await sync();L=await current()}if(!L)throw new Error('sin lista');
  if(MANID!==L.m){MAN=JSON.parse(new TextDecoder().decode(await dec(key,await blob(L.m))));MANID=L.m}return MAN}

async function post(msg){for(const c of await self.clients.matchAll({includeUncontrolled:true}))c.postMessage(msg)}
let syncing=null,lastSync=0;
function sync(){return syncing||(syncing=(async()=>{try{
  lastSync=Date.now();
  const L=await (await fetch(BASE+'v/list.json',{cache:'no-store'})).json();
  const c=await caches.open(VC);const cur=await current();
  if(cur&&cur.v===L.v){await post({t:'synced',changed:false});return}
  if(!cur)await c.put(BASE+'v/current-list',new Response(JSON.stringify(L)));
  const keys=new Set((await c.keys()).map(r=>r.url));
  const need=L.files.filter(id=>!keys.has(BASE+'v/'+id+'.bin'));let done=0;const total=need.length;
  await post({t:'progress',done,total});
  let i=0;await Promise.all([0,1,2,3].map(async()=>{while(i<need.length){const id=need[i++];const u=BASE+'v/'+id+'.bin';
    const r=await fetch(u,{cache:'no-cache'});if(!r.ok)throw new Error('blob '+r.status);await c.put(u,r);done++;post({t:'progress',done,total})}}));
  await c.put(BASE+'v/current-list',new Response(JSON.stringify(L)));
  const keep=new Set(L.files.map(id=>BASE+'v/'+id+'.bin'));
  for(const r of await c.keys())if(/\/v\/[0-9a-f]+\.bin$/.test(r.url)&&!keep.has(r.url))await c.delete(r);
  await post({t:'synced',changed:!!cur&&cur.v!==L.v,v:L.v});
}catch(e){await post({t:'sync-error',e:String(e)})}finally{syncing=null}})())}

self.addEventListener('message',e=>{const d=e.data||{};if(d.t==='sync')e.waitUntil(sync())});

async function serveApp(req,u){
  const key=await getKey();
  if(!key)return req.mode==='navigate'?Response.redirect(BASE,302):new Response('',{status:403});
  let man;try{man=await manifest(key)}catch(e){return new Response('<meta charset=utf-8><p style="font-family:system-ui;padding:20px">Necesito internet una vez para terminar de descargar la app.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}})}
  let p=decodeURIComponent(u.pathname.slice(new URL(APP).pathname.length));if(!p||p.endsWith('/'))p+='index.html';
  const ent=man[p];if(!ent)return new Response('No encontrado',{status:404});
  try{const body=await dec(key,await blob(ent[0]));return new Response(body,{headers:{'Content-Type':ent[1],'Cache-Control':'no-store'}})}
  catch(e){return new Response('No disponible sin internet todavía',{status:503})}
}

self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const u=new URL(req.url);
  if(u.href.startsWith(APP)){
    if(req.mode==='navigate'&&Date.now()-lastSync>10*60*1000)e.waitUntil(sync());
    e.respondWith(serveApp(req,u));return}
  if(u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'){
    e.respondWith(caches.open(FC).then(async c=>{const hit=await c.match(req);if(hit)return hit;try{const r=await fetch(req);if(r.ok||r.type==='opaque')c.put(req,r.clone());return r}catch(x){return new Response('',{status:504})}}));return}
  if(u.origin!==location.origin)return;
  if(/\/v\/[0-9a-f]+\.bin$/.test(u.pathname)){e.respondWith(caches.open(VC).then(async c=>(await c.match(req))||fetch(req)));return}
  if(u.pathname.endsWith('/v/list.json'))return;
  // Cáscara: red primero (para recibir mejoras), caché si no hay internet.
  e.respondWith((async()=>{const c=await caches.open(SHELL_V);try{const r=await fetch(req,{cache:'no-cache'});if(r.ok)c.put(req,r.clone());return r}catch(x){return (await c.match(req,{ignoreSearch:true}))||(req.mode==='navigate'?c.match(BASE+'index.html'):new Response('',{status:504}))}})());
});
