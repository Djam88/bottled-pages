/* ---------- state ---------- */
var KEY='kerbside-v1', API='/api/kerbside/reports';
var state={settings:{badge:false,zones:'',lead:15},session:null,noReturn:[],spots:[],history:[],my:{},did:''};
try{var raw=localStorage.getItem(KEY); if(raw){var sv=JSON.parse(raw); for(var k in sv) state[k]=sv[k];}}catch(e){}
if(!state.did){state.did=Array.from({length:16},function(){return Math.floor(Math.random()*16).toString(16);}).join('');}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
function reviveRule(r){return r;}
var gps=null, spot=null, manual=false, gpsState='wait', area={streets:[],carparks:[],at:null,status:'idle',place:null,reports:null,repStatus:'idle'}, view='here';
function $(id){return document.getElementById(id);}
function el(tag,props){
  var n=document.createElement(tag),k,v,i,c;
  for(k in (props||{})){v=props[k];
    if(k==='class')n.className=v; else if(k==='text')n.textContent=v; else if(k==='html')n.innerHTML=v; else if(k==='value')n.value=v;
    else if(k.slice(0,2)==='on')n.addEventListener(k.slice(2),v); else if(v===true)n.setAttribute(k,''); else if(v!==false&&v!=null)n.setAttribute(k,v);}
  for(i=2;i<arguments.length;i++){c=arguments[i]; if(c==null||c===false)continue; if(Array.isArray(c))c.forEach(function(x){if(x!=null&&x!==false)n.append(x);}); else n.append(c);}
  return n;
}
var toastT; function toast(msg){var t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true;},4200);}
function openSheet(){var s=$('sheet');s.replaceChildren.apply(s,[].slice.call(arguments));$('overlay').hidden=false;s.scrollTop=0;var f=s.querySelector('h2');if(f){f.tabIndex=-1;f.focus();}}
function closeSheet(){$('overlay').hidden=true;$('sheet').replaceChildren();}
$('overlay').addEventListener('click',function(e){if(e.target===$('overlay'))closeSheet();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('overlay').hidden)closeSheet();});
function opts(extra){var o={badge:!!state.settings.badge};if(extra)for(var k in extra)o[k]=extra[k];return o;}
function hasPermit(rule){var z=(state.settings.zones||'').split(',').map(function(x){return x.trim().toLowerCase();}).filter(Boolean);
  return !!rule.zone&&z.indexOf(String(rule.zone).toLowerCase())>=0;}
function vOf(rule,now,extra){var o=opts(extra);o.permit=hasPermit(rule);return verdict(rule,now||new Date(),o);}

/* ---------- drawings ---------- */
function kerbSvg(kind){
  var y='#f2c200', r='#d3212d', w='#f4f6f8', s='<svg class="kerb" viewBox="0 0 120 56" role="img" aria-hidden="true"><rect width="120" height="56" fill="#2d3238"/><rect y="44" width="120" height="12" fill="#aab1b8"/><rect y="44" width="120" height="2" fill="#7d858d"/>';
  function line(yy,c){return '<rect x="0" y="'+yy+'" width="120" height="3" fill="'+c+'"/>';}
  function bay(t){return '<rect x="10" y="10" width="100" height="30" fill="none" stroke="'+w+'" stroke-width="2" stroke-dasharray="7 5"/>'+(t?'<text x="60" y="30" text-anchor="middle" fill="'+w+'" font-family="Arial,sans-serif" font-weight="700" font-size="11">'+t+'</text>':'');}
  if(kind==='dy') s+=line(33,y)+line(39,y);
  else if(kind==='sy') s+=line(39,y);
  else if(kind==='dr') s+=line(33,r)+line(39,r);
  else if(kind==='sr') s+=line(39,r);
  else if(kind==='zigzag') s+='<polyline points="0,40 15,28 30,40 45,28 60,40 75,28 90,40 105,28 120,40" fill="none" stroke="'+w+'" stroke-width="3"/>';
  else if(kind==='pay') s+=bay('PAY');
  else if(kind==='limited') s+=bay('2 HOURS');
  else if(kind==='permit') s+=bay('PERMIT');
  else if(kind==='disabled') s+=bay('DISABLED');
  else if(kind==='loading') s+=bay('LOADING');
  return s+'</svg>';
}
function plate(rule){
  var k=rule.kind, sym, lines=[], hrs=rule.hoursUnknown?['See the sign']:describeHours(rule.hours);
  if(k==='dy'||k==='sy'||k==='loading') sym=el('div',{class:'sym nw'});
  else if(k==='dr'||k==='sr'||k==='zigzag') sym=el('div',{class:'sym nw ns'});
  else if(k==='unknown') sym=el('div',{class:'sym q',text:'?'});
  else sym=el('div',{class:'sym p',text:'P'});
  if(k==='dy'||k==='dr') lines.push(['At any time',1]);
  else if(k==='zigzag') lines.push(['No stopping',1]);
  else if(k==='free') lines.push(['No restriction',1]);
  else if(k==='unknown') lines.push(['Read the sign',1]);
  else if(k==='carpark'){lines.push([rule.name||'Car park',1]); if(rule.maxStay)lines.push([fmtDur(rule.maxStay)]); if(rule.fee)lines.push(['Pay here']);}
  else{
    if(k==='permit') lines.push(['Permit holders only'+(rule.zone?' '+rule.zone:''),1]);
    if(k==='disabled') lines.push(['Disabled badge holders only',1]);
    if(k==='loading') lines.push(['Loading only',1]);
    hrs.forEach(function(h){lines.push([h,k==='sy'||k==='sr']);});
    if(k==='pay') lines.push(['Pay here']);
    if(rule.maxStay) lines.push([fmtDur(rule.maxStay),1]);
    if(rule.noReturn) lines.push(['No return within '+fmtDur(rule.noReturn)]);
  }
  return el('div',{class:'plate','aria-hidden':'true'},sym,lines.map(function(l){return el('span',{class:l[1]?'big':'',text:l[0]});}));
}
var STATE_WORD={ok:'Park',pay:'Pay',no:'Do not park',check:'Check'};

