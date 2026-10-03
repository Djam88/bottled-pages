/* ---------- rule engine: pure functions, no DOM ---------- */
var DAYS=['Mo','Tu','We','Th','Fr','Sa','Su'], DAYNAMES=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function dayIx(d){return (d.getDay()+6)%7;}
function atDay(d,off,min){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+off,0,min,0,0);}

/* "Mo-Sa 08:00-18:30; Su 10:00-16:00" -> [{days:[7],from,to}], null = at any time, undefined = could not read */
function parseHours(str){
  if(str==null) return undefined;
  str=String(str).trim().replace(/^\(+|\)+$/g,'').trim();
  if(!str) return undefined;
  if(/^24\/7$/.test(str)) return null;
  var out=[], ok=true;
  str.split(';').forEach(function(part){
    part=part.trim(); if(!part) return;
    if(/\b(off|closed)\b/.test(part)) return;
    var m=part.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\s*[-,]?\s*)+)?\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+)?$/);
    if(!m||(!m[1]&&!m[2])){ok=false;return;}
    var days=[0,0,0,0,0,0,0];
    if(m[1]){
      m[1].replace(/\s/g,'').split(',').forEach(function(tok){
        var r=tok.split('-').filter(Boolean); if(!r.length) return;
        var a=DAYS.indexOf(r[0]), b=r[1]?DAYS.indexOf(r[1]):a;
        if(a<0||b<0) return;
        for(var i=a;;i=(i+1)%7){days[i]=1;if(i===b)break;}
      });
      if(!days.some(Boolean)){ok=false;return;}
    } else days=[1,1,1,1,1,1,1];
    var times=m[2]?m[2].match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g):['00:00-24:00'];
    times.forEach(function(t){
      var p=t.split('-').map(function(x){var q=x.trim().split(':');return +q[0]*60+ +q[1];});
      if(p[1]>p[0]) out.push({days:days.slice(),from:p[0],to:Math.min(1440,p[1])});
      else if(p[1]<p[0]){
        out.push({days:days.slice(),from:p[0],to:1440});
        if(p[1]>0) out.push({days:days.map(function(_,i){return days[(i+6)%7];}),from:0,to:p[1]});
      } else out.push({days:days.slice(),from:0,to:1440});
    });
  });
  return ok&&out.length?out:undefined;
}
/* "2 hours", "30 minutes", "1 h", "90 min", "02:00" -> minutes */
function parseStay(s){
  if(s==null) return 0; s=String(s).trim().toLowerCase();
  var m=s.match(/^(\d{1,2}):(\d{2})$/); if(m) return +m[1]*60+ +m[2];
  m=s.match(/^([\d.]+)\s*(h|hr|hrs|hour|hours)\b/); if(m) return Math.round(parseFloat(m[1])*60);
  m=s.match(/^([\d.]+)\s*(m|min|mins|minute|minutes)\b/); if(m) return Math.round(parseFloat(m[1]));
  m=s.match(/^([\d.]+)\s*(d|day|days)\b/); if(m) return Math.round(parseFloat(m[1])*1440);
  m=s.match(/^(\d+)$/); if(m) return +m[1];
  return 0;
}
function activeAt(spec,d){
  if(!spec) return true;
  var m=d.getHours()*60+d.getMinutes(), di=dayIx(d);
  return spec.some(function(s){return s.days[di]&&m>=s.from&&m<s.to;});
}
/* the next moment the restriction switches on or off; null if it never does */
function nextFlip(spec,d){
  if(!spec) return null;
  var cur=activeAt(spec,d), c=[], di=dayIx(d);
  for(var k=0;k<=8;k++) spec.forEach(function(s){ if(s.days[(di+k)%7]){c.push(atDay(d,k,s.from));c.push(atDay(d,k,s.to));} });
  c=c.filter(function(t){return t>d;}).sort(function(a,b){return a-b;});
  for(var i=0;i<c.length;i++) if(activeAt(spec,c[i])!==cur) return c[i];
  return null;
}
function signTime(min){
  if(min===0||min===1440) return 'midnight'; if(min===720) return 'noon';
  var h=Math.floor(min/60), m=min%60, ap=h>=12?'pm':'am'; h=h%12||12;
  return h+(m?'.'+(m<10?'0':'')+m:'')+' '+ap;
}
function dayRange(days){
  if(days.every(Boolean)) return '';
  var runs=[], i=0;
  while(i<7){ if(days[i]){var j=i;while(j<6&&days[j+1])j++;runs.push(i===j?DAYNAMES[i]:DAYNAMES[i]+' - '+DAYNAMES[j]);i=j+1;} else i++; }
  return runs.join(', ');
}
/* sign-style lines: ["Mon - Sat", "8 am - 6.30 pm"] */
function describeHours(spec){
  if(spec===null) return ['At any time'];
  if(!spec) return [];
  var seen={}, out=[];
  spec.forEach(function(s){
    var key=s.days.join('')+':'+s.from+':'+s.to; if(seen[key]) return; seen[key]=1;
    var d=dayRange(s.days), t=(s.from===0&&s.to===1440)?'All day':signTime(s.from)+' - '+signTime(s.to);
    out.push((d?d+' ':'')+t);
  });
  return out;
}
function fmtDur(min){
  min=Math.max(0,Math.round(min));
  if(min>=1440){var dd=Math.floor(min/1440), hh=Math.round((min%1440)/60);return dd+(dd===1?' day':' days')+(hh?' '+hh+' h':'');}
  var h=Math.floor(min/60), m=min%60;
  return h?(h+(h===1?' hour':' hours')+(m?' '+m+' min':'')):m+' min';
}
function hhmm(d){return (d.getHours()<10?'0':'')+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();}
function fmtWhen(t,now){
  var a=new Date(now.getFullYear(),now.getMonth(),now.getDate()), b=new Date(t.getFullYear(),t.getMonth(),t.getDate());
  var diff=Math.round((b-a)/86400000);
  return (diff===0?'today at ':diff===1?'tomorrow at ':DAYNAMES[dayIx(t)]+' at ')+hhmm(t);
}

