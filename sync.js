/* Mi Día · sincronización entre dispositivos.
   Guarda todo el avance (localStorage + IndexedDB) cifrado con la llave del dispositivo en la rama "datos"
   del repo de GitHub (sync/estado.bin). Une cambios de laptop y celular con una mezcla de tres vías
   campo por campo. El token de GitHub también va cifrado (sync/token.bin), así el otro dispositivo
   lo toma solo después de escribir el código de verificación. */
(function(){
const OWNER='eduardodaniel1789-cpu',REPO='mi-dia',BR='datos';
const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const RAW=`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BR}/`;
const SKIP=/^(midia-bk-last|midia-sync.*|midia-away|anx-hint)$/;
const DBS=[['midia-anota','a',function(d){const s=d.createObjectStore('a',{keyPath:'id'});s.createIndex('page','page')}],['maison-img','i',function(d){d.createObjectStore('i')}]];
const BIG=60000;
const te=new TextEncoder(),td=new TextDecoder();

/* ---------- utilidades ---------- */
function vault(){return new Promise((ok,no)=>{const r=indexedDB.open('midia-vault',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function kv(op,k,v){const d=await vault();return new Promise((ok,no)=>{const t=d.transaction('kv',op==='get'?'readonly':'readwrite'),s=t.objectStore('kv');const r=op==='get'?s.get(k):op==='del'?s.delete(k):s.put(v,k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
const b64=u=>{let s='';const a=u instanceof Uint8Array?u:new Uint8Array(u);for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode.apply(null,a.subarray(i,i+32768));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0));
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function sha(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes)).slice(0,32)}
function canon(v){if(v===undefined)return 'u';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canon).join(',')+']';return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'}
const eq=(a,b)=>canon(a)===canon(b);
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!v.__x&&!v.__s;
function merge3(b,l,r){if(eq(l,r))return l;if(eq(l,b))return r;if(eq(r,b))return l;
  if(isObj(l)&&isObj(r)){const o={},bb=isObj(b)?b:{};for(const k of new Set([...Object.keys(l),...Object.keys(r)])){const m=merge3(bb[k],l[k],r[k]);if(m!==undefined)o[k]=m}return o}
  return l===undefined?r:l}
function merge2(l,r){if(eq(l,r))return l;if(l===undefined)return r;if(r===undefined)return l;if(isObj(l)&&isObj(r)){const o={};for(const k of new Set([...Object.keys(l),...Object.keys(r)])){const m=merge2(l[k],r[k]);if(m!==undefined)o[k]=m}return o}return r}
async function gz(bytes,dir){if(!window.CompressionStream)return null;const s=new Blob([bytes]).stream().pipeThrough(dir?new CompressionStream('gzip'):new DecompressionStream('gzip'));return new Uint8Array(await new Response(s).arrayBuffer())}
async function seal(key,bytes){const z=await gz(bytes,1);const body=z||bytes;const iv=crypto.getRandomValues(new Uint8Array(12));const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,body));const out=new Uint8Array(13+ct.length);out[0]=z?1:0;out.set(iv,1);out.set(ct,13);return out}
async function open_(key,buf){const a=new Uint8Array(buf);const pt=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(1,13)},key,a.slice(13)));return a[0]===1?await gz(pt,0):pt}

/* ---------- GitHub ---------- */
async function gh(token,path,opt){opt=opt||{};const h={'Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','Accept':opt.raw?'application/vnd.github.raw':'application/vnd.github.object'};
  if(opt.body)h['Content-Type']='application/json';
  const r=await fetch(API+path+(opt.body?'':'?ref='+BR+'&t='+Date.now()),{method:opt.body?'PUT':'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'});return r}
async function getFile(token,path){const r=await gh(token,path);if(r.status===404)return null;if(!r.ok)throw new Error('gh '+r.status);const j=await r.json();
  let bytes;if(j.content&&j.encoding==='base64')bytes=unb64(j.content);else{const rr=await gh(token,path,{raw:1});if(!rr.ok)throw new Error('raw '+rr.status);bytes=new Uint8Array(await rr.arrayBuffer())}
  return {sha:j.sha,bytes}}
async function putFile(token,path,bytes,sha,msg){const body={message:msg||'sync',content:b64(bytes),branch:BR};if(sha)body.sha=sha;return gh(token,path,{body})}

/* ---------- estado local ---------- */
function idbOpen(name,store,mk){return new Promise(res=>{try{const r=indexedDB.open(name);r.onupgradeneeded=()=>{if(mk)mk(r.result);else try{r.transaction.abort()}catch(e){}};r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains(store)){d.close();res(null)}else res(d)};r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch(e){res(null)}})}
async function readStore(name,store){const d=await idbOpen(name,store);if(!d)return null;return new Promise(ok=>{const o={};const st=d.transaction(store).objectStore(store);const c=st.openCursor();c.onsuccess=()=>{const x=c.result;if(x){o[st.keyPath?String(x.value[st.keyPath]):String(x.key)]=x.value;x.continue()}else{d.close();ok(o)}};c.onerror=()=>{d.close();ok(o)}})}
const BLOBS=new Map();// hash -> {t:'s'|'b',v,type}
async function ext(v){
  if(v instanceof Blob){const buf=new Uint8Array(await v.arrayBuffer());const h=await sha(buf);BLOBS.set(h,{t:'b',v,type:v.type});return {__x:h,k:'b',type:v.type}}
  if(typeof v==='string'&&v.length>=BIG){const h=await sha(te.encode(v));BLOBS.set(h,{t:'s',v});return {__x:h,k:'s'}}
  if(Array.isArray(v)){const o=[];for(const x of v)o.push(await ext(x));return o}
  if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=await ext(v[k]);return o}
  return v}