/* ---------- map ---------- */
var M={z:17,c:null,follow:true,tiles:{},w:0,h:0};
function proj(lat,lon,z){var s=256*Math.pow(2,z),x=(lon+180)/360*s,sn=Math.sin(lat*Math.PI/180);return {x:x,y:(0.5-Math.log((1+sn)/(1-sn))/(4*Math.PI))*s};}
function unproj(x,y,z){var s=256*Math.pow(2,z);return {lon:x/s*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y/s)))*180/Math.PI};}
function mapXY(p){var c=proj(M.c.lat,M.c.lon,M.z),q=proj(p.lat,p.lon,M.z);return [q.x-c.x+M.w/2,q.y-c.y+M.h/2];}
function drawMap(){
  var box=$('map'); M.w=box.clientWidth; M.h=box.clientHeight; if(!M.c||!M.w) return;
  box.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
  var c=proj(M.c.lat,M.c.lon,M.z), x0=c.x-M.w/2, y0=c.y-M.h/2, n=Math.pow(2,M.z), keep={}, tiles=$('tiles');
  for(var tx=Math.floor(x0/256);tx<=Math.floor((x0+M.w)/256);tx++) for(var ty=Math.floor(y0/256);ty<=Math.floor((y0+M.h)/256);ty++){
    if(ty<0||ty>=n) continue; var key=M.z+'/'+((tx%n)+n)%n+'/'+ty, img=M.tiles[key];
    if(!img){img=new Image();img.alt='';img.decoding='async';img.src='https://tile.openstreetmap.org/'+key+'.png';img.onerror=function(){this.style.visibility='hidden';};M.tiles[key]=img;tiles.append(img);}
    img.style.transform='translate('+Math.round(tx*256-x0)+'px,'+Math.round(ty*256-y0)+'px)'; keep[key]=1;
  }
  for(var k2 in M.tiles) if(!keep[k2]){M.tiles[k2].remove();delete M.tiles[k2];}
  var svg=$('overlay-svg'), h='', css=getComputedStyle(document.documentElement), col={ok:css.getPropertyValue('--ok'),pay:css.getPropertyValue('--warn'),no:css.getPropertyValue('--no'),check:css.getPropertyValue('--check')}, blue=css.getPropertyValue('--blue');
  var now=new Date();
  area.streets.forEach(function(s){
    var worst='ok', rank={ok:0,check:1,pay:2,no:3};
    s.sides.forEach(function(x){var st=vOf(x.rule,now).state; if(rank[st]>rank[worst]) worst=st;});
    h+='<polyline fill="none" stroke="'+col[worst]+'" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".85" points="'+s.geom.map(function(p){var q=mapXY(p);return q[0].toFixed(1)+','+q[1].toFixed(1);}).join(' ')+'"/>';
  });
  area.carparks.forEach(function(p){var q=mapXY(p);h+='<g transform="translate('+q[0].toFixed(1)+','+q[1].toFixed(1)+')"><rect x="-10" y="-10" width="20" height="20" rx="4" fill="#0a57a4" stroke="#fff" stroke-width="2"/><text y="5" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="13">P</text></g>';});
  if(state.session){var cq=mapXY(state.session);h+='<g transform="translate('+cq[0].toFixed(1)+','+cq[1].toFixed(1)+')"><path d="M0,0 L-11,-20 A12.5,12.5 0 1 1 11,-20 Z" fill="#111417" stroke="#fff" stroke-width="2"/><circle cy="-24" r="5" fill="#f2c200"/></g>';}
  if(gps){var g=mapXY(gps), mpp=156543.03392*Math.cos(gps.lat*Math.PI/180)/Math.pow(2,M.z), ar=Math.min(200,(gps.acc||0)/mpp);
    h+='<circle cx="'+g[0]+'" cy="'+g[1]+'" r="'+ar.toFixed(1)+'" fill="'+blue+'" opacity=".13"/><circle class="me-pulse" cx="'+g[0]+'" cy="'+g[1]+'" r="8" fill="'+blue+'" opacity="0"/><circle cx="'+g[0]+'" cy="'+g[1]+'" r="8" fill="'+blue+'" stroke="#fff" stroke-width="3"/>';}
  if(manual&&spot){var m=mapXY(spot);h+='<g transform="translate('+m[0]+','+m[1]+')" stroke="'+css.getPropertyValue('--ink')+'" stroke-width="2.5" fill="none"><circle r="11"/><path d="M-17,0H-6M6,0H17M0,-17V-6M0,6V17"/></g>';}
  svg.innerHTML=h;
  $('recentre').hidden=!(gps&&(!M.follow||manual));
}
(function(){
  var box=$('map'), pts={}, start=null, moved=false, pinch=0;
  box.addEventListener('pointerdown',function(e){ if(e.target.closest('button,a')) return; box.setPointerCapture(e.pointerId); pts[e.pointerId]={x:e.clientX,y:e.clientY};
    var ids=Object.keys(pts); if(ids.length===1){start={x:e.clientX,y:e.clientY,c:M.c&&proj(M.c.lat,M.c.lon,M.z)};moved=false;} else if(ids.length===2){pinch=Math.hypot(pts[ids[0]].x-pts[ids[1]].x,pts[ids[0]].y-pts[ids[1]].y);moved=true;} });
  box.addEventListener('pointermove',function(e){ if(!pts[e.pointerId]||!M.c) return; pts[e.pointerId]={x:e.clientX,y:e.clientY}; var ids=Object.keys(pts);
    if(ids.length===2&&pinch){var d=Math.hypot(pts[ids[0]].x-pts[ids[1]].x,pts[ids[0]].y-pts[ids[1]].y); if(d>pinch*1.45){zoom(1);pinch=d;} else if(d<pinch*0.69){zoom(-1);pinch=d;} return;}
    if(ids.length===1&&start&&start.c){var dx=e.clientX-start.x,dy=e.clientY-start.y; if(!moved&&Math.hypot(dx,dy)<7) return; moved=true;M.follow=false;M.c=unproj(start.c.x-dx,start.c.y-dy,M.z);drawMap();} });
  function up(e){ if(!pts[e.pointerId]) return; delete pts[e.pointerId];
    if(!moved&&start&&M.c&&e.type==='pointerup'){var r=box.getBoundingClientRect(),c=proj(M.c.lat,M.c.lon,M.z),p=unproj(c.x+(e.clientX-r.left)-M.w/2,c.y+(e.clientY-r.top)-M.h/2,M.z);setSpot(p,true);}
    if(!Object.keys(pts).length){start=null;pinch=0;} }
  box.addEventListener('pointerup',up); box.addEventListener('pointercancel',up);
  box.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1:-1);},{passive:false});
  function zoom(d){M.z=Math.max(13,Math.min(19,M.z+d));drawMap();}
  $('zoom-in').addEventListener('click',function(){zoom(1);}); $('zoom-out').addEventListener('click',function(){zoom(-1);});
  $('recentre').addEventListener('click',function(){if(!gps)return;M.follow=true;M.c={lat:gps.lat,lon:gps.lon};setSpot(gps,false);});
  addEventListener('resize',drawMap);
})();

