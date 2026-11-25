import {view,model,timeOf} from './analysis.js';
const names={
  xau:['国际现货黄金','XAU / USD','美元/盎司','#e9c67e','https://quote.cngold.org/gjs/gjhj_xhhj.html'],
  sge:['国内现货黄金','SGE · Au99.99','元/克','#dcb795','https://quote.cngold.org/gjs/jjs_hj9999.html'],
  brent:['布伦特原油','BRENT','美元/桶','#84c6be','https://m.cngold.org/quote/oil/gjyy_bltyy.html'],
  tips:['美债实际利率','TIPS · DFII10','%','#a8bcea','https://fred.stlouisfed.org/series/DFII10']
};
const $=s=>document.querySelector(s), data={market:{},rate:{},minute:{},daily:{}}, fresh={};
let id='xau',days=1,hover=-1,busy=false,checked='',records={},dailyAt=0;
const fmt=v=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const signed=(n,d=2)=>!Number.isFinite(n)?'—':(n>0?'+':'')+n.toFixed(d);
const label=(k,v)=>k==='tips' ? v.change===null?'—':signed(Math.round(v.change*100),0)+' 基点' : signed(v.percent)+'%';
const groupFor=k=>days===1?(k==='tips'?'rate':'market'):'daily';
const texts=(el,value)=>{el.textContent=value;};
const smallDate=s=>s.length>10?s.slice(11,16):s.slice(5);
const stamp=r=>r?.asof || r?.points?.at(-1)?.[0] || '';
const cardNodes={};
for(const [key,[name,code,unit,color]] of Object.entries(names)){
  const b=document.createElement('button'); b.className='card';b.style.setProperty('--accent',color);
  b.innerHTML='<span class="ticker"></span><span class="card-title"></span><span class="card-value"><b></b><small></small></span><span class="card-delta"></span><canvas class="mini" aria-hidden="true"></canvas><span class="card-meta"></span>';
  texts(b.querySelector('.ticker'),code);texts(b.querySelector('.card-title'),name);texts(b.querySelector('small'),unit);
  b.addEventListener('click',()=>{id=key;hover=-1;render();});
  $('#cards').append(b);cardNodes[key]=b;
}
function sizeCanvas(canvas){
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
  if(!w || !h)return null;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  return {w,h,ctx};
}
function plot(canvas,points,color,full=false){
  const box=sizeCanvas(canvas);if(!box || !points.length)return;
  const {w,h,ctx}=box,root=getComputedStyle(document.documentElement);
  ctx.font=full?'12px Consolas, monospace':'10px sans-serif';
  const vals=points.map(p=>p[1]),times=points.map(p=>timeOf(p[0]));
  const lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.08 || Math.max(.01,Math.abs(hi)*.0005);
  const bottom=full?h-24:h-2,top=full?7:2,left=full?Math.ceil(ctx.measureText(fmt(hi+pad)).width)+12:2,right=w-(full?6:2);
  const px=i=>left+(right-left)*(times[i]-times[0])/(times.at(-1)-times[0]||1);
  const py=v=>bottom-(bottom-top)*(v-lo+pad)/(hi-lo+2*pad);
  if(full){
    ctx.fillStyle='#a1aea5';ctx.strokeStyle=root.getPropertyValue('--line');ctx.lineWidth=1;
    for(let i=0;i<4;i++){
      const v=lo-pad+(hi-lo+pad*2)*i/3,y=py(v);ctx.beginPath();ctx.setLineDash([3,5]);
      ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(fmt(v),left-8,y+4);
    }
    ctx.setLineDash([]);const indices=[0,Math.floor((times.length-1)/2),times.length-1];
    indices.forEach((j,i)=>{if(i===1&&(j===0||right-left<210))return;
      ctx.textAlign=['left','center','right'][i];ctx.fillText(smallDate(points[j][0]),px(j),h-3);});
  }
  let start=0;
  for(let i=1;i<=points.length;i++){
    if(i<points.length && (points[i][0].length===10 || times[i]-times[i-1]<=900000))continue;
    ctx.beginPath();
    for(let j=start;j<i;j++)j===start?ctx.moveTo(px(j),py(vals[j])):ctx.lineTo(px(j),py(vals[j]));
    ctx.strokeStyle=color;ctx.lineWidth=full?2:1.5;ctx.lineJoin='round';ctx.stroke();
    if(full){
      ctx.lineTo(px(i-1),bottom);ctx.lineTo(px(start),bottom);ctx.closePath();
      const gradient=ctx.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,color+'33');gradient.addColorStop(1,color+'02');ctx.fillStyle=gradient;ctx.fill();
    }
    start=i;
  }
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(px(points.length-1),py(vals.at(-1)),full?3:2,0,Math.PI*2);ctx.fill();
  if(full){
    geometry={times,left,right};
    if(hover>=0 && hover<points.length){
      const x=px(hover),y=py(vals[hover]);ctx.beginPath();ctx.strokeStyle='#b3beb8';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
      const box=$('#hover');box.hidden=false;box.textContent=points[hover][0]+'  ·  '+fmt(vals[hover]);
      box.style.left=Math.max(0,Math.min(w-box.offsetWidth,x+8))+'px';box.style.top='0px';
    }
  }
}
let geometry;
function mainPlot(){
  geometry=null;$('#hover').hidden=true;
  const v=records[id];if(!v)return;
  $('#empty').hidden=!!v.pts.length;
  plot($('#plot canvas'),v.pts,names[id][3],true);
}
function updateModel(){
  const m=model(data);
  if(!m){texts($('#formula'),'金价日涨跌幅 ≈ 常数 + b × 布油日涨跌幅 + c × 实际利率变动');texts($('#fit'),'共同交易日不足，等待历史数据');return;}
  const term=v=>(v<0?' − ':' + ')+Math.abs(v).toFixed(3);
  texts($('#formula'),'金价日涨跌幅 ≈ '+m.a.toFixed(3)+term(m.b)+' × 布油日涨跌幅'+term(m.c)+' × 实际利率变动');
  const stats=['样本期间  '+m.start+' 至 '+m.end,'共同区间  '+m.n+' 个','样本内解释度 R²  '+(100*m.r2).toFixed(1)+'%'];
  $('#fit').replaceChildren(...stats.map(s=>{const e=document.createElement('span');e.textContent=s;return e;}));
}
function render(){
  records={};
  for(const [k,b] of Object.entries(cardNodes)){
    const v=records[k]=view(data,k,days);b.setAttribute('aria-pressed',String(k===id));
    texts(b.querySelector('b'),fmt(v.price));
    const d=b.querySelector('.card-delta');d.className='card-delta '+(v.change>0?'up':v.change<0?'down':'flat');
    texts(d,(days===1?(k==='tips'?'较前次观测':'较昨收'):days===7?'近一周':'近一月')+'  '+label(k,v));
    texts(b.querySelector('.card-meta'),(fresh[groupFor(k)]?.includes(k)?'':'留存 · ')+(v.asof||'等待更新'));
    plot(b.querySelector('canvas'),v.pts,names[k][3]);
  }
  const v=records[id],[name,code,unit,,url]=names[id], points=v.pts;
  texts($('#code'),code);texts($('#chart-title'),name+'走势');texts($('#unit'),unit);
  texts($('#series-label'),(days===1?(id==='tips'?'相邻两次日度观测':'交易时段 · 分钟价'):'近 '+days+' 天 · 日度走势')+(!fresh[days===1?(id==='tips'?'rate':'minute'):'daily']?.includes(id)?' · 留存数据':''));
  texts($('#asof'),points.length?points[0][0]+' 至 '+points.at(-1)[0]:'等待数据');
  const vals=points.map(p=>p[1]),base=days===1&&id!=='tips'?'昨收价':'区间起点';
  const entries=[[base,fmt(v.prev)],['区间末值',fmt(v.price)],['走势最高',vals.length?fmt(Math.max(...vals)):'—'],['走势最低',vals.length?fmt(Math.min(...vals)):'—'],['区间变动',label(id,v)]];
  const dl=document.createElement('dl');
  entries.forEach(([key,val])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=val;dl.append(dt,dd);});$('#range').replaceChildren(dl);
  const link=$('#origin');link.href=id==='tips'&&v.source==='美联储 H.15'?'https://www.federalreserve.gov/releases/h15/':url;link.textContent=v.source;
  const count=Object.values(fresh).reduce((s,keys)=>s+keys.length,0);
  texts($('#status'),busy?'正在刷新行情…':checked?'最近采集检查 '+checked+'（北京时间） · '+(count===11?'已读取全部行情':count?'部分数据使用留存记录':'当前显示留存记录'):'显示留存记录 · 等待采集时间');
  mainPlot();updateModel();
}
function merge(group,records){
  for(const [k,r] of Object.entries(records||{})){
    if(!Object.hasOwn(names,k) || !r || stamp(r)<stamp(data[group][k]))continue;
    if(group==='daily'||group==='minute'){
      if(!Array.isArray(r.points)||!r.points.length||r.points.length>2000||!r.points.every(p=>Array.isArray(p)&&Number.isFinite(p[1])&&Number.isFinite(timeOf(p[0]))))continue;
    }else if(!Number.isFinite(r.value)||!Number.isFinite(timeOf(r.asof)))continue;
    data[group][k]=r;
  }
}
async function refresh(force=false){
  if(busy)return;busy=true;$('#refresh').disabled=true;render();
  const slow=force || Date.now()-dailyAt>=900000;
  const groups=slow?['market','minute','daily','rate']:['market','minute'];
  await Promise.all(groups.map(async group=>{
    try {
      const r=await fetch('./data/'+group+'.json',{cache:'no-store',signal:AbortSignal.timeout(23000)});
      if(!r.ok)throw Error();
      const msg=await r.json();merge(group,msg.records);
      if(msg.checked>checked)checked=msg.checked;
      const age=Date.now()-Date.parse(msg.checked.replace(' ','T')+'+08:00');
      const recent=Number.isFinite(age) && age>=-60000 && age<20*60000;
      fresh[group]=(recent?msg.valid||[]:[]).filter(k=>stamp(msg.records[k])>=stamp(data[group][k]));
    }catch{fresh[group]=[];}
    render();
  }));
  if(slow)dailyAt=fresh.daily?.length===4&&fresh.rate?.length===1?Date.now():0;
  busy=false;$('#refresh').disabled=false;
  try{localStorage.setItem('goldboard.pages.v1',JSON.stringify(data));}catch{}render();
}
document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{days=+b.dataset.days;hover=-1;document.querySelectorAll('[data-days]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));render();});
$('#refresh').onclick=()=>refresh(true);$('#sources').onclick=()=>$('#source-dialog').showModal();$('#close-dialog').onclick=()=>$('#source-dialog').close();
$('#source-dialog').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.close();};
$('#plot').onpointermove=e=>{
  if(!geometry)return;
  const {times,left,right}=geometry,x=e.clientX-$('#plot').getBoundingClientRect().left;
  const target=times[0]+(times.at(-1)-times[0])*(x-left)/(right-left);
  hover=times.reduce((best,t,i)=>Math.abs(t-target)<Math.abs(times[best]-target)?i:best,0);mainPlot();
};
$('#plot').onpointerleave=()=>{hover=-1;mainPlot();};
$('#plot').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();hover=Math.max(0,Math.min(records[id].pts.length-1,hover+(e.key==='ArrowLeft'?-1:1)));mainPlot();};
new ResizeObserver(()=>render()).observe($('#plot'));
try{const cached=JSON.parse(localStorage.getItem('goldboard.pages.v1')||'{}');for(const group of Object.keys(data))merge(group,cached[group]);}catch{}
render();
try{const r=await fetch('./snapshot.json');if(r.ok){const seed=await r.json();for(const g of Object.keys(data))merge(g,seed[g]);}}catch{}
await refresh(true);setInterval(()=>{if(!document.hidden)refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