async function collect(){const ls={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(SKIP.test(k))continue;const s=localStorage.getItem(k);let v;try{v=JSON.parse(s);if(JSON.stringify(v)!==s&&typeof v!=='object')v={__s:s}}catch(e){v={__s:s}}ls[k]=v}
  const db={};for(const [n,s] of DBS){const rows=await readStore(n,s);if(rows){const o={};for(const k in rows)o[k]=await ext(rows[k]);db[n+'/'+s]=o}}
  return {ls,db}}
function refs(v,set){if(Array.isArray(v))v.forEach(x=>refs(x,set));else if(v&&typeof v==='object'){if(v.__x)set.add(v.__x);else for(const k in v)refs(v[k],set)}return set}
async function inflate(v,key,token){
  if(Array.isArray(v)){const o=[];for(const x of v)o.push(await inflate(x,key,token));return o}
  if(v&&typeof v==='object'){if(v.__x){let b=BLOBS.get(v.__x);if(!b){const f=await getFile(token,'sync/x/'+v.__x+'.bin');if(!f)return null;const pt=await open_(key,f.bytes);b=v.k==='b'?{t:'b',v:new Blob([pt],{type:v.type||''})}:{t:'s',v:td.decode(pt)};BLOBS.set(v.__x,b)}return b.v}
    const o={};for(const k in v)o[k]=await inflate(v[k],key,token);return o}
  return v}
async function apply(cur,next,key,token){let changed=false;
  for(const k of new Set([...Object.keys(cur.ls),...Object.keys(next.ls)])){if(eq(cur.ls[k],next.ls[k]))continue;changed=true;const v=next.ls[k];
    if(v===undefined)localStorage.removeItem(k);else localStorage.setItem(k,v&&v.__s!==undefined?v.__s:JSON.stringify(v))}
  for(const [n,s,mk] of DBS){const nk=n+'/'+s,a=cur.db[nk]||{},b=next.db[nk]||{};const diff=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!eq(a[k],b[k]));if(!diff.length)continue;changed=true;
    const rows=[];for(const k of diff)rows.push([k,b[k]===undefined?undefined:await inflate(b[k],key,token)]);
    const d=await idbOpen(n,s,mk);if(!d)continue;await new Promise(ok=>{const t=d.transaction(s,'readwrite'),st=t.objectStore(s);for(const [k,v] of rows){if(v===undefined)st.delete(st.keyPath?k:k);else st.keyPath?st.put(v):st.put(v,k)}t.oncomplete=ok;t.onerror=ok});d.close()}
  return changed}