/* ---------- position ---------- */
function setSpot(p,isManual){
  manual=!!isManual; spot={lat:p.lat,lon:p.lon,acc:isManual?0:p.acc};
  if(!M.c||(!isManual&&M.follow)) M.c={lat:p.lat,lon:p.lon};
  renderChip(); loadArea(); renderHere(); drawMap();
}
function renderChip(){
  var c=$('gps-chip'), help=$('gps-help'); c.className='chip'; help.hidden=true;
  if(manual){c.textContent='Checking the spot you tapped';c.classList.add('good');return;}
  if(gpsState==='ok'&&gps){var a=Math.round(gps.acc);c.textContent='GPS accurate to '+a+' m';c.classList.add(a<=20?'good':'rough');
    if(a>35){help.hidden=false;help.replaceChildren(el('p',{class:'small',text:'GPS is rough here (within '+a+' m), which is common between tall buildings. Check the street name above, or tap the map on the exact spot.'}));}
    return;}
  if(gpsState==='wait'){c.textContent='Finding you';return;}
  c.classList.add('bad'); c.textContent=gpsState==='denied'?'Location is switched off':'Location unavailable';
  help.hidden=false;
  help.replaceChildren(el('h3',{text:gpsState==='denied'?'Kerbside needs your location':'Your location could not be found'}),
    el('p',{class:'small dim',text:gpsState==='denied'?'Allow location for this site in your browser settings, then try again. Your position stays on this phone; only a rounded position is sent when you report a spot.':'Move somewhere with a view of the sky, or tap the map to check a spot by hand.'}),
    el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Try again',onclick:startGps}),
      el('button',{type:'button',text:'Try an example street',onclick:function(){setSpot({lat:53.47945,lon:-2.24480},true);M.c={lat:53.47945,lon:-2.24480};drawMap();}})));
}
var watchId=null;
function startGps(){
  if(!('geolocation' in navigator)){gpsState='error';renderChip();return;}
  gpsState='wait'; renderChip();
  if(watchId!=null) navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(function(p){
    gps={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy||0}; gpsState='ok';
    if(!manual){ if(!spot||dist(spot,gps)>8||Math.abs((spot.acc||0)-gps.acc)>10) setSpot(gps,false); else {renderChip();drawMap();} }
    else {drawMap();}
    if(view==='parked') renderParked();
  },function(err){gpsState=err.code===1?'denied':'error';renderChip();if(!spot)renderHere();},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
}

/* ---------- data ---------- */
function fetchJSON(url,o,ms){var ac=new AbortController(),t=setTimeout(function(){ac.abort();},ms||15000);o=o||{};o.signal=ac.signal;
  return fetch(url,o).then(function(r){clearTimeout(t);if(!r.ok)throw new Error('http '+r.status);return r.json();},function(e){clearTimeout(t);throw e;});}
var loadSeq=0;
function loadArea(){
  if(!spot) return;
  if(area.at&&dist(area.at,spot)<45&&area.status!=='error') return;
  var here={lat:spot.lat,lon:spot.lon}, seq=++loadSeq; area.at=here; area.status='loading'; area.repStatus='loading';
  var q='[out:json][timeout:20];(way(around:140,'+here.lat.toFixed(6)+','+here.lon.toFixed(6)+')[highway][~"^parking:"~"."];);out tags geom;(nwr(around:600,'+here.lat.toFixed(6)+','+here.lon.toFixed(6)+')[amenity=parking][access!~"^(private|no)$"];);out tags center 40;';
  fetchJSON('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'}},22000).then(function(d){
    if(seq!==loadSeq) return; var streets=[], parks=[];
    (d.elements||[]).forEach(function(e){ var t=e.tags||{};
      if(t.amenity==='parking'){var c=e.center||(e.lat!=null?{lat:e.lat,lon:e.lon}:null); if(c) parks.push({id:e.type+e.id,lat:c.lat,lon:c.lon,rule:osmCarpark(t)});}
      else if(e.geometry){var sides=osmStreetRules(t); if(sides.length) streets.push({id:e.id,name:t.name||t.ref||'',geom:e.geometry,sides:sides});}
    });
    area.streets=streets; area.carparks=parks; area.status='ok'; renderHere(); drawMap();
  },function(){ if(seq!==loadSeq) return; area.status='error'; area.streets=[]; area.carparks=[]; renderHere(); drawMap(); });
  fetchJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat='+here.lat.toFixed(6)+'&lon='+here.lon.toFixed(6),null,12000).then(function(d){
    if(seq!==loadSeq) return; var a=d.address||{};
    area.place={road:a.road||a.pedestrian||a.neighbourhood||'',area:a.suburb||a.town||a.city||a.village||'',council:a.city||a.county||a.state_district||'',
      london:/London/.test((a.city||'')+' '+(a.state_district||'')),scotland:a.state==='Scotland',uk:!a.country_code||a.country_code==='gb'};
    renderPlace(); renderHere();
  },function(){ if(seq!==loadSeq) return; area.place=null; renderPlace(); });
  loadReports(here,seq);
}
function loadReports(here,seq){
  fetchJSON(API+'?lat='+here.lat.toFixed(5)+'&lon='+here.lon.toFixed(5),null,10000).then(function(d){
    if(seq!==loadSeq) return; area.reports=d; area.repStatus='ok'; renderReports();
  },function(){ if(seq!==loadSeq) return; area.reports=null; area.repStatus='error'; renderReports(); });
}
function renderPlace(){
  var p=area.place; $('place-road').textContent=p&&p.road?p.road:(spot?'Street not named':'Finding your street');
  $('place-area').textContent=p?[p.area,p.council!==p.area?p.council:''].filter(Boolean).join(', ')||' ':' ';
}

