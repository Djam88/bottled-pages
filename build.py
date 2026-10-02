import re,os,json
ROOT=os.path.dirname(os.path.abspath(__file__))
s=open(os.path.join(ROOT,'src','page.html')).read()
title=re.search(r'<title>(.*?)</title>',s).group(1)
fonts=re.search(r'<link rel="stylesheet"[^>]*>',s).group(0)
body=s.replace('<title>%s</title>\n'%title,'').replace(fonts+'\n','')
out=os.path.join(ROOT,'site'); os.makedirs(out,exist_ok=True)
head=f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="A vintage reading tracker. Every book is a bottle at sea that fills with the pages you read.">
<meta name="theme-color" content="#eadfc6">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Bottled Pages">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{fonts}
<style>[hidden]{{display:none!important}}img{{max-width:100%}}html{{-webkit-text-size-adjust:100%}}body{{padding-bottom:env(safe-area-inset-bottom,0px)}}</style>
</head>
<body>
'''
open(out+'/index.html','w').write(head+body+'\n</body>\n</html>\n')
json.dump({"name":"Bottled Pages","short_name":"Bottled Pages","description":"A vintage reading tracker where every book is a bottle at sea.","start_url":"./","scope":"./","display":"standalone","background_color":"#eadfc6","theme_color":"#eadfc6",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]},open(out+'/manifest.webmanifest','w'),indent=1)
open(out+'/sw.js','w').write('''const C='bottled-pages-v6';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(r,cp));return res;}).catch(()=>caches.match(r).then(m=>m||caches.match('./'))));
  } else if(/(^|\\.)(fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|covers\\.openlibrary\\.org|unpkg\\.com)$/.test(u.hostname)){
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(r,cp));return res;})));
  }
});
''')