/* ---------- llave y token ---------- */
async function K(){try{return await kv('get','k')}catch(e){return null}}
async function token(key){if(await kv('get','sync-disabled'))return null;const w=await kv('get','sync-token');if(w)return td.decode(await open_(key,w));
  try{const r=await fetch(RAW+'sync/token.bin?t='+Date.now(),{cache:'no-store'});if(!r.ok)return null;const pt=await open_(key,await r.arrayBuffer());await kv('put','sync-token',await seal(key,pt));return td.decode(pt)}catch(e){return null}}

/* ---------- sincronizar ---------- */
let busy=null,pending=false;
async function sync(mode){// mode: 'full' (trae y aplica), 'push' (solo sube si el otro no cambió)
  if(busy)return busy;busy=(async()=>{try{
  const key=await K();if(!key)return {ok:false,why:'nokey'};const tk=await token(key);if(!tk)return {ok:false,why:'notoken'};
  BLOBS.clear();const local=await collect();const meta=await kv('get','sync-meta')||{};const baseRaw=await kv('get','sync-base');const base=baseRaw?JSON.parse(baseRaw):null;
  if(mode==='push'&&base&&eq(local,base))return {ok:true,same:true};
  const f=await getFile(tk,'sync/estado.bin');let remote=null;if(f)remote=JSON.parse(td.decode(await open_(key,f.bytes)));
  if(mode==='push'&&f&&meta.sha&&f.sha!==meta.sha){pending=true;return {ok:true,pending:true}}
  let merged;
  if(!remote)merged=local;
  else if(!base)merged=merge2(local,remote);// primera vez en este dispositivo: junta ambos; si chocan, gana lo guardado
  else merged=merge3(base,local,remote);
  const changed=await apply(local,merged,key,tk);
  let shaNow=f&&f.sha;
  if(!remote||!eq(merged,remote)){
    const have=remote?refs(remote,new Set()):new Set();
    for(const h of refs(merged,new Set())){if(have.has(h))continue;const b=BLOBS.get(h);if(!b)continue;const bytes=b.t==='b'?new Uint8Array(await b.v.arrayBuffer()):te.encode(b.v);const r=await putFile(tk,'sync/x/'+h+'.bin',await seal(key,bytes),null,'sync archivo');if(!r.ok&&r.status!==422)throw new Error('x '+r.status)}
    const r=await putFile(tk,'sync/estado.bin',await seal(key,te.encode(JSON.stringify(merged))),f&&f.sha,'sync '+new Date().toISOString());
    if(r.status===409||r.status===422){busy=null;return sync('full')}
    if(!r.ok)throw new Error('put '+r.status);shaNow=(await r.json()).content.sha}
  await kv('put','sync-base',JSON.stringify(merged));await kv('put','sync-meta',{sha:shaNow,at:Date.now()});pending=false;
  try{localStorage.setItem('midia-sync-at',String(Date.now()))}catch(e){}
  return {ok:true,changed}}
  catch(e){return {ok:false,why:String(e&&e.message||e)}}finally{busy=null}})();return busy}

async function setToken(tk){const key=await K();if(!key)throw new Error('nokey');tk=tk.trim();
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`,{headers:{'Authorization':'Bearer '+tk},cache:'no-store'});if(!r.ok)throw new Error('token');
  const j=await r.json();if(!j.permissions||!j.permissions.push)throw new Error('permiso');
  const sealed=await seal(key,te.encode(tk));
  const f=await getFile(tk,'sync/token.bin');const p=await putFile(tk,'sync/token.bin',sealed,f&&f.sha,'token cifrado');if(!p.ok)throw new Error('put '+p.status);
  await kv('put','sync-token',sealed);await kv('del','sync-disabled');return sync('full')}
async function off(){await kv('put','sync-disabled',1);await kv('del','sync-token');await kv('del','sync-base');await kv('del','sync-meta')}
async function status(){const key=await K();if(!key)return 'nokey';const w=await kv('get','sync-token');return w?'on':'off'}

window.MDSYNC={sync,setToken,off,status,isPending:()=>pending};
})();