var KIND_NAME={dy:'Double yellow lines',sy:'Single yellow line',dr:'Double red lines',sr:'Single red line',pay:'Paid bay',limited:'Limited waiting bay',
  permit:'Permit holders bay',disabled:'Disabled bay',loading:'Loading bay',free:'No restriction',zigzag:'Zig-zag lines',carpark:'Car park',unknown:'Not known'};

/* verdict for a rule at a moment. o: {badge, permit, paidUntil:Date} */
function verdict(rule,now,o){
  o=o||{};
  var k=rule.kind, h=rule.hours, unk=!!rule.hoursUnknown, ms=rule.maxStay||0;
  var act=unk?null:activeAt(h,now), flip=unk?null:nextFlip(h,now);
  var v={state:'ok',title:'',lines:[],leaveBy:null,leaveLabel:''};
  function add(ms_,t){return new Date(t.getTime()+ms_*60000);}
  function stayLimit(){
    if(!ms) return null;
    if(h===null) return add(ms,now);
    if(act){ var t=add(ms,now); if(!flip||t<flip) return t; var s=nextFlip(h,flip); return s?add(ms,s):null; }
    return flip?add(ms,flip):null;
  }
  if(k==='dy'){v.state='no';v.title='No waiting at any time';
    v.lines.push('You may stop briefly to set down or pick up passengers.');
    v.lines.push('Loading is allowed unless there are yellow marks on the kerb.');
    if(o.badge) v.lines.push('Blue Badge: usually up to 3 hours with the clock set, where there is no loading ban. Not on red routes, and not in parts of central London.');}
  else if(k==='dr'){v.state='no';v.title='No stopping at any time';v.lines.push('Red route. Stopping even briefly can bring a penalty, usually by camera.');}
  else if(k==='zigzag'){v.state='no';v.title='No stopping on zig-zags';v.lines.push('Zig-zags mark a crossing or a school entrance. Do not stop here, even to drop off.');}
  else if(k==='sy'||k==='sr'||k==='loading'||(k==='permit'&&!o.permit)){
    var nm={sy:'No waiting',sr:'No stopping',loading:'Loading only',permit:'Permit holders only'}[k];
    if(unk){v.state='check';v.title=KIND_NAME[k]+': check the times';
      v.lines.push(k==='sy'?'The hours are on a small yellow plate nearby, or on the zone entry sign you passed.':'The hours are on the sign beside the bay or kerb.');
      v.lines.push('Add the hours from the sign to get a leave-by time.');}
    else if(act){v.state='no';v.title=nm+' right now';
      v.lines.push(flip?'The restriction ends '+fmtWhen(flip,now)+'.':'This applies at all times.');v.freeFrom=flip;}
    else{v.title='You can park here now';v.leaveBy=flip;v.leaveLabel=nm+' starts';
      if(k==='permit') v.lines.push('Outside permit hours anyone may park in this bay.');}
  }
  else if(k==='permit'){v.title='Your permit covers this bay';if(rule.zone)v.lines.push('Zone '+rule.zone+'.');}
  else if(k==='disabled'){
    if(o.badge){v.title='Blue Badge bay';v.lines.push('Display your badge. Set the clock if the sign gives a time limit.');v.leaveBy=stayLimit();v.leaveLabel='Maximum stay ends';}
    else{v.state='no';v.title='Blue Badge holders only';v.lines.push('Parking here without a badge on display brings a penalty.');}
  }
  else if(k==='pay'){
    if(unk){v.state='pay';v.title='Paid bay: check the hours';v.lines.push('Charging hours and the maximum stay are on the sign or the machine.');}
    else if(act){v.state='pay';v.title='Pay to park here';
      var lim=stayLimit();
      if(o.paidUntil){
        if(flip&&o.paidUntil>=flip){v.leaveBy=nextFlip(h,flip);v.leaveLabel='Charges start again';}
        else{v.leaveBy=o.paidUntil;v.leaveLabel='Paid time ends';}
        if(lim&&v.leaveBy&&lim<v.leaveBy){v.leaveBy=lim;v.leaveLabel='Maximum stay ends';}
        v.title='Paid until '+hhmm(o.paidUntil);
      } else {
        if(lim){v.leaveBy=lim;v.leaveLabel='Maximum stay ends';}
        v.lines.push(flip?'Charges apply until '+fmtWhen(flip,now)+'.':'Charges apply at all times.');
        v.lines.push('Enter the time you have paid until to get a warning before it runs out.');
      }
    } else {v.title='Free to park right now';v.leaveBy=flip;v.leaveLabel='Charges start';}
  }
  else if(k==='limited'){
    if(unk){v.state='check';v.title='Time-limited bay: check the sign';v.lines.push('Add the hours and the maximum stay from the sign.');}
    else{v.title=act?(ms?'You can park for up to '+fmtDur(ms):'You can park here now'):'No time limit right now';
      v.leaveBy=stayLimit();v.leaveLabel='Maximum stay ends';
      if(!act&&flip) v.lines.push('The time limit starts '+fmtWhen(flip,now)+'.');}
  }
  else if(k==='carpark'){
    if(h!==undefined&&!unk&&h!==null&&!act){v.state='no';v.title='Closed right now';if(flip)v.lines.push('Opens '+fmtWhen(flip,now)+'.');}
    else{v.state=rule.fee?'pay':'ok';v.title=rule.fee?'Pay to park':(rule.feeUnknown?'Car park: check for charges':'Free car park');
      if(ms){v.leaveBy=add(ms,now);v.leaveLabel='Maximum stay ends';}
      if(o.paidUntil&&(!v.leaveBy||o.paidUntil<v.leaveBy)){v.leaveBy=o.paidUntil;v.leaveLabel='Paid time ends';}
      if(h&&flip&&act) v.lines.push('Closes '+fmtWhen(flip,now)+'.');}
  }
  else if(k==='free'){v.title='No restriction here';
    v.lines.push('Still check for a zone entry sign: in a controlled zone, unmarked kerbs can be restricted.');
    v.lines.push('Keep clear of dropped kerbs and stay 10 metres from a junction.');}
  else{v.state='check';v.title='No rules found for this spot';v.lines.push('Look at the lines on the road and the nearest sign, then tell the app what you see.');}
  if(ms&&k!=='carpark'&&v.state!=='no'&&v.state!=='check') v.lines.push('Maximum stay '+fmtDur(ms)+(rule.noReturn?', no return within '+fmtDur(rule.noReturn):'')+'.');
  return v;
}

