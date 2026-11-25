export function rateSeries(record,q){
  const p=new Map(record?.points || []);
  for(const [d,v] of q?.history || []) p.set(d,v);
  if(q) p.set(q.asof,q.value);
  return [...p].filter(([d])=>!q||d<=q.asof).sort((a,b)=>a[0].localeCompare(b[0]));
}
const dayMs=86400000;
export function interval(points,days){
  if(points.length<2)return [];
  if(days===1)return points.slice(-2);
  const cutoff=Date.parse(points.at(-1)[0])-days*dayMs;
  for(let i=points.length-1;i>=0;i--){
    const gap=cutoff-Date.parse(points[i][0]);
    if(gap>=0)return gap<=10*dayMs?points.slice(i):[];
  }
  return [];
}
export function view(data,id,days){
  const rate=id==='tips',q=(rate?data.rate:data.market)?.[id], daily=data.daily?.[id];
  let pts=[], prev=q?.previous, price=q?.value, asof=q?.asof||'', source=q?.source||(rate?'美国财政部':'金投网');
  if(days===1&&!rate){
    pts=data.minute?.[id]?.points||[];
    if(q){
      const t=asof.slice(0,16);
      pts=pts.filter(([d])=>d<=t);
      if(pts.length){
        const gap=timeOf(t)-timeOf(pts.at(-1)[0]);
        if(gap>6*3600000)pts=[];
        else if(gap<=180000)pts=[...pts.filter(([d])=>d!==t),[t,price]];
      }
    }else if(pts.length){[asof,price]=pts.at(-1);}
  }else{
    pts=interval(rate?rateSeries(daily,q):(daily?.points||[]),days);
    prev=pts[0]?.[1];
    if(pts.length){
      const end=pts.at(-1);
      [asof,price]=end;
      if(!rate && q && q.opening && q.opening===daily.opening &&
         Math.abs(Date.parse(end[0])-Date.parse(q.asof.slice(0,10)))<=4*dayMs &&
         timeOf(daily.fetched)-timeOf(q.asof)<=120000){
        price=q.value;asof=q.asof;pts=[...pts.slice(0,-1),[end[0],price]];
      }
    }
  }
  const change=Number.isFinite(prev)&&Number.isFinite(price)?price-prev:null;
  return {pts,price,prev,change,percent:change!==null&&prev?change/prev*100:null,asof,source,q};
}
export function timeOf(s){return Date.parse(s.length===10?s:s.replace(' ','T')+'+08:00');}
function differences(points,rate=false){
  const changes=new Map();
  for(let i=1;i<points.length;i++){
    const [day,a]=points[i-1],[end,b]=points[i];
    if(Date.parse(end)-Date.parse(day)<=5*dayMs)changes.set(day+'/'+end,rate?(b-a)*10:(b/a-1)*100);
  }
  return changes;
}
export function model(data){
  const gold=differences((data.daily?.xau?.points||[]).slice(0,-1)),oil=differences((data.daily?.brent?.points||[]).slice(0,-1));
  const rates=differences(rateSeries(data.daily?.tips,data.rate?.tips),true);
  const dates=[...gold.keys()].filter(k=>oil.has(k)&&rates.has(k)).sort().slice(-120);
  const n=dates.length;if(n<30)return null;
  const rows=dates.map(k=>[oil.get(k),rates.get(k),gold.get(k)]);
  const [mx,mr,my]=[0,1,2].map(i=>rows.reduce((s,row)=>s+row[i],0)/n);
  let xx=0,rr=0,xr=0,xy=0,ry=0,yy=0;
  for(const [x,r,y] of rows){
    const u=x-mx,v=r-mr,w=y-my;
    xx+=u*u;rr+=v*v;xr+=u*v;xy+=u*w;ry+=v*w;yy+=w*w;
  }
  const det=xx*rr-xr*xr;
  if(det<=1e-10*xx*rr||yy<=0)return null;
  const b=(xy*rr-ry*xr)/det,c=(ry*xx-xy*xr)/det;
  return {a:my-b*mx-c*mr,b,c,r2:Math.max(0,Math.min(1,(b*xy+c*ry)/yy)),n,start:dates[0].split('/')[0],end:dates.at(-1).split('/')[1]};
}