/* ---------- here ---------- */
function candidates(){
  var out=[]; if(!spot) return out;
  var saved=state.spots.filter(function(s){return dist(s,spot)<35;}).sort(function(a,b){return dist(a,spot)-dist(b,spot);})[0];
  if(saved) out.push({label:'Your saved sign for this spot',rule:saved.rule,saved:saved});
  var near=area.streets.map(function(s){return {s:s,d:distToLine(spot,s.geom)};}).filter(function(x){return x.d<=35;}).sort(function(a,b){return a.d-b.d;})[0];
  if(near&&!saved) near.s.sides.forEach(function(x){out.push({label:(near.s.name||'This street')+(x.side==='both'?'':', one side'),rule:x.rule,osm:true,sides:near.s.sides.length});});
  var cp=area.carparks.map(function(p){return {p:p,d:dist(p,spot)};}).filter(function(x){return x.d<=45&&!/^(street_side|lane)$/.test(x.p.rule.type);}).sort(function(a,b){return a.d-b.d;})[0];
  if(cp&&!saved) out.push({label:cp.p.rule.name||'Car park',rule:cp.p.rule,osm:true});
  if(!out.length) out.push({label:'',rule:{kind:'unknown'},unknown:true});
  return out;
}
function verdictCard(c,now,extra){
  var v=vOf(c.rule,now,extra), card=el('section',{class:'card verdict '+v.state});
  card.append(el('div',{class:'vhead'},plate(c.rule),
    el('div',{class:'vtext'},el('span',{class:'state',text:STATE_WORD[v.state]}),el('h2',{class:'vtitle',text:v.title}),c.label&&el('span',{class:'src',text:c.label}))));
  if(v.leaveBy) card.append(el('div',{class:'leave'},el('span',{class:'label',text:v.leaveLabel}),el('b',{text:hhmm(v.leaveBy)}),el('span',{class:'dim small',text:fmtWhen(v.leaveBy,now).replace(/ at .*/,'')+' · in '+fmtDur((v.leaveBy-now)/60000)})));
  if(v.lines.length) card.append(el('div',{class:'vlines'},v.lines.map(function(l){return el('p',{text:l});})));
  return {card:card,v:v};
}
function renderHere(){
  var box=$('cards'); box.replaceChildren(); renderNoReturn();
  if(!spot){
    box.append(el('section',{class:'card'},el('h2',{text:gpsState==='wait'?'Finding where you are':'Where are you parking?'}),
      el('p',{class:'dim',text:'Kerbside reads the parking rules mapped for the kerb you are on, checks them against the time right now, and tells you when you have to move.'})));
    renderReports(); renderCarparks(); return;
  }
  var now=new Date(), cands=candidates();
  if(cands.length>1&&cands[0].sides>1) box.append(el('p',{class:'small dim',text:'The two sides of this street have different rules. Pick the side you are on.'}));
  cands.forEach(function(c){
    var r=verdictCard(c,now), card=r.card, v=r.v, row=el('div',{class:'row'});
    if(c.unknown){
      if(area.status==='loading') card.querySelector('.vtitle').textContent='Looking up this kerb';
      card.querySelector('.vlines').replaceChildren(el('p',{text:area.status==='loading'?'Fetching the rules mapped around you.':area.status==='error'?'The map data could not be loaded. You can still read the sign into the app.':'Nobody has mapped the rules for this kerb yet. Tell the app what the lines and the sign say and it will work out when you must move.'}));
      row.append(photoBtn('Photograph the sign','primary'),el('button',{type:'button',text:'Pick the lines by hand',onclick:function(){openSign(null);}}));
    } else {
      if(v.state!=='check') row.append(el('button',{class:v.state==='no'?'':'primary',type:'button',text:v.state==='no'?'Park here anyway':'I’ve parked here',onclick:function(){startParking(c.rule);}}));
      row.append(el('button',{type:'button',class:v.state==='check'?'primary':'',text:c.saved?'Change the sign':v.state==='check'?'Add the hours':'The sign says otherwise',onclick:function(){openSign(c.rule);}}));
      row.append(photoBtn('Photograph the sign'));
      if(c.saved) row.append(el('button',{class:'quiet',type:'button',text:'Forget',onclick:function(){state.spots=state.spots.filter(function(s){return s!==c.saved;});save();renderHere();}}));
    }
    card.append(row);
    if(c.osm) card.append(el('p',{class:'src',text:'From OpenStreetMap volunteers. It may be out of date, so check it against the sign.'}));
    box.append(card);
  });
  var p=area.place;
  if(p&&(p.london||p.scotland)) box.append(el('p',{class:'small dim',text:'Pavement parking is banned in '+(p.london?'London':'Scotland')+' unless signs allow it. Keep all four wheels on the road.'}));
  if(p&&!p.uk) box.append(el('p',{class:'small dim',text:'This spot is outside the UK. The rules in this app are UK rules.'}));
  renderReports(); renderCarparks();
}
function renderNoReturn(){
  var box=$('noreturn'), now=Date.now(); box.replaceChildren();
  state.noReturn=state.noReturn.filter(function(n){return n.until>now;});
  if(!spot) return;
  state.noReturn.forEach(function(n){ if(dist(n,spot)<150) box.append(el('div',{class:'banner no',text:'No return yet. You left '+(n.street||'this street')+' at '+hhmm(new Date(n.left))+' and cannot park here again until '+hhmm(new Date(n.until))+'.'})); });
}
function renderCarparks(){
  var box=$('carparks'), now=new Date(); box.replaceChildren(el('h2',{id:'cp-h',text:'Car parks nearby'}));
  if(!spot||area.status==='loading'){box.append(el('p',{class:'dim small',text:spot?'Looking for car parks.':'They will appear once your position is known.'}));return;}
  if(area.status==='error'){box.append(el('p',{class:'dim small',text:'The map data could not be loaded.'}),el('div',null,el('button',{type:'button',text:'Try again',onclick:function(){area.at=null;loadArea();renderHere();}})));return;}
  var list=area.carparks.map(function(p){return {p:p,d:dist(p,spot)};}).sort(function(a,b){return a.d-b.d;}).slice(0,8);
  if(!list.length){box.append(el('p',{class:'dim small',text:'No public car parks are mapped within 600 metres.'}));return;}
  box.append(el('div',{class:'list'},list.map(function(x){
    var r=x.p.rule, v=vOf(r,now), bits=[r.fee?'Paid':r.feeUnknown?'Charges not mapped':'Free', r.maxStay?'max '+fmtDur(r.maxStay):'', {'multi-storey':'multi-storey',underground:'underground',surface:'surface',street_side:'street bays',lane:'street bays'}[r.type]||'', r.capacity?r.capacity+' spaces':'', v.state==='no'?'closed now':''].filter(Boolean);
    return el('div',{class:'item'},el('span',{class:'dot '+v.state}),el('div',{class:'grow'},el('b',{text:r.name||(r.type==='street_side'||r.type==='lane'?'Street bays':'Car park')}),el('span',{class:'small dim',text:bits.join(' · ')})),
      el('span',{class:'metres',text:Math.round(x.d/10)*10+' m'}),
      el('a',{class:'small',href:'https://www.google.com/maps/dir/?api=1&destination='+x.p.lat+','+x.p.lon,target:'_blank',rel:'noopener',text:'Route'}));
  })));
}

/* ---------- driver reports ---------- */
var REASONS={warden:'Wardens patrol often',sign:'Sign is confusing or hidden',camera:'Camera enforced',quick:'Ticketed within minutes',quiet:'Rarely checked'};
function cellOf(p){return Math.round(p.lat*2000)+'_'+Math.round(p.lon*2000);}
function renderReports(){
  var box=$('reports'); box.replaceChildren(el('h2',{id:'rep-h',text:'Tickets reported here'}));
  if(!spot){box.append(el('p',{class:'dim small',text:'Reports from other drivers appear once your position is known.'}));return;}
  var r=area.reports, mine=state.my[cellOf(spot)];
  if(area.repStatus==='loading') box.append(el('p',{class:'dim small',text:'Loading reports from other drivers.'}));
  else if(area.repStatus==='error'||!r) box.append(el('p',{class:'dim small',text:'Reports from other drivers could not be loaded just now.'}));
  else{
    var n=(r.ok||0)+(r.ticket||0);
    if(!n) box.append(el('div',{class:'meter empty'}),el('p',{class:'dim small',text:'No reports yet within about 100 metres. Be the first once you have parked here.'}));
    else{
      var pct=Math.round(100*r.ticket/n);
      box.append(el('div',{class:'repline'},n>=5?el('b',{text:pct+'%'}):null,el('span',{text:n>=5?'of '+n+' drivers were ticketed here':r.ticket+' of '+n+(n===1?' report':' reports')+' ended in a ticket. Too few to judge yet.'})),
        el('div',{class:'meter',role:'img','aria-label':pct+' percent ticketed'},el('i',{style:'width:'+pct+'%'})));
      var top=Object.keys(r.reasons||{}).filter(function(k){return REASONS[k];}).sort(function(a,b){return r.reasons[b]-r.reasons[a];}).slice(0,3);
      if(top.length) box.append(el('p',{class:'small dim',text:'Drivers say: '+top.map(function(k){return REASONS[k].toLowerCase()+' ('+r.reasons[k]+')';}).join(', ')+'.'}));
      box.append(el('p',{class:'small dim',text:'Reports from the past year within about 100 metres. They are drivers’ own reports, not council figures.'}));
    }
  }
  box.append(el('div',{class:'row'},el('button',{type:'button',text:mine?'Change my report':'Report this spot',onclick:function(){openReport(spot);}}),mine&&el('span',{class:'small dim',text:'You reported: '+(mine.v==='ticket'?'got a ticket':'no ticket')+'.'})));
}
function openReport(p,after){
  var v='', reason='', err=el('p',{class:'small',style:'color:var(--no)',role:'alert'});
  var b1=el('button',{type:'button','aria-pressed':'false',text:'No ticket',onclick:function(){pick('ok');}}), b2=el('button',{type:'button','aria-pressed':'false',text:'Got a ticket',onclick:function(){pick('ticket');}});
  function pick(x){v=x;b1.setAttribute('aria-pressed',x==='ok');b2.setAttribute('aria-pressed',x==='ticket');}
  var chips=el('div',{class:'chips'},Object.keys(REASONS).map(function(k){return el('button',{type:'button','aria-pressed':'false',text:REASONS[k],onclick:function(e){reason=reason===k?'':k;[].forEach.call(chips.children,function(c){c.setAttribute('aria-pressed','false');});if(reason)e.currentTarget.setAttribute('aria-pressed','true');}});}));
  var send=el('button',{class:'primary',type:'button',text:'Send report',onclick:function(){
    if(!v){err.textContent='Choose whether you got a ticket.';return;}
    send.disabled=true;send.textContent='Sending';
    fetchJSON(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:+p.lat.toFixed(5),lon:+p.lon.toFixed(5),v:v,reason:reason,did:state.did})},10000).then(function(){
      state.my[cellOf(p)]={v:v,at:Date.now()};save();closeSheet();toast('Thanks. Your report helps the next driver.');area.at=null;if(spot)loadArea();renderReports();
    },function(){send.disabled=false;send.textContent='Send report';err.textContent='The report could not be sent. Check your connection and try again.';});}});
  openSheet(el('h2',{text:after?'How did it go?':'Report this spot'}),
    el('p',{class:'dim small',text:'One tap helps other drivers judge this spot. Reports are anonymous: only a rounded position and your answer are stored.'}),
    el('div',{class:'chips'},b1,b2),el('span',{class:'label',text:'Anything to add? (optional)'}),chips,err,
    el('div',{class:'row'},send,el('button',{type:'button',text:after?'Skip':'Cancel',onclick:closeSheet})));
}