/* ---------- OpenStreetMap tags -> rules ---------- */
function condSplit(s){ /* "no_parking @ (Mo-Sa 08:00-18:30)" -> {val, hours} ; first clause only */
  if(!s) return null;
  var first=String(s).split(/;\s*(?=[a-z0-9_ ]+@)/i)[0], m=first.match(/^\s*([^@]+?)\s*@\s*\(?(.+?)\)?\s*$/);
  return m?{val:m[1].trim(),hours:parseHours(m[2])}:null;
}
function sideRule(get){
  var r=get('restriction'), rc=condSplit(get('restriction:conditional')), fee=get('fee'), fc=condSplit(get('fee:conditional')),
      stay=get('maxstay'), sc=condSplit(get('maxstay:conditional')), acc=get('access'), ac=condSplit(get('access:conditional')), pos=get(''), zone=get('zone');
  function withHours(rule,cond){ if(cond){ if(cond.hours===undefined) rule.hoursUnknown=true; else rule.hours=cond.hours; } else rule.hours=null; return rule; }
  if(r==='no_stopping') return {kind:'dr',hours:null};
  if(r==='no_parking'||r==='no_standing') return {kind:'dy',hours:null};
  if(r==='loading_only') return {kind:'loading',hours:null};
  if(rc){
    var kind={no_parking:'sy',no_standing:'sy',no_stopping:'sr',loading_only:'loading'}[rc.val];
    if(kind) return withHours({kind:kind},rc);
  }
  if(pos==='no') return {kind:'dy',hours:null,soft:true};
  var permitVals=/^(permit|residents|private|customers)$/;
  if(permitVals.test(acc||'')) return {kind:'permit',hours:null,zone:zone||''};
  if(ac&&permitVals.test(ac.val)) return withHours({kind:'permit',zone:zone||''},ac);
  if(fee==='yes'||(fc&&fc.val==='yes')){
    var p=withHours({kind:'pay'},fc&&fc.val==='yes'?fc:null);
    p.maxStay=parseStay(sc?sc.val:stay); if(zone)p.zone=zone; return p;
  }
  if(sc||stay){ var l=withHours({kind:'limited'},sc); l.maxStay=parseStay(sc?sc.val:stay); return l.maxStay?l:{kind:'free',hours:null}; }
  if(pos&&pos!=='separate'||fee==='no'||r==='none') return {kind:'free',hours:null};
  return null;
}
function oldSideRule(tags,side){ /* older parking:condition:* scheme */
  function g(k){var a=tags['parking:condition:'+side+(k?':'+k:'')];return a!=null?a:tags['parking:condition:both'+(k?':'+k:'')];}
  var c=g(''); if(!c) return null;
  var ti=g('time_interval'), hours=ti?parseHours(ti):null, unk=ti&&hours===undefined, stay=parseStay(g('maxstay'));
  var kind={no_parking:hours||unk?'sy':'dy',no_standing:hours||unk?'sy':'dy',no_stopping:hours||unk?'sr':'dr',ticket:'pay',residents:'permit',disc:'limited',free:stay?'limited':'free',loading:'loading'}[c];
  if(!kind) return null;
  var rule={kind:kind,hours:unk?undefined:(hours||null)}; if(unk) rule.hoursUnknown=true; if(stay) rule.maxStay=stay;
  return rule;
}
function osmStreetRules(tags){
  var out=[];
  ['left','right'].forEach(function(side){
    var rule=sideRule(function(k){var key=k?':'+k:'';var a=tags['parking:'+side+key];return a!=null?a:tags['parking:both'+key];})||oldSideRule(tags,side);
    if(rule){rule.src='osm';out.push({side:side,rule:rule});}
  });
  if(out.length===2&&JSON.stringify(out[0].rule)===JSON.stringify(out[1].rule)) return [{side:'both',rule:out[0].rule}];
  return out;
}
function osmCarpark(tags){
  var rule={kind:'carpark',src:'osm',name:tags.name||'',fee:tags.fee==='yes'||(!!tags.fee&&tags.fee!=='no'&&tags.fee!=='unknown'),feeUnknown:!tags.fee,
    maxStay:parseStay(tags.maxstay),operator:tags.operator||'',capacity:tags.capacity||'',type:tags.parking||''};
  if(tags.opening_hours){var h=parseHours(tags.opening_hours); if(h===undefined) rule.hoursUnknown=false; rule.hours=h===undefined?null:h; rule.hoursText=tags.opening_hours;}
  else rule.hours=null;
  return rule;
}
/* ---------- geometry ---------- */
function dist(a,b){var R=6371000,p=Math.PI/180,x=(b.lon-a.lon)*p*Math.cos((a.lat+b.lat)*p/2),y=(b.lat-a.lat)*p;return Math.sqrt(x*x+y*y)*R;}
function distToLine(pt,geom){ /* metres from point to polyline [{lat,lon}] */
  var best=Infinity, p=Math.PI/180, k=Math.cos(pt.lat*p);
  for(var i=0;i<geom.length-1;i++){
    var ax=(geom[i].lon-pt.lon)*k, ay=geom[i].lat-pt.lat, bx=(geom[i+1].lon-pt.lon)*k, by=geom[i+1].lat-pt.lat;
    var dx=bx-ax, dy=by-ay, t=dx||dy?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))):0;
    var cx=ax+t*dx, cy=ay+t*dy, d=Math.sqrt(cx*cx+cy*cy)*p*6371000;
    if(d<best) best=d;
  }
  return best;
}
function compass(a,b){var p=Math.PI/180,y=Math.sin((b.lon-a.lon)*p)*Math.cos(b.lat*p),x=Math.cos(a.lat*p)*Math.sin(b.lat*p)-Math.sin(a.lat*p)*Math.cos(b.lat*p)*Math.cos((b.lon-a.lon)*p);
  var deg=(Math.atan2(y,x)/p+360)%360;return {deg:deg,word:['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round(deg/45)%8]};}

/* ---------- words on a sign -> rules ---------- */
var DAYWORD={mon:0,tue:1,tues:1,wed:2,thu:3,thur:3,thurs:3,fri:4,sat:5,sun:6};
function signTimeToMin(h,m,ap,word){
  if(word==='noon'||word==='midday') return 720; if(word==='midnight') return 1440;
  h=+h; m=+(m||0); if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0; return h*60+m;
}
function parseSignText(text){
  var t=' '+String(text||'').toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ')+' ';
  var rule={src:'photo'}, notes=[];
  var kind='';
  if(/red route|no stopping/.test(t)) kind=/at any time/.test(t)?'dr':'sr';
  else if(/permit holders?|residents?('| )?s? (permit|only|parking)|permit .{0,12}only/.test(t)) kind='permit';
  else if(/disabled|blue badge/.test(t)) kind='disabled';
  else if(/loading only|goods vehicles? loading/.test(t)) kind='loading';
  else if(/pay (at|by|here|and display)|pay & display|ticket machine|paybyphone|ringgo|tariff|charges apply/.test(t)) kind='pay';
  else if(/no (waiting|parking)/.test(t)) kind=/at any time/.test(t)?'dy':'sy';
  else if(/no return|(\d+)\s*(hours?|hrs?|mins?|minutes?)/.test(t)) kind='limited';
  else if(/at any time/.test(t)) kind='dy';
  if(!kind) return [];
  rule.kind=kind;
  var z=t.match(/zone\s+([a-z0-9]{1,4})\b/)||t.match(/permit holders?\s+([a-z]{1,2}\d{0,2})\s+only/);
  if(z&&kind==='permit'&&!/^(only|ends?)$/.test(z[1])) rule.zone=z[1].toUpperCase();
  var days=[0,0,0,0,0,0,0], dm, dre=/\b(mon|tues?|wed|thur?s?|fri|sat|sun)(?:day|nesday|urday)?s?\b(?:\s*(?:-|to)\s*(mon|tues?|wed|thur?s?|fri|sat|sun)(?:day|nesday|urday)?s?\b)?/g, anyDay=false;
  while((dm=dre.exec(t))){var a=DAYWORD[dm[1]], b=dm[2]?DAYWORD[dm[2]]:a; if(a==null||b==null) continue; anyDay=true; for(var i=a;;i=(i+1)%7){days[i]=1;if(i===b)break;}}
  if(!anyDay) days=[1,1,1,1,1,1,1];
  var tre=/(?:(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?|(noon|midday|midnight))\s*(?:-|to|until)\s*(?:(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?|(noon|midday|midnight))/g, tm, spans=[];
  while((tm=tre.exec(t))){
    if(!tm[3]&&!tm[7]&&!tm[4]&&!tm[8]&&!tm[2]&&!tm[6]) continue; /* bare "2 - 4" is not a time */
    var ap1=tm[3]||(tm[7]&&+tm[1]<=+tm[5]&&tm[7]==='pm'&&+tm[5]!==12?'pm':tm[3]), from=signTimeToMin(tm[1],tm[2],ap1||(tm[7]?'am':''),tm[4]), to=signTimeToMin(tm[5],tm[6],tm[7],tm[8]);
    if(!tm[7]&&!tm[8]&&to<=from&&+tm[5]<12) to+=720;
    if(to>from) spans.push([from,to]);
  }
  if(/at any time/.test(t)||(!spans.length&&!anyDay)){ rule.hours=null; if(!/at any time/.test(t)&&/^(sy|sr|pay|limited|permit|loading)$/.test(kind)){rule.hoursUnknown=true;delete rule.hours;notes.push('No hours could be read. Add them by hand if the sign shows any.');} }
  else if(!spans.length) rule.hours=[{days:days,from:0,to:1440}];
  else rule.hours=spans.map(function(s){return {days:days.slice(),from:s[0],to:Math.min(1440,s[1])};});
  var nr=t.match(/no return (?:within|for)\s*(\d+)\s*(hours?|hrs?|mins?|minutes?)/);
  if(nr) rule.noReturn=+nr[1]*(/^h/.test(nr[2])?60:1);
  var rest=nr?t.replace(nr[0],' '):t, st=rest.match(/(?:max(?:imum)? stay\s*)?\b(\d+)\s*(hours?|hrs?|mins?|minutes?)\b/);
  if(st&&/^(pay|limited|disabled)$/.test(kind)) rule.maxStay=+st[1]*(/^h/.test(st[2])?60:1);
  if(/bank holiday/.test(t)) notes.push('The sign mentions bank holidays. Read that line yourself.');
  if(/except/.test(t)) notes.push('The sign lists an exception. Check whether it applies to you.');
  if(/match ?day|event day/.test(t)) notes.push('Different rules apply on match or event days.');
  return [{rule:rule,notes:notes}];
}
/* structured answer from the sign reader -> rules */
function rulesFromReader(d){
  return (d&&Array.isArray(d.rules)?d.rules:[]).map(function(x){
    var k=String(x.kind||''); if(!KIND_NAME[k]||k==='unknown'||k==='carpark') return null;
    var rule={kind:k,src:'photo'}, notes=Array.isArray(x.notes)?x.notes.filter(function(n){return typeof n==='string';}).map(function(n){return n.slice(0,200);}).slice(0,4):[];
    if(x.anyTime||/^(dy|dr|zigzag|free)$/.test(k)) rule.hours=null;
    else{
      var days=[0,0,0,0,0,0,0]; (Array.isArray(x.days)?x.days:[]).forEach(function(n){var i=DAYS.indexOf(String(n).slice(0,2));if(i>=0)days[i]=1;});
      var h=days.some(Boolean)&&/^\d{1,2}:\d{2}$/.test(x.from||'')&&/^\d{1,2}:\d{2}$/.test(x.to||'')?parseHours(days.map(function(v,i){return v?DAYS[i]:'';}).filter(Boolean).join(',')+' '+x.from+'-'+x.to):undefined;
      if(h===undefined){ if(k==='disabled') rule.hours=null; else rule.hoursUnknown=true; } else rule.hours=h;
    }
    if(+x.maxStayMin>0) rule.maxStay=Math.min(1440,Math.round(+x.maxStayMin));
    if(+x.noReturnMin>0) rule.noReturn=Math.min(1440,Math.round(+x.noReturnMin));
    if(x.zone&&k==='permit') rule.zone=String(x.zone).slice(0,8).toUpperCase();
    return {rule:rule,notes:notes};
  }).filter(Boolean);
}
