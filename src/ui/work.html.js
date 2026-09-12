export default `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HeyMia | Workflow Command Center</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#07060a;--panel:rgba(18,16,26,.88)}
body{font-family:Plus Jakarta Sans,sans-serif;background:var(--bg);color:#f8fafc;height:100vh;overflow:hidden}
.serif{font-family:Playfair Display,serif}
.glass{background:var(--panel);border:1px solid rgba(255,255,255,.08)}
.tab-active{background:linear-gradient(90deg,#ec4899,#a855f7);color:#fff}
</style></head>
<body class="flex flex-col h-screen">
<header class="h-14 flex items-center gap-3 px-4 glass border-b border-white/10">
  <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center font-black">H</div>
  <div><div class="font-bold text-sm serif leading-none">HeyMia</div><div class="text-[9px] text-pink-400 tracking-widest uppercase">Workflow v3</div></div>
  <div class="ml-auto flex gap-2">
    <button id="b-work" class="px-3 py-1.5 rounded-lg text-xs font-bold tab-active">Work</button>
    <button id="b-play" class="px-3 py-1.5 rounded-lg text-xs font-bold glass text-slate-300">Play</button>
  </div>
</header>
<div class="flex-1 grid md:grid-cols-[320px_1fr] min-h-0">
  <aside class="glass border-r border-white/10 flex flex-col min-h-0">
    <div class="p-3 border-b border-white/10 text-xs font-bold">Mia · gemini-3.8-flash</div>
    <div id="log" class="flex-1 overflow-auto p-3 space-y-2 text-sm"></div>
    <form id="f" class="p-3 border-t border-white/10 flex gap-2">
      <input id="q" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="Tell Mia to publish a site, list the vault…">
      <button class="px-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-xs font-bold">Send</button>
    </form>
  </aside>
  <main class="p-5 overflow-auto space-y-4">
    <section class="glass rounded-2xl p-4">
      <h2 class="serif text-lg">Publish a website</h2>
      <input id="n" class="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="Site name">
      <input id="t" class="mt-2 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="Tagline">
      <button id="pub" class="mt-3 px-4 py-2 rounded-xl bg-emerald-600 text-xs font-bold">Publish to /s/slug/</button>
      <div id="sites" class="mt-3 text-xs text-slate-400"></div>
    </section>
    <section class="glass rounded-2xl p-4">
      <h2 class="serif text-lg">Vault</h2>
      <input id="file" type="file" multiple class="mt-2 text-sm">
      <div id="files" class="mt-3 text-xs text-slate-400"></div>
    </section>
    <pre id="st" class="glass rounded-2xl p-4 text-xs overflow-auto"></pre>
  </main>
</div>
<script>
const BASE = location.origin;
const log = (role, text) => {
  const d = document.createElement('div');
  d.className = 'rounded-xl p-2 ' + (role==='you'?'bg-pink-500/20 text-right':'bg-white/5');
  d.textContent = (role==='you'?'You: ':'Mia: ') + text;
  document.getElementById('log').appendChild(d);
};
async function j(path, opt){ const r=await fetch(BASE+path,opt); return r.json(); }
async function status(){ document.getElementById('st').textContent = JSON.stringify(await j('/api/status'),null,2); }
async function sites(){ const d=await j('/api/sites'); document.getElementById('sites').innerHTML=(d.sites||[]).map(s=>'<a class="text-pink-400" href="'+s.url+'" target="_blank">'+s.slug+'</a>').join('<br>')||'None yet'; }
async function files(){ const d=await j('/files'); document.getElementById('files').textContent=(d.files||d.objects||[]).map(f=>f.name||f.key).join('\n')||'Empty'; }
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault(); const q=document.getElementById('q').value.trim(); if(!q) return;
  log('you', q); document.getElementById('q').value='';
  const d=await j('/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:'Mia',mode:'work',messages:[{role:'user',content:q}]})});
  log('mia', d.response||d.error||JSON.stringify(d));
};
document.getElementById('pub').onclick=async()=>{
  const name=document.getElementById('n').value||'Studio';
  const d=await j('/api/sites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,tagline:document.getElementById('t').value})});
  log('mia', d.message||d.error); sites();
};
document.getElementById('file').onchange=async e=>{
  for (const f of e.target.files){
    await fetch(BASE+'/files',{method:'POST',headers:{'X-File-Name':f.name,'X-Category':'vault','Content-Type':f.type||'application/octet-stream'},body:f});
  }
  files();
};
status(); sites(); files();
</script></body></html>`;
