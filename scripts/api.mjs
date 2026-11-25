const instruments = { xau: ['JO_92233','XAU','美元/盎司'], sge: ['JO_71','Au9999','元/克'], brent: ['JO_92272','BOIL','美元/桶'] };
const referer = 'https://quote.cngold.org/';
const base = 'https://api.jijinhao.com/';
const fred = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10';
const treasury = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
const bj = ms => new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');
const positive = n => Number.isFinite(n) && n > 0;
const cache = new Map();
const inFlight = new Map();

async function read(url, ms=8500) {
  const response = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0', ...(url.startsWith(base) ? {Referer:referer} : {})},signal:AbortSignal.timeout(ms)});
  if (!response.ok) throw new Error('上游暂不可用');
  return response.text();
}
async function jsonp(path) {
  const raw=await read(base+path);
  const match=raw.match(/^\s*var\s+\w+\s*=\s*([\s\S]+?)\s*;?\s*$/);
  if (!match) throw new Error('行情格式改变');
  return JSON.parse(match[1]);
}
async function quotes() {
  const codes=Object.values(instruments).map(([code])=>code).join(',');
  const data=await jsonp('quoteCenter/realTime.htm?codes='+codes);
  const values={};
  for(const [id,[code,symbol,unit]] of Object.entries(instruments)) {
    const q=data[code];
    if(!q || q.showCode!==symbol || q.unit!==unit || !positive(q.q63) || !positive(q.time) || q.time>Date.now()+600000) continue;
    values[id]={value:q.q63,previous:q.q2,opening:q.q1,low:q.q4,high:q.q3,asof:bj(q.time),source:'金投网'};
  }
  return values;
}
function pointRecord(points, extra={}) {
  if(!points.length) throw new Error('没有有效历史数据');
  return {points:[...new Map(points)].sort((a,b)=>a[0].localeCompare(b[0])),fetched:bj(Date.now()),...extra};
}
async function history(id,minute) {
  const [code]=instruments[id];
  const data=await jsonp('sQuoteCenter/'+(minute?'todayMin':'kDataList')+'.htm?code='+code);
  if(minute){
    const rows=data.data;
    const start=Math.max(0,rows.findIndex(r=>r.volume>0));
    return pointRecord(rows.slice(start).filter(r=>positive(r.price)&&positive(r.date)&&r.date<=Date.now()).map(r=>[bj(r.date).slice(0,16),r.price]));
  }
  const rows=data.data[0].slice(-270).filter(r=>positive(r.close)&&/^\d{4}\/\d{2}\/\d{2}$/.test(r.day));
  return pointRecord(rows.map(r=>[r.day.replaceAll('/','-'),r.close]),{opening:rows.at(-1)?.open});
}
async function treasuryYear(year){
  const xml=await read(treasury+'?data=daily_treasury_real_yield_curve&field_tdr_date_value='+year);
  const points=[];
  for(const [entry] of xml.matchAll(/<m:properties>[\s\S]*?<\/m:properties>/g)) {
    const day=entry.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/);
    const value=entry.match(/<d:TC_10YEAR[^>]*>([-+\d.]+)</);
    if(day && value && Number.isFinite(+value[1])) points.push([day[1],+value[1]]);
  }
  return points;
}
async function treasuryHistory(){
  const current=new Date().getUTCFullYear(), prior=new Date(Date.now()-250*86400000).getUTCFullYear();
  const byYear=await Promise.all([...new Set([prior,current])].map(treasuryYear));
  return pointRecord(byYear.flat().slice(-270));
}
function h15(html){
  const table=html.match(/<table[^>]+id="h15table"[\s\S]*?<\/table>/i)?.[0] || '';
  const dates={};
  for(const [,col,year,month,day] of table.matchAll(/<th id="(col\d+)"[^>]*>\s*(\d{4})<br\s*\/?>\s*(\w+)<br\s*\/?>\s*(\d+)<\/th>/gi)) {
    const d=new Date(month+' '+day+', '+year+' 00:00:00 GMT');
    if(!isNaN(d)) dates[col]=d.toISOString().slice(0,10);
  }
  const segment=table.split(/>\s*Inflation indexed\b/i)[1] || '';
  const row=segment.match(/>10-year<\/th>([\s\S]*?)<\/tr>/i)?.[1] || '';
  const points=[];
  for(const [,col,cell] of row.matchAll(/<td[^>]*headers="[^"]*\b(col\d+)"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const v=cell.replaceAll('&nbsp;','').trim();
    if(dates[col] && /^[-+]?\d+(\.\d+)?$/.test(v)) points.push([dates[col],+v]);
  }
  return points;
}
async function rate(){
  let points=[], source='FRED';
  try{
    const csv=await read(fred+'&cosd='+new Date(Date.now()-400*86400000).toISOString().slice(0,10),4500);
    for(const line of csv.split(/\r?\n/)){
      const [d,v]=line.split(',');
      if(/^\d{4}-\d\d-\d\d$/.test(d)&&v?.trim()&&Number.isFinite(+v)) points.push([d,+v]);
    }
  }catch{}
  if(!points.length){ points=h15(await read('https://www.federalreserve.gov/releases/h15/')); source='美联储 H.15'; }
  if(points.length<2) throw new Error('日度观测暂缺');
  const [asof,value]=points.at(-1);
  return {tips:{value,previous:points.at(-2)[1],asof,source,history:points.slice(-270)}};
}
async function load(group){
  if(group==='market') return quotes();
  if(group==='rate') return rate();
  const jobs=Object.keys(instruments).map(async id=>[id,await history(id,group==='minute')]);
  if(group==='daily') jobs.push(treasuryHistory().then(v=>['tips',v]));
  const settled=await Promise.allSettled(jobs);
  return Object.fromEntries(settled.filter(r=>r.status==='fulfilled').map(r=>r.value));
}
const expected={market:3,rate:1,minute:3,daily:4};
async function snapshot(group){
  const old=cache.get(group);
  if(old && Date.now()<old.until) return old.payload;
  if(inFlight.has(group)) return inFlight.get(group);
  const task=(async()=>{
    const checked=bj(Date.now());
    let fresh={};
    try{ fresh=await load(group); }catch{}
    const records={...old?.payload.records};
    const valid=[];
    for(const [id,q] of Object.entries(fresh)){
      const stamp=r=>r?.asof || r?.points?.at(-1)?.[0] || '';
      if(stamp(q)>=stamp(records[id])){records[id]=q; valid.push(id);}
    }
    const payload={records,valid,checked};
    const ttl=valid.length!==expected[group]?20000 : (group==='rate'||group==='daily'?900000:45000);
    cache.set(group,{payload,until:Date.now()+ttl});
    return payload;
  })();
  inFlight.set(group,task);
  try{return await task;}finally{inFlight.delete(group);}
}
export async function marketResponse(request){
  if(request.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
  const group=new URL(request.url).searchParams.get('group') || 'market';
  if(!Object.hasOwn(expected,group)) return new Response('未知行情类别',{status:400});
  const payload=await snapshot(group);
  const ok=Object.keys(payload.records).length>0;
  return Response.json(payload,{status:ok?200:503,headers:{'Cache-Control':ok?'public, max-age=10':'no-store'}});
}