/* ---------- read the sign ---------- */
var PICKS=[['dy','Double yellow lines'],['sy','Single yellow line'],['dr','Double red lines'],['sr','Single red line'],['pay','Pay and display or pay by phone'],['limited','Free bay with a time limit'],['permit','Permit holders bay'],['disabled','Disabled bay'],['loading','Loading bay'],['zigzag','Zig-zag lines'],['free','No lines, no sign']];
function openSign(base){
  var r=base&&base.kind!=='unknown'&&base.kind!=='carpark'?JSON.parse(JSON.stringify(base)):{kind:''};
  var first=(r.hours&&r.hours[0])||null, days=first?first.days.slice():[1,1,1,1,1,1,0], from=first?first.from:480, to=first?first.to:1110, any=r.hours===null&&!!r.kind;
  var body=el('div',{style:'display:flex;flex-direction:column;gap:14px'}), preview=el('div');
  function t2s(m){m=Math.min(1439,m);return (m<600?'0':'')+Math.floor(m/60)+':'+(m%60<10?'0':'')+m%60;}
  function build(){
    var k=r.kind, rule={kind:k,src:'sign'};
    if(!k) return null;
    var timed=/^(sy|sr|pay|limited|permit|loading)$/.test(k);
    if(timed&&!any){ if(!days.some(Boolean)||to===from) return null; rule.hours=parseHours(days.map(function(d,i){return d?DAYS[i]:'';}).filter(Boolean).join(',')+' '+t2s(from)+'-'+(to>=1440?'24:00':t2s(to))); if(rule.hours===undefined) return null; }
    else rule.hours=null;
    if(/^(pay|limited|disabled)$/.test(k)&&r.maxStay) rule.maxStay=r.maxStay;
    if(/^(pay|limited)$/.test(k)&&r.noReturn) rule.noReturn=r.noReturn;
    if(k==='permit'&&r.zone) rule.zone=r.zone;
    return rule;
  }
  function draw(){
    var k=r.kind, timed=/^(sy|sr|pay|limited|permit|loading)$/.test(k);
    body.replaceChildren();
    if(timed){
      body.append(el('span',{class:'label',text:'Hours on the sign'}),
        el('label',{class:'check'},el('input',{id:'sg-any',type:'checkbox',checked:any,onchange:function(e){any=e.target.checked;draw();}}),'At any time (no hours shown)'));
      if(!any) body.append(el('div',{class:'days',role:'group','aria-label':'Days'},DAYNAMES.map(function(n,i){return el('button',{type:'button','aria-pressed':days[i]?'true':'false',text:n,onclick:function(){days[i]=days[i]?0:1;draw();}});})),
        el('div',{class:'row'},el('label',{class:'field'},'From',el('input',{id:'sg-from',type:'time',value:t2s(from),onchange:function(e){var p=e.target.value.split(':');from=+p[0]*60+ +p[1];upd();}})),
          el('label',{class:'field'},'Until',el('input',{id:'sg-to',type:'time',value:t2s(to),onchange:function(e){var p=e.target.value.split(':');to=+p[0]*60+ +p[1];if(to===0)to=1440;upd();}}))));
    }
    if(/^(pay|limited|disabled)$/.test(k)) body.append(el('div',{class:'row'},
      el('label',{class:'field'},'Maximum stay',sel('sg-stay',[[0,'Not shown'],[20,'20 minutes'],[30,'30 minutes'],[60,'1 hour'],[120,'2 hours'],[180,'3 hours'],[240,'4 hours']],r.maxStay||0,function(v){r.maxStay=v;upd();})),
      k!=='disabled'&&el('label',{class:'field'},'No return within',sel('sg-return',[[0,'Not shown'],[60,'1 hour'],[120,'2 hours'],[180,'3 hours'],[240,'4 hours']],r.noReturn||0,function(v){r.noReturn=v;upd();}))));
    if(k==='permit') body.append(el('label',{class:'field'},'Zone letter or code on the sign',el('input',{id:'sg-zone',maxlength:'8',value:r.zone||'',oninput:function(e){r.zone=e.target.value.trim();upd();}})));
    upd();
  }
  function sel(id,optsList,val,fn){return el('select',{id:id,onchange:function(e){fn(+e.target.value);}},optsList.map(function(o){var op=el('option',{value:o[0],text:o[1]});if(o[0]===val)op.selected=true;return op;}));}
  function upd(){
    var rule=build(); preview.replaceChildren();
    if(!rule){ if(r.kind) preview.append(el('p',{class:'small dim',text:'Choose at least one day and a start and end time.'})); useBtn.disabled=true; return; }
    useBtn.disabled=false; preview.append(verdictCard({rule:rule,label:'Preview for right now'},new Date()).card);
  }
  var useBtn=el('button',{class:'primary',type:'button',text:'Use this for the spot',disabled:true,onclick:function(){
    var rule=build(); if(!rule||!spot) return; saveSpotRule(rule);}});
  var picker=el('div',{class:'picker'},PICKS.map(function(p){return el('button',{type:'button',class:'pick','aria-pressed':r.kind===p[0]?'true':'false',onclick:function(e){r.kind=p[0];any=/^(dy|dr|zigzag|free|disabled)$/.test(p[0])?true:(r.hours===null&&base&&base.kind===p[0]);
      [].forEach.call(picker.children,function(c){c.setAttribute('aria-pressed','false');});e.currentTarget.setAttribute('aria-pressed','true');draw();}},el('span',{html:kerbSvg(p[0])}),p[1]);}));
  openSheet(el('h2',{text:'What does the kerb look like?'}),el('p',{class:'dim small',text:'Pick the lines or bay you can see, then copy the hours from the nearest sign.'}),picker,body,preview,
    el('div',{class:'row'},useBtn,el('button',{type:'button',text:'Cancel',onclick:closeSheet})));
  if(r.kind) draw();
}


