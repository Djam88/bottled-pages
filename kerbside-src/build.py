import json,os
H=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(H,'..','site','kerbside'); os.makedirs(OUT,exist_ok=True)
r=lambda f:open(os.path.join(H,f)).read()
html=f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Kerbside</title>
<meta name="description" content="Checks the UK parking rules for the kerb you are on and warns you before you have to move.">
<meta name="theme-color" content="#0a57a4">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Kerbside">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@600;700&display=swap">
<style>
{r('style.css')}
:root{{padding-top:env(safe-area-inset-top,0px)}}
</style>
</head>
<body>
{r('body.html')}
<script>
(function(){{
"use strict";
{r('engine.js')}
{r('app.js')}
if('serviceWorker' in navigator&&location.protocol==='https:') navigator.serviceWorker.register('/sw.js').catch(function(){{}});
}})();
</script>
</body>
</html>
'''
open(OUT+'/index.html','w').write(html)
json.dump({"name":"Kerbside","short_name":"Kerbside","description":"UK parking rules for the kerb you are on.","start_url":"./","scope":"./","display":"standalone","background_color":"#0a57a4","theme_color":"#0a57a4",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]},open(OUT+'/manifest.webmanifest','w'),indent=1)
print('built',len(html))