/* ---------- photograph the sign ---------- */
var SIGN_API='/api/kerbside/sign';
function saveSpotRule(rule){
  if(!spot){toast('Kerbside needs your position first.');return;}
  state.spots=state.spots.filter(function(s){return dist(s,spot)>=35;}); state.spots.push({lat:spot.lat,lon:spot.lon,rule:rule,at:Date.now()}); if(state.spots.length>200)state.spots.shift();
  save(); closeSheet(); renderHere(); toast('Saved. Kerbside will remember this sign for this spot.');
}
function photoBtn(label,cls){
  return el('label',{class:'filebtn '+(cls||'')},label,el('input',{class:'sign-file',type:'file',accept:'image/*',capture:'environment',hidden:true,
    onchange:function(e){var f=e.target.files&&e.target.files[0];e.target.value='';if(f)readSign(f);}}));
}
var tessLoading=null;
function ocr(dataUrl){
  if(!tessLoading) tessLoading=new Promise(function(res,rej){var sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';sc.onload=res;sc.onerror=function(){tessLoading=null;rej(new Error('load'));};document.head.append(sc);});
  return tessLoading.then(function(){return window.Tesseract.recognize(dataUrl,'eng');}).then(function(r){return (r&&r.data&&r.data.text)||'';});
}
function readSign(file){
  var status=el('p',{class:'dim',role:'status',text:'Reading the sign. This can take a few seconds.'}), pic=el('img',{class:'photo',alt:'Your photo of the sign'});
  openSheet(el('h2',{text:'Reading the sign'}),pic,status,el('div',null,el('button',{type:'button',text:'Cancel',onclick:closeSheet})));
  var token={}; readSign.token=token;
  shrink(file,1400).then(function(url){
    pic.src=url;
    return fetchJSON(SIGN_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:url})},40000).then(function(d){
      return {results:rulesFromReader(d),text:String(d.text||'').slice(0,600),url:url};
    },function(){
      status.textContent='Reading the words on this phone. The first time takes longer.';
      return ocr(url).then(function(text){return {results:parseSignText(text),text:text.replace(/\s+/g,' ').trim().slice(0,600),url:url};},function(){return {results:[],text:'',url:url,failed:true};});
    });
  },function(){return {results:[],text:'',url:'',failed:true};}).then(function(r){ if(readSign.token===token&&!$('overlay').hidden) showSign(r); });
}
function showSign(r){
  var now=new Date(), kids=[el('h2',{text:r.results.length?'What this sign means':'The sign could not be read'})];
  if(r.url) kids.push(el('img',{class:'photo',src:r.url,alt:'Your photo of the sign'}));
  r.results.forEach(function(x){
    var vc=verdictCard({rule:x.rule,label:'From your photo, for right now'},now), card=vc.card;
    x.notes.forEach(function(n){card.append(el('div',{class:'banner',text:n}));});
    card.append(el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Use this for the spot',onclick:function(){saveSpotRule(x.rule);}}),
      el('button',{type:'button',text:'Correct it',onclick:function(){openSign(x.rule);}})));
    kids.push(card);
  });
  if(!r.results.length) kids.push(el('p',{class:'dim',text:'Try again closer and straight on, with the whole sign in the frame. Or type the words below, or fill it in by hand.'}));
  var ta=el('textarea',{id:'sign-text',rows:'3',maxlength:'600',placeholder:'For example: Mon - Sat 8 am - 6.30 pm, 2 hours, No return within 1 hour'}); ta.value=r.text||'';
  kids.push(el('label',{class:'field'},r.text?'Words read from the sign (fix any mistakes)':'Type the words on the sign',ta),
    el('div',{class:'row'},el('button',{type:'button',text:'Explain these words',onclick:function(){var res=parseSignText(ta.value);showSign({results:res,text:ta.value,url:r.url});if(!res.length)toast('Those words did not match a parking rule.');}}),
      photoBtn('Retake'),el('button',{type:'button',text:'Fill in by hand',onclick:function(){openSign(null);}}),el('button',{class:'quiet',type:'button',text:'Close',onclick:closeSheet})),
    el('p',{class:'small dim',text:'Reading from a photo can make mistakes. Check the result against the sign before you rely on it.'}));
  openSheet.apply(null,kids);
}

/* ---------- parking session ---------- */
function sessionV(now){var s=state.session;if(!s)return null;var v=vOf(s.rule,new Date(s.at),s.paidUntil?{paidUntil:new Date(s.paidUntil)}:null);return v;}
function startParking(rule){
  if(!spot) return;
  var s={lat:spot.lat,lon:spot.lon,acc:spot.acc||0,at:Date.now(),rule:rule,street:area.place&&area.place.road||'',area:area.place&&area.place.area||'',warned:{}};
  function go(){state.session=s;save();closeSheet();setView('parked');drawMap();askNotify();}
  var v=vOf(rule,new Date());
  if(rule.kind==='pay'||(rule.kind==='carpark'&&rule.fee)){
    var def=new Date(Date.now()+3600000), inp=el('input',{id:'pk-paid',type:'time',value:hhmm(def)});
    openSheet(el('h2',{text:'When does your paid time end?'}),el('p',{class:'dim small',text:'Copy it from your ticket or the payment app. Kerbside warns you before it runs out.'}),
      el('label',{class:'field'},'Paid until',inp),
      el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Start the clock',onclick:function(){var p=(inp.value||'').split(':');if(p.length===2){var d=new Date();d.setHours(+p[0],+p[1],0,0);if(d<Date.now()-60000)d.setDate(d.getDate()+1);s.paidUntil=d.getTime();}go();}}),
        el('button',{type:'button',text:'I have not paid yet',onclick:go})));
  } else if(v.state==='no'){
    openSheet(el('h2',{text:'Parking is not allowed here right now'}),el('p',{class:'dim',text:v.title+'. If you park anyway you risk a penalty charge.'}),
      el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Find somewhere else',onclick:closeSheet}),el('button',{type:'button',text:'Save my car’s position anyway',onclick:go})));
  } else go();
}
function askNotify(){ try{ if('Notification' in window&&Notification.permission==='default') Notification.requestPermission(); }catch(e){} }
function notify(title,body){
  toast(title); try{navigator.vibrate&&navigator.vibrate([200,100,200]);}catch(e){}
  try{ if('Notification' in window&&Notification.permission==='granted'){
    if(navigator.serviceWorker&&navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(function(reg){reg.showNotification(title,{body:body,tag:'kerbside',icon:'icon-192.png'});}); else new Notification(title,{body:body,tag:'kerbside'}); } }catch(e){}
}
function endParking(){
  var s=state.session; if(!s) return;
  if(s.rule.noReturn) state.noReturn.push({lat:s.lat,lon:s.lon,street:s.street,left:Date.now(),until:Date.now()+s.rule.noReturn*60000});
  state.history.unshift({street:s.street,area:s.area,at:s.at,end:Date.now(),kind:s.rule.kind}); state.history=state.history.slice(0,30);
  state.session=null; save(); renderParked(); drawMap(); renderHere();
  openReport({lat:s.lat,lon:s.lon},true);
}
function icsFor(s,leave){
  function z(d){return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');}
  var lead=state.settings.lead||15, st=new Date(leave.getTime()-lead*60000);
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kerbside//EN','BEGIN:VEVENT','UID:'+s.at+'@kerbside','DTSTAMP:'+z(new Date()),'DTSTART:'+z(st),'DTEND:'+z(leave),
    'SUMMARY:Move the car'+(s.street?' ('+s.street+')':''),'DESCRIPTION:Your parking time ends at '+hhmm(leave)+'.','BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:Move the car','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
}
function shrink(file,max){return new Promise(function(res,rej){var img=new Image(),u=URL.createObjectURL(file);img.onload=function(){var k=Math.min(1,(max||900)/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=img.width*k;c.height=img.height*k;c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL('image/jpeg',.7));};img.onerror=rej;img.src=u;});}
var countEl=null, countBig=null, countSub=null;
function renderParked(){
  var box=$('v-parked'), s=state.session; box.replaceChildren(); countEl=null; $('pip').hidden=!s;
  var col=el('div',{style:'display:flex;flex-direction:column;gap:16px'}); box.append(col);
  if(!s){
    col.append(el('section',{class:'card'},el('h2',{text:'No car parked'}),el('p',{class:'dim',text:'When you park, tap “I’ve parked here” on the Here screen. Kerbside saves the spot, counts down to the moment you must move, and warns you before it.'}),
      el('div',null,el('button',{class:'primary',type:'button',text:'Check where I am',onclick:function(){setView('here');}}))));
    if(state.history.length) col.append(el('section',{class:'card'},el('h2',{text:'Recent parking'}),el('div',{class:'list'},state.history.slice(0,8).map(function(h){
      return el('div',{class:'item'},el('div',{class:'grow'},el('b',{text:h.street||'Unnamed street'}),el('span',{class:'small dim',text:[h.area,KIND_NAME[h.kind]].filter(Boolean).join(' · ')})),
        el('span',{class:'metres',text:new Date(h.at).toLocaleDateString(undefined,{day:'numeric',month:'short'})+' · '+fmtDur((h.end-h.at)/60000)}));}))));
    return;
  }
  var v=sessionV(), now=new Date();
  countBig=el('div',{class:'big',text:'--:--'}); countSub=el('p',{class:'dim'}); countEl=el('div',{class:'count'},el('span',{class:'label',text:v.leaveBy?v.leaveLabel:'Parked since '+hhmm(new Date(s.at))}),countBig,countSub);
  var card=el('section',{class:'card verdict '+v.state},el('div',{class:'vhead'},plate(s.rule),el('div',{class:'vtext'},el('span',{class:'state',text:'Parked'}),el('h2',{class:'vtitle',text:s.street||'Your car'}),el('span',{class:'src',text:[s.area,'since '+hhmm(new Date(s.at))].filter(Boolean).join(' · ')}))),countEl);
  if(v.state==='no') card.append(el('div',{class:'banner no',text:v.title+'. You are at risk of a penalty charge here.'}));
  var row=el('div',{class:'row'});
  if(s.rule.kind==='pay'||(s.rule.kind==='carpark'&&s.rule.fee)) row.append(el('button',{type:'button',text:s.paidUntil?'I’ve paid for longer':'Enter paid time',onclick:function(){
    var inp=el('input',{id:'pk-paid2',type:'time',value:hhmm(new Date(s.paidUntil||Date.now()+3600000))});
    openSheet(el('h2',{text:'Paid until'}),el('label',{class:'field'},'New end time',inp),el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Update',onclick:function(){var p=(inp.value||'').split(':');if(p.length===2){var d=new Date();d.setHours(+p[0],+p[1],0,0);if(d<Date.now()-60000)d.setDate(d.getDate()+1);s.paidUntil=d.getTime();s.warned={};save();}closeSheet();renderParked();}}),el('button',{type:'button',text:'Cancel',onclick:closeSheet})));}}));
  if(v.leaveBy) row.append(el('a',{href:'data:text/calendar;charset=utf-8,'+encodeURIComponent(icsFor(s,v.leaveBy)),download:'move-the-car.ics',style:'font-weight:600',text:'Add an alarm to my calendar'}));
  card.append(row);
  var perm=('Notification' in window)?Notification.permission:'unsupported';
  card.append(el('p',{class:'small dim',text:v.leaveBy?(perm==='granted'?'Kerbside will alert you '+(state.settings.lead||15)+' minutes and 5 minutes before. ':'Kerbside will warn you on screen '+(state.settings.lead||15)+' minutes and 5 minutes before. ')+'Phones can silence web apps in the background, so add the calendar alarm as a backup.':'There is no time limit to count down for this spot.'}));
  col.append(card);
  // find my car
  var find=el('section',{class:'card'},el('h2',{text:'Find my car'}));
  if(gps){var d=dist(gps,s), cp=compass(gps,s);find.append(el('div',{class:'repline'},el('b',{text:d<1000?Math.round(d/5)*5+' m':(d/1000).toFixed(1)+' km'}),el('span',{text:d<15?'You are at the car.':'to the '+cp.word+' of you'})));}
  else find.append(el('p',{class:'dim small',text:'Your distance from the car shows once your location is on.'}));
  find.append(el('div',{class:'row'},el('a',{href:'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination='+s.lat+','+s.lon,target:'_blank',rel:'noopener',text:'Walk there with Google Maps'}),el('a',{href:'https://maps.apple.com/?dirflg=w&daddr='+s.lat+','+s.lon,target:'_blank',rel:'noopener',text:'Apple Maps'})));
  if(s.photo) find.append(el('img',{class:'photo',src:s.photo,alt:'Your photo of the sign or the car'}));
  find.append(el('label',{class:'check',style:'cursor:pointer;text-decoration:underline'},s.photo?'Replace the photo':'Add a photo of the sign or the car',el('input',{id:'pk-photo',type:'file',accept:'image/*',capture:'environment',hidden:true,onchange:function(e){var f=e.target.files&&e.target.files[0];if(!f)return;shrink(f).then(function(u){s.photo=u;save();renderParked();},function(){toast('That photo could not be read.');});}})));
  col.append(find);
  col.append(el('div',{class:'row',style:'justify-content:center'},el('button',{class:'primary',type:'button',text:'I’ve moved the car',onclick:endParking})));
  tick();
}
function tick(){
  var s=state.session; if(!s) return;
  var v=sessionV(), now=Date.now(), lead=state.settings.lead||15;
  if(v.leaveBy){
    var left=(v.leaveBy.getTime()-now)/60000;
    if(left<=lead&&left>5&&!s.warned.lead){s.warned.lead=1;save();notify('Move the car in '+Math.ceil(left)+' minutes','Your time'+(s.street?' on '+s.street:'')+' ends at '+hhmm(v.leaveBy)+'.');}
    if(left<=5&&left>0&&!s.warned.five){s.warned.five=1;s.warned.lead=1;save();notify('5 minutes left on your parking','Your time ends at '+hhmm(v.leaveBy)+'.');}
    if(left<=0&&!s.warned.over){s.warned.over=1;s.warned.five=1;s.warned.lead=1;save();notify('Your parking time is up','You should have moved by '+hhmm(v.leaveBy)+'.');}
    if(countEl){
      var sec=Math.round(Math.abs(v.leaveBy.getTime()-now)/1000), h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), ss=sec%60;
      countBig.textContent=(left<0?'+':'')+(h?h+':'+(m<10?'0':''):'')+m+':'+(ss<10?'0':'')+ss;
      countEl.className='count'+(left<=0?' over':left<=lead?' soon':'');
      countSub.textContent=left<=0?'Over time. Move the car now.':'left. Leave by '+hhmm(v.leaveBy)+(fmtWhen(v.leaveBy,new Date()).indexOf('today')?' '+fmtWhen(v.leaveBy,new Date()).replace(/ at .*/,''):'');
    }
  } else if(countEl){ countBig.textContent=fmtDur((now-s.at)/60000); countSub.textContent='No deadline for this spot.'; }
}
setInterval(tick,1000);
document.addEventListener('visibilitychange',function(){if(!document.hidden){tick();if(view==='here')renderHere();}});
setInterval(function(){if(view==='here'&&$('overlay').hidden&&!document.hidden){renderHere();drawMap();}},60000);

/* ---------- guide ---------- */
var GUIDE=[['dy','Double yellow lines','No waiting at any time, every day. You can stop to let passengers in or out. Loading is allowed unless the kerb has yellow marks.'],
  ['sy','Single yellow line','No waiting during the hours on the yellow plate nearby. Inside a controlled zone the hours are on the zone entry sign instead. Outside those hours you can park.'],
  ['dr','Double red lines','Red route. No stopping at any time, not even to drop someone off. Usually enforced by camera.'],
  ['sr','Single red line','No stopping during the hours on the sign. Outside those hours you can park.'],
  ['pay','Paid bays','Pay at the machine or by phone during the hours on the sign. Many bays also have a maximum stay and a no-return period. Outside the charging hours they are usually free.'],
  ['limited','Limited waiting','Free, but only for the time shown, such as 2 hours. “No return within 1 hour” means you cannot come back to the same stretch within that time.'],
  ['permit','Permit holders only','Only vehicles with a permit for that zone during the hours shown. If the sign shows no hours, it applies at all times.'],
  ['disabled','Disabled bays','For Blue Badge holders with the badge on display. Some have a time limit, so set the clock.'],
  ['loading','Loading bays','For loading and unloading only during the hours shown. Check whether the sign says goods vehicles only.'],
  ['zigzag','Zig-zag lines','White zig-zags at crossings and yellow zig-zags at schools. Do not stop on them.'],
  ['free','No lines and no sign','You can usually park, but not within 10 metres of a junction, across a dropped kerb, or where you would block the road. In a controlled zone, look for the entry sign.']];
function renderGuide(){
  var box=$('v-guide'); if(box.firstChild) return;
  box.append(el('div',{style:'display:flex;flex-direction:column;gap:16px'},
    el('section',{class:'card'},el('h2',{text:'Reading UK kerbs'}),el('p',{class:'dim',text:'Lines tell you what kind of restriction applies. The sign tells you when. If the two seem to disagree, or a sign is missing, take a photo before you leave the car.'})),
    el('div',{class:'guide'},GUIDE.map(function(g){return el('section',{class:'card'},el('span',{html:kerbSvg(g[0])}),el('h3',{text:g[1]}),el('p',{class:'small dim',text:g[2]}));})),
    el('section',{class:'card'},el('h3',{text:'Good to know'}),
      el('p',{class:'small dim',text:'Two short yellow marks on the kerb mean no loading at any time. One mark means no loading during the hours on the sign.'}),
      el('p',{class:'small dim',text:'Bank holidays: restrictions still apply unless the sign or the council says they do not. Councils differ, so check the council’s website.'}),
      el('p',{class:'small dim',text:'Pavement parking is banned in London and in Scotland unless signs allow it. Elsewhere it can still be an obstruction.'}),
      el('p',{class:'small'},el('a',{href:'https://www.gov.uk/guidance/the-highway-code/waiting-and-parking-238-to-252',target:'_blank',rel:'noopener',text:'The Highway Code: waiting and parking (rules 238 to 252)'})))));
}

/* ---------- settings + navigation ---------- */
$('settings-btn').addEventListener('click',function(){
  var st=state.settings;
  openSheet(el('h2',{text:'Settings'}),
    el('label',{class:'check'},el('input',{id:'st-badge',type:'checkbox',checked:!!st.badge,onchange:function(e){st.badge=e.target.checked;save();}}),'I hold a Blue Badge'),
    el('label',{class:'field'},'My permit zones (letters or codes, separated by commas)',el('input',{id:'st-zones',value:st.zones||'',maxlength:'60',oninput:function(e){st.zones=e.target.value;save();}})),
    el('label',{class:'field'},'Warn me this long before I must move',(function(){var s=el('select',{id:'st-lead',onchange:function(e){st.lead=+e.target.value;save();}});[5,10,15,20,30].forEach(function(m){var o=el('option',{value:m,text:m+' minutes'});if(m===(st.lead||15))o.selected=true;s.append(o);});return s;})()),
    el('p',{class:'small dim',text:state.spots.length+' saved '+(state.spots.length===1?'sign':'signs')+' on this phone.'}),
    el('div',{class:'row'},el('button',{class:'primary',type:'button',text:'Done',onclick:function(){closeSheet();renderHere();drawMap();}}),
      state.spots.length?el('button',{type:'button',text:'Forget my saved signs',onclick:function(){state.spots=[];save();closeSheet();renderHere();toast('Saved signs removed.');}}):null));
});
function setView(v){
  view=v; ['here','parked','guide'].forEach(function(n){$('v-'+n).hidden=n!==v;});
  [].forEach.call(document.querySelectorAll('.tabs button'),function(b){if(b.dataset.view===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(v==='parked') renderParked(); if(v==='guide') renderGuide(); if(v==='here'){renderHere();drawMap();}
  scrollTo(0,0);
}
[].forEach.call(document.querySelectorAll('.tabs button'),function(b){b.addEventListener('click',function(){setView(b.dataset.view);});});
$('pip').hidden=!state.session;
renderHere(); renderPlace();
if(state.session){M.c={lat:state.session.lat,lon:state.session.lon};setView('parked');}
startGps();
